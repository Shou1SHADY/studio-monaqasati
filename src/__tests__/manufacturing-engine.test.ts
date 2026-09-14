/**
 * The marble line's engine (PRD 1.2): a work order is a quantity on the
 * product's route; every unit is in exactly one place after every event; the
 * approvals gate the saw; nothing closes before QC releases; state and the
 * next step are computed; a shortage has no date; and rework to an earlier
 * station is never counted twice.
 */

import {
  DEFAULT_MFG_SETTINGS,
  allocateStock,
  bottleneck,
  candidates,
  canDo,
  computeOrder,
  conservationGap,
  daysFrom,
  addDaysISO,
  emptyProgress,
  estimateExpired,
  estimateIncomplete,
  formatDocNumber,
  hourVariance,
  materialNeed,
  materialState,
  minQuantity,
  needRemain,
  normalizeMfgSettings,
  orderCost,
  ownsCandidate,
  releaseBlocks,
  roundNeed,
  scheduleOrders,
  shortages,
  standardCost,
  stationBlocks,
  stationGate,
  unitSunkCost,
  verdict,
  whyLate,
  type Actor,
  type CandidateContext,
  type DeptCapacityFields,
  type MfgNoteSlice,
  type MfgOrderSlice,
  type MfgProduct,
  type StockIndex,
  type WorkOrderMaterial,
} from "@/lib/manufacturing-engine"

const S = DEFAULT_MFG_SETTINGS
const NOW = new Date("2026-09-13T09:00:00Z").getTime()
const TODAY = "2026-09-13"

const DEPTS: DeptCapacityFields[] = [
  { id: "s1", name: "Design & nesting", workers: 2, hoursPerDay: 8, hourlyRate: 85, gate: "drawing" },
  { id: "s6", name: "Slab selection & sign-off", workers: 1, hoursPerDay: 8, hourlyRate: 65, gate: "slab" },
  { id: "s7", name: "Bridge-saw cutting", workers: 2, hoursPerDay: 8, hourlyRate: 70, gate: null, leadUserId: "sami" },
  { id: "s8", name: "Profiling & edges", workers: 3, hoursPerDay: 8, hourlyRate: 60, gate: null, leadUserId: "ammar" },
  { id: "s10", name: "Polishing & sealing", workers: 2, hoursPerDay: 8, hourlyRate: 58, gate: null },
  { id: "s5", name: "QC & packing", workers: 2, hoursPerDay: 8, hourlyRate: 45, gate: null, qcStation: true },
]

const COUNTER: MfgProduct = {
  id: "pr11",
  organizationId: "org",
  name: "Kitchen counter — Crema Marfil",
  unit: "m²",
  family: "stone",
  requiresMeasurement: true,
  requiresDrawingApproval: true,
  requiresSlabApproval: true,
  wastePercent: 32,
  referenceBuyPrice: 780,
  route: [
    { departmentId: "s1", departmentName: "Design", hoursPerUnit: 0.09 },
    { departmentId: "s6", departmentName: "Slab", hoursPerUnit: 0.07 },
    { departmentId: "s7", departmentName: "Cutting", hoursPerUnit: 0.36 },
    { departmentId: "s8", departmentName: "Profiling", hoursPerUnit: 0.42 },
    { departmentId: "s10", departmentName: "Polishing", hoursPerUnit: 0.3 },
    { departmentId: "s5", departmentName: "QC", hoursPerUnit: 0.09 },
  ],
  bom: [
    { itemName: "Crema Marfil slab", unit: "m²", qtyPerUnit: 1, departmentId: "s7", withWaste: true, unitCost: 320, lotted: true },
    { itemName: "Diamond blades", unit: "pc", qtyPerUnit: 0.016, departmentId: "s7", withWaste: false, unitCost: 340, custody: true },
    { itemName: "Stone epoxy", unit: "pail", qtyPerUnit: 0.07, departmentId: "s8", withWaste: false, unitCost: 95, custody: true },
    { itemName: "Timber crate", unit: "crate", qtyPerUnit: 0.06, departmentId: "s5", withWaste: false, unitCost: 85, custody: true },
  ],
}

