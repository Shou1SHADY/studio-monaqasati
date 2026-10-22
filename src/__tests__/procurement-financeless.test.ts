/**
 * Procurement 1.5, PUR-10 (question 5): a company WITHOUT Finance keeps its books in another
 * system. The order carries an optional payment status, the advance is marked paid and the
 * supplier's date counts from it, the unpaid advance is a row on Today (the three tiles do not change with the package,
 * NAV-03), and the accountant gets an export of the period's approved orders and receipts in fixed columns.
 */
import { ORDER_COLUMNS, RECEIPT_COLUMNS, accountantExport, toCsv } from "@/lib/procurement/accountant-export"
import { awaitsAdvance, datedFromAdvance, paymentMarkRefusal, paymentStateOf, type FinancelessPo } from "@/lib/procurement/payment-mark"
import { todayKpis } from "@/lib/procurement/kpis"
import { todayTasks, type ProcWorld, type TodayActor } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"

const NOW = new Date("2026-10-20T08:00:00Z")
const OWNER: TodayActor = { uid: "owner", name: "O", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }
const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Block 20", unit: "pc", quantity: 2000, unitPrice: 4, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<FinancelessPo> & Record<string, unknown> = {}): FinancelessPo =>
  ({
    id: "po1",
    organizationId: "org",
    docNumber: "PO-2026/007",
    status: "accepted",
    basis: "rfq",
    rfqId: "r1",
    rfqTitle: "Block",
    offerId: "o1",
    supplierOrgId: "sup1",
    supplierName: "Al-Bina",
    isGuestSupplier: false,
    lines: [line()],
    totalExVat: 8000,
    vatRate: 0.15,
    offersCount: 2,
    lowestOfferTotal: 8000,
    shortCompetition: false,
    noOfficialQuote: false,
    preparedById: "buyer",
    preparedByName: "Sara",
    createdAt: "2026-10-01T08:00:00Z",
    approverKind: "manager",
    approvedAt: "2026-10-02T08:00:00Z",
    log: [],
    ...over,
  }) as FinancelessPo
const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, ownerHasTeam: true, ...over })

describe("the payment status is optional and never a ledger", () => {
  it("an order nobody marked reads «لم يُدفع»; the last mark is its state", () => {
    expect(paymentStateOf(po())).toBe("unpaid")
    expect(paymentStateOf(po({ paymentMark: { state: "part", day: "2026-10-10", byName: "O", at: "x" } }))).toBe("part")
  })
  it("a mark is refused for a future day or an amount above the order (VAT included)", () => {
    const order = po()
    expect(paymentMarkRefusal({ state: "paid", day: "2026-10-21" }, order, "2026-10-20")).toBe("day")
    expect(paymentMarkRefusal({ state: "paid", day: "20-10-2026" }, order, "2026-10-20")).toBe("day")
    expect(paymentMarkRefusal({ state: "part", day: "2026-10-20", amount: 9200.01 + 0.01 }, order, "2026-10-20")).toBe("amount")
    expect(paymentMarkRefusal({ state: "part", day: "2026-10-20", amount: 9200 }, order, "2026-10-20")).toBeNull()
    expect(paymentMarkRefusal({ state: "paid", day: "2026-10-19", amount: null }, order, "2026-10-20")).toBeNull()
  })
})

describe("the advance: the supplier's date counts from the day it was paid", () => {
  it("date = advance day + the offer's lead time; nothing without either", () => {
    expect(datedFromAdvance("2026-10-10", 14)).toBe("2026-10-24")
    expect(datedFromAdvance(null, 14)).toBeNull()
    expect(datedFromAdvance("2026-10-10", null)).toBeNull()
    expect(datedFromAdvance("2026-10-10", 0)).toBeNull()
  })
  it("an approved / sent / accepted order with an advance not marked paid waits for it", () => {
    expect(awaitsAdvance(po({ advancePercent: 20 }))).toBe(true)
    expect(awaitsAdvance(po({ status: "approved", advancePercent: 20 }))).toBe(true)
    expect(awaitsAdvance(po({ advancePercent: 20, advancePaidDay: "2026-10-05" }))).toBe(false)
    expect(awaitsAdvance(po({ advancePercent: 0 }))).toBe(false)
    expect(awaitsAdvance(po({ status: "awaiting_approval", advancePercent: 20 }))).toBe(false)
  })
})

