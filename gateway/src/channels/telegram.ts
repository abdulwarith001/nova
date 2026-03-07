import type { ChatService } from "../chat-service.js";
import { drainPendingImages } from "../../../runtime/src/pending-images.js";
import {
  markdownToTelegramHtml,
  formatStreamingChunk,
  formatSourcesHtml,
} from "./telegram-formatter.js";

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

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  photo?: TelegramPhotoSize[];
  caption?: string;
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
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
  private readonly activeResearch = new Map<number, AbortController>();

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

  /**
   * Send a proactive message to a chat ID (used by heartbeat engine).
   */
  async sendProactiveMessage(chatId: number, text: string): Promise<void> {
    await this.streamDelivery(chatId, text);
  }

  private async pollLoop(): Promise<void> {
    let retryMs = this.config.retryBaseMs;
    let consecutiveFailures = 0;
    const CIRCUIT_BREAK_THRESHOLD = 5;
    const CIRCUIT_BREAK_LONG_THRESHOLD = 10;
    const CIRCUIT_BREAK_PAUSE_MS = 5 * 60 * 1000; // 5 min
    const CIRCUIT_BREAK_LONG_PAUSE_MS = 15 * 60 * 1000; // 15 min

    while (this.running) {
      try {
        const updates = await this.getUpdates(this.lastUpdateId + 1);
        for (const update of updates) {
          this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
          await this.handleUpdate(update);
        }
        retryMs = this.config.retryBaseMs;
        consecutiveFailures = 0;
      } catch (error: any) {
        consecutiveFailures++;
        this.lastErrorAt = new Date().toISOString();
        this.lastError = error?.message || "Unknown error";

        if (consecutiveFailures >= CIRCUIT_BREAK_LONG_THRESHOLD) {
          console.error(
            `🔴 Telegram circuit breaker: ${consecutiveFailures} consecutive failures — pausing 15min`,
          );
          await waitMs(CIRCUIT_BREAK_LONG_PAUSE_MS);
          consecutiveFailures = 0;
          retryMs = this.config.retryBaseMs;
        } else if (consecutiveFailures >= CIRCUIT_BREAK_THRESHOLD) {
          console.warn(
            `🟡 Telegram circuit breaker: ${consecutiveFailures} consecutive failures — pausing 5min`,
          );
          await waitMs(CIRCUIT_BREAK_PAUSE_MS);
          retryMs = this.config.retryBaseMs;
        } else {
          console.error("telegram poll error:", error);
          await waitMs(retryMs);
          retryMs = Math.min(this.config.retryMaxMs, retryMs * 2);
        }
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!update.message || !update.message.chat) return;
    const message = update.message;
    const hasPhoto = !!(message.photo && message.photo.length > 0);
    const hasImageDoc =
      message.document?.mime_type?.startsWith("image/") ?? false;
    const text = String(message.text || message.caption || "").trim();
    if (!text && !hasPhoto && !hasImageDoc) return;

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
      await this.sendMessage(
        chatId,
        "Chat context reset for this Telegram chat.",
      );
      return;
    }

    const startedAt = performance.now();

    // Check if the user wants to cancel an ongoing research
    if (isCancelPhrase(text) && this.activeResearch.has(chatId)) {
      const controller = this.activeResearch.get(chatId);
      controller?.abort();
      this.activeResearch.delete(chatId);
      await this.sendMessage(
        chatId,
        "⛔ Research stopped. Send a new message to start fresh.",
      );
      console.log(
        `   ⛔ [Telegram] User cancelled active research for chat ${chatId}`,
      );
      return;
    }

    const stopThinking = this.startThinkingIndicator(chatId);
    const abortController = new AbortController();
    this.activeResearch.set(chatId, abortController);

    // Progress message: send an editable status message and update it
    let progressMessageId: number | undefined;
    const onProgress = async (stage: string) => {
      try {
        if (progressMessageId) {
          await this.editMessage(chatId, progressMessageId, stage);
        } else {
          progressMessageId = await this.sendMessageAndGetId(chatId, stage);
        }
      } catch {
        // Progress updates are best-effort
      }
    };

    try {
      // Download photo if present
      let imageBase64: string | undefined;
      if (hasPhoto && message.photo) {
        const largest = message.photo[message.photo.length - 1];
        imageBase64 = await this.downloadFileAsBase64(largest.file_id);
      } else if (hasImageDoc && message.document) {
        imageBase64 = await this.downloadFileAsBase64(message.document.file_id);
      }

      // Use the full orchestrator (with tools) for processing
      const result = await this.chatService.runChatTurn({
        message: text || "Describe this image.",
        sessionId: `telegram:${chatId}`,
        historyKey: `telegram:${chatId}`,
        channel: "telegram",
        imageBase64,
        onProgress,
        signal: abortController.signal,
      });

      stopThinking();
      this.activeResearch.delete(chatId);

      // Delete the progress message before sending the final response
      if (progressMessageId) {
        await this.deleteMessage(chatId, progressMessageId).catch(() => {});
      }

      const responseText = buildTelegramResponse(
        result.response,
        (result.research?.sources as TelegramSource[] | undefined) || [],
      );

      // Stream the delivery of the response for a progressive display
      await this.streamDelivery(chatId, responseText);

      // Send any images generated by tools during this chat turn
      const pendingImages = drainPendingImages();
      for (const img of pendingImages) {
        try {
          await this.sendPhoto(chatId, img.imageBase64, img.caption);
        } catch (imgErr: any) {
          console.warn("Failed to send generated image:", imgErr?.message);
        }
      }

      console.log(
        JSON.stringify({
          type: "telegram_update",
          auth_result: "allowed",
          chat_id: chatId,
          update_id: update.update_id,
          response_length: responseText.length,
          time_total_ms: Number((performance.now() - startedAt).toFixed(1)),
        }),
      );
    } catch (error) {
      console.error("telegram message handling error:", error);
      if (progressMessageId) {
        await this.deleteMessage(chatId, progressMessageId).catch(() => {});
      }
      await this.sendMessage(chatId, "Sorry, I ran into an error.", false);
    } finally {
      // Always drain pending images to prevent stale images leaking into next request
      drainPendingImages();
      stopThinking();
      this.activeResearch.delete(chatId);
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

  private async sendMessage(
    chatId: number,
    text: string,
    useHtml = true,
  ): Promise<void> {
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text: useHtml ? markdownToTelegramHtml(text) : text,
      parse_mode: useHtml ? "HTML" : undefined,
      disable_web_page_preview: true,
    });
  }

  /**
   * Send a message and return its message_id for later editing/deleting.
   */
  private async sendMessageAndGetId(
    chatId: number,
    text: string,
  ): Promise<number> {
    const result = await this.callTelegramApi<{ message_id: number }>(
      "sendMessage",
      {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      },
    );
    return result.message_id;
  }

  /**
   * Edit an existing message by message_id.
   */
  private async editMessage(
    chatId: number,
    messageId: number,
    text: string,
  ): Promise<void> {
    try {
      await this.callTelegramApi("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        disable_web_page_preview: true,
      });
    } catch {
      // Edit can fail if message is identical or already deleted — ignore
    }
  }

  /**
   * Delete a message by message_id (best-effort).
   */
  private async deleteMessage(
    chatId: number,
    messageId: number,
  ): Promise<void> {
    await this.callTelegramApi("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  /**
   * Send a streaming draft message using Telegram's sendMessageDraft API.
   * Incrementally updates the message as text is generated.
   */
  private async sendMessageDraft(
    chatId: number,
    text: string,
    draftId: number,
    complete = false,
  ): Promise<void> {
    try {
      await this.callTelegramApi("sendMessageDraft", {
        chat_id: chatId,
        text,
        draft_id: draftId,
        parse_mode: "HTML",
        complete,
        disable_web_page_preview: true,
      });
    } catch (err: any) {
      // If sendMessageDraft is not available (older API), fall back silently
      if (
        err?.message?.includes("not found") ||
        err?.message?.includes("unknown method")
      ) {
        if (complete) {
          // Fall back to regular sendMessage for the final text
          await this.callTelegramApi("sendMessage", {
            chat_id: chatId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          });
        }
        return;
      }
      throw err;
    }
  }

  /**
   * Stream the delivery of an already-generated response to Telegram.
   * Tries progressive reveal via sendMessageDraft, then sends a permanent message.
   */
  private async streamDelivery(chatId: number, text: string): Promise<void> {
    // Short responses — just send directly
    if (text.length < 50) {
      await this.sendChunkedMessage(chatId, text);
      return;
    }

    const draftId = Date.now();
    const CHUNK_SIZE = 120;
    const STEP_DELAY_MS = 60;
    let cursor = 0;
    let draftWorked = false;

    try {
      // Progressive reveal via drafts
      while (cursor < text.length) {
        cursor = Math.min(cursor + CHUNK_SIZE, text.length);
        if (cursor < text.length) {
          const nextSpace = text.indexOf(" ", cursor);
          if (nextSpace !== -1 && nextSpace - cursor < 20) {
            cursor = nextSpace + 1;
          }
        }
        const partial = text.slice(0, cursor);
        const formatted = formatStreamingChunk(partial);
        await this.sendMessageDraft(chatId, formatted, draftId, false);
        draftWorked = true;
        if (cursor < text.length) {
          await waitMs(STEP_DELAY_MS);
        }
      }

      // Finalize draft
      const finalHtml = markdownToTelegramHtml(text);
      await this.sendMessageDraft(chatId, finalHtml, draftId, true);
    } catch (err: any) {
      console.warn("Draft streaming failed:", err?.message || err);
      if (!draftWorked) {
        // sendMessageDraft not supported — just send normally
        await this.sendChunkedMessage(chatId, text);
        return;
      }
    }

    // Send permanent message
    await this.sendChunkedMessage(chatId, text);
  }

  /**
   * Stream an async generator of text deltas to Telegram using sendMessageDraft.
   * Debounces updates every 300ms to avoid rate limiting.
   * Returns the accumulated full text.
   * @deprecated This method is no longer used directly for streaming responses. Use `streamDelivery` instead.
   */
  async streamResponse(
    chatId: number,
    stream: AsyncGenerator<string>,
    draftId: number,
  ): Promise<string> {
    let accumulated = "";
    let lastSentAt = 0;
    const DEBOUNCE_MS = 300;

    for await (const delta of stream) {
      accumulated += delta;
      const now = Date.now();

      if (now - lastSentAt >= DEBOUNCE_MS) {
        const formatted = formatStreamingChunk(accumulated);
        await this.sendMessageDraft(chatId, formatted, draftId, false).catch(
          () => {
            // Swallow draft update errors — final message will be sent below
          },
        );
        lastSentAt = now;
      }
    }

    // Finalize draft (best effort) then send permanent message
    const finalHtml = markdownToTelegramHtml(accumulated);
    await this.sendMessageDraft(chatId, finalHtml, draftId, true).catch(
      () => {},
    );

    // Always send a permanent message so the user has a lasting copy
    await this.sendChunkedMessage(chatId, accumulated);

    return accumulated;
  }

  /** Download a Telegram file by file_id and return as base64. */
  private async downloadFileAsBase64(fileId: string): Promise<string> {
    const token = this.config.botToken;
    if (!token) throw new Error("Missing Telegram bot token");

    // Step 1: Get file path
    const fileInfo = await this.callTelegramApi<{
      file_path: string;
    }>("getFile", { file_id: fileId });

    // Step 2: Download binary
    const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString("base64");
  }

  /** Send a photo to a chat. Accepts base64 image data. */
  async sendPhoto(
    chatId: number,
    imageBase64: string,
    caption?: string,
    mimeType = "image/png",
  ): Promise<void> {
    const token = this.config.botToken;
    if (!token) throw new Error("Missing Telegram bot token");

    const buffer = Buffer.from(imageBase64, "base64");
    const ext =
      mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";

    // Use multipart/form-data for binary upload
    const boundary = `----NovaUpload${Date.now()}`;
    const parts: Buffer[] = [];

    // chat_id field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`,
      ),
    );

    // photo field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="image.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
    );
    parts.push(buffer);
    parts.push(Buffer.from("\r\n"));

    // caption field (optional)
    if (caption) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`,
        ),
      );
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendPhoto`,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(
        `Telegram sendPhoto failed: ${(data as any).description || response.statusText}`,
      );
    }
  }

  /** Send a photo proactively (used by tools/scheduler). */
  async sendProactivePhoto(
    chatId: number,
    imageBase64: string,
    caption?: string,
  ): Promise<void> {
    await this.sendPhoto(chatId, imageBase64, caption);
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

  private async sendChunkedMessage(
    chatId: number,
    text: string,
  ): Promise<void> {
    const formatted = markdownToTelegramHtml(text);
    const chunks = splitTelegramMessage(formatted, TELEGRAM_MAX_MESSAGE);
    for (let i = 0; i < chunks.length; i++) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: chunks[i],
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      // Small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await waitMs(100);
      }
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

const CANCEL_PHRASES = new Set([
  "stop",
  "cancel",
  "abort",
  "stop research",
  "cancel research",
  "stop it",
  "nevermind",
  "never mind",
]);

function isCancelPhrase(text: string): boolean {
  return CANCEL_PHRASES.has(text.toLowerCase().trim());
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

function buildTelegramResponse(
  baseText: string,
  sources: TelegramSource[],
): string {
  const sourcesHtml = formatSourcesHtml(sources);
  return sourcesHtml ? `${baseText}${sourcesHtml}` : baseText;
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function maskToken(token?: string): string {
  if (!token) return "(not set)";
  if (token.length <= 10) return "*".repeat(token.length);
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}