const SKIRTING: MfgProduct = {
  ...COUNTER,
  id: "pr15",
  name: "Marble skirting 10 cm",
  unit: "m",
  requiresMeasurement: false,
  requiresDrawingApproval: false,
  requiresSlabApproval: false,
  wastePercent: 15,
  referenceBuyPrice: 70,
  route: [
    { departmentId: "s7", departmentName: "Cutting", hoursPerUnit: 0.06 },
    { departmentId: "s8", departmentName: "Profiling", hoursPerUnit: 0.07 },
    { departmentId: "s10", departmentName: "Polishing", hoursPerUnit: 0.05 },
    { departmentId: "s5", departmentName: "QC", hoursPerUnit: 0.02 },
  ],
  bom: [{ itemName: "Beige Sahel slab", unit: "m²", qtyPerUnit: 0.12, departmentId: "s7", withWaste: true, unitCost: 245 }],
}

function order(over: Partial<MfgOrderSlice> = {}, product: MfgProduct = COUNTER): MfgOrderSlice {
  return {
    id: "o1",
    number: 42,
    productId: product.id,
    quantity: 20,
    neededBy: "2026-09-30",
    createdAt2: "2026-09-01T08:00:00Z",
    releasedAt: null,
    source: "project",
    downPayment: { required: false, confirmed: true, percent: null },
    survey: null,
    drawing: null,
    slabApproval: null,
    rush: null,
    progress: emptyProgress(product.route),
    materials: [],
    scrap: [],
    rejects: [],
    qcReleases: [],
    closures: [],
    frozenCost: null,
    remade: 0,
    shortfall: 0,
    brokenResolved: 0,
    remnants: [],
    purchaseRequests: [],
    overrides: {},
    changeRequest: null,
    cancellation: null,
    varianceReviews: {},
    status: "open",
    ...over,
  }
}

const received = (itemName: string, departmentId: string, quantity: number, unitCost = 320): WorkOrderMaterial => ({
  id: `${itemName}_${departmentId}_${quantity}`,
  requestNumber: "WR-2026/001",
  itemName,
  unit: "m²",
  quantity,
  departmentId,
  lot: "BLK-4471",
  state: "received",
  unitCost,
  warehouseId: "w1",
  requestedByUserId: "sami",
  requestedByName: "Abu Sami",
  requestedAt: "2026-09-05T08:00:00Z",
})

const prog = (rows: Array<[number, number, number?, number?, number?]>) =>
  COUNTER.route.map((r, i) => {
    const [done, rejected, hours, rework, back] = rows[i] || [0, 0]
    return { departmentId: r.departmentId, done, rejected, hours: hours || 0, rework: rework || 0, back: back || 0 }
  })

/** Released, surveyed, drawing A, slab signed, slab received — at cutting. */
function atCutting(over: Partial<MfgOrderSlice> = {}): MfgOrderSlice {
  return order({
    releasedAt: "2026-09-05T08:00:00Z",
    survey: { at: "2026-09-04", by: "Eng. Badr", sketchUrl: "x", sketchName: "sketch.pdf" },
    drawing: { revision: 1, approverOrg: "technical_office", submittedAt: "2026-09-05T09:00:00Z", submittedBy: "Badr", code: "A", recordedAt: "2026-09-06T09:00:00Z" },
    slabApproval: { at: "2026-09-07T09:00:00Z", by: "Eng. Lama", lot: "BLK-4471", quantity: 26.4 },
    materials: [received("Crema Marfil slab", "s7", 26.4)],
    ...over,
  })
}

const ctx = (alloc: CandidateContext["alloc"] = null): CandidateContext => ({ settings: S, alloc, today: TODAY, nowMs: NOW })
const manager: Actor = { uid: "badr", manage: true, work: false, qc: false, cost: false, view: false }
const sami: Actor = { uid: "sami", manage: false, work: true, qc: false, cost: false, view: false }
const lama: Actor = { uid: "lama", manage: false, work: false, qc: true, cost: false, view: false }
const noura: Actor = { uid: "noura", manage: false, work: false, qc: false, cost: true, view: false }

