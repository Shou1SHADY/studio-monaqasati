/**
 * The advance, end to end (Sales PRD D2, D8, PAY-04, PAY-07, SO-06, SO-11, SO-16;
 * scenarios S3–S5): nothing made to order is executed before Finance confirms
 * the advance; reporting it sends the production request so the plant can PLAN;
 * the two ways Finance can confirm it end the same way; a promise is reset with
 * a reason, into the order's trail.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/accounting/hooks", () => ({
  onQuotationPaymentRecorded: jest.fn(),
  onSalesCreditNoteIssued: jest.fn(),
  onSalesDelivered: jest.fn(),
  onSalesInvoiceIssued: jest.fn(),
  onSalesInvoicePaid: jest.fn(),
}))

import type { Firestore } from "firebase/firestore"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { onQuotationPaymentRecorded } from "@/lib/accounting/hooks"
import type { CrmQuotation } from "@/lib/crm"
import { answerWindow, awaitsDownPayment, requestState } from "@/lib/manufacturing-requests"
import { installmentStates } from "@/lib/sales-installments"
import type { ManufacturingRequest, SalesOrder } from "@/lib/sales-orders"
import { neededByFor, productionNeeds, requestProductionForAdvance, resetOrderPromise } from "@/lib/sales-order-writes"
import { confirmAdvanceForOrder, installmentNoticeState, reportTransfer, type TransferNotice } from "@/lib/sales-transfers"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-17T08:00:00.000Z")
const TODAY = "2026-09-17"
const ORG = "org1"
const REEM = { id: "reem", name: "Reem" }
const NOURA = { id: "noura", name: "Noura" }
const COPY = { title: "t", message: "m" }

const CANOPY = "Steel canopy"
const DOOR = "HDF door"

function seedQuote(): CrmQuotation {
  seed("crmQuotations/q1", {
    organizationId: ORG,
    contactId: "c1",
    contactName: "Al-Diyar",
    quotationNumber: "QT-2026/068-2",
    amount: 65780,
    status: "accepted",
    installments: [
      { id: "inst_adv", label: "Advance", percent: 30, beforeProduction: true },
      { id: "inst_rest", label: "On delivery", percent: 70, beforeProduction: false },
    ],
    payments: null,
    salesOrderId: "so53",
  })
  return readDoc<CrmQuotation>("crmQuotations/q1")!
}

function seedOrder(over: Partial<SalesOrder> = {}): SalesOrder {
  seed("salesOrders/so53", {
    organizationId: ORG,
    orderNumber: 53,
    type: "standard",
    status: "awaiting_deposit",
    contactId: "c1",
    contactName: "Al-Diyar",
    quotationId: "q1",
    quotationNumber: "QT-2026/068-2",
    payment: { kind: "deposit", depositPercent: 30, depositPaid: false, advanceInstallmentId: "inst_adv" },
    promiseDate: "2026-11-01",
    vatPercent: 15,
    lines: [
      { name: CANOPY, unit: "pc", quantity: 4, unitPrice: 16000, unitCost: 11000 },
      { name: DOOR, unit: "pc", quantity: 10, unitPrice: 178, unitCost: 120 },
    ],
    createdByUserId: REEM.id,
    createdByUserName: REEM.name,
    ...over,
  })
  return readDoc<SalesOrder>("salesOrders/so53")!
}

const order = () => readDoc<SalesOrder>("salesOrders/so53")!
const quote = () => readDoc<CrmQuotation>("crmQuotations/q1")!
const notices = () => listCollection<TransferNotice>("salesTransferNotices")
const requests = () => listCollection<ManufacturingRequest>("manufacturingRequests")
const advanceAmount = () => installmentStates(quote()).find((s) => s.id === "inst_adv")!.amount

const report = (amountStated: number) =>
  reportTransfer(db, { quotation: quote(), order: order(), installment: { id: "inst_adv", label: "Advance" }, amountStated, transferDate: TODAY, bankRef: "SNB-7781", note: null, actor: REEM, recipients: [], notification: COPY })

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "queueMicrotask", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
})
afterAll(() => jest.useRealTimers())
beforeEach(() => {
  resetFakeDb()
  jest.clearAllMocks()
  jest.setSystemTime(NOW)
})

describe("SO-16 · what an order needs made", () => {
  const cards = [{ id: "p1", name: CANOPY, unit: "pc" }, { id: "p2", name: "Old product", unit: "pc", archived: true }]

  it("only what the workshop makes, beyond what the stores hold, that is not already with the plant", () => {
    const o = seedOrder()
    expect(productionNeeds(o, cards, new Map(), [])).toEqual([{ itemName: CANOPY, unit: "pc", quantity: 4, productId: "p1" }])
    // One canopy on the shelf: three are missing.
    expect(productionNeeds(o, cards, new Map([["steel CANOPY", 1]]), [])).toEqual([{ itemName: CANOPY, unit: "pc", quantity: 3, productId: "p1" }])
    expect(productionNeeds(o, cards, [{ name: CANOPY, available: 4 }], [])).toEqual([])
    // A stocked door with no shelf is NOT asked of the plant — nor of Procurement: adjust the order or the promise.
    expect(productionNeeds(o, cards, new Map(), []).some((n) => n.itemName === DOOR)).toBe(false)
  })

  it("never asks twice — but a declined request frees the line to be asked again", () => {
    const o = seedOrder()
    const asked = (status: ManufacturingRequest["status"]) => [{ orderId: "so53", itemName: CANOPY, status }]
    expect(productionNeeds(o, cards, new Map(), asked("new"))).toEqual([])
    expect(productionNeeds(o, cards, new Map(), asked("accepted"))).toEqual([])
    expect(productionNeeds(o, cards, new Map(), asked("rejected"))).toHaveLength(1)
    expect(productionNeeds(o, cards, new Map(), [{ orderId: "other", itemName: CANOPY, status: "new" }])).toHaveLength(1)
  })

  it("the plant needs it two days before the client was promised it", () => {
    expect(neededByFor("2026-11-01")).toBe("2026-10-30")
    expect(neededByFor("2026-11-01T08:00:00Z")).toBe("2026-10-30")
    expect(neededByFor(null)).toBeNull()
    expect(neededByFor("not a date")).toBeNull()
  })
})

describe("S4 · PAY-07 · reporting the advance sends the production request", () => {
  it("the request reaches the plant while the order still waits — and its answer clock does not run", async () => {
    seedQuote()
    const o = seedOrder()
    await report(advanceAmount())
    const needs = productionNeeds(o, [{ id: "p1", name: CANOPY, unit: "pc" }], new Map(), [])
    const ids = await requestProductionForAdvance(db, { order: o, needs, actor: REEM })
    expect(ids).toHaveLength(1)

    const mr = requests()[0]
    expect(mr).toMatchObject({ status: "new", kind: "make", sourceKind: "sales", orderId: "so53", orderNumber: 53, itemName: CANOPY, quantity: 4, neededBy: "2026-10-30", createdByUserName: "Reem" })
    expect(mr.requestNumber).toMatch(/^MR-2026\/\d{3}$/)

    // Nothing else moved: the order still waits, the instalment is with Finance.
    expect(order()).toMatchObject({ status: "awaiting_deposit", payment: { depositPaid: false } })
    expect(installmentNoticeState(installmentStates(quote()).find((s) => s.id === "inst_adv")!, notices())).toBe("awaiting_finance")

    // Three days on and unanswered — but Finance has not confirmed, so it is not "overdue".
    const later = NOW.getTime() + 72 * 3600000
    expect(awaitsDownPayment(mr, order())).toBe(true)
    expect(answerWindow(mr, 24, later, awaitsDownPayment(mr, order())).overdue).toBe(false)
    expect(requestState(mr, 24, later, true)).toBe("awaiting")
    // Once the advance is confirmed the clock counts as it always did.
    expect(requestState(mr, 24, later, false)).toBe("overdue")
    expect(awaitsDownPayment(mr, { payment: { kind: "deposit", depositPaid: true } })).toBe(false)
    // A project's request, or a costing request, never waits on a client's advance.
    expect(awaitsDownPayment({ sourceKind: "project", orderId: null, kind: "make" }, order())).toBe(false)
    expect(awaitsDownPayment({ sourceKind: "sales", orderId: "so53", kind: "cost" }, order())).toBe(false)
  })
})

describe("the two ways Finance confirms an advance end the same way", () => {
  it("with the seller's notice open: it is answered, the instalment settles, the order is released", async () => {
    seedQuote()
    seedOrder()
    await report(advanceAmount())

    const result = await confirmAdvanceForOrder(db, { order: order(), actor: NOURA, notification: COPY })
    expect(result).toEqual({ released: true, via: "notice" })
    expect(notices()[0]).toMatchObject({ status: "confirmed", answeredByUserName: "Noura" })
    expect(order()).toMatchObject({ status: "running", payment: { depositPaid: true, depositPaidAt: NOW.toISOString() } })

    const advance = installmentStates(quote()).find((s) => s.id === "inst_adv")!
    expect(advance.settled).toBe(true)
    expect(installmentNoticeState(advance, notices())).toBe("confirmed")
    expect(onQuotationPaymentRecorded).toHaveBeenCalledTimes(1)
  })

  it("with no notice filed: the advance is still recorded on the quotation — it never stays 'awaiting Finance' after Finance confirmed it", async () => {
    seedQuote()
    seedOrder()
    const result = await confirmAdvanceForOrder(db, { order: order(), actor: NOURA, notification: COPY })
    expect(result).toEqual({ released: true, via: "direct" })
    expect(order().status).toBe("running")
    const advance = installmentStates(quote()).find((s) => s.id === "inst_adv")!
    expect(advance).toMatchObject({ settled: true, paid: advanceAmount() })
    expect(onQuotationPaymentRecorded).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ installmentId: "inst_adv", amount: advanceAmount(), isAdvance: true }))
  })

  it("a seller who under-stated the transfer does not leave the confirmed advance half-settled", async () => {
    seedQuote()
    seedOrder()
    await report(1000)
    await confirmAdvanceForOrder(db, { order: order(), actor: NOURA, notification: COPY })
    expect(order().status).toBe("running")
    expect(installmentStates(quote()).find((s) => s.id === "inst_adv")!.settled).toBe(true)
  })

  it("refuses an order that is not waiting on an advance, and releases a quotation-less one as before", async () => {
    seedQuote()
    seedOrder({ status: "running" })
    await expect(confirmAdvanceForOrder(db, { order: order(), actor: NOURA, notification: COPY })).rejects.toThrow("not_awaiting_advance")

    resetFakeDb()
    seedOrder({ quotationId: null, quotationNumber: null })
    await expect(confirmAdvanceForOrder(db, { order: order(), actor: NOURA, notification: COPY })).resolves.toEqual({ released: true, via: "direct" })
    expect(order().status).toBe("running")
    expect(onQuotationPaymentRecorded).not.toHaveBeenCalled()
  })
})

describe("SO-11 · reset the promise", () => {
  it("a date that is not in the past, a written reason, and an entry in the order's trail under the user's name", async () => {
    seedOrder({ status: "running" })
    const reset = (promiseDate: string, reason: string) => resetOrderPromise(db, { orderId: "so53", promiseDate, reason, today: TODAY, actor: REEM })
    await expect(reset("2026-11-20", "  ")).rejects.toThrow("reason_required")
    await expect(reset("2026-09-01", "Late slab")).rejects.toThrow("promise_in_past")
    await expect(reset("20 Nov", "Late slab")).rejects.toThrow("promise_in_past")
    expect(order().promiseDate).toBe("2026-11-01")

    await reset("2026-11-20", "Work order WO-2026/036 is running late")
    expect(order().promiseDate).toBe("2026-11-20")
    expect(order().log).toEqual([{ at: NOW.toISOString(), by: "Reem", kind: "promise_reset", detail: "2026-11-01 → 2026-11-20 · Work order WO-2026/036 is running late" }])
  })

  it("an order with no promise yet gets one; a closed order's promise is history", async () => {
    seedOrder({ status: "running", promiseDate: null })
    await resetOrderPromise(db, { orderId: "so53", promiseDate: "2026-10-10", reason: "Agreed with the client", today: TODAY, actor: REEM })
    expect(order().log?.[0]).toMatchObject({ kind: "promise_set", detail: "— → 2026-10-10 · Agreed with the client" })

    seed("salesOrders/so53", { ...(readDoc<Record<string, unknown>>("salesOrders/so53") as Record<string, unknown>), id: "so53", status: "closed" })
    await expect(resetOrderPromise(db, { orderId: "so53", promiseDate: "2026-12-01", reason: "x", today: TODAY, actor: REEM })).rejects.toThrow("order_closed")
  })
})
