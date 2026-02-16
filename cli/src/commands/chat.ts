import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import WebSocket from "ws";
import { loadConfig } from "../utils/config.js";
import { daemonCommand } from "./daemon.js";

export async function chatCommand(options: { agent?: string }) {
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

      try {
        // Send message to daemon
        ws.send(
          JSON.stringify({
            type: "chat",
            message,
            agent: options.agent,
            history: conversationHistory,
          }),
        );

        // Wait for response
        const response: any = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Response timeout"));
          }, 60000); // 60 second timeout

          ws.once("message", (data) => {
            clearTimeout(timeout);
            try {
              const parsed = JSON.parse(data.toString());
              resolve(parsed);
            } catch {
              resolve({ response: String(data) });
            }
          });
        });

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
