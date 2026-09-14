// Inventory valuation (قيمة المخزون) — what the company's stock is worth, in
// the three parts the general ledger keeps it in:
//
//   مواد إنشائية        construction materials   110401
//   بضاعة تحت التصنيع   work in progress (WIP)   110402
//   بضاعة تامة الصنع    finished goods           110403
//
// Pure: no Firestore. The hook (useInventoryValuation) reads the rows; every
// rule about which value sits where lives here, next to its tests.
//
// The value follows the same moments as the posting rules, so the operational
// figure and the books tell one story:
//
//   * Buying in lands on the shelf → materials.
//   * Materials drawn into manufacturing leave materials and enter WIP —
//     a legacy order at creation (its `inputs` snapshot), a v2 order when the
//     station SIGNS for a withdrawal (state "received"). A v2 withdrawal the
//     storekeeper has released but the station hasn't signed for is already
//     off the shelf yet still raw-materials value in the ledger, so it is
//     counted in materials (as `releasedValue`) — value never vanishes in the
//     gap between the two signatures.
//   * The finished output leaves WIP only when the receiving warehouse signs
//     the delivery note ("received"). A note still in transit stays in WIP; a
//     rejected note never left it.
//   * Once landed, the manufactured row is finished goods at its unitCost.
//   * Approved scrap leaves WIP as a production cost (postMfgScrap).
//   * A cancelled order counts for nothing: cancelling doesn't return stock,
//     and whatever it held is not work anyone is still doing.

import { round2 } from "./manufacturing-engine"
import type { WorkOrderMaterial, WorkOrderScrap } from "./manufacturing-engine"
import type { WorkOrderDelivery, WorkOrderInputItem, WorkOrderStatus } from "./manufacturing"
import type { DeliveryNoteStatus } from "./delivery-notes"

// ---------------------------------------------------------------------------
// Inputs — structural slices, so Firestore docs and test fixtures both fit
// ---------------------------------------------------------------------------

export interface ValuationStockRow {
  warehouseId: string
  quantity?: number | null
  /** Cost of one unit in SAR; null/absent = unpriced (counted, never valued at 0). */
  unitCost?: number | null
  /** Stamped on every row a delivery note lands (both the legacy and v2 paths). */
  isManufactured?: boolean | null
  sourceWorkOrderId?: string | null
}

export interface ValuationWarehouse {
  id: string
  name?: string | null
  isCentral?: boolean | null
  /** The virtual distribution warehouse — finished goods awaiting a destination. */
  isOutbound?: boolean | null
  projectId?: string | null
}

export interface ValuationWorkOrder {
  id: string
  status: WorkOrderStatus
  /** Present on v2 (product-born) orders only. */
  productId?: string | null
  /** Legacy: raw materials drawn from stock at creation, cost snapshotted. */
  inputs?: WorkOrderInputItem[] | null
  materialCost?: number | null
  /** v2: per-station withdrawals (requested → released → received). */
  materials?: WorkOrderMaterial[] | null
  scrapRecords?: WorkOrderScrap[] | null
  /** Legacy: where the output went. Orders delivered before delivery notes
   * existed carry this and no `deliveryNoteId`. */
  deliveredTo?: WorkOrderDelivery | null
  deliveryNoteId?: string | null
}

