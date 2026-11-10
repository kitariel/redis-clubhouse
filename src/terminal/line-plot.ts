import { maxSampleGap } from './redis-metrics'

const dots = [[1, 8], [2, 16], [4, 32], [64, 128]]
const asciiMarks = ['*', '+']

export type PlotSample = { at: number; values: (number | undefined)[]; breakBefore?: boolean }
export type PlotCell = { mark: string; series?: number }
export type PlotDomain = { min: number; max: number }

function niceStep(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return ([1, 2, 5, 10].find(step => step * magnitude >= value) ?? 10) * magnitude
}

export function plotDomain(samples: PlotSample[], fromZero: boolean): PlotDomain {
  const values = samples.flatMap(sample => sample.values).filter((value): value is number => value !== undefined)
  if (!values.length) return { min: 0, max: 1 }
  const max = Math.max(...values)
  if (fromZero) return { min: 0, max: max > 0 ? niceStep(max) : 1 }
  const min = Math.min(...values)
  const padding = min === max ? Math.max(1024, max * .025) : (max - min) * .1
  const step = niceStep((max - min + 2 * padding) / 4)
  return { min: Math.max(0, Math.floor((min - padding) / step) * step), max: Math.ceil((max + padding) / step) * step }
}

export function linePlot(samples: PlotSample[], width: number, height: number, domain: PlotDomain, ascii = false): PlotCell[][] {
  const horizontal = ascii ? 1 : 2
  const vertical = ascii ? 1 : 4
  const xMax = width * horizontal - 1
  const yMax = height * vertical - 1
  const span = (samples.at(-1)?.at ?? 0) - (samples[0]?.at ?? 0)
  const cells = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ mask: 0, series: undefined as number | undefined })))
  const previous: ({ x: number; y: number } | undefined)[] = []

  function paint(x: number, y: number, series: number) {
    const cell = cells[Math.floor(y / vertical)][Math.floor(x / horizontal)]
    cell.series = cell.mask && cell.series !== series ? -1 : series
    cell.mask |= ascii ? 1 : dots[y % 4][x % 2]
  }

  samples.forEach((sample, i) => {
    if (sample.breakBefore || (i > 0 && sample.at - samples[i - 1].at > maxSampleGap)) previous.length = 0
    const position = span > 0 ? (sample.at - samples[0].at) / span : samples.length < 2 ? 1 : i / (samples.length - 1)
    const x = Math.round(Math.max(0, Math.min(1, position)) * xMax)
    sample.values.forEach((value, series) => {
      if (value === undefined) {
        previous[series] = undefined
        return
      }
      const fraction = (domain.max - value) / (domain.max - domain.min)
      const y = Math.round(Math.max(0, Math.min(1, fraction)) * yMax)
      const last = previous[series]
      if (last) {
        const steps = Math.max(Math.abs(x - last.x), Math.abs(y - last.y))
        for (let step = 1; step < steps; step++) {
          paint(Math.round(last.x + (x - last.x) * step / steps), Math.round(last.y + (y - last.y) * step / steps), series)
        }
      }
      paint(x, y, series)
      previous[series] = { x, y }
    })
  })

  return cells.map(row => row.map(({ mask, series }) => ({
    mark: mask ? ascii ? series === -1 ? '#' : asciiMarks[series ?? 0] : String.fromCharCode(0x2800 + mask) : ' ',
    series,
  })))
}
