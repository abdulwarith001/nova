import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { Agent } from "../../agent/src/index.js";
import { Runtime } from "../../runtime/src/index.js";
import path from "path";
import { homedir } from "os";
import { ensureEnvLoaded, loadNovaConfig } from "../../runtime/src/config.js";
import { loadSoul } from "../../runtime/src/soul.js";
import { HeartbeatEngine } from "../../runtime/src/heartbeat.js";
import { ResearchOrchestrator } from "./research-orchestrator.js";
import { ChatService } from "./chat-service.js";
import { TelegramChannel } from "./channels/telegram.js";

ensureEnvLoaded();

function loadGatewayConfig(): {
  notificationEmail?: string;
  telegramEnabled?: boolean;
  telegramOwnerUserId?: number;
  telegramOwnerChatId?: number;
} {
  const configJson = loadNovaConfig();
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
  const agentConfig = {
    provider: (process.env.DEFAULT_PROVIDER as any) || "openai",
    model: process.env.DEFAULT_MODEL || "gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
  };

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
    agent: agentConfig,
  });
  console.log("✅ Runtime initialized");

  // Load soul.md personality
  const soulContent = loadSoul();
  console.log("✅ Loaded soul.md");

  const agent = new Agent(agentConfig, soulContent);

  // Get tools from Runtime in agent-compatible format
  const allTools = runtime.getToolsForAgent();
  console.log(`📋 Loaded ${allTools.length} tools`);

  // === Wire tools that need runtime references ===
  const { wireBrowseTools, wireGoogleWorkspaceTools, wireSkillTools } =
    await import("./tool-wiring.js");
  await wireSkillTools(runtime);
  await wireBrowseTools(runtime, agent);
  await wireGoogleWorkspaceTools(runtime);

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
    soulContent,
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

  // Start heartbeat engine
  const heartbeat = new HeartbeatEngine();
  heartbeat.onTick(async (tick) => {
    console.log(`💓 Heartbeat task "${tick.task.name}": ${tick.task.message}`);
    // TODO: Route through chatService or telegramChannel for proactive messages
  });
  heartbeat.start();

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("\n🛑 Shutting down gateway...");
    heartbeat.stop();
    await telegramChannel.stop();
    await runtime.shutdown();
    await app.close();
    process.exit(0);
  });
}

start().catch((error) => {
  console.error("Fatal error starting gateway:", error);
  process.exit(1);
});
