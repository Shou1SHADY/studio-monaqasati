/**
 * The Manufacturing screen model: every screen reads one derived view of each
 * work order, so the Today queue, the orders table, the board and the drawer
 * can never disagree about where an order is, whether it makes its date, or
 * what it has sent to Finance.
 */

import { DEFAULT_MFG_SETTINGS, emptyProgress, scheduleOrders, type MfgProduct } from "@/lib/manufacturing-engine"
import type { DeliveryNote } from "@/lib/delivery-notes"
import { toNoteSlice, toOrderSlice, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import {
  buildOrderView,
  buildOrderViews,
  cardsAtDepartment,
  compareOrders,
  computeKpis,
  documentTrail,
  financeEvents,
  inSegment,
  matchesSearch,
  orderLog,
  orderMoney,
  productionLines,
  segmentCounts,
} from "@/lib/manufacturing-view"

const TODAY = "2026-09-14"
const DEPTS = [
  { id: "cut", name: "Cut", workers: 2, hoursPerDay: 8, hourlyRate: 70 },
  { id: "edge", name: "Edge", workers: 2, hoursPerDay: 8, hourlyRate: 60 },
  { id: "pack", name: "Pack", workers: 1, hoursPerDay: 8, hourlyRate: 45 },
]

const PRODUCT: MfgProduct = {
  id: "p1",
  organizationId: "org",
  name: "Kitchen counter",
  unit: "m2",
  family: "stone",
  requiresMeasurement: true,
  requiresDrawingApproval: false,
  requiresSlabApproval: false,
  wastePercent: 20,
  salePrice: 1000,
  estimateValue: 700,
  referenceBuyPrice: 900,
  route: [
    { departmentId: "cut", departmentName: "Cut", hoursPerUnit: 0.5 },
    { departmentId: "edge", departmentName: "Edge", hoursPerUnit: 0.4 },
    { departmentId: "pack", departmentName: "Pack", hoursPerUnit: 0.1 },
  ],
  bom: [{ itemName: "Slab", unit: "m2", qtyPerUnit: 1, departmentId: "cut", withWaste: true, unitCost: 300 }],
}

function order(id: string, n: number, patch: Partial<WorkOrderV2> = {}): WorkOrderV2 {
  return {
    id,
    organizationId: "org",
    orderNumber: n,
    title: `Order ${n}`,
    items: [],
    source: { kind: "manual" },
    status: "open",
    currentStageIndex: 0,
    stages: [],
    createdByUserId: "u1",
    createdByUserName: "Manager",
    productId: "p1",
    quantity: 10,
    neededBy: "2026-09-30",
    createdAtIso: "2026-09-01T08:00:00.000Z",
    releasedAt: null,
    measurement: null,
    drawingApprovalStatus: "na",
    slabApproval: null,
    rush: null,
    progress: emptyProgress(PRODUCT.route),
    materials: [],
    scrapRecords: [],
    ...patch,
  }
}

const note = (id: string, orderId: string, patch: Partial<DeliveryNote>): DeliveryNote => ({
  id,
  organizationId: "org",
  noteNumber: `DN-${id}`,
  source: { kind: "manufacturing", workOrderId: orderId, workOrderNumber: 0, title: "" },
  item: { name: "Kitchen counter", quantity: 4, unit: "m2", unitCost: 500 },
  toWarehouseId: "w1",
  toWarehouseName: "Site store",
  toKind: "project",
  status: "in_transit",
  sentByUserId: "u1",
  sentByUserName: "Manager",
  sentAt: "2026-09-10T09:00:00.000Z",
  ...patch,
})

const progress = (rows: Array<[number, number, number]>) =>
  PRODUCT.route.map((r, i) => ({ departmentId: r.departmentId, done: rows[i][0], rejected: rows[i][1], rework: 0, hours: rows[i][2] }))

// Blocked: needs a site measurement before release.
const blocked = order("o1", 101, { projectId: "pr1", projectName: "Tower" })
// Running: 10 released, 6 cut, 2 edged + 1 rejected at edge.
const running = order("o2", 102, {
  releasedAt: "2026-09-05T08:00:00.000Z",
  releasedByName: "Manager",
  measurement: { at: "2026-09-04T08:00:00.000Z", by: "Surveyor" },
  progress: progress([[6, 0, 4], [2, 1, 2], [0, 0, 0]]),
  source: { kind: "quotation", quotationNumber: "Q-ABC", contactName: "Client A" },
  materials: [
    {
      id: "m1",
      requestNumber: "MW-1",
      itemName: "Slab",
      unit: "m2",
      quantity: 12,
      departmentId: "cut",
      lot: null,
      state: "received",
      unitCost: 300,
      warehouseId: "w0",
      requestedByUserId: "u2",
      requestedByName: "Lead",
      requestedAt: "2026-09-05T09:00:00.000Z",
      releasedByName: "Keeper",
      releasedAt: "2026-09-05T10:00:00.000Z",
      receivedByName: "Lead",
      receivedAt: "2026-09-05T11:00:00.000Z",
    },
  ],
})
// Late: needed yesterday, finished and packed, part on the road.
const late = order("o3", 103, {
  neededBy: "2026-09-13",
  releasedAt: "2026-09-01T08:00:00.000Z",
  measurement: { at: "2026-08-31T08:00:00.000Z", by: "Surveyor" },
  progress: progress([[10, 0, 5], [10, 0, 4], [10, 0, 1]]),
  projectId: "pr1",
  projectName: "Tower",
  rush: { reason: "Owner handover", by: "Manager", at: "2026-09-12T08:00:00.000Z" },
})
const lateNotes = [note("n1", "o3", { status: "in_transit", item: { name: "x", quantity: 4, unit: "m2", unitCost: 500 } })]
// Done: everything received.
const done = order("o4", 104, {
  status: "done",
  releasedAt: "2026-08-01T08:00:00.000Z",
  measurement: { at: "2026-07-31T08:00:00.000Z", by: "Surveyor" },
  progress: progress([[10, 0, 5], [10, 0, 4], [10, 0, 1]]),
})
const doneNotes = [note("n2", "o4", { status: "received", receivedAt: "2026-08-20T08:00:00.000Z", receivedByUserName: "Engineer", toKind: "central", item: { name: "x", quantity: 10, unit: "m2", unitCost: 500 }, brokenQuantity: 1 })]

const ORDERS = [blocked, running, late, done]
const notesByOrder = new Map([
  ["o3", lateNotes],
  ["o4", doneNotes],
])
const inputs = ORDERS.map((o) => ({ order: toOrderSlice(o), product: PRODUCT, notes: (notesByOrder.get(o.id) || []).map(toNoteSlice) }))
const schedule = scheduleOrders(inputs, DEPTS)
const VIEWS = buildOrderViews(
  { v2Orders: ORDERS, productById: new Map([["p1", PRODUCT]]), notesByOrder, schedule, settings: DEFAULT_MFG_SETTINGS },
  TODAY
)
const byId = (id: string) => VIEWS.find((v) => v.id === id)!

describe("order state", () => {
  it("says where each order is, in priority order", () => {
    expect(byId("o1")).toMatchObject({ state: "blocked", released: false, live: true, sourceKind: "project", sourceName: "Tower" })
    expect(byId("o1").releaseBlocks.map((b) => b.key)).toEqual(["measurement"])
    expect(byId("o2")).toMatchObject({ state: "at_department", current: 0, stateDepartmentId: "cut", sourceKind: "quotation", sourceName: "Client A", rejected: 1 })
    expect(byId("o2").active).toEqual([0, 1, 2])
    expect(byId("o3")).toMatchObject({ state: "in_transit", ready: 6, shipped: 4, rush: true })
    expect(byId("o4")).toMatchObject({ state: "done", done: true, live: false, delivered: 9 })
  })

  it("names a quotation-born order by its quote when the client is unnamed", () => {
    const [v] = buildOrderViews(
      {
        v2Orders: [order("q1", 201, { source: { kind: "quotation", quotationNumber: "Q-777" } })],
        productById: new Map([["p1", PRODUCT]]),
        notesByOrder: new Map(),
        schedule: new Map(),
        settings: DEFAULT_MFG_SETTINGS,
      },
      TODAY
    )
    expect(v).toMatchObject({ sourceKind: "quotation", sourceName: "Q-777", quotationNumber: "Q-777" })
  })

  it("knows when an order is late and by how much", () => {
    expect(byId("o3")).toMatchObject({ overdue: true, late: true, lateDays: 1 })
    expect(byId("o2").overdue).toBe(false)
    expect(byId("o4").late).toBe(false)
  })

  it("gives released live orders a possible date from capacity", () => {
    expect(byId("o2").possibleDate).toMatch(/^2026-09-1\d$/)
    expect(byId("o4").possibleDate).toBeNull()
  })
})

describe("lists", () => {
  it("segments, counts and searches", () => {
    expect(segmentCounts(VIEWS)).toEqual({ live: 2, release: 1, late: 1, done: 1, all: 4 })
    expect(VIEWS.filter((v) => inSegment(v, "release")).map((v) => v.id)).toEqual(["o1"])
    expect(matchesSearch(byId("o2"), "#102")).toBe(true)
    expect(matchesSearch(byId("o2"), "q-abc")).toBe(true)
    expect(matchesSearch(byId("o2"), "tower")).toBe(false)
  })

  it("orders rush first, then the earliest need, then the newest", () => {
    // o3 is rushed; o1, o2 and o4 all need 2026-09-30, so the newest number wins.
    expect([...VIEWS].sort(compareOrders).map((v) => v.id)).toEqual(["o3", "o4", "o2", "o1"])
  })
})

describe("headline figures and the board", () => {
  it("computes the three KPIs", () => {
    const k = computeKpis(VIEWS, inputs, DEPTS, true)
    expect(k).toMatchObject({ liveCount: 2, lateCount: 1, readyUnits: 6, readyOrders: 1 })
    expect(k.wipUnits).toBe(byId("o2").wip + byId("o3").wip)
  })

  it("puts each in-hand quantity on its department's column", () => {
    expect(cardsAtDepartment(VIEWS, "cut").map((c) => [c.view.id, c.inHand, c.materialState])).toEqual([["o2", 4, "complete"]])
    expect(cardsAtDepartment(VIEWS, "edge").map((c) => [c.view.id, c.inHand])).toEqual([["o2", 3]])
    expect(cardsAtDepartment(VIEWS, "pack").map((c) => [c.view.id, c.inHand])).toEqual([["o2", 2]])
  })

  it("derives production lines from product routes", () => {
    expect(productionLines([PRODUCT])).toEqual([{ family: "stone", departmentIds: ["cut", "edge", "pack"] }])
  })
})

describe("money, trail, finance and log", () => {
  it("prices an order from its real movements against its value", () => {
    const m = orderMoney(byId("o2"), DEPTS, DEFAULT_MFG_SETTINGS)
    expect(m.materials).toBe(3_600)
    expect(m.labour).toBe(4 * 70 + 2 * 60)
    expect(m.overhead).toBe(6 * DEFAULT_MFG_SETTINGS.overheadRatePerHour)
    expect(m.valueKind).toBe("sale")
    expect(m.value).toBe(10_000)
    expect(m.difference).toBe(10_000 - m.total)
  })

  it("traces the order's documents", () => {
    expect(documentTrail(byId("o2")).map((t) => [t.kind, t.ref])).toEqual([
      ["quotation", "Q-ABC"],
      ["work_order", "#102"],
      ["withdrawal", "MW-1"],
    ])
    expect(documentTrail(byId("o4")).map((t) => t.kind)).toEqual(["work_order", "delivery_note", "finance_stock"])
  })

  it("lists what went to Finance and what is still waiting", () => {
    const late = financeEvents(byId("o3"), DEPTS, DEFAULT_MFG_SETTINGS)
    expect(late.find((e) => e.kind === "note_in_transit")).toMatchObject({ posted: false, ref: "DN-n1", quantity: 4 })
    const done = financeEvents(byId("o4"), DEPTS, DEFAULT_MFG_SETTINGS)
    expect(done.find((e) => e.kind === "delivery_stock")).toMatchObject({ posted: true, quantity: 9, value: 4_500 })
    expect(done.find((e) => e.kind === "breakage")).toMatchObject({ posted: false, quantity: 1 })
  })

  it("tells the order's history newest first", () => {
    const log = orderLog(byId("o2")).map((l) => l.kind)
    expect(log[0]).toBe("materials_received")
    expect(log).toEqual(["materials_received", "materials_released", "materials_requested", "released", "measured", "created"])
    expect(orderLog(buildOrderView(late, PRODUCT, lateNotes, null, TODAY, false))[0]).toMatchObject({ kind: "rushed", tone: "bad" })
  })
})
