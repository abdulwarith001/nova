/**
 * tasks/tools.ts — Agent-facing tools for managing tasks.
 *
 * Tools: task_create, task_list, task_cancel, task_update
 */

import type { TaskStore } from "../../../runtime/src/task-store.js";

export function registerTaskTools(
  registry: { register(tool: any): void },
  store: TaskStore,
): void {
  // ── task_create ─────────────────────────────────────────────────────

  registry.register({
    name: "task_create",
    description:
      "Create a reminder, recurring task, or scheduled agent action. Use this when the user says 'remind me', 'every day/hour', 'in X minutes do Y', or any scheduling request. Provide EITHER triggerAt (ISO datetime for a specific time) OR delayMinutes (minutes from now). If the user does not specify a time, ASK them — never guess.",
    category: "data",
    parametersSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["reminder", "recurring", "task"],
          description:
            "reminder = one-shot message, recurring = repeating, task = one-shot agent action",
        },
        message: {
          type: "string",
          description: "What to remind or do (human-readable)",
        },
        delayMinutes: {
          type: "number",
          description:
            "Delay in minutes from NOW until trigger. Use for relative delays: 5 min = 5, 30 min = 30, 1 hour = 60, 2 hours = 120. Either this OR triggerAt is required.",
        },
        triggerAt: {
          type: "string",
          description:
            "ISO 8601 datetime string for when to trigger (e.g. '2026-03-04T09:00:00'). Use for specific times like 'at 9 AM', 'tomorrow at noon'. Use the timezone from your system prompt. Either this OR delayMinutes is required.",
        },
        action: {
          type: "string",
          description:
            "Optional agent instruction for task/recurring kinds. The agent will execute this as a prompt when triggered.",
        },
        schedule: {
          type: "string",
          description:
            "Interval for recurring items: '30m', '6h', '24h', '1d'. Required for kind=recurring.",
        },
        timeOfDay: {
          type: "string",
          description:
            "Optional time of day for recurring items: '09:00', '14:30'. Used with schedule to align triggers.",
        },
      },
      required: ["kind", "message"],
    },
    permissions: [],
    execute: async (params: any) => {
      const kind = String(params.kind || "reminder") as
        | "reminder"
        | "recurring"
        | "task";
      const message = String(params.message || "");
      const delayMinutes =
        params.delayMinutes != null ? Number(params.delayMinutes) : null;
      const triggerAt = params.triggerAt ? String(params.triggerAt) : null;

      if (!message) throw new Error("Message is required");
      if (delayMinutes == null && !triggerAt) {
        throw new Error(
          "Provide either delayMinutes (e.g. 5, 60, 1440) or triggerAt (e.g. '2026-03-04T09:00:00'). If the user did not specify a time, ask them.",
        );
      }

      let nextRun: number;
      const now = Date.now();

      if (triggerAt) {
        const parsed = new Date(triggerAt).getTime();
        if (!Number.isFinite(parsed)) {
          throw new Error(
            `Invalid triggerAt datetime: "${triggerAt}". Use ISO 8601 format like '2026-03-04T09:00:00'.`,
          );
        }
        if (parsed <= now) {
          throw new Error(
            `triggerAt is in the past. Current time: ${new Date(now).toISOString()}. Provide a future datetime.`,
          );
        }
        nextRun = parsed;
      } else {
        if (!Number.isFinite(delayMinutes!) || delayMinutes! < 0) {
          throw new Error(
            "delayMinutes must be a positive number (minutes from now). Examples: 5 min = 5, 1 hour = 60.",
          );
        }
        nextRun = now + delayMinutes! * 60_000;
      }

      const item = store.create({
        kind,
        message,
        nextRun,
        action: params.action ? String(params.action) : undefined,
        schedule: params.schedule ? String(params.schedule) : undefined,
        timeOfDay: params.timeOfDay ? String(params.timeOfDay) : undefined,
      });

      const triggerDate = new Date(item.nextRun).toLocaleString();
      return {
        success: true,
        id: item.id,
        kind: item.kind,
        message: item.message,
        triggersAt: triggerDate,
        nextRun: item.nextRun,
        schedule: item.schedule || null,
      };
    },
  });

  // ── task_list ───────────────────────────────────────────────────────

  registry.register({
    name: "task_list",
    description:
      "List tasks (reminders, recurring, agent actions). Filter by status or kind.",
    category: "data",
    parametersSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "triggered", "cancelled", "paused"],
          description: "Filter by status. Defaults to active.",
        },
        kind: {
          type: "string",
          enum: ["reminder", "recurring", "task"],
          description: "Filter by kind",
        },
      },
    },
    permissions: [],
    execute: async (params: any) => {
      const filter: { status?: any; kind?: any } = {};
      if (params.status) filter.status = String(params.status);
      if (params.kind) filter.kind = String(params.kind);

      // Default to active if no filter
      if (!filter.status && !filter.kind) {
        filter.status = "active";
      }

      const items = store.list(filter);
      const stats = store.getStats();

      return {
        items: items.map((item) => ({
          id: item.id,
          kind: item.kind,
          message: item.message,
          triggersAt: new Date(item.nextRun).toLocaleString(),
          nextRun: item.nextRun,
          schedule: item.schedule || null,
          status: item.status,
        })),
        count: items.length,
        stats,
      };
    },
  });

  // ── task_cancel ─────────────────────────────────────────────────────

  registry.register({
    name: "task_cancel",
    description:
      "Cancel a task by ID. Reminders, tasks, and recurring items can all be cancelled.",
    category: "data",
    parametersSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The ID of the task to cancel",
        },
      },
      required: ["id"],
    },
    permissions: [],
    execute: async (params: any) => {
      const id = String(params.id || "");
      if (!id) throw new Error("ID is required");

      const cancelled = store.cancel(id);
      if (!cancelled) {
        return { success: false, error: "Task not found or already cancelled" };
      }
      return { success: true, id };
    },
  });

  // ── task_update ─────────────────────────────────────────────────────

  registry.register({
    name: "task_update",
    description:
      "Update a task: snooze (set new delay), change message, change interval, pause/resume. Use this for 'snooze', 'reschedule', 'change to every X', or 'update' requests. ALWAYS use this instead of creating a new task when the user wants to modify an existing one.",
    category: "data",
    parametersSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The ID of the task to update",
        },
        delayMinutes: {
          type: "number",
          description:
            "New delay in minutes from now for snooze/reschedule. 15 min = 15, 1 hour = 60.",
        },
        triggerAt: {
          type: "string",
          description:
            "ISO 8601 datetime for new trigger time (e.g. '2026-03-04T14:00:00'). Alternative to delayMinutes.",
        },
        message: {
          type: "string",
          description: "Updated message text",
        },
        status: {
          type: "string",
          enum: ["active", "paused"],
          description: "Set to 'paused' to pause, 'active' to resume",
        },
        schedule: {
          type: "string",
          description:
            "New interval for recurring items: '10m', '30m', '6h', '24h'. Use to change how often a recurring item repeats.",
        },
        action: {
          type: "string",
          description:
            "Updated agent instruction for task/recurring kinds. When updating the message, ALWAYS update the action too if the task has one.",
        },
      },
      required: ["id"],
    },
    permissions: [],
    execute: async (params: any) => {
      const id = String(params.id || "");
      if (!id) throw new Error("ID is required");

      const changes: Record<string, any> = {};
      if (params.triggerAt) {
        const parsed = new Date(String(params.triggerAt)).getTime();
        if (!Number.isFinite(parsed)) {
          throw new Error(
            `Invalid triggerAt datetime. Use ISO 8601 format like '2026-03-04T09:00:00'.`,
          );
        }
        if (parsed <= Date.now()) {
          throw new Error(
            "triggerAt is in the past. Provide a future datetime.",
          );
        }
        changes.nextRun = parsed;
        changes.status = "active";
      } else if (params.delayMinutes) {
        const delayMinutes = Number(params.delayMinutes);
        if (!Number.isFinite(delayMinutes) || delayMinutes < 0) {
          throw new Error("delayMinutes must be a positive number");
        }
        changes.nextRun = Date.now() + delayMinutes * 60_000;
        changes.status = "active"; // Re-activate if snoozed
      }
      if (params.message) changes.message = String(params.message);
      if (params.status) changes.status = String(params.status);
      if (params.schedule) changes.schedule = String(params.schedule);
      if (params.action) changes.action = String(params.action);

      if (Object.keys(changes).length === 0) {
        throw new Error(
          "Provide at least one field to update: delayMinutes, message, action, schedule, or status",
        );
      }

      const updated = store.update(id, changes);
      if (!updated) {
        return { success: false, error: "Task not found" };
      }

      return {
        success: true,
        id: updated.id,
        message: updated.message,
        triggersAt: new Date(updated.nextRun).toLocaleString(),
        nextRun: updated.nextRun,
        status: updated.status,
      };
    },
  });
}
