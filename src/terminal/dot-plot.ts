const dots = [[1, 8], [2, 16], [4, 32], [64, 128]]

export function dotPlot(values: (number | undefined)[], width: number, height: number, ascii = false, timestamps?: number[]) {
  const horizontal = ascii ? 1 : 2
  const vertical = ascii ? 1 : 4
  const xMax = width * horizontal - 1
  const yMax = height * vertical - 1
  const visible = values.slice(-(xMax + 1))
  const times = timestamps?.slice(-visible.length)
  const span = times?.length ? times.at(-1)! - times[0] : 0
  const samples = visible.filter((value): value is number => value !== undefined)
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const cells = Array.from({ length: height }, () => Array<number>(width).fill(0))
  visible.forEach((value, i) => {
    if (value === undefined) return
    const relative = times && span > 0 ? (times[i] - times[0]) / span :
      visible.length < 2 ? 1 : i / (visible.length - 1)
    const x = Math.round(relative * xMax)
    const y = min === max ? Math.round(yMax / 2) : Math.round((max - value) * yMax / (max - min))
    cells[Math.floor(y / vertical)][Math.floor(x / horizontal)] |= ascii ? 1 : dots[y % 4][x % 2]
  })
  return cells.map(row => row.map(cell => cell ? ascii ? '*' : String.fromCharCode(0x2800 + cell) : ' ').join(''))
}
