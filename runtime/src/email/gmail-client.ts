import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import type { gmail_v1 } from "googleapis";

/**
 * Gmail API credentials
 */
export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * Email message structure
 */
export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  snippet: string;
  body: string;
  date: Date;
  labels: string[];
  isUnread: boolean;
}

/**
 * Gmail API client for full email access
 */
export class GmailClient {
  private oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail;
  private profileEmail?: string;

  constructor(credentials: GmailCredentials) {
    this.oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      "http://localhost:18790/oauth/callback",
    );

    this.oauth2Client.setCredentials({
      refresh_token: credentials.refreshToken,
    });

    this.gmail = google.gmail({ version: "v1", auth: this.oauth2Client });
  }

  /**
   * Get the authenticated user's email address (cached)
   */
  async getProfileEmail(): Promise<string | null> {
    if (this.profileEmail) return this.profileEmail;

    const response = await this.gmail.users.getProfile({ userId: "me" });
    const email = response.data.emailAddress || null;
    if (email) this.profileEmail = email;
    return email;
  }

  /**
   * List messages from inbox
   */
  async listMessages(params: {
    maxResults?: number;
    query?: string;
  }): Promise<EmailMessage[]> {
    const { maxResults = 10, query } = params;

    const response = await this.gmail.users.messages.list({
      userId: "me",
      maxResults,
      q: query,
    });

    const messages = response.data.messages || [];
    const fullMessages: EmailMessage[] = [];

    for (const msg of messages) {
      if (msg.id) {
        const fullMsg = await this.getMessage(msg.id);
        if (fullMsg) fullMessages.push(fullMsg);
      }
    }

    return fullMessages;
  }

  /**
   * Get full message details
   */
  private async getMessage(messageId: string): Promise<EmailMessage | null> {
    const response = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const msg = response.data;
    const headers = msg.payload?.headers || [];

    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value || "";

    // Extract body
    let body = "";
    if (msg.payload?.parts) {
      const textPart = msg.payload.parts.find(
        (p) => p.mimeType === "text/plain",
      );
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
      }
    } else if (msg.payload?.body?.data) {
      body = Buffer.from(msg.payload.body.data, "base64").toString("utf-8");
    }

    return {
      id: msg.id!,
      threadId: msg.threadId!,
      from: getHeader("from"),
      to: getHeader("to")
        .split(",")
        .map((s) => s.trim()),
      subject: getHeader("subject"),
      snippet: msg.snippet || "",
      body: body || msg.snippet || "",
      date: new Date(parseInt(msg.internalDate || "0")),
      labels: msg.labelIds || [],
      isUnread: msg.labelIds?.includes("UNREAD") || false,
    };
  }

  /**
   * Send a new email
   */
  async sendEmail(params: {
    to: string[];
    subject: string;
    body: string;
    html?: string;
  }): Promise<{ messageId: string }> {
    const { to, subject, body, html } = params;

    // Build email in RFC 2822 format
    const email = [
      `To: ${to.join(", ")}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      html
        ? 'Content-Type: text/html; charset="UTF-8"'
        : 'Content-Type: text/plain; charset="UTF-8"',
      "",
      html || body,
    ].join("\r\n");

    const encodedEmail = Buffer.from(email)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedEmail,
      },
    });

    return { messageId: response.data.id! };
  }

  /**
   * Reply to an email thread
   */
  async replyToEmail(params: {
    threadId: string;
    body: string;
    html?: string;
  }): Promise<{ messageId: string }> {
    const { threadId, body, html } = params;

    // Get original message to extract recipient and subject
    const thread = await this.gmail.users.threads.get({
      userId: "me",
      id: threadId,
    });

    const firstMessage = thread.data.messages?.[0];
    const headers = firstMessage?.payload?.headers || [];

    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value || "";

    const originalFrom = getHeader("from");
    const originalSubject = getHeader("subject");
    const replySubject = originalSubject.startsWith("Re:")
      ? originalSubject
      : `Re: ${originalSubject}`;

    // Extract email from "Name <email>" format
    const replyTo = originalFrom.match(/<(.+?)>$/)?.[1] || originalFrom.trim();

    // Build reply
    const email = [
      `To: ${replyTo}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${firstMessage?.id}`,
      `References: ${firstMessage?.id}`,
      "MIME-Version: 1.0",
      html
        ? 'Content-Type: text/html; charset="UTF-8"'
        : 'Content-Type: text/plain; charset="UTF-8"',
      "",
      html || body,
    ].join("\r\n");

    const encodedEmail = Buffer.from(email)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedEmail,
        threadId: threadId,
      },
    });

    return { messageId: response.data.id! };
  }

  /**
   * Search emails with Gmail query syntax
   */
  async search(query: string): Promise<EmailMessage[]> {
    return this.listMessages({ query, maxResults: 20 });
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        removeLabelIds: ["UNREAD"],
      },
    });
  }

  /**
   * Mark message as unread
   */
  async markAsUnread(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        addLabelIds: ["UNREAD"],
      },
    });
  }

  /**
   * Archive message (remove from inbox)
   */
  async archive(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        removeLabelIds: ["INBOX"],
      },
    });
  }

  /**
   * Delete message (move to trash)
   */
  async delete(messageId: string): Promise<void> {
    await this.gmail.users.messages.trash({
      userId: "me",
      id: messageId,
    });
  }

  /**
   * Check if client is properly configured
   */
  static isConfigured(): boolean {
    return !!(
      process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN
    );
  }
}
