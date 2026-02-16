---
name: Reminders
description: Create time-based reminders and notifications
category: data
keywords: [reminder, remind, schedule, notification, alert, later]
---

# Reminders

## Overview

Create reminders to notify you at specific times or after delays. Perfect for remembering tasks, follow-ups, and scheduled actions.

## When to Use

- User wants to be reminded about something
- Schedule a notification for later
- Set up recurring reminders
- Create task alerts

## Available Tools

- **reminder_create** - Create a new reminder

## Examples

### Simple Reminder

**User**: "Remind me in 30 minutes to call John"

**Nova**: Uses `reminder_create`:

```json
{
  "message": "Call John",
  "time": "in 30 minutes"
}
```

### Specific Time

**User**: "Remind me tomorrow at 9am to review the report"

**Nova**: Uses `reminder_create`:

```json
{
  "message": "Review the report",
  "time": "tomorrow at 9am"
}
```

### Multiple Reminders

**User**: "Remind me at 2pm and 5pm to drink water"

**Nova**: Creates two reminders:

1. `{message: "Drink water", time: "today at 2pm"}`
2. `{message: "Drink water", time: "today at 5pm"}`

## Time Format Guide

**Relative:**

- "in 15 minutes"
- "in 2 hours"
- "in 3 days"

**Specific:**

- "tomorrow at 10am"
- "next Monday at 9:30am"
- "January 15 at 2pm"

**Natural language:**

- "this afternoon"
- "tonight"
- "next week"

## Best Practices

1. **Be specific about time** - avoid ambiguous times
2. **Include context in message** - "Call John about meeting"
3. **Confirm with user** - show when reminder will trigger
4. **Handle time zones** - use user's local time
5. **Test timing** - verify the parsed time is correct

## Current Limitations

- No recurring reminders yet (planned)
- Reminders stored in local database only
- No cross-device sync
- No snooze functionality yet

## How Reminders Work

1. Reminder stored in `~/.nova/memory.db`
2. Scheduler monitors database every minute
3. When time reached, notification sent
4. Status updated to "completed"

## Future Enhancements

- [ ] Recurring reminders (daily, weekly, monthly)
- [ ] Snooze functionality
- [ ] Email/SMS notifications
- [ ] Integration with calendar apps
- [ ] Voice notifications
