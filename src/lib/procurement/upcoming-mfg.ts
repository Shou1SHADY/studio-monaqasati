// «قادمة» from the workshop (Procurement 2.0, INC-06 — the prototype's «أمر تشغيل مخطط: لا يكفي ما في مستودع الورشة»): a work order
// that is planned (not released yet) whose materials the stores cannot cover after every released order took its share. It reaches
// Incoming as the workshop's shortfall once the order is released and the workshop manager asks for it; until then it is read here,
// for preparing. Pure — over the same engine the workshop runs (allocation in queue order, never double-spent).

import { allocateStock, itemKey, needRemain, queueOrder, requestedItems, type DeptCapacityFields, type MfgProduct, type OrderCalc, type StockIndex } from "../manufacturing-engine"
import { calcOf, isV2Order, type WorkOrderV2 } from "../manufacturing-writes"
import { orderRef } from "../manufacturing-view"
import { workOrderWatchKey, type UpcomingItem } from "./upcoming"

const r3 = (n: number) => Math.round(n * 1000) / 1000

export function upcomingFromWorkOrders(input: { orders: ReadonlyArray<WorkOrderV2>; products: ReadonlyMap<string, MfgProduct>; departments: DeptCapacityFields[]; stock: StockIndex }): UpcomingItem[] {
  const calcs: OrderCalc[] = []
  const byId = new Map<string, WorkOrderV2>()
  for (const o of input.orders) {
    if (!isV2Order(o)) continue
    const p = input.products.get(o.productId || "")
    if (!p) continue
    const c = calcOf(o, p, input.departments, [])
    if (!c.live) continue
    calcs.push(c)
    byId.set(o.id, o)
  }
  // What released orders already hold is theirs; the planned ones draw on what is left, in the workshop's own queue order.
  const free = new Map(allocateStock(calcs, input.stock).free)
  const out: UpcomingItem[] = []
  for (const c of calcs.filter((x) => !x.released).sort(queueOrder)) {
    const o = byId.get(c.slice.id) as WorkOrderV2
    const lines: UpcomingItem["lines"] = []
    for (const it of requestedItems(c.product)) {
      const k = itemKey(it.itemName)
      const need = needRemain(c, it.itemName)
      if (!(need > 0)) continue
      const have = Math.max(0, free.get(k) || 0)
      const short = r3(need - have)
      free.set(k, r3(have - Math.min(have, need)))
      if (short > 0) lines.push({ name: it.itemName, unit: it.unit, qty: short })
    }
    if (!lines.length) continue
    const no = orderRef(o)
    out.push({
      key: workOrderWatchKey(o.id),
      kind: "workorder",
      ref: null,
      place: c.product.name,
      by: null,
      since: null,
      lines,
      needBy: c.slice.neededBy ? c.slice.neededBy.slice(0, 10) : null,
      stock: null,
      workOrder: { no, product: c.product.name },
    })
  }
  return out
}
