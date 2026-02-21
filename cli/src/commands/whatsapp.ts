import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

function resolveBrowserPath(): string | undefined {
  const puppeteerCache = join(homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(puppeteerCache)) {
    try {
      const versions = readdirSync(puppeteerCache);
      for (const ver of versions) {
        const macPath = join(
          puppeteerCache,
          ver,
          "chrome-mac-arm64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        );
        if (existsSync(macPath)) return macPath;
        const macIntelPath = join(
          puppeteerCache,
          ver,
          "chrome-mac-x64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        );
        if (existsSync(macIntelPath)) return macIntelPath;
        const linuxPath = join(puppeteerCache, ver, "chrome-linux64", "chrome");
        if (existsSync(linuxPath)) return linuxPath;
      }
    } catch {
      /* ignore */
    }
  }
  const systemPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const p of systemPaths) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

const NOVA_DIR = join(homedir(), ".nova");
const ENV_PATH = join(NOVA_DIR, ".env");
const AUTH_PATH = join(NOVA_DIR, "whatsapp-auth");

export async function whatsappCommand(action?: string): Promise<void> {
  switch ((action || "").toLowerCase()) {
    case "setup":
      await setupWhatsApp();
      return;
    case "status":
      showStatus();
      return;
    case "disable":
      disableWhatsApp();
      return;
    default:
      showHelp();
  }
}

async function setupWhatsApp(): Promise<void> {
  ensureNovaDir();
  const env = readEnv();

  console.log(chalk.cyan.bold("\n💬 WhatsApp Setup\n"));

  // Pre-check: ensure a browser is available
  const browserPath = resolveBrowserPath();
  if (!browserPath) {
    console.log(
      chalk.yellow("⚠️  No Chrome or Chromium browser found on your system."),
    );
    console.log(
      chalk.gray("WhatsApp Web requires a Chrome-based browser to run.\n"),
    );

    const { shouldDownload } = await inquirer.prompt([
      {
        type: "confirm",
        name: "shouldDownload",
        message: "Download Chromium automatically? (~170MB)",
        default: true,
      },
    ]);

    if (!shouldDownload) {
      console.log(
        chalk.gray(
          "\nYou can install Chrome manually from https://google.com/chrome",
        ),
      );
      console.log(chalk.gray("Then run `nova whatsapp setup` again.\n"));
      return;
    }

    const dlSpinner = ora("Downloading Chromium...").start();
    try {
      const { execSync } = await import("child_process");
      execSync("npx -y @puppeteer/browsers install chrome@stable", {
        stdio: "pipe",
        timeout: 5 * 60 * 1000,
      });
      dlSpinner.succeed("Chromium downloaded");
    } catch (error: any) {
      dlSpinner.fail("Chromium download failed");
      console.log(chalk.red(error?.message || "Unknown error"));
      console.log(
        chalk.gray(
          "\nAlternatively, install Google Chrome from https://google.com/chrome",
        ),
      );
      console.log(chalk.gray("Then run `nova whatsapp setup` again.\n"));
      return;
    }
  }

  const { isOwnNumber } = await inquirer.prompt([
    {
      type: "confirm",
      name: "isOwnNumber",
      message:
        "Is this your personal WhatsApp number? (Nova will prefix its messages with 'Nova:')",
      default: true,
    },
  ]);

  const { ownerNumber } = await inquirer.prompt([
    {
      type: "input",
      name: "ownerNumber",
      message: isOwnNumber
        ? "Your phone number (with country code, no +):"
        : "Your phone number (so Nova can recognize you, with country code, no +):",
      default: env.NOVA_WHATSAPP_OWNER_NUMBER || "",
      validate: (input: string) => {
        const cleaned = input.replace(/\D/g, "");
        if (cleaned.length < 7) return "Enter a valid phone number";
        return true;
      },
    },
  ]);

  const { ownerName } = await inquirer.prompt([
    {
      type: "input",
      name: "ownerName",
      message: "Your name (so Nova knows how to refer to you):",
      default: env.NOVA_WHATSAPP_OWNER_NAME || "",
    },
  ]);

  // Allowed list only applies in bot-number mode
  let allowedNumbers = "";
  if (!isOwnNumber) {
    const { addAllowed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "addAllowed",
        message:
          "Allow other numbers to chat with Nova? (You can add/change later)",
        default: false,
      },
    ]);

    if (addAllowed) {
      const { numbers } = await inquirer.prompt([
        {
          type: "input",
          name: "numbers",
          message: "Allowed numbers (comma-separated, with country code):",
          default: env.NOVA_WHATSAPP_ALLOWED_NUMBERS || "",
        },
      ]);
      allowedNumbers = numbers;
    }
  }

  // Save config
  const nextEnv: Record<string, string> = {
    ...env,
    NOVA_WHATSAPP_ENABLED: "true",
    NOVA_WHATSAPP_OWNER_NUMBER: ownerNumber.replace(/\D/g, ""),
    NOVA_WHATSAPP_IS_OWN_NUMBER: String(isOwnNumber),
  };

  if (ownerName) {
    nextEnv.NOVA_WHATSAPP_OWNER_NAME = ownerName.trim();
  }

  if (allowedNumbers) {
    nextEnv.NOVA_WHATSAPP_ALLOWED_NUMBERS = allowedNumbers
      .split(",")
      .map((n: string) => n.trim().replace(/\D/g, ""))
      .filter(Boolean)
      .join(",");
  }

  writeEnv(nextEnv);

  // Stop daemon to release WhatsApp session lock
  try {
    const { execSync } = await import("child_process");
    const pidFile = join(NOVA_DIR, "daemon.pid");
    if (existsSync(pidFile)) {
      console.log(chalk.gray("Stopping daemon to release WhatsApp session..."));
      execSync("nova daemon stop", { stdio: "pipe", timeout: 10000 });
    }
  } catch {
    // Daemon might not be running, that's fine
  }

  // Now connect WhatsApp and show QR code
  console.log(chalk.yellow("\n📱 Connecting to WhatsApp...\n"));
  console.log(
    chalk.gray(
      "A QR code will appear below — scan it with your WhatsApp app.\n",
    ),
  );

  const spinner = ora("Launching WhatsApp Web...").start();

  try {
    const wwjs = await import("whatsapp-web.js");
    const mod = (wwjs as any).default || wwjs;
    const WAClient = mod.Client;
    const WALocalAuth = mod.LocalAuth;

    const browserPath = resolveBrowserPath();
    const client = new WAClient({
      authStrategy: new WALocalAuth({ dataPath: AUTH_PATH }),
      puppeteer: {
        headless: true,
        ...(browserPath ? { executablePath: browserPath } : {}),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          client.destroy().catch(() => {});
          reject(new Error("Connection timeout (3 minutes). Try again."));
        },
        3 * 60 * 1000,
      );

      client.on("qr", async (qr: string) => {
        spinner.stop();
        console.log(chalk.cyan.bold("📸 Scan this QR code with WhatsApp:\n"));
        try {
          const qrcodeTerminal = await import("qrcode-terminal");
          (qrcodeTerminal as any).default.generate(qr, { small: true });
        } catch {
          console.log("QR data:", qr);
        }
        console.log(chalk.gray("\nWaiting for scan...\n"));
      });

      client.on("ready", () => {
        clearTimeout(timeout);
        spinner.succeed("WhatsApp connected!");
        // Gracefully close — session is saved by LocalAuth
        client.destroy().catch(() => {});
        resolve();
      });

      client.on("auth_failure", (msg: string) => {
        clearTimeout(timeout);
        client.destroy().catch(() => {});
        reject(new Error(`Auth failed: ${msg}`));
      });

      client.initialize().catch(reject);
    });

    console.log(chalk.green("\n✅ WhatsApp setup complete\n"));
    console.log(chalk.gray(`Owner: ${nextEnv.NOVA_WHATSAPP_OWNER_NUMBER}`));
    console.log(chalk.gray(`Own number: ${isOwnNumber}`));
    if (allowedNumbers) {
      console.log(
        chalk.gray(`Allowed: ${nextEnv.NOVA_WHATSAPP_ALLOWED_NUMBERS}`),
      );
    }
    // Auto-restart daemon
    await restartDaemon();
  } catch (error: any) {
    spinner.fail("WhatsApp connection failed");
    console.error(chalk.red(error?.message || "Unknown error"));
    console.log(chalk.gray("\nYour config was saved. You can try again with:"));
    console.log(chalk.gray("  nova whatsapp setup\n"));
    // Restart daemon even on failure (we stopped it earlier)
    await restartDaemon();
  }
}

