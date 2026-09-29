"use client"

// Facts Today's rows need from other modules, read only while a row needs
// them (every Procurement page carries the shell): how far an order waiting on
// Projects' budget decision runs past its items (R-25), when the workshop will
// have a line it is making (P-26), and where a notice's goods land and whom the
// register names to receive them there (P-20). Each returns an empty record
// until its facts are read — a row then simply says less.

import { useEffect, useMemo, useState } from "react"
import { collection, doc, getDoc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import { MFG_DEPARTMENTS, WORK_ORDERS, type MfgDepartment } from "@/lib/manufacturing"
import { MFG_PRODUCTS, MFG_SETTINGS, normalizeMfgSettings, type MfgProduct, type MfgSettings } from "@/lib/manufacturing-engine"
import { isV2Order, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { buildWorld } from "@/lib/manufacturing-view"
import { awaitsPmBudget, budgetOverrun, overrunTotal, type BoqGateItem, type PurchaseOrderX } from "@/lib/procurement/po-extras"
import { landingWarehouseId, suggestedReceiver } from "@/lib/procurement/receipt-desk"
import { noticeTold } from "@/lib/procurement/policy-enforce"
import type { NeedRow } from "@/lib/procurement/need-desk"
import type { ProcurementPolicies, PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"

/** By order id: the overrun of an order awaiting the project manager's budget decision. */
export function useBudgetOverruns(orders: PurchaseOrder[]): Record<string, number> {
  const firestore = useFirestore()
  const waiting = useMemo(() => orders.filter((o) => awaitsPmBudget(o as PurchaseOrderX) && o.projectId), [orders])
  const wanted = useMemo(
    () => Array.from(new Set(waiting.flatMap((o) => o.lines.map((l) => (l.boqItemId ? `${o.projectId}/${l.boqItemId}` : "")).filter(Boolean)))).sort(),
    [waiting]
  )
  const signature = wanted.join("|")
  const [items, setItems] = useState<Record<string, BoqGateItem>>({})
  useEffect(() => {
    if (!firestore || !signature) return
    let cancelled = false
    Promise.all(
      signature.split("|").map(async (path) => {
        const [projectId, itemId] = path.split("/")
        const snap = await getDoc(doc(firestore, "projects", projectId, "boqItems", itemId)).catch(() => null)
        return snap?.exists() ? ([path, { id: itemId, ...(snap.data() as Omit<BoqGateItem, "id">) }] as const) : null
      })
    ).then((pairs) => {
      if (!cancelled) setItems(Object.fromEntries(pairs.filter((p): p is readonly [string, BoqGateItem] => p !== null)))
    })
    return () => {
      cancelled = true
    }
  }, [firestore, signature])
  return useMemo(() => {
    const out: Record<string, number> = {}
    for (const po of waiting) {
      const own = Object.entries(items).filter(([k]) => k.startsWith(`${po.projectId}/`)).map(([, v]) => v)
      const over = overrunTotal(budgetOverrun(po, own, orders))
      if (over > 0) out[po.id] = over
    }
    return out
  }, [waiting, items, orders])
}

/** By need row key: the day the workshop's schedule says a line being made is ready — the
 * latest of its work orders, none while one of them has no possible date. */
export function useMfgReadyDates(orgId: string, rows: NeedRow[], requests: Record<string, { workOrderId?: string | null; workOrderIds?: string[] }>): Record<string, string> {
  const firestore = useFirestore()
  const made = useMemo(
    () =>
      rows
        .filter((r) => r.state === "mfg" && r.need.mfgRequestId)
        .map((r) => {
          const req = requests[r.need.mfgRequestId as string]
          return { key: r.key, orders: Array.from(new Set([...(req?.workOrderIds || []), req?.workOrderId || ""].filter(Boolean))) }
        })
        .filter((x) => x.orders.length > 0),
    [rows, requests]
  )
  const on = Boolean(firestore && orgId && made.length)
  const ordersQ = useMemoFirebase(() => (firestore && on ? query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId)) : null), [on, firestore, orgId])
  const productsQ = useMemoFirebase(() => (firestore && on ? query(collection(firestore, MFG_PRODUCTS), where("organizationId", "==", orgId)) : null), [on, firestore, orgId])
  const departmentsQ = useMemoFirebase(() => (firestore && on ? query(collection(firestore, MFG_DEPARTMENTS), where("organizationId", "==", orgId)) : null), [on, firestore, orgId])
  const settingsRef = useMemoFirebase(() => (firestore && on ? doc(firestore, MFG_SETTINGS, orgId) : null), [on, firestore, orgId])
  const { data: ordersData } = useCollection(ordersQ)
  const { data: productsData } = useCollection(productsQ)
  const { data: departmentsData } = useCollection(departmentsQ)
  const { data: settingsData } = useDoc(settingsRef)
  return useMemo(() => {
    if (!on || !ordersData || !productsData || !departmentsData) return {}
    const today = new Date().toISOString().slice(0, 10)
    const world = buildWorld({
      today,
      nowMs: Date.now(),
      settings: normalizeMfgSettings(settingsData as Partial<MfgSettings> | null),
      departments: ((departmentsData || []) as MfgDepartment[]).slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
      products: new Map(((productsData || []) as MfgProduct[]).map((p) => [p.id, p])),
      orders: ((ordersData || []) as WorkOrderV2[]).filter(isV2Order),
      notesByOrder: new Map(),
      salesOrders: new Map(),
      stops: [],
      notices: [],
      stock: null,
    })
    const out: Record<string, string> = {}
    for (const m of made) {
      const dates = m.orders.map((id) => world.viewById.get(id)?.possibleDate ?? null)
      if (dates.every((d): d is string => Boolean(d))) out[m.key] = dates.sort()[dates.length - 1]
    }
    return out
  }, [on, made, ordersData, productsData, departmentsData, settingsData])
}

/** By delivery id: the store a notice nobody has forwarded lands in, and the register's person there. */
export function useForwardFacts(orgId: string, receipts: ReceiptFact[], orders: PurchaseOrder[], policies: ProcurementPolicies): Record<string, { place: string | null; receiver: string | null }> {
  const firestore = useFirestore()
  const untold = useMemo(() => receipts.filter((r) => r.status === "pending_confirmation" && !noticeTold(r, policies)), [receipts, policies])
  const on = Boolean(firestore && orgId && untold.length)
  const { receivers } = useProcReceivers(on ? orgId : null)
  const projectsQ = useMemoFirebase(() => (firestore && on ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [on, firestore, orgId])
  const warehousesQ = useMemoFirebase(() => (firestore && on ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [on, firestore, orgId])
  const { data: projectsData } = useCollection(projectsQ)
  const { data: warehousesData } = useCollection(warehousesQ)
  return useMemo(() => {
    if (!on) return {}
    const projects = (projectsData || []) as Array<{ id: string; warehouseId?: string | null }>
    const names = new Map(((warehousesData || []) as Array<{ id: string; name?: string }>).map((w) => [w.id, w.name || ""]))
    const orderById = new Map(orders.map((o) => [o.id, o]))
    const out: Record<string, { place: string | null; receiver: string | null }> = {}
    for (const r of untold) {
      const po = r.poId ? orderById.get(r.poId) : undefined
      const landing = r.landedWarehouseId || landingWarehouseId(r.projectId || po?.projectId, projects, orgId)
      out[r.id] = { place: (landing && names.get(landing)) || null, receiver: suggestedReceiver(receivers, landing)?.name || null }
    }
    return out
  }, [on, untold, orders, projectsData, warehousesData, receivers, orgId])
}
