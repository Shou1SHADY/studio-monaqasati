"use client"

// Everything the RFQ's page reads, gathered once (Procurement 2.0 WP-S3-04): the RFQ, its offers (with the buyer's decisions
// about them), the supplier questions, the orders and receipts that came out of it, the policies, the requests that fed it,
// and the one evaluation (`offer-calc.ts`) the header, the best-of cards, the rows, the panel and the comparison all read.
// Every list names its side — the offers by `contractorOrgId` — so the rules can prove each query (G-06).

import { useEffect, useMemo, useState } from "react"
import { collection, doc, getDoc, orderBy, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useOfferDecisions } from "@/hooks/useOfferDecisions"
import { useProcActor } from "@/hooks/useProcActor"
import { useRfqRunner } from "@/hooks/useRfqRunner"
import { useSupplierRecords } from "@/hooks/useSupplierRecords"
import { riyadhDay } from "@/lib/hr/format"
import { awardSupplierOrgId, supplierFactsFromProfile } from "@/lib/procurement/award"
import { PROC_INCOMING, type IncomingDoc } from "@/lib/procurement/incoming-state"
import type { DecisionMap, OfferDecision } from "@/lib/procurement/offer-decisions"
import { supplierScore, type NoticeFact } from "@/lib/procurement/po"
import { resolvePolicies } from "@/lib/procurement/policies"
import { actsOnRfq, awardsOnRfq, closesRfqEarly, ownerReadsRfqs, rfqMine, runsRfqs, type RfqWriteActor } from "@/lib/procurement/rfq-access"
import { pageState, pathModel, requestsOfRfq, type PageState, type PathModel } from "@/lib/procurement/rfq-path"
import { bestCards, buildOfferRows, type BestCards, type OfferRowModel, type OfferRows, type RowOffer } from "@/lib/procurement/rfq-offers-view"
import { createdIso, inquiryCounts, type InquiryCounts, type InquiryDoc } from "@/lib/procurement/rfq-inquiries"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS, type ProcActor, type ProcurementPolicies, type PurchaseOrder, type ReceiptFact, type SupplierFacts } from "@/lib/procurement/types"
import type { SupplierRecord } from "@/lib/procurement/supplier-file"
import type { RfqOfferView, RfqView } from "@/components/procurement/rfq/rfqOfferView"

export type WorldOffer = RfqOfferView & RowOffer

/** What the buyer picked on the offers tab to award: one supplier, all he priced or the lines named. */
export interface AwardSelection {
  offerId: string
  /** RFQ line indexes; empty = everything he priced. */
  lines: number[]
  /** Open the award review at once (the offer panel's «رسِّ…»), instead of only marking the cells. */
  review: boolean
}

export interface SupplierProfileFacts {
  orgId: string
  facts: SupplierFacts
  rating: number | null
  city: string | null
  name: string | null
}

export interface SupplierExperience {
  orders: number
  onTimePercent: number | null
  rejectPercent: number | null
}

export interface RfqAccess {
  /** Runs this RFQ: share, extend, exclude, answer, ask (rfq-access.ts). */
  acts: boolean
  /** May award: offers.accept or the owner. */
  canDecide: boolean
  closes: boolean
  /** The ★ is a reader's note: anyone who sees offers. */
  canShortlist: boolean
  ownerReads: boolean
  notMine: boolean
  isPlatformAdmin: boolean
  seesPrices: boolean
}

export interface RfqWorld {
  rfqId: string
  loading: boolean
  rfq: RfqView | null
  /** Newest first. */
  offers: WorldOffer[]
  decisions: DecisionMap
  decisionRecords: Array<OfferDecision & { id: string }>
  inquiries: Array<InquiryDoc & { id: string }>
  inquiryCounts: InquiryCounts
  orders: PurchaseOrder[]
  orgOrders: PurchaseOrder[]
  receipts: ReceiptFact[]
  notices: NoticeFact[]
  policies: ProcurementPolicies
  project: { name?: string | null; budget?: number | null } | null
  requests: IncomingDoc[]
  profiles: Record<string, SupplierProfileFacts>
  records: Map<string, SupplierRecord>
  today: string
  actor: ProcActor
  runner: RfqWriteActor
  orgId: string
  orgName: string
  userId: string
  profile: Record<string, unknown> | null
  access: RfqAccess
  state: PageState
  path: PathModel
  rows: OfferRowModel[]
  evaluation: OfferRows["ev"]
  cards: BestCards
  /** G-03: THE lowest complete offer's gross, the same figure on the header, the card and row #1. */
  lowestCompleteGrossH: number | null
  experienceOf: (orgId: string | null) => SupplierExperience
  hasRecord: (row: OfferRowModel) => boolean
}

