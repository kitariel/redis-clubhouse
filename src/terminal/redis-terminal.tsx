import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { Charts, Dashboard } from './dashboard'
import { KeyGrid, KeyPreview } from './key-grid'
import { clampIndex, gold, mint, Panel, quiet, red, safeLine, windowStart, wrapPreview } from './rendering'
import { createRedisSession, redisError, RedisAuthError, type RedisKeyMetadata, type RedisPage, type RedisPreview, type RedisTarget } from './redis-client'
import { databaseRows, type RedisMetrics } from './redis-metrics'

type Session = ReturnType<typeof createRedisSession>
const emptyPage: RedisPage = { cursor: '0', keys: [] }
const tabs = ['Overview', 'Keys', 'Charts'] as const
type View = typeof tabs[number]
const historyLimit = 60

export function RedisTerminal({ target, ascii }: { target: RedisTarget; ascii: boolean }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [size, setSize] = useState(() => ({ width: stdout.columns || 80, height: stdout.rows || 24 }))
  const [view, setView] = useState<View>('Overview')
  const [database, setDatabase] = useState(target.database)
  const activeDb = useRef(target.database)
  const [dbFocus, setDbFocus] = useState(target.database)
  const [configured, setConfigured] = useState<number>()
  const [now, setNow] = useState(Date.now)
  const [samples, setSamples] = useState<RedisMetrics[]>([])
  const [metricsNote, setMetricsNote] = useState('')
  const [page, setPage] = useState(emptyPage)
  const [cursors, setCursors] = useState(['0'])
  const [pattern, setPattern] = useState('')
  const [draft, setDraft] = useState<{ kind: 'filter' | 'password' | 'database'; value: string }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [ready, setReady] = useState(false)
  const [index, setIndex] = useState(0)
  const [metadata, setMetadata] = useState(new Map<Buffer, RedisKeyMetadata>())
  const metadataCache = useRef(new WeakMap<Buffer, RedisKeyMetadata>())
  const [preview, setPreview] = useState<{ key: Buffer; data: RedisPreview }>()
  const [pane, setPane] = useState<'keys' | 'value'>('keys')
  const [scroll, setScroll] = useState(0)
  const [help, setHelp] = useState(false)
  const session = useRef<Session>()
  const credential = useRef(process.env.REDISCLI_AUTH)
  const pending = useRef(false)
  const sampling = useRef(false)
  const pollEnabled = useRef(true)

  async function sample(connection: Session, discover = false) {
    if (sampling.current) return
    sampling.current = true
    try {
      const [info, count] = await Promise.allSettled([
        connection.metrics(), discover ? connection.databaseCount() : Promise.resolve(undefined),
      ])
      if (session.current !== connection) return
      if (discover) setConfigured(count.status === 'fulfilled' ? count.value : undefined)
      if (info.status === 'fulfilled') {
        setSamples(previous => [...previous.slice(1 - historyLimit), info.value])
        setMetricsNote('')
        pollEnabled.current = true
      } else {
        pollEnabled.current = false
        setMetricsNote(/^(NOPERM|ERR unknown command)\b/.test(info.reason?.message ?? '') ?
          'Metrics unavailable · INFO permission required' : 'Metrics unavailable · r retries')
        if (!connection.ready) setReady(false)
      }
    } finally {
      sampling.current = false
    }
  }

  async function run(operation: (connection: Session, reconnected: boolean) => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError('')
    try {
      const reconnected = !session.current?.ready
      if (reconnected) {
        if (process.env.REDIS_USERNAME && !credential.current) throw new RedisAuthError()
        session.current?.close()
        session.current = createRedisSession({ ...target, database: activeDb.current }, credential.current)
        await session.current.connect()
      }
      const connection = session.current!
      try { await operation(connection, reconnected) }
      finally { if (reconnected && connection.ready) await sample(connection, true) }
      setReady(connection.ready)
    } catch (failure) {
      const auth = failure instanceof RedisAuthError || (failure instanceof Error && /^(WRONGPASS|NOAUTH)\b/.test(failure.message))
      if (auth) {
        session.current?.close()
        credential.current = undefined
        setHelp(false); setDraft({ kind: 'password', value: '' })
      }
      setReady(Boolean(session.current?.ready))
      setError(redisError(failure))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  function load(nextPattern: string, nextCursors: string[], options: { db?: number; refresh?: boolean } = {}) {
    void run(async (connection, reconnected) => {
      if (options.db !== undefined) {
        if (options.db !== activeDb.current) {
          await connection.select(options.db)
          activeDb.current = options.db
          setDatabase(options.db); setDbFocus(options.db)
          setPage(emptyPage); setMetadata(new Map()); setCursors(['0']); setPattern(nextPattern); setIndex(0)
        }
        setView('Keys'); setPreview(undefined); setPane('keys'); setScroll(0)
      }
      try {
        const result = await connection.scan(nextCursors.at(-1)!, nextPattern)
        setPage(result); setMetadata(new Map()); setCursors(nextCursors); setPattern(nextPattern)
        setIndex(0); setPreview(undefined); setPane('keys'); setScroll(0)
      } finally {
        if (options.refresh && !reconnected && connection.ready) await sample(connection, true)
      }
    })
  }

  useEffect(() => {
    load('', ['0'])
    const resize = () => setSize({ width: stdout.columns || 80, height: stdout.rows || 24 })
    stdout.on('resize', resize)
    const timer = setInterval(() => {
      setNow(Date.now())
      if (pending.current) return
      if (!session.current?.ready) {
        setReady(false)
      } else if (pollEnabled.current) {
        void sample(session.current)
      }
    }, 2000)
    return () => {
      clearInterval(timer); stdout.off('resize', resize)
      const connection = session.current
      session.current = undefined
      connection?.close()
    }
  }, [stdout])

  const width = size.width
  const height = Math.max(11, size.height - 4)
  const wide = width >= 104
  const keysWidth = wide ? Math.floor(width * .58) : width
  const detailWidth = wide ? width - keysWidth : width
  const keyRows = Math.max(1, height - 6)
  const start = windowStart(page.keys.length, keyRows, index)
  const visible = Math.max(1, height - 8)
  const lines = useMemo(() => wrapPreview(preview?.data.text ?? '', detailWidth - 4), [preview, detailWidth])
  const maxScroll = Math.max(0, lines.length - visible)
  const databases = databaseRows(samples.at(-1), configured, database)
  const dbIndex = Math.max(0, databases.findIndex(db => db.index === dbFocus))
  const keyGridVisible = view === 'Keys' && (wide || pane === 'keys')

  const metadataEpoch = Math.floor(now / 10_000)
  useEffect(() => {
    const connection = session.current
    if (!keyGridVisible || !ready || !connection?.ready || busy) return
    const keys = page.keys.slice(start, start + Math.min(keyRows, 100))
    const unseen = keys.filter(key => Date.now() - (metadataCache.current.get(key)?.at ?? 0) >= 8_000)
    let canceled = false
    const timer = setTimeout(() => {
      void Promise.all(unseen.map(async key => {
        metadataCache.current.set(key, await connection.metadata(key))
      })).then(() => {
        if (canceled || session.current !== connection) return
        setMetadata(previous => {
          const next = new Map(previous)
          keys.forEach(key => next.set(key, metadataCache.current.get(key) ?? {}))
          return next
        })
      })
    }, 70)
    return () => { canceled = true; clearTimeout(timer) }
  }, [keyGridVisible, ready, busy, page, start, keyRows, metadataEpoch])

  function switchView(next: View) {
    setView(next)
    if (next === 'Keys') setPane('keys')
  }

  useInput((input, key) => {
    if (draft) {
      if (key.escape) setDraft(undefined)
      else if (key.return) {
        setDraft(undefined)
        if (draft.kind === 'password') {
          credential.current = draft.value
          load(pattern, ['0'])
        } else if (draft.kind === 'filter') {
          load(draft.value, ['0'])
        } else if (/^\d+$/.test(draft.value) && Number.isSafeInteger(Number(draft.value))) {
          load('', ['0'], { db: Number(draft.value) })
        } else setError('Enter a zero-based database index, such as 0 or 1.')
      } else if (key.backspace || key.delete) setDraft({ ...draft, value: Array.from(draft.value).slice(0, -1).join('') })
      else if (!key.ctrl && !key.meta && !key.tab && input) setDraft({ ...draft, value: (draft.value + input).slice(0, 1024) })
      return
    }
    if (input === 'q') { exit(); return }
    if (help) {
      if (key.escape || input === '?') setHelp(false)
      return
    }
    if (input === '?') { setHelp(true); return }
    if (busy) return
    if (input === '1' || input === '2' || input === '3') { switchView(tabs[Number(input) - 1]); return }
    if (input === 'd') { setDraft({ kind: 'database', value: '' }); return }
    if (input === 'r') { load(pattern, ['0'], { refresh: true }); return }
    const delta = key.upArrow ? -1 : key.downArrow ? 1 : key.pageUp ? -keyRows : key.pageDown ? keyRows : 0
    if (view === 'Overview') {
      if (delta) setDbFocus(databases[clampIndex(dbIndex + delta, databases.length)].index)
      if (key.return) load('', ['0'], { db: databases[dbIndex].index })
      return
    }
    if (view !== 'Keys') return
    if (key.escape) { setPane('keys'); setPreview(undefined); return }
    if (key.tab && (wide || preview)) { setPane(pane === 'keys' ? 'value' : 'keys'); return }
    if (input === '/') { setPane('keys'); setDraft({ kind: 'filter', value: '' }); return }
    if (input === 'n' && page.cursor !== '0') { load(pattern, [...cursors, page.cursor]); return }
    if (input === 'p' && cursors.length > 1) { load(pattern, cursors.slice(0, -1)); return }
    if (delta) {
      if (pane === 'keys') setIndex(clampIndex(index + delta, page.keys.length))
      else setScroll(Math.min(maxScroll, Math.max(0, scroll + delta)))
    }
    if (key.return && pane === 'keys' && page.keys[index]) {
      const selected = page.keys[index]
      setPreview(undefined); setScroll(0)
      void run(async connection => {
        const data = await connection.inspect(selected)
        setPreview({ key: selected, data }); setPane('value')
      })
    }
  })

  const displayedDraft = draft?.kind === 'password' ? '*'.repeat(Math.min(draft.value.length, 24)) : safeLine(draft?.value ?? '')
  const status = error || (busy ? 'Reading Redis…' : ready ? 'Connected · read-only' : 'Disconnected · r retries')
  const shortcuts = view === 'Overview' ? '↑↓ select DB · Enter opens keys · d jump' :
    view === 'Keys' ? '↑↓ move · Enter inspect · / filter · n/p batches · Tab pane' : ready ? 'Live samples every 2s · newest at right' : 'Chart history · disconnected'
  return <Box width={width} flexDirection="column">
    <Box height={1} paddingX={1}><Text color={quiet} wrap="truncate-end">
      <Text color={mint} bold>Redis Clubhouse</Text>  |  {target.label.replace(/\/\d+$/, '')}  |  db{database}
      {samples.at(-1)?.version ? '  ·  Redis ' + safeLine(samples.at(-1)!.version!) : ''}
    </Text></Box>
    <Box height={1} paddingX={1}><Text color={quiet} wrap="truncate-end">
      {tabs.map((tab, i) => <Text key={tab} bold={view === tab} color={view === tab ? mint : quiet}>
        {view === tab ? '[' : ' '}{i + 1} {tab}{view === tab ? ']' : ' '}{'  '}
      </Text>)}
    </Text></Box>
    {help || draft?.kind === 'password' || draft?.kind === 'database' ? <Panel width={width} height={height} ascii={ascii} focused>
      {help ? <>
        <Text color={mint} bold>Redis Clubhouse shortcuts</Text>
        <Text>1 Overview · 2 Keys · 3 Charts</Text>
        <Text>↑↓ navigate · Enter open database or key · d jump to database</Text>
        <Text>/ search keys by glob · n/p batches · Tab switch key panes</Text>
        <Text>r refresh · Esc back or cancel · q quit</Text>
      </> : <>
        <Text color={mint} bold>{draft?.kind === 'password' ? 'Redis authentication' : 'Open database index'}</Text>
        <Text color={quiet}>{draft?.kind === 'password' ?
          'Set REDIS_USERNAME in your shell for a named ACL user.' : 'Enter a zero-based index such as 0 or 1.'}</Text>
        <Text color={mint} wrap="truncate-end">{draft?.kind === 'password' ? 'Password  ' : 'Index  '}{displayedDraft}▏</Text>
        <Text color={quiet}>Enter confirm · Esc cancel</Text>
      </>}
    </Panel> : view === 'Overview' ? <Dashboard {...{ width, height, ascii, samples, databases, configured }}
      selected={dbIndex} active={database} /> : view === 'Charts' ? <Charts {...{ width, height, ascii, samples }} /> :
      <Box>
        {keyGridVisible && <KeyGrid width={keysWidth} {...{ height, ascii, database, page, pattern, index, start, metadata, busy, now }}
          filter={draft?.kind === 'filter' ? draft.value : undefined} batch={cursors.length} rows={keyRows} focused={pane === 'keys'} />}
        {(wide || pane === 'value') && <KeyPreview width={detailWidth} {...{ height, ascii, preview, busy, lines, scroll, visible, now }}
          focused={pane === 'value'} />}
      </Box>}
    <Box paddingX={1} height={1}><Text color={error ? red : quiet} wrap="truncate-end">
      {status}{metricsNote && !error && ready ? '  ·  ' : ''}{metricsNote && !error && ready ? <Text color={gold}>{metricsNote}</Text> : ''}
    </Text></Box>
    <Box paddingX={1} height={1}><Text color={quiet} wrap="truncate-end">{shortcuts} · r refresh · ? help · q quit</Text></Box>
  </Box>
}
