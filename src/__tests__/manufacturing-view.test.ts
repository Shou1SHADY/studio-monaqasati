/**
 * The screen model: every screen reads one computed world, so Today per role,
 * the Workshop, the board and the order panel can never disagree about an
 * order's state, its next step and whose it is, whether it is late and why,
 * or the one WIP number.
 */

import { DEFAULT_MFG_SETTINGS, emptyProgress, type Actor, type MfgProduct } from "@/lib/manufacturing-engine"
import {
  buildDecisions,
  buildWorld,
  byUnit,
  documentTrail,
  filterCounts,
  financeEvents,
  groupDecisions,
  inFilter,
  lostHoursToday,
  matchesSearch,
  myStations,
  orderLog,
  personasOf,
  stationQueue,
  waitingOthers,
  waitingTeam,
  wipReconciliation,
  wipTotal,
  type MfgWorldInput,
  type TeamMember,
} from "@/lib/manufacturing-view"
import type { WorkOrderV2, MfgStop } from "@/lib/manufacturing-writes"
import type { MfgDepartment } from "@/lib/manufacturing"
import type { DeliveryNote } from "@/lib/delivery-notes"
import type { SalesOrder } from "@/lib/sales-orders"

const TODAY = "2026-09-13"
const NOW = new Date("2026-09-13T09:00:00Z").getTime()
const S = DEFAULT_MFG_SETTINGS

const DEPTS: MfgDepartment[] = [
  { id: "s7", organizationId: "org", name: "Cutting", order: 1, workers: 2, hoursPerDay: 8, hourlyRate: 70, leadUserId: "sami", leadUserName: "Abu Sami", gate: null } as MfgDepartment,
  { id: "s8", organizationId: "org", name: "Profiling", order: 2, workers: 3, hoursPerDay: 8, hourlyRate: 60, leadUserId: "ammar", leadUserName: "Abu Ammar", gate: null } as MfgDepartment,
  { id: "s5", organizationId: "org", name: "QC & packing", order: 3, workers: 2, hoursPerDay: 8, hourlyRate: 45, qcStation: true, gate: null } as MfgDepartment,
]

const SKIRTING: MfgProduct = {
  id: "pr15",
  organizationId: "org",
  name: "Marble skirting",
  unit: "m",
  family: "stone",
  requiresMeasurement: false,
  requiresDrawingApproval: false,
  requiresSlabApproval: false,
  wastePercent: 15,
  referenceBuyPrice: 70,
  route: [
    { departmentId: "s7", departmentName: "Cutting", hoursPerUnit: 0.06 },
    { departmentId: "s8", departmentName: "Profiling", hoursPerUnit: 0.07 },
    { departmentId: "s5", departmentName: "QC", hoursPerUnit: 0.02 },
  ],
  bom: [{ itemName: "Beige Sahel slab", unit: "m²", qtyPerUnit: 0.12, departmentId: "s7", withWaste: true, unitCost: 245 }],
}

const FLOOR: MfgProduct = { ...SKIRTING, id: "pr12", name: "Marble flooring", unit: "m²", bom: [{ itemName: "Beige Sahel slab", unit: "m²", qtyPerUnit: 1, departmentId: "s7", withWaste: true, unitCost: 245 }] }

const wo = (over: Partial<WorkOrderV2>): WorkOrderV2 =>
  ({
    id: "o1",
    organizationId: "org",
    orderNumber: 55,
    docNumber: "WO-2026/055",
    title: "Skirting",
    items: [],
    source: { kind: "manual" },
    status: "open",
    currentStageIndex: 0,
    stages: [],
    createdByUserId: "badr",
    createdByUserName: "Eng. Badr",
    productId: "pr15",
    quantity: 100,
    neededBy: "2026-09-30",
    createdAtIso: "2026-09-10T08:00:00Z",
    releasedAt: null,
    progress: emptyProgress(SKIRTING.route),
    materials: [],
    scrapRecords: [],
    closures: [],
    ...over,
  }) as WorkOrderV2

