import {
  computeProgress,
  buildClaimLines,
  computeClaimTotals,
  previouslyClaimedByItem,
  nextClaimNumber,
  DEFAULT_IPC_TERMS,
  type MeasurableBoqItem,
  type MeasurementEntry,
} from "@/lib/ipc"

const items: MeasurableBoqItem[] = [
  { id: "a", itemNo: "1.1", descriptionAr: "خرسانة", descriptionEn: "Concrete", unit: "m3", quantity: 400, unitPrice: 100, executedQuantity: 120 },
  { id: "b", itemNo: "1.2", descriptionAr: "حديد", descriptionEn: "Steel", unit: "ton", quantity: 50, unitPrice: 2000, executedQuantity: 0 },
  { id: "c", itemNo: "2.1", descriptionAr: "بلوك", descriptionEn: "Block", unit: "m2", quantity: 100, unitPrice: 50, executedQuantity: 150 },
]

describe("computeProgress", () => {
  it("weights progress by line value and caps overrun at 100% of the line", () => {
    const { percent, contractValue, executedValue } = computeProgress(items)
    expect(contractValue).toBe(400 * 100 + 50 * 2000 + 100 * 50)
    expect(executedValue).toBe(120 * 100 + 0 + 100 * 50)
    expect(percent).toBe(Math.round((executedValue / contractValue) * 10000) / 100)
  })

  it("returns 0% for an empty or unpriced BOQ", () => {
    expect(computeProgress([]).percent).toBe(0)
    expect(computeProgress([{ id: "x", quantity: 10, unitPrice: 0 }]).percent).toBe(0)
  })
})

describe("buildClaimLines", () => {
  const measurements: MeasurementEntry[] = [
    { id: "m1", boqItemId: "a", quantity: 80, measuredAt: "2026-09-01" },
    { id: "m2", boqItemId: "a", quantity: 40, measuredAt: "2026-09-02" },
    { id: "m3", boqItemId: "b", quantity: 10, measuredAt: "2026-09-02" },
    { id: "m4", boqItemId: "b", quantity: -10, measuredAt: "2026-09-03" },
    { id: "m5", boqItemId: "a", quantity: 999, measuredAt: "2026-08-01", claimId: "old" },
  ]

  it("sums unclaimed measurements per item, nets reversals, skips claimed and zero lines", () => {
    const lines = buildClaimLines(measurements, items, new Map(), "ar")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      boqItemId: "a",
      itemNo: "1.1",
      description: "خرسانة",
      contractQty: 400,
      previousQty: 0,
      currentQty: 120,
      cumulativeQty: 120,
      amount: 12000,
    })
  })

  it("carries previous claimed quantities into cumulative", () => {
    const prev = new Map([["a", 200]])
    const [line] = buildClaimLines(measurements, items, prev)
    expect(line.previousQty).toBe(200)
    expect(line.cumulativeQty).toBe(320)
  })

  it("uses the English description for the en locale", () => {
    const [line] = buildClaimLines(measurements, items, new Map(), "en")
    expect(line.description).toBe("Concrete")
  })
})

describe("previouslyClaimedByItem", () => {
  it("accumulates currentQty across claims and ignores line-less legacy claims", () => {
    const map = previouslyClaimedByItem([
      { lines: [{ boqItemId: "a", currentQty: 50 } as never] },
      { lines: [{ boqItemId: "a", currentQty: 30 } as never, { boqItemId: "b", currentQty: 5 } as never] },
      {},
    ])
    expect(map.get("a")).toBe(80)
    expect(map.get("b")).toBe(5)
  })
})

describe("computeClaimTotals", () => {
  it("applies retention and advance recovery before VAT", () => {
    const lines = [{ amount: 100000 } as never]
    const totals = computeClaimTotals(lines, { retentionPercent: 10, advanceRecoveryPercent: 10, vatPercent: 15 })
    expect(totals.gross).toBe(100000)
    expect(totals.retention).toBe(10000)
    expect(totals.advanceRecovery).toBe(10000)
    expect(totals.vat).toBe(12000)
    expect(totals.net).toBe(92000)
  })

  it("matches the Saudi defaults", () => {
    const totals = computeClaimTotals([{ amount: 1000 } as never], DEFAULT_IPC_TERMS)
    expect(totals.retention).toBe(100)
    expect(totals.advanceRecovery).toBe(0)
    expect(totals.vat).toBe(135)
    expect(totals.net).toBe(1035)
  })
})

describe("nextClaimNumber", () => {
  it("increments past the highest existing number, legacy claims counting as 0", () => {
    expect(nextClaimNumber([])).toBe(1)
    expect(nextClaimNumber([{ claimNumber: 3 }, {}, { claimNumber: 1 }])).toBe(4)
  })
})
