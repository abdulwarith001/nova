import type { Agent, Message } from "../../agent/src/index.js";
import {
  type ResearchEvent,
  type ResearchOrchestrator,
  type ResearchSource,
} from "./research-orchestrator.js";
import {
  trimConversationHistory,
  type ChatHistoryMessage,
} from "./chat-speed.js";

export interface ChatServiceConfig {
  useResearchOrchestratorV2: boolean;
  enableTelemetry: boolean;
  shadowMode: boolean;
  historyLimit?: number;
}

export interface ChatTurnInput {
  message: string;
  sessionId: string;
  historyKey: string;
  channel: "ws" | "telegram" | "whatsapp";
  /** Optional context about the sender — identity, role, instructions for the agent. Only used by WhatsApp channel. */
  senderContext?: string;
}

export interface ChatTurnOutput {
  response: string;
  success: boolean;
  research?: {
    sources: ResearchSource[];
    uncertainty: string;
    confidence: number;
  };
  events?: ResearchEvent[];
}

export class ChatService {
  private readonly histories = new Map<string, ChatHistoryMessage[]>();
  private readonly historyLimit: number;

  constructor(
    private readonly orchestrator: ResearchOrchestrator,
    private readonly agent: Agent,
    private readonly config: ChatServiceConfig,
  ) {
    this.historyLimit = config.historyLimit ?? 24;
  }

  resetHistory(historyKey: string): void {
    this.histories.delete(historyKey);
  }

  async runChatTurn(input: ChatTurnInput): Promise<ChatTurnOutput> {
    const userMessage = String(input.message || "").trim();
    if (!userMessage) {
      return { response: "", success: true };
    }

    const history = this.getOrCreateHistory(input.historyKey, input.channel);

    // Inject per-message sender context (e.g. WhatsApp identity info)
    if (input.senderContext) {
      const contextContent = `[SENDER CONTEXT] ${input.senderContext}`;
      const existingIdx = history.findIndex(
        (m) => m.role === "system" && m.content.startsWith("[SENDER CONTEXT]"),
      );
      if (existingIdx >= 0) {
        history[existingIdx] = { role: "system", content: contextContent };
      } else {
        // Insert after the initial system message
        const insertAt =
          history.length > 0 && history[0].role === "system" ? 1 : 0;
        history.splice(insertAt, 0, {
          role: "system",
          content: contextContent,
        });
      }
    }

    if (this.config.useResearchOrchestratorV2) {
      const result = await this.orchestrator.runChatTurn({
        message: userMessage,
        history,
        sessionId: input.sessionId,
      });

      this.histories.set(input.historyKey, result.history);
      if (this.config.shadowMode) {
        void this.agent
          .chat(userMessage, this.toSimpleHistory(result.history))
          .then((shadowResponse) => {
            console.log(
              JSON.stringify({
                type: "research_shadow_compare",
                channel: input.channel,
                history_key: input.historyKey,
                primary_preview: result.response.slice(0, 180),
                shadow_preview: shadowResponse.slice(0, 180),
              }),
            );
          })
          .catch((shadowError) => {
            console.error("shadow mode failed:", shadowError);
          });
      }

      return {
        response: result.response,
        success: result.success,
        research: {
          sources: result.research.sources,
          uncertainty: result.research.uncertainty,
          confidence: result.research.confidence,
        },
        events: this.config.enableTelemetry ? result.events : undefined,
      };
    }

    const fallbackResponse = await this.agent.chat(
      userMessage,
      this.toSimpleHistory(history),
    );
    const nextHistory = trimConversationHistory(
      [
        ...history,
        { role: "user", content: userMessage },
        { role: "assistant", content: fallbackResponse },
      ],
      this.historyLimit,
    );
    this.histories.set(input.historyKey, nextHistory);

    return {
      response: fallbackResponse,
      success: true,
    };
  }

  getSessionCount(): number {
    return this.histories.size;
  }

  private getOrCreateHistory(
    historyKey: string,
    channel?: string,
  ): ChatHistoryMessage[] {
    const existing = this.histories.get(historyKey);
    if (existing) return existing;

    const initialHistory: ChatHistoryMessage[] = [
      {
        role: "system",
        content: this.buildInitialSystemPrompt(channel),
      },
    ];
    this.histories.set(historyKey, initialHistory);
    return initialHistory;
  }

  private buildInitialSystemPrompt(channel?: string): string {
    const now = new Date();
    const timestamp = `Current date and time: ${now.toISOString()}.`;

    if (channel === "whatsapp") {
      return [
        timestamp,
        "",
        "You are Nova, a personal AI assistant communicating via WhatsApp.",
        "",
        "Behavior:",
        "- Be warm, conversational, and concise — this is a chat, not an email.",
        "- Be proactive: suggest useful actions, don't just wait to be asked.",
        "- Reference past conversations and memories when relevant.",
        "- If you have access to tools (calendar, email, search), offer to use them.",
        "",
        "Formatting rules (WhatsApp-native):",
        "- Use *bold* for emphasis (NOT **bold**).",
        "- Use _italics_ for subtle emphasis.",
        "- Use bullet points with • or -.",
        "- NEVER use markdown headers (#), tables, or code blocks — they render as plain text on WhatsApp.",
        "- Use emojis naturally but sparingly.",
        "- Keep responses under 200 words unless asked for detail.",
      ].join("\n");
    }

    return `${timestamp} Use this as the reference for any time-related queries.`;
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
}
