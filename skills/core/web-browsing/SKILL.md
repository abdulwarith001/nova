---
name: web-browsing
description: Web browsing, search, and content extraction
capabilities: web search, browse pages, scrape content, extract structured data, take screenshots, navigate pages, fill forms, click elements
env: NOVA_WEB_AGENT_ENABLED
tools: 9
---

# Web Browsing Skill

Provides web search, page browsing, and content extraction via Playwright.

## Tools

| Tool                     | Description                                  |
| ------------------------ | -------------------------------------------- |
| `web_search`             | Search the web using a search engine         |
| `browse`                 | Navigate to a URL and extract content        |
| `scrape`                 | Scrape structured data from a page           |
| `web_session_start`      | Start a persistent browser session           |
| `web_observe`            | Observe the current state of a page          |
| `web_decide_next`        | Decide the next browser action               |
| `web_act`                | Execute a browser action (click, type, etc.) |
| `web_extract_structured` | Extract structured data from the page        |
| `web_session_end`        | End the browser session                      |

## Setup

Requires Playwright with Chromium. Set `NOVA_WEB_AGENT_ENABLED=true` to activate.
