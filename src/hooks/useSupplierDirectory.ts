"use client"

// The Suppliers tab's two lists, gathered once (PRD 3.0 §7.2): every supplier
// company on the platform — one entry per company, not per logged-in account —
// with its platform profile, its contractor reviews, and, for the ones that are
// ours, our connection and our record of it. The screens derive the rest.
//
// A supplier company can have several accounts (the owner and invited members);
// reviews and links written against any of them count for the company, and the
// owner's own document is the base because it is the one onboarding filled in.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { collection, documentId, getDocs, query, where, type Firestore } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useCompanyNamesForMembers } from "@/hooks/useActiveCompanyName"
import { COMPANY_PUBLIC_FACTS, factsFromProfile, type CompanyPublicFacts } from "@/lib/company-public-facts"
import { useIdentityOverlays } from "@/hooks/useIdentityOverlays"
import { stripIdentityFields } from "@/lib/identity-fields"
import { SUPPLIER_RECORDS, isInternationalSupplier, starAverage, type SupplierRecord } from "@/lib/procurement/supplier-file"
import type { ProcOffer } from "@/hooks/useProcurementWorld"
import { EMPTY_SUPPLIER_FILTER, SUPPLIER_PAGE_SIZE, type SupplierFacets, type SupplierFilter } from "@/lib/procurement/supplier-list"
import type { SupplierCard } from "@/lib/procurement/supplier-stats"
import { isGuestSupplierKey } from "@/lib/procurement/supplier-offplatform"

export interface SupplierCertificate {
  id?: string
  name?: string
  issuer?: string
  expiryDate?: string
  documentUrl?: string
}

/** A previous work the supplier shows on his profile (SP-01): its title, where, and its photos. */
export interface SupplierWork {
  id: string
  title: string
  description: string | null
  images: string[]
}

/** A supporting file the supplier added to his profile (SP-01): a brochure, a certificate scan. */
export interface SupplierProfileFile {
  id: string
  name: string
  url: string
  kind: "image" | "document"
}

const https = (v: unknown): string | null => (typeof v === "string" && /^https:\/\//i.test(v.trim()) ? v.trim() : null)

/** His «سابقة الأعمال» as the profile page stores them (`projects[]`: name, description, images). */
export function worksOf(raw: unknown): SupplierWork[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x, i) => ({
      id: String(x.id ?? i),
      title: String(x.name ?? x.title ?? "").trim(),
      description: typeof x.description === "string" && x.description.trim() ? x.description.trim() : null,
      images: (Array.isArray(x.images) ? x.images : []).map(https).filter((u): u is string => Boolean(u)),
    }))
    .filter((w) => w.title || w.images.length)
}

/** His supporting files (`companyFiles[]`) — only those with an address we can open. */
export function profileFilesOf(raw: unknown): SupplierProfileFile[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x, i) => ({ id: String(x.id ?? i), name: String(x.name ?? "").trim(), url: https(x.url) || "", kind: x.type === "image" ? ("image" as const) : ("document" as const) }))
    .filter((f) => f.url && f.name)
}

interface SupplierUserDoc {
  id: string
  organizationId?: string
  organizationRole?: string
  /** The platform admin's classification: "international" | "local"; absent = read the phone. */
  supplierOrigin?: string | null
  companyName?: string
  name?: string
  city?: string
  location?: string
  coverageCities?: string[]
  specializations?: string[]
  certificates?: SupplierCertificate[]
  projects?: unknown[]
  description?: string
  phone?: string
  email?: string
  createdAt?: unknown
  isVerified?: boolean
  taxNumber?: string | number
  legalDocuments?: { cr?: { expiryDate?: string } }
  nationalAddress?: string
  crNumber?: string | number
  [key: string]: unknown
}

interface ReviewDoc {
  id: string
  revieweeId?: string
  rating?: number
  comment?: string
  createdAt?: unknown
}

interface LinkDoc {
  id: string
  supplierOrgId?: string
  status?: string
  requestedBy?: string
}

