import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import http from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { google } from "googleapis";

const NOVA_DIR = join(homedir(), ".nova");
const ENV_PATH = join(NOVA_DIR, ".env");
const OAUTH_PORT = 18790;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
];

export async function googleCommand(action?: string): Promise<void> {
  switch ((action || "").toLowerCase()) {
    case "setup":
      await setupGoogle();
      return;
    case "status":
      await googleStatus();
      return;
    case "disable":
      await disableGoogle();
      return;
    case "test":
      await testGoogle();
      return;
    default:
      showHelp();
  }
}

async function setupGoogle(): Promise<void> {
  ensureNovaDir();
  const env = readEnv();

  console.log(chalk.cyan.bold("\n🔑 Google Workspace Setup\n"));
  console.log(chalk.gray("Steps to get OAuth credentials:"));
  console.log(
    chalk.gray("1. Go to https://console.cloud.google.com/apis/credentials"),
  );
  console.log(chalk.gray("2. Create a new project (or select existing)"));
  console.log(
    chalk.gray("3. Enable these APIs: Gmail API, Calendar API, Drive API"),
  );
  console.log(
    chalk.gray("4. Go to 'OAuth consent screen' → External → Create"),
  );
  console.log(
    chalk.gray("5. Go to 'Credentials' → Create Credentials → OAuth client ID"),
  );
  console.log(chalk.gray("6. Application type: 'Desktop app'"));
  console.log(chalk.gray("7. Copy the Client ID and Client Secret\n"));

  const { clientId, clientSecret } = await inquirer.prompt([
    {
      type: "input",
      name: "clientId",
      message: "Google Client ID:",
      default: env.GOOGLE_CLIENT_ID || "",
      validate: (input: string) =>
        input.trim().length > 0 ? true : "Client ID is required",
    },
    {
      type: "password",
      name: "clientSecret",
      message: "Google Client Secret:",
      default: env.GOOGLE_CLIENT_SECRET || "",
      validate: (input: string) =>
        input.trim().length > 0 ? true : "Client Secret is required",
    },
  ]);

  const oauth2Client = new google.auth.OAuth2(
    clientId.trim(),
    clientSecret.trim(),
    `http://localhost:${OAUTH_PORT}/oauth/callback`,
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log(
    chalk.yellow("\n📋 Open this URL in your browser to authorize Nova:\n"),
  );
  console.log(chalk.blue.underline(authUrl));
  console.log(
    chalk.gray(
      "\nWaiting for authorization callback on port " + OAUTH_PORT + "...\n",
    ),
  );

  // Try to open browser automatically
  try {
    const open = (await import("open")).default;
    await open(authUrl);
  } catch {
    // If open fails, user can manually open the URL
  }

  // Start callback server
  const authCode = await waitForAuthCode();

  const spinner = ora("Exchanging authorization code for tokens...").start();
  try {
    const { tokens } = await oauth2Client.getToken(authCode);
    if (!tokens.refresh_token) {
      spinner.fail(
        "No refresh token received. Try revoking access at https://myaccount.google.com/permissions and running setup again.",
      );
      return;
    }

    oauth2Client.setCredentials(tokens);

    // Get user email
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email || "unknown";

    spinner.succeed(`Authorized as ${chalk.bold(email)}`);

    const nextEnv: Record<string, string> = {
      ...env,
      GOOGLE_CLIENT_ID: clientId.trim(),
      GOOGLE_CLIENT_SECRET: clientSecret.trim(),
      GOOGLE_REFRESH_TOKEN: tokens.refresh_token,
    };
    writeEnv(nextEnv);

    console.log(chalk.green("\n✅ Google Workspace setup complete\n"));
    console.log(chalk.gray(`Email: ${email}`));
    console.log(chalk.gray("Services: Gmail, Calendar, Drive (read-only)\n"));
    console.log(chalk.yellow("Restart the gateway to activate:"));
    console.log(chalk.gray("  nova daemon restart\n"));
  } catch (error: any) {
    spinner.fail("Failed to exchange auth code");
    console.error(chalk.red(error?.message || "Unknown error"));
  }
}

function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${OAUTH_PORT}`);
      if (url.pathname === "/oauth/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "content-type": "text/html" });
          res.end(
            "<h1>Authorization denied</h1><p>You can close this window.</p>",
          );
          server.close();
          reject(new Error(`Authorization denied: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { "content-type": "text/html" });
          res.end(
            "<h1>✅ Nova authorized!</h1><p>You can close this window and return to the terminal.</p>",
          );
          server.close();
          resolve(code);
          return;
        }

        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Missing authorization code");
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(OAUTH_PORT, () => {
      // Server ready
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        server.close();
        reject(new Error("Authorization timeout (5 minutes)"));
      },
      5 * 60 * 1000,
    );
  });
}

