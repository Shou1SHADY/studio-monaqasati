/**
 * Procurement PRD 3.0 — the goods receipt's write: one transaction that
 * validates against the order, draws the GR number, moves the order's line
 * counters and flips the delivery; then the consequences (stock, books,
 * Manufacturing, events, the supplier) each on their own — a failure in one
 * never stops the next. Plus the desk's pure helpers: segments, counts, CSV.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/warehouse-transfer", () => ({ receiveDelivery: jest.fn(async () => undefined) }))
jest.mock("@/lib/accounting/hooks", () => ({ onGoodsReceived: jest.fn(() => undefined) }))
jest.mock("@/lib/manufacturing-writes", () => ({ markPurchaseArrived: jest.fn(async () => undefined) }))
jest.mock("@/lib/mfg-events", () => ({ ...jest.requireActual("@/lib/mfg-events"), emitMfgEvent: jest.fn(async () => 1) }))

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { receiveDelivery } from "@/lib/warehouse-transfer"
import { onGoodsReceived } from "@/lib/accounting/hooks"
import { markPurchaseArrived } from "@/lib/manufacturing-writes"
import { emitMfgEvent } from "@/lib/mfg-events"
import { DEFAULT_POLICIES, type DeliveryLine, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import { poStatus } from "@/lib/procurement/po"
import { ProcWriteError } from "@/lib/procurement/writes"
import {
  ReceiptValidationError,
  countedLines,
  createArrivalWithoutNotice,
  createManualReceipt,
  legacyLinesOf,
  linesForReceipt,
  markReceiptAsExpense,
  recordReceipt,
  stockItemsOf,
  validateReceiptLines,
} from "@/lib/procurement/receipt-writes"
import { incomingRows, receiptCsv, receiptCsvRows, receiptRows, receiptSegment, segmentCounts, type CsvWords, type DeskDelivery } from "@/lib/procurement/receipt-desk"
import { buildReceiptPrintHtml } from "@/lib/procurement/receipt-print"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-22T09:00:00Z")
const ORG = "owner-uid"

const gate: ProcActor = { uid: "gate", name: "Salma", isOwner: false, canApprove: false, canPrepare: false, canExpedite: false, canReceive: true, seesPrices: false }
const buyer: ProcActor = { ...gate, uid: "buyer", name: "Badr", canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }
const nobody: ProcActor = { ...gate, uid: "x", name: "X", canReceive: false }

const copy = Object.assign((key: string) => key, { has: () => false })

function order(over: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: "po1",
    organizationId: ORG,
    docNumber: "PO-2026/001",
    status: "accepted",
    basis: "rfq",
    rfqId: "rfq1",
    rfqTitle: "حديد تسليح",
    offerId: "of1",
    projectId: "p1",
    projectName: "برج",
    purchaseSource: { kind: "mfg_purchase", workOrderId: "wo1", purchaseRequestId: "pr1" },
    supplierOrgId: "sup-org",
    supplierUserId: "sup-user",
    supplierName: "شركة الحديد",
    isGuestSupplier: false,
    lines: [
      { id: "l1", name: "حديد 12مم", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0 },
      { id: "l2", name: "حديد 16مم", unit: "طن", quantity: 5, unitPrice: 3200, accepted: 0, rejected: 0, held: 0, cancelled: 0 },
    ],
    totalExVat: 46000,
    vatRate: 0.15,
    offersCount: 2,
    lowestOfferTotal: 46000,
    shortCompetition: false,
    noOfficialQuote: false,
    preparedById: "buyer",
    preparedByName: "Badr",
    createdAt: "2026-09-01T00:00:00Z",
    approverKind: "manager",
    supplierAcceptedAt: "2026-09-02T00:00:00Z",
    promisedDate: "2026-09-20",
    log: [],
    ...over,
  }
}

function seedWorld(po: PurchaseOrder = order()) {
  seed(`users/${ORG}`, { organizationId: ORG, name: "Owner" })
  seed("users/buyer", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy" })
  seed("users/fin", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-fin" })
  seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept"] })
  seed("teamGroups/g-fin", { organizationId: ORG, permissions: ["invoices.manage"] })
  seed("projects/p1", { organizationId: ORG, name: "برج", warehouseId: "wh-p1" })
  seed("warehouses/wh-p1", { organizationId: ORG, name: "مستودع البرج" })
  const { id, ...rest } = po
  seed(`purchaseOrders/${id}`, rest)
  seed("deliveries/d1", {
    contractorOrgId: ORG,
    status: "pending_confirmation",
    poId: "po1",
    poNumber: "PO-2026/001",
    offerId: "of1",
    rfqId: "rfq1",
    rfqTitle: "حديد تسليح",
    supplierId: "sup-user",
    supplierOrgId: "sup-org",
    supplierName: "شركة الحديد",
    projectId: "p1",
    deliveryPersonName: "أبو خالد",
    deliveryDate: "2026-09-21",
    lines: [
      { poLineId: "l1", name: "حديد 12مم", unit: "طن", noticeQuantity: 6 },
      { poLineId: "l2", name: "حديد 16مم", unit: "طن", noticeQuantity: 5 },
    ],
  })
}

const delivery = (id = "d1") => ({ id, ...(readDoc<Record<string, unknown>>(`deliveries/${id}`) as Record<string, unknown>) }) as DeskDelivery & { contractorOrgId: string }
const po = (id = "po1") => readDoc<PurchaseOrder>(`purchaseOrders/${id}`) as PurchaseOrder
const mocked = <T extends (...a: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock

beforeEach(() => {
  resetFakeDb()
  jest.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Pure pieces
// ─────────────────────────────────────────────────────────────────────────────

describe("lines for the gate", () => {
  it("a legacy delivery's items become lines counted in full; a PO-backed notice keeps its lines; an order alone gives open lines with no notice figure", () => {
    const legacy = legacyLinesOf({ items: [{ name: "أسمنت", quantity: "50", unitOfMeasure: "كيس" }, { name: "", quantity: 3 }] })
    expect(legacy).toEqual([{ poLineId: "i1", name: "أسمنت", unit: "كيس", noticeQuantity: 50, counted: 50 }])
    expect(linesForReceipt({ lines: [{ poLineId: "l1", name: "x", unit: "u", noticeQuantity: 4, counted: 99 }] }, null)).toEqual([{ poLineId: "l1", name: "x", unit: "u", noticeQuantity: 4 }])
    const fromPo = linesForReceipt({}, order({ lines: [{ id: "l1", name: "a", unit: "u", quantity: 10, unitPrice: 1, accepted: 10, rejected: 0, held: 0, cancelled: 0 }, { id: "l2", name: "b", unit: "u", quantity: 5, unitPrice: 1, accepted: 0, rejected: 0, held: 0, cancelled: 0 }] }))
    expect(fromPo).toEqual([{ poLineId: "l2", name: "b", unit: "u", noticeQuantity: 0 }])
  })

  it("countedLines skips blank lines, computes accepted and drops reasons that have no quantity", () => {
    const out = countedLines([
      { poLineId: "l1", name: "a", unit: "u", noticeQuantity: 6, counted: 6, rejected: 1, rejectReason: "damaged", held: 2, holdReason: "test" },
      { poLineId: "l2", name: "b", unit: "u", noticeQuantity: 5, rejectReason: "damaged" },
      { poLineId: "l3", name: "c", unit: "u", noticeQuantity: 5, counted: 5, rejected: 0, rejectReason: "damaged" },
    ])
    expect(out.map((l) => l.poLineId)).toEqual(["l1", "l3"])
    expect(out[0]).toMatchObject({ accepted: 3, rejected: 1, held: 2, rejectReason: "damaged", holdReason: "test" })
    expect(out[1]).toMatchObject({ accepted: 5, rejectReason: null })
  })

  it("validateReceiptLines: over-receipt beyond the tolerance is refused, on the order's numbers", () => {
    const errs = validateReceiptLines(order(), [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 6, counted: 11 }], DEFAULT_POLICIES)
    expect(errs).toEqual([{ code: "over_receipt", poLineId: "l1", params: { counted: 11, limit: 10.5, outstanding: 10, tolerance: 5 } }])
    expect(validateReceiptLines(order(), [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 6, counted: 10.5 }], DEFAULT_POLICIES)).toEqual([])
    expect(validateReceiptLines(null, [{ poLineId: "i1", name: "a", unit: "u", noticeQuantity: 6 }], DEFAULT_POLICIES)).toEqual([{ code: "nothing_counted", params: {} }])
  })

  it("stockItemsOf: accepted quantity at the order's unit price; a one-line legacy lot gets its price per unit; never a total split across lines", () => {
    const lines: DeliveryLine[] = [
      { poLineId: "l1", name: "a", unit: "طن", noticeQuantity: 6, counted: 6, rejected: 1, held: 2 },
      { poLineId: "l2", name: "b", unit: "طن", noticeQuantity: 5, counted: 0 },
    ]
    expect(stockItemsOf(lines, order())).toEqual([{ name: "a", unit: "طن", quantity: 3, unitCost: 3000 }])
    expect(stockItemsOf([{ poLineId: "i1", name: "x", unit: "u", noticeQuantity: 4, counted: 4 }], null, 1000)).toEqual([{ name: "x", unit: "u", quantity: 4, unitCost: 250 }])
    expect(stockItemsOf([{ poLineId: "i1", name: "x", unit: "u", noticeQuantity: 4, counted: 4 }, { poLineId: "i2", name: "y", unit: "u", noticeQuantity: 1, counted: 1 }], null, 1000).map((i) => i.unitCost)).toEqual([null, null])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// recordReceipt — PO-backed
// ─────────────────────────────────────────────────────────────────────────────

describe("recordReceipt on an order", () => {
  const lines: DeliveryLine[] = [
    { poLineId: "l1", name: "حديد 12مم", unit: "طن", noticeQuantity: 6, counted: 6, rejected: 1, rejectReason: "damaged", held: 2, holdReason: "test" },
    { poLineId: "l2", name: "حديد 16مم", unit: "طن", noticeQuantity: 5, counted: 4 },
  ]

  it("one transaction: draws GR-…, moves the order's counters, flips the delivery with accepted computed and the receiver's facts", async () => {
    seedWorld()
    const r = await recordReceipt(db, gate, { delivery: delivery(), po: po(), lines, receiverName: "سلمى", checklist: ["delivery_note", "photos"], vehiclePlate: "ABC 123", paperNoteNumber: "DN-77", note: "كرتونتان مبلولتان", policies: DEFAULT_POLICIES }, { now: NOW, copy })
    expect(r.docNumber).toBe("GR-2026/001")
    expect(r).toMatchObject({ deliveryId: "d1", stockLanded: true, posted: true, mfgClosed: true, landedWarehouseId: "wh-p1" })
    const d = delivery()
    expect(d).toMatchObject({ status: "confirmed", docNumber: "GR-2026/001", receivedByName: "سلمى", receiverUserId: "gate", confirmedByUserId: "gate", checklist: ["delivery_note", "photos"], vehiclePlate: "ABC 123", paperNoteNumber: "DN-77", receiptNote: "كرتونتان مبلولتان", landedWarehouseId: "wh-p1", selfReceived: false, postedNet: 3 * 3000 + 4 * 3200 })
    expect(d.lines).toEqual([
      expect.objectContaining({ poLineId: "l1", counted: 6, rejected: 1, held: 2, accepted: 3, rejectReason: "damaged", holdReason: "test" }),
      expect.objectContaining({ poLineId: "l2", counted: 4, accepted: 4, rejected: 0, held: 0 }),
    ])
    expect(po().lines[0]).toMatchObject({ accepted: 3, rejected: 1, held: 2 })
    expect(po().lines[1]).toMatchObject({ accepted: 4 })
    expect(po().log[po().log.length - 1]).toMatchObject({ action: "received", byId: "gate", params: { number: "GR-2026/001", deliveryId: "d1", accepted: 7 } })
    // Complete? No — the status stays derived, nothing auto-closes.
    expect(po().status).toBe("accepted")
    expect(poStatus(po())).toBe("part_received")
    expect(readDoc<{ last: number }>(`mfgCounters/${ORG}__GR__2026`)?.last).toBe(1)
  })

  it("the consequences, in order and with the right arguments: stock at the order's price, the books per delivery, Manufacturing's request, the preparer and Finance, the supplier", async () => {
    seedWorld()
    seed("workOrders/wo1", { organizationId: ORG, docNumber: "WO-2026/003", purchaseRequests: [{ id: "pr1", byId: "mgr", quantity: 10, unit: "طن", itemName: "حديد", state: "ordered" }] })
    await recordReceipt(db, gate, { delivery: delivery(), po: po(), lines, receiverName: "سلمى", policies: DEFAULT_POLICIES, projectName: "برج" }, { now: NOW, copy })
    expect(mocked(receiveDelivery)).toHaveBeenCalledWith({
      firestore: db,
      warehouseId: "wh-p1",
      organizationId: ORG,
      items: [
        { name: "حديد 12مم", unit: "طن", quantity: 3, unitCost: 3000 },
        { name: "حديد 16مم", unit: "طن", quantity: 4, unitCost: 3200 },
      ],
    })
    expect(mocked(onGoodsReceived)).toHaveBeenCalledWith(db, { organizationId: ORG, userId: "gate", userName: "Salma" }, { deliveryId: "d1", net: 21800, supplierId: "sup-org", supplierName: "شركة الحديد", rfqTitle: "حديد تسليح", projectId: "p1", projectName: "برج" })
    expect(mocked(markPurchaseArrived)).toHaveBeenCalledWith(db, { orderId: "wo1", purchaseRequestId: "pr1", actor: { id: "gate", name: "Salma" } })
    expect(mocked(emitMfgEvent)).toHaveBeenCalledWith(db, expect.objectContaining({ kind: "purchase_arrived", organizationId: ORG, workOrderId: "wo1", to: [{ permission: "manufacturing.manage" }, { users: ["mgr"] }], params: expect.objectContaining({ ref: "WO-2026/003", qty: "10", unit: "طن", item: "حديد" }) }))
    const buyerInbox = listCollection<{ type: string; i18n: { params: Record<string, unknown> } }>("users/buyer/notifications")
    expect(buyerInbox.map((n) => n.type)).toContain("po_receipt_recorded")
    expect(buyerInbox.find((n) => n.type === "po_receipt_recorded")?.i18n.params).toMatchObject({ number: "PO-2026/001", receipt: "GR-2026/001", accepted: 7, ordered: 15 })
    expect(listCollection<{ type: string }>("users/fin/notifications").map((n) => n.type)).toContain("po_receipt_recorded")
    const sup = listCollection<{ type: string; title: string; message: string; i18n: { title: string; params: { rfq: string } }; offerId: string; rfqId: string; organizationId: string; read: boolean }>("users/sup-user/notifications")
    expect(sup).toHaveLength(1)
    expect(sup[0]).toMatchObject({ type: "delivery_confirmed", organizationId: "sup-org", offerId: "of1", rfqId: "rfq1", read: false, i18n: { title: "pn_delivery_confirmed_title", params: { rfq: "حديد تسليح" } }, title: "✅ تم تأكيد الاستلام" })
  })

  it("a failure in one consequence does not stop the others, and the result says what did not happen", async () => {
    seedWorld()
    seed("workOrders/wo1", { organizationId: ORG, purchaseRequests: [{ id: "pr1", byId: "mgr", quantity: 1, unit: "u", itemName: "x", state: "ordered" }] })
    mocked(receiveDelivery).mockRejectedValueOnce(new Error("permission-denied"))
    const r = await recordReceipt(db, gate, { delivery: delivery(), po: po(), lines, receiverName: "سلمى", policies: DEFAULT_POLICIES }, { now: NOW, copy })
    expect(r).toMatchObject({ stockLanded: false, posted: false, mfgClosed: false, landedWarehouseId: null })
    // The receipt itself stands; the document no longer claims where it went.
    expect(delivery()).toMatchObject({ status: "confirmed", landedWarehouseId: null, postedNet: null })
    expect(mocked(onGoodsReceived)).not.toHaveBeenCalled()
    expect(mocked(markPurchaseArrived)).not.toHaveBeenCalled()
    // The preparer, Finance and the supplier still hear of the receipt.
    expect(listCollection<{ type: string }>("users/buyer/notifications").map((n) => n.type)).toContain("po_receipt_recorded")
    expect(listCollection<{ type: string }>("users/sup-user/notifications").map((n) => n.type)).toContain("delivery_confirmed")

    // And Manufacturing failing does not silence the rest either.
    resetFakeDb()
    seedWorld()
    mocked(markPurchaseArrived).mockRejectedValueOnce(new Error("permission-denied"))
    const r2 = await recordReceipt(db, gate, { delivery: delivery(), po: po(), lines, receiverName: "سلمى", policies: DEFAULT_POLICIES }, { now: NOW, copy })
    expect(r2).toMatchObject({ stockLanded: true, posted: true, mfgClosed: false })
    expect(listCollection<{ type: string }>("users/sup-user/notifications").map((n) => n.type)).toContain("delivery_confirmed")
  })

  it("refuses an over-receipt before touching anything, a receiver name is required, and only a receiver may record", async () => {
    seedWorld()
    await expect(recordReceipt(db, gate, { delivery: delivery(), po: po(), lines: [{ poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 6, counted: 11 }], receiverName: "س", policies: DEFAULT_POLICIES }, { now: NOW })).rejects.toBeInstanceOf(ReceiptValidationError)
    await expect(recordReceipt(db, gate, { delivery: delivery(), po: po(), lines, receiverName: "  ", policies: DEFAULT_POLICIES }, { now: NOW })).rejects.toMatchObject({ code: "reason_required" })
    await expect(recordReceipt(db, nobody, { delivery: delivery(), po: po(), lines, receiverName: "x", policies: DEFAULT_POLICIES }, { now: NOW })).rejects.toMatchObject({ code: "no_permission" })
    expect(delivery().status).toBe("pending_confirmation")
    expect(po().lines[0].accepted).toBe(0)
    expect(readDoc(`mfgCounters/${ORG}__GR__2026`)).toBeNull()
    expect(mocked(receiveDelivery)).not.toHaveBeenCalled()
  })

  it("re-validates against the order as it is NOW: a stale screen is refused inside the transaction, and a delivery already confirmed is refused", async () => {
    seedWorld()
    const stale = po() // the screen's copy: 10 outstanding on l1
    seed("purchaseOrders/po1", { ...order(), lines: [{ ...order().lines[0], accepted: 8 }, order().lines[1]] })
    await expect(recordReceipt(db, gate, { delivery: delivery(), po: stale, lines: [{ poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 6, counted: 6 }], receiverName: "س", policies: DEFAULT_POLICIES }, { now: NOW })).rejects.toBeInstanceOf(ReceiptValidationError)
    expect(delivery().status).toBe("pending_confirmation")

    resetFakeDb()
    seedWorld()
    await recordReceipt(db, gate, { delivery: delivery(), po: po(), lines, receiverName: "س", policies: DEFAULT_POLICIES }, { now: NOW })
    const small: DeliveryLine[] = [{ poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 6, counted: 1 }]
    await expect(recordReceipt(db, gate, { delivery: delivery(), po: po(), lines: small, receiverName: "س", policies: DEFAULT_POLICIES }, { now: NOW })).rejects.toMatchObject({ code: "wrong_state" })
    expect(readDoc<{ last: number }>(`mfgCounters/${ORG}__GR__2026`)?.last).toBe(1)
  })

  it("flags a receipt by the order's preparer, records the supplier's acceptance on a merely-sent order, and posts a lump-sum order only on completion", async () => {
    seedWorld(order({ status: "sent", supplierAcceptedAt: null, promisedDate: null, lines: [{ id: "l1", name: "a", unit: "u", quantity: 10, unitPrice: null, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], totalExVat: 5000 }))
    const r1 = await recordReceipt(db, buyer, { delivery: delivery(), po: po(), lines: [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 6, counted: 6 }], receiverName: "بدر", policies: DEFAULT_POLICIES }, { now: NOW })
    expect(delivery()).toMatchObject({ selfReceived: true, postedNet: null })
    expect(po()).toMatchObject({ status: "accepted", acceptanceRecordedBy: "buyer" })
    expect(r1.posted).toBe(false)
    expect(mocked(receiveDelivery)).toHaveBeenCalledWith(expect.objectContaining({ items: [{ name: "a", unit: "u", quantity: 6, unitCost: null }] }))
    // The second delivery completes the lot: the whole total, less what was posted before (nothing).
    seed("deliveries/d2", { ...(readDoc<Record<string, unknown>>("deliveries/d1") as Record<string, unknown>), status: "pending_confirmation", lines: [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 4 }] })
    const r2 = await recordReceipt(db, gate, { delivery: delivery("d2"), po: po(), lines: [{ poLineId: "l1", name: "a", unit: "u", noticeQuantity: 4, counted: 4 }], receiverName: "س", policies: DEFAULT_POLICIES, alreadyPostedNet: 0 }, { now: NOW })
    expect(r2).toMatchObject({ docNumber: "GR-2026/002", posted: true })
    expect(delivery("d2").postedNet).toBe(5000)
    expect(mocked(onGoodsReceived)).toHaveBeenLastCalledWith(db, expect.anything(), expect.objectContaining({ deliveryId: "d2", net: 5000 }))
    expect(poStatus(po())).toBe("received")
    expect(po().status).toBe("accepted")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Legacy, arrival without notice, manual
// ─────────────────────────────────────────────────────────────────────────────

describe("the other doors", () => {
  it("a legacy notice (no order, no lines) confirms all with the receiver's name, lands its items at the lot's unit price and posts the offer's value", async () => {
    seed("deliveries/old", { contractorOrgId: ORG, status: "pending_confirmation", offerId: "of9", rfqId: "rfq9", rfqTitle: "أسمنت", supplierId: "sup-user", supplierOrgId: "sup-org", supplierName: "مصنع", projectId: null, items: [{ name: "أسمنت", quantity: 50, unitOfMeasure: "كيس" }] })
    const r = await recordReceipt(db, gate, { delivery: delivery("old"), po: null, receiverName: "سلمى", policies: DEFAULT_POLICIES, legacyNet: 1250 }, { now: NOW, centralWarehouseCopy: { name: "المركزي", location: "المقر", description: "" } })
    expect(r).toMatchObject({ docNumber: "GR-2026/001", stockLanded: true, posted: true, mfgClosed: false, landedWarehouseId: `central_${ORG}` })
    expect(delivery("old")).toMatchObject({ status: "confirmed", receivedByName: "سلمى", confirmedByUserId: "gate", postedNet: 1250, selfReceived: false })
    expect(delivery("old").lines).toEqual([expect.objectContaining({ poLineId: "i1", name: "أسمنت", unit: "كيس", noticeQuantity: 50, counted: 50, accepted: 50 })])
    expect(readDoc<{ name: string; isCentral: boolean }>(`warehouses/central_${ORG}`)).toMatchObject({ name: "المركزي", isCentral: true })
    expect(mocked(receiveDelivery)).toHaveBeenCalledWith(expect.objectContaining({ warehouseId: `central_${ORG}`, items: [{ name: "أسمنت", unit: "كيس", quantity: 50, unitCost: 25 }] }))
    expect(mocked(onGoodsReceived)).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ deliveryId: "old", net: 1250, supplierId: "sup-org", rfqTitle: "أسمنت" }))
    expect(listCollection<{ type: string }>("users/sup-user/notifications").map((n) => n.type)).toEqual(["delivery_confirmed"])
  })

  it("a legacy notice with NO items (registered suppliers' notices before this module) still confirms whole — nothing to count, nothing lands, nothing posts", async () => {
    seed("deliveries/empty", { contractorOrgId: ORG, status: "pending_confirmation", offerId: "of8", rfqId: "rfq8", rfqTitle: "بلاط", supplierId: "sup-user", supplierOrgId: "sup-org", supplierName: "مصنع", projectId: null, items: [] })
    const r = await recordReceipt(db, gate, { delivery: delivery("empty"), po: null, receiverName: "سلمى", policies: DEFAULT_POLICIES, legacyNet: 900 }, { now: NOW, centralWarehouseCopy: { name: "المركزي", location: "المقر", description: "" } })
    expect(r).toMatchObject({ docNumber: "GR-2026/001", stockLanded: false, posted: false })
    expect(delivery("empty")).toMatchObject({ status: "confirmed", receivedByName: "سلمى", lines: [], landedWarehouseId: null, postedNet: null })
    expect(mocked(receiveDelivery)).not.toHaveBeenCalled()
    expect(mocked(onGoodsReceived)).not.toHaveBeenCalled()
    expect(listCollection<{ type: string }>("users/sup-user/notifications").map((n) => n.type)).toEqual(["delivery_confirmed"])
  })

  it("a delivery that names an order is never received as a legacy one", async () => {
    seedWorld()
    await expect(recordReceipt(db, gate, { delivery: delivery("d1"), po: null, receiverName: "سلمى", policies: DEFAULT_POLICIES }, { now: NOW })).rejects.toMatchObject({ code: "order_missing" })
    expect(delivery("d1").status).toBe("pending_confirmation")
  })

  it("an arrival with no notice is a contractor-born delivery, born confirmed, flagged noNotice, naming only the order — and moves the order", async () => {
    seedWorld()
    const r = await createArrivalWithoutNotice(db, gate, { po: po(), lines: [{ poLineId: "l2", name: "حديد 16مم", unit: "طن", noticeQuantity: 0, counted: 5 }], receiverName: "سلمى", deliveryDate: "2026-09-22", driverName: "سائق", policies: DEFAULT_POLICIES }, { now: NOW })
    expect(r.docNumber).toBe("GR-2026/001")
    const d = readDoc<Record<string, unknown>>(`deliveries/${r.deliveryId}`) as Record<string, unknown>
    expect(d).toMatchObject({ contractorOrgId: ORG, contractorId: "gate", status: "confirmed", noNotice: true, poId: "po1", poNumber: "PO-2026/001", docNumber: "GR-2026/001", supplierName: "شركة الحديد", deliveryDate: "2026-09-22", deliveryPersonName: "سائق", receivedByName: "سلمى", confirmedByUserId: "gate", postedNet: 16000 })
    for (const forbidden of ["offerId", "rfqId", "supplierOrgId", "supplierId", "source"]) expect(d).not.toHaveProperty(forbidden)
    expect(po().lines[1].accepted).toBe(5)
    expect(mocked(receiveDelivery)).toHaveBeenCalledWith(expect.objectContaining({ items: [{ name: "حديد 16مم", unit: "طن", quantity: 5, unitCost: 3200 }] }))
    // The supplier is still told, through the order's user.
    expect(listCollection<{ type: string }>("users/sup-user/notifications").map((n) => n.type)).toContain("delivery_confirmed")
    // From the manual form it is additionally flagged manual.
    const r2 = await createArrivalWithoutNotice(db, gate, { po: po(), lines: [{ poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 0, counted: 2 }], receiverName: "س", policies: DEFAULT_POLICIES, manual: true }, { now: NOW })
    expect(readDoc<{ source: string; docNumber: string }>(`deliveries/${r2.deliveryId}`)).toMatchObject({ source: "manual", docNumber: "GR-2026/002" })
    await expect(createArrivalWithoutNotice(db, gate, { po: po(), lines: [{ poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 0, counted: 50 }], receiverName: "س", policies: DEFAULT_POLICIES }, { now: NOW })).rejects.toBeInstanceOf(ReceiptValidationError)
  })

  it("a manual receipt with no order is numbered, flagged manual, posts nothing, lands stock only in a chosen warehouse, and can be booked as an expense", async () => {
    const r = await createManualReceipt(db, gate, { organizationId: ORG, supplierName: "محل الحي", deliveryDate: "2026-09-22", receiverName: "سلمى", reason: "شراء نقدي", warehouseId: "wh-p1", items: [{ name: "زوايا حديد", quantity: 20, unit: "حبة", unitPrice: 12 }] }, { now: NOW })
    expect(r).toMatchObject({ docNumber: "GR-2026/001", stockLanded: true })
    const d = readDoc<Record<string, unknown>>(`deliveries/${r.deliveryId}`) as Record<string, unknown>
    expect(d).toMatchObject({ source: "manual", status: "confirmed", contractorId: "gate", supplierName: "محل الحي", receiptNote: "شراء نقدي", landedWarehouseId: "wh-p1", postedNet: null })
    for (const forbidden of ["offerId", "rfqId", "supplierOrgId", "supplierId", "poId"]) expect(d).not.toHaveProperty(forbidden)
    expect(d.lines).toEqual([expect.objectContaining({ name: "زوايا حديد", counted: 20, accepted: 20 })])
    expect(mocked(receiveDelivery)).toHaveBeenCalledWith(expect.objectContaining({ warehouseId: "wh-p1", items: [{ name: "زوايا حديد", unit: "حبة", quantity: 20, unitCost: 12 }] }))
    expect(mocked(onGoodsReceived)).not.toHaveBeenCalled()
    await markReceiptAsExpense(db, gate, r.deliveryId)
    expect(readDoc<{ regularisation: string }>(`deliveries/${r.deliveryId}`)?.regularisation).toBe("expense")
    await expect(markReceiptAsExpense(db, nobody, r.deliveryId)).rejects.toBeInstanceOf(ProcWriteError)
    await expect(createManualReceipt(db, gate, { organizationId: ORG, supplierName: "", deliveryDate: "2026-09-22", receiverName: "س", items: [] }, { now: NOW })).rejects.toMatchObject({ code: "reason_required" })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The desk — segments, counts, CSV, print
// ─────────────────────────────────────────────────────────────────────────────

describe("the desk's pure helpers", () => {
  const pending: DeskDelivery = { id: "n1", status: "pending_confirmation", poId: "po1", supplierName: "شركة الحديد", deliveryDate: "2026-09-23", lines: [{ poLineId: "l1", name: "حديد 12مم", unit: "طن", noticeQuantity: 6 }] }
  const latePending: DeskDelivery = { id: "n2", status: "pending_confirmation", poId: null, offerId: "of3", supplierName: "مصنع", deliveryDate: "2026-09-10", items: [{ name: "أسمنت", quantity: 50, unit: "كيس" }] }
  const received: DeskDelivery = { id: "g1", status: "confirmed", poId: "po1", poNumber: "PO-2026/001", docNumber: "GR-2026/001", supplierName: "شركة الحديد", confirmedAt: "2026-09-21T10:00:00Z", receivedByName: "سلمى", landedWarehouseId: "wh-p1", projectId: "p1", lines: [{ poLineId: "l1", name: "حديد 12مم", unit: "طن", noticeQuantity: 6, counted: 6, rejected: 1, held: 2, accepted: 3, rejectReason: "damaged", holdReason: "test" }] }
  const manual: DeskDelivery = { id: "m1", status: "confirmed", source: "manual", docNumber: "GR-2026/002", supplierName: "محل الحي", deliveryDate: "2026-09-22", receivedByName: "بدر", items: [{ name: "زوايا", quantity: 20, unit: "حبة" }], noNotice: false }
  const legacy: DeskDelivery = { id: "o1", status: "confirmed", offerId: "of5", supplierName: "قديم", confirmedAt: "2026-08-01T00:00:00Z", items: [{ name: "رمل", quantity: 3, unit: "م3" }] }
  const all = [pending, latePending, received, manual, legacy]
  const dueOrder = order({ id: "po2", docNumber: "PO-2026/002", supplierName: "الأنابيب", rfqTitle: "أنابيب", promisedDate: "2026-09-18", projectId: "p2", lines: [{ id: "l1", name: "أنبوب 4 بوصة", unit: "م", quantity: 100, unitPrice: 10, accepted: 0, rejected: 0, held: 0, cancelled: 0 }] })
  const farOrder = order({ id: "po3", docNumber: "PO-2026/003", promisedDate: "2026-10-30" })
  const orders = [order(), dueOrder, farOrder]

  it("segments: pending → incoming; manual without an order → nopo; the rest → log", () => {
    expect(all.map(receiptSegment)).toEqual(["incoming", "incoming", "log", "nopo", "log"])
  })

  it("on the way: pending notices with their state, then live orders due within the horizon and un-noticed, sorted by day", () => {
    const rows = incomingRows(all, orders, NOW)
    expect(rows.map((r) => r.id)).toEqual(["n:n2", "d:po2", "n:n1"])
    expect(rows[0]).toMatchObject({ kind: "notice", state: "late_notice" })
    expect(rows[1]).toMatchObject({ kind: "due", daysLate: 4, day: "2026-09-18" })
    expect(rows[2]).toMatchObject({ kind: "notice", state: "on_the_way", daysFromNow: 1, afterPromise: 3 })
  })

  it("counts respect the search and the project filter across segments", () => {
    expect(segmentCounts(all, orders, { term: "", projectId: null }, NOW)).toEqual({ incoming: 3, log: 2, nopo: 1 })
    expect(segmentCounts(all, orders, { term: "حديد", projectId: null }, NOW)).toEqual({ incoming: 1, log: 1, nopo: 0 })
    expect(segmentCounts(all, orders, { term: "", projectId: "p2" }, NOW)).toEqual({ incoming: 1, log: 0, nopo: 0 })
    expect(segmentCounts(all, orders, { term: "الانابيب", projectId: null }, NOW).incoming).toBe(1)
  })

  it("the log rows carry the state and the flags", () => {
    const rows = receiptRows(all, orders, "log", NOW)
    expect(rows.map((r) => r.delivery.id)).toEqual(["g1", "o1"])
    expect(rows[0]).toMatchObject({ state: "received_with_rejects", rejected: 1, held: 2, short: 0, complete: false })
    expect(rows[1]).toMatchObject({ state: "received", complete: null })
    expect(receiptRows(all, orders, "nopo", NOW)[0]).toMatchObject({ state: "manual_no_po" })
  })

  it("CSV: one row per line, no money, BOM, every cell quoted", () => {
    const words: CsvWords = { headers: { receipt: "السند", date: "التاريخ", supplier: "المورد", po: "أمر الشراء", material: "المادة", perNotice: "حسب الإشعار", counted: "المعدود", accepted: "المقبول", rejected: "المرفوض", held: "بانتظار الفحص", place: "المكان", receiver: "المستلم", recordedIn: "سجّله" }, recordedManual: "يدوي", recordedGate: "البوابة", noPo: "بلا أمر", noNotice: "بلا إشعار" }
    const rows = receiptCsvRows(all, orders, (id) => (id === "wh-p1" ? "مستودع البرج" : ""), words)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual(["GR-2026/002", "2026-09-22", "محل الحي", "بلا أمر", "زوايا · حبة", "بلا إشعار", "20", "20", "0", "0", "", "بدر", "يدوي"])
    expect(rows[1]).toEqual(["GR-2026/001", "2026-09-21", "شركة الحديد", "PO-2026/001", "حديد 12مم · طن", "6", "6", "3", "1", "2", "مستودع البرج", "سلمى", "البوابة"])
    const csv = receiptCsv(rows, words)
    expect(csv.startsWith("﻿\"السند\",")).toBe(true)
    expect(csv.split("\r\n")).toHaveLength(4)
    expect(csv).not.toMatch(/[⃁﷼]/)
    expect(csv).not.toContain("3000")
  })

  it("the printed receipt: status banner, the quantity table, the checklist, three signatures, no riyal glyph, value only for a reader who sees prices", () => {
    const t = (k: string, p?: Record<string, string | number>) => `[${k}${p ? ":" + Object.values(p).join("|") : ""}]`
    const base = { delivery: { ...received, checklist: ["delivery_note" as const], deliveryPersonName: "أبو خالد", vehiclePlate: "ABC 123" }, po: order(), company: { name: "النخبة", cr: "1010", vat: "3001" }, placeName: "مستودع البرج", projectName: "برج", displayNumber: "ا.س-2026/001", displayPoNumber: "ط.ش-2026/001", locale: "ar", t, tp: t, now: NOW }
    const html = buildReceiptPrintHtml({ ...base, withPrices: true })
    expect(html).toContain("[status_partial:")
    expect(html).toContain("[rejectReason.damaged]")
    expect(html).toContain("[holdReason.test]")
    expect(html).toContain("☑ [checklist.delivery_note]")
    expect(html).toContain("☐ [checklist.weighbridge]")
    expect(html).toContain("ABC 123")
    expect((html.match(/\[signature\]/g) || []).length).toBe(3)
    expect(html).toContain("9,000 ر.س") // 3 accepted × 3000
    expect(html).not.toMatch(/[⃁﷼]/)
    expect(buildReceiptPrintHtml({ ...base, withPrices: false })).not.toContain("9,000")
    const noPo = buildReceiptPrintHtml({ ...base, delivery: manual, po: null, withPrices: true })
    expect(noPo).toContain("[status_no_po]")
    expect(noPo).toContain("[title_no_po]")
    expect(noPo).toContain("[footer_no_po]")
  })
})