describe("settings and helpers", () => {
  it("normalizes Finance's policies over the defaults", () => {
    const s = normalizeMfgSettings({ scrapApprovalLimit: 5000, features: { time: false, estimates: true, checklists: true } })
    expect(s.scrapApprovalLimit).toBe(5000)
    expect(s.noteEscalationHours).toBe(48)
    expect(s.estimateValidityDays).toBe(15)
    expect(s.features.time).toBe(false)
  })

  it("rounds a need up: fractions to a decimal, counted units whole", () => {
    expect(roundNeed("m²", 26.41)).toBe(26.5)
    expect(roundNeed("pc", 0.32)).toBe(1)
    expect(roundNeed("م²", 3.0)).toBe(3)
  })

  it("reads an order-level step from the station name until one is set", () => {
    expect(stationGate({ name: "التصميم والتقطيع النظري" })).toBe("drawing")
    expect(stationGate({ name: "فرز البلاطات واعتماد العميل" })).toBe("slab")
    expect(stationGate({ name: "Design", gate: null })).toBeNull()
  })

  it("numbers documents per type and year", () => {
    expect(formatDocNumber("WO", 2026, 57)).toBe("WO-2026/057")
    expect(daysFrom("2026-09-13", "2026-09-20")).toBe(7)
    expect(addDaysISO("2026-09-13", 3)).toBe("2026-09-16")
  })
})

describe("the gates before production", () => {
  it("a client order waits for Finance: planned, never released (ORD-12)", () => {
    const c = computeOrder(order({ source: "client", downPayment: { required: true, confirmed: false, percent: 40 } }), COUNTER, DEPTS, [])
    expect(c.stage).toBe("pay")
    expect(releaseBlocks(c).map((b) => b.key)).toEqual(["down_payment", "survey"])
    const cs = candidates(c, ctx())
    expect(cs[0]).toMatchObject({ key: "down_payment", owner: { kind: "external", module: "finance" } })
    expect(cs.some((x) => x.key === "release" || x.key === "survey")).toBe(false)
  })

  it("made to measure: the survey comes before release (ORD-10)", () => {
    const c = computeOrder(order(), COUNTER, DEPTS, [])
    expect(c.stage).toBe("wait")
    expect(candidates(c, ctx()).map((x) => x.key)).toEqual(["survey"])
    const surveyed = computeOrder(order({ survey: { at: "2026-09-04", by: "Badr", sketchUrl: "u" } }), COUNTER, DEPTS, [])
    expect(candidates(surveyed, ctx()).map((x) => x.key)).toEqual(["release"])
    expect(releaseBlocks(surveyed)).toEqual([])
  })

  it("released: design holds the quantity until the drawing is approved in the approver's module", () => {
    const released = order({ releasedAt: "2026-09-05T08:00:00Z", survey: { at: "2026-09-04", by: "Badr" } })
    const draft = computeOrder(released, COUNTER, DEPTS, [])
    expect(draft.pend[0]).toBe(20)
    expect(candidates(draft, ctx())[0]).toMatchObject({ key: "submit_drawing", departmentId: "s1" })

    const atApproval = computeOrder({ ...released, drawing: { revision: 1, approverOrg: "consultant", submittedAt: "2026-09-06T08:00:00Z", submittedBy: "Badr", code: null } }, COUNTER, DEPTS, [])
    const wait = candidates(atApproval, ctx())[0]
    expect(wait).toMatchObject({ key: "drawing_wait", owner: { kind: "external", module: "projects" } })
    expect(ownsCandidate(wait, manager, DEPTS, S)).toBe(false)

    const approved = computeOrder({ ...released, drawing: { revision: 1, approverOrg: "consultant", submittedAt: "2026-09-06T08:00:00Z", submittedBy: "Badr", code: "B", resultNotes: "3 mm radius" } }, COUNTER, DEPTS, [])
    expect(approved.pend[0]).toBe(0)
    expect(approved.pend[1]).toBe(20)
    expect(candidates(approved, ctx())[0]).toMatchObject({ key: "slab", owner: { kind: "manager_or_qc" } })
  })

  it("a C sends the drawing back to design with its notes", () => {
    const c = computeOrder(
      order({ releasedAt: "2026-09-05T08:00:00Z", survey: { at: "x", by: "b" }, drawing: { revision: 1, approverOrg: "technical_office", submittedAt: null, submittedBy: "Badr", code: null, previousC: "Move the cut-outs" } }),
      COUNTER,
      DEPTS,
      []
    )
    expect(c.drawingState).toBe("draft")
    expect(candidates(c, ctx())[0]).toMatchObject({ key: "submit_drawing", previousC: "Move the cut-outs" })
  })

  it("the approvals gate the saw when the route has no order-level steps", () => {
    const depts = DEPTS.map((d) => ({ ...d, gate: null }))
    const c = computeOrder(order({ releasedAt: "2026-09-05T08:00:00Z", survey: { at: "x", by: "b" } }), COUNTER, depts, [])
    expect(c.firstQ).toBe(0)
    expect(stationBlocks(c, 0).map((b) => b.key)).toEqual(["drawing", "slab"])
  })
})

