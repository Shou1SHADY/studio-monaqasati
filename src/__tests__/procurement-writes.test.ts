/**
 * Procurement PRD 3.0 — the purchase order's writes and events: lines built
 * from the award, the number drawn in the same transaction, idempotency,
 * one-step transitions with their log trail, and who hears of each act.
 * Runs against the in-memory Firestore (transactions commit atomically, a
 * refused step writes nothing).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import fs from "fs"
import path from "path"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PROC_EVENT_COPY_AR, PROC_EVENT_KINDS, PROC_EVENT_PARAM_COPY_AR, buildProcNotification, emitProcEvent, procEventMessageKey, procEventTitleKey, renderProcCopy, sarText, toMfgSpecs } from "@/lib/procurement/events"
import { formatProcDocNumber } from "@/lib/procurement/numbering"
import { poStatus } from "@/lib/procurement/po"
import { DEFAULT_POLICIES, type DeliveryLine, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import {
  ProcWriteError,
  applyReceipt,
  applyRejectDecision,
  approvePurchaseOrder,
  buildPoLines,
  buildRating,
  cancelPurchaseOrder,
  cancelRemainder,
  closePurchaseOrder,
  createPurchaseOrderFromAward,
  decideReject,
  draftPurchaseOrder,
  offerLeadTimeDays,
  offerTotalExVat,
  ratePurchaseOrder,
  recordSupplierAcceptance,
  releaseHeld,
  remindSupplier,
  resubmitPurchaseOrder,
  retroactivePurchaseOrder,
  returnPurchaseOrder,
  sendPurchaseOrder,
  supplierAcceptPurchaseOrder,
  supplierOfOffer,
  updatePromisedDate,
  type AwardOfferLike,
  type RfqLike,
} from "@/lib/procurement/writes"
import { resolveRecipients, type TeamSnapshot } from "@/lib/mfg-events"
import { doc, runTransaction } from "firebase/firestore"

const db = fakeFirestore as unknown as Firestore
const ROOT = path.join(__dirname, "..", "..")
const NOW = new Date("2026-09-22T09:00:00Z")

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ORG = "owner-uid"
const actorOf = (over: Partial<ProcActor>): ProcActor => ({
  uid: "buyer",
  name: "Badr",
  isOwner: false,
  canApprove: false,
  canPrepare: true,
  canExpedite: true,
  canReceive: false,
  seesPrices: true,
  ...over,
})
const buyer = actorOf({})
const approver = actorOf({ uid: "fin", name: "Noura", canApprove: true, canPrepare: false })
const owner = actorOf({ uid: ORG, name: "Owner", isOwner: true, canApprove: true, canReceive: true })
const receiver = actorOf({ uid: "gate", name: "Salma", canPrepare: false, canExpedite: false, canReceive: true, seesPrices: false })

const rfq: RfqLike = {
  id: "rfq1",
  title: "حديد تسليح",
  organizationId: ORG,
  contractorId: "buyer",
  projectId: "p1",
  city: "الرياض",
  products: [
    { name: "حديد 12مم", quantity: 10, unitOfMeasure: "طن", boqItemId: "b1" },
    { name: "حديد 16مم", quantity: "5", unitOfMeasure: "طن" },
  ],
  purchaseSource: { kind: "mfg_purchase", workOrderId: "wo1", purchaseRequestId: "pr1" },
}
const offer: AwardOfferLike = { id: "of1", price: "42,000", supplierId: "sup-user", organizationId: "sup-org", companyName: "شركة الحديد", offerPdfUrl: "x.pdf", executionDuration: "2", executionDurationUnit: "أسابيع" }
const cheaper: AwardOfferLike = { id: "of2", price: "39000", supplierId: "u2", organizationId: "o2", companyName: "B" }
const rejected: AwardOfferLike = { id: "of3", price: "10", status: "مرفوض" }

/** The team the events resolve against: users + groups as `loadTeam` reads them. */
function seedTeam() {
  seed(`users/${ORG}`, { organizationId: ORG, name: "Owner" })
  seed("users/buyer", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy" })
  seed("users/fin", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-fin" })
  seed("users/gate", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-gate" })
  seed("users/exp", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-exp" })
  seed("users/sup-user", { organizationId: "sup-org", role: "Supplier" })
  seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept", "rfq.manage"] })
  seed("teamGroups/g-fin", { organizationId: ORG, permissions: ["po.approve", "invoices.manage"] })
  seed("teamGroups/g-gate", { organizationId: ORG, permissions: ["deliveries.confirm"] })
  seed("teamGroups/g-exp", { organizationId: ORG, permissions: ["po.expedite"] })
}

const inbox = (uid: string) => listCollection<{ type: string; title: string; message: string; link: string; organizationId: string; i18n: { params: Record<string, unknown> } }>(`users/${uid}/notifications`)

async function awardedOrder(offers: AwardOfferLike[] = [offer, cheaper, rejected]) {
  seed("offers/of1", { ...offer, status: "مقبول" })
  const r = await createPurchaseOrderFromAward(db, buyer, { rfq, offer, offers, policies: DEFAULT_POLICIES, awardReason: { code: "quality", text: "أفضل جودة" } }, { now: NOW })
  return r
}
const po = (id: string) => readDoc<PurchaseOrder>(`purchaseOrders/${id}`) as PurchaseOrder
const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1]
// The newest notification OF A KIND. `last(inbox(...))` used to stand in for
// this, which quietly tied the assertion to how the fake store sorts document
// ids — and the once-per-order events are now written at an id of their own.
const told = (uid: string, type: string) => last(inbox(uid).filter((n) => n.type === type))

beforeEach(() => {
  resetFakeDb()
  seedTeam()
})

// ─────────────────────────────────────────────────────────────────────────────
// Lines from the award — pure
// ─────────────────────────────────────────────────────────────────────────────

describe("buildPoLines — the RFQ's products become lines", () => {
  it("indexes lines l1… with unit, quantity, BOQ item, and NO unit price on a lump-sum offer", () => {
    const lines = buildPoLines(rfq, offer)
    expect(lines.map((l) => l.id)).toEqual(["l1", "l2"])
    expect(lines[0]).toMatchObject({ name: "حديد 12مم", unit: "طن", quantity: 10, unitPrice: null, accepted: 0, rejected: 0, held: 0, cancelled: 0, boqItemId: "b1", rfqProductIndex: 0 })
    expect(lines[1]).toMatchObject({ quantity: 5, unitPrice: null, boqItemId: null, rfqProductIndex: 1 })
  })

  it("sets unit prices only when the offer priced EVERY line", () => {
    // 10 × 2,800 + 5 × 2,900 = 42,500: rates that add up to the price, or they are stale.
    const priced = buildPoLines(rfq, { ...offer, price: "42,500", lines: [{ rfqProductIndex: 0, unitPrice: 2800 }, { rfqProductIndex: 1, unitPrice: "2900" }] })
    expect(priced.map((l) => l.unitPrice)).toEqual([2800, 2900])
    const half = buildPoLines(rfq, { ...offer, lines: [{ rfqProductIndex: 0, unitPrice: 2800 }] })
    expect(half.map((l) => l.unitPrice)).toEqual([null, null])
  })

  it("an RFQ without products becomes one lot of quantity 1 at the offer's total", () => {
    expect(buildPoLines({ title: "توريد متنوع", products: [] }, { price: "1500" })).toEqual([
      { id: "l1", name: "توريد متنوع", unit: "", quantity: 1, unitPrice: 1500, accepted: 0, rejected: 0, held: 0, cancelled: 0, boqItemId: null, rfqProductIndex: null },
    ])
  })

  it("the total is the offer's price ex-VAT, or the sum of its batches when shipped in parts", () => {
    expect(offerTotalExVat({ price: "42,000" })).toBe(42000)
    expect(offerTotalExVat({ price: "42,000", totalBatchesPrice: 43500 })).toBe(43500)
    expect(offerTotalExVat({ price: null })).toBe(0)
  })

  it("lead time reads the Arabic unit", () => {
    expect(offerLeadTimeDays({ executionDuration: "2", executionDurationUnit: "أسابيع" })).toBe(14)
    expect(offerLeadTimeDays({ executionDuration: 1, executionDurationUnit: "أشهر" })).toBe(30)
    expect(offerLeadTimeDays({ executionDuration: "3", executionDurationUnit: "أيام" })).toBe(3)
    expect(offerLeadTimeDays({})).toBeNull()
  })

  it("a guest offer has no org and no user; a registered one carries both", () => {
    expect(supplierOfOffer({ isGuestOffer: true, guestContact: { name: "أبو خالد" } })).toEqual({ supplierOrgId: "guest", supplierUserId: null, supplierName: "أبو خالد", isGuestSupplier: true })
    expect(supplierOfOffer(offer)).toEqual({ supplierOrgId: "sup-org", supplierUserId: "sup-user", supplierName: "شركة الحديد", isGuestSupplier: false })
  })
})

describe("draftPurchaseOrder — the award's facts", () => {
  it("records competition, the lowest price, the reason, the source and routes by value", () => {
    const d = draftPurchaseOrder(buyer, { rfq, offer, offers: [offer, cheaper, rejected], policies: DEFAULT_POLICIES, awardReason: { code: "quality", text: "أفضل جودة" } }, NOW)
    expect(d).toMatchObject({
      organizationId: ORG,
      status: "awaiting_approval",
      basis: "rfq",
      rfqId: "rfq1",
      offerId: "of1",
      projectId: "p1",
      totalExVat: 42000,
      offersCount: 3,
      lowestOfferTotal: 39000,
      awardReasonCode: "quality",
      awardReasonText: "أفضل جودة",
      shortCompetition: false, // 42,000 is above the threshold, but three offers meet the minimum
      noOfficialQuote: false,
      leadTimeDays: 14,
      deliveryLocation: "الرياض",
      approverKind: "manager",
      preparedById: "buyer",
      purchaseSource: { kind: "mfg_purchase", workOrderId: "wo1", purchaseRequestId: "pr1" },
    })
  })

  it("above the manager's limit the owner approves; a direct award says so", () => {
    const big = draftPurchaseOrder(buyer, { rfq: { ...rfq, directAward: true }, offer: { ...offer, price: "200000" }, offers: [offer], policies: DEFAULT_POLICIES }, NOW)
    expect(big.approverKind).toBe("owner")
    expect(big.basis).toBe("direct")
    expect(big.shortCompetition).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Creation — number, offer stamp, idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("createPurchaseOrderFromAward", () => {
  it("draws PO-yyyy/nnn in the same transaction, stamps the offer, and asks the approvers", async () => {
    const r = await awardedOrder()
    expect(r.created).toBe(true)
    expect(r.docNumber).toBe(formatProcDocNumber("PO", 2026, 1))
    expect(readDoc<{ last: number; type: string }>(`mfgCounters/${ORG}__PO__2026`)).toMatchObject({ last: 1, type: "PO" })
    expect(readDoc<{ poId: string; poNumber: string; status: string }>("offers/of1")).toMatchObject({ poId: r.id, poNumber: "PO-2026/001", status: "مقبول" })
    const stored = po(r.id)
    expect(stored.log).toHaveLength(1)
    expect(stored.log[0]).toMatchObject({ action: "created", byId: "buyer", byName: "Badr", at: NOW.toISOString(), params: { basis: "rfq", number: "PO-2026/001" } })
    // The approver (po.approve) and the owner hear; the preparer does not.
    expect(inbox("fin").map((n) => n.type)).toEqual(["po_awaiting_approval"])
    expect(inbox(ORG).map((n) => n.type)).toEqual(["po_awaiting_approval"])
    expect(inbox("buyer")).toEqual([])
    expect(inbox("gate")).toEqual([])
    const n = inbox("fin")[0]
    // Arabic text shows the Arabic prefix, as every screen does; the stored number stays Latin.
    expect(n.message).toContain("ط.ش-2026/001")
    expect(n.message).toContain("42,000 ر.س")
    expect(n.message).not.toContain("⃁")
    expect(n.link).toBe(`/contractor/rfqs/orders?po=${r.id}`)
  })

  it("is idempotent: an offer that names its order returns it without a second number", async () => {
    const first = await awardedOrder()
    const again = await createPurchaseOrderFromAward(db, buyer, { rfq, offer: { ...offer, poId: first.id, poNumber: first.docNumber }, offers: [offer], policies: DEFAULT_POLICIES })
    expect(again).toEqual({ id: first.id, docNumber: first.docNumber, created: false })
    // …and even when the caller's offer copy is stale, the transaction re-reads it.
    const stale = await createPurchaseOrderFromAward(db, buyer, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES })
    expect(stale).toEqual({ id: first.id, docNumber: first.docNumber, created: false })
    expect(listCollection("purchaseOrders")).toHaveLength(1)
    expect(readDoc<{ last: number }>(`mfgCounters/${ORG}__PO__2026`)?.last).toBe(1)
  })

  it("owner-routed orders ask the owner alone", async () => {
    seed("offers/of1", { ...offer, status: "مقبول" })
    await createPurchaseOrderFromAward(db, buyer, { rfq, offer: { ...offer, price: "160000" }, offers: [offer], policies: DEFAULT_POLICIES })
    expect(inbox(ORG).map((n) => n.type)).toEqual(["po_awaiting_approval"])
    expect(inbox("fin")).toEqual([])
  })

  it("refuses without offers.accept and writes nothing", async () => {
    seed("offers/of1", { ...offer, status: "مقبول" })
    await expect(createPurchaseOrderFromAward(db, receiver, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES })).rejects.toMatchObject({ code: "no_permission" })
    expect(listCollection("purchaseOrders")).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Approval — who, and the log
// ─────────────────────────────────────────────────────────────────────────────

describe("approval", () => {
  it("nobody approves their own order; a manager approves within the limit and tells preparer, Finance and the gate", async () => {
    const { id } = await awardedOrder()
    await expect(approvePurchaseOrder(db, buyer, id, { policies: DEFAULT_POLICIES })).rejects.toMatchObject({ code: "no_permission" })
    await expect(approvePurchaseOrder(db, actorOf({ uid: "buyer", canApprove: true }), id, { policies: DEFAULT_POLICIES })).rejects.toMatchObject({ code: "own_order" })
    expect(po(id).status).toBe("awaiting_approval")

    const out = await approvePurchaseOrder(db, approver, id, { policies: DEFAULT_POLICIES }, { now: NOW })
    expect(out.status).toBe("approved")
    expect(po(id)).toMatchObject({ status: "approved", approvedById: "fin", approvedByName: "Noura", approvedAt: NOW.toISOString() })
    expect(po(id).log.map((l) => l.action)).toEqual(["created", "approved"])
    expect(po(id).log[1].params).toBeNull()
    expect(inbox("buyer").map((n) => n.type)).toEqual(["po_approved"])
    expect(inbox("gate").map((n) => n.type)).toEqual(["po_expected_arrival"])
    // The receiver's message names lines, never money.
    expect(inbox("gate")[0].message).not.toMatch(/ر\.س|SAR/)
    expect(inbox("gate")[0].link).toBe("/contractor/goods-received")
    // Finance holds invoices.manage AND po.approve — one notification, not two, and never the actor's own.
    expect(inbox("fin").filter((n) => n.type === "po_approved")).toHaveLength(0)
  })

  it("the owner may approve their own order — flagged selfApproved in the log", async () => {
    seed("offers/of1", { ...offer, status: "مقبول" })
    const { id } = await createPurchaseOrderFromAward(db, owner, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES })
    await approvePurchaseOrder(db, owner, id, { policies: DEFAULT_POLICIES })
    expect(po(id).log[1]).toMatchObject({ action: "approved", params: { selfApproved: 1 } })
  })

  it("above the limit a manager is refused; a blocking fact refuses everyone but writes nothing", async () => {
    seed("offers/of1", { ...offer, status: "مقبول" })
    const { id } = await createPurchaseOrderFromAward(db, buyer, { rfq, offer: { ...offer, price: "160000" }, offers: [offer], policies: DEFAULT_POLICIES })
    await expect(approvePurchaseOrder(db, approver, id, { policies: DEFAULT_POLICIES })).rejects.toMatchObject({ code: "above_limit" })
    await expect(
      approvePurchaseOrder(db, owner, id, { policies: DEFAULT_POLICIES, blocks: { supplier: { orgId: "sup-org", hasVatNumber: false, verified: true, crExpiry: null }, otherOrders: [] } })
    ).rejects.toMatchObject({ code: "blocked", params: { codes: "supplier_no_vat" } })
    expect(po(id).status).toBe("awaiting_approval")
  })

  it("return needs a reason and keeps the order awaiting; resubmit clears it and asks again", async () => {
    const { id } = await awardedOrder()
    await expect(returnPurchaseOrder(db, approver, id, "  ")).rejects.toMatchObject({ code: "reason_required" })
    await returnPurchaseOrder(db, approver, id, "السعر أعلى من الميزانية")
    expect(po(id)).toMatchObject({ status: "awaiting_approval", returnedReason: "السعر أعلى من الميزانية" })
    expect(inbox("buyer").map((n) => n.type)).toEqual(["po_returned"])
    await expect(resubmitPurchaseOrder(db, approver, id, null)).rejects.toMatchObject({ code: "no_permission" })
    await resubmitPurchaseOrder(db, buyer, id, "خُفّض السعر")
    expect(po(id).returnedReason).toBeNull()
    expect(po(id).log.map((l) => l.action)).toEqual(["created", "returned", "resubmitted"])
    expect(inbox("fin").map((n) => n.type)).toEqual(["po_awaiting_approval", "po_awaiting_approval"])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch, acceptance, date, reminder
// ─────────────────────────────────────────────────────────────────────────────

async function approvedOrder() {
  const { id } = await awardedOrder()
  await approvePurchaseOrder(db, approver, id, { policies: DEFAULT_POLICIES })
  return id
}

describe("dispatch and the supplier's answer", () => {
  it("no dispatch before approval; sending records channel, time and sender and tells the registered supplier", async () => {
    const { id } = await awardedOrder()
    await expect(sendPurchaseOrder(db, buyer, id, "portal")).rejects.toMatchObject({ code: "wrong_state" })
    await approvePurchaseOrder(db, approver, id, { policies: DEFAULT_POLICIES })
    await sendPurchaseOrder(db, buyer, id, "whatsapp", { now: NOW, orgName: "مقاولات النخبة" })
    expect(po(id)).toMatchObject({ status: "sent", sentAt: NOW.toISOString(), sentById: "buyer", sentByName: "Badr", sentChannel: "whatsapp" })
    expect(last(po(id).log)).toMatchObject({ action: "sent", params: { channel: "whatsapp" } })
    const n = inbox("sup-user")
    expect(n.map((x) => x.type)).toEqual(["po_sent"])
    expect(n[0].organizationId).toBe("sup-org")
    expect(n[0].link).toBe(`/supplier/orders?po=${id}`)
    expect(n[0].message).toContain("مقاولات النخبة")
  })

  it("a guest supplier has nobody to notify", async () => {
    seed("offers/of1", { ...offer, status: "مقبول" })
    const { id } = await createPurchaseOrderFromAward(db, buyer, { rfq, offer: { ...offer, isGuestOffer: true, supplierId: "guest" }, offers: [offer], policies: DEFAULT_POLICIES })
    await approvePurchaseOrder(db, approver, id, { policies: DEFAULT_POLICIES })
    await sendPurchaseOrder(db, buyer, id, "email")
    expect(po(id).status).toBe("sent")
    expect(listCollection("users/sup-user/notifications")).toHaveLength(0)
  })

  it("we record the acceptance for him with a valid day; preparer and expediters hear", async () => {
    const id = await approvedOrder()
    await sendPurchaseOrder(db, buyer, id, "portal")
    await expect(recordSupplierAcceptance(db, buyer, id, { promisedDate: "next week", by: "buyer" })).rejects.toMatchObject({ code: "date_invalid" })
    await recordSupplierAcceptance(db, actorOf({ uid: "exp", name: "Expediter", canPrepare: false }), id, { promisedDate: "2026-10-05", by: "buyer" }, { now: NOW })
    expect(po(id)).toMatchObject({ status: "accepted", promisedDate: "2026-10-05", acceptanceRecordedBy: "buyer", supplierAcceptedAt: NOW.toISOString() })
    expect(poStatus(po(id))).toBe("in_delivery")
    expect(inbox("buyer").map((n) => n.type)).toContain("po_supplier_accepted")
    expect(inbox("exp")).toEqual([]) // the actor
  })

  it("the supplier accepts in his portal — sent → accepted, by 'supplier', and only named users are told", async () => {
    const id = await approvedOrder()
    await expect(supplierAcceptPurchaseOrder(db, { uid: "sup-user", name: "أحمد" }, id, "2026-10-05")).rejects.toMatchObject({ code: "wrong_state" })
    await sendPurchaseOrder(db, buyer, id, "portal")
    await supplierAcceptPurchaseOrder(db, { uid: "sup-user", name: "أحمد" }, id, "2026-10-05")
    expect(po(id)).toMatchObject({ status: "accepted", acceptanceRecordedBy: "supplier", promisedDate: "2026-10-05" })
    expect(last(po(id).log)).toMatchObject({ action: "supplier_accepted", byId: "sup-user", params: { date: "2026-10-05", recordedBy: "supplier" } })
    expect(inbox("buyer").map((n) => n.type)).toContain("po_supplier_accepted")
    expect(inbox("exp")).toEqual([]) // no team load from the supplier's side
  })

  it("a new date keeps the old one in the log and tells the gate; a reminder names what is asked", async () => {
    const id = await approvedOrder()
    await sendPurchaseOrder(db, buyer, id, "portal")
    await remindSupplier(db, buyer, id)
    expect(told("sup-user", "po_reminder")).toMatchObject({ i18n: { params: { ask: "@pn_po_reminder_ask_accept" } } })
    expect(told("sup-user", "po_reminder")?.message).toContain(PROC_EVENT_PARAM_COPY_AR.pn_po_reminder_ask_accept)
    await recordSupplierAcceptance(db, buyer, id, { promisedDate: "2026-10-05", by: "buyer" })
    await updatePromisedDate(db, buyer, id, { date: "2026-10-12", note: "تأخر الشحن" })
    expect(po(id).promisedDate).toBe("2026-10-12")
    expect(last(po(id).log)).toMatchObject({ action: "date_updated", note: "تأخر الشحن", params: { from: "2026-10-05", date: "2026-10-12" } })
    expect(inbox("gate").map((n) => n.type)).toContain("po_date_updated")
    await remindSupplier(db, buyer, id)
    expect(told("sup-user", "po_reminder")).toMatchObject({ i18n: { params: { ask: "@pn_po_reminder_ask_deliver" } } })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Receipts, line decisions, close-out
// ─────────────────────────────────────────────────────────────────────────────

async function acceptedOrder() {
  const id = await approvedOrder()
  await sendPurchaseOrder(db, buyer, id, "portal")
  await recordSupplierAcceptance(db, buyer, id, { promisedDate: "2026-10-05", by: "buyer" })
  return id
}

/** The RECEIPTS agent's transaction, reduced to what this helper does inside it. */
async function receive(id: string, lines: DeliveryLine[], deliveryId = "d1") {
  const ref = doc(db, "purchaseOrders", id)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    return applyReceipt(tx, ref, { ...(snap.data() as PurchaseOrder), id }, lines, receiver, { deliveryId, docNumber: "GR-2026/001", at: NOW.toISOString() })
  })
}

describe("applyReceipt inside the receipt's transaction", () => {
  it("moves the counters, logs the receipt, and returns the lines so the caller can close out", async () => {
    const id = await acceptedOrder()
    const lines = await receive(id, [
      { poLineId: "l1", name: "حديد 12مم", unit: "طن", noticeQuantity: 10, counted: 10, rejected: 1, held: 2 },
      { poLineId: "l2", name: "حديد 16مم", unit: "طن", noticeQuantity: 5, counted: 5 },
    ])
    expect(lines[0]).toMatchObject({ accepted: 7, rejected: 1, held: 2 })
    expect(lines[1]).toMatchObject({ accepted: 5 })
    expect(po(id).lines).toEqual(lines)
    expect(last(po(id).log)).toMatchObject({ action: "received", byId: "gate", params: { number: "GR-2026/001", deliveryId: "d1", accepted: 12 } })
    expect(poStatus(po(id))).toBe("part_received")
  })

  it("an arrival on an order the supplier never acknowledged records his acceptance for him", async () => {
    const id = await approvedOrder()
    await sendPurchaseOrder(db, buyer, id, "portal")
    await receive(id, [{ poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 10, counted: 10 }])
    expect(po(id)).toMatchObject({ status: "accepted", acceptanceRecordedBy: "buyer", supplierAcceptedAt: NOW.toISOString(), promisedDate: null })
  })

  it("refuses on an order that was never sent, and the transaction writes nothing", async () => {
    const id = await approvedOrder()
    await expect(receive(id, [{ poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 1, counted: 1 }])).rejects.toBeInstanceOf(ProcWriteError)
    expect(po(id).lines[0].accepted).toBe(0)
  })
})

describe("line decisions", () => {
  it("held goods are released by the gate; cancelling the remainder cancels only what is still to arrive", async () => {
    const id = await acceptedOrder()
    await receive(id, [{ poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 10, counted: 6, held: 2 }])
    await expect(releaseHeld(db, buyer, id, { lineId: "l1", quantity: 2, outcome: "accept" })).rejects.toMatchObject({ code: "no_permission" })
    await releaseHeld(db, receiver, id, { lineId: "l1", quantity: 5, outcome: "accept" }) // capped at what is held
    expect(po(id).lines[0]).toMatchObject({ accepted: 6, held: 0 })
    await cancelRemainder(db, buyer, id, { lineId: "l1", reason: "توقف المصنع" }, { orgName: "النخبة" })
    expect(po(id).lines[0]).toMatchObject({ cancelled: 4, cancelReason: "توقف المصنع" })
    expect(last(po(id).log)).toMatchObject({ action: "remainder_cancelled", params: { line: "حديد 12مم", qty: 4, unit: "طن" } })
    expect(told("sup-user", "po_remainder_cancelled")).toMatchObject({ organizationId: "sup-org" })
    expect(inbox("fin").map((n) => n.type)).toContain("po_remainder_cancelled")
    await expect(cancelRemainder(db, buyer, id, { lineId: "l1", reason: "again" })).rejects.toMatchObject({ code: "nothing_outstanding" })
  })

  it("applyRejectDecision: replace keeps it owed, reduce cancels it, discount keeps the goods", () => {
    const lines = [{ id: "l1", name: "x", unit: "u", quantity: 10, unitPrice: 5, accepted: 7, rejected: 3, held: 0, cancelled: 0 }]
    expect(applyRejectDecision(lines, "l1", "replace", null, "t")[0]).toMatchObject({ accepted: 7, cancelled: 0, rejectDecision: "replace", rejectDecidedAt: "t" })
    expect(applyRejectDecision(lines, "l1", "reduce", "n", "t")[0]).toMatchObject({ accepted: 7, cancelled: 3, rejectDecisionNote: "n" })
    expect(applyRejectDecision(lines, "l1", "discount", null, "t")[0]).toMatchObject({ accepted: 10, rejected: 3, cancelled: 0 })
  })

  it("decideReject needs something rejected and tells the supplier with a translatable decision", async () => {
    const id = await acceptedOrder()
    await expect(decideReject(db, buyer, id, { lineId: "l1", decision: "replace" })).rejects.toMatchObject({ code: "nothing_rejected" })
    await receive(id, [{ poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 10, counted: 10, rejected: 2, rejectReason: "damaged" }])
    await decideReject(db, buyer, id, { lineId: "l1", decision: "reduce", note: "لا حاجة للبديل" })
    expect(po(id).lines[0]).toMatchObject({ rejected: 2, cancelled: 2, rejectDecision: "reduce" })
    const n = told("sup-user", "po_rejects_decided")
    expect(n).toMatchObject({ i18n: { params: { decision: "@pn_po_decision_reduce", qty: 2 } } })
    expect(n?.message).toContain(PROC_EVENT_PARAM_COPY_AR.pn_po_decision_reduce)
  })
})

describe("close-out, cancellation, rating", () => {
  it("a complete order closes as it is; an incomplete one only short, with a reason", async () => {
    const id = await acceptedOrder()
    await expect(closePurchaseOrder(db, buyer, id, {})).rejects.toMatchObject({ code: "reason_required" })
    await closePurchaseOrder(db, buyer, id, { reason: "المورد أفلس" }, { now: NOW })
    expect(po(id)).toMatchObject({ status: "closed", closedShort: true, closeReason: "المورد أفلس", closedAt: NOW.toISOString() })
    // The preparer closed it himself, so Finance is the one told.
    expect(told("fin", "po_closed")).toMatchObject({ i18n: { params: { outcome: "@pn_po_closed_short_flag" } } })
    expect(inbox("buyer").map((n) => n.type)).not.toContain("po_closed")

    const id2 = await acceptedOrder()
    await receive(id2, [
      { poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 10, counted: 10 },
      { poLineId: "l2", name: "y", unit: "طن", noticeQuantity: 5, counted: 5 },
    ])
    expect(poStatus(po(id2))).toBe("received")
    await closePurchaseOrder(db, buyer, id2)
    expect(po(id2)).toMatchObject({ status: "closed", closedShort: false, closeReason: null })
  })

  it("cancelling is refused once goods arrived; before that it tells the supplier only if the order had reached him", async () => {
    const { id } = await awardedOrder()
    await cancelPurchaseOrder(db, buyer, id, "أُلغي المشروع")
    expect(po(id)).toMatchObject({ status: "cancelled", cancelledReason: "أُلغي المشروع" })
    expect(inbox("sup-user")).toEqual([])
    expect(inbox("fin").map((n) => n.type)).not.toContain("po_cancelled")

    const id2 = await acceptedOrder()
    await cancelPurchaseOrder(db, buyer, id2, "تغيّرت المواصفة")
    expect(told("sup-user", "po_cancelled")).toBeDefined()
    expect(inbox("fin").map((n) => n.type)).toContain("po_cancelled")

    const id3 = await acceptedOrder()
    await receive(id3, [{ poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 1, counted: 1 }])
    await expect(cancelPurchaseOrder(db, buyer, id3, "x")).rejects.toMatchObject({ code: "has_receipts" })
    await expect(cancelPurchaseOrder(db, buyer, id2, "x")).rejects.toMatchObject({ code: "already_cancelled" })
  })

  it("buildRating computes the three aspects from receipts and clamps the stars", () => {
    const order = { id: "po1", status: "accepted", lines: [{ id: "l1", name: "x", unit: "u", quantity: 10, unitPrice: null, accepted: 10, rejected: 1, held: 0, cancelled: 0 }], promisedDate: "2026-10-05", log: [] } as unknown as PurchaseOrder
    const receipts = [{ id: "d1", poId: "po1", status: "confirmed" as const, confirmedAt: "2026-10-07T10:00:00Z", lines: [{ poLineId: "l1", name: "x", unit: "u", noticeQuantity: 11, accepted: 10, rejected: 1 }] }]
    const r = buildRating(order, receipts, { conformity: 9, cooperation: 0, publishAnonymously: true, note: " جيد " }, buyer, "t")
    expect(r).toMatchObject({ onTime: false, lateByDays: 2, inFull: true, rejectPercent: 9.09, conformity: 5, cooperation: 1, note: "جيد", publishAnonymously: true, byId: "buyer", at: "t" })
  })

  it("rating needs the whole story; publishing writes an anonymous platform review and the supplier's average", async () => {
    const id = await acceptedOrder()
    await expect(ratePurchaseOrder(db, buyer, id, { conformity: 4, cooperation: 5, publishAnonymously: false, receipts: [] })).rejects.toMatchObject({ code: "cannot_rate" })
    await receive(id, [
      { poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 10, counted: 10 },
      { poLineId: "l2", name: "y", unit: "طن", noticeQuantity: 5, counted: 5 },
    ])
    seed("reviews/old", { revieweeId: "sup-user", rating: 3 })
    const receipts = [{ id: "d1", poId: id, status: "confirmed" as const, confirmedAt: "2026-10-01T10:00:00Z" }]
    await ratePurchaseOrder(db, buyer, id, { conformity: 4, cooperation: 5, publishAnonymously: true, receipts }, { orgName: "النخبة" })
    expect(po(id).rating).toMatchObject({ onTime: true, inFull: true, conformity: 4, cooperation: 5, publishAnonymously: true })
    const reviews = listCollection<{ rating: number; anonymous?: boolean; reviewerName?: string; revieweeId: string; poId?: string }>("reviews")
    expect(reviews.find((r) => r.poId === id)).toMatchObject({ rating: 5, anonymous: true, reviewerName: "", revieweeId: "sup-user" })
    expect(readDoc<{ rating: number; reviewsCount: number }>("users/sup-user")).toMatchObject({ rating: 4, reviewsCount: 2 })
    expect(readDoc<{ contractorRated?: boolean }>("offers/of1")?.contractorRated).toBe(true)
    expect(told("sup-user", "po_rated")).toMatchObject({ i18n: { params: { stars: 5 } } })
    await expect(ratePurchaseOrder(db, buyer, id, { conformity: 1, cooperation: 1, publishAnonymously: false, receipts })).rejects.toMatchObject({ code: "cannot_rate" })
  })

  it("a private rating writes no review and tells nobody", async () => {
    const id = await acceptedOrder()
    await receive(id, [
      { poLineId: "l1", name: "x", unit: "طن", noticeQuantity: 10, counted: 10 },
      { poLineId: "l2", name: "y", unit: "طن", noticeQuantity: 5, counted: 5 },
    ])
    const before = inbox("sup-user").length
    await ratePurchaseOrder(db, buyer, id, { conformity: 2, cooperation: 2, publishAnonymously: false, receipts: [{ id: "d1", poId: id, status: "confirmed" }] })
    expect(listCollection("reviews")).toHaveLength(0)
    expect(inbox("sup-user")).toHaveLength(before)
  })
})

describe("retroactive order", () => {
  it("is born awaiting the owner, with its lines already accepted, and stamps the receipt when the actor may", async () => {
    seed("deliveries/d9", { contractorOrgId: ORG, status: "confirmed", source: "manual" })
    const r = await retroactivePurchaseOrder(db, owner, { organizationId: ORG, rfqTitle: "شراء نقدي", supplierName: "مستودع الحي", lines: [{ name: "أسمنت", unit: "كيس", quantity: 40, unitPrice: 18 }], totalExVat: 720, deliveryId: "d9", reason: "حاجة عاجلة في الموقع" })
    expect(r.deliveryLinked).toBe(true)
    expect(po(r.id)).toMatchObject({ basis: "retroactive", approverKind: "owner", status: "awaiting_approval", isGuestSupplier: true, supplierOrgId: "guest", totalExVat: 720 })
    expect(po(r.id).lines[0]).toMatchObject({ id: "l1", quantity: 40, accepted: 40, unitPrice: 18 })
    expect(readDoc<{ poId: string; poNumber: string }>("deliveries/d9")).toMatchObject({ poId: r.id, poNumber: r.docNumber })
    // A preparer without deliveries.confirm raises the order but leaves the link for later.
    const r2 = await retroactivePurchaseOrder(db, buyer, { organizationId: ORG, rfqTitle: "x", supplierName: "y", lines: [], totalExVat: 0, deliveryId: "d9", reason: "r" })
    expect(r2.deliveryLinked).toBe(false)
    expect(r2.docNumber).toBe("PO-2026/002")
    // Only the owner approves a retroactive order.
    await expect(approvePurchaseOrder(db, approver, r.id, { policies: DEFAULT_POLICIES })).rejects.toMatchObject({ code: "owner_only" })
  })

  it("is approved straight into accepted — nothing to send, nobody to wait for, no arrival to expect", async () => {
    const r = await retroactivePurchaseOrder(db, owner, { organizationId: ORG, rfqTitle: "شراء نقدي", supplierName: "مستودع الحي", lines: [{ name: "أسمنت", unit: "كيس", quantity: 40, unitPrice: 18 }], totalExVat: 720, reason: "حاجة عاجلة" }, { now: NOW })
    const out = await approvePurchaseOrder(db, owner, r.id, { policies: DEFAULT_POLICIES }, { now: NOW })
    expect(out.status).toBe("accepted")
    expect(po(r.id)).toMatchObject({ status: "accepted", approvedById: owner.uid, supplierAcceptedAt: NOW.toISOString(), acceptanceRecordedBy: "buyer" })
    expect(po(r.id).log.map((l) => l.action)).toEqual(["created", "approved"])
    const kinds = listCollection<{ type: string }>(`users/${owner.uid}/notifications`).map((n) => n.type).concat(listCollection<{ type: string }>("users/gate/notifications").map((n) => n.type))
    expect(kinds).not.toContain("po_expected_arrival")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Events — recipients and copy
// ─────────────────────────────────────────────────────────────────────────────

const team: TeamSnapshot = {
  ownerId: ORG,
  members: [
    { id: ORG, organizationRole: "owner" },
    { id: "buyer", defaultGroupId: "g-buy" },
    { id: "fin", defaultGroupId: "g-fin" },
    { id: "gate", defaultGroupId: "g-gate" },
    { id: "exp", defaultGroupId: "g-exp" },
    { id: "admin", defaultGroupId: "g-all" },
  ],
  groups: [
    { id: "g-buy", permissions: ["offers.accept", "rfq.manage"] },
    { id: "g-fin", permissions: ["po.approve", "invoices.manage"] },
    { id: "g-gate", permissions: ["deliveries.confirm"] },
    { id: "g-exp", permissions: ["po.expedite"] },
    { id: "g-all", permissions: ["*"] },
  ],
  departments: [],
}

describe("emitProcEvent — who hears", () => {
  it("resolves roles, users and the owner through the shared resolver, never the actor", () => {
    expect(resolveRecipients(team, toMfgSpecs([{ permission: "po.approve" }], ORG), "buyer").sort()).toEqual(["admin", "fin", ORG])
    expect(resolveRecipients(team, toMfgSpecs([{ owner: true }], ORG), "buyer")).toEqual([ORG])
    expect(resolveRecipients(team, toMfgSpecs([{ owner: true }], ORG), ORG)).toEqual([])
    expect(resolveRecipients(team, toMfgSpecs([{ users: ["buyer", null] }, { permission: "invoices.manage" }], ORG), "fin").sort()).toEqual(["admin", "buyer", ORG])
    expect(resolveRecipients(team, toMfgSpecs([{ permission: "deliveries.confirm" }], ORG), "x").sort()).toEqual(["admin", "gate", ORG])
    expect(resolveRecipients(team, toMfgSpecs([{ permission: "po.expedite" }], ORG), "x").sort()).toEqual(["admin", "exp", ORG])
  })

  it("writes the documented shape: keys in Portal.Shared, rendered text, link, ids, ISO createdAt, read:false", async () => {
    const n = await emitProcEvent(db, { uid: "buyer", name: "Badr" }, { kind: "po_returned", organizationId: ORG, to: [{ users: ["fin"] }], params: { number: "PO-2026/001", reason: "x" }, poId: "po1", rfqId: "r1", offerId: "o1" })
    expect(n).toBe(1)
    const [d] = listCollection<Record<string, unknown>>("users/fin/notifications")
    expect(d).toMatchObject({
      userId: "fin",
      organizationId: ORG,
      type: "po_returned",
      title: "أُعيد أمر الشراء ط.ش-2026/001",
      message: "أعاد Badr أمر الشراء ط.ش-2026/001 دون اعتماد: x. عدّله وأعد رفعه.",
      i18n: { title: "pn_po_returned_title", message: "pn_po_returned", params: { actor: "Badr", number: "PO-2026/001", reason: "x" } },
      link: "/contractor/rfqs/orders?po=po1",
      poId: "po1",
      rfqId: "r1",
      offerId: "o1",
      actorId: "buyer",
      read: false,
    })
    expect(typeof d.createdAt).toBe("string")
    expect(Number.isNaN(Date.parse(d.createdAt as string))).toBe(false)
  })

  it("a resent once-per-order event leaves ONE notification, a resent reminder leaves two", async () => {
    // PRD 3.0 SS5.3: the key is what stops a retry from telling somebody twice.
    // An order is sent once, so the second emit addresses the same document; a
    // reminder is a new act every time and must still arrive.
    const sent: Parameters<typeof emitProcEvent>[2] = { kind: "po_sent", organizationId: ORG, to: [{ users: ["fin"] }], poId: "po1" }
    await emitProcEvent(db, { uid: "buyer", name: "Badr" }, sent)
    await emitProcEvent(db, { uid: "buyer", name: "Badr" }, sent)
    expect(inbox("fin").filter((n) => n.type === "po_sent")).toHaveLength(1)

    const nudge: Parameters<typeof emitProcEvent>[2] = { kind: "po_reminder", organizationId: ORG, to: [{ users: ["fin"] }], poId: "po1" }
    await emitProcEvent(db, { uid: "buyer", name: "Badr" }, nudge)
    await emitProcEvent(db, { uid: "buyer", name: "Badr" }, nudge)
    expect(inbox("fin").filter((n) => n.type === "po_reminder")).toHaveLength(2)
  })

  it("renders from the sender's translator when it has the key, else from the Arabic table", () => {
    const t = ((key: string, params?: Record<string, string | number>) => `${key}:${params?.number}`) as ((key: string, params?: Record<string, string | number>) => string) & { has: (key: string) => boolean }
    t.has = (k: string) => k.startsWith("pn_po_")
    expect(renderProcCopy("po_sent", { number: "PO-1", company: "c" }, t)).toEqual({ title: "pn_po_sent_title:PO-1", message: "pn_po_sent:PO-1" })
    expect(renderProcCopy("po_sent", { number: "PO-1", company: "c" }, null).title).toBe("أمر شراء جديد PO-1")
    expect(buildProcNotification({ kind: "po_sent", organizationId: ORG, to: [], poId: "p", supplier: { userId: "s", orgId: "so" } }, { uid: "a", name: "A" }, "s", "2026-01-01T00:00:00Z")).toMatchObject({ organizationId: "so", link: "/supplier/orders?po=p" })
  })

  it("money in notification text is ر.س / SAR, never the glyph", () => {
    expect(sarText(12500.5)).toBe("12,500.5 ر.س")
    expect(sarText(12500, "en")).toBe("SAR 12,500")
    expect(sarText(null)).toBe("")
    for (const c of Object.values(PROC_EVENT_COPY_AR)) expect(`${c.title}${c.message}`).not.toMatch(/[⃁﷼]/)
  })

  it("every kind has its Arabic copy and its two keys in the WRITES fragment (until merged) or the message files", () => {
    const fragment = path.join("/tmp/claude-1000/-home-shady-studio-monaqasati/35bb147a-114c-4a43-b820-37d160a486a6/scratchpad/i18n")
    const load = (locale: "ar" | "en"): Record<string, string> => {
      const merged = JSON.parse(fs.readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")).Portal.Shared as Record<string, string>
      const frag = path.join(fragment, `WRITES.${locale}.json`)
      return fs.existsSync(frag) ? { ...merged, ...(JSON.parse(fs.readFileSync(frag, "utf8")).Portal.Shared as Record<string, string>) } : merged
    }
    for (const k of PROC_EVENT_KINDS) expect(PROC_EVENT_COPY_AR[k]).toBeDefined()
    for (const locale of ["ar", "en"] as const) {
      const dict = load(locale)
      const missing = [...PROC_EVENT_KINDS.flatMap((k) => [procEventTitleKey(k), procEventMessageKey(k)]), ...Object.keys(PROC_EVENT_PARAM_COPY_AR)].filter((key) => !(key in dict))
      expect({ locale, missing }).toEqual({ locale, missing: [] })
    }
    // The Arabic table IS the Arabic message copy.
    const ar = load("ar")
    for (const k of PROC_EVENT_KINDS) {
      expect(ar[procEventTitleKey(k)]).toBe(PROC_EVENT_COPY_AR[k].title)
      expect(ar[procEventMessageKey(k)]).toBe(PROC_EVENT_COPY_AR[k].message)
    }
  })
})
