import type { Point } from './snapshot'

export type HttpRequest = { name: string; method: string; url: string; headers: [string, string][]; body?: string }
export type HttpResponse = { status: number; elapsed: number; text: string; json?: unknown }

export function parseHttp(source: string): HttpRequest[] {
  const requests: HttpRequest[] = []
  let lines: { text: string; line: number }[] = []
  let title = ''
  function finish() {
    const start = lines.findIndex(({ text }) => text.trim() && !/^\s*(?:#|\/\/)/.test(text))
    if (start === -1) return
    const first = lines[start]
    const match = /^([A-Z]+)\s+(\S+)(?:\s+HTTP\/\d(?:\.\d)?)?$/i.exec(first.text.trim())
    if (!match) throw new Error('Line ' + first.line + ': expected METHOD URL')
    const [, method, url] = match
    const headers: [string, string][] = []
    let next = start + 1
    for (; next < lines.length && lines[next].text.trim(); next++) {
      const { text, line } = lines[next]
      if (/^\s*(?:#|\/\/)/.test(text)) continue
      const header = /^([\w!#$%&'*+.^`|~-]+):\s*(.*)$/.exec(text)
      if (!header) throw new Error('Line ' + line + ': expected Header: value or a blank line before the body')
      headers.push([header[1], header[2]])
    }
    const body = lines.slice(next + 1).map(line => line.text).join('\n').trimEnd()
    requests.push({ name: title || 'Request ' + (requests.length + 1), method: method.toUpperCase(), url, headers, body: body || undefined })
  }
  source.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((text, index) => {
    const separator = /^\s*###(?:\s+(.*))?\s*$/.exec(text)
    if (separator) {
      finish()
      title = separator[1]?.trim() ?? ''
      lines = []
    } else lines.push({ text, line: index + 1 })
  })
  finish()
  if (!requests.length) throw new Error('No requests found. Add a line such as GET https://example.test/items.')
  return requests
}

export type Row = Record<string, unknown>
type Table = { path: string; rows: Row[] }
export type Sort = { column: string; descending: boolean }
const isRow = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value))

export function findTables(value: unknown): Table[] {
  const tables: Table[] = []
  const pending: { path: string; value: unknown }[] = [{ path: '$', value }]
  while (pending.length) {
    const item = pending.pop()!
    if (Array.isArray(item.value)) {
      if (item.value.every(isRow)) tables.push({ path: item.path, rows: item.value })
      for (let i = item.value.length - 1; i >= 0; i--) {
        const value = item.value[i]
        if (value && typeof value === 'object') pending.push({ path: item.path + '[' + i + ']', value })
      }
    } else if (isRow(item.value)) {
      for (const [key, value] of Object.entries(item.value).reverse()) {
        if (value && typeof value === 'object') {
          const suffix = /^[\w$]+$/.test(key) ? '.' + key : '[' + JSON.stringify(key) + ']'
          pending.push({ path: item.path + suffix, value })
        }
      }
    }
  }
  return tables
}

export function cell(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return '[Value is too deeply nested to display]' }
}
export const columnsOf = (rows: Row[]) => [...new Set(rows.flatMap(row => Object.keys(row)))]
export const field = (row: Row, key: string) => Object.hasOwn(row, key) ? row[key] : undefined

export function filterSort(rows: Row[], query: string, sort?: Sort) {
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? rows.filter(row => Object.values(row).some(value => cell(value).toLowerCase().includes(needle)))
    : rows
  if (!sort) return filtered
  return [...filtered].sort((a, b) => {
    const left = field(a, sort.column)
    const right = field(b, sort.column)
    if (left == null || right == null) return Number(left == null) - Number(right == null)
    const compare = typeof left === 'number' && typeof right === 'number'
      ? left - right : cell(left).localeCompare(cell(right), 'en', { numeric: true })
    return sort.descending ? -compare : compare
  })
}

export function makeSeries(rows: Row[], x: string, y: string): Point[] {
  return rows.map(row => {
    const value = field(row, y)
    return { label: cell(field(row, x)), value: typeof value === 'number' && Number.isFinite(value) ? value : null }
  })
}

export function prettyJson(value: unknown) {
  const pending = [{ value, depth: 0 }]
  let budget = 2 * 1024 * 1024
  while (pending.length) {
    const item = pending.pop()!
    budget -= item.depth * 4 + 4
    if (budget < 0 || item.depth > 96) return undefined
    if (item.value && typeof item.value === 'object') {
      for (const value of Object.values(item.value)) pending.push({ value, depth: item.depth + 1 })
    }
  }
  return JSON.stringify(value, null, 2)
}

export function rawText(response: HttpResponse) {
  if (response.json === undefined) return response.text
  return prettyJson(response.json) ?? response.text
}
