import { useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { border, clampIndex, mint, quiet, red, safeLine, windowStart } from './rendering'
import { createRedisSession, redisError, redisText, RedisAuthError, type RedisPage, type RedisPreview, type RedisTarget } from './redis-client'

type Session = ReturnType<typeof createRedisSession>
const emptyPage: RedisPage = { cursor: '0', keys: [] }

export function RedisTerminal({ target, ascii }: { target: RedisTarget; ascii: boolean }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [size, setSize] = useState(() => ({ width: stdout.columns || 80, height: stdout.rows || 24 }))
  const [page, setPage] = useState(emptyPage)
  const [cursors, setCursors] = useState(['0'])
  const [pattern, setPattern] = useState('')
  const [filter, setFilter] = useState<string>()
  const [password, setPassword] = useState<string>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [ready, setReady] = useState(false)
  const [index, setIndex] = useState(0)
  const [preview, setPreview] = useState<{ key: Buffer; data: RedisPreview }>()
  const [pane, setPane] = useState<'keys' | 'value'>('keys')
  const [scroll, setScroll] = useState(0)
  const [help, setHelp] = useState(false)
  const session = useRef<Session>()
  const credential = useRef(process.env.REDISCLI_AUTH)
  const pending = useRef(false)

  async function run(operation: (connection: Session) => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError('')
    try {
      if (!session.current?.ready) {
        session.current?.close()
        session.current = createRedisSession(target, credential.current)
        await session.current.connect()
      }
      await operation(session.current)
      setReady(true)
    } catch (failure) {
      const auth = failure instanceof RedisAuthError || (failure instanceof Error && /^(WRONGPASS|NOAUTH)\b/.test(failure.message))
      if (auth) {
        session.current?.close()
        credential.current = undefined
        setHelp(false); setPassword('')
      }
      setReady(Boolean(session.current?.ready))
      setError(redisError(failure))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  function load(nextPattern: string, nextCursors: string[]) {
    void run(async connection => {
      const result = await connection.scan(nextCursors.at(-1)!, nextPattern)
      setPage(result); setCursors(nextCursors); setPattern(nextPattern)
      setIndex(0); setPreview(undefined); setPane('keys'); setScroll(0)
    })
  }

  useEffect(() => {
    load('', ['0'])
    const resize = () => setSize({ width: stdout.columns || 80, height: stdout.rows || 24 })
    stdout.on('resize', resize)
    return () => { stdout.off('resize', resize); session.current?.close() }
  }, [stdout])

  const wide = size.width >= 96
  const height = Math.max(6, size.height - 4)
  const keysWidth = wide ? Math.floor(size.width * .37) : size.width
  const detailWidth = wide ? size.width - keysWidth : size.width
  const keyRows = height - 5
  const start = windowStart(page.keys.length, keyRows, index)
  const textWidth = Math.max(2, detailWidth - 4)
  const lines = (preview?.data.text ?? '').split('\n').flatMap(line => {
    const safe = safeLine(line)
    const charsPerLine = /^[ -~]*$/.test(safe) ? textWidth : Math.floor(textWidth / 2)
    return safe.match(new RegExp('.{1,' + charsPerLine + '}', 'gu')) ?? [' ']
  })
  const visibleLines = Math.max(1, height - 6)
  const maxScroll = Math.max(0, lines.length - visibleLines)

  useInput((input, key) => {
    if (password !== undefined || filter !== undefined) {
      const isPassword = password !== undefined
      const draft = password ?? filter ?? ''
      const update = isPassword ? setPassword : setFilter
      if (key.escape) update(undefined)
      else if (key.return) {
        update(undefined)
        if (isPassword) credential.current = draft
        load(isPassword ? pattern : draft, ['0'])
      } else if (key.backspace || key.delete) update(Array.from(draft).slice(0, -1).join(''))
      else if (!key.ctrl && !key.meta && !key.tab && input) update((draft + input).slice(0, 1024))
      return
    }
    if (input === 'q') { exit(); return }
    if (help) {
      if (key.escape || input === '?') setHelp(false)
      return
    }
    if (input === '?') { setHelp(true); return }
    if (busy) return
    if (key.escape) { setPane('keys'); setPreview(undefined); return }
    if (key.tab) { setPane(pane === 'keys' ? 'value' : 'keys'); return }
    if (input === '/') { setFilter(''); return }
    if (input === 'r') { load(pattern, ['0']); return }
    if (input === 'n' && page.cursor !== '0') { load(pattern, [...cursors, page.cursor]); return }
    if (input === 'p' && cursors.length > 1) { load(pattern, cursors.slice(0, -1)); return }
    const delta = key.upArrow ? -1 : key.downArrow ? 1 : key.pageUp ? -keyRows : key.pageDown ? keyRows : 0
    if (delta) {
      if (pane === 'keys') setIndex(clampIndex(index + delta, page.keys.length))
      else setScroll(Math.min(maxScroll, Math.max(0, scroll + delta)))
    }
    if (key.return && pane === 'keys' && page.keys[index]) {
      const selected = page.keys[index]
      setPreview(undefined); setPane('value'); setScroll(0)
      void run(async connection => {
        const data = await connection.inspect(selected)
        setPreview({ key: selected, data })
      })
    }
  })

  const edge = ascii ? 'classic' : 'single'
  const ttl = preview?.data.ttl
  return <Box width={size.width} flexDirection="column">
    <Box height={1} paddingX={1}><Text color={quiet} wrap="truncate-end">
      <Text color={mint} bold>TermScope</Text>  |  Redis  |  {target.label}
    </Text></Box>
    <Box height={height}>
      {password !== undefined || help ? <Box width={size.width} height={height} flexDirection="column" borderStyle={edge} borderColor={mint} paddingX={1}>
        <Text color={mint} bold>{help ? 'Redis shortcuts' : 'Redis authentication'}</Text>
        {help ? <>
          <Text>Tab switch panes · ↑↓ move or scroll · Enter inspect key</Text>
          <Text>/ search by glob · n next batch · p previous batch · r refresh</Text>
          <Text>? / Esc close help · q quit</Text>
        </> : <>
          <Text color={quiet}>Enter the Redis password. Set REDIS_USERNAME for a named ACL user.</Text>
          <Text color={mint} wrap="truncate-end">{'Password: ' + '*'.repeat(Math.min(password?.length ?? 0, 24))}</Text>
          <Text color={quiet}>Enter connect · Esc cancel</Text>
        </>}
      </Box> : <>
        {(wide || pane === 'keys') && <Box width={keysWidth} height={height} borderStyle={edge} borderColor={pane === 'keys' ? mint : border}
          flexDirection="column" paddingX={1} overflow="hidden">
          <Text color={mint} bold>Redis keys</Text>
          <Text color={filter !== undefined ? mint : quiet} wrap="truncate-end">
            {filter !== undefined ? 'Search glob: ' + safeLine(filter) + '▏' : 'Pattern: ' + (safeLine(pattern) || '*')}
          </Text>
          <Text color={quiet} wrap="truncate-end">{busy ? 'Loading…' : page.keys.length + (page.keys.length === 1 ? ' key' : ' keys') + ' · batch ' + cursors.length + (page.cursor !== '0' ? ' · n next' : '')}</Text>
          {!busy && !page.keys.length && <Text color={quiet} wrap="truncate-end">
            {page.cursor !== '0' ? 'No matches in this batch. Press n to continue.' : ready ? 'No matching keys.' : 'Press r to retry.'}
          </Text>}
          {page.keys.slice(start, start + keyRows).map((key, i) => <Text key={start + i} color={start + i === index ? mint : undefined} wrap="truncate-end">
            {start + i === index ? '> ' : '  '}{safeLine(redisText(key))}
          </Text>)}
        </Box>}
        {(wide || pane === 'value') && <Box width={detailWidth} height={height} borderStyle={edge} borderColor={pane === 'value' ? mint : border}
          flexDirection="column" paddingX={1} overflow="hidden">
          <Text color={mint} bold>Key details</Text>
          {preview ? <>
            <Text wrap="truncate-end">{safeLine(redisText(preview.key))}</Text>
            <Text color={quiet} wrap="truncate-end">Type: {safeLine(preview.data.type)} · TTL: {ttl === -2 ? 'Missing' : ttl === -1 ? 'No expiry' : ttl + ' s'}</Text>
            <Text color={quiet}>{preview.data.note ?? 'Value preview'}</Text>
            {lines.slice(scroll, scroll + visibleLines).map((line, i) => <Text key={i} wrap="truncate-end">{line || ' '}</Text>)}
          </> : <Text color={quiet}>{busy ? 'Reading Redis…' : 'Select a key and press Enter.'}</Text>}
        </Box>}
      </>}
    </Box>
    <Box paddingX={1} height={1}><Text color={error ? red : quiet} wrap="truncate-end">
      {error || (busy ? 'Connecting or reading…' : ready ? 'Connected · read-only' : 'Disconnected')}
    </Text></Box>
    <Box paddingX={1} height={1}><Text color={quiet} wrap="truncate-end">Tab pane · ↑↓ move · Enter inspect · / search · n/p batches · r refresh · ? help · q quit</Text></Box>
  </Box>
}
