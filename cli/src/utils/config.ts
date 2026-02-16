import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface NovaConfig {
  defaultModel: string;
  defaultProvider: string;
  memoryPath: string;
  daemonPort: number;
  logLevel?: string;
  notificationEmail?: string;
  telegramEnabled?: boolean;
  telegramOwnerUserId?: number;
  telegramOwnerChatId?: number;
}

export function loadConfig(): NovaConfig {
  const configPath = join(homedir(), ".nova", "config.json");

  if (!existsSync(configPath)) {
    // Return default config
    return {
      defaultModel: "gpt-4o-mini",
      defaultProvider: "openai",
      memoryPath: join(homedir(), ".nova", "memory.db"),
      daemonPort: 3000,
      logLevel: "info",
      notificationEmail: undefined,
      telegramEnabled: false,
      telegramOwnerUserId: undefined,
      telegramOwnerChatId: undefined,
    };
  }

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return config;
  } catch (error) {
    throw new Error(`Failed to load config: ${error}`);
  }
}
