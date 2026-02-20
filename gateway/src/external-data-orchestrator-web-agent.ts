import { Agent, type Message } from "../../agent/src/index.js";
import { Runtime } from "../../runtime/src/index.js";
import type { MemoryStore } from "../../runtime/src/memory.js";
import type { ThoughtRecord } from "../../runtime/src/web-agent/contracts.js";
import { WebTelemetry } from "../../runtime/src/web-agent/telemetry.js";
import { extractExplicitUrls } from "../../runtime/src/web-agent/url-utils.js";
import {
  DEFAULT_CONTEXT_TURN_LIMIT,
  trimConversationTurns,
  truncateToolContent,
  type ChatHistoryMessage,
} from "./chat-speed.js";
import {
  createProgressEvent,
  type ChatProgressEvent,
} from "./chat-progress.js";
import type {
  ExternalDataContract,
  ExternalDataEvent,
  ExternalDataMetrics,
  ExternalDataTurnInput,
  ExternalDataTurnResult,
} from "./external-data-contracts.js";

export interface ExternalDataOrchestratorWebAgentConfig {
  maxIterations: number;
  toolTimeoutMs: number;
  maxSources: number;
  enableTelemetry: boolean;
  provider: "openai" | "anthropic" | "google";
  maxSearchResults?: number;
  maxPagesPerTurn?: number;
  headless: boolean;
  streamThoughts: boolean;
}

interface SearchPayload {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet?: string;
    rank?: number;
  }>;
}

interface StructuredPayload {
  url: string;
  title: string;
  mainText: string;
  headings?: string[];
  links?: Array<{ text: string; url: string }>;
}

interface NavigationDecision {
  shouldContinue: boolean;
  reason: string;
  missingInfo: string[];
  nextBestUrl?: string;
}

interface ObjectiveCoverage {
  coverage: number;
  matchedTokens: string[];
  missingTokens: string[];
}

type TaskRelation = "new_task" | "continue" | "correction" | "acknowledge";
type IntentType = string;

interface TaskFrame {
  sessionId: string;
  turnId: string;
  relation: TaskRelation;
  intentType: IntentType;
  userObjective: string;
  entities: string[];
  domainHints: string[];
  requiredOutput: string;
  missingInputs: string[];
  skillPlan: string[];
  entityStatus: Record<string, "resolved" | "unresolved">;
}

const ACKNOWLEDGEMENT_ONLY_PATTERN =
  /^\s*(ok(?:ay)?|alright|got it|understood|thanks|thank you|cool|great|nice|sure)[.!]?\s*$/i;
const CORRECTION_PATTERN =
  /\b(i mean|i meant|correction|typo|that was a typo|meant)\b/i;

type StopReason =
  | "enough_info"
  | "max_actions"
  | "stagnation"
  | "repeat_guard"
  | "tool_error"
  | "finalized_by_model";

export class ExternalDataOrchestratorWebAgent {
  private readonly telemetry = new WebTelemetry();
  private readonly taskFrames = new Map<string, TaskFrame>();

  constructor(
    private readonly runtime: Runtime,
    private readonly agent: Agent,
    private readonly config: ExternalDataOrchestratorWebAgentConfig,
  ) {}

  getHealth() {
    return {
      version: "web-agent-v1",
      maxIterations: this.config.maxIterations,
      maxSearchResults: this.maxSearchResults(),
      maxPagesPerTurn: this.maxPagesPerTurn(),
      headless: this.config.headless,
      streamThoughts: this.config.streamThoughts,
    };
  }