async function restartDaemon(): Promise<void> {
  try {
    const { execSync } = await import("child_process");
    console.log(chalk.gray("\nStarting daemon..."));
    execSync("nova daemon start", { stdio: "pipe", timeout: 15000 });
    console.log(chalk.green("✔ Daemon started\n"));
  } catch {
    console.log(
      chalk.yellow("\nRun `nova daemon start` to activate WhatsApp.\n"),
    );
  }
}

function showStatus(): void {
  const env = readEnv();
  const hasSession = existsSync(AUTH_PATH);

  console.log(chalk.cyan.bold("\n💬 WhatsApp Status\n"));
  console.log(
    `Enabled: ${env.NOVA_WHATSAPP_ENABLED === "true" ? chalk.green("yes") : chalk.red("no")}`,
  );
  console.log(
    `Owner: ${env.NOVA_WHATSAPP_OWNER_NUMBER || chalk.red("(not set)")}`,
  );
  console.log(
    `Owner name: ${env.NOVA_WHATSAPP_OWNER_NAME || chalk.gray("(not set)")}`,
  );
  console.log(
    `Own number: ${env.NOVA_WHATSAPP_IS_OWN_NUMBER === "true" ? "yes" : "no"}`,
  );
  console.log(
    `Allowed: ${env.NOVA_WHATSAPP_ALLOWED_NUMBERS || "(owner only)"}`,
  );
  console.log(
    `Session: ${hasSession ? chalk.green("saved") : chalk.yellow("not connected")}`,
  );
  console.log();
}

