// The platform directory, served from the server (SUP-01/02, NFR-03). The Suppliers tab used to read EVERY supplier account
// and EVERY supplier review into the browser and filter there; now the browser asks for a page.
//
// `supplierStats/{orgId}` holds one public card per supplier company — name, city, specialties, what he added to his
// profile, the number of operations he completed on the platform across all buyers, his on-time share and a rating
// computed from his orders. Only this module writes it (Admin SDK; the rules grant clients nothing, so the ruleset does not
// grow). A card is rebuilt at most once a day: the daily job `/api/cron/supplier-stats` does it, and a request that finds
// the cards stale does it inline once (guarded by a short lock on `supplierStats/_meta`, so a burst of requests rebuilds
// once and the rest read what is there).
//
// The directory lists only suppliers the platform verified. A card carries no phone, no e-mail, no tax number — a company's
// own file shows those from its own record of him.

import type { Firestore } from "firebase-admin/firestore"
import { specialtyKeys } from "../materials/subs"
import { serverMaterialTree } from "../materials/tree-server"
import { NO_STATS, SUPPLIER_STATS, SUPPLIER_STATS_META, buildCard, cardToItem, platformStats, statsAreFresh, type SupplierAccountFacts, type SupplierCard } from "./supplier-stats"
import { SUPPLIER_PAGE_SIZE, listSuppliers, supplierFacets, type SupplierFilter } from "./supplier-list"
import { PURCHASE_ORDERS, type PurchaseOrder, type ReceiptFact } from "./types"
import { SUPPLIER_RECORDS, waPhone } from "./supplier-file"

type Rec = Record<string, unknown>
const text = (v: unknown): string | null => {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : ""
  return s || null
}
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [])
const chunks = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
const dayText = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v.slice(0, 10)
  if (typeof v === "number") return new Date(v).toISOString().slice(0, 10)
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString().slice(0, 10) : null
}

const READ_PARALLEL = 5
const WRITE_PARALLEL = 25

/** The lock a rebuild holds so a burst of requests rebuilds once. */
const LOCK_MS = 2 * 60 * 1000

export interface RebuildResult {
  suppliers: number
}

