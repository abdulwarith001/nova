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
import { ensureEnvLoaded } from "./config.js";

ensureEnvLoaded();

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
        width: Number(
          (params.viewport as Record<string, unknown>).width || 1366,
        ),
        height: Number(
          (params.viewport as Record<string, unknown>).height || 900,
        ),
      }
    : { width: 1366, height: 900 };

  const locale = String(
    params.locale || process.env.NOVA_WEB_LOCALE || "en-US",
  );
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

  throw new Error(
    "web_act requires an 'action' object or action fields at the top level",
  );
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
  const explicit = String(params.backend || "")
    .trim()
    .toLowerCase();
  if (
    explicit === "local" ||
    explicit === "browserbase" ||
    explicit === "steel" ||
    explicit === "auto"
  ) {
    return explicit;
  }
  const env = String(envValue || "")
    .trim()
    .toLowerCase();
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
