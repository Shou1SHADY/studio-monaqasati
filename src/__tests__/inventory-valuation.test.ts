import {
  isManufacturedStock,
  orderWip,
  valuationShares,
  valueInventory,
  valueStock,
  type ValuationDeliveryNote,
  type ValuationStockRow,
  type ValuationWarehouse,
  type ValuationWorkOrder,
} from "@/lib/inventory-valuation"
import type { WorkOrderMaterial, WorkOrderScrap } from "@/lib/manufacturing-engine"
import { carriedValueFields } from "@/lib/warehouse-transfer"

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function material(
  requestNumber: string,
  state: WorkOrderMaterial["state"],
  quantity: number,
  unitCost: number | null
): WorkOrderMaterial {
  return {
    id: `${requestNumber}-${state}-${quantity}`,
    requestNumber,
    itemName: "رخام",
    unit: "m2",
    quantity,
    departmentId: "cut",
    lot: null,
    state,
    unitCost,
    warehouseId: "c1",
    requestedByUserId: "u",
    requestedByName: "u",
    requestedAt: "2026-09-01T08:00:00.000Z",
  }
}

function scrap(value: number, status: WorkOrderScrap["status"]): WorkOrderScrap {
  return {
    id: `SC-${value}-${status}`,
    quantity: 1,
    value,
    reason: "كسر",
    departmentId: "cut",
    raisedByUserId: "u",
    raisedByName: "u",
    raisedAt: "2026-09-02T08:00:00.000Z",
    status,
  }
}

function note(
  workOrderId: string,
  status: ValuationDeliveryNote["status"],
  quantity: number,
  unitCost: number | null,
  brokenQuantity = 0
): ValuationDeliveryNote {
  return { status, source: { workOrderId }, item: { quantity, unitCost }, brokenQuantity }
}

const input = (quantity: number, unitCost: number | null) => ({
  inventoryItemId: `inv-${quantity}-${unitCost}`,
  name: "حديد",
  quantity,
  unit: "kg",
  unitCost,
})

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

describe("valueStock", () => {
  it("recognises finished goods by either marker", () => {
    expect(isManufacturedStock({ isManufactured: true })).toBe(true)
    expect(isManufacturedStock({ sourceWorkOrderId: "wo-1" })).toBe(true)
    expect(isManufacturedStock({ isManufactured: false, sourceWorkOrderId: null })).toBe(false)
    expect(isManufacturedStock({})).toBe(false)
  })

  it("splits bought-in stock from manufactured stock and counts unpriced rows instead of valuing them at 0", () => {
    const rows: ValuationStockRow[] = [
      { warehouseId: "c1", quantity: 10, unitCost: 250 }, // 2,500
      { warehouseId: "c1", quantity: 1, unitCost: null }, // equipment, unpriced
      { warehouseId: "c1", quantity: 0, unitCost: null }, // empty row: holds nothing
      { warehouseId: "c1", quantity: 4, unitCost: 250, isManufactured: true, sourceWorkOrderId: "wo-1" }, // 1,000
      { warehouseId: "c1", quantity: 2, sourceWorkOrderId: "wo-2" }, // FG, unpriced
    ]
    expect(valueStock(rows)).toEqual({
      materials: { value: 2500, itemCount: 2, unpricedCount: 1 },
      finishedGoods: { value: 1000, itemCount: 2, unpricedCount: 1 },
    })
  })
})

// ---------------------------------------------------------------------------
// WIP per order
// ---------------------------------------------------------------------------

