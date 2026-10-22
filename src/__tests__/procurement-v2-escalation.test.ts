/** @jest-environment node */
/**
 * Procurement 2.0 — escalating a delivery nobody counted (TDY-05, §14, WP-S5-04). A notice forwarded to a receiver who has not counted
 * after the company's window (`escalateAfterDays`, 2 by default) shows red with «صعّد». The prototype's rule is `-n.date > escDays`: the
 * delivery day passed by MORE than the window. One press (or the daily job) sends it — once — to the site's project manager, or to the owner
 * without Projects (event `proc:PO:<no>:REP<n>:ESC`). A second press, or the job meeting it again, changes nothing and tells nobody twice.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({}),
  getStorageBucketName: () => "b",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))

import { POST as escalateRoute } from "@/app/api/procurement/notice/escalate/route"
import { daysUncounted, escalationTarget, needsEscalation } from "@/lib/procurement/escalation"
import { EscalationRefusal, escalateDelivery, runNoticeEscalation } from "@/lib/procurement/escalation-server"
import { noticeRows, noticeWait, type DeskDelivery } from "@/lib/procurement/receipt-desk"
import { resolvePolicies } from "@/lib/procurement/policies"
import { runReceiptWindow } from "@/lib/supplier-free/receipt-window"

const ORG = "org1"
const TODAY = new Date("2026-10-23T09:00:00Z")
const fwd = { linkId: "lk1", name: "سامي الدوسري", userId: "rcv", phoneMasked: "05••", byName: "ريم", at: "2026-10-19T08:00:00Z" }
const n = (over: Partial<DeskDelivery> = {}): DeskDelivery => ({ id: "d1", status: "pending_confirmation", deliveryDate: "2026-10-20T00:00:00.000Z", forwardedTo: fwd, ...over }) as DeskDelivery

describe("the window — strictly more than escalateAfterDays after the delivery day, forwarded, uncounted, not yet escalated", () => {
  it("day +2 is still inside a 2-day window; day +3 is past it", () => {
    expect(daysUncounted(n({ deliveryDate: "2026-10-21" }), TODAY)).toBe(2)
    expect(needsEscalation(n({ deliveryDate: "2026-10-21" }), TODAY, 2)).toBe(false)
    expect(needsEscalation(n({ deliveryDate: "2026-10-20" }), TODAY, 2)).toBe(true)
    expect(needsEscalation(n({ deliveryDate: "2026-10-20" }), TODAY, 5)).toBe(false)
  })

  it("never before the delivery day, never for an unforwarded notice, a confirmed one, a closed one or one already escalated", () => {
    expect(needsEscalation(n({ deliveryDate: "2026-10-30" }), TODAY, 2)).toBe(false)
    expect(daysUncounted(n({ deliveryDate: "2026-10-30" }), TODAY)).toBe(0)
    expect(needsEscalation(n({ forwardedTo: null }), TODAY, 2)).toBe(false)
    expect(needsEscalation(n({ status: "confirmed" }), TODAY, 2)).toBe(false)
    expect(needsEscalation(n({ closedByReceipt: { deliveryId: "x", docNumber: "GR-1" } }), TODAY, 2)).toBe(false)
    expect(needsEscalation(n({ escalation: { at: "2026-10-22T00:00:00Z", byId: "u", byName: "u", toKind: "owner", toUid: ORG } }), TODAY, 2)).toBe(false)
  })

  it("the hub row is red with the escalate act only past the window; the wait says who and since when", () => {
    const rows = noticeRows([n(), n({ id: "d2", deliveryDate: "2026-10-22T00:00:00.000Z" })], [], TODAY, 2)
    expect(rows.map((r) => [r.delivery.id, r.stage, r.escalate, r.uncounted])).toEqual([["d1", "count", true, 3], ["d2", "count", false, 1]])
    expect(noticeWait(n(), TODAY, 2)).toMatchObject({ kind: "with_receiver", name: "سامي الدوسري", days: 3, escalate: true, escalated: false })
    expect(resolvePolicies({}).escalateAfterDays).toBe(2)
  })

  it("who gets it: the project's manager with Projects on, the owner without Projects or for a site that names no manager", () => {
    expect(escalationTarget({ projectsOn: true, projectManagerId: "pm1", ownerId: ORG })).toEqual({ kind: "project_manager", uid: "pm1" })
    expect(escalationTarget({ projectsOn: false, projectManagerId: "pm1", ownerId: ORG })).toEqual({ kind: "owner", uid: ORG })
    expect(escalationTarget({ projectsOn: true, projectManagerId: null, ownerId: ORG })).toEqual({ kind: "owner", uid: ORG })
  })
})

const seed = (over: { delivery?: Record<string, unknown>; off?: string[] } = {}) => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockDb.seed("users/org1", { organizationId: ORG, name: "المالك" })
  mockDb.seed("users/pm1", { organizationId: ORG, organizationRole: "member" })
  mockDb.seed("users/exp", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-exp" })
  mockDb.seed("users/nobody", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-none" })
  mockDb.seed("teamGroups/g-exp", { organizationId: ORG, permissions: ["po.expedite"] })
  mockDb.seed("teamGroups/g-none", { organizationId: ORG, permissions: ["rfq.create"] })
  mockDb.seed("projects/p1", { organizationId: ORG, projectManagerId: "pm1", projectManagerName: "م. فهد" })
  mockDb.seed("purchaseOrders/po1", { organizationId: ORG, docNumber: "PO-2026/021", supplierName: "مصنع الجودة", projectId: "p1", status: "accepted", lines: [], log: [] })
  mockDb.seed("deliveries/d1", { contractorOrgId: ORG, status: "pending_confirmation", poId: "po1", poNumber: "PO-2026/021", supplierName: "مصنع الجودة", projectId: "p1", deliveryDate: "2026-10-20T00:00:00.000Z", seq: 2, forwardedTo: fwd, ...over.delivery })
  if (over.off) mockDb.seed("companyModules/org1", { off: over.off })
}
const asDb = mockDb as never

describe("the act — once, to the right person, with its event", () => {
  beforeEach(() => seed())

  it("with Projects it goes to the project manager: stamped on the delivery, the REP2 ESC event, one notice at his Today", async () => {
    const r = await escalateDelivery(asDb, { deliveryId: "d1", orgId: ORG, by: { uid: "exp", name: "ريم" } }, TODAY)
    expect(r).toMatchObject({ already: false, days: 3, escalation: { toKind: "project_manager", toUid: "pm1", toName: "م. فهد", byId: "exp" } })
    expect(mockDb.get("deliveries/d1")).toMatchObject({ escalation: { toKind: "project_manager", toUid: "pm1" } })
    expect(mockDb.get("procEvents/org1__proc:PO:PO-2026_021:REP2:ESC")).toMatchObject({ id: "po_escalate", key: "proc:PO:PO-2026/021:REP2:ESC" })
    expect(mockDb.list("users/pm1/notifications")).toEqual([expect.objectContaining({ type: "po_receipt_window_escalated", poId: "po1" })])
  })

  it("without Projects it goes to the owner", async () => {
    seed({ off: ["project-management"] })
    const r = await escalateDelivery(asDb, { deliveryId: "d1", orgId: ORG, by: { uid: "exp", name: "ريم" } }, TODAY)
    expect(r.escalation).toMatchObject({ toKind: "owner", toUid: ORG })
    expect(mockDb.list("users/org1/notifications")).toHaveLength(1)
    expect(mockDb.list("users/pm1/notifications")).toHaveLength(0)
  })

  it("is idempotent: the second press changes nothing and tells nobody again", async () => {
    await escalateDelivery(asDb, { deliveryId: "d1", orgId: ORG, by: { uid: "exp", name: "ريم" } }, TODAY)
    const again = await escalateDelivery(asDb, { deliveryId: "d1", orgId: ORG, by: { uid: "exp", name: "ريم" } }, TODAY)
    expect(again.already).toBe(true)
    expect(mockDb.list("users/pm1/notifications")).toHaveLength(1)
    expect(mockDb.list("procEvents")).toHaveLength(1)
  })

  it("is refused inside the window, for another company's delivery and for one nobody was told of", async () => {
    seed({ delivery: { deliveryDate: "2026-10-22T00:00:00.000Z" } })
    await expect(escalateDelivery(asDb, { deliveryId: "d1", orgId: ORG, by: { uid: "exp", name: "ريم" } }, TODAY)).rejects.toMatchObject({ code: "not_due", status: 409 })
    seed()
    await expect(escalateDelivery(asDb, { deliveryId: "d1", orgId: "other", by: { uid: "x", name: "x" } }, TODAY)).rejects.toMatchObject({ code: "not_yours" })
    seed({ delivery: { forwardedTo: null } })
    await expect(escalateDelivery(asDb, { deliveryId: "d1", orgId: ORG, by: { uid: "exp", name: "ريم" } }, TODAY)).rejects.toBeInstanceOf(EscalationRefusal)
  })

  it("reads the company's own window: a 5-day policy keeps a 3-day-old delivery inside", async () => {
    mockDb.seed(`procurementSettings/${ORG}`, { escalateAfterDays: 5 })
    await expect(escalateDelivery(asDb, { deliveryId: "d1", orgId: ORG, by: { uid: "exp", name: "ريم" } }, TODAY)).rejects.toMatchObject({ code: "not_due" })
  })
})

describe("the route — whoever follows deliveries up may press it; the requester may not", () => {
  const press = async (user: string, deliveryId = "d1") => {
    const res = await escalateRoute(new NextRequest("http://localhost/api/procurement/notice/escalate", { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify({ deliveryId }) }))
    return { status: res.status, json: (await res.json()) as { data?: { to: string; days: number; already: boolean }; code?: string } }
  }
  beforeEach(() => {
    seed()
    jest.useFakeTimers().setSystemTime(TODAY)
  })
  afterEach(() => jest.useRealTimers())

  it("an expediter: 200 with the target; a second press says already; a member with no follow-up permission: 403", async () => {
    const first = await press("exp")
    expect([first.status, first.json.data?.to, first.json.data?.already]).toEqual([200, "project_manager", false])
    expect((await press("exp")).json.data?.already).toBe(true)
    expect((await press("nobody")).status).toBe(403)
  })

  it("the owner may; a delivery inside the window is 409", async () => {
    seed({ delivery: { deliveryDate: "2026-10-22T00:00:00.000Z" } })
    const r = await press("org1")
    expect([r.status, r.json.code]).toEqual([409, "NOT_DUE"])
  })
})

describe("the daily job — the same act, at each company's own window, once", () => {
  beforeEach(() => seed())

  it("escalates what is past the window and leaves the rest; a second run finds nothing to do", async () => {
    mockDb.seed("deliveries/d2", { contractorOrgId: ORG, status: "pending_confirmation", poId: "po1", poNumber: "PO-2026/021", deliveryDate: "2026-10-22T00:00:00.000Z", seq: 3, forwardedTo: fwd })
    mockDb.seed("deliveries/d3", { contractorOrgId: ORG, status: "pending_confirmation", poId: "po1", poNumber: "PO-2026/021", deliveryDate: "2026-10-10T00:00:00.000Z", seq: 1 })
    const first = await runNoticeEscalation(asDb, TODAY)
    expect(first).toMatchObject({ open: 3, escalated: 1, failed: 0 })
    expect(mockDb.get("deliveries/d1")).toMatchObject({ escalation: { byId: "system" } })
    expect(mockDb.get("deliveries/d2")).not.toHaveProperty("escalation")
    expect(mockDb.get("deliveries/d3")).not.toHaveProperty("escalation")
    expect(await runNoticeEscalation(asDb, TODAY)).toMatchObject({ escalated: 0 })
    expect(mockDb.list("users/pm1/notifications")).toHaveLength(1)
  })

  it("the supplier-reported-delivery job now escalates at the same policy value (2 by default), and reminds at 2 whatever it is", async () => {
    const report = { id: "r1", at: "2026-10-20T08:00:00Z", date: "2026-10-20", note: null, byId: "su1", byName: "مورد", reminders: [] }
    mockDb.seed("purchaseOrders/po9", { organizationId: ORG, docNumber: "PO-2026/099", status: "accepted", supplierName: "م", preparedById: "buyer", lines: [], log: [], deliveryReports: [report] })
    mockDb.seed("users/buyer", { organizationId: ORG, organizationRole: "member" })
    const totals = await runReceiptWindow(asDb, TODAY)
    expect(totals).toMatchObject({ reminded: 1, escalated: 1 })
    mockDb.seed(`procurementSettings/${ORG}`, { escalateAfterDays: 5 })
    mockDb.seed("purchaseOrders/po9", { organizationId: ORG, docNumber: "PO-2026/099", status: "accepted", supplierName: "م", preparedById: "buyer", lines: [], log: [], deliveryReports: [report] })
    expect(await runReceiptWindow(asDb, TODAY)).toMatchObject({ reminded: 1, escalated: 0 })
  })
})
