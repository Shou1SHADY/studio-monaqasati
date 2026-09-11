/**
 * The manufacturing v2 engine's proof: a work order is a quantity on a route,
 * every unit is somewhere and the sum closes; blocking facts gate the saw;
 * planned waste is part of the need; the achievable date falls out of capacity
 * and queues; cost is built from real movements; and make-or-buy is a computed
 * verdict, not an opinion.
 */

import {
  DEFAULT_MFG_SETTINGS,
  activeIndexes,
  addDaysISO,
  atSiteQty,
  bottleneck,
  brokenQty,
  brokenUndecided,
  buildDecisions,
  buildEstimateLines,
  currentIndex,
  daysFrom,
  deliveredQty,
  deptCapacity,
  emptyProgress,
  estimateCost,
  exitIndex,
  finishedQty,
  fitQty,
  hourVariance,
  hoursTotal,
  inAt,
  isDoneV2,
  labourCostOf,
  marginPercent,
  materialCostOf,
  materialNeed,
  materialShortages,
  materialState,
  minPriceFor,
  normalizeMfgSettings,
  orderCost,
  outQty,
  overheadCostOf,
  pendingAt,
  possibleForDays,
  readyQty,
  releaseBlocks,
  remainAt,
  scheduleOrders,
  scrapApprovedQty,
  scrapPendingQty,
  shippedQty,
  standardCost,
  stationBlocks,
  stationLoadHours,
  stationQueueDays,
  unitSunkCost,
  verdict,
  wasteFactor,
  wipQty,
  type DeptCapacityFields,
  type MfgNoteSlice,
  type MfgOrderSlice,
  type MfgProduct,
  type ScheduleInput,
  type WorkOrderMaterial,
} from "@/lib/manufacturing-engine"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const dept = (id: string, workers = 2, hoursPerDay = 8, hourlyRate = 60): DeptCapacityFields => ({
  id,
  workers,
  hoursPerDay,
  hourlyRate,
})

const DEPTS: DeptCapacityFields[] = [dept("d1"), dept("d2"), dept("d3"), dept("d4"), dept("d5", 4)]

const SETTINGS = DEFAULT_MFG_SETTINGS

const PRODUCT: MfgProduct = {
  id: "p1",
  organizationId: "org1",
  name: "كاونتر رخام",
  unit: "م²",
  family: "stone",
  requiresMeasurement: true,
  requiresDrawingApproval: true,
  requiresSlabApproval: true,
  wastePercent: 25,
  salePrice: 1150,
  estimateValue: 735,
  referenceBuyPrice: 850,
  route: [
    { departmentId: "d1", departmentName: "التصميم", hoursPerUnit: 0.1 },
    { departmentId: "d2", departmentName: "القص", hoursPerUnit: 0.3 },
    { departmentId: "d3", departmentName: "التلميع", hoursPerUnit: 0.2 },
    { departmentId: "d4", departmentName: "الفحص والتغليف", hoursPerUnit: 0.1 },
    { departmentId: "d5", departmentName: "التركيب", hoursPerUnit: 0.5, onSite: true },
  ],
  bom: [
    { itemName: "رخام كريمة", unit: "م²", qtyPerUnit: 1, departmentId: "d2", withWaste: true, unitCost: 320, lotted: true },
    { itemName: "غراء إيبوكسي", unit: "عبوة", qtyPerUnit: 0.1, departmentId: "d3", withWaste: false, unitCost: 95 },
    { itemName: "صندوق خشبي", unit: "صندوق", qtyPerUnit: 0.05, departmentId: "d4", withWaste: false, unitCost: 85 },
  ],
}

