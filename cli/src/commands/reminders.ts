import chalk from "chalk";
import ora from "ora";
import WebSocket from "ws";
import { loadConfig } from "../utils/config.js";
import readline from "readline";

export async function remindersCommand(options: {
  cancel?: string;
  select?: boolean;
  all?: boolean;
}) {
  if (options.cancel) {
    return cancelReminder(options.cancel);
  }

  console.log(chalk.cyan.bold("\n📋 Pending Reminders\n"));

  const spinner = ora("Fetching reminders...").start();

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

    // Request reminders list
    const request = (payload: any) =>
      new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Request timeout")),
          10000,
        );

        ws.once("message", (data) => {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(data.toString()));
          } catch {
            resolve({});
          }
        });

        ws.send(JSON.stringify(payload));
      });

    const remindersResult = await request({
      type: "list_reminders",
      status: options.all ? undefined : "scheduled",
    });

    spinner.stop();

    const reminders = remindersResult.reminders || [];

    if (reminders.length === 0) {
      console.log(chalk.yellow("No pending reminders\n"));
    } else {
      console.log(chalk.gray(`Found ${reminders.length} item(s):\n`));

      reminders.forEach((item: any, index: number) => {
        const time = new Date(
          item.nextRun || item.sendAt || item.triggerTime,
        ).toLocaleString();
        const icon = item.kind === "recurring" ? "🔄" : "⏰";
        console.log(`${index + 1}. ${icon} [${time}] ${item.message}`);
        if (item.schedule) {
          console.log(chalk.gray(`   Schedule: ${item.schedule}`));
        }
        console.log(chalk.gray(`   Status: ${item.status}`));
        console.log(chalk.gray(`   ID: ${item.id}\n`));
      });
    }

    if (options.select && reminders.length > 0) {
      const picked = await promptForIndex(reminders.length);
      if (picked !== null) {
        const target = reminders[picked];
        ws.close();
        return cancelReminder(target.id);
      }
    }

    ws.close();
  } catch (error: any) {
    spinner.fail("Failed to fetch reminders");
    console.error(chalk.red("\nError:"), error.message);
    process.exit(1);
  }
}

async function cancelReminder(id: string) {
  console.log(chalk.cyan(`\n🚫 Cancelling reminder: ${id}\n`));

  const spinner = ora("Cancelling...").start();

  try {
    const config = loadConfig();
    const ws = new WebSocket(`ws://127.0.0.1:${config.daemonPort || 3000}/ws`);

    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
      setTimeout(() => reject(new Error("Connection timeout")), 5000);
    });

    ws.send(
      JSON.stringify({
        type: "cancel_reminder",
        id,
      }),
    );

    const result: any = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Request timeout")),
        10000,
      );

      ws.once("message", (data) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data.toString()));
        } catch {
          resolve({ success: true });
        }
      });
    });

    if (result.success) {
      spinner.succeed("Reminder cancelled");
    } else {
      spinner.fail("Failed to cancel reminder");
    }

    console.log();
    ws.close();
  } catch (error: any) {
    spinner.fail("Failed to cancel reminder");
    console.error(chalk.red("\nError:"), error.message);
    process.exit(1);
  }
}

 

function promptForIndex(max: number): Promise<number | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      chalk.cyan(`Select reminder to cancel (1-${max}, or empty to skip): `),
      (answer) => {
        rl.close();
        const trimmed = answer.trim();
        if (!trimmed) {
          resolve(null);
          return;
        }
        const idx = Number(trimmed);
        if (!Number.isFinite(idx) || idx < 1 || idx > max) {
          console.log(chalk.red("Invalid selection."));
          resolve(null);
          return;
        }
        resolve(idx - 1);
      },
    );
  });
}