const asDay = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : null
}

export function useRfqWorld(rfqId: string): RfqWorld {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const userRef = useMemoFirebase(() => (isUserLoading || !user || !firestore ? null : doc(firestore, "users", user.uid)), [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userRef)

  const rfqRef = useMemoFirebase(() => (firestore && rfqId ? doc(firestore, "rfqs", rfqId) : null), [firestore, rfqId])
  const { data: rfqDoc, isLoading: rfqLoading } = useDoc(rfqRef)
  const rfq = useMemo(() => (rfqDoc ? ({ ...(rfqDoc as object), id: rfqId } as RfqView) : null), [rfqDoc, rfqId])
  const projectId = rfq?.projectId || undefined

  const { actor, orgId, orgName } = useProcActor(projectId)
  const { runner } = useRfqRunner(projectId)
  const buyerOrgId = rfq?.organizationId || orgId

  const offersQuery = useMemoFirebase(() => (isUserLoading || !user || !firestore || !buyerOrgId ? null : query(collection(firestore, "offers"), where("rfqId", "==", rfqId), where("contractorOrgId", "==", buyerOrgId))), [firestore, user, isUserLoading, rfqId, buyerOrgId])
  const { data: offersRaw, isLoading: offersLoading } = useCollection(offersQuery)
  const offers = useMemo(
    () =>
      ((offersRaw || []) as unknown as WorldOffer[]).slice().sort((a, b) => {
        const t = (o: WorldOffer) => Date.parse(asDay(o.createdAt) || "") || 0
        return t(b) - t(a)
      }),
    [offersRaw]
  )

  const { decisions, records: decisionRecords } = useOfferDecisions(buyerOrgId, rfqId)

  const inquiriesQuery = useMemoFirebase(() => (firestore && rfqId ? query(collection(firestore, "rfqs", rfqId, "inquiries"), orderBy("createdAt", "desc")) : null), [firestore, rfqId])
  const { data: inquiriesRaw } = useCollection(inquiriesQuery)
  const inquiries = useMemo(() => ((inquiriesRaw || []) as unknown as Array<InquiryDoc & { id: string }>).map((q) => ({ ...q, createdAt: createdIso(q) || q.createdAt })), [inquiriesRaw])

  const ordersQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: ordersRaw } = useCollection(ordersQuery)
  const orgOrders = useMemo(() => ((ordersRaw || []) as PurchaseOrder[]).map((o) => ({ ...o, lines: o.lines || [], log: o.log || [] })), [ordersRaw])
  const orders = useMemo(() => orgOrders.filter((o) => o.rfqId === rfqId), [orgOrders, rfqId])

  const deliveriesQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "deliveries"), where("contractorOrgId", "==", orgId)) : null), [firestore, orgId])
  const { data: deliveriesRaw } = useCollection(deliveriesQuery)
  const receipts = useMemo(
    () => ((deliveriesRaw || []) as Array<ReceiptFact & { deliveryDate?: unknown; confirmedAt?: unknown }>).map((d) => ({ ...d, deliveryDate: asDay(d.deliveryDate), confirmedAt: asDay(d.confirmedAt) })) as ReceiptFact[],
    [deliveriesRaw]
  )
  const notices = useMemo(() => receipts.filter((d) => (d as { rfqId?: string }).rfqId === rfqId) as unknown as NoticeFact[], [receipts, rfqId])

  const policiesRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PROCUREMENT_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: policiesDoc } = useDoc(policiesRef)
  const policies = useMemo<ProcurementPolicies>(() => resolvePolicies(policiesDoc as Partial<ProcurementPolicies> | null), [policiesDoc])

  const projectRef = useMemoFirebase(() => (firestore && projectId ? doc(firestore, "projects", projectId) : null), [firestore, projectId])
  const { data: projectDoc } = useDoc(projectRef)

  const incomingQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PROC_INCOMING), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: incomingRaw } = useCollection(incomingQuery)
  const requests = useMemo(() => requestsOfRfq((incomingRaw || []) as IncomingDoc[], rfqId), [incomingRaw, rfqId])

  const records = useSupplierRecords(orgId)

  const supplierIds = useMemo(() => {
    const ids = new Set<string>()
    for (const o of offers) {
      const id = awardSupplierOrgId(o as never)
      if (id) ids.add(id)
    }
    return [...ids].sort().join(",")
  }, [offers])
  const [profiles, setProfiles] = useState<Record<string, SupplierProfileFacts>>({})
  useEffect(() => {
    if (!firestore || !supplierIds) return
    const missing = supplierIds.split(",").filter((id) => !profiles[id])
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      const found: Record<string, SupplierProfileFacts> = {}
      for (const id of missing) {
        try {
          let snap = await getDoc(doc(firestore, "users", id))
          if (!snap.exists()) snap = await getDoc(doc(firestore, "organizations", id))
          const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null
          found[id] = {
            orgId: id,
            facts: supplierFactsFromProfile(id, data as Parameters<typeof supplierFactsFromProfile>[1]),
            rating: data && Number(data.rating) > 0 ? Number(data.rating) : null,
            city: data && typeof data.city === "string" ? data.city : null,
            name: data ? ((data.companyName as string) || (data.name as string) || null) : null,
          }
        } catch (err) {
          console.warn("supplier facts not read:", (err as { code?: string })?.code || err)
          found[id] = { orgId: id, facts: supplierFactsFromProfile(id, null), rating: null, city: null, name: null }
        }
      }
      if (!cancelled) setProfiles((prev) => ({ ...prev, ...found }))
    })()
    return () => {
      cancelled = true
    }
  }, [firestore, supplierIds, profiles])

  const today = riyadhDay()
  const isPlatformAdmin = (profile as { role?: string } | null)?.role === "Admin"
  const author = { createdByUserId: rfq?.createdByUserId ?? null, contractorId: rfq?.contractorId ?? null }
  const acts = isPlatformAdmin || actsOnRfq(author, runner)
  const seesPrices = actor.seesPrices || isPlatformAdmin
  const access: RfqAccess = {
    acts,
    canDecide: isPlatformAdmin || awardsOnRfq(author, runner),
    closes: closesRfqEarly(author, runner),
    canShortlist: acts || seesPrices,
    ownerReads: ownerReadsRfqs(runner) && !acts,
    notMine: !isPlatformAdmin && runsRfqs(runner) && !rfqMine(author, runner),
    isPlatformAdmin,
    seesPrices,
  }

  const experienceOf = useMemo(() => {
    const byOrg = new Map<string, PurchaseOrder[]>()
    for (const o of orgOrders) byOrg.set(o.supplierOrgId, [...(byOrg.get(o.supplierOrgId) || []), o])
    return (id: string | null): SupplierExperience => {
      if (!id) return { orders: 0, onTimePercent: null, rejectPercent: null }
      const mine = byOrg.get(id) || []
      const score = supplierScore(mine, receipts, new Date())
      return { orders: mine.filter((o) => o.status !== "cancelled").length, onTimePercent: score.onTimePercent, rejectPercent: score.rejectPercent }
    }
  }, [orgOrders, receipts])

  const hasRecord = useMemo(
    () => (row: OfferRowModel) => {
      const id = awardSupplierOrgId(row.offer as never)
      if (!id) return false
      return experienceOf(id).orders > 0 || records.has(id)
    },
    [experienceOf, records]
  )

  const built = useMemo(
    () =>
      buildOfferRows({
        rfq,
        offers,
        decisions,
        today,
        tiePercent: policies.tieBandPct,
        ratingOf: (o) => {
          const id = awardSupplierOrgId(o as never)
          return id ? profiles[id]?.rating ?? null : null
        },
      }),
    [rfq, offers, decisions, today, policies.tieBandPct, profiles]
  )
  const cards = useMemo(() => bestCards({ rows: built.rows, ev: built.ev, rfq, limit: policies.minOffers, hasRecord }), [built, rfq, policies.minOffers, hasRecord])

  const state = useMemo<PageState>(() => pageState(rfq || {}, today), [rfq, today])
  const path = useMemo(
    () =>
      pathModel({
        rfq: (rfq || { id: rfqId }) as never,
        today,
        offerCount: offers.length,
        requests,
        orders,
        awardWindowDays: policies.awardCycleDays,
      }),
    [rfq, rfqId, today, offers.length, requests, orders, policies.awardCycleDays]
  )

  return {
    rfqId,
    loading: rfqLoading || offersLoading,
    rfq,
    offers,
    decisions,
    decisionRecords,
    inquiries,
    inquiryCounts: inquiryCounts(inquiries),
    orders,
    orgOrders,
    receipts,
    notices,
    policies,
    project: (projectDoc as { name?: string; budget?: number } | null) ?? null,
    requests,
    profiles,
    records,
    today,
    actor,
    runner,
    orgId,
    orgName,
    userId: user?.uid || "",
    profile: (profile as Record<string, unknown> | null) ?? null,
    access,
    state,
    path,
    rows: built.rows,
    evaluation: built.ev,
    cards,
    lowestCompleteGrossH: built.ev.lowestComplete?.grossH ?? null,
    experienceOf,
    hasRecord,
  }
}