const received = (qty: number) => ({
  id: `m${qty}`,
  requestNumber: "WR-2026/181",
  itemName: "Beige Sahel slab",
  unit: "m²",
  quantity: qty,
  departmentId: "s7",
  lot: "BLK-2210",
  state: "received" as const,
  unitCost: 245,
  warehouseId: "w1",
  requestedByUserId: "sami",
  requestedByName: "Abu Sami",
  requestedAt: "2026-09-11T08:00:00Z",
  receivedByName: "Abu Sami",
  receivedAt: "2026-09-11T12:00:00Z",
})

const prog = (rows: Array<[number, number]>) => SKIRTING.route.map((r, i) => ({ departmentId: r.departmentId, done: rows[i]?.[0] || 0, rejected: rows[i]?.[1] || 0, rework: 0, hours: 0, back: 0 }))

const ORDERS: WorkOrderV2[] = [
  // Client order waiting for Finance.
  wo({ id: "pay", orderNumber: 56, docNumber: "WO-2026/056", sourceKind: "client", salesOrderId: "so131", salesOrderNumber: 131, source: { kind: "quotation", contactName: "Al-Ufuq" }, quantity: 400 }),
  // Stock order ready to release.
  wo({ id: "stock", orderNumber: 55 }),
  // Project order at profiling with 2 rejected; cutting done.
  wo({ id: "prj", orderNumber: 54, docNumber: "WO-2026/054", sourceKind: "project", projectId: "p1", projectName: "Al-Narjes", productId: "pr12", quantity: 20, neededBy: "2026-09-10", releasedAt: "2026-09-05T08:00:00Z", materials: [received(23)], progress: prog([[20, 0], [10, 2]]) }),
  // Flooring at QC & packing.
  wo({ id: "qc", orderNumber: 53, docNumber: "WO-2026/053", productId: "pr12", quantity: 10, releasedAt: "2026-09-05T08:00:00Z", materials: [received(11.5)], progress: prog([[10, 0], [10, 0]]) }),
  // Big scrap pending above the manager's limit.
  wo({
    id: "scrap",
    orderNumber: 52,
    docNumber: "WO-2026/052",
    productId: "pr12",
    quantity: 10,
    releasedAt: "2026-09-05T08:00:00Z",
    materials: [received(11.5)],
    progress: prog([[10, 0], [4, 0]]),
    scrapRecords: [{ id: "sc1", quantity: 6, value: 4257, reason: "vein", departmentId: "s8", index: 1, raisedByUserId: "lama", raisedByName: "Eng. Lama", raisedAt: "2026-09-11T08:00:00Z", status: "pending", decision: null }],
  }),
]

const NOTES = new Map<string, DeliveryNote[]>()
const SALES = new Map<string, SalesOrder>([["so131", { id: "so131", payment: { kind: "deposit", depositPercent: 40, depositPaid: false } } as SalesOrder]])

function world(over: Partial<MfgWorldInput> = {}) {
  return buildWorld({
    today: TODAY,
    nowMs: NOW,
    settings: S,
    departments: DEPTS,
    products: new Map([["pr15", SKIRTING], ["pr12", FLOOR]]),
    orders: ORDERS,
    notesByOrder: NOTES,
    salesOrders: SALES,
    stops: [],
    notices: [],
    stock: { onHand: new Map([["beige sahel slab", 500]]), lots: [] },
    ...over,
  })
}