describe("orderWip — legacy orders", () => {
  const legacy: ValuationWorkOrder = {
    id: "wo-l",
    status: "open",
    inputs: [input(5, 100), input(2, 25)],
    materialCost: 550,
  }

  it("holds the drawn inputs at snapshot cost until the handover is signed for", () => {
    expect(orderWip(legacy, [])).toMatchObject({ value: 550, holdsWip: true, unpriced: false })
    // Finished in the workshop, note still on the road: still WIP.
    const done = { ...legacy, status: "done" as const, deliveredTo: { warehouseId: "c1", warehouseName: "c", kind: "central" as const }, deliveryNoteId: "dn" }
    expect(orderWip(done, [note("wo-l", "in_transit", 2, 275)]).value).toBe(550)
    // Refused at the door: the order is back to "finished, undelivered".
    expect(orderWip({ ...legacy, status: "done" }, [note("wo-l", "rejected", 2, 275)]).value).toBe(550)
  })

  it("empties exactly on a received note, even when materialCost ÷ quantity rounded", () => {
    // 1,000 over 3 doors → unitCost 333.33 → 999.99 landed; no 0.01 left behind.
    const order: ValuationWorkOrder = { id: "wo-r", status: "done", inputs: [input(10, 100)], materialCost: 1000, deliveryNoteId: "dn" }
    expect(orderWip(order, [note("wo-r", "received", 3, 333.33)])).toMatchObject({ value: 0, holdsWip: false })
  })

  it("treats orders delivered before delivery notes existed as handed over", () => {
    const order: ValuationWorkOrder = {
      id: "wo-old",
      status: "done",
      inputs: [input(2, 50)],
      deliveredTo: { warehouseId: "out", warehouseName: "توزيع", kind: "outbound" },
      deliveryNoteId: null,
    }
    expect(orderWip(order, []).holdsWip).toBe(false)
  })

  it("flags an unpriced input and ignores orders that drew nothing", () => {
    const order: ValuationWorkOrder = { id: "wo-u", status: "open", inputs: [input(3, 100), input(1, null)], materialCost: 300 }
    expect(orderWip(order, [])).toMatchObject({ value: 300, holdsWip: true, unpriced: true })
    expect(orderWip({ id: "wo-q", status: "open", inputs: [] }, []).holdsWip).toBe(false)
  })

  it("counts nothing for a cancelled order", () => {
    const order: ValuationWorkOrder = { id: "wo-x", status: "cancelled", inputs: [input(10, 100)], materialCost: 1000 }
    expect(orderWip(order, [])).toMatchObject({ value: 0, holdsWip: false, unpriced: false })
  })
})

describe("orderWip — v2 orders", () => {
  it("holds received withdrawals minus received notes (net of breakage) and approved scrap", () => {
    const order: ValuationWorkOrder = {
      id: "wo-v2",
      status: "open",
      productId: "prd",
      materials: [
        material("MW-1", "received", 20, 150), // 3,000
        material("MW-2", "received", 10, 40), //    400
        material("MW-3", "released", 5, 150), //   750 — off the shelf, not signed for
        material("MW-4", "requested", 3, 150), //  nothing moved yet
      ],
      scrapRecords: [scrap(200, "approved"), scrap(999, "pending")],
    }
    const notes = [
      note("wo-v2", "received", 4, 480, 1), // net 3 × 480 = 1,440 left WIP
      note("wo-v2", "in_transit", 2, 480), // still WIP until signed for
      note("wo-v2", "rejected", 1, 480),
      note("someone-else", "received", 50, 10),
    ]
    // 3,400 − 1,440 − 200 = 1,760
    expect(orderWip(order, notes)).toEqual({
      value: 1760,
      holdsWip: true,
      unpriced: false,
      released: { value: 750, lines: 1, unpricedLines: 0 },
    })
  })

  it("never goes negative when labour and overhead capitalised into the note exceed the materials drawn", () => {
    const order: ValuationWorkOrder = {
      id: "wo-lab",
      status: "open",
      productId: "prd",
      materials: [material("MW-1", "received", 10, 50)], // 500
    }
    // 2 × 400 = 800 handed over (materials + labour + overhead).
    expect(orderWip(order, [note("wo-lab", "received", 2, 400)])).toMatchObject({ value: 0, holdsWip: true })
  })

  it("drops a residual within the note's unitCost rounding once the order is done", () => {
    const order: ValuationWorkOrder = {
      id: "wo-rnd",
      status: "done",
      productId: "prd",
      materials: [material("MW-1", "received", 1, 1000)],
    }
    // 3 × 333.33 = 999.99 → 0.01 left ≤ 3 × 0.005
    expect(orderWip(order, [note("wo-rnd", "received", 3, 333.33)])).toMatchObject({ value: 0, holdsWip: false })
  })

  it("flags unpriced received lines and counts nothing for a cancelled order", () => {
    const open: ValuationWorkOrder = {
      id: "wo-up",
      status: "open",
      productId: "prd",
      materials: [material("MW-1", "received", 2, null), material("MW-2", "received", 4, 25), material("MW-3", "released", 1, null)],
    }
    expect(orderWip(open, [])).toEqual({
      value: 100,
      holdsWip: true,
      unpriced: true,
      released: { value: 0, lines: 1, unpricedLines: 1 },
    })
    const cancelled: ValuationWorkOrder = { ...open, id: "wo-cx", status: "cancelled" }
    expect(orderWip(cancelled, [])).toMatchObject({ value: 0, holdsWip: false, released: { value: 0, lines: 0 } })
  })
})

