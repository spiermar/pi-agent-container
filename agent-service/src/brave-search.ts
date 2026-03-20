import type { WebSearchResult, WebSearchError, WebSearchOptions, SearchResult } from './web-tools.js'

const API_BASE = 'https://api.search.brave.com/res/v1/web/search'
const DEFAULT_TIMEOUT = 30000

export class BraveSearchClient {
  private getApiKey(): string | null {
    return process.env.BRAVE_SEARCH_API_KEY ?? null
  }

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult | WebSearchError> {
    const apiKey = this.getApiKey()
    if (!apiKey) {
      return { error: true, message: 'BRAVE_SEARCH_API_KEY environment variable not set' }
    }

    const count = options.count ?? 10
    const offset = options.offset ?? 0

    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(count, 20)),
    })
    if (offset > 0) params.set('offset', String(offset))
    if (options.search_lang) params.set('search_lang', options.search_lang)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

      const response = await fetch(`${API_BASE}?${params}`, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey,
        },
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        if (response.status === 429) {
          return { error: true, message: 'Brave Search API rate limit exceeded' }
        }
        return { error: true, message: `Brave Search API error: ${response.status}` }
      }

      const data = await response.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } }
      const results: SearchResult[] = data.web?.results?.map(r => ({
        title: r.title,
        url: r.url,
        description: r.description,
      })) ?? []

      return { results }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { error: true, message: 'Search request timed out' }
      }
      const message = err instanceof Error ? err.message : String(err)
      return { error: true, message: `Brave Search API error: ${message}` }
    }
  }
}
