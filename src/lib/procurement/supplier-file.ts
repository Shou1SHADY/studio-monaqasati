// The supplier as Procurement keeps him (PRD 3.0 §7.2 Suppliers) — pure.
//
// Two files describe one supplier and they must never be merged by spreading:
// the supplier's PLATFORM profile (`users/{id}` — written by him: coverage,
// specialties, certificates, bio) and OUR record of him
// (`supplierRecords/{orgId}__{supplierOrgId}` — written by us: the VAT number
// and CR expiry we checked, the payment terms Finance reads, the lead time we
// see, and whether our manager verified him). Where both carry a fact, ours
// wins, because ours is the one somebody in this company vouched for.
//
// `verified: false` is a state, not a missing field: a supplier a buyer added
// from the platform directory waits for the manager, and no order is approved
// for him meanwhile. A record with no `verified` field is a legacy supplier and
// blocks nothing.
//
// Everything else here — performance, response rate, ratings, the directory's
// filters, the invitation links — is derived on read from the orders, RFQs and
// offers we already hold.

import { foldSearchText, matchesSearch } from "../search-text"
import { daysBetween, dayOf, poFacts, type RfqInviteFacts } from "./po"
import { materialKey, type PriceHistoryEntry } from "./prices"
import type { ProcActor, PurchaseOrder, PoRating, ReceiptFact, SupplierFacts } from "./types"

export const SUPPLIER_RECORDS = "supplierRecords"

export const supplierRecordId = (orgId: string, supplierOrgId: string): string => `${orgId}__${supplierOrgId}`

export const SUPPLIER_KINDS = ["mat", "svc", "sub"] as const
export type SupplierKind = (typeof SUPPLIER_KINDS)[number]

export const SUPPLIER_ORIGINS = ["local", "international"] as const
export type SupplierOrigin = (typeof SUPPLIER_ORIGINS)[number]
export type OriginFilter = "" | SupplierOrigin

export const SUPPLIER_SOURCES = ["directory", "invite", "guest_link", "link"] as const
export type SupplierSource = (typeof SUPPLIER_SOURCES)[number]

export const SUPPLIER_LOG_ACTIONS = ["added", "verified", "record_updated", "favourite_on", "favourite_off"] as const
export type SupplierLogAction = (typeof SUPPLIER_LOG_ACTIONS)[number]

/** «أُضيف إلى المفضّلين / أُزيل من المفضّلين» — a line in the record's log, with who and when. */
export const favouriteLogEntry = (actor: Pick<ProcActor, "uid" | "name">, on: boolean, at: string): SupplierLogEntry => ({
  action: on ? "favourite_on" : "favourite_off",
  at,
  byId: actor.uid,
  byName: actor.name,
})

/** A supplier we keep a file on who has no account on the platform: requests and orders reach him by link. */
export const isOffPlatform = (s: { memberIds: string[]; record: Pick<SupplierRecord, "source"> | null }): boolean =>
  s.memberIds.length === 0 || s.record?.source === "guest_link"

export interface SupplierLogEntry {
  action: SupplierLogAction
  at: string
  byId: string
  byName: string
  params?: Record<string, string | number> | null
}

export interface SupplierRecord {
  id: string
  organizationId: string
  supplierOrgId: string
  supplierName: string
  kind?: SupplierKind | null
  /** Our own call on where he is based; absent means "read it from his phone number". */
  origin?: SupplierOrigin | null
  source?: SupplierSource | null
  vatNumber?: string | null
  /** `YYYY-MM-DD`. */
  crExpiry?: string | null
  /** 0 = cash in advance. */
  paymentTermsDays?: number | null
  leadTimeDays?: number | null
  verified?: boolean | null
  verifiedById?: string | null
  verifiedByName?: string | null
  verifiedAt?: string | null
  addedById?: string | null
  addedByName?: string | null
  addedAt?: string | null
  log?: SupplierLogEntry[]
}

/** The payment terms the form offers, in days; 0 is cash in advance. */
export const PAYMENT_TERM_DAYS = [0, 15, 30, 45, 60, 90] as const

