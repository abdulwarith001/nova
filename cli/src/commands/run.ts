import chalk from "chalk";
import ora from "ora";
import WebSocket from "ws";
import { loadConfig } from "../utils/config.js";

export async function runCommand(task: string) {
  console.log(chalk.cyan(`\n🚀 Executing: ${task}\n`));

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

    spinner.text = "Executing task...";

    // Send task to daemon
    ws.send(
      JSON.stringify({
        type: "execute",
        task,
      }),
    );

    // Wait for result
    const result: any = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Execution timeout"));
      }, 120000); // 2 minute timeout

      ws.once("message", (data) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data.toString()));
        } catch {
          resolve({ result: String(data) });
        }
      });
    });

    spinner.succeed("Task completed");

    console.log(chalk.green("\n✅ Result:\n"));

    if (typeof result.result === "object") {
      console.log(JSON.stringify(result.result, null, 2));
    } else {
      console.log(result.result || result.message || result);
    }

    console.log();

    ws.close();
  } catch (error: any) {
    spinner.fail("Task failed");
    console.error(chalk.red("\nError:"), error.message);
    console.log(chalk.gray("\nMake sure the daemon is running:"));
    console.log(chalk.gray("  nova daemon start\n"));
    process.exit(1);
  }
}
