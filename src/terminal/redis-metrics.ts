export type RedisDatabase = { index: number; keys?: number; expires?: number }
export type RedisMetrics = {
  at: number
  memory?: number
  maxMemory?: number
  ops?: number
  clients?: number
  version?: string
  keyspace?: Map<number, RedisDatabase>
}

function count(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

export function parseRedisInfo(info: string, at = Date.now()): RedisMetrics {
  const fields = new Map<string, string>()
  const databases = new Map<number, RedisDatabase>()
  let keyspaceAvailable = false
  for (const line of info.split(/\r?\n/)) {
    if (line.trim() === '# Keyspace') keyspaceAvailable = true
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const name = line.slice(0, colon)
    const value = line.slice(colon + 1).trim()
    const db = /^db(\d+)$/.exec(name)
    const index = db ? count(db[1]) : undefined
    if (index !== undefined) {
      const keys = count(/(?:^|,)keys=(\d+)(?:,|$)/.exec(value)?.[1])
      const expires = count(/(?:^|,)expires=(\d+)(?:,|$)/.exec(value)?.[1])
      if (keys !== undefined) databases.set(index, { index, keys, expires })
    } else {
      fields.set(name, value)
    }
  }
  return {
    at, memory: count(fields.get('used_memory')), maxMemory: count(fields.get('maxmemory')),
    ops: count(fields.get('instantaneous_ops_per_sec')), clients: count(fields.get('connected_clients')),
    version: fields.get('redis_version'),
    keyspace: keyspaceAvailable || databases.size ? databases : undefined,
  }
}

export function databaseRows(stats: RedisMetrics | undefined, configured: number | undefined, active: number): RedisDatabase[] {
  const indices = new Set([0, active, ...(stats?.keyspace?.keys() ?? [])])
  for (let index = 0; index < Math.min(configured ?? 0, 256); index++) indices.add(index)
  return [...indices].sort((a, b) => a - b).map(index => stats?.keyspace?.get(index) ?? {
    index, keys: stats?.keyspace ? 0 : undefined, expires: stats?.keyspace ? 0 : undefined,
  })
}

export function number(value: number | undefined) {
  return value === undefined ? '—' : value.toLocaleString('en-US')
}

export function bytes(value: number | undefined) {
  if (value === undefined) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return value.toLocaleString('en-US', { maximumFractionDigits: unit ? 2 : 0 }) + ' ' + units[unit]
}

export function ttlText(ttl: number | undefined, at?: number, now = Date.now()) {
  if (ttl === undefined) return '—'
  if (ttl === -2) return 'Missing'
  if (ttl === -1) return 'Persistent'
  if (at !== undefined) {
    ttl -= Math.floor(Math.max(0, now - at) / 1000)
    if (ttl < 0) return 'Due'
  }
  if (ttl >= 86400) return Math.floor(ttl / 86400) + 'd ' + Math.floor(ttl % 86400 / 3600) + 'h'
  if (ttl >= 3600) return Math.floor(ttl / 3600) + 'h ' + Math.floor(ttl % 3600 / 60) + 'm'
  if (ttl >= 60) return Math.floor(ttl / 60) + 'm ' + ttl % 60 + 's'
  return ttl + 's'
}