describe("materials and coverage", () => {
  it("the slab is requested per order with waste; custody consumables are not", () => {
    const c = computeOrder(atCutting({ materials: [] }), COUNTER, DEPTS, [])
    const i = c.firstQ
    expect(c.route[i].departmentId).toBe("s7")
    expect(materialNeed(c, i)).toEqual([expect.objectContaining({ itemName: "Crema Marfil slab", net: 20, qty: 26.4 })])
    expect(materialState(c, i)).toBe("missing")
    expect(canDo(c, i)).toBe(0)
    const cs = candidates(c, ctx())
    expect(cs.find((x) => x.key === "request_materials")).toMatchObject({ departmentId: "s7" })
    expect(cs.some((x) => x.key === "output")).toBe(false)
    expect(stationBlocks(c, i)).toEqual([expect.objectContaining({ key: "materials", severity: "soft", covers: 0 })])
  })

  it("output is allowed up to what the received slab covers; an override lifts it (MAT-03)", () => {
    const half = computeOrder(atCutting({ materials: [received("Crema Marfil slab", "s7", 13.2)] }), COUNTER, DEPTS, [])
    expect(canDo(half, 2)).toBe(10)
    const overridden = computeOrder(atCutting({ materials: [], overrides: { s7: { reason: "Offcuts from WO 040", by: "Badr", at: "x" } } }), COUNTER, DEPTS, [])
    expect(stationBlocks(overridden, 2)).toEqual([])
    expect(candidates(overridden, ctx()).find((x) => x.key === "output")).toBeTruthy()
  })

  it("the station lead owns cutting; the manager does not act for an owned station", () => {
    const c = computeOrder(atCutting(), COUNTER, DEPTS, [])
    const out = candidates(c, ctx()).find((x) => x.key === "output")!
    expect(ownsCandidate(out, sami, DEPTS, S)).toBe(true)
    expect(ownsCandidate(out, manager, DEPTS, S)).toBe(false)
    expect(ownsCandidate(out, lama, DEPTS, S)).toBe(false)
  })

  it("reservations are allocated in queue order and never double-spent (MAT-04)", () => {
    const stock: StockIndex = { onHand: new Map([["crema marfil slab", 30]]), lots: [{ itemName: "Crema Marfil slab", lot: "BLK-4471", quantity: 30 }] }
    const first = computeOrder(atCutting({ id: "a", materials: [], rush: { reason: "promised", by: "Badr", at: "x" } }), COUNTER, DEPTS, [])
    const second = computeOrder(atCutting({ id: "b", materials: [] }), COUNTER, DEPTS, [])
    expect(needRemain(first, "Crema Marfil slab")).toBe(26.4)
    const alloc = allocateStock([second, first], stock)
    expect(alloc.reserved.get("a")?.get("crema marfil slab")).toBe(26.4)
    expect(alloc.reserved.get("b")?.get("crema marfil slab")).toBe(3.6)
    expect(shortages(first, alloc)).toEqual([])
    expect(shortages(second, alloc)).toEqual([expect.objectContaining({ itemName: "Crema Marfil slab", short: 22.8, requested: null })])
    expect(candidates(second, ctx(alloc)).find((x) => x.key === "shortage")).toMatchObject({ quantity: 22.8, owner: { kind: "manager" } })
  })

  it("a shortage has no date until it arrives (ORD-16, D16)", () => {
    const stock: StockIndex = { onHand: new Map(), lots: [] }
    const c = computeOrder(atCutting({ materials: [] }), COUNTER, DEPTS, [])
    const alloc = allocateStock([c], stock)
    const sched = scheduleOrders([c], DEPTS, new Map(), alloc).get("o1")!
    expect(sched.finishDays).toBeNull()
    expect(sched.condition).toBe("materials")
    expect(whyLate(c, alloc, sched, NOW)).toMatchObject({ key: "shortage", quantity: 26.4 })
    const requested = computeOrder(atCutting({ materials: [], purchaseRequests: [{ id: "p", itemName: "Crema Marfil slab", unit: "m²", quantity: 26.4, needBy: null, note: null, by: "Badr", at: "x", state: "sent" }] }), COUNTER, DEPTS, [])
    const cs = candidates(requested, ctx(allocateStock([requested], stock)))
    expect(cs.some((x) => x.key === "shortage")).toBe(false)
    expect(cs.find((x) => x.key === "purchase_wait")).toMatchObject({ owner: { kind: "external", module: "procurement" } })
  })
})

