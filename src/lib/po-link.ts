// The order link (`/po/<token>`), Procurement 2.0 WP-S4-08: what an off-platform supplier is shown of ONE purchase order and
// what he may do with it, by the order's state (G-17). Shared by the page and the routes, so the screen offers exactly what the
// server allows. Pure: no I/O, the clock is passed in.

import { riyadhDay } from "@/lib/hr/format"
import { addDays, poStatus } from "@/lib/procurement/po"
import { pendingVersion } from "@/lib/procurement/po-state"
import { supplierCanNotify } from "@/lib/procurement/supplier"
import type { ThreadItem } from "@/lib/procurement/po-messages"
import type { PoLine, PoSite, PoVersionKind, PurchaseOrder } from "@/lib/procurement/types"

export type PoLinkState = "awaiting" | "declined" | "accepted" | "complete" | "cancelled"

/** The state the link page shows; null while the order has not been sent (there is no link to open yet). */
export function poLinkState(po: Pick<PurchaseOrder, "status" | "supplierDecline" | "lines">): PoLinkState | null {
  if (po.status === "cancelled") return "cancelled"
  if (po.status === "closed") return "complete"
  if (po.status === "sent") return po.supplierDecline ? "declined" : "awaiting"
  if (po.status === "accepted") return poStatus(po as PurchaseOrder) === "received" ? "complete" : "accepted"
  return null
}

export interface PoLinkActs {
  accept: boolean
  requestChange: boolean
  decline: boolean
  report: boolean
  reply: boolean
  acceptVersion: boolean
}

const NONE: PoLinkActs = { accept: false, requestChange: false, decline: false, report: false, reply: false, acceptVersion: false }

/** G-17: acceptance and the change request and the decline exist only before he accepts; the delivery report only after, and only
 * while something is still owed; a cancelled order is read-only; a completed one takes nothing but a word. */
export function poLinkActs(po: PurchaseOrder): PoLinkActs {
  const state = poLinkState(po)
  if (!state || state === "cancelled") return NONE
  return {
    accept: state === "awaiting",
    requestChange: state === "awaiting",
    decline: state === "awaiting",
    report: state === "accepted" && supplierCanNotify(po),
    reply: true,
    acceptVersion: pendingVersion(po) != null,
  }
}

/** «يصل في»: today, tomorrow, the day after — the only days a report can name. */
export const POL_REPORT_OFFSETS = [0, 1, 2] as const
export type PoReportOffset = (typeof POL_REPORT_OFFSETS)[number]
export const reportDayFor = (offset: PoReportOffset, now: Date): string => addDays(riyadhDay(now), offset)
export const reportDayValid = (day: string, now: Date): boolean => POL_REPORT_OFFSETS.some((o) => reportDayFor(o, now) === day)

export const POL_DECLINE_REASONS = ["stock", "price", "date", "other"] as const
export type PoDeclineReason = (typeof POL_DECLINE_REASONS)[number]

/** The reasons in the words the buyer reads (the supplier's screen carries them in his own language). */
export const POL_DECLINE_TEXT: Record<"ar" | "en", Record<PoDeclineReason, string>> = {
  ar: { stock: "لا تتوفر الكمية", price: "تغيّر السعر", date: "لا أستطيع الموعد", other: "سبب آخر" },
  en: { stock: "Quantity not available", price: "The price changed", date: "Cannot meet the date", other: "Other" },
}

export const POL_CHANGE_LABEL: Record<"ar" | "en", string> = { ar: "طلب تعديل", en: "Change requested" }

export interface PoLinkLine {
  id: string
  name: string
  /** Net of what was cancelled. */
  quantity: number
  unit: string
  /** Exclusive of VAT; null on a lump-sum order. */
  price: number | null
  pk: number | null
  need: number | null
  base: string | null
  packName: { ar: string; en: string } | null
  cancelled: number
}

export interface PoLinkNotice {
  id: string
  seq: number
  date: string
  note: string | null
  /** What the receiver counted, once he did. */
  count: { accepted: number; rejected: number } | null
}

export interface PoLinkTotal {
  kind: "incl" | "nvat" | "lump"
  /** What the supplier reads: with VAT, without it, or the lump sum. */
  amount: number
  exVat: number
}

export interface PoLinkView {
  no: string
  company: string
  supplierName: string
  state: PoLinkState
  ver: number
  acts: PoLinkActs
  site: Pick<PoSite, "name" | "city" | "district" | "address" | "mapUrl"> | null
  access: PoSite["access"] | null
  needBy: string | null
  dueDate: string | null
  promisedDate: string | null
  acceptBy: string | null
  terms: string | null
  lines: PoLinkLine[]
  total: PoLinkTotal
  receiver: { name: string; phone: string | null } | null
  notices: PoLinkNotice[]
  pendingVersion: { n: number; kind: PoVersionKind; note: string | null; date: string | null } | null
  cancel: { at: string; why: string } | null
  decline: { at: string; reason: PoDeclineReason; note: string | null } | null
  payment: { state: string; day: string | null } | null
  thread: ThreadItem[]
  unread: number
}

/** `PO-2026/014` → `2026/014`: the supplier reads «أمر 2026/014», never the buyer's code. */
export function bareOrderNo(n: string | null | undefined): string {
  const s = (n || "").trim()
  const m = /(\d{4}\/\d+)\s*$/.exec(s)
  return m ? m[1] : s.replace(/^[A-Za-z؀-ۿ.]+-?/, "")
}

export const lineView = (l: PoLine): PoLinkLine => ({
  id: l.id,
  name: l.name,
  quantity: Math.max(0, (Number(l.quantity) || 0) - (Number(l.cancelled) || 0)),
  unit: l.unit,
  price: l.unitPrice == null ? null : Number(l.unitPrice),
  pk: Number(l.pk) > 0 ? Number(l.pk) : null,
  need: Number(l.need) > 0 ? Number(l.need) : null,
  base: l.base || null,
  packName: l.packName || null,
  cancelled: Number(l.cancelled) || 0,
})
