import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";

// LLM Provider types
export type LLMProvider = "anthropic" | "openai" | "google";

export interface AgentConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ToolCall {
  id?: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Raw thinking output from extended thinking or CoT prompt */
  thinking?: string;
}

// Agent class with tool calling support
export class Agent {
  private config: AgentConfig;
  private systemPrompt: string;
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;

  constructor(config: AgentConfig, systemPrompt?: string) {
    this.config = config;
    this.systemPrompt = systemPrompt || "You are a helpful AI assistant.";

    // Initialize client based on provider
    if (config.provider === "anthropic") {
      this.anthropicClient = new Anthropic({
        apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
      });
    } else if (config.provider === "openai") {
      this.openaiClient = new OpenAI({
        apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      });
    }
  }

  /**
   * Simple chat without tools
   */
  async chat(userMessage: string, history: Message[] = []): Promise<string> {
    const messages: Message[] = [
      { role: "system", content: this.systemPrompt },
      ...history,
      { role: "user", content: userMessage },
    ];

    const response = await this.chatInternal(messages);
    return response.content;
  }

  /**
   * Chat with tool calling support
   */
  async chatWithTools(
    messages: Array<{ role: string; content: string }>,
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    if (this.config.provider === "anthropic") {
      return this.chatWithToolsAnthropic(messages, tools);
    } else if (this.config.provider === "openai") {
      return this.chatWithToolsOpenAI(messages, tools);
    }
    throw new Error(
      `Provider ${this.config.provider} not supported for tool calling`,
    );
  }

  /**
   * Anthropic tool calling
   */
  private async chatWithToolsAnthropic(
    messages: Array<{ role: string; content: string }>,
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    if (!this.anthropicClient) {
      throw new Error("Anthropic client not initialized");
    }

    // Convert tools to Anthropic format
    const anthropicTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));

    // Separate system message
    const systemMessage =
      messages.find((m) => m.role === "system")?.content || this.systemPrompt;
    const userMessages = messages.filter((m) => m.role !== "system");

    const response = (await (this.anthropicClient.messages.create as any)({
      model: this.config.model || "claude-3-5-sonnet-20241022",
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature || 0.7,
      system: systemMessage,
      messages: userMessages as any,
      tools: anthropicTools as any,
    })) as any;

    // Extract tool calls
    const toolCalls: ToolCall[] = [];
    let textContent = "";

    for (const block of response.content as any[]) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          name: block.name,
          parameters: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * OpenAI tool calling
   */
  private async chatWithToolsOpenAI(
    messages: Array<{ role: string; content: string }>,
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    // Convert tools to OpenAI format
    const openaiTools = tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const response = await this.openaiClient.chat.completions.create({
      model: this.config.model || "gpt-4-turbo",
      messages: messages as any,
      temperature: this.config.temperature || 0.7,
      max_tokens: this.config.maxTokens || 4096,
      tools: openaiTools,
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        toolCalls.push({
          id: toolCall.id,
          name: toolCall.function.name,
          parameters: JSON.parse(toolCall.function.arguments),
        });
      }
    }

    return {
      content: choice.message.content || "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    };
  }

  /**
   * Internal chat method
   */
  private async chatInternal(messages: Message[]): Promise<LLMResponse> {
    if (this.config.provider === "anthropic" && this.anthropicClient) {
      const response = await this.anthropicClient.messages.create({
        model: this.config.model || "claude-3-5-sonnet-20241022",
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature || 0.7,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
      });

      return {
        content:
          response.content[0].type === "text" ? response.content[0].text : "",
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    }

    if (this.config.provider === "openai" && this.openaiClient) {
      const response = await this.openaiClient.chat.completions.create({
        model: this.config.model || "gpt-4o-mini",
        temperature: this.config.temperature || 0.7,
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      });

      const choice = response.choices[0];
      return {
        content: choice.message.content || "",
        usage: {
          inputTokens: response.usage?.prompt_tokens || 0,
          outputTokens: response.usage?.completion_tokens || 0,
        },
      };
    }

    throw new Error("Provider not supported");
  }

  /**
   * Vision analysis — sends an image to the LLM for visual understanding.
   * Used by the browse tool's vision sub-agent to analyze screenshots.
   * Returns a text description of what the LLM sees in the image.
   */
  async chatWithVision(imageBase64: string, prompt: string): Promise<string> {
    if (this.config.provider === "anthropic" && this.anthropicClient) {
      const response = await this.anthropicClient.messages.create({
        model: this.config.model || "claude-3-5-sonnet-20241022",
        max_tokens: this.config.maxTokens || 2048,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: imageBase64,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      });

      return response.content[0].type === "text"
        ? response.content[0].text
        : "";
    }

    if (this.config.provider === "openai" && this.openaiClient) {
      const response = await this.openaiClient.chat.completions.create({
        model: this.config.model || "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: this.config.maxTokens || 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${imageBase64}`,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      });

      return response.choices[0]?.message?.content || "";
    }

    throw new Error("Provider not supported for vision");
  }

  /**
   * Streaming chat
   */
  async *streamChat(
    userMessage: string,
    history: Message[] = [],
  ): AsyncGenerator<string> {
    const messages: Message[] = [
      { role: "system", content: this.systemPrompt },
      ...history,
      { role: "user", content: userMessage },
    ];

    if (this.config.provider === "anthropic" && this.anthropicClient) {
      const stream = await this.anthropicClient.messages.create({
        model: this.config.model || "claude-3-5-sonnet-20241022",
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature || 0.7,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        stream: true,
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }
    }
  }

  /**
   * Chat with chain-of-thought reasoning.
   * The model is prompted to think step-by-step before responding.
   * Returns both the thinking trace and the final response.
   */
  async chatWithThinking(
    userMessage: string,
    history: Message[] = [],
    tools?: ToolDefinition[],
  ): Promise<LLMResponse> {
    const thinkingPrompt = `Before responding, think through this step by step in a <thinking> block. Then provide your final response.

${userMessage}`;

    if (tools && tools.length > 0) {
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: this.systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: thinkingPrompt },
      ];
      const response = await this.chatWithTools(messages, tools);

      // Extract thinking from <thinking> tags if present
      const thinkingMatch = response.content.match(
        /<thinking>([\s\S]*?)<\/thinking>/,
      );
      const thinking = thinkingMatch ? thinkingMatch[1].trim() : undefined;
      const cleanContent = response.content
        .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
        .trim();

      return {
        ...response,
        content: cleanContent || response.content,
        thinking,
      };
    }

    const response = await this.chat(thinkingPrompt, history);

    // Extract thinking from <thinking> tags if present
    const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/);
    const thinking = thinkingMatch ? thinkingMatch[1].trim() : undefined;
    const cleanContent = response
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
      .trim();

    return {
      content: cleanContent || response,
      thinking,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