export interface PlatformReview {
  id: string
  rating: number
  comment: string | null
  day: string | null
}

export interface PlatformSupplier {
  orgId: string
  memberIds: string[]
  name: string
  city: string | null
  coverageCities: string[]
  categories: string[]
  /** The material tree's sub-categories he chose (PUR-04). */
  subIds: string[]
  certificates: SupplierCertificate[]
  worksCount: number
  bio: string | null
  phone: string | null
  email: string | null
  international: boolean
  since: string | null
  platformVerified: boolean
  /** The number itself, only while the old profile field exists; screens that show it read the identity document (useSupplierVat). */
  profileVat: string | null
  profileHasVat: boolean
  profileCrExpiry: string | null
  reviews: PlatformReview[]
  rating: { avg: number; n: number } | null
  isMine: boolean
  isFavorite: boolean
  isExplicitFavorite: boolean
  linkId: string | null
  linkRequestedBy: string | null
  record: SupplierRecord | null
  /** The national address he wrote in his profile, when he did. */
  address?: string | null
  contactName?: string | null
  crNumber?: string | null
  /** SP-01: the profile's optional slots, readable in the file — previous work with its photos, supporting files, the profile file. */
  works?: SupplierWork[]
  files?: SupplierProfileFile[]
  profileFileUrl?: string | null
}

const asDay = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v.slice(0, 10)
  if (typeof v === "number") return new Date(v).toISOString().slice(0, 10)
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString().slice(0, 10) : null
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : ""
  return s || null
}

const ACCEPTED = "مقبول"

interface Parts {
  users: SupplierUserDoc[]
  reviewDocs: ReviewDoc[]
  linkDocs: LinkDoc[]
  recordDocs: SupplierRecord[]
  factsByOrg: Map<string, CompanyPublicFacts>
  offers: ProcOffer[]
  favoriteIds: string[]
  overlays: Map<string, Record<string, unknown>>
  companyNames: Map<string, string>
}

