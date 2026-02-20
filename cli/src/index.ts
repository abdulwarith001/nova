#!/usr/bin/env node
import { program } from "commander";
import chalk from "chalk";

// Import commands
import { initCommand } from "./commands/init.js";
import { chatCommand } from "./commands/chat.js";
import { daemonCommand } from "./commands/daemon.js";
import { runCommand } from "./commands/run.js";
import { telegramCommand } from "./commands/telegram.js";
import { braveCommand } from "./commands/brave.js";
import { googleCommand } from "./commands/google.js";
import { whatsappCommand } from "./commands/whatsapp.js";
import { webAgentCommand } from "./commands/web-agent.js";

program
  .name("nova")
  .description(chalk.cyan("🚀 Nova AI Agent CLI"))
  .version("0.1.0");

// Onboarding
program
  .command("init")
  .description("Initialize Nova configuration")
  .action(initCommand);

// Chat
program
  .command("chat")
  .description("Start interactive chat with Nova")
  .option(
    "-a, --agent <role>",
    "Chat with specific agent role (researcher|coder|analyst)",
  )
  .option("--no-progress", "Disable live progress updates while waiting")
  .action(chatCommand);

// Daemon management
program
  .command("daemon <action>")
  .description("Manage Nova daemon (start|stop|status|logs|restart)")
  .option("--tail", "Follow logs in real-time")
  .option("--clear", "Clear log file")
  .option("--force", "Force stop and clear daemon state")
  .action(async (action, options) => {
    return daemonCommand(action, options);
  });

// Quick actions
program
  .command("run <task>")
  .description("Execute a one-time task")
  .action(runCommand);

program
  .command("telegram [action]")
  .description("Manage Telegram channel (setup|status|disable|test)")
  .action(async (action?: string) => {
    return telegramCommand(action);
  });

program
  .command("brave [action]")
  .description("Manage Brave Search API (setup|status|disable|test)")
  .action(async (action?: string) => {
    return braveCommand(action);
  });

program
  .command("google [action]")
  .description("Manage Google Workspace (setup|status|disable|test)")
  .action(async (action?: string) => {
    return googleCommand(action);
  });

program
  .command("whatsapp [action]")
  .description("Manage WhatsApp connection (setup|status|disable)")
  .action(async (action?: string) => {
    return whatsappCommand(action);
  });

program
  .command("web [action] [arg1] [arg2]")
  .description("Web-agent utilities (bootstrap|approve)")
  .option("--start-url <url>", "Optional URL for profile bootstrap")
  .option(
    "--backend <backend>",
    "Browser backend override (auto|steel|browserbase|local)",
  )
  .action(
    async (
      action?: string,
      arg1?: string,
      arg2?: string,
      command?: { startUrl?: string; backend?: string },
    ) => {
      return webAgentCommand(action || "", arg1, arg2, {
        startUrl: command?.startUrl,
        backend: command?.backend,
      });
    },
  );

// Management commands
program
  .command("memory [action] [args...]")
  .description(
    "Manage memory (status|user|agent|list|search|delete|forget|export)",
  )
  .action(async (action?: string, args?: string[]) => {
    const { memoryCommand } = await import("./commands/memory.js");
    return memoryCommand(action, args);
  });

program
  .command("config [action] [key] [value]")
  .description("Manage configuration (show|get|set|edit)")
  .action(async (action?: string, key?: string, value?: string) => {
    const { configCommand } = await import("./commands/config.js");
    return configCommand(action, key, value);
  });

program
  .command("reasoning")
  .description("View agent reasoning logs")
  .option("-t, --tail", "Follow logs in real-time")
  .option("-n, --lines <count>", "Number of lines to show (default: 50)")
  .option("--clear", "Clear the reasoning log")
  .action(async (options) => {
    const { reasoningCommand } = await import("./commands/reasoning.js");
    return reasoningCommand(options);
  });

// Parse arguments
program.parse();
