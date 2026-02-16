import chalk from "chalk";
import ora from "ora";
import WebSocket from "ws";
import { loadConfig } from "../utils/config.js";

export async function remindCommand(
  message: string,
  time: string,
  options?: { email?: string },
) {
  console.log(chalk.cyan(`\n⏰ Creating reminder: "${message}" at ${time}\n`));

  const spinner = ora("Connecting to daemon...").start();

  try {
    const config = loadConfig();
    const ws = new WebSocket(
      `ws://127.0.0.1:${config.daemonPort || 3000}/ws`,
    );

    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
      setTimeout(() => reject(new Error("Connection timeout")), 5000);
    });

    spinner.text = "Creating reminder...";

    // Send reminder creation request
    const payload: Record<string, unknown> = {
      type: "create_reminder",
      message,
      time,
    };

    if (options?.email) {
      payload.channel = "email";
      payload.recipientEmail = options.email;
    }

    ws.send(JSON.stringify(payload));

    // Wait for confirmation
    const result: any = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Request timeout"));
      }, 10000);

      ws.once("message", (data) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data.toString()));
        } catch {
          resolve({ success: true, message: String(data) });
        }
      });
    });

    if (result.success) {
      spinner.succeed("Reminder created");
      console.log(
        chalk.green(`\n✅ Reminder set for: ${result.triggerTime || time}`),
      );
      if (result.reminderId) {
        console.log(chalk.gray(`   ID: ${result.reminderId}`));
      }
    } else {
      spinner.fail("Failed to create reminder");
      console.error(chalk.red(`\nError: ${result.error || "Unknown error"}`));
    }

    console.log();

    ws.close();
  } catch (error: any) {
    spinner.fail("Failed to create reminder");
    console.error(chalk.red("\nError:"), error.message);
    console.log(chalk.gray("\nMake sure the daemon is running:"));
    console.log(chalk.gray("  nova daemon start\n"));
    process.exit(1);
  }
}