/** One entry per supplier COMPANY from the accounts, reviews, links and records a screen holds. */
function assembleSuppliers(p: Parts): PlatformSupplier[] {
  const orgOf = new Map<string, string>()
  const byOrg = new Map<string, SupplierUserDoc[]>()
  for (const u of p.users) {
    const org = u.organizationId || u.id
    orgOf.set(u.id, org)
    byOrg.set(org, [...(byOrg.get(org) || []), u])
  }
  const reviewsByOrg = new Map<string, PlatformReview[]>()
  for (const r of p.reviewDocs) {
    if (!r.revieweeId) continue
    const org = orgOf.get(r.revieweeId) || r.revieweeId
    reviewsByOrg.set(org, [...(reviewsByOrg.get(org) || []), { id: r.id, rating: Number(r.rating) || 0, comment: str(r.comment), day: asDay(r.createdAt) }])
  }
  const activeLinks = new Map<string, LinkDoc>()
  for (const l of p.linkDocs) if (l.status === "active" && l.supplierOrgId) activeLinks.set(l.supplierOrgId, l)
  const records = new Map<string, SupplierRecord>()
  for (const r of p.recordDocs) if (r.supplierOrgId) records.set(r.supplierOrgId, r)
  const implicitFav = new Set(p.offers.filter((o) => o.status === ACCEPTED).flatMap((o) => [o.supplierId, o.organizationId]).filter((x): x is string => Boolean(x)))
  const explicitFav = new Set(p.favoriteIds)

  return Array.from(byOrg.entries()).map(([org, members]) => {
    const raw = members.find((m) => !m.organizationRole || m.organizationRole === "owner") || members[0]
    const overlay = p.overlays.get(raw.id)
    const owner = (overlay ? { ...stripIdentityFields(raw), ...overlay } : raw) as SupplierUserDoc
    const pick = <K extends keyof SupplierUserDoc>(k: K): SupplierUserDoc[K] | undefined => owner[k] || members.find((m) => m[k])?.[k]
    const ids = [org, ...members.map((m) => m.id)]
    const link = ids.map((id) => activeLinks.get(id)).find(Boolean) || null
    const reviews = (reviewsByOrg.get(org) || []).sort((a, b) => (b.day || "").localeCompare(a.day || ""))
    const isExplicitFavorite = ids.some((id) => explicitFav.has(id))
    const isFavorite = isExplicitFavorite || ids.some((id) => implicitFav.has(id))
    const record = records.get(org) || null
    const facts = factsFromProfile({ taxNumber: pick("taxNumber"), legalDocuments: owner.legalDocuments }, p.factsByOrg.get(org))
    return {
      orgId: org,
      memberIds: members.map((m) => m.id),
      name: p.companyNames.get(owner.id) || str(owner.companyName) || str(owner.name) || org,
      city: str(pick("city")) || str(pick("location")),
      coverageCities: (pick("coverageCities") as string[] | undefined) || [],
      categories: (pick("specializations") as string[] | undefined) || [],
      subIds: (pick("specialtyIds") as string[] | undefined) || [],
      certificates: (pick("certificates") as SupplierCertificate[] | undefined) || [],
      worksCount: ((pick("projects") as unknown[] | undefined) || []).length,
      bio: str(pick("description")),
      phone: str(pick("phone")),
      email: str(pick("email")),
      international: isInternationalSupplier({ phone: str(pick("phone")), record, platformOrigin: raw.supplierOrigin ?? null }),
      since: asDay(raw.createdAt),
      platformVerified: Boolean(owner.isVerified),
      profileVat: str(facts.vat),
      profileHasVat: facts.hasVat,
      profileCrExpiry: asDay(facts.crExpiry),
      reviews,
      rating: starAverage(reviews.map((r) => r.rating)),
      isMine: Boolean(link) || isFavorite,
      isFavorite,
      isExplicitFavorite,
      linkId: link?.id || null,
      linkRequestedBy: link?.requestedBy || null,
      record,
      address: str(pick("nationalAddress")) || str(pick("location")),
      contactName: str(owner.name),
      crNumber: str(pick("crNumber")),
      works: worksOf(pick("projects")),
      files: profileFilesOf(pick("companyFiles")),
      profileFileUrl: https(pick("companyProfileUrl")) || https(pick("profileFileUrl")),
    }
  })
}

/** The supplier we keep a record of who has no account: the record's own words, keyed by his verified mobile. */
function offPlatformSupplier(record: SupplierRecord): PlatformSupplier {
  const phone = str((record as SupplierRecord & { guestPhone?: unknown }).guestPhone)
  return {
    orgId: record.supplierOrgId,
    memberIds: [],
    name: record.supplierName,
    city: null,
    coverageCities: [],
    categories: [],
    subIds: [],
    certificates: [],
    worksCount: 0,
    bio: null,
    phone,
    email: null,
    international: isInternationalSupplier({ phone, record }),
    since: null,
    platformVerified: false,
    profileVat: null,
    profileHasVat: false,
    profileCrExpiry: null,
    reviews: [],
    rating: null,
    isMine: true,
    isFavorite: false,
    isExplicitFavorite: false,
    linkId: null,
    linkRequestedBy: null,
    record,
  }
}

