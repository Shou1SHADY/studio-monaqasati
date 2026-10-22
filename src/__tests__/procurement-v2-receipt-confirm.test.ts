/** @jest-environment node */
/**
 * Procurement 2.0 — THE RECEIVER'S CONFIRMATION IS THE RECEIPT (G-09, RCV-03, R-35, WF-18, WP-S5-01). The receiver — a member forwarded to,
 * or anyone holding the link's code — counts blind, says what he did not accept and why, and «أكّد الاستلام» makes the receipt in ONE
 * server act: the GR number, the order's counters, the delivery confirmed, the stock in the store, the books, the workshop's request, the
 * `inv:GRN` / `prj:GRN` event. Procurement records nothing. Ported: qa_review R-35 (count 3, accept 2, reject 1 with its reason ⇒ the receipt
 * exists at once, the order moves, `g.by === n.fwd.to`) and qa_flows WF-18 (the arrival with no notice).
 */

import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const db = new FakeAdminDb()

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))

import { ReceiptRefusal, confirmReceipt, type ConfirmRequest } from "@/lib/procurement/receipt-confirm-server"
import type { PurchaseOrder } from "@/lib/procurement/types"

const ORG = "org1"
const NOW = new Date("2026-10-21T09:00:00Z")
const asDb = db as never

const line = (id: string, name: string, quantity: number, unitPrice = 3000, extra: Record<string, unknown> = {}) => ({ id, name, unit: "طن", quantity, unitPrice, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...extra })

const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/021",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "حديد التسليح",
  offerId: "o1",
  projectId: "p1",
  projectName: "برج العليا",
  supplierOrgId: "sup1",
  supplierUserId: "su1",
  supplierName: "مصنع الجودة",
  isGuestSupplier: false,
  lines: [line("l1", "حديد 12 مم", 10), line("l2", "حديد 16 مم", 5, 3200)],
  totalExVat: 46000,
  vatRate: 0.15,
  preparedById: "buyer",
  preparedByName: "بدر",
  createdAt: "2026-10-10T08:00:00Z",
  approverKind: "manager",
  supplierAcceptedAt: "2026-10-12T08:00:00Z",
  promisedDate: "2026-10-20",
  log: [],
  ...over,
})

const notice = (over: Record<string, unknown> = {}) => ({
  contractorOrgId: ORG,
  status: "pending_confirmation",
  poId: "po1",
  poNumber: "PO-2026/021",
  supplierName: "مصنع الجودة",
  supplierOrgId: "sup1",
  supplierId: "su1",
  rfqTitle: "حديد التسليح",
  projectId: "p1",
  deliveryDate: "2026-10-20T00:00:00.000Z",
  seq: 1,
  notes: "الشاحنة الأولى",
  items: [],
  forwardedTo: { linkId: "lk1", name: "سامي الدوسري", userId: "rcv", phoneMasked: "05••", byName: "ريم", at: "2026-10-19T08:00:00Z" },
  ...over,
})

const link = (over: Record<string, unknown> = {}) => ({ token: "t".repeat(64), deliveryId: "d1", organizationId: ORG, receiver: { kind: "user", userId: "rcv", name: "سامي الدوسري", phone: "+966500000000" }, status: "open", createdById: "clerk", createdByName: "ريم", createdAt: "2026-10-19T08:00:00Z", expiresAt: "2026-10-30T00:00:00Z", ...over })

const row = (poLineId: string, counted: number, rejected = 0, rejectReason: string | null = null) => ({ poLineId, name: "", unit: "", counted, rejected, rejectReason, held: 0, holdReason: null, note: null })

const req = (over: Partial<ConfirmRequest> = {}): ConfirmRequest => ({
  deliveryId: "d1",
  linkId: "lk1",
  receiver: { name: "سامي الدوسري", userId: "rcv", via: "login" },
  rows: [row("l1", 3, 1, "damaged"), row("l2", 0)],
  files: [{ name: "ticket.jpg", url: "https://firebasestorage.googleapis.com/v0/b/x/o/t.jpg?alt=media", kind: "ticket" }],
  forwardedById: "clerk",
  ...over,
})

