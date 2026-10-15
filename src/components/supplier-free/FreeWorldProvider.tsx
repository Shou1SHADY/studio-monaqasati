"use client"

// The supplier's world, live: one subscription set for the whole free journey, so every page, the sidebar
// badges and the deal drawer read the same deals (G-04). The documents are read as they are stored; the
// deals are derived from them (`lib/supplier-free/derive.ts`).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { collection, doc, deleteField, query, setDoc, updateDoc, where, serverTimestamp, type DocumentData, type Firestore, type UpdateData } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useChunkedDocs } from "@/hooks/useChunkedDocs"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { riyadhDay } from "@/lib/hr/format"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"
import { deriveWorld, type RawWorld } from "@/lib/supplier-free/derive"
import { createWorldLogic, type WorldLogic } from "@/lib/supplier-free/world-logic"
import type { World } from "@/lib/supplier-free/types"

export interface FreeProfile {
  uid: string
  orgId: string
  name: string
  companyName: string
  phone: string
  email: string
  city: string
  specializations: string[]
  coverageCities: string[]
  isVerified: boolean
  raw: Record<string, unknown>
}

interface FreeWorldValue {
  ready: boolean
  today: string
  world: World
  L: WorldLogic
  profile: FreeProfile | null
  pos: PurchaseOrder[]
  refreshInvites: () => Promise<void>
  /** The stored documents behind a deal — what a write needs. */
  rawRfq: (rfqId: string) => (Record<string, unknown> & { id: string }) | null
  rawOffer: (rfqId: string) => (Record<string, unknown> & { id: string }) | null
  poOf: (rfqId: string) => PurchaseOrder | null
  archive: (rfqIds: readonly string[], on: boolean) => Promise<void>
  markSeen: (dealId: string) => void
}

const EMPTY_WORLD: World = { deals: [], contractors: {}, invites: [], requests: [], arch: {}, seen: {} }
const Ctx = createContext<FreeWorldValue | null>(null)

export const SUPPLIER_WORKSPACE = "supplierWorkspace"

/** Today in Riyadh, rolled over at midnight without a reload. */
function useToday(): string {
  const [today, setToday] = useState(() => riyadhDay())
  useEffect(() => {
    const id = setInterval(() => setToday((t) => (riyadhDay() !== t ? riyadhDay() : t)), 60_000)
    return () => clearInterval(id)
  }, [])
  return today
}

