// Admin → Free suppliers: the companies on the FREE journey, apart from the subscribed ones (plan "full").
// Pure maths over a few collection reads the screen makes once — no read per row: the plans, the month's offers, the
// accepted invitations, the claimed guest offers. The counts are the OFFERS' (a company's quotes this month), not
// `supplierQuoteCounts`: that counter is written only while the admin's allowance is on, and no rule lets a client read it.

import type { ListedCompany } from "@/lib/admin-accounts"
import { approvalState, hasApprovalDoc, riyadhMonth, type ApprovalState } from "@/lib/supplier-approval"
import { planOf } from "@/lib/supplier-plan"
import { matchesSearch } from "@/lib/search-text"

type Rec = Record<string, unknown>

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
const DAY = 86_400_000

/** A stored moment as milliseconds: a Firestore Timestamp, an ISO string or a number. */
export function tsMs(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string") {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  const o = v as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
  if (typeof o.toMillis === "function") return o.toMillis()
  if (typeof o.toDate === "function") return o.toDate().getTime()
  const s = typeof o.seconds === "number" ? o.seconds : typeof o._seconds === "number" ? o._seconds : null
  return s == null ? null : s * 1000
}

// ---------------------------------------------------------------------------
// How a company came
// ---------------------------------------------------------------------------

/** `self` — the public free sign-up · `invited` — a contractor invited it · `guest_claim` — it quoted as a guest through a link and registered. */
export const SIGNUP_SOURCES = ["self", "invited", "guest_claim", "unknown"] as const
export type SignupSource = (typeof SIGNUP_SOURCES)[number]

const EXPLICIT: readonly SignupSource[] = ["self", "invited", "guest_claim"]

/** The stored `signupSource`, when it is one of the three the sign-up writes. */
export function explicitSource(v: unknown): SignupSource | null {
  return typeof v === "string" && (EXPLICIT as readonly string[]).includes(v) ? (v as SignupSource) : null
}

export interface SourceContext {
  /** Supplier company ids that accepted a contractor's invitation (`invitations.acceptedSupplierOrgId`). */
  invitedOrgIds: ReadonlySet<string>
  /** Company ids that now own an offer they first made as a guest (`offers.wasGuestOffer`). */
  claimedOrgIds: ReadonlySet<string>
}

/** The stored mark first; else an invitation (on the owner's account or accepted); else a claimed guest offer; else unknown. */
export function deriveSource(input: { orgId: string; owner?: Rec | null; company?: Rec | null }, ctx: SourceContext): SignupSource {
  const stored = explicitSource(input.owner?.signupSource) ?? explicitSource(input.company?.signupSource)
  if (stored) return stored
  const invitedMark = [input.owner?.invitedBy, input.owner?.invitedById, input.company?.invitedBy, input.company?.invitedById].some((v) => str(v) !== "")
  if (invitedMark || ctx.invitedOrgIds.has(input.orgId)) return "invited"
  if (ctx.claimedOrgIds.has(input.orgId)) return "guest_claim"
  return "unknown"
}

export type SourceTone = "ok" | "info" | "warn" | "mute"

/** The label key (under `Portal.Admin.FreeSuppliers`) and tone a source shows with. */
export function describeSource(source: SignupSource): { labelKey: string; tone: SourceTone } {
  switch (source) {
    case "self":
      return { labelKey: "source_self", tone: "ok" }
    case "invited":
      return { labelKey: "source_invited", tone: "info" }
    case "guest_claim":
      return { labelKey: "source_guest_claim", tone: "warn" }
    default:
      return { labelKey: "source_unknown", tone: "mute" }
  }
}

// ---------------------------------------------------------------------------
// The plans, the month, the counts
// ---------------------------------------------------------------------------

/** Company ids on the full plan. No document, or anything but "full", is FREE. */
export function fullOrgIdsOf(plans: ReadonlyArray<{ id: string; supplierPlan?: unknown }> | null | undefined): Set<string> {
  return new Set((plans ?? []).filter((p) => planOf(p) === "full").map((p) => p.id))
}

/** The instant a Riyadh month begins, as the ISO string `offers.createdAt` is compared against. */
export const riyadhMonthStartISO = (month: string): string => new Date(`${month}-01T00:00:00+03:00`).toISOString()

