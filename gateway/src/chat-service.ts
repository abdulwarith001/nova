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
  identityContent?: string;
  skillsSummary?: string;
}

export interface ChatTurnInput {
  message: string;
  sessionId: string;
  historyKey: string;
  channel: "ws" | "telegram";
  imageBase64?: string;
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
    if (!userMessage && !input.imageBase64) {
      return { response: "", success: true };
    }

    const history = this.getOrCreateHistory(input.historyKey, input.channel);

    // Vision path: image present → use chatWithVision directly
    if (input.imageBase64) {
      const prompt = userMessage || "Describe this image in detail.";
      try {
        const visionResponse = await this.agent.chatWithVision(
          input.imageBase64,
          prompt,
        );
        // Store text summary in history (not the huge base64)
        const nextHistory = trimConversationHistory(
          [
            ...history,
            { role: "user", content: `[Image sent] ${prompt}` },
            { role: "assistant", content: visionResponse },
          ],
          this.historyLimit,
        );
        this.histories.set(input.historyKey, nextHistory);

        return {
          response: visionResponse,
          success: true,
        };
      } catch (err: any) {
        console.error("Vision analysis failed:", err?.message);
        return {
          response:
            "Sorry, I couldn't analyze that image. Try sending it again.",
          success: false,
        };
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

    const parts: string[] = [timestamp, ""];

    // Use IDENTITY.md content if available, otherwise fall back to a minimal prompt
    if (this.config.identityContent) {
      parts.push(this.config.identityContent);
    } else {
      parts.push(
        "You are Nova, a personal AI assistant.",
        "Be warm, direct, and genuinely helpful.",
      );
    }

    // Append available skills so the LLM knows what it can do
    if (this.config.skillsSummary) {
      parts.push("", this.config.skillsSummary);
    }

    return parts.join("\n");
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
