import chalk from "chalk";
import inquirer from "inquirer";
import WebSocket from "ws";
import { createHmac } from "crypto";
import { loadConfig } from "../utils/config.js";

interface WebCommandOptions {
  startUrl?: string;
  backend?: string;
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Connection timeout"));
    }, 7000);

    ws.once("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForResult(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Daemon response timeout"));
    }, 30000);

    const onMessage = (data: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed?.type === "result") {
          cleanup();
          resolve(parsed.result);
          return;
        }
        if (parsed?.type === "error") {
          cleanup();
          reject(new Error(String(parsed.message || "Unknown error")));
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };

    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

async function executeTool(tool: string, params: Record<string, unknown>): Promise<any> {
  const cfg = loadConfig();
  const ws = await connect(`ws://127.0.0.1:${cfg.daemonPort || 3000}/ws`);

  ws.send(
    JSON.stringify({
      type: "execute",
      tool,
      params,
    }),
  );

  try {
    return await waitForResult(ws);
  } finally {
    ws.close();
  }
}

function signApprovalToken(sessionId: string, actionDigest: string): string {
  const secret = process.env.NOVA_WEB_CONFIRM_SECRET || "nova-web-agent-local-secret";
  const payload = `${sessionId}:${actionDigest}`;
  return createHmac("sha256", secret)
    .update(payload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function webAgentCommand(
  action: string,
  profileId?: string,
  actionDigest?: string,
  options?: WebCommandOptions,
) {
  switch (String(action || "").trim().toLowerCase()) {
    case "bootstrap": {
      const id = String(profileId || "default").trim() || "default";

      console.log(chalk.cyan.bold("\n🌐 Web Profile Bootstrap\n"));
      console.log(chalk.gray(`Profile: ${id}`));
      console.log(chalk.gray("Opening a headed browser so you can sign in manually...\n"));

      const started = await executeTool("web_session_start", {
        profileId: id,
        headless: false,
        startUrl: options?.startUrl,
        backend: options?.backend,
      });

      console.log(chalk.green("Session started."));
      const backend = String(started?.session?.backend || "").trim();
      if (backend) {
        console.log(chalk.gray(`Backend: ${backend}`));
      }
      const liveViewUrl = String(started?.session?.liveViewUrl || "").trim();
      if (liveViewUrl) {
        console.log(chalk.gray(`Live view: ${liveViewUrl}`));
      }
      console.log(chalk.gray("Complete login/setup in the opened browser window."));

      await inquirer.prompt([
        {
          type: "input",
          name: "continue",
          message: "Press Enter after finishing profile login setup",
        },
      ]);

      await executeTool("web_session_end", {
        sessionId: started?.session?.sessionId || id,
      });

      console.log(chalk.green("\nProfile bootstrap complete.\n"));
      return;
    }

    case "approve": {
      const session = String(profileId || "").trim();
      const digest = String(actionDigest || "").trim();
      if (!session || !digest) {
        throw new Error("Usage: nova web approve <sessionId> <actionDigest>");
      }

      const token = signApprovalToken(session, digest);
      console.log(chalk.cyan("\nConfirmation token:"));
      console.log(token + "\n");
      return;
    }

    default:
      console.log(chalk.cyan.bold("\n🌐 Web Agent Utilities\n"));
      console.log("Usage: nova web <action>\n");
      console.log("Actions:");
      console.log("  " + chalk.bold("bootstrap [profileId]") + "   Open headed browser for one-time profile login");
      console.log("  " + chalk.bold("approve <sessionId> <actionDigest>") + "   Generate high-risk action confirmation token");
      console.log("\nOptions:");
      console.log("  " + chalk.gray("--start-url <url>") + "   Optional URL for bootstrap start page\n");
      console.log("  " + chalk.gray("--backend <auto|steel|browserbase|local>") + "   Optional browser backend override\n");
  }
}