export function FreeWorldProvider({ children }: { children: ReactNode }) {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { profile: resolved, organizationId, isLoading: profileLoading } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const today = useToday()
  const orgId = organizationId || user?.uid || ""

  const profile = useMemo<FreeProfile | null>(() => {
    if (!user || !resolved || !orgId) return null
    const p = resolved as Record<string, unknown>
    const list = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [])
    return {
      uid: user.uid,
      orgId,
      name: String(p.name || user.displayName || ""),
      companyName: String(p.companyName || p.name || ""),
      phone: String(p.phone || ""),
      email: String(p.email || user.email || ""),
      city: String(p.city || ""),
      specializations: list(p.specializations),
      coverageCities: list(p.coverageCities),
      isVerified: !!p.isVerified,
      raw: p,
    }
  }, [user, resolved, orgId])
  const specsKey = profile ? profile.specializations.slice(0, 30).join("|") : ""

  // ---- What the supplier owns or is addressed in ----
  const offersQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "offers"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: offers, isLoading: offersLoading } = useCollection(offersQ)
  const posQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PURCHASE_ORDERS), where("supplierOrgId", "==", orgId)) : null), [firestore, orgId])
  const { data: pos, isLoading: posLoading } = useCollection<Omit<PurchaseOrder, "id">>(posQ)

  // ---- Requests: public ones in his field, those that name him, and those he quoted ----
  const publicQ = useMemoFirebase(() => {
    if (!firestore || !profile) return null
    const specs = specsKey ? specsKey.split("|") : []
    if (!specs.length) return null
    return query(collection(firestore, "rfqs"), where("status", "==", "New"), where("visibility", "==", "public"), where("category", "in", specs))
  }, [firestore, profile, specsKey])
  const { data: publicRfqs, isLoading: publicLoading } = useCollection(publicQ)
  const inviteQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "rfqs"), where("allowedSupplierOrgIds", "array-contains", orgId)) : null), [firestore, orgId])
  const { data: inviteRfqs, isLoading: inviteLoading } = useCollection(inviteQ)
  const invitedQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "rfqs"), where("invitedSupplierOrgIds", "array-contains", orgId)) : null), [firestore, orgId])
  const { data: invitedRfqs } = useCollection(invitedQ)
  const quotedIds = useMemo(() => (offers || []).map((o) => String((o as { rfqId?: string }).rfqId || "")).filter(Boolean), [offers])
  const { data: quotedRfqs, ready: quotedReady } = useChunkedDocs<Record<string, unknown>>("rfqs", null, quotedIds)

  const rfqs = useMemo(() => {
    const by = new Map<string, Record<string, unknown> & { id: string }>()
    for (const list of [publicRfqs, inviteRfqs, invitedRfqs, quotedRfqs]) for (const r of (list || []) as (Record<string, unknown> & { id: string })[]) by.set(r.id, r)
    return [...by.values()]
  }, [publicRfqs, inviteRfqs, invitedRfqs, quotedRfqs])

  // ---- What came of his orders ----
  const poIds = useMemo(() => ((pos || []) as PurchaseOrder[]).map((p) => p.id), [pos])
  const { data: deliveries, ready: deliveriesReady } = useChunkedDocs<Record<string, unknown>>("deliveries", "poId", poIds)
  const invoicesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "supplierInvoices"), where("supplierOrgId", "==", orgId)) : null), [firestore, orgId])
  const { data: invoices } = useCollection(invoicesQ)
  const transfersQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "supplierTransfers"), where("supplierOrgId", "==", orgId)) : null), [firestore, orgId])
  const { data: transfers } = useCollection(transfersQ)
  const warrantiesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "supplierWarranties"), where("supplierOrgId", "==", orgId)) : null), [firestore, orgId])
  const { data: warranties } = useCollection(warrantiesQ)
  const chatsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "chats"), where("supplierOrgId", "==", orgId)) : null), [firestore, orgId])
  const { data: chats } = useCollection(chatsQ)
  const linksQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "contractorSupplierLinks"), where("supplierOrgId", "==", orgId)) : null), [firestore, orgId])
  const { data: links } = useCollection(linksQ)
  // Invitations are addressed by e-mail or by mobile, so the server finds his and the page asks it (the rules key on the e-mail).
  const [invitations, setInvitations] = useState<Record<string, unknown>[]>([])
  const refreshInvites = useCallback(async () => {
    if (!user || !profile) return
    try {
      const token = await user.getIdToken()
      const res = await fetch("/api/supplier-free/invitations", { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const body = (await res.json()) as { data?: Record<string, unknown>[] }
      setInvitations((body.data || []).map((i) => ({ ...i, type: "supplier_invite", status: "pending" })))
    } catch (err) {
      console.error("invitations", err)
    }
  }, [user, profile])
  useEffect(() => {
    void refreshInvites()
  }, [refreshInvites])

  // ---- The contractors behind all of it ----
  const contractorIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of rfqs) ids.add(String(r.organizationId || r.contractorId || ""))
    for (const l of (links || []) as { contractorOrgId?: string }[]) ids.add(String(l.contractorOrgId || ""))
    for (const i of (invitations || []) as { contractorOrgId?: string; invitedBy?: string }[]) ids.add(String(i.contractorOrgId || i.invitedBy || ""))
    return [...ids].filter(Boolean)
  }, [rfqs, links, invitations])
  const { data: contractorDocs } = useChunkedDocs<Record<string, unknown>>("users", null, contractorIds)

  // ---- The supplier's own marks: archived requests, deals he has opened ----
  const wsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, SUPPLIER_WORKSPACE, orgId) : null), [firestore, orgId])
  const { data: ws, isLoading: wsLoading } = useDoc(wsRef)

  const ready = !!profile && !profileLoading && !offersLoading && !posLoading && !publicLoading && !inviteLoading && quotedReady && deliveriesReady && !wsLoading

  const quotedSet = useMemo(() => new Set(quotedIds), [quotedIds])

  const world = useMemo<World>(() => {
    if (!profile || !ready) return EMPTY_WORLD
    // A contractor's phone is kept only for one he deals with directly — an invitation, an order or a connection
    // (B-04): the free journey shows "call" for those alone, so a public request's contractor keeps his number.
    const close = closeContractors(orgId, rfqs, (pos || []) as PurchaseOrder[], (links || []) as Record<string, unknown>[], invitations)
    const contractors: Record<string, Record<string, unknown>> = {}
    for (const c of contractorDocs) contractors[c.id] = close.has(c.id) ? c : withoutPhone(c)
    const raw: RawWorld = {
      today,
      myOrgId: orgId,
      rfqs: rfqs.filter((r) => quotedSet.has(r.id) || inField(r, profile)),
      offers: (offers || []) as RawWorld["offers"],
      pos: ((pos || []) as PurchaseOrder[]),
      deliveries: deliveries as RawWorld["deliveries"],
      invoices: (invoices || []) as RawWorld["invoices"],
      transfers: (transfers || []) as RawWorld["transfers"],
      warranties: (warranties || []) as RawWorld["warranties"],
      chats: (chats || []) as RawWorld["chats"],
      contractors,
      links: (links || []) as RawWorld["links"],
      invitations: invitations as RawWorld["invitations"],
      archived: ((ws as { arch?: Record<string, unknown> } | null)?.arch) || {},
      seen: ((ws as { seen?: Record<string, unknown> } | null)?.seen) || {},
      declined: ((ws as { declined?: Record<string, { at?: string; note?: string }> } | null)?.declined) || {},
      myUid: profile.uid,
      questions: {},
    }
    return deriveWorld(raw)
  }, [profile, ready, today, orgId, rfqs, quotedSet, offers, pos, deliveries, invoices, transfers, warranties, chats, contractorDocs, links, invitations, ws])

  const vatOn = !!(profile && String(profile.raw.taxNumber || "").trim())
  const L = useMemo(() => createWorldLogic(today, world, vatOn ? 0.15 : 0), [today, world, vatOn])

  const archive = useCallback(
    async (rfqIds: readonly string[], on: boolean) => {
      if (!firestore || !orgId || !rfqIds.length) return
      const patch: Record<string, unknown> = { organizationId: orgId, updatedAt: serverTimestamp() }
      for (const id of rfqIds) patch[`arch.${id}`] = on ? true : deleteField()
      await updateOrCreate(firestore, orgId, patch)
    },
    [firestore, orgId]
  )
  const markSeen = useCallback(
    (dealId: string) => {
      if (!firestore || !orgId || world.seen[dealId]) return
      void updateOrCreate(firestore, orgId, { organizationId: orgId, [`seen.${dealId}`]: true }).catch(() => undefined)
    },
    [firestore, orgId, world.seen]
  )

  const rawRfq = useCallback((id: string) => rfqs.find((r) => r.id === id) || null, [rfqs])
  const rawOffer = useCallback(
    (rfqId: string) => {
      const mine = ((offers || []) as (Record<string, unknown> & { id: string })[]).filter((o) => o.rfqId === rfqId)
      return mine.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] || null
    },
    [offers]
  )
  const poOf = useCallback(
    (rfqId: string) => {
      const mine = ((pos || []) as PurchaseOrder[]).filter((p) => p.rfqId === rfqId)
      return mine.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null
    },
    [pos]
  )

  const value = useMemo<FreeWorldValue>(
    () => ({ ready, today, world, L, profile, pos: (pos || []) as PurchaseOrder[], refreshInvites, rawRfq, rawOffer, poOf, archive, markSeen }),
    [ready, today, world, L, profile, pos, refreshInvites, rawRfq, rawOffer, poOf, archive, markSeen]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

async function updateOrCreate(firestore: Firestore, orgId: string, patch: Record<string, unknown>) {
  const ref = doc(firestore, SUPPLIER_WORKSPACE, orgId)
  try {
    await updateDoc(ref, patch as UpdateData<DocumentData>)
  } catch (err) {
    if ((err as { code?: string }).code !== "not-found") throw err
    const base: Record<string, unknown> = { organizationId: orgId, arch: {}, seen: {} }
    const arch: Record<string, unknown> = {}
    const seen: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (k.startsWith("arch.") && v === true) arch[k.slice(5)] = true
      if (k.startsWith("seen.") && v === true) seen[k.slice(5)] = true
    }
    await setDoc(ref, { ...base, arch, seen, updatedAt: serverTimestamp() })
  }
}

