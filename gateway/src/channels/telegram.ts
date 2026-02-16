import type { ChatService } from "../chat-service.js";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
}

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMe {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramSource {
  title?: string;
  url?: string;
}

export interface TelegramChannelConfig {
  enabled: boolean;
  botToken?: string;
  ownerUserId?: number;
  ownerChatId?: number;
  pollTimeoutSec: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

export interface TelegramChannelStatus {
  enabled: boolean;
  running: boolean;
  connected: boolean;
  ownerUserId?: number;
  ownerChatId?: number;
  botUsername?: string;
  lastUpdateId?: number;
  lastErrorAt?: string;
  lastError?: string;
}

const TELEGRAM_MAX_MESSAGE = 3900;

export class TelegramChannel {
  private running = false;
  private connected = false;
  private lastUpdateId = 0;
  private lastErrorAt: string | undefined;
  private lastError: string | undefined;
  private botUsername: string | undefined;
  private pollPromise: Promise<void> | undefined;

  constructor(
    private readonly config: TelegramChannelConfig,
    private readonly chatService: ChatService,
  ) {}

  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log("📨 Telegram channel disabled");
      this.lastError = undefined;
      this.lastErrorAt = undefined;
      return;
    }
    if (!this.config.botToken) {
      this.setStartupError(
        "missing_telegram_bot_token",
        "⚠️ Telegram is enabled but TELEGRAM_BOT_TOKEN is missing. Run `nova telegram setup` and restart the daemon.",
      );
      return;
    }
    if (!this.config.ownerUserId && !this.config.ownerChatId) {
      this.setStartupError(
        "missing_telegram_owner_id",
        "⚠️ Telegram is enabled but owner IDs are not configured. Run `nova telegram setup` and restart the daemon.",
      );
      return;
    }
    if (this.running) return;

    try {
      const me = await this.getMe();
      this.botUsername = me.username;
      this.connected = true;
      this.running = true;
      this.lastError = undefined;
      this.lastErrorAt = undefined;
      console.log(
        `📨 Telegram channel started (${this.botUsername || "unknown-bot"})`,
      );
      this.pollPromise = this.pollLoop();
    } catch (error: any) {
      const maskedToken = maskToken(this.config.botToken);
      this.setStartupError(
        "telegram_getme_validation_failed",
        `⚠️ Telegram bot validation failed for token ${maskedToken}: ${error?.message || "unknown error"}. Re-run \`nova telegram setup\`.`,
      );
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollPromise) {
      await this.pollPromise.catch((error) => {
        console.error("telegram poll shutdown error:", error);
      });
      this.pollPromise = undefined;
    }
    this.connected = false;
  }

  getStatus(): TelegramChannelStatus {
    return {
      enabled: this.config.enabled,
      running: this.running,
      connected: this.connected,
      ownerUserId: this.config.ownerUserId,
      ownerChatId: this.config.ownerChatId,
      botUsername: this.botUsername,
      lastUpdateId: this.lastUpdateId || undefined,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }

  private async pollLoop(): Promise<void> {
    let retryMs = this.config.retryBaseMs;
    while (this.running) {
      try {
        const updates = await this.getUpdates(this.lastUpdateId + 1);
        for (const update of updates) {
          this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
          await this.handleUpdate(update);
        }
        retryMs = this.config.retryBaseMs;
      } catch (error: any) {
        this.lastErrorAt = new Date().toISOString();
        this.lastError = error?.message || "Unknown error";
        console.error("telegram poll error:", error);
        await waitMs(retryMs);
        retryMs = Math.min(this.config.retryMaxMs, retryMs * 2);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!update.message || !update.message.chat) return;
    const message = update.message;
    const text = String(message.text || "").trim();
    if (!text) return;

    const chatId = message.chat.id;
    const fromUserId = message.from?.id;
    if (!this.isAuthorized(chatId, fromUserId)) {
      await this.sendMessage(
        chatId,
        "This bot is restricted to the configured Nova owner.",
      );
      console.log(
        JSON.stringify({
          type: "telegram_update",
          auth_result: "denied",
          chat_id: chatId,
          update_id: update.update_id,
        }),
      );
      return;
    }

    const command = parseCommand(text);
    if (command === "/start") {
      await this.sendMessage(
        chatId,
        "Nova is connected. Send a message and I will respond with research-backed answers.",
      );
      return;
    }
    if (command === "/help") {
      await this.sendMessage(
        chatId,
        "Commands:\n/start - confirm bot is ready\n/help - show help\n/reset - reset this chat context",
      );
      return;
    }
    if (command === "/reset") {
      this.chatService.resetHistory(`telegram:${chatId}`);
      await this.sendMessage(chatId, "Chat context reset for this Telegram chat.");
      return;
    }

    const startedAt = performance.now();
    const stopThinking = this.startThinkingIndicator(chatId);
    try {
      const result = await this.chatService.runChatTurn({
        message: text,
        sessionId: `telegram:${chatId}`,
        historyKey: `telegram:${chatId}`,
        channel: "telegram",
      });
      const responseText = buildTelegramResponse(
        result.response,
        (result.research?.sources as TelegramSource[] | undefined) || [],
      );
      await this.sendChunkedMessage(chatId, responseText);
      console.log(
        JSON.stringify({
          type: "telegram_update",
          auth_result: "allowed",
          chat_id: chatId,
          update_id: update.update_id,
          source_count: result.research?.sources?.length || 0,
          time_total_ms: Number((performance.now() - startedAt).toFixed(1)),
        }),
      );
    } catch (error) {
      console.error("telegram message handling error:", error);
      await this.sendMessage(chatId, "Sorry, I ran into an error.");
    } finally {
      stopThinking();
    }
  }

  private isAuthorized(chatId: number, fromUserId?: number): boolean {
    const ownerUserId = this.config.ownerUserId;
    const ownerChatId = this.config.ownerChatId;
    const byUser = ownerUserId ? fromUserId === ownerUserId : false;
    const byChat = ownerChatId ? chatId === ownerChatId : false;
    return byUser || byChat;
  }

  private async getMe(): Promise<TelegramMe> {
    return await this.callTelegramApi<TelegramMe>("getMe", {});
  }

  private async getUpdates(offset: number): Promise<TelegramUpdate[]> {
    return await this.callTelegramApi<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout: this.config.pollTimeoutSec,
      allowed_updates: ["message"],
    });
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
  }

  private async sendChatAction(
    chatId: number,
    action: "typing",
  ): Promise<void> {
    await this.callTelegramApi("sendChatAction", {
      chat_id: chatId,
      action,
    });
  }

  private async sendChunkedMessage(chatId: number, text: string): Promise<void> {
    const chunks = splitTelegramMessage(text, TELEGRAM_MAX_MESSAGE);
    for (const chunk of chunks) {
      await this.sendMessage(chatId, chunk);
    }
  }

  private async callTelegramApi<T>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const token = this.config.botToken;
    if (!token) {
      throw new Error("Missing Telegram bot token");
    }

    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const data = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !data.ok || data.result === undefined) {
      const retryAfter = data.parameters?.retry_after;
      if (typeof retryAfter === "number" && retryAfter > 0) {
        await waitMs(retryAfter * 1000);
      }
      throw new Error(
        `Telegram API ${method} failed: ${
          data.description || response.statusText || "unknown error"
        }`,
      );
    }

    return data.result;
  }

  private startThinkingIndicator(chatId: number): () => void {
    let active = true;
    const emit = () => {
      if (!active) return;
      void this.sendChatAction(chatId, "typing").catch(() => {
        // Typing indicator failures should never break message handling.
      });
    };
    emit();
    const timer = setInterval(emit, 4500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }

  private setStartupError(code: string, message: string): void {
    this.running = false;
    this.connected = false;
    this.lastErrorAt = new Date().toISOString();
    this.lastError = code;
    console.warn(message);
  }
}

function parseCommand(text: string): string | null {
  const firstToken = text.split(/\s+/)[0];
  if (!firstToken.startsWith("/")) return null;
  const [command] = firstToken.split("@");
  return command.toLowerCase();
}

function splitTelegramMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + maxLength, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > cursor + 500) {
        end = newline;
      }
    }
    chunks.push(text.slice(cursor, end).trim());
    cursor = end;
  }
  return chunks.filter(Boolean);
}

function buildTelegramResponse(baseText: string, sources: TelegramSource[]): string {
  const normalized: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  for (const source of sources || []) {
    const url = String(source?.url || "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const rawTitle = String(source?.title || "").trim();
    const title = rawTitle || url;
    normalized.push({ title, url });
    if (normalized.length >= 3) break;
  }

  if (normalized.length === 0) return baseText;
  const formattedSources = normalized
    .map((source, index) => `${index + 1}. ${source.title}\n   ${source.url}`)
    .join("\n");

  return `${baseText}\n\nSources:\n${formattedSources}`;
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function maskToken(token?: string): string {
  if (!token) return "(not set)";
  if (token.length <= 10) return "*".repeat(token.length);
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}
