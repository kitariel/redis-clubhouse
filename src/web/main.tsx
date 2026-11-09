import { maxSnapshotBytes } from '../core/capture'
import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { demoCaptures, demoRequests, demoResponses } from '../core/demo'
import { comparisonPair, countText, coverage, parseSnapshot, printKey, storeSeries, storesOf, type Capture, type Key } from '../core/snapshot'
import { columnsOf, field, filterSort, findTables, makeSeries, rawText, type Row, type Sort } from '../core/rest'
import {
  comparisonColumns, comparisonRows, databaseViews, displayCell, indexColumns, indexRows, keyRows,
  matchingValues, overviewColumns, overviewRows, restViews, storageText, valueText, type ComparisonRow,
} from '../core/views'
import { Chart } from './charts'
import './styles.css'

function Table({ rows, columns, sort, onSort, onOpen, snapshot = true }: {
  rows: Row[]; columns: string[]; snapshot?: boolean; sort?: Sort; onSort?: (column: string) => void; onOpen?: (row: Row) => void;
}) {
  const [page, setPage] = useState(0)
  const limit = 14
  const offset = Math.min(page, Math.max(0, Math.ceil(rows.length / limit) - 1)) * limit
  if (!rows.length) return <div className="empty">No rows to display.</div>
  return <>
    <div className="table-scroll">
      <table><thead><tr>{columns.map(column => <th key={column} scope="col"
        aria-sort={sort?.column === column ? sort.descending ? 'descending' : 'ascending' : undefined}>
        {onSort ? <button onKeyDown={event => {
          if (event.key === 's') { onSort(column); setPage(0) }
        }} onClick={() => { onSort(column); setPage(0) }}>{column}
          <span aria-hidden="true">{sort?.column === column ? sort.descending ? ' ↓' : ' ↑' : ' ↕'}</span>
        </button> : column}
      </th>)}</tr></thead>
        <tbody>{rows.slice(offset, offset + limit).map((row, i) => <tr key={offset + i}>
          {columns.map((column, j) => <td key={column} className={snapshot && column === 'Change' && typeof row.Change === 'number' && row.Change !== 0 ? row.Change > 0 ? 'positive' : 'negative' : undefined}>
            {onOpen && j === 0 ? <button className="row-link" onClick={() => onOpen(row)}>{displayCell(row, column, snapshot)}</button> : displayCell(row, column, snapshot)}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {rows.length > limit && <div className="pagination">
      <button disabled={!offset} onClick={() => setPage(offset / limit - 1)}>Previous</button>
      <span>{offset + 1}–{Math.min(offset + limit, rows.length)} of {rows.length}</span>
      <button disabled={offset + limit >= rows.length} onClick={() => setPage(offset / limit + 1)}>Next</button>
    </div>}
  </>
}

function Select({ label, children, value, change }: {
  label: string; children: ReactNode; value: string | number; change: (value: string) => void;
}) {
  return <label className="control"><span>{label}</span><select aria-label={label} value={value} onChange={e => change(e.target.value)}>{children}</select></label>
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); close() }}>
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button autoFocus onClick={close}>Close <kbd>Esc</kbd></button></div>
    {children}
  </dialog>
}

function App() {
  const [source, setSource] = useState<'IndexedDB' | 'REST'>('IndexedDB')
  const [captures, setCaptures] = useState(demoCaptures)
  const [usingDemo, setUsingDemo] = useState(true)
  const [captureIndex, setCaptureIndex] = useState(0)
  const [storeId, setStoreId] = useState('')
  const [dbView, setDbView] = useState<(typeof databaseViews)[number]>('Overview')
  const [restView, setRestView] = useState<(typeof restViews)[number]>('Raw')
  const [request, setRequest] = useState(0)
  const [before, setBefore] = useState(0)
  const [after, setAfter] = useState(1)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>()
  const [path, setPath] = useState('')
  const [x, setX] = useState('')
  const [y, setY] = useState('')
  const [line, setLine] = useState(false)
  const [pin, setPin] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [help, setHelp] = useState(false)
  const [selectedKey, setSelectedKey] = useState<Key>()
  const [difference, setDifference] = useState<ComparisonRow>()
  const filter = useRef<HTMLInputElement>(null)

  const capture = captures[captureIndex]
  const dbMode = source === 'IndexedDB'
  const entries = useMemo(() => storesOf(capture.snapshot), [capture])
  const selected = entries.find(entry => entry.id === storeId)
  const view = dbMode ? dbView : restView
  const filterable = dbMode ? dbView !== 'Charts' : restView !== 'Raw'
  const response = demoResponses[request]
  const tables = useMemo(() => findTables(response.json), [response])
  const table = tables.find(table => table.path === path) ?? tables[0]
  const columns = columnsOf(table.rows)
  const numbers = columns.filter(column => table.rows.some(row => typeof field(row, column) === 'number'))
  const xField = columns.includes(x) ? x : columns[0]
  const yField = numbers.includes(y) ? y : numbers[0]
  const restRows = filterSort(table.rows, query, sort)
  const restSeries = makeSeries(restRows, xField, yField)
  const hasTimeline = captures.filter(item => item.snapshot.origin === capture.snapshot.origin).length > 1
  const timeline = selected && hasTimeline
  const comparison = comparisonRows(captures[before], captures[after])
  const sameOrigin = captures[before]?.snapshot.origin === captures[after]?.snapshot.origin

  function resetFilter() { setQuery(''); setSort(undefined) }
  function changeView(next: typeof view) {
    if (dbMode) { setDbView(next as typeof dbView); resetFilter() }
    else setRestView(next as typeof restView)
  }
  function chooseStore(id: string, index = captureIndex, key?: Key) {
    setCaptureIndex(index); setStoreId(id); setDbView('Keys'); resetFilter(); setSelectedKey(key)
  }
  function changeCapture(index: number) {
    setCaptureIndex(index)
    const sameStore = storesOf(captures[index].snapshot).some(entry => entry.id === storeId)
    if (!sameStore) setStoreId('')
    setSelectedKey(undefined)
  }
  function toggleSort(column: string) {
    setSort(current => ({ column, descending: current?.column === column ? !current.descending : false }))
  }
  async function importFiles(files: File[]) {
    if (!files.length || importing) return
    setImporting(true); setError('')
    try {
      const loaded = await Promise.all(files.map(async file => {
        try {
          if (file.size > maxSnapshotBytes) throw new Error('File exceeds the 20 MiB import limit.')
          return { label: file.name, snapshot: parseSnapshot(await file.text()) }
        } catch (error) { throw new Error(file.name + ' · ' + (error as Error).message) }
      }))
      const first = usingDemo ? 0 : captures.length
      const next = usingDemo ? loaded : [...captures, ...loaded]
      const [beforeIndex, afterIndex] = comparisonPair(next, next[first].snapshot.origin)
      setCaptures(next); setUsingDemo(false); setSource('IndexedDB'); setCaptureIndex(usingDemo ? beforeIndex : first)
      setBefore(beforeIndex); setAfter(afterIndex); setStoreId(''); setDbView('Overview'); resetFilter()
    } catch (error) { setError((error as Error).message) }
    finally { setImporting(false) }
  }

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (event.altKey || event.metaKey || event.ctrlKey || help || selectedKey !== undefined || difference ||
        target?.closest('input:not([type=file]), textarea, select, [contenteditable]')) return
      if (event.key === '?') setHelp(true)
      else if (event.key === '/' && filterable) { event.preventDefault(); filter.current?.focus() }
      else if (event.key === 'c' && dbMode) changeView('Comparison')
      else if (event.key === 'p' && !dbMode) setPin(current => !current)
      else if (/^[1-5]$/.test(event.key)) {
        const next = (dbMode ? databaseViews : restViews)[Number(event.key) - 1]
        if (next) changeView(next)
      }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  })

  const tableProps = { sort, onSort: toggleSort }
  const filtered = (rows: Row[]) => filterSort(rows, query, sort)
  const chartControls = <div className="controls">
    <Select label="X field" value={xField ?? ''} change={setX}>{columns.map(column => <option key={column}>{column}</option>)}</Select>
    <Select label="Y field" value={yField ?? ''} change={setY}>{numbers.map(column => <option key={column}>{column}</option>)}</Select>
    <Select label="Style" value={line ? 'Line' : 'Bar'} change={value => setLine(value === 'Line')}><option>Bar</option><option>Line</option></Select>
  </div>

  return <div className="shell">
    <header className="top">
      <div className="brand"><span className="logo" aria-hidden="true">›_</span><strong>TermScope</strong><span className="version">v0.1</span></div>
      <div className="top-context"><span className="live-dot" />{source}<span className="slash">/</span>{dbMode ? capture.label : 'sales.http'}</div>
      <button onClick={() => setHelp(true)}>Keyboard help <kbd>?</kbd></button>
    </header>
    <div className="frame">
      <aside className="sidebar" aria-label="Source navigator">
        <div className="side-section">
          <div className="eyebrow">Source</div>
          <div className="switcher">{(['IndexedDB', 'REST'] as const).map(option => <button key={option}
            aria-pressed={source === option} onClick={() => { setSource(option); resetFilter() }}>{option}</button>)}</div>
        </div>
        {dbMode ? <>
          <div className="side-section captures">
            <div className="eyebrow">Captures <span>{String(captures.length).padStart(2, '0')}</span></div>
            <div className="capture-list">{captures.map((item, index) => <button key={index} aria-pressed={index === captureIndex}
              onClick={() => changeCapture(index)}><span>{item.label}</span><small>{new Date(item.snapshot.capturedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC</small></button>)}</div>
            <label className="import"><input type="file" accept=".json,application/json" multiple disabled={importing} onChange={event => {
              void importFiles(Array.from(event.target.files ?? [])); event.target.value = ''
            }} /><span>＋ {importing ? 'Importing…' : 'Import snapshots'}</span></label>
            {error && <p role="alert" className="error">{error}</p>}
          </div>
          <nav className="side-section tree" aria-label="Databases and stores">
            <div className="eyebrow">Database explorer</div>
            <button className="tree-overview" aria-pressed={dbView === 'Overview'} onClick={() => changeView('Overview')}><span aria-hidden="true">⊞</span> All stores</button>
            {capture.snapshot.databases.map(db => <details key={db.name} open>
              <summary>{db.name} <small>v{db.version}</small></summary>
              <div className="branches">{entries.filter(entry => entry.database === db.name).map(({ id, store }) =>
                <button key={id} aria-pressed={selected?.id === id && dbView !== 'Overview'} onClick={() => chooseStore(id)}>
                  <span>{store.name}</span><small>{store.count === null ? '?' : countText(store.count)}</small>
                </button>)}</div>
            </details>)}
          </nav>
        </> : <nav className="side-section" aria-label="REST requests">
          <div className="eyebrow">sales.http</div>
          {demoRequests.map((item, index) => <button key={index} className="request" aria-pressed={request === index}
            onClick={() => { setRequest(index); setPath(''); setX(''); setY(''); resetFilter() }}><b>{item.method}</b> {item.name}</button>)}
        </nav>}
        <div className="side-note"><span className="live-dot" /> {dbMode ? 'Local inspection' : 'Bundled response fixtures'}</div>
      </aside>
      <main className="workspace">
        <div className="breadcrumb">{dbMode ? 'INDEXEDDB' : 'REST'} <span>/</span> {dbMode ? selected && dbView !== 'Overview' ? selected.database : 'EXPLORER' : 'SALES.HTTP'}</div>
        <div className="heading"><div><h1>{dbMode ? dbView === 'Comparison' ? 'Compare snapshots' :
          selected && dbView !== 'Overview' ? selected.store.name : 'Database overview' : demoRequests[request].name}</h1>
          <p>{dbMode ? capture.snapshot.origin : demoRequests[request].method + ' ' + demoRequests[request].url}</p></div>
          <span className="tag">{dbMode ? usingDemo ? 'Sample capture' : 'Imported snapshot' : 'Demo fixture'}</span>
        </div>
        <div className="metrics">
          {dbMode ? <>
            <div><span>Databases</span><strong>{capture.snapshot.databases.length}</strong></div>
            <div><span>Object stores</span><strong>{entries.length}</strong></div>
            <div><span>Origin storage estimate</span><strong>{storageText(capture)}</strong><small>Usage / quota for the whole origin</small></div>
          </> : <>
            <div><span>HTTP status</span><strong>{response.status}</strong></div>
            <div><span>Latency</span><strong>{response.elapsed} ms</strong></div>
            <div><span>Response rows</span><strong>{table.rows.length}</strong></div>
          </>}
        </div>
        <nav className="tabs" aria-label="Workspace views">{(dbMode ? databaseViews : restViews).map((tab, index) =>
          <button key={tab} aria-current={tab === view ? 'page' : undefined} onClick={() => changeView(tab)}><kbd>{index + 1}</kbd>{tab}</button>)}</nav>
        <section className="panel" aria-label={view}>
          <div className="panel-head">
            <div><h2>{dbMode ? ({ Overview: 'Object stores', Keys: 'Primary keys', Indexes: 'Store indexes',
              Charts: timeline ? 'Record count over time' : 'Records by store', Comparison: 'Store changes' })[dbView] : restView === 'Raw' ? 'Response body' : restView === 'Chart' ? 'Response chart' : 'Response table'}</h2>
              {dbMode && selected && dbView === 'Keys' && <p>{selected.store.count === null ? 'Count unavailable' : countText(selected.store.count) + ' records'} · {coverage(selected.store)}</p>}
              {dbMode && dbView === 'Overview' && <p>Record totals and captured key coverage</p>}
            </div>
            {filterable && <label className="search"><kbd>/</kbd><input ref={filter} value={query} onChange={e => setQuery(e.target.value)} aria-label="Filter rows" placeholder="Filter rows…" /></label>}
          </div>
          {dbMode ? <>
            {dbView === 'Overview' && <Table key="overview" rows={filtered(overviewRows(capture))} columns={overviewColumns} {...tableProps} onOpen={row => chooseStore(String(row.id))} />}
            {(dbView === 'Keys' || dbView === 'Indexes') && !selected && <p className="empty">Select an object store in the database explorer.</p>}
            {dbView === 'Keys' && selected && <Table key={storeId} rows={filtered(keyRows(selected.store))} columns={['Key']} {...tableProps} onOpen={row => setSelectedKey(row.key as Key)} />}
            {dbView === 'Indexes' && selected && <Table key={storeId + '-indexes'} rows={filtered(indexRows(selected.store))} columns={indexColumns} {...tableProps} />}
            {dbView === 'Charts' && <>
              {hasTimeline && <div className="controls"><Select label="Store" value={storeId} change={setStoreId}>
                <option value="">All stores in this capture</option>
                {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.database} / {entry.store.name}</option>)}
              </Select></div>}
              <Chart key={storeId} points={storeSeries(captures, capture.snapshot, timeline ? storeId : undefined)} line={Boolean(timeline)} />
            </>}
            {dbView === 'Comparison' && <>
              <div className="controls">
                <Select label="Before" value={before} change={value => setBefore(Number(value))}>{captures.map((item, i) => <option key={i} value={i}>{item.label}</option>)}</Select>
                <Select label="After" value={after} change={value => setAfter(Number(value))}>{captures.map((item, i) => <option key={i} value={i}>{item.label}</option>)}</Select>
              </div>
              {captures.length < 2 || before === after ? <p className="empty">Select two different captures to compare.</p> : !sameOrigin ?
                <p className="empty">Select captures from the same origin.</p> :
                <Table key="comparison" rows={filtered(comparison)} columns={comparisonColumns} {...tableProps} onOpen={row => setDifference(row as ComparisonRow)} />}
            </>}
          </> : <>
            {restView === 'Raw' ? <pre className="raw">{rawText(response)}</pre> : <>
              <div className="controls"><Select label="Array path" value={table.path} change={value => { setPath(value); setX(''); setY(''); setSort(undefined) }}>
                {tables.map(table => <option key={table.path}>{table.path}</option>)}
              </Select><button aria-pressed={pin} onClick={() => setPin(!pin)}>{pin ? 'Unpin chart' : 'Pin chart'} <kbd>p</kbd></button></div>
              {restView === 'Table' && <Table key={table.path} snapshot={false} rows={restRows} columns={columns} {...tableProps} />}
              {(restView === 'Chart' || pin) && <>{chartControls}<Chart points={restSeries} line={line} /></>}
            </>}
          </>}
        </section>
      </main>
    </div>
    <footer className="status"><span><i className="live-dot" /> Ready <span className="footer-context">· {source} / {view}</span></span>
      <div><kbd>Tab</kbd> navigate <kbd>↵</kbd> open <kbd>/</kbd> filter {dbMode ? <><kbd>c</kbd> compare</> : <><kbd>p</kbd> pin chart</>} <kbd>?</kbd> help</div></footer>
    {help && <Dialog title="Keyboard shortcuts" close={() => setHelp(false)}><dl className="help">
      <dt>Tab / Shift+Tab</dt><dd>Move between controls</dd><dt>Enter / Space</dt><dd>Activate the focused control</dd>
      <dt>1–5</dt><dd>Switch IndexedDB views (1–3 in REST)</dd><dt>/</dt><dd>Focus the current filter</dd><dt>s</dt><dd>Sort the focused column header</dd>
      <dt>c</dt><dd>Compare IndexedDB snapshots</dd><dt>p</dt><dd>Pin the REST chart below the table</dd><dt>? / Esc</dt><dd>Open / close help</dd>
    </dl></Dialog>}
    {selectedKey !== undefined && <Dialog title={printKey(selectedKey)} close={() => setSelectedKey(undefined)}>
      <pre className="raw">{valueText(selected?.store, selectedKey)}</pre>
      <h3>Other captured matches</h3>
      <div className="matches">{matchingValues(captures, capture, selectedKey)
        .filter(match => match.index !== captureIndex || match.id !== storeId)
        .map(match => <button key={match.index + match.id} onClick={() => chooseStore(match.id, match.index, selectedKey)}>
          {match.capture.label} / {match.database} / {match.store.name}
        </button>)}</div>
    </Dialog>}
    {difference && <Dialog title={difference.database + ' / ' + difference.name} close={() => setDifference(undefined)}>
      <p>{displayCell(difference, 'Before')} → {displayCell(difference, 'After')} · Change {displayCell(difference, 'Change')}</p>
      {difference.added && difference.removed ? <div className="difference">{(['added', 'removed'] as const).map(kind =>
        <section key={kind}><h3>{kind === 'added' ? 'Added' : 'Removed'} keys ({difference[kind]!.length})</h3>
          <ul>{difference[kind]!.map((key, i) => <li key={i}>{printKey(key)}</li>)}</ul>
        </section>)}</div> : <p>Key comparison unavailable. Both stores must have complete key previews.</p>}
    </Dialog>}
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
