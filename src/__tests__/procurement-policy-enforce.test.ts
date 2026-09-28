/**
 * The four operating policies (§6.4) where they change what happens, and the
 * order's boundary acts: Projects' budget / sample gates re-run at approval,
 * the buyer's self-issue under a limit read in the transaction, who acts on
 * an order (R-26), cancel-with-fee and the hold decision telling the others,
 * Projects' stop request, a receipt closing the notice it took, and the reply
 * window of Inventory / the workshop.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/warehouse-transfer", () => ({ receiveDelivery: jest.fn(async () => undefined) }))
jest.mock("@/lib/accounting/hooks", () => ({ onGoodsReceived: jest.fn(() => undefined) }))
jest.mock("@/lib/manufacturing-writes", () => ({ markPurchaseArrived: jest.fn(async () => undefined) }))

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { runTransaction, type Firestore } from "firebase/firestore"
import { DEFAULT_POLICIES, type DeliveryLine, type ProcActor } from "@/lib/procurement/types"
import { resolvePolicies } from "@/lib/procurement/policies"
import { approvalGateBlocks, noticeAudience, noticeTold, receiveRight, replyLapsed, selfReceivedFlag } from "@/lib/procurement/policy-enforce"
import type { PurchaseOrderX } from "@/lib/procurement/po-extras"
import { approvePurchaseOrder, assertActs, cancelRemainder, sendPurchaseOrder } from "@/lib/procurement/writes"
import { cancelRemainderWithFee, decideHold, decidePmBudget, pmStopLine, referBudgetToProjects, requestPmStopInTx, selfIssuePurchaseOrder } from "@/lib/procurement/po-extra-writes"
import { createArrivalWithoutNotice, recordReceipt, trimNotices } from "@/lib/procurement/receipt-writes"
import { recordNeedDecision } from "@/lib/procurement/need-decision-writes"
import { boundaryLog } from "@/lib/procurement/boundary"
import { exceptions, openCommitments } from "@/lib/procurement/reports"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-22T09:00:00Z")
const ORG = "owner-uid"
const MANUAL_SEND = { ...DEFAULT_POLICIES, sendOnApproval: false }

const actorOf = (over: Partial<ProcActor>): ProcActor => ({ uid: "buyer", name: "Badr", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true, ...over })
const buyer = actorOf({})
const approver = actorOf({ uid: "fin", name: "Noura", canApprove: true, canPrepare: false })
const owner = actorOf({ uid: ORG, name: "Owner", isOwner: true, canApprove: true, canReceive: true })
const gate = actorOf({ uid: "gate", name: "Salma", canPrepare: false, canExpedite: false, canReceive: true, seesPrices: false })

function order(over: Partial<PurchaseOrderX> = {}): PurchaseOrderX {
  return {
    id: "po1",
    organizationId: ORG,
    docNumber: "PO-2026/001",
    status: "awaiting_approval",
    basis: "direct",
    rfqId: null,
    rfqTitle: "أسمنت",
    offerId: null,
    projectId: "p1",
    projectName: "برج",
    supplierOrgId: "sup-org",
    supplierUserId: "sup-user",
    supplierName: "مورد",
    isGuestSupplier: false,
    lines: [{ id: "l1", name: "أسمنت", unit: "كيس", quantity: 100, unitPrice: 15, accepted: 0, rejected: 0, held: 0, cancelled: 0, boqItemId: "b1" }],
    totalExVat: 1500,
    vatRate: 0.15,
    offersCount: 1,
    lowestOfferTotal: null,
    shortCompetition: false,
    noOfficialQuote: false,
    preparedById: "buyer",
    preparedByName: "Badr",
    createdAt: "2026-09-01T00:00:00Z",
    approverKind: "manager",
    log: [],
    ...over,
  } as PurchaseOrderX
}

function seedTeam() {
  seed(`users/${ORG}`, { organizationId: ORG, name: "Owner" })
  seed("users/buyer", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy" })
  seed("users/fin", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-fin" })
  seed("users/gate", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-gate" })
  seed("users/store", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-inv" })
  seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept"] })
  seed("teamGroups/g-fin", { organizationId: ORG, permissions: ["po.approve", "invoices.manage"] })
  seed("teamGroups/g-gate", { organizationId: ORG, permissions: ["deliveries.confirm"] })
  seed("teamGroups/g-inv", { organizationId: ORG, permissions: ["warehouses.manage"] })
  seed("projects/p1", { organizationId: ORG, name: "برج" })
}
const seedOrder = (po: PurchaseOrderX) => seed(`purchaseOrders/${po.id}`, { ...po })
const read = (id = "po1") => readDoc<PurchaseOrderX>(`purchaseOrders/${id}`) as PurchaseOrderX
const kinds = (uid: string) => listCollection<{ type: string }>(`users/${uid}/notifications`).map((n) => n.type)

beforeEach(() => {
  resetFakeDb()
  seedTeam()
})

describe("pure: the operating policies", () => {
  it("noticeRouting — `both` means nothing waits to be forwarded; the stamped receivers join the audience once", () => {
    expect(noticeTold({}, resolvePolicies(null))).toBe(false)
    expect(noticeTold({}, { noticeRouting: "both" })).toBe(true)
    expect(noticeTold({ forwardedTo: { name: "x" } }, resolvePolicies(null))).toBe(true)
    expect(noticeAudience(["buyer", "owner"], { noticeCopyTo: ["gate", "buyer", 3] })).toEqual(["buyer", "owner", "gate"])
    expect(noticeAudience(["buyer"], {})).toEqual(["buyer"])
  })
  it("buyerReceives — the gate always; the buyer only under the policy, and flagged", () => {
    expect(receiveRight(gate, null)).toBe("receiver")
    expect(receiveRight(buyer, null)).toBeNull()
    expect(receiveRight(buyer, { buyerReceives: true })).toBe("buyer")
    expect(receiveRight(actorOf({ canPrepare: false }), { buyerReceives: true })).toBeNull()
    expect(selfReceivedFlag(buyer, "buyer", order({ preparedById: "other" }))).toBe(true)
    expect(selfReceivedFlag(gate, "receiver", order())).toBe(false)
    expect(selfReceivedFlag(buyer, "receiver", order())).toBe(true)
  })
  it("replyWindowDays — strictly past the window, from the policy", () => {
    const since = Date.parse("2026-09-20T09:00:00Z")
    expect(replyLapsed(since, NOW, null)).toBe(true)
    expect(replyLapsed(since, NOW, { replyWindowDays: 2 })).toBe(false)
    expect(replyLapsed(since, NOW, { replyWindowDays: 3 })).toBe(false)
    expect(replyLapsed(Date.parse("2026-09-21T08:59:00Z"), NOW, { replyWindowDays: 1 })).toBe(true)
    expect(replyLapsed(null, NOW, null)).toBe(false)
  })
  it("the approval gates — a budget decision ASKED for blocks; an unreferred overrun does not (no dead end)", () => {
    const items = [{ id: "b1", quantity: 10, estCost: 100 }]
    expect(approvalGateBlocks(order(), items, [])).toEqual([])
    expect(approvalGateBlocks(order({ pmBudget: { state: "pending", over: 500 } }), items, []).map((b) => b.code)).toEqual(["pm_budget_pending"])
    expect(approvalGateBlocks(order({ pmBudget: { state: "renegotiate" } }), items, []).map((b) => b.code)).toEqual(["pm_budget_pending"])
    expect(approvalGateBlocks(order({ pmBudget: { state: "accepted" } }), items, [])).toEqual([])
    expect(approvalGateBlocks(order(), [{ id: "b1", pmSample: true, pmSub: "sub", description: "بلاط" }], []).map((b) => b.code)).toEqual(["sample_pending"])
  })
  it("the stop request finds the owed line by BOQ item, else by name and unit", () => {
    const po = order({ status: "accepted" })
    expect(pmStopLine(po, { name: "x", unit: "y", boqItemId: "b1" })?.id).toBe("l1")
    expect(pmStopLine(po, { name: " أسمنت ", unit: "كيس" })?.id).toBe("l1")
    expect(pmStopLine(order({ status: "accepted", lines: [{ ...po.lines[0], accepted: 100 }] }), { name: "أسمنت", unit: "كيس" })).toBeNull()
  })
  it("a receipt without the notice trims what the notice announced, oldest first; a notice with nothing left closes", () => {
    const n = (q: number): DeliveryLine => ({ poLineId: "l1", name: "أسمنت", unit: "كيس", noticeQuantity: q })
    const out = trimNotices([{ lines: [n(40)] }, { lines: [n(60)] }], [{ ...n(0), counted: 70 }])
    expect(out[0]).toMatchObject({ closed: true, changed: true })
    expect(out[1].lines[0].noticeQuantity).toBe(30)
    expect(out[1].closed).toBe(false)
  })
})

describe("approval re-checks Projects' gates in the write (R-25)", () => {
  it("refuses while the budget decision is pending, approves once accepted", async () => {
    seedOrder(order({ pmBudget: { state: "pending", over: 500 } }))
    await expect(approvePurchaseOrder(db, approver, "po1", { policies: MANUAL_SEND })).rejects.toMatchObject({ code: "pm_budget_pending" })
    seed("purchaseOrders/po1", { ...read(), pmBudget: { state: "accepted" } })
    await expect(approvePurchaseOrder(db, approver, "po1", { policies: MANUAL_SEND })).resolves.toMatchObject({ status: "approved" })
  })
  it("an overrun nobody referred does not dead-end the approval", async () => {
    seed("projects/p1/boqItems/b1", { quantity: 1, estCost: 10 })
    seedOrder(order())
    await expect(approvePurchaseOrder(db, approver, "po1", { policies: MANUAL_SEND })).resolves.toMatchObject({ status: "approved" })
  })
  it("refuses a line whose sample is not approved — read from the BOQ inside the transaction", async () => {
    seed("projects/p1/boqItems/b1", { pmSample: true, pmSub: "sub", description: "بلاط" })
    seedOrder(order())
    await expect(approvePurchaseOrder(db, approver, "po1", { policies: MANUAL_SEND })).rejects.toMatchObject({ code: "sample_pending" })
  })
  it("with notices routed to both, the receivers are stamped on the order", async () => {
    seedOrder(order())
    await approvePurchaseOrder(db, approver, "po1", { policies: { ...MANUAL_SEND, noticeRouting: "both" } as typeof MANUAL_SEND })
    expect(read().noticeCopyTo).toContain("gate")
  })
})

describe("the budget referral (Procurement) and decision (Projects)", () => {
  it("refers an overrun, waits, and the PM's acceptance releases it", async () => {
    seedOrder(order())
    await referBudgetToProjects(db, buyer, "po1", { items: [{ id: "b1", quantity: 10, estCost: 100 }], otherOrders: [] })
    expect(read().pmBudget).toMatchObject({ state: "pending", over: 500 })
    expect(kinds(ORG)).toContain("po_budget_referred")
    await expect(referBudgetToProjects(db, buyer, "po1", { items: [{ id: "b1", quantity: 10, estCost: 100 }], otherOrders: [] })).rejects.toMatchObject({ code: "nothing_to_refer" })
    await expect(decidePmBudget(db, { uid: "pm", name: "PM" }, "po1", { decision: "renegotiate" })).rejects.toMatchObject({ code: "reason_required" })
    await decidePmBudget(db, { uid: "pm", name: "PM" }, "po1", { decision: "accepted" })
    expect(read().pmBudget?.state).toBe("accepted")
    expect(kinds("buyer")).toContain("po_budget_decided")
  })
})

describe("the buyer's self-issue (R-32)", () => {
  it("reads the limit from the org's policies in the transaction, not the screen", async () => {
    seed(`procurementSettings/${ORG}`, { buyerSelfIssueLimit: 1000 })
    seedOrder(order())
    await expect(selfIssuePurchaseOrder(db, buyer, "po1", {}, { now: NOW })).rejects.toMatchObject({ code: "above_limit" })
  })
  it("issues a direct order under the limit and tells Finance and the receivers", async () => {
    seedOrder(order())
    const out = await selfIssuePurchaseOrder(db, buyer, "po1", {}, { now: NOW })
    expect(out).toMatchObject({ status: "sent", selfIssued: true })
    expect(kinds("fin")).toContain("po_approved")
    expect(kinds("gate")).toContain("po_expected_arrival")
  })
  it("never on an RFQ award", async () => {
    seedOrder(order({ basis: "rfq" }))
    await expect(selfIssuePurchaseOrder(db, buyer, "po1", {}, { now: NOW })).rejects.toMatchObject({ code: "wrong_state" })
  })
})

describe("who acts on an order (R-26)", () => {
  it("the owner reads somebody else's order; a buyer acts on his own only", async () => {
    expect(() => assertActs({ preparedById: "buyer" }, owner)).toThrow("owner_read_only")
    expect(() => assertActs({ preparedById: "other" }, buyer)).toThrow("not_your_order")
    expect(() => assertActs({ preparedById: "other" }, approver)).not.toThrow()
    seedOrder(order({ status: "approved" }))
    await expect(sendPurchaseOrder(db, owner, "po1", "whatsapp")).rejects.toMatchObject({ code: "owner_read_only" })
    await expect(sendPurchaseOrder(db, actorOf({ uid: "b2" }), "po1", "whatsapp")).rejects.toMatchObject({ code: "not_your_order" })
    await expect(sendPurchaseOrder(db, buyer, "po1", "whatsapp")).resolves.toMatchObject({ status: "sent" })
  })
  it("the approver's own approval still sends it on the portal, whoever prepared it", async () => {
    seedOrder(order())
    await expect(approvePurchaseOrder(db, owner, "po1", { policies: DEFAULT_POLICIES })).resolves.toMatchObject({ status: "sent" })
  })
})

describe("cancelling a remainder and deciding a hold tell the others", () => {
  it("cancel-with-fee reaches the supplier, Finance and Inventory — once per line, not once per order", async () => {
    seedOrder(order({ status: "accepted", lines: [order().lines[0], { ...order().lines[0], id: "l2", name: "رمل" }] }))
    await cancelRemainderWithFee(db, buyer, "po1", { lineId: "l1", reason: "أغلق البند", fee: 50 })
    await cancelRemainderWithFee(db, buyer, "po1", { lineId: "l2", reason: "أغلق البند" })
    expect(kinds("sup-user").filter((k) => k === "po_remainder_cancelled")).toHaveLength(2)
    expect(kinds("fin")).toContain("po_remainder_cancelled")
    expect(kinds("store")).toContain("po_remainder_cancelled")
    await expect(cancelRemainder(db, owner, "po1", { lineId: "l1", reason: "x" })).rejects.toMatchObject({ code: "owner_read_only" })
  })
  it("the hold decision is logged on the order and sent to Finance", async () => {
    seedOrder(order({ status: "accepted", approvedAt: "2026-09-02T00:00:00Z", financeHolds: [{ id: "h1", invoiceNo: "INV-9", amount: 100, reason: "price", text: "t", need: "n", at: "2026-09-10T00:00:00Z", byName: "F", state: "open" }] }))
    await decideHold(db, buyer, "po1", { holdId: "h1", decision: "new_price", note: "اتفقنا" })
    const po = read()
    expect(po.financeHolds?.[0]).toMatchObject({ state: "decided", decision: "new_price" })
    expect(po.log.at(-1)).toMatchObject({ action: "hold_decided" })
    expect(kinds("fin")).toContain("po_hold_decided")
    expect(exceptions({ orders: [po], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {} } as never).map((e) => e.kind)).toContain("variance_accepted")
  })
})

describe("Projects' stop request lands on the order (P-19)", () => {
  it("writes pmCancels on the owed line in the caller's transaction", async () => {
    seedOrder(order({ status: "accepted" }))
    const lineId = await runTransaction(db, (tx) => requestPmStopInTx(tx, db, "po1", { name: "أسمنت", unit: "كيس" }, { reason: "أُغلق البند", byName: "PM", at: NOW.toISOString(), projectId: "p1", requestId: "r1" }))
    expect(lineId).toBe("l1")
    expect(read()).toMatchObject({ pmCancelKey: "l1", pmCancels: { l1: { reason: "أُغلق البند", requestId: "r1" } } })
    expect(boundaryLog([read()], []).map((e) => e.kind)).toContain("pm_stop")
  })
})

describe("receipts under the policies", () => {
  const counted = (q: number): DeliveryLine => ({ poLineId: "l1", name: "أسمنت", unit: "كيس", noticeQuantity: 0, counted: q, rejected: 0, held: 0 })
  it("a buyer records a receipt only under buyerReceives, and it is flagged", async () => {
    seedOrder(order({ status: "accepted", preparedById: "other" }))
    seed("deliveries/d1", { status: "pending_confirmation", contractorOrgId: ORG, poId: "po1", lines: [{ ...counted(0), noticeQuantity: 100 }] })
    const input = { delivery: { id: "d1", contractorOrgId: ORG, poId: "po1" }, po: read(), lines: [counted(100)], receiverName: "Badr", landedWarehouseId: "w1" }
    await expect(recordReceipt(db, buyer, { ...input, policies: DEFAULT_POLICIES })).rejects.toMatchObject({ code: "no_permission" })
    await recordReceipt(db, buyer, { ...input, policies: { ...DEFAULT_POLICIES, buyerReceives: true } as typeof DEFAULT_POLICIES })
    expect(readDoc<{ selfReceived: boolean; status: string }>("deliveries/d1")).toMatchObject({ status: "confirmed", selfReceived: true })
  })
  it("an arrival recorded without the notice closes the notice it took, and a manual one tells Finance", async () => {
    seedOrder(order({ status: "accepted" }))
    seed("deliveries/n1", { status: "pending_confirmation", contractorOrgId: ORG, poId: "po1", lines: [{ ...counted(0), noticeQuantity: 100 }] })
    await createArrivalWithoutNotice(db, buyer, { po: read(), lines: [counted(100)], receiverName: "Badr", policies: DEFAULT_POLICIES, manual: true, landedWarehouseId: "w1" })
    expect(readDoc<{ closedByReceipt: unknown }>("deliveries/n1")?.closedByReceipt).toBeTruthy()
    expect(kinds("fin")).toContain("receipt_manual")
  })
})

describe("the reply window of Inventory (P-33)", () => {
  it("proceeding waits the policy's days, read from the org's settings", async () => {
    seed(`procurementSettings/${ORG}`, { replyWindowDays: 3 })
    seed("projects/p1/purchaseRequests/r1", { status: "pending", createdAt: "2026-09-20T09:00:00Z", items: [] })
    await expect(recordNeedDecision(db, buyer, { projectId: "p1", requestId: "r1", kind: "proceed_full" }, { now: NOW })).rejects.toMatchObject({ code: "need_not_waiting" })
    await recordNeedDecision(db, buyer, { projectId: "p1", requestId: "r1", kind: "proceed_full" }, { now: new Date("2026-09-23T10:00:00Z") })
    expect(readDoc<{ procDecision: { kind: string } }>("projects/p1/purchaseRequests/r1")?.procDecision.kind).toBe("proceed_full")
  })
})

describe("open commitments read the advance Finance paid (R-24)", () => {
  it("an advance is due until Finance records it paid; invoice payments come off received", () => {
    const base = order({ status: "accepted", approvedAt: "2026-09-02T00:00:00Z", advancePercent: 20, promisedDate: "2026-10-01" })
    const w = (po: PurchaseOrderX) => ({ orders: [po], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {} }) as never
    expect(openCommitments(w(base), NOW).totals.advance).toBe(300)
    const paid = { ...base, financePayments: [{ no: "PAY-1", kind: "adv" as const, amount: 300, valueDate: "2026-09-05", reference: "r", byName: "F", at: "2026-09-05T00:00:00Z" }] }
    expect(openCommitments(w(paid), NOW).totals.advance).toBe(0)
  })
})

