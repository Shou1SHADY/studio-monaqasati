/** @jest-environment node */
/**
 * Procurement 2.0 — the receiver's doors, as routes (G-09, B-01, RCV-03, R-35, WF-18). The page reads the link without ever being told a
 * quantity (blind count), «أكّد الاستلام» posts to the sign route and the RECEIPT comes back; a truck with no notice asks for its own link
 * from the order, signed in, and only a member who holds the receiving permission gets one — a buyer who only prepares orders is refused (403).
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const verdicts: { otp: "ok" | "wrong" | "expired" } = { otp: "ok" }

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => (t === "bad" ? Promise.reject(new Error("bad")) : { uid: t }) }),
  getAdminFirestore: () => mockDb,
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/otp", () => ({ verifyOtp: async () => verdicts.otp, maskPhone: (p: string) => `${p.slice(0, 4)}••` }))

import { GET as readLink } from "@/app/api/receipt-links/[token]/route"
import { POST as sign } from "@/app/api/receipt-links/[token]/sign/route"
import { POST as arrival } from "@/app/api/receipt-links/arrival/route"

const ORG = "org1"
const TOKEN = "a".repeat(64)

const line = (id: string, name: string, quantity: number) => ({ id, name, unit: "طن", quantity, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0 })
const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/021",
  status: "accepted",
  rfqTitle: "حديد التسليح",
  projectId: "p1",
  supplierOrgId: "sup1",
  supplierUserId: "su1",
  supplierName: "مصنع الجودة",
  isGuestSupplier: false,
  lines: [line("l1", "حديد 12 مم", 10), line("l2", "حديد 16 مم", 5)],
  totalExVat: 45000,
  vatRate: 0.15,
  preparedById: "buyer",
  preparedByName: "بدر",
  log: [],
  ...over,
})

const call = async (route: (r: NextRequest, c: { params: Promise<{ token: string }> }) => Promise<Response>, init: { token?: string; user?: string; body?: unknown; method?: string }) => {
  const res = await route(
    new NextRequest("http://localhost/api/receipt-links/x", {
      method: init.method || "POST",
      headers: { "content-type": "application/json", ...(init.user ? { authorization: `Bearer ${init.user}` } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }),
    { params: Promise.resolve({ token: init.token || TOKEN }) }
  )
  return { status: res.status, json: (await res.json()) as { data?: Record<string, any>; code?: string } } // eslint-disable-line @typescript-eslint/no-explicit-any
}
const callPlain = async (route: (r: NextRequest) => Promise<Response>, user: string | null, body: unknown) => {
  const res = await route(new NextRequest("http://localhost/api/receipt-links/arrival", { method: "POST", headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${user}` } : {}) }, body: JSON.stringify(body) }))
  return { status: res.status, json: (await res.json()) as { data?: { token?: string }; code?: string } }
}

const answer = (poLineId: string, counted: number, rejected = 0, rejectReason: string | null = null) => ({ poLineId, counted, rejected, rejectReason, held: 0, holdReason: null, note: null })
const signBody = (lines: unknown[], extra: Record<string, unknown> = {}) => ({ receiverName: "سامي الدوسري", note: null, signatureData: null, lines, ...extra })

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  verdicts.otp = "ok"
  mockDb.seed("users/org1", { organizationId: ORG, companyName: "شركة المقاول", name: "المالك" })
  mockDb.seed("users/buyer", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy", name: "بدر" })
  mockDb.seed("users/rcv", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-rcv", name: "سامي" })
  mockDb.seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept"] })
  mockDb.seed("teamGroups/g-rcv", { organizationId: ORG, permissions: ["deliveries.confirm"] })
  mockDb.seed("projects/p1", { organizationId: ORG, warehouseId: "wh-p1" })
  mockDb.seed("warehouses/wh-p1", { organizationId: ORG, name: "مستودع البرج", projectId: "p1" })
  mockDb.seed("purchaseOrders/po1", order())
  mockDb.seed("deliveries/d1", {
    contractorOrgId: ORG,
    status: "pending_confirmation",
    poId: "po1",
    poNumber: "PO-2026/021",
    supplierName: "مصنع الجودة",
    rfqTitle: "حديد التسليح",
    projectId: "p1",
    deliveryDate: "2026-10-20T00:00:00.000Z",
    seq: 1,
    items: [],
    forwardedTo: { linkId: "lk1", name: "سامي", userId: "rcv", phoneMasked: "05••", byName: "ريم", at: "2026-10-19T08:00:00Z" },
  })
  mockDb.seed("receiptLinks/lk1", { token: TOKEN, deliveryId: "d1", organizationId: ORG, receiver: { kind: "user", userId: "rcv", name: "سامي", phone: "+966500000000" }, status: "open", createdById: "clerk", createdByName: "ريم", createdAt: "2026-10-19T08:00:00Z", expiresAt: "2999-01-01T00:00:00Z" })
})

describe("the page reads the link — and never a quantity", () => {
  it("names, units and where it will land; no ordered quantity, no price, no whole mobile number (the count is blind)", async () => {
    const res = await call(readLink as never, { method: "GET" })
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ supplierName: "مصنع الجودة", poNumber: "PO-2026/021", where: "project", lines: [{ poLineId: "l1", name: "حديد 12 مم", unit: "طن" }, { poLineId: "l2", name: "حديد 16 مم", unit: "طن" }] })
    const text = JSON.stringify(res.json.data)
    expect(text).not.toMatch(/noticeQuantity|"quantity"|unitPrice|3000|966500000000/)
  })
})

describe("«أكّد الاستلام» — the sign route makes the receipt", () => {
  it("a member signed in as the named receiver: no code, the receipt comes back with its number, the order has moved", async () => {
    const res = await call(sign as never, { user: "rcv", body: signBody([answer("l1", 3, 1, "damaged"), answer("l2", 0)]) })
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ docNumber: "GR-2026/001", module: "projects", stockLanded: true })
    expect(res.json.data?.print).toMatchObject({ companyName: "شركة المقاول", complete: false, via: "login" })
    expect(mockDb.get("deliveries/d1")).toMatchObject({ status: "confirmed", confirmedVia: "login", recordedBy: "receiver", receiverUserId: "rcv" })
    expect((mockDb.get("purchaseOrders/po1") as { lines: Array<{ accepted: number; rejected: number }> }).lines[0]).toMatchObject({ accepted: 2, rejected: 1 })
  })

  it("anyone else needs the texted code: none → 400, wrong → 400, right → the receipt, flagged sms_code", async () => {
    expect((await call(sign as never, { body: signBody([answer("l1", 3), answer("l2", 0)]) })).json.code).toBe("CODE_NEEDED")
    verdicts.otp = "wrong"
    expect((await call(sign as never, { body: signBody([answer("l1", 3), answer("l2", 0)], { challengeId: "c1", code: "123456" }) })).json.code).toBe("WRONG_CODE")
    verdicts.otp = "ok"
    const ok = await call(sign as never, { body: signBody([answer("l1", 3), answer("l2", 0)], { challengeId: "c1", code: "123456" }) })
    expect(ok.status).toBe(200)
    expect(mockDb.get("deliveries/d1")).toMatchObject({ status: "confirmed", confirmedVia: "sms_code" })
  })

  it("a signed-in member who is NOT the named receiver still needs the code", async () => {
    const res = await call(sign as never, { user: "buyer", body: signBody([answer("l1", 3), answer("l2", 0)]) })
    expect(res.json.code).toBe("CODE_NEEDED")
    expect(mockDb.get("deliveries/d1")).toMatchObject({ status: "pending_confirmation" })
  })

  it("refuses a rejection with no reason, a line left out, nothing counted and an over-receipt; the receipt is not made", async () => {
    expect((await call(sign as never, { user: "rcv", body: signBody([answer("l1", 3, 1, null), answer("l2", 0)]) })).json.code).toBe("REJECT_NEEDS_REASON")
    expect((await call(sign as never, { user: "rcv", body: signBody([answer("l1", 3)]) })).json.code).toBe("MISSING_LINE")
    expect((await call(sign as never, { user: "rcv", body: signBody([answer("l1", 0), answer("l2", 0)]) })).json.code).toBe("NOTHING_COUNTED")
    const over = await call(sign as never, { user: "rcv", body: signBody([answer("l1", 11), answer("l2", 0)]) })
    expect([over.status, over.json.code]).toEqual([400, "OVER_RECEIPT"])
    expect(mockDb.get("deliveries/d1")).toMatchObject({ status: "pending_confirmation" })
  })

  it("the link is single-use: a second press is 410, and the receipt it made is not made twice", async () => {
    await call(sign as never, { user: "rcv", body: signBody([answer("l1", 3), answer("l2", 0)]) })
    const again = await call(sign as never, { user: "rcv", body: signBody([answer("l1", 3), answer("l2", 0)]) })
    expect([again.status, again.json.code]).toEqual([410, "LINK_SIGNED"])
    expect(mockDb.get("mfgCounters/org1__GR__2026")).toMatchObject({ last: 1 })
  })
})

describe("WF-18 — a truck with no notice: the receiver asks for its link; Procurement cannot", () => {
  it("a member holding the receiving permission gets a link for the order; counting through it creates the tagged receipt", async () => {
    const asked = await callPlain(arrival as never, "rcv", { poId: "po1" })
    expect(asked.status).toBe(200)
    const token = asked.json.data?.token as string
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    const stored = mockDb.list("receiptLinks").find((l) => l.token === token) as unknown as { arrival: boolean; poId: string; receiver: { userId: string } }
    expect(stored).toMatchObject({ arrival: true, poId: "po1", receiver: { userId: "rcv" } })

    const page = await call(readLink as never, { method: "GET", token })
    expect(page.json.data).toMatchObject({ noNotice: true, poNumber: "PO-2026/021", lines: [{ poLineId: "l1" }, { poLineId: "l2" }] })

    const noLogin = await call(sign as never, { token, body: signBody([answer("l1", 4), answer("l2", 0)]) })
    expect([noLogin.status, noLogin.json.code]).toEqual([401, "LOGIN_NEEDED"])

    const done = await call(sign as never, { token, user: "rcv", body: signBody([answer("l1", 4), answer("l2", 0)]) })
    expect(done.status).toBe(200)
    const created = mockDb.list("deliveries").find((d) => d.noNotice)
    expect(created).toMatchObject({ status: "confirmed", noNotice: true, poId: "po1", recordedBy: "receiver" })
  })

  it("G-09 — a user who only prepares orders (offers.accept, no receiving permission) is refused: 403", async () => {
    const res = await callPlain(arrival as never, "buyer", { poId: "po1" })
    expect(res.status).toBe(403)
    expect(mockDb.list("receiptLinks").filter((l) => l.arrival)).toHaveLength(0)
  })

  it("an order that is closed, another company's order and no sign-in are refused", async () => {
    mockDb.seed("purchaseOrders/po2", order({ status: "closed" }))
    expect((await callPlain(arrival as never, "rcv", { poId: "po2" })).status).toBe(409)
    mockDb.seed("purchaseOrders/po3", order({ organizationId: "other" }))
    expect((await callPlain(arrival as never, "rcv", { poId: "po3" })).status).toBe(404)
    expect((await callPlain(arrival as never, null, { poId: "po1" })).status).toBe(401)
  })
})