async function googleStatus(): Promise<void> {
  const env = readEnv();
  const clientId = env.GOOGLE_CLIENT_ID;
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;

  console.log(chalk.cyan.bold("\n🔑 Google Workspace Status\n"));
  console.log(
    `Client ID: ${clientId ? maskKey(clientId) : chalk.red("(not set)")}`,
  );
  console.log(
    `Refresh Token: ${refreshToken ? maskKey(refreshToken) : chalk.red("(not set)")}`,
  );

  if (clientId && env.GOOGLE_CLIENT_SECRET && refreshToken) {
    const spinner = ora("Checking Google API connectivity...").start();
    try {
      const oauth2Client = new google.auth.OAuth2(
        clientId,
        env.GOOGLE_CLIENT_SECRET,
        `http://localhost:${OAUTH_PORT}/oauth/callback`,
      );
      oauth2Client.setCredentials({ refresh_token: refreshToken });

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: "me" });
      spinner.succeed(`Connected as ${profile.data.emailAddress}`);
    } catch (error: any) {
      spinner.fail(`Connection failed: ${error?.message || "Unknown error"}`);
    }
  } else {
    console.log(chalk.yellow("\nRun `nova google setup` to connect.\n"));
  }
  console.log();
}

async function disableGoogle(): Promise<void> {
  ensureNovaDir();
  const env = readEnv();
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
  delete env.GOOGLE_REFRESH_TOKEN;
  writeEnv(env);
  console.log(chalk.green("\n✅ Google credentials removed\n"));
  console.log(chalk.yellow("Restart the gateway for changes to take effect."));
  console.log(chalk.gray("  nova daemon restart\n"));
}

async function testGoogle(): Promise<void> {
  const env = readEnv();
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REFRESH_TOKEN
  ) {
    console.log(
      chalk.red("\n❌ Google not configured. Run `nova google setup`.\n"),
    );
    return;
  }

  const oauth2Client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    `http://localhost:${OAUTH_PORT}/oauth/callback`,
  );
  oauth2Client.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });

  console.log(chalk.cyan.bold("\n🧪 Google Workspace Test\n"));

  // Test Gmail
  const gmailSpinner = ora("Testing Gmail...").start();
  try {
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const messages = await gmail.users.messages.list({
      userId: "me",
      maxResults: 3,
    });
    gmailSpinner.succeed(
      `Gmail: ${messages.data.resultSizeEstimate || 0} messages accessible`,
    );
  } catch (error: any) {
    gmailSpinner.fail(`Gmail: ${error?.message || "failed"}`);
  }

  // Test Calendar
  const calSpinner = ora("Testing Calendar...").start();
  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const events = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults: 1,
    });
    calSpinner.succeed(
      `Calendar: ${events.data.items?.length || 0} upcoming events`,
    );
  } catch (error: any) {
    calSpinner.fail(`Calendar: ${error?.message || "failed"}`);
  }

  // Test Drive
  const driveSpinner = ora("Testing Drive...").start();
  try {
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const files = await drive.files.list({ pageSize: 1 });
    driveSpinner.succeed(
      `Drive: accessible (${files.data.files?.length || 0}+ files)`,
    );
  } catch (error: any) {
    driveSpinner.fail(`Drive: ${error?.message || "failed"}`);
  }

  console.log();
}

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const map: Record<string, string> = {};
  const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) map[key] = value;
  }
  return map;
}

function writeEnv(env: Record<string, string>): void {
  ensureNovaDir();
  const lines = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  writeFileSync(ENV_PATH, lines.join("\n") + "\n");
}

function ensureNovaDir(): void {
  mkdirSync(NOVA_DIR, { recursive: true });
}

function maskKey(key: string): string {
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function showHelp(): void {
  console.log(chalk.cyan.bold("\n🔑 Google Workspace Commands\n"));
  console.log("Usage: nova google <action>\n");
  console.log(chalk.gray("Connect Gmail, Calendar, and Drive to Nova.\n"));
  console.log("Actions:");
  console.log("  setup     Connect Google account via OAuth");
  console.log("  status    Check connection and credentials");
  console.log("  disable   Remove Google credentials");
  console.log("  test      Test Gmail, Calendar, and Drive access\n");
}
