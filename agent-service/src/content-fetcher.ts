import type { FetchedContent, FetchError } from './web-tools.js'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { parseHTML } from 'linkedom'
import pdf from 'pdf-parse'

const MAX_URL_LENGTH = 2048
const DEFAULT_TIMEOUT = 30000

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

function validateUrl(url: string): { valid: true } | { valid: false; error: string } {
  if (url.length > MAX_URL_LENGTH) {
    return { valid: false, error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` }
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: `Invalid URL scheme: ${parsed.protocol}. Only http:// and https:// are allowed` }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: `Invalid URL format: ${url}` }
  }
}

function extractContentType(header: string | null): string | null {
  if (!header) return null
  return header.split(';')[0].trim().toLowerCase()
}

async function extractHtml(html: string): Promise<string> {
  const { document } = parseHTML(html)
  const reader = new Readability(document)
  const article = reader.parse()

  if (!article || !article.content) {
    return document.body?.textContent?.trim() ?? ''
  }

  return turndownService.turndown(article.content)
}

export async function fetchContent(url: string): Promise<FetchedContent | FetchError> {
  const validation = validateUrl(url)
  if (!validation.valid) {
    return { error: true, message: validation.error }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return { error: true, message: `Failed to fetch ${url}: HTTP ${response.status}` }
    }

    const contentType = extractContentType(response.headers.get('content-type'))

    if (contentType === 'text/html') {
      const html = await response.text()
      const content = await extractHtml(html)
      return { content, contentType: 'text/html' }
    }

    if (contentType === 'application/pdf') {
      const buffer = await response.arrayBuffer()
      const data = await pdf(Buffer.from(buffer))
      return { content: data.text, contentType: 'application/pdf' }
    }

    return {
      error: true,
      message: `Unsupported content type: ${contentType ?? 'unknown'}. Supported: text/html, application/pdf`,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: true, message: `Request to ${url} timed out` }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { error: true, message: `Failed to fetch ${url}: ${message}` }
  }
}
