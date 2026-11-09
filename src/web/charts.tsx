import { useRef, useState } from 'react'
import type { Point } from '../core/snapshot'
import { countText } from '../core/snapshot'
import { chartDomain } from '../core/views'

export function Chart({ points, line = false }: { points: Point[]; line?: boolean }) {
  const [focus, setFocus] = useState(0)
  const [page, setPage] = useState(0)
  const pointButtons = useRef<HTMLDivElement>(null)
  const pageSize = 16
  const start = Math.min(page, Math.max(0, Math.ceil(points.length / pageSize) - 1)) * pageSize
  const visible = points.slice(start, start + pageSize)
  if (!visible.length) return <p className="empty">No chart points match this view.</p>
  const active = Math.min(focus, visible.length - 1)
  const { min, max, ratio } = chartDomain(visible)
  const left = 75, right = 690, top = 20, bottom = 198
  const dx = (right - left) / visible.length
  const x = (i: number) => left + dx * (i + 0.5)
  const y = (value: number) => bottom - ratio(value) * (bottom - top)
  const baseline = y(0)
  return <figure className="chart">
    <figcaption><strong>{visible[active].detail ?? visible[active].label}</strong><span>{countText(visible[active].value)}</span></figcaption>
    <svg role="img" aria-label={line ? 'Line chart of current data' : 'Bar chart of current data'} viewBox="0 0 720 220">
      {[0, .25, .5, .75, 1].map(fraction => {
        const value = min * (1 - fraction) + max * fraction
        const ordinate = bottom - fraction * (bottom - top)
        return <g key={fraction}>
          <line x1={left} x2={right} y1={ordinate} y2={ordinate} className="grid-line" />
          <text x={left - 8} y={ordinate + 4} textAnchor="end">{Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}</text>
        </g>
      })}
      {visible.map(({ value, label }, i) => {
        const previous = visible[i - 1]?.value
        return <g key={i} onClick={() => setFocus(i)} className={i === active ? 'point active' : 'point'}>
          <title>{label} · {countText(value)}</title>
          <rect x={left + dx * i} y={top} width={dx} height={bottom - top} fill="transparent" />
          {value === null ? <line x1={x(i) - 6} x2={x(i) + 6} y1={baseline} y2={baseline} className="gap" /> : line ? <>
            {previous != null && <line x1={x(i - 1)} x2={x(i)} y1={y(previous)} y2={y(value)} className="trend" />}
            <circle cx={x(i)} cy={y(value)} r={i === active ? 5 : 3} />
          </> : <rect className="bar" x={x(i) - Math.min(dx * .3, 32)} y={Math.min(y(value), baseline)}
            width={Math.min(dx * .6, 64)} height={Math.max(2, Math.abs(y(value) - baseline))} rx="2" />}
        </g>
      })}
    </svg>
    <div className="point-buttons" ref={pointButtons}>{visible.map((point, i) => <button key={i} type="button"
      aria-label={point.label + ': ' + countText(point.value)} aria-pressed={active === i}
      onKeyDown={event => {
        const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 :
          event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0
        if (!direction) return
        event.preventDefault()
        const next = Math.max(0, Math.min(visible.length - 1, i + direction))
        const button = pointButtons.current?.children[next]
        if (button instanceof HTMLButtonElement) button.focus()
      }}
      onFocus={() => setFocus(i)} onClick={() => setFocus(i)}>{point.label}</button>)}</div>
    {points.length > pageSize && <div className="pagination">
      <button disabled={start === 0} onClick={() => { setPage(start / pageSize - 1); setFocus(0) }}>Previous points</button>
      <span>{start + 1}–{start + visible.length} of {points.length}</span>
      <button disabled={start + visible.length === points.length} onClick={() => { setPage(start / pageSize + 1); setFocus(0) }}>Next points</button>
    </div>}
  </figure>
}
