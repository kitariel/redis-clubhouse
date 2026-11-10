import { render } from 'ink'
import { parseRedisTarget } from './redis-client'
import { RedisTerminal } from './redis-terminal'
import { safeLine } from './rendering'

const usage = `Redis Clubhouse · live Redis dashboard

  redis-clubhouse [host[:port]|redis://url] [--ascii]

Defaults to localhost:6379. Use rediss:// for TLS.
Press ? in the dashboard for keyboard shortcuts.
`

async function main(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage)
    return
  }
  const ascii = args.includes('--ascii')
  const address = args.filter(arg => arg !== '--ascii')
  if (address.length > 1 || address.some(arg => arg.startsWith('-'))) {
    throw new Error('Use redis-clubhouse <host[:port]> [--ascii]. Run redis-clubhouse --help.')
  }
  const target = parseRedisTarget(address[0] ?? 'localhost')
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Open Redis Clubhouse in an interactive terminal.')
  await render(<RedisTerminal target={target} ascii={ascii} />).waitUntilExit()
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  process.stderr.write('Redis Clubhouse: ' + safeLine((error as Error).message) + '\n')
  process.exitCode = 1
}
