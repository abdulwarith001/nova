import chalk from "chalk";
import ora from "ora";
import { spawn, exec } from "child_process";
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";
import { killProcessOnPort } from "../utils/port.js";

const execAsync = promisify(exec);

const NOVA_DIR = join(homedir(), ".nova");
const PID_FILE = join(NOVA_DIR, "daemon.pid");
const LOG_FILE = join(NOVA_DIR, "daemon.log");
const CONFIG_FILE = join(NOVA_DIR, "config.json");
const DEFAULT_DAEMON_PORT = 18789;

export async function daemonCommand(
  action: string,
  options?: { tail?: boolean; clear?: boolean; force?: boolean },
) {
  switch (action) {
    case "start":
      return startDaemon();
    case "stop":
      return stopDaemon(options?.force);
    case "status":
      return daemonStatus();
    case "logs":
      return daemonLogs(options);
    case "restart":
      await stopDaemon(options?.force);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await startDaemon();
      break;
    default:
      console.log(chalk.cyan.bold("\n🔧 Daemon Management\n"));
      console.log("Usage: nova daemon <action>\n");
      console.log("Actions:");
      console.log("  " + chalk.bold("start") + "    Start the gateway daemon");
      console.log("  " + chalk.bold("stop") + "     Stop the gateway daemon");
      console.log("  " + chalk.bold("restart") + "  Restart the daemon");
      console.log("  " + chalk.bold("status") + "   Check daemon status");
      console.log("  " + chalk.bold("logs") + "     View daemon logs\n");
      console.log("Options:");
      console.log("  " + chalk.gray("--force") + "  Force stop (kill and clear state)");
      console.log("Log options:");
      console.log("  " + chalk.gray("--tail") + "   Follow logs in real-time");
      console.log("  " + chalk.gray("--clear") + "  Clear log file\n");
  }
}

function getDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) {
    return null;
  }
  try {
    return parseInt(readFileSync(PID_FILE, "utf-8").trim());
  } catch {
    return null;
  }
}