function disableWhatsApp(): void {
  ensureNovaDir();
  const env = readEnv();
  delete env.NOVA_WHATSAPP_ENABLED;
  delete env.NOVA_WHATSAPP_OWNER_NUMBER;
  delete env.NOVA_WHATSAPP_IS_OWN_NUMBER;
  delete env.NOVA_WHATSAPP_ALLOWED_NUMBERS;
  writeEnv(env);
  console.log(chalk.green("\n✅ WhatsApp disabled\n"));
  console.log(chalk.yellow("Restart the daemon for changes to take effect."));
  console.log(chalk.gray("  nova daemon restart\n"));
}

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const map: Record<string, string> = {};
  const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep <= 0) continue;
    map[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
  }
  return map;
}

function writeEnv(env: Record<string, string>): void {
  ensureNovaDir();
  const lines = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(ENV_PATH, lines.join("\n") + "\n");
}

function ensureNovaDir(): void {
  mkdirSync(NOVA_DIR, { recursive: true });
}

function showHelp(): void {
  console.log(chalk.cyan.bold("\n💬 WhatsApp Commands\n"));
  console.log("Usage: nova whatsapp <action>\n");
  console.log(chalk.gray("Connect WhatsApp to Nova.\n"));
  console.log("Actions:");
  console.log("  setup     Configure and connect WhatsApp");
  console.log("  status    Show connection status");
  console.log("  disable   Remove WhatsApp config\n");
}
