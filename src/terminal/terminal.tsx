import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { countText, coverage, printKey, storeSeries, storesOf, type Capture, type Key } from '../core/snapshot'
import { columnsOf, field, filterSort, findTables, makeSeries, rawText, type HttpRequest, type HttpResponse, type Row, type Sort } from '../core/rest'
import {
  comparisonColumns, comparisonRows, databaseViews, displayCell, indexColumns, indexRows, keyRows, matchingValues,
  overviewColumns, overviewRows, restViews, storageText, valueText, type ComparisonRow,
} from '../core/views'
import { runRequest } from './request'
import { border, clampIndex, Grid, mint, quiet, red, safeLine, TerminalChart, windowStart } from './rendering'

export type Source = { mode: 'IndexedDB'; captures: Capture[] } |
  { mode: 'REST'; file: string; requests: HttpRequest[]; baseUrl?: string }
type View = (typeof databaseViews)[number] | (typeof restViews)[number]
type Overlay = 'help' | 'options' | 'value' | 'difference'
type Choice = { label: string; value: string; names: string[]; current: number; change: (index: number) => void }
type NavItem = { label: string; activate?: () => void; selected?: boolean }
type Result = { response?: HttpResponse; error?: string; running?: boolean }

const help = [
  'Tab / Shift+Tab   Switch between source and workspace',
  '↑ / ↓            Move through items, rows, or chart points',
  '← / →            Select a column, chart point, or option',
  'Enter            Open item, run request, or confirm option',
  '1–5              IndexedDB views in tab order',
  '1–3              REST Raw, Table, and Chart',
  '/                Filter list or table (Enter applies, Esc reverts)',
  's                Sort selected column and toggle direction',
  'c                Compare IndexedDB snapshots',
  'o                Options for the current view',
  'p                Pin chart below table on wide terminals',
  'x                Cancel active request',
  'PgUp / PgDn      Page through the focused view',
  '? / Esc          Open help / close overlay',
  'q / Ctrl+C       Quit',
]

