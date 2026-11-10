import { Box, Text } from 'ink'
import { redisText, type RedisKeyMetadata, type RedisPage, type RedisPreview } from './redis-client'
import { ttlText } from './redis-metrics'
import { blue, gold, mint, Panel, quiet, safeLine, wrapPreview } from './rendering'

export function KeyGrid({ width, height, ascii, database, page, pattern, filter, batch, index, start, rows, metadata, busy, focused, now }: {
  width: number; height: number; ascii: boolean; database: number; page: RedisPage; pattern: string; filter?: string;
  batch: number; index: number; start: number; rows: number; metadata: Map<Buffer, RedisKeyMetadata>; busy: boolean; focused: boolean; now: number
}) {
  const typeWidth = width < 58 ? 9 : 12
  const ttlWidth = width < 58 ? 11 : 15
  const keyWidth = Math.max(1, width - 4 - typeWidth - ttlWidth)
  return <Panel {...{ width, height, ascii, focused }}>
    <Text bold color={mint} wrap="truncate-end">db{database}  /  Key explorer</Text>
    <Text color={filter === undefined ? quiet : mint} wrap="truncate-end">{filter === undefined ?
      'Filter ' + (safeLine(pattern) || '*') + ' · batch ' + batch : 'Search glob  ' + safeLine(filter) + '▏'}</Text>
    <Box>
      <Box width={keyWidth}><Text color={quiet} wrap="truncate-end">  Key</Text></Box>
      <Box width={typeWidth}><Text color={quiet} wrap="truncate-end">Type</Text></Box>
      <Box width={ttlWidth}><Text color={quiet} wrap="truncate-end">TTL</Text></Box>
    </Box>
    {page.keys.slice(start, start + rows).map((key, i) => {
      const selected = start + i === index
      const details = metadata.get(key)
      return <Box key={start + i}>
        <Box width={keyWidth} paddingRight={1}><Text color={selected ? mint : undefined} bold={selected} wrap="truncate-end">
          {selected ? '> ' : '  '}{safeLine(redisText(key))}
        </Text></Box>
        <Box width={typeWidth} paddingRight={1}><Text color={blue} wrap="truncate-end">{safeLine(details?.type ?? '—')}</Text></Box>
        <Box width={ttlWidth}><Text color={(details?.ttl ?? -1) >= 0 ? gold : quiet} wrap="truncate-end">{ttlText(details?.ttl, details?.at, now)}</Text></Box>
      </Box>
    })}
    {!page.keys.length && <Text color={quiet} wrap="truncate-end">{busy ? 'Loading keys…' :
      page.cursor !== '0' ? 'No matches in this batch · n continues' : 'No keys in this view'}</Text>}
    {!!page.keys.length && <Text color={quiet} wrap="truncate-end">
      {start + 1}–{Math.min(start + rows, page.keys.length)} of {page.keys.length} in batch{page.cursor !== '0' ? ' · n next batch' : ''}
    </Text>}
  </Panel>
}

export function KeyPreview({ width, height, ascii, focused, preview, busy, lines, scroll, visible, now }: {
  width: number; height: number; ascii: boolean; focused: boolean; preview?: { key: Buffer; data: RedisPreview };
  busy: boolean; lines: string[]; scroll: number; visible: number; now: number
}) {
  return <Panel {...{ width, height, ascii, focused }}>
    <Text color={mint} bold>Key details</Text>
    {preview ? <>
      {wrapPreview(redisText(preview.key), width - 4).slice(0, 2).map((line, i) =>
        <Text key={i} bold wrap="truncate-end">{line}</Text>)}
      <Text color={blue} wrap="truncate-end">Type {safeLine(preview.data.type ?? '—')}  ·  TTL {ttlText(preview.data.ttl, preview.data.at, now)}</Text>
      <Text color={quiet} wrap="truncate-end">{preview.data.note ?? 'Value preview'}</Text>
      {lines.slice(scroll, scroll + visible).map((line, i) => <Text key={i} wrap="truncate-end">{line}</Text>)}
      {lines.length > visible && <Text color={quiet} wrap="truncate-end">↑↓ scroll · {scroll + 1}–{Math.min(scroll + visible, lines.length)} of {lines.length}</Text>}
    </> : <Text color={quiet}>{busy ? 'Reading Redis…' : 'Select a key and press Enter.'}</Text>}
  </Panel>
}
