import assert from 'node:assert/strict'
import { test } from 'node:test'
import { databaseRows, parseRedisInfo, ttlText } from '../src/terminal/redis-metrics'

test('reads live Redis metrics and distinguishes empty databases from unavailable key counts', () => {
  const stats = parseRedisInfo('# Memory\r\nused_memory:1048576\r\nmaxmemory:0\r\n# Stats\r\ninstantaneous_ops_per_sec:12\r\n# Keyspace\r\ndb0:keys=8,expires=3,avg_ttl=1000\r\ndb2:keys=2,expires=0,avg_ttl=0\r\n', 1234)
  assert.equal(stats.memory, 1048576)
  assert.equal(stats.maxMemory, 0)
  assert.equal(stats.ops, 12)
  assert.equal(stats.at, 1234)
  assert.deepEqual(databaseRows(stats, 3, 0), [
    { index: 0, keys: 8, expires: 3 },
    { index: 1, keys: 0, expires: 0 },
    { index: 2, keys: 2, expires: 0 },
  ])
  assert.deepEqual(databaseRows(parseRedisInfo('used_memory:3'), undefined, 7), [
    { index: 0, keys: undefined, expires: undefined },
    { index: 7, keys: undefined, expires: undefined },
  ])
})

test('counts down expiring keys while preserving Redis missing and persistent states', () => {
  assert.equal(ttlText(5, 1000, 4000), '2s')
  assert.equal(ttlText(5, 1000, 7000), 'Due')
  assert.equal(ttlText(-1, 1000, 7000), 'Persistent')
  assert.equal(ttlText(-2, 1000, 7000), 'Missing')
})
