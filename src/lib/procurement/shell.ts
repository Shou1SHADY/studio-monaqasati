// Procurement's shell (PRD 3.0 §7.1) — the tab rail and what gates each tab,
// the adapter from what the hook loads to what the pure layer reads, the two
// dashboard roll-ups, the "arriving this week" panel, and the reports frame
// (which reports a role sees, the period presets, CSV text). No Firestore,
// no React, no sentences: the screens format, the tests read this.

import { PERMISSION_SECTIONS, type PermissionId } from "../permissions"
import { approvalRefusal, daysFromNow, poLate, poStatus, dayOf, lineOutstanding } from "./po"
import type { OfferFact, ProcWorld, RfqFact } from "./today"
import type { ProcurementPolicies, PurchaseOrder, ReceiptFact, SupplierFacts } from "./types"

// ---------------------------------------------------------------------------
// Tabs — real routes, each gated like the sidebar entry it mirrors
// ---------------------------------------------------------------------------

export type ProcTabId = "today" | "rfqs" | "requests" | "orders" | "receipts" | "suppliers" | "reports" | "settings"

export interface ProcTabDef {
  id: ProcTabId
  href: string
  /** In `Portal.Sidebar`. */
  labelKey: string
  /** Shown when the viewer holds ANY of these; the owner passes every check. */
  anyOf: PermissionId[]
}

/** Every permission of the Procurement section — holding any one opens Today. */
export const PROCUREMENT_PERMISSIONS: PermissionId[] = PERMISSION_SECTIONS.find((s) => s.key === "procurement")?.permissions ?? []

/** Who sees a price: the owner, `offers.view`, `offers.accept`, `po.approve` (DESIGN §Permissions). */
export const PRICE_PERMISSIONS: PermissionId[] = ["offers.view", "offers.accept", "po.approve"]

export const PROC_TODAY_HREF = "/contractor/rfqs/today"
export const PROC_ORDERS_HREF = "/contractor/rfqs/orders"
export const PROC_REPORTS_HREF = "/contractor/rfqs/reports"
export const PROC_SETTINGS_HREF = "/contractor/rfqs/settings"

export const PROC_TABS: ProcTabDef[] = [
  { id: "today", href: PROC_TODAY_HREF, labelKey: "contractor_proc_today", anyOf: PROCUREMENT_PERMISSIONS },
  { id: "rfqs", href: "/contractor/rfqs", labelKey: "contractor_rfqs", anyOf: ["rfq.manage"] },
  { id: "requests", href: "/contractor/rfqs/requests", labelKey: "contractor_purchase_requests", anyOf: ["rfq.manage"] },
  { id: "orders", href: PROC_ORDERS_HREF, labelKey: "contractor_purchase_orders", anyOf: ["offers.view", "offers.accept", "po.approve", "po.expedite"] },
  { id: "receipts", href: "/contractor/goods-received", labelKey: "contractor_goods_received", anyOf: ["deliveries.confirm"] },
  { id: "suppliers", href: "/contractor/suppliers", labelKey: "contractor_browse_suppliers", anyOf: ["suppliers.manage"] },
  { id: "reports", href: PROC_REPORTS_HREF, labelKey: "contractor_proc_reports", anyOf: ["offers.view", "offers.accept"] },
  { id: "settings", href: PROC_SETTINGS_HREF, labelKey: "contractor_proc_settings", anyOf: ["po.approve"] },
]

export type Can = (permission: PermissionId) => boolean

/** The tabs this viewer may open, in rail order. `can` already says yes to
 * everything for the org owner (`usePermissions().can`). */
export function visibleProcTabs(can: Can, tabs: ProcTabDef[] = PROC_TABS): ProcTabDef[] {
  return tabs.filter((tab) => tab.anyOf.some((p) => can(p)))
}