/** Rebuild every supplier company's card from the platform's accounts, orders, receipts and reviews. */
export async function rebuildSupplierStats(db: Firestore, now: Date = new Date()): Promise<RebuildResult> {
  const users: Array<Rec & { id: string }> = (await db.collection("users").where("role", "==", "Supplier").get()).docs.map((d) => ({ ...(d.data() as Rec), id: d.id }))
  const byOrg = new Map<string, Array<Rec & { id: string }>>()
  const orgOf = new Map<string, string>()
  for (const u of users) {
    const org = text(u.organizationId) || u.id
    orgOf.set(u.id, org)
    byOrg.set(org, [...(byOrg.get(org) || []), u])
  }
  const orgIds = [...byOrg.keys()]

  const orders = new Map<string, PurchaseOrder[]>()
  const receipts = new Map<string, ReceiptFact[]>()
  // `in` takes ten values; the groups are read a few at a time so a thousand suppliers do not wait on each other one by one.
  for (const wave of chunks(chunks(orgIds, 10), READ_PARALLEL)) {
    const reads = await Promise.all(
      wave.map(async (group) => ({
        orders: (await db.collection(PURCHASE_ORDERS).where("supplierOrgId", "in", group).get()).docs,
        receipts: (await db.collection("deliveries").where("supplierOrgId", "in", group).get()).docs,
      }))
    )
    for (const read of reads) {
      for (const d of read.orders) {
        const po = { ...(d.data() as Omit<PurchaseOrder, "id">), id: d.id } as PurchaseOrder
        orders.set(po.supplierOrgId, [...(orders.get(po.supplierOrgId) || []), po])
      }
      for (const d of read.receipts) {
        const r = { ...(d.data() as Omit<ReceiptFact, "id">), id: d.id } as ReceiptFact & { supplierOrgId?: string }
        if (r.supplierOrgId) receipts.set(r.supplierOrgId, [...(receipts.get(r.supplierOrgId) || []), r])
      }
    }
  }

  const stars = new Map<string, number[]>()
  for (const d of (await db.collection("reviews").where("revieweeRole", "==", "Supplier").get()).docs) {
    const r = d.data() as Rec
    const org = orgOf.get(String(r.revieweeId)) || String(r.revieweeId)
    const n = Number(r.rating)
    if (Number.isFinite(n) && n > 0) stars.set(org, [...(stars.get(org) || []), n])
  }

  const index = await serverMaterialTree(db)
  const cards: Array<{ org: string; card: SupplierCard }> = []
  for (const [org, members] of byOrg) {
    const owner = members.find((m) => !m.organizationRole || m.organizationRole === "owner") || members[0]
    let base: Rec = owner
    if (org !== owner.id && owner.organizationRole !== "member") {
      const overlay = (await db.collection("organizations").doc(org).get()).data()
      if (overlay) base = { ...owner, ...overlay }
    }
    const pick = (k: string): unknown => base[k] || members.find((m) => m[k])?.[k]
    const account: SupplierAccountFacts = {
      orgId: org,
      name: text(base.companyName) || text(base.name) || org,
      city: text(pick("city")) || text(pick("location")),
      coverageCities: strings(pick("coverageCities")),
      specialties: specialtyKeys(index, strings(pick("specialtyIds")), strings(pick("specializations"))),
      since: dayText(owner.createdAt) || dayText(owner.joinedAt),
      verified: Boolean(base.isVerified ?? owner.isVerified),
      bio: text(pick("description")),
      worksCount: Array.isArray(pick("projects")) ? (pick("projects") as unknown[]).length : 0,
      certificatesCount: Array.isArray(pick("certificates")) ? (pick("certificates") as unknown[]).length : 0,
      hasProfileFile: Boolean(text(pick("companyProfileUrl")) || text(pick("profileFileUrl"))),
    }
    const mine = stars.get(org) || []
    const reviews = { avg: mine.length ? Math.round((mine.reduce((s, x) => s + x, 0) / mine.length) * 10) / 10 : null, count: mine.length }
    const stats = orders.get(org) ? platformStats(orders.get(org) as PurchaseOrder[], receipts.get(org) || [], now) : NO_STATS
    cards.push({ org, card: buildCard(account, stats, reviews, now) })
  }
  for (const wave of chunks(cards, WRITE_PARALLEL)) await Promise.all(wave.map(({ org, card }) => db.collection(SUPPLIER_STATS).doc(org).set(card as unknown as Rec)))
  const written = cards.length
  await db.collection(SUPPLIER_STATS).doc(SUPPLIER_STATS_META).set({ updatedAt: now.toISOString(), suppliers: written, rebuildingUntil: null })
  return { suppliers: written }
}

/** Rebuild when the cards are older than a day — once, even if many requests arrive together. */
export async function ensureSupplierStats(db: Firestore, now: Date = new Date()): Promise<{ rebuilt: boolean }> {
  const metaRef = db.collection(SUPPLIER_STATS).doc(SUPPLIER_STATS_META)
  const meta = (await metaRef.get()).data() as { updatedAt?: string; rebuildingUntil?: string | null } | undefined
  if (statsAreFresh(meta?.updatedAt, now)) return { rebuilt: false }
  if (meta?.rebuildingUntil && Date.parse(meta.rebuildingUntil) > now.getTime()) return { rebuilt: false }
  await metaRef.set({ rebuildingUntil: new Date(now.getTime() + LOCK_MS).toISOString() }, { merge: true })
  try {
    await rebuildSupplierStats(db, now)
  } catch (error) {
    await metaRef.set({ rebuildingUntil: null }, { merge: true })
    throw error
  }
  return { rebuilt: true }
}

export async function readCards(db: Firestore): Promise<SupplierCard[]> {
  const snap = await db.collection(SUPPLIER_STATS).get()
  return snap.docs.filter((d) => d.id !== SUPPLIER_STATS_META).map((d) => d.data() as unknown as SupplierCard)
}

