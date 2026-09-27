// Procurement › RFQs — what each RFQ card and row shows (PRD 3.0 §7.2 tab 3,
// the reference prototype's RFQ list). The stored status is Draft · New ·
// Awarded; the stage the buyer reads is derived from it and the deadline:
// open while the deadline has not passed, then ready to compare if offers
// came in, closed without offers if none did. Nothing here is stored.
// Pure: no I/O.

import { lastPaid, type PriceHistoryEntry } from "./prices"

export type RfqStage = "draft" | "open" | "compare" | "closed_empty" | "awarded"
export type RfqStatusChip = "all" | "Draft" | "New" | "Awarded"

export interface RfqLike {
  status?: string | null
  deadline?: string | null
  offersCount?: number | null
  products?: Array<{ description?: string | null; name?: string | null; quantity?: string | number | null; unit?: string | null }> | null
  quantity?: string | number | null
  unitOfMeasure?: string | null
  title?: string | null
}

const dayOf = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null)
const todayOf = (now: Date) => {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 10)
}

/** Whole days from today to the deadline (negative once it passed); null without one. */
export function daysToDeadline(rfq: Pick<RfqLike, "deadline">, now: Date): number | null {
  const day = dayOf(rfq.deadline)
  if (!day) return null
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayOf(now)}T00:00:00Z`)) / 86_400_000)
}

export function rfqStage(rfq: RfqLike, now: Date): RfqStage {
  if (rfq.status === "Draft") return "draft"
  if (rfq.status === "Awarded") return "awarded"
  const days = daysToDeadline(rfq, now)
  if (days === null || days >= 0) return "open"
  return (rfq.offersCount ?? 0) > 0 ? "compare" : "closed_empty"
}

/** The tone of the stage — the card's top edge and its pill share it. */
export const STAGE_TONE: Record<RfqStage, "mute" | "info" | "warn" | "bad" | "ok"> = {
  draft: "mute",
  open: "info",
  compare: "warn",
  closed_empty: "bad",
  awarded: "ok",
}

export type DeadlinePill = { kind: "passed" } | { kind: "soon"; days: number } | null

/** The deadline's pill: passed (red) while it still matters, or two days or less left (amber). */
export function deadlinePill(rfq: RfqLike, now: Date): DeadlinePill {
  const stage = rfqStage(rfq, now)
  if (stage === "draft" || stage === "awarded") return null
  const days = daysToDeadline(rfq, now)
  if (days === null) return null
  if (days < 0) return { kind: "passed" }
  if (days <= 2) return { kind: "soon", days }
  return null
}

/** The status chips' counts: all · drafts · active (open, comparing or closed empty) · awarded. */
export function chipCounts(rfqs: RfqLike[]): Record<RfqStatusChip, number> {
  return {
    all: rfqs.length,
    Draft: rfqs.filter((r) => r.status === "Draft").length,
    New: rfqs.filter((r) => r.status === "New").length,
    Awarded: rfqs.filter((r) => r.status === "Awarded").length,
  }
}

/** How many products the RFQ asks for — a single-material RFQ counts one. */
export const productCount = (rfq: RfqLike) => (Array.isArray(rfq.products) && rfq.products.length ? rfq.products.length : 1)

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

/**
 * An estimate at the last price we paid for each material (excl. VAT): a
 * number only when EVERY line has a history — a partial sum would read as the
 * whole RFQ's value and understate it.
 */
export function estimateAtLastPrice(rfq: RfqLike, history: PriceHistoryEntry[]): number | null {
  const lines = Array.isArray(rfq.products) && rfq.products.length
    ? rfq.products.map((p) => ({ name: p.description || p.name || "", qty: num(p.quantity), unit: p.unit || "" }))
    : [{ name: rfq.title || "", qty: num(rfq.quantity), unit: rfq.unitOfMeasure || "" }]
  let total = 0
  for (const l of lines) {
    const last = l.name && l.qty > 0 ? lastPaid(history, l.name, l.unit) : null
    if (!last) return null
    total += l.qty * last.price
  }
  return Math.round(total * 100) / 100
}
