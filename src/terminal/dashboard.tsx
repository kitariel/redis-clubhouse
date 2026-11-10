import { Box, Text } from 'ink'
import { MetricChart, type ChartLayout } from './charts'
import { bytes, keyCounts, number, type RedisDatabase, type RedisMetrics } from './redis-metrics'
import { blue, gold, mint, Panel, quiet, windowStart } from './rendering'

type Layout = ChartLayout

function MetricCards({ width, ascii, stats }: Pick<Layout, 'width' | 'ascii'> & { stats?: RedisMetrics }) {
  const [total] = keyCounts(stats)
  const memoryNote = stats?.maxMemory === 0 ? 'No Redis limit' :
    stats?.maxMemory ? 'Limit ' + bytes(stats.maxMemory) : 'Redis allocator'
  const cards = [
    { title: 'Memory used', value: bytes(stats?.memory), note: memoryNote, color: mint },
    { title: 'Total keys', value: number(total), note: 'Across databases', color: blue },
    { title: 'Commands/s', value: number(stats?.ops), note: 'Reported by Redis', color: gold },
    { title: 'Clients', value: number(stats?.clients), note: 'Connected', color: mint },
  ]
  const cardWidth = Math.floor(width / cards.length)
  return <Box>
    {cards.map(({ title, value, note, color }, i) => <Panel key={title}
      width={i === cards.length - 1 ? width - i * cardWidth : cardWidth} height={5} ascii={ascii}>
      <Text color={quiet} wrap="truncate-end">{title}</Text>
      <Text color={color} bold wrap="truncate-end">{value}</Text>
      <Text color={quiet} wrap="truncate-end">{note}</Text>
    </Panel>)}
  </Box>
}

function DatabaseGrid({ width, height, ascii, databases, selected, active, configured }: Layout & {
  databases: RedisDatabase[]; selected: number; active: number; configured?: number
}) {
  const rows = Math.max(1, height - 6)
  const offset = windowStart(databases.length, rows, selected)
  const max = Math.max(1, ...databases.map(db => db.keys ?? 0))
  const plotWidth = Math.max(1, Math.min(32, width - 35))
  return <Panel width={width} height={height} ascii={ascii} focused>
    <Text bold color={mint}>Databases</Text>
    <Text color={quiet} wrap="truncate-end">{configured === undefined ? 'Discovered indexes · d opens any index' :
      number(configured) + ' configured · d jumps to an index'}</Text>
    <Box>
      <Box width={12}><Text color={quiet}>  Index</Text></Box>
      <Box width={9}><Text color={quiet}>Keys</Text></Box>
      <Box width={10}><Text color={quiet}>Expiring</Text></Box>
      <Text color={quiet} wrap="truncate-end">Relative keys</Text>
    </Box>
    {databases.slice(offset, offset + rows).map((db, i) => {
      const focus = selected === offset + i
      const color = focus ? mint : undefined
      const length = db.keys ? Math.max(1, Math.round(db.keys * plotWidth / max)) : 0
      return <Box key={db.index}>
        <Box width={12}><Text color={color} bold={focus} wrap="truncate-end">{focus ? '> ' : '  '}db{db.index}{active === db.index ? ' *' : ''}</Text></Box>
        <Box width={9}><Text color={color} wrap="truncate-end">{number(db.keys)}</Text></Box>
        <Box width={10}><Text color={color} wrap="truncate-end">{number(db.expires)}</Text></Box>
        <Text color={blue} wrap="truncate-end">{(ascii ? '#' : '⣿').repeat(length)}</Text>
      </Box>
    })}
    <Text color={quiet} wrap="truncate-end">{offset + 1}–{Math.min(offset + rows, databases.length)} of {databases.length} shown · * active · Enter opens keys</Text>
  </Panel>
}

export function Dashboard({ width, height, ascii, samples, databases, selected, active, configured }: Layout & {
  samples: RedisMetrics[]; databases: RedisDatabase[]; selected: number; active: number; configured?: number
}) {
  const wide = width >= 100 && height >= 21
  const dbWidth = wide ? Math.floor(width * .55) : width
  const pulseWidth = width - dbWidth
  const bodyHeight = height - 5
  const memoryHeight = Math.floor(bodyHeight / 2)
  return <Box flexDirection="column">
    <MetricCards width={width} ascii={ascii} stats={samples.at(-1)} />
    <Box>
      <DatabaseGrid width={dbWidth} height={bodyHeight} ascii={ascii} {...{ databases, selected, active, configured }} />
      {wide && <Box flexDirection="column">
        <MetricChart width={pulseWidth} height={memoryHeight} ascii={ascii} samples={samples} metric="memory" />
        <MetricChart width={pulseWidth} height={bodyHeight - memoryHeight} ascii={ascii} samples={samples} metric="ops" />
      </Box>}
    </Box>
  </Box>
}
