// The orders screen's own derivations — pure, over the domain in
// `src/lib/procurement/po.ts`. The list's segments and counts, the "honest
// date" a row shows (a promise only once the supplier made one), the line
// bar's partition of the ordered quantity, the ready message for WhatsApp
// and e-mail, and the print models. Nothing here reads the clock on its own:
// every function that needs it takes `now`.

import {
  acceptedValue,
  canCancelRemainder,
  canRate,
  daysLate,
  dayOf,
  isLumpSum,
  isReceived,
  lineOutstanding,
  lineToArrive,
  poCommitment,
  poLate,
  poLive,
  poOpenValue,
  poStatus,
  poValue,
  receiptDay,
  receiptsOf,
  round2,
} from "@/lib/procurement/po"
import type { PoLine, PoStatus, ProcActor, PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"
import { matchesSearch } from "@/lib/search-text"

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export const PO_SEGMENTS = ["awaiting_approval", "live", "late", "received", "all"] as const
export type PoSegment = (typeof PO_SEGMENTS)[number]
export const DEFAULT_SEGMENT: PoSegment = "live"

export const isPoSegment = (v: string | null | undefined): v is PoSegment => PO_SEGMENTS.includes(v as PoSegment)

const DONE: ReadonlySet<PoStatus> = new Set(["received", "closed", "cancelled"])

/** Does this order sit in the segment? "Late" is a subset of "live". */
export function inSegment(po: PurchaseOrder, segment: PoSegment, now: Date): boolean {
  switch (segment) {
    case "all":
      return true
    case "awaiting_approval":
      return po.status === "awaiting_approval"
    case "live":
      return poLive(po)
    case "late":
      return poLate(po, now)
    case "received":
      return DONE.has(poStatus(po))
  }
}

export function segmentCounts(orders: PurchaseOrder[], now: Date): Record<PoSegment, number> {
  const out = { awaiting_approval: 0, live: 0, late: 0, received: 0, all: 0 }
  for (const po of orders) for (const s of PO_SEGMENTS) if (inSegment(po, s, now)) out[s]++
  return out
}

/** The search fields a row answers to: number (both scripts), supplier, title, project, line names. */
export function poSearchFields(po: PurchaseOrder, displayNumber: string): Array<string | null | undefined> {
  return [po.docNumber, displayNumber, po.supplierName, po.rfqTitle, po.projectName, ...po.lines.map((l) => l.name)]
}

/** Supplier date ascending, undated last; then newest first. */
export function sortOrders(orders: PurchaseOrder[]): PurchaseOrder[] {
  return [...orders].sort((a, b) => {
    const da = a.promisedDate || "9999-99-99"
    const db = b.promisedDate || "9999-99-99"
    if (da !== db) return da < db ? -1 : 1
    return (b.createdAt || "") < (a.createdAt || "") ? -1 : 1
  })
}

/** The rows a segment shows. A search spans every segment — whoever arrives
 * with a number from a notification does not know which segment it sits in. */
export function visibleOrders(orders: PurchaseOrder[], segment: PoSegment, search: string, now: Date, displayNumber: (n: string) => string): PurchaseOrder[] {
  const searching = search.trim().length > 0
  return sortOrders(orders.filter((po) => (searching ? matchesSearch(search, poSearchFields(po, displayNumber(po.docNumber))) : inSegment(po, segment, now))))
}

// ---------------------------------------------------------------------------
// The honest date
// ---------------------------------------------------------------------------

export type HonestDate =
  | { kind: "with_approver"; approver: "manager" | "owner" }
  | { kind: "not_sent" }
  | { kind: "no_acceptance" }
  | { kind: "no_date" }
  | { kind: "promised"; date: string; daysLate: number }
  | { kind: "closed"; date: string | null }
  | { kind: "cancelled" }

/** What the "date" column may honestly say: a promise once the supplier made
 * one, otherwise WHY there is none — never a wish dressed as a date. */
export function honestDate(po: PurchaseOrder, now: Date): HonestDate {
  switch (po.status) {
    case "awaiting_approval":
      return { kind: "with_approver", approver: po.approverKind }
    case "approved":
      return { kind: "not_sent" }
    case "sent":
      return { kind: "no_acceptance" }
    case "accepted":
      return po.promisedDate ? { kind: "promised", date: po.promisedDate, daysLate: daysLate(po, now) } : { kind: "no_date" }
    case "closed":
      return { kind: "closed", date: dayOf(po.closedAt) || null }
    case "cancelled":
      return { kind: "cancelled" }
  }
}

// ---------------------------------------------------------------------------
// Lines — the bar partitions the ordered quantity exactly
// ---------------------------------------------------------------------------

export interface LineParts {
  ordered: number
  accepted: number
  held: number
  /** Rejected and not yet decided — still inside what the supplier owes. */
  rejected: number
  cancelled: number
  toArrive: number
}

/** accepted + held + rejected(undecided) + cancelled + toArrive = ordered. A
 * decided reject has moved: `reduce` into cancelled, `discount` into accepted,
 * `replace` back into what is to arrive. */
export function lineParts(l: PoLine): LineParts {
  const rejected = l.rejectDecision ? 0 : Math.max(0, Number(l.rejected) || 0)
  const toArrive = Math.max(0, round2(lineToArrive(l) - rejected))
  return {
    ordered: Math.max(0, Number(l.quantity) || 0),
    accepted: Math.max(0, Number(l.accepted) || 0),
    held: Math.max(0, Number(l.held) || 0),
    rejected,
    cancelled: Math.max(0, Number(l.cancelled) || 0),
    toArrive,
  }
}

export const percentOf = (part: number, whole: number): number => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0)