const po = () => db.get("purchaseOrders/po1") as unknown as PurchaseOrder
const delivery = (id = "d1") => db.get(`deliveries/${id}`) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  db.docs.clear()
  db.writes.length = 0
  db.seed("users/org1", { companyName: "شركة المقاول", organizationId: ORG })
  db.seed("users/buyer", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy" })
  db.seed("users/fin", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-fin" })
  db.seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept"] })
  db.seed("teamGroups/g-fin", { organizationId: ORG, permissions: ["invoices.manage"] })
  db.seed("projects/p1", { organizationId: ORG, name: "برج العليا", warehouseId: "wh-p1" })
  db.seed("warehouses/wh-p1", { organizationId: ORG, name: "مستودع البرج", projectId: "p1" })
  db.seed("purchaseOrders/po1", order())
  db.seed("deliveries/d1", notice())
  db.seed("receiptLinks/lk1", link())
})

describe("R-35 — the receiver counts 3, accepts 2, rejects 1 with its reason: the receipt exists at once", () => {
  it("one act: GR number, the order moves, the delivery is the receipt, the link is spent", async () => {
    const out = await confirmReceipt(asDb, req(), NOW)
    expect(out.docNumber).toBe("GR-2026/001")
    expect(po().lines.map((l) => [l.accepted, l.rejected])).toEqual([[2, 1], [0, 0]])
    expect(po().log.at(-1)).toMatchObject({ action: "received", byId: "rcv", params: { number: "GR-2026/001", accepted: 2 } })
    expect(delivery()).toMatchObject({
      status: "confirmed",
      docNumber: "GR-2026/001",
      receivedByName: "سامي الدوسري",
      confirmedVia: "login",
      recordedBy: "receiver",
      receiverModule: "projects",
      grnKey: "prj:GRN:GR-2026/001",
      landedWarehouseId: "wh-p1",
      selfReceived: false,
      poId: "po1",
    })
    expect(delivery().lines).toEqual([expect.objectContaining({ poLineId: "l1", counted: 3, rejected: 1, rejectReason: "damaged", accepted: 2 })])
    expect(delivery().receiverReport).toMatchObject({ verifiedBy: "login", receiverUserId: "rcv" })
    expect(delivery().attachmentUrls).toEqual(["https://firebasestorage.googleapis.com/v0/b/x/o/t.jpg?alt=media"])
    expect(delivery().checklist).toEqual(["weighbridge"])
    expect(db.get("receiptLinks/lk1")).toMatchObject({ status: "signed" })
    expect(out).toMatchObject({ stockLanded: true, eventSent: true })
  })

  it("stock lands in the project's store at the order's price; the event of the unit that received it leaves once", async () => {
    await confirmReceipt(asDb, req(), NOW)
    const stock = db.list("warehouses/wh-p1/inventoryItems")
    expect(stock).toEqual([expect.objectContaining({ name: "حديد 12 مم", unit: "طن", quantity: 2, unitCost: 3000 })])
    expect(db.get("procEvents/org1__prj:GRN:GR-2026_001")).toMatchObject({ id: "pm_receipt", key: "prj:GRN:GR-2026/001", by: "rcv" })
  })

  it("the preparer, Finance and the forwarder hear of it; the supplier is told which receipt took his delivery", async () => {
    await confirmReceipt(asDb, req(), NOW)
    expect(db.list("users/buyer/notifications").map((n) => n.type)).toContain("po_receipt_recorded")
    expect(db.list("users/fin/notifications").map((n) => n.type)).toContain("po_receipt_recorded")
    expect(db.list("users/clerk/notifications").map((n) => n.type)).toContain("po_receipt_recorded")
    expect(db.list("users/su1/notifications").map((n) => n.type)).toEqual(["po_receipt_for_supplier"])
  })

  it("the books hear of it when Finance is on — one balanced entry per delivery — and never when it is off", async () => {
    await confirmReceipt(asDb, req(), NOW)
    expect(db.list("accounting_journal")).toHaveLength(0)
    db.docs.clear()
    beforeEachSeed()
    db.seed("accounting_settings/s1", { organizationId: ORG, enabled: true })
    await confirmReceipt(asDb, req(), NOW)
    const entry = db.list("accounting_journal")[0] as unknown as { sourceType: string; sourceId: string; totalDebit: number; totalCredit: number }
    expect(entry).toMatchObject({ sourceType: "goods_receipt", sourceId: "d1" })
    expect(entry.totalDebit).toBe(entry.totalCredit)
    expect(entry.totalDebit).toBe(6900)
  })

  it("closes the workshop's purchase request the order answered", async () => {
    db.seed("purchaseOrders/po1", order({ purchaseSource: { kind: "mfg_purchase", workOrderId: "wo1", purchaseRequestId: "pr1" } }))
    db.seed("workOrders/wo1", { docNumber: "WO-2026/004", purchaseRequests: [{ id: "pr1", state: "ordered", quantity: 3, unit: "طن", itemName: "حديد", byId: "wm" }] })
    db.seed("users/wm", { organizationId: ORG, organizationRole: "member" })
    const out = await confirmReceipt(asDb, req(), NOW)
    expect(out.mfgClosed).toBe(true)
    expect((db.get("workOrders/wo1") as { purchaseRequests: Array<{ state: string }> }).purchaseRequests[0].state).toBe("arrived")
    expect(db.list("users/wm/notifications").map((n) => n.type)).toEqual(["mfg_purchase_arrived"])
  })
})

