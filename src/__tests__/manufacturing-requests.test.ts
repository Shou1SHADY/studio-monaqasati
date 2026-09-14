/**
 * Requests & estimates — the pure half of the Requests screen: segments,
 * the answer window, make-or-buy screening with its one-line reason, and the
 * validation every answer/estimate form confirms against.
 */

import { DEFAULT_MFG_SETTINGS, type DeptCapacityFields, type MfgProduct, type ScheduleInput } from "@/lib/manufacturing-engine"
import {
  DEFAULT_NEED_DAYS,
  answerWindow,
  defaultAnswerRoute,
  defaultMakeQty,
  effectiveSegment,
  estimateEarliestDays,
  inRequestSegment,
  isLegacyRequest,
  mainMaterial,
  makeOrderCount,
  makeRemainder,
  neededInDays,
  parseRequestSegment,
  productForLine,
  quoteCheck,
  requestLines,
  requestSegmentCounts,
  requestSourceKind,
  screenRequest,
  sortEstimates,
  summarizeScreen,
  validateAward,
  validateMakeAnswer,
  validateNewRequest,
  validateQuote,
  validateValidityDays,
  verdictReason,
  type ScreenContext,
} from "@/lib/manufacturing-requests"
import type { ManufacturingRequest } from "@/lib/sales-orders"

const TODAY = "2026-09-14"
const DEPTS: DeptCapacityFields[] = [
  { id: "d1", workers: 2, hoursPerDay: 8, hourlyRate: 60 },
  { id: "d2", workers: 2, hoursPerDay: 8, hourlyRate: 60 },
]

// unit cost = 100 + 0.4×60 + 0.4×32 = 136.8
const SIMPLE: MfgProduct = {
  id: "p1",
  organizationId: "org",
  name: "باب",
  unit: "قطعة",
  family: "wood",
  requiresMeasurement: false,
  requiresDrawingApproval: false,
  requiresSlabApproval: false,
  wastePercent: 20,
  salePrice: null,
  estimateValue: null,
  referenceBuyPrice: 200,
  route: [
    { departmentId: "d1", departmentName: "القص", hoursPerUnit: 0.2 },
    { departmentId: "d2", departmentName: "التجميع", hoursPerUnit: 0.2 },
  ],
  bom: [
    { itemName: "مسمار", unit: "علبة", qtyPerUnit: 0.1, departmentId: "d2", withWaste: false, unitCost: 0 },
    { itemName: "لوح خشب", unit: "لوح", qtyPerUnit: 1, departmentId: "d1", withWaste: true, unitCost: 100 / 1.2 },
  ],
}

const ctx = (over: Partial<ScreenContext> = {}): ScreenContext => ({
  products: [SIMPLE],
  productById: new Map([[SIMPLE.id, SIMPLE]]),
  inputs: [],
  departments: DEPTS,
  settings: DEFAULT_MFG_SETTINGS,
  today: TODAY,
  ...over,
})

const req = (over: Partial<ManufacturingRequest> = {}): ManufacturingRequest => ({
  id: "r1",
  organizationId: "org",
  requestNumber: "MR-1",
  itemName: "باب",
  unit: "قطعة",
  quantity: 10,
  status: "new",
  sourceKind: "project",
  projectName: "برج الريان",
  neededBy: "2026-09-30",
  lines: [{ productId: "p1", itemName: "باب", unit: "قطعة", quantity: 10 }],
  createdByUserId: "u1",
  createdByUserName: "م. خالد",
  requestedAt: "2026-09-14T08:00:00Z",
  ...over,
})

describe("segments", () => {
  it("parses the URL segment and falls back while estimates are off", () => {
    expect(parseRequestSegment("answered")).toBe("answered")
    expect(parseRequestSegment("nope")).toBeNull()
    expect(effectiveSegment("estimates", false)).toBe("new")
    expect(effectiveSegment("estimates", true)).toBe("estimates")
  })

  it("counts open, answered, live estimates and everything", () => {
    const requests = [req(), req({ id: "r2", status: "accepted" }), req({ id: "r3", status: "rejected" })]
    const estimates = [{ state: "draft" as const }, { state: "lost" as const }]
    expect(requestSegmentCounts(requests, estimates, true)).toEqual({ new: 1, estimates: 1, answered: 2, all: 5 })
    expect(requestSegmentCounts(requests, estimates, false)).toEqual({ new: 1, estimates: 0, answered: 2, all: 3 })
    expect(inRequestSegment(requests[1], "new")).toBe(false)
    expect(inRequestSegment(requests[1], "answered")).toBe(true)
  })

  it("sorts estimates work-first", () => {
    const sorted = sortEstimates([{ state: "won" as const }, { state: "sent" as const }, { state: "draft" as const }, { state: "lost" as const }])
    expect(sorted.map((e) => e.state)).toEqual(["draft", "sent", "won", "lost"])
  })
})