describe("every unit in one place", () => {
  it("output, rejects and rework to an earlier station are never double-counted", () => {
    // 20 m²: cut 20, profiled 14 with 4 rejected (2 still in hand).
    const base = atCutting({ progress: prog([[0, 0], [0, 0], [20, 0, 7], [14, 4, 6]]) })
    const c = computeOrder(base, COUNTER, DEPTS, [])
    expect(c.pend[3]).toBe(2)
    expect(c.pend[4]).toBe(14)
    expect(c.rejected).toBe(4)
    expect(conservationGap(c)).toBe(0)

    // QC sends 3 back to cutting: they leave profiling (back) and re-enter cutting (rework).
    const reworked = computeOrder(atCutting({ progress: prog([[0, 0], [0, 0], [20, 0, 7, 3], [14, 1, 6, 0, 3]]) }), COUNTER, DEPTS, [])
    expect(reworked.pend[2]).toBe(3)
    expect(reworked.pend[3]).toBe(2)
    expect(reworked.wip).toBe(19)
    expect(conservationGap(reworked)).toBe(0)

    // Cutting redoes them and hands over: profiling holds 5, not 8.
    const redone = computeOrder(atCutting({ progress: prog([[0, 0], [0, 0], [23, 0, 8, 3], [14, 1, 6, 0, 3]]) }), COUNTER, DEPTS, [])
    expect(redone.pend[2]).toBe(0)
    expect(redone.pend[3]).toBe(5)
    expect(conservationGap(redone)).toBe(0)
  })

  it("scrap leaves the station; the re-make re-enters the first unit step", () => {
    const withScrap = atCutting({
      progress: prog([[0, 0], [0, 0], [20, 0], [14, 0]]),
      scrap: [{ id: "sc", quantity: 6, value: 3000, reason: "vein crack", departmentId: "s8", index: 3, raisedByUserId: "lama", raisedByName: "Lama", raisedAt: "2026-09-12T08:00:00Z", status: "pending", decision: null }],
    })
    const c = computeOrder(withScrap, COUNTER, DEPTS, [])
    expect(c.pend[3]).toBe(0)
    expect(c.scrapUndecided).toBe(6)
    expect(conservationGap(c)).toBe(0)
    const cs = candidates(c, ctx())
    expect(cs.find((x) => x.key === "scrap_review")).toMatchObject({ owner: { kind: "scrap", value: 3000 } })
    expect(cs.find((x) => x.key === "remake_scrap")).toMatchObject({ quantity: 6, approvalRunning: true })

    const remade = computeOrder(
      { ...withScrap, remade: 6, scrap: withScrap.scrap.map((s) => ({ ...s, decision: "remake" as const })), progress: prog([[0, 0], [0, 0], [20, 0, 0, 6], [14, 0]]) },
      COUNTER,
      DEPTS,
      []
    )
    expect(remade.pend[2]).toBe(6)
    expect(conservationGap(remade)).toBe(0)
  })

  it("scrap review: the manager up to Finance's limit, the cost controller above", () => {
    const small = { key: "scrap_review" as const, owner: { kind: "scrap" as const, value: 1200 }, severity: "r" as const }
    const big = { ...small, owner: { kind: "scrap" as const, value: 4257 } }
    expect(ownsCandidate(small, manager, DEPTS, S)).toBe(true)
    expect(ownsCandidate(big, manager, DEPTS, S)).toBe(false)
    expect(ownsCandidate(big, noura, DEPTS, S)).toBe(true)
    expect(ownsCandidate(big, lama, DEPTS, S)).toBe(false)
  })

  it("only Quality releases out of QC & packing; nothing is ready before a close decision", () => {
    const packed = atCutting({ progress: prog([[0, 0], [0, 0], [20, 0], [20, 0], [20, 0], [0, 0]]) })
    const atQc = computeOrder(packed, COUNTER, DEPTS, [])
    const rel = candidates(atQc, ctx()).find((x) => x.key === "qc_release")!
    expect(rel).toMatchObject({ owner: { kind: "qc" }, quantity: 20 })
    expect(ownsCandidate(rel, lama, DEPTS, S)).toBe(true)
    expect(ownsCandidate(rel, manager, DEPTS, S)).toBe(false)

    const released = computeOrder(atCutting({ progress: prog([[0, 0], [0, 0], [20, 0], [20, 0], [20, 0], [20, 0]]) }), COUNTER, DEPTS, [])
    expect(released.stage).toBe("close")
    expect(released.ready).toBe(0)
    expect(candidates(released, ctx())[0]).toMatchObject({ key: "close", quantity: 20 })

    const closed = computeOrder(atCutting({ progress: prog([[0, 0], [0, 0], [20, 0], [20, 0], [20, 0], [20, 0]]), closures: [{ quantity: 12, by: "Badr", at: "x" }] }), COUNTER, DEPTS, [])
    expect(closed.ready).toBe(12)
    expect(closed.toClose).toBe(8)
    expect(conservationGap(closed)).toBe(0)
  })

  it("the note is ours until received; breakage opens a decision; closed = all received", () => {
    const finished = atCutting({ progress: prog([[0, 0], [0, 0], [20, 0], [20, 0], [20, 0], [20, 0]]), closures: [{ quantity: 20, by: "Badr", at: "x" }] })
    const out: MfgNoteSlice[] = [{ id: "n1", number: "DN-2026/061", quantity: 20, brokenQuantity: 0, status: "in_transit", sentAt: "2026-09-10T08:00:00Z", toKind: "project" }]
    const transit = computeOrder(finished, COUNTER, DEPTS, out)
    expect(transit.stage).toBe("transit")
    const wait = candidates(transit, ctx()).find((x) => x.key === "receipt_wait")!
    expect(wait).toMatchObject({ owner: { kind: "external", module: "projects" }, escalated: true })

    const broken = computeOrder(finished, COUNTER, DEPTS, [{ ...out[0], status: "received", brokenQuantity: 2 }])
    expect(broken.delivered).toBe(18)
    expect(broken.brokenOpen).toBe(2)
    expect(broken.done_).toBe(false)
    expect(conservationGap(broken)).toBe(0)
    expect(candidates(broken, ctx())[0]).toMatchObject({ key: "remake_breakage", quantity: 2 })

    const short = computeOrder({ ...finished, shortfall: 2, brokenResolved: 2 }, COUNTER, DEPTS, [{ ...out[0], status: "received", brokenQuantity: 2 }])
    expect(short.target).toBe(18)
    expect(short.done_).toBe(true)
    expect(short.stage).toBe("done")
    expect(candidates(short, ctx())).toEqual([])
  })

  it("an order from before production close: what finished counts as closed", () => {
    const legacy = computeOrder(atCutting({ closures: null, progress: prog([[0, 0], [0, 0], [20, 0], [20, 0], [20, 0], [20, 0]]) }), COUNTER, DEPTS, [])
    expect(legacy.toClose).toBe(0)
    expect(legacy.ready).toBe(20)
    expect(legacy.stage).toBe("ready")
  })

  it("the minimum after a change is what already entered production (ORD-11)", () => {
    const c = computeOrder(atCutting({ progress: prog([[0, 0], [0, 0], [12, 1], [8, 0]]) }), COUNTER, DEPTS, [])
    expect(minQuantity(c)).toBe(13)
  })
})

