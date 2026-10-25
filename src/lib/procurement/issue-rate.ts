// The current issue rate of a stock item (Procurement 2.0, INC-06 — the prototype's «الرصيد يكفي 9 أيام بمعدل الصرف الحالي»): what
// left each warehouse over the last days — stock moved out to another warehouse or a project, a warehouse request released, a
// customer delivery signed, a work order's materials issued — summed per warehouse and item name, per day. Pure.

/** The days the rate is read over. */
export const ISSUE_WINDOW_DAYS = 30

export interface StockMove {
  warehouseId: string
  name: string
  qty: number
  /** `YYYY-MM-DD` the stock left. */
  day: string
}

export const issueKey = (warehouseId: string, name: string) => `${warehouseId}|${name.trim().toLowerCase()}`

const DAY = 86_400_000
const dayNum = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY

/** Per warehouse and item: the quantity issued per day over the window ending `today` (moves outside it, or of no quantity, are not counted). */
export function issueRates(moves: ReadonlyArray<StockMove>, today: string, windowDays = ISSUE_WINDOW_DAYS): Record<string, number> {
  const to = dayNum(today)
  const from = to - windowDays
  const sums: Record<string, number> = {}
  for (const m of moves) {
    if (!m.warehouseId || !m.name?.trim() || !(m.qty > 0) || !m.day) continue
    const d = dayNum(m.day)
    if (!(d > from && d <= to)) continue
    const k = issueKey(m.warehouseId, m.name)
    sums[k] = (sums[k] || 0) + m.qty
  }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(sums)) out[k] = Math.round((v / windowDays) * 1000) / 1000
  return out
}
