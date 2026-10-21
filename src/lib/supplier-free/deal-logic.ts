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

import { lineCalc } from "@/lib/procurement/offer-calc"
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
  lost: ["lost", "noaward", "withdrawn", "declinedPo"],
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

/** The facts "paid in full" stands on, as plain values so the server (rating, B-09) asks the same question the screen
 * does: every line arrived or was cancelled, every receipt is named by an invoice, and confirmed transfers cover the
 * invoices' own gross (each with the VAT rate it carried; 15% when it names none). */
export interface PaidFacts {
  lines: { qty: number; got: number; can: number }[]
  receipts: string[]
  invoices: { amt: number; vat?: number | null; grns?: string[] | null }[]
  paidOk: number
}

/** A receipt accepted something — the only kind an invoice can name (one where all was rejected or held has a cap of 0). */
export const receiptAccepts = (r: { got: Record<string, number> }): boolean => Object.values(r.got || {}).some((q) => (Number(q) || 0) > 0)

/** Server-side twin of `receiptAccepts`, over a stored receipt's lines (`accepted`, else counted − rejected − held). */
export const storedReceiptAccepts = (lines: unknown): boolean =>
  (Array.isArray(lines) ? (lines as Record<string, unknown>[]) : []).some((l) => {
    const n = (v: unknown) => Number(v) || 0
    return (l.accepted != null ? n(l.accepted) : n(l.counted ?? l.noticeQuantity) - n(l.rejected) - n(l.held)) > 0
  })

export function paidInFull(x: PaidFacts, vatRate: number = VAT): boolean {
  if (!x.lines.length || !x.invoices.length) return false
  if (!x.lines.every((l) => r2(l.qty - (l.got || 0) - (l.can || 0)) <= 0)) return false
  const named = new Set(x.invoices.flatMap((i) => i.grns || []))
  if (!x.receipts.every((r) => named.has(r))) return false
  const gross = r2(x.invoices.reduce((s, i) => s + r2(i.amt * (1 + (i.vat != null ? i.vat : vatRate))), 0))
  return r2(gross - x.paidOk) <= 0.01
}