export function Terminal({ source, ascii }: { source: Source; ascii: boolean }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [size, setSize] = useState(() => ({ width: stdout.columns || 80, height: stdout.rows || 24 }))
  useEffect(() => {
    const resize = () => setSize({ width: stdout.columns || 80, height: stdout.rows || 24 })
    stdout.on('resize', resize)
    return () => { stdout.off('resize', resize) }
  }, [stdout])

  const dbMode = source.mode === 'IndexedDB'
  const captures = dbMode ? source.captures : []
  const [captureIndex, setCaptureIndex] = useState(0)
  const [storeId, setStoreId] = useState('')
  const [view, setView] = useState<View>(dbMode ? 'Overview' : 'Raw')
  const [pane, setPane] = useState<'source' | 'workspace'>('source')
  const [navIndex, setNavIndex] = useState(0)
  const [rowIndex, setRowIndex] = useState(0)
  const [columnIndex, setColumnIndex] = useState(0)
  const [pointIndex, setPointIndex] = useState(0)
  const [overlay, setOverlay] = useState<Overlay>()
  const [overlayIndex, setOverlayIndex] = useState(0)
  const [before, setBefore] = useState(0)
  const [after, setAfter] = useState(Math.min(1, captures.length - 1))
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<string>()
  const [sort, setSort] = useState<Sort>()
  const [key, setKey] = useState<Key>()
  const [difference, setDifference] = useState<ComparisonRow>()
  const [requestIndex, setRequestIndex] = useState(0)
  const [results, setResults] = useState<Record<number, Result>>({})
  const running = useRef(new Map<number, AbortController>())
  const [path, setPath] = useState('')
  const [x, setX] = useState('')
  const [y, setY] = useState('')
  const [line, setLine] = useState(false)
  const [pin, setPin] = useState(false)
  useEffect(() => {
    const requests = running.current
    return () => { requests.forEach(controller => controller.abort()) }
  }, [])

  const capture = captures[captureIndex]
  const entries = useMemo(() => capture ? storesOf(capture.snapshot) : [], [capture])
  const selected = entries.find(entry => entry.id === storeId)
  const request = dbMode ? undefined : source.requests[requestIndex]
  const result = results[requestIndex]
  const response = result?.response
  const tables = useMemo(() => findTables(response?.json), [response])
  const table = tables.find(table => table.path === path) ?? tables[0]
  const restColumns = useMemo(() => table ? columnsOf(table.rows) : [], [table])
  const numbers = useMemo(() => restColumns.filter(column =>
    table?.rows.some(row => typeof field(row, column) === 'number' && Number.isFinite(field(row, column)))), [table, restColumns])
  const xField = restColumns.includes(x) ? x : restColumns[0]
  const yField = numbers.includes(y) ? y : numbers[0]

  const hasTimeline = Boolean(capture && captures.filter(item => item.snapshot.origin === capture.snapshot.origin).length > 1)
  const timeline = Boolean(selected && hasTimeline)
  const comparable = before !== after && captures[before]?.snapshot.origin === captures[after]?.snapshot.origin
  const dbRows: Row[] = !capture ? [] : view === 'Overview' ? overviewRows(capture) :
    view === 'Keys' ? keyRows(selected?.store) : view === 'Indexes' ? indexRows(selected?.store) :
    view === 'Comparison' && comparable ? comparisonRows(captures[before], captures[after]) : []
  const columns = dbMode ? view === 'Overview' ? overviewColumns : view === 'Keys' ? ['Key'] :
    view === 'Indexes' ? indexColumns : view === 'Comparison' ? comparisonColumns : [] : restColumns
  const rows = filterSort(dbMode ? dbRows : table?.rows ?? [], draft ?? query, sort)
  const chartView = view === 'Charts' || view === 'Chart'
  const tableView = ['Overview', 'Keys', 'Indexes', 'Comparison', 'Table'].includes(view)
  const points = capture ? storeSeries(captures, capture.snapshot, timeline ? storeId : undefined) :
    yField ? makeSeries(rows, xField, yField) : []
  const matches = key !== undefined && capture ? matchingValues(captures, capture, key)
    .filter(match => match.index !== captureIndex || match.id !== storeId) : []

  const wide = size.width >= 98
  const navWidth = wide ? 27 : size.width
  const mainWidth = (wide ? size.width - navWidth : size.width) - 4
  const paneHeight = Math.max(7, size.height - 4)
  const hasPin = pin && tableView && wide && size.height >= 30 && points.length > 0
  const chartHeight = hasPin ? 7 : Math.max(3, paneHeight - 7)
  const rowHeight = Math.max(1, paneHeight - 9 - (hasPin ? chartHeight + 1 : 0))
  const safeRow = clampIndex(rowIndex, rows.length)
  const safeColumn = clampIndex(columnIndex, columns.length)
  const safePoint = clampIndex(pointIndex, points.length)

  function resetTable() {
    setQuery(''); setDraft(undefined); setSort(undefined); setRowIndex(0); setColumnIndex(0); setPointIndex(0)
  }
  function changeView(next: View) {
    setView(next); setPane('workspace')
    if (dbMode) resetTable()
    else { setRowIndex(0); setPointIndex(0) }
  }
  function openStore(id: string, index = captureIndex) {
    setCaptureIndex(index); setStoreId(id); changeView('Keys')
  }
  function openCapture(index: number) {
    setCaptureIndex(index); setStoreId(''); changeView('Overview')
  }
  function selectRequest(index: number) {
    if (requestIndex !== index) {
      resetTable(); setPath(''); setX(''); setY('')
    }
    setRequestIndex(index); setView('Raw'); setRowIndex(0)
  }
  function startRequest(index: number) {
    if (dbMode) return
    selectRequest(index)
    setPane('workspace')
    if (running.current.has(index)) return
    const controller = new AbortController()
    running.current.set(index, controller)
    setResults(current => ({ ...current, [index]: { running: true } }))
    void runRequest(source.requests[index], { baseUrl: source.baseUrl, signal: controller.signal })
      .then(response => setResults(current => ({ ...current, [index]: { response } })))
      .catch((error: Error) => setResults(current => ({ ...current, [index]: { error: error.message } })))
      .finally(() => running.current.delete(index))
  }

  const nav: NavItem[] = dbMode ? [
    ...captures.map((item, i) => ({ label: (ascii ? '* ' : '◈ ') + item.label, selected: i === captureIndex, activate: () => openCapture(i) })),
    { label: (ascii ? '+ ' : '⊞ ') + 'All stores', selected: view === 'Overview', activate: () => changeView('Overview') },
    ...capture.snapshot.databases.flatMap(db => [
      { label: (ascii ? '+ ' : '▾ ') + db.name + '  v' + db.version },
      ...entries.filter(entry => entry.database === db.name).map(entry => ({
        label: (ascii ? '  |- ' : '  ├─ ') + entry.store.name + '  ' + (entry.store.count === null ? '?' : countText(entry.store.count)),
        selected: entry.id === storeId && view !== 'Overview', activate: () => openStore(entry.id),
      })),
    ]),
  ] : source.requests.map((item, i) => ({
    label: item.method + ' ' + item.name + (results[i]?.running ? ' …' : ''),
    selected: requestIndex === i, activate: () => startRequest(i),
  }))
  const safeNav = clampIndex(navIndex, nav.length)
  const choices: Choice[] = []
  function addChoice(label: string, names: string[], current: number, change: (index: number) => void) {
    if (names.length) choices.push({ label, names, current, value: names[current] ?? names[0], change })
  }
  if (dbMode && view === 'Comparison') {
    const labels = captures.map(item => item.label)
    addChoice('Before', labels, before, setBefore)
    addChoice('After', labels, after, setAfter)
  }
  if (dbMode && view === 'Charts' && hasTimeline) {
    addChoice('Store', ['All stores', ...entries.map(entry => entry.database + ' / ' + entry.store.name)],
      entries.findIndex(entry => entry.id === storeId) + 1, index => { setStoreId(entries[index - 1]?.id ?? ''); setPointIndex(0) })
  }
  if (!dbMode && table && view !== 'Raw') {
    addChoice('Array path', tables.map(table => table.path), tables.indexOf(table), index => {
      setPath(tables[index].path); setX(''); setY(''); setRowIndex(0); setPointIndex(0); setSort(undefined)
    })
    addChoice('X field', restColumns, restColumns.indexOf(xField), index => setX(restColumns[index]))
    addChoice('Y field', numbers, numbers.indexOf(yField), index => setY(numbers[index]))
    addChoice('Style', ['Bar', 'Line'], Number(line), index => setLine(index === 1))
  }

  function rawLines(text: string) {
    return text.split(/\r\n|\r|\n/).flatMap(line => {
      const chars = Array.from(safeLine(line))
      const width = Math.max(8, Math.floor(mainWidth / 2))
      return chars.length ? Array.from({ length: Math.ceil(chars.length / width) }, (_, i) =>
        chars.slice(i * width, (i + 1) * width).join('')) : [' ']
    })
  }

  const detail = key !== undefined ? rawLines(valueText(selected?.store, key)) : []
  const diffLines = difference ? [
    displayCell(difference, 'Before') + ' → ' + displayCell(difference, 'After') + ' · Change ' + displayCell(difference, 'Change'),
    ...(difference.added && difference.removed ? [
      'Added keys (' + difference.added.length + ')', ...difference.added.map(printKey),
      'Removed keys (' + difference.removed.length + ')', ...difference.removed.map(printKey),
    ] : ['Key comparison unavailable. Both stores must have complete key previews.']),
  ] : []
  const raw = useMemo(() => response && view === 'Raw' ? rawLines(rawText(response)) : [], [response, view, mainWidth])
  const filterable = tableView || (!dbMode && view === 'Chart')

  function openOverlay(next: Overlay) {
    setOverlay(next); setOverlayIndex(0); setPane('workspace')
  }

  useInput((input, pressed) => {
    if (draft !== undefined) {
      if (pressed.escape) setDraft(undefined)
      else if (pressed.return) { setQuery(draft); setDraft(undefined) }
      else if (pressed.backspace || pressed.delete) setDraft(Array.from(draft).slice(0, -1).join(''))
      else if (!pressed.ctrl && !pressed.meta && input && !pressed.tab) setDraft(draft + safeLine(input))
      setRowIndex(0); setPointIndex(0)
      return
    }
    if (overlay) {
      if (pressed.escape || (pressed.return && overlay !== 'value')) { setOverlay(undefined); return }
      const length = overlay === 'help' ? help.length : overlay === 'options' ? choices.length :
        overlay === 'value' ? detail.length + matches.length : diffLines.length
      const current = clampIndex(overlayIndex, length)
      const direction = pressed.upArrow ? -1 : pressed.downArrow ? 1 : pressed.pageUp ? -rowHeight : pressed.pageDown ? rowHeight : 0
      if (direction) setOverlayIndex(clampIndex(current + direction, length))
      if (overlay === 'options' && (pressed.leftArrow || pressed.rightArrow)) {
        const choice = choices[current]
        if (choice) choice.change((choice.current + (pressed.leftArrow ? -1 : 1) + choice.names.length) % choice.names.length)
      }
      if (overlay === 'value' && pressed.return && current >= detail.length) {
        const match = matches[current - detail.length]
        if (match) { openStore(match.id, match.index); setOverlayIndex(0) }
      }
      return
    }
    if (input === 'q') { exit(); return }
    if (pressed.tab) { setPane(pane === 'source' ? 'workspace' : 'source'); return }
    if (input === '?') { openOverlay('help'); return }
    if (input === 'o' && choices.length) { openOverlay('options'); return }
    if (input === 'c' && dbMode) { changeView('Comparison'); return }
    if (input === 'p') { setPin(!pin); return }
    if (input === 'x' && !dbMode) { running.current.get(requestIndex)?.abort(); return }
    if (/^[1-5]$/.test(input)) {
      const next = (dbMode ? databaseViews : restViews)[Number(input) - 1]
      if (next) changeView(next)
      return
    }
    if (input === '/' && filterable) { setDraft(query); setPane('workspace'); return }
    const vertical = pressed.upArrow ? -1 : pressed.downArrow ? 1 : pressed.pageUp ? -rowHeight : pressed.pageDown ? rowHeight : 0
    const horizontal = pressed.leftArrow ? -1 : pressed.rightArrow ? 1 : 0
    if (pane === 'source') {
      if (vertical) {
        const index = clampIndex(safeNav + vertical, nav.length)
        setNavIndex(index)
        if (!dbMode && index !== requestIndex) selectRequest(index)
      }
      if (pressed.return) nav[safeNav]?.activate?.()
      return
    }
    if (chartView) {
      if (vertical || horizontal) setPointIndex(clampIndex(safePoint + (vertical || horizontal), points.length))
    } else if (view === 'Raw') {
      if (vertical) setRowIndex(clampIndex(rowIndex + vertical, raw.length))
    } else {
      if (vertical) {
        setRowIndex(clampIndex(safeRow + vertical, rows.length))
        if (hasPin) setPointIndex(clampIndex(safeRow + vertical, points.length))
      }
      if (horizontal) setColumnIndex(clampIndex(safeColumn + horizontal, columns.length))
    }
    if (input === 's' && tableView && columns[safeColumn]) {
      const column = columns[safeColumn]
      setSort({ column, descending: sort?.column === column ? !sort.descending : false }); setRowIndex(0); setPointIndex(0)
    }
    if (pressed.return) {
      if (view === 'Overview' && rows[safeRow]) openStore(String(rows[safeRow].id))
      if (view === 'Keys' && rows[safeRow]) { setKey(rows[safeRow].key as Key); openOverlay('value') }
      if (view === 'Comparison' && rows[safeRow]) { setDifference(rows[safeRow] as ComparisonRow); openOverlay('difference') }
      if (chartView && choices.length) openOverlay('options')
    }
  })

  const navStart = windowStart(nav.length, paneHeight - 3, safeNav)
  const overlayHeight = Math.max(2, paneHeight - 5)
  const header = dbMode ? capture.label + ' · ' + capture.snapshot.origin : source.file
  const tabs = (dbMode ? databaseViews : restViews).map((tab, i) => (tab === view ? '[' : '') + (i + 1) + ' ' + tab + (tab === view ? ']' : '')).join('  ')
  let summary = ''
  if (dbMode) {
    if (view === 'Overview') summary = capture.snapshot.databases.length + ' DB · ' + entries.length + ' stores · Origin storage est. ' + storageText(capture) + ' (usage / quota)'
    if (view === 'Keys' && selected) summary = selected.store.name + ' · ' + (selected.store.count === null ? 'Count unavailable' : countText(selected.store.count) + ' records') + ' · ' + coverage(selected.store)
    if (view === 'Indexes' && selected) summary = selected.store.name + ' · Key path: ' + JSON.stringify(selected.store.keyPath) + ' · Auto-increment: ' + (selected.store.autoIncrement ? 'yes' : 'no')
    if (view === 'Comparison') summary = (captures[before]?.label ?? '—') + ' → ' + (captures[after]?.label ?? '—') + ' · o choose pair'
    if (view === 'Charts') summary = (timeline ? selected?.store.name + ' · Records over time' : 'Records by store') + (hasTimeline ? ' · o choose store' : '')
  } else {
    summary = request?.method + ' ' + request?.name + ' · ' + (response ? 'HTTP ' + response.status + ' · ' + response.elapsed + ' ms' :
      result?.running ? 'Running · x cancel' : result?.error ?? 'Select a request and press Enter to run.')
  }

  function scrollLines(lines: string[], current: number, height: number) {
    const start = windowStart(lines.length, height, current)
    return lines.slice(start, start + height).map((line, i) => <Text key={i}
      color={current === start + i ? mint : undefined} wrap="truncate-end">{safeLine(line) || ' '}</Text>)
  }

  return <Box flexDirection="column" width={size.width}>
    <Box height={1} paddingX={1}><Text color={quiet} wrap="truncate-end"><Text color={mint} bold>TermScope</Text>  {ascii ? '|' : '│'}  {source.mode}  /  {view}  {ascii ? '|' : '│'}  {safeLine(header)}</Text></Box>
    <Box height={paneHeight}>
      {(wide || pane === 'source') && <Box width={navWidth} height={paneHeight} flexDirection="column" paddingX={1}
        borderStyle={ascii ? 'classic' : 'single'} borderColor={pane === 'source' ? mint : border} overflow="hidden">
        <Text bold color={pane === 'source' ? mint : quiet}>{dbMode ? 'DATABASE EXPLORER' : 'REQUESTS'}</Text>
        {nav.slice(navStart, navStart + paneHeight - 3).map((item, i) =>
          <Text key={navStart + i} color={item.selected || safeNav === navStart + i ? mint : quiet} wrap="truncate-end">
            {safeNav === navStart + i ? '> ' : '  '}{safeLine(item.label)}
          </Text>)}
      </Box>}
      {(wide || pane === 'workspace') && <Box width={mainWidth + 4} height={paneHeight} flexDirection="column" paddingX={1}
        borderStyle={ascii ? 'classic' : 'single'} borderColor={pane === 'workspace' ? mint : border} overflow="hidden">
        <Text bold color={mint} wrap="truncate-end">{safeLine(tabs)}</Text>
        {overlay ? <>
          <Text color={quiet} wrap="truncate-end">{safeLine(overlay === 'help' ? 'Keyboard shortcuts · Esc closes' :
            overlay === 'options' ? 'Options · ←/→ changes · Enter confirms' : overlay === 'value' && key !== undefined ?
              printKey(key) + ' · Enter opens focused captured match' : (difference?.database ?? '') + ' / ' + (difference?.name ?? ''))}</Text>
          {overlay === 'help' && scrollLines(help, overlayIndex, overlayHeight)}
          {overlay === 'options' && scrollLines(choices.map(choice => choice.label + '  ‹ ' + choice.value + ' ›'), overlayIndex, overlayHeight)}
          {overlay === 'value' && scrollLines([...detail, ...matches.map(match =>
            '→ ' + match.capture.label + ' / ' + match.database + ' / ' + match.store.name)], overlayIndex, overlayHeight)}
          {overlay === 'difference' && scrollLines(diffLines, overlayIndex, overlayHeight)}
        </> : <>
          <Text color={result?.error && !dbMode ? red : quiet} wrap="truncate-end">{safeLine(summary) || 'Select a store in the explorer.'}</Text>
          {filterable && <Text color={draft !== undefined ? mint : quiet} wrap="truncate-end">/{draft !== undefined ? ' ' + draft + '▏ · Enter applies' : query ? ' ' + query : ' filter'}{choices.length && draft === undefined ? '   o options' : ''}{tableView && columns[safeColumn] && draft === undefined ? '   Column: ' + safeLine(columns[safeColumn]) : ''}</Text>}
          {view === 'Raw' && response && scrollLines(raw, rowIndex, paneHeight - 5)}
          {dbMode && view === 'Comparison' && !comparable ? <Text color={quiet}>
            {before === after ? 'Choose two different captures with o.' : 'Choose captures from the same origin with o.'}
          </Text> : tableView && <Grid rows={rows} columns={columns} index={safeRow} column={safeColumn} sort={sort} width={mainWidth} height={rowHeight} snapshot={dbMode} />}
          {(chartView || hasPin) && <Box flexDirection="column">
            {hasPin && <Text color={quiet}>Pinned chart</Text>}
            <TerminalChart points={points} index={safePoint} width={mainWidth} height={chartHeight} line={capture ? timeline : line} ascii={ascii} />
          </Box>}
        </>}
      </Box>}
    </Box>
    <Box paddingX={1} height={1}><Text color={quiet} wrap="truncate-end">
      {pane === 'source' ? 'Tab workspace · ↑↓ move · Enter open' : chartView ? 'Tab source · ↑↓ point · o options' : 'Tab source · ↑↓ move · ←→ column · / filter · s sort'} · {dbMode ? 'c compare' : 'p pin · x cancel'} · ? help · q quit
    </Text></Box>
  </Box>
}
