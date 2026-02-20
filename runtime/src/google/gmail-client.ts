import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import type { gmail_v1 } from "googleapis";

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

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
 * Gmail API client for Nova.
 * Handles reading, sending, drafting, searching, and managing emails.
 */
export class GmailClient {
  private oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail;
  private profileEmail?: string;

  constructor(credentials: GoogleCredentials) {
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

  async getProfileEmail(): Promise<string | null> {
    if (this.profileEmail) return this.profileEmail;
    const response = await this.gmail.users.getProfile({ userId: "me" });
    const email = response.data.emailAddress || null;
    if (email) this.profileEmail = email;
    return email;
  }

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
    const results: EmailMessage[] = [];
    for (const msg of messages) {
      if (msg.id) {
        const full = await this.getFullMessage(msg.id);
        if (full) results.push(full);
      }
    }
    return results;
  }

  async readMessage(messageId: string): Promise<EmailMessage | null> {
    return this.getFullMessage(messageId);
  }

  async sendEmail(params: {
    to: string[];
    subject: string;
    body: string;
    html?: string;
  }): Promise<{ messageId: string }> {
    const fromEmail = await this.getProfileEmail();
    const email = [
      fromEmail ? `From: ${fromEmail}` : "",
      `To: ${params.to.join(", ")}`,
      `Subject: ${params.subject}`,
      "MIME-Version: 1.0",
      params.html
        ? 'Content-Type: text/html; charset="UTF-8"'
        : 'Content-Type: text/plain; charset="UTF-8"',
      "",
      params.html || params.body,
    ]
      .filter(Boolean)
      .join("\r\n");

    const encodedEmail = Buffer.from(email)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedEmail },
    });
    return { messageId: response.data.id! };
  }

  async replyToEmail(params: {
    threadId: string;
    body: string;
    html?: string;
  }): Promise<{ messageId: string }> {
    const thread = await this.gmail.users.threads.get({
      userId: "me",
      id: params.threadId,
    });
    const first = thread.data.messages?.[0];
    const headers = first?.payload?.headers || [];
    const getH = (n: string) =>
      headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ||
      "";

    const originalFrom = getH("from");
    const replyTo = originalFrom.match(/<(.+?)>$/)?.[1] || originalFrom.trim();
    const subject = getH("subject");
    const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

    const email = [
      `To: ${replyTo}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${first?.id}`,
      `References: ${first?.id}`,
      "MIME-Version: 1.0",
      params.html
        ? 'Content-Type: text/html; charset="UTF-8"'
        : 'Content-Type: text/plain; charset="UTF-8"',
      "",
      params.html || params.body,
    ].join("\r\n");

    const encodedEmail = Buffer.from(email)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedEmail, threadId: params.threadId },
    });
    return { messageId: response.data.id! };
  }

  async createDraft(params: {
    to: string[];
    subject: string;
    body: string;
  }): Promise<{ draftId: string }> {
    const fromEmail = await this.getProfileEmail();
    const email = [
      fromEmail ? `From: ${fromEmail}` : "",
      `To: ${params.to.join(", ")}`,
      `Subject: ${params.subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      params.body,
    ]
      .filter(Boolean)
      .join("\r\n");

    const encodedEmail = Buffer.from(email)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await this.gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw: encodedEmail },
      },
    });
    return { draftId: response.data.id! };
  }

  async search(query: string): Promise<EmailMessage[]> {
    return this.listMessages({ query, maxResults: 15 });
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
  }

  async archive(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: ["INBOX"] },
    });
  }

  async trash(messageId: string): Promise<void> {
    await this.gmail.users.messages.trash({ userId: "me", id: messageId });
  }

  private async getFullMessage(
    messageId: string,
  ): Promise<EmailMessage | null> {
    const response = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
    const msg = response.data;
    const headers = msg.payload?.headers || [];
    const getH = (n: string) =>
      headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ||
      "";

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
      from: getH("from"),
      to: getH("to")
        .split(",")
        .map((s) => s.trim()),
      subject: getH("subject"),
      snippet: msg.snippet || "",
      body: body || msg.snippet || "",
      date: new Date(parseInt(msg.internalDate || "0")),
      labels: msg.labelIds || [],
      isUnread: msg.labelIds?.includes("UNREAD") || false,
    };
  }

  static isConfigured(): boolean {
    return !!(
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN
    );
  }
}
