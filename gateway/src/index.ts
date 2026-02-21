import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { Agent } from "../../agent/src/index.js";
import { Runtime } from "../../runtime/src/index.js";
import path from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { config } from "dotenv";
import { ResearchOrchestrator } from "./research-orchestrator.js";
import { ChatService } from "./chat-service.js";
import { TelegramChannel } from "./channels/telegram.js";
import { WhatsAppChannel } from "./channels/whatsapp.js";

// Load environment variables from ~/.nova/.env
config({ path: path.join(homedir(), ".nova", ".env") });

// Default to Lagos time if not explicitly set
if (!process.env.TZ) {
  process.env.TZ = "Africa/Lagos";
}

function loadGatewayConfig(): {
  notificationEmail?: string;
  telegramEnabled?: boolean;
  telegramOwnerUserId?: number;
  telegramOwnerChatId?: number;
} {
  const configPath = path.join(homedir(), ".nova", "config.json");
  if (!existsSync(configPath)) return {};
  try {
    const configJson = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    return {
      notificationEmail:
        typeof configJson.notificationEmail === "string"
          ? configJson.notificationEmail
          : undefined,
      telegramEnabled:
        typeof configJson.telegramEnabled === "boolean"
          ? configJson.telegramEnabled
          : undefined,
      telegramOwnerUserId:
        typeof configJson.telegramOwnerUserId === "number"
          ? configJson.telegramOwnerUserId
          : undefined,
      telegramOwnerChatId:
        typeof configJson.telegramOwnerChatId === "number"
          ? configJson.telegramOwnerChatId
          : undefined,
    };
  } catch {
    return {};
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function start() {
  const app = Fastify({
    logger: true,
  });

  // Initialize Nova Runtime with full tool support
  console.log("🔧 Initializing Nova Runtime...");
  const gatewayConfig = loadGatewayConfig();
  const runtime = await Runtime.create({
    memoryPath: path.join(homedir(), ".nova", "memory.db"),
    security: {
      sandboxMode: "none",
      allowedTools: ["*"],
      deniedTools: [],
    },
    executor: {
      maxParallel: 4,
      defaultTimeoutMs: 30000,
    },
    agent: {
      provider: (process.env.DEFAULT_PROVIDER as any) || "openai",
      model: process.env.DEFAULT_MODEL || "gpt-4o-mini",
      apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
    },
  });
  console.log("✅ Runtime initialized");

  // Initialize Agent for chat
  const agentConfig = {
    provider: (process.env.DEFAULT_PROVIDER as any) || "openai",
    model: process.env.DEFAULT_MODEL || "gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
  };

  const chatSystemPrompt =
    "You are Nova, a helpful AI assistant with access to various tools to help users accomplish tasks.\n\n" +
    "Decision-making:\n" +
    "- First, silently reason about the user's intent, required inputs, and whether a tool is needed.\n" +
    "- Then do ONE of the following: call the correct tool, ask a focused follow-up question, or respond normally.\n" +
    "- Do not reveal your internal reasoning. Keep responses concise and user-facing.\n\n" +
    "Tool selection:\n" +
    "- Use tools when they are needed to complete the task (e.g., web search, email).\n" +
    "- Do not call a tool if required inputs are missing; ask for the missing input instead.\n";

  const agent = new Agent(agentConfig, chatSystemPrompt);

  // Get tools from Runtime in agent-compatible format
  const allTools = runtime.getToolsForAgent();
  console.log(`📋 Loaded ${allTools.length} tools`);

  // === Wire browse & scrape tools (need Agent reference) ===
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

  // === Wire Google Workspace tools ===
  const { CalendarClient } =
    await import("../../runtime/src/google/calendar-client.js");
  const { DriveClient } =
    await import("../../runtime/src/google/drive-client.js");
  const { GmailClient: GoogleGmailClient } =
    await import("../../runtime/src/google/gmail-client.js");

  const googleConfigured =
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN;

  if (googleConfigured) {
    try {
      // GOOGLE_* credentials are stored as plain text by `nova google setup`
      // (unlike GMAIL_* which are encrypted by `nova config email-setup`)
      const googleCreds = {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
      };

      const googleGmail = new GoogleGmailClient(googleCreds);
      const calendarClient = new CalendarClient(googleCreds);
      const driveClient = new DriveClient(googleCreds);

      // Gmail tools
      const gmailListTool = runtime.getTools().get("gmail_list");
      if (gmailListTool) {
        gmailListTool.execute = async (params: any) => {
          const messages = await googleGmail.listMessages({
            maxResults: params.maxResults,
            query: params.query,
          });
          return { count: messages.length, messages };
        };
      }

      const gmailReadTool = runtime.getTools().get("gmail_read");
      if (gmailReadTool) {
        gmailReadTool.execute = async (params: any) => {
          return await googleGmail.readMessage(params.messageId);
        };
      }

      const gmailSendTool = runtime.getTools().get("gmail_send");
      if (gmailSendTool) {
        gmailSendTool.execute = async (params: any) => {
          return await googleGmail.sendEmail({
            to: params.to,
            subject: params.subject,
            body: params.body,
          });
        };
      }

      const gmailReplyTool = runtime.getTools().get("gmail_reply");
      if (gmailReplyTool) {
        gmailReplyTool.execute = async (params: any) => {
          return await googleGmail.replyToEmail({
            threadId: params.threadId,
            body: params.body,
          });
        };
      }

      const gmailSearchTool = runtime.getTools().get("gmail_search");
      if (gmailSearchTool) {
        gmailSearchTool.execute = async (params: any) => {
          const messages = await googleGmail.search(params.query);
          return { count: messages.length, messages };
        };
      }

      const gmailDraftTool = runtime.getTools().get("gmail_draft");
      if (gmailDraftTool) {
        gmailDraftTool.execute = async (params: any) => {
          return await googleGmail.createDraft({
            to: params.to,
            subject: params.subject,
            body: params.body,
          });
        };
      }

      // Calendar tools
      const calListTool = runtime.getTools().get("calendar_list");
      if (calListTool) {
        calListTool.execute = async (params: any) => {
          const events = await calendarClient.listEvents({
            timeMin: params.timeMin,
            timeMax: params.timeMax,
            maxResults: params.maxResults,
          });
          return { count: events.length, events };
        };
      }

      const calCreateTool = runtime.getTools().get("calendar_create");
      if (calCreateTool) {
        calCreateTool.execute = async (params: any) => {
          return await calendarClient.createEvent({
            summary: params.summary,
            start: params.start,
            end: params.end,
            description: params.description,
            location: params.location,
            attendees: params.attendees,
          });
        };
      }

      const calSearchTool = runtime.getTools().get("calendar_search");
      if (calSearchTool) {
        calSearchTool.execute = async (params: any) => {
          const events = await calendarClient.searchEvents(params.query);
          return { count: events.length, events };
        };
      }

      // Drive tools
      const driveListTool = runtime.getTools().get("drive_list");
      if (driveListTool) {
        driveListTool.execute = async (params: any) => {
          const files = await driveClient.listFiles({
            maxResults: params.maxResults,
          });
          return { count: files.length, files };
        };
      }

      const driveSearchTool = runtime.getTools().get("drive_search");
      if (driveSearchTool) {
        driveSearchTool.execute = async (params: any) => {
          const files = await driveClient.searchFiles(params.query);
          return { count: files.length, files };
        };
      }

      const driveReadTool = runtime.getTools().get("drive_read");
      if (driveReadTool) {
        driveReadTool.execute = async (params: any) => {
          return await driveClient.readFile(params.fileId);
        };
      }

      const driveUploadTool = runtime.getTools().get("drive_upload");
      if (driveUploadTool) {
        driveUploadTool.execute = async (params: any) => {
          return await driveClient.uploadFile({
            name: params.name,
            content: Buffer.from(params.content, "utf-8"),
            mimeType: params.mimeType || "text/plain",
            folderId: params.folderId,
          });
        };
      }

      const drivePdfTool = runtime.getTools().get("drive_create_pdf");
      if (drivePdfTool) {
        drivePdfTool.execute = async (params: any) => {
          return await driveClient.createPdf({
            title: params.title,
            content: params.content,
            folderId: params.folderId,
          });
        };
      }

      console.log(
        "🔗 Wired 14 Google Workspace tools (Gmail, Calendar, Drive)",
      );
    } catch (googleError) {
      console.warn("⚠️ Google tools not configured:", googleError);
    }
  } else {
    console.log(
      "ℹ️  Google tools registered but not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)",
    );
  }

  const useResearchOrchestratorV2 =
    process.env.NOVA_RESEARCH_ORCHESTRATOR_V2 !== "false";
  const researchMaxIterations = parsePositiveInt(
    process.env.NOVA_RESEARCH_MAX_ITER,
    10,
  );
  const researchToolTimeoutMs = parsePositiveInt(
    process.env.NOVA_RESEARCH_TOOL_TIMEOUT_MS,
    45000,
  );
  const researchMaxSources = parsePositiveInt(
    process.env.NOVA_RESEARCH_MAX_SOURCES,
    8,
  );
  const enableTelemetry = process.env.NOVA_RESEARCH_ENABLE_TELEMETRY === "true";
  const shadowMode = process.env.NOVA_RESEARCH_SHADOW_MODE === "true";

  const researchOrchestrator = new ResearchOrchestrator(runtime, agent, {
    provider: agentConfig.provider,
    maxIterations: researchMaxIterations,
    toolTimeoutMs: researchToolTimeoutMs,
    maxSources: researchMaxSources,
    enableTelemetry,
  });

  console.log(
    `🧠 Research orchestrator v2: ${useResearchOrchestratorV2 ? "enabled" : "disabled"}`,
  );

  const chatService = new ChatService(researchOrchestrator, agent, {
    useResearchOrchestratorV2,
    enableTelemetry,
    shadowMode,
  });

  const telegramEnabled =
    process.env.NOVA_TELEGRAM_ENABLED !== undefined
      ? process.env.NOVA_TELEGRAM_ENABLED === "true"
      : gatewayConfig.telegramEnabled === true;
  const telegramChannel = new TelegramChannel(
    {
      enabled: telegramEnabled,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      ownerUserId:
        parseOptionalInt(process.env.NOVA_TELEGRAM_OWNER_USER_ID) ??
        gatewayConfig.telegramOwnerUserId,
      ownerChatId:
        parseOptionalInt(process.env.NOVA_TELEGRAM_OWNER_CHAT_ID) ??
        gatewayConfig.telegramOwnerChatId,
      pollTimeoutSec: parsePositiveInt(
        process.env.NOVA_TELEGRAM_POLL_TIMEOUT_SEC,
        25,
      ),
      retryBaseMs: parsePositiveInt(
        process.env.NOVA_TELEGRAM_RETRY_BASE_MS,
        1000,
      ),
      retryMaxMs: parsePositiveInt(
        process.env.NOVA_TELEGRAM_RETRY_MAX_MS,
        30000,
      ),
    },
    chatService,
  );

  // WhatsApp configuration
  const whatsappEnabled = process.env.NOVA_WHATSAPP_ENABLED === "true";
  const whatsappChannel = new WhatsAppChannel(
    {
      enabled: whatsappEnabled,
      ownerNumber: process.env.NOVA_WHATSAPP_OWNER_NUMBER,
      isOwnNumber: process.env.NOVA_WHATSAPP_IS_OWN_NUMBER === "true",
      allowedNumbers: process.env.NOVA_WHATSAPP_ALLOWED_NUMBERS
        ? process.env.NOVA_WHATSAPP_ALLOWED_NUMBERS.split(",").filter(Boolean)
        : undefined,
      messagePrefix: "Nova:",
      ownerName: process.env.NOVA_WHATSAPP_OWNER_NAME || undefined,
    },
    chatService,
  );

  // Register plugins
  await app.register(cors);
  await app.register(websocket);

  // Health check
  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // WebSocket endpoint for agent communication
  app.register(async (fastify) => {
    fastify.get("/ws", { websocket: true }, (connection, req) => {
      console.log("🔌 Client connected");
      const historyKey = `ws:${String(req.id || Date.now())}`;
      const sessionId = historyKey;

      connection.on("message", async (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());
          console.log("📨 Received message:", data.type);

          switch (data.type) {
            case "ping":
              connection.send(JSON.stringify({ type: "pong" }));
              break;

            case "chat": {
              try {
                const userMessage = String(data.message || "").trim();
                if (!userMessage) {
                  connection.send(
                    JSON.stringify({
                      type: "response",
                      response: "",
                      success: true,
                    }),
                  );
                  break;
                }

                console.log("💬 Processing chat:", userMessage);
                const result = await chatService.runChatTurn({
                  message: userMessage,
                  sessionId,
                  historyKey,
                  channel: "ws",
                });

                const payload: Record<string, unknown> = {
                  type: "response",
                  response: result.response,
                  success: result.success,
                };
                if (result.research) {
                  payload.research = result.research;
                }
                if (enableTelemetry && result.events) {
                  payload.events = result.events;
                }
                connection.send(JSON.stringify(payload));
              } catch (error: any) {
                console.error("❌ Chat error:", error);

                connection.send(
                  JSON.stringify({
                    type: "response",
                    response: "Sorry, I ran into an error.",
                    success: false,
                  }),
                );
              }
              break;
            }

            case "execute": {
              try {
                const result = await runtime.executeTool(
                  data.tool,
                  data.params || {},
                );

                connection.send(
                  JSON.stringify({
                    type: "result",
                    result: result,
                    success: true,
                  }),
                );
              } catch (error: any) {
                connection.send(
                  JSON.stringify({
                    type: "error",
                    message: `Execution error: ${error.message}`,
                  }),
                );
              }
              break;
            }

            default:
              connection.send(
                JSON.stringify({
                  type: "error",
                  message: `Unknown message type: ${data.type}`,
                }),
              );
          }
        } catch (error: any) {
          console.error("Error handling message:", error);
          connection.send(
            JSON.stringify({
              type: "error",
              message: error.message,
            }),
          );
        }
      });

      connection.on("close", () => {
        console.log("🔌 Client disconnected");
        chatService.resetHistory(historyKey);
      });

      connection.on("error", (error) => {
        console.error("WebSocket error:", error);
      });
    });
  });

  // API routes
  app.get("/api/status", async () => {
    return {
      status: "running",
      version: "0.1.0",
      uptime: process.uptime(),
      tools: allTools.length,
      chatSessions: chatService.getSessionCount(),
      telegram: telegramChannel.getStatus(),
      whatsapp: whatsappChannel.getStatus(),
    };
  });

  const PORT = process.env.PORT || 18789;
  await app.listen({ port: Number(PORT), host: "127.0.0.1" });
  console.log(`🚀 Gateway running on http://127.0.0.1:${PORT}`);
  console.log(`📡 WebSocket available at ws://127.0.0.1:${PORT}/ws`);
  await telegramChannel.start().catch((error) => {
    console.warn(
      "⚠️ Telegram channel startup failed:",
      error?.message || error,
    );
  });

  await whatsappChannel.start().catch((error) => {
    console.warn(
      "⚠️ WhatsApp channel startup failed:",
      error?.message || error,
    );
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("\n🛑 Shutting down gateway...");
    await telegramChannel.stop();
    await whatsappChannel.stop();
    await runtime.shutdown();
    await app.close();
    process.exit(0);
  });
}

start().catch((error) => {
  console.error("Fatal error starting gateway:", error);
  process.exit(1);
});
