import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync } from "fs";
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
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data: string;
  };
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
  private readonly statePath: string;
  private lastErrorAt: string | undefined;
  private lastError: string | undefined;
  private botUsername: string | undefined;
  private pollPromise: Promise<void> | undefined;
  private readonly activeResearch = new Map<number, AbortController>();
  private readonly pendingConfirmations = new Map<
    string,
    (approved: boolean) => void
  >();

  constructor(
    private readonly config: TelegramChannelConfig,
    private readonly chatService: ChatService,
  ) {
    this.statePath = join(homedir(), ".nova", "telegram-state.json");
    this.loadState();
  }

  private loadState(): void {
    try {
      if (existsSync(this.statePath)) {
        const raw = readFileSync(this.statePath, "utf-8");
        const data = JSON.parse(raw);
        if (data && data.lastUpdateId) {
          this.lastUpdateId = data.lastUpdateId;
          console.log(`📨 [Telegram] Resumed from update ${this.lastUpdateId}`);
        }
      }
    } catch (err) {
      // Ignore
    }
  }

  private async saveState(): Promise<void> {
    try {
      writeFileSync(
        this.statePath,
        JSON.stringify({ lastUpdateId: this.lastUpdateId }),
        "utf-8",
      );
    } catch (err) {
      // Ignore
    }
  }

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

  async sendProactiveMessage(chatId: number, text: string): Promise<void> {
    await this.streamDelivery(chatId, text);
  }

  /**
   * Ask the user for confirmation via an interactive message.
   */
  async askConfirmation(
    chatId: number,
    text: string,
    actionId: string,
  ): Promise<boolean> {
    const messageId = await this.callTelegramApi<{ message_id: number }>(
      "sendMessage",
      {
        chat_id: chatId,
        text: `🛡️ <b>Security Confirmation Required</b>\n\n${text}`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `confirm_ok:${actionId}` },
              { text: "❌ Deny", callback_data: `confirm_no:${actionId}` },
            ],
          ],
        },
      },
    ).then((res) => res.message_id);

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(
        () => {
          this.pendingConfirmations.delete(actionId);
          this.editMessage(chatId, messageId, "⌛ Confirmation timed out.")
            .catch(() => {})
            .finally(() => resolve(false));
        },
        5 * 60 * 1000,
      ); // 5 minute timeout

      this.pendingConfirmations.set(actionId, (approved: boolean) => {
        clearTimeout(timeout);
        this.pendingConfirmations.delete(actionId);
        this.editMessage(
          chatId,
          messageId,
          approved ? "✅ Action Approved" : "❌ Action Denied",
        )
          .catch(() => {})
          .finally(() => resolve(approved));
      });
    });
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
          if (update.update_id > this.lastUpdateId) {
            this.lastUpdateId = update.update_id;
            await this.saveState();
          }

          // Callback queries (button clicks) must be processed synchronously
          // so they can resolve pending HitL confirmations immediately.
          // Message updates are processed asynchronously so the poll loop
          // continues fetching — this prevents the deadlock where the loop
          // blocks on message processing and can never receive the callback.
          if (update.callback_query) {
            await this.handleUpdate(update);
          } else {
            void this.handleUpdate(update).catch((err) => {
              console.error("📨 [Telegram] Error handling update:", err);
            });
          }
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
    const updateType = update.callback_query
      ? "callback_query"
      : update.message
        ? "message"
        : "unknown";
    console.log(
      `📨 [Telegram] Update ${update.update_id} (${updateType}) received`,
    );

    // 1. Handle Callback Queries (Buttons)
    if (update.callback_query) {
      const { id, data, message } = update.callback_query;
      console.log(
        `📨 [Telegram] Callback Query: id=${id}, data=${data}, msgId=${message?.message_id}`,
      );

      try {
        // DO NOT await this, send it and continue so the UI doesn't hang
        void this.callTelegramApi("answerCallbackQuery", {
          callback_query_id: id,
        }).catch((err) => {
          console.warn(
            `⚠️ [Telegram] Failed to answer callback query ${id}:`,
            err,
          );
        });
      } catch (err) {
        // Sink
      }

      if (data.startsWith("confirm_")) {
        const approved = data.startsWith("confirm_ok:");
        const actionId = data.split(":")[1];
        const handler = this.pendingConfirmations.get(actionId);

        console.log(
          `🛡️ [Telegram] HitL Confirmation: ${approved ? "✅ APPROVED" : "❌ DENIED"} (id: ${actionId}, chat: ${message?.chat.id})`,
        );

        if (handler) {
          handler(approved);
        } else {
          console.warn(`⚠️ [Telegram] No handler for actionId: ${actionId}`);
          if (message) {
            try {
              await this.editMessage(
                message.chat.id,
                message.message_id,
                "⚠️ <b>Request Expired</b>\n\nThis confirmation request is no longer active (likely due to a bot restart). Please try the command again.",
              );
            } catch (err) {
              console.warn(
                `⚠️ [Telegram] Failed to edit expired message:`,
                err,
              );
            }
          }
        }
      }
      return;
    }

    // 2. Handle Messages
    if (!update.message || !update.message.chat) return;
    const message = update.message;

    console.log(
      `📨 [Telegram] New update ${update.update_id} from chat ${message.chat.id}`,
    );
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
        confirm: async (step, reason) => {
          return await this.askConfirmation(
            chatId,
            `${reason}\n\n<b>Action:</b> ${step.toolName}`,
            `confirm_${Date.now()}_${step.id}`,
          );
        },
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
      allowed_updates: ["message", "callback_query"],
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
   * Native streaming bubble for real-time AI responses (Bot API 9.5+).
   */
  private async sendMessageDraft(
    chatId: number,
    text: string,
    draftId: number,
  ): Promise<void> {
    try {
      await this.callTelegramApi(
        "sendMessageDraft",
        {
          chat_id: chatId,
          text,
          draft_id: draftId,
          disable_web_page_preview: true,
        },
      );
    } catch {
      // Ignore transient draft errors
    }
  }

  /**
   * Stream the delivery of an already-generated response to Telegram.
   * Uses Bot API 9.5 native streaming (sendMessageDraft) to simulate typing speed,
   * then sends a permanent message.
   */
  private async streamDelivery(chatId: number, text: string): Promise<void> {
    // Short responses — just send directly (e.g. "Yes.", "Done.")
    if (text.length < 15) {
      await this.sendChunkedMessage(chatId, text);
      return;
    }

    const CHUNK_SIZE = 25; // Smaller chunks for a smoother typing effect
    const STEP_DELAY_MS = 60; // Delay to simulate typing and respect rate limits
    const draftId = Math.floor(Math.random() * 1_000_000_000);
    let cursor = 0;

    // Progressive reveal via draft edits
    while (cursor < text.length) {
      cursor = Math.min(cursor + CHUNK_SIZE, text.length);
      if (cursor < text.length) {
        // Try to break at space for better visual flow
        const nextSpace = text.indexOf(" ", cursor);
        if (nextSpace !== -1 && nextSpace - cursor < 30) {
          cursor = nextSpace + 1;
        }
      }

      const partial = text.slice(0, cursor);
      const formatted = formatStreamingChunk(partial);

      await this.sendMessageDraft(chatId, formatted, draftId);

      if (cursor < text.length) {
        await waitMs(STEP_DELAY_MS);
      }
    }

    // Clear the draft bubble explicitly
    await this.sendMessageDraft(chatId, "", draftId);

    // Finalize with full markdown-to-html conversion for the whole text
    await this.sendChunkedMessage(chatId, text);
  }

  /**
   * Stream an async generator of text deltas to Telegram using sendMessageDraft.
   * Debounces updates every 300ms to avoid rate limiting.
   * Returns the accumulated full text.
   * @deprecated This method is no longer used directly for streaming responses. Use `streamDelivery` instead.
   */

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
