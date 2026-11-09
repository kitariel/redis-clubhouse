import { stripVTControlCharacters } from 'node:util'
import { Box, Text } from 'ink'
import { countText, type Point } from '../core/snapshot'
import type { Row, Sort } from '../core/rest'
import { chartDomain, displayCell } from '../core/views'

export const mint = '#90e4c1'
export const quiet = '#a2b2ae'
export const border = '#50635e'
export const red = '#f4a9a0'

export function safeLine(value: string) {
  return stripVTControlCharacters(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ')
}

export function windowStart(total: number, size: number, focus: number) {
  return Math.min(Math.max(0, total - size), Math.max(0, focus - Math.floor(size / 2)))
}
export const clampIndex = (index: number, length: number) => Math.min(Math.max(0, length - 1), Math.max(index, 0))

export function Grid({ rows, columns, index, column, sort, width, height, snapshot }: {
  rows: Row[]; columns: string[]; index: number; column: number; sort?: Sort; width: number; height: number; snapshot: boolean;
}) {
  if (!rows.length || !columns.length) return <Text color={quiet}>No rows to display.</Text>
  const count = Math.min(columns.length, Math.max(1, Math.floor(width / 12)))
  const first = windowStart(columns.length, count, column)
  const shown = columns.slice(first, first + count)
  const firstWidth = count === 1 ? width - 2 : Math.floor((width - 2) / (count + 1) * 2)
  const otherWidth = Math.floor((width - 2 - firstWidth) / Math.max(1, count - 1))
  const widths = shown.map((_, i) => i ? otherWidth : firstWidth)
  if (shown.length === 4 && shown[2] === 'Key preview' && width >= 70) {
    const storeWidth = Math.floor(width * .23)
    widths.splice(0, 4, storeWidth, 10, width - storeWidth - 21, 9)
  }
  const start = windowStart(rows.length, height, index)
  return <Box flexDirection="column">
    <Box><Text color={quiet}>  </Text>{shown.map((name, i) =>
      <Box key={name} width={widths[i]} paddingRight={1}>
        <Text color={i + first === column ? mint : quiet} wrap="truncate-end">{safeLine(name)}{sort?.column === name ? sort.descending ? ' ↓' : ' ↑' : ''}</Text>
      </Box>)}</Box>
    {rows.slice(start, start + height).map((row, i) => <Box key={i}>
      <Text color={mint}>{start + i === index ? '> ' : '  '}</Text>
      {shown.map((name, j) => <Box key={name} width={widths[j]} paddingRight={1}>
        <Text color={start + i === index ? mint : undefined} wrap="truncate-end">{safeLine(displayCell(row, name, snapshot)) || ' '}</Text>
      </Box>)}
    </Box>)}
    {(rows.length > height || count < columns.length) && <Text color={quiet} wrap="truncate-end">
      {start + 1}–{Math.min(start + height, rows.length)} of {rows.length} rows · columns {first + 1}–{first + shown.length} of {columns.length}
    </Text>}
  </Box>
}

export function TerminalChart({ points, index, width, height, line, ascii }: {
  points: Point[]; index: number; width: number; height: number; line: boolean; ascii: boolean;
}) {
  if (!points.length) return <Text color={quiet}>No chart points match this view.</Text>
  const current = points[index] ?? points[0]
  const title = safeLine(current.detail ?? current.label) + ' · ' + countText(current.value)
  const { ratio } = chartDomain(points)
  if (!line) {
    const size = Math.max(1, height - 1)
    const start = windowStart(points.length, size, index)
    const barWidth = Math.max(4, width - 38)
    return <Box flexDirection="column">
      <Text color={mint} wrap="truncate-end">{title}</Text>
      {points.slice(start, start + size).map((point, i) => {
        const zero = Math.round(ratio(0) * (barWidth - 1))
        const target = point.value === null ? zero : Math.round(ratio(point.value) * (barWidth - 1))
        const marks = Array.from({ length: barWidth }, (_, j) => {
          if (point.value === null) return j === zero ? (ascii ? '-' : '·') : ' '
          if (j === zero) return point.value === 0 ? (ascii ? '.' : '·') : target === zero ? (ascii ? '#' : '█') : '|'
          return j >= Math.min(zero, target) && j <= Math.max(zero, target) ? (ascii ? '#' : '█') : ' '
        }).join('')
        return <Box key={i}>
          <Box width={22} paddingRight={1}><Text color={start + i === index ? mint : quiet} wrap="truncate-end">{safeLine(point.label)}</Text></Box>
          <Text color={mint}>{marks} </Text><Text wrap="truncate-end">{countText(point.value)}</Text>
        </Box>
      })}
    </Box>
  }
  const plotWidth = Math.max(8, width - 2)
  const plotHeight = Math.max(2, height - 1)
  const size = Math.min(points.length, Math.max(2, Math.floor(plotWidth / 3)))
  const start = windowStart(points.length, size, index)
  const grid = Array.from({ length: plotHeight }, () => Array<string>(plotWidth).fill(' '))
  const baseline = Math.round((1 - ratio(0)) * (plotHeight - 1))
  grid[baseline].fill(ascii ? '.' : '·')
  let previous: { x: number; y: number } | undefined
  points.slice(start, start + size).forEach((point, i) => {
    if (point.value === null) { previous = undefined; return }
    const x = size === 1 ? 1 : Math.round(i / (size - 1) * (plotWidth - 1))
    const y = Math.round((1 - ratio(point.value)) * (plotHeight - 1))
    if (previous) for (let j = previous.x + 1; j < x; j++) {
      const t = (j - previous.x) / (x - previous.x)
      grid[Math.round(previous.y * (1 - t) + y * t)][j] = ascii ? '-' : '─'
    }
    grid[y][x] = i + start === index ? (ascii ? '@' : '●') : (ascii ? 'o' : '○')
    previous = { x, y }
  })
  return <Box flexDirection="column"><Text color={mint} wrap="truncate-end">{title}</Text>
    {grid.map((row, i) => <Text key={i} color={mint}>{row.join('')}</Text>)}
  </Box>
}
