// The three numbers above every Procurement page (NAV-03, PRD §9). The same three tiles for every role, each the one definition
// of its figure (G-03, G-18) and each a door to the list behind it:
//   1. «احتياج بلا أمر شراء» — the LINES of open requests still to buy, awaiting a reply, or in an RFQ that is not yet an order,
//      with the requests that passed their last day to order as its note.
//   2. «ملتزم لم يصل» — Σ (ordered − accepted) × price × 1.15 over the approved orders that are not complete (no VAT for an
//      unregistered supplier; a lump sum × the share not yet received) — INCLUDING VAT, as every total on screen.
//   3. «فرق السعر عن آخر شراء — 30 يوماً» — Σ (price − the last price of the SAME specification before the order) × qty ÷
//      Σ last price × qty, over the orders sent in the last 30 days; lump sums and piece lines are left out.
// A viewer who sees no prices (the expediter) is shown the same three tiles as COUNTS — no amount, no percentage.
// Pure: nothing here reads a clock but the one passed in.

import { addDays, dayOf, isLumpSum, poOpenValue, poStatus, round2, todayOf } from "./po"
import { inBuyerScope, needKpi } from "./need-desk"
import { poSeg, type PoStateCtx } from "./po-state"
import { materialKey } from "./prices"
import { NEEDS_HREF, type ProcWorld, type TodayActor } from "./today"
import type { PurchaseOrder } from "./types"
import type { StepNotice } from "./next-step"

export const KPI_IDS = ["needs", "committed", "drift"] as const
export type KpiId = (typeof KPI_IDS)[number]

/** `lines` · `money` (incl. VAT) · `percent` (signed, one decimal) · `count` (the no-price form of the last two). */
export type KpiUnit = "lines" | "money" | "percent" | "count"

export interface KpiTile {
  id: KpiId
  labelKey: string
  value: number
  unit: KpiUnit
  /** A money figure says what it includes (G-18). */
  basis: "incl" | null
  noteKey: string
  noteParams: Record<string, string | number>
  tone: "good" | "bad" | "warn" | "neutral"
  href: string
}

export interface ProcKpis {
  tiles: KpiTile[]
}

export const DRIFT_WINDOW_DAYS = 30
export const ORDERS_HREF = "/contractor/rfqs/orders"
export const DRIFT_REPORT_HREF = "/contractor/rfqs/reports?report=drift&period=30"

const num = (n: unknown): number => (Number.isFinite(Number(n)) ? Number(n) : 0)

/** Approved and not complete: the commitment still open (the prototype's `live`). */
export const committedOrders = (orders: PurchaseOrder[]): PurchaseOrder[] => orders.filter((po) => ["approved", "sent", "in_delivery", "part_received"].includes(poStatus(po)))

/** The share of a lump-sum order that has arrived: the mean of its lines' accepted shares. */
function receivedShare(po: PurchaseOrder): number {
  const lines = po.lines.filter((l) => num(l.quantity) - num(l.cancelled) > 0)
  if (!lines.length) return 0
  return lines.reduce((s, l) => s + Math.min(1, num(l.accepted) / (num(l.quantity) - num(l.cancelled))), 0) / lines.length
}

/** What is still owed on an order, EXCLUDING VAT: the quantities not yet accepted at their prices — a lump sum × the share not received. */
export function remainingExVat(po: PurchaseOrder): number {
  if (isLumpSum(po)) return round2(num(po.totalExVat) * (1 - receivedShare(po)))
  return poOpenValue(po)
}

/** `remainingExVat × (1 + VAT)` — no VAT on an order whose supplier is not registered (`vatRate` 0 / `noVat`). */
export const remainingInclVat = (po: PurchaseOrder): number => round2(remainingExVat(po) * (1 + (po.noVat ? 0 : num(po.vatRate))))

export interface Committed {
  /** Σ remaining incl. VAT over the approved incomplete orders. */
  total: number
  orders: number
  /** Of those, the orders late by the one definition of late (`poSeg`). */
  late: number
}

export function committedInclVat(orders: PurchaseOrder[], ctx: PoStateCtx): Committed {
  const live = committedOrders(orders)
  return { total: round2(live.reduce((s, po) => s + remainingInclVat(po), 0)), orders: live.length, late: live.filter((po) => poSeg(po, ctx) === "late").length }
}

export interface Drift {
  /** Signed, one decimal; 0 when nothing could be compared. */
  percent: number
  /** Lines that were compared with an earlier price, and of those the ones priced higher. */
  lines: number
  up: number
  base: number
  diff: number
}

interface Priced {
  day: string
  at: string
  id: string
  price: number
}

const specKey = (l: { specKey?: string | null }): string | null => (l.specKey ? `s:${l.specKey}` : null)