describe("capacity and the honest date", () => {
  it("today's stops move every possible date through the station (FL-14)", () => {
    const c = computeOrder(order({ releasedAt: "x", survey: { at: "x", by: "b" }, quantity: 500 }, SKIRTING), SKIRTING, DEPTS, [])
    const calm = scheduleOrders([c], DEPTS).get("o1")!
    const stopped = scheduleOrders([c], DEPTS, new Map([["s7", 12]])).get("o1")!
    expect(stopped.finishDays!).toBeGreaterThan(calm.finishDays!)
    expect(bottleneck([c], DEPTS, new Map([["s7", 12]]))?.departmentId).toBe("s7")
  })

  it("a step without standard time is left out of the queue and blocks a cost statement", () => {
    const partial: MfgProduct = { ...SKIRTING, route: SKIRTING.route.map((r, i) => (i === 1 ? { ...r, hoursPerUnit: null } : r)) }
    const std = standardCost(partial, DEPTS, S, 10)
    expect(std.unestimated).toEqual(["s8"])
    const inc = estimateIncomplete({ lines: [{ productId: "pr15", productName: "x", quantity: 10, unit: "m", materialCost: 0, labourCost: 0, overheadCost: 0, hours: 0, totalCost: 0 }] }, new Map([["pr15", partial]]), S)
    expect(inc).toEqual([{ productId: "pr15", departmentIds: ["s8"] }])
  })

  it("a cost statement expires after its validity unless Sales closed it", () => {
    expect(estimateExpired({ state: "sent", sentAt: "2026-08-20T08:00:00Z", validityDays: 15 }, TODAY, S)).toBe(true)
    expect(estimateExpired({ state: "won", sentAt: "2026-08-20T08:00:00Z", validityDays: 15 }, TODAY, S)).toBe(false)
    expect(estimateExpired({ state: "sent", sentAt: "2026-09-10T08:00:00Z", validityDays: 15 }, TODAY, S)).toBe(false)
  })
})

