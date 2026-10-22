// Procurement's shell (PRD 3.0 §7.1) — the tab rail and what gates each tab,
// the adapter from what the hook loads to what the pure layer reads, the two
// dashboard roll-ups, and the reports frame
// (which reports a role sees, the period presets, CSV text). No Firestore,
// no React, no sentences: the screens format, the tests read this.

import { PERMISSION_SECTIONS, type PermissionId } from "../permissions"
import { PROC_MINE_HREF, PROC_TAB_GATES, type ProcTabId } from "./tab-gates"
import { isRequesterOnly } from "./roles-matrix"
import { approvalRefusal, daysFromNow, poLate, poStatus, dayOf, type NoticeFact } from "./po"
import type { OfferFact, ProcWorld, RfqFact } from "./today"
import type { ProcurementPolicies, PurchaseOrder, ReceiptFact, SupplierFacts } from "./types"

// ---------------------------------------------------------------------------
// Tabs — real routes, each gated like the sidebar entry it mirrors
// ---------------------------------------------------------------------------

export type { ProcTabId }

export interface ProcTabDef {
  id: ProcTabId
  href: string
  /** In `Portal.Sidebar`. */
  labelKey: string
  /** The rail's own wording, in `Portal.Shared` (the prototype's tab names). */
  railKey: string
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

// The prototype's rail: Today · incoming requests · RFQs · orders · receipts ·
// suppliers · reports · boundaries. The gates live in `./tab-gates`, which the
// sidebar reads too.
export const PROC_TABS: ProcTabDef[] = [
  { id: "today", href: PROC_TODAY_HREF, labelKey: "contractor_proc_today", railKey: "proc_tab_today", anyOf: PROC_TAB_GATES.today },
  { id: "requests", href: "/contractor/rfqs/requests", labelKey: "contractor_purchase_requests", railKey: "proc_tab_requests", anyOf: PROC_TAB_GATES.requests },
  { id: "rfqs", href: "/contractor/rfqs", labelKey: "contractor_rfqs", railKey: "proc_tab_rfqs", anyOf: PROC_TAB_GATES.rfqs },
  { id: "orders", href: PROC_ORDERS_HREF, labelKey: "contractor_purchase_orders", railKey: "proc_tab_orders", anyOf: PROC_TAB_GATES.orders },
  { id: "receipts", href: "/contractor/goods-received", labelKey: "contractor_goods_received", railKey: "proc_tab_receipts", anyOf: PROC_TAB_GATES.receipts },
  { id: "suppliers", href: "/contractor/suppliers", labelKey: "contractor_browse_suppliers", railKey: "proc_tab_suppliers", anyOf: PROC_TAB_GATES.suppliers },
  { id: "reports", href: PROC_REPORTS_HREF, labelKey: "contractor_proc_reports", railKey: "proc_tab_reports", anyOf: PROC_TAB_GATES.reports },
  { id: "settings", href: PROC_SETTINGS_HREF, labelKey: "contractor_proc_settings", railKey: "proc_tab_settings", anyOf: PROC_TAB_GATES.settings },
]

export type Can = (permission: PermissionId) => boolean

/** The requester's one tab (REQ-01): outside `PROC_TABS`, because the eight pages of the rail are the buyers' and only a member who holds none of Procurement's sees this one. */
export const PROC_MINE_TAB: ProcTabDef = { id: "mine", href: PROC_MINE_HREF, labelKey: "contractor_my_requests", railKey: "proc_tab_mine", anyOf: [] }

/** The tabs this viewer may open, in rail order. `can` already says yes to
 * everything for the org owner (`usePermissions().can`). */
export function visibleProcTabs(can: Can, tabs: ProcTabDef[] = PROC_TABS): ProcTabDef[] {
  const out = tabs.filter((tab) => tab.anyOf.some((p) => can(p)))
  return out.length === 0 && tabs === PROC_TABS && isRequesterOnly(can, false) ? [PROC_MINE_TAB] : out
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
  products?: Array<{ name?: string; quantity?: number | string | null; unit?: string | null; unitOfMeasure?: string | null; category?: string | null }> | null
  deadline?: string | null
  title?: string | null
  offersCount?: number | null
  organizationId?: string | null
  projectId?: string | null
  category?: string | null
  createdAt?: unknown
  awardedAt?: string | null
  invitedSupplierOrgIds?: string[] | null
  createdByUserId?: string | null
  contractorId?: string | null
  pricingMode?: string | null
  shipmentMode?: string | null
  needSources?: unknown
  purchaseSource?: unknown
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
  validUntil?: string | null
  lines?: OfferFact["lines"]
  lump?: OfferFact["lump"]
  totalBatchesPrice?: OfferFact["totalBatchesPrice"]
  vatRegistered?: OfferFact["vatRegistered"]
  vatRate?: OfferFact["vatRate"]
  leadDays?: OfferFact["leadDays"]
  executionDuration?: OfferFact["executionDuration"]
  executionDurationUnit?: OfferFact["executionDurationUnit"]
  skippedItems?: unknown
  withdrawnAt?: unknown
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
    createdByUserId: r.createdByUserId ?? null,
    contractorId: r.contractorId ?? null,
    products: (r.products || []).map((p) => ({ name: p.name, quantity: p.quantity ?? null, unit: p.unit || p.unitOfMeasure || null, unitOfMeasure: p.unitOfMeasure || null, category: p.category ?? null })),
    pricingMode: r.pricingMode ?? null,
    shipmentMode: r.shipmentMode ?? null,
    needSources: r.needSources,
    purchaseSource: r.purchaseSource,
  }))
  const offers: OfferFact[] = w.offers
    .filter((o) => Boolean(o.rfqId))
    .map((o) => ({
      id: o.id,
      rfqId: o.rfqId as string,
      status: o.status ?? null,
      price: o.price ?? null,
      supplierOrgId: o.supplierOrgId ?? o.organizationId ?? null,
      offerPdfUrl: o.offerPdfUrl ?? null,
      poId: o.poId ?? null,
      ...(o.validUntil ? { validUntil: o.validUntil } : {}),
      lines: o.lines,
      lump: o.lump,
      totalBatchesPrice: o.totalBatchesPrice,
      vatRegistered: o.vatRegistered,
      vatRate: o.vatRate,
      leadDays: o.leadDays,
      executionDuration: o.executionDuration,
      executionDurationUnit: o.executionDurationUnit,
      skippedItems: o.skippedItems,
      withdrawnAt: o.withdrawnAt,
    }))
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
export function workQueueCounts(orders: PurchaseOrder[], policies: ProcurementPolicies, viewer: QueueViewer, now: Date, notices?: ReadonlyArray<NoticeFact>): WorkQueueCounts {
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
    } else if ((st === "in_delivery" || st === "part_received") && poLate(po, now, notices)) late++
  }
  return { approve, attention: { late, notAccepted, notSent, total: late + notAccepted + notSent } }
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

