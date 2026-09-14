/**
 * Requests & cost statements — the pure half of the Requests screen: the two
 * doors, segments, the answer window, screening per line, the make answer's
 * validation and the cost statement's status (PRD 1.2 REQ-01…REQ-09).
 */

import { DEFAULT_MFG_SETTINGS, type DeptCapacityFields, type MfgCostEstimate, type MfgProduct } from "@/lib/manufacturing-engine"
import {
  answerWindow,
  defaultMakeQty,
  effectiveSegment,
  estimateNeedsWork,
  estimateStatus,
  inRequestSegment,
  makeRemainders,
  matchProduct,
  neededInDays,
  parseRequestSegment,
  requestDownPayment,
  requestSegmentCounts,
  requestSource,
  requestSourceInfo,
  requestState,
  salesQuoteState,
  screenRequest,
  slabNeed,
  summarizeScreen,
  validateMakeLines,
  verdictReason,
  type ScreenContext,
} from "@/lib/manufacturing-requests"
import type { ManufacturingRequest } from "@/lib/sales-orders"

const TODAY = "2026-09-14"
const NOW = new Date("2026-09-14T12:00:00Z").getTime()
const SETTINGS = DEFAULT_MFG_SETTINGS
const DEPTS: DeptCapacityFields[] = [
  { id: "cut", name: "Cutting", workers: 2, hoursPerDay: 8, hourlyRate: 70 },
  { id: "pol", name: "Polishing", workers: 2, hoursPerDay: 8, hourlyRate: 58 },
]

const COUNTER: MfgProduct = {
  id: "p1",
  organizationId: "org",
  name: "Kitchen counter",
  unit: "m²",
  family: "stone",
  requiresMeasurement: true,
  requiresDrawingApproval: false,
  requiresSlabApproval: true,
  wastePercent: 30,
  referenceBuyPrice: 5000,
  route: [
    { departmentId: "cut", departmentName: "Cutting", hoursPerUnit: 0.5 },
    { departmentId: "pol", departmentName: "Polishing", hoursPerUnit: 0.3 },
  ],
  bom: [
    { itemName: "Crema slab", unit: "m²", qtyPerUnit: 1, departmentId: "cut", withWaste: true, unitCost: 200 },
    { itemName: "Blade", unit: "pc", qtyPerUnit: 0.01, departmentId: "cut", withWaste: false, unitCost: 300, custody: true },
  ],
}

const request = (over: Partial<ManufacturingRequest> = {}): ManufacturingRequest => ({
  id: "r1",
  organizationId: "org",
  requestNumber: "MR-2026/045",
  itemName: "Kitchen counter",
  unit: "m²",
  quantity: 10,
  status: "new",
  sourceKind: "sales",
  kind: "make",
  orderId: "so1",
  orderNumber: 134,
  contactName: "Namaa",
  neededBy: "2026-10-02",
  lines: [{ productId: "p1", itemName: "Kitchen counter", unit: "m²", quantity: 10 }],
  createdByUserId: "u-sales",
  createdByUserName: "Reem",
  requestedAt: "2026-09-14T08:00:00Z",
  ...over,
})

const ctx: ScreenContext = {
  products: [COUNTER],
  productById: new Map([[COUNTER.id, COUNTER]]),
  calcs: [],
  departments: DEPTS,
  settings: SETTINGS,
  lost: new Map(),
  free: new Map([["crema slab", 8]]),
  today: TODAY,
}

describe("segments", () => {
  it("parses and falls back when cost estimating is off", () => {
    expect(parseRequestSegment("estimates")).toBe("estimates")
    expect(parseRequestSegment("nope")).toBeNull()
    expect(effectiveSegment("estimates", false)).toBe("new")
    expect(inRequestSegment({ status: "new" }, "new")).toBe(true)
    expect(inRequestSegment({ status: "accepted" }, "answered")).toBe(true)
    expect(inRequestSegment({ status: "accepted" }, "estimates")).toBe(false)
  })

  it("counts drafts and expired statements as the cost controller's work", () => {
    const estimates = [
      { state: "draft", sentAt: null, validityDays: 15 },
      { state: "sent", sentAt: "2026-08-01", validityDays: 15 },
      { state: "sent", sentAt: "2026-09-10", validityDays: 15 },
    ] as Array<Pick<MfgCostEstimate, "state" | "sentAt" | "validityDays">>
    expect(estimateNeedsWork(estimates[1], TODAY, SETTINGS)).toBe(true)
    expect(requestSegmentCounts([{ status: "new" }, { status: "rejected" }], estimates, true, TODAY, SETTINGS)).toEqual({ new: 1, estimates: 2, answered: 1, all: 5 })
  })
})

