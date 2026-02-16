---
name: Web Search
description: Search the web using Serper.dev API for news, information, and content
category: browser
keywords: [search, google, web, find, query, news, information, lookup]
---

# Web Search

## Overview

Search the web using Serper.dev API - a fast, reliable Google Search API alternative. Get search results, news, images, and more without the complexity of web scraping.

## When to Use

- User asks to search for something online
- Need current information or news
- Looking up facts, articles, or content
- Finding websites or resources
- Getting latest news about a topic

## Prerequisites

Set your Serper API key in `~/.nova/.env`:

```bash
SERPER_API_KEY=your_api_key_here
```

Get a free API key at: https://serper.dev (2,500 free searches/month)

## Available Tools

- **web_search** - Search the web and get structured results

## Examples

### General Search

**User**: "Search for 'AI agents'"

**Nova**: Uses `web_search`:

```json
{
  "query": "AI agents",
  "type": "search"
}
```

Returns top 10 results with title, link, and snippet.

### News Search

**User**: "Latest news about Seyi Vibez"

**Nova**: Uses `web_search`:

```json
{
  "query": "Seyi Vibez",
  "type": "news"
}
```

Returns recent news articles.

### Image Search

**User**: "Find images of golden retrievers"

**Nova**: Uses `web_search`:

```json
{
  "query": "golden retrievers",
  "type": "images"
}
```

### Location-Based Search

**User**: "Best restaurants in Lagos"

**Nova**: Uses `web_search`:

```json
{
  "query": "best restaurants",
  "location": "Lagos, Nigeria"
}
```

## Search Types

- **search** - General web search (default)
- **news** - News articles
- **images** - Image results
- **videos** - Video results
- **places** - Local business/places

## Best Practices

1. **Be specific** - "latest albums by Wizkid" > "Wizkid"
2. **Use quotes** for exact phrases - `"machine learning"`
3. **Specify time** for news - "recent", "latest", "2024"
4. **Combine with browser** - search first, then scrape specific pages
5. **Respect rate limits** - 2,500 free searches/month

## Response Format

```json
{
  "organic": [
    {
      "title": "Result title",
      "link": "https://...",
      "snippet": "Description..."
    }
  ],
  "news": [...],
  "answerBox": {...}
}
```

## Advantages over Browser Scraping

✅ **Faster** - No browser rendering needed  
✅ **Reliable** - No CSS selector breakage  
✅ **Structured** - Clean JSON responses  
✅ **Current** - Always up-to-date results  
✅ **No CAPTCHAs** - API authentication

## Limitations

- Rate limited (2,500/month free tier)
- Requires API key
- Costs money beyond free tier
- Some search features limited

## When to Use Browser Instead

- Need to interact with a specific website
- Filling forms or clicking buttons
- Screenshots needed
- Dynamic content requiring JavaScript