/** Inside this many days of its expiry, the CR is worth a word on the list. */
export const CR_WARN_DAYS = 60

const text = (s: string | null | undefined): string => (s || "").trim()

/** The VAT number we go by: ours when we recorded one, else the supplier's own. */
export const effectiveVat = (record: Pick<SupplierRecord, "vatNumber"> | null | undefined, profileVat: string | null | undefined): string =>
  text(record?.vatNumber) || text(profileVat)

export const effectiveCrExpiry = (record: Pick<SupplierRecord, "crExpiry"> | null | undefined, profileCr: string | null | undefined): string | null =>
  dayOf(text(record?.crExpiry)) || dayOf(text(profileCr)) || null

export const isUnverified = (record: Pick<SupplierRecord, "verified"> | null | undefined): boolean => record?.verified === false

export const isProcManager = (actor: Pick<ProcActor, "isOwner" | "canApprove">): boolean => Boolean(actor.isOwner || actor.canApprove)

/** What an approval reads, with our record laid over the profile's facts. */
export function supplierFactsWithRecord(facts: SupplierFacts, record: SupplierRecord | null | undefined): SupplierFacts {
  if (!record) return facts
  const vat = text(record.vatNumber)
  return {
    orgId: facts.orgId,
    hasVatNumber: vat ? true : facts.hasVatNumber,
    verified: record.verified == null ? facts.verified : record.verified,
    crExpiry: dayOf(text(record.crExpiry)) || facts.crExpiry,
  }
}

export type DocsState = "cr_expired" | "no_vat" | "cr_ending" | "ok"

export interface DocsFacts {
  state: DocsState
  crExpiry: string | null
  /** Days to the CR's expiry, negative once it passed; null when not recorded. */
  crDays: number | null
}

/** The list's status column — the first thing that stops an order wins. */
export function supplierDocs(vat: string | null | undefined, crExpiry: string | null | undefined, today: string): DocsFacts {
  const cr = dayOf(text(crExpiry)) || null
  const crDays = cr ? daysBetween(today, cr) : null
  const state: DocsState = crDays != null && crDays < 0 ? "cr_expired" : !text(vat) ? "no_vat" : crDays != null && crDays <= CR_WARN_DAYS ? "cr_ending" : "ok"
  return { state, crExpiry: cr, crDays }
}

export type VerifyRefusal = "no_permission" | "no_vat" | "not_pending"

/** The manager verifies, and only a supplier whose VAT number is on file. */
export function verifyRefusal(actor: Pick<ProcActor, "isOwner" | "canApprove">, record: Pick<SupplierRecord, "verified"> | null | undefined, vat: string | null | undefined, ownerHasTeam = false): VerifyRefusal | null {
  if (!isProcManager(actor) || (actor.isOwner && ownerHasTeam)) return "no_permission"
  if (!isUnverified(record)) return "not_pending"
  if (!text(vat)) return "no_vat"
  return null
}

// ---------------------------------------------------------------------------
// The record form
// ---------------------------------------------------------------------------

export interface RecordInput {
  vatNumber: string
  crExpiry: string
  paymentTermsDays: number | string | null
  leadTimeDays: number | string | null
  kind: SupplierKind
  /** "auto" clears our call and lets the phone number decide. */
  origin?: SupplierOrigin | "auto"
}

export type RecordError = "vat_format" | "cr_format" | "terms_invalid" | "lead_invalid" | "kind_invalid" | "origin_invalid"

/** A number written with a country code other than Saudi Arabia's, in either the + or the 00 spelling. */
export function phoneIsInternational(phone: string | null | undefined): boolean {
  const raw = text(phone).replace(/[\s().-]/g, "")
  const e164 = raw.startsWith("00") ? `+${raw.slice(2)}` : raw
  return /^\+\d{6,}$/.test(e164) && !e164.startsWith("+966")
}

/** Where he is based: our own call when we made one, else what his phone number says. */
export function isInternationalSupplier(s: { phone?: string | null; record?: Pick<SupplierRecord, "origin"> | null }): boolean {
  return s.record?.origin ? s.record.origin === "international" : phoneIsInternational(s.phone)
}

