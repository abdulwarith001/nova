---
name: Email
description: Full Gmail access - read, send, reply, search emails
category: communication
keywords: [email, gmail, inbox, send, reply, search, mail]
---

# Email

Full email client access via Gmail API. Read, send, reply to, and search emails directly from Nova.

## Setup Required

> **Note:** Email tools require Gmail API OAuth setup

1. Create Google Cloud project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable Gmail API
3. Create OAuth 2.0 credentials (Client ID and Secret)
4. Run setup command:
   ```bash
   nova config email-setup
   ```

## Available Tools

- **email_read** - Read recent emails from inbox
- **email_send** - Send new email
- **email_reply** - Reply to email thread
- **email_search** - Search emails with Gmail query syntax

## Examples

### Read Unread Emails

**User**: "Check my unread emails"

**Nova**: Uses `email_read`:

```json
{
  "query": "is:unread",
  "maxResults": 10
}
```

### Send Email

**User**: "Email John about the project update"

**Nova**:

1. Asks: "What's John's email address?"
2. User provides: "john@company.com"
3. Uses `email_send`:

```json
{
  "to": "john@company.com",
  "subject": "Project Update",
  "body": "Hi John,\n\nHere's the project update..."
}
```

### Search Emails

**User**: "Find emails from my boss about the meeting"

**Nova**: Uses `email_search`:

```json
{
  "query": "from:boss@company.com subject:meeting"
}
```

### Reply to Email

**User**: "Reply to that email saying I'll attend"

**Nova**: Uses `email_reply`:

```json
{
  "threadId": "thread_id_from_previous_read",
  "body": "Thanks! I'll attend the meeting."
}
```

## Gmail Query Syntax

Use Gmail's powerful search syntax:

- `is:unread` - Unread messages
- `from:sender@example.com` - From specific sender
- `to:recipient@example.com` - To specific recipient
- `subject:keyword` - Subject contains keyword
- `has:attachment` - Has attachments
- `after:2026/01/01` - After date
- `before:2026/12/31` - Before date
- Combine: `from:boss@company.com subject:urgent is:unread`

## Security

- **OAuth 2.0**: Secure authentication via Google
- **Encrypted Storage**: All tokens encrypted with AES-256-GCM
- **Limited Scope**: Gmail read/write only, no other Google services
- **Machine-Specific**: Tokens only work on the machine they were created on

## How It Works

1. OAuth setup creates encrypted credentials in `~/.nova/.env`
2. Gmail client decrypts credentials on startup
3. API calls use Google's Gmail API
4. Token auto-refreshes when expired

## Troubleshooting

**"Gmail not configured" error:**

- Run `nova config email-setup` to set up OAuth
- Ensure you completed the browser authorization flow

**"Forbidden" or "Unauthorized":**

- Token may have expired or been revoked
- Re-run `nova config email-setup` to refresh

**"Decryption failed":**

- Tokens are machine-specific
- If you moved machines, re-run setup on new machine

## Future Enhancements

- [ ] Calendar integration
- [ ] Email drafts
- [ ] Attachments support
- [ ] Labels/folders management
- [ ] Filters and rules
- [ ] Microsoft Outlook support
