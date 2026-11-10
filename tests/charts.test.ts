import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linePlot } from '../src/terminal/line-plot'
import { cacheRates, parseRedisInfo } from '../src/terminal/redis-metrics'

test('connects sampled values across the chart and preserves separate series', () => {
  const chart = linePlot([
    { at: 0, values: [0, 2] }, { at: 2000, values: [0, 2] },
  ], 8, 3, { min: 0, max: 2 }, true)
  assert.equal(chart[0].map(cell => cell.mark).join(''), '++++++++')
  assert.equal(chart[2].map(cell => cell.mark).join(''), '********')
  assert.deepEqual(chart[0].map(cell => cell.series), Array(8).fill(1))
  const dots = linePlot([
    { at: 0, values: [0] }, { at: 2000, values: [2] },
  ], 8, 3, { min: 0, max: 2 })
  assert.ok(dots[1].some(cell => /^[\u2801-\u28ff]$/.test(cell.mark)))
})

test('leaves a visible gap for missing data and disconnected intervals', () => {
  for (const samples of [
    [{ at: 0, values: [0] }, { at: 2000, values: [undefined] }, { at: 4000, values: [0] }],
    [{ at: 0, values: [0] }, { at: 12000, values: [0] }],
  ]) {
    const chart = linePlot(samples, 8, 2, { min: 0, max: 1 }, true)
    assert.equal(chart[1].map(cell => cell.mark).join(''), '*      *')
  }
})

test('calculates cache rates using elapsed time and skips resets', () => {
  const stats = (at: number, hits: number, misses: number, run = 'one') =>
    parseRedisInfo('run_id:' + run + '\nkeyspace_hits:' + hits + '\nkeyspace_misses:' + misses, at)
  assert.deepEqual(cacheRates(stats(0, 100, 5), stats(2500, 110, 7)), [4, 0.8])
  assert.deepEqual(cacheRates(stats(0, 100, 5), stats(2500, 1, 0)), [undefined, undefined])
  assert.deepEqual(cacheRates(stats(0, 100, 5), stats(2500, 110, 7, 'two')), [undefined, undefined])
  assert.deepEqual(cacheRates(undefined, stats(2500, 110, 7)), [undefined, undefined])
})
