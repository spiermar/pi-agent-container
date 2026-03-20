import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { BraveSearchClient } from '../../src/brave-search.js'

describe('BraveSearchClient', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.BRAVE_SEARCH_API_KEY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns error when BRAVE_SEARCH_API_KEY is not set', async () => {
    const client = new BraveSearchClient()
    const result = await client.search('test query')
    
    expect(result.error).toBe(true)
    expect(result.message).toBe('BRAVE_SEARCH_API_KEY environment variable not set')
  })

  it('returns search results on successful API call', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-api-key'
    
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'Result 1', url: 'https://example.com/1', description: 'Description 1' },
            { title: 'Result 2', url: 'https://example.com/2', description: 'Description 2' },
          ]
        }
      })
    })
    global.fetch = mockFetch

    const client = new BraveSearchClient()
    const result = await client.search('test query')

    expect(result.error).toBeUndefined()
    if (!result.error) {
      expect(result.results).toHaveLength(2)
      expect(result.results[0].title).toBe('Result 1')
      expect(result.results[0].url).toBe('https://example.com/1')
    }
  })

  it('returns error on rate limit (429)', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-api-key'
    
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    })
    global.fetch = mockFetch

    const client = new BraveSearchClient()
    const result = await client.search('test query')

    expect(result.error).toBe(true)
    if (result.error) {
      expect(result.message).toBe('Brave Search API rate limit exceeded')
    }
  })
})
