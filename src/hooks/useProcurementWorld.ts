"use client"

// Everything Procurement's screens read, loaded once and org-scoped (PRD 3.0
// §7): the purchase orders, the deliveries (supplier notices and goods
// receipts), the RFQs and their offers, the org's policies, and — lazily —
// what an approval needs to know about each supplier (VAT number, platform
// verification, CR expiry). The pure layer (`src/lib/procurement/*`) derives
// the rest on every render; this hook only gathers.
//
// Prices are loaded for every viewer and masked by the screens for a member
// who may not see them (`ProcActor.seesPrices`) — Firestore cannot hide a
// field, and a price-free twin of every document would cost more than it
// protects. Stated honestly here so nobody mistakes the mask for a wall.

import { useEffect, useMemo, useState } from "react"
import { collection, doc, getDoc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useProcActor } from "@/hooks/useProcActor"
import { resolvePolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS, type ProcActor, type ProcurementPolicies, type PurchaseOrder, type ReceiptFact, type SupplierFacts } from "@/lib/procurement/types"

/** A delivery as stored (supplier notice, guest notice or manual receipt) plus the optional PO fields. */
export type ProcDelivery = ReceiptFact & {
  contractorOrgId?: string | null
  supplierOrgId?: string | null
  supplierId?: string | null
  rfqTitle?: string | null
  deliveryPersonName?: string | null
  receivedByName?: string | null
  isGuestDelivery?: boolean | null
  items?: Array<{ name?: string; quantity?: number; unit?: string; unitOfMeasure?: string }> | null
  notes?: string | null
  createdAt?: unknown
}

export interface ProcRfq {
  id: string
  title?: string
  status?: string
  organizationId?: string | null
  contractorId?: string | null
  projectId?: string | null
  category?: string | null
  deadline?: string | null
  createdAt?: unknown
  offersCount?: number
  directAward?: boolean | null
  products?: Array<{ name?: string; quantity?: number | string; unitOfMeasure?: string; unit?: string; boqItemId?: string | null }> | null
  purchaseSource?: { kind: string; workOrderId?: string; purchaseRequestId?: string } | null
  allowedSupplierOrgIds?: string[] | null
  invitedSupplierOrgIds?: string[] | null
}

export interface ProcOffer {
  id: string
  rfqId?: string | null
  status?: string | null
  price?: string | number | null
  totalBatchesPrice?: number | null
  supplierId?: string | null
  organizationId?: string | null
  supplierName?: string | null
  companyName?: string | null
  isGuestOffer?: boolean | null
  offerPdfUrl?: string | null
  poId?: string | null
  poNumber?: string | null
  createdAt?: string | null
  decidedAt?: string | null
}

export interface ProcurementWorld {
  orders: PurchaseOrder[]
  deliveries: ProcDelivery[]
  rfqs: ProcRfq[]
  offers: ProcOffer[]
  policies: ProcurementPolicies
  /** By supplier org id — filled lazily for the suppliers the orders name. */
  supplierFacts: Map<string, SupplierFacts>
  actor: ProcActor
  orgId: string
  orgName: string
  loading: boolean
}

const asDay = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : null
}

export function useProcurementWorld(): ProcurementWorld {
  const firestore = useFirestore()
  const { actor, orgId, orgName, isLoading: actorLoading } = useProcActor()

  const ordersQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const deliveriesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "deliveries"), where("contractorOrgId", "==", orgId)) : null), [firestore, orgId])
  const rfqsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "rfqs"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  // Offers key on the RFQ's org — for an RFQ a team member created, older
  // web-submitted offers may carry the creator's uid instead (impl-b §8.1);
  // those are reached through the RFQ's own offers screen, not from here.
  const offersQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "offers"), where("contractorOrgId", "==", orgId)) : null), [firestore, orgId])
  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PROCUREMENT_SETTINGS, orgId) : null), [firestore, orgId])

  const { data: ordersData, isLoading: ordersLoading } = useCollection(ordersQ)
  const { data: deliveriesData, isLoading: deliveriesLoading } = useCollection(deliveriesQ)
  const { data: rfqsData, isLoading: rfqsLoading } = useCollection(rfqsQ)
  const { data: offersData } = useCollection(offersQ)
  const { data: settingsData, isLoading: settingsLoading } = useDoc(settingsRef)

  const orders = useMemo(() => ((ordersData || []) as PurchaseOrder[]).map((o) => ({ ...o, lines: o.lines || [], log: o.log || [] })), [ordersData])
  const deliveries = useMemo(
    () =>
      ((deliveriesData || []) as Array<ProcDelivery & { deliveryDate?: unknown; confirmedAt?: unknown }>).map((d) => ({
        ...d,
        deliveryDate: asDay(d.deliveryDate),
        confirmedAt: asDay(d.confirmedAt),
      })) as ProcDelivery[],
    [deliveriesData]
  )
  const rfqs = useMemo(() => (rfqsData || []) as ProcRfq[], [rfqsData])
  const offers = useMemo(() => (offersData || []) as ProcOffer[], [offersData])
  const policies = useMemo(() => resolvePolicies(settingsData as Partial<ProcurementPolicies> | null), [settingsData])

  // Supplier facts — one read per supplier the orders name, cached for the session.
  const supplierIds = useMemo(
    () =>
      Array.from(new Set(orders.map((o) => o.supplierOrgId).filter((id): id is string => Boolean(id) && id !== "guest" && id !== "mdmak-system")))
        .sort()
        .join(","),
    [orders]
  )
  const [supplierFacts, setSupplierFacts] = useState<Map<string, SupplierFacts>>(() => new Map())
  useEffect(() => {
    if (!firestore || !supplierIds) return
    let cancelled = false
    ;(async () => {
      const found = new Map<string, SupplierFacts>()
      for (const id of supplierIds.split(",")) {
        try {
          let snap = await getDoc(doc(firestore, "users", id))
          if (!snap.exists()) snap = await getDoc(doc(firestore, "organizations", id))
          const data = (snap.exists() ? snap.data() : {}) as { taxNumber?: string | null; isVerified?: boolean | null; legalDocuments?: { cr?: { expiryDate?: string | null } } | null }
          const known = snap.exists()
          found.set(id, {
            orgId: id,
            hasVatNumber: known ? Boolean((data.taxNumber || "").toString().trim()) : null,
            verified: known ? Boolean(data.isVerified) : null,
            crExpiry: known ? (data.legalDocuments?.cr?.expiryDate as string | undefined)?.slice(0, 10) || null : null,
          })
        } catch (err) {
          console.warn("supplier facts not read:", (err as { code?: string })?.code || err)
          found.set(id, { orgId: id, hasVatNumber: null, verified: null, crExpiry: null })
        }
      }
      // Re-reads a known supplier only when the set of suppliers changes — cheap, and never stale.
      if (!cancelled) setSupplierFacts((prev) => new Map([...prev, ...found]))
    })()
    return () => {
      cancelled = true
    }
    // `supplierFacts` is read through the functional setState above, so the
    // effect never needs it as a dependency (it is what the effect fills).
  }, [firestore, supplierIds])

  return {
    orders,
    deliveries,
    rfqs,
    offers,
    policies,
    supplierFacts,
    actor,
    orgId,
    orgName,
    loading: actorLoading || ordersLoading || deliveriesLoading || rfqsLoading || settingsLoading,
  }
}