describe("the package changes Today's rows, never the three tiles (NAV-03)", () => {
  const orders = [po({ id: "a", advancePercent: 20 }), po({ id: "b", advancePercent: 20, advancePaidDay: "2026-10-05" }), po({ id: "c" })]
  it("the same three tiles with Finance, without it, or unknown", () => {
    for (const financeOn of [undefined, true, false]) expect(todayKpis(world({ orders, financeOn }), OWNER, NOW).tiles.map((t) => t.id)).toEqual(["needs", "committed", "drift"])
  })
  it("without Finance: an advance not marked paid is a row for whoever closes orders — the one that was marked is not", () => {
    const rows = todayTasks(world({ orders, financeOn: false, ownerHasTeam: false }), OWNER, NOW).filter((t) => t.kind === "advance_unpaid")
    expect(rows).toMatchObject([{ id: "advance:a", chip: "po", severity: "amber", titleKey: "task.advance_unpaid.title", titleParams: { percent: 20 } }])
    expect(todayTasks(world({ orders, financeOn: true, ownerHasTeam: false }), OWNER, NOW).some((t) => t.kind === "advance_unpaid")).toBe(false)
  })
})

describe("«صدّر للمحاسبة»: approved orders and receipts of the period, fixed columns", () => {
  const approved = po({
    id: "a",
    approvedAt: "2026-10-02T08:00:00Z",
    supplierVatNumber: "300000000000003",
    lines: [line({ accepted: 500 })],
    paymentMark: { state: "paid", day: "2026-10-15", byName: "O", at: "x" },
    invoiceFiles: [{ name: "inv.pdf", url: "https://x/inv.pdf", from: "buyer", number: "INV-9", at: "2026-10-03" }],
  })
  const outside = po({ id: "b", docNumber: "PO-2026/001", approvedAt: "2026-09-02T08:00:00Z" })
  const waiting = po({ id: "c", docNumber: "PO-2026/009", status: "awaiting_approval", approvedAt: null })
  const cancelled = po({ id: "d", docNumber: "PO-2026/010", status: "cancelled" })
  const receipt = { id: "g1", status: "confirmed", poId: "a", docNumber: "GR-2026/004", confirmedAt: "2026-10-05T09:00:00Z", lines: [{ poLineId: "l1", name: "Block 20", unit: "pc", noticeQuantity: 500, accepted: 500 }] } as ReceiptFact
  const pending = { id: "g2", status: "pending_confirmation", poId: "a", deliveryDate: "2026-10-06", lines: [{ poLineId: "l1", name: "Block 20", unit: "pc", noticeQuantity: 500, accepted: 500 }] } as ReceiptFact
  const out = accountantExport([approved, outside, waiting, cancelled], [receipt, pending], { from: "2026-10-01", to: "2026-10-31" }, (s) => `st:${s}`)

  it("only orders approved inside the period — never awaiting approval or cancelled", () => {
    expect(out.orders.map((r) => r[0])).toEqual(["PO-2026/007"])
  })
  it("the order row has every fixed column, in order", () => {
    expect(out.orders[0]).toHaveLength(ORDER_COLUMNS.length)
    expect(out.orders[0]).toEqual(["PO-2026/007", "2026-10-02", "Al-Bina", "300000000000003", "Block", 8000, 1200, 9200, 2000, "st:paid", "2026-10-15", "https://x/inv.pdf"])
  })
  it("receipts: confirmed ones only, one row per accepted line, valued at the order's price ex. VAT", () => {
    expect(out.receipts).toEqual([["GR-2026/004", "2026-10-05", "PO-2026/007", "Al-Bina", "Block 20", 500, "pc", 4, 2000]])
    expect(out.receipts[0]).toHaveLength(RECEIPT_COLUMNS.length)
  })
  it("the invoices go with it", () => {
    expect(out.invoices).toEqual([{ order: "PO-2026/007", name: "INV-9", url: "https://x/inv.pdf" }])
  })
  it("CSV keeps Arabic readable in Excel and quotes what needs it", () => {
    const csv = toCsv([{ title: "أوامر", head: ["رقم", "المورد"], rows: [["PO-1", 'Al "Bina", Co']] }])
    expect(csv.startsWith("﻿")).toBe(true)
    expect(csv).toContain('PO-1,"Al ""Bina"", Co"')
  })
})

describe("without Finance the purchase order type stays the same", () => {
  it("FinancelessPo is a PurchaseOrder with optional fields", () => {
    const plain: PurchaseOrder = po()
    expect(paymentStateOf(plain as FinancelessPo)).toBe("unpaid")
  })
})
