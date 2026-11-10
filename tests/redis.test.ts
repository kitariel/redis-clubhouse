import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('registers the direct Redis command and accepts a host with port', () => {
  const cli = ['--import', 'tsx', 'src/terminal/cli.tsx']
  const output = execFileSync(process.execPath, [...cli, '--help'], { encoding: 'utf8' })
  assert.match(output, /redis-clubhouse \[host\[:port\]\|redis:\/\/url\]/)
  const result = spawnSync(process.execPath, [...cli, 'localhost:6379'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Open Redis Clubhouse in an interactive terminal/)
  const badOption = spawnSync(process.execPath, [...cli, 'localhost:6379', '--password=example-secret'], { encoding: 'utf8' })
  assert.equal(badOption.status, 1)
  assert.match(badOption.stderr, /Use redis-clubhouse <host/)
  assert.doesNotMatch(badOption.stderr, /example-secret/)
})

test('accepts bare Redis hosts, custom ports, and TLS URLs without exposing credentials', async () => {
  const { parseRedisTarget } = await import('../src/terminal/redis-client')
  assert.deepEqual(parseRedisTarget('localhost'), {
    host: 'localhost', port: 6379, tls: false, database: 0, label: 'redis://localhost:6379/0',
  })
  assert.deepEqual(parseRedisTarget('rediss://[::1]:6380/2'), {
    host: '::1', port: 6380, tls: true, database: 2, label: 'rediss://[::1]:6380/2',
  })
  assert.throws(() => parseRedisTarget('http://example.test:6379'), /Use a Redis address/)
  assert.throws(() => parseRedisTarget('redis://default:example-secret@localhost'), {
    message: 'Enter the password when prompted or set REDISCLI_AUTH. Set REDIS_USERNAME for an ACL user.',
  })
})