  async runChatTurn(
    input: ExternalDataTurnInput,
  ): Promise<ExternalDataTurnResult> {
    const startedAt = performance.now();
    const events: ExternalDataEvent[] = [];
    const metrics: ExternalDataMetrics = {
      iteration_count: 0,
      model_calls: 0,
      tool_calls: 0,
      tool_failures: 0,
      time_model_ms: 0,
      time_tools_ms: 0,
      time_total_ms: 0,
    };

    const emitProgress = (event: ChatProgressEvent) => {
      if (!input.onProgress) return;
      try {
        const maybePromise = input.onProgress(event);
        if (
          maybePromise &&
          typeof (maybePromise as Promise<void>).catch === "function"
        ) {
          void (maybePromise as Promise<void>).catch((error) => {
            console.warn("web-assist progress callback failed:", error);
          });
        }
      } catch (error) {
        console.warn("web-assist progress callback failed:", error);
      }
    };

    const emitStage = (
      stage: ChatProgressEvent["stage"],
      message?: string,
      iteration?: number,
    ) => {
      emitProgress(
        createProgressEvent(stage, {
          requestId: input.requestId,
          message,
          iteration,
        }),
      );
    };

    const memory = this.runtime.getMemory();
    const sessionId = String(input.sessionId || `chat-${Date.now()}`);
    const turnId = String(input.requestId || `turn-${Date.now()}`);
    const previousFrame = this.taskFrames.get(sessionId);
    const explicitUrls = extractExplicitUrls(input.message);
    const hintedUrls = this.extractDomainHintUrls(input.message);
    const providedUrls = dedupeUrls([...explicitUrls, ...hintedUrls]);
    const taskFrame = await this.buildTaskFrame({
      sessionId,
      turnId,
      message: input.message,
      previousFrame,
      providedUrls,
    });
    this.taskFrames.set(sessionId, taskFrame);
    const domainBaseUrl = this.extractDomainBaseUrl(
      providedUrls.length > 0 ? providedUrls : taskFrame.domainHints,
    );
    const needsWebsiteUrl =
      providedUrls.length === 0 &&
      taskFrame.missingInputs.includes("official_website_url") &&
      this.shouldAskForWebsiteUrl(input.message, taskFrame);

    const previousActions = await this.loadPreviousActions(memory, sessionId);
    let thought = await this.buildThoughtRecord({
      sessionId,
      turnId,
      message: `${input.message}\nTask objective: ${taskFrame.userObjective}`,
      previousActions,
      lastToolOutcome: "none",
      sessionState: "new_turn",
    });
    this.recordThought(events, sessionId, "thought_start", thought);
    this.maybeStreamThought(emitStage, thought);

    const sources: ExternalDataContract["sources"] = [];
    const found: string[] = [];
    const structuredDocs: StructuredPayload[] = [];
    let stopReason: StopReason = "max_actions";

    if (taskFrame.relation === "acknowledge") {
      const responseText = await this.buildAcknowledgeResponse(
        previousFrame,
        input.message,
      );
      const updatedHistory = trimConversationTurns(
        [
          ...input.history,
          { role: "user", content: input.message },
          { role: "assistant", content: responseText },
        ],
        DEFAULT_CONTEXT_TURN_LIMIT,
      );
      thought = this.updateThoughtRecord(thought, {
        previousActions: [
          ...thought.previousActions,
          "Detected acknowledgement-only follow-up and skipped web actions.",
        ],
        nextBestAction:
          "Wait for the user's next concrete request or instruction.",
        usefulnessPlan:
          "Avoid unnecessary browsing for acknowledgement turns and preserve session context.",
      });
      this.recordThought(events, sessionId, "thought_final", thought);
      await this.persistThought(memory, thought);
      metrics.time_total_ms = performance.now() - startedAt;
      stopReason = "finalized_by_model";
      return {
        response: responseText,
        success: true,
        history: updatedHistory,
        externalData: {
          answer: responseText,
          sources: [],
          uncertainty:
            "No external data retrieval was needed for this acknowledgement turn.",
          confidence: 0.98,
          execution: {
            actionsTaken: 0,
            stopReason,
            mode: "site_direct",
            searchUsed: false,
          },
          presentation: {
            includeSources: false,
            style: "none",
          },
        },
        events: this.config.enableTelemetry ? events : undefined,
        metrics,
      };
    }

    if (needsWebsiteUrl) {
      const responseText = await this.buildWebsiteUrlRequestResponse(
        input.message,
        taskFrame,
      );
      const updatedHistory = trimConversationTurns(
        [
          ...input.history,
          { role: "user", content: input.message },
          { role: "assistant", content: responseText },
        ],
        DEFAULT_CONTEXT_TURN_LIMIT,
      );

      thought = this.updateThoughtRecord(thought, {
        previousActions: [
          ...thought.previousActions,
          "No explicit website URL was provided for a website-specific request.",
        ],
        nextBestAction: "Ask the user for the exact official website URL.",
        usefulnessPlan:
          "Avoid guessing domains or paths; wait for the user-provided URL and then navigate directly.",
      });
      this.recordThought(events, sessionId, "thought_final", thought);
      await this.persistThought(memory, thought);
      metrics.time_total_ms = performance.now() - startedAt;
      stopReason = "finalized_by_model";

      return {
        response: responseText,
        success: true,
        history: updatedHistory,
        externalData: {
          answer: responseText,
          sources: [],
          uncertainty:
            "Waiting for the user to provide the official website URL to avoid incorrect navigation.",
          confidence: 0.92,
          execution: {
            actionsTaken: 0,
            stopReason,
            mode: "site_direct",
            searchUsed: false,
          },
          presentation: {
            includeSources: false,
            style: "none",
          },
        },
        events: this.config.enableTelemetry ? events : undefined,
        metrics,
      };
    }

    try {
      emitStage("planning", "Starting persistent web-assist session...");

      const sessionStart = (await this.runTool(
        "web_session_start",
        {
          headless: this.config.headless,
          viewport: { width: 1366, height: 900 },
          locale: "en-US",
          timezone: process.env.TZ || "America/New_York",
        },
        sessionId,
        metrics,
        events,
      )) as {
        session?: {
          backend?: string;
          liveViewUrl?: string;
          remoteSessionId?: string;
          remoteContextId?: string;
        };
      };
      const sessionMeta = sessionStart?.session;
      if (sessionMeta?.backend) {
        this.pushEvent(events, "tool_complete", {
          name: "web_session_backend",
          success: true,
          backend: sessionMeta.backend,
          remoteSessionId: sessionMeta.remoteSessionId,
          remoteContextId: sessionMeta.remoteContextId,
          liveViewUrl: sessionMeta.liveViewUrl,
        });
      }
      if (sessionMeta?.liveViewUrl && this.shouldExposeLiveViewLink()) {
        emitStage("planning", `Live view: ${sessionMeta.liveViewUrl}`);
      }

      thought = this.updateThoughtRecord(thought, {
        previousActions: [
          ...thought.previousActions,
          "Started persistent browser session.",
        ],
        nextBestAction:
          providedUrls.length > 0
            ? "Open provided URL(s) and discover relevant pages inside the same site."
            : "Search the web for supporting external data.",
      });
      this.recordThought(events, sessionId, "thought_update", thought);

      let searchPayload: SearchPayload | null = null;
      const targetUrls: string[] = [];

      if (providedUrls.length > 0) {
        targetUrls.push(...providedUrls);
      }

      if (domainBaseUrl) {
        emitStage(
          "discovering",
          `Discovering key pages on ${domainBaseUrl}...`,
        );
        const discovered = await this.discoverSiteUrls({
          sessionId,
          siteBaseUrl: domainBaseUrl,
          message: taskFrame.userObjective || input.message,
          metrics,
          events,
          emitStage,
        });
        targetUrls.push(...discovered);
      } else if (providedUrls.length === 0) {
        emitStage("searching", "Checking web data from multiple sources...");
        const plannedSearchQuery = this.buildSearchQuery(
          taskFrame,
          input.message,
        );
        const rawSearch = (await this.runTool(
          "web_search",
          {
            query: plannedSearchQuery,
            limit: this.maxSearchResults(),
          },
          sessionId,
          metrics,
          events,
        )) as SearchPayload;

        const rankedResults = this.rankSearchResultsForTask(
          Array.isArray(rawSearch.results) ? rawSearch.results : [],
          taskFrame,
          plannedSearchQuery,
        );
        searchPayload = {
          query: plannedSearchQuery,
          results: rankedResults,
        };

        targetUrls.push(
          ...searchPayload.results
            .map((result) => String(result.url || "").trim())
            .filter(Boolean)
            .slice(0, this.maxPagesPerTurn()),
        );

        thought = this.updateThoughtRecord(thought, {
          previousActions: [
            ...thought.previousActions,
            `Ran web search and collected ${targetUrls.length} target URLs.`,
          ],
          nextBestAction:
            targetUrls.length > 0
              ? "Open top pages and extract structured content."
              : "Synthesize a best-effort answer with baseline knowledge.",
        });
        this.recordThought(events, sessionId, "thought_update", thought);
      }

      const candidateLimit = Math.max(this.maxPagesPerTurn() * 3, 8);
      const dedupedTargets = dedupeUrls(targetUrls).slice(0, candidateLimit);
      const pendingUrls = [...dedupedTargets];
      const visitedUrls = new Set<string>();

      while (
        pendingUrls.length > 0 &&
        metrics.iteration_count < this.config.maxIterations
      ) {
        const url = pendingUrls.shift();
        if (!url) break;
        const normalizedUrl = normalizeUrl(url);
        if (normalizedUrl && visitedUrls.has(normalizedUrl)) {
          continue;
        }

        metrics.iteration_count += 1;
        const stepNumber = metrics.iteration_count;

        try {
          emitStage("opening_pages", `Opening ${url}`, stepNumber);
          await this.runTool(
            "web_act",
            {
              action: {
                type: "navigate",
                url,
                options: {
                  timeoutMs: 35_000,
                  waitUntil: "load",
                  settleMs: 1200,
                },
              },
            },
            sessionId,
            metrics,
            events,
          );

          await this.runTool(
            "web_observe",
            {
              mode: "dom+vision",
              includeScreenshot: stepNumber === 1,
            },
            sessionId,
            metrics,
            events,
          );

          emitStage("extracting", "Extracting structured page content...");
          const extracted = (await this.runTool(
            "web_extract_structured",
            {},
            sessionId,
            metrics,
            events,
          )) as StructuredPayload;

          const extractedUrl =
            normalizeUrl(extracted?.url) || normalizedUrl || url;
          if (extractedUrl) {
            visitedUrls.add(extractedUrl);
          }

          if (extracted?.url) {
            sources.push({
              title: extracted.title || extracted.url,
              url: extracted.url,
              whyRelevant: "Captured from a page visited during this turn.",
            });
          }

          if (extracted?.mainText) {
            structuredDocs.push(extracted);
            found.push(
              `${extracted.title || extracted.url}: ${extracted.mainText.slice(0, 180)}...`,
            );
          }

          const decision = await this.decideNavigationAfterPage({
            taskFrame,
            userMessage: input.message,
            currentDoc: extracted,
            visitedUrls: Array.from(visitedUrls),
            remainingUrls: pendingUrls,
            allCandidateUrls: dedupedTargets,
            metrics,
          });

          if (!decision.shouldContinue) {
            stopReason = "enough_info";
            emitStage(
              "planning",
              `Current page is sufficient. ${decision.reason}`,
              stepNumber,
            );
            thought = this.updateThoughtRecord(thought, {
              previousActions: [
                ...thought.previousActions,
                `Stopped after ${extracted?.url || url}: ${decision.reason}`,
              ],
              nextBestAction:
                "Draft final helpful answer using available context.",
            });
            this.recordThought(events, sessionId, "thought_update", thought);
            break;
          }

          if (decision.nextBestUrl) {
            const nextNormalized = normalizeUrl(decision.nextBestUrl);
            const alreadyVisited = nextNormalized
              ? visitedUrls.has(nextNormalized)
              : false;
            const alreadyQueued = pendingUrls.some(
              (item) => normalizeUrl(item) === nextNormalized,
            );
            if (!alreadyVisited && !alreadyQueued) {
              pendingUrls.unshift(decision.nextBestUrl);
            }
          }

          emitStage(
            "planning",
            decision.nextBestUrl
              ? `Current page incomplete: ${decision.reason}. Next: ${decision.nextBestUrl}`
              : `Current page incomplete: ${decision.reason}. Checking next best candidate page.`,
            stepNumber,
          );

          thought = this.updateThoughtRecord(thought, {
            previousActions: [
              ...thought.previousActions,
              `Processed ${extracted?.url || url}. ${
                decision.shouldContinue
                  ? `Continue: ${decision.reason}`
                  : "Sufficient page found."
              }`,
            ],
            nextBestAction: decision.nextBestUrl
              ? `Open ${decision.nextBestUrl} because current page is missing required details.`
              : "Open the highest-ranked remaining page to fill missing information.",
          });
          this.recordThought(events, sessionId, "thought_update", thought);
        } catch (stepError: any) {
          const message = String(
            stepError?.message || stepError || "Unknown error",
          );
          thought = this.updateThoughtRecord(thought, {
            previousActions: [
              ...thought.previousActions,
              `Failed to process ${url}: ${message.slice(0, 180)}`,
            ],
            nextBestAction:
              pendingUrls.length > 0
                ? "Skip failing page and continue with remaining relevant pages."
                : "Synthesize from successfully gathered data and state any uncertainty.",
          });
          this.recordThought(events, sessionId, "thought_update", thought);
          continue;
        }
      }

      const synthesis = await this.synthesizeResponse(
        input.message,
        input.history,
        searchPayload,
        structuredDocs,
        taskFrame,
        metrics,
      );

      const responseText = await this.ensureBestEffortAnswer(
        synthesis.answer,
        input.message,
        structuredDocs.length > 0 || (searchPayload?.results.length || 0) > 0,
      );
      if (stopReason !== "enough_info") {
        stopReason =
          metrics.iteration_count >= this.config.maxIterations
            ? "max_actions"
            : "finalized_by_model";
      }

      const updatedHistory = trimConversationTurns(
        [
          ...input.history,
          { role: "user", content: input.message },
          { role: "assistant", content: responseText },
        ],
        DEFAULT_CONTEXT_TURN_LIMIT,
      );

      this.pushEvent(events, "finalized", {
        version: "web-agent-v1",
        actionsTaken: metrics.tool_calls,
        stopReason,
      });

      emitStage("done", "Done.");

      metrics.time_total_ms = performance.now() - startedAt;
      metrics.canonical_source_count = sources.length;
      metrics.external_doc_count = structuredDocs.length;

      thought = this.updateThoughtRecord(thought, {
        nextBestAction:
          "Provide concise answer with uncertainty only if needed.",
        usefulnessPlan:
          structuredDocs.length > 0
            ? "Use extracted page details to answer directly and cite source URLs."
            : "Provide best-effort guidance, clearly noting limited external web confirmation.",
      });
      this.recordThought(events, sessionId, "thought_final", thought);
      await this.persistThought(memory, thought);
      this.taskFrames.set(
        sessionId,
        this.finalizeTaskFrame(taskFrame, structuredDocs, searchPayload),
      );

      return {
        response: responseText,
        success: true,
        history: updatedHistory,
        externalData: {
          answer: responseText,
          sources: dedupeSources(sources).slice(0, this.config.maxSources),
          uncertainty:
            synthesis.uncertainty ||
            (structuredDocs.length > 0
              ? "Based on pages visited in this turn."
              : "Web context was limited; answer includes best-effort guidance."),
          confidence:
            typeof synthesis.confidence === "number"
              ? clamp(
                  synthesis.confidence,
                  structuredDocs.length > 0 ? 0.72 : 0.55,
                )
              : structuredDocs.length > 0
                ? 0.72
                : 0.55,
          found: found.slice(0, 6),
          execution: {
            actionsTaken: metrics.tool_calls,
            stopReason,
            mode:
              providedUrls.length > 0 || Boolean(domainBaseUrl)
                ? "site_direct"
                : "web_first",
            discoveryMode: "source_pack_url_first",
            searchUsed: providedUrls.length === 0 && !domainBaseUrl,
          },
          presentation: {
            includeSources: sources.length > 0,
            style: sources.length > 0 ? "appendix" : "none",
          },
        },
        events: this.config.enableTelemetry ? events : undefined,
        metrics,
      };
    } catch (error) {
      emitStage("error");
      metrics.time_total_ms = performance.now() - startedAt;

      thought = this.updateThoughtRecord(thought, {
        previousActions: [
          ...thought.previousActions,
          "Turn ended with an execution error.",
        ],
        nextBestAction:
          "Return an actionable fallback answer and ask for clarification if needed.",
      });
      this.recordThought(events, sessionId, "thought_final", thought);
      await this.persistThought(memory, thought);

      console.error("web-assist orchestrator error:", error);
      throw error;
    }
  }