/** The whole platform in the browser — only for the screens that still need every supplier at hand (an RFQ's recipient picker, a direct order's list). The Suppliers tab uses `useOurSuppliers` and `usePlatformDirectory`. */
export function useSupplierDirectory(orgId: string, favoriteIds: string[], offers: ProcOffer[]) {
  const firestore = useFirestore()

  const usersQ = useMemoFirebase(() => (firestore ? query(collection(firestore, "users"), where("role", "==", "Supplier")) : null), [firestore])
  const linksQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "contractorSupplierLinks"), where("contractorOrgId", "==", orgId)) : null), [firestore, orgId])
  const reviewsQ = useMemoFirebase(() => (firestore ? query(collection(firestore, "reviews"), where("revieweeRole", "==", "Supplier")) : null), [firestore])
  const recordsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, SUPPLIER_RECORDS), where("organizationId", "==", orgId)) : null), [firestore, orgId])

  const { data: userDocs, isLoading: usersLoading } = useCollection<Omit<SupplierUserDoc, "id">>(usersQ)
  const { data: linkDocs, isLoading: linksLoading } = useCollection<Omit<LinkDoc, "id">>(linksQ)
  const { data: reviewDocs } = useCollection<Omit<ReviewDoc, "id">>(reviewsQ)
  const { data: recordDocs } = useCollection<Omit<SupplierRecord, "id">>(recordsQ)
  const factsQ = useMemoFirebase(() => (firestore ? collection(firestore, COMPANY_PUBLIC_FACTS) : null), [firestore])
  const { data: factDocs } = useCollection<CompanyPublicFacts>(factsQ)

  const users = useMemo(() => (userDocs || []) as SupplierUserDoc[], [userDocs])
  const companyNames = useCompanyNamesForMembers(users)
  const overlays = useIdentityOverlays(users)

  const suppliers = useMemo<PlatformSupplier[]>(() => {
    const factsByOrg = new Map<string, CompanyPublicFacts>()
    for (const f of (factDocs || []) as Array<CompanyPublicFacts & { id: string }>) factsByOrg.set(f.id, f)
    return assembleSuppliers({
      users,
      reviewDocs: (reviewDocs || []) as ReviewDoc[],
      linkDocs: (linkDocs || []) as LinkDoc[],
      recordDocs: (recordDocs || []) as SupplierRecord[],
      factsByOrg,
      offers,
      favoriteIds,
      overlays,
      companyNames,
    })
  }, [users, reviewDocs, linkDocs, recordDocs, factDocs, offers, favoriteIds, overlays, companyNames])

  return { suppliers, loading: usersLoading || linksLoading }
}

const IN_LIMIT = 30
function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

interface Accounts {
  users: SupplierUserDoc[]
  reviews: ReviewDoc[]
  facts: Map<string, CompanyPublicFacts>
}

const NO_ACCOUNTS: Accounts = { users: [], reviews: [], facts: new Map() }

async function loadAccounts(firestore: Firestore, ids: string[]): Promise<Accounts> {
  const users = new Map<string, SupplierUserDoc>()
  const add = (d: { id: string; data: () => unknown }) => users.set(d.id, { ...(d.data() as Omit<SupplierUserDoc, "id">), id: d.id })
  for (const group of chunks(ids, IN_LIMIT)) (await getDocs(query(collection(firestore, "users"), where(documentId(), "in", group)))).docs.forEach(add)
  // A name may be a member's id: his company is his organisation's, and the company's other accounts count for it.
  const orgIds = [...new Set([...users.values()].map((u) => u.organizationId || u.id))]
  for (const group of chunks(orgIds.filter((o) => !users.has(o)), IN_LIMIT)) (await getDocs(query(collection(firestore, "users"), where(documentId(), "in", group)))).docs.forEach(add)
  for (const group of chunks(orgIds, IN_LIMIT)) (await getDocs(query(collection(firestore, "users"), where("organizationId", "in", group)))).docs.forEach(add)
  const suppliers = [...users.values()].filter((u) => u.role === "Supplier")
  const reviews: ReviewDoc[] = []
  for (const group of chunks(suppliers.map((u) => u.id), IN_LIMIT)) {
    ;(await getDocs(query(collection(firestore, "reviews"), where("revieweeId", "in", group)))).docs.forEach((d) => reviews.push({ ...(d.data() as Omit<ReviewDoc, "id">), id: d.id }))
  }
  const facts = new Map<string, CompanyPublicFacts>()
  for (const group of chunks(orgIds, IN_LIMIT)) (await getDocs(query(collection(firestore, COMPANY_PUBLIC_FACTS), where(documentId(), "in", group)))).docs.forEach((d) => facts.set(d.id, d.data() as CompanyPublicFacts))
  return { users: suppliers, reviews, facts }
}

