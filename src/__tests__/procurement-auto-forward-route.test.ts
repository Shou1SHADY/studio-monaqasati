/** @jest-environment node */
// PUR-06: the on-demand run forwards the CALLER's company only, and only for someone
// who may forward a notice by hand.

const mockRun = jest.fn(async () => ({ orgs: 1, pending: 2, forwarded: 1, skipped: 1, failed: 0 }))
const mockCaller = jest.fn()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => { if (t !== "good") throw new Error("bad"); return { uid: "u1" } } }),
  getAdminFirestore: () => ({}),
}))
jest.mock("@/lib/receipt-links", () => ({ callerOf: (...a: unknown[]) => mockCaller(...a) }))
jest.mock("@/lib/procurement/auto-forward-server", () => ({ runAutoForward: (...a: unknown[]) => mockRun(...(a as [])) }))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/procurement/auto-forward/route"

const call = (token?: string, body?: unknown) =>
  POST(new NextRequest("http://localhost/api/procurement/auto-forward", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))

beforeEach(() => { mockRun.mockClear(); mockCaller.mockReset() })

it("refuses without a valid sign-in", async () => {
  expect((await call()).status).toBe(401)
  expect((await call("forged")).status).toBe(401)
  expect(mockRun).not.toHaveBeenCalled()
})

it("refuses a member who may not forward", async () => {
  mockCaller.mockResolvedValue({ uid: "u1", orgId: "org1", name: "", can: () => false })
  expect((await call("good")).status).toBe(403)
  expect(mockRun).not.toHaveBeenCalled()
})

it("runs for the caller's company only", async () => {
  mockCaller.mockResolvedValue({ uid: "u1", orgId: "org1", name: "", can: (p: string) => p === "po.expedite" })
  const res = await call("good")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ success: true, data: { forwarded: 1 } })
  expect(mockRun).toHaveBeenCalledWith(expect.anything(), expect.any(Number), "org1", { ignoreAge: false })
})

it("lifts only the age limit when a person pressed «forward everything overdue», still for the caller's company", async () => {
  mockCaller.mockResolvedValue({ uid: "u1", orgId: "org1", name: "", can: (p: string) => p === "po.expedite" })
  expect((await call("good", { overdue: true })).status).toBe(200)
  expect(mockRun).toHaveBeenCalledWith(expect.anything(), expect.any(Number), "org1", { ignoreAge: true })
})

it("refuses a body that tries to say whom or which company", async () => {
  mockCaller.mockResolvedValue({ uid: "u1", orgId: "org1", name: "", can: (p: string) => p === "po.expedite" })
  expect((await call("good", { orgId: "org2" })).status).toBe(400)
  expect(mockRun).not.toHaveBeenCalled()
})
