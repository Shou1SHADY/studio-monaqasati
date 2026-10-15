// Every figure the free supplier sees is computed here, from the deal and nothing else
// (Supplier 1.0 PRD §8 and the invariants G-01…G-12). Pure functions: the one
// outside input is the day, so `createDealLogic(today)` closes over it and a test can
// stand on any date.
//
// Four rules run through the file:
//  - a quantity lives in one place: ordered = accepted + cancelled + left, and a
//    rejected quantity returns to "left" unless the contractor cancels it (G-02);
//  - the supplier's report "I delivered" is a date and a note — it never moves a
//    quantity (G-03); quantities come from the contractor's receipts;
//  - lateness is one rule: what is left after the committed date is late, unless a
//    delivery was reported on or before that date, then the clock stops until the
//    receipt (G-05);
//  - an invoice is raised per receipt, never above what the contractor accepted
//    (decision 1, G-07), and its instalments come from the terms frozen on the order (G-08).

import type { Deal, DealInvoice, DealOffer, DealPo, DealReceipt, DealReport, PaymentTerm, PoLineFact, QuoteVersion } from "./types"

export const VAT = 0.15
export const STAGES = ["new", "offered", "deliver", "collect", "done"] as const
export type Stage = (typeof STAGES)[number]

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const MS_DAY = 864e5
export const dayNum = (iso: string) => {
  const p = iso.slice(0, 10).split("-").map(Number)
  return Date.UTC(p[0], p[1] - 1, p[2])
}
export const addDaysTo = (iso: string, n: number) => new Date(dayNum(iso) + n * MS_DAY).toISOString().slice(0, 10)

export interface LineState {
  ord: number
  got: number
  rej: number
  can: number
  left: number
}

export type OfferState = DealOffer["status"] | "declinedPo" | null

export type PoState = "new" | "wait" | "supply" | "done" | "declined" | null
export type InvState = "toinv" | "due" | "sent" | "paid" | "late" | null

export interface Instalment {
  pct: number
  amt: number
  due: string
}

export interface NextDue {
  amt: number
  due: string
  /** The invoice this instalment belongs to. */
  inv: number
}

export const OFFER_SEG = {
  reply: ["reduce", "sample"],
  wait: ["review", "sampleSent"],
  won: ["won"],
  lost: ["lost", "noaward", "withdrawn", "declinedPo", "noquote"],
} as const
export type OfferSeg = keyof typeof OFFER_SEG
export const OFFER_ORDER: readonly OfferSeg[] = ["reply", "wait", "won", "lost"]

export interface InvoiceAlloc {
  /** Index into `deal.invs`. */
  n: number
  inv: DealInvoice
  gross: number
  paid: number
  left: number
  /** Reported by the contractor, not yet confirmed by the supplier. */
  reported: number
  st: "paid" | "sent" | "due"
}

export const FALLBACK_TERMS: PaymentTerm[] = [{ pct: 100, days: 30 }]

