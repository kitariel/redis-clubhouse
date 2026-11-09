import { z } from 'zod'

export type Key = string | number | { type: 'date' | 'binary'; value: string } |
  { type: 'number'; value: 'Infinity' | '-Infinity' } | Key[]
const dateKey = z.string().regex(/^(?:[+-]\d{6}|\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
  .refine(value => Number.isFinite(Date.parse(value)), 'Invalid date key')
  .transform(value => new Date(value).toISOString())
const keySchema: z.ZodType<Key> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.array(keySchema),
  z.object({ type: z.literal('date'), value: dateKey }),
  z.object({ type: z.literal('binary'), value: z.string().regex(/^(?:[0-9a-f]{2})*$/) }),
  z.object({ type: z.literal('number'), value: z.enum(['Infinity', '-Infinity']) }),
]))
const countSchema = z.number().int().nonnegative().safe()
const keyPath = z.union([z.string(), z.array(z.string())])
const indexSchema = z.object({
  name: z.string(), keyPath, unique: z.boolean(), multiEntry: z.boolean(),
  entries: countSchema.optional(), distinctKeys: countSchema.optional(),
})
const storeSchema = z.object({
  name: z.string(), keyPath: keyPath.nullable(), autoIncrement: z.boolean(),
  count: countSchema.nullable(), indexes: z.array(indexSchema),
  keys: z.array(keySchema), keysComplete: z.boolean(),
  values: z.array(z.object({ key: keySchema, value: z.unknown(), omitted: z.string().optional() })
    .refine(entry => Object.hasOwn(entry, 'value'), 'Missing value')).optional(),
})
function unique<T>(items: T[], identity: (item: T) => string) {
  return new Set(items.map(identity)).size === items.length
}
const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  origin: z.string().url().refine(value => URL.canParse(value) && new URL(value).origin === value, 'Use an origin such as https://example.test'),
  capturedAt: z.string().datetime({ offset: true }),
  databases: z.array(z.object({
    name: z.string(), version: countSchema.positive(), stores: z.array(storeSchema),
  })),
  storage: z.object({ usage: countSchema.optional(), quota: countSchema.optional() }).optional(),
}).superRefine((snapshot, ctx) => {
  function issue(path: (string | number)[], message: string) {
    ctx.addIssue({ code: 'custom', path, message })
  }
  if (!unique(snapshot.databases, db => db.name)) issue(['databases'], 'Duplicate database name')
  snapshot.databases.forEach((db, dbIndex) => {
    const base = ['databases', dbIndex, 'stores']
    if (!unique(db.stores, store => store.name)) issue(base, 'Duplicate object store name')
    db.stores.forEach((store, storeIndex) => {
      const path = [...base, storeIndex]
      const keys = new Set(store.keys.map(keyId))
      if (keys.size !== store.keys.length) issue([...path, 'keys'], 'Duplicate primary key')
      if (!unique(store.indexes, index => index.name)) issue([...path, 'indexes'], 'Duplicate index name')
      if (store.keysComplete && store.count !== null && keys.size !== store.count) {
        issue([...path, 'keysComplete'], 'Complete preview must match the record count')
      }
      if (store.count !== null && keys.size > store.count) issue([...path, 'keys'], 'Preview exceeds the record count')
      const values = store.values ?? []
      if (!unique(values, entry => keyId(entry.key)) || values.some(entry => !keys.has(keyId(entry.key)))) {
        issue([...path, 'values'], 'Each value must reference a unique preview key')
      }
    })
  })
})

export type Snapshot = z.infer<typeof snapshotSchema>
export type Store = z.infer<typeof storeSchema>
export type Capture = { label: string; snapshot: Snapshot }