  private maxSearchResults(): number {
    return Math.max(3, Math.min(20, this.config.maxSearchResults ?? 8));
  }

  private maxPagesPerTurn(): number {
    return Math.max(1, Math.min(6, this.config.maxPagesPerTurn ?? 3));
  }

  private shouldExposeLiveViewLink(): boolean {
    const configured = String(
      process.env.NOVA_WEB_EXPOSE_LIVE_VIEW_LINK || "true",
    )
      .trim()
      .toLowerCase();
    return configured !== "false";
  }

  private async runTool(
    toolName: string,
    params: Record<string, unknown>,
    sessionId: string,
    metrics: ExternalDataMetrics,
    events: ExternalDataEvent[],
  ): Promise<unknown> {
    metrics.tool_calls += 1;
    this.pushEvent(events, "tool_start", {
      name: toolName,
      parameters: params,
    });

    const started = performance.now();
    try {
      const result = await withTimeout(
        this.runtime.executeTool(toolName, params, { sessionId }),
        this.config.toolTimeoutMs,
        `Tool '${toolName}' timed out after ${this.config.toolTimeoutMs}ms`,
      );
      metrics.time_tools_ms += performance.now() - started;
      this.pushEvent(events, "tool_complete", {
        name: toolName,
        success: true,
      });
      return result;
    } catch (error: any) {
      metrics.time_tools_ms += performance.now() - started;
      const message = String(error?.message || "Unknown error");
      if (this.shouldRecoverMissingSession(toolName, message)) {
        await this.recoverMissingSession(sessionId, metrics, events);

        const retryStarted = performance.now();
        metrics.tool_calls += 1;
        this.pushEvent(events, "tool_start", {
          name: toolName,
          parameters: params,
          retryAfterSessionRecovery: true,
        });

        try {
          const retried = await withTimeout(
            this.runtime.executeTool(toolName, params, { sessionId }),
            this.config.toolTimeoutMs,
            `Tool '${toolName}' timed out after ${this.config.toolTimeoutMs}ms`,
          );
          metrics.time_tools_ms += performance.now() - retryStarted;
          this.pushEvent(events, "tool_complete", {
            name: toolName,
            success: true,
            retryAfterSessionRecovery: true,
          });
          return retried;
        } catch (retryError: any) {
          metrics.time_tools_ms += performance.now() - retryStarted;
          metrics.tool_failures += 1;
          this.pushEvent(events, "tool_complete", {
            name: toolName,
            success: false,
            retryAfterSessionRecovery: true,
            error: String(retryError?.message || "Unknown error"),
          });
          throw retryError;
        }
      }

      metrics.tool_failures += 1;
      this.pushEvent(events, "tool_complete", {
        name: toolName,
        success: false,
        error: message,
      });
      throw error;
    }
  }

  private async synthesizeResponse(
    message: string,
    history: ChatHistoryMessage[],
    searchPayload: SearchPayload | null,
    docs: StructuredPayload[],
    taskFrame: TaskFrame,
    metrics: ExternalDataMetrics,
  ): Promise<{
    answer: string;
    uncertainty?: string;
    confidence?: number;
  }> {
    const prompt = [
      "You are Nova's web-assist synthesis service.",
      "Combine your baseline knowledge with supporting web context from this turn.",
      "Prefer web-derived facts when they are available and relevant.",
      "If web context is limited, still provide a useful best-effort answer with a short uncertainty note.",
      "Do not refuse purely because web data is missing.",
      "If the user is correcting a prior entity, continue the same objective instead of changing topic.",
      "Write for mobile chat readability: direct answer first, short paragraphs, concise bullets only when needed.",
      "Avoid markdown-heavy styling: no bold markers, no decorative headings, no tables.",
      'Return JSON only with shape: {"answer":"...","uncertainty":"...","confidence":0.0}',
      `Current date/time: ${new Date().toISOString()}`,
      `User task: ${message}`,
      `Task frame: ${truncateToolContent(taskFrame, 2500)}`,
      `Recent history: ${truncateToolContent(
        this.toSimpleHistory(history).slice(-4),
        1500,
      )}`,
      `Search context: ${truncateToolContent(searchPayload, 6000)}`,
      `Visited documents: ${truncateToolContent(docs, 14000)}`,
    ].join("\n\n");

    const started = performance.now();
    const raw = await this.agent.chat(prompt, []);
    metrics.time_model_ms += performance.now() - started;
    metrics.model_calls += 1;

    const parsed = this.parseJson(raw) as {
      answer?: string;
      uncertainty?: string;
      confidence?: number;
    } | null;

    if (!parsed) {
      return {
        answer: "",
        uncertainty: "Web synthesis output was not parseable.",
        confidence: docs.length > 0 ? 0.58 : 0.45,
      };
    }

    return {
      answer: String(parsed.answer || "").trim(),
      uncertainty:
        typeof parsed.uncertainty === "string"
          ? parsed.uncertainty.trim()
          : undefined,
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    };
  }

