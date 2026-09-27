/**
 * Procurement › RFQs as the reference prototype shows them: the stage derived
 * from the status and the deadline, the deadline pill, the chip counts, the
 * estimate at the last price paid (only when every line has one), and the
 * rail's counts.
 */

import { materialKey, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { chipCounts, deadlinePill, estimateAtLastPrice, productCount, rfqStage } from "@/lib/procurement/rfq-view"
import { procTabCounts } from "@/lib/procurement/shell"
import type { PurchaseOrder } from "@/lib/procurement/types"

const now = new Date("2026-08-26T10:00:00")

describe("the RFQ's stage", () => {
  it("draft and awarded come from the status; the rest from the deadline and the offers", () => {
    expect(rfqStage({ status: "Draft", deadline: "2026-08-01" }, now)).toBe("draft")
    expect(rfqStage({ status: "Awarded", deadline: "2026-08-01" }, now)).toBe("awarded")
    expect(rfqStage({ status: "New", deadline: "2026-08-26" }, now)).toBe("open")
    expect(rfqStage({ status: "New", deadline: "2026-08-25", offersCount: 3 }, now)).toBe("compare")
    expect(rfqStage({ status: "New", deadline: "2026-08-25", offersCount: 0 }, now)).toBe("closed_empty")
  })

  it("the deadline pill: passed, or two days or less left — none on drafts or awarded", () => {
    expect(deadlinePill({ status: "New", deadline: "2026-08-24", offersCount: 3 }, now)).toEqual({ kind: "passed" })
    expect(deadlinePill({ status: "New", deadline: "2026-08-28" }, now)).toEqual({ kind: "soon", days: 2 })
    expect(deadlinePill({ status: "New", deadline: "2026-08-29" }, now)).toBeNull()
    expect(deadlinePill({ status: "Awarded", deadline: "2026-08-01" }, now)).toBeNull()
  })

  it("the chips count every status; a single-material RFQ is one product", () => {
    expect(chipCounts([{ status: "Draft" }, { status: "New" }, { status: "New" }, { status: "Awarded" }])).toEqual({ all: 4, Draft: 1, New: 2, Awarded: 1 })
    expect(productCount({})).toBe(1)
    expect(productCount({ products: [{}, {}] })).toBe(2)
  })
})

describe("the estimate at the last price paid", () => {
  const h = (name: string, unit: string, price: number, day: string): PriceHistoryEntry =>
    ({ id: `${name}${day}`, organizationId: "o", materialKey: materialKey(name, unit), name, unit, supplierOrgId: "s", supplierName: "S", price, day, kind: "po", poId: null, poNumber: null }) as unknown as PriceHistoryEntry

  it("sums qty × the last price when every line has one — otherwise none", () => {
    const history = [h("cable", "m", 10, "2026-01-01"), h("cable", "m", 12, "2026-06-01"), h("pipe", "pc", 5, "2026-05-01")]
    const both = { products: [{ description: "cable", quantity: 100, unit: "m" }, { description: "pipe", quantity: "20", unit: "pc" }] }
    expect(estimateAtLastPrice(both, history)).toBe(1_300)
    expect(estimateAtLastPrice({ products: [{ description: "unknown", quantity: 1, unit: "m" }] }, history)).toBeNull()
  })
})

describe("the rail's counts", () => {
  it("today · incoming requests · open RFQs · live orders · orders being delivered", () => {
    const order = (status: string, accepted = 0) => ({ id: status, status, lines: [{ id: "l", quantity: 10, accepted, rejected: 0, held: 0, cancelled: 0 }], log: [] }) as unknown as PurchaseOrder
    const c = procTabCounts({
      tasks: 19,
      incomingRequests: 13,
      rfqs: [{ status: "New", deadline: "2026-12-01" }, { status: "New", deadline: "2020-01-01" }, { status: "Draft" }, { status: "New" }],
      orders: [order("sent"), order("accepted"), order("accepted", 4), order("closed"), order("cancelled")],
      now,
    })
    expect(c).toEqual({ today: 19, requests: 13, rfqs: 2, orders: 3, receipts: 2 })
  })
})
