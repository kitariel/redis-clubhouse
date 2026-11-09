import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { findTables, filterSort, makeSeries, parseHttp } from '../src/core/rest'
import { runRequest } from '../src/terminal/request'

test('runs a real request and derives the chart from filtered and numerically sorted rows', async () => {
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer local-secret')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: { items: [
      { name: 'East', sales: 100 }, { name: 'West', sales: 2 }, { name: 'East', sales: 20 },
    ] }, meta: [{ label: 'a' }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const [request] = parseHttp('### Sales\nGET /sales\nAuthorization: Bearer {{TOKEN}}')
    const response = await runRequest(request, {
      baseUrl: 'http://127.0.0.1:' + address.port, env: { TOKEN: 'local-secret' },
    })
    assert.equal(response.status, 200)
    const tables = findTables(response.json)
    assert.deepEqual(tables.map(table => table.path), ['$.data.items', '$.meta'])
    const rows = filterSort(tables[0].rows, 'east', { column: 'sales', descending: false })
    assert.deepEqual(makeSeries(rows, 'name', 'sales').map(point => point.value), [20, 100])
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('rejects malformed headers with their line number', () => {
  assert.throws(() => parseHttp('GET /sales\nAccept application/json'), /Line 2/)
})

test('bounds response bodies and distinguishes timeouts from cancellation', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/large') response.end('x'.repeat(2048))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const baseUrl = 'http://127.0.0.1:' + address.port
    const [large, wait] = parseHttp('GET /large\n###\nGET /wait')
    await assert.rejects(runRequest(large, { baseUrl, maxBytes: 1024 }), /exceeded 1,024 bytes/)
    await assert.rejects(runRequest(wait, { baseUrl, timeoutMs: 40 }), /timed out/)
    const controller = new AbortController()
    const pending = runRequest(wait, { baseUrl, signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, /cancelled/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