// ---------------------------------------------------------------------------
// Money — masked for whoever may not see it
// ---------------------------------------------------------------------------

export interface MoneyTrail {
  exVat: number
  vat: number
  commitment: number
  /** null = unknown until the lump sum is complete. */
  accepted: number | null
  open: number
  lumpSum: boolean
}

export function moneyTrail(po: PurchaseOrder): MoneyTrail {
  const exVat = poValue(po)
  return {
    exVat,
    vat: round2(exVat * (Number(po.vatRate) || 0)),
    commitment: poCommitment(po),
    accepted: acceptedValue(po),
    open: poOpenValue(po),
    lumpSum: isLumpSum(po),
  }
}

/** "12,500" — grouped Latin digits, at most two decimals; the caller adds the currency. */
export function figure(n: number | null | undefined): string {
  return (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString("en-US", { maximumFractionDigits: 2 })
}

/** An amount: whole riyals bare ("36,200"), otherwise both halala digits
 * ("2,392.50", never "2,392.5"). Quantities keep `figure`. */
export function moneyFigure(n: number | null | undefined): string {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0
  const whole = Math.round(v * 100) % 100 === 0
  return v.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
}

/** "12,500 ر.س" / "SAR 12,500" — plain text for print, messages and CSV (no glyph). */
export function sarPlain(n: number | null | undefined, locale: string): string {
  return locale === "ar" ? `${moneyFigure(n)} ر.س` : `SAR ${moneyFigure(n)}`
}

export function quantityText(q: number, unit: string): string {
  return unit ? `${figure(q)} ${unit}` : figure(q)
}

// ---------------------------------------------------------------------------
// What may happen — the drawer asks these, the writes ask the same predicates
// ---------------------------------------------------------------------------

export const actorCanExpedite = (a: ProcActor) => a.isOwner || a.canExpedite || a.canPrepare || a.canApprove
export const actorCanDecideLines = (a: ProcActor) => a.isOwner || a.canPrepare || a.canApprove
export const actorCanReturn = (a: ProcActor) => a.isOwner || a.canApprove
/** The write lets any preparer resubmit; the drawer shows the button to the
 * one who prepared it (and the owner), as the returned note is addressed to him. */
export const actorCanResubmit = (po: PurchaseOrder, a: ProcActor) => a.isOwner || (a.canPrepare && po.preparedById === a.uid)
export const actorCanRate = (a: ProcActor) => a.isOwner || a.canPrepare

export interface LineActions {
  cancelRemainder: boolean
  decideReject: boolean
}

export function lineActions(po: PurchaseOrder, l: PoLine, actor: ProcActor): LineActions {
  const decides = actorCanDecideLines(actor)
  return {
    cancelRemainder: decides && canCancelRemainder(po) && lineToArrive(l) > 0,
    decideReject: decides && po.status === "accepted" && (Number(l.rejected) || 0) > 0 && !l.rejectDecision,
  }
}

/** The whole order may still be cancelled: nothing received or held, not closed. */
export function canCancelOrder(po: PurchaseOrder, actor: ProcActor): boolean {
  if (!actorCanDecideLines(actor)) return false
  if (po.status === "cancelled" || po.status === "closed") return false
  return !po.lines.some((l) => (Number(l.accepted) || 0) > 0 || (Number(l.held) || 0) > 0)
}

export function canCloseComplete(po: PurchaseOrder, actor: ProcActor): boolean {
  return actorCanDecideLines(actor) && po.status === "accepted" && isReceived(po)
}

export function canCloseShort(po: PurchaseOrder, actor: ProcActor): boolean {
  return actorCanDecideLines(actor) && po.status === "accepted" && !isReceived(po)
}

export function canRateNow(po: PurchaseOrder, receipts: ReceiptFact[], actor: ProcActor): boolean {
  return actorCanRate(actor) && canRate(po, receipts)
}

/** Lines still owed, as "name qty unit" — what the statement calls outstanding. */
export function outstandingLines(po: PurchaseOrder): Array<{ name: string; quantity: number; unit: string }> {
  return po.lines.filter((l) => lineOutstanding(l) > 0).map((l) => ({ name: l.name, quantity: lineOutstanding(l), unit: l.unit }))
}

// ---------------------------------------------------------------------------
// The ready message (PRD §10.7): the system opens it, the buyer sends it
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  locale: "ar" | "en"
  number: string
  orgName: string
  /** Value INCLUDING VAT; null when the sender may not see prices. */
  commitment: number | null
  lines: Array<{ name: string; quantity: number; unit: string }>
  /** The supplier's portal link, when he is registered. */
  portalUrl?: string | null
  note?: string | null
}