function isDaemonProcessRunning(): boolean {
  const pid = getDaemonPid();
  if (!pid) return false;

  try {
    // Check if process exists (signal 0 doesn't kill, just checks)
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getDaemonPort(): number {
  if (!existsSync(CONFIG_FILE)) return DEFAULT_DAEMON_PORT;
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as {
      daemonPort?: number;
    };
    if (typeof config.daemonPort === "number" && config.daemonPort > 0) {
      return config.daemonPort;
    }
  } catch {
    // ignore parse errors and use default port
  }
  return DEFAULT_DAEMON_PORT;
}

async function isGatewayHealthy(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForGatewayReady(
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isDaemonProcessRunning()) return false;
    if (await isGatewayHealthy(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function findGatewayPath(): Promise<string | null> {
  // Try multiple locations
  const candidates = [
    join(process.cwd(), "gateway"),
    join(process.cwd(), "..", "gateway"),
    join(homedir(), "personal-projects", "nova", "gateway"),
  ];

  for (const path of candidates) {
    if (existsSync(join(path, "package.json"))) {
      return path;
    }
  }

  return null;
}

async function startDaemon() {
  const spinner = ora("Starting Nova gateway...").start();
  const daemonPort = getDaemonPort();

  // Kill any existing processes on port 18789 to prevent conflicts
  spinner.text = "Cleaning up existing gateway processes...";
  await killProcessOnPort(daemonPort);

  // Clean up stale PID file
  if (existsSync(PID_FILE)) {
    safeRemovePidFile();
  }

  spinner.text = "Starting Nova gateway...";

  try {
    // Ensure .nova directory exists
    mkdirSync(NOVA_DIR, { recursive: true });

    // Find gateway directory
    const gatewayPath = await findGatewayPath();
    if (!gatewayPath) {
      spinner.fail("Cannot find gateway directory");
      console.log(
        chalk.red("\n   Make sure you're in the Nova project directory\n"),
      );
      return;
    }

    // Create log file
    writeFileSync(
      LOG_FILE,
      `[${new Date().toISOString()}] Starting gateway with ${process.execPath} --import tsx src/index.ts\n`,
    );

    // Open log file for writing (use file descriptor for spawn stdio)
    const { openSync } = await import("fs");
    const logFd = openSync(LOG_FILE, "a");

    const daemonProcess = spawn(
      process.execPath,
      ["--import", "tsx", "src/index.ts"],
      {
      cwd: gatewayPath,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env },
      },
    );

    // Save PID
    writeFileSync(PID_FILE, daemonProcess.pid!.toString());
    daemonProcess.unref();

    // Wait for daemon to be healthy, not just alive
    const healthy = await waitForGatewayReady(daemonPort, 15000);
    if (healthy) {
      spinner.succeed("Gateway started successfully");
      console.log(chalk.gray(`\n   🔌 WebSocket: ws://127.0.0.1:${daemonPort}`));
      console.log(chalk.gray("   📝 Logs: ~/.nova/daemon.log"));
      console.log(chalk.gray(`   🆔 PID: ${getDaemonPid()}\n`));
      console.log(chalk.green("✅ Ready! Use 'nova chat' to connect\n"));
    } else {
      spinner.fail("Failed to start gateway");
      console.log(chalk.gray("\n   Check logs: nova daemon logs\n"));
      printKnownStartupHints();
    }
  } catch (error) {
    spinner.fail("Failed to start gateway");
    console.error(chalk.red("\nError:"), error);
  }
}

function printKnownStartupHints() {
  try {
    if (!existsSync(LOG_FILE)) return;
    const logTail = readFileSync(LOG_FILE, "utf-8").slice(-8000);

    if (
      logTail.includes("better_sqlite3.node") ||
      logTail.includes("ERR_DLOPEN_FAILED")
    ) {
      console.log(
        chalk.yellow(
          "   Detected native module mismatch (better-sqlite3). Rebuild dependencies with your current Node version:",
        ),
      );
      console.log(chalk.gray("     node -v"));
      console.log(chalk.gray("     npm rebuild better-sqlite3\n"));
    }
  } catch {
    // no-op
  }
}

async function stopDaemon(force: boolean = false) {
  const daemonPort = getDaemonPort();
  const pid = getDaemonPid();
  if (!pid && !force) {
    console.log(chalk.yellow("\n⚠️  Gateway is not running\n"));
    return;
  }

  const spinner = ora(
    force ? "Force stopping Nova gateway..." : "Stopping Nova gateway...",
  ).start();

  try {
    if (force) {
      // Kill anything on the port and clear state
      await killProcessOnPort(daemonPort);
    }

    // Try graceful shutdown first
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error: any) {
        if (error?.code !== "ESRCH") {
          throw error;
        }
      }

      // Wait for process to stop
      let attempts = 0;
      while (attempts < 10 && isDaemonProcessRunning()) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        attempts++;
      }

      // Force kill if still running
      if (isDaemonProcessRunning()) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error: any) {
          if (error?.code !== "ESRCH") {
            throw error;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Clean up PID file
    if (existsSync(PID_FILE)) {
      safeRemovePidFile();
    }

    spinner.succeed(force ? "Gateway force-stopped" : "Gateway stopped");
    console.log();
  } catch (error) {
    spinner.fail("Failed to stop gateway");
    console.error(chalk.red("\nError:"), error);

    // Try to clean up anyway
    if (existsSync(PID_FILE)) {
      safeRemovePidFile();
    }
  }
}

async function daemonStatus() {
  const daemonPort = getDaemonPort();
  const processRunning = isDaemonProcessRunning();
  const healthy = await isGatewayHealthy(daemonPort);
  const pid = getDaemonPid();

  console.log(chalk.cyan.bold("\n📊 Gateway Status\n"));

  if (processRunning && healthy && pid) {
    console.log(chalk.green("✅ Running\n"));
    console.log(chalk.gray(`   PID: ${pid}`));
    console.log(chalk.gray(`   Port: ${daemonPort}`));
    console.log(chalk.gray(`   WebSocket: ws://localhost:${daemonPort}`));
    console.log(chalk.gray(`   Logs: ${LOG_FILE}\n`));
    console.log(chalk.green(`   ✓ Port ${daemonPort} is healthy\n`));
  } else if (processRunning && pid) {
    console.log(chalk.yellow("⚠️  Process running but gateway is not healthy\n"));
    console.log(chalk.gray(`   PID: ${pid}`));
    console.log(chalk.gray(`   Expected Port: ${daemonPort}`));
    console.log(chalk.gray(`   Logs: ${LOG_FILE}\n`));
    printKnownStartupHints();
    console.log(chalk.gray("   Check logs: nova daemon logs --tail\n"));
  } else {
    console.log(chalk.red("❌ Not running\n"));
    console.log(chalk.gray("   Start with: nova daemon start\n"));
  }
}

async function daemonLogs(options?: { tail?: boolean; clear?: boolean }) {
  // Clear logs
  if (options?.clear) {
    if (existsSync(LOG_FILE)) {
      unlinkSync(LOG_FILE);
      console.log(chalk.green("\n✓ Log file cleared\n"));
    } else {
      console.log(chalk.gray("\nNo log file to clear\n"));
    }
    return;
  }

  console.log(chalk.cyan.bold("\n📜 Gateway Logs\n"));

  if (!existsSync(LOG_FILE)) {
    console.log(chalk.gray("No logs yet. Start the daemon first.\n"));
    return;
  }

  // Tail logs (follow in real-time)
  if (options?.tail) {
    console.log(chalk.gray("Following logs (Ctrl+C to stop)...\n"));

    const tail = spawn("tail", ["-f", LOG_FILE], {
      stdio: ["ignore", "inherit", "inherit"],
    });

    // Handle Ctrl+C
    process.on("SIGINT", () => {
      tail.kill();
      console.log(chalk.cyan("\n\n👋 Stopped following logs\n"));
      process.exit(0);
    });

    return;
  }

  // Show last 50 lines
  try {
    const logs = readFileSync(LOG_FILE, "utf-8");
    const lines = logs.split("\n").slice(-50);

    console.log(chalk.gray("Last 50 lines:\n"));
    console.log(lines.join("\n"));
    console.log();
    console.log(chalk.gray(`Full logs: ${LOG_FILE}`));
    console.log(chalk.gray("Tip: Use --tail to follow logs in real-time\n"));
  } catch (error) {
    console.error(chalk.red("Failed to read logs:"), error);
  }
}

function safeRemovePidFile(): void {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch (error: any) {
    // Stale/permission issues should not crash daemon management flows.
    if (error?.code !== "ENOENT") {
      console.log(
        chalk.yellow(
          `⚠️ Could not remove PID file (${error?.code || "unknown"}).`,
        ),
      );
    }
  }
}
