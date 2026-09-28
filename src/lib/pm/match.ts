// PM 1.0 — the three-way match, read-only (PRD STK-07): what we ordered on the
// project's purchase orders × what we proved we received (the accepted
// quantity at the gate) × what the supplier invoiced. Payment is Finance's;
// an invoice above what we received is a difference Finance does not pay.
// Invoices are the supplier's own (the portal's `invoices`), tied to an order
// by its id or by its RFQ, and to a line by its material's name — a one-line
// order takes the whole invoice. Pure: no I/O.

import { foldSearchText } from "../search-text"
import type { CostPo } from "./cost"

const r2 = (n: number) => Math.round(n * 100) / 100

export interface InvoiceFact {
  id: string
  no: string
  date: string | null
  poId?: string | null
  rfqId?: string | null
  lines: Array<{ name: string; quantity: number; unitPrice: number }>
}

export const MATCH_STATES = ["ok", "over", "under", "noinv"] as const
export type MatchState = (typeof MATCH_STATES)[number]

export interface MatchRow {
  poId: string
  poNo: string
  lineId: string
  material: string
  unit: string
  itemId: string | null
  ordered: number
  received: number
  invoiced: number | null
  invoicedAmount: number | null
  invoice: { no: string; date: string | null } | null
  state: MatchState
}

/** Orders that reach the match: approved onwards (a cancelled one only if something arrived). */
const MATCHING = new Set(["approved", "sent", "accepted", "closed"])

export function matchState(received: number, invoiced: number | null): MatchState {
  if (invoiced === null) return "noinv"
  if (Math.abs(received - invoiced) < 0.01) return "ok"
  return invoiced > received ? "over" : "under"
}

export function matchRows(pos: CostPo[], invoices: InvoiceFact[]): MatchRow[] {
  const out: MatchRow[] = []
  for (const po of pos) {
    if (!MATCHING.has(po.status) && !(po.status === "cancelled" && po.lines.some((l) => l.accepted > 0))) continue
    const mine = invoices.filter((i) => i.poId === po.id || (!i.poId && po.rfqId && i.rfqId === po.rfqId))
    for (const l of po.lines) {
      const key = foldSearchText(l.name)
      let qty = 0
      let amount = 0
      const hits: InvoiceFact[] = []
      for (const inv of mine) {
        const lines = po.lines.length === 1 ? inv.lines : inv.lines.filter((x) => foldSearchText(x.name) === key)
        if (!lines.length) continue
        hits.push(inv)
        qty += lines.reduce((a, x) => a + x.quantity, 0)
        amount += lines.reduce((a, x) => a + x.quantity * x.unitPrice, 0)
      }
      const hit = hits.slice().sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""))[0] ?? null
      const invoiced = hit ? r2(qty) : null
      out.push({
        poId: po.id,
        poNo: po.docNumber,
        lineId: l.id,
        material: l.name,
        unit: l.unit,
        itemId: l.boqItemId ?? null,
        ordered: l.quantity,
        received: r2(l.accepted),
        invoiced,
        invoicedAmount: hit ? r2(amount) : null,
        invoice: hit ? { no: hit.no, date: hit.date } : null,
        state: matchState(r2(l.accepted), invoiced),
      })
    }
  }
  return out
}
