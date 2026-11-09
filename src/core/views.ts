import { compareSnapshots, countText, coverage, keyId, numberText, printKey, storesOf, type Capture, type Point, type Store } from './snapshot'
import { cell, prettyJson, type Row } from './rest'

export const databaseViews = ['Overview', 'Keys', 'Indexes', 'Charts', 'Comparison'] as const
export const restViews = ['Raw', 'Table', 'Chart'] as const

export const overviewColumns = ['Store', 'Records', 'Key preview', 'Indexes']
export const overviewRows = (capture: Capture) => storesOf(capture.snapshot).map(({ database, store, id }) => ({
  id, Store: capture.snapshot.databases.length > 1 ? database + ' / ' + store.name : store.name, Records: store.count, 'Key preview': coverage(store), Indexes: store.indexes.length,
}))
export const indexColumns = ['Index', 'Key path', 'Unique', 'Multi-entry', 'Index entries', 'Distinct index key values']
export const indexRows = (store?: Store) => (store?.indexes ?? []).map(index => ({
  Index: index.name, 'Key path': index.keyPath, Unique: index.unique, 'Multi-entry': index.multiEntry,
  'Index entries': index.entries, 'Distinct index key values': index.distinctKeys,
}))

export const comparisonColumns = ['Store', 'Before', 'After', 'Change', 'Keys']
export const signed = (value: number) => (value > 0 ? '+' : '') + numberText(value)
export function comparisonRows(before?: Capture, after?: Capture) {
  if (!before || !after) return []
  return compareSnapshots(before.snapshot, after.snapshot).map(item => ({
    ...item, Store: before.snapshot.databases.length > 1 || after.snapshot.databases.length > 1
      ? item.database + ' / ' + item.name : item.name, Before: item.beforeCount, After: item.afterCount, Change: item.delta,
    Keys: item.added && item.removed ? '+' + item.added.length + ' / −' + item.removed.length : 'Unavailable',
  }))
}
export type ComparisonRow = ReturnType<typeof comparisonRows>[number]

export function displayCell(row: Row, column: string, snapshot = true) {
  const value = Object.hasOwn(row, column) ? row[column] : undefined
  if (snapshot && column === 'Before' && row.presence === 'new') return 'New store'
  if (snapshot && column === 'After' && row.presence === 'missing') return 'Missing store'
  if (snapshot && value === null && ['Before', 'After', 'Records', 'Change'].includes(column)) return countText(value)
  if (snapshot && column === 'Change' && typeof value === 'number') return signed(value)
  if (typeof value === 'number') return numberText(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return cell(value)
}

export function keyRows(store?: Store) {
  return (store?.keys ?? []).map(key => ({ key, Key: printKey(key) }))
}

export function valueText(store: Store | undefined, key: Parameters<typeof keyId>[0]) {
  const entry = store?.values?.find(entry => keyId(entry.key) === keyId(key))
  if (!entry) return 'Value not captured'
  if (entry.omitted) return entry.omitted
  return prettyJson(entry.value) ?? cell(entry.value)
}

export function matchingValues(captures: Capture[], capture: Capture, key: Parameters<typeof keyId>[0]) {
  const identity = keyId(key)
  return captures.flatMap((entry, index) => {
    if (entry.snapshot.origin !== capture.snapshot.origin) return []
    return storesOf(entry.snapshot).filter(item => item.store.keys.some(key => keyId(key) === identity))
      .map(item => ({ ...item, capture: entry, index }))
  })
}

export function storageText(capture: Capture) {
  const { usage, quota } = capture.snapshot.storage ?? {}
  const bytes = (value: number | undefined) => value === undefined ? 'Unavailable' : numberText(value) + ' B'
  return bytes(usage) + ' / ' + bytes(quota)
}

export function chartDomain(points: Point[]) {
  let min = 0
  let max = 0
  for (const { value } of points) {
    if (value === null) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (min === max) max = 1
  const scale = Math.max(Math.abs(min), Math.abs(max))
  return { min, max, ratio: (value: number) => (value / scale - min / scale) / (max / scale - min / scale) }
}