export function createDealLogic(today: string, vatRate: number = VAT) {
  const daysTo = (iso: string, from: string = today) => Math.round((dayNum(iso) - dayNum(from)) / MS_DAY)
  const addDays = addDaysTo

  const curV = (d: Deal): QuoteVersion | null => (d.offer ? d.offer.v[d.offer.v.length - 1] : null)

  /** Σ unit price × quantity of the priced items, or the one total. Before VAT. */
  function offerTotal(d: Deal, v: QuoteVersion | null = curV(d)): number {
    if (!v) return 0
    if (d.pricing === "total") return r2(v.total || 0)
    return r2(d.items.reduce((s, i) => s + (v.prices[i.id] != null ? lineCalc(i.qty, v.prices[i.id] as number, v.packs?.[i.id]).totalH / 100 : 0), 0))
  }
  /** The VAT rate a quote version carried (stored with it); one from before the rate was stored reads today's. */
  const quoteVatRate = (d: Deal, v: QuoteVersion | null = curV(d)): number => (v && v.vat != null ? v.vat : vatRate)

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
  /** What is still owed by the supplier: the quantity left less what sits on the contractor's hold (a certificate, a test,
   * the consultant) — he delivered it, so it is not his to deliver and never makes the order late. */
  const owedToDeliver = (d: Deal) =>
    d.po && !isLump(d.po) ? r2(d.po.lines.reduce((s, l) => s + lateShares(l).base * (l.price as number), 0)) : unsentValue(d)
  /** A line's quantity still owed, split by when it falls due: the part due on the committed date, the part the contractor
   * agreed to take back by a later date (replacement), and what is set aside — on hold, or kept at a discount (decision 3). */
  function lateShares(l: PoLineFact): { base: number; replacement: number } {
    const left = lineSt(l).left
    const held = l.held || 0
    const rej = Math.max(0, l.rej || 0)
    const asideDiscount = l.dec === "discount" && l.dst === "wait" ? Math.min(rej, left) : 0
    const replacement = l.dec === "replace" && l.repl ? Math.min(rej, Math.max(0, left - asideDiscount)) : 0
    return { base: Math.max(0, r2(left - held - asideDiscount - replacement)), replacement }
  }
  /** A replacement whose own date has passed and which has not arrived. */
  const replacementLate = (d: Deal) => !!d.po && !isLump(d.po) && d.po.lines.some((l) => lateShares(l).replacement > 0 && l.repl && daysTo(l.repl) < 0)
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

  /** The receipts there is something to bill on: a receipt where everything was rejected or held accepted nothing, and
   * an invoice on it is refused (its cap is 0) — so it never waits for one, nor holds "paid in full" back. */
  const billableReceipts = (d: Deal): DealReceipt[] => receipts(d).filter(receiptAccepts)
  /** The receipts no invoice names yet. */
  const uninvoicedReceipts = (d: Deal): DealReceipt[] => {
    const named = new Set(d.invs.flatMap((i) => i.grns || []))
    return billableReceipts(d).filter((r) => !named.has(r.grn))
  }
  /** Accepted value of one receipt, before VAT. A lump-sum order has none until it is complete. */
  function receiptNet(d: Deal, r: DealReceipt): number {
    if (!d.po || isLump(d.po)) return 0
    if (r.net != null) return r.net
    return r2(d.po.lines.reduce((s, l) => s + (r.got[l.it] != null ? r.got[l.it] : r.items[l.it] || 0) * (l.price as number), 0))
  }
  /** Value of the receipts no invoice names yet (before VAT) — what the supplier may still bill. An invoice below
   * its receipts' value closes them all the same (the shortfall is shown, never billed twice). A lump-sum order
   * bills its total once, when it is complete. */
  function uninvoicedNet(d: Deal): number {
    const open = uninvoicedReceipts(d)
    if (!d.po || !open.length) return 0
    if (isLump(d.po)) return allGot(d) ? Math.max(0, r2(lumpTotal(d) - invoicedNet(d))) : 0
    return r2(open.reduce((s, r) => s + receiptNet(d, r), 0))
  }

  // ---- Lateness (G-05) ---------------------------------------------------------------

  /** What is left after the committed date is late, unless a delivery was reported on or
   * before it: then the clock stops until the contractor's receipt carries the real date. */
  const isLate = (d: Deal): boolean =>
    !!(
      d.po &&
      d.po.acc &&
      !d.closed &&
      ((owedToDeliver(d) > 0 && daysTo(d.po.acc.date) < 0 && !waiting(d).some((s) => daysTo(s.date, (d.po as DealPo).acc!.date) <= 0)) || (unsentValue(d) > 0 && replacementLate(d)))
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
  const canInvoice = (d: Deal) =>
    !!d.po && !!d.po.acc && !(d.closed && d.closed.k === "declined") && uninvoicedReceipts(d).length > 0 && (!isLump(d.po) || allGot(d))

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

  /** Everything arrived, every receipt is on an invoice, and the invoices' own totals (with the VAT each carried) are
   * covered by confirmed transfers. */
  const isFullyPaid = (d: Deal) =>
    !!d.po &&
    paidInFull(
      { lines: d.po.lines.map((l) => ({ qty: l.qty, got: l.got, can: l.can })), receipts: billableReceipts(d).map((r) => r.grn), invoices: d.invs.map((i) => ({ amt: i.amt, vat: i.vat, grns: i.grns })), paidOk: paidOk(d) },
      vatRate
    )

  /** For each transfer, how many days after the instalment it covers it was reported (prototype `payLateness`): the
   * instalments of every invoice, oldest first, are consumed in the order the transfers came; a missing one covers
   * nothing and is never late. */
  function payLateness(d: Deal): number[] {
    const sc = d.invs
      .map((i, n) => ({ i, n }))
      .sort((a, b) => dayNum(a.i.date || "1970-01-01") - dayNum(b.i.date || "1970-01-01") || a.n - b.n)
      .flatMap(({ i }) => sched(d, i))
    let idx = 0
    let rem = sc.length ? sc[0].amt : 0
    return d.pays.map((p) => {
      if (p.st === "miss" || idx >= sc.length) return 0
      const n = daysTo(p.at, sc[idx].due)
      let a = p.amt
      while (a > 0.009 && idx < sc.length) {
        const take = Math.min(a, rem)
        a = r2(a - take)
        rem = r2(rem - take)
        if (rem <= 0.009) {
          idx++
          rem = idx < sc.length ? sc[idx].amt : 0
        }
      }
      return n > 0 ? n : 0
    })
  }

  return {
    daysTo,
    addDays,
    curV,
    offerTotal,
    quoteVatRate,
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
    billableReceipts,
    uninvoicedReceipts,
    receiptNet,
    canInvoice,
    isFullyPaid,
    payLateness,
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