export interface OfferActivity {
  quotes: number
  last: number | null
}

/** Per company: the quotes it made in the Riyadh month and its latest offer activity. A guest's offer belongs to nobody. */
export function offerActivity(offers: readonly Rec[] | null | undefined, month: string): Map<string, OfferActivity> {
  const out = new Map<string, OfferActivity>()
  for (const o of offers ?? []) {
    const org = str(o.organizationId)
    if (!org || o.isGuestOffer === true) continue
    const created = tsMs(o.createdAt)
    if (created == null || riyadhMonth(new Date(created)) !== month) continue
    const seen = Math.max(created, tsMs(o.updatedAt) ?? 0)
    const prev = out.get(org) ?? { quotes: 0, last: null }
    out.set(org, { quotes: prev.quotes + 1, last: prev.last == null ? seen : Math.max(prev.last, seen) })
  }
  return out
}

/** Company ids that appear on an offer that began as a guest's. */
export function claimedOrgIdsOf(offers: readonly Rec[] | null | undefined): Set<string> {
  return new Set((offers ?? []).filter((o) => o.wasGuestOffer === true).map((o) => str(o.organizationId)).filter(Boolean))
}

/** Company ids that accepted a contractor's invitation. */
export function invitedOrgIdsOf(invitations: readonly Rec[] | null | undefined): Set<string> {
  return new Set((invitations ?? []).map((i) => str(i.acceptedSupplierOrgId)).filter(Boolean))
}

/** Orders per supplier company, from the purchase orders addressed to the companies asked about. */
export function orderCounts(orders: readonly Rec[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const o of orders ?? []) {
    const org = str(o.supplierOrgId)
    if (org) out.set(org, (out.get(org) ?? 0) + 1)
  }
  return out
}

/** «used / limit» state of the free plan's allowance; no limit = nothing to compare. */
export function quotaState(used: number, limit: number | null): { used: number; limit: number | null; full: boolean } {
  return { used, limit, full: limit != null && used >= limit }
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

export interface FreeSupplierRow {
  /** The company id. */
  id: string
  /** Where the company's identity is stored: `users/{id}` or `organizations/{id}`. */
  source: ListedCompany["source"]
  ownerUserId: string | null
  /** The company's name. */
  name: string
  /** The owner's own name, when it is not the company's. */
  ownerName: string
  phone: string
  email: string
  city: string
  specializations: string[]
  crNumber: string
  taxNumber: string
  signup: SignupSource
  approval: ApprovalState
  verified: boolean
  verificationRequested: boolean
  hasAllRequiredDocs: boolean
  joinedAt: number | null
  lastActivityAt: number | null
  quotesThisMonth: number
  /** The company's identity document, for the supplier's file. */
  doc: Rec
}

export interface FreeWorld {
  companies: readonly ListedCompany[]
  usersById: ReadonlyMap<string, Rec>
  fullOrgIds: ReadonlySet<string>
  invitedOrgIds: ReadonlySet<string>
  claimedOrgIds: ReadonlySet<string>
  monthOffers: readonly Rec[]
  month: string
}

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [])

/** The companies of the free journey — every supplier company that is not on the full plan. */
export function freeCompanies(companies: readonly ListedCompany[], fullOrgIds: ReadonlySet<string>): ListedCompany[] {
  return companies.filter((c) => !fullOrgIds.has(c.orgId))
}

