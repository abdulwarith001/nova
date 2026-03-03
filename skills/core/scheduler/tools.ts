/**
 * scheduler/tools.ts — Agent-facing tools for managing schedules.
 *
 * Tools: schedule_create, schedule_list, schedule_cancel, schedule_update
 */

import type { SchedulerStore } from "../../../runtime/src/scheduler-store.js";

export function registerSchedulerTools(
  registry: { register(tool: any): void },
  store: SchedulerStore,
): void {
  // ── schedule_create ─────────────────────────────────────────────────────

  registry.register({
    name: "schedule_create",
    description:
      "Create a reminder, recurring task, or scheduled agent action. Use this when the user says 'remind me', 'every day/hour', 'in X minutes do Y', or any scheduling request. You MUST provide delayMs (milliseconds from now until trigger). Simple conversions: 1 minute = 60000, 1 hour = 3600000, 1 day = 86400000. If the user does not specify a time, ASK them when they want to be reminded — never guess.",
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
        delayMs: {
          type: "number",
          description:
            "Delay in milliseconds from NOW until trigger. Examples: 5 min = 300000, 30 min = 1800000, 1 hour = 3600000, 2 hours = 7200000, 1 day = 86400000. ALWAYS use this — never pass an absolute timestamp.",
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
      required: ["kind", "message", "delayMs"],
    },
    permissions: [],
    execute: async (params: any) => {
      const kind = String(params.kind || "reminder") as
        | "reminder"
        | "recurring"
        | "task";
      const message = String(params.message || "");
      const delayMs = Number(params.delayMs);

      if (!message) throw new Error("Message is required");
      if (!delayMs || !Number.isFinite(delayMs) || delayMs < 0) {
        throw new Error(
          "delayMs must be a positive number (milliseconds from now). Examples: 5 min = 300000, 1 hour = 3600000. If the user did not specify a time, ask them when they want to be reminded.",
        );
      }

      const now = Date.now();
      const nextRun = now + delayMs;

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

  // ── schedule_list ───────────────────────────────────────────────────────

  registry.register({
    name: "schedule_list",
    description:
      "List scheduled items (reminders, recurring tasks, agent actions). Filter by status or kind.",
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

  // ── schedule_cancel ─────────────────────────────────────────────────────

  registry.register({
    name: "schedule_cancel",
    description:
      "Cancel a scheduled item by ID. Reminders, tasks, and recurring items can all be cancelled.",
    category: "data",
    parametersSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The ID of the scheduled item to cancel",
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
        return { success: false, error: "Item not found or already cancelled" };
      }
      return { success: true, id };
    },
  });

  // ── schedule_update ─────────────────────────────────────────────────────

  registry.register({
    name: "schedule_update",
    description:
      "Update a scheduled item: snooze (set new delay), change message, change interval, pause/resume. Use this for 'snooze', 'reschedule', 'change to every X', or 'update' requests. ALWAYS use this instead of creating a new schedule when the user wants to modify an existing one.",
    category: "data",
    parametersSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The ID of the scheduled item to update",
        },
        delayMs: {
          type: "number",
          description:
            "New delay in milliseconds from now for snooze/reschedule. 15 min = 900000, 1 hour = 3600000.",
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
      if (params.delayMs) {
        const delayMs = Number(params.delayMs);
        if (!Number.isFinite(delayMs) || delayMs < 0) {
          throw new Error("delayMs must be a positive number");
        }
        changes.nextRun = Date.now() + delayMs;
        changes.status = "active"; // Re-activate if snoozed
      }
      if (params.message) changes.message = String(params.message);
      if (params.status) changes.status = String(params.status);
      if (params.schedule) changes.schedule = String(params.schedule);
      if (params.action) changes.action = String(params.action);

      if (Object.keys(changes).length === 0) {
        throw new Error(
          "Provide at least one field to update: delayMs, message, action, schedule, or status",
        );
      }

      const updated = store.update(id, changes);
      if (!updated) {
        return { success: false, error: "Item not found" };
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
