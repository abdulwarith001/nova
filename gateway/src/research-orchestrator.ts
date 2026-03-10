import { Agent, type Message } from "../../agent/src/index.js";
import { Runtime } from "../../runtime/src/index.js";
import { ConfirmationCallback } from "../../runtime/src/executor.js";
import {
  ReasoningEngine,
  toReasoningTools,
} from "../../agent/src/reasoning/index.js";
import {
  trimConversationHistory,
  truncateToolContent,
  type ChatHistoryMessage,
} from "./chat-speed.js";
import { ProfileExtractor } from "../../runtime/src/profile-extractor.js";

export interface ResearchSource {
  title: string;
  url: string;
  whyRelevant: string;
}

export interface ResearchContract {
  summary: string;
  fullReport: string;
  sources: ResearchSource[];
  uncertainty: string;
  confidence: number;
}

export interface ResearchEvent {
  type:
    | "tool_start"
    | "tool_complete"
    | "synthesis_start"
    | "reasoning"
    | "plan_created"
    | "plan_progress"
    | "finalized";
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface ResearchMetrics {
  iteration_count: number;
  model_calls: number;
  tool_calls: number;
  tool_failures: number;
  time_model_ms: number;
  time_tools_ms: number;
  time_total_ms: number;
  fallback_reason?: string;
}

export interface ResearchTurnResult {
  response: string;
  success: boolean;
  history: ChatHistoryMessage[];
  research: ResearchContract;
  events?: ResearchEvent[];
  metrics: ResearchMetrics;
}

export interface ResearchTurnInput {
  message: string;
  history: ChatHistoryMessage[];
  sessionId?: string;
  onProgress?: (stage: string) => void;
  confirm?: ConfirmationCallback;
  signal?: AbortSignal;
}

export interface ResearchOrchestratorConfig {
  maxIterations: number;
  toolTimeoutMs: number;
  maxSources: number;
  enableTelemetry: boolean;
  provider: "openai" | "anthropic";
}

type ToolExecutionResult = {
  toolName: string;
  result?: unknown;
  error?: string;
};

const DEFAULT_ERROR_RESPONSE =
  "I wasn't able to fully resolve that request. This may have been due to tool failures or connectivity issues. Could you try rephrasing or breaking it into smaller parts?";

export class ResearchOrchestrator {
  private readonly reasoningEngine: ReasoningEngine;
  private readonly profileExtractor: ProfileExtractor | null;

  constructor(
    private readonly runtime: Runtime,
    private readonly agent: Agent,
    private readonly config: ResearchOrchestratorConfig,
  ) {
    this.reasoningEngine = new ReasoningEngine(agent, { mode: "full" });

    // Dedicated cheap agent for profile extraction
    try {
      const extractionAgent = new Agent(
        {
          provider: config.provider,
          model:
            config.provider === "anthropic"
              ? "claude-3-5-haiku-20241022"
              : "gpt-4.1-mini",
          apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
        },
        "You are a profile extraction agent.",
      );
      this.profileExtractor = new ProfileExtractor((msg, hist) =>
        extractionAgent.chat(msg, hist as any),
      );
      console.log(
        "📝 Profile extractor initialized (model:",
        config.provider === "anthropic" ? "claude-3-5-haiku" : "gpt-4.1-mini",
        ")",
      );
    } catch (err: any) {
      console.warn("⚠️ Profile extractor init failed:", err?.message);
      this.profileExtractor = null;
    }
  }

