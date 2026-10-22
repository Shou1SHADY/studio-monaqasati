/** @jest-environment node */
/**
 * Procurement 2.0 — WP-S1-11: the buying side's small writes on an offer (ask for a sample, record a guest's invitation, mark an
 * offer rated) run on the server. They were the last users of the `offers` contractor-update branch of the ruleset, now deleted:
 * a buyer runs only the RFQs he raised, another company's offer does not exist for the caller, and the RFQ's log names who did what.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => (t === "bad" ? Promise.reject(new Error("bad")) : { uid: t }) }),
  getAdminFirestore: () => mockDb,
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))

import { POST as act } from "@/app/api/procurement/offers/act/route"

const ORG = "org1"
const can = (...ps: string[]) => (p: string) => ps.includes(p)
const person = (uid: string, orgId: string, name: string, perms: string[] | "all") => ({ uid, orgId, name, can: perms === "all" ? () => true : can(...perms) })

const call = async (user: string, body: unknown) => {
  const res = await act(new NextRequest("http://localhost/api/procurement/offers/act", { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
  return { status: res.status, json: (await res.json()) as { success?: boolean; reason?: string; code?: string } }
}
const offer = () => mockDb.get("offers/o1") as Record<string, unknown>
const rfqLog = () => (mockDb.get("rfqs/r1") as { log?: Array<{ action: string; byId: string; params?: Record<string, unknown> }> }).log ?? []

beforeEach(() => {
  mockDb.docs.clear()
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, ORG, "المالك", "all"),
    clerk: person("clerk", ORG, "ريم", ["offers.accept"]),
    other: person("other", ORG, "فهد", ["offers.accept"]),
    viewer: person("viewer", ORG, "مشاهد", ["offers.view"]),
    stranger: person("stranger", "org2", "غريب", "all"),
  })
  mockDb.seed("rfqs/r1", { organizationId: ORG, contractorId: "clerk", createdByUserId: "clerk", status: "New", title: "حديد", log: [] })
  mockDb.seed("offers/o1", { rfqId: "r1", supplierId: "sup1", organizationId: "sup1", contractorOrgId: ORG, status: "قيد المراجعة", rfqTitle: "حديد", isGuestOffer: false })
})

describe("asking for a sample", () => {
  const body = { act: "sample", offerId: "o1", what: "عينة حديد 12", place: "موقع الخرج", by: "2099-01-01" }

  it("writes the request on the offer and tells the supplier once", async () => {
    const res = await call("clerk", body)
    expect(res.status).toBe(200)
    expect(offer()).toMatchObject({ sampleStatus: "مطلوبة", sampleWhat: "عينة حديد 12", samplePlace: "موقع الخرج", sampleBy: "2099-01-01", sampleSentAt: null, sampleReceivedBy: null })
    const told = mockDb.list("users/sup1/notifications")
    expect(told).toHaveLength(1)
    expect(told[0]).toMatchObject({ type: "sample_requested", offerId: "o1", rfqId: "r1", i18n: { message: "pn_sample_requested", params: { rfq: "حديد" } } })
  })

  it("a guest has no inbox: the offer is written, nobody is notified", async () => {
    mockDb.seed("offers/o1", { ...offer(), isGuestOffer: true, supplierId: "guest" })
    expect((await call("clerk", body)).status).toBe(200)
    expect(mockDb.list("users/guest/notifications")).toHaveLength(0)
  })

  it("a buyer asks on the RFQs he raised only; the owner and a reader are as the RFQ rules say", async () => {
    expect((await call("other", body)).json.reason).toBe("no_permission")
    expect((await call("viewer", body)).json.reason).toBe("no_permission")
    expect(offer()).not.toHaveProperty("sampleStatus")
    expect((await call(ORG, body)).status).toBe(200)
  })

  it("another company's offer does not exist for the caller; a past day is refused", async () => {
    expect((await call("stranger", body)).json.reason).toBe("offer_missing")
    expect((await call("clerk", { ...body, by: "2020-01-01" })).json.reason).toBe("date_invalid")
    expect((await call("clerk", { ...body, what: "" })).status).toBe(400)
  })
})

describe("recording that a guest was invited to join", () => {
  it("puts the invitation on the offer and the name of who did it on the RFQ's log", async () => {
    const res = await call("clerk", { act: "guest_invited", offerId: "o1", supplierName: "مؤسسة الحي", channel: "wa", invitationId: "inv1" })
    expect(res.status).toBe(200)
    expect(offer().guestInvite).toMatchObject({ byId: "clerk", byName: "ريم", channel: "wa", invitationId: "inv1" })
    expect(rfqLog()).toEqual([expect.objectContaining({ action: "guest_invited", byId: "clerk", params: { supplier: "مؤسسة الحي" } })])
    expect((await call("other", { act: "guest_invited", offerId: "o1", supplierName: "x", channel: "email" })).json.reason).toBe("no_permission")
  })
})

describe("marking an offer rated", () => {
  it("whoever prepares or approves orders marks it; a reader and another company do not", async () => {
    expect((await call("viewer", { act: "rated", offerId: "o1" })).json.reason).toBe("no_permission")
    expect((await call("stranger", { act: "rated", offerId: "o1" })).json.reason).toBe("offer_missing")
    expect(offer()).not.toHaveProperty("contractorRated")
    expect((await call("other", { act: "rated", offerId: "o1" })).status).toBe(200)
    expect(offer().contractorRated).toBe(true)
  })

  it("answers 401 without a sign-in and 400 for an act it does not know", async () => {
    const anon = await act(new NextRequest("http://localhost/api/procurement/offers/act", { method: "POST", body: "{}" }))
    expect(anon.status).toBe(401)
    expect((await call("clerk", { act: "accept", offerId: "o1" })).status).toBe(400)
  })
})