export function parseSnapshot(text: string): Snapshot {
  let data: unknown
  try { data = JSON.parse(text) } catch { throw new Error('Invalid JSON. Choose a TermScope snapshot file.') }
  if (data && typeof data === 'object' && 'schemaVersion' in data && data.schemaVersion !== 1) {
    throw new Error('Unsupported snapshot version. Export with schemaVersion 1.')
  }
  try {
    return snapshotSchema.parse(data)
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw new Error('Snapshot is too deeply nested to import.')
    throw new Error(error.issues.slice(0, 4).map(issue =>
      (issue.path.join('.') || 'snapshot') + ': ' + issue.message).join(' · '))
  }
}

export const keyId = (key: Key): string => JSON.stringify(key)
export function printKey(key: Key): string {
  if (Array.isArray(key)) return '[' + key.map(printKey).join(', ') + ']'
  if (typeof key !== 'object') return JSON.stringify(key)
  if (key.type === 'number') return key.value
  return key.type === 'date' ? 'Date(' + key.value + ')' : 'Binary(0x' + key.value + ')'
}
export const numberText = (n: number) => Number.isInteger(n) ? n.toLocaleString('en-US') : String(n)
export const countText = (n: number | null) => n === null ? 'Unavailable' : numberText(n)
export function coverage(store: Store) {
  if (store.keysComplete) return 'Complete · ' + numberText(store.keys.length) + ' keys'
  const keys = numberText(store.keys.length) + ' captured key' + (store.keys.length === 1 ? '' : 's')
  return 'Showing ' + keys + ' · ' + (store.count === null ? 'total unavailable' : numberText(store.count) + ' total')
}

export function storesOf(snapshot: Snapshot) {
  return snapshot.databases.flatMap(db => db.stores.map(store => ({
    database: db.name, store, id: JSON.stringify([snapshot.origin, db.name, store.name]),
  })))
}

export function compareSnapshots(before: Snapshot, after: Snapshot) {
  if (before.origin !== after.origin) return []
  const first = new Map(storesOf(before).map(item => [item.id, item]))
  const second = new Map(storesOf(after).map(item => [item.id, item]))
  return [...new Set([...first.keys(), ...second.keys()])].map(id => {
    const left = first.get(id)
    const right = second.get(id)
    const item = (right ?? left)!
    const beforeCount = left?.store.count ?? null
    const afterCount = right?.store.count ?? null
    const complete = left?.store.keysComplete && right?.store.keysComplete
    const firstKeys = complete ? new Set(left.store.keys.map(keyId)) : undefined
    const secondKeys = complete ? new Set(right.store.keys.map(keyId)) : undefined
    return {
      id, database: item.database, name: item.store.name, beforeCount, afterCount,
      presence: left && right ? 'present' : left ? 'missing' : 'new',
      delta: beforeCount !== null && afterCount !== null ? afterCount - beforeCount : null,
      added: firstKeys && right?.store.keys.filter(key => !firstKeys.has(keyId(key))),
      removed: secondKeys && left?.store.keys.filter(key => !secondKeys.has(keyId(key))),
    }
  })
}

export type Point = { label: string; value: number | null; detail?: string }
export function comparisonPair(captures: Capture[], origin: string): [number, number] {
  const indices = captures.map((capture, index) => ({ capture, index }))
    .filter(({ capture }) => capture.snapshot.origin === origin)
    .sort((a, b) => Date.parse(a.capture.snapshot.capturedAt) - Date.parse(b.capture.snapshot.capturedAt))
  return [indices[0].index, indices.at(-1)!.index]
}

export function storeSeries(captures: Capture[], active: Snapshot, id?: string): Point[] {
  if (!id) return storesOf(active).map(({ database, store }) => ({
    label: store.name, value: store.count, detail: database + ' / ' + store.name,
  }))
  return captures.filter(capture => capture.snapshot.origin === active.origin)
    .sort((a, b) => Date.parse(a.snapshot.capturedAt) - Date.parse(b.snapshot.capturedAt))
    .map(({ label, snapshot }) => ({
      label: snapshot.capturedAt.slice(11, 16) + ' · ' + label,
      value: storesOf(snapshot).find(item => item.id === id)?.store.count ?? null,
      detail: label + ' · ' + snapshot.capturedAt,
    }))
}
