import chalk from "chalk";
import inquirer from "inquirer";
import { encrypt } from "../utils/encryption.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createServer } from "http";
import { google } from "googleapis";
import open from "open";

const CONFIG_DIR = join(homedir(), ".nova");
const ENV_FILE = join(CONFIG_DIR, ".env");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Interactive Gmail OAuth setup
 */
export async function emailSetup() {
  console.log(chalk.cyan.bold("\n📧 Gmail API Setup\n"));
  console.log(chalk.gray("This will set up Gmail API access for Nova.\n"));

  // Step 1: Get Google Cloud credentials
  console.log(chalk.yellow("Step 1: Google Cloud Credentials"));
  console.log(
    chalk.gray(
      "You need OAuth credentials from Google Cloud Console:\n" +
        "  1. Go to https://console.cloud.google.com\n" +
        "  2. Create a project (or use existing)\n" +
        "  3. Enable Gmail API\n" +
        "  4. Create OAuth 2.0 Client ID (Desktop app)\n" +
        "  5. Copy Client ID and Client Secret\n",
    ),
  );

  const { clientId, clientSecret } = await inquirer.prompt([
    {
      type: "input",
      name: "clientId",
      message: "Enter your Google Cloud Client ID:",
      validate: (input) => input.length > 0 || "Client ID is required",
    },
    {
      type: "password",
      name: "clientSecret",
      message: "Enter your Google Cloud Client Secret:",
      validate: (input) => input.length > 0 || "Client Secret is required",
    },
  ]);

  // Step 2: OAuth flow
  console.log(chalk.yellow("\nStep 2: Authorization"));
  console.log(chalk.gray("Opening browser for Google authorization...\n"));

  try {
    const refreshToken = await performOAuthFlow(clientId, clientSecret);

    // Step 3: Encrypt and save
    console.log(chalk.yellow("\nStep 3: Saving Credentials"));

    const encryptedClientId = encrypt(clientId);
    const encryptedClientSecret = encrypt(clientSecret);
    const encryptedRefreshToken = encrypt(refreshToken);

    // Read existing .env file
    let envContent = "";
    if (existsSync(ENV_FILE)) {
      envContent = readFileSync(ENV_FILE, "utf-8");
    }

    // Update or add Gmail credentials
    const lines = envContent.split("\n");
    const updatedLines = lines.filter(
      (line) =>
        !line.startsWith("GMAIL_CLIENT_ID=") &&
        !line.startsWith("GMAIL_CLIENT_SECRET=") &&
        !line.startsWith("GMAIL_REFRESH_TOKEN="),
    );

    updatedLines.push(`GMAIL_CLIENT_ID=${encryptedClientId}`);
    updatedLines.push(`GMAIL_CLIENT_SECRET=${encryptedClientSecret}`);
    updatedLines.push(`GMAIL_REFRESH_TOKEN=${encryptedRefreshToken}`);

    writeFileSync(ENV_FILE, updatedLines.join("\n") + "\n");

    // Step 4: Optional notification email
    const { notificationEmail } = await inquirer.prompt([
      {
        type: "input",
        name: "notificationEmail",
        message: "Default notification email (optional):",
      },
    ]);

    if (notificationEmail && notificationEmail.trim()) {
      // Read or initialize config file
      let config: Record<string, unknown> = {};
      if (existsSync(CONFIG_FILE)) {
        try {
          config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
        } catch {
          config = {};
        }
      }

      config.notificationEmail = notificationEmail.trim();
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }

    console.log(chalk.green("\n✓ Gmail setup complete!"));
    console.log(chalk.gray(`\nCredentials saved to: ${ENV_FILE}`));
    console.log(chalk.gray("All tokens are encrypted with machine-specific keys.\n"));

    if (notificationEmail && notificationEmail.trim()) {
      console.log(
        chalk.gray(`Default reminder email: ${notificationEmail.trim()}`),
      );
    } else {
      console.log(
        chalk.gray(
          "You can set a default reminder email anytime:\n  nova config set notificationEmail you@example.com",
        ),
      );
    }

    console.log(chalk.cyan("\nYou can now use email tools in Nova:"));
    console.log(chalk.gray('  - "Check my unread emails"'));
    console.log(chalk.gray('  - "Send an email to john@example.com"'));
    console.log(chalk.gray('  - "Search for emails from my boss"\n'));
  } catch (error) {
    console.error(
      chalk.red("\n✗ Setup failed:"),
      error instanceof Error ? error.message : error,
    );
    console.log(chalk.gray("\nPlease try again.\n"));
    process.exit(1);
  }
}

/**
 * Perform OAuth flow with local callback server
 */
async function performOAuthFlow(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const REDIRECT_URI = "http://localhost:18790/oauth/callback";
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    REDIRECT_URI,
  );

  // Generate authorization URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    prompt: "consent", // Force consent to get refresh token
  });

  console.log(chalk.gray("Opening browser to authorize Nova...\n"));

  // Start local server to receive callback
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (req.url?.startsWith("/oauth/callback")) {
        const url = new URL(req.url, "http://localhost:18790");
        const code = url.searchParams.get("code");

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            "<h1>Error</h1><p>Authorization code not found.</p><p>You can close this window.</p>",
          );
          server.close();
          reject(new Error("Authorization code not received"));
          return;
        }

        try {
          // Exchange code for tokens
          const { tokens } = await oauth2Client.getToken(code);
          if (!tokens.refresh_token) {
            throw new Error("No refresh token received");
          }

          // Send success page
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<h1>Success!</h1><p>Gmail authorized successfully.</p><p>You can close this window and return to the terminal.</p>",
          );

          server.close();
          resolve(tokens.refresh_token);
        } catch (error) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(
            "<h1>Error</h1><p>Failed to exchange authorization code.</p><p>You can close this window.</p>",
          );
          server.close();
          reject(error);
        }
      }
    });

    server.listen(18790, () => {
      // Open browser
      open(authUrl).catch(() => {
        console.log(chalk.yellow("Could not open browser automatically.\n"));
        console.log(chalk.cyan("Please open this URL in your browser:\n"));
        console.log(chalk.blue(authUrl + "\n"));
      });
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth flow timed out after 5 minutes"));
    }, 5 * 60 * 1000);
  });
}
