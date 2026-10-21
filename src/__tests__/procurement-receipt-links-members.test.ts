/** @jest-environment node */
/**
 * PUR-06 — «عضو في الفريق» is told in his own account and receives signed in: no link or code is
 * sent to him. The link and the code are for a person with no account only. Real handlers over an
 * in-memory Admin Firestore.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb, type FakeDocRef } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockSend = jest.fn(async (_m: { to: string; body: string }) => ({ sent: true }))

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("tok:")) throw new Error("bad token")
      return { uid: t.slice(4) }
    },
  }),
}))
jest.mock("@/lib/sms", () => ({ ...jest.requireActual("@/lib/sms"), sendDirectMessage: (m: { to: string; body: string }) => mockSend(m) }))

import { POST as forward } from "@/app/api/receipt-links/route"
import { POST as remind } from "@/app/api/receipt-links/remind/route"

const ORG = "acme"
const post = (handler: (r: NextRequest) => Promise<Response>, body: unknown, uid?: string) =>
  handler(new NextRequest("http://localhost/api/receipt-links", { method: "POST", headers: { "content-type": "application/json", ...(uid ? { authorization: `Bearer tok:${uid}` } : {}) }, body: JSON.stringify(body) }))
const links = () => mockDb.list("receiptLinks")
const notices = (uid: string) => mockDb.list(`users/${uid}/notifications`)
const delivery = () => mockDb.get("deliveries/d1") as { forwardedTo?: Record<string, unknown> }

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockSend.mockClear()
  jest.spyOn(console, "error").mockImplementation(() => undefined)
  jest.spyOn(console, "warn").mockImplementation(() => undefined)
  ;(mockDb as unknown as { batch: () => unknown }).batch = () => {
    const ops: Array<() => Promise<void>> = []
    return {
      update: (ref: FakeDocRef, patch: Record<string, unknown>) => void ops.push(() => ref.update(patch)),
      set: (ref: FakeDocRef, data: Record<string, unknown>) => void ops.push(() => ref.set(data)),
      commit: async () => {
        for (const op of ops) await op()
      },
    }
  }
  mockDb.seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "Saad" })
  mockDb.seed("users/keeper", { organizationId: ORG, organizationRole: "member", name: "Ahmed", phone: "0551002210" })
  mockDb.seed("users/stranger", { organizationId: "rival", organizationRole: "owner", name: "Rival" })
  mockDb.seed("deliveries/d1", { contractorOrgId: ORG, status: "pending_confirmation", supplierName: "Al Rajhi", lines: [] })
})
afterEach(() => jest.restoreAllMocks())

describe("forwarding to a team member", () => {
  it("writes the forwarding record and tells him in his account — and hands out no link or code", async () => {
    const res = await post(forward, { deliveryId: "d1", receiver: { kind: "user", userId: "keeper" } }, ORG)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ url: null, phoneMasked: null, viaAccount: true })
    expect(delivery().forwardedTo).toMatchObject({ name: "Ahmed", userId: "keeper", byName: "Saad" })
    expect(links()).toHaveLength(1)
    expect(links()[0]).toMatchObject({ viaAccount: true, receiver: { kind: "user", userId: "keeper" }, status: "open" })
    const note = notices("keeper")
    expect(note).toHaveLength(1)
    expect(note[0]).toMatchObject({ type: "receipt_forwarded", link: "/contractor/receive/d1", deliveryId: "d1" })
    expect(JSON.stringify(note[0])).not.toContain(String(links()[0].token))
    expect(JSON.stringify(body)).not.toContain(String(links()[0].token))
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("forwarding again to someone else closes the member's earlier session", async () => {
    await post(forward, { deliveryId: "d1", receiver: { kind: "user", userId: "keeper" } }, ORG)
    await post(forward, { deliveryId: "d1", receiver: { kind: "person", name: "Salem", phone: "0501234567" } }, ORG)
    expect(links().map((l) => l.status).sort()).toEqual(["open", "revoked"])
    expect(delivery().forwardedTo).toMatchObject({ name: "Salem", userId: null })
  })

  it("refuses someone who is not on the company's team", async () => {
    const res = await post(forward, { deliveryId: "d1", receiver: { kind: "user", userId: "stranger" } }, ORG)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("NOT_A_MEMBER")
    expect(links()).toHaveLength(0)
  })
})

describe("forwarding to a person with no account", () => {
  it("gives Procurement the link to send, with the code going to his mobile — and writes no notification", async () => {
    const res = await post(forward, { deliveryId: "d1", receiver: { kind: "person", name: "Salem", phone: "0501234567" } }, ORG)
    const body = await res.json()
    expect(body.data.url).toContain(`/receive/${links()[0].token}`)
    expect(body.data.viaAccount).toBe(false)
    expect(String(body.data.phoneMasked)).not.toContain("0501234567")
    expect(links()[0].viaAccount).toBeUndefined()
    expect(links()[0].receiver).toMatchObject({ kind: "person", userId: null, phone: "+966501234567" })
    expect(Array.from(mockDb.docs.keys()).filter((k) => k.includes("notifications"))).toHaveLength(0)
  })
})

describe("reminding the receiver", () => {
  it("a member is reminded in his account, pointing at his task and not at a link", async () => {
    await post(forward, { deliveryId: "d1", receiver: { kind: "user", userId: "keeper" } }, ORG)
    const res = await post(remind, { deliveryId: "d1" }, ORG)
    expect(res.status).toBe(200)
    const reminder = notices("keeper").find((n) => String(n.title).includes("تذكير"))
    expect(reminder).toMatchObject({ link: "/contractor/receive/d1" })
    expect(JSON.stringify(reminder)).not.toContain(String(links()[0].token))
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("a person with no account is sent his link again by message", async () => {
    await post(forward, { deliveryId: "d1", receiver: { kind: "person", name: "Salem", phone: "0501234567" } }, ORG)
    await post(remind, { deliveryId: "d1" }, ORG)
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0].body).toContain(`/receive/${links()[0].token}`)
  })
})