export interface ValuationDeliveryNote {
  status: DeliveryNoteStatus
  source: { workOrderId: string }
  item: { quantity: number; unitCost: number | null }
  /** v2: broken on arrival — only the net quantity landed. */
  brokenQuantity?: number | null
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface StockSegment {
  value: number
  /** Rows actually holding stock (quantity > 0). */
  itemCount: number
  /** Of those, rows with no unitCost — their value is unknown, not zero. */
  unpricedCount: number
}

export interface MaterialsSegment extends StockSegment {
  /** Part of `value`: v2 withdrawals released from the shelf, not yet signed
   * for by the station. `unpricedCount` includes their unpriced lines. */
  releasedValue: number
  releasedLines: number
}

export interface WipSegment {
  value: number
  /** Orders still holding drawn materials in production. */
  orderCount: number
  /** Of those, orders with a drawn line (or a received note) that has no cost. */
  unpricedOrders: number
}

export interface WarehouseValuation {
  warehouseId: string
  warehouseName: string
  kind: "central" | "project" | "outbound" | "other"
  materials: number
  finishedGoods: number
}

export interface InventoryValuation {
  materials: MaterialsSegment
  wip: WipSegment
  finishedGoods: StockSegment
  total: number
  byWarehouse: WarehouseValuation[]
}

// ---------------------------------------------------------------------------
// Stock rows
// ---------------------------------------------------------------------------

/** Finished goods are recognised by either marker — every landing path writes
 * both, but a hand-edited or migrated row may keep only one. */
export function isManufacturedStock(row: Pick<ValuationStockRow, "isManufactured" | "sourceWorkOrderId">): boolean {
  return row.isManufactured === true || !!row.sourceWorkOrderId
}

const qtyOf = (n: number | null | undefined): number => {
  const q = Number(n)
  return Number.isFinite(q) && q > 0 ? q : 0
}

const isPriced = (cost: number | null | undefined): cost is number =>
  cost != null && Number.isFinite(Number(cost))

function emptyStock(): StockSegment {
  return { value: 0, itemCount: 0, unpricedCount: 0 }
}

/**
 * One warehouse's (or the whole org's) stock, split into materials and
 * finished goods. Everything not manufactured is "materials" whatever section
 * it is filed under (materials, equipment, a custom type): it was bought in,
 * and the ledger holds all of it in the one raw-materials account. Rows at
 * zero quantity hold nothing and are not counted.
 */
export function valueStock(rows: ValuationStockRow[]): { materials: StockSegment; finishedGoods: StockSegment } {
  const materials = emptyStock()
  const finishedGoods = emptyStock()
  for (const row of rows) {
    const q = qtyOf(row.quantity)
    if (q === 0) continue
    const seg = isManufacturedStock(row) ? finishedGoods : materials
    seg.itemCount += 1
    if (isPriced(row.unitCost)) seg.value += q * Number(row.unitCost)
    else seg.unpricedCount += 1
  }
  materials.value = round2(materials.value)
  finishedGoods.value = round2(finishedGoods.value)
  return { materials, finishedGoods }
}

// ---------------------------------------------------------------------------
// Work in progress — per order
// ---------------------------------------------------------------------------

export interface OrderWip {
  value: number
  /** The order still holds drawn materials in production. */
  holdsWip: boolean
  unpriced: boolean
  /** v2 withdrawals off the shelf but not yet signed for (materials side). */
  released: { value: number; lines: number; unpricedLines: number }
}

const NO_WIP: OrderWip = { value: 0, holdsWip: false, unpriced: false, released: { value: 0, lines: 0, unpricedLines: 0 } }

/**
 * What one order holds in WIP.
 *
 * Legacy order: its drawn `inputs` at snapshot cost until the handover is
 * signed for. A legacy order hands its whole output over on a single note
 * whose unitCost is materialCost ÷ output quantity, so a received note empties
 * it exactly (no halala left behind by that division's rounding). Orders
 * delivered before delivery notes existed (`deliveredTo` with no note) are
 * handed over too.
 *
 * v2 order: received withdrawals at cost, minus unitCost × net quantity on
 * every RECEIVED note, minus approved scrap. The note's unitCost is the
 * order's cost so far — materials PLUS labour and overhead — spread over the
 * order quantity, so what leaves can exceed what entered: labour is
 * capitalised into finished goods at the handover (the same value the ledger
 * moves), not accrued into WIP along the way. The per-order figure is
 * therefore floored at 0, and a residual within the unitCost rounding
 * (≤ half a halala per unit handed over) is treated as 0.
 */
export function orderWip(order: ValuationWorkOrder, notes: ValuationDeliveryNote[]): OrderWip {
  if (order.status === "cancelled") return NO_WIP
  const mine = notes.filter((n) => n.source?.workOrderId === order.id)
  const received = mine.filter((n) => n.status === "received")

  if (!order.productId) {
    const inputs = (order.inputs || []).filter((i) => qtyOf(i.quantity) > 0)
    let drawn = 0
    let unpriced = false
    if (inputs.length > 0) {
      for (const i of inputs) {
        if (isPriced(i.unitCost)) drawn += qtyOf(i.quantity) * Number(i.unitCost)
        else unpriced = true
      }
    } else if (isPriced(order.materialCost) && Number(order.materialCost) > 0) {
      drawn = Number(order.materialCost)
    }
    const hasDrawn = inputs.length > 0 || drawn > 0
    const deliveredBeforeNotes = !!order.deliveredTo && !order.deliveryNoteId && mine.length === 0
    const handedOver = received.length > 0 || deliveredBeforeNotes
    if (!hasDrawn || handedOver) return NO_WIP
    return { value: round2(drawn), holdsWip: true, unpriced, released: NO_WIP.released }
  }

  let drawn = 0
  let unpriced = false
  let hasReceived = false
  const released = { value: 0, lines: 0, unpricedLines: 0 }
  for (const m of order.materials || []) {
    const q = qtyOf(m.quantity)
    if (q === 0) continue
    if (m.state === "received") {
      hasReceived = true
      if (isPriced(m.unitCost)) drawn += q * Number(m.unitCost)
      else unpriced = true
    } else if (m.state === "released") {
      released.lines += 1
      if (isPriced(m.unitCost)) released.value += q * Number(m.unitCost)
      else released.unpricedLines += 1
    }
  }
  released.value = round2(released.value)

  let handedValue = 0
  let handedQty = 0
  for (const n of received) {
    const net = Math.max(0, qtyOf(n.item?.quantity) - qtyOf(n.brokenQuantity))
    handedQty += net
    if (isPriced(n.item?.unitCost)) handedValue += net * Number(n.item.unitCost)
    else if (net > 0) unpriced = true
  }
  const scrapValue = (order.scrapRecords || [])
    .filter((s) => s.status === "approved")
    .reduce((a, s) => a + (Number(s.value) || 0), 0)

  const raw = drawn - handedValue - scrapValue
  const value = raw <= handedQty * 0.005 + 1e-6 ? 0 : round2(raw)
  const holdsWip = hasReceived && (order.status === "open" || value > 0)
  return { value: holdsWip ? value : 0, holdsWip, unpriced: holdsWip && unpriced, released }
}

// ---------------------------------------------------------------------------
// The whole org
// ---------------------------------------------------------------------------

export function warehouseKind(w: ValuationWarehouse | undefined): WarehouseValuation["kind"] {
  if (!w) return "other"
  if (w.isOutbound) return "outbound"
  if (w.isCentral) return "central"
  if (w.projectId) return "project"
  return "other"
}

export function valueInventory(input: {
  stock: ValuationStockRow[]
  warehouses?: ValuationWarehouse[]
  orders?: ValuationWorkOrder[]
  notes?: ValuationDeliveryNote[]
}): InventoryValuation {
  const orders = input.orders || []
  const notes = input.notes || []
  const warehouses = input.warehouses || []

  const { materials: shelf, finishedGoods } = valueStock(input.stock)
  const materials: MaterialsSegment = { ...shelf, releasedValue: 0, releasedLines: 0 }
  const wip: WipSegment = { value: 0, orderCount: 0, unpricedOrders: 0 }

  for (const order of orders) {
    const w = orderWip(order, notes)
    materials.releasedValue += w.released.value
    materials.releasedLines += w.released.lines
    materials.unpricedCount += w.released.unpricedLines
    if (!w.holdsWip) continue
    wip.value += w.value
    wip.orderCount += 1
    if (w.unpriced) wip.unpricedOrders += 1
  }
  materials.releasedValue = round2(materials.releasedValue)
  materials.value = round2(materials.value + materials.releasedValue)
  wip.value = round2(wip.value)

  const byId = new Map(warehouses.map((w) => [w.id, w]))
  const rowsByWarehouse = new Map<string, ValuationStockRow[]>()
  for (const w of warehouses) rowsByWarehouse.set(w.id, [])
  for (const row of input.stock) {
    const list = rowsByWarehouse.get(row.warehouseId)
    if (list) list.push(row)
    else rowsByWarehouse.set(row.warehouseId, [row])
  }
  const byWarehouse: WarehouseValuation[] = [...rowsByWarehouse.entries()].map(([warehouseId, rows]) => {
    const split = valueStock(rows)
    const w = byId.get(warehouseId)
    return {
      warehouseId,
      warehouseName: w?.name || "",
      kind: warehouseKind(w),
      materials: split.materials.value,
      finishedGoods: split.finishedGoods.value,
    }
  })

  return {
    materials,
    wip,
    finishedGoods,
    total: round2(materials.value + wip.value + finishedGoods.value),
    byWarehouse,
  }
}

/** Whole-percent shares of the total that always add up to 100 (largest
 * remainder), so the three rows never read 33 + 33 + 33. All zero when the
 * total is zero. */
export function valuationShares(v: {
  materials: { value: number }
  wip: { value: number }
  finishedGoods: { value: number }
}): {
  materials: number
  wip: number
  finishedGoods: number
} {
  const values = [v.materials.value, v.wip.value, v.finishedGoods.value].map((x) => Math.max(0, x))
  const total = values.reduce((a, x) => a + x, 0)
  if (total <= 0) return { materials: 0, wip: 0, finishedGoods: 0 }
  const exact = values.map((x) => (x / total) * 100)
  const floors = exact.map(Math.floor)
  let left = 100 - floors.reduce((a, x) => a + x, 0)
  const order = exact.map((x, i) => ({ i, rem: x - floors[i] })).sort((a, b) => b.rem - a.rem)
  for (const { i } of order) {
    if (left <= 0) break
    if (values[i] > 0) {
      floors[i] += 1
      left -= 1
    }
  }
  return { materials: floors[0], wip: floors[1], finishedGoods: floors[2] }
}
