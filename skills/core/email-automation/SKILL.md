---
name: Email Automation
description: Send, read, and manage emails via SMTP/IMAP
category: communication
keywords: [email, send, inbox, mail, message, reply, compose]
---

# Email Automation Skill

## Overview

This skill enables Nova to send, read, and manage emails on your behalf. Perfect for automating email workflows, sending notifications, or checking your inbox.

## When to Use

Use this skill when the user wants to:

- Send an email to someone
- Check their inbox
- Reply to messages
- Search for specific emails
- Set up email notifications

## Prerequisites

Ensure these environment variables are set in `~/.nova/.env`:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

For Gmail, you'll need an [App Password](https://support.google.com/accounts/answer/185833).

## Available Tools

- **email_send** - Send an email with subject and body
- **email_read** - Read inbox messages (not yet implemented)
- **email_search** - Search for emails (not yet implemented)

## Examples

### Send a Simple Email

**User**: "Send an email to john@example.com with subject 'Meeting Tomorrow' and body 'Hi John, see you at 2pm.'"

**Nova**: Uses `email_send` tool:

```json
{
  "to": "john@example.com",
  "subject": "Meeting Tomorrow",
  "body": "Hi John, see you at 2pm."
}
```

### Send Email with CC

**User**: "Email the team at team@company.com, cc boss@company.com, subject 'Weekly Update', body 'Here's this week's progress...'"

**Nova**: Uses `email_send` with cc parameter

### Check Inbox

**User**: "Check my inbox for emails from Sarah"

**Nova**: Would use `email_search` (when implemented)

## Best Practices

1. **Always confirm before sending** - Ask the user to verify recipient, subject, and body
2. **Ask for missing info** - If user doesn't provide to/subject/body, ask for it
3. **Validate email addresses** - Check format before attempting to send
4. **Be clear about limits** - SMTP servers have rate limits
5. **Respect privacy** - Never log email contents

## Troubleshooting

**Tool fails with authentication error**

- Check SMTP credentials in `.env`
- For Gmail, ensure you're using an App Password, not your regular password

**Email not sending**

- Verify SMTP_HOST and SMTP_PORT are correct for your provider
- Check firewall settings

**Rate limits**

- Most SMTP providers limit emails per day
- Gmail: ~500 emails/day for free accounts

## Future Enhancements

- [ ] Read inbox with IMAP
- [ ] Search and filter emails
- [ ] Attach files to emails
- [ ] HTML email templates
- [ ] Schedule emails for later