describe("the request", () => {
  it("reads legacy single-item requests as one line", () => {
    const legacy = req({ lines: undefined, orderId: "so1", sourceKind: undefined })
    expect(isLegacyRequest(legacy)).toBe(true)
    expect(requestLines(legacy)).toEqual([{ productId: null, itemName: "باب", unit: "قطعة", quantity: 10 }])
    expect(requestSourceKind(legacy)).toBe("sales")
    // A legacy line finds its product card by name.
    expect(productForLine(requestLines(legacy)[0], [SIMPLE], new Map())).toBe(SIMPLE)
  })

  it("ages against the answer window", () => {
    const now = new Date("2026-09-14T18:00:00Z").getTime()
    expect(answerWindow(req(), 24, now)).toEqual({ ageHours: 10, overdue: false, leftHours: 14, overdueHours: 0 })
    const late = answerWindow(req({ requestedAt: "2026-09-12T12:00:00Z" }), 24, now)
    expect(late.overdue).toBe(true)
    expect(late.overdueHours).toBe(30)
    // An answered request never counts as overdue.
    expect(answerWindow(req({ status: "accepted", requestedAt: "2026-09-01T00:00:00Z" }), 24, now).overdue).toBe(false)
  })

  it("screens against two weeks when no date is named", () => {
    expect(neededInDays(req({ neededBy: null }), TODAY)).toBe(DEFAULT_NEED_DAYS)
    expect(neededInDays(req({ neededBy: "2026-09-10" }), TODAY)).toBe(0)
  })
})

describe("screening", () => {
  it("gives each line a verdict, a reason and a possible date", () => {
    const [line] = screenRequest(req(), ctx())
    expect(line.verdict?.kind).toBe("make")
    expect(line.reason).toEqual({ key: "make_ready", date: "2026-09-15", spareDays: 15 })
    expect(line.possibleDate).toBe("2026-09-15")
    expect(line.std?.total).toBeCloseTo(1368)
    expect(line.material).toEqual({ itemName: "لوح خشب", unit: "لوح", qty: 12, wastePercent: 20 })
  })

  it("explains why buying wins", () => {
    const cheap = { ...SIMPLE, referenceBuyPrice: 120 }
    const [line] = screenRequest(req(), ctx({ products: [cheap], productById: new Map([["p1", cheap]]) }))
    expect(line.verdict?.kind).toBe("buy_price")
    expect(line.reason).toEqual({ key: "buy_labour_gap", materialUnit: 100 })
    const dearer = { ...SIMPLE, referenceBuyPrice: 90 }
    const [l2] = screenRequest(req(), ctx({ products: [dearer], productById: new Map([["p1", dearer]]) }))
    expect(l2.reason?.key).toBe("buy_materials_dearer")
  })

  it("names the date the capacity runs out at", () => {
    const queue: ScheduleInput = {
      order: {
        id: "A",
        productId: "p1",
        quantity: 800,
        neededBy: null,
        createdAt2: "",
        releasedAt: "2026-09-01",
        measurement: null,
        drawingApprovalStatus: "na",
        slabApproval: null,
        rush: null,
        progress: [
          { departmentId: "d1", done: 0, rejected: 0, rework: 0, hours: 0 },
          { departmentId: "d2", done: 0, rejected: 0, rework: 0, hours: 0 },
        ],
        materials: [],
        scrap: [],
        status: "open",
      },
      product: SIMPLE,
      notes: [],
    }
    const lines = screenRequest(req({ neededBy: "2026-09-15" }), ctx({ inputs: [queue] }))
    expect(lines[0].verdict?.kind).toBe("buy_capacity")
    expect(lines[0].reason).toMatchObject({ key: "buy_capacity", needDate: "2026-09-15" })
    expect(defaultAnswerRoute(lines)).toBe("buy")
  })

  it("time off: no date, and the reason says so", () => {
    const off = { ...DEFAULT_MFG_SETTINGS, features: { ...DEFAULT_MFG_SETTINGS.features, time: false } }
    const [line] = screenRequest(req(), ctx({ settings: off }))
    expect(line.possibleDate).toBeNull()
    expect(line.reason).toEqual({ key: "make_untimed", hasBuyPrice: true })
    expect(verdictReason({ ...line.verdict!, buyPrice: null }, TODAY, 14)).toEqual({ key: "make_untimed", hasBuyPrice: false })
  })

  it("leaves a line with no product card unscreened", () => {
    const lines = screenRequest(req({ lines: [{ productId: null, itemName: "مجهول", unit: "م", quantity: 3 }] }), ctx())
    expect(lines[0].verdict).toBeNull()
    expect(summarizeScreen(lines).unscreened).toBe(1)
    expect(defaultAnswerRoute(lines)).toBe("make")
    expect(defaultMakeQty(lines[0], false)).toBe(0)
    expect(defaultMakeQty(lines[0], true)).toBe(3)
  })

  it("summarises the full cost and when all of it could be ready", () => {
    const two = req({
      lines: [
        { productId: "p1", itemName: "باب", unit: "قطعة", quantity: 10 },
        { productId: "p1", itemName: "باب", unit: "قطعة", quantity: 100 },
      ],
    })
    const s = summarizeScreen(screenRequest(two, ctx()))
    expect(s.fullCost).toBeCloseTo(136.8 * 110)
    expect(s.earliestAll! >= "2026-09-15").toBe(true)
  })

  it("picks the main material by planned waste", () => {
    expect(mainMaterial({ ...SIMPLE, bom: [] }, 1)).toBeNull()
  })
})