/** The contractors the supplier deals with directly: who invited him to a request or to connect, who ordered from him,
 * and those he is connected with. */
export function closeContractors(
  orgId: string,
  rfqs: readonly Record<string, unknown>[],
  pos: readonly { organizationId?: string }[],
  links: readonly Record<string, unknown>[],
  invitations: readonly Record<string, unknown>[]
): Set<string> {
  const out = new Set<string>()
  const names = (v: unknown) => Array.isArray(v) && (v as unknown[]).includes(orgId)
  for (const r of rfqs) if (names(r.allowedSupplierOrgIds) || names(r.invitedSupplierOrgIds)) out.add(String(r.organizationId || r.contractorId || ""))
  for (const p of pos) out.add(String(p.organizationId || ""))
  for (const l of links) if (l.status === "active") out.add(String(l.contractorOrgId || ""))
  for (const i of invitations) out.add(String(i.contractorOrgId || i.invitedBy || ""))
  out.delete("")
  return out
}

function withoutPhone(c: Record<string, unknown> & { id: string }): Record<string, unknown> & { id: string } {
  const { phone: _phone, ...rest } = c
  return rest as Record<string, unknown> & { id: string }
}

/** A public request is his only when it is in his coverage cities; one that names him or he quoted always is. */
function inField(rfq: Record<string, unknown> & { id: string }, profile: FreeProfile): boolean {
  const allowed = Array.isArray(rfq.allowedSupplierOrgIds) ? (rfq.allowedSupplierOrgIds as string[]) : []
  const invited = Array.isArray(rfq.invitedSupplierOrgIds) ? (rfq.invitedSupplierOrgIds as string[]) : []
  if (allowed.includes(profile.orgId) || invited.includes(profile.orgId)) return true
  if (rfq.visibility === "private") return false
  if (!profile.coverageCities.length) return false
  const city = String(rfq.city || "")
  // Deliberate (RFQ-01): a request that names no city is nationwide, so it reaches every supplier in its specialty.
  return !city || profile.coverageCities.includes(city)
}

export function useFreeWorld(): FreeWorldValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useFreeWorld outside FreeWorldProvider")
  return v
}