describe("the request", () => {
  it("has two doors — project requests reach us through Procurement", () => {
    expect(requestSource({ sourceKind: "sales", orderId: null })).toBe("sales")
    expect(requestSource({ sourceKind: "project", orderId: null })).toBe("procurement")
    expect(requestSource({ sourceKind: undefined, orderId: "so1" })).toBe("sales")
  })

  it("reads the down payment from the sales order", () => {
    const r = request()
    expect(requestDownPayment(r, { payment: { kind: "deposit", depositPercent: 30, depositPaid: false } })).toBe("pending")
    expect(requestDownPayment(r, { payment: { kind: "deposit", depositPercent: 30, depositPaid: true } })).toBe("confirmed")
    expect(requestDownPayment(r, { payment: { kind: "cash" } as never })).toBe("none")
    expect(requestDownPayment(request({ kind: "cost" }), { payment: { kind: "deposit", depositPaid: false } })).toBeNull()
  })

  it("names its references per door", () => {
    expect(requestSourceInfo(request()).refs).toEqual([{ kind: "sales_order", ref: "SO-134" }])
    const proc = requestSourceInfo(request({ sourceKind: "procurement", orderId: null, orderNumber: null, projectName: "Clinics", purchaseRequestRef: "PR-79", pmRequestRef: "MRQ-63", costItemName: "Flooring" }))
    expect(proc.name).toBe("Clinics")
    expect(proc.refs.map((x) => x.kind)).toEqual(["purchase_request", "pm_request", "cost_item"])
  })

  it("is overdue after the answer window", () => {
    expect(answerWindow(request(), 24, NOW)).toMatchObject({ overdue: false, leftHours: 20 })
    expect(requestState(request({ requestedAt: "2026-09-13T08:00:00Z" }), 24, NOW)).toBe("overdue")
    expect(requestState(request({ status: "estimated" }), 24, NOW)).toBe("costed")
    expect(requestState(request({ status: "rejected" }), 24, NOW)).toBe("declined")
  })
})

describe("screening", () => {
  it("matches a line by id, else by name", () => {
    expect(matchProduct({ productId: null, itemName: " kitchen COUNTER " }, [COUNTER], new Map())).toBe(COUNTER)
    expect(matchProduct({ productId: "zz", itemName: "Other" }, [COUNTER], ctx.productById)).toBeNull()
  })

  it("screens each line with its verdict and the slab against stock", () => {
    const lines = screenRequest(request(), ctx)
    expect(neededInDays(request(), TODAY)).toBe(18)
    expect(lines[0].verdict?.kind).toBe("make")
    expect(defaultMakeQty(lines[0])).toBe(10)
    // 10 m² × 1.3 waste = 13 needed, 8 free.
    expect(lines[0].slab).toEqual({ itemName: "Crema slab", unit: "m²", need: 13, available: 8 })
    expect(slabNeed(COUNTER, 1, null)?.available).toBeNull()
    const sum = summarizeScreen(lines)
    expect(sum.unscreened).toBe(0)
    expect(sum.fullCost).toBeGreaterThan(0)
  })

  it("gives buy-on-price its reason and no make quantity", () => {
    const cheap = { ...COUNTER, referenceBuyPrice: 10 }
    const lines = screenRequest(request(), { ...ctx, products: [cheap], productById: new Map([[cheap.id, cheap]]) })
    expect(lines[0].verdict?.kind).toBe("buy_price")
    expect(defaultMakeQty(lines[0])).toBe(0)
    expect(verdictReason(lines[0].verdict!, 18).key).toBe("buy_materials_dearer")
  })

  it("leaves a line with no product card unscreened", () => {
    const lines = screenRequest(request({ lines: [{ productId: null, itemName: "Unknown", unit: "m", quantity: 4 }] }), ctx)
    expect(lines[0].verdict).toBeNull()
    expect(summarizeScreen(lines).unscreened).toBe(1)
  })
})

describe("the make answer", () => {
  it("needs one quantity, within the ask, on a product card", () => {
    expect(validateMakeLines([{ asked: 10, qty: 0, hasProduct: true }]).formError).toBe("nothing")
    expect(validateMakeLines([{ asked: 10, qty: 11, hasProduct: true }]).lineErrors).toEqual(["over"])
    expect(validateMakeLines([{ asked: 10, qty: 2, hasProduct: false }]).lineErrors).toEqual(["no_product"])
    expect(validateMakeLines([{ asked: 10, qty: 6, hasProduct: true }]).formError).toBeNull()
    expect(makeRemainders([{ asked: 10, qty: 6 }, { asked: 4, qty: 4 }])).toEqual([4, 0])
  })
})

describe("cost statements", () => {
  const base = { state: "sent", sentAt: "2026-09-10", validityDays: 15, quoteNumber: null } as Pick<MfgCostEstimate, "state" | "sentAt" | "validityDays" | "quoteNumber">
  it("is draft, sent or expired — and reads Sales' quote state", () => {
    expect(estimateStatus({ ...base, state: "draft", sentAt: null }, TODAY, SETTINGS)).toBe("draft")
    expect(estimateStatus(base, TODAY, SETTINGS)).toBe("sent")
    expect(estimateStatus({ ...base, sentAt: "2026-08-20" }, TODAY, SETTINGS)).toBe("expired")
    expect(salesQuoteState(base)).toBe("no_quote")
    expect(salesQuoteState({ ...base, state: "won" })).toBe("won")
    // Won or lost is Sales' closed record — it never expires.
    expect(estimateStatus({ ...base, state: "won", sentAt: "2026-08-01" }, TODAY, SETTINGS)).toBe("sent")
  })
})
