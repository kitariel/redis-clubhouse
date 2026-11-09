import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const temp = await mkdtemp(join(tmpdir(), 'termscope-e2e-'))
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }
const sales = { data: { items: [
  { month: 'Jan', region: 'East', revenue: 12400 },
  { month: 'Feb', region: 'West', revenue: 14900 },
  { month: 'Mar', region: 'East', revenue: 13100 },
] } }
let requests = 0
const server = createServer(async (request, response) => {
  if (request.url === '/sales' || request.url === '/regions') {
    requests++
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(request.url === '/sales' ? sales : [{ region: 'East', revenue: 25500 }]))
    return
  }
  if (request.url === '/test-app/') {
    response.setHeader('Content-Type', 'text/html')
    response.end('<title>Offline sync test app</title>')
    return
  }
  const path = request.url?.match(/^\/project\/([\w.\-/]*)$/)?.[1]
  try {
    if (path === undefined || path.split('/').includes('..')) throw new Error('Invalid path')
    const file = join('dist', path || 'index.html')
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream')
    response.end(await readFile(file))
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port
let browser
try {
  browser = await chromium.launch({ channel: process.env.TERMSCOPE_CHROMIUM_CHANNEL || undefined })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(7000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error))
  await page.goto(url + '/test-app/')
  const snapshots = await page.evaluate(async () => {
    const { captureSnapshot } = await import('/project/capture.mjs')
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('test-ledger', 1)
      open.onupgradeneeded = () => {
        const db = open.result
        const transactions = db.createObjectStore('transactions', { keyPath: 'id' })
        transactions.createIndex('state', 'state')
        for (let i = 1; i <= 1248; i++) transactions.put({ id: 'txn-z-' + String(i).padStart(5, '0'), state: 'posted' })
        const accounts = db.createObjectStore('accounts')
        for (let i = 1; i <= 6; i++) accounts.put({ name: 'Account ' + i }, i)
        const queue = db.createObjectStore('sync_queue', { keyPath: 'id' })
        for (let i = 1; i <= 18; i++) queue.put({ id: 'txn-sync-' + String(i).padStart(3, '0'), state: 'queued' })
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const before = await captureSnapshot([database], { includeValues: true, maxKeys: 1300 })
    const partial = await captureSnapshot([database], { maxKeys: 5 })
    await new Promise((resolve, reject) => {
      const tx = database.transaction(['sync_queue', 'transactions'], 'readwrite')
      const queue = tx.objectStore('sync_queue')
      const rows = queue.getAll()
      rows.onsuccess = () => {
        for (const item of rows.result) tx.objectStore('transactions').put({ ...item, state: 'posted' })
        queue.clear()
      }
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
    })
    const after = await captureSnapshot([database], { maxKeys: 50, includeValues: true })
    database.close()
    return { before, after, partial }
  })
  assert.equal(snapshots.before.databases[0].stores.find(store => store.name === 'sync_queue').count, 18)
  assert.equal(snapshots.after.databases[0].stores.find(store => store.name === 'sync_queue').count, 0)
  const destination = snapshots.after.databases[0].stores.find(store => store.name === 'transactions')
  assert.equal(destination.count, 1266)
  assert.equal(destination.values[0].value.state, 'posted')
  const files = Object.fromEntries(await Promise.all(Object.entries(snapshots).map(async ([name, data]) => {
    const path = join(temp, name + '.json')
    await writeFile(path, JSON.stringify(data))
    return [name, path]
  })))

  await page.goto(url + '/project/')
  await page.getByRole('heading', { name: 'Database overview' }).waitFor()
  if (process.env.TERMSCOPE_SCREENSHOT) await page.screenshot({ path: process.env.TERMSCOPE_SCREENSHOT })
  await page.keyboard.press('c')
  await page.getByRole('heading', { name: 'Compare snapshots' }).waitFor()
  const queue = page.getByRole('row').filter({ hasText: 'sync_queue' })
  assert.match(await queue.innerText(), /18\s+0\s+-18/)
  await queue.getByRole('button').click()
  await page.getByRole('heading', { name: 'Removed keys (18)' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: 'Databases and stores' }).getByRole('button', { name: /sync_queue/ }).click()
  await page.getByRole('button', { name: '"txn-sync-001"', exact: true }).click()
  await page.getByText('"state": "queued"', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'After sync / ledger / transactions' }).click()
  await page.getByText('"state": "posted"', { exact: false }).waitFor()
  await page.keyboard.press('Escape')

  // Import reverse filename order to verify automatic chronological pairing.
  await page.locator('input[type=file]').setInputFiles([files.after, files.before])
  await page.getByText('Imported snapshot', { exact: true }).waitFor()
  await page.keyboard.press('c')
  assert.match(await queue.innerText(), /18\s+0\s+-18/)
  await page.keyboard.press('4')
  await page.getByLabel('Store', { exact: true }).selectOption({ label: 'test-ledger / sync_queue' })
  await page.getByRole('heading', { name: 'Record count over time' }).waitFor()
  await page.getByRole('button', { name: /before.json: 18$/ }).focus()
  await page.keyboard.press('ArrowRight')
  assert.match(await page.locator('figcaption').innerText(), /after.json.*\s0$/s)
  await page.getByRole('navigation', { name: 'Databases and stores' }).getByRole('button', { name: /sync_queue/ }).click()
  await page.getByRole('button', { name: '"txn-sync-001"', exact: true }).click()
  await page.getByRole('button', { name: 'after.json / test-ledger / transactions' }).click()
  await page.getByText('"state": "posted"', { exact: false }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('input[type=file]').setInputFiles(files.partial)
  await page.getByRole('button', { name: /partial.json/ }).waitFor()
  await page.keyboard.press('c')
  await page.getByLabel('Before', { exact: true }).selectOption({ label: 'partial.json' })
  await page.getByLabel('After', { exact: true }).selectOption({ label: 'after.json' })
  assert.match(await queue.innerText(), /18\s+0\s+-18\s+Unavailable/)
  await queue.getByRole('button').click()
  await page.getByText('Key comparison unavailable.', { exact: false }).waitFor()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'REST', exact: true }).click()
  await page.keyboard.press('2')
  await page.getByRole('button', { name: /Pin chart/ }).click()
  await page.getByRole('button', { name: /Feb: 14,900/ }).waitFor()
  await page.keyboard.press('/')
  await page.getByRole('textbox', { name: 'Filter rows' }).fill('East')
  assert.equal(await page.getByRole('button', { name: /Feb: 14,900/ }).count(), 0)
  await page.getByRole('button', { name: /Mar: 13,100/ }).waitFor()
  assert.equal(requests, 0, 'Browser fixture must not call the REST server')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
  assert.deepEqual(pageErrors, [])
  console.log('Chromium capture, imports, comparison, captured values, fixture chart, and mobile layout passed')

  const terminal = spawn('python3', ['tests/terminal-e2e.py', files.before, files.after, files.partial, url], { stdio: 'inherit' })
  await new Promise((resolve, reject) => {
    terminal.on('error', reject)
    terminal.on('exit', code => code === 0 ? resolve() : reject(new Error('Terminal verification exited with status ' + code)))
  })
  assert.equal(requests, 2)
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(temp, { recursive: true, force: true })
}