/** A Saudi VAT number: fifteen digits, starting and ending with 3. */
export const VAT_PATTERN = /^3\d{13}3$/

export function recordErrors(input: RecordInput): RecordError[] {
  const out: RecordError[] = []
  const vat = text(input.vatNumber).replace(/\s/g, "")
  if (vat && !VAT_PATTERN.test(vat)) out.push("vat_format")
  const cr = text(input.crExpiry)
  if (cr && !/^\d{4}-\d{2}-\d{2}$/.test(cr)) out.push("cr_format")
  const terms = input.paymentTermsDays === "" || input.paymentTermsDays == null ? 0 : Number(input.paymentTermsDays)
  if (!Number.isInteger(terms) || terms < 0 || terms > 365) out.push("terms_invalid")
  const lead = input.leadTimeDays === "" || input.leadTimeDays == null ? null : Number(input.leadTimeDays)
  if (lead != null && (!Number.isInteger(lead) || lead < 0 || lead > 365)) out.push("lead_invalid")
  if (!SUPPLIER_KINDS.includes(input.kind)) out.push("kind_invalid")
  if (input.origin !== undefined && input.origin !== "auto" && !SUPPLIER_ORIGINS.includes(input.origin)) out.push("origin_invalid")
  return out
}

/** The fields a save writes, cleaned. */
export function recordFields(input: RecordInput): Pick<SupplierRecord, "vatNumber" | "crExpiry" | "paymentTermsDays" | "leadTimeDays" | "kind" | "origin"> {
  const lead = input.leadTimeDays === "" || input.leadTimeDays == null ? null : Number(input.leadTimeDays)
  return {
    vatNumber: text(input.vatNumber).replace(/\s/g, "") || null,
    crExpiry: text(input.crExpiry) || null,
    paymentTermsDays: input.paymentTermsDays === "" || input.paymentTermsDays == null ? 0 : Number(input.paymentTermsDays),
    leadTimeDays: lead,
    kind: input.kind,
    origin: input.origin && input.origin !== "auto" ? input.origin : null,
  }
}

// ---------------------------------------------------------------------------
// His record with us
// ---------------------------------------------------------------------------

export interface RfqLike {
  id: string
  status?: string | null
  allowedSupplierOrgIds?: string[] | null
  invitedSupplierOrgIds?: string[] | null
}

export interface OfferLikeForInvite {
  rfqId?: string | null
  organizationId?: string | null
  supplierId?: string | null
}

/** RFQs that named him (private recipients or invitees) and how many he answered.
 * A draft invited nobody yet. */
export function rfqInviteFacts(supplierOrgId: string, memberIds: readonly string[], rfqs: RfqLike[], offers: OfferLikeForInvite[]): RfqInviteFacts {
  const ids = new Set([supplierOrgId, ...memberIds])
  const answered = new Set(offers.filter((o) => o.rfqId && ((o.organizationId && ids.has(o.organizationId)) || (o.supplierId && ids.has(o.supplierId)))).map((o) => o.rfqId as string))
  let invited = 0
  let responded = 0
  for (const r of rfqs) {
    if (r.status === "Draft") continue
    const named = [...(r.allowedSupplierOrgIds || []), ...(r.invitedSupplierOrgIds || [])].some((id) => ids.has(id))
    if (!named) continue
    invited++
    if (answered.has(r.id)) responded++
  }
  return { invited, responded }
}

const newest = (a: PurchaseOrder, b: PurchaseOrder) => (b.createdAt || "").localeCompare(a.createdAt || "") || b.docNumber.localeCompare(a.docNumber)

export function ordersOfSupplier(orders: PurchaseOrder[], supplierOrgId: string): PurchaseOrder[] {
  return orders.filter((o) => o.supplierOrgId === supplierOrgId).sort(newest)
}

export const SUPPLIER_FILE_ORDERS = 6

export interface OurRating {
  po: PurchaseOrder
  rating: PoRating
}

