import { maxSnapshotBytes } from '../core/capture'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { render } from 'ink'
import { demoCaptures } from '../core/demo'
import { parseSnapshot } from '../core/snapshot'
import { parseHttp } from '../core/rest'
import { Terminal, type Source } from './terminal'
import { safeLine } from './rendering'

const usage = `TermScope · terminal data inspector

  termscope demo [--ascii]
  termscope inspect <snapshot.json> [snapshot.json ...] [--ascii]
  termscope open <requests.http> [--base-url <url>] [--ascii]

Use a TTY and press ? to see the current shortcuts.
`

async function readLocal(path: string, limit: number) {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    const data = chunk as Buffer
    bytes += data.length
    if (bytes > limit) throw new Error('File exceeds the ' + (limit / 1024 / 1024) + ' MiB input limit.')
    chunks.push(data)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main([command, ...args]: string[]) {
  if (!command || command === '--help' || args.includes('--help')) {
    process.stdout.write(usage)
    return
  }
  const files: string[] = []
  let ascii = false
  let baseUrl: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ascii') ascii = true
    else if (args[i] === '--base-url' && command === 'open' && args[i + 1] && !args[i + 1].startsWith('--')) baseUrl = args[++i]
    else if (args[i].startsWith('--')) throw new Error('Unknown or incomplete option: ' + args[i])
    else files.push(args[i])
  }
  let source: Source
  if (command === 'demo' && files.length === 0) source = { mode: 'IndexedDB', captures: demoCaptures }
  else if (command === 'inspect' && files.length) {
    const captures = []
    for (const file of files) {
      try { captures.push({ label: basename(file), snapshot: parseSnapshot(await readLocal(file, maxSnapshotBytes)) }) }
      catch (error) { throw new Error(basename(file) + ': ' + (error as Error).message) }
    }
    source = { mode: 'IndexedDB', captures }
  } else if (command === 'open' && files.length === 1) {
    source = { mode: 'REST', file: basename(files[0]), requests: parseHttp(await readLocal(files[0], 1024 * 1024)), baseUrl }
  } else throw new Error('Invalid arguments. Run termscope --help.')
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Open TermScope in an interactive terminal.')
  const app = render(<Terminal source={source} ascii={ascii} />)
  await app.waitUntilExit()
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  process.stderr.write('TermScope: ' + safeLine((error as Error).message) + '\n')
  process.exitCode = 1
}