const AR = {
  order: (n: string, org: string) => `أمر شراء ${n} من ${org}`,
  value: (v: string) => ` بقيمة ${v} شاملاً الضريبة`,
  lines: "البنود:",
  link: (u: string) => `نسخة الأمر في بوابتك: ${u}`,
  ask: "نرجو تأكيد القبول وموعد التوريد.",
}
const EN = {
  order: (n: string, org: string) => `Purchase order ${n} from ${org}`,
  value: (v: string) => ` — ${v} incl. VAT`,
  lines: "Lines:",
  link: (u: string) => `The order in your portal: ${u}`,
  ask: "Please confirm acceptance and the delivery date.",
}

/** The text WhatsApp or the e-mail opens with — the number, the value when
 * the sender may see it, the lines, and the one thing we ask. */
export function buildSendMessage(input: SendMessageInput): string {
  const c = input.locale === "ar" ? AR : EN
  const parts: string[] = []
  if (input.note?.trim()) parts.push(input.note.trim(), "")
  let head = c.order(input.number, input.orgName)
  if (input.commitment != null) head += c.value(sarPlain(input.commitment, input.locale))
  parts.push(`${head}.`)
  if (input.lines.length) {
    parts.push(c.lines)
    for (const l of input.lines) parts.push(`• ${l.name} — ${quantityText(l.quantity, l.unit)}`)
  }
  if (input.portalUrl) parts.push(c.link(input.portalUrl))
  parts.push(c.ask)
  return parts.join("\n")
}

/** `wa.me` wants digits only, international, no plus; a Saudi 05… becomes 9665…. */
export function whatsappNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (digits.startsWith("00")) return digits.slice(2)
  if (digits.startsWith("05") && digits.length === 10) return `966${digits.slice(1)}`
  if (digits.startsWith("5") && digits.length === 9) return `966${digits}`
  return digits
}