function order(over: Partial<MfgOrderSlice> = {}): MfgOrderSlice {
  return {
    id: "o1",
    productId: "p1",
    quantity: 10,
    neededBy: "2026-09-20",
    createdAt2: "2026-09-01T08:00:00Z",
    releasedAt: "2026-09-02T08:00:00Z",
    measurement: { at: "2026-09-01", by: "أبو سامي" },
    drawingApprovalStatus: "approved",
    slabApproval: { at: "2026-09-02", by: "العميل", lot: "BLK-1" },
    rush: null,
    progress: emptyProgress(PRODUCT.route),
    materials: [],
    scrap: [],
    shortfall: 0,
    brokenResolved: 0,
    status: "open",
    sourceQuotationId: null,
    sourceQuotationWon: null,
    ...over,
  }
}

const mat = (over: Partial<WorkOrderMaterial>): WorkOrderMaterial => ({
  id: "m1",
  requestNumber: "MW-1",
  itemName: "رخام كريمة",
  unit: "م²",
  quantity: 12.5,
  departmentId: "d2",
  lot: "BLK-1",
  state: "received",
  unitCost: 320,
  warehouseId: "w1",
  requestedByUserId: "u1",
  requestedByName: "أبو عمار",
  requestedAt: "2026-09-02T09:00:00Z",
  ...over,
})

const note = (quantity: number, status: MfgNoteSlice["status"], broken = 0): MfgNoteSlice => ({
  quantity,
  brokenQuantity: broken,
  status,
})

// ---------------------------------------------------------------------------
// Settings & basics
// ---------------------------------------------------------------------------

