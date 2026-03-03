/**
 * Google Workspace skill — self-contained tool definitions with execute handlers.
 *
 * Exports wireTools() which registers all 14 tools and wires their
 * execute handlers to the Google API clients. Silently skips if
 * Google credentials are not configured.
 */

import type { Runtime } from "../../../runtime/src/index.js";
import type { ToolDefinition } from "../../../runtime/src/tools.js";

/**
 * Register all Google Workspace tools with execute handlers.
 * Skips silently if credentials are not configured.
 */
export async function wireTools(runtime: Runtime): Promise<void> {
  const googleConfigured =
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN;

  // Always register schemas so the LLM knows about them
  const registry = runtime.getTools();
  for (const tool of tools) {
    registry.register(tool);
  }

  if (!googleConfigured) {
    console.log(
      "ℹ️  Google tools registered but not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)",
    );
    return;
  }

  // Wire execute handlers when credentials are available
  try {
    const { CalendarClient } =
      await import("../../../runtime/src/google/calendar-client.js");
    const { DriveClient } =
      await import("../../../runtime/src/google/drive-client.js");
    const { GmailClient: GoogleGmailClient } =
      await import("../../../runtime/src/google/gmail-client.js");

    const googleCreds = {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
    };

    const gmail = new GoogleGmailClient(googleCreds);
    const calendar = new CalendarClient(googleCreds);
    const drive = new DriveClient(googleCreds);

    const wire = (
      name: string,
      handler: (params: any) => Promise<unknown>,
    ): void => {
      const tool = registry.get(name);
      if (tool) tool.execute = handler;
    };

    // Gmail
    wire("gmail_list", async (p) => {
      const messages = await gmail.listMessages({
        maxResults: p.maxResults,
        query: p.query,
      });
      return { count: messages.length, messages };
    });
    wire("gmail_read", async (p) => gmail.readMessage(p.messageId));
    wire("gmail_send", async (p) =>
      gmail.sendEmail({ to: p.to, subject: p.subject, body: p.body }),
    );
    wire("gmail_reply", async (p) =>
      gmail.replyToEmail({ threadId: p.threadId, body: p.body }),
    );
    wire("gmail_search", async (p) => {
      const messages = await gmail.search(p.query);
      return { count: messages.length, messages };
    });
    wire("gmail_draft", async (p) =>
      gmail.createDraft({ to: p.to, subject: p.subject, body: p.body }),
    );

    // Calendar
    wire("calendar_list", async (p) => {
      const events = await calendar.listEvents({
        timeMin: p.timeMin,
        timeMax: p.timeMax,
        maxResults: p.maxResults,
      });
      return { count: events.length, events };
    });
    wire("calendar_create", async (p) =>
      calendar.createEvent({
        summary: p.summary,
        start: p.start,
        end: p.end,
        description: p.description,
        location: p.location,
        attendees: p.attendees,
      }),
    );
    wire("calendar_search", async (p) => {
      const events = await calendar.searchEvents(p.query);
      return { count: events.length, events };
    });

    // Drive
    wire("drive_list", async (p) => {
      const files = await drive.listFiles({ maxResults: p.maxResults });
      return { count: files.length, files };
    });
    wire("drive_search", async (p) => {
      const files = await drive.searchFiles(p.query);
      return { count: files.length, files };
    });
    wire("drive_read", async (p) => drive.readFile(p.fileId));
    wire("drive_upload", async (p) =>
      drive.uploadFile({
        name: p.name,
        content: Buffer.from(p.content, "utf-8"),
        mimeType: p.mimeType || "text/plain",
        folderId: p.folderId,
      }),
    );
    wire("drive_create_pdf", async (p) =>
      drive.createPdf({
        title: p.title,
        content: p.content,
        folderId: p.folderId,
      }),
    );

    console.log(
      "🔗 Loaded google-workspace skill (14 tools, credentials configured)",
    );
  } catch (googleError) {
    console.warn("⚠️ Google tools not configured:", googleError);
  }
}