// ---------------------------------------------------------------------------
// The org
// ---------------------------------------------------------------------------

describe("valueInventory", () => {
  const warehouses: ValuationWarehouse[] = [
    { id: "c1", name: "المستودع المركزي", isCentral: true },
    { id: "p1", name: "مستودع المشروع", projectId: "proj-1" },
    { id: "out", name: "مستودع التوزيع", isOutbound: true },
  ]

  const stock: ValuationStockRow[] = [
    { warehouseId: "c1", quantity: 10, unitCost: 250 }, // rebar 2,500
    { warehouseId: "c1", quantity: 40, unitCost: 20 }, //  cement  800
    { warehouseId: "c1", quantity: 1, unitCost: null }, // excavator, unpriced
    { warehouseId: "c1", quantity: 0, unitCost: null }, // empty row
    { warehouseId: "p1", quantity: 5, unitCost: 30 }, //   sand    150
    { warehouseId: "out", quantity: 4, unitCost: 250, isManufactured: true, sourceWorkOrderId: "wo-legacy-done" }, // 1,000
    { warehouseId: "p1", quantity: 3, unitCost: 480, isManufactured: true, sourceWorkOrderId: "wo-v2" }, //           1,440
    { warehouseId: "p1", quantity: 2, unitCost: null, sourceWorkOrderId: "wo-migrated" }, //                        unpriced FG
  ]

  const orders: ValuationWorkOrder[] = [
    { id: "wo-legacy-open", status: "open", inputs: [input(5, 100), input(2, 25)], materialCost: 550 }, // 550
    { id: "wo-legacy-done", status: "done", inputs: [input(10, 100)], materialCost: 1000, deliveryNoteId: "dn-1" }, // 0
    { id: "wo-legacy-transit", status: "done", inputs: [input(3, 100), input(1, null)], materialCost: 300, deliveryNoteId: "dn-2" }, // 300, unpriced
    { id: "wo-legacy-rejected", status: "done", inputs: [input(4, 30)], materialCost: 120 }, // 120
    {
      id: "wo-legacy-old",
      status: "done",
      inputs: [input(2, 50)],
      deliveredTo: { warehouseId: "out", warehouseName: "مستودع التوزيع", kind: "outbound" },
    }, // 0
    { id: "wo-quote", status: "open", inputs: [] }, // drew nothing
    { id: "wo-cancelled", status: "cancelled", inputs: [input(10, 100)], materialCost: 1000 }, // nothing
    {
      id: "wo-v2",
      status: "open",
      productId: "prd",
      materials: [
        material("MW-1", "received", 20, 150),
        material("MW-2", "received", 10, 40),
        material("MW-3", "released", 5, 150), // 750 in hand-over → materials
        material("MW-4", "requested", 3, 150),
      ],
      scrapRecords: [scrap(200, "approved"), scrap(999, "pending")],
    }, // 1,760
    {
      id: "wo-v2-cancelled",
      status: "cancelled",
      productId: "prd",
      materials: [material("MW-9", "received", 10, 100), material("MW-10", "released", 10, 100)],
    }, // nothing, not even the released line
    { id: "wo-v2-labour", status: "open", productId: "prd", materials: [material("MW-5", "received", 10, 50)] }, // 0, still in production
    { id: "wo-v2-round", status: "done", productId: "prd", materials: [material("MW-6", "received", 1, 1000)] }, // 0
    {
      id: "wo-v2-unpriced",
      status: "open",
      productId: "prd",
      materials: [material("MW-7", "received", 2, null), material("MW-8", "received", 4, 25), material("MW-11", "released", 1, null)],
    }, // 100, unpriced; one unpriced released line
  ]

  const notes: ValuationDeliveryNote[] = [
    note("wo-legacy-done", "received", 4, 250),
    note("wo-legacy-transit", "in_transit", 1, 300),
    note("wo-legacy-rejected", "rejected", 2, 60),
    note("wo-v2", "received", 4, 480, 1),
    note("wo-v2", "in_transit", 2, 480),
    note("wo-v2", "rejected", 1, 480),
    note("wo-v2-labour", "received", 2, 400),
    note("wo-v2-round", "received", 3, 333.33),
  ]

  const v = valueInventory({ stock, warehouses, orders, notes })

  it("values construction materials: shelf stock plus withdrawals released but not yet signed for", () => {
    // shelf 2,500 + 800 + 150 = 3,450; released 750 → 4,200
    expect(v.materials).toEqual({
      value: 4200,
      itemCount: 4,
      unpricedCount: 2, // the excavator + one unpriced released line
      releasedValue: 750,
      releasedLines: 2,
    })
  })

  it("values work in progress across legacy and v2 orders, leaving cancelled orders out", () => {
    // 550 + 300 + 120 + 1,760 + 0 + 100
    expect(v.wip).toEqual({ value: 2830, orderCount: 6, unpricedOrders: 2 })
  })

  it("values finished goods wherever they landed", () => {
    expect(v.finishedGoods).toEqual({ value: 2440, itemCount: 3, unpricedCount: 1 })
  })

  it("totals the three segments", () => {
    expect(v.total).toBe(9470)
    expect(v.total).toBe(v.materials.value + v.wip.value + v.finishedGoods.value)
  })

  it("breaks the shelf stock down per warehouse", () => {
    expect(v.byWarehouse).toEqual([
      { warehouseId: "c1", warehouseName: "المستودع المركزي", kind: "central", materials: 3300, finishedGoods: 0 },
      { warehouseId: "p1", warehouseName: "مستودع المشروع", kind: "project", materials: 150, finishedGoods: 1440 },
      { warehouseId: "out", warehouseName: "مستودع التوزيع", kind: "outbound", materials: 0, finishedGoods: 1000 },
    ])
  })

  it("keeps the total unchanged as value moves shelf → released → WIP → finished goods", () => {
    const wh = [{ id: "c1", isCentral: true }, { id: "out", isOutbound: true }]
    const base = { id: "wo", status: "open" as const, productId: "prd" }

    const onShelf = valueInventory({ stock: [{ warehouseId: "c1", quantity: 20, unitCost: 150 }], warehouses: wh, orders: [] })
    const released = valueInventory({
      stock: [{ warehouseId: "c1", quantity: 0, unitCost: 150 }],
      warehouses: wh,
      orders: [{ ...base, materials: [material("MW-1", "released", 20, 150)] }],
    })
    const inWip = valueInventory({
      stock: [{ warehouseId: "c1", quantity: 0, unitCost: 150 }],
      warehouses: wh,
      orders: [{ ...base, materials: [material("MW-1", "received", 20, 150)] }],
    })
    const shipped = valueInventory({
      stock: [{ warehouseId: "c1", quantity: 0, unitCost: 150 }],
      warehouses: wh,
      orders: [{ ...base, materials: [material("MW-1", "received", 20, 150)] }],
      notes: [note("wo", "in_transit", 10, 300)],
    })
    const landed = valueInventory({
      stock: [
        { warehouseId: "c1", quantity: 0, unitCost: 150 },
        { warehouseId: "out", quantity: 10, unitCost: 300, isManufactured: true, sourceWorkOrderId: "wo" },
      ],
      warehouses: wh,
      orders: [{ ...base, status: "done", materials: [material("MW-1", "received", 20, 150)] }],
      notes: [note("wo", "received", 10, 300)],
    })

    expect([onShelf, released, inWip, shipped, landed].map((x) => x.total)).toEqual([3000, 3000, 3000, 3000, 3000])
    expect([onShelf.materials.value, onShelf.wip.value, onShelf.finishedGoods.value]).toEqual([3000, 0, 0])
    expect([released.materials.value, released.wip.value, released.finishedGoods.value]).toEqual([3000, 0, 0])
    expect([inWip.materials.value, inWip.wip.value, inWip.finishedGoods.value]).toEqual([0, 3000, 0])
    expect([shipped.materials.value, shipped.wip.value, shipped.finishedGoods.value]).toEqual([0, 3000, 0])
    expect([landed.materials.value, landed.wip.value, landed.finishedGoods.value]).toEqual([0, 0, 3000])
  })

  it("is all zeros for an org with nothing in stock", () => {
    const empty = valueInventory({ stock: [] })
    expect(empty.total).toBe(0)
    expect(empty.wip).toEqual({ value: 0, orderCount: 0, unpricedOrders: 0 })
    expect(empty.byWarehouse).toEqual([])
  })
})