/**
 * «مورّدونا» — only the suppliers this company keeps: an active link, a record of his, a favourite, or the supplier of an
 * accepted offer. Their accounts are fetched BY ID (never "every supplier on the platform"), and the supplier we keep a
 * record of who has no account comes from that record alone.
 */
export function useOurSuppliers(orgId: string, favoriteIds: string[], offers: ProcOffer[]) {
  const firestore = useFirestore()
  const linksQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "contractorSupplierLinks"), where("contractorOrgId", "==", orgId)) : null), [firestore, orgId])
  const recordsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, SUPPLIER_RECORDS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: linkDocs, isLoading: linksLoading } = useCollection<Omit<LinkDoc, "id">>(linksQ)
  const { data: recordDocs, isLoading: recordsLoading } = useCollection<Omit<SupplierRecord, "id">>(recordsQ)

  const links = useMemo(() => (linkDocs || []) as LinkDoc[], [linkDocs])
  const records = useMemo(() => (recordDocs || []) as SupplierRecord[], [recordDocs])
  const wanted = useMemo(() => {
    const ids = new Set<string>(favoriteIds)
    for (const l of links) if (l.status === "active" && l.supplierOrgId) ids.add(l.supplierOrgId)
    for (const r of records) if (r.supplierOrgId && !isGuestSupplierKey(r.supplierOrgId)) ids.add(r.supplierOrgId)
    for (const o of offers) if (o.status === ACCEPTED) for (const x of [o.supplierId, o.organizationId]) if (x && x !== "guest") ids.add(x)
    return [...ids].sort()
  }, [links, records, favoriteIds, offers])
  const wantedKey = wanted.join(",")

  const [loaded, setLoaded] = useState<(Accounts & { key: string }) | null>(null)
  useEffect(() => {
    if (!firestore || linksLoading || recordsLoading) return
    let live = true
    if (!wanted.length) {
      setLoaded({ key: wantedKey, ...NO_ACCOUNTS })
      return
    }
    loadAccounts(firestore, wanted)
      .then((r) => live && setLoaded({ key: wantedKey, ...r }))
      .catch(() => live && setLoaded({ key: wantedKey, ...NO_ACCOUNTS }))
    return () => {
      live = false
    }
    // wantedKey is the real dependency — the same ids load the same accounts.
  }, [firestore, wantedKey, linksLoading, recordsLoading])

  const users = useMemo(() => loaded?.users || [], [loaded])
  const companyNames = useCompanyNamesForMembers(users)
  const overlays = useIdentityOverlays(users)

  const suppliers = useMemo<PlatformSupplier[]>(() => {
    const onPlatform = assembleSuppliers({ users, reviewDocs: loaded?.reviews || [], linkDocs: links, recordDocs: records, factsByOrg: loaded?.facts || new Map(), offers, favoriteIds, overlays, companyNames }).filter((s) => s.isMine)
    const known = new Set(onPlatform.map((s) => s.orgId))
    const offPlatform = records.filter((r) => r.supplierOrgId && !known.has(r.supplierOrgId) && (isGuestSupplierKey(r.supplierOrgId) || r.source === "guest_link")).map(offPlatformSupplier)
    return [...onPlatform, ...offPlatform]
  }, [users, loaded, links, records, offers, favoriteIds, overlays, companyNames])

  return { suppliers, loading: linksLoading || recordsLoading || !loaded || loaded.key !== wantedKey }
}

/** One platform supplier's account as he wrote it — fetched when his file is opened from the directory. */
export function usePlatformSupplier(orgId: string | null, favoriteIds: string[], enabled = true) {
  const firestore = useFirestore()
  const [state, setState] = useState<{ orgId: string; supplier: PlatformSupplier | null } | null>(null)
  useEffect(() => {
    if (!firestore || !orgId || !enabled) return
    let live = true
    loadAccounts(firestore, [orgId])
      .then((r) => {
        if (!live) return
        const [supplier] = assembleSuppliers({ users: r.users, reviewDocs: r.reviews, linkDocs: [], recordDocs: [], factsByOrg: r.facts, offers: [], favoriteIds, overlays: new Map(), companyNames: new Map() })
        setState({ orgId, supplier: supplier || null })
      })
      .catch(() => live && setState({ orgId, supplier: null }))
    return () => {
      live = false
    }
  }, [firestore, orgId, enabled])
  return state && state.orgId === orgId ? state.supplier : null
}

