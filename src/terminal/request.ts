import type { HttpRequest, HttpResponse } from '../core/rest'

type RequestOptions = {
  baseUrl?: string
  env?: Record<string, string | undefined>
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
}
const variable = /\{\{([A-Za-z_][A-Za-z_0-9]*)\}\}/g

export async function runRequest(request: HttpRequest, options: RequestOptions = {}): Promise<HttpResponse> {
  const expand = (text: string) => text.replace(variable, (_, name: string) => {
    const value = (options.env ?? process.env)[name]
    if (value === undefined) throw new Error('Set the environment variable ' + name + ' before running this request.')
    return value
  })
  const target = expand(request.url)
  const base = options.baseUrl ? expand(options.baseUrl) : undefined
  let url: URL
  try { url = new URL(target, base) } catch {
    throw new Error('Use an absolute HTTP(S) URL or provide --base-url for relative paths.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP(S) URL and put credentials in request headers.')
  }
  const headers = request.headers.map(([name, value]): [string, string] => [name, expand(value)])
  const body = request.body === undefined ? undefined : expand(request.body)
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const limit = options.maxBytes ?? 2 * 1024 * 1024
  const start = performance.now()
  try {
    const response = await fetch(url, { method: request.method, headers, body, signal, redirect: 'manual' })
    let text = ''
    let bytes = 0
    const decoder = new TextDecoder()
    if (response.body) {
      const reader = response.body.getReader()
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.length
          if (bytes > limit) {
            await reader.cancel()
            throw new Error('RESPONSE_LIMIT')
          }
          text += decoder.decode(chunk.value, { stream: true })
        }
        text += decoder.decode()
      } finally {
        reader.releaseLock()
      }
    }
    let json: unknown
    try { json = JSON.parse(text) } catch { /* Plain text response. */ }
    return { status: response.status, elapsed: Math.round(performance.now() - start), text, json }
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Request cancelled.')
    if (timeout.aborted) throw new Error('Request timed out.')
    if (error instanceof Error && error.message === 'RESPONSE_LIMIT') {
      throw new Error('Response exceeded ' + limit.toLocaleString('en-US') + ' bytes.')
    }
    throw new Error('Request failed. Check the URL, headers, body, and network connection.')
  }
}