export function createDealLogic(today: string, vatRate: number = VAT) {
  const daysTo = (iso: string, from: string = today) => Math.round((dayNum(iso) - dayNum(from)) / MS_DAY)
  const addDays = addDaysTo

  const curV = (d: Deal): QuoteVersion | null => (d.offer ? d.offer.v[d.offer.v.length - 1] : null)

  /** Σ unit price × quantity of the priced items, or the one total. Before VAT. */
  function offerTotal(d: Deal, v: QuoteVersion | null = curV(d)): number {
    if (!v) return 0
    if (d.pricing === "total") return r2(v.total || 0)
    return r2(d.items.reduce((s, i) => s + (v.prices[i.id] != null ? (v.prices[i.id] as number) * i.qty : 0), 0))
  }

  const isLump = (po: DealPo) => po.lump != null || po.lines.some((l) => l.price == null)

  function lineSt(l: PoLineFact): LineState {
    const got = l.got || 0
    const can = l.can || 0
    return { ord: l.qty, got, rej: l.rej || 0, can, left: Math.max(0, r2(l.qty - got - can)) }
  }

  const allGot = (d: Deal) => !!d.po && d.po.lines.every((l) => lineSt(l).left === 0)

  /** Value of a share of the order. A lump-sum order has no unit prices: the figure is
   * the whole total once everything arrived and nothing before it (no invented split). */
  function sumLines(d: Deal, f: (s: LineState) => number): number {
    if (!d.po) return 0
    if (isLump(d.po)) return 0
    return r2(d.po.lines.reduce((s, l) => s + f(lineSt(l)) * (l.price as number), 0))
  }
  const lumpTotal = (d: Deal) => (d.po && isLump(d.po) ? r2(d.po.lump || 0) : 0)

  const poValue = (d: Deal): number => {
    if (!d.po) return 0
    return isLump(d.po) ? lumpTotal(d) : r2(d.po.lines.reduce((s, l) => s + l.qty * (l.price as number), 0))
  }
  const canValue = (d: Deal) => sumLines(d, (x) => x.can)
  const gotValue = (d: Deal) => (d.po && isLump(d.po) ? (allGot(d) ? lumpTotal(d) : 0) : sumLines(d, (x) => x.got))
  const unsentValue = (d: Deal) => (d.po && isLump(d.po) ? (allGot(d) ? 0 : lumpTotal(d)) : sumLines(d, (x) => x.left))
  const deliveredPct = (d: Deal) => {
    const v = r2(poValue(d) - canValue(d))
    return v > 0 ? Math.min(100, Math.round((gotValue(d) / v) * 100)) : 0
  }

  const receipts = (d: Deal): DealReceipt[] => d.ship.filter((s): s is DealReceipt => s.st === "ok")
  /** Reports the contractor has not answered with a receipt yet. */
  const waiting = (d: Deal): DealReport[] => d.ship.filter((s): s is DealReport => s.st === "wait")

  // ---- Money: invoices per receipt ---------------------------------------------------

  const vatOf = (i: DealInvoice) => (i.vat != null ? i.vat : vatRate)
  const invGross = (i: DealInvoice) => r2(i.amt * (1 + vatOf(i)))
  /** What the accepted-but-unbilled value would come to with VAT, for the "upload the invoice" task's estimate. */
  const uninvoicedGross = (d: Deal) => r2(uninvoicedNet(d) * (1 + vatRate))
  const invoices = (d: Deal) => d.invs
  const invoicedNet = (d: Deal) => r2(d.invs.reduce((s, i) => s + i.amt, 0))
  const paidOk = (d: Deal) => r2(d.pays.filter((p) => p.st === "ok").reduce((s, p) => s + p.amt, 0))
  const paidSent = (d: Deal) => r2(d.pays.filter((p) => p.st === "sent").reduce((s, p) => s + p.amt, 0))
  const grossTotal = (d: Deal) => r2(d.invs.reduce((s, i) => s + invGross(i), 0))
  const owed = (d: Deal) => (d.invs.length ? Math.max(0, r2(grossTotal(d) - paidOk(d))) : 0)

  const termsOf = (d: Deal): PaymentTerm[] => (d.po && d.po.terms.length ? d.po.terms : FALLBACK_TERMS)

  /** Instalments of one invoice: share × its total, due on its date + the term's days,
   * from the terms frozen on the order (G-08). */
  function sched(d: Deal, i: DealInvoice): Instalment[] {
    const tot = invGross(i)
    return termsOf(d).map((x) => ({ pct: x.pct, amt: r2((tot * x.pct) / 100), due: addDays(i.date, x.days) }))
  }

  /** Confirmed and reported transfers cover instalments in order — invoice by invoice,
   * oldest first. The first instalment they do not cover is the next due. */
  function nextDue(d: Deal): NextDue | null {
    let cov = r2(paidOk(d) + paidSent(d))
    const ordered = d.invs.map((i, n) => ({ i, n })).sort((a, b) => dayNum(a.i.date) - dayNum(b.i.date) || a.n - b.n)
    for (const { i, n } of ordered) {
      for (const s of sched(d, i)) {
        if (cov >= s.amt - 0.01) {
          cov -= s.amt
          continue
        }
        return { amt: r2(s.amt - cov), due: s.due, inv: n }
      }
    }
    return null
  }
  const isOverdue = (d: Deal) => {
    const nd = nextDue(d)
    return !!(nd && daysTo(nd.due) < 0)
  }
  const payIssue = (d: Deal) => {
    const i = d.pays.map((p) => p.st).lastIndexOf("miss")
    return i >= 0 && i === d.pays.length - 1
  }

  /** Accepted value not yet invoiced (before VAT) — what the supplier may still bill. */
  function uninvoicedNet(d: Deal): number {
    return Math.max(0, r2(gotValue(d) - invoicedNet(d)))
  }
  /** The receipts no invoice names yet. */
  const uninvoicedReceipts = (d: Deal): DealReceipt[] => {
    const named = new Set(d.invs.flatMap((i) => i.grns || []))
    return receipts(d).filter((r) => !named.has(r.grn))
  }
  /** Accepted value of one receipt, before VAT. A lump-sum order has none until it is complete. */
  function receiptNet(d: Deal, r: DealReceipt): number {
    if (!d.po || isLump(d.po)) return 0
    return r2(d.po.lines.reduce((s, l) => s + (r.got[l.it] != null ? r.got[l.it] : r.items[l.it] || 0) * (l.price as number), 0))
  }

  // ---- Lateness (G-05) ---------------------------------------------------------------

  /** What is left after the committed date is late, unless a delivery was reported on or
   * before it: then the clock stops until the contractor's receipt carries the real date. */
  const isLate = (d: Deal): boolean =>
    !!(
      d.po &&
      d.po.acc &&
      !d.closed &&
      unsentValue(d) > 0 &&
      daysTo(d.po.acc.date) < 0 &&
      !waiting(d).some((s) => daysTo(s.date, (d.po as DealPo).acc!.date) <= 0)
    )
  const shipOnTime = (d: Deal, s: { date: string }) => !d.po || !d.po.acc || daysTo(d.po.acc.date, s.date) >= 0

  // ---- Stage and states --------------------------------------------------------------

  function stage(d: Deal): Stage {
    if (d.closed) return "done"
    if (!d.offer) return "new"
    if (!d.po) return "offered"
    if (!d.po.acc || !allGot(d)) return "deliver"
    return "collect"
  }

  function offerSt(d: Deal): OfferState {
    if (!d.offer) return null
    if (d.closed && d.closed.k === "declined") return "declinedPo"
    if (d.po || d.offer.status === "won") return "won"
    return d.offer.status
  }
  function offerSeg(d: Deal): OfferSeg | null {
    const s = offerSt(d)
    for (const k of Object.keys(OFFER_SEG) as OfferSeg[]) if ((OFFER_SEG[k] as readonly string[]).includes(s as string)) return k
    return null
  }
  /** The date of the last thing that happened to the quote. */
  function offAt(d: Deal): string {
    const o = d.offer as DealOffer
    const s = offerSt(d)
    if (s === "reduce") return (o.reduce as NonNullable<DealOffer["reduce"]>).at
    if (s === "sample") return (o.sample as NonNullable<DealOffer["sample"]>).at
    if (s === "sampleSent") return (o.sample as NonNullable<DealOffer["sample"]>).sentAt || (o.sample as NonNullable<DealOffer["sample"]>).at
    if (s === "won") return o.wonAt || (curV(d) as QuoteVersion).at
    if (d.closed) return d.closed.at
    return (curV(d) as QuoteVersion).at
  }
  function offDue(d: Deal): string | null {
    const o = d.offer
    const s = offerSt(d)
    if (!o) return null
    return s === "reduce" ? (o.reduce as NonNullable<DealOffer["reduce"]>).by : s === "sample" ? (o.sample as NonNullable<DealOffer["sample"]>).by : null
  }

  function poSt(d: Deal): PoState {
    if (!d.po) return null
    if (d.closed && d.closed.k === "declined") return "declined"
    if (!d.po.acc) return "new"
    if (waiting(d).length) return "wait"
    if (!allGot(d)) return "supply"
    return "done"
  }

  /** The invoice side of a deal: nothing to bill · something to bill · awaiting payment ·
   * a transfer to confirm · paid. */
  function invSt(d: Deal): InvState {
    if (!d.po || !d.po.acc || (d.closed && d.closed.k === "declined")) return null
    if (canInvoice(d)) return "toinv"
    if (!d.invs.length) return null
    if (owed(d) <= 0.01) return "paid"
    if (paidSent(d) > 0) return "sent"
    return "due"
  }
  /** Something received and not billed yet — one invoice per receipt, so a pending report
   * for the rest of the order does not hold it back (decision 1). */
  const canInvoice = (d: Deal) => !!d.po && !!d.po.acc && !(d.closed && d.closed.k === "declined") && uninvoicedNet(d) > 0.009

  /** Confirmed transfers cover invoices oldest first; reported ones are shown apart. */
  function invAlloc(d: Deal): InvoiceAlloc[] {
    let ok = paidOk(d)
    let sent = paidSent(d)
    return d.invs
      .map((i, n) => ({ i, n }))
      .sort((a, b) => dayNum(a.i.date) - dayNum(b.i.date) || a.n - b.n)
      .map(({ i, n }) => {
        const gross = invGross(i)
        const paid = Math.min(gross, ok)
        ok = r2(ok - paid)
        const left = r2(gross - paid)
        const reported = Math.min(left, sent)
        sent = r2(sent - reported)
        return { n, inv: i, gross, paid, left, reported, st: left <= 0.01 ? ("paid" as const) : reported > 0 ? ("sent" as const) : ("due" as const) }
      })
  }

  const isFullyPaid = (d: Deal) => !!d.po && allGot(d) && d.invs.length > 0 && uninvoicedNet(d) <= 0.009 && owed(d) <= 0.01

  return {
    daysTo,
    addDays,
    curV,
    offerTotal,
    isLump,
    lineSt,
    allGot,
    sumLines,
    poValue,
    canValue,
    gotValue,
    unsentValue,
    deliveredPct,
    receipts,
    waiting,
    invGross,
    uninvoicedGross,
    vatRate,
    invoices,
    invoicedNet,
    paidOk,
    paidSent,
    grossTotal,
    owed,
    termsOf,
    sched,
    nextDue,
    isOverdue,
    payIssue,
    uninvoicedNet,
    uninvoicedReceipts,
    receiptNet,
    canInvoice,
    isFullyPaid,
    invAlloc,
    isLate,
    shipOnTime,
    stage,
    offerSt,
    offerSeg,
    offAt,
    offDue,
    poSt,
    invSt,
  }
}

export type DealLogic = ReturnType<typeof createDealLogic>