export function whatsappUrl(phone: string, text: string): string {
  const n = whatsappNumber(phone)
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`
}

export function mailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export const isEmail = (s: string) => /.+@.+\..+/.test(s.trim())

// ---------------------------------------------------------------------------
// Print models — everything the paper needs, computed once
// ---------------------------------------------------------------------------

export interface PrintCompany {
  name: string
  cr?: string | null
  vat?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
}

export interface PoPrintLine {
  index: number
  name: string
  unit: string
  quantity: number
  /** null when the printer may not see prices, or the order is a lump sum. */
  unitPrice: number | null
  total: number | null
}

export interface PoPrintModel {
  number: string
  status: PoStatus
  basis: PurchaseOrder["basis"]
  date: string
  company: PrintCompany
  supplierName: string
  projectName: string | null
  title: string
  deliveryLocation: string | null
  paymentTerms: string | null
  promisedDate: string | null
  leadTimeDays: number | null
  lines: PoPrintLine[]
  withPrices: boolean
  lumpSum: boolean
  exVat: number | null
  vat: number | null
  total: number | null
  vatRate: number
  preparedBy: string
  preparedAt: string
  approvedBy: string | null
  approvedAt: string | null
  selfApproved: boolean
}

/** The order as it prints. An expediter's copy carries no value at all. */
export function buildPoPrintModel(po: PurchaseOrder, company: PrintCompany, withPrices: boolean): PoPrintModel {
  const lump = isLumpSum(po)
  const money = moneyTrail(po)
  const lines: PoPrintLine[] = po.lines.map((l, i) => {
    const q = Math.max(0, round2((Number(l.quantity) || 0) - (Number(l.cancelled) || 0)))
    const price = withPrices && !lump && l.unitPrice != null ? Number(l.unitPrice) : null
    return { index: i + 1, name: l.name, unit: l.unit, quantity: q, unitPrice: price, total: price == null ? null : round2(q * price) }
  })
  return {
    number: po.docNumber,
    status: poStatus(po),
    basis: po.basis,
    date: dayOf(po.approvedAt) || dayOf(po.createdAt),
    company,
    supplierName: po.supplierName,
    projectName: po.projectName || null,
    title: po.rfqTitle,
    deliveryLocation: po.deliveryLocation || null,
    paymentTerms: po.paymentTerms || null,
    promisedDate: po.promisedDate || null,
    leadTimeDays: po.leadTimeDays ?? null,
    lines,
    withPrices,
    lumpSum: lump,
    exVat: withPrices ? money.exVat : null,
    vat: withPrices ? money.vat : null,
    total: withPrices ? money.commitment : null,
    vatRate: Number(po.vatRate) || 0,
    preparedBy: po.preparedByName,
    preparedAt: dayOf(po.createdAt),
    approvedBy: po.approvedByName || null,
    approvedAt: dayOf(po.approvedAt) || null,
    selfApproved: Boolean(po.approvedById) && po.approvedById === po.preparedById,
  }
}

export interface StatementLine {
  index: number
  name: string
  unit: string
  ordered: number
  accepted: number
  rejected: number
  held: number
  cancelled: number
  outstanding: number
}

export interface StatementReceipt {
  number: string
  date: string
  accepted: number
  rejected: number
  held: number
  receiver: string | null
}

export interface StatementModel {
  number: string
  supplierName: string
  company: PrintCompany
  projectName: string | null
  deliveryLocation: string | null
  approvedAt: string | null
  promisedDate: string | null
  complete: boolean
  lines: StatementLine[]
  receipts: StatementReceipt[]
  outstanding: Array<{ name: string; quantity: number; unit: string }>
  printedAt: string
}

/** The receipt statement — quantities only, safe for anyone. Receipts oldest first. */
export function buildStatementModel(po: PurchaseOrder, receipts: ReceiptFact[], company: PrintCompany, now: Date): StatementModel {
  const mine = receiptsOf(po, receipts).sort((a, b) => (receiptDay(a) < receiptDay(b) ? -1 : 1))
  const sum = (r: ReceiptFact, k: "accepted" | "rejected" | "held") => round2((r.lines || []).reduce((s, l) => s + (Number(l[k]) || 0), 0))
  return {
    number: po.docNumber,
    supplierName: po.supplierName,
    company,
    projectName: po.projectName || null,
    deliveryLocation: po.deliveryLocation || null,
    approvedAt: dayOf(po.approvedAt) || null,
    promisedDate: po.promisedDate || null,
    complete: isReceived(po) || po.status === "closed",
    lines: po.lines.map((l, i) => ({
      index: i + 1,
      name: l.name,
      unit: l.unit,
      ordered: Number(l.quantity) || 0,
      accepted: Number(l.accepted) || 0,
      rejected: Number(l.rejected) || 0,
      held: Number(l.held) || 0,
      cancelled: Number(l.cancelled) || 0,
      outstanding: lineOutstanding(l),
    })),
    receipts: mine.map((r) => ({
      number: r.docNumber || r.id,
      date: receiptDay(r),
      accepted: sum(r, "accepted"),
      rejected: sum(r, "rejected"),
      held: sum(r, "held"),
      receiver: (r as ReceiptFact & { receivedByName?: string | null }).receivedByName || null,
    })),
    outstanding: outstandingLines(po),
    printedAt: now.toISOString(),
  }
}
