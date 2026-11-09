import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureSnapshot } from '../src/core/capture'
import { compareSnapshots, coverage, parseSnapshot, printKey } from '../src/core/snapshot'

test('captures full counts, bounded typed keys, and opt-in values using open handles', async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('offline-sync', 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('sync_queue')
      store.createIndex('state', 'state')
      store.put({ state: 'queued' }, [1, new Date('2026-01-01')])
      store.put({ state: 'queued' }, [2, new Date('2026-01-01')])
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  try {
    const before = await captureSnapshot([db], { origin: 'https://example.test', maxKeys: 1 })
    const store = parseSnapshot(JSON.stringify(before)).databases[0].stores[0]
    assert.equal(store.count, 2)
    assert.equal(coverage(store), 'Showing 1 captured key · 2 total')
    assert.match(printKey(store.keys[0]), /Date\(2026-01-01/)
    assert.equal(store.values, undefined)
    assert.equal(store.indexes[0].name, 'state')

    const complete = await captureSnapshot([db], { origin: before.origin, includeValues: true })
    assert.equal(complete.databases[0].stores[0].values?.length, 2)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite')
      tx.objectStore('sync_queue').clear()
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
    const after = await captureSnapshot([db], { origin: before.origin })
    const [partial] = compareSnapshots(before, after)
    assert.equal(partial.delta, -2)
    assert.equal(partial.removed, undefined)
    assert.equal(compareSnapshots(complete, after)[0].removed?.length, 2)
    assert.equal(after.databases[0].stores[0].count, 0)
  } finally {
    db.close()
  }
})

test('rejects unsupported versions and inconsistent previews', () => {
  assert.throws(() => parseSnapshot('{"schemaVersion":2}'), /Unsupported snapshot version/)
  assert.throws(() => parseSnapshot(JSON.stringify({
    schemaVersion: 1, origin: 'https://example.test', capturedAt: '2026-01-01T00:00:00Z',
    databases: [{ name: 'test', version: 1, stores: [{
      name: 'items', keyPath: null, autoIncrement: false, count: 8,
      indexes: [], keys: [], keysComplete: true,
    }] }],
  })), /complete preview/i)
})

test('round-trips extended dates, binary keys, and infinite numbers', async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('typed-keys')
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('keys')
      store.put(new Map(), -Infinity)
      store.put('too long', new Date(8_640_000_000_000_000))
      store.put(null, new Uint8Array([0, 255]))
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  try {
    const captured = await captureSnapshot([db], {
      origin: 'https://example.test', includeValues: true, maxValueBytes: 4,
    })
    const imported = parseSnapshot(JSON.stringify(captured))
    const [store] = imported.databases[0].stores
    assert.deepEqual(store.keys.map(printKey), ['-Infinity', 'Date(+275760-09-13T00:00:00.000Z)', 'Binary(0x00ff)'])
    assert.match(store.values![0].omitted!, /unsupported/)
    assert.match(store.values![1].omitted!, /size limit/)
    assert.equal(store.values![2].value, null)
    assert.equal(store.values![2].omitted, undefined)
  } finally {
    db.close()
  }
})
