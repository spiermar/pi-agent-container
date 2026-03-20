export interface SearchResult {
  title: string
  url: string
  description: string
}

export interface WebSearchOptions {
  count?: number
  offset?: number
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