  private async buildThoughtRecord(args: {
    sessionId: string;
    turnId: string;
    message: string;
    previousActions: string[];
    lastToolOutcome: string;
    sessionState: string;
  }): Promise<ThoughtRecord> {
    const fallback = this.buildFallbackThought(args);

    const prompt = [
      "Create a concise web-assist thought record for Nova.",
      "Return JSON only with keys: intent, previousActions, nextBestAction, usefulnessPlan.",
      "Keep each field practical, short, and action-oriented.",
      `User message: ${args.message}`,
      `Previous actions: ${JSON.stringify(args.previousActions.slice(-6))}`,
      `Last tool outcome: ${args.lastToolOutcome}`,
      `Session state: ${args.sessionState}`,
    ].join("\n\n");

    try {
      const raw = await this.agent.chat(prompt, []);
      const parsed = this.parseJson(raw) as {
        intent?: unknown;
        previousActions?: unknown;
        nextBestAction?: unknown;
        usefulnessPlan?: unknown;
      } | null;

      if (!parsed || typeof parsed !== "object") {
        return fallback;
      }

      return {
        sessionId: args.sessionId,
        turnId: args.turnId,
        intent:
          typeof parsed.intent === "string" && parsed.intent.trim()
            ? parsed.intent.trim()
            : fallback.intent,
        previousActions: Array.isArray(parsed.previousActions)
          ? parsed.previousActions
              .map((item) => String(item || "").trim())
              .filter(Boolean)
              .slice(-8)
          : fallback.previousActions,
        nextBestAction:
          typeof parsed.nextBestAction === "string" &&
          parsed.nextBestAction.trim()
            ? parsed.nextBestAction.trim()
            : fallback.nextBestAction,
        usefulnessPlan:
          typeof parsed.usefulnessPlan === "string" &&
          parsed.usefulnessPlan.trim()
            ? parsed.usefulnessPlan.trim()
            : fallback.usefulnessPlan,
        timestamp: new Date().toISOString(),
      };
    } catch {
      return fallback;
    }
  }

  private buildFallbackThought(args: {
    sessionId: string;
    turnId: string;
    message: string;
    previousActions: string[];
  }): ThoughtRecord {
    const message = String(args.message || "").trim();
    const intent = message
      ? `Understand and solve the user's request: ${message.slice(0, 220)}`
      : "Understand the user's request and provide a useful answer.";
    return {
      sessionId: args.sessionId,
      turnId: args.turnId,
      intent,
      previousActions:
        args.previousActions.length > 0
          ? args.previousActions.slice(-8)
          : ["No prior web actions recorded for this session."],
      nextBestAction:
        extractExplicitUrls(message).length > 0 ||
        this.extractDomainHintUrls(message).length > 0
          ? "Open the provided URL and extract the most relevant details."
          : "Search for current external web data relevant to the request.",
      usefulnessPlan:
        "Provide a direct answer, then add concise supporting web context when it materially improves accuracy.",
      timestamp: new Date().toISOString(),
    };
  }

  private updateThoughtRecord(
    current: ThoughtRecord,
    patch: Partial<
      Pick<
        ThoughtRecord,
        "intent" | "previousActions" | "nextBestAction" | "usefulnessPlan"
      >
    >,
  ): ThoughtRecord {
    return {
      ...current,
      ...patch,
      timestamp: new Date().toISOString(),
    };
  }

  private recordThought(
    events: ExternalDataEvent[],
    sessionId: string,
    type: "thought_start" | "thought_update" | "thought_final",
    thought: ThoughtRecord,
  ): void {
    this.pushEvent(events, type, { thought });
    this.telemetry.record(sessionId, type, { thought });
  }

  private maybeStreamThought(
    emitStage: (
      stage: ChatProgressEvent["stage"],
      message?: string,
      iteration?: number,
    ) => void,
    thought: ThoughtRecord,
  ): void {
    if (!this.config.streamThoughts) return;
    emitStage("planning", `Intent: ${thought.intent}`);
    emitStage("planning", `Next action: ${thought.nextBestAction}`);
  }

  private async persistThought(
    memory: MemoryStore,
    thought: ThoughtRecord,
  ): Promise<void> {
    const content = [
      `Intent: ${thought.intent}`,
      `Previous actions: ${thought.previousActions.join(" | ")}`,
      `Next action: ${thought.nextBestAction}`,
      `Usefulness plan: ${thought.usefulnessPlan}`,
    ].join("\n");

    await memory.store({
      id: `thought-${thought.sessionId}-${thought.turnId}-${Date.now()}`,
      content,
      timestamp: Date.now(),
      importance: 0.65,
      decayRate: 0.08,
      tags: [
        "thought",
        "intent",
        "next_action",
        "usefulness_plan",
        "web_assist",
      ],
      source: "chat",
      category: "conversation",
      sessionId: thought.sessionId,
      metadata: {
        turnId: thought.turnId,
        thought,
      },
    });
  }

  private async loadPreviousActions(
    memory: MemoryStore,
    sessionId: string,
  ): Promise<string[]> {
    try {
      const recent = await memory.getRecent("conversation", 40);
      return recent
        .filter((entry) => entry.sessionId === sessionId)
        .filter(
          (entry) =>
            Array.isArray(entry.tags) && entry.tags.includes("thought"),
        )
        .slice(-3)
        .flatMap((entry) => {
          const metadata = entry.metadata || {};
          const stored = (metadata as Record<string, unknown>).thought;
          if (!stored || typeof stored !== "object") return [];
          const actions = (stored as { previousActions?: unknown })
            .previousActions;
          if (!Array.isArray(actions)) return [];
          return actions
            .map((item) => String(item || "").trim())
            .filter(Boolean);
        })
        .slice(-8);
    } catch {
      return [];
    }
  }

  private toSimpleHistory(history: ChatHistoryMessage[]): Message[] {
    return history
      .filter(
        (item) =>
          item.role === "system" ||
          item.role === "user" ||
          item.role === "assistant",
      )
      .map((item) => ({
        role: item.role as "system" | "user" | "assistant",
        content: item.content,
      }));
  }

  private parseJson(text: string): unknown | null {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }

  private pushEvent(
    events: ExternalDataEvent[],
    type: ExternalDataEvent["type"],
    details?: Record<string, unknown>,
  ): void {
    events.push({
      type,
      timestamp: Date.now(),
      details,
    });
  }

  private shouldRecoverMissingSession(
    toolName: string,
    message: string,
  ): boolean {
    if (toolName === "web_session_start") return false;
    if (!toolName.startsWith("web_")) return false;
    return /no active web session/i.test(message);
  }

