import { Box, Text } from 'ink'
import { linePlot, plotDomain, type PlotCell, type PlotSample } from './line-plot'
import { bytes, cacheRates, keyCounts, type RedisMetrics } from './redis-metrics'
import { blue, gold, mint, Panel, quiet, red } from './rendering'

export type ChartLayout = { width: number; height: number; ascii: boolean }
type Metric = 'memory' | 'ops' | 'cache' | 'keys'
const chartOrder: Metric[] = ['memory', 'ops', 'cache', 'keys']
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const reading = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour12: false })

const definitions = {
  memory: { title: 'Redis memory', series: [{ name: 'Used', color: mint }] },
  ops: { title: 'Commands per second', series: [{ name: 'Commands/s', color: gold }] },
  cache: { title: 'Cache lookups per second', series: [{ name: 'Hits/s', color: mint }, { name: 'Misses/s', color: red }] },
  keys: { title: 'Keyspace counts', series: [{ name: 'Total keys', color: blue }, { name: 'Expiring', color: gold }] },
}

function project(samples: RedisMetrics[], metric: Metric): PlotSample[] {
  return samples.map((sample, i) => {
    const previous = samples[i - 1]
    const values = metric === 'memory' ? [sample.memory] : metric === 'ops' ? [sample.ops] :
      metric === 'cache' ? cacheRates(previous, sample) : keyCounts(sample)
    return { at: sample.at, values, breakBefore: Boolean(previous?.runId && sample.runId && previous.runId !== sample.runId) }
  })
}

function spans(row: PlotCell[], colors: string[], tick: boolean, ascii: boolean) {
  const result: { text: string; color: string }[] = []
  for (const { mark, series } of row) {
    const color = series === undefined ? '#4c5e59' : series === -1 ? '#e7ece6' : colors[series]
    const glyph = series === undefined && tick ? ascii ? '.' : '┄' : mark
    const last = result.at(-1)
    if (last?.color === color) last.text += glyph
    else result.push({ text: glyph, color })
  }
  return result
}

export function MetricChart({ width, height, ascii, samples, metric }: ChartLayout & { samples: RedisMetrics[]; metric: Metric }) {
  const chart = definitions[metric]
  const points = project(samples, metric)
  const latest = points.at(-1)
  const format = (value: number | undefined) => value === undefined ? '—' :
    metric === 'memory' ? bytes(value) : reading.format(value)
  const legends = chart.series.map(({ name, color }, i) => {
    const value = latest?.values[i]
    const prefix = (ascii ? (i ? '+' : '*') : '━') + ' ' + name + ' '
    const text = prefix + format(value)
    return { name, color, text: metric !== 'memory' && value !== undefined && text.length > width - 4 ?
      prefix + compact.format(value) : text }
  })
  const splitLegend = legends.length > 1 && legends.map(item => item.text).join('   ').length > width - 4
  const graphHeight = Math.max(1, height - 6 - Number(splitLegend))
  const domain = plotDomain(points, metric !== 'memory')
  const colors = chart.series.map(series => series.color)
  const hasData = points.some(point => point.values.some(value => value !== undefined))
  const ticks = new Set([0, graphHeight - 1, ...(graphHeight >= 5 ? [Math.floor((graphHeight - 1) / 2)] : [])])
  const labels = Array.from({ length: graphHeight }, (_, i) => {
    if (!hasData || !ticks.has(i)) return ''
    const value = domain.max - (domain.max - domain.min) * i / Math.max(1, graphHeight - 1)
    return metric === 'memory' ? bytes(value).replace(/[ ,]/g, '') : compact.format(value)
  })
  const axisWidth = Math.max(8, ...labels.map(label => label.length))
  const graphWidth = Math.max(1, Math.min(144, width - axisWidth - 5))
  const cells = linePlot(points, graphWidth, graphHeight, domain, ascii)
  const timeStart = points.length ? clock(points[0].at) : ''
  const timeEnd = latest ? clock(latest.at) : ''
  const collecting = 'Collecting samples'
  const timeframe = points.length === 0 ? 'Waiting for Redis metrics' :
    points.length === 1 ? (graphWidth >= collecting.length + 9 ?
      collecting + timeEnd.padStart(graphWidth - collecting.length) : timeEnd.padStart(graphWidth)) :
    !hasData ? 'No readings for this metric' :
    graphWidth >= 17 ? timeStart + timeEnd.padStart(graphWidth - timeStart.length) : timeEnd.padStart(graphWidth)

  return <Panel width={width} height={height} ascii={ascii}>
    <Box justifyContent="space-between">
      <Text bold wrap="truncate-end">{chart.title}</Text>
      {width >= 44 && <Text color={quiet}>{points.length} {points.length === 1 ? 'sample' : 'samples'}</Text>}
    </Box>
    {splitLegend ? legends.map(({ name, text, color }) => <Text key={name} color={color} wrap="truncate-end">{text}</Text>) :
      <Text wrap="truncate-end">{legends.map(({ name, text, color }, i) => <Text key={name} color={color}>
        {i ? '   ' : ''}{text}
      </Text>)}</Text>}
    {cells.map((row, i) => {
      const tick = ticks.has(i)
      const label = labels[i]
      return <Text key={i} wrap="truncate-end">
        <Text color={quiet}>{label.padStart(axisWidth)}{ascii ? '|' : tick ? '┤' : '│'}</Text>
        {spans(row, colors, tick, ascii).map(({ text, color }, j) => <Text key={j} color={color}>{text}</Text>)}
      </Text>
    })}
    <Text color={quiet} wrap="truncate-end">{' '.repeat(axisWidth)}{ascii ? '+' : '└'}{(ascii ? '-' : '─').repeat(graphWidth)}</Text>
    <Text color={quiet} wrap="truncate-end">{' '.repeat(axisWidth + 1)}{timeframe}</Text>
  </Panel>
}

export function chartsPerPage(width: number, height: number) {
  if (width >= 104 && height >= 22) return 4
  return width >= 104 || height >= 18 ? 2 : 1
}

export function Charts({ width, height, ascii, samples, page }: ChartLayout & { samples: RedisMetrics[]; page: number }) {
  const count = chartsPerPage(width, height)
  const wide = width >= 104 && count > 1
  const columns = wide ? 2 : 1
  const rows = count / columns
  const rowHeight = Math.floor(height / rows)
  const columnWidth = Math.floor(width / columns)
  const shown = chartOrder.slice(page * count, (page + 1) * count)
  return <Box flexDirection="column">
    {Array.from({ length: rows }, (_, row) => <Box key={row}>
      {shown.slice(row * columns, (row + 1) * columns).map((metric, column) => <MetricChart key={metric}
        width={column === columns - 1 ? width - column * columnWidth : columnWidth}
        height={row === rows - 1 ? height - row * rowHeight : rowHeight} {...{ ascii, samples, metric }} />)}
    </Box>)}
  </Box>
}
