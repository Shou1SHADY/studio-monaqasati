/** @jest-environment node */
/**
 * Procurement 2.0 — cancel an order, then re-award (WP-S3-10, WF-25, R-11, G-13): the buyer's choice «أعد ترسيتها من عروض الطلب» returns the
 * RFQ to the comparison WITHOUT the cancelled order's offer (the reason `order_cancelled` in the buyer's decision record), the lines of the
 * orders still alive stay locked, only the bidders who competed for the reopened lines wait for a decision again, and the next award is
 * round R2; «أعِدها إلى الواردة» lets the lines go instead. The supplier's decline keeps the order `sent` and the same re-award follows.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "bkt",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))
jest.mock("@/lib/procurement/incoming-server", () => ({ syncIncoming: jest.fn(async () => ({ created: 0, refreshed: 0, told: 0, migrated: 0 })) }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1), permissionHolders: jest.fn(async () => []) }))

import { POST as award } from "@/app/api/procurement/rfq/award/route"
import { POST as cancel } from "@/app/api/procurement/po/cancel/route"
import { syncIncoming } from "@/lib/procurement/incoming-server"
import { actSchema, runBuyerAct, runSupplierAct, type Act } from "@/lib/supplier-free/server-acts"

const ORG = "org1"
jest.useFakeTimers({ now: new Date("2026-10-22T09:00:00Z"), doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })

const person = (uid: string, name: string, perms: string[] | "all") => ({ uid, orgId: ORG, name, can: perms === "all" ? () => true : (p: string) => perms.includes(p) })
const prod = (name: string, quantity: number) => ({ name, quantity, unitOfMeasure: "م", deliverySiteId: "s1", deliveryCity: "الرياض" })
const offer = (supplier: string, lines: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ({
  rfqId: "r1", contractorOrgId: ORG, supplierId: `u_${supplier}`, organizationId: supplier, companyName: supplier, status: "قيد المراجعة", lines, price: "0",
  vatRegistered: true, vatRate: 0.15, leadDays: 5, validUntil: "2026-11-30", offerPdfUrl: "x.pdf", versions: [{ n: 1 }], rev: 1, ...over,
})

const post = async (route: (r: NextRequest) => Promise<Response>, path: string, user: string, body: unknown) => {
  const res = await route(new NextRequest(`http://localhost/api/procurement/${path}`, { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
  return { status: res.status, json: (await res.json()) as { data?: Record<string, any>; code?: string; reason?: string } }
}
const pick = (li: number, offerId: string) => ({ li, offerId, rev: 1 })
const orders = () => mockDb.list("purchaseOrders") as Array<Record<string, any>>
const orderOf = (offerId: string) => orders().find((o) => o.offerId === offerId) as Record<string, any>

beforeEach(async () => {
  mockDb.docs.clear()
  ;(syncIncoming as jest.Mock).mockClear()
  Object.assign(mockCallers, { [ORG]: person(ORG, "المالك", "all"), buyer: person("buyer", "ريم", ["offers.accept", "po.expedite"]) })
  mockDb.seed("users/org1", { companyName: "المقاول", organizationId: ORG })
  mockDb.seed("rfqs/r1", { organizationId: ORG, contractorId: ORG, createdByUserId: "buyer", rfqNumber: "RFQ-2026/011", title: "طلب", status: "New", deadline: "2026-10-30", pricingMode: "line", products: [prod("حديد", 100), prod("خشب", 100)], allowedSupplierOrgIds: [], log: [] })
  mockDb.seed("offers/oA", offer("supA", [{ rfqProductIndex: 0, unitPrice: 10 }, { rfqProductIndex: 1, unitPrice: 30 }]))
  mockDb.seed("offers/oB", offer("supB", [{ rfqProductIndex: 0, unitPrice: 11 }, { rfqProductIndex: 1, unitPrice: 20 }]))
  mockDb.seed("offers/oC", offer("supC", [{ rfqProductIndex: 0, unitPrice: 12 }, { rfqProductIndex: 1, unitPrice: 40 }]))
  mockDb.seed("offers/oD", offer("supD", [{ rfqProductIndex: 1, unitPrice: 50 }]))
  // A wins the iron, B wins the timber: two orders.
  const res = await post(award, "rfq/award", "buyer", { rfqId: "r1", picks: [pick(0, "oA"), pick(1, "oB")] })
  expect(res.status).toBe(200)
  expect(orders()).toHaveLength(2)
  ;(syncIncoming as jest.Mock).mockClear()
})

describe("«أعد ترسيتها من عروض الطلب»", () => {
  it("returns the RFQ to the comparison without his offer, keeps the other order's line locked, and resets only the bidders who competed for the reopened line", async () => {
    const po = orderOf("oA")
    const res = await post(cancel, "po/cancel", "buyer", { poId: po.id, why: "nacc", then: "reaward" })
    expect(res.status).toBe(200)
    const rfq = mockDb.get("rfqs/r1") as any
    expect(rfq.status).toBe("New")
    expect(rfq.awardReopened).toMatchObject({ poId: po.id, byId: "buyer" })
    expect(rfq.deadline < "2026-10-22").toBe(true)
    expect(rfq.log.map((e: { action: string }) => e.action)).toContain("award_reopened")
    expect(mockDb.get("offerDecisions/oA")).toMatchObject({ exclusion: { code: "order_cancelled", byId: "buyer" } })
    expect((mockDb.get("offers/oC") as any).outcome).toBeNull()
    expect((mockDb.get("offers/oD") as any).outcome).toMatchObject({ k: "lost" })
    expect((mockDb.get(`purchaseOrders/${po.id}`) as any).cancelChoice).toMatchObject({ then: "reaward", resolved: true })
    expect(syncIncoming).toHaveBeenCalled()
  })
  it("the next award chooses among the others for the reopened line only (R2): his offer is out, the live order's line is locked, nothing new is accepted", async () => {
    await post(cancel, "po/cancel", "buyer", { poId: orderOf("oA").id, why: "nacc", then: "reaward" })
    expect((await post(award, "rfq/award", "buyer", { rfqId: "r1", picks: [pick(0, "oA")] })).json.code).toBe("offer_excluded")
    expect((await post(award, "rfq/award", "buyer", { rfqId: "r1", picks: [pick(1, "oC")] })).json.code).toBe("line_locked")
    const next = await post(award, "rfq/award", "buyer", { rfqId: "r1", picks: [pick(0, "oB")], lowComp: { code: "urgent" } })
    expect(next.status).toBe(200)
    expect(next.json.data?.round).toBe(2)
    expect(mockDb.get("rfqs/r1")).toMatchObject({ status: "Awarded", awardRound: 2 })
    expect(orders().filter((o) => o.status !== "cancelled")).toHaveLength(2)
  })
})

describe("«أعِدها إلى الواردة»", () => {
  it("lets the cancelled order's lines go (the RFQ keeps its record) and refreshes the requests", async () => {
    const res = await post(cancel, "po/cancel", "buyer", { poId: orderOf("oB").id, why: "need", then: "back" })
    expect(res.status).toBe(200)
    const rfq = mockDb.get("rfqs/r1") as any
    expect(rfq.status).toBe("Awarded")
    expect(rfq.unawardedLines).toEqual([1])
    expect(mockDb.get("offerDecisions/oB")).toBeUndefined()
    expect(syncIncoming).toHaveBeenCalled()
  })
})

describe("the supplier's decline (DEC) — the order stays sent, the buyer's re-award follows without refusing a split award", () => {
  it("keeps the order «sent» with the decline as a version, and «أعد الترسية» cancels it and reopens the RFQ while the other order lives", async () => {
    const po = orderOf("oA")
    mockDb.seed(`purchaseOrders/${po.id}`, { ...po, status: "sent", sentAt: "2026-10-22T09:00:00Z", approvedAt: "2026-10-22T09:00:00Z", approvedById: "x", supplierUserId: "u_supA", supplierOrgId: "supA", docNumber: po.docNumber })
    const supplier = { uid: "u_supA", name: "سامر", orgId: "supA", company: "supA" }
    await runSupplierAct(mockDb as never, supplier as never, actSchema.parse({ action: "po.decline", poId: po.id, reason: "stock", reasonText: "لا مخزون" }) as Act)
    const declined = mockDb.get(`purchaseOrders/${po.id}`) as any
    expect(declined.status).toBe("sent")
    expect(declined.supplierDecline).toMatchObject({ reason: "stock" })
    expect(declined.versions.at(-1)).toMatchObject({ kind: "decline" })
    await runBuyerAct(mockDb as never, "buyer", actSchema.parse({ action: "award.reopen", poId: po.id }) as Act, new Date())
    expect((mockDb.get(`purchaseOrders/${po.id}`) as any).status).toBe("cancelled")
    expect(mockDb.get("rfqs/r1")).toMatchObject({ status: "New" })
    expect((mockDb.get("offers/oA") as any).status).toBe("اعتذر عن الأمر")
  })
})