  private async recoverMissingSession(
    sessionId: string,
    metrics: ExternalDataMetrics,
    events: ExternalDataEvent[],
  ): Promise<void> {
    metrics.tool_calls += 1;
    this.pushEvent(events, "tool_start", {
      name: "web_session_start",
      recovery: "missing_session",
    });
    const started = performance.now();
    try {
      await withTimeout(
        this.runtime.executeTool(
          "web_session_start",
          {
            headless: this.config.headless,
            viewport: { width: 1366, height: 900 },
            locale: "en-US",
            timezone: process.env.TZ || "America/New_York",
          },
          { sessionId },
        ),
        this.config.toolTimeoutMs,
        `Tool 'web_session_start' timed out after ${this.config.toolTimeoutMs}ms`,
      );
      metrics.time_tools_ms += performance.now() - started;
      this.pushEvent(events, "tool_complete", {
        name: "web_session_start",
        success: true,
        recovery: "missing_session",
      });
    } catch (error: any) {
      metrics.time_tools_ms += performance.now() - started;
      metrics.tool_failures += 1;
      this.pushEvent(events, "tool_complete", {
        name: "web_session_start",
        success: false,
        recovery: "missing_session",
        error: String(error?.message || "Unknown error"),
      });
      throw error;
    }
  }

  private async buildTaskFrame(args: {
    sessionId: string;
    turnId: string;
    message: string;
    previousFrame?: TaskFrame;
    providedUrls: string[];
  }): Promise<TaskFrame> {
    const fallback = this.buildFallbackTaskFrame(args);
    const prompt = [
      "You are Nova's web-assist task planner.",
      "Infer the task context without hardcoded intent categories.",
      "Keep continuity with previous frame when the user is correcting or continuing.",
      "If user message is acknowledgement-only, relation must be 'acknowledge'.",
      "Return JSON only with keys:",
      "relation, intentType, userObjective, entities, domainHints, requiredOutput, missingInputs, skillPlan",
      "Allowed relation values: new_task, continue, correction, acknowledge.",
      "missingInputs should include 'official_website_url' only when the task truly depends on navigating a specific site and no reliable domain is available.",
      `User message: ${args.message}`,
      `Previous frame: ${truncateToolContent(args.previousFrame || null, 2000)}`,
      `Provided URLs: ${JSON.stringify(args.providedUrls)}`,
    ].join("\n\n");

    try {
      const raw = await this.agent.chat(prompt, []);
      const parsed = this.parseJson(raw) as {
        relation?: unknown;
        intentType?: unknown;
        userObjective?: unknown;
        entities?: unknown;
        domainHints?: unknown;
        requiredOutput?: unknown;
        missingInputs?: unknown;
        skillPlan?: unknown;
      } | null;

      if (!parsed || typeof parsed !== "object") return fallback;

      const relation = this.normalizeTaskRelation(
        parsed.relation,
        fallback.relation,
      );
      const explicitEntities = safeStringArray(parsed.entities);
      const entities = this.resolveEntities({
        relation,
        explicitEntities:
          explicitEntities.length > 0 ? explicitEntities : fallback.entities,
        previousFrame: args.previousFrame,
      });
      const domainHints = dedupeUrls([
        ...args.providedUrls,
        ...safeStringArray(parsed.domainHints).map((value) =>
          /^https?:\/\//i.test(value) ? value : `https://${value}`,
        ),
        ...(relation === "new_task"
          ? []
          : args.previousFrame?.domainHints || []),
      ]);
      const missingInputs = dedupeStrings([
        ...safeStringArray(parsed.missingInputs),
        ...(domainHints.length === 0 &&
        this.shouldAskForWebsiteUrl(args.message)
          ? ["official_website_url"]
          : []),
      ]).filter(
        (item) => !(item === "official_website_url" && domainHints.length > 0),
      );
      const entityStatus = this.resolveEntityStatus({
        entities,
        previousFrame: args.previousFrame,
      });

      return {
        sessionId: args.sessionId,
        turnId: args.turnId,
        relation,
        intentType:
          typeof parsed.intentType === "string" && parsed.intentType.trim()
            ? parsed.intentType.trim()
            : fallback.intentType,
        userObjective:
          typeof parsed.userObjective === "string" &&
          parsed.userObjective.trim()
            ? parsed.userObjective.trim()
            : this.buildUserObjective({
                message: args.message,
                relation,
                entities,
                previousFrame: args.previousFrame,
              }),
        entities,
        domainHints,
        requiredOutput:
          typeof parsed.requiredOutput === "string" &&
          parsed.requiredOutput.trim()
            ? parsed.requiredOutput.trim()
            : this.buildRequiredOutputFromMessage(args.message, entities),
        missingInputs,
        skillPlan:
          safeStringArray(parsed.skillPlan).length > 0
            ? safeStringArray(parsed.skillPlan).slice(0, 8)
            : this.buildSkillPlan(domainHints.length > 0),
        entityStatus,
      };
    } catch {
      return fallback;
    }
  }

  private buildFallbackTaskFrame(args: {
    sessionId: string;
    turnId: string;
    message: string;
    previousFrame?: TaskFrame;
    providedUrls: string[];
  }): TaskFrame {
    const relation = this.resolveTaskRelation(args.message, args.previousFrame);
    const explicitEntities = this.extractEntityCandidates(args.message);
    const entities = this.resolveEntities({
      relation,
      explicitEntities,
      previousFrame: args.previousFrame,
    });
    const domainHints = dedupeUrls([
      ...args.providedUrls,
      ...(relation === "new_task" ? [] : args.previousFrame?.domainHints || []),
    ]);
    const missingInputs =
      domainHints.length === 0 && this.shouldAskForWebsiteUrl(args.message)
        ? ["official_website_url"]
        : [];

    return {
      sessionId: args.sessionId,
      turnId: args.turnId,
      relation,
      intentType:
        args.previousFrame &&
        (relation === "continue" ||
          relation === "correction" ||
          relation === "acknowledge")
          ? args.previousFrame.intentType
          : "web_assist_task",
      userObjective: this.buildUserObjective({
        message: args.message,
        relation,
        entities,
        previousFrame: args.previousFrame,
      }),
      entities,
      domainHints,
      requiredOutput: this.buildRequiredOutputFromMessage(
        args.message,
        entities,
      ),
      missingInputs,
      skillPlan: this.buildSkillPlan(domainHints.length > 0),
      entityStatus: this.resolveEntityStatus({
        entities,
        previousFrame: args.previousFrame,
      }),
    };
  }

  private normalizeTaskRelation(
    value: unknown,
    fallback: TaskRelation,
  ): TaskRelation {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
    if (
      normalized === "new_task" ||
      normalized === "continue" ||
      normalized === "correction" ||
      normalized === "acknowledge"
    ) {
      return normalized;
    }
    return fallback;
  }

  private resolveTaskRelation(
    message: string,
    previousFrame?: TaskFrame,
  ): TaskRelation {
    if (!previousFrame) return "new_task";
    const lower = String(message || "").toLowerCase();
    if (ACKNOWLEDGEMENT_ONLY_PATTERN.test(message)) return "acknowledge";
    if (CORRECTION_PATTERN.test(lower)) return "correction";

    const tokenCount = lower.split(/[^a-z0-9]+/).filter(Boolean).length;
    if (tokenCount <= 4) return "continue";

    const hasExplicitUrl = extractExplicitUrls(message).length > 0;
    const startsWithQuestion =
      lower.startsWith("what") ||
      lower.startsWith("how") ||
      lower.startsWith("where") ||
      lower.startsWith("when");
    if (hasExplicitUrl || startsWithQuestion) return "new_task";

    return "continue";
  }

