/** @jest-environment node */
/**
 * Procurement 2.0 — the award as a SERVER route (WP-S3-07): WF-12 (split award), WF-13 (award before the deadline closes the request and
 * tells everyone), G-04/R-15 (a reason the numbers back), G-05/R-13 (one order per supplier × site), G-14/R-14/R-19 (a changed, excluded or
 * expired offer is refused 409/422), G-16/R-07/R-08/R-36 (the approval class, thin competition tags and never blocks), CMP-12/R-17 (a lump
 * sum is awarded whole), R-18 (not VAT-registered: no VAT on the order), R-20 (pieces). Over the fake Admin Firestore, one transaction.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => (t === "bad" ? Promise.reject(new Error("bad")) : { uid: t }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "bkt",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))
jest.mock("@/lib/procurement/incoming-server", () => ({ syncIncoming: jest.fn(async () => ({ created: 0, refreshed: 0, told: 0, migrated: 0 })) }))

import { POST as award } from "@/app/api/procurement/rfq/award/route"
import { syncIncoming } from "@/lib/procurement/incoming-server"

const ORG = "org1"
const NOW = new Date("2026-10-22T09:00:00Z")
jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })

const can = (...ps: string[]) => (p: string) => ps.includes(p)
const person = (uid: string, orgId: string, name: string, perms: string[] | "all") => ({ uid, orgId, name, can: perms === "all" ? () => true : can(...perms) })

const prod = (name: string, quantity: number, over: Record<string, unknown> = {}) => ({ name, quantity, unitOfMeasure: "م", deliverySiteId: "s1", deliveryCity: "الرياض", needBy: "2026-11-05", ...over })
const rfq = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  contractorId: ORG,
  createdByUserId: "buyer",
  rfqNumber: "RFQ-2026/011",
  title: "حديد وخشب",
  status: "New",
  deadline: "2026-10-30",
  pricingMode: "line",
  products: [prod("زوايا حديد 50×50×5 مم", 175, { saleUnits: [{ ar: "قطعة 6 م", lengthM: 6 }, { ar: "قطعة 12 م", lengthM: 12 }] }), prod("خشب ألواح", 320, { saleUnits: [{ ar: "لوح 4 م", lengthM: 4 }] })],
  allowedSupplierOrgIds: ["supA", "supS", "supM", "supAmal", "supH", "supQuiet"],
  paymentTermsList: null,
  log: [],
  ...over,
})
const offer = (id: string, supplier: string, lines: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ({
  rfqId: "r1",
  contractorOrgId: ORG,
  supplierId: `u_${supplier}`,
  organizationId: supplier,
  companyName: `مورد ${supplier}`,
  status: "قيد المراجعة",
  lines,
  price: "0",
  vatRegistered: true,
  vatRate: 0.15,
  leadDays: 5,
  validUntil: "2026-11-30",
  offerPdfUrl: `https://f/${id}.pdf`,
  versions: [{ n: 1 }],
  rev: 1,
  ...over,
})

function seedWorld(db: FakeAdminDb, rfqOver: Record<string, unknown> = {}) {
  db.seed("users/org1", { companyName: "المقاول", organizationId: ORG })
  db.seed("rfqs/r1", rfq(rfqOver))
  db.seed("offers/oA", offer("oA", "supA", [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6 }], { leadDays: 5 }))
  db.seed("offers/oS", offer("oS", "supS", [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12 }, { rfqProductIndex: 1, unitPrice: 3.7 }], { leadDays: 7 }))
  db.seed("offers/oM", offer("oM", "supM", [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6 }, { rfqProductIndex: 1, unitPrice: 3.7 }], { leadDays: 3 }))
  db.seed("offers/oAmal", offer("oAmal", "supAmal", [{ rfqProductIndex: 0, unitPrice: 80, packLen: 6 }, { rfqProductIndex: 1, unitPrice: 13.5, packLen: 4 }], { vatRegistered: false, vatRate: 0, leadDays: 6, offerPdfUrl: null }))
  db.seed("offers/oH", offer("oH", "supH", [{ rfqProductIndex: 1, unitPrice: 14.2, packLen: 4 }], { skippedItems: [0] }))
}

const req = (user: string, body: unknown) => new NextRequest("http://localhost/api/procurement/rfq/award", { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) })
const run = async (user: string, body: Record<string, unknown>) => {
  const res = await award(req(user, { rfqId: "r1", ...body }))
  return { status: res.status, json: (await res.json()) as { success?: boolean; data?: Record<string, any>; code?: string; error?: boolean } }
}
const pick = (li: number, offerId: string, rev = 1) => ({ li, offerId, rev })
const orders = () => mockDb.list("purchaseOrders") as Array<Record<string, any>>
const notes = (uid: string) => mockDb.list(`users/${uid}/notifications`) as Array<Record<string, any>>

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  ;(syncIncoming as jest.Mock).mockClear()
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, ORG, "المالك", "all"),
    buyer: person("buyer", ORG, "ريم", ["offers.accept", "po.expedite"]),
    mgr: person("mgr", ORG, "منى", ["offers.accept", "po.approve", "po.expedite"]),
    nobody: person("nobody", ORG, "سعد", ["offers.view"]),
    stranger: person("stranger", "org2", "غريب", "all"),
  })
  seedWorld(mockDb)
})

describe("the split award — WF-12 / G-05 / R-18 / R-20", () => {
  it("makes one order per supplier × site, from the stored versions: pieces counted, VAT off for the unregistered, totals in riyals", async () => {
    const res = await run("buyer", { picks: [pick(0, "oA"), pick(1, "oAmal")] })
    expect(res.status).toBe(200)
    expect(res.json.data?.orders).toHaveLength(2)
    const byOffer = Object.fromEntries(orders().map((o) => [o.offerId, o]))
    expect(byOffer.oA).toMatchObject({ basis: "rfq", rfqId: "r1", supplierOrgId: "supA", vatRate: 0.15, totalExVat: 2187.5, siteKey: "supA|s1", offerRev: 1 })
    expect(byOffer.oA.lines[0]).toMatchObject({ id: "l1", quantity: 175, unitPrice: 12.5, rfqProductIndex: 0 })
    expect(byOffer.oAmal).toMatchObject({ vatRate: 0, noVat: true, totalExVat: 1080 })
    expect(byOffer.oAmal.lines[0]).toMatchObject({ id: "l2", quantity: 80, unitPrice: 13.5, pk: 4, need: 320, base: "م", rfqProductIndex: 1 })
    expect(byOffer.oAmal.docNumber).toMatch(/^PO-2026\/00[12]$/)
  })
  it("two delivery sites of one supplier are two orders (G-05), and the lines of one order are only its site's", async () => {
    mockDb.seed("rfqs/r1", rfq({ products: [prod("حديد", 10, { deliverySiteId: "s1" }), prod("خشب", 20, { deliverySiteId: "s2" })] }))
    for (const gone of ["oS", "oM", "oAmal", "oH"]) mockDb.docs.delete(`offers/${gone}`)
    mockDb.seed("offers/oA", offer("oA", "supA", [{ rfqProductIndex: 0, unitPrice: 10 }, { rfqProductIndex: 1, unitPrice: 5 }]))
    const res = await run("buyer", { picks: [pick(0, "oA"), pick(1, "oA")] })
    expect(res.status).toBe(200)
    expect(orders()).toHaveLength(2)
    expect(orders().map((o) => o.lines.map((l: { rfqProductIndex: number }) => l.rfqProductIndex)).sort()).toEqual([[0], [1]])
    expect(new Set(orders().map((o) => o.siteKey)).size).toBe(2)
    expect((mockDb.get("offers/oA") as any).awardedLines).toEqual([0, 1])
  })
  it("marks the winners مقبول with their result, tells every other bidder, and writes the RFQ's award", async () => {
    await run("buyer", { picks: [pick(0, "oA"), pick(1, "oAmal")], lossReason: "price" })
    expect(mockDb.get("offers/oA")).toMatchObject({ status: "مقبول", awardedLines: [0], outcome: { k: "won", round: 1 } })
    expect(mockDb.get("offers/oS")).toMatchObject({ outcome: { k: "lost", why: "price", round: 1 } })
    expect(notes("supS")[0]).toMatchObject({ type: "rfq_outcome" })
    expect(notes("u_supA")[0].message).toContain("أمر الشراء")
    expect(mockDb.get("rfqs/r1")).toMatchObject({ status: "Awarded", awardRound: 1, awardSplit: true, unawardedLines: [] })
    expect(syncIncoming).toHaveBeenCalled()
  })
  it("returns the lines nobody won to the RFQ's unawarded list (they go back to «الواردة»)", async () => {
    const res = await run("buyer", { picks: [pick(0, "oA")] })
    expect(res.json.data?.unawarded).toEqual([1])
    expect(mockDb.get("rfqs/r1")).toMatchObject({ unawardedLines: [1] })
  })
})

describe("WF-13 — an award before the deadline closes the request in the same transaction", () => {
  it("moves the deadline back, records «أُغلق مبكراً» with the date and tells the invitees who never bid", async () => {
    const res = await run("buyer", { picks: [pick(0, "oA"), pick(1, "oAmal")] })
    expect(res.json.data?.closedEarly).toBe(true)
    const r = mockDb.get("rfqs/r1") as any
    expect(r.closedEarly).toMatchObject({ byId: "buyer", originalDeadline: "2026-10-30", reason: "award" })
    expect(r.deadline).toBe("2026-10-21")
    expect(r.log.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(["closed_early", "awarded"]))
    expect(notes("supQuiet")[0]).toMatchObject({ type: "rfq_outcome", i18n: { message: "pn_rfq_closed_early" } })
    expect(notes("supA").filter((n) => n.type === "rfq_outcome")).toHaveLength(1)
  })
  it("a request already past its deadline is not 'closed early'", async () => {
    mockDb.seed("rfqs/r1", rfq({ deadline: "2026-10-20" }))
    const res = await run("buyer", { picks: [pick(0, "oA")] })
    expect(res.json.data?.closedEarly).toBe(false)
    expect(notes("supQuiet")).toHaveLength(0)
  })
  it("an award on a request that is not open is refused 409, and nothing is written", async () => {
    mockDb.seed("rfqs/r1", rfq({ status: "Awarded" }))
    mockDb.writes.length = 0
    const res = await run("buyer", { picks: [pick(0, "oA")] })
    expect(res.status).toBe(409)
    expect(res.json.code).toBe("rfq_not_open")
    expect(mockDb.writes).toHaveLength(0)
  })
})

describe("G-14 — the pick is pinned to the offer version", () => {
  it("an offer edited since the pick (rev 2) is refused 409 offer_changed and nothing is written", async () => {
    mockDb.seed("offers/oA", { ...(mockDb.get("offers/oA") as object), versions: [{ n: 1 }, { n: 2 }], rev: 2 })
    mockDb.writes.length = 0
    const res = await run("buyer", { picks: [pick(0, "oA", 1)] })
    expect(res.status).toBe(409)
    expect(res.json.code).toBe("offer_changed")
    expect(mockDb.writes).toHaveLength(0)
    expect((await run("buyer", { picks: [pick(0, "oA", 2)] })).status).toBe(200)
  })
  it("an offer the buyer excluded meanwhile is refused 409 offer_excluded", async () => {
    mockDb.seed("offerDecisions/oA", { offerId: "oA", exclusion: { code: "spec", text: null, at: "x", byId: "u", byName: "u" }, shortlist: null, log: [] })
    const res = await run("buyer", { picks: [pick(0, "oA")] })
    expect(res.status).toBe(409)
    expect(res.json.code).toBe("offer_excluded")
  })
  it("an expired offer is refused 422 offer_expired (R-19); the last valid day is still valid", async () => {
    mockDb.seed("offers/oA", { ...(mockDb.get("offers/oA") as object), validUntil: "2026-10-21" })
    const res = await run("buyer", { picks: [pick(0, "oA")] })
    expect(res.status).toBe(422)
    expect(res.json.code).toBe("offer_expired")
    mockDb.seed("offers/oA", { ...(mockDb.get("offers/oA") as object), validUntil: "2026-10-22" })
    expect((await run("buyer", { picks: [pick(0, "oA")] })).status).toBe(200)
  })
  it("a line the offer does not price is refused 422, and a line a live order already carries 409", async () => {
    expect((await run("buyer", { picks: [pick(0, "oH")] })).json.code).toBe("line_not_covered")
    mockDb.seed("purchaseOrders/old", { organizationId: ORG, rfqId: "r1", offerId: "oS", status: "approved", docNumber: "PO-2026/009", lines: [{ id: "l1", rfqProductIndex: 0 }] })
    const res = await run("buyer", { picks: [pick(0, "oA")] })
    expect(res.status).toBe(409)
    expect(res.json.code).toBe("line_locked")
  })
})

describe("G-04 / R-15 — not the lowest needs a reason the numbers back", () => {
  it("is refused without a reason (422), with a reason the numbers do not back (422), and with «سبب آخر» with too few words", async () => {
    expect((await run("buyer", { picks: [pick(0, "oM")] })).json.code).toBe("reason_required")
    expect((await run("buyer", { picks: [pick(0, "oM")], why: { code: "warranty" } })).json.code).toBe("reason_untrue")
    expect((await run("buyer", { picks: [pick(0, "oM")], why: { code: "other", text: "نعم" } })).json.code).toBe("reason_text_short")
    expect(orders()).toHaveLength(0)
  })
  it("a faster supplier is a reason the numbers back; the order carries it as a tag and in the log of the RFQ", async () => {
    const res = await run("buyer", { picks: [pick(0, "oM")], why: { code: "fastest" } })
    expect(res.status).toBe(200)
    expect(orders()[0]).toMatchObject({ tags: { notLowest: { why: "أسرع توريداً" } }, awardWhy: { code: "fastest" } })
  })
  it("a tie within 0.5 % is ALSO the lowest: no reason is needed (R-31)", async () => {
    expect((await run("buyer", { picks: [pick(0, "oS")] })).status).toBe(200)
  })
})

describe("G-18 / R-08 — thin competition above 20,000 needs a reason and a tag, and never blocks", () => {
  beforeEach(() => {
    mockDb.seed("rfqs/r1", rfq({ products: [prod("حديد", 100)] }))
    mockDb.seed("offers/oA", offer("oA", "supA", [{ rfqProductIndex: 0, unitPrice: 300 }]))
    mockDb.seed("offers/oS", offer("oS", "supS", [{ rfqProductIndex: 0, unitPrice: 320 }]))
    mockDb.docs.delete("offers/oM")
    mockDb.docs.delete("offers/oAmal")
    mockDb.docs.delete("offers/oH")
  })
  it("two offers on a 30,000 award: a reason is asked (422); with one the award goes through and the order is tagged", async () => {
    expect((await run("buyer", { picks: [pick(0, "oA")] })).json.code).toBe("lowcomp_reason_required")
    const res = await run("buyer", { picks: [pick(0, "oA")], lowComp: { code: "urgent" } })
    expect(res.status).toBe(200)
    expect(orders()[0]).toMatchObject({ shortCompetition: true, tags: { lowComp: { n: 2, why: "عاجل لا يحتمل الانتظار" } }, lowComp: { n: 2, threshold: 3 } })
  })
  it("under the threshold nothing is asked", async () => {
    mockDb.seed("offers/oA", offer("oA", "supA", [{ rfqProductIndex: 0, unitPrice: 100 }]))
    mockDb.seed("offers/oS", offer("oS", "supS", [{ rfqProductIndex: 0, unitPrice: 120 }]))
    expect((await run("buyer", { picks: [pick(0, "oA")] })).status).toBe(200)
  })
})

describe("CMP-12 / R-17 — a lump sum is awarded whole, as one value", () => {
  beforeEach(() => {
    mockDb.seed("rfqs/r1", rfq({ pricingMode: "total" }))
    mockDb.seed("offers/oA", offer("oA", "supA", [], { price: "5000", lump: 5000 }))
    mockDb.seed("offers/oS", offer("oS", "supS", [], { price: "5200", lump: 5200 }))
    mockDb.docs.delete("offers/oM")
    mockDb.docs.delete("offers/oAmal")
    mockDb.docs.delete("offers/oH")
  })
  it("one line of it is refused 422 lump_partial", async () => {
    const res = await run("buyer", { picks: [pick(0, "oA")] })
    expect(res.status).toBe(422)
    expect(res.json.code).toBe("lump_partial")
  })
  it("the whole request makes ONE order with no line prices and the lump as its total", async () => {
    const res = await run("buyer", { picks: [pick(0, "oA"), pick(1, "oA")], lowComp: { code: "urgent" } })
    expect(res.status).toBe(200)
    expect(orders()).toHaveLength(1)
    expect(orders()[0]).toMatchObject({ lump: true, totalExVat: 5000 })
    expect(orders()[0].lines.every((l: { unitPrice: number | null }) => l.unitPrice === null)).toBe(true)
  })
})

describe("G-16 / R-07 — the approval class is the server's", () => {
  it("a buyer's order within the manager's limit is approved by policy and sent at once", async () => {
    const res = await run("buyer", { picks: [pick(0, "oA")] })
    expect(res.json.data?.orders[0]).toMatchObject({ state: "sent" })
    const po = orders()[0]
    expect(po.status).toBe("sent")
    expect(po.approvedByName).toBe("ضمن حدّ الاعتماد")
  })
  it("an order above the limit waits for the approver; a buyer cannot approve it now, and the owner can", async () => {
    const solo = () => {
      for (const k of [...mockDb.docs.keys()]) if (k.startsWith("purchaseOrders/")) mockDb.docs.delete(k)
      for (const gone of ["oS", "oM", "oAmal", "oH"]) mockDb.docs.delete(`offers/${gone}`)
      mockDb.seed("rfqs/r1", rfq())
      mockDb.seed("offers/oA", offer("oA", "supA", [{ rfqProductIndex: 0, unitPrice: 800 }, { rfqProductIndex: 1, unitPrice: 400 }]))
    }
    const body = { picks: [pick(0, "oA"), pick(1, "oA")], lowComp: { code: "urgent" } }
    solo()
    const waits = await run("buyer", body)
    expect(waits.json.data?.orders[0]).toMatchObject({ state: "waiting" })
    expect(orders()[0].status).toBe("awaiting_approval")
    const key = waits.json.data?.orders[0].key as string
    solo()
    const denied = await run("buyer", { ...body, approveNow: [key] })
    expect(denied.status).toBe(403)
    expect(denied.json.code).toBe("approve_not_owner")
    solo()
    const owner = await run(ORG, { ...body, approveNow: [key] })
    expect(owner.status).toBe(200)
    expect(owner.json.data?.orders[0].state).toMatch(/approved|sent/)
  })
  it("the manager's own order is never approved by him: it waits (the preparer approves nothing he prepared)", async () => {
    const res = await run("mgr", { picks: [pick(0, "oA")] })
    expect(res.json.data?.orders[0].state).toBe("waiting")
    expect(orders()[0]).toMatchObject({ status: "awaiting_approval", approverKind: "owner" })
  })
})

describe("who may award, and how the request is read", () => {
  it("needs offers.accept (403), and another company's request does not exist (404)", async () => {
    expect((await run("nobody", { picks: [pick(0, "oA")] })).status).toBe(403)
    expect((await run("stranger", { picks: [pick(0, "oA")] })).json.code).toBe("rfq_missing")
  })
  it("refuses an empty award (422) and a guest supplier unless the buyer accepted him (today's behaviour)", async () => {
    expect((await run("buyer", { picks: [] })).json.code).toBe("nothing_picked")
    mockDb.seed("offers/oA", offer("oA", "guest", [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6 }], { isGuestOffer: true, supplierId: "guest", organizationId: "guest", companyName: "زائر" }))
    expect((await run("buyer", { picks: [pick(0, "oA")] })).json.code).toBe("guest_unregistered")
    expect((await run("buyer", { picks: [pick(0, "oA")], acceptGuest: true })).status).toBe(200)
  })
  it("never believes a price from the browser: an extra price field in the body is ignored", async () => {
    const res = await run("buyer", { picks: [{ ...pick(0, "oA"), unitPrice: 1 }], total: 1 })
    expect(res.status).toBe(200)
    expect(orders()[0].totalExVat).toBe(2187.5)
  })
})

describe("what the old client award guaranteed, now the server's", () => {
  it("another buyer's request is refused 403 not_yours; a supplier with a live order may still win the lines no order carries", async () => {
    mockDb.seed("rfqs/r1", rfq({ createdByUserId: "other" }))
    expect((await run("buyer", { picks: [pick(0, "oA")] })).json.code).toBe("not_yours")
    mockDb.seed("rfqs/r1", rfq())
    mockDb.seed("purchaseOrders/old", { organizationId: ORG, rfqId: "r1", offerId: "oS", status: "approved", docNumber: "PO-2026/009", lines: [{ id: "l1", rfqProductIndex: 0 }] })
    mockDb.seed("offers/oS", { ...(mockDb.get("offers/oS") as object), poId: "old", poNumber: "PO-2026/009", awardedLines: [0], awardedTotal: 2190 })
    const res = await run("buyer", { picks: [pick(1, "oS")], why: { code: "other", text: "عميل قديم" } })
    expect(res.status).toBe(200)
    expect((mockDb.get("offers/oS") as any).awardedLines).toEqual([0, 1])
  })
  it("freezes the RFQ's payment terms on the order", async () => {
    mockDb.seed("rfqs/r1", rfq({ paymentTermsList: [{ pct: 30, days: 0 }, { pct: 70, days: 30 }] }))
    await run("buyer", { picks: [pick(0, "oA")] })
    expect(orders()[0].termsList).toEqual([{ pct: 30, days: 0 }, { pct: 70, days: 30 }])
  })
  it("tells the project request which order answers it, in the same transaction", async () => {
    mockDb.seed("projects/p1", { name: "مشروع", pm: { lifecycle: "live" } })
    mockDb.seed("projects/p1/purchaseRequests/pr1", { rfqId: "r1", status: "approved", lines: [] })
    mockDb.seed("rfqs/r1", rfq({ needSources: [{ kind: "project_request", projectId: "p1", purchaseRequestId: "pr1" }] }))
    await run("buyer", { picks: [pick(0, "oA")] })
    expect(mockDb.get("projects/p1/purchaseRequests/pr1")).toMatchObject({ poId: orders()[0].id, poNumber: orders()[0].docNumber })
  })
})

describe("the editor's direct award — the order is made here, the owner approves above the cap (R-36 / G-16)", () => {
  const directRfq = () => rfq({ status: "Awarded", directAward: true, deadline: null, products: [prod("حديد", 10)], allowedSupplierOrgIds: ["supD"] })
  const directOffer = (price: number) => ({ ...offer("oD", "supD", [{ rfqProductIndex: 0, unitPrice: price / 10 }], { directAward: true, status: "مقبول", awaitingOrderApproval: true, price: String(price), validUntil: null, offerPdfUrl: null }) })
  beforeEach(() => {
    for (const gone of ["oA", "oS", "oM", "oAmal", "oH"]) mockDb.docs.delete(`offers/${gone}`)
    mockDb.seed("rfqs/r1", directRfq())
  })
  it("under the cap it is an ordinary order born from the accepted offer, sent at once for a buyer", async () => {
    mockDb.seed("offers/oD", directOffer(3000))
    const res = await run("buyer", { picks: [], direct: { offerId: "oD", reason: null } })
    expect(res.status).toBe(200)
    expect(orders()[0]).toMatchObject({ basis: "direct", rfqId: "r1", offerId: "oD", totalExVat: 3000 })
    expect(mockDb.get("rfqs/r1")).toMatchObject({ status: "Awarded" })
    expect((mockDb.get("offers/oD") as any).poId).toBe(orders()[0].id)
  })
  it("above the cap it needs the reason (422) and waits for the owner — a buyer cannot approve it now (403)", async () => {
    mockDb.seed("offers/oD", directOffer(8000))
    expect((await run("buyer", { picks: [], direct: { offerId: "oD", reason: null } })).json.code).toBe("reason_required")
    const res = await run("buyer", { picks: [], direct: { offerId: "oD", reason: "المورد الوحيد" } })
    expect(res.json.data?.orders[0].state).toBe("waiting")
    expect(orders()[0]).toMatchObject({ status: "awaiting_approval", approverKind: "owner", tags: { directOver: { why: "المورد الوحيد" } } })
  })
  it("is idempotent: the offer that already names its order gives it back and makes no second", async () => {
    mockDb.seed("offers/oD", directOffer(3000))
    await run("buyer", { picks: [], direct: { offerId: "oD", reason: null } })
    const again = await run("buyer", { picks: [], direct: { offerId: "oD", reason: null } })
    expect(again.status).toBe(200)
    expect(orders()).toHaveLength(1)
  })
})
