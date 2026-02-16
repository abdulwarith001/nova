---
name: Browser Automation
description: Navigate web pages, extract content, and interact with websites
category: browser
keywords: [browse, website, web, navigate, click, screenshot, scrape, extract]
---

# Browser Automation

## Overview

Control a headless browser to navigate websites, extract content, take screenshots, and interact with web pages. Powered by Playwright.

## When to Use

- User wants to visit a website
- Need to extract information from a web page
- Take screenshots of websites
- Fill forms or click buttons
- Scrape web content

## Available Tools

- **browser_navigate** - Navigate to a URL
- **browser_screenshot** - Capture page screenshot
- **browser_extract** - Extract text from page
- **browser_click** - Click an element
- **browser_fill** - Fill form fields
- **browser_html** - Get page HTML

## Examples

### Visit a Website

**User**: "Go to example.com"

**Nova**: Uses `browser_navigate`:

```json
{
  "url": "https://example.com"
}
```

### Extract Content

**User**: "What does the homepage of nova.ai say?"

**Nova**:

1. `browser_navigate` to https://nova.ai
2. `browser_extract` to get text content

### Take Screenshot

**User**: "Screenshot google.com and save as google.png"

**Nova**:

1. `browser_navigate` to https://google.com
2. `browser_screenshot` with path "google.png"

### Interact with Page

**User**: "Search for 'AI agents' on Google"

**Nova**:

1. `browser_navigate` to https://google.com
2. `browser_fill` the search input: `{selector: "input[name='q']", value: "AI agents"}`
3. `browser_click` the search button

## Best Practices

1. **Always navigate first** before other browser actions
2. **Use full URLs** including https://
3. **Handle timeouts** - some pages load slowly
4. **Wait for content** - dynamic pages may need time
5. **Use CSS selectors** for precise element targeting
6. **Respect robots.txt** and rate limits

## CSS Selectors Guide

- By ID: `#header`
- By class: `.button`
- By tag: `button`
- By attribute: `input[type="submit"]`
- Descendant: `form input`

## Limitations

- JavaScript-heavy sites may not fully load
- Cannot handle CAPTCHAs or authentication
- Rate limiting may kick in
- Some sites block headless browsers
- Screenshots save to local filesystem only
