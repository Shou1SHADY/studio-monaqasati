/**
 * Goods received — prototype parity (S-01…S-30): the log's completeness
 * filter and the pseudo-places, the on-the-way pill and shipment ordinal, the
 * suggested receiver, where it went and who recorded it, what earlier receipts
 * accepted, the seven-step trail and the receipt's log; the reject decision's
 * date / price; regularising a no-PO receipt against an open order.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/warehouse-transfer", () => ({ receiveDelivery: jest.fn(async () => undefined) }))
jest.mock("@/lib/accounting/hooks", () => ({ onGoodsReceived: jest.fn(() => undefined) }))

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { onGoodsReceived } from "@/lib/accounting/hooks"
import {
  PLACE_GENERAL,
  PLACE_WORKSHOP,
  acceptedBefore,
  completenessMatches,
  destKind,
  incomingPill,
  incomingRows,
  landingWarehouseId,
  noPoInvoiceValue,
  receiptLog,
  receiptRows,
  receiptTrail,
  recordedBy,
  rejectTermsOf,
  segmentCounts,
  shipmentOrdinal,
  suggestedReceiver,
  type DeskDelivery,
} from "@/lib/procurement/receipt-desk"
import { matchReceiptToOrder, openOrdersForReceipt, priceAboveReference, priceReference, regulariseProblem, registeredSuppliers, defaultChoice, parseChoice, choiceKey } from "@/lib/procurement/receipt-regularise"
import { linkReceiptToOrder, markReceiptAsExpense } from "@/lib/procurement/receipt-writes"
import { applyRejectDecision, decideReject, type RejectTermsLine } from "@/lib/procurement/writes"
import type { ProcReceiver } from "@/lib/procurement/receivers"
import type { PriceAgreement, PriceHistoryEntry } from "@/lib/procurement/prices"
import type { ProcActor, PurchaseOrder } from "@/lib/procurement/types"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-22T09:00:00Z")
const ORG = "owner-uid"
const buyer: ProcActor = { uid: "buyer", name: "Badr", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const gate: ProcActor = { ...buyer, uid: "gate", name: "Salma", canPrepare: false, canExpedite: false, canReceive: true, seesPrices: false }

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
    approvedAt: "2026-09-01T08:00:00Z",
    approverKind: "manager",
    promisedDate: "2026-09-20",
    log: [],
    ...over,
  }
}

describe("the desk: filters, pills, shipments, receivers", () => {
  const po = order()
  const workshop = order({ id: "po2", docNumber: "PO-2026/002", projectId: null, purchaseSource: { kind: "mfg_purchase", workOrderId: "wo1", purchaseRequestId: "pr1" } })
  const general = order({ id: "po3", docNumber: "PO-2026/003", projectId: null })
  const orders = [po, workshop, general]
  const g = (id: string, poId: string, over: Partial<DeskDelivery> = {}): DeskDelivery => ({ id, status: "confirmed", poId, supplierName: "x", confirmedAt: "2026-09-21T10:00:00Z", lines: [{ poLineId: "l1", name: "حديد 12مم", unit: "طن", noticeQuantity: 2, counted: 2, accepted: 2 }], ...over })
  const all = [g("a", "po1", { projectId: "p1" }), g("b", "po2"), g("c", "po3")]

  it("the place filter knows two pseudo-places: general stock and the workshop", () => {
    expect(segmentCounts(all, orders, { term: "", projectId: PLACE_WORKSHOP }, NOW).log).toBe(1)
    expect(segmentCounts(all, orders, { term: "", projectId: PLACE_GENERAL }, NOW).log).toBe(1)
    expect(segmentCounts(all, orders, { term: "", projectId: "p1" }, NOW).log).toBe(1)
  })

  it("the log says what is left and filters complete / partial; a receipt with no order only under all", () => {
    const rows = receiptRows(all, orders, "log", NOW)
    expect(rows[0]).toMatchObject({ complete: false, remaining: 15 })
    const done = receiptRows([g("z", "po9")], [order({ id: "po9", lines: [{ id: "l1", name: "a", unit: "u", quantity: 2, unitPrice: 1, accepted: 2, rejected: 0, held: 0, cancelled: 0 }] })], "log", NOW)[0]
    expect(done).toMatchObject({ complete: true, remaining: 0 })
    expect(completenessMatches(done, "done")).toBe(true)
    expect(completenessMatches(done, "open")).toBe(false)
    expect(completenessMatches({ complete: null }, "open")).toBe(false)
    expect(completenessMatches({ complete: null }, "all")).toBe(true)
  })

  it("the pill: a notice still with us inside the window is ours to forward; red on its day", () => {
    const notice = (day: string, over: Partial<DeskDelivery> = {}): DeskDelivery => ({ id: `n-${day}`, status: "pending_confirmation", poId: "po1", deliveryDate: day, lines: [], ...over })
    const rowsOf = (d: DeskDelivery) => incomingRows([d], [po], NOW)[0]
    expect(incomingPill(rowsOf(notice("2026-09-23")), 1)).toEqual({ kind: "to_forward", tone: "warn" })
    expect(incomingPill(rowsOf(notice("2026-09-22")), 1)).toEqual({ kind: "to_forward", tone: "bad" })
    expect(incomingPill(rowsOf(notice("2026-09-21")), 1)).toEqual({ kind: "to_forward", tone: "bad" })
    const fw = { linkId: "k", name: "ناصر", userId: null, phoneMasked: "•••12", byName: "Badr", at: "2026-09-21T08:00:00Z" }
    expect(incomingPill(rowsOf(notice("2026-09-23", { forwardedTo: fw })), 1)).toEqual({ kind: "after_promise", days: 3 })
    const early = order({ promisedDate: "2026-10-30" })
    expect(incomingPill(incomingRows([notice("2026-09-21", { forwardedTo: fw })], [early], NOW)[0], 1)).toEqual({ kind: "passed_no_receipt" })
    expect(incomingPill(incomingRows([notice("2026-09-28", { forwardedTo: fw })], [early], NOW)[0], 1)).toEqual({ kind: "in_days", days: 6 })
    // Unforwarded before the window: still ours to forward (blue) — the prototype shows it on every one.
    expect(incomingPill(incomingRows([notice("2026-09-28")], [early], NOW)[0], 1)).toEqual({ kind: "to_forward", tone: "info" })
    // Routed to both at once: nothing waits on us.
    expect(incomingPill(incomingRows([notice("2026-09-28")], [early], NOW)[0], 1, "both")).toEqual({ kind: "in_days", days: 6 })
    // A notice a receipt already took is no longer on the way.
    expect(incomingRows([notice("2026-09-28", { closedByReceipt: { deliveryId: "d2", docNumber: "GR-2026/002" } })], [], NOW)).toEqual([])
    const due = incomingRows([], [order({ promisedDate: "2026-09-18" })], NOW)[0]
    expect(incomingPill(due, 1)).toEqual({ kind: "due_late", days: 4 })
  })

  it("shipment n of m: m only when the pending notices cover what is left", () => {
    const first = g("s1", "po1", { deliveryDate: "2026-09-10", lines: [{ poLineId: "l1", name: "a", unit: "t", noticeQuantity: 4, counted: 4, accepted: 4 }] })
    const second: DeskDelivery = { id: "s2", status: "pending_confirmation", poId: "po1", deliveryDate: "2026-09-25", lines: [{ poLineId: "l1", name: "a", unit: "t", noticeQuantity: 6 }, { poLineId: "l2", name: "b", unit: "t", noticeQuantity: 5 }] }
    const after = order({ lines: [{ ...po.lines[0], accepted: 4 }, po.lines[1]] })
    expect(shipmentOrdinal(second, [first, second], after)).toEqual({ n: 2, m: 2 })
    const partial = { ...second, lines: [{ poLineId: "l1", name: "a", unit: "t", noticeQuantity: 3 }] }
    expect(shipmentOrdinal(partial, [first, partial], after)).toEqual({ n: 2, m: null })
    expect(shipmentOrdinal({ ...partial, id: "only" }, [{ ...partial, id: "only" }], after)).toBeNull()
  })

  it("the suggested receiver: named for the place first; the project's warehouse, else the central one", () => {
    const r = (id: string, name: string, warehouseIds: string[]): ProcReceiver => ({ id, organizationId: ORG, name, title: "t", module: "inventory", phone: "0500000000", warehouseIds, active: true, createdAt: "", createdById: "" })
    const register = [r("1", "أحمد", []), r("2", "ناصر", ["wh-p1"])]
    const place = landingWarehouseId("p1", [{ id: "p1", warehouseId: "wh-p1" }], ORG)
    expect(place).toBe("wh-p1")
    expect(landingWarehouseId(null, [], ORG)).toBe(`central_${ORG}`)
    expect(suggestedReceiver(register, place)?.name).toBe("ناصر")
    expect(suggestedReceiver([], place)).toBeNull()
  })

  it("where it went and who recorded it", () => {
    expect(destKind({ projectId: "p1" })).toBe("prj")
    expect(destKind({ projectId: null })).toBe("inv")
    expect(destKind(null, "p1")).toBe("prj")
    expect(destKind(null, null)).toBeNull()
    expect(recordedBy({ source: "manual" }, "inv")).toBe("procurement")
    expect(recordedBy({ selfReceived: true }, "prj")).toBe("procurement")
    expect(recordedBy({}, "prj")).toBe("projects")
    expect(recordedBy({}, "inv")).toBe("inventory")
  })

  it("accepted before this receipt: earlier receipts of the same order and line only", () => {
    const a = g("a1", "po1", { confirmedAt: "2026-09-10T10:00:00Z", docNumber: "GR-2026/001" })
    const b = g("b1", "po1", { confirmedAt: "2026-09-15T10:00:00Z", docNumber: "GR-2026/002" })
    const c = g("c1", "po1", { confirmedAt: "2026-09-20T10:00:00Z", docNumber: "GR-2026/003" })
    expect(acceptedBefore(c, [a, b, c], "l1")).toBe(4)
    expect(acceptedBefore(a, [a, b, c], "l1")).toBe(0)
    expect(acceptedBefore(c, [a, b, c], "l2")).toBe(0)
  })

  it("a no-PO receipt's invoice value is the priced lines only", () => {
    expect(noPoInvoiceValue({ items: [{ name: "a", quantity: 20, unitPrice: 12 }, { name: "b", quantity: 3, unitPrice: null }] })).toBe(240)
    expect(noPoInvoiceValue({ items: [{ name: "a", quantity: 2 }] })).toBeNull()
  })
})

describe("the trail and the log", () => {
  const po = order({ purchaseSource: { kind: "project_request" } })
  const fw = { linkId: "k", name: "ناصر", userId: null, phoneMasked: "•••12", byName: "Badr", at: "2026-09-20T08:00:00Z" }
  const d: DeskDelivery = { id: "g1", status: "confirmed", poId: "po1", docNumber: "GR-2026/004", createdAt: "2026-09-18T07:00:00Z", deliveryDate: "2026-09-21", paperNoteNumber: "DN-77", confirmedAt: "2026-09-21T10:00:00Z", confirmedByName: "Salma", receivedByName: "سلمى", forwardedTo: fw, lines: [{ poLineId: "l1", name: "a", unit: "t", noticeQuantity: 6, counted: 6, held: 1, accepted: 5 }] }

  it("seven steps, the held goods keep 'went' open, finance waits until the order closes", () => {
    const steps = receiptTrail(d, po)
    expect(steps.map((s) => s.key)).toEqual(["requested", "purchased", "notified", "forwarded", "received", "went", "finance"])
    expect(steps.map((s) => s.state)).toEqual(["ok", "ok", "ok", "ok", "ok", "now", "now"])
    expect(steps[0].variant).toBe("source_project_request")
    expect(steps[3]).toMatchObject({ variant: "link", params: { name: "ناصر", by: "Badr" } })
    const bare = receiptTrail({ ...d, noNotice: true, forwardedTo: null, lines: [] }, order({ status: "closed", closedAt: "2026-09-25T00:00:00Z" }))
    expect(bare.map((s) => s.state)).toEqual(["ok", "ok", "bad", "bad", "ok", "ok", "ok"])
    expect(bare[0].variant).toBe("direct")
    expect(bare[3].variant).toBe("unannounced")
  })

  it("the log is assembled newest first from the documents", () => {
    const log = receiptLog(d, po)
    expect(log.map((e) => e.action)).toEqual(["recorded", "forwarded", "noticed"])
    const manual: DeskDelivery = { id: "m1", status: "confirmed", source: "manual", docNumber: "GR-2026/009", confirmedAt: "2026-09-21T10:00:00Z", confirmedByName: "Badr", regularisation: "expense", regularisedAt: "2026-09-22T10:00:00Z", regularisedByName: "Badr" }
    expect(receiptLog(manual, null).map((e) => e.action)).toEqual(["expensed", "recorded"])
  })
})

describe("regularising a receipt with no order", () => {
  const lines = [{ poLineId: "i1", name: "حديد ١٢مم", unit: "طن", noticeQuantity: 0, counted: 3, accepted: 3 }]
  it("matches every line to an open line of the same material with room, or nothing", () => {
    expect(matchReceiptToOrder(lines, order())).toEqual([expect.objectContaining({ poLineId: "l1", counted: 3, accepted: 3 })])
    expect(matchReceiptToOrder([{ ...lines[0], counted: 30, accepted: 30 }], order())).toBeNull()
    expect(matchReceiptToOrder([...lines, { poLineId: "i2", name: "رمل", unit: "م3", noticeQuantity: 0, counted: 1, accepted: 1 }], order())).toBeNull()
    expect(openOrdersForReceipt([order(), order({ id: "x", projectId: "p9" }), order({ id: "y", status: "closed" })], lines, "p1").map((o) => o.id)).toEqual(["po1"])
    expect(defaultChoice([order()])).toEqual({ kind: "link", poId: "po1" })
    expect(defaultChoice([])).toEqual({ kind: "new" })
    expect(parseChoice(choiceKey({ kind: "link", poId: "po1" }))).toEqual({ kind: "link", poId: "po1" })
    expect(parseChoice("expense")).toEqual({ kind: "expense" })
  })

  it("a retroactive order names a supplier and a price on every line; the reference turns red above 2%", () => {
    expect(regulariseProblem({ kind: "new" }, { supplierName: "", prices: [1] })).toBe("supplier")
    expect(regulariseProblem({ kind: "new" }, { supplierName: "x", prices: [null] })).toBe("price")
    expect(regulariseProblem({ kind: "new" }, { supplierName: "x", prices: [5] })).toBeNull()
    expect(regulariseProblem({ kind: "expense" }, { supplierName: "", prices: [] })).toBeNull()
    const ag: PriceAgreement = { id: "a", organizationId: ORG, docNumber: "AG-2026/001", supplierOrgId: "s", supplierName: "المصنع", from: "2026-01-01", until: "2026-12-31", lines: [{ name: "حديد 12مم", unit: "طن", price: 3000 }], preparedById: "b", preparedByName: "b", createdAt: "" }
    const hist: PriceHistoryEntry = { id: "h", organizationId: ORG, materialKey: "", name: "رمل", unit: "م3", supplierOrgId: "s", supplierName: "المحجر", price: 50, day: "2026-08-01", kind: "po", poId: null, poNumber: null }
    const ref = priceReference([ag], [], "حديد ١٢مم", "طن", "2026-09-22")
    expect(ref).toMatchObject({ kind: "agreement", price: 3000 })
    expect(priceAboveReference(3060, ref)).toBe(false)
    expect(priceAboveReference(3061, ref)).toBe(true)
    const last = priceReference([], [{ ...hist, materialKey: "رمل|م3" }], "رمل", "م3", "2026-09-22")
    expect(last).toMatchObject({ kind: "last", price: 50, supplierName: "المحجر" })
    expect(priceReference([], [], "x", "y", "2026-09-22")).toBeNull()
  })

  it("registered suppliers come from our orders, never a guest", () => {
    expect(registeredSuppliers([order(), order({ id: "g", supplierOrgId: "guest", isGuestSupplier: true, supplierName: "ضيف" })])).toEqual([{ orgId: "sup-org", userId: "sup-user", name: "شركة الحديد" }])
  })
})

describe("the writes", () => {
  beforeEach(() => {
    resetFakeDb()
    jest.clearAllMocks()
  })

  it("links a no-PO receipt to an open order: the counters move, the receipt names the order, the books hear of landed goods", async () => {
    const { id, ...rest } = order()
    seed(`purchaseOrders/${id}`, rest)
    seed("deliveries/m1", { contractorOrgId: ORG, status: "confirmed", source: "manual", docNumber: "GR-2026/005", landedWarehouseId: "wh-p1", lines: [{ poLineId: "i1", name: "حديد 12مم", unit: "طن", noticeQuantity: 0, counted: 3, accepted: 3 }] })
    await expect(linkReceiptToOrder(db, gate, { deliveryId: "m1", poId: "po1" }, { now: NOW })).rejects.toMatchObject({ code: "no_permission" })
    const r = await linkReceiptToOrder(db, buyer, { deliveryId: "m1", poId: "po1" }, { now: NOW })
    expect(r).toEqual({ poNumber: "PO-2026/001", posted: true })
    expect(readDoc<PurchaseOrder>("purchaseOrders/po1")?.lines[0].accepted).toBe(3)
    expect(readDoc<Record<string, unknown>>("deliveries/m1")).toMatchObject({ poId: "po1", poNumber: "PO-2026/001", postedNet: 9000, regularisedByName: "Badr", lines: [expect.objectContaining({ poLineId: "l1" })] })
    expect(onGoodsReceived as jest.Mock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ deliveryId: "m1", net: 9000 }))
    await expect(linkReceiptToOrder(db, buyer, { deliveryId: "m1", poId: "po1" }, { now: NOW })).rejects.toMatchObject({ code: "not_no_po" })
    await expect(markReceiptAsExpense(db, buyer, "m1")).rejects.toMatchObject({ code: "not_no_po" })
  })

  it("refuses an order the receipt does not fit", async () => {
    const { id, ...rest } = order()
    seed(`purchaseOrders/${id}`, rest)
    seed("deliveries/m2", { contractorOrgId: ORG, status: "confirmed", source: "manual", lines: [{ poLineId: "i1", name: "رمل", unit: "م3", noticeQuantity: 0, counted: 3, accepted: 3 }] })
    await expect(linkReceiptToOrder(db, buyer, { deliveryId: "m2", poId: "po1" }, { now: NOW })).rejects.toMatchObject({ code: "no_matching_order" })
  })

  it("the reject decision carries its replacement date or discounted price; a discount without a price is refused", async () => {
    const lines = order().lines.map((l, i) => (i === 0 ? { ...l, accepted: 7, rejected: 3 } : l))
    const rep = applyRejectDecision(lines, "l1", "replace", null, "t", { replaceBy: "2026-09-30" })[0] as RejectTermsLine
    expect(rejectTermsOf(rep)).toEqual({ replaceBy: "2026-09-30", discountPrice: null })
    const disc = applyRejectDecision(lines, "l1", "discount", null, "t", { discountPrice: 2500 })[0] as RejectTermsLine
    expect(rejectTermsOf(disc)).toEqual({ replaceBy: null, discountPrice: 2500 })
    expect(disc.accepted).toBe(10)
    const { id, ...rest } = order({ lines })
    seed(`purchaseOrders/${id}`, rest)
    await expect(decideReject(db, buyer, "po1", { lineId: "l1", decision: "discount" }, { now: NOW })).rejects.toMatchObject({ code: "price_missing" })
    await expect(decideReject(db, buyer, "po1", { lineId: "l1", decision: "replace", replaceBy: "soon" }, { now: NOW })).rejects.toMatchObject({ code: "date_invalid" })
    const after = await decideReject(db, buyer, "po1", { lineId: "l1", decision: "replace", replaceBy: "2026-09-30" }, { now: NOW })
    expect(rejectTermsOf(after.lines[0])).toEqual({ replaceBy: "2026-09-30", discountPrice: null })
    expect(after.log[after.log.length - 1]).toMatchObject({ action: "reject_decided", params: expect.objectContaining({ lineId: "l1", replaceBy: "2026-09-30" }) })
  })
})
