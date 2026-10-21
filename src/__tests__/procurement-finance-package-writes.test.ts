/**
 * Procurement 1.5, PUR-07 / PUR-10 — the order's money acts follow the package, inside the transaction:
 * Finance's payment and hold exist only where Finance is, a received order is closed by hand only where it is
 * not, «أوقف صرف فاتورة» is a Procurement decision, and the reminders reach whoever they name.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { holdInvoice, recordFinancePayment, releaseHold, remindApprovers, remindFinanceAboutAdvance } from "@/lib/procurement/po-extra-writes"
import { closeReceivedPurchaseOrder } from "@/lib/procurement/writes"
import type { PurchaseOrderX } from "@/lib/procurement/po-extras"
import type { ProcActor } from "@/lib/procurement/types"

const db = fakeFirestore as unknown as Firestore
const ORG = "own"
const NOW = new Date("2026-10-19T09:00:00Z")

const actorOf = (over: Partial<ProcActor>): ProcActor => ({ uid: "buyer", name: "Badr", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true, ...over })
const buyer = actorOf({})
const approver = actorOf({ uid: "mgr", name: "Noura", canApprove: true, canPrepare: false })
const owner = actorOf({ uid: ORG, name: "Owner", isOwner: true, canApprove: true })

const line = (over: Record<string, unknown> = {}) => ({ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/001",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "حديد",
  offerId: "o1",
  supplierOrgId: "sup1",
  supplierUserId: null,
  supplierName: "مصنع الجودة",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 30000,
  vatRate: 0.15,
  preparedById: "buyer",
  preparedByName: "Badr",
  createdAt: "2026-10-01T08:00:00Z",
  approverKind: "manager",
  approvedAt: "2026-10-02T08:00:00Z",
  supplierAcceptedAt: "2026-10-03T08:00:00Z",
  promisedDate: "2026-10-20",
  log: [],
  ...over,
})
const po = (id: string) => readDoc<PurchaseOrderX>(`purchaseOrders/${id}`) as PurchaseOrderX
const inbox = (uid: string) => listCollection<{ type: string; message: string }>(`users/${uid}/notifications`)

const financeOff = () => seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["payments"] })

beforeEach(() => {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, name: "Owner" })
  seed("users/buyer", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy" })
  seed("users/mgr", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-mgr" })
  seed("users/fin", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-fin" })
  seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept"] })
  seed("teamGroups/g-mgr", { organizationId: ORG, permissions: ["po.approve"] })
  seed("teamGroups/g-fin", { organizationId: ORG, permissions: ["invoices.manage"] })
})

describe("F2 · closing a received order where there is no Finance", () => {
  const receivedOrder = () => order({ lines: [line({ accepted: 10 })], paymentMark: { state: "unpaid", day: "2026-10-10", byName: "O", at: "x" } })

  it("the owner and the approvers close it — the optional payment status never stops them", async () => {
    financeOff()
    seed("purchaseOrders/a", receivedOrder())
    seed("purchaseOrders/b", receivedOrder())
    await closeReceivedPurchaseOrder(db, owner, "a", { now: NOW })
    await closeReceivedPurchaseOrder(db, approver, "b", { now: NOW })
    expect(po("a")).toMatchObject({ status: "closed", closedShort: false, closedAt: NOW.toISOString() })
    expect(po("b").status).toBe("closed")
    expect(po("a").log.at(-1)).toMatchObject({ action: "closed", byId: ORG, params: { complete: 1 } })
  })

  it("the preparer is told; a plain buyer may not close it", async () => {
    financeOff()
    seed("purchaseOrders/a", receivedOrder())
    await expect(closeReceivedPurchaseOrder(db, buyer, "a", { now: NOW })).rejects.toMatchObject({ code: "no_permission" })
    expect(po("a").status).toBe("accepted")
    await closeReceivedPurchaseOrder(db, owner, "a", { now: NOW })
    expect(inbox("buyer").map((n) => n.type)).toContain("po_closed")
  })

  it("only a fully received order: a part-received one is closed short with a reason, as before", async () => {
    financeOff()
    seed("purchaseOrders/a", order({ lines: [line({ accepted: 4 })] }))
    await expect(closeReceivedPurchaseOrder(db, owner, "a", { now: NOW })).rejects.toMatchObject({ code: "wrong_state" })
    expect(po("a").status).toBe("accepted")
  })

  it("with Finance in the package the payment closes it — never this button", async () => {
    seed("purchaseOrders/a", receivedOrder())
    await expect(closeReceivedPurchaseOrder(db, owner, "a", { now: NOW })).rejects.toMatchObject({ code: "finance_on" })
    expect(po("a").status).toBe("accepted")
  })
})

describe("F5 · Finance's acts are refused where Finance is not", () => {
  const hold = { invoiceNo: "INV-1", amount: 500, reason: "nopo" as const, text: "بلا أمر", need: "أمر الشراء" }
  const payment = { kind: "part" as const, amount: 1000, valueDate: "2026-10-10", reference: "R-1" }

  it("a payment, a hold and a release are refused inside the transaction when the company has no Finance", async () => {
    financeOff()
    seed("purchaseOrders/a", order({ financeHolds: [{ id: "h1", invoiceNo: "I", amount: 1, reason: "dup", text: "x", need: "", at: "t", byName: "F", state: "open" }] }))
    await expect(recordFinancePayment(db, owner, true, "a", payment, NOW)).rejects.toMatchObject({ code: "finance_off" })
    await expect(holdInvoice(db, owner, true, "a", hold, NOW)).rejects.toMatchObject({ code: "finance_off" })
    await expect(releaseHold(db, owner, true, "a", "h1", NOW)).rejects.toMatchObject({ code: "finance_off" })
    expect(po("a").financeHolds).toHaveLength(1)
    expect(po("a").financePayments).toBeUndefined()
  })

  it("with Finance they work as before", async () => {
    seed("purchaseOrders/a", order())
    await recordFinancePayment(db, owner, true, "a", payment, NOW)
    expect(po("a").financePayments).toHaveLength(1)
  })
})

describe("F8 · «أوقف صرف فاتورة» is a Procurement decision", () => {
  const hold = { invoiceNo: "INV-1", amount: 500, reason: "nopo" as const, text: "بلا أمر", need: "أمر الشراء" }

  it("the owner and the order's approvers hold; so does Finance; a buyer does not", async () => {
    seed("purchaseOrders/a", order())
    await holdInvoice(db, approver, false, "a", hold, NOW)
    await holdInvoice(db, owner, false, "a", { ...hold, invoiceNo: "INV-2" }, NOW)
    await holdInvoice(db, buyer, true, "a", { ...hold, invoiceNo: "INV-3" }, NOW)
    expect(po("a").financeHolds?.map((h) => h.invoiceNo)).toEqual(["INV-1", "INV-2", "INV-3"])
    await expect(holdInvoice(db, buyer, false, "a", hold, NOW)).rejects.toMatchObject({ code: "no_permission" })
  })

  it("releasing it stays Finance's", async () => {
    seed("purchaseOrders/a", order())
    await holdInvoice(db, approver, false, "a", hold, NOW)
    await expect(releaseHold(db, approver, false, "a", "h1", NOW)).rejects.toMatchObject({ code: "no_permission" })
  })
})

describe("F7 · the reminders", () => {
  it("«ذكّر المعتمِد» reaches the approvers (or the owner when it is his), not the one who asks", async () => {
    seed("purchaseOrders/a", order({ status: "awaiting_approval", approvedAt: null }))
    await remindApprovers(db, buyer, "a", { now: NOW })
    expect(inbox("mgr").map((n) => n.type)).toContain("po_awaiting_approval")
    expect(inbox("buyer")).toHaveLength(0)
    seed("purchaseOrders/b", order({ status: "awaiting_approval", approvedAt: null, approverKind: "owner" }))
    await remindApprovers(db, buyer, "b", { now: NOW })
    expect(inbox(ORG).map((n) => n.type)).toContain("po_awaiting_approval")
  })

  it("an order no longer waiting cannot be reminded about", async () => {
    seed("purchaseOrders/a", order())
    await expect(remindApprovers(db, buyer, "a", { now: NOW })).rejects.toMatchObject({ code: "wrong_state" })
  })

  it("«ذكّر المالية» about an unpaid advance reaches Finance once a day, and only where Finance is", async () => {
    seed("purchaseOrders/a", order({ advancePercent: 30 }))
    await remindFinanceAboutAdvance(db, buyer, "a", { now: NOW })
    expect(inbox("fin").map((n) => n.type)).toContain("po_advance_reminder")
    expect(po("a").log.at(-1)).toMatchObject({ action: "finance_reminded" })
    await expect(remindFinanceAboutAdvance(db, buyer, "a", { now: new Date(NOW.getTime() + 3600_000) })).rejects.toMatchObject({ code: "reminded_recently" })
    await remindFinanceAboutAdvance(db, buyer, "a", { now: new Date(NOW.getTime() + 25 * 3600_000) })
    expect(po("a").log.filter((e) => (e.action as string) === "finance_reminded")).toHaveLength(2)

    financeOff()
    seed("purchaseOrders/b", order({ advancePercent: 30 }))
    await expect(remindFinanceAboutAdvance(db, buyer, "b", { now: NOW })).rejects.toMatchObject({ code: "finance_off" })
  })

  it("an advance already paid is nothing to remind about", async () => {
    seed("purchaseOrders/a", order({ advancePercent: 30, advancePaidDay: "2026-10-10" }))
    await expect(remindFinanceAboutAdvance(db, buyer, "a", { now: NOW })).rejects.toMatchObject({ code: "wrong_state" })
  })
})