describe("cost — one WIP, earned standard", () => {
  it("cost lands at receipt; custody is charged at output; WIP = good cost − delivered share", () => {
    const c = computeOrder(atCutting({ progress: prog([[0, 0], [0, 0], [20, 0, 8], [10, 0, 5]]) }), COUNTER, DEPTS, [])
    const cost = orderCost(c, DEPTS, S)
    expect(cost.materials).toBe(8448)
    expect(cost.custody).toBeCloseTo(0.016 * 20 * 340 + 0.07 * 10 * 95, 1)
    expect(cost.labour).toBe(8 * 70 + 5 * 60)
    expect(cost.overhead).toBe(13 * 32)
    expect(cost.wip).toBe(cost.total)
    expect(cost.earnedStandard).toBeGreaterThan(0)
    expect(cost.variancePercent).not.toBeNull()
  })

  it("scrap is valued at what the unit had sunk up to its station", () => {
    expect(unitSunkCost(COUNTER, DEPTS, S, 2)).toBeGreaterThan(unitSunkCost(COUNTER, DEPTS, S, 1))
  })

  it("a variance is flagged once and stays quiet after review (FL-05)", () => {
    const over = atCutting({ progress: prog([[0, 0], [0, 0], [20, 0, 12]]) })
    expect(hourVariance(computeOrder(over, COUNTER, DEPTS, []), S)).toMatchObject({ departmentId: "s7" })
    const reviewed = { ...over, varianceReviews: { s7: { cause: "standard_wrong" as const, note: null, by: "Noura", at: "x" } } }
    expect(hourVariance(computeOrder(reviewed, COUNTER, DEPTS, []), S)).toBeNull()
  })

  it("make or buy is computed, not an opinion", () => {
    const v = verdict({ ...SKIRTING, referenceBuyPrice: 5 }, 100, 30, [], DEPTS, S)
    expect(v.kind).toBe("buy_price")
    expect(verdict(SKIRTING, 100, 30, [], DEPTS, S).kind).toBe("make")
  })
})
