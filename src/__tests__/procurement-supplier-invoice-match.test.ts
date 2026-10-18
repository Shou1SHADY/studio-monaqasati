/**
 * Supplier 1.0 boundary — Finance's three-way match of a supplier's invoice with the order's price and the receipts it
 * names, and the schedule of its shares under the order's frozen terms, covered by the transfers Finance reported.
 */

import { matchInvoice, scheduleInvoices, termsOfOrder, type SupplierInvoiceDoc } from "@/lib/procurement/supplier-invoice-match"
import type { PoLine, PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar 12 mm", unit: "t", quantity: 100, unitPrice: 2800, accepted: 60, rejected: 0, held: 0, cancelled: 0, ...over })

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({
    id: "po1",
    organizationId: "org",
    docNumber: "PO-2026/014",
    status: "accepted",
    supplierOrgId: "sup1",
    supplierName: "Al-Hadid",
    lines: [line()],
    totalExVat: 280000,
    vatRate: 0.15,
    termsList: [{ pct: 100, days: 30 }],
    log: [],
    ...over,
  }) as PurchaseOrder

const receipt = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({
  id: "d1",
  docNumber: "GR-2026/031",
  status: "confirmed",
  poId: "po1",
  confirmedAt: "2026-10-01T10:00:00Z",
  lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 60, counted: 60, accepted: 60, rejected: 0, held: 0 }],
  ...over,
})

const inv = (over: Record<string, unknown> = {}): SupplierInvoiceDoc => ({ id: "i1", poId: "po1", number: "INV-77", date: "2026-10-02", amountNet: 168000, vat: 0.15, grns: ["GR-2026/031"], ...over })

describe("matchInvoice — the invoice against the order's price and our receipts", () => {
  it("matches when the invoice equals accepted quantity × the order's price", () => {
    const m = matchInvoice(inv(), po(), [receipt()])
    expect(m.expectedNet).toBe(168000)
    expect(m.state).toBe("match")
    expect(m.diff).toBe(0)
    expect(m.gross).toBe(193200)
  })

  it("an invoice below its receipts is shown as such, with the shortfall", () => {
    const m = matchInvoice(inv({ amountNet: 160000 }), po(), [receipt()])
    expect(m.state).toBe("under")
    expect(m.diff).toBe(-8000)
  })

  it("asks for a check when it names a receipt that is not ours, not confirmed or on another order", () => {
    expect(matchInvoice(inv({ grns: ["GR-2026/999"] }), po(), [receipt()]).state).toBe("check")
    expect(matchInvoice(inv(), po(), [receipt({ status: "pending_confirmation" })]).state).toBe("check")
    expect(matchInvoice(inv(), po(), [receipt({ poId: "po2" })]).state).toBe("check")
  })

  it("prices only what was accepted — rejected and held quantities are not billable", () => {
    const r = receipt({ lines: [{ poLineId: "l1", name: "Rebar", unit: "t", noticeQuantity: 60, counted: 60, accepted: 50, rejected: 6, held: 4 }] })
    expect(matchInvoice(inv({ amountNet: 140000 }), po(), [r]).state).toBe("match")
  })

  it("reads a released discount as a receipt of its own at the discounted price", () => {
    const order = po({
      lines: [line({ rejected: 5, rejectDecision: "discount", rejectDiscountState: "released", rejectDiscountPrice: 2000 } as Partial<PoLine>)],
      log: [{ at: "2026-10-03T08:00:00Z", byId: "u", byName: "U", action: "reject_discount_released", note: null, params: { lineId: "l1" } }] as PurchaseOrder["log"],
    })
    const m = matchInvoice(inv({ grns: ["GR-2026/031", "DISC-l1"], amountNet: 178000 }), order, [receipt()])
    expect(m.expectedNet).toBe(178000)
    expect(m.state).toBe("match")
  })

  it("a lump-sum order matches its total only once every line is complete", () => {
    const lump = po({ lines: [line({ unitPrice: null as unknown as number })] })
    expect(matchInvoice(inv({ amountNet: 280000 }), lump, [receipt()]).state).toBe("check")
    const done = po({ lines: [line({ unitPrice: null as unknown as number, accepted: 100 })] })
    expect(matchInvoice(inv({ amountNet: 280000 }), done, [receipt()]).state).toBe("match")
  })
})

describe("scheduleInvoices — shares due under the order's terms, covered oldest first", () => {
  it("falls back to 100% at 30 days when the order carries no terms", () => {
    expect(termsOfOrder(po({ termsList: null }))).toEqual([{ pct: 100, days: 30 }])
  })

  it("spreads each invoice over the frozen terms from its own date", () => {
    const s = scheduleInvoices([inv()], po({ termsList: [{ pct: 30, days: 0 }, { pct: 70, days: 60 }] }), 0).get("i1")!
    expect(s.instalments.map((i) => [i.amount, i.due])).toEqual([
      [57960, "2026-10-02"],
      [135240, "2026-12-01"],
    ])
    expect(s.next?.due).toBe("2026-10-02")
    expect(s.left).toBe(193200)
  })

  it("reported transfers cover the oldest invoice first, then part of the next", () => {
    const older = inv({ id: "a", date: "2026-09-01", amountNet: 100000 })
    const newer = inv({ id: "b", date: "2026-10-01", amountNet: 100000 })
    const map = scheduleInvoices([newer, older], po(), 115000 + 20000)
    expect(map.get("a")!.next).toBeNull()
    expect(map.get("a")!.left).toBe(0)
    expect(map.get("b")!.next?.open).toBe(95000)
    expect(map.get("b")!.left).toBe(95000)
  })
})
