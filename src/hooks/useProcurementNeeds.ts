"use client"

// The needs desk's world (`src/lib/procurement/need-desk.ts`): every need that
// reaches Purchasing — work orders' shortfalls, projects' requests, stock gaps —
// with what decides each line's state and path: the stores, our workshop's
// product cards and its answers, agreements and the prices we paid. Read by
// the requests tab, by Today and by the head of every Procurement page.
// A member's `procurementCategories` (optional, on `users/{uid}`) scopes a buyer.

import { useMemo, useState } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { useOrgStock, stockKey } from "@/hooks/useOrgStock"
import { usePermissions } from "@/hooks/usePermissions"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { useProjectPurchaseRequests } from "@/hooks/useProjectPurchaseRequests"
import type { ProcurementWorld } from "@/hooks/useProcurementWorld"
import { WORK_ORDERS } from "@/lib/manufacturing"
import { MFG_PRODUCTS, MFG_SETTINGS, itemKey, normalizeMfgSettings, type MfgProduct, type MfgSettings, type PurchaseRequestRecord } from "@/lib/manufacturing-engine"
import { isV2Order, sourceOf, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { orderRef } from "@/lib/manufacturing-view"
import { purchaseRequestRef } from "@/lib/mfg-outside"
import { can as resolveCan, type TeamGroup } from "@/lib/permissions"
import { MANUFACTURING_REQUESTS, type ManufacturingRequest } from "@/lib/sales-orders"
import { buildNeedRows, type BuyerScope, type MfgRequestFact, type NeedRow } from "@/lib/procurement/need-desk"
import { procTeam } from "@/lib/procurement/team"
import { mfgNeed, needsForModules, projectNeed, returnedNeeds, sortNeeds, stockNeeds, type Need } from "@/lib/procurement/needs"

export interface ProcurementNeeds {
  loading: boolean
  rows: NeedRow[]
  needs: Need[]
  buyers: BuyerScope[]
  /** The viewer's own categories when he is a buyer; null = all. */
  viewerCategories: string[] | null
  /** Anyone besides the owner prepares or approves orders. */
  ownerHasTeam: boolean
  /** For the dialogs behind a row. */
  mfgByKey: Map<string, { order: WorkOrderV2; request: PurchaseRequestRecord; lotted: boolean }>
  mfgRequests: Record<string, ManufacturingRequest>
  products: MfgProduct[]
  mfgSettings: MfgSettings
  stockLoading: boolean
  onHand: (name: string) => number | null
}

const asIso = (v: unknown): string | null => {
  if (typeof v === "string") return v
  const t = v as { toDate?: () => Date } | null
  return t && typeof t.toDate === "function" ? t.toDate().toISOString() : null
}

export function useProcurementNeeds(world: ProcurementWorld): ProcurementNeeds {
  const firestore = useFirestore()
  const { orgId, actor, policies, orders, rfqs } = world
  const { profile, groups, can: viewerCan } = usePermissions()
  const [now] = useState(() => new Date())

  const { on } = useModules()
  const pmOn = on("project-management")
  const mfgOn = on("manufacturing")
  const woQ = useMemoFirebase(() => (firestore && orgId && mfgOn ? query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId)) : null), [firestore, orgId, mfgOn])
  const { data: woData, isLoading: woLoading } = useCollection(woQ)
  const productsQ = useMemoFirebase(() => (firestore && orgId && mfgOn ? query(collection(firestore, MFG_PRODUCTS), where("organizationId", "==", orgId)) : null), [firestore, orgId, mfgOn])
  const { data: productsData } = useCollection(productsQ)
  const whQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: whData } = useCollection(whQ)
  const mrQ = useMemoFirebase(() => (firestore && orgId && mfgOn ? query(collection(firestore, MANUFACTURING_REQUESTS), where("organizationId", "==", orgId)) : null), [firestore, orgId, mfgOn])
  const { data: mrData } = useCollection(mrQ)
  const settingsRef = useMemoFirebase(() => (firestore && orgId && mfgOn ? doc(firestore, MFG_SETTINGS, orgId) : null), [firestore, orgId, mfgOn])
  const { data: settingsData } = useDoc(settingsRef)
  const warehouses = useMemo(() => (whData || []) as Array<{ id: string; name?: string; isOutbound?: boolean }>, [whData])
  const stock = useOrgStock(warehouses, warehouses.length > 0)
  const { agreements, history } = useProcurementPrices(orgId || null)
  const projectRequests = useProjectPurchaseRequests(orgId || null, pmOn)
  const { orgMembers } = useOrgMembers(orgId || null)

  const products = useMemo(() => ((productsData || []) as MfgProduct[]).filter((p) => !p.archived), [productsData])
  const mfgSettings = useMemo(() => normalizeMfgSettings(settingsData as Partial<MfgSettings> | null), [settingsData])
  const mfgRequests = useMemo(() => Object.fromEntries(((mrData || []) as ManufacturingRequest[]).map((r) => [r.id, r])), [mrData])

  const mfgByKey = useMemo(() => {
    const productById = new Map(products.map((p) => [p.id, p]))
    const m = new Map<string, { order: WorkOrderV2; request: PurchaseRequestRecord; lotted: boolean }>()
    for (const o of ((woData || []) as WorkOrderV2[]).filter(isV2Order)) {
      const p = productById.get(o.productId || "")
      for (const request of o.purchaseRequests || []) m.set(`mfg:${o.id}:${request.id}`, { order: o, request, lotted: !!p?.bom.some((b) => b.lotted && itemKey(b.itemName) === itemKey(request.itemName)) })
    }
    return m
  }, [woData, products])

  const needs = useMemo(() => {
    const out: Need[] = []
    mfgByKey.forEach(({ order: o, request }) => {
      const s = sourceOf(o)
      const context = o.productName || (s === "project" ? o.projectName || "" : s === "client" ? o.source?.contactName || "" : "")
      out.push(mfgNeed({ id: o.id, ref: orderRef(o), context, projectId: o.projectId ?? null, projectName: o.projectName ?? null }, request))
    })
    for (const { project, requests } of projectRequests.rows) for (const pr of requests) out.push(projectNeed(project, pr, purchaseRequestRef(pr.id)))
    out.push(...returnedNeeds(out, orders))
    const names = new Map(warehouses.map((w) => [w.id, w.name || ""]))
    const stockRows = Array.from(stock.byWarehouse.entries()).flatMap(([warehouseId, rows]) => rows.filter((r) => !r.isManufactured).map((r) => ({ ...r, warehouseId, warehouseName: names.get(warehouseId) || "" })))
    out.push(...stockNeeds(stockRows, { rfqs, orders }))
    return sortNeeds(needsForModules(out, { projects: pmOn, workshop: mfgOn }).filter((n) => n.lines.length > 0))
  }, [mfgByKey, projectRequests.rows, stock.byWarehouse, warehouses, rfqs, orders, pmOn, mfgOn])

  const onHand = useMemo(() => (name: string) => (stock.loading ? null : stock.byName.get(stockKey(name)) ?? null), [stock])
  const makeable = useMemo(() => {
    const keys = products.map((p) => itemKey(p.name)).filter(Boolean)
    return (name: string) => {
      const k = itemKey(name)
      return !!k && keys.some((p) => p === k || p.includes(k) || k.includes(p))
    }
  }, [products])

  const rows = useMemo(() => {
    const facts: Record<string, MfgRequestFact> = {}
    for (const [id, r] of Object.entries(mfgRequests)) facts[id] = { status: r.status, at: (r as ManufacturingRequest & { requestedAt?: string }).requestedAt || asIso((r as ManufacturingRequest & { createdAt?: unknown }).createdAt) }
    return buildNeedRows(needs, { now, policies, agreements, history, orders, rfqs, onHand, makeable, mfgRequests: facts })
  }, [needs, now, policies, agreements, history, orders, rfqs, onHand, makeable, mfgRequests])

  const canSource = actor.isOwner || actor.canPrepare || viewerCan("rfq.manage")
  const team = useMemo(
    () =>
      procTeam(
        orgMembers.map((m) => ({
          id: m.id,
          name: (m.name as string) || (m.email as string) || "",
          procurementCategories: m.procurementCategories,
          can: (p) => resolveCan(p, { organizationRole: (m.organizationRole as string | null | undefined) ?? null, defaultGroupId: (m.defaultGroupId as string | undefined) || null, groups: groups as TeamGroup[] }),
          isOwner: m.id === orgId || m.organizationRole === "owner",
        })),
        { ...actor, canSource },
        (profile as Record<string, unknown> | null)?.procurementCategories
      ),
    [orgMembers, groups, orgId, actor, canSource, profile]
  )
  const viewerCategories = team.viewerCategories

  return {
    loading: woLoading || (pmOn && projectRequests.loading) || world.loading,
    rows,
    needs,
    buyers: team.buyers,
    viewerCategories,
    ownerHasTeam: team.ownerHasTeam,
    mfgByKey,
    mfgRequests,
    products,
    mfgSettings,
    stockLoading: stock.loading,
    onHand,
  }
}