/** The suppliers this company already keeps: an active link, a record of his, or a favourite of the caller's. */
export async function oursOf(db: Firestore, orgId: string, uid: string): Promise<{ ours: Set<string>; preferred: Set<string> }> {
  const ours = new Set<string>()
  const preferred = new Set<string>()
  for (const d of (await db.collection("contractorSupplierLinks").where("contractorOrgId", "==", orgId).get()).docs) {
    const l = d.data() as Rec
    if (l.status === "active" && typeof l.supplierOrgId === "string") ours.add(l.supplierOrgId)
  }
  for (const d of (await db.collection(SUPPLIER_RECORDS).where("organizationId", "==", orgId).get()).docs) {
    const r = d.data() as Rec
    if (typeof r.supplierOrgId === "string") ours.add(r.supplierOrgId)
  }
  const me = (await db.collection("users").doc(uid).get()).data() as Rec | undefined
  for (const id of strings(me?.favoriteSuppliers)) {
    ours.add(id)
    preferred.add(id)
  }
  return { ours, preferred }
}

export interface DirectoryQuery {
  filter: SupplierFilter
  offset: number
  limit: number
}

/** A card as the directory sends it: the public facts and the viewer's own `ours` flag. */
export interface DirectoryRow extends SupplierCard {
  ours: boolean
}

export interface DirectoryPage {
  rows: DirectoryRow[]
  matched: number
  total: number
  remaining: number
  more: number
  facets: ReturnType<typeof supplierFacets>
}

/** The verified suppliers, filtered, sorted and cut — the same pure functions the screen would have run. */
export function directoryPage(cards: SupplierCard[], ours: ReadonlySet<string>, q: DirectoryQuery): DirectoryPage {
  const listed = cards.filter((c) => c.verified)
  const items = listed.map((c) => cardToItem(c, { ours: ours.has(c.orgId) }))
  const byId = new Map(listed.map((c) => [c.orgId, c]))
  const limit = Math.min(48, Math.max(1, q.limit || SUPPLIER_PAGE_SIZE))
  const offset = Math.max(0, q.offset || 0)
  const page = listSuppliers(items, q.filter, "dir", { limit: offset + limit })
  const rows = page.rows.slice(offset).map((i) => ({ ...(byId.get(i.id) as SupplierCard), ours: i.ours }))
  const remaining = Math.max(0, page.matched - offset - rows.length)
  return { rows, matched: page.matched, total: items.length, remaining, more: Math.min(SUPPLIER_PAGE_SIZE, remaining), facets: supplierFacets(items, q.filter, "dir") }
}

/** Platform numbers for named suppliers — any of them, verified or not (a company's own file of him wants "N operations on the platform"). */
export async function cardsFor(db: Firestore, orgIds: string[]): Promise<SupplierCard[]> {
  const out: SupplierCard[] = []
  for (const id of orgIds.slice(0, 50)) {
    const d = (await db.collection(SUPPLIER_STATS).doc(id).get()).data()
    if (d && id !== SUPPLIER_STATS_META) out.push(d as unknown as SupplierCard)
  }
  return out
}

/** Every spelling a Saudi mobile is stored in. */
function phoneVariants(phone: string): string[] {
  const intl = waPhone(phone)
  const national = intl.startsWith("966") ? intl.slice(3) : intl
  return [...new Set([`0${national}`, national, intl, `+${intl}`, `00${intl}`])].filter((v) => v.length >= 9)
}

/** «موجود في المنصة»: the supplier company behind this mobile or e-mail, if there is one — only its id and name. */
export async function findPlatformSupplier(db: Firestore, contact: { phone?: string | null; email?: string | null }): Promise<{ orgId: string; name: string } | null> {
  const found: Array<Rec & { id: string }> = []
  if (contact.email) found.push(...(await db.collection("users").where("email", "==", contact.email.toLowerCase()).get()).docs.map((d) => ({ ...(d.data() as Rec), id: d.id })))
  if (contact.phone) found.push(...(await db.collection("users").where("phone", "in", phoneVariants(contact.phone)).get()).docs.map((d) => ({ ...(d.data() as Rec), id: d.id })))
  const hit = found.find((u) => u.role === "Supplier")
  if (!hit) return null
  const orgId = text(hit.organizationId) || hit.id
  return { orgId, name: text(hit.companyName) || text(hit.name) || orgId }
}
