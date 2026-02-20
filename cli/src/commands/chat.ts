import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import WebSocket from "ws";
import { loadConfig } from "../utils/config.js";
import { daemonCommand } from "./daemon.js";

type ProgressFrame = {
  type: "response_progress";
  requestId?: string;
  stage?: string;
  message?: string;
  timestamp?: number;
  iteration?: number;
};

type ResponseFrame = {
  type?: string;
  requestId?: string;
  response?: string;
  message?: string;
  success?: boolean;
  thinking?: string;
  reasoningSteps?: Array<{
    type: string;
    content: string;
    confidence?: number;
  }>;
};

function createRequestId(): string {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function waitForChatResponse(
  ws: WebSocket,
  requestId: string,
  onProgress: (frame: ProgressFrame) => void,
): Promise<ResponseFrame> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Response timeout"));
    }, 60000);

    const onMessage = (data: WebSocket.RawData) => {
      let parsed: any;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        cleanup();
        resolve({ response: String(data), success: true });
        return;
      }

      if (parsed?.type === "response_progress") {
        if (parsed.requestId && parsed.requestId !== requestId) return;
        onProgress(parsed as ProgressFrame);
        return;
      }

      if (parsed?.type === "error") {
        cleanup();
        reject(new Error(String(parsed.message || "Unknown gateway error")));
        return;
      }

      const isResponseFrame =
        parsed?.type === "response" ||
        parsed?.response !== undefined ||
        parsed?.message !== undefined;
      if (!isResponseFrame) return;
      if (parsed.requestId && parsed.requestId !== requestId) return;

      cleanup();
      resolve(parsed as ResponseFrame);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };

    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

export async function chatCommand(options: { agent?: string; progress?: boolean }) {
  console.log(chalk.cyan.bold("\n💬 Nova Chat\n"));

  if (options.agent) {
    console.log(chalk.gray(`Chatting with: ${options.agent}\n`));
  }

  // Check if daemon is running
  const spinner = ora("Connecting to Nova daemon...").start();

  try {
    const config = loadConfig();
    const ws = new WebSocket(`ws://127.0.0.1:${config.daemonPort || 3000}/ws`);

    await new Promise((resolve, reject) => {
      ws.on("open", () => {
        spinner.succeed("Connected");
        resolve(null);
      });

      ws.on("error", (error) => {
        spinner.fail("Failed to connect to daemon");
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 5000);
    });

    console.log(chalk.gray('Type "exit" or "quit" to end conversation\n'));
    const showProgress =
      options.progress !== false && process.env.NOVA_CHAT_SHOW_PROGRESS !== "false";
    const showThoughtFrames = process.env.NOVA_CHAT_STREAM_THOUGHTS === "true";

    let conversationHistory: any[] = [];

    while (true) {
      const { message } = await inquirer.prompt([
        {
          type: "input",
          name: "message",
          message: chalk.blue("You:"),
          prefix: "",
        },
      ]);

      if (
        message.toLowerCase() === "exit" ||
        message.toLowerCase() === "quit"
      ) {
        break;
      }

      if (!message.trim()) {
        continue;
      }

      const thinking = ora("Nova is thinking...").start();
      const requestId = createRequestId();

      try {
        // Send message to daemon
        ws.send(
          JSON.stringify({
            type: "chat",
            requestId,
            message,
            agent: options.agent,
            history: conversationHistory,
          }),
        );

        // Wait for response
        const response = await waitForChatResponse(
          ws,
          requestId,
          (progressFrame) => {
            if (!showProgress) return;
            const text = String(progressFrame.message || "").trim();
            if (!text) return;
            const isThoughtFrame =
              text.startsWith("Intent:") || text.startsWith("Next action:");
            if (isThoughtFrame && !showThoughtFrames) return;
            if (isThoughtFrame) {
              thinking.stop();
              console.log(chalk.dim(`  🧭 ${text}`));
              thinking.start("Nova is thinking...");
              return;
            }
            thinking.text = text;
          },
        );

        thinking.stop();

        // Display thinking/reasoning steps if present
        if (response.thinking) {
          console.log(chalk.dim("\n  🧠 Thinking:"));
          const lines = String(response.thinking).split("\n");
          for (const line of lines) {
            console.log(chalk.dim(`    ${line}`));
          }
          console.log();
        }

        // Display reasoning steps if present
        if (Array.isArray(response.reasoningSteps)) {
          console.log(chalk.dim("  📋 Reasoning:"));
          for (const step of response.reasoningSteps) {
            const icon = step.type === "conclusion" ? "└─" : "├─";
            const confStr =
              step.confidence != null
                ? chalk.dim(` (${(step.confidence * 100).toFixed(0)}%)`)
                : "";
            console.log(
              chalk.dim(`    ${icon} `) +
                chalk.yellow(step.type) +
                chalk.dim(": ") +
                step.content +
                confStr,
            );
          }
          console.log();
        }

        const responseText =
          response.response || response.message || String(response);
        console.log(chalk.green("\nNova:"), responseText + "\n");

        // Update history
        conversationHistory.push(
          { role: "user", content: message },
          { role: "assistant", content: responseText },
        );

        // Keep only last 20 messages
        if (conversationHistory.length > 20) {
          conversationHistory = conversationHistory.slice(-20);
        }
      } catch (error: any) {
        thinking.fail("Error communicating with Nova");
        console.error(chalk.red(error.message + "\n"));
      }
    }

    ws.close();
    console.log(chalk.cyan("\n👋 Goodbye!\n"));
  } catch (error: any) {
    spinner.fail("Failed to connect");

    // Offer to auto-start daemon
    console.log(chalk.yellow("\n⚠️  Gateway is not running\n"));

    const { shouldStart } = await inquirer.prompt([
      {
        type: "confirm",
        name: "shouldStart",
        message: "Would you like to start it now?",
        default: true,
      },
    ]);

    if (shouldStart) {
      console.log();
      await daemonCommand("start");
      console.log(chalk.cyan("\n💬 Starting chat...\n"));
      // Retry connection
      return chatCommand(options);
    } else {
      console.log(chalk.gray("\nStart manually with: nova daemon start\n"));
      process.exit(1);
    }
  }
}
