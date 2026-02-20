import type { ChatService } from "../chat-service.js";
import type { ChatProgressEvent } from "../chat-progress.js";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readdirSync } from "fs";

/**
 * Find a usable Chrome/Chromium binary.
 * 1. Puppeteer's cache (~/.cache/puppeteer/chrome/...)
 * 2. System Chrome/Chromium
 * Returns undefined if nothing found — Puppeteer will try its own default.
 */
function resolveBrowserPath(): string | undefined {
  // Check Puppeteer's download cache
  const puppeteerCache = join(homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(puppeteerCache)) {
    try {
      const versions = readdirSync(puppeteerCache);
      for (const ver of versions) {
        // macOS: chrome-mac-arm64/Google Chrome for Testing.app/...
        const macPath = join(
          puppeteerCache,
          ver,
          "chrome-mac-arm64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        );
        if (existsSync(macPath)) return macPath;
        // macOS Intel
        const macIntelPath = join(
          puppeteerCache,
          ver,
          "chrome-mac-x64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        );
        if (existsSync(macIntelPath)) return macIntelPath;
        // Linux
        const linuxPath = join(puppeteerCache, ver, "chrome-linux64", "chrome");
        if (existsSync(linuxPath)) return linuxPath;
      }
    } catch {
      /* ignore */
    }
  }

  // Fallback: system-installed browsers
  const systemPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const p of systemPaths) {
    if (existsSync(p)) return p;
  }

  return undefined;
}

export interface WhatsAppChannelConfig {
  enabled: boolean;
  /** The user's own phone number (with country code, no +). Used to detect "own number" mode. */
  ownerNumber?: string;
  /**
   * Numbers allowed to interact with Nova.
   * If empty/undefined AND ownerNumber is set, only the owner can chat.
   * If set, these numbers can also message Nova and get replies.
   * Format: country code + number, e.g. "2348012345678"
   */
  allowedNumbers?: string[];
  /** If true, the connected WhatsApp is the user's own number (not a separate bot number) */
  isOwnNumber?: boolean;
  /** Prefix for agent messages when using own number (default: "Nova:") */
  messagePrefix?: string;
}

export interface WhatsAppChannelStatus {
  enabled: boolean;
  running: boolean;
  connected: boolean;
  ownerNumber?: string;
  isOwnNumber: boolean;
  lastError?: string;
  lastErrorAt?: string;
}

const WA_MAX_MESSAGE = 4000;

export class WhatsAppChannel {
  private running = false;
  private connected = false;
  private client: any = null;
  private lastError: string | undefined;
  private lastErrorAt: string | undefined;
  private messagePrefix: string;

  constructor(
    private readonly config: WhatsAppChannelConfig,
    private readonly chatService: ChatService,
  ) {
    this.messagePrefix = config.messagePrefix || "Nova:";
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log(
        JSON.stringify({
          type: "whatsapp_channel",
          status: "disabled",
        }),
      );
      return;
    }

    this.running = true;

    try {
      const wwjs = await import("whatsapp-web.js");
      // whatsapp-web.js is CJS — handle both ESM interop shapes
      const mod = (wwjs as any).default || wwjs;
      const WAClient = mod.Client;
      const WALocalAuth = mod.LocalAuth;

      const authPath = join(homedir(), ".nova", "whatsapp-auth");

      const browserPath = resolveBrowserPath();
      this.client = new WAClient({
        authStrategy: new WALocalAuth({ dataPath: authPath }),
        puppeteer: {
          headless: true,
          ...(browserPath ? { executablePath: browserPath } : {}),
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
          ],
        },
      });

      this.client.on("qr", (_qr: string) => {
        // QR should have been handled during `nova whatsapp setup`.
        // If we get here, the saved session expired.
        console.log(
          JSON.stringify({
            type: "whatsapp_channel",
            status: "needs_reauth",
            message:
              "WhatsApp session expired. Run `nova whatsapp setup` to reconnect.",
          }),
        );
      });

      this.client.on("ready", () => {
        this.connected = true;
        console.log(
          JSON.stringify({
            type: "whatsapp_channel",
            status: "connected",
            is_own_number: this.config.isOwnNumber,
          }),
        );
      });

      this.client.on("authenticated", () => {
        console.log(
          JSON.stringify({
            type: "whatsapp_channel",
            status: "authenticated",
          }),
        );
      });

      this.client.on("auth_failure", (msg: string) => {
        this.lastError = `Auth failed: ${msg}`;
        this.lastErrorAt = new Date().toISOString();
        console.error(
          JSON.stringify({
            type: "whatsapp_channel",
            status: "auth_failure",
            error: msg,
          }),
        );
      });

      this.client.on("disconnected", (reason: string) => {
        this.connected = false;
        this.lastError = `Disconnected: ${reason}`;
        this.lastErrorAt = new Date().toISOString();
        console.log(
          JSON.stringify({
            type: "whatsapp_channel",
            status: "disconnected",
            reason,
          }),
        );
      });

      this.client.on("message_create", async (msg: any) => {
        if (!this.running) return;
        try {
          await this.handleMessage(msg);
        } catch (error) {
          console.error("whatsapp message handling error:", error);
        }
      });

      await this.client.initialize();
    } catch (error) {
      this.lastError = String((error as any)?.message || error);
      this.lastErrorAt = new Date().toISOString();
      console.error("WhatsApp channel startup error:", error);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // Ignore destroy errors
      }
      this.client = null;
    }
    this.connected = false;
  }

  getStatus(): WhatsAppChannelStatus {
    return {
      enabled: this.config.enabled,
      running: this.running,
      connected: this.connected,
      ownerNumber: this.config.ownerNumber,
      isOwnNumber: this.config.isOwnNumber || false,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
    };
  }

  private async handleMessage(msg: any): Promise<void> {
    // Skip non-text, status broadcasts, and group messages (for now)
    if (msg.type !== "chat") return;
    if (msg.isStatus) return;
    if (msg.from === "status@broadcast") return;

    const text = String(msg.body || "").trim();
    if (!text) return;

    // In own-number mode: Nova's own replies start with the prefix — skip them
    if (this.config.isOwnNumber && text.startsWith(this.messagePrefix)) {
      return;
    }

    // Determine the chat partner number and conversation context
    const fromNumber = String(msg.from || "")
      .replace("@c.us", "")
      .replace("@s.whatsapp.net", "");
    const toNumber = String(msg.to || "")
      .replace("@c.us", "")
      .replace("@s.whatsapp.net", "");
    const isFromMe = Boolean(msg.fromMe);

    if (this.config.isOwnNumber) {
      // Own-number mode:
      // - Messages FROM the owner (fromMe=true): user is talking to Nova → process
      // - Messages TO the owner (fromMe=false): someone messaged user → process if authorized
      if (isFromMe) {
        // Owner sent this message — treat as input to Nova
        // Use the recipient (toNumber) as the conversation partner
        const chatId = toNumber;
        await this.processMessage(msg, text, chatId);
      } else {
        // Someone else messaged the owner
        if (!this.isAuthorized(fromNumber)) {
          console.log(
            JSON.stringify({
              type: "whatsapp_update",
              auth_result: "denied",
              sender: fromNumber,
            }),
          );
          return;
        }
        await this.processMessage(msg, text, fromNumber);
      }
    } else {
      // Bot-number mode: only process incoming messages
      if (isFromMe) return;
      if (!this.isAuthorized(fromNumber)) {
        console.log(
          JSON.stringify({
            type: "whatsapp_update",
            auth_result: "denied",
            sender: fromNumber,
          }),
        );
        return;
      }
      await this.processMessage(msg, text, fromNumber);
    }
  }

  private async processMessage(
    msg: any,
    text: string,
    chatId: string,
  ): Promise<void> {
    // Handle commands
    if (text.toLowerCase() === "/reset") {
      this.chatService.resetHistory(`whatsapp:${chatId}`);
      await this.sendReply(msg, "Conversation reset ✨");
      return;
    }

    const startedAt = performance.now();
    const chat = await msg.getChat();

    // Show typing indicator
    await chat.sendStateTyping();

    const requestId = `whatsapp-${chatId}-${Date.now()}`;

    try {
      const result = await this.chatService.runChatTurn({
        message: text,
        sessionId: `whatsapp:${chatId}`,
        historyKey: `whatsapp:${chatId}`,
        channel: "whatsapp",
        requestId,
      });

      const responseText = String(result.response || "").trim();
      if (!responseText) return;

      await this.sendChunkedReply(msg, chat, responseText);

      // Clear typing
      await chat.clearState();

      console.log(
        JSON.stringify({
          type: "whatsapp_update",
          auth_result: "allowed",
          chat_id: chatId,
          time_total_ms: Number((performance.now() - startedAt).toFixed(1)),
        }),
      );
    } catch (error) {
      console.error("whatsapp response error:", error);
      await chat.clearState();
      await this.sendReply(msg, "Something went wrong, try again in a moment.");
    }
  }

  private isAuthorized(senderNumber: string): boolean {
    // If no owner configured, deny all
    if (!this.config.ownerNumber) return false;

    // Owner is always allowed
    if (senderNumber === this.config.ownerNumber) return true;

    // Check allowed numbers list
    if (this.config.allowedNumbers?.length) {
      return this.config.allowedNumbers.includes(senderNumber);
    }

    return false;
  }

  private async sendReply(msg: any, text: string): Promise<void> {
    const formatted = this.formatMessage(text);
    if (this.config.isOwnNumber) {
      // On own number, send as a new message (not reply) to the same chat
      const chat = await msg.getChat();
      await chat.sendMessage(formatted);
    } else {
      await msg.reply(formatted);
    }
  }

  private async sendChunkedReply(
    msg: any,
    chat: any,
    text: string,
  ): Promise<void> {
    const formatted = this.formatMessage(text);
    const chunks = splitMessage(formatted, WA_MAX_MESSAGE);

    for (const chunk of chunks) {
      if (this.config.isOwnNumber) {
        await chat.sendMessage(chunk);
      } else {
        await msg.reply(chunk);
      }
    }
  }

  private formatMessage(text: string): string {
    if (this.config.isOwnNumber) {
      return `${this.messagePrefix} ${text}`;
    }
    return text;
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx <= 0) {
      // Try space
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx <= 0) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
