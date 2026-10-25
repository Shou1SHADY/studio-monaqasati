/** @jest-environment node */
/**
 * PM 1.1 — closing a work permit early (HSE-01 `pmtclose`, FX-29) runs on the
 * server: the guard (`permit.close` = hse) and the rule run again in the
 * transaction; another company's project reads as missing; a permit closes once.
 */

import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("tok:")) throw new Error("bad token")
      return { uid: t.slice(4) }
    },
  }),
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))

import { closePermitServer, PermitCloseError } from "@/lib/pm/permit-close-server"
import { POST } from "@/app/api/pm/permit-close/route"

const db = mockDb as never
const TODAY = "2026-10-25"

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.seed("users/org1", { name: "Owner", organizationId: "org1" })
  mockDb.seed("users/hs1", { name: "Majed", organizationId: "org1", organizationRole: "member", defaultGroupId: "gSite" })
  mockDb.seed("users/se1", { name: "Omar", organizationId: "org1", organizationRole: "member", defaultGroupId: "gSite" })
  mockDb.seed("users/x1", { name: "Other", organizationId: "org9", organizationRole: "member" })
  mockDb.seed("teamGroups/gSite", { organizationId: "org1", permissions: ["pm.site"] })
  mockDb.seed("projects/p1", { organizationId: "org1", projectManagerId: "pm1", pm: { no: "PJ-2026/003", lifecycle: "live" } })
  mockDb.seed("projects/p1/members/hs1", { userId: "hs1", pmRole: "hse" })
  mockDb.seed("projects/p1/members/se1", { userId: "se1", pmRole: "site" })
  mockDb.seed("projects/p1/pmPermits/01", { seq: 1, k: "hot", title: "Roof", who: "Crew", from: "2026-10-20", to: "2026-10-30", by: "hs1" })
})

describe("closing a permit early", () => {
  it("is safety's: the HSE officer closes it today, once", async () => {
    await expect(closePermitServer(db, "se1", { projectId: "p1", permitId: "01" }, TODAY)).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(await closePermitServer(db, "hs1", { projectId: "p1", permitId: "01" }, TODAY)).toEqual({ closedOn: TODAY })
    expect(mockDb.get("projects/p1/pmPermits/01")).toMatchObject({ closedOn: TODAY, closedBy: "hs1", closedByName: "Majed" })
    await expect(closePermitServer(db, "hs1", { projectId: "p1", permitId: "01" }, TODAY)).rejects.toMatchObject({ code: "BLOCKED", blocks: ["closed"] })
  })

  it("never an expired permit, never on an archived project, never another company's", async () => {
    mockDb.seed("projects/p1/pmPermits/02", { seq: 2, k: "exc", title: "Trench", who: "Sub", from: "2026-10-01", to: "2026-10-10", by: "hs1" })
    await expect(closePermitServer(db, "hs1", { projectId: "p1", permitId: "02" }, TODAY)).rejects.toMatchObject({ blocks: ["expired"] })
    await expect(closePermitServer(db, "x1", { projectId: "p1", permitId: "01" }, TODAY)).rejects.toMatchObject({ code: "NOT_FOUND" })
    mockDb.seed("projects/p1", { organizationId: "org1", projectManagerId: "pm1", pm: { lifecycle: "closed" } })
    await expect(closePermitServer(db, "org1", { projectId: "p1", permitId: "01" }, TODAY)).rejects.toBeInstanceOf(PermitCloseError)
  })

  it("the route: signed in, a valid body, the consistent error shape", async () => {
    const req = (body: unknown, token?: string) =>
      new Request("http://x/api/pm/permit-close", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }) as never
    expect((await POST(req({ projectId: "p1", permitId: "01" }))).status).toBe(401)
    expect((await POST(req({ projectId: "p1" }, "tok:hs1"))).status).toBe(400)
    const refused = await POST(req({ projectId: "p1", permitId: "01" }, "tok:se1"))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ error: true, code: "FORBIDDEN" })
    // The route closes on the Riyadh day — a permit running far ahead keeps the case date-proof.
    mockDb.seed("projects/p1/pmPermits/01", { seq: 1, k: "hot", title: "Roof", who: "Crew", from: "2026-10-20", to: "2099-12-31", by: "hs1" })
    const ok = await POST(req({ projectId: "p1", permitId: "01" }, "tok:hs1"))
    expect(await ok.json()).toMatchObject({ success: true, data: { closedOn: expect.any(String) } })
  })
})
