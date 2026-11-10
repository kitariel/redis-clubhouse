import { isUtf8 } from 'node:buffer'
import { isIP } from 'node:net'
import { createClient, RESP_TYPES } from '@redis/client'

const previewBytes = 4096
const previewItems = 10

export type RedisTarget = { host: string; port: number; tls: boolean; database: number; label: string }
export type RedisPage = { cursor: string; keys: Buffer[] }
export type RedisPreview = { type: string; ttl: number; text: string; note?: string }
export class RedisAuthError extends Error {}

export function parseRedisTarget(address: string): RedisTarget {
  const invalid = 'Use a Redis address such as localhost:6379 or rediss://cache.example.com:6380/0.'
  const source = isIP(address) === 6 ? '[' + address + ']' : address
  let url: URL
  try { url = new URL(source.includes('://') ? source : 'redis://' + source) }
  catch { throw new Error(invalid) }
  if (url.username || url.password) {
    throw new Error('Enter the password when prompted or set REDISCLI_AUTH. Set REDIS_USERNAME for an ACL user.')
  }
  const port = Number(url.port || '6379')
  const database = Number(url.pathname.slice(1) || '0')
  if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || url.search || url.hash ||
      !/^(?:\/\d*)?$/.test(url.pathname) || port < 1 || !Number.isSafeInteger(database) ||
      /[\s%]/.test(url.hostname)) {
    throw new Error(invalid)
  }
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''), port, database, tls: url.protocol === 'rediss:',
    label: url.protocol + '//' + url.hostname + ':' + port + '/' + database,
  }
}

export function redisText(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    const slice = value.subarray(0, previewBytes)
    if (!isUtf8(slice)) return '0x' + slice.subarray(0, 128).toString('hex') + (value.length > 128 ? '…' : '')
    return JSON.stringify(slice.toString('utf8')) + (value.length > previewBytes ? '…' : '')
  }
  if (Array.isArray(value)) return '[' + value.map(redisText).join(', ') + ']'
  return String(value)
}

export function redisError(error: unknown) {
  if (error instanceof RedisAuthError) return 'Authentication required. Enter a password to connect.'
  const message = error instanceof Error ? error.message : ''
  if (/^(NOAUTH|WRONGPASS)\b/.test(message)) return 'Authentication failed. Check the password and REDIS_USERNAME.'
  if (/^NOPERM\b/.test(message)) return 'Redis denied this read command. Check the user’s ACL permissions.'
  if (/^WRONGTYPE\b/.test(message)) return 'The key type changed while reading it. Open the key again.'
  if (/^(MOVED|ASK)\b/.test(message)) return 'Redis redirected the command. Connect directly to the relevant Redis node.'
  if (message === 'Redis operation timed out.') return message
  return 'Redis request failed. Check the host, port, TLS setting, and server availability.'
}

async function deadline<T>(operation: Promise<T>, close: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Redis operation timed out.'))
        close()
      }, 5000)
    })])
  } finally {
    clearTimeout(timer)
  }
}

export function createRedisSession(target: RedisTarget, password?: string, username = process.env.REDIS_USERNAME) {
  const { host, port, tls, database } = target
  const socket = { host, port, connectTimeout: 4000, reconnectStrategy: false as const }
  const client = createClient({
    socket: tls ? { ...socket, tls: true, servername: isIP(host) ? undefined : host } : socket,
    database, password, username,
    disableOfflineQueue: true, disableClientInfo: true,
  })
  client.on('error', () => { /* Connection and command failures are handled by the caller. */ })
  const close = () => { if (client.isOpen) client.destroy() }
  const typeMapping = { [RESP_TYPES.BLOB_STRING]: Buffer }
  const command = <T,>(...args: (string | Buffer)[]) =>
    deadline(client.sendCommand<T>(args, { typeMapping }), close)

  return {
    get ready() { return client.isReady },
    async connect() {
      try { await deadline(client.connect(), close) }
      catch (error) {
        if (!password && error instanceof Error && /^NOAUTH\b/.test(error.message)) throw new RedisAuthError()
        throw error
      }
    },
    close,
    async scan(cursor: string, pattern: string): Promise<RedisPage> {
      try {
        // Sparse MATCH patterns can produce several empty batches while the cursor is still open.
        for (let i = 0; i < 5; i++) {
          const [next, keys] = await command<[Buffer, Buffer[]]>('SCAN', cursor, 'MATCH', pattern || '*', 'COUNT', '100')
          cursor = next.toString('ascii')
          if (keys.length || cursor === '0') {
            return { cursor, keys: [...new Map(keys.map(key => [key.toString('hex'), key])).values()] }
          }
        }
        return { cursor, keys: [] }
      } catch (error) {
        if (!password && error instanceof Error && /^NOAUTH\b/.test(error.message)) throw new RedisAuthError()
        throw error
      }
    },
    async inspect(key: Buffer): Promise<RedisPreview> {
      const [type, ttl] = await Promise.all([command<string>('TYPE', key), command<number>('TTL', key)])
      if (type === 'none' || ttl === -2) return { type: 'none', ttl: -2, text: 'The key no longer exists.' }
      if (type === 'string') {
        const [length, value] = await Promise.all([
          command<number>('STRLEN', key), command<Buffer>('GETRANGE', key, '0', String(previewBytes - 1)),
        ])
        return {
          type, ttl, text: redisText(value),
          note: length > previewBytes ? 'First 4,096 of ' + length.toLocaleString('en-US') + ' bytes' : length + ' bytes',
        }
      }

      const count = String(previewItems)
      const commands: Record<string, string[]> = {
        list: ['LRANGE', '0', String(previewItems - 1)],
        hash: ['HRANDFIELD', count, 'WITHVALUES'],
        set: ['SRANDMEMBER', count],
        zset: ['ZRANGE', '0', String(previewItems - 1), 'WITHSCORES'],
        stream: ['XRANGE', '-', '+', 'COUNT', count],
      }
      if (!Object.hasOwn(commands, type)) return { type, ttl, text: 'Value preview unavailable for this key type.' }
      const [name, ...args] = commands[type]
      const values = await command<unknown[] | null>(name, key, ...args) ?? []
      const pairs = type === 'hash' || type === 'zset'
      const lines = pairs ? Array.from({ length: Math.floor(values.length / 2) }, (_, i) =>
        redisText(values[2 * i]) + ' → ' + redisText(values[2 * i + 1])) : values.map(redisText)
      return { type, ttl, text: lines.join('\n') || 'Empty preview.', note: 'Preview of up to ' + count + ' items' }
    },
  }
}
