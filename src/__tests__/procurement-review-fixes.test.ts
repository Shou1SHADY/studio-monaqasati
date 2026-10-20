/**
 * The production review of Procurement 1.5 (20 Oct 2026) — each fix with the case that broke.
 */
import { accountantExport, receivedValue } from "@/lib/procurement/accountant-export"
import { receiptProgress } from "@/lib/procurement/next-step"
import { rfqEditRefusal, rfqIdentityOf } from "@/lib/procurement/rfq-editor"
import { holdsRequest, teamProgress, teamSource } from "@/lib/procurement/team-requests"
import { requestReaches } from "@/lib/supplier-free/quote-rules"
import { UPLOAD_MAX_BYTES, shouldShrink } from "@/lib/upload-fit"
import type { FinancelessPo } from "@/lib/procurement/payment-mark"
import type { PoLine, PurchaseOrder } from "@/lib/procurement/types"

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 2800, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })

describe("editing an RFQ never rewrites what it is", () => {
  it("only a draft, or a published RFQ nobody priced, opens in the editor", () => {
    expect(rfqEditRefusal({ status: "Draft" }, 3)).toBeNull()
    expect(rfqEditRefusal({ status: "New" }, 0)).toBeNull()
    expect(rfqEditRefusal({ status: "New" }, 1)).toBe("has_offers")
    expect(rfqEditRefusal({ status: "New", offersCount: 2 }, 0)).toBe("has_offers")
    expect(rfqEditRefusal({ status: "Cancelled" }, 0)).toBe("closed")
    expect(rfqEditRefusal({ status: "Awarded" }, 0)).toBe("closed")
  })
  it("keeps the RFQ's project and its author (the editor is not the author)", () => {
    expect(rfqIdentityOf({ projectId: "p1", contractorId: "owner", createdByUserId: "buyer1", createdByUserName: "سارة" })).toEqual({ projectId: "p1", contractorId: "owner", createdByUserId: "buyer1", createdByUserName: "سارة" })
    expect(rfqIdentityOf({ projectId: null, createdByUserId: "" })).toEqual({ projectId: null, contractorId: null, createdByUserId: null, createdByUserName: null })
  })
})

describe("the accounting export tells what was received, on the Riyadh day", () => {
  it("a remainder closed short is not received", () => {
    expect(receivedValue({ totalExVat: 28000, lines: [line({ accepted: 6, cancelled: 4 })] })).toBe(16800)
  })
  it("a lump-sum order by the share of its quantity accepted", () => {
    expect(receivedValue({ totalExVat: 50000, lines: [line({ unitPrice: null, quantity: 4, accepted: 1 })] })).toBe(12500)
    expect(receivedValue({ totalExVat: 50000, lines: [line({ unitPrice: null, quantity: 4, accepted: 0 })] })).toBe(0)
  })
  it("an order approved at 01:00 Riyadh on the 1st belongs to the 1st", () => {
    const po = { id: "a", docNumber: "PO-2026/001", status: "approved", approvedAt: "2026-10-31T22:00:00Z", supplierName: "س", rfqTitle: "", totalExVat: 100, vatRate: 0.15, lines: [line()] } as unknown as FinancelessPo
    expect(accountantExport([po], [], { from: "2026-11-01", to: "2026-11-30" }, () => "").orders).toHaveLength(1)
    expect(accountantExport([po], [], { from: "2026-10-01", to: "2026-10-31" }, () => "").orders).toHaveLength(0)
  })
})

describe("receipt progress never adds tonnes to bags", () => {
  it("one unit: quantities", () => {
    expect(receiptProgress([line({ accepted: 4 }), line({ id: "l2", accepted: 6 })])).toMatchObject({ byLines: false, received: 10, ordered: 20, unit: "طن" })
  })
  it("several units: materials complete", () => {
    expect(receiptProgress([line({ accepted: 10 }), line({ id: "l2", unit: "كيس", quantity: 200, accepted: 50 })])).toMatchObject({ byLines: true, linesDone: 1, linesTotal: 2, unit: "" })
  })
})

describe("a team request is released by a cancelled RFQ", () => {
  const src = teamSource("t1")
  it("a cancelled RFQ holds nothing; the newest live one is read", () => {
    expect(holdsRequest({ id: "r1", status: "Cancelled", needSources: [src] }, "t1")).toBe(false)
    const rfqs = [
      { id: "r2", status: "New", rfqNumber: "RFQ-2026/009", createdAt: "2026-10-12T08:00:00Z", needSources: [src] },
      { id: "r1", status: "New", rfqNumber: "RFQ-2026/004", createdAt: "2026-10-02T08:00:00Z", needSources: [src] },
      { id: "r3", status: "Cancelled", rfqNumber: "RFQ-2026/011", createdAt: "2026-10-15T08:00:00Z", needSources: [src] },
    ]
    expect(teamProgress("t1", rfqs, [] as PurchaseOrder[]).rfq).toEqual({ id: "r2", number: "RFQ-2026/009" })
  })
})

describe("an RFQ in several cities reaches suppliers in any of them", () => {
  const rfq = { visibility: "public", subCategoryIds: ["rebar"], city: "الرياض", cities: ["الرياض", "جدة"] }
  it("the second group's city counts", () => {
    expect(requestReaches(rfq, "s1", { specs: [], cities: ["جدة"], subIds: ["rebar"] })).toBe(true)
    expect(requestReaches(rfq, "s1", { specs: [], cities: ["الدمام"], subIds: ["rebar"] })).toBe(false)
    // An older RFQ with one city reads as before.
    expect(requestReaches({ ...rfq, cities: undefined }, "s1", { specs: [], cities: ["جدة"], subIds: ["rebar"] })).toBe(false)
  })
})

describe("uploads fit the host's request limit", () => {
  it("the ceiling is under Vercel's 4.5 MB body limit, and a large photo is shrunk first", () => {
    expect(UPLOAD_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024)
    expect(shouldShrink({ size: 6_000_000, type: "image/jpeg" })).toBe(true)
    expect(shouldShrink({ size: 1_000_000, type: "image/jpeg" })).toBe(false)
    expect(shouldShrink({ size: 6_000_000, type: "application/pdf" })).toBe(false)
  })
})
