/**
 * Supplier 1.0 DEC — re-award after the supplier declined the order. It runs on the server (`award.reopen`): a buyer
 * who holds only `offers.accept` may not move the RFQ's status in the rules, and the ruleset has no room for a branch.
 */

import { competingOffers, OFFER_ORDER_DECLINED } from "@/lib/procurement/award"
import { actSchema, ActError, runBuyerAct, isBuyerAct, type Act } from "@/lib/supplier-free/server-acts"
import { callerOf } from "@/lib/receipt-links"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1) }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: jest.fn() }))
jest.mock("@/lib/firebaseAdmin", () => ({ getAdminAuth: () => ({}), getAdminFirestore: () => ({}), getAdminStorage: () => ({}), getStorageBucketName: () => "b" }))
jest.mock("@/lib/procurement/incoming-server", () => ({ syncIncoming: jest.fn(async () => ({})) }))

type Doc = Record<string, unknown>
const NOW = new Date("2026-10-15T09:00:00Z")
const declined = { at: "2026-10-14T10:00:00.000Z", reason: "stock", note: "", byId: "sup1", byName: "S" }
const rfq = { organizationId: "buyer", contractorId: "badr", createdByUserId: "badr", title: "بلوك", status: "Awarded", log: [] }
const po = (over: Doc = {}): Doc => ({ organizationId: "buyer", supplierOrgId: "sup1", supplierUserId: "sup1", supplierName: "S", status: "cancelled", supplierDecline: declined, docNumber: "PO-2026/044", rfqId: "r1", offerId: "o1", lines: [], log: [], ...over })

const world = () =>
  new FakeAdminDb()
    .seed("rfqs/r1", rfq)
    .seed("purchaseOrders/p1", po())
    .seed("offers/o1", { rfqId: "r1", supplierId: "sup1", status: "مقبول", price: "300", poId: "p1", awaitingOrderApproval: true })
    .seed("offers/o2", { rfqId: "r1", supplierId: "sup2", status: "قيد المراجعة", price: "320", outcome: { k: "lost", at: "2026-10-12", why: "price" } })
    .seed("offers/o3", { rfqId: "r1", supplierId: "sup3", status: "مرفوض", price: "500", exclusion: { code: "spec" } })

const as = (uid: string, perms: string[], orgId = "buyer") => (callerOf as jest.Mock).mockResolvedValue({ uid, name: uid, orgId, can: (p: string) => perms.includes(p) })
const reopen = (db: FakeAdminDb, poId = "p1") => runBuyerAct(db as never, "x", actSchema.parse({ action: "award.reopen", poId }) as Act, NOW)
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof ActError ? e.code : String(e)))

beforeEach(() => jest.clearAllMocks())

describe("award.reopen (DEC)", () => {
  it("is a buyer's act", () => {
    expect(isBuyerAct(actSchema.parse({ action: "award.reopen", poId: "p1" }) as Act)).toBe(true)
  })

  it("reopens the RFQ, closes the declined quote and puts the losers back to «awaiting a decision» — for a buyer with only offers.accept", async () => {
    as("badr", ["offers.accept"])
    const db = world()
    await reopen(db)
    const r = db.get("rfqs/r1") as { status: string; awardReopened: { poId: string; byId: string }; log: Array<{ action: string }> }
    expect(r.status).toBe("New")
    expect(r.awardReopened).toMatchObject({ poId: "p1", byId: "badr" })
    expect(r.log.map((e) => e.action)).toEqual(["award_reopened"])
    expect(db.get("offers/o1")).toMatchObject({ status: OFFER_ORDER_DECLINED, poId: "p1", declinedOrder: { poId: "p1", reason: "stock" }, awaitingOrderApproval: false })
    expect((db.get("offers/o2") as Doc).outcome).toBeNull()
    expect((db.get("offers/o3") as Doc).status).toBe("مرفوض")
    const all = db.list("offers") as Array<{ id: string; status?: string }>
    expect(competingOffers(all).map((o) => o.id)).toEqual(["o2"])
  })

  it("is no longer refused while another order of the same award runs (WF-25): the RFQ reopens, the live order's lines stay locked", async () => {
    as("badr", ["offers.accept"])
    const db = world().seed("purchaseOrders/p2", po({ status: "approved", supplierDecline: null, offerId: "o4", lines: [{ id: "l2", rfqProductIndex: 1 }] })).seed("offers/o4", { rfqId: "r1", status: "مقبول", price: "100", poId: "p2" })
    expect(await refusal(reopen(db))).toBeNull()
    expect((db.get("rfqs/r1") as Doc).status).toBe("New")
    expect((db.get("purchaseOrders/p2") as Doc).status).toBe("approved")
    expect((db.get("offerDecisions/o1") as Doc).exclusion).toMatchObject({ code: "order_cancelled" })
  })

  it("is refused without the award's permission, on another buyer's RFQ, on an order nobody declined, and across companies", async () => {
    as("badr", [])
    expect(await refusal(reopen(world()))).toBe("no_permission")
    as("other", ["offers.accept"])
    expect(await refusal(reopen(world()))).toBe("not_your_rfq")
    as("mgr", ["offers.accept", "po.approve"])
    expect(await refusal(reopen(world()))).toBeNull()
    as("badr", ["offers.accept"])
    expect(await refusal(reopen(world().seed("purchaseOrders/p1", po({ supplierDecline: null }))))).toBe("not_declined")
    expect(await refusal(reopen(world().seed("rfqs/r1", { ...rfq, status: "New" })))).toBe("rfq_not_awarded")
    as("badr", ["offers.accept"], "elsewhere")
    expect(await refusal(reopen(world()))).toBe("not_found")
  })
})
