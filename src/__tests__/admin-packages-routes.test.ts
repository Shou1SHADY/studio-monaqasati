/** @jest-environment node */
/**
 * Procurement 2.0, WF-22 / ADM-03 — the admin's side of a contractor's package: only the admin reads the impact and saves,
 * the impact is counted from the company's own records, a change that touches records is refused until acknowledged, the
 * save writes the switches, the need answers and one history entry per connector that changed, and saving twice changes
 * nothing. A new contractor starts on the base package with the connectors the admin ticked.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockPending = jest.fn()
const mockCreateUser = jest.fn()
const mockDeleteUser = jest.fn()

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (t === "admin") return { uid: "adm" }
      if (t === "contractor") return { uid: "con" }
      throw new Error("bad")
    },
    createUser: (...a: unknown[]) => mockCreateUser(...a),
    deleteUser: (...a: unknown[]) => mockDeleteUser(...a),
    generatePasswordResetLink: async () => "https://reset.example/x",
  }),
  getAdminFirestore: () => mockDb,
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))
jest.mock("@/lib/company-modules-pending-server", () => ({ loadPending: (...a: unknown[]) => mockPending(...a) }))
jest.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }), buildAccountCreatedEmail: () => ({ subject: "s", html: "h" }) }))
jest.mock("@/lib/materials/tree-server", () => ({ serverMaterialTree: async () => ({ subs: [{ id: "x" }] }) }))

import { GET as impact } from "@/app/api/admin/company-modules/impact/route"
import { POST as save } from "@/app/api/admin/company-modules/route"
import { POST as createUser } from "@/app/api/admin/users/create/route"

const ORG = "org1"
const get = (query: string, token = "admin") => new NextRequest(`http://localhost/api/admin/company-modules/impact?${query}`, { headers: { authorization: `Bearer ${token}` } })
const post = (body: unknown, token = "admin") => new NextRequest("http://localhost/api/admin/company-modules", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) })
const stored = () => mockDb.get(`companyModules/${ORG}`) as { off: string[]; needs?: Record<string, unknown>; history?: Array<Record<string, unknown>> } | undefined

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockPending.mockReset()
  mockPending.mockResolvedValue({})
  mockCreateUser.mockReset()
  mockCreateUser.mockResolvedValue({ uid: "newUid" })
  mockDb.seed("users/adm", { role: "Admin", name: "Admin A" })
  mockDb.seed("users/con", { role: "Contractor", name: "C", organizationId: ORG })
  mockDb.seed(`users/${ORG}`, { role: "Contractor", name: "Acme" })
})

describe("the impact route", () => {
  it("refuses anyone but the platform admin", async () => {
    expect((await impact(get(`orgId=${ORG}`, "contractor"))).status).toBe(403)
    expect((await impact(get(`orgId=${ORG}`, "nobody"))).status).toBe(401)
    expect((await impact(new NextRequest("http://localhost/x"))).status).toBe(401)
  })

  it("refuses a company that is not a contractor, and a missing orgId", async () => {
    mockDb.seed("users/sup1", { role: "Supplier" })
    expect((await impact(get("orgId=sup1"))).status).toBe(404)
    expect((await impact(get(""))).status).toBe(400)
  })

  it("a company is its owner's primary company or a secondary organisation, judged by its own role", async () => {
    // the owner is switched into a supplier company: his primary company is still a contractor
    mockDb.seed("users/u3", { role: "Supplier", primaryRole: "Contractor", organizationId: "org-s", organizationRole: "owner" })
    mockDb.seed("organizations/org-s", { role: "Supplier", ownerUserId: "u3" })
    mockDb.seed("organizations/org-c", { role: "Contractor", ownerUserId: "u3" })
    expect((await impact(get("orgId=u3"))).status).toBe(200)
    expect((await impact(get("orgId=org-c"))).status).toBe(200)
    expect((await impact(get("orgId=org-s"))).status).toBe(404)
  })

  it("counts the records of the staged change: closing Manufacturing names the unanswered question and the answer with a work order", async () => {
    mockDb.seed("manufacturingRequests/m1", { organizationId: ORG, status: "new", sourceKind: "project" })
    mockDb.seed("manufacturingRequests/m2", { organizationId: ORG, status: "accepted", sourceKind: "procurement", workOrderId: "wo1" })
    mockDb.seed("manufacturingRequests/other", { organizationId: "elsewhere", status: "new", sourceKind: "project" })
    const res = await impact(get(`orgId=${ORG}&off=manufacturing`))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { changes: Array<{ conn: string; to: string; impact: Record<string, number> }>; to: Record<string, boolean>; hrDependent: boolean } }
    expect(body.data.to).toEqual({ pm: true, fin: true, mfg: false })
    expect(body.data.changes).toEqual([{ conn: "mfg", to: "off", impact: { workshopAsksUnanswered: 1, workshopAnswersWithWorkOrder: 1 } }])
    expect(body.data.hrDependent).toBe(false)
  })

  it("closing Finance counts the orders awaiting payment and says HR goes with it", async () => {
    mockDb.seed("purchaseOrders/o1", { organizationId: ORG, status: "accepted", approvedAt: "2026-10-01T00:00:00Z", totalExVat: 100, vatRate: 0.15, lines: [] })
    mockDb.seed("purchaseOrders/o2", { organizationId: ORG, status: "closed", approvedAt: "2026-10-01T00:00:00Z", totalExVat: 100, vatRate: 0.15, lines: [] })
    const res = await impact(get(`orgId=${ORG}&off=payments`))
    const body = (await res.json()) as { data: { changes: Array<{ impact: Record<string, number> }>; hrDependent: boolean; off: string[] } }
    expect(body.data.changes[0].impact.ordersAwaitingPayment).toBe(1)
    expect(body.data.hrDependent).toBe(true)
    expect(body.data.off).toEqual(["hr", "payments"])
  })

  it("closing Projects counts the project requests across the company's projects, and flags a company over the 300-project cap", async () => {
    for (let i = 0; i < 301; i++) mockDb.seed(`projects/p${i}`, { organizationId: ORG, name: `P${i}` })
    mockDb.seed("projects/p0/purchaseRequests/r1", { status: "approved" })
    mockDb.seed("projects/p0/purchaseRequests/r2", { status: "approved", rfqId: "rfq1" })
    const res = await impact(get(`orgId=${ORG}&off=project-management`))
    const body = (await res.json()) as { data: { changes: Array<{ impact: Record<string, number> }>; projectsCapped: boolean; scanCap: number } }
    expect(body.data.changes[0].impact).toEqual({ projectRequestsOpen: 2, projectRequestsInFlight: 1 })
    expect(body.data.projectsCapped).toBe(true)
    expect(body.data.scanCap).toBe(300)
  })

  it("no staged list means no change: nothing to count", async () => {
    mockDb.seed(`companyModules/${ORG}`, { off: ["manufacturing"] })
    const body = (await (await impact(get(`orgId=${ORG}`))).json()) as { data: { changes: unknown[] } }
    expect(body.data.changes).toEqual([])
  })

  it("carries the module-level warnings of what the existing pending route counts", async () => {
    mockPending.mockResolvedValue({ manufacturing: [{ key: "notes", count: 4 }] })
    const body = (await (await impact(get(`orgId=${ORG}&off=manufacturing`))).json()) as { data: { warnings: Array<{ module: string; items: unknown[] }> } }
    expect(body.data.warnings).toEqual([{ module: "manufacturing", items: [{ key: "notes", count: 4 }] }])
  })
})

describe("the save route", () => {
  it("refuses anyone but the platform admin and a non-contractor company", async () => {
    expect((await save(post({ orgId: ORG, off: [] }, "contractor"))).status).toBe(403)
    mockDb.seed("users/sup1", { role: "Supplier" })
    expect((await save(post({ orgId: "sup1", off: [] }))).status).toBe(404)
    expect((await save(post({ orgId: "a/b", off: [] }))).status).toBe(400)
    expect(mockDb.writes.filter(([p]) => p.startsWith("companyModules"))).toHaveLength(0)
  })

  it("a change that touches no record saves without an acknowledgement and leaves one history entry per connector, done at once", async () => {
    const res = await save(post({ orgId: ORG, off: ["manufacturing"], needs: { pm: 1, fin: 1, mfg: 0 } }))
    expect(res.status).toBe(200)
    expect(stored()).toMatchObject({ organizationId: ORG, off: ["manufacturing"], needs: { pm: 1, fin: 1, mfg: 0 }, updatedById: "adm", updatedByName: "Admin A" })
    expect(stored()?.history).toHaveLength(1)
    expect(stored()?.history?.[0]).toMatchObject({ connector: "mfg", to: "off", byId: "adm", state: "done", applied: {} })
  })

  it("a change that touches records is refused until the admin acknowledges it, then saves", async () => {
    mockDb.seed("manufacturingRequests/m1", { organizationId: ORG, status: "new", sourceKind: "project" })
    const refused = await save(post({ orgId: ORG, off: ["manufacturing"] }))
    expect(refused.status).toBe(409)
    const body = (await refused.json()) as { code: string; data: { changes: Array<{ impact: Record<string, number> }> } }
    expect(body.code).toBe("ACK_REQUIRED")
    expect(body.data.changes[0].impact.workshopAsksUnanswered).toBe(1)
    expect(stored()).toBeUndefined()
    const saved = await save(post({ orgId: ORG, off: ["manufacturing"], ack: true }))
    expect(saved.status).toBe(200)
    expect(stored()?.off).toEqual(["manufacturing"])
  })

  it("closing Finance saves HR off with it, whatever the screen sent", async () => {
    const res = await save(post({ orgId: ORG, off: ["payments"], ack: true }))
    expect(res.status).toBe(200)
    expect(stored()?.off).toEqual(["hr", "payments"])
  })

  it("saving the same package again changes nothing and adds no history", async () => {
    await save(post({ orgId: ORG, off: ["manufacturing"], needs: { mfg: 0 } }))
    const writes = mockDb.writes.length
    const again = await save(post({ orgId: ORG, off: ["manufacturing"], needs: { mfg: 0 } }))
    expect(((await again.json()) as { data: { unchanged: boolean } }).data.unchanged).toBe(true)
    expect(mockDb.writes).toHaveLength(writes)
    expect(stored()?.history).toHaveLength(1)
  })

  it("answers to the need questions alone are saved without touching the switches or the history", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["hr"], history: [] })
    const res = await save(post({ orgId: ORG, off: ["hr"], needs: { pm: 1 } }))
    expect(res.status).toBe(200)
    expect(stored()).toMatchObject({ off: ["hr"], needs: { pm: 1 }, history: [] })
  })

  it("the subscription status alone (Trial / Active, AD-03) is saved without touching the switches or the history", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["hr"], history: [] })
    const res = await save(post({ orgId: ORG, off: ["hr"], subscription: "trial" }))
    expect(res.status).toBe(200)
    expect(stored()).toMatchObject({ off: ["hr"], subscription: "trial", history: [] })
    const writes = mockDb.writes.length
    const again = await save(post({ orgId: ORG, off: ["hr"], subscription: "trial" }))
    expect(((await again.json()) as { data: { unchanged: boolean } }).data.unchanged).toBe(true)
    expect(mockDb.writes).toHaveLength(writes)
    await save(post({ orgId: ORG, off: ["hr"], subscription: "active" }))
    expect(stored()).toMatchObject({ subscription: "active" })
  })

  it("a save that does not name the subscription status leaves it as stored", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [], subscription: "trial" })
    await save(post({ orgId: ORG, off: ["manufacturing"] }))
    expect(stored()).toMatchObject({ off: ["manufacturing"], subscription: "trial" })
    expect((await save(post({ orgId: ORG, off: [], subscription: "paid" }))).status).toBe(400)
  })

  it("a trial gets its length from the save: the clock starts now and ends that many days later", async () => {
    const before = Date.now()
    const res = await save(post({ orgId: ORG, off: [], subscription: "trial", trialDays: 10 }))
    expect(res.status).toBe(200)
    const row = stored() as unknown as { subscription: string; trialDays: number; trialStartedAt: string; trialEndsAt: string }
    expect(row).toMatchObject({ subscription: "trial", trialDays: 10 })
    const start = Date.parse(row.trialStartedAt)
    expect(start).toBeGreaterThanOrEqual(before)
    expect(Date.parse(row.trialEndsAt) - start).toBe(10 * 86_400_000)
    expect((row as unknown as { trialEndsMs: number }).trialEndsMs).toBe(Date.parse(row.trialEndsAt))
  })

  it("choosing «trial» without a length uses the default, and a length alone means a trial", async () => {
    await save(post({ orgId: ORG, off: [], subscription: "trial" }))
    expect(stored()).toMatchObject({ subscription: "trial", trialDays: 14 })
    mockDb.docs.delete(`companyModules/${ORG}`)
    await save(post({ orgId: ORG, off: [], trialDays: 5 }))
    expect(stored()).toMatchObject({ subscription: "trial", trialDays: 5 })
  })

  it("saving a length on a running trial restarts it; saving without one leaves the dates as they were", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [], subscription: "trial", trialDays: 3, trialStartedAt: "2020-01-01T00:00:00.000Z", trialEndsAt: "2020-01-04T00:00:00.000Z" })
    await save(post({ orgId: ORG, off: ["manufacturing"] }))
    expect(stored()).toMatchObject({ trialEndsAt: "2020-01-04T00:00:00.000Z" })
    await save(post({ orgId: ORG, off: ["manufacturing"], trialDays: 30 }))
    const row = stored() as unknown as { trialStartedAt: string; trialEndsAt: string }
    expect(Date.parse(row.trialStartedAt)).toBeGreaterThan(Date.parse("2021-01-01"))
    expect(Date.parse(row.trialEndsAt) - Date.parse(row.trialStartedAt)).toBe(30 * 86_400_000)
  })

  it("going back to Active clears the dates; a length is refused with Active, or out of range", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [], subscription: "trial", trialDays: 3, trialStartedAt: "2020-01-01T00:00:00.000Z", trialEndsAt: "2020-01-04T00:00:00.000Z" })
    await save(post({ orgId: ORG, off: [], subscription: "active" }))
    expect(stored()).toMatchObject({ subscription: "active", trialDays: null, trialStartedAt: null, trialEndsAt: null, trialEndsMs: null })
    expect((await save(post({ orgId: ORG, off: [], subscription: "active", trialDays: 5 }))).status).toBe(400)
    expect((await save(post({ orgId: ORG, off: [], trialDays: 0 }))).status).toBe(400)
    expect((await save(post({ orgId: ORG, off: [], trialDays: 366 }))).status).toBe(400)
    expect((await save(post({ orgId: ORG, off: [], trialDays: 2.5 }))).status).toBe(400)
  })

  it("keeps the last twenty history entries and the earlier ones in order", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: Array.from({ length: 20 }, (_, i) => ({ id: `h${i}` })) })
    await save(post({ orgId: ORG, off: ["manufacturing"] }))
    const history = stored()?.history ?? []
    expect(history).toHaveLength(20)
    expect(history[0].id).toBe("h1")
    expect(history[19]).toMatchObject({ connector: "mfg" })
  })

  it("rejects a malformed body", async () => {
    expect((await save(post({ orgId: ORG, off: "payments" }))).status).toBe(400)
    expect((await save(post({ orgId: ORG, off: [], needs: { pm: 7 } }))).status).toBe(400)
  })
})

describe("a new contractor starts on the base package", () => {
  const create = (body: Record<string, unknown>) =>
    createUser(new NextRequest("http://localhost/api/admin/users/create", { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: "New Co", email: "n@x.sa", role: "Contractor", ...body }) }))

  it("with no connector named, all three are closed — and HR with Finance", async () => {
    const res = await create({})
    expect(res.status).toBe(200)
    expect((mockDb.get("companyModules/newUid") as { off: string[] }).off.slice().sort()).toEqual(["hr", "manufacturing", "payments", "project-management"])
  })

  it("the connectors the admin ticked stay on", async () => {
    await create({ connectors: { pm: true, fin: true } })
    expect((mockDb.get("companyModules/newUid") as { off: string[] }).off).toEqual(["manufacturing"])
  })

  it("the full package writes an empty list", async () => {
    await create({ connectors: { pm: true, fin: true, mfg: true } })
    expect((mockDb.get("companyModules/newUid") as { off: string[] }).off).toEqual([])
  })

  it("opened as a trial, the account starts its clock the moment it is created", async () => {
    const before = Date.now()
    const res = await create({ trialDays: 21 })
    expect(res.status).toBe(200)
    const row = mockDb.get("companyModules/newUid") as { subscription: string; trialDays: number; trialStartedAt: string; trialEndsAt: string }
    expect(row).toMatchObject({ subscription: "trial", trialDays: 21 })
    expect(Date.parse(row.trialStartedAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(row.trialEndsAt) - Date.parse(row.trialStartedAt)).toBe(21 * 86_400_000)
  })

  it("without a trial the account has no subscription fields; a bad length is refused before anything is created", async () => {
    await create({})
    expect(mockDb.get("companyModules/newUid")).not.toHaveProperty("subscription")
    mockCreateUser.mockClear()
    expect((await create({ trialDays: 0 })).status).toBe(400)
    expect((await create({ trialDays: 1000 })).status).toBe(400)
    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  it("a trial is for contractors only", async () => {
    const res = await createUser(
      new NextRequest("http://localhost/api/admin/users/create", { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: "S", email: "s@x.sa", role: "Supplier", specialtyIds: ["x"], trialDays: 7 }) }),
    )
    expect(res.status).toBe(400)
  })

  it("a supplier is not given a contractor's package", async () => {
    await createUser(
      new NextRequest("http://localhost/api/admin/users/create", { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: "S", email: "s@x.sa", role: "Supplier", specialtyIds: ["x"] }) }),
    )
    expect(mockDb.get("users/newUid")).toMatchObject({ role: "Supplier" })
    expect(mockDb.get("companyModules/newUid")).toBeUndefined()
  })
})

describe("a trial that cannot be written is not left open-ended", () => {
  const create = (body: Record<string, unknown>) =>
    createUser(new NextRequest("http://localhost/api/admin/users/create", { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: "New Co", email: "n@x.sa", role: "Contractor", ...body }) }))

  it("the account, its profile and the Auth user are undone, and the admin is told", async () => {
    const real = mockDb.collection.bind(mockDb)
    const spy = jest.spyOn(mockDb, "collection").mockImplementation((name: string) => {
      const c = real(name)
      if (name !== "companyModules") return c
      return { ...c, doc: (id: string) => ({ ...c.doc(id), set: async () => Promise.reject(new Error("write failed")) }) } as never
    })
    mockDeleteUser.mockClear()
    const res = await create({ trialDays: 7 })
    spy.mockRestore()
    expect(res.status).toBe(500)
    expect(mockDeleteUser).toHaveBeenCalledWith("newUid")
    expect(mockDb.get("users/newUid")).toBeUndefined()
  })

  it("without a trial a failed package write still leaves the account (the admin sets the package later)", async () => {
    const real = mockDb.collection.bind(mockDb)
    const spy = jest.spyOn(mockDb, "collection").mockImplementation((name: string) => {
      const c = real(name)
      if (name !== "companyModules") return c
      return { ...c, doc: (id: string) => ({ ...c.doc(id), set: async () => Promise.reject(new Error("write failed")) }) } as never
    })
    const res = await create({})
    spy.mockRestore()
    expect(res.status).toBe(200)
    expect(mockDb.get("users/newUid")).toMatchObject({ role: "Contractor" })
  })
})

describe("a supplier given the paid portal for a few days", () => {
  const create = (body: Record<string, unknown>) =>
    createUser(new NextRequest("http://localhost/api/admin/users/create", { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: "S Co", email: "s@x.sa", role: "Supplier", specialtyIds: ["x"], ...body }) }))

  it("gets the full plan with an end date; the clock starts at creation", async () => {
    const before = Date.now()
    const res = await create({ paidTrialDays: 7 })
    expect(res.status).toBe(200)
    const plan = mockDb.get("companyPlans/newUid") as { supplierPlan: string; planTrialDays: number; planTrialStartedAt: string; planTrialEndsAt: string }
    expect(plan).toMatchObject({ supplierPlan: "full", planTrialDays: 7 })
    expect(Date.parse(plan.planTrialStartedAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(plan.planTrialEndsAt) - Date.parse(plan.planTrialStartedAt)).toBe(7 * 86_400_000)
  })

  it("without it the supplier has no plan document (free by default); a contractor cannot be given a paid trial", async () => {
    await create({})
    expect(mockDb.get("companyPlans/newUid")).toBeUndefined()
    const res = await createUser(
      new NextRequest("http://localhost/api/admin/users/create", { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: "C", email: "c@x.sa", role: "Contractor", paidTrialDays: 7 }) }),
    )
    expect(res.status).toBe(400)
  })
})