async function authed(user: { getIdToken: () => Promise<string> } | null, url: string): Promise<unknown> {
  if (!user) throw new Error("signed_out")
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } })
  if (!res.ok) throw new Error(String(res.status))
  return ((await res.json()) as { data: unknown }).data
}

/** The platform numbers (operations completed, on-time, computed rating) of the named suppliers — read from the daily cards through the server. */
export function usePlatformCards(orgIds: string[], enabled = true): Map<string, SupplierCard> {
  const { user } = useUser()
  const [cards, setCards] = useState<Map<string, SupplierCard>>(new Map())
  const key = [...new Set(orgIds.filter((id) => !isGuestSupplierKey(id)))].sort().join(",")
  useEffect(() => {
    if (!user || !enabled || !key) return
    let live = true
    Promise.all(chunks(key.split(","), 50).map((ids) => authed(user, `/api/procurement/suppliers?ids=${encodeURIComponent(ids.join(","))}`) as Promise<{ cards: SupplierCard[] }>))
      .then((parts) => live && setCards(new Map(parts.flatMap((p) => p.cards).map((c) => [c.orgId, c] as const))))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [user, key, enabled])
  return cards
}

export interface DirectoryRow extends SupplierCard {
  ours: boolean
}

interface DirectoryAnswer {
  rows: DirectoryRow[]
  matched: number
  total: number
  remaining: number
  more: number
  facets: SupplierFacets
}

const NO_FACETS: SupplierFacets = { specialties: [], cities: [] }

/** «دليل موردي المنصة» a page at a time: the filters go to the server, which answers 24 rows, the counts and what is left. */
export function usePlatformDirectory(filter: SupplierFilter, enabled = true) {
  const { user } = useUser()
  const [answer, setAnswer] = useState<DirectoryAnswer | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const ticket = useRef(0)
  const paramsOf = useCallback(
    (offset: number) => {
      const p = new URLSearchParams({ q: filter.q.trim(), specialty: filter.specialty, city: filter.city, status: filter.status, sort: filter.sort, offset: String(offset), limit: String(SUPPLIER_PAGE_SIZE) })
      return `/api/procurement/suppliers?${p.toString()}`
    },
    [filter.q, filter.specialty, filter.city, filter.status, filter.sort]
  )

  useEffect(() => {
    if (!user || !enabled) return
    const mine = ++ticket.current
    setLoading(true)
    const wait = setTimeout(() => {
      authed(user, paramsOf(0))
        .then((d) => {
          if (ticket.current !== mine) return
          setAnswer(d as DirectoryAnswer)
          setFailed(false)
        })
        .catch(() => ticket.current === mine && setFailed(true))
        .finally(() => ticket.current === mine && setLoading(false))
    }, filter.q ? 250 : 0)
    return () => clearTimeout(wait)
  }, [user, enabled, paramsOf, filter.q])

  const loadMore = useCallback(() => {
    if (!user || !answer) return
    const mine = ++ticket.current
    setLoading(true)
    authed(user, paramsOf(answer.rows.length))
      .then((d) => {
        if (ticket.current !== mine) return
        const next = d as DirectoryAnswer
        setAnswer({ ...next, rows: [...answer.rows, ...next.rows] })
      })
      .catch(() => ticket.current === mine && setFailed(true))
      .finally(() => ticket.current === mine && setLoading(false))
  }, [user, answer, paramsOf])

  return { rows: answer?.rows ?? [], matched: answer?.matched ?? 0, total: answer?.total ?? 0, remaining: answer?.remaining ?? 0, more: answer?.more ?? 0, facets: answer?.facets ?? NO_FACETS, loading, failed, loadMore, ready: answer != null }
}

export { EMPTY_SUPPLIER_FILTER }
