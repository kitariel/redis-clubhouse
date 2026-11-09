import before from '../../samples/before.json'
import after from '../../samples/after.json'
import { parseSnapshot } from './snapshot'
import { parseHttp, type HttpResponse } from './rest'

export const demoCaptures = [
  { label: 'Before sync', snapshot: parseSnapshot(JSON.stringify(before)) },
  { label: 'After sync', snapshot: parseSnapshot(JSON.stringify(after)) },
]

export const demoRequests = parseHttp('### Sales\nGET /sales\n### Sales by region\nGET /regions')
const fixture = (json: unknown, elapsed: number): HttpResponse => ({
  status: 200, elapsed, text: JSON.stringify(json), json,
})
export const demoResponses = [
  fixture({ data: { items: [
    { month: 'Jan', region: 'East', revenue: 12400, orders: 104 },
    { month: 'Feb', region: 'West', revenue: 14900, orders: 121 },
    { month: 'Mar', region: 'East', revenue: 13100, orders: 113 },
    { month: 'Apr', region: 'West', revenue: 18200, orders: 146 },
    { month: 'May', region: 'East', revenue: 22400, orders: 173 },
    { month: 'Jun', region: 'West', revenue: 21600, orders: 168 },
  ] } }, 84),
  fixture({ regions: [
    { region: 'East', revenue: 47900, orders: 390 },
    { region: 'West', revenue: 54700, orders: 435 },
  ] }, 42),
]