describe("valuationShares", () => {
  const seg = (value: number) => ({ value })

  it("rounds to whole percents that add up to 100", () => {
    // 4,200 / 2,830 / 2,440 of 9,470 → 44.35 / 29.88 / 25.77
    const s = valuationShares({
      materials: seg(4200),
      wip: seg(2830),
      finishedGoods: seg(2440),
    })
    expect(s).toEqual({ materials: 44, wip: 30, finishedGoods: 26 })
    const thirds = valuationShares({ materials: seg(1), wip: seg(1), finishedGoods: seg(1) })
    expect(thirds.materials + thirds.wip + thirds.finishedGoods).toBe(100)
  })

  it("is zero everywhere when there is no value, and never hands a point to an empty segment", () => {
    expect(valuationShares({ materials: seg(0), wip: seg(0), finishedGoods: seg(0) })).toEqual({
      materials: 0,
      wip: 0,
      finishedGoods: 0,
    })
    expect(valuationShares({ materials: seg(500), wip: seg(0), finishedGoods: seg(0) })).toEqual({
      materials: 100,
      wip: 0,
      finishedGoods: 0,
    })
  })
})

describe("carriedValueFields — stock moved between warehouses keeps its value", () => {
  it("carries the unit cost and the finished-goods marker, and adds nothing a row never had", () => {
    expect(
      carriedValueFields({ unitCost: 480, isManufactured: true, sourceWorkOrderId: "wo-v2", sourceWorkOrderNumber: 12 })
    ).toEqual({ unitCost: 480, isManufactured: true, sourceWorkOrderId: "wo-v2", sourceWorkOrderNumber: 12 })
    expect(carriedValueFields({ unitCost: 20 })).toEqual({ unitCost: 20 })
    expect(carriedValueFields({ unitCost: null, isManufactured: false })).toEqual({})
    expect(carriedValueFields(undefined)).toEqual({})
  })

  it("so a finished item moved to a project warehouse is still finished goods at cost", () => {
    const moved = { warehouseId: "p1", quantity: 3, ...carriedValueFields({ unitCost: 480, isManufactured: true, sourceWorkOrderId: "wo-v2" }) }
    expect(valueStock([moved]).finishedGoods).toEqual({ value: 1440, itemCount: 1, unpricedCount: 0 })
  })
})