describe("settings", () => {
  it("normalizes a partial doc over the defaults", () => {
    const s = normalizeMfgSettings({ features: { time: false } as never, scrapApprovalLimit: 5000 })
    expect(s.features.time).toBe(false)
    expect(s.features.estimates).toBe(true)
    expect(s.scrapApprovalLimit).toBe(5000)
    expect(s.overheadRatePerHour).toBe(32)
    expect(normalizeMfgSettings(null)).toEqual(DEFAULT_MFG_SETTINGS)
  })

  it("waste factor converts percent to multiplier", () => {
    expect(wasteFactor({ wastePercent: 25 })).toBe(1.25)
    expect(wasteFactor({ wastePercent: 0 })).toBe(1)
    expect(wasteFactor({ wastePercent: -5 })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Quantity calculus
// ---------------------------------------------------------------------------

describe("quantity flow", () => {
  it("an unreleased order feeds nothing into the first step", () => {
    const o = order({ releasedAt: null })
    expect(inAt(o, PRODUCT.route, 0, [])).toBe(0)
    expect(wipQty(o, PRODUCT.route)).toBe(0)
  })

  it("release feeds the full quantity into step 0 and it flows by handover", () => {
    const o = order()
    expect(inAt(o, PRODUCT.route, 0, [])).toBe(10)
    expect(pendingAt(o, PRODUCT.route, 0, [])).toBe(10)
    o.progress[0].done = 10
    expect(pendingAt(o, PRODUCT.route, 0, [])).toBe(0)
    expect(pendingAt(o, PRODUCT.route, 1, [])).toBe(10)
    expect(currentIndex(o, PRODUCT.route, [])).toBe(1)
  })

  it("rejected quantity is held at the station, not passed on", () => {
    const o = order()
    o.progress[0].done = 10
    o.progress[1].done = 6
    o.progress[1].rejected = 2
    expect(pendingAt(o, PRODUCT.route, 1, [])).toBe(2)
    expect(pendingAt(o, PRODUCT.route, 2, [])).toBe(6)
  })

  it("rework adds to what a station must process", () => {
    const o = order()
    o.progress[0].done = 10
    o.progress[1].done = 10
    o.progress[1].rework = 2
    expect(inAt(o, PRODUCT.route, 1, [])).toBe(12)
    expect(pendingAt(o, PRODUCT.route, 1, [])).toBe(2)
  })

  it("the exit is the last non-site step; site receives only what landed", () => {
    expect(exitIndex(PRODUCT.route)).toBe(3)
    const o = order()
    o.progress.forEach((p, i) => {
      if (i < 4) p.done = 10
    })
    expect(finishedQty(o, PRODUCT.route)).toBe(10)
    // Nothing shipped yet: the site step has nothing in hand.
    expect(pendingAt(o, PRODUCT.route, 4, [])).toBe(0)
    const notes = [note(6, "received")]
    expect(pendingAt(o, PRODUCT.route, 4, notes)).toBe(6)
    expect(readyQty(o, PRODUCT.route, notes)).toBe(4)
  })

  it("ready = finished minus everything that left on a note", () => {
    const o = order()
    o.progress.forEach((p, i) => {
      if (i < 4) p.done = 10
    })
    const notes = [note(4, "received"), note(3, "in_transit"), note(2, "rejected")]
    expect(outQty(notes)).toBe(7)
    expect(readyQty(o, PRODUCT.route, notes)).toBe(3)
    expect(shippedQty(notes)).toBe(3)
    expect(deliveredQty(notes)).toBe(4)
  })

  it("transit breakage is neither delivered nor forgotten", () => {
    const o = order()
    const notes = [note(6, "received", 2)]
    expect(deliveredQty(notes)).toBe(4)
    expect(brokenQty(notes)).toBe(2)
    expect(brokenUndecided(o, notes)).toBe(2)
    expect(brokenUndecided({ brokenResolved: 2 }, notes)).toBe(0)
  })

  it("the sum closes: released + rework = wip + ready + out + rejected + scrap + shortfall", () => {
    const o = order({ shortfall: 1 })
    o.progress[0].done = 10
    o.progress[1].done = 8
    o.progress[1].rejected = 1
    o.progress[1].rework = 2 // came back for rework
    o.progress[2].done = 7
    o.progress[3].done = 6
    o.scrap = [
      { id: "s1", quantity: 1, value: 400, reason: "كسر", departmentId: "d2", raisedByUserId: "u", raisedByName: "لمى", raisedAt: "", status: "approved" },
    ]
    const notes = [note(3, "received", 1), note(2, "in_transit")]
    const released = o.quantity // 10
    const rework = 2
    const wip = wipQty(o, PRODUCT.route)
    const ready = readyQty(o, PRODUCT.route, notes)
    const out = outQty(notes) // shipped + received incl. broken
    expect(wip + ready + out + 1 /* rejected */ + 1 /* scrap */ + 1 /* shortfall */).toBe(released + rework)
  })

  it("isDoneV2 needs everything landed and every decision made", () => {
    const o = order({ quantity: 10 })
    o.progress.forEach((p, i) => {
      if (i < 4) p.done = 10
    })
    const partWay = [note(10, "in_transit")]
    expect(isDoneV2(o, PRODUCT.route, partWay)).toBe(false)
    const landed = [note(10, "received")]
    // Site step still to install
    expect(atSiteQty(o, PRODUCT.route, landed)).toBe(10)
    expect(isDoneV2(o, PRODUCT.route, landed)).toBe(false)
    o.progress[4].done = 10
    expect(isDoneV2(o, PRODUCT.route, landed)).toBe(true)
    // A broken unit with no decision keeps it open
    const withBreak = [note(10, "received", 1)]
    expect(isDoneV2(o, PRODUCT.route, withBreak)).toBe(false)
  })

  it("scrap reduces what remains at every later station", () => {
    const o = order()
    o.scrap = [
      { id: "s1", quantity: 2, value: 800, reason: "عرق", departmentId: "d2", raisedByUserId: "u", raisedByName: "لمى", raisedAt: "", status: "approved" },
      { id: "s2", quantity: 3, value: 1200, reason: "كسر", departmentId: "d2", raisedByUserId: "u", raisedByName: "لمى", raisedAt: "", status: "pending" },
    ]
    expect(scrapApprovedQty(o)).toBe(2)
    expect(scrapPendingQty(o)).toBe(3)
    // Pending scrap does NOT reduce the deliverable — only approved does.
    expect(remainAt(o, 2)).toBe(8)
  })

  it("activeIndexes lists every station holding quantity", () => {
    const o = order()
    o.progress[0].done = 10
    o.progress[1].done = 4
    expect(activeIndexes(o, PRODUCT.route, [])).toEqual([1, 2])
  })
})

// ---------------------------------------------------------------------------
// Blocking facts
// ---------------------------------------------------------------------------

describe("gates", () => {
  it("release blocks: unwon quote and missing measurement", () => {
    const o = order({ releasedAt: null, measurement: null, sourceQuotationId: "q1", sourceQuotationWon: false })
    const blocks = releaseBlocks(o, PRODUCT)
    expect(blocks.map((b) => b.key).sort()).toEqual(["measurement", "quote"])
    expect(releaseBlocks(order({ releasedAt: null }), PRODUCT)).toEqual([])
    const noMeasure = order({ releasedAt: null, measurement: null })
    expect(releaseBlocks(noMeasure, { requiresMeasurement: false })).toEqual([])
  })

  it("drawing and slab approval block from the second step, not design", () => {
    const o = order({ drawingApprovalStatus: "pending", slabApproval: null })
    expect(stationBlocks(o, PRODUCT, PRODUCT.route, 0).filter((b) => b.severity === "hard")).toEqual([])
    const atSaw = stationBlocks(o, PRODUCT, PRODUCT.route, 1)
    expect(atSaw.map((b) => b.key)).toEqual(expect.arrayContaining(["drawing", "slab"]))
    const approved = order()
    expect(stationBlocks(approved, PRODUCT, PRODUCT.route, 1).filter((b) => b.severity === "hard")).toEqual([])
  })

  it("missing materials are a soft block", () => {
    const o = order()
    const blocks = stationBlocks(o, PRODUCT, PRODUCT.route, 1)
    expect(blocks).toEqual([{ key: "materials", severity: "soft" }])
  })
})

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

describe("materials", () => {
  it("the need includes planned waste and shrinks with approved scrap", () => {
    const o = order()
    const need = materialNeed(o, PRODUCT, "d2")
    expect(need).toHaveLength(1)
    expect(need[0].net).toBe(10)
    expect(need[0].qty).toBe(12.5)
    o.scrap = [
      { id: "s", quantity: 2, value: 0, reason: "x", departmentId: "d2", raisedByUserId: "u", raisedByName: "n", raisedAt: "", status: "approved" },
    ]
    expect(materialNeed(o, PRODUCT, "d2")[0].qty).toBe(10)
  })

  it("material state walks missing → requested → released → complete", () => {
    const o = order()
    expect(materialState(o, PRODUCT, PRODUCT.route, 1)).toBe("missing")
    o.materials = [mat({ state: "requested" })]
    expect(materialState(o, PRODUCT, PRODUCT.route, 1)).toBe("requested")
    o.materials = [mat({ state: "released" })]
    expect(materialState(o, PRODUCT, PRODUCT.route, 1)).toBe("released")
    o.materials = [mat({ state: "received", quantity: 6 })]
    expect(materialState(o, PRODUCT, PRODUCT.route, 1)).toBe("partial")
    o.materials = [mat({ state: "received", quantity: 12.5 })]
    expect(materialState(o, PRODUCT, PRODUCT.route, 1)).toBe("complete")
    expect(materialState(o, PRODUCT, PRODUCT.route, 0)).toBe("none")
  })

  it("shortages measure need beyond store availability", () => {
    const o = order()
    const availability = new Map([["رخام كريمة", 5]])
    const short = materialShortages(o, PRODUCT, "d2", availability)
    expect(short).toHaveLength(1)
    expect(short[0].short).toBe(7.5)
    const plenty = new Map([["رخام كريمة", 50]])
    expect(materialShortages(o, PRODUCT, "d2", plenty)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Capacity & scheduling
// ---------------------------------------------------------------------------

const SIMPLE: MfgProduct = {
  ...PRODUCT,
  id: "p2",
  requiresMeasurement: false,
  requiresDrawingApproval: false,
  requiresSlabApproval: false,
  route: [{ departmentId: "d2", departmentName: "القص", hoursPerUnit: 0.4 }],
  bom: [{ itemName: "خام", unit: "م", qtyPerUnit: 1, departmentId: "d2", withWaste: false, unitCost: 100 }],
  referenceBuyPrice: null,
}

const simpleOrder = (id: string, qty: number, over: Partial<MfgOrderSlice> = {}): MfgOrderSlice =>
  order({
    id,
    productId: "p2",
    quantity: qty,
    progress: emptyProgress(SIMPLE.route),
    measurement: null,
    drawingApprovalStatus: "na",
    slabApproval: null,
    ...over,
  })

describe("capacity & schedule", () => {
  it("capacity defaults to 1×8 when the department has no numbers", () => {
    expect(deptCapacity({ workers: null, hoursPerDay: null })).toBe(8)
    expect(deptCapacity({ workers: 2, hoursPerDay: 8 })).toBe(16)
  })

  it("orders queue on a department in need order; a rush jumps the queue", () => {
    const A: ScheduleInput = { order: simpleOrder("A", 40, { neededBy: "2026-09-10" }), product: SIMPLE, notes: [] }
    const B: ScheduleInput = { order: simpleOrder("B", 80, { neededBy: "2026-09-15" }), product: SIMPLE, notes: [] }
    const sched = scheduleOrders([A, B], DEPTS)
    expect(sched.get("A")?.finishDays).toBe(1) // 40×0.4 = 16h / 16h·day
    expect(sched.get("B")?.finishDays).toBe(3) // waits 1d, then 32h = 2d
    expect(sched.get("B")?.waitDepartmentId).toBe("d2")
    const rushed: ScheduleInput = { ...B, order: { ...B.order, rush: { reason: "x", by: "y", at: "" } } }
    const sched2 = scheduleOrders([A, rushed], DEPTS)
    expect(sched2.get("B")?.finishDays).toBe(2)
    expect(sched2.get("A")?.finishDays).toBe(3)
  })

  it("an unwon quote has no date at all; a blocked one carries its condition", () => {
    const unwon = simpleOrder("Q", 10, { releasedAt: null, sourceQuotationId: "q1", sourceQuotationWon: false })
    const unreleased = simpleOrder("R", 10, { releasedAt: null })
    const sched = scheduleOrders(
      [
        { order: unwon, product: SIMPLE, notes: [] },
        { order: unreleased, product: SIMPLE, notes: [] },
      ],
      DEPTS
    )
    expect(sched.has("Q")).toBe(false)
    expect(sched.get("R")?.condition).toBe("release")
  })

  it("station load and the bottleneck", () => {
    const A: ScheduleInput = { order: simpleOrder("A", 40), product: SIMPLE, notes: [] }
    expect(stationLoadHours([A], "d2")).toBe(16)
    expect(stationQueueDays([A], DEPTS[1])).toBe(1)
    expect(bottleneck([A], DEPTS)?.departmentId).toBe("d2")
  })

  it("a new quantity joins the back of the queue; fitQty is its inverse", () => {
    const A: ScheduleInput = { order: simpleOrder("A", 40), product: SIMPLE, notes: [] }
    const B: ScheduleInput = { order: simpleOrder("B", 80), product: SIMPLE, notes: [] }
    expect(possibleForDays(SIMPLE, 16, [A, B], DEPTS)).toBe(4) // 3d queue + 0.4
    expect(possibleForDays(SIMPLE, 40, [], DEPTS)).toBe(1)
    expect(fitQty(SIMPLE, 1, [], DEPTS)).toBe(40)
    expect(fitQty(SIMPLE, 0, [], DEPTS)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------

describe("costing", () => {
  it("standard cost = materials (with waste) + labour + overhead", () => {
    const std = standardCost(PRODUCT, DEPTS, SETTINGS, 1)
    expect(std.materials).toBe(413.75) // 320×1.25 + 9.5 + 4.25
    expect(std.hours).toBe(1.2)
    expect(std.labour).toBe(72) // 1.2 × 60
    expect(std.overhead).toBe(38.4) // 1.2 × 32
    expect(std.total).toBe(524.15)
    expect(std.allPriced).toBe(true)
  })

  it("an unknown BOM cost makes the total honest about understating", () => {
    const p = { ...PRODUCT, bom: [...PRODUCT.bom, { itemName: "مجهول", unit: "م", qtyPerUnit: 1, departmentId: "d2", withWaste: false, unitCost: null }] }
    expect(standardCost(p, DEPTS, SETTINGS, 1).allPriced).toBe(false)
  })

  it("time off drops labour and overhead to zero, not to a guess", () => {
    const off = { ...SETTINGS, features: { ...SETTINGS.features, time: false } }
    const std = standardCost(PRODUCT, DEPTS, off, 2)
    expect(std.labour).toBe(0)
    expect(std.overhead).toBe(0)
    expect(std.total).toBe(std.materials)
  })

  it("order cost is built from received materials and reported hours only", () => {
    const o = order()
    o.materials = [mat({ state: "received", quantity: 12.5, unitCost: 320 }), mat({ id: "m2", state: "released", quantity: 5, unitCost: 95 })]
    expect(materialCostOf(o).cost).toBe(4000)
    o.progress[1].hours = 3
    o.progress[2].hours = 2
    expect(hoursTotal(o)).toBe(5)
    expect(labourCostOf(o, PRODUCT.route, DEPTS, SETTINGS)).toBe(300)
    expect(overheadCostOf(o, SETTINGS)).toBe(160)
    expect(orderCost(o, PRODUCT.route, DEPTS, SETTINGS)).toBe(4460)
  })

  it("a received line with unknown cost flags the total instead of writing zero as truth", () => {
    const o = order({ materials: [mat({ unitCost: null })] })
    const { cost, allPriced } = materialCostOf(o)
    expect(cost).toBe(0)
    expect(allPriced).toBe(false)
  })

  it("unit sunk cost accumulates route by route — the scrap valuation", () => {
    expect(unitSunkCost(PRODUCT, DEPTS, SETTINGS, 0)).toBe(9) // 0.1×(60+32)
    expect(unitSunkCost(PRODUCT, DEPTS, SETTINGS, 1)).toBe(437) // +400 slab +0.3×92
  })

  it("hour variance flags >15% over standard AND at least two hours", () => {
    const o = order()
    o.progress[1].done = 10
    o.progress[1].hours = 5.2 // std = 3
    const v = hourVariance(o, PRODUCT.route, SETTINGS)
    expect(v?.departmentId).toBe("d2")
    expect(v?.gap).toBe(2.2)
    expect(v?.percent).toBe(73)
    o.progress[1].hours = 3.4 // over 13% only
    expect(hourVariance(o, PRODUCT.route, SETTINGS)).toBeNull()
    o.progress[1].hours = 4.4 // 47% over but check the 2h floor with smaller done
    o.progress[1].done = 2
    o.progress[1].hours = 1.5 // std 0.6, gap 0.9 < 2h
    expect(hourVariance(o, PRODUCT.route, SETTINGS)).toBeNull()
  })

  it("finance floor and margin", () => {
    expect(minPriceFor(820, SETTINGS)).toBe(1000) // 18% margin
    expect(marginPercent(1000, 820)).toBe(18)
    expect(marginPercent(0, 820)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Make or buy
// ---------------------------------------------------------------------------

describe("verdict", () => {
  it("buying wins when the reference price beats our unit cost", () => {
    // unit cost = 100 + 0.4×60 + 0.4×32 = 136.8
    const p = { ...SIMPLE, referenceBuyPrice: 120 }
    const v = verdict(p, 10, 30, [], DEPTS, SETTINGS)
    expect(v.kind).toBe("buy_price")
    expect(v.makeQty).toBe(0)
  })

  it("we make when capacity meets the date", () => {
    const v = verdict(SIMPLE, 10, 30, [], DEPTS, SETTINGS)
    expect(v.kind).toBe("make")
    expect(v.makeQty).toBe(10)
    expect(v.possibleDays).toBe(1)
  })

  it("a tight date splits the answer: make what fits, buy the rest", () => {
    const queue: ScheduleInput = { order: simpleOrder("A", 80), product: SIMPLE, notes: [] }
    const v = verdict(SIMPLE, 100, 3, [queue], DEPTS, SETTINGS)
    expect(v.kind).toBe("partial")
    expect(v.makeQty).toBeGreaterThan(0)
    expect(v.makeQty).toBeLessThan(100)
  })

  it("no capacity at all → buy", () => {
    const queue: ScheduleInput = { order: simpleOrder("A", 800), product: SIMPLE, notes: [] }
    const v = verdict(SIMPLE, 50, 1, [queue], DEPTS, SETTINGS)
    expect(v.kind).toBe("buy_capacity")
  })

  it("with time off the verdict falls back to price alone", () => {
    const off = { ...SETTINGS, features: { ...SETTINGS.features, time: false } }
    const v = verdict(SIMPLE, 10, 1, [], DEPTS, off)
    expect(v.kind).toBe("make")
    expect(v.possibleDays).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

describe("estimates", () => {
  it("lines snapshot the standard cost split", () => {
    const lines = buildEstimateLines([{ product: PRODUCT, quantity: 2 }], DEPTS, SETTINGS)
    expect(lines[0].totalCost).toBe(1048.3)
    expect(lines[0].materialCost).toBe(827.5)
    expect(estimateCost({ lines })).toBe(1048.3)
  })
})

// ---------------------------------------------------------------------------
// Decisions & dates
// ---------------------------------------------------------------------------

describe("decisions", () => {
  it("surfaces the day's work sorted by weight", () => {
    const o = order()
    o.progress[0].done = 10
    o.progress[1].done = 8
    o.progress[1].rejected = 2
    o.scrap = [
      { id: "s1", quantity: 1, value: 4200, reason: "كسر", departmentId: "d2", raisedByUserId: "u", raisedByName: "لمى", raisedAt: "", status: "pending" },
    ]
    const notes = [{ ...note(2, "in_transit"), id: "n1" }]
    const decisions = buildDecisions({
      orders: [{ order: o, product: PRODUCT, notes }],
      requests: [{ id: "r1", state: "new", ageHours: 30 }],
      estimates: [{ id: "e1", state: "draft", sentAt: null, quotedAt: null }],
      schedule: new Map(),
      departments: DEPTS,
      settings: SETTINGS,
      today: "2026-09-12",
    })
    const kinds = decisions.map((d) => d.kind)
    expect(kinds).toContain("answer_request")
    expect(kinds).toContain("send_estimate")
    expect(kinds).toContain("qc_decision")
    expect(kinds).toContain("approve_scrap")
    expect(kinds).toContain("confirm_note")
    expect(kinds[0]).toBe("answer_request") // 30h overdue outweighs the rest
    const weights = decisions.map((d) => d.weight)
    expect([...weights].sort((a, b) => b - a)).toEqual(weights)
  })

  it("an order past its needed-by date raises the miss flag", () => {
    const o = order({ neededBy: "2026-09-10" })
    o.progress[0].done = 5
    const decisions = buildDecisions({
      orders: [{ order: o, product: PRODUCT, notes: [] }],
      requests: [],
      estimates: [],
      schedule: new Map(),
      departments: DEPTS,
      settings: SETTINGS,
      today: "2026-09-12",
    })
    expect(decisions.map((d) => d.kind)).toContain("will_miss_date")
  })

  it("date helpers", () => {
    expect(daysFrom("2026-09-12", "2026-09-15")).toBe(3)
    expect(daysFrom("2026-09-12", "2026-09-10")).toBe(-2)
    expect(addDaysISO("2026-09-12", 5)).toBe("2026-09-17")
  })
})
