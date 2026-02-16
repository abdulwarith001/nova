import { Agent, type Message } from "../../agent/src/index.js";
import { Runtime } from "../../runtime/src/index.js";
import {
  trimConversationHistory,
  truncateToolContent,
  type ChatHistoryMessage,
} from "./chat-speed.js";

export interface ResearchSource {
  title: string;
  url: string;
  whyRelevant: string;
}

export interface ResearchContract {
  answer: string;
  sources: ResearchSource[];
  uncertainty: string;
  confidence: number;
}

export interface ResearchEvent {
  type: "tool_start" | "tool_complete" | "synthesis_start" | "finalized";
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
}

export interface ResearchOrchestratorConfig {
  maxIterations: number;
  toolTimeoutMs: number;
  maxSources: number;
  enableTelemetry: boolean;
  provider: "openai" | "anthropic" | "google";
}

type ToolExecutionResult = {
  toolName: string;
  result?: unknown;
  error?: string;
};

const DEFAULT_ERROR_RESPONSE =
  "I'm sorry, I couldn't complete that request.";

export class ResearchOrchestrator {
  constructor(
    private readonly runtime: Runtime,
    private readonly agent: Agent,
    private readonly config: ResearchOrchestratorConfig,
  ) {}

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

    const memory = this.runtime.getMemory();
    const queueMemoryStore = (entry: Parameters<typeof memory.store>[0]) => {
      void memory.store(entry).catch((error) => {
        console.error("⚠️ Memory store failed:", error);
      });
    };

    queueMemoryStore({
      id: `msg-${Date.now()}-user`,
      content: input.message,
      timestamp: Date.now(),
      importance: 0.6,
      decayRate: 0.1,
      tags: ["chat", "user-message"],
      source: "chat",
      category: "conversation",
      sessionId: input.sessionId,
      metadata: { role: "user" },
    });

    const tools = this.runtime.getToolsForAgent();
    let modelHistory = trimConversationHistory(
      [...input.history, { role: "user", content: input.message }],
      24,
    );

    let finalText = "";
    let fallbackReason: string | undefined;
    let usedWebTool = false;
    const toolResults: ToolExecutionResult[] = [];

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      metrics.iteration_count = iteration + 1;
      this.pushEvent(events, "synthesis_start", { iteration: iteration + 1 });

      const modelStart = performance.now();
      const response = await this.agent.chatWithTools(modelHistory, tools);
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
            toolName === "search_web" ||
            toolName === "fetch_url" ||
            toolName === "extract_main_content"
          ) {
            usedWebTool = true;
          }

          this.pushEvent(events, "tool_start", {
            name: toolName,
            parameters: toolCall.parameters,
          });

          try {
            const toolStart = performance.now();
            const result = await withTimeout(
              this.runtime.executeTool(toolName, toolCall.parameters),
              this.config.toolTimeoutMs,
              `Tool '${toolName}' timed out after ${this.config.toolTimeoutMs}ms`,
            );
            metrics.time_tools_ms += performance.now() - toolStart;
            toolResults.push({ toolName, result });

            queueMemoryStore({
              id: `tool-${Date.now()}-${toolName}`,
              content: `Successfully used ${toolName} tool`,
              timestamp: Date.now(),
              importance: 0.7,
              decayRate: 0.15,
              tags: ["tool-usage", toolName],
              source: "chat",
              category: "self",
              sessionId: input.sessionId,
              metadata: {
                tool: toolName,
                params: toolCall.parameters,
                success: true,
              },
            });

            if (this.config.provider === "openai" && toolCall.id) {
              modelHistory.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: truncateToolContent(result),
              });
            } else {
              modelHistory.push({
                role: "assistant",
                content: `Used tool ${toolName}: ${truncateToolContent(result)}`,
              });
            }

            this.pushEvent(events, "tool_complete", {
              name: toolName,
              success: true,
            });
          } catch (error: any) {
            const message = error?.message || "Unknown error";
            metrics.tool_failures++;
            toolResults.push({ toolName, error: message });

            if (this.config.provider === "openai" && toolCall.id) {
              modelHistory.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: message }),
              });
            }

            this.pushEvent(events, "tool_complete", {
              name: toolName,
              success: false,
              error: message,
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

    const responseText = research.answer || DEFAULT_ERROR_RESPONSE;

    const updatedHistory = trimConversationHistory(
      [
        ...input.history,
        { role: "user", content: input.message },
        { role: "assistant", content: responseText },
      ],
      12,
    );

    queueMemoryStore({
      id: `msg-${Date.now()}-assistant`,
      content: responseText,
      timestamp: Date.now(),
      importance: 0.6,
      decayRate: 0.1,
      tags: ["chat", "agent-response"],
      source: "chat",
      category: "conversation",
      sessionId: input.sessionId,
      metadata: {
        role: "assistant",
        sources: research.sources.length,
        confidence: research.confidence,
      },
    });

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

    return {
      response: responseText,
      success: true,
      history: updatedHistory,
      research,
      events: this.config.enableTelemetry ? events : undefined,
      metrics,
    };
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
      "Produce a final user-facing answer now.",
      "Use the available tool results as evidence.",
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
        answer: raw || DEFAULT_ERROR_RESPONSE,
        sources: fallbackSources,
        uncertainty:
          fallbackSources.length > 0
            ? "Sources were inferred from tool results."
            : "Limited evidence available.",
        confidence: fallbackSources.length > 0 ? 0.55 : 0.35,
      };
    }

    const candidate = parsed as any;
    const answer = String(candidate.answer || raw || DEFAULT_ERROR_RESPONSE).trim();
    const sources = normalizeSources(candidate.sources, this.config.maxSources);
    const uncertainty =
      typeof candidate.uncertainty === "string" && candidate.uncertainty.trim()
        ? candidate.uncertainty.trim()
        : sources.length > 0
          ? "Based on the cited sources; details may change over time."
          : "Limited evidence available.";
    const confidence = clampNumber(candidate.confidence, sources.length > 0 ? 0.7 : 0.4);

    return {
      answer,
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
          whyRelevant: String(result?.description || `Found via ${item.toolName}`),
        });
        if (sources.length >= maxSources) return sources;
      }
    }

    const fetchUrl = typeof resultObj.finalUrl === "string" ? resultObj.finalUrl : "";
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
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
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