export function buildFreeSupplierRows(world: FreeWorld): FreeSupplierRow[] {
  const activity = offerActivity(world.monthOffers, world.month)
  const ctx: SourceContext = { invitedOrgIds: world.invitedOrgIds, claimedOrgIds: world.claimedOrgIds }
  return freeCompanies(world.companies, world.fullOrgIds).map((c) => {
    const d = c.doc as Rec
    const owner = (c.ownerUserId ? world.usersById.get(c.ownerUserId) : null) ?? (c.source === "user" ? d : null)
    const company = str(d.companyName) || str(d.name)
    const ownerName = str(owner?.name)
    const act = activity.get(c.orgId)
    const logins = tsMs(owner?.lastLoginAt)
    const last = [act?.last ?? null, logins].filter((x): x is number => x != null)
    const legal = d.legalDocuments
    return {
      id: c.orgId,
      source: c.source,
      ownerUserId: c.ownerUserId,
      name: company,
      ownerName: ownerName && ownerName !== company ? ownerName : "",
      phone: str(d.phone) || str(owner?.phone),
      email: str(d.email) || str(owner?.email),
      city: str(d.city),
      specializations: listOf(d.specializations),
      crNumber: str(d.crNumber),
      taxNumber: str(d.taxNumber),
      signup: deriveSource({ orgId: c.orgId, owner, company: d }, ctx),
      approval: approvalState({ isVerified: d.isVerified, verificationRequested: d.verificationRequested, legalDocuments: legal }),
      verified: d.isVerified === true,
      verificationRequested: d.verificationRequested === true,
      hasAllRequiredDocs: hasApprovalDoc(legal, "cr") && hasApprovalDoc(legal, "vat"),
      joinedAt: [d, owner].reduce<number | null>((found, x) => found ?? tsMs(x?.createdAt) ?? tsMs(x?.signedUpAt) ?? tsMs(x?.joinedAt), null),
      lastActivityAt: last.length ? Math.max(...last) : null,
      quotesThisMonth: act?.quotes ?? 0,
      doc: d,
    }
  })
}

// ---------------------------------------------------------------------------
// KPIs, filters, sort
// ---------------------------------------------------------------------------

export interface FreeKpis {
  total: number
  waiting: number
  joined7: number
  joined30: number
  active: number
}

export function freeKpis(rows: readonly FreeSupplierRow[], now: number): FreeKpis {
  const within = (r: FreeSupplierRow, days: number) => r.joinedAt != null && r.joinedAt >= now - days * DAY && r.joinedAt <= now
  return {
    total: rows.length,
    waiting: rows.filter((r) => r.approval === "pending").length,
    joined7: rows.filter((r) => within(r, 7)).length,
    joined30: rows.filter((r) => within(r, 30)).length,
    active: rows.filter((r) => r.quotesThisMonth > 0).length,
  }
}

export const FREE_FILTERS = ["all", "waiting", "approved", "no_docs", "self", "invited", "guest_claim"] as const
export type FreeFilter = (typeof FREE_FILTERS)[number]

export function inFilter(row: FreeSupplierRow, filter: FreeFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "waiting":
      return row.approval === "pending"
    case "approved":
      return row.approval === "approved"
    case "no_docs":
      return row.approval === "missing"
    default:
      return row.signup === filter
  }
}

export function filterCounts(rows: readonly FreeSupplierRow[]): Record<FreeFilter, number> {
  return Object.fromEntries(FREE_FILTERS.map((f) => [f, rows.filter((r) => inFilter(r, f)).length])) as Record<FreeFilter, number>
}

/** The search looks across the chips: it narrows the chosen segment, and the counts on the chips stay the whole list's. */
export function filterFreeRows(rows: readonly FreeSupplierRow[], opts: { filter: FreeFilter; search: string }): FreeSupplierRow[] {
  return rows.filter((r) => inFilter(r, opts.filter) && matchesSearch(opts.search, [r.name, r.ownerName, r.phone, r.email, r.city, r.crNumber, r.taxNumber, ...r.specializations]))
}

export type FreeSort = "attention" | "newest" | "activity"

const ATTENTION: Record<ApprovalState, number> = { pending: 0, ready: 1, missing: 2, approved: 3 }

export function sortFreeRows(rows: readonly FreeSupplierRow[], sort: FreeSort): FreeSupplierRow[] {
  const newest = (a: FreeSupplierRow, b: FreeSupplierRow) => (b.joinedAt ?? 0) - (a.joinedAt ?? 0)
  const cmp = {
    attention: (a: FreeSupplierRow, b: FreeSupplierRow) => ATTENTION[a.approval] - ATTENTION[b.approval] || newest(a, b),
    newest,
    activity: (a: FreeSupplierRow, b: FreeSupplierRow) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || newest(a, b),
  }[sort]
  return [...rows].sort(cmp)
}

/** An account of a role-"Supplier" list belongs to the subscribed place when its company is on the full plan. */
export function isSubscribedAccount(row: { id: string; organizationId?: string | null }, fullOrgIds: ReadonlySet<string>): boolean {
  return fullOrgIds.has(row.organizationId || row.id)
}