  async runChatTurn(input: ResearchTurnInput): Promise<ResearchTurnResult> {
    const startedAt = performance.now();
    const events: ResearchEvent[] = [];
    const metrics: ResearchMetrics = {
      iteration_count: 0,
      model_calls: 0,
      tool_calls: 0,
      tool_failures: 0,
      time_model_ms: 0,
      time_tools_ms: 0,
      time_total_ms: 0,
    };

    const mdMemory = this.runtime.getMarkdownMemory();
    const convStore = mdMemory.getConversationStore();
    const userId = input.sessionId || `session-${Date.now()}`;
    const conversationId = userId;

    // Store user message in conversation log
    try {
      convStore.addMessage({
        userId,
        conversationId,
        role: "user",
        content: input.message,
        channel: (input as any).channel || "ws",
      });
    } catch (err: any) {
      console.error("⚠️ Conversation store failed:", err?.message);
    }

    const tools = this.runtime.getToolsForAgent();
    let modelHistory = trimConversationHistory(
      [...input.history, { role: "user", content: input.message }],
      24,
    );

    try {
      const memoryContext = this.getMemoryContext(input.message);
      const oodaResult = await this.reasoningEngine.runOODA({
        message: input.message,
        memoryContext,
        conversationHistory: modelHistory.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
      this.pushEvent(events, "reasoning", {
        assembledThinking: oodaResult.assembledThinking,
        confidence: oodaResult.decision.confidence,
        thoughtCount: oodaResult.thoughts.length,
      });
      // Inject reasoning context into model history so the LLM benefits
      if (oodaResult.assembledThinking) {
        modelHistory = [
          ...modelHistory.slice(0, -1),
          {
            role: "system",
            content: `[Internal reasoning]\n${oodaResult.assembledThinking}`,
          },
          modelHistory[modelHistory.length - 1],
        ];
      }

      // Proactive Planning: If the task is complex or requires tools, generate a plan
      const orientThought = oodaResult.thoughts.find(
        (t) => t.phase === "orient",
      );
      const isComplex =
        orientThought?.content.toLowerCase().includes("tools needed:") ||
        oodaResult.decision.confidence < 0.7;

      if (isComplex) {
        try {
          const plan = await this.reasoningEngine.planSteps(
            input.message,
            toReasoningTools(tools),
            memoryContext,
          );
          if (plan && plan.length > 0) {
            this.pushEvent(events, "plan_created", { steps: plan });
            const planMarkdown = plan
              .map((s) => `- [ ] Step ${s.id}: ${s.description}`)
              .join("\n");
            modelHistory = [
              ...modelHistory.slice(0, -1),
              {
                role: "system",
                content: `[Execution Plan]\n${planMarkdown}\n\nFollow this plan systematically. Perform one or two steps at a time using tool calls. Update your progress mentally as you go.`,
              },
              modelHistory[modelHistory.length - 1],
            ];
          }
        } catch (planError: any) {
          console.warn("⚠️ Planning failed (non-fatal):", planError?.message);
        }
      }
    } catch (reasoningError: any) {
      console.warn(
        "⚠️ OODA reasoning failed (non-fatal):",
        reasoningError?.message || reasoningError,
      );
      // Inject minimal thinking context so the LLM isn't flying blind
      modelHistory = [
        ...modelHistory.slice(0, -1),
        {
          role: "system",
          content: `[Internal reasoning] Reasoning engine was unavailable. Approach the user's message directly and helpfully. Message: "${input.message.slice(0, 200)}"`,
        },
        modelHistory[modelHistory.length - 1],
      ];
    }

    let finalText = "";
    let fallbackReason: string | undefined;
    let usedWebTool = false;
    const toolResults: ToolExecutionResult[] = [];

    for (
      let iteration = 0;
      !finalText && iteration < this.config.maxIterations;
      iteration++
    ) {
      metrics.iteration_count = iteration + 1;
      this.pushEvent(events, "synthesis_start", { iteration: iteration + 1 });

      const modelStart = performance.now();
      let response;
      try {
        response = await this.agent.chatWithTools(modelHistory, tools);
      } catch (llmError: any) {
        console.warn(
          `⚠️ LLM call failed on iteration ${iteration + 1}: ${llmError?.message || llmError}`,
        );
        // If we have partial tool results, break to forced synthesis
        if (toolResults.length > 0) {
          fallbackReason = "llm_call_failed_with_partial_results";
          break;
        }
        // No tool results at all — one more try next iteration, or give up
        continue;
      }
      metrics.time_model_ms += performance.now() - modelStart;
      metrics.model_calls++;

      if (response.toolCalls && response.toolCalls.length > 0) {
        if (this.config.provider === "openai") {
          modelHistory.push({
            role: "assistant",
            content: response.content || "",
            tool_calls: response.toolCalls.map((call) => ({
              id: call.id || `${call.name}-${Date.now()}`,
              type: "function" as const,
              function: {
                name: call.name,
                arguments: JSON.stringify(call.parameters),
              },
            })),
          });
        }

        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.name;
          metrics.tool_calls++;
          if (
            toolName === "web_search" ||
            toolName === "scrape" ||
            toolName === "browse"
          ) {
            usedWebTool = true;
          }

          // Check abort signal before tool execution
          if (input.signal?.aborted) {
            console.log("   ⛔ Research aborted by user.");
            finalText =
              "Research was stopped. Here's what I found so far:\n\n" +
                toolResults
                  .filter((tr) => tr.result)
                  .map(
                    (tr) =>
                      `• ${tr.toolName}: ${String(tr.result).slice(0, 200)}`,
                  )
                  .join("\n") || "No findings yet.";
            break;
          }

          this.pushEvent(events, "tool_start", {
            name: toolName,
            parameters: toolCall.parameters,
          });

          // Emit progress for Telegram
          if (toolName === "web_search") {
            input.onProgress?.("🌐 Searching the web...");
          } else if (toolName === "scrape" || toolName === "browse") {
            input.onProgress?.("📄 Reading sources...");
          }

          console.log(
            `🔧 Tool call: ${toolName}`,
            JSON.stringify(toolCall.parameters).slice(0, 200),
          );

          const isHitl = this.runtime.requiresConfirmation(
            toolName,
            toolCall.parameters as any,
          ).required;
          const toolTimeout = isHitl
            ? 360_000 // 6 min for human decision
            : this.config.toolTimeoutMs;

          // Retry once for transient errors (unless it's a HitL tool)
          let lastToolError: string | undefined;
          let toolSucceeded = false;
          const maxAttempts = isHitl ? 1 : 2;

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
              const toolStart = performance.now();
              const result = await withTimeout(
                this.runtime.executeTool(toolName, toolCall.parameters, {
                  sessionId: userId,
                  confirm: input.confirm,
                }),
                toolTimeout,
                `Tool '${toolName}' timed out after ${toolTimeout}ms`,
              );
              metrics.time_tools_ms += performance.now() - toolStart;
              toolResults.push({ toolName, result });

              const toolMaxChars = 1200;
              if (this.config.provider === "openai" && toolCall.id) {
                modelHistory.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: truncateToolContent(result, toolMaxChars),
                });
              } else {
                modelHistory.push({
                  role: "assistant",
                  content: `Used tool ${toolName}: ${truncateToolContent(result, toolMaxChars)}`,
                });
              }

              this.pushEvent(events, "tool_complete", {
                name: toolName,
                success: true,
              });
              toolSucceeded = true;
              console.log(
                `✅ Tool success: ${toolName} (${(performance.now() - toolStart).toFixed(0)}ms)`,
              );
              break;
            } catch (error: any) {
              lastToolError = error?.message || "Unknown error";
              const isTransient =
                /timed? ?out|network|ECONNR|ETIMEDOUT|socket hang up/i.test(
                  lastToolError!,
                );
              if (attempt === 0 && isTransient) {
                console.warn(
                  `⚠️ Tool '${toolName}' failed (transient), retrying once...`,
                );
                metrics.tool_calls++; // count the retry
                continue;
              }
              break;
            }
          }

          if (!toolSucceeded && lastToolError) {
            metrics.tool_failures++;
            console.error(`❌ Tool failed: ${toolName} — ${lastToolError}`);
            toolResults.push({ toolName, error: lastToolError });

            // Enriched error context with tool-specific fallback suggestions
            const fallbackHints: Record<string, string> = {
              scrape:
                "The page may be JavaScript-rendered. Try using 'browse' instead to take a screenshot and analyze it visually.",
              web_search:
                "Try using 'browse' to visit the URL directly and extract content from the page.",
              browse:
                "Try using 'scrape' for a simpler text extraction, or 'web_session_start' + 'web_observe' for interactive pages.",
              web_act:
                "Make sure you called web_observe first to see the page elements. Try with a different target (use text, placeholder, or name instead of CSS selectors).",
              web_observe:
                "The session may have ended. Try web_session_start again.",
            };
            const hint =
              fallbackHints[toolName] || "Try a different tool or approach.";
            const enrichedError = `Tool '${toolName}' failed: ${lastToolError}. ${hint} Do NOT give up — try an alternative tool now.`;

            if (this.config.provider === "openai" && toolCall.id) {
              modelHistory.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: enrichedError,
              });
            } else {
              modelHistory.push({
                role: "assistant",
                content: `[tool error] ${enrichedError}`,
              });
            }

