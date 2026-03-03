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

| Tool                     | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `web_search`             | Search the web using a search engine                     |
| `browse`                 | Navigate to a URL and extract content                    |
| `scrape`                 | Scrape structured data from a page                       |
| `web_session_start`      | Start a persistent browser session for interactive tasks |
| `web_observe`            | Observe the current state of a page                      |
| `web_decide_next`        | Decide the next browser action                           |
| `web_act`                | Execute a browser action (click, type, etc.)             |
| `web_extract_structured` | Extract structured data from the page                    |
| `web_session_end`        | End the browser session                                  |

## When to Use Which Tool

- **Just reading a page?** → Use `browse` (takes screenshot, extracts text) or `scrape` (article text only).
- **Need to click, fill forms, submit, or interact?** → Use the **session tools**:

### Interactive Workflow (forms, clicking, submitting)

```
1. web_session_start(startUrl: "https://example.com/page")
2. web_observe()               → see the page elements
3. web_act({ type: "fill", target: { css: "#email" }, value: "user@test.com" })
4. web_act({ type: "fill", target: { css: "#password" }, value: "secret" })
5. web_act({ type: "click", target: { text: "Submit" } })
6. web_observe()               → verify result
7. web_session_end()
```

**IMPORTANT:** `browse` is READ-ONLY. If the user asks you to fill a form, click a button, log in, register, or interact with a page, you MUST use `web_session_start` + `web_act`.

## Setup

Requires Playwright with Chromium.
