import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createWebTools } from '../../src/web-tools.js'

describe('createWebTools', () => {
  it('returns array of tools', () => {
    const tools = createWebTools()
    expect(tools).toBeInstanceOf(Array)
    expect(tools.length).toBe(2)
  })

  it('includes web_search tool', () => {
    const tools = createWebTools()
    const webSearch = tools.find(t => t.name === 'web_search')
    expect(webSearch).toBeDefined()
    expect(webSearch?.description.toLowerCase()).toContain('search')
  })

  it('includes web_fetch tool', () => {
    const tools = createWebTools()
    const webFetch = tools.find(t => t.name === 'web_fetch')
    expect(webFetch).toBeDefined()
    expect(webFetch?.description.toLowerCase()).toContain('fetch')
  })
})

describe('web_search tool execution', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.BRAVE_SEARCH_API_KEY = 'test-key'
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: { results: [{ title: 'Test', url: 'https://example.com', description: 'Desc' }] }
      }),
    })
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error cleanup
    delete global.fetch
  })

  it('returns search results', async () => {
    const tools = createWebTools()
    const webSearch = tools.find(t => t.name === 'web_search')
    
    const result = await webSearch!.execute('test-id', { query: 'test query' })
    
    expect(result).toMatchObject({
      details: { results: [{ title: 'Test', url: 'https://example.com', description: 'Desc' }] }
    })
  })
})
