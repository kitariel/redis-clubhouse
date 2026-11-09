import type { Key, Snapshot, Store } from './snapshot'

export const maxSnapshotBytes = 20 * 1024 * 1024

export type CaptureOptions = {
  origin?: string
  maxKeys?: number
  includeValues?: boolean
  maxValues?: number
  maxValueBytes?: number
}

function encodeKey(key: IDBValidKey): Key {
  if (Array.isArray(key)) return key.map(encodeKey)
  if (key instanceof Date) return { type: 'date', value: key.toISOString() }
  if (typeof key === 'string') return key
  if (typeof key === 'number') {
    if (Number.isFinite(key)) return key
    return { type: 'number', value: key < 0 ? '-Infinity' : 'Infinity' }
  }
  const bytes = key instanceof ArrayBuffer
    ? new Uint8Array(key)
    : new Uint8Array(key.buffer, key.byteOffset, key.byteLength)
  return { type: 'binary', value: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') }
}

function encodeValue(value: unknown, maxBytes: number) {
  try {
    const json = JSON.stringify(value, function (name, current: unknown) {
      const original: unknown = Object.hasOwn(this, name) ? this[name] : current
      if (original instanceof Date && typeof current === 'string') return { type: 'date', value: current }
      if (current === null || ['boolean', 'string'].includes(typeof current)) return current
      if (typeof current === 'number' && Number.isFinite(current)) return current
      if (current && typeof current === 'object' &&
          (Array.isArray(current) || Object.getPrototypeOf(current) === Object.prototype)) return current
      throw new Error('Value uses an unsupported type')
    })
    if (new TextEncoder().encode(json).length > maxBytes) return { value: null, omitted: 'Value exceeds capture size limit' }
    return { value: JSON.parse(json) as unknown }
  } catch {
    return { value: null, omitted: 'Value contains an unsupported type or circular reference' }
  }
}

function bounded(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error('Capture limit must be an integer from 0 to ' + maximum)
  }
  return value
}

export async function captureSnapshot(handles: Iterable<IDBDatabase>, options: CaptureOptions = {}): Promise<Snapshot> {
  const origin = options.origin ?? globalThis.location?.origin
  if (!origin || new URL(origin).origin !== origin || origin === 'null') {
    throw new Error('Capture requires an origin such as https://example.test')
  }
  const maxKeys = bounded(options.maxKeys, 50, 10_000)
  const maxValues = options.includeValues ? Math.min(maxKeys, bounded(options.maxValues, 10, 1000)) : 0
  const maxValueBytes = bounded(options.maxValueBytes, 4096, 1024 * 1024)
  const databases = [...handles]
  if (new Set(databases.map(db => db.name)).size !== databases.length) throw new Error('Pass one open handle per database')
  const capturedAt = new Date().toISOString()
  const captures = await Promise.all(databases.map(async db => {
    const names = Array.from(db.objectStoreNames)
    const stores = names.length ? await new Promise<Store[]>((resolve, reject) => {
      const tx = db.transaction(names, 'readonly')
      const result = names.map(name => {
        const source = tx.objectStore(name)
        const store: Store = {
          name, keyPath: source.keyPath, autoIncrement: source.autoIncrement, count: null,
          keys: [], keysComplete: false,
          indexes: Array.from(source.indexNames, indexName => {
            const index = source.index(indexName)
            return { name: indexName, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }
          }),
        }
        if (maxValues) store.values = []
        const count = source.count()
        count.onsuccess = () => { store.count = count.result }
        count.onerror = event => event.preventDefault()
        const cursor = source.openKeyCursor()
        cursor.onerror = event => event.preventDefault()
        cursor.onsuccess = () => {
          const row = cursor.result
          if (!row) {
            store.keysComplete = true
            return
          }
          if (store.keys.length >= maxKeys) return
          const key = encodeKey(row.primaryKey)
          store.keys.push(key)
          if (store.keys.length <= maxValues) {
            const value = source.get(row.primaryKey)
            value.onsuccess = () => { store.values!.push({ key, ...encodeValue(value.result, maxValueBytes) }) }
            value.onerror = event => {
              event.preventDefault()
              store.values!.push({ key, value: null, omitted: 'Value could not be read' })
            }
          }
          row.continue()
        }
        return store
      })
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(new Error('Read-only capture failed for database ' + db.name, { cause: tx.error }))
    }) : []
    return { name: db.name, version: db.version, stores }
  }))
  const snapshot: Snapshot = { schemaVersion: 1, origin, capturedAt, databases: captures }
  try {
    const estimate = await globalThis.navigator?.storage?.estimate()
    if (estimate) snapshot.storage = { usage: estimate.usage, quota: estimate.quota }
  } catch {
    // Storage estimates are optional.
  }
  return snapshot
}

export async function downloadSnapshot(handles: Iterable<IDBDatabase>, options?: CaptureOptions) {
  const snapshot = await captureSnapshot(handles, options)
  const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
  if (blob.size > maxSnapshotBytes) {
    throw new Error('Capture exceeds 20 MiB. Reduce maxKeys, maxValues, or maxValueBytes and try again.')
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'termscope-' + snapshot.capturedAt.replaceAll(':', '-') + '.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return snapshot
}