describe("the answer", () => {
  it("validates what the workshop takes on", () => {
    const lines = [
      { asked: 10, input: "10", makeable: true },
      { asked: 5, input: "", makeable: true },
    ]
    expect(validateMakeAnswer(lines).formError).toBeNull()
    expect(makeOrderCount(lines)).toBe(1)
    expect(makeRemainder(lines)).toBe(5)
    expect(validateMakeAnswer([{ asked: 10, input: "11", makeable: true }]).lineErrors).toEqual(["over"])
    expect(validateMakeAnswer([{ asked: 10, input: "-1", makeable: true }]).lineErrors).toEqual(["invalid"])
    expect(validateMakeAnswer([{ asked: 10, input: "2", makeable: false }]).lineErrors).toEqual(["no_product"])
    expect(validateMakeAnswer([{ asked: 10, input: "0", makeable: true }]).formError).toBe("nothing_made")
  })
})

describe("new request", () => {
  const base = { sourceKind: "project" as const, projectId: "pr1", neededBy: "2026-09-30", rows: [{ productId: "p1", quantity: "4" }] }
  it("accepts a complete request", () => {
    expect(validateNewRequest(base, TODAY).ok).toBe(true)
  })
  it("names each missing piece", () => {
    const { ok, errors } = validateNewRequest({ ...base, projectId: "", neededBy: "2026-09-01", rows: [{ productId: "p1", quantity: "" }, { productId: "", quantity: "" }] }, TODAY)
    expect(ok).toBe(false)
    expect(errors.project).toBe(true)
    expect(errors.neededBy).toBe("past")
    expect(errors.rows).toEqual([{ product: false, quantity: true }, { product: false, quantity: false }])
    expect(errors.noLines).toBe(true)
    expect(validateNewRequest({ ...base, sourceKind: "procurement", projectId: "" }, TODAY).ok).toBe(true)
  })
})

describe("estimates", () => {
  it("checks a quote against the finance floor", () => {
    // floor = 1000 / (1 - 0.18) = 1220
    expect(quoteCheck(1300, 1000, DEFAULT_MFG_SETTINGS)).toEqual({ floor: 1220, margin: 23, below: false, gap: 0 })
    expect(quoteCheck(1100, 1000, DEFAULT_MFG_SETTINGS)).toMatchObject({ below: true, gap: 120, margin: 9 })
    expect(quoteCheck(0, 1000, DEFAULT_MFG_SETTINGS)).toMatchObject({ below: false, margin: null })
  })

  it("needs a named finance approval below the floor", () => {
    const d = { quoteNumber: "Q-1", price: "1100", issuedBy: "ريم", financeApprover: "" }
    expect(validateQuote(d, 1000, DEFAULT_MFG_SETTINGS)).toMatchObject({ financeApprover: true, ok: false })
    expect(validateQuote({ ...d, financeApprover: "المدير المالي" }, 1000, DEFAULT_MFG_SETTINGS).ok).toBe(true)
    expect(validateQuote({ ...d, quoteNumber: " ", price: "x" }, 1000, DEFAULT_MFG_SETTINGS)).toMatchObject({ quoteNumber: true, price: true })
  })

  it("validates validity days and the award", () => {
    expect(validateValidityDays("15")).toBe(true)
    expect(validateValidityDays("0")).toBe(false)
    expect(validateValidityDays("2.5")).toBe(false)
    expect(validateAward({ date: "2026-09-20", confirmedBy: "x" }, TODAY)).toMatchObject({ date: "future", ok: false })
    expect(validateAward({ date: TODAY, confirmedBy: " " }, TODAY)).toMatchObject({ confirmedBy: true, ok: false })
    expect(validateAward({ date: TODAY, confirmedBy: "العميل" }, TODAY).ok).toBe(true)
  })

  it("the earliest delivery is the slowest line", () => {
    const e = { lines: [{ productId: "p1", quantity: 10 }, { productId: "p1", quantity: 200 }, { productId: "gone", quantity: 1 }] }
    const days = estimateEarliestDays(e as never, new Map([["p1", SIMPLE]]), [], DEPTS)
    // 200 × 0.2h ÷ 16h/day = 2.5 days at each of the two departments.
    expect(days).toBe(5)
  })
})
