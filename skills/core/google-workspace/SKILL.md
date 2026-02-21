---
name: google-workspace
description: Google Workspace integration — Gmail, Calendar, and Drive
capabilities: send email, read email, search email, draft email, reply to email, list emails, list calendar events, create calendar event, search calendar, list drive files, search drive, read drive file, upload to drive, create PDF
env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
tools: 14
---

# Google Workspace Skill

Provides access to Gmail, Google Calendar, and Google Drive.

## Tools

| Tool               | Description                   |
| ------------------ | ----------------------------- |
| `gmail_list`       | List recent emails            |
| `gmail_read`       | Read a specific email         |
| `gmail_send`       | Send a new email              |
| `gmail_reply`      | Reply to an email             |
| `gmail_search`     | Search emails                 |
| `gmail_draft`      | Create a draft email          |
| `calendar_list`    | List upcoming calendar events |
| `calendar_create`  | Create a new calendar event   |
| `calendar_search`  | Search calendar events        |
| `drive_list`       | List files in Google Drive    |
| `drive_search`     | Search Google Drive           |
| `drive_read`       | Read a file from Google Drive |
| `drive_upload`     | Upload a file to Google Drive |
| `drive_create_pdf` | Create a PDF document         |

## Setup

1. Create a Google Cloud project and enable Gmail, Calendar, and Drive APIs
2. Create OAuth 2.0 credentials
3. Set environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