            this.pushEvent(events, "tool_complete", {
              name: toolName,
              success: false,
              error: lastToolError,
            });
          }
        }

        modelHistory = trimConversationHistory(modelHistory, 24);
        continue;
      }

      finalText = (response.content || "").trim();
      if (finalText) {
        break;
      }
    }

    if (!finalText) {
      if (toolResults.length > 0) {
        fallbackReason = "forced_synthesis_after_tool_execution";
        this.pushEvent(events, "synthesis_start", { forced: true });
        const synthesisStart = performance.now();
        finalText = (
          await this.agent.chat(
            this.buildForcedSynthesisPrompt(input.message, toolResults),
            this.toSimpleHistory(modelHistory),
          )
        ).trim();
        metrics.time_model_ms += performance.now() - synthesisStart;
        metrics.model_calls++;
      } else {
        fallbackReason = "no_final_answer_no_tools";
      }
    }

    const modelProvidedSources = modelOutputHasSources(finalText);
    let research = this.normalizeResearchOutput(
      finalText || DEFAULT_ERROR_RESPONSE,
      toolResults,
    );

    if (usedWebTool && !modelProvidedSources) {
      fallbackReason = fallbackReason || "repair_missing_citations";
      const repairStart = performance.now();
      const repaired = (
        await this.agent.chat(
          this.buildCitationRepairPrompt(input.message, finalText, toolResults),
          [],
        )
      ).trim();
      metrics.time_model_ms += performance.now() - repairStart;
      metrics.model_calls++;

      research = this.normalizeResearchOutput(
        repaired || finalText || DEFAULT_ERROR_RESPONSE,
        toolResults,
      );
    }

    const responseText = research.summary || DEFAULT_ERROR_RESPONSE;

    const updatedHistory = trimConversationHistory(
      [
        ...input.history,
        { role: "user", content: input.message },
        { role: "assistant", content: responseText },
      ],
      12,
    );

    // Store assistant response in conversation log
    try {
      convStore.addMessage({
        userId,
        conversationId,
        role: "assistant",
        content: responseText,
        channel: (input as any).channel || "ws",
      });
    } catch (err: any) {
      console.error("⚠️ Conversation store failed:", err?.message);
    }

    metrics.time_total_ms = performance.now() - startedAt;
    metrics.fallback_reason = fallbackReason;
    this.pushEvent(events, "finalized", {
      confidence: research.confidence,
      sourceCount: research.sources.length,
      fallbackReason,
    });

    console.log(
      JSON.stringify({
        type: "research_turn_metrics",
        ...metrics,
      }),
    );

    // Fire-and-forget: extract profile info from this turn
    if (this.profileExtractor) {
      void this.profileExtractor
        .extract(
          input.message,
          responseText,
          this.runtime.getMarkdownMemory().getProfileStore(),
        )
        .catch((err) =>
          console.warn("⚠️ Profile extraction failed:", err?.message),
        );
    }

    return {
      response: responseText,
      success: true,
      history: updatedHistory,
      research: {
        summary: research.summary,
        fullReport: research.fullReport,
        sources: research.sources,
        uncertainty: research.uncertainty,
        confidence: research.confidence,
      },
      events: this.config.enableTelemetry ? events : undefined,
      metrics,
    };
  }

  private getMemoryContext(_message: string): string | undefined {
    try {
      const profileStore = this.runtime.getMarkdownMemory().getProfileStore();
      const userProfile = profileStore.getUser();
      const identity = profileStore.getIdentity();

      const sections: string[] = [];

      if (userProfile.trim()) {
        sections.push("=== ABOUT MY USER ===");
        sections.push(userProfile);
      }

      if (identity.trim()) {
        sections.push("", "=== WHO I AM ===");
        sections.push(identity);
      }

      return sections.join("\n");
    } catch {
      return undefined;
    }
  }

  private pushEvent(
    events: ResearchEvent[],
    type: ResearchEvent["type"],
    details?: Record<string, unknown>,
  ) {
    events.push({
      type,
      timestamp: Date.now(),
      details,
    });
  }

  private toSimpleHistory(history: ChatHistoryMessage[]): Message[] {
    return history
      .filter(
        (message) =>
          message.role === "system" ||
          message.role === "user" ||
          message.role === "assistant",
      )
      .map((message) => ({
        role: message.role as "system" | "user" | "assistant",
        content: message.content,
      }));
  }

  private buildForcedSynthesisPrompt(
    task: string,
    toolResults: ToolExecutionResult[],
  ): string {
    return [
      "Produce a comprehensive, detailed, user-facing answer now.",
      "Include all key findings, supporting evidence, different viewpoints, and specific details from the tool results.",
      "Do NOT summarize briefly — the user expects a thorough, in-depth response.",
      "Return JSON only with shape:",
      `{"answer":"...","sources":[{"title":"...","url":"https://...","whyRelevant":"..."}],"uncertainty":"...","confidence":0.0}`,
      `Task: ${task}`,
      `Tool Results: ${truncateToolContent(toolResults, 12000)}`,
    ].join("\n\n");
  }

  private buildCitationRepairPrompt(
    task: string,
    draftAnswer: string,
    toolResults: ToolExecutionResult[],
  ): string {
    return [
      "Rewrite this answer with explicit citations from the provided tool evidence.",
      "Keep the answer comprehensive and detailed — preserve all findings, viewpoints, and specific data. Do NOT shorten it.",
      "Return JSON only with shape:",
      `{"answer":"...","sources":[{"title":"...","url":"https://...","whyRelevant":"..."}],"uncertainty":"...","confidence":0.0}`,
      `Task: ${task}`,
      `Current Answer: ${draftAnswer || "N/A"}`,
      `Tool Evidence: ${truncateToolContent(toolResults, 12000)}`,
    ].join("\n\n");
  }

  private normalizeResearchOutput(
    raw: string,
    toolResults: ToolExecutionResult[],
  ): ResearchContract {
    const parsed = parseJsonObject(raw);
    const fallbackSources = extractSourcesFromToolResults(
      toolResults,
      this.config.maxSources,
    );

    if (!parsed || typeof parsed !== "object") {
      return {
        summary: raw || DEFAULT_ERROR_RESPONSE,
        fullReport: raw || DEFAULT_ERROR_RESPONSE,
        sources: fallbackSources,
        uncertainty:
          fallbackSources.length > 0
            ? "Sources were inferred from tool results."
            : "Limited evidence available.",
        confidence: fallbackSources.length > 0 ? 0.55 : 0.35,
      };
    }

    const candidate = parsed as any;
    const summary = String(
      candidate.summary || candidate.answer || raw || DEFAULT_ERROR_RESPONSE,
    ).trim();
    const fullReport = String(candidate.fullReport || summary).trim();
    const sources = normalizeSources(candidate.sources, this.config.maxSources);
    const uncertainty =
      typeof candidate.uncertainty === "string" && candidate.uncertainty.trim()
        ? candidate.uncertainty.trim()
        : sources.length > 0
          ? "Based on the cited sources; details may change over time."
          : "Limited evidence available.";
    const confidence = clampNumber(
      candidate.confidence,
      sources.length > 0 ? 0.7 : 0.4,
    );

    return {
      summary,
      fullReport,
      sources: sources.length > 0 ? sources : fallbackSources,
      uncertainty,
      confidence,
    };
  }
}

