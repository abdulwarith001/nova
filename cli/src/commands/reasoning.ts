import chalk from "chalk";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const LOG_PATH = join(homedir(), ".nova", "reasoning.log");

export async function reasoningCommand(options: {
  tail?: boolean;
  lines?: string;
  clear?: boolean;
}) {
  if (options.clear) {
    const { writeFileSync } = await import("fs");
    writeFileSync(LOG_PATH, "");
    console.log(chalk.green("✔ Reasoning log cleared"));
    return;
  }

  if (!existsSync(LOG_PATH)) {
    console.log(chalk.yellow("No reasoning log found yet."));
    console.log(
      chalk.gray("Logs appear after the agent processes a request.\n"),
    );
    return;
  }

  if (options.tail) {
    console.log(chalk.cyan("📋 Following reasoning log (Ctrl+C to stop)\n"));
    const { spawn } = await import("child_process");
    const tail = spawn("tail", ["-f", LOG_PATH], { stdio: "inherit" });
    tail.on("error", () => {
      console.error(chalk.red("Failed to tail log file"));
    });
    // Keep the process alive until user hits Ctrl+C
    await new Promise(() => {});
    return;
  }

  const lineCount = parseInt(options.lines || "50", 10);
  const content = readFileSync(LOG_PATH, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  if (lines.length === 0) {
    console.log(chalk.yellow("Reasoning log is empty."));
    return;
  }

  const displayed = lines.slice(-lineCount);

  console.log(
    chalk.cyan.bold(`\n🧠 Reasoning Log`) +
      chalk.gray(` (last ${displayed.length} of ${lines.length} entries)\n`),
  );

  for (const line of displayed) {
    // Color the lines based on content
    if (line.includes("[THINKING]")) {
      console.log(chalk.blue(line));
    } else if (line.includes("[PLAN]")) {
      console.log(chalk.magenta(line));
    } else if (line.includes("[REFLECT]")) {
      console.log(chalk.yellow(line));
    } else if (line.includes("[ERROR]")) {
      console.log(chalk.red(line));
    } else if (line.includes("[TRACE]")) {
      console.log(chalk.green(line));
    } else if (line.startsWith("===")) {
      console.log(chalk.dim(line));
    } else {
      console.log(chalk.gray(line));
    }
  }
  console.log();
}
