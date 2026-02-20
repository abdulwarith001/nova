import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { config } from "dotenv";
import { homedir } from "os";
import { join } from "path";
import {
  ActionExecutor,
  ProfileAssignmentStore,
  type WebBackendPreference,
  WebAgentOrchestrator,
  WebSessionManager,
  WebWorldModelStore,
  type ObservationMode,
  type WebAction,
} from "./web-agent/index.js";

config({ path: join(homedir(), ".nova", ".env") });

interface ToolExecutionContext {
  sessionId?: string;
}

interface ToolExecution {
  toolName: string;
  parameters: Record<string, unknown>;
  context?: ToolExecutionContext;
}

const sessionManager = new WebSessionManager();
const actionExecutor = new ActionExecutor(sessionManager);
const worldModels = new WebWorldModelStore();
const webOrchestrator = new WebAgentOrchestrator();
const profileAssignments = new ProfileAssignmentStore();

export default async function (execution: ToolExecution): Promise<unknown> {
  const { toolName, parameters } = execution;
  const sessionId = resolveSessionId(execution);
  const worldModel = worldModels.forSession(sessionId);

  switch (toolName) {
    case "web_session_start":
      return await executeWebSessionStart(sessionId, parameters);

    case "web_observe": {
      const mode = String(parameters.mode || "dom+vision") as ObservationMode;
      const includeScreenshot = parameters.includeScreenshot === true;
      const observation = await actionExecutor.observe(
        sessionId,
        mode === "dom" ? "dom" : "dom+vision",
        includeScreenshot,
      );
      worldModel.addObservation(observation);
      return {
        sessionId,
        observation,
      };
    }

    case "web_decide_next": {
      const goal = String(parameters.goal || "").trim();
      if (!goal) throw new Error("Missing goal parameter");

      const decision = webOrchestrator.decideNext({
        goal,
        observation: worldModel.getLatestObservation(),
        worldModel,
        mode: String(parameters.mode || "dom+vision") as ObservationMode,
      });
      return {
        sessionId,
        decision,
        world: worldModel.summary(),
      };
    }

    case "web_act": {
      const action = normalizeAction(parameters);
      const confirmationToken =
        typeof parameters.confirmationToken === "string"
          ? parameters.confirmationToken.trim()
          : undefined;

      try {
        const result = await actionExecutor.execute(sessionId, action, {
          confirmationToken,
          mode:
            String(parameters.mode || "dom+vision") === "dom"
              ? "dom"
              : "dom+vision",
          currentObservation: worldModel.getLatestObservation(),
        });
        worldModel.addAction(action, true);

        const maybeObservation = result.data?.observation;
        if (
          maybeObservation &&
          typeof maybeObservation === "object" &&
          !Array.isArray(maybeObservation)
        ) {
          worldModel.addObservation(maybeObservation as any);
        }

        return {
          sessionId,
          ...result,
          world: worldModel.summary(),
        };
      } catch (error) {
        worldModel.addAction(action, false);
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("CONFIRMATION_REQUIRED:")) {
          const raw = message.slice("CONFIRMATION_REQUIRED:".length);
          let details: Record<string, unknown> = {};
          try {
            details = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            details = { message: raw };
          }

          return {
            sessionId,
            success: false,
            action,
            needsConfirmation: true,
            risk: "high",
            confirmationRequired: details,
          };
        }
        throw error;
      }
    }

    case "web_search": {
      const query = String(parameters.query || parameters.value || "").trim();
      if (!query) throw new Error("Missing query parameter");
      const result = await actionExecutor.search(sessionId, query, {
        limit: Number(parameters.limit || 8),
        timeoutMs: Number(parameters.timeoutMs || 45_000),
      });
      worldModel.addNote(`search:${query}`);
      return result;
    }

    case "web_extract_structured": {
      const url =
        typeof parameters.url === "string" && parameters.url.trim()
          ? parameters.url.trim()
          : undefined;
      const extracted = await actionExecutor.extractStructured(sessionId, url);
      return extracted;
    }

    case "web_session_end": {
      const result = await sessionManager.endSession(sessionId);
      worldModels.delete(sessionId);
      return result;
    }

    case "bash":
      return executeBash(parameters);
    case "read":
      return executeRead(parameters);
    case "write":
      return executeWrite(parameters);
    case "curl":
      return await executeCurl(parameters);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

async function executeWebSessionStart(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const assignedProfileId = profileAssignments.get(sessionId);
  const profileId = resolveWebProfileId(
    params,
    sessionId,
    assignedProfileId,
    process.env.NOVA_WEB_PROFILE_ID,
  );
  profileAssignments.set(sessionId, profileId);
  const headless = resolveWebHeadless(params);
  const viewport = isObject(params.viewport)
    ? {
        width: Number((params.viewport as Record<string, unknown>).width || 1366),
        height: Number((params.viewport as Record<string, unknown>).height || 900),
      }
    : { width: 1366, height: 900 };

  const locale = String(params.locale || process.env.NOVA_WEB_LOCALE || "en-US");
  const timezone = String(
    params.timezone ||
      process.env.NOVA_WEB_TIMEZONE ||
      process.env.TZ ||
      "America/New_York",
  );

  const startUrl =
    typeof params.startUrl === "string" && params.startUrl.trim()
      ? params.startUrl.trim()
      : undefined;
  const backendPreference = resolveWebBackend(params);
  const fallbackOnError = resolveWebBackendFallback(params);

  const snapshot = await sessionManager.startSession(sessionId, {
    profileId,
    headless,
    viewport,
    locale,
    timezone,
    startUrl,
    backendPreference,
    fallbackOnError,
  });

  return {
    success: true,
    session: snapshot,
  };
}

function resolveSessionId(execution: ToolExecution): string {
  const fromContext = String(execution.context?.sessionId || "").trim();
  if (fromContext) return fromContext;

  const fromParams = String(execution.parameters.sessionId || "").trim();
  if (fromParams) return fromParams;

  return "default";
}

function normalizeAction(params: Record<string, unknown>): WebAction {
  if (isObject(params.action)) {
    const candidate = params.action as Record<string, unknown>;
    if (typeof candidate.type === "string") {
      return candidate as unknown as WebAction;
    }
  }

  if (typeof params.type === "string") {
    return {
      type: params.type as WebAction["type"],
      target: isObject(params.target)
        ? (params.target as WebAction["target"])
        : undefined,
      value: typeof params.value === "string" ? params.value : undefined,
      url: typeof params.url === "string" ? params.url : undefined,
      options: isObject(params.options)
        ? (params.options as Record<string, unknown>)
        : undefined,
    };
  }

  throw new Error("web_act requires an 'action' object or action fields at the top level");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

export function resolveWebHeadless(
  params: Record<string, unknown>,
  envValue: string | undefined = process.env.NOVA_WEB_HEADLESS,
): boolean {
  const envHeadless = parseOptionalBool(envValue) ?? true;
  return parseOptionalBool(params.headless) ?? envHeadless;
}

export function resolveWebProfileId(
  params: Record<string, unknown>,
  sessionId: string,
  assignedProfileId?: string,
  envDefaultProfileId: string | undefined = process.env.NOVA_WEB_PROFILE_ID,
): string {
  const explicit = String(params.profileId || "").trim();
  if (explicit) return explicit;

  const assigned = String(assignedProfileId || "").trim();
  if (assigned) return assigned;

  const envDefault = String(envDefaultProfileId || "").trim();
  if (envDefault) return envDefault;

  return String(sessionId || "").trim() || "default";
}

export function resolveWebBackend(
  params: Record<string, unknown>,
  envValue: string | undefined = process.env.NOVA_WEB_BACKEND,
): WebBackendPreference {
  const explicit = String(params.backend || "").trim().toLowerCase();
  if (
    explicit === "local" ||
    explicit === "browserbase" ||
    explicit === "steel" ||
    explicit === "auto"
  ) {
    return explicit;
  }
  const env = String(envValue || "").trim().toLowerCase();
  if (env === "local" || env === "browserbase" || env === "steel") return env;
  return "auto";
}

export function resolveWebBackendFallback(
  params: Record<string, unknown>,
  envValue: string | undefined = process.env.NOVA_WEB_BACKEND_FALLBACK_ON_ERROR,
): boolean {
  const explicit = parseOptionalBool(params.fallbackOnError);
  if (explicit !== undefined) return explicit;
  return parseOptionalBool(envValue) ?? true;
}

function executeBash(params: Record<string, unknown>): {
  stdout: string;
  stderr: string;
} {
  const command = params.command as string;
  if (!command) {
    throw new Error("Missing command parameter");
  }

  try {
    const stdout = execSync(command, {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    return { stdout, stderr: "" };
  } catch (error: any) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
    };
  }
}

function executeRead(params: Record<string, unknown>): { content: string } {
  const path = params.path as string;
  if (!path) {
    throw new Error("Missing path parameter");
  }

  try {
    const content = readFileSync(path, "utf-8");
    return { content };
  } catch (error) {
    throw new Error(
      `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

function executeWrite(params: Record<string, unknown>): { success: boolean } {
  const path = params.path as string;
  const content = params.content as string;

  if (!path) {
    throw new Error("Missing path parameter");
  }
  if (content === undefined) {
    throw new Error("Missing content parameter");
  }

  try {
    writeFileSync(path, content, "utf-8");
    return { success: true };
  } catch (error) {
    throw new Error(
      `Failed to write file: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function executeCurl(params: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}> {
  const url = String(params.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Invalid url parameter. Expected http/https URL.");
  }

  const method = String(params.method || "GET").trim().toUpperCase();
  const allowedMethods = new Set([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ]);
  if (!allowedMethods.has(method)) {
    throw new Error(`Unsupported HTTP method: ${method}`);
  }

  const timeoutMs = Math.max(
    500,
    Number.isFinite(Number(params.timeoutMs)) ? Number(params.timeoutMs) : 30_000,
  );
  const maxChars = Math.max(
    500,
    Number.isFinite(Number(params.maxChars)) ? Number(params.maxChars) : 20_000,
  );
  const followRedirects = params.followRedirects !== false;

  const headersInput =
    params.headers && typeof params.headers === "object"
      ? (params.headers as Record<string, unknown>)
      : {};
  const headers = new Headers();
  for (const [key, value] of Object.entries(headersInput)) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    headers.set(key, String(value));
  }

  let body: string | undefined;
  if (params.json !== undefined) {
    body = JSON.stringify(params.json);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  } else if (params.body !== undefined && params.body !== null) {
    body = String(params.body);
  }

  if ((method === "GET" || method === "HEAD") && body !== undefined) {
    body = undefined;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      redirect: followRedirects ? "follow" : "manual",
      signal: controller.signal,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    const rawBody = method === "HEAD" ? "" : await response.text();
    const truncated = rawBody.length > maxChars;
    const outBody = truncated ? `${rawBody.slice(0, maxChars)}... [truncated]` : rawBody;

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      method,
      headers: responseHeaders,
      body: outBody,
      truncated,
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`curl request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`curl request failed: ${error?.message || "Unknown error"}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
