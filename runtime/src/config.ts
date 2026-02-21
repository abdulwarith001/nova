import { config } from "dotenv";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

/**
 * Load environment variables from ~/.nova/.env and set default timezone.
 * Safe to call multiple times — only loads once.
 */
let envLoaded = false;
export function ensureEnvLoaded(): void {
  if (envLoaded) return;
  config({ path: join(homedir(), ".nova", ".env") });
  if (!process.env.TZ) {
    process.env.TZ = "Africa/Lagos";
  }
  envLoaded = true;
}

/**
 * Load the Nova config file (~/.nova/config.json).
 * Returns an empty object if the file doesn't exist or is invalid.
 */
export function loadNovaConfig(): Record<string, unknown> {
  const configPath = join(homedir(), ".nova", "config.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}
