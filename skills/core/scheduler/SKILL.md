---
name: Scheduler
description: Create reminders, recurring tasks, and scheduled agent actions
category: data
keywords:
  [
    reminder,
    remind,
    schedule,
    recurring,
    later,
    timer,
    snooze,
    follow-up,
    check-in,
    monitor,
  ]
status: active
---

# Scheduler

## Overview

Create reminders to notify you at specific times, set up recurring tasks the agent runs automatically, and schedule deferred agent actions.

## When to Use

- User wants to be reminded about something
- Schedule a recurring task (daily summary, periodic monitoring)
- Defer an agent action to run later
- Track deadlines and follow-ups
- Set up monitoring (watch a page for changes)

## Available Tools

- **schedule_create** — Create a reminder, recurring task, or agent action
- **schedule_list** — View scheduled items (filter by status/kind)
- **schedule_cancel** — Cancel a scheduled item
- **schedule_update** — Snooze, reschedule, or update a scheduled item

## Kinds

| Kind        | Behavior                                                            |
| ----------- | ------------------------------------------------------------------- |
| `reminder`  | One-shot message delivery. Triggers once, then marked as triggered. |
| `recurring` | Repeats on interval. Agent runs the message/action each time.       |
| `task`      | One-shot agent action. Agent executes tools when triggered.         |

## Examples

### Simple Reminder

**User**: "Remind me in 30 minutes to call John"
**Tool**: `schedule_create({ kind: "reminder", message: "Call John", delayMs: 1800000 })`

### Recurring Task

**User**: "Every morning at 9am, give me a news summary"
**Tool**: `schedule_create({ kind: "recurring", message: "Give the user a morning news summary", delayMs: 86400000, schedule: "24h", timeOfDay: "09:00" })`

### Deferred Agent Task

**User**: "In 2 hours, check noteiq.live pricing and tell me what it says"
**Tool**: `schedule_create({ kind: "task", message: "Check noteiq.live pricing", action: "Browse noteiq.live/pricing and report the current pricing", delayMs: 7200000 })`

### Follow-up

**User**: "Follow up with Sarah next Monday about the proposal"
**Tool**: `schedule_create({ kind: "reminder", message: "Follow up with Sarah about the proposal", delayMs: <days until Monday * 86400000> })`

### Snooze

**User**: "Snooze that for 15 minutes"
**Tool**: `schedule_update({ id: "<id>", delayMs: 900000 })`

## Time Handling

Provide `delayMs` in milliseconds from now. The tool computes the trigger time server-side.

| Delay      | delayMs  |
| ---------- | -------- |
| 5 minutes  | 300000   |
| 30 minutes | 1800000  |
| 1 hour     | 3600000  |
| 2 hours    | 7200000  |
| 1 day      | 86400000 |

> **IMPORTANT**: If the user does NOT specify when, ASK them. Never guess a time.