const badr: Actor = { uid: "badr", manage: true, work: false, qc: false, cost: false, view: false }
const sami: Actor = { uid: "sami", manage: false, work: true, qc: false, cost: false, view: false }
const ammar: Actor = { uid: "ammar", manage: false, work: true, qc: false, cost: false, view: false }
const lama: Actor = { uid: "lama", manage: false, work: false, qc: true, cost: false, view: false }
const noura: Actor = { uid: "noura", manage: false, work: false, qc: false, cost: true, view: false }
const aziz: Actor = { uid: "aziz", manage: false, work: false, qc: false, cost: false, view: true }
const TEAM: TeamMember[] = [
  { id: "badr", name: "Eng. Badr", manage: true, work: false, qc: false, cost: false, view: false },
  { id: "sami", name: "Abu Sami", manage: false, work: true, qc: false, cost: false, view: false },
  { id: "ammar", name: "Abu Ammar", manage: false, work: true, qc: false, cost: false, view: false },
  { id: "lama", name: "Eng. Lama", manage: false, work: false, qc: true, cost: false, view: false },
  { id: "noura", name: "Noura", manage: false, work: false, qc: false, cost: true, view: false },
]

const decisionsFor = (actor: Actor, persona: Parameters<typeof buildDecisions>[0]["persona"]) =>
  buildDecisions({ world: world(), requests: [], estimates: [], departments: DEPTS, settings: S, actor, persona, today: TODAY, nowMs: NOW })

describe("the world", () => {
  it("computes every order once, with state, source and the honest date", () => {
    const w = world()
    const pay = w.viewById.get("pay")!
    expect(pay.stage).toBe("pay")
    expect(pay.source).toBe("client")
    expect(pay.candidates[0].owner).toEqual({ kind: "external", module: "finance" })
    const prj = w.viewById.get("prj")!
    expect(prj.ref).toBe("WO-2026/054")
    expect(prj.overdue).toBe(true)
    expect(prj.late).toBe(true)
    expect(prj.lateReason).toMatchObject({ key: "at_station" })
    expect(w.viewById.get("stock")!.stage).toBe("wait")
  })

  it("a shortage removes the date (D16)", () => {
    const w = world({ stock: { onHand: new Map(), lots: [] } })
    const stock = w.viewById.get("stock")!
    expect(stock.possibleDate).not.toBeNull()
    const w2 = world({ stock: { onHand: new Map(), lots: [] }, orders: ORDERS.map((o) => (o.id === "stock" ? { ...o, releasedAt: "2026-09-12T08:00:00Z" } : o)) })
    const released = w2.viewById.get("stock")!
    expect(released.shortages.length).toBe(1)
    expect(released.possibleDate).toBeNull()
  })

  it("today's stops are summed per station", () => {
    const stops = [
      { departmentId: "s8", date: TODAY, hours: 4 },
      { departmentId: "s8", date: TODAY, hours: 2 },
      { departmentId: "s8", date: "2026-09-12", hours: 8 },
    ] as MfgStop[]
    expect(lostHoursToday(stops, TODAY).get("s8")).toBe(6)
  })
})

