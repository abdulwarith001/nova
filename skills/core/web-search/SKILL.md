---
name: Web Search
description: Search the web using Nova's browser-native search and extraction tools
category: browser
keywords: [search, browser, web, find, query, news, information, lookup]
---

# Web Search

## Overview

Search the web using Nova's browser-native tooling. Discovery is handled by `browser_search`, then deeper retrieval is done with `browser_navigate`, `browser_extract`, and `browser_html`.

## When to Use

- User asks to search for something online
- Need current information or news
- Looking up facts, articles, or content
- Finding websites or resources
- Getting latest updates about a topic

## Prerequisites

No third-party search API key is required.

## Available Tools

- **browser_search** - Discover relevant links and snippets using browser-based search
- **browser_navigate** - Open a specific URL
- **browser_extract** - Extract page text for analysis
- **browser_html** - Retrieve page HTML when extraction quality is poor

## Example Flow

### General Search

**User**: "Search for AI agents"

1. Use `browser_search` with query `AI agents`
2. Open top sources with `browser_navigate`
3. Extract content using `browser_extract`
4. Synthesize with citations

### News Query

**User**: "Latest news about Seyi Vibez"

1. Use `browser_search` with query `Seyi Vibez latest news`
2. Verify multiple sources before final response
3. Cite source URLs in output

## Best Practices

1. **Be specific** - "latest albums by Wizkid" > "Wizkid"
2. **Verify multiple sources** before finalizing research answers
3. **Extract after navigate** - do not rely on snippets alone
4. **Prefer primary sources** for high-confidence claims
5. **Call out uncertainty** when information conflicts or is incomplete

## Typical Response Shape

```json
{
  "results": [
    {
      "title": "Result title",
      "url": "https://...",
      "description": "Short snippet"
    }
  ]
}
```

## Limitations

- Some pages are anti-bot or JS-heavy and may need retries
- Dynamic sites may require additional navigation/click steps
- Source quality varies, so synthesis should always include confidence/uncertainty