  private extractEntityCandidates(message: string): string[] {
    const cleaned = String(message || "")
      .replace(/\b(i mean|i meant|correction|typo|that was a typo)\b/gi, " ")
      .trim();
    if (!cleaned) return [];

    const fromQuoted =
      cleaned
        .match(/"([^"]+)"|'([^']+)'/g)
        ?.map((item) => item.slice(1, -1).trim()) || [];
    const fromDomain = this.extractDomainHintUrls(cleaned).map((url) => {
      try {
        return new URL(url).hostname.replace(/^www\./i, "");
      } catch {
        return "";
      }
    });
    const titleLike = cleaned.match(/\b[A-Z][a-zA-Z0-9.&-]{1,30}\b/g) || [];
    return dedupeStrings([...fromQuoted, ...fromDomain, ...titleLike]).filter(
      Boolean,
    );
  }

  private resolveEntities(args: {
    relation: TaskRelation;
    explicitEntities: string[];
    previousFrame?: TaskFrame;
  }): string[] {
    const { relation, explicitEntities, previousFrame } = args;
    if (!previousFrame) return dedupeStrings(explicitEntities);
    if (relation === "acknowledge") return [...previousFrame.entities];

    if (relation === "correction") {
      if (explicitEntities.length === 0) return [...previousFrame.entities];
      if (explicitEntities.length === 1 && previousFrame.entities.length > 0) {
        const next = [...previousFrame.entities];
        const unresolvedIndex = next.findIndex(
          (entity) => previousFrame.entityStatus[entity] === "unresolved",
        );
        const replaceIndex =
          unresolvedIndex >= 0 ? unresolvedIndex : next.length - 1;
        next[replaceIndex] = explicitEntities[0];
        return dedupeStrings(next);
      }
      return dedupeStrings(explicitEntities);
    }

    if (relation === "continue") {
      return explicitEntities.length > 0
        ? dedupeStrings([...previousFrame.entities, ...explicitEntities])
        : [...previousFrame.entities];
    }

    return dedupeStrings(explicitEntities);
  }

  private resolveEntityStatus(args: {
    entities: string[];
    previousFrame?: TaskFrame;
  }): Record<string, "resolved" | "unresolved"> {
    const status: Record<string, "resolved" | "unresolved"> = {};
    for (const entity of args.entities) {
      status[entity] =
        args.previousFrame?.entityStatus?.[entity] || "unresolved";
    }
    return status;
  }

  private buildRequiredOutputFromMessage(
    message: string,
    entities: string[],
  ): string {
    if (entities.length > 0) {
      return `Answer the user request for ${entities.join(", ")} with concrete external-data details.`;
    }
    const trimmed = String(message || "").trim();
    if (!trimmed) return "Provide a concise web-assisted answer.";
    return `Provide the exact output the user asked for: ${trimmed.slice(0, 220)}`;
  }

  private buildSkillPlan(hasDomainHint: boolean): string[] {
    return hasDomainHint
      ? ["navigate_to_domain", "discover_pages", "extract_structured", "answer"]
      : [
          "search_web",
          "rank_sources",
          "open_pages",
          "extract_structured",
          "answer",
        ];
  }

  private buildUserObjective(args: {
    message: string;
    relation: TaskRelation;
    entities: string[];
    previousFrame?: TaskFrame;
  }): string {
    const trimmed = String(args.message || "").trim();
    if (args.relation === "acknowledge" && args.previousFrame) {
      return args.previousFrame.userObjective;
    }
    if (
      args.previousFrame &&
      (args.relation === "continue" || args.relation === "correction") &&
      trimmed.length <= 80
    ) {
      if (args.entities.length > 0) {
        return `${args.previousFrame.userObjective} | updated entities: ${args.entities.join(", ")}`;
      }
      return args.previousFrame.userObjective;
    }
    return trimmed || "Provide useful web-assisted support.";
  }

  private async buildAcknowledgeResponse(
    previousFrame: TaskFrame | undefined,
    userMessage: string,
  ): Promise<string> {
    return await this.composeUserFacingFallback({
      intent: "acknowledgement_turn",
      userMessage,
      context: {
        previousObjective: previousFrame?.userObjective || null,
      },
    });
  }

  private buildSearchQuery(taskFrame: TaskFrame, rawMessage: string): string {
    const pendingEntities = taskFrame.entities.filter(
      (entity) => taskFrame.entityStatus[entity] !== "resolved",
    );
    const entitiesPart = (
      pendingEntities.length > 0 ? pendingEntities : taskFrame.entities
    ).join(" ");
    const objectivePart =
      taskFrame.requiredOutput || taskFrame.userObjective || rawMessage;
    const host = taskFrame.domainHints
      .map((url) => {
        try {
          return new URL(url).hostname.replace(/^www\./i, "");
        } catch {
          return "";
        }
      })
      .find(Boolean);

    if (host) {
      return `site:${host} ${objectivePart}`.trim().slice(0, 220);
    }

    const query = `${entitiesPart} ${objectivePart}`.trim();
    return (query || rawMessage).slice(0, 220);
  }

  private rankSearchResultsForTask(
    results: Array<{
      title: string;
      url: string;
      snippet?: string;
      rank?: number;
    }>,
    taskFrame: TaskFrame,
    fallbackQuery: string,
  ): Array<{ title: string; url: string; snippet?: string; rank?: number }> {
    const objectiveTokens = dedupeStrings(
      `${taskFrame.requiredOutput} ${taskFrame.userObjective} ${fallbackQuery} ${taskFrame.entities.join(" ")}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3),
    );
    const domainHosts = taskFrame.domainHints
      .map((url) => {
        try {
          return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
        } catch {
          return "";
        }
      })
      .filter(Boolean);

    const ranked = results
      .map((result, index) => {
        const title = String(result.title || "");
        const url = String(result.url || "");
        const snippet = String(result.snippet || "");
        const blob = `${title} ${url} ${snippet}`.toLowerCase();
        let score = Math.max(0, 6 - index * 0.35);
        for (const token of objectiveTokens) {
          if (blob.includes(token)) score += 0.4;
        }
        for (const host of domainHosts) {
          if (blob.includes(host)) score += 4.5;
        }
        if (
          /\bhow-to\b/i.test(blob) &&
          !objectiveTokens.some((token) => token === "how")
        ) {
          score -= 1.4;
        }
        return { ...result, score };
      })
      .sort((a, b) => b.score - a.score);

    return ranked.map(({ score, ...result }) => result);
  }

  private async decideNavigationAfterPage(args: {
    taskFrame: TaskFrame;
    userMessage: string;
    currentDoc: StructuredPayload;
    visitedUrls: string[];
    remainingUrls: string[];
    allCandidateUrls: string[];
    metrics: ExternalDataMetrics;
  }): Promise<NavigationDecision> {
    const fallback = this.buildFallbackNavigationDecision(args);
    const prompt = [
      "You are Nova's page navigation judge.",
      "Decide whether the current page already provides enough information for the user objective.",
      "Only suggest moving to a new page if there is a clear information gap.",
      "If moving, choose one best next URL from remainingUrls and explain why.",
      "Return JSON only with keys: shouldContinue, reason, missingInfo, nextBestUrl.",
      `User request: ${args.userMessage}`,
      `Task objective: ${args.taskFrame.userObjective}`,
      `Required output: ${args.taskFrame.requiredOutput}`,
      `Current page: ${truncateToolContent(args.currentDoc, 5000)}`,
      `Visited URLs: ${truncateToolContent(args.visitedUrls, 1200)}`,
      `Remaining URLs: ${truncateToolContent(args.remainingUrls, 2400)}`,
    ].join("\n\n");

    try {
      const started = performance.now();
      const raw = await this.agent.chat(prompt, []);
      args.metrics.time_model_ms += performance.now() - started;
      args.metrics.model_calls += 1;

      const parsed = this.parseJson(raw) as {
        shouldContinue?: unknown;
        reason?: unknown;
        missingInfo?: unknown;
        nextBestUrl?: unknown;
      } | null;

      if (!parsed || typeof parsed !== "object") {
        return fallback;
      }

      const shouldContinue =
        typeof parsed.shouldContinue === "boolean"
          ? parsed.shouldContinue
          : fallback.shouldContinue;
      const reason =
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : fallback.reason;
      const missingInfo =
        Array.isArray(parsed.missingInfo) && parsed.missingInfo.length > 0
          ? parsed.missingInfo
              .map((item) => String(item || "").trim())
              .filter(Boolean)
              .slice(0, 6)
          : fallback.missingInfo;
      const modelNext =
        typeof parsed.nextBestUrl === "string" && parsed.nextBestUrl.trim()
          ? parsed.nextBestUrl.trim()
          : undefined;

      let nextBestUrl = fallback.nextBestUrl;
      if (modelNext) {
        const normalizedModel = normalizeUrl(modelNext);
        const inRemaining = args.remainingUrls.find(
          (url) => normalizeUrl(url) === normalizedModel,
        );
        if (inRemaining) {
          nextBestUrl = inRemaining;
        } else if (normalizeUrl(modelNext)) {
          nextBestUrl = modelNext;
        }
      }

      return {
        shouldContinue,
        reason,
        missingInfo,
        nextBestUrl: shouldContinue ? nextBestUrl : undefined,
      };
    } catch {
      return fallback;
    }
  }

  private buildFallbackNavigationDecision(args: {
    taskFrame: TaskFrame;
    userMessage: string;
    currentDoc: StructuredPayload;
    remainingUrls: string[];
  }): NavigationDecision {
    const coverage = this.computeObjectiveCoverage(
      args.taskFrame,
      args.userMessage,
      args.currentDoc,
    );
    const hasSubstantialText =
      String(args.currentDoc.mainText || "").trim().length >= 220;
    const shouldContinue = !(hasSubstantialText && coverage.coverage >= 0.62);
    const nextBestUrl = shouldContinue
      ? this.selectBestNextUrl(args.remainingUrls, coverage.missingTokens)
      : undefined;

    if (!shouldContinue) {
      return {
        shouldContinue: false,
        reason:
          coverage.matchedTokens.length > 0
            ? `Page covers key objective signals (${coverage.matchedTokens
                .slice(0, 4)
                .join(", ")}).`
            : "Page contains enough structured detail for the requested output.",
        missingInfo: [],
      };
    }

    return {
      shouldContinue: true,
      reason:
        coverage.missingTokens.length > 0
          ? `Current page is missing key details (${coverage.missingTokens
              .slice(0, 4)
              .join(", ")}).`
          : "Current page does not yet provide enough concrete details for the requested output.",
      missingInfo: coverage.missingTokens.slice(0, 6),
      nextBestUrl,
    };
  }

  private computeObjectiveCoverage(
    taskFrame: TaskFrame,
    userMessage: string,
    doc: StructuredPayload,
  ): ObjectiveCoverage {
    const objectiveTokens = extractSignalTokens(
      `${taskFrame.requiredOutput} ${taskFrame.userObjective} ${taskFrame.entities.join(" ")} ${userMessage}`,
    );
    if (objectiveTokens.length === 0) {
      return { coverage: 0, matchedTokens: [], missingTokens: [] };
    }

    const content =
      `${doc.url || ""} ${doc.title || ""} ${(doc.headings || []).join(" ")} ${
        doc.mainText || ""
      }`.toLowerCase();
    const matchedTokens = objectiveTokens.filter((token) =>
      content.includes(token),
    );
    const missingTokens = objectiveTokens.filter(
      (token) => !content.includes(token),
    );

    return {
      coverage: matchedTokens.length / objectiveTokens.length,
      matchedTokens,
      missingTokens,
    };
  }

  private selectBestNextUrl(
    urls: string[],
    missingTokens: string[],
  ): string | undefined {
    if (urls.length === 0) return undefined;
    const structuralPattern =
      /\/(?:sitemap(?:_index)?\.xml|llms\.txt|\.well-known\/llms\.txt)$/i;
    const scored = urls.map((url, index) => {
      const lower = url.toLowerCase();
      let score = Math.max(0, 4 - index * 0.25);
      if (structuralPattern.test(lower)) {
        score -= 3.2;
      }
      for (const token of missingTokens) {
        if (token.length < 3) continue;
        if (lower.includes(token)) score += 1.25;
      }
      if (
        /\b(pricing|plans?|subscription|billing|contact|support|faq|docs?|features?)\b/i.test(
          lower,
        )
      ) {
        score += 0.8;
      }
      return { url, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.url;
  }

  private finalizeTaskFrame(
    taskFrame: TaskFrame,
    docs: StructuredPayload[],
    searchPayload: SearchPayload | null,
  ): TaskFrame {
    const blob = [
      ...docs.map(
        (doc) => `${doc.title || ""} ${doc.url || ""} ${doc.mainText || ""}`,
      ),
      ...(searchPayload?.results || []).map(
        (result) =>
          `${result.title || ""} ${result.url || ""} ${result.snippet || ""}`,
      ),
    ]
      .join(" ")
      .toLowerCase();

    const nextStatus: Record<string, "resolved" | "unresolved"> = {};
    for (const entity of taskFrame.entities) {
      const token = entity.toLowerCase();
      const matched = token.length > 1 && blob.includes(token);
      nextStatus[entity] = matched
        ? "resolved"
        : taskFrame.entityStatus[entity] || "unresolved";
    }

    return {
      ...taskFrame,
      entityStatus: nextStatus,
      missingInputs:
        taskFrame.missingInputs.includes("official_website_url") &&
        taskFrame.domainHints.length > 0
          ? taskFrame.missingInputs.filter(
              (item) => item !== "official_website_url",
            )
          : taskFrame.missingInputs,
    };
  }

  private shouldAskForWebsiteUrl(
    message: string,
    taskFrame?: TaskFrame,
  ): boolean {
    const lower = String(message || "").toLowerCase();
    const hasWebsiteCue =
      lower.includes("website") ||
      lower.includes("site") ||
      lower.includes("domain") ||
      lower.includes("landing page");
    const hasPageCue =
      lower.includes("pricing") ||
      lower.includes("subscription") ||
      lower.includes("plans") ||
      lower.includes("plan");
    if (taskFrame?.domainHints.length) return false;
    return hasWebsiteCue && hasPageCue;
  }

  private async buildWebsiteUrlRequestResponse(
    userMessage: string,
    taskFrame: TaskFrame,
  ): Promise<string> {
    return await this.composeUserFacingFallback({
      intent: "request_official_website_url",
      userMessage,
      context: {
        objective: taskFrame.userObjective,
        missingInputs: taskFrame.missingInputs,
      },
    });
  }

  private extractDomainHintUrls(message: string): string[] {
    const text = String(message || "");
    const matches =
      text.match(
        /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[^\s]*)?)/gi,
      ) || [];

    const urls = matches.map((raw) => {
      const trimmed = String(raw || "")
        .trim()
        .replace(/[),.;!?]+$/g, "");
      if (!trimmed) return "";
      if (/^https?:\/\//i.test(trimmed)) return trimmed;
      return `https://${trimmed}`;
    });

    return dedupeUrls(urls);
  }

  private extractDomainBaseUrl(urls: string[]): string | null {
    for (const value of urls) {
      try {
        const parsed = new URL(value);
        if (!/^https?:$/i.test(parsed.protocol)) continue;
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async discoverSiteUrls(args: {
    sessionId: string;
    siteBaseUrl: string;
    message: string;
    metrics: ExternalDataMetrics;
    events: ExternalDataEvent[];
    emitStage: (
      stage: ChatProgressEvent["stage"],
      message?: string,
      iteration?: number,
    ) => void;
  }): Promise<string[]> {
    const siteRoot = args.siteBaseUrl.replace(/\/+$/, "");
    const candidates = new Set<string>([
      siteRoot,
      ...this.buildDirectPathHints(siteRoot, args.message),
    ]);
    const structuralEndpoints = this.prioritizeStructuralEndpoints(
      siteRoot,
      args.message,
    );

    const probeEndpoint = async (endpoint: string): Promise<boolean> => {
      try {
        args.emitStage("opening_pages", `Opening ${endpoint}`);
        await this.runTool(
          "web_act",
          {
            action: {
              type: "navigate",
              url: endpoint,
              options: {
                timeoutMs: 25_000,
                waitUntil: "load",
                settleMs: 900,
              },
            },
          },
          args.sessionId,
          args.metrics,
          args.events,
        );
        const extracted = (await this.runTool(
          "web_extract_structured",
          {},
          args.sessionId,
          args.metrics,
          args.events,
        )) as StructuredPayload;

        for (const link of this.collectDiscoveryLinks(extracted, siteRoot)) {
          candidates.add(link);
        }
        return true;
      } catch {
        return false;
      }
    };

    await probeEndpoint(siteRoot);

    let ranked = this.rankSiteUrls(
      Array.from(candidates),
      args.message,
      siteRoot,
    );
    const hasStrongCandidate = this.hasObjectiveCandidate(ranked, args.message);

    if (!hasStrongCandidate) {
      const maxStructuralProbes = 1;
      let probed = 0;
      for (const endpoint of structuralEndpoints) {
        if (probed >= maxStructuralProbes) break;
        const success = await probeEndpoint(endpoint);
        if (success) {
          probed += 1;
          ranked = this.rankSiteUrls(
            Array.from(candidates),
            args.message,
            siteRoot,
          );
          if (this.hasObjectiveCandidate(ranked, args.message)) {
            break;
          }
        }
      }
    }

    return ranked.slice(0, Math.max(this.maxPagesPerTurn(), 8));
  }

  private buildDirectPathHints(siteRoot: string, message: string): string[] {
    const lower = String(message || "").toLowerCase();
    const hints: string[] = [];
    const push = (path: string) =>
      hints.push(`${siteRoot}/${path}`.replace(/\/+$/, ""));

    if (/\b(pricing|price|plans?|subscription|billing)\b/.test(lower)) {
      push("pricing");
      push("plans");
      push("subscription");
      push("billing");
    }
    if (/\b(contact|support|help|email|phone)\b/.test(lower)) {
      push("contact");
      push("support");
      push("help");
    }
    if (/\b(sign ?up|register|create account|onboard)\b/.test(lower)) {
      push("signup");
      push("register");
      push("get-started");
    }
    if (/\b(docs?|api|developer)\b/.test(lower)) {
      push("docs");
      push("api");
      push("developers");
    }

    return dedupeUrls(hints);
  }

  private prioritizeStructuralEndpoints(
    siteRoot: string,
    message: string,
  ): string[] {
    const lower = String(message || "").toLowerCase();
    const wantsModelDocs =
      lower.includes("llms.txt") ||
      lower.includes("model context") ||
      lower.includes("prompt");
    if (wantsModelDocs) {
      return [
        `${siteRoot}/llms.txt`,
        `${siteRoot}/.well-known/llms.txt`,
        `${siteRoot}/sitemap.xml`,
      ];
    }
    return [
      `${siteRoot}/sitemap.xml`,
      `${siteRoot}/sitemap_index.xml`,
      `${siteRoot}/llms.txt`,
    ];
  }

  private hasObjectiveCandidate(urls: string[], message: string): boolean {
    const lower = String(message || "").toLowerCase();
    const tokens = extractSignalTokens(lower);
    return urls.some((url) => {
      const l = url.toLowerCase();
      if (
        /\b(pricing|plans?|subscription|billing|contact|support|docs?|api)\b/.test(
          l,
        )
      ) {
        return true;
      }
      return tokens.some((token) => token.length >= 4 && l.includes(token));
    });
  }

  private collectDiscoveryLinks(
    doc: StructuredPayload,
    siteRoot: string,
  ): string[] {
    const fromLinks = Array.isArray(doc.links)
      ? doc.links.map((item) => String(item.url || "").trim())
      : [];
    const fromText = this.extractUrlsFromText(String(doc.mainText || ""));
    const fromRelative = this.extractRelativeLinksFromText(
      String(doc.mainText || ""),
    ).map((path) => `${siteRoot}${path.startsWith("/") ? path : `/${path}`}`);
    const merged = dedupeUrls([...fromLinks, ...fromText, ...fromRelative]);
    return merged.filter((url) => this.isWithinSite(url, siteRoot));
  }

  private extractUrlsFromText(text: string): string[] {
    const matches = String(text || "").match(/https?:\/\/[^\s<>"')]+/gi) || [];
    return dedupeUrls(matches);
  }

  private extractRelativeLinksFromText(text: string): string[] {
    const matches =
      String(text || "").match(/\((\/[a-z0-9/_\-?.=&%#]+)\)/gi) || [];
    return matches
      .map((item) => {
        const cleaned = item.replace(/[()]/g, "").trim();
        return cleaned.startsWith("/") ? cleaned : "";
      })
      .filter(Boolean);
  }

  private isWithinSite(candidateUrl: string, siteRoot: string): boolean {
    try {
      const candidate = new URL(candidateUrl);
      const root = new URL(siteRoot);
      const host = candidate.hostname.toLowerCase();
      const rootHost = root.hostname.toLowerCase();
      return host === rootHost || host.endsWith(`.${rootHost}`);
    } catch {
      return false;
    }
  }

  private rankSiteUrls(
    urls: string[],
    message: string,
    siteRoot: string,
  ): string[] {
    const lowerTask = String(message || "").toLowerCase();
    const wantsStructural =
      lowerTask.includes("sitemap") ||
      lowerTask.includes("llms.txt") ||
      lowerTask.includes("robots.txt");
    const keywordHints = [
      "pricing",
      "price",
      "plans",
      "plan",
      "subscription",
      "billing",
      "faq",
      "about",
      "features",
      "product",
      "docs",
      "api",
    ];
    const taskTokens = lowerTask.split(/[^a-z0-9]+/).filter(Boolean);

    const scored = dedupeUrls(urls)
      .map((url) => {
        const lowerUrl = url.toLowerCase();
        let score = 0;
        if (url.replace(/\/+$/, "") === siteRoot.replace(/\/+$/, ""))
          score += 2.5;

        for (const hint of keywordHints) {
          if (lowerTask.includes(hint) && lowerUrl.includes(hint)) score += 2;
        }
        for (const token of taskTokens) {
          if (token.length < 4) continue;
          if (lowerUrl.includes(token)) score += 0.4;
        }
        if (/\/pricing|\/plans?|\/subscription|\/billing/i.test(lowerUrl))
          score += 2.6;
        if (/\/contact|\/support|\/faq/i.test(lowerUrl)) score += 1.3;
        if (/\/about/i.test(lowerUrl)) score -= 0.4;
        if (
          !wantsStructural &&
          /\/(?:sitemap|llms\.txt|\.well-known\/llms\.txt)/i.test(lowerUrl)
        ) {
          score -= 3.5;
        }

        return { url, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored.map((entry) => entry.url);
  }

  private async ensureBestEffortAnswer(
    answer: string,
    userMessage: string,
    hasWebSignals: boolean,
  ): Promise<string> {
    const text = String(answer || "").trim();
    if (!text) {
      return await this.composeUserFacingFallback({
        intent: "empty_synthesis_answer",
        userMessage,
        context: { hasWebSignals },
      });
    }
    if (hasWebSignals) return text;

    const refusalPattern =
      /\b(i('| a)m unable to provide|i cannot provide|can'?t provide|no recent web results|no web results available|couldn'?t find any information)\b/i;
    if (!refusalPattern.test(text)) return text;

    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return await this.composeUserFacingFallback({
      intent: "limited_web_signals",
      userMessage,
      context: {
        modelAnswer: text,
        tail: sentences.slice(1).join(" "),
      },
    });
  }

  private async composeUserFacingFallback(input: {
    intent: string;
    userMessage: string;
    context?: Record<string, unknown>;
  }): Promise<string> {
    const prompt = [
      "You are Nova's user-facing response layer.",
      "Write one concise helpful reply only. No JSON.",
      "Be explicit about uncertainty when needed, but still be useful.",
      `Intent: ${input.intent}`,
      `User message: ${input.userMessage}`,
      `Context: ${truncateToolContent(input.context || {}, 2200)}`,
      `Current date/time: ${new Date().toISOString()}`,
    ].join("\n\n");

    try {
      const drafted = String(await this.agent.chat(prompt, [])).trim();
      if (drafted) return drafted;
    } catch (error) {
      console.warn("composeUserFacingFallback failed:", error);
    }

    const fallback = String(input.userMessage || "").trim();
    if (fallback) return fallback;
    return String(input.intent || "continue");
  }
}

function dedupeSources(
  sources: ExternalDataContract["sources"],
): ExternalDataContract["sources"] {
  const seen = new Set<string>();
  const out: ExternalDataContract["sources"] = [];

  for (const source of sources) {
    const url = String(source.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(source);
  }

  return out;
}

function dedupeUrls(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of urls) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      parsed.hash = "";
      const normalized = parsed.toString().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(normalized)) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    } catch {
      continue;
    }
  }

  return out;
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeUrl(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function extractSignalTokens(text: string): string[] {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "from",
    "this",
    "have",
    "will",
    "your",
    "about",
    "into",
    "what",
    "when",
    "where",
    "which",
    "whose",
    "their",
    "there",
    "please",
    "user",
    "request",
    "details",
    "provide",
    "output",
    "exact",
    "latest",
  ]);
  const tokens = String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !stopwords.has(token));
  return dedupeStrings(tokens).slice(0, 20);
}

function clamp(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
