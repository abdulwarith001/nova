---
name: Tasks
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
    task,
  ]
status: active
---

# Tasks

## Overview

Create reminders to notify you at specific times, set up recurring tasks the agent runs automatically, and schedule deferred agent actions.

## When to Use

- User wants to be reminded about something
- Schedule a recurring task (daily summary, periodic monitoring)
- Defer an agent action to run later
- Track deadlines and follow-ups
- Set up monitoring (watch a page for changes)

## Available Tools

- **task_create** — Create a reminder, recurring task, or agent action
- **task_list** — View tasks (filter by status/kind)
- **task_cancel** — Cancel a task
- **task_update** — Snooze, reschedule, or update a task

## Kinds

| Kind        | Behavior                                                      |
| ----------- | ------------------------------------------------------------- |
| `reminder`  | One-shot message delivery. Triggers once, then removed.       |
| `recurring` | Repeats on interval. Agent runs the message/action each time. |
| `task`      | One-shot agent action. Agent executes tools when triggered.   |

## Examples

### Simple Reminder

**User**: "Remind me in 30 minutes to call John"
**Tool**: `task_create({ kind: "reminder", message: "Call John", delayMinutes: 30 })`

### Recurring Task

**User**: "Every morning at 9am, give me a news summary"
**Tool**: `task_create({ kind: "recurring", message: "Give the user a morning news summary", delayMinutes: 1440, schedule: "24h", timeOfDay: "09:00" })`

### Deferred Agent Task

**User**: "In 2 hours, check noteiq.live pricing and tell me what it says"
**Tool**: `task_create({ kind: "task", message: "Check noteiq.live pricing", action: "Browse noteiq.live/pricing and report the current pricing", delayMinutes: 120 })`

### Follow-up

**User**: "Follow up with Sarah next Monday about the proposal"
**Tool**: `task_create({ kind: "reminder", message: "Follow up with Sarah about the proposal", delayMinutes: <days until Monday * 1440> })`

### Snooze

**User**: "Snooze that for 15 minutes"
**Tool**: `task_update({ id: "<id>", delayMinutes: 15 })`

## Time Handling

Provide `delayMinutes` in minutes from now. The tool computes the trigger time server-side.

| Delay      | delayMinutes |
| ---------- | ------------ |
| 5 minutes  | 5            |
| 30 minutes | 30           |
| 1 hour     | 60           |
| 2 hours    | 120          |
| 1 day      | 1440         |

> **IMPORTANT**: If the user does NOT specify when, ASK them. Never guess a time.
