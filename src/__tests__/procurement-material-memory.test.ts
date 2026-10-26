/** @jest-environment node */
/**
 * Procurement «ارفع ملف إكسل» (IMP 1.3, IMP-09/IMP-12): what a buyer picks for a text of an uploaded file is remembered by the SERVER for
 * the company — only whoever can create an RFQ reads or writes it, one company never sees another's, and a second pick for the same text
 * replaces the first.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCaller = jest.fn()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (t !== "good") throw new Error("bad")
      return { uid: "u1" }
    },
  }),
  getAdminFirestore: () => mockDb,
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: (...a: unknown[]) => mockCaller(...a) }))

import { GET, POST } from "@/app/api/procurement/material-memory/route"

const headers = { authorization: "Bearer good", "content-type": "application/json" }
const post = (body: unknown, auth = true) => POST(new NextRequest("http://localhost/api/procurement/material-memory", { method: "POST", headers: auth ? headers : { "content-type": "application/json" }, body: JSON.stringify(body) }))
const get = (auth = true) => GET(new NextRequest("http://localhost/api/procurement/material-memory", { headers: auth ? headers : {} }))
const caller = (orgId: string, can: (p: string) => boolean) => ({ uid: "u1", orgId, name: "نورة", can })
const entry = { text: "سلك 2.5 ملم", nodeId: "n1", specs: [{ spec: "المقاس", option: "2.50 مم" }], brand: null }

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockCaller.mockReset()
  mockCaller.mockResolvedValue(caller("org1", (p) => p === "rfq.create"))
})

describe("/api/procurement/material-memory", () => {
  it("refuses a request without a valid sign-in", async () => {
    expect((await post(entry, false)).status).toBe(401)
    expect((await get(false)).status).toBe(401)
    expect(mockDb.writes).toHaveLength(0)
  })

  it("refuses a member who cannot create an RFQ — nothing is read and nothing is written", async () => {
    mockCaller.mockResolvedValue(caller("org1", () => false))
    expect((await post(entry)).status).toBe(403)
    expect((await get()).status).toBe(403)
    expect(mockDb.writes).toHaveLength(0)
  })

  it.each(["rfq.create", "rfq.manage", "projects.publish", "offers.accept", "po.approve"])("%s may remember and read", async (perm) => {
    mockCaller.mockResolvedValue(caller("org1", (p) => p === perm))
    expect((await post(entry)).status).toBe(200)
    expect((await get()).status).toBe(200)
  })

  it("writes one document per company and returns what it holds", async () => {
    await post(entry)
    await post({ text: "حديد الأعمدة", nodeId: "n2", specs: [], brand: "سابك" })
    expect(mockDb.writes.map(([p]) => p)).toEqual(["materialMemory/org1", "materialMemory/org1"])
    const body = await (await get()).json()
    expect(body.success).toBe(true)
    expect(body.data.entries.map((e: { text: string; nodeId: string }) => [e.text, e.nodeId])).toEqual([
      ["سلك 2.5 ملم", "n1"],
      ["حديد الأعمدة", "n2"],
    ])
    expect(mockDb.get("materialMemory/org1")).toMatchObject({ organizationId: "org1" })
  })

  it("a second pick for the same text replaces the first", async () => {
    await post(entry)
    await post({ ...entry, nodeId: "n9" })
    const body = await (await get()).json()
    expect(body.data.entries).toHaveLength(1)
    expect(body.data.entries[0]).toMatchObject({ text: "سلك 2.5 ملم", nodeId: "n9", by: "u1" })
  })

  it("one company never sees another's memory", async () => {
    await post(entry)
    mockCaller.mockResolvedValue(caller("org2", (p) => p === "rfq.create"))
    const body = await (await get()).json()
    expect(body.data.entries).toEqual([])
  })

  it("refuses a pick with extra keys or no material", async () => {
    expect((await post({ ...entry, organizationId: "other" })).status).toBe(400)
    expect((await post({ ...entry, nodeId: "" })).status).toBe(400)
    expect((await post({ text: "", nodeId: "n", specs: [], brand: null })).status).toBe(400)
    expect(mockDb.writes).toHaveLength(0)
  })
})