// Schema-only definitions for backward compatibility and SkillLoader.loadSkill()
const tools: ToolDefinition[] = [
  {
    name: "gmail_list",
    description:
      "List recent emails from Gmail inbox. Returns subject, sender, date, and read status.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        maxResults: {
          type: "number",
          description: "Max emails to return (default 10)",
        },
        query: {
          type: "string",
          description:
            "Optional Gmail search query (e.g. 'is:unread', 'from:boss@company.com')",
        },
      },
    },
    permissions: ["google"],
  },
  {
    name: "gmail_read",
    description: "Read the full content of a specific email by its message ID.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The email message ID to read",
        },
      },
      required: ["messageId"],
    },
    permissions: ["google"],
  },
  {
    name: "gmail_send",
    description: "Send a new email. Composes and sends immediately.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "Recipient email addresses",
        },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body text" },
      },
      required: ["to", "subject", "body"],
    },
    permissions: ["google"],
  },
  {
    name: "gmail_reply",
    description: "Reply to an existing email thread.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          description: "The thread ID to reply to",
        },
        body: { type: "string", description: "Reply body text" },
      },
      required: ["threadId", "body"],
    },
    permissions: ["google"],
  },
  {
    name: "gmail_search",
    description:
      "Search emails using Gmail query syntax (e.g. 'from:john subject:meeting', 'has:attachment', 'newer_than:7d').",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query" },
      },
      required: ["query"],
    },
    permissions: ["google"],
  },
  {
    name: "gmail_draft",
    description: "Create an email draft without sending it.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "Recipient email addresses",
        },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Draft body text" },
      },
      required: ["to", "subject", "body"],
    },
    permissions: ["google"],
  },
  {
    name: "calendar_list",
    description: "List upcoming calendar events. Defaults to the next 7 days.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        timeMin: {
          type: "string",
          description: "Start time ISO string (default: now)",
        },
        timeMax: {
          type: "string",
          description: "End time ISO string (default: 7 days from now)",
        },
        maxResults: {
          type: "number",
          description: "Max events (default 15)",
        },
      },
    },
    permissions: ["google"],
  },
  {
    name: "calendar_create",
    description: "Create a new calendar event.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title" },
        start: { type: "string", description: "Start datetime ISO string" },
        end: { type: "string", description: "End datetime ISO string" },
        description: {
          type: "string",
          description: "Optional event description",
        },
        location: { type: "string", description: "Optional location" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Optional attendee emails",
        },
      },
      required: ["summary", "start", "end"],
    },
    permissions: ["google"],
  },
  {
    name: "calendar_search",
    description:
      "Search calendar events by text (searches past 6 months and next 6 months).",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text" },
      },
      required: ["query"],
    },
    permissions: ["google"],
  },
  {
    name: "drive_list",
    description:
      "List recent files from Google Drive, sorted by last modified.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        maxResults: { type: "number", description: "Max files (default 15)" },
      },
    },
    permissions: ["google"],
  },
  {
    name: "drive_search",
    description: "Search Google Drive files by name or content.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (matches file name and content)",
        },
      },
      required: ["query"],
    },
    permissions: ["google"],
  },
  {
    name: "drive_read",
    description:
      "Read the text content of a Google Drive file. Exports Google Docs as plain text, Sheets as CSV.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "The Drive file ID to read" },
      },
      required: ["fileId"],
    },
    permissions: ["google"],
  },
  {
    name: "drive_upload",
    description: "Upload a text file to Google Drive.",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "File name (e.g. 'notes.txt')" },
        content: { type: "string", description: "Text content of the file" },
        mimeType: {
          type: "string",
          description: "MIME type (default: text/plain)",
        },
        folderId: { type: "string", description: "Optional Drive folder ID" },
      },
      required: ["name", "content"],
    },
    permissions: ["google"],
  },
  {
    name: "drive_create_pdf",
    description:
      "Create a PDF document and save it to Google Drive. Supports markdown-like headings (# and ##).",
    category: "google",
    parametersSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "PDF title (also used as filename)",
        },
        content: {
          type: "string",
          description:
            "PDF body content. Use # for headings, ## for subheadings.",
        },
        folderId: { type: "string", description: "Optional Drive folder ID" },
      },
      required: ["title", "content"],
    },
    permissions: ["google"],
  },
];

export default tools;
