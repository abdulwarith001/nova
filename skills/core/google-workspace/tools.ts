/**
 * Google Workspace skill — tool definitions.
 *
 * These are the schema-only registrations. The actual wiring of execute()
 * handlers happens in gateway/src/tool-wiring.ts at startup.
 */

import type { ToolDefinition } from "../../../runtime/src/tools.js";

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
