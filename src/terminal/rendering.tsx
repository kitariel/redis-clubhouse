import { stripVTControlCharacters } from 'node:util'
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'

export const mint = '#8ee8c2'
export const quiet = '#a6b3b1'
export const border = '#475d56'
export const red = '#f29588'
export const gold = '#f2c184'
export const blue = '#93bff0'

export function safeLine(value: string) {
  return stripVTControlCharacters(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ')
}

export function windowStart(total: number, size: number, focus: number) {
  return Math.min(Math.max(0, total - size), Math.max(0, focus - Math.floor(size / 2)))
}

export const clampIndex = (index: number, length: number) => Math.min(Math.max(0, length - 1), Math.max(index, 0))

export function Panel({ width, height, ascii, focused, children }: {
  width: number; height: number; ascii: boolean; focused?: boolean; children: ReactNode
}) {
  return <Box width={width} height={height} paddingX={1} flexDirection="column" overflow="hidden"
    borderStyle={ascii ? 'classic' : 'single'} borderColor={focused ? mint : border}>{children}</Box>
}

export function wrapPreview(text: string, width: number) {
  return text.split('\n').flatMap(line => {
    const safe = safeLine(line)
    const cells = Math.max(1, /^[ -~]*$/.test(safe) ? width : Math.floor(width / 2))
    return safe.match(new RegExp('.{1,' + cells + '}', 'gu')) ?? [' ']
  })
}