/** Our ratings of him, one per completed order, newest first. */
export function ourRatings(orders: PurchaseOrder[], supplierOrgId: string): OurRating[] {
  return orders
    .filter((o) => o.supplierOrgId === supplierOrgId && o.rating)
    .map((po) => ({ po, rating: po.rating as PoRating }))
    .sort((a, b) => (b.rating.at || "").localeCompare(a.rating.at || ""))
}

/** Average of the stars, one decimal; null without reviews. */
export function starAverage(ratings: number[]): { avg: number; n: number } | null {
  const ok = ratings.filter((r) => Number.isFinite(r) && r > 0)
  if (!ok.length) return null
  return { avg: Math.round((ok.reduce((s, r) => s + r, 0) / ok.length) * 10) / 10, n: ok.length }
}

/** A bar's width: at least a sliver when there is a value, nothing without one. */
export const barWidth = (v: number | null | undefined): number => (v == null ? 0 : Math.max(4, Math.min(100, v)))

// ---------------------------------------------------------------------------
// Agreements and orders
// ---------------------------------------------------------------------------

export function agreementOrderCounts(orders: PurchaseOrder[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const o of orders) if (o.agreementId) out.set(o.agreementId, (out.get(o.agreementId) || 0) + 1)
  return out
}

export function ordersOnAgreement(orders: PurchaseOrder[], agreementId: string): PurchaseOrder[] {
  return orders.filter((o) => o.agreementId === agreementId).sort(newest)
}

// ---------------------------------------------------------------------------
// A material
// ---------------------------------------------------------------------------

export const MATERIAL_PURCHASES = 10

/** The last purchases of a material, newest first. */
export function materialPurchases(history: PriceHistoryEntry[], key: string, limit = MATERIAL_PURCHASES): PriceHistoryEntry[] {
  return history
    .filter((h) => h.materialKey === key)
    .sort((a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id))
    .slice(0, limit)
}

const lineKeyed = (po: PurchaseOrder, key: string) => po.lines.some((l) => materialKey(l.name, l.unit) === key)

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/**
 * How long this material usually takes to arrive: the median of the days from
 * the order leaving us to its last receipt, over the orders that carried it and
 * were received. Without one received, the median of what the offers promised;
 * without that, nothing — a guessed lead time would move somebody's dates.
 */
export function usualLeadDays(orders: PurchaseOrder[], receipts: ReceiptFact[], key: string): number | null {
  const mine = orders.filter((o) => o.status !== "cancelled" && lineKeyed(o, key))
  const actual: number[] = []
  for (const po of mine) {
    const start = dayOf(po.sentAt || po.approvedAt || null)
    const last = poFacts(po, receipts).lastReceiptDay
    if (start && last) actual.push(Math.max(0, daysBetween(start, last)))
  }
  if (actual.length) return median(actual)
  return median(mine.map((o) => Number(o.leadTimeDays)).filter((n) => Number.isFinite(n) && n > 0))
}

/** The category of the last order that bought this material, when it named one. */
export function materialCategory(orders: PurchaseOrder[], key: string): string | null {
  const found = orders.filter((o) => o.category && lineKeyed(o, key)).sort(newest)[0]
  return found?.category || null
}

/** Materials Manufacturing also makes — the ones its make-or-buy decision reads. */
export function makeOrBuyKeys(productNames: Array<string | null | undefined>): Set<string> {
  return new Set(productNames.map((n) => foldSearchText(n)).filter(Boolean))
}

export const readByManufacturing = (keys: Set<string>, name: string): boolean => keys.has(foldSearchText(name))

// ---------------------------------------------------------------------------
// The platform directory
// ---------------------------------------------------------------------------

export interface DirectoryEntry {
  orgId: string
  name: string
  city: string | null
  categories: string[]
  international?: boolean
}

export interface DirectoryFilter {
  q: string
  category: string
  city: string
  origin?: OriginFilter
}

export function filterDirectory<T extends DirectoryEntry>(entries: T[], f: DirectoryFilter, label: (category: string) => string = (c) => c): T[] {
  return entries.filter(
    (e) =>
      (!f.category || e.categories.includes(f.category)) &&
      (!f.city || e.city === f.city) &&
      (!f.origin || (f.origin === "international") === Boolean(e.international)) &&
      matchesSearch(f.q, [e.name, e.city, ...e.categories, ...e.categories.map(label)])
  )
}

