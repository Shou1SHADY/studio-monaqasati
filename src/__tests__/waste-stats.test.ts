import { aggregateWasteRecords, type WasteRecord } from "@/hooks/useProjectWasteStats"

/** Minimal record with sensible defaults, so each test only states what it's about. */
function rec(over: Partial<WasteRecord> & { id: string }): WasteRecord {
  return {
    itemName: "بلاط",
    unit: "متر مربع",
    quantityTaken: 0,
    quantityUsed: 0,
    wastePercent: 0,
    recordedByUserId: "u1",
    recordedByUserName: "سامي",
    ...over,
  }
}

describe("aggregateWasteRecords", () => {
  it("returns zeroed totals for an empty collection", () => {
    const s = aggregateWasteRecords([])
    expect(s.totalTaken).toBe(0)
    expect(s.totalUsed).toBe(0)
    expect(s.wastePercent).toBe(0)
    expect(s.activeRecords).toEqual([])
  })

  it("computes waste from taken vs. used", () => {
    const s = aggregateWasteRecords([
      rec({ id: "a", quantityTaken: 100, quantityUsed: 90 }),
      rec({ id: "b", quantityTaken: 100, quantityUsed: 80 }),
    ])
    expect(s.totalTaken).toBe(200)
    expect(s.totalUsed).toBe(170)
    expect(s.totalWaste).toBe(30)
    expect(s.wastePercent).toBe(15)
  })

  it("treats records with no explicit type as consumptions", () => {
    // Every row written before reversals existed lacks `type` entirely.
    const s = aggregateWasteRecords([rec({ id: "legacy", quantityTaken: 50, quantityUsed: 40 })])
    expect(s.activeRecords).toHaveLength(1)
    expect(s.wastePercent).toBe(20)
  })

  describe("reversals", () => {
    it("drops both the reversal and the entry it cancels from the totals", () => {
      const s = aggregateWasteRecords([
        rec({ id: "a", type: "consumption", quantityTaken: 100, quantityUsed: 90 }),
        rec({ id: "bad", type: "consumption", quantityTaken: 500, quantityUsed: 0 }),
        rec({ id: "rev", type: "reversal", reversesRecordId: "bad", quantityTaken: -500, quantityUsed: -0 }),
      ])
      // Without netting this would read 600 taken / 90 used / 85% waste.
      expect(s.totalTaken).toBe(100)
      expect(s.totalUsed).toBe(90)
      expect(s.wastePercent).toBe(10)
      expect(s.activeRecords.map((r) => r.id)).toEqual(["a"])
    })

    it("still exposes both halves in `records` so the ledger can show the trail", () => {
      const s = aggregateWasteRecords([
        rec({ id: "bad", type: "consumption", quantityTaken: 10, quantityUsed: 0 }),
        rec({ id: "rev", type: "reversal", reversesRecordId: "bad", quantityTaken: -10, quantityUsed: 0 }),
      ])
      expect(s.records).toHaveLength(2)
      expect(s.reversedIds.has("bad")).toBe(true)
      expect(s.activeRecords).toEqual([])
    })

    it("excludes a reversed entry's value from the money total", () => {
      const s = aggregateWasteRecords([
        rec({ id: "a", type: "consumption", quantityTaken: 10, quantityUsed: 8, wasteValue: 40 }),
        rec({ id: "bad", type: "consumption", quantityTaken: 10, quantityUsed: 0, wasteValue: 200 }),
        rec({ id: "rev", type: "reversal", reversesRecordId: "bad", quantityTaken: -10, quantityUsed: 0, wasteValue: -200 }),
      ])
      expect(s.totalWasteValue).toBe(40)
      expect(s.valuedRecordCount).toBe(1)
    })
  })

  describe("valuation", () => {
    it("sums only records that carry a value and reports how many did", () => {
      const s = aggregateWasteRecords([
        rec({ id: "a", quantityTaken: 10, quantityUsed: 8, wasteValue: 40 }),
        rec({ id: "b", quantityTaken: 10, quantityUsed: 5, wasteValue: null }),
      ])
      // "No price on file" must not be silently counted as zero cost.
      expect(s.totalWasteValue).toBe(40)
      expect(s.valuedRecordCount).toBe(1)
      expect(s.activeRecords).toHaveLength(2)
    })
  })

  describe("reason breakdown", () => {
    it("groups wasted quantity by reason, largest first", () => {
      const s = aggregateWasteRecords([
        rec({ id: "a", quantityTaken: 100, quantityUsed: 95, reasonCode: "cutting" }),
        rec({ id: "b", quantityTaken: 100, quantityUsed: 80, reasonCode: "breakage" }),
        rec({ id: "c", quantityTaken: 100, quantityUsed: 97, reasonCode: "cutting" }),
      ])
      expect(s.byReason).toEqual([
        { code: "breakage", quantity: 20, value: 0 },
        { code: "cutting", quantity: 8, value: 0 },
      ])
    })

    it("buckets an uncategorised row under `unspecified`", () => {
      const s = aggregateWasteRecords([rec({ id: "a", quantityTaken: 10, quantityUsed: 7 })])
      expect(s.byReason).toEqual([{ code: "unspecified", quantity: 3, value: 0 }])
    })

    it("ignores rows that wasted nothing", () => {
      const s = aggregateWasteRecords([
        rec({ id: "a", quantityTaken: 10, quantityUsed: 10, reasonCode: "cutting" }),
      ])
      expect(s.byReason).toEqual([])
    })
  })

  it("never reports negative waste when more was used than taken", () => {
    // Shouldn't happen (the dialog clamps used <= taken), but the percentage is
    // shown to users and must not go negative if bad data ever lands.
    const s = aggregateWasteRecords([rec({ id: "a", quantityTaken: 10, quantityUsed: 12 })])
    expect(s.totalWaste).toBe(0)
    expect(s.wastePercent).toBe(0)
  })

  it("sorts records newest first", () => {
    const at = (ms: number) => ({ toMillis: () => ms })
    const s = aggregateWasteRecords([
      rec({ id: "old", createdAt: at(1000) }),
      rec({ id: "new", createdAt: at(3000) }),
      rec({ id: "mid", createdAt: at(2000) }),
    ])
    expect(s.records.map((r) => r.id)).toEqual(["new", "mid", "old"])
  })
})
