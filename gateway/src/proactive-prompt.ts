/**
 * proactive-prompt.ts — Builds context-aware prompts for autonomous check-ins.
 *
 * Assembles time, user profile, pending tasks, and the heartbeat trigger
 * into a prompt that gives the agent full context to decide what to share.
 */

import type { TaskStore } from "../../runtime/src/task-store.js";
import type { ProfileStore } from "../../runtime/src/markdown-memory/profile-store.js";

export interface ProactiveContext {
  triggerMessage: string;
  profileStore: ProfileStore;
  taskStore: TaskStore;
}

/**
 * Build a proactive check-in prompt with full context.
 */
export function buildProactivePrompt(ctx: ProactiveContext): string {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  // Get user profile
  let userProfile = "";
  try {
    userProfile = ctx.profileStore.getUser();
  } catch {
    userProfile = "(no profile available)";
  }

  // Get active tasks
  let taskSummary = "";
  try {
    const tasks = ctx.taskStore.list({ status: "active" });
    if (tasks.length > 0) {
      taskSummary = tasks
        .slice(0, 10)
        .map(
          (t) =>
            `- [${t.kind}] ${t.message}${t.schedule ? ` (every ${t.schedule})` : ""}`,
        )
        .join("\n");
    } else {
      taskSummary = "(no active tasks)";
    }
  } catch {
    taskSummary = "(unable to load tasks)";
  }

  return `You are Nova, running an autonomous proactive check-in.
Current time: ${timeStr}

=== USER PROFILE ===
${userProfile}

=== ACTIVE TASKS & REMINDERS ===
${taskSummary}

=== TRIGGER ===
${ctx.triggerMessage}

=== INSTRUCTIONS ===
You have access to ALL your tools. On this check-in you SHOULD:
1. Check the user's latest emails (gmail_search) for anything important
2. Check today's calendar events (calendar_list_events) for upcoming meetings
3. Review the active tasks above for anything due
4. Do web searches if needed for any context

Based on what you find, compose a brief, useful Telegram message to the user.
Be concise — 2-4 sentences max. Only share things that are actionable or important.

If there is genuinely NOTHING worth sharing, respond with exactly: [NO_MESSAGE]

At the END of your response, on its own line, specify when you should next check in:
[NEXT_CHECK_IN: 2h]

Use your judgment for timing:
- 30m if something urgent is developing
- 1h-2h during work hours
- 6h-12h during evenings/weekends
- 24h if everything is calm`;
}

/**
 * Parse the agent's response to extract the message and next check-in interval.
 */
export function parseProactiveResponse(response: string): {
  message: string | null;
  nextCheckInMs: number;
} {
  const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const MIN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Check for [NO_MESSAGE]
  if (response.trim() === "[NO_MESSAGE]" || response.includes("[NO_MESSAGE]")) {
    // Still parse next check-in if present
    const intervalMs = extractCheckInInterval(response) || DEFAULT_INTERVAL_MS;
    return {
      message: null,
      nextCheckInMs: Math.max(
        MIN_INTERVAL_MS,
        Math.min(MAX_INTERVAL_MS, intervalMs),
      ),
    };
  }

  // Extract next check-in
  const intervalMs = extractCheckInInterval(response) || DEFAULT_INTERVAL_MS;

  // Remove the [NEXT_CHECK_IN: ...] tag from the message
  const cleanMessage = response
    .replace(/\[NEXT_CHECK_IN:\s*\w+\]/gi, "")
    .replace(/\[NO_MESSAGE\]/gi, "")
    .trim();

  return {
    message: cleanMessage || null,
    nextCheckInMs: Math.max(
      MIN_INTERVAL_MS,
      Math.min(MAX_INTERVAL_MS, intervalMs),
    ),
  };
}

function extractCheckInInterval(text: string): number | null {
  const match = text.match(/\[NEXT_CHECK_IN:\s*(\d+)(m|h|d)\]/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}