/**
 * Σ (price − last) × qty ÷ Σ last × qty over the orders SENT in the last `windowDays`. «Last» is the price of the same
 * specification on an earlier sent order (a line without a specification key compares by name and unit); a lump-sum order and
 * a piece line are on neither side.
 */
export function priceDriftPercent(orders: PurchaseOrder[], now: Date, windowDays = DRIFT_WINDOW_DAYS): Drift {
  const today = todayOf(now)
  const from = addDays(today, -windowDays)
  const sent = orders.filter((po) => po.status !== "awaiting_approval" && po.status !== "cancelled" && po.sentAt && !isLumpSum(po))
  const index = new Map<string, Priced[]>()
  for (const po of sent) {
    for (const l of po.lines) {
      if (l.unitPrice == null || num(l.pk) > 0) continue
      const entry: Priced = { day: dayOf(po.sentAt), at: po.sentAt as string, id: po.id, price: l.unitPrice }
      for (const k of [specKey(l), `m:${materialKey(l.name, l.unit)}`]) if (k) index.set(k, [...(index.get(k) || []), entry])
    }
  }
  for (const list of index.values()) list.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))

  let base = 0
  let diff = 0
  let lines = 0
  let up = 0
  for (const po of sent) {
    const day = dayOf(po.sentAt)
    if (day < from || day > today) continue
    for (const l of po.lines) {
      if (l.unitPrice == null || num(l.pk) > 0) continue
      const earlier = (index.get(specKey(l) ?? `m:${materialKey(l.name, l.unit)}`) || []).filter((e) => e.id !== po.id && e.day < day)
      const last = earlier[earlier.length - 1]
      const qty = Math.max(0, num(l.quantity) - num(l.cancelled))
      if (!last || !(qty > 0)) continue
      base += last.price * qty
      diff += (l.unitPrice - last.price) * qty
      lines++
      if (l.unitPrice > last.price) up++
    }
  }
  return { percent: base > 0 ? Math.round((diff / base) * 1000) / 10 : 0, lines, up, base: round2(base), diff: round2(diff) }
}

/** The tiles for this viewer. Same ids for everyone; only the form of tiles 2 and 3 follows what he may see. */
export function todayKpis(w: ProcWorld, actor: TodayActor, now: Date): ProcKpis {
  const stateCtx: PoStateCtx = { notices: w.receipts as StepNotice[], financeOn: w.financeOn !== false, acceptanceDays: w.policies.supplierAcceptanceDays, now }
  const desk = w.needDesk
  const buyerScoped = !actor.isOwner && !actor.canApprove && (actor.canPrepare || Boolean(actor.canSource))
  const rows = desk ? (buyerScoped ? desk.rows.filter((r) => inBuyerScope(r, desk.viewerCategories)) : desk.rows) : []
  const nk = needKpi(rows)
  const committed = committedInclVat(w.orders, stateCtx)
  const drift = priceDriftPercent(w.orders, now)

  const needs: KpiTile = {
    id: "needs",
    labelKey: "kpi.needs.label",
    value: nk.need,
    unit: "lines",
    basis: null,
    noteKey: nk.overdue ? "kpi.needs.note_overdue" : "kpi.needs.note_none",
    noteParams: { count: nk.overdue },
    tone: nk.overdue ? "bad" : "good",
    href: `${NEEDS_HREF}?seg=new`,
  }

  if (!actor.seesPrices) {
    return {
      tiles: [
        needs,
        { id: "committed", labelKey: "kpi.committed.label", value: committed.orders, unit: "count", basis: null, noteKey: committed.late ? "kpi.committed.note_late" : "kpi.committed.note_none", noteParams: { count: committed.late }, tone: committed.late ? "bad" : "good", href: ORDERS_HREF + "?filter=all" },
        { id: "drift", labelKey: "kpi.drift.label", value: drift.up, unit: "count", basis: null, noteKey: drift.up ? "kpi.drift.note_up" : "kpi.drift.note_none", noteParams: { count: drift.up }, tone: "neutral", href: DRIFT_REPORT_HREF },
      ],
    }
  }

  return {
    tiles: [
      needs,
      { id: "committed", labelKey: "kpi.committed.label", value: committed.total, unit: "money", basis: "incl", noteKey: committed.late ? "kpi.committed.note_late" : "kpi.committed.note_none", noteParams: { count: committed.late }, tone: committed.late ? "bad" : "good", href: ORDERS_HREF + "?filter=all" },
      { id: "drift", labelKey: "kpi.drift.label", value: drift.percent, unit: "percent", basis: null, noteKey: drift.up ? "kpi.drift.note_up" : "kpi.drift.note_none", noteParams: { count: drift.up }, tone: drift.up ? "warn" : "good", href: DRIFT_REPORT_HREF },
    ],
  }
}