describe("five roles", () => {
  it("resolves personas and stations", () => {
    expect(personasOf(badr, DEPTS)).toEqual(["manager"])
    expect(personasOf({ ...badr, work: true, qc: true, cost: true, view: true }, DEPTS)).toEqual(["manager", "lead", "qc", "cost", "management"])
    expect(myStations(sami, DEPTS, "lead")).toEqual(["s7"])
    expect(myStations(lama, DEPTS, "qc")).toEqual(["s5"])
  })

  it("each Today holds only that role's decisions (TD-04)", () => {
    const manager = decisionsFor(badr, "manager").map((d) => (d.kind === "order" ? `${d.view.id}:${d.candidate.key}` : d.kind))
    expect(manager).toEqual(expect.arrayContaining(["stock:release", "scrap:remake_scrap"]))
    expect(manager).not.toContain("scrap:scrap_review")
    expect(manager).not.toContain("prj:output")

    const lead = decisionsFor(ammar, "lead").map((d) => (d.kind === "order" ? `${d.view.id}:${d.candidate.key}` : d.kind))
    expect(lead).toEqual(["prj:output"])

    const qc = decisionsFor(lama, "qc").map((d) => (d.kind === "order" ? `${d.view.id}:${d.candidate.key}` : d.kind))
    expect(qc).toEqual(expect.arrayContaining(["prj:qc_decision", "qc:qc_release"]))

    const cost = decisionsFor(noura, "cost").map((d) => (d.kind === "order" ? `${d.view.id}:${d.candidate.key}` : d.kind))
    expect(cost).toContain("scrap:scrap_review")

    expect(decisionsFor(aziz, "management")).toEqual([])
  })

  it("groups the manager's decisions into one card per order", () => {
    const groups = groupDecisions(decisionsFor(badr, "manager"))
    const ids = groups.filter((g) => g.kind === "order").map((g) => (g.kind === "order" ? g.view.id : ""))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("the station queue is the lead's stations in rush, late, date order", () => {
    // WO 052's six scrapped metres left profiling — nothing of it is in hand.
    const rows = stationQueue(world(), ["s8"], ammar, DEPTS, S, "lead")
    expect(rows.map((r) => r.view.id)).toEqual(["prj"])
    expect(rows[0].action?.key).toBe("output")
  })
})

describe("awaiting", () => {
  it("other modules — read-only, scoped by role (TD-08)", () => {
    const w = world()
    expect(waitingOthers(w, "manager", [], [], S, TODAY).map((g) => g.module)).toEqual(["finance"])
    expect(waitingOthers(w, "qc", [], [], S, TODAY)).toEqual([])
    expect(waitingOthers(w, "cost", [], [], S, TODAY)).toEqual([])
    expect(waitingOthers(w, "lead", ["s8"], [], S, TODAY)).toEqual([])
  })

  it("our team — grouped by the person who holds it (TD-07)", () => {
    const groups = waitingTeam(world(), TEAM, badr, DEPTS, S)
    const holders = groups.map((g) => g.holder.name)
    expect(holders).toEqual(expect.arrayContaining(["Abu Ammar", "Eng. Lama", "Noura"]))
    expect(holders).not.toContain("Eng. Badr")
  })
})

describe("the Workshop and the numbers", () => {
  it("filters with counts and a search over refs, sources and products (WS-02/03)", () => {
    const views = world().views
    const counts = filterCounts(views)
    expect(counts.all).toBe(5)
    expect(counts.pay).toBe(1)
    expect(counts.wait).toBe(1)
    expect(counts.prod).toBe(3)
    expect(views.filter((v) => inFilter(v, "prod")).map((v) => v.id).sort()).toEqual(["prj", "qc", "scrap"])
    const prj = views.find((v) => v.id === "prj")!
    expect(matchesSearch(prj, "2026/054")).toBe(true)
    expect(matchesSearch(prj, "narjes")).toBe(true)
    expect(matchesSearch(views.find((v) => v.id === "pay")!, "SO-131")).toBe(true)
  })

  it("never sums m² with m (UI-06)", () => {
    expect(byUnit([["m²", 2], ["m", 3], ["m²", 1.5], ["m", 0]])).toEqual([{ unit: "m²", qty: 3.5 }, { unit: "m", qty: 3 }])
  })

  it("one WIP: the reconciliation total is the same number as the KPI (FN-06)", () => {
    const views = world().views
    expect(wipReconciliation(views).total).toBe(wipTotal(views))
  })

  it("the panel's finance events, trail and log come from the same facts", () => {
    const prj = world().viewById.get("prj")!
    expect(financeEvents(prj, S).find((e) => e.kind === "materials")).toMatchObject({ state: "posted" })
    expect(documentTrail(prj, []).map((x) => x.kind)).toEqual(expect.arrayContaining(["work_order", "withdrawal"]))
    expect(orderLog(prj).map((x) => x.kind)).toEqual(expect.arrayContaining(["released", "materials_received", "created_project"]))
  })
})