const beforeEachSeed = () => {
  db.seed("users/org1", { companyName: "شركة المقاول", organizationId: ORG })
  db.seed("users/buyer", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy" })
  db.seed("projects/p1", { organizationId: ORG, name: "برج العليا", warehouseId: "wh-p1" })
  db.seed("warehouses/wh-p1", { organizationId: ORG, name: "مستودع البرج", projectId: "p1" })
  db.seed("purchaseOrders/po1", order())
  db.seed("deliveries/d1", notice())
  db.seed("receiptLinks/lk1", link())
}

describe("the count is checked against the order as it is NOW", () => {
  const refused = async (r: Partial<ConfirmRequest>) => confirmReceipt(asDb, req(r), NOW).catch((e) => e)

  it("a rejection without a reason, a count past the tolerance and an empty count are refused with codes — nothing is written", async () => {
    const noReason = await refused({ rows: [row("l1", 3, 1, null)] })
    expect(noReason).toBeInstanceOf(ReceiptRefusal)
    expect(noReason.errors[0]).toMatchObject({ code: "reject_reason_missing", poLineId: "l1" })
    const over = await refused({ rows: [row("l1", 11)] })
    expect(over.errors[0].code).toBe("over_receipt")
    const none = await refused({ rows: [row("l1", 0), row("l2", 0)] })
    expect(none.errors[0].code).toBe("nothing_counted")
    expect(delivery().status).toBe("pending_confirmation")
    expect(po().lines[0].accepted).toBe(0)
    expect(db.list("mfgCounters")).toHaveLength(0)
  })

  it("an order that is no longer open (cancelled) takes no receipt", async () => {
    db.seed("purchaseOrders/po1", order({ status: "cancelled" }))
    const e = await refused({})
    expect(e).toMatchObject({ code: "order_not_open", status: 409 })
  })

  it("a delivery already confirmed, or a link already spent, is refused (410) — a second press changes nothing", async () => {
    await confirmReceipt(asDb, req(), NOW)
    const again = await refused({})
    expect(again).toMatchObject({ code: "link_closed", status: 410 })
    db.seed("receiptLinks/lk1", link())
    const second = await refused({})
    expect(second).toMatchObject({ code: "already_received", status: 410 })
    expect(po().lines[0].accepted).toBe(2)
    expect(db.get("mfgCounters/org1__GR__2026")).toMatchObject({ last: 1 })
  })

  it("numbers run on: the next receipt of the company is GR-2026/002", async () => {
    await confirmReceipt(asDb, req(), NOW)
    db.seed("deliveries/d2", notice({ seq: 2 }))
    db.seed("receiptLinks/lk2", link({ deliveryId: "d2" }))
    const out = await confirmReceipt(asDb, req({ deliveryId: "d2", linkId: "lk2", rows: [row("l1", 4), row("l2", 0)] }), NOW)
    expect(out.docNumber).toBe("GR-2026/002")
    expect(po().lines[0].accepted).toBe(6)
  })
})

describe("who the receipt belongs to", () => {
  it("a person with no account confirms with the code: confirmed by that mobile, flagged sms_code, no user id", async () => {
    const out = await confirmReceipt(asDb, req({ receiver: { name: "عامل الموقع", userId: null, phoneMasked: "05••12", via: "sms_code" } }), NOW)
    expect(delivery()).toMatchObject({ confirmedVia: "sms_code", receiverUserId: null, confirmedByUserId: null, receivedByName: "عامل الموقع" })
    expect(out.print.via).toBe("sms_code")
  })

  it("the order's own preparer receiving it is allowed and flagged (the exceptions report reads it)", async () => {
    await confirmReceipt(asDb, req({ receiver: { name: "بدر", userId: "buyer", via: "login" } }), NOW)
    expect(delivery().selfReceived).toBe(true)
  })

  it("at a store that belongs to no project it is Inventory that received it: inv:GRN, central store made on the fly", async () => {
    db.seed("purchaseOrders/po1", order({ projectId: null }))
    db.seed("deliveries/d1", notice({ projectId: null }))
    const out = await confirmReceipt(asDb, req({ receiver: { name: "أمين المستودع", userId: "keeper", via: "login" } }), NOW)
    expect(out.place).toEqual({ warehouseId: "central_org1", module: "inventory" })
    expect(delivery()).toMatchObject({ receiverModule: "inventory", grnKey: "inv:GRN:GR-2026/001", landedWarehouseId: "central_org1" })
    expect(db.get("warehouses/central_org1")).toMatchObject({ isCentral: true })
    expect(db.get("procEvents/org1__inv:GRN:GR-2026_001")).toBeTruthy()
  })

  it("the store the receiver is registered at wins over the central one when the order has no project", async () => {
    db.seed("purchaseOrders/po1", order({ projectId: null }))
    db.seed("deliveries/d1", notice({ projectId: null }))
    db.seed("warehouses/wh-jed", { organizationId: ORG, name: "مستودع جدة" })
    db.seed("procurementReceivers/r1", { organizationId: ORG, userId: "rcv", active: true, warehouseIds: ["wh-jed"] })
    const out = await confirmReceipt(asDb, req(), NOW)
    expect(out.place).toEqual({ warehouseId: "wh-jed", module: "inventory" })
  })
})

describe("WF-18 — a truck with no notice: the receipt is born at the confirmation, tagged, and closes the notice it answers", () => {
  const arrival = (over: Partial<ConfirmRequest> = {}): ConfirmRequest => req({ deliveryId: "new1", arrivalPoId: "po1", linkId: "lk9", rows: [row("l1", 4), row("l2", 0)], ...over })
  beforeEach(() => {
    db.docs.delete("deliveries/d1")
    db.seed("receiptLinks/lk9", link({ deliveryId: "new1", arrival: true, poId: "po1" }))
  })

  it("creates a confirmed delivery flagged noNotice against the order, naming no supplier account the buyer could impersonate", async () => {
    const out = await confirmReceipt(asDb, arrival(), NOW)
    expect(delivery("new1")).toMatchObject({ status: "confirmed", noNotice: true, poId: "po1", supplierName: "مصنع الجودة", confirmedVia: "login", docNumber: out.docNumber, deliveryDate: "2026-10-21" })
    expect(po().lines[0].accepted).toBe(4)
    expect(db.get("receiptLinks/lk9")).toMatchObject({ status: "signed" })
  })

  it("the first pending notice (a day and a note — no quantity) is closed by the receipt that counted something; the second stays on the way", async () => {
    db.seed("deliveries/n1", notice({ seq: 1 }))
    db.seed("deliveries/n2", notice({ seq: 2 }))
    const out = await confirmReceipt(asDb, arrival(), NOW)
    expect(delivery("n1").closedByReceipt).toEqual({ deliveryId: "new1", docNumber: out.docNumber })
    expect(delivery("n2").closedByReceipt).toBeUndefined()
  })

  it("a second confirmation of the same arrival is refused", async () => {
    await confirmReceipt(asDb, arrival(), NOW)
    db.seed("receiptLinks/lk9", link({ deliveryId: "new1", arrival: true, poId: "po1" }))
    const e = await confirmReceipt(asDb, arrival(), NOW).catch((x) => x)
    expect(e).toMatchObject({ code: "already_received" })
  })
})

describe("a legacy notice (no order) is still received — whole, at the offer's price", () => {
  it("counts its items as lines, lands them, and posts the offer's value", async () => {
    db.docs.delete("purchaseOrders/po1")
    db.seed("offers/o1", { price: 5000 })
    db.seed("accounting_settings/s1", { organizationId: ORG, enabled: true })
    db.seed("deliveries/d1", notice({ poId: null, poNumber: null, projectId: null, items: [{ name: "أسمنت", quantity: 50, unitOfMeasure: "كيس" }], offerId: "o1" }))
    const out = await confirmReceipt(asDb, req({ rows: [{ poLineId: "i1", name: "أسمنت", unit: "كيس", counted: 50, rejected: 0, rejectReason: null, held: 0, holdReason: null, note: null }] }), NOW)
    expect(out.po).toBeNull()
    expect(db.list("warehouses/central_org1/inventoryItems")).toEqual([expect.objectContaining({ name: "أسمنت", quantity: 50, unitCost: 100 })])
    expect(db.list("accounting_journal")).toHaveLength(1)
  })
})
