// Numbers the RFQs raised before RFQs were numbered (Supplier 1.0 NAV-08 / G-10) — pure, so the script's plan is
// tested. Per company and per year of creation, oldest first, each takes the next number after what that year's
// counter already holds (RFQs created since the release drew theirs live), and the counter moves to the last one.
// An RFQ that already has a number keeps it.

import { formatYearlyDocNumber } from "../sales-numbering"
import { RFQ_DOC_TYPE } from "./numbering"

export interface BackfillRfq {
  id: string
  organizationId?: string | null
  contractorId?: string | null
  createdAt?: string | null
  rfqNumber?: string | null
}

export interface BackfillGroup {
  orgId: string
  year: number
  /** `mfgCounters` document id. */
  counterId: string
  /** The counter's value before the backfill. */
  from: number
  assign: Array<{ id: string; rfqNumber: string }>
}

const yearOf = (iso: string | null | undefined, fallback: number): number => {
  const t = Date.parse(String(iso || ""))
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : fallback
}

/** `counters`: counter id → its current `last` (absent = 0). */
export function planRfqNumbers(rfqs: BackfillRfq[], counters: Record<string, number>, fallbackYear: number): BackfillGroup[] {
  const groups = new Map<string, { orgId: string; year: number; rows: BackfillRfq[] }>()
  for (const r of rfqs) {
    if (r.rfqNumber) continue
    const orgId = r.organizationId || r.contractorId || ""
    if (!orgId) continue
    const year = yearOf(r.createdAt, fallbackYear)
    const key = `${orgId}__${RFQ_DOC_TYPE}__${year}`
    const g = groups.get(key) || { orgId, year, rows: [] }
    g.rows.push(r)
    groups.set(key, g)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([counterId, g]) => {
      const from = Number(counters[counterId]) || 0
      const rows = [...g.rows].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || a.id.localeCompare(b.id))
      return { orgId: g.orgId, year: g.year, counterId, from, assign: rows.map((r, k) => ({ id: r.id, rfqNumber: formatYearlyDocNumber(RFQ_DOC_TYPE, g.year, from + k + 1) })) }
    })
}
