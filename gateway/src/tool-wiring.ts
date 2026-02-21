import type { Runtime } from "../../runtime/src/index.js";
import type { Agent } from "../../agent/src/index.js";
import { SkillLoader } from "../../runtime/src/skill-loader.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Register tool schemas from skill directories.
 * This loads the SKILL.md manifests and tool definition arrays into the tool registry.
 */
export async function wireSkillTools(runtime: Runtime): Promise<void> {
  const loader = new SkillLoader();
  const projectRoot = path.resolve(__dirname, "../../");
  const dirs = SkillLoader.getDefaultDirs(projectRoot);
  const manifests = loader.buildIndex(dirs);

  for (const manifest of manifests) {
    try {
      const tools = await loader.loadSkill(manifest.name);
      const registry = runtime.getTools();
      for (const tool of tools) {
        registry.register(tool);
      }
      console.log(`📦 Loaded skill "${manifest.name}" (${tools.length} tools)`);
    } catch (err: any) {
      // Skills without a tools.ts are index-only — skip silently
      if (!err.message?.includes("no tools module")) {
        console.warn(
          `⚠️ Failed to load skill "${manifest.name}": ${err.message}`,
        );
      }
    }
  }
}

/**
 * Wire the browse and scrape tools (they need the Agent reference for vision).
 */
export async function wireBrowseTools(
  runtime: Runtime,
  agent: Agent,
): Promise<void> {
  const { browse } = await import("../../runtime/src/web-agent/browse-tool.js");
  const { scrape } = await import("../../runtime/src/web-agent/scrape-tool.js");

  const browseTool = runtime.getTools().get("browse");
  if (browseTool) {
    browseTool.execute = async (params: any) => {
      const url = String(params.url || "").trim();
      if (!url) throw new Error("Missing url parameter");
      return await browse(url, agent);
    };
    console.log("🌐 Wired browse tool");
  }

  const scrapeTool = runtime.getTools().get("scrape");
  if (scrapeTool) {
    scrapeTool.execute = async (params: any) => {
      const url = String(params.url || "").trim();
      if (!url) throw new Error("Missing url parameter");
      return await scrape(url);
    };
    console.log("🌐 Wired scrape tool");
  }
}

/**
 * Wire all Google Workspace tools (Gmail, Calendar, Drive).
 * Reads credentials from environment variables.
 * Silently skips if credentials are not configured.
 */
export async function wireGoogleWorkspaceTools(
  runtime: Runtime,
): Promise<void> {
  const googleConfigured =
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN;

  if (!googleConfigured) {
    console.log(
      "ℹ️  Google tools registered but not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)",
    );
    return;
  }

  try {
    const { CalendarClient } =
      await import("../../runtime/src/google/calendar-client.js");
    const { DriveClient } =
      await import("../../runtime/src/google/drive-client.js");
    const { GmailClient: GoogleGmailClient } =
      await import("../../runtime/src/google/gmail-client.js");

    const googleCreds = {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
    };

    const gmail = new GoogleGmailClient(googleCreds);
    const calendar = new CalendarClient(googleCreds);
    const drive = new DriveClient(googleCreds);
    const tools = runtime.getTools();

    // Helper to wire a tool in one line
    const wire = (
      name: string,
      handler: (params: any) => Promise<unknown>,
    ): void => {
      const tool = tools.get(name);
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

    console.log("🔗 Wired 14 Google Workspace tools (Gmail, Calendar, Drive)");
  } catch (googleError) {
    console.warn("⚠️ Google tools not configured:", googleError);
  }
}
