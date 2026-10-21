"use client"

// The org's open needs in one list (R-19, the RFQ form's «من الاحتياج المفتوح»): the stored incoming requests that still have a
// line to buy (a project's, the team's, a work order's shortfall) and the stock gaps — the same assembly the needs desk makes, read
// once for the form's picker. A request partly in hand is here for its remainder only. Off (`enabled` false) it reads nothing.

import { useMemo, useState } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useDoc, useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useIncomingDocs } from "@/hooks/useIncomingDocs"
import { useOrgStock } from "@/hooks/useOrgStock"
import type { ProcurementWorld } from "@/hooks/useProcurementWorld"
import { incomingNeeds, toLinkWorld } from "@/lib/procurement/incoming-need"
import { replyClockOf } from "@/lib/procurement/incoming-state"
import { sortNeeds, stockNeeds, type Need } from "@/lib/procurement/needs"
import { resolvePolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"

export function useOpenNeeds(world: Pick<ProcurementWorld, "orgId" | "rfqs" | "orders">, enabled: boolean): Need[] {
  const firestore = useFirestore()
  const orgId = enabled ? world.orgId : ""
  const [now] = useState(() => new Date())
  const warehousesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: warehousesData } = useCollection(warehousesQ)
  const warehouses = useMemo(() => (warehousesData || []) as Array<{ id: string; name?: string }>, [warehousesData])
  const stock = useOrgStock(warehouses, warehouses.length > 0)
  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PROCUREMENT_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settings } = useDoc(settingsRef)
  const incoming = useIncomingDocs(orgId || null, Boolean(orgId))

  return useMemo(() => {
    if (!enabled) return []
    const clock = replyClockOf(now, resolvePolicies(settings as Parameters<typeof resolvePolicies>[0]))
    const out: Need[] = incomingNeeds(incoming.docs, toLinkWorld(world.rfqs, world.orders), clock)
    const names = new Map(warehouses.map((w) => [w.id, w.name || ""]))
    const rows = Array.from(stock.byWarehouse.entries()).flatMap(([warehouseId, items]) => items.filter((r) => !r.isManufactured).map((r) => ({ ...r, warehouseId, warehouseName: names.get(warehouseId) || "" })))
    out.push(...stockNeeds(rows, { rfqs: world.rfqs, orders: world.orders }))
    return sortNeeds(out.filter((n) => n.state === "action" && n.lines.some((l) => !l.link)))
  }, [enabled, now, settings, incoming.docs, stock.byWarehouse, warehouses, world.rfqs, world.orders])
}