function normalizeSources(raw: unknown, maxSources: number): ResearchSource[] {
  if (!Array.isArray(raw)) return [];
  const normalized: ResearchSource[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const source = entry as any;
    const url = typeof source.url === "string" ? source.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    normalized.push({
      title:
        typeof source.title === "string" && source.title.trim()
          ? source.title.trim()
          : url,
      url,
      whyRelevant:
        typeof source.whyRelevant === "string" && source.whyRelevant.trim()
          ? source.whyRelevant.trim()
          : "Referenced source used for this answer.",
    });
    if (normalized.length >= maxSources) break;
  }
  return normalized;
}

function extractSourcesFromToolResults(
  toolResults: ToolExecutionResult[],
  maxSources: number,
): ResearchSource[] {
  const dedupe = new Set<string>();
  const sources: ResearchSource[] = [];

  for (const item of toolResults) {
    if (!item.result || typeof item.result !== "object") continue;
    const resultObj = item.result as any;

    if (Array.isArray(resultObj.results)) {
      for (const result of resultObj.results) {
        const url = typeof result?.url === "string" ? result.url : "";
        if (!/^https?:\/\//i.test(url) || dedupe.has(url)) continue;
        dedupe.add(url);
        sources.push({
          title: String(result?.title || url),
          url,
          whyRelevant: String(
            result?.description || `Found via ${item.toolName}`,
          ),
        });
        if (sources.length >= maxSources) return sources;
      }
    }

    const fetchUrl =
      typeof resultObj.finalUrl === "string" ? resultObj.finalUrl : "";
    if (/^https?:\/\//i.test(fetchUrl) && !dedupe.has(fetchUrl)) {
      dedupe.add(fetchUrl);
      sources.push({
        title: String(resultObj.title || fetchUrl),
        url: fetchUrl,
        whyRelevant: `Fetched with ${item.toolName}`,
      });
      if (sources.length >= maxSources) return sources;
    }
  }

  return sources;
}

function parseJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Balanced-brace matching instead of greedy regex
    const start = trimmed.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let end = -1;
    for (let i = start; i < trimmed.length; i++) {
      if (trimmed[i] === "{") depth++;
      else if (trimmed[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function modelOutputHasSources(text: string): boolean {
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object") return false;
  const raw = (parsed as any).sources;
  return Array.isArray(raw) && raw.length > 0;
}

function clampNumber(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
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