/** Each option's count over the whole directory, as the prototype's selects show. */
export function directoryCounts(entries: DirectoryEntry[]): { categories: Array<[string, number]>; cities: Array<[string, number]> } {
  const cats = new Map<string, number>()
  const cities = new Map<string, number>()
  for (const e of entries) {
    for (const c of new Set(e.categories)) cats.set(c, (cats.get(c) || 0) + 1)
    if (e.city) cities.set(e.city, (cities.get(e.city) || 0) + 1)
  }
  const sorted = (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return { categories: sorted(cats), cities: sorted(cities) }
}

export const directoryFiltered = (f: DirectoryFilter): boolean => Boolean(f.q.trim() || f.category || f.city || f.origin)

// ---------------------------------------------------------------------------
// Invitations — the system does not message; it opens the sender's own tool
// ---------------------------------------------------------------------------

export const INVITE_CHANNELS = ["wa", "email"] as const
export type InviteChannel = (typeof INVITE_CHANNELS)[number]

export const inviteJoinUrl = (origin: string, token: string): string => `${origin.replace(/\/$/, "")}/register?invite=${token}`

/** A Saudi mobile in the form wa.me takes: `0501234567` → `966501234567`. */
export function waPhone(raw: string | null | undefined): string {
  let d = (raw || "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\D/g, "")
  if (d.startsWith("00")) d = d.slice(2)
  if (d.startsWith("966")) return d
  if (d.startsWith("0")) return `966${d.slice(1)}`
  if (d.length === 9 && d.startsWith("5")) return `966${d}`
  return d
}

export const waLink = (phone: string, message: string): string => `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(message)}`

export const mailtoLink = (email: string, subject: string, body: string): string =>
  `mailto:${encodeURIComponent(text(email))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

export interface InviteInput {
  companyName: string
  phone: string
  email: string
  channel: InviteChannel
}

export type InviteError = "name_missing" | "phone_missing" | "email_missing" | "email_invalid" | "phone_invalid"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The channel the invitation goes by decides which contact is required. */
export function inviteErrors(input: InviteInput): InviteError[] {
  const out: InviteError[] = []
  if (!text(input.companyName)) out.push("name_missing")
  const phone = text(input.phone)
  const email = text(input.email)
  if (input.channel === "wa" && !phone) out.push("phone_missing")
  if (input.channel === "email" && !email) out.push("email_missing")
  if (email && !EMAIL.test(email)) out.push("email_invalid")
  if (phone && waPhone(phone).length < 9) out.push("phone_invalid")
  return out
}

/** The invitation's own words: the sender's note, then the fixed sentence with the link. */
export const inviteMessage = (note: string | null | undefined, sentence: string): string => (text(note) ? `${text(note)}\n\n${sentence}` : sentence)


// ---------------------------------------------------------------------------
// The tab's segments — the two price segments are for those who see prices
// ---------------------------------------------------------------------------

export const SUPPLIER_SEGMENTS = ["mine", "platform", "agreements", "history"] as const
export type SupplierTabSegment = (typeof SUPPLIER_SEGMENTS)[number]

export const PRICE_SEGMENTS: readonly SupplierTabSegment[] = ["agreements", "history"]

export const visibleSupplierSegments = (seesPrices: boolean): SupplierTabSegment[] => SUPPLIER_SEGMENTS.filter((s) => seesPrices || !PRICE_SEGMENTS.includes(s))

/** `?segment=` as asked, unless it names a price segment this viewer may not see. */
export function segmentFromParam(param: string | null | undefined, seesPrices: boolean): SupplierTabSegment {
  const asked = SUPPLIER_SEGMENTS.find((s) => s === param)
  return asked && visibleSupplierSegments(seesPrices).includes(asked) ? asked : "mine"
}

// ---------------------------------------------------------------------------
// Who manages the supplier file (the prototype's `CAN('sup') && !CAN('ro')`)
// ---------------------------------------------------------------------------
//
// The procurement manager (po.approve) and the buyer (offers.accept) add,
// invite and favour suppliers; the expediter reads; the owner of a company
// with a procurement team reads too (he approves what is routed to him). A
// one-person company's owner does everything himself.

type ActorRoles = Pick<ProcActor, "isOwner" | "canApprove" | "canPrepare">

export const ownerReadsOnly = (actor: Pick<ProcActor, "isOwner">, ownerHasTeam: boolean): boolean => actor.isOwner && ownerHasTeam

export const canManageSuppliers = (actor: ActorRoles, ownerHasTeam: boolean): boolean =>
  !ownerReadsOnly(actor, ownerHasTeam) && Boolean(actor.isOwner || actor.canApprove || actor.canPrepare)

/** Verify and edit the master record: the manager only (`CAN('all') && !ro`). */
export const canVouchSuppliers = (actor: Pick<ProcActor, "isOwner" | "canApprove">, ownerHasTeam: boolean): boolean => !ownerReadsOnly(actor, ownerHasTeam) && isProcManager(actor)

/** Renew or end a price agreement: the manager only; signing a new one is the buyer's too. */
export const canRenewAgreements = canVouchSuppliers

export const canSignAgreements = canManageSuppliers

// ---------------------------------------------------------------------------
// A buyer's suppliers (the prototype's `supScope`)
// ---------------------------------------------------------------------------

/** The top-level category a specialty belongs to — a buyer's categories are top-level. */
export function categoryRoot(category: string, tree: Record<string, readonly string[]>): string {
  if (tree[category]) return category
  for (const [root, subs] of Object.entries(tree)) if (subs.includes(category)) return root
  return category
}

/** A buyer sees the MATERIAL suppliers of his categories, and every service
 * company and subcontractor. No categories on his record = all of them. */
export function supplierInScope(
  supplier: { categories: string[]; record?: Pick<SupplierRecord, "kind"> | null },
  categories: string[] | null | undefined,
  tree: Record<string, readonly string[]> = {}
): boolean {
  if (!categories || !categories.length) return true
  if ((supplier.record?.kind || "mat") !== "mat") return true
  return supplier.categories.some((c) => categories.includes(categoryRoot(c, tree)))
}

// ---------------------------------------------------------------------------
// Sourcing from an unverified supplier (prototype `wAll` 2083, `canOrder` 1820)
// ---------------------------------------------------------------------------

export type SourcingBlock = "unverified" | "no_vat" | "cr_expired"

/** Why this supplier may not be sent a private RFQ or be awarded one: a
 * supplier added and not yet vouched for, one with no VAT number (Finance will
 * not take his invoice), one whose CR has lapsed. Null = he may. */
export function supplierSourcingBlock(record: Pick<SupplierRecord, "verified" | "vatNumber" | "crExpiry"> | null | undefined, profile: { vat?: string | null; crExpiry?: string | null } | null | undefined, today: string): SourcingBlock | null {
  if (isUnverified(record)) return "unverified"
  if (!effectiveVat(record, profile?.vat)) return "no_vat"
  const cr = effectiveCrExpiry(record, profile?.crExpiry)
  if (cr && cr < today) return "cr_expired"
  return null
}

// ---------------------------------------------------------------------------
// A supplier who joined through our invitation
// ---------------------------------------------------------------------------

/** The record the invitation's acceptance writes (server-side): he is ours
 * and UNVERIFIED — VAT and terms to be completed, and no order is approved
 * for him until the manager vouches for him (prototype 2016-2019). An
 * existing record is never overwritten. */
export function invitedSupplierRecord(input: {
  organizationId: string
  supplierOrgId: string
  supplierName: string
  vat: string | null
  invitedById: string | null
  invitedByName: string | null
  at: string
  /** A guest registered from his offer («سجّله مورداً»): what the buyer recorded of him — the record is tagged «سُجّل من رابط زوار». */
  guest?: { vatNumber?: string | null; crExpiry?: string | null; paymentTermsDays?: number | null } | null
}): Omit<SupplierRecord, "id"> {
  const by = { byId: input.invitedById || "", byName: input.invitedByName || "" }
  const source = input.guest ? "guest_link" : "invite"
  return {
    organizationId: input.organizationId,
    supplierOrgId: input.supplierOrgId,
    supplierName: input.supplierName,
    kind: "mat",
    source,
    vatNumber: text(input.guest?.vatNumber) || text(input.vat) || null,
    crExpiry: input.guest?.crExpiry || null,
    paymentTermsDays: input.guest?.paymentTermsDays ?? 30,
    leadTimeDays: null,
    verified: false,
    addedById: input.invitedById,
    addedByName: input.invitedByName,
    addedAt: input.at,
    log: [{ action: "added", at: input.at, ...by, params: { source } }],
  }
}

/** Orders still live with him: approved and not yet sent, sent, accepted, arriving. */
export const OPEN_WITH_SUPPLIER: ReadonlySet<string> = new Set(["approved", "sent", "accepted", "in_delivery", "part_received"])

// ---------------------------------------------------------------------------
// A direct order's supplier list (prototype `supOpts`)
// ---------------------------------------------------------------------------

export interface DirectSupplierOption {
  key: string
  orgId: string | null
  userId: string | null
  name: string
  crExpired: boolean
  unverified: boolean
  /** On the platform, not yet in our records or orders — «— من المنصة». */
  platform?: boolean
}

/** Material suppliers only (a service company or a subcontractor is not a
 * material's source); those whose orders show they supply none of the lines'
 * categories are left out — one we know nothing about stays in; a lapsed CR
 * and an unvouched supplier are flagged, not hidden (the approval stops them). */
export function directSupplierOptions(input: {
  records: Array<Pick<SupplierRecord, "supplierOrgId" | "supplierName"> & { kind?: string | null; crExpiry?: string | null; verified?: boolean | null }>
  orders: PurchaseOrder[]
  keyOf: (po: PurchaseOrder) => string
  categories: string[]
  today: string
  /** Platform suppliers already matched to the lines' categories (`publicReach`) — the
   * supplier file beyond our own, so an order never names a company typed by hand. */
  platform?: Array<{ orgId: string; memberIds?: string[]; name: string; profileCrExpiry?: string | null }>
}): DirectSupplierOption[] {
  const known = new Map<string, Set<string>>()
  for (const o of input.orders) {
    if (!o.category) continue
    const k = input.keyOf(o)
    known.set(k, (known.get(k) || new Set()).add(o.category))
  }
  const fits = (key: string) => {
    const cats = known.get(key)
    return !input.categories.length || !cats || input.categories.some((c) => cats.has(c))
  }
  const out = new Map<string, DirectSupplierOption>()
  const skip = new Set<string>()
  for (const r of input.records) {
    if ((r.kind || "mat") !== "mat") {
      skip.add(r.supplierOrgId)
      continue
    }
    const cr = dayOf(text(r.crExpiry)) || null
    out.set(r.supplierOrgId, { key: r.supplierOrgId, orgId: r.supplierOrgId, userId: r.supplierOrgId, name: r.supplierName, crExpired: Boolean(cr && cr < input.today), unverified: r.verified === false })
  }
  for (const o of input.orders) {
    const key = input.keyOf(o)
    if (out.has(key) || skip.has(key)) continue
    out.set(key, { key, orgId: o.isGuestSupplier ? null : o.supplierOrgId, userId: o.supplierUserId, name: o.supplierName, crExpired: false, unverified: false })
  }
  const ours = Array.from(out.values())
    .filter((s) => fits(s.key))
    .sort((a, b) => a.name.localeCompare(b.name))
  const taken = new Set([...Array.from(out.keys()), ...Array.from(skip)])
  const platform = (input.platform || [])
    .filter((p) => !taken.has(p.orgId) && !(p.memberIds || []).some((m) => taken.has(m)))
    .map((p): DirectSupplierOption => {
      const cr = dayOf(text(p.profileCrExpiry)) || null
      return { key: p.orgId, orgId: p.orgId, userId: p.orgId, name: p.name, crExpired: Boolean(cr && cr < input.today), unverified: false, platform: true }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...ours, ...platform]
}
