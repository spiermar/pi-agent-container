# Web Search & Fetch Tools Design

## Overview

Add `web_search` and `web_fetch` tools to the agent-service, enabling the AI agent to search the web via Brave Search API and fetch/extract content from URLs.

## Requirements

- **web_search**: Query Brave Search API, return structured results (title, URL, snippet)
- **web_fetch**: Fetch URLs and extract readable content (HTML→markdown, PDF→text)
- No LLM processing for fetch — raw extraction only
- Gemini API key not required
- Brave Search API key via `BRAVE_SEARCH_API_KEY` environment variable

## Architecture

```
agent-service/
├── src/
│   ├── agent.ts           # Updated to include web tools
│   ├── web-tools.ts       # Tool definitions for web_search + web_fetch
│   ├── brave-search.ts    # Brave Search API client
│   └── content-fetcher.ts # URL fetching + content extraction
```

## Data Flow

### web_search
```
user query → web_search tool → Brave Search API → structured results
```

### web_fetch
```
URL → web_fetch tool → detect content type →
  HTML: fetch → Readability → Turndown → markdown
  PDF: fetch → pdf-parse → text
```

## TypeScript Types

```typescript
export interface SearchResult {
  title: string
  url: string
  description: string
}

export interface WebSearchOptions {
  count?: number   // 1-20, default 10
  offset?: number  // 0-9 for pagination
  search_lang?: string
}

export interface WebSearchResult {
  error?: false
  results: SearchResult[]
}

export interface WebSearchError {
  error: true
  message: string
}

export interface FetchedContent {
  error?: false
  content: string
  contentType: 'text/html' | 'application/pdf'
}

export interface FetchError {
  error: true
  message: string
}
```

## Components

### brave-search.ts

`BraveSearchClient` class:
- `search(query, options)` method
- Options: `count` (1-20, default 10), `offset` (0-9 for pagination), `search_lang`
- Returns `WebSearchResult | WebSearchError`
- Reads `BRAVE_SEARCH_API_KEY` from environment
- 30 second timeout
- No automatic retry on rate limit (429) — returns error to caller

API endpoint: `https://api.search.brave.com/res/v1/web/search`

### content-fetcher.ts

Functions:
- `fetchContent(url)` → detects content-type, routes to appropriate extractor
- `extractHtml(url)`: fetch → Readability → Turndown → markdown
- `extractPdf(url)`: fetch → pdf-parse → text
- 30 second timeout per request
- Follow up to 5 redirects max

Content-type detection:
1. Check HTTP `Content-Type` header
2. Strip charset suffix: `text/html; charset=utf-8` → `text/html`
3. Fallback: check URL extension if header missing

HTML extraction fallback:
1. Attempt Readability extraction
2. If Readability returns null/empty: return raw text content stripped of tags
3. Log extraction failure for debugging

Supported content types:
- `text/html` → markdown extraction
- `application/pdf` → text extraction
- Other types → error with supported types list

URL validation:
- Must start with `http://` or `https://` only
- Reject `file://`, `ftp://`, `javascript:`, `data:` schemes
- Reject URLs exceeding 2048 characters
- Use WHATWG URL parser for validation

### web-tools.ts

`createWebTools()` function returns `Tool[]` (same type as `createCodingTools()`):

```typescript
import type { Tool } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"

export function createWebTools(): Tool[] {
  return [webSearchTool, webFetchTool]
}
```

**web_search**
- Input schema: `Type.Object({ query: Type.String(), count: Type.Optional(Type.Number()) })`
- Output: `WebSearchResult | WebSearchError`

**web_fetch**
- Input schema: `Type.Object({ url: Type.String() })`
- Output: `FetchedContent | FetchError`

Integration in `agent.ts`:
```typescript
const { session } = await createAgentSession({
  // ...
  tools: [...createCodingTools(process.cwd()), ...createWebTools()],
});
```

## Dependencies

Add to `package.json`:
- `@mozilla/readability` — HTML content extraction
- `turndown` — HTML to markdown conversion
- `pdf-parse` — PDF text extraction
- `linkedom` — DOM implementation for Readability (server-side, lighter weight than JSDOM)

Turndown configuration:
```typescript
const turndownService = new TurndownService({
  headingStyle: 'atx',        // Use # for headings
  codeBlockStyle: 'fenced',   // Use ``` for code
  bulletListMarker: '-',      // Use - for bullets
})
```

## Error Handling

All errors returned in tool response objects, not thrown:

**web_search errors:**
- Missing `BRAVE_SEARCH_API_KEY` → "BRAVE_SEARCH_API_KEY environment variable not set"
- Rate limit (429) → "Brave Search API rate limit exceeded"
- Timeout → "Search request timed out"
- API error → "Brave Search API error: {status} {message}"

**web_fetch errors:**
- Invalid URL → "Invalid URL format: {url}"
- HTTP error → "Failed to fetch {url}: HTTP {status}"
- Timeout → "Request to {url} timed out"
- Unsupported content-type → "Unsupported content type: {type}. Supported: text/html, application/pdf"
- Extraction failed → "Failed to extract content from {url}: {reason}"

## Testing

### Unit Tests

`tests/unit/brave-search.test.ts`:
- Mock fetch responses
- Test query parameter building
- Test response parsing
- Test error handling (missing key, rate limit, timeout)

`tests/unit/content-fetcher.test.ts`:
- Mock HTTP responses for HTML and PDF
- Test HTML extraction with Readability
- Test PDF extraction
- Test content-type detection
- Test error handling

`tests/unit/web-tools.test.ts`:
- Test tool definitions match expected schema
- Test input validation

### Integration Tests

`tests/integration/web-tools-integration.test.ts`:
- Real Brave Search API calls (requires `BRAVE_SEARCH_API_KEY`)
- Real URL fetching (public URLs)
- Skip if API key not present:

```typescript
import { describe, it, expect } from 'vitest'

const describeIfApiKey = process.env.BRAVE_SEARCH_API_KEY 
  ? describe 
  : describe.skip

describeIfApiKey('web_search integration', () => {
  // tests
})
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BRAVE_SEARCH_API_KEY` | Yes | Brave Search API key |

Update `.env.example` to include:
```
BRAVE_SEARCH_API_KEY=your_brave_search_api_key_here
```

## Docker Integration

Add to `docker-compose.yml`:
```yaml
environment:
  - BRAVE_SEARCH_API_KEY=${BRAVE_SEARCH_API_KEY}
```

## Security Considerations

- No user input validation on search queries — API handles sanitization
- URL validation: only allow `http://` and `https://` schemes
- No local file access via `file://` URLs
- Timeout limits prevent hanging on slow/unresponsive servers