// ---------------------------------------------------------------------------
// The rail's counts (the reference prototype's TABS()): what waits on each tab
// ---------------------------------------------------------------------------

export type ProcTabCounts = Partial<Record<ProcTabId, number>>

/** The prototype's TABS(): Today = the decisions; requests = lines still
 * Purchasing's to act on; RFQs = open ones, closed-and-awaiting-award
 * included; orders = approved, sent, in delivery, part received; receipts =
 * the live notices plus the orders due within three days with none. */
export const RECEIPTS_DUE_DAYS = 3

export function procTabCounts(input: {
  tasks: number
  incomingRequests: number
  rfqs: Array<{ status?: string | null; deadline?: string | null }>
  orders: PurchaseOrder[]
  receipts?: ReceiptFact[]
  now: Date
  /** A buyer's RFQs (the prototype's `rfqMine`); absent = every RFQ counts. */
  rfqInScope?: (r: { status?: string | null; deadline?: string | null }) => boolean
}): ProcTabCounts {
  const openRfqs = input.rfqs.filter((r) => r.status === "New" && (!input.rfqInScope || input.rfqInScope(r))).length
  const live = input.orders.filter((o) => ["approved", "sent", "in_delivery", "part_received"].includes(poStatus(o)))
  const notices = (input.receipts || []).filter((r) => r.status === "pending_confirmation")
  const noticed = new Set(notices.map((r) => r.poId).filter(Boolean))
  const due = input.orders.filter((o) => {
    const s = poStatus(o)
    const d = daysFromNow(o.promisedDate, input.now)
    return (s === "in_delivery" || s === "part_received") && !noticed.has(o.id) && d != null && d <= RECEIPTS_DUE_DAYS
  })
  return { today: input.tasks, requests: input.incomingRequests, rfqs: openRfqs, orders: live.length, receipts: notices.length + due.length }
}

/** The viewer's authority, as the head of every page says it (the prototype's ROLES.d). */
export type ProcRole = "owner" | "owner_solo" | "manager" | "buyer" | "expediter" | "receiver"

export function procRole(actor: { isOwner: boolean; canApprove: boolean; canPrepare: boolean; canExpedite: boolean; canReceive: boolean; seesPrices: boolean; canSource?: boolean }, ownerHasTeam: boolean): ProcRole | null {
  if (actor.isOwner) return ownerHasTeam ? "owner" : "owner_solo"
  if (actor.canApprove) return "manager"
  // rfq.manage without offers.accept (the seeded supply-chain group) sources like a buyer.
  if (actor.canPrepare || actor.canSource) return "buyer"
  if (actor.canExpedite && !actor.seesPrices) return "expediter"
  if (actor.canReceive) return "receiver"
  return null
}
