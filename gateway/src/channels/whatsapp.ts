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
  /** The user's display name — used by the agent when referring to the user */
  ownerName?: string;
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
  /** Tracks last owner message timestamp per chat — used for first-message proactive hook */
  private lastOwnerMessageAt = new Map<string, number>();

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

  /**
   * Resolve the sender's display name from the WhatsApp contact.
   * Falls back through: saved contact name → WhatsApp profile name → phone number.
   */
  private async resolveSenderName(msg: any): Promise<string> {
    try {
      const contact = await msg.getContact();
      return (
        contact?.name ||
        contact?.pushname ||
        contact?.shortName ||
        contact?.number ||
        "Unknown"
      );
    } catch {
      return "Unknown";
    }
  }

  /**
   * Resolve sender contact info (name + phone number) from the WhatsApp contact.
   * WhatsApp may use LIDs (@lid) in msg.from instead of phone numbers,
   * so we must get the real number from the contact object.
   */
  private async resolveContact(
    msg: any,
  ): Promise<{ name: string; number: string }> {
    try {
      const contact = await msg.getContact();
      const name =
        contact?.name ||
        contact?.pushname ||
        contact?.shortName ||
        contact?.number ||
        "Unknown";
      // contact.number is the actual phone number, even when msg.from is a LID
      const number =
        contact?.number ||
        String(msg.from || "")
          .replace("@c.us", "")
          .replace("@s.whatsapp.net", "")
          .replace("@lid", "");
      return { name, number };
    } catch {
      // Fallback: parse from msg.from
      const fallback = String(msg.from || "")
        .replace("@c.us", "")
        .replace("@s.whatsapp.net", "")
        .replace("@lid", "");
      return { name: "Unknown", number: fallback };
    }
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
    const ownerName = this.config.ownerName || "the user";

    if (this.config.isOwnNumber) {
      // Own-number mode:
      // - Messages FROM the owner (fromMe=true): user is talking to Nova → process
      // - Messages TO the owner (fromMe=false): someone messaged user → process if authorized
      if (isFromMe) {
        // Owner sent this message — process as input to Nova
        const chatId = toNumber;
        await this.processMessage(msg, text, chatId, {
          senderName: ownerName,
          senderNumber: this.config.ownerNumber || fromNumber,
          isOwner: true,
        });
      } else {
        // Someone else messaged the owner — in own-number mode, Nova does
        // not respond to anyone else. Silently ignore.
        return;
      }
    } else {
      // Bot-number mode: only process incoming messages
      if (isFromMe) return;

      // Resolve sender info — WhatsApp may use LIDs (@lid) instead of phone
      // numbers in msg.from, so we must get the real number from the contact.
      const contact = await this.resolveContact(msg);
      const senderName = contact.name;
      const senderPhoneNumber = contact.number;
      const isOwner =
        senderPhoneNumber.replace(/\D/g, "") ===
        (this.config.ownerNumber || "").replace(/\D/g, "");

      console.log(
        JSON.stringify({
          type: "whatsapp_incoming",
          from_raw: fromNumber,
          resolved_number: senderPhoneNumber,
          configured_owner: this.config.ownerNumber,
          is_owner: isOwner,
          authorized: this.isAuthorized(senderPhoneNumber),
        }),
      );

      if (!this.isAuthorized(senderPhoneNumber)) {
        // Politely respond and notify the owner
        await this.sendReply(
          msg,
          `Hi ${senderName}, ${ownerName} is not available right now. I'm Nova, their AI assistant. I'll let them know you reached out.`,
        );
        await this.notifyOwner(senderName, senderPhoneNumber, text);
        console.log(
          JSON.stringify({
            type: "whatsapp_update",
            auth_result: "denied_with_reply",
            sender: senderPhoneNumber,
            sender_name: senderName,
          }),
        );
        return;
      }
      await this.processMessage(msg, text, senderPhoneNumber, {
        senderName,
        senderNumber: senderPhoneNumber,
        isOwner,
      });
    }
  }

  private async processMessage(
    msg: any,
    text: string,
    chatId: string,
    senderInfo: {
      senderName: string;
      senderNumber: string;
      isOwner: boolean;
    },
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

    // Build sender context for the agent
    const ownerName = this.config.ownerName || "the user";
    let senderContext: string;

    if (senderInfo.isOwner) {
      const timeOfDay = this.getTimeOfDay();
      const chatKey = `whatsapp:${chatId}`;
      const lastMsg = this.lastOwnerMessageAt.get(chatKey);
      const gapHours = lastMsg
        ? (Date.now() - lastMsg) / (1000 * 60 * 60)
        : Infinity;
      const isFirstMessage = gapHours > 1;

      const parts: string[] = [
        `You are Nova, ${ownerName}'s personal AI assistant.`,
        `The person messaging you right now IS ${ownerName} — your owner. You know them.`,
        `It is currently ${timeOfDay}. Greet them accordingly (e.g. "Good morning ${ownerName}!" or "Hey ${ownerName}, evening!").`,
        `Be proactive: suggest helpful things, remind them of things they mentioned before, offer ideas.`,
        `You have full access to your conversation history with ${ownerName} and should use it.`,
        `You have access to tools: Gmail, Google Calendar, Google Drive, and web search. Proactively offer to use them (e.g. "Want me to check your calendar?" or "I can search that for you").`,
      ];

      if (isFirstMessage) {
        parts.push(
          `This is the start of a new conversation or it's been a while since ${ownerName} last messaged. ` +
            `Be extra proactive: suggest checking their calendar, offer a quick summary, or bring up something useful based on the time of day.`,
        );
      }

      senderContext = parts.join(" ");
    } else {
      senderContext =
        `You are Nova, ${ownerName}'s personal AI assistant, responding on their WhatsApp. ` +
        `You are NOT ${ownerName} — never pretend to be them. Clearly identify yourself as Nova, their AI assistant. ` +
        `This message is from ${senderInfo.senderName} (${senderInfo.senderNumber}), who is authorized to chat with you. ` +
        `PRIVACY RULES (CRITICAL — never violate these): ` +
        `- NEVER share ${ownerName}'s personal information, memories, conversation history, schedule, or any private data with anyone other than ${ownerName}. ` +
        `- NEVER reveal what ${ownerName} has told you in past conversations. ` +
        `- If asked about ${ownerName}'s personal details, politely decline and suggest they ask ${ownerName} directly. ` +
        `Respond helpfully and politely on behalf of ${ownerName}. If you need more information from ${ownerName} to answer properly, ` +
        `let ${senderInfo.senderName} know that you'll check with ${ownerName} and get back to them. ` +
        `Keep responses concise — this is WhatsApp.`;
    }

    try {
      const result = await this.chatService.runChatTurn({
        message: text,
        sessionId: `whatsapp:${chatId}`,
        historyKey: `whatsapp:${chatId}`,
        channel: "whatsapp",
        senderContext,
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
          sender_name: senderInfo.senderName,
          is_owner: senderInfo.isOwner,
          time_total_ms: Number((performance.now() - startedAt).toFixed(1)),
        }),
      );

      // Track last owner message time for first-message proactive hook
      if (senderInfo.isOwner) {
        this.lastOwnerMessageAt.set(`whatsapp:${chatId}`, Date.now());
      }
    } catch (error) {
      console.error("whatsapp response error:", error);
      await chat.clearState();
      await this.sendReply(msg, "Something went wrong, try again in a moment.");
    }
  }

  private getTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    if (hour >= 17 && hour < 21) return "evening";
    return "night";
  }

  private isAuthorized(senderNumber: string): boolean {
    // If no owner configured, deny all
    if (!this.config.ownerNumber) return false;

    // Normalize both numbers to digits-only for comparison
    // (WhatsApp Business can deliver numbers in slightly different formats)
    const normalize = (n: string) => n.replace(/\D/g, "");
    const normalized = normalize(senderNumber);
    const ownerNormalized = normalize(this.config.ownerNumber);

    // Owner is always allowed
    if (normalized === ownerNormalized) return true;

    // Check allowed numbers list
    if (this.config.allowedNumbers?.length) {
      return this.config.allowedNumbers.some(
        (n) => normalize(n) === normalized,
      );
    }

    return false;
  }

  /**
   * Notify the owner about an incoming message from someone.
   * Sends a summary directly to the owner's WhatsApp chat.
   */
  private async notifyOwner(
    senderName: string,
    senderNumber: string,
    messagePreview: string,
  ): Promise<void> {
    if (!this.config.ownerNumber || !this.client) return;

    const ownerChatId = `${this.config.ownerNumber}@c.us`;
    const preview =
      messagePreview.length > 200
        ? messagePreview.slice(0, 200) + "..."
        : messagePreview;

    const notification =
      `📩 New message from ${senderName} (${senderNumber}):\n` +
      `"${preview}"\n\n` +
      `_They were told you're not available. Reply to them directly if needed._`;

    try {
      await this.client.sendMessage(ownerChatId, notification);
    } catch (error) {
      console.error("Failed to notify owner:", error);
    }
  }

  /**
   * Send a message directly to a specific chat ID.
   */
  private async sendDirectMessage(chatId: string, text: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.sendMessage(chatId, text);
    } catch (error) {
      console.error("Failed to send direct message:", error);
    }
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
