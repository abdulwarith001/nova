import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { Agent } from "../../agent/src/index.js";
import { Runtime } from "../../runtime/src/index.js";
import { drainPendingImages } from "../../runtime/src/pending-images.js";
import { ensureEnvLoaded, loadNovaConfig } from "../../runtime/src/config.js";
import { TaskStore } from "../../runtime/src/task-store.js";
import { TaskEngine } from "../../runtime/src/task-engine.js";
import { HeartbeatEngine } from "../../runtime/src/heartbeat.js";

import { ResearchOrchestrator } from "./research-orchestrator.js";
import { ChatService } from "./chat-service.js";
import { TelegramChannel } from "./channels/telegram.js";
import {
  buildProactivePrompt,
  parseProactiveResponse,
} from "./proactive-prompt.js";

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
  const novaConfig = loadNovaConfig();
  const agentConfig = {
    provider: (process.env.DEFAULT_PROVIDER ||
      (novaConfig as any).defaultProvider ||
      "openai") as any,
    model:
      process.env.DEFAULT_MODEL ||
      (novaConfig as any).defaultModel ||
      "gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
  };

  let plannerChat: ((prompt: string) => Promise<string>) | undefined;

  const runtime = await Runtime.create({
    security: {
      allowedTools: ["*"],
      deniedTools: [],
    },
    executor: {
      maxParallel: 4,
      defaultTimeoutMs: 30000,
    },
    planner: {
      llmChat: async (prompt: string) => {
        if (!plannerChat) {
          throw new Error("Planner LLM chat not initialized yet");
        }
        return await plannerChat(prompt);
      },
    },
  });
  console.log("✅ Runtime initialized");

  // Load agent identity from IDENTITY.md profile
  const profileStore = runtime.getMarkdownMemory().getProfileStore();
  const identityContent = profileStore.getIdentity();
  const rulesContent = profileStore.getRules();
  console.log("✅ Loaded IDENTITY.md + RULES.md");

  const agent = new Agent(agentConfig, identityContent);
  plannerChat = async (prompt: string) => agent.chat(prompt);

  // Get tools from Runtime in agent-compatible format
  const allTools = runtime.getToolsForAgent();
  console.log(`📋 Loaded ${allTools.length} tools`);

  // === Wire tools that need runtime references ===
  const { SkillLoader } = await import("../../runtime/src/skill-loader.js");
  const { SkillBuilder } = await import("../../runtime/src/skill-builder.js");
  const skillLoader = new SkillLoader();
  const skillBuilder = new SkillBuilder();

  const projectRoot = (await import("path")).resolve(
    (await import("url")).fileURLToPath(import.meta.url),
    "../../..",
  );
  skillLoader.init(SkillLoader.getDefaultDirs(projectRoot));
  const skillsSummary = skillLoader.getIndexSummary();

  const { wireSkillTools, wireProfileTools } = await import("./tool-wiring.js");
  await wireSkillTools(runtime, agent, { skillLoader, skillBuilder });
  wireProfileTools(runtime);

  console.log(
    `📋 Skill index: ${skillLoader.getIndex().length} skills available`,
  );

  const useResearchOrchestratorV2 =
    process.env.NOVA_RESEARCH_ORCHESTRATOR_V2 !== "false";
  const researchMaxIterations = parsePositiveInt(
    process.env.NOVA_RESEARCH_MAX_ITER,
    10,
  );
  const researchToolTimeoutMs = parsePositiveInt(
    process.env.NOVA_RESEARCH_TOOL_TIMEOUT_MS,
    90000,
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

  const chatService = new ChatService(
    researchOrchestrator,
    agent,
    {
      useResearchOrchestratorV2,
      enableTelemetry,
      shadowMode,
      identityContent,
      rulesContent,
      skillsSummary,
    },
    runtime.getMarkdownMemory().getConversationStore(),
  );

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
                  confirm: async (step, reason) => {
                    console.log(
                      `🛡️ HitL Confirmation required (WS): ${reason}`,
                    );
                    // For now, WS just logs and auto-approves or could wait for a specific 'approve' message
                    return true;
                  },
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

                // Drain any images generated by tools (WS can't send images, but clear the queue)
                drainPendingImages();
              } catch (error: any) {
                console.error("❌ Chat error:", error);
                drainPendingImages(); // Clear any stale images on error

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

            case "list_tasks": {
              try {
                const store = taskEngine.getStore();
                const status = data.status || "active";
                const items = store.list({ status });
                connection.send(
                  JSON.stringify({
                    type: "result",
                    tasks: items.map((item) => ({
                      id: item.id,
                      kind: item.kind,
                      message: item.message,
                      nextRun: item.nextRun,
                      status: item.status,
                      schedule: item.schedule,
                    })),
                  }),
                );
              } catch (error: any) {
                connection.send(
                  JSON.stringify({ type: "error", message: error.message }),
                );
              }
              break;
            }

            case "cancel_task": {
              try {
                const store = taskEngine.getStore();
                const success = store.cancel(String(data.id || ""));
                connection.send(JSON.stringify({ type: "result", success }));
              } catch (error: any) {
                connection.send(
                  JSON.stringify({ type: "error", message: error.message }),
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
      version: "0.1.15",
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

  // Start task engine
  const taskStore = new TaskStore();

  const taskEngine = new TaskEngine(taskStore);
  taskEngine.onTick(async (tick) => {
    const label =
      tick.item.kind === "reminder"
        ? "🔔"
        : tick.item.kind === "recurring"
          ? "🔄"
          : "📋";
    console.log(`${label} Task triggered: "${tick.item.message}"`);

    try {
      const isConnected = telegramChannel.getStatus().connected;
      const ownerChatId = telegramChannel.getStatus().ownerChatId;

      if (tick.item.kind === "reminder") {
        // Reminders: route through LLM so delivery feels natural and fun
        const prompt = `You have a reminder to deliver to the user. Tell them in a fun, friendly, natural way — like a personal assistant nudging them. Keep it short (1-2 sentences). The reminder is: "${tick.item.message}"`;
        const result = await chatService.runChatTurn({
          message: prompt,
          sessionId: `task:${tick.item.id}`,
          historyKey: `task:reminder:${tick.item.id}`,
          channel: "telegram",
          confirm: async (step, reason) => {
            if (isConnected && ownerChatId) {
              return await telegramChannel.askConfirmation(
                ownerChatId,
                `${reason}\n\n<b>Action:</b> ${step.toolName}\n<b>Target:</b> ${step.id}`,
                `confirm_${tick.item.id}_${step.id}`,
              );
            }
            return false;
          },
        });

        if (result.response && isConnected && ownerChatId) {
          await telegramChannel.sendProactiveMessage(
            ownerChatId,
            `🔔 ${result.response}`,
          );
        }
        drainPendingImages(); // Always clear
      } else {
        // Tasks & recurring: route through chat pipeline (agent acts on it)
        const prompt = tick.item.action || tick.item.message;
        const result = await chatService.runChatTurn({
          message: prompt,
          sessionId: `task:${tick.item.id}`,
          historyKey: `task:${tick.item.kind}:${tick.item.id}`,
          channel: "telegram",
          confirm: async (step, reason) => {
            if (isConnected && ownerChatId) {
              return await telegramChannel.askConfirmation(
                ownerChatId,
                `${reason}\n\n<b>Action:</b> ${step.toolName}\n<b>Step:</b> ${step.id}`,
                `confirm_${tick.item.id}_${step.id}`,
              );
            }
            return false;
          },
        });

        if (result.response && isConnected && ownerChatId) {
          await telegramChannel.sendProactiveMessage(
            ownerChatId,
            result.response,
          );

          // Send any images generated by tools during this task
          const pendingImages = drainPendingImages();
          for (const img of pendingImages) {
            try {
              await telegramChannel.sendProactivePhoto(
                ownerChatId,
                img.imageBase64,
                img.caption,
              );
            } catch (imgErr: any) {
              console.warn("Failed to send task image:", imgErr?.message);
            }
          }
        } else {
          drainPendingImages(); // Clear if not connected
        }
      }
    } catch (err: any) {
      console.warn(
        `⚠️ Task delivery failed for "${tick.item.message}":`,
        err?.message,
      );
      drainPendingImages(); // Safety drain on error
    }
  });
  taskEngine.start();

  // Start heartbeat engine for proactive messaging
  const heartbeatEngine = new HeartbeatEngine(undefined, 60 * 60 * 1000);
  heartbeatEngine.onTick(async (tick) => {
    const isConnected = telegramChannel.getStatus().connected;
    const ownerChatId = telegramChannel.getStatus().ownerChatId;
    if (!isConnected || !ownerChatId) return;

    console.log(`💓 Proactive check-in: "${tick.task.name}"`);

    try {
      const prompt = buildProactivePrompt({
        triggerMessage: tick.task.message,
        profileStore: runtime.getMarkdownMemory().getProfileStore(),
        taskStore: taskEngine.getStore(),
      });

      const result = await chatService.runChatTurn({
        message: prompt,
        sessionId: `heartbeat:${tick.task.name}`,
        historyKey: `heartbeat:proactive`,
        channel: "telegram",
      });

      const parsed = parseProactiveResponse(result.response);

      if (parsed.message) {
        await telegramChannel.sendProactiveMessage(ownerChatId, parsed.message);

        // Send any images generated by tools
        const pendingImages = drainPendingImages();
        for (const img of pendingImages) {
          try {
            await telegramChannel.sendProactivePhoto(
              ownerChatId,
              img.imageBase64,
              img.caption,
            );
          } catch (imgErr: any) {
            console.warn("Failed to send heartbeat image:", imgErr?.message);
          }
        }
      } else {
        console.log("💓 Agent decided: [NO_MESSAGE]");
        drainPendingImages();
      }

      // Dynamically adjust next check-in
      heartbeatEngine.setNextTickInterval(parsed.nextCheckInMs);
    } catch (err: any) {
      console.warn(`⚠️ Heartbeat check-in failed:`, err?.message);
      drainPendingImages();
    }
  });
  heartbeatEngine.start();

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("\n🛑 Shutting down gateway...");
    taskEngine.stop();
    heartbeatEngine.stop();
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