/** Longest matching prefix wins: `/rfqs/requests` must not light up `/rfqs`. */
export function activeProcTab<T extends { href: string }>(tabs: T[], pathname: string): T | undefined {
  return tabs
    .filter((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
}

// ---------------------------------------------------------------------------
// The world the hook loads → the world the pure layer reads
// ---------------------------------------------------------------------------

/** What `useProcurementWorld` returns, structurally — the adapter does not
 * import the hook so it stays testable without Firebase. */
export interface LoadedRfq {
  id: string
  status?: string | null
  deadline?: string | null
  title?: string | null
  offersCount?: number | null
  organizationId?: string | null
  projectId?: string | null
  category?: string | null
  createdAt?: unknown
  awardedAt?: string | null
  invitedSupplierOrgIds?: string[] | null
}

export interface LoadedOffer {
  id: string
  rfqId?: string | null
  status?: string | null
  price?: string | number | null
  supplierOrgId?: string | null
  organizationId?: string | null
  offerPdfUrl?: string | null
  poId?: string | null
}

export interface LoadedWorld {
  orders: PurchaseOrder[]
  deliveries: ReceiptFact[]
  rfqs: LoadedRfq[]
  offers: LoadedOffer[]
  policies: ProcurementPolicies
  supplierFacts: Map<string, SupplierFacts> | Record<string, SupplierFacts>
}

const isoOf = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : null
}

export function toProcWorld(w: LoadedWorld): ProcWorld {
  const rfqs: RfqFact[] = w.rfqs.map((r) => ({
    id: r.id,
    status: r.status || "",
    deadline: r.deadline ?? null,
    title: r.title ?? null,
    offersCount: r.offersCount ?? null,
    organizationId: r.organizationId ?? undefined,
    projectId: r.projectId ?? null,
    category: r.category ?? null,
    createdAt: isoOf(r.createdAt),
    awardedAt: r.awardedAt ?? null,
    invitedCount: r.invitedSupplierOrgIds?.length || null,
  }))
  const offers: OfferFact[] = w.offers
    .filter((o) => Boolean(o.rfqId))
    .map((o) => ({ id: o.id, rfqId: o.rfqId as string, status: o.status ?? null, price: o.price ?? null, supplierOrgId: o.supplierOrgId ?? o.organizationId ?? null, offerPdfUrl: o.offerPdfUrl ?? null, poId: o.poId ?? null }))
  return {
    orders: w.orders,
    receipts: w.deliveries,
    rfqs,
    offers,
    policies: w.policies,
    supplierFacts: w.supplierFacts instanceof Map ? Object.fromEntries(w.supplierFacts) : w.supplierFacts,
  }
}

// ---------------------------------------------------------------------------
// The dashboard's two roll-ups — one card each, a count, a door
// ---------------------------------------------------------------------------

export interface QueueViewer {
  uid: string
  isOwner: boolean
}

export interface WorkQueueCounts {
  /** Orders awaiting THIS viewer's approval (limit, own order, retroactive all applied). */
  approve: number
  attention: {
    late: number
    notAccepted: number
    notSent: number
    total: number
  }
}

/** The dashboard card holder is assumed to hold `po.approve` — the page gates
 * the card by permission; this only applies the data conditions. */
export function workQueueCounts(orders: PurchaseOrder[], policies: ProcurementPolicies, viewer: QueueViewer, now: Date): WorkQueueCounts {
  const actor = { uid: viewer.uid, name: "", isOwner: viewer.isOwner, canApprove: true, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
  let approve = 0
  let late = 0
  let notAccepted = 0
  let notSent = 0
  for (const po of orders) {
    const st = poStatus(po)
    if (st === "awaiting_approval") {
      if (!approvalRefusal(po, actor, policies)) approve++
      continue
    }
    if (st === "approved") notSent++
    else if (st === "sent") {
      const sent = daysFromNow(dayOf(po.sentAt), now)
      if (sent != null && -sent >= policies.supplierAcceptanceDays) notAccepted++
    } else if ((st === "in_delivery" || st === "part_received") && poLate(po, now)) late++
  }
  return { approve, attention: { late, notAccepted, notSent, total: late + notAccepted + notSent } }
}

// ---------------------------------------------------------------------------
// Arriving this week — the supplier's notices due inside seven days
// ---------------------------------------------------------------------------

export interface ArrivingRow {
  id: string
  supplierName: string
  number: string
  /** `YYYY-MM-DD` */
  date: string
  /** Days to the date; negative = its date passed with no receipt. */
  inDays: number
  /** "name qty unit · …" from the notice, else from the order's open lines. */
  lines: string
  href: string
}

export const ARRIVING_WINDOW_DAYS = 7

export function arrivingThisWeek(w: ProcWorld, now: Date, receiptHref: (id: string) => string): ArrivingRow[] {
  const orderById = new Map(w.orders.map((o) => [o.id, o]))
  const out: ArrivingRow[] = []
  for (const r of w.receipts) {
    if (r.status !== "pending_confirmation" || !r.deliveryDate) continue
    const d = daysFromNow(r.deliveryDate, now)
    if (d == null || d > ARRIVING_WINDOW_DAYS) continue
    const po = r.poId ? orderById.get(r.poId) : undefined
    const lines = (r.lines || []).length
      ? (r.lines || []).map((l) => `${l.name} ${l.noticeQuantity} ${l.unit}`).join(" · ")
      : po
        ? po.lines.filter((l) => lineOutstanding(l) > 0).map((l) => `${l.name} ${lineOutstanding(l)} ${l.unit}`).join(" · ")
        : ""
    out.push({ id: r.id, supplierName: r.supplierName || po?.supplierName || "", number: r.poNumber || po?.docNumber || "", date: dayOf(r.deliveryDate), inDays: d, lines, href: receiptHref(r.id) })
  }
  return out.sort((a, b) => a.inDays - b.inDays || a.supplierName.localeCompare(b.supplierName))
}

// ---------------------------------------------------------------------------
// Reports frame
// ---------------------------------------------------------------------------

export const REPORT_IDS = ["project", "supplier", "delivery", "drift", "cycle", "exceptions", "commitments"] as const
export type ReportId = (typeof REPORT_IDS)[number]

/** Reports that are money: removed, not masked, for a viewer without prices. */
export const REPORT_NEEDS_PRICE: Record<ReportId, boolean> = {
  project: true,
  supplier: true,
  delivery: false,
  drift: true,
  cycle: false,
  exceptions: false,
  commitments: true,
}

export function visibleReports(seesPrices: boolean): ReportId[] {
  return REPORT_IDS.filter((id) => seesPrices || !REPORT_NEEDS_PRICE[id])
}

/** The report the URL names, when this viewer may see it; else the first he may. */
export function resolveReport(param: string | null | undefined, seesPrices: boolean): ReportId {
  const list = visibleReports(seesPrices)
  return list.includes(param as ReportId) ? (param as ReportId) : list[0]
}

export const PERIOD_PRESETS = ["30", "90", "year", "custom"] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

/** A CSV cell: quoted when it needs to be; numbers as plain digits, never a
 * currency sign (the sheet has no font for it and Excel wants a number). */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return ""
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : ""
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** BOM + CRLF so Excel opens Arabic correctly. */
export function csvText(head: Array<string | number | null>, rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [head, ...rows].map((r) => r.map(csvCell).join(","))
  return `﻿${lines.join("\r\n")}\r\n`
}
