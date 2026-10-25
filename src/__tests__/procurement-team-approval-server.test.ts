/** @jest-environment node */
/**
 * Procurement 2.0 — the team-approval policy on the server (REQ-05, gap reports 01 IN-17 / 06 ST-02) over an in-memory Admin
 * Firestore: with the policy on a team «طلب مواد» waits (numbered, out of Incoming) for the owner or the site's manager; nobody
 * approves his own (the owner excepted, flagged); a return needs a reason; the requester withdraws or edits and sends again;
 * approving lands it in Incoming «جديدة» with its number and history; turning the policy off releases what waits; a request past
 * the window is escalated once. Also «طلباتي»'s RFQ deadline and the goods on their way (IN-15).
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

let mockDb = new FakeAdminDb()

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ name: "b", file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "b",
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("tok:")) throw new Error("bad token")
      return { uid: t.slice(4) }
    },
  }),
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "SERVER_TS", increment: (n: number) => ({ __inc: n }), arrayUnion: (v: unknown) => [v] } }))
jest.mock("@/lib/sms", () => ({
  isSmsConfigured: () => true,
  sendSms: async () => ({ sent: true }),
  sendWhatsApp: async () => ({ sent: true }),
  sendDirectMessage: async () => ({ sent: true }),
  normalizePhoneE164: (p: string | undefined | null) => (p ? String(p).replace(/\s/g, "") : null),
}))

import { GET as teamGet, POST as teamRoute } from "@/app/api/procurement/team-requests/route"
import { createTeamRequest, myRequests } from "@/lib/procurement/incoming-server"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { PROC_TEAM_APPROVALS, teamApprovalDocId, type TeamApprovalDoc, type TeamApprovalView } from "@/lib/procurement/team-approval"
import { approversOf, createPendingTeamRequest, decideTeamRequest, releaseWaiting, sweepTeamApprovals } from "@/lib/procurement/team-approval-server"
import type { Firestore } from "firebase-admin/firestore"

const ORG = "own"
const NOW = new Date("2026-10-21T08:00:00.000Z")
const db = () => mockDb as unknown as Firestore
const incoming = () => mockDb.list("procIncoming") as unknown as IncomingDoc[]
const approval = (id: string) => mockDb.get(`${PROC_TEAM_APPROVALS}/${teamApprovalDocId(ORG, id)}`) as unknown as TeamApprovalDoc
const notices = (uid: string) => mockDb.list(`users/${uid}/notifications`) as unknown as Array<{ type?: string; i18n?: { message: string; params?: Record<string, string> } }>
const as = (uid: string, body?: unknown) => new NextRequest("http://localhost/api/procurement/team-requests", { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", authorization: `Bearer tok:${uid}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const json = async (res: Response) => (await res.json()) as { success?: boolean; code?: string; data?: Record<string, unknown> }
const create = (uid: string, over: Record<string, unknown> = {}) => teamRoute(as(uid, { action: "create", lines: [{ name: "اسمنت", unit: "كيس", quantity: 5 }], needBy: "2099-01-01", place: { label: "موقع الملقا", city: "الرياض", district: "الملقا" }, ...over }))

beforeEach(() => {
  mockDb = new FakeAdminDb()
  mockDb.seed(`users/${ORG}`, { name: "المالك" })
  mockDb.seed("users/eng1", { organizationId: ORG, organizationRole: "member", name: "م. فهد" })
  mockDb.seed("users/mgr", { organizationId: ORG, organizationRole: "member", name: "مدير الموقع" })
  mockDb.seed("users/buyer", { organizationId: ORG, organizationRole: "member", name: "المشتري", defaultGroupId: "g-buy" })
  mockDb.seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept"], name: "buyers" })
  mockDb.seed(`companyModules/${ORG}`, { off: ["project-management"] })
  mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG, teamApproval: true, deliverySites: [{ id: "s1", kind: "site", name: "موقع الملقا", city: "الرياض", district: "الملقا", address: "", receiverId: null, managerId: "mgr" }] })
})

describe("who approves", () => {
  it("the owner, and the site's manager when the site names one in the company", async () => {
    expect((await approversOf(db(), ORG, "s1")).map((a) => [a.uid, a.role])).toEqual([[ORG, "owner"], ["mgr", "site"]])
    expect((await approversOf(db(), ORG, null)).map((a) => a.uid)).toEqual([ORG])
    mockDb.seed("users/mgr", { organizationId: "elsewhere", name: "x" })
    expect((await approversOf(db(), ORG, "s1")).map((a) => a.uid)).toEqual([ORG])
  })
})

describe("the policy on: a team request waits before Incoming", () => {
  it("is numbered, kept out of Incoming, and the approvers are told", async () => {
    const res = await json(await create("eng1", { siteId: "s1" }))
    expect(res.data).toMatchObject({ number: "MAT-2026/001", pending: true })
    expect(incoming()).toHaveLength(0)
    const id = String(res.data?.id).slice(5)
    expect(approval(id)).toMatchObject({ st: "wait", no: "MAT-2026/001", approvers: [{ uid: ORG }, { uid: "mgr" }] })
    expect(notices("mgr")[0]).toMatchObject({ i18n: { message: "pn_team_request_awaiting" } })
    expect(notices(ORG)[0]).toMatchObject({ i18n: { message: "pn_team_request_awaiting" } })
  })

  it("with the policy off (or Projects on) it goes straight to Incoming as before", async () => {
    mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG, teamApproval: false })
    const res = await json(await create("eng1"))
    expect(res.data?.pending).toBeUndefined()
    expect(incoming()).toHaveLength(1)
  })

  it("approve: lands in Incoming «جديدة» with its number and its history, approvedBy named; the buyers and the requester are told", async () => {
    const pending = await createPendingTeamRequest(db(), ORG, { uid: "eng1", name: "م. فهد" }, { lines: [{ name: "اسمنت", unit: "كيس", quantity: 5 }], needBy: "2099-01-01", siteId: "s1", place: { label: "موقع الملقا", city: "الرياض", district: "" }, note: null, requestedFor: { kind: "member", id: "eng1", name: "م. فهد" } }, NOW)
    const res = await decideTeamRequest(db(), ORG, { uid: "mgr", name: "مدير الموقع", isOwner: false }, { id: pending.id, kind: "approve" }, NOW)
    expect(typeof res).not.toBe("string")
    const landed = mockDb.get(`procIncoming/${incomingDocId(ORG, pending.mrKey)}`) as unknown as IncomingDoc
    expect(landed).toMatchObject({ no: "MAT-2026/001", src: "team", st: "new", approvedBy: { name: "مدير الموقع", on: "2026-10-21" } })
    expect(landed.log.map((e) => e.act)).toEqual(expect.arrayContaining(["created", "submitted", "approved"]))
    expect(approval(pending.id).st).toBe("appr")
    expect(notices("buyer").some((n) => n.i18n?.message === "pn_team_request_released")).toBe(true)
    expect(notices("eng1").some((n) => n.i18n?.message === "pn_team_request_approved")).toBe(true)
    // Decided once: a second approval is refused.
    expect(await decideTeamRequest(db(), ORG, { uid: ORG, name: "المالك", isOwner: true }, { id: pending.id, kind: "approve" }, NOW)).toBe("not_waiting")
  })

  it("nobody approves his own — the owner excepted, flagged; a member who is no approver is refused", async () => {
    const mine = await createPendingTeamRequest(db(), ORG, { uid: "mgr", name: "مدير الموقع" }, { lines: [{ name: "رمل", unit: "م³", quantity: 3 }], needBy: "2099-01-01", siteId: "s1", place: { label: "موقع الملقا", city: "الرياض", district: "" }, note: null, requestedFor: { kind: "member", id: "mgr", name: "مدير الموقع" } }, NOW)
    expect(await decideTeamRequest(db(), ORG, { uid: "mgr", name: "مدير الموقع", isOwner: false }, { id: mine.id, kind: "approve" }, NOW)).toBe("own_request")
    expect(await decideTeamRequest(db(), ORG, { uid: "buyer", name: "المشتري", isOwner: false }, { id: mine.id, kind: "approve" }, NOW)).toBe("not_approver")
    const owners = await createPendingTeamRequest(db(), ORG, { uid: ORG, name: "المالك" }, { lines: [{ name: "رمل", unit: "م³", quantity: 3 }], needBy: "2099-01-01", siteId: null, place: { label: "x", city: "الرياض", district: "" }, note: null, requestedFor: { kind: "member", id: ORG, name: "المالك" } }, NOW)
    const res = await decideTeamRequest(db(), ORG, { uid: ORG, name: "المالك", isOwner: true }, { id: owners.id, kind: "approve" }, NOW)
    expect(typeof res === "string" ? res : res.doc.decided).toMatchObject({ ownerSelf: true })
    expect(approval(owners.id).log.map((e) => e.act)).toContain("approved_own")
  })

  it("return needs a reason; the requester reads it, edits and sends again — it waits again — or withdraws", async () => {
    const created = await json(await create("eng1", { siteId: "s1" }))
    const id = String(created.data?.id).slice(5)
    expect((await teamRoute(as("mgr", { action: "return", id, code: "other", note: "x" }))).status).toBe(400)
    expect((await teamRoute(as("mgr", { action: "return", id, code: "qty", note: null }))).status).toBe(200)
    expect(approval(id)).toMatchObject({ st: "ret", returned: { why: "راجع الكميات", byName: "مدير الموقع" } })
    expect(notices("eng1").find((n) => n.i18n?.message === "pn_team_request_returned")?.i18n?.params).toMatchObject({ reason: "راجع الكميات" })
    // Only the requester sends it again.
    const again = { action: "resubmit", id, lines: [{ name: "اسمنت", unit: "كيس", quantity: 3 }], needBy: "2099-01-01", siteId: "s1", place: { label: "موقع الملقا", city: "الرياض", district: "" } }
    expect((await teamRoute(as("buyer", again))).status).toBe(403)
    expect((await teamRoute(as("eng1", again))).status).toBe(200)
    expect(approval(id)).toMatchObject({ st: "wait", returned: null, lines: [{ quantity: 3 }] })
    expect(approval(id).log.map((e) => e.act)).toEqual(["created", "submitted", "returned", "resubmitted"])
    expect((await teamRoute(as("eng1", { action: "withdraw", id: `team:${id}` }))).status).toBe(200)
    expect(approval(id).st).toBe("wd")
    expect(incoming()).toHaveLength(0)
  })

  it("GET: the approver sees what he decides, the buyer what is coming, the requester his own", async () => {
    await create("eng1", { siteId: "s1" })
    const view = async (uid: string) => ((await json(await teamGet(as(uid)))).data?.approvals || []) as TeamApprovalView[]
    expect((await view("mgr"))[0]).toMatchObject({ canDecide: true, mine: false, approvers: ["المالك", "مدير الموقع"] })
    expect((await view("buyer"))[0]).toMatchObject({ canDecide: false })
    expect((await view("eng1"))[0]).toMatchObject({ canDecide: false, mine: true })
    mockDb.seed("users/other", { organizationId: ORG, organizationRole: "member", name: "غيره" })
    expect(await view("other")).toEqual([])
  })
})

describe("the policy off releases; a long wait is escalated once", () => {
  it("turning the policy off releases what waits to Incoming, logged; a returned one stays with its requester", async () => {
    const a = await json(await create("eng1"))
    const b = await json(await create("eng1"))
    await teamRoute(as(ORG, { action: "return", id: String(b.data?.id).slice(5), code: "dup" }))
    // The owner may not release while the policy is still on.
    expect((await teamRoute(as(ORG, { action: "release" }))).status).toBe(409)
    mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG, teamApproval: false })
    expect((await teamRoute(as("eng1", { action: "release" }))).status).toBe(403)
    const res = await json(await teamRoute(as(ORG, { action: "release" })))
    expect(res.data).toMatchObject({ released: 1 })
    const landed = incoming()
    expect(landed.map((d) => d.mrKey)).toEqual([String(a.data?.id)])
    expect(landed[0].log.map((e) => e.act)).toContain("released_policy_off")
    expect(approval(String(b.data?.id).slice(5)).st).toBe("ret")
    expect(await releaseWaiting(db(), ORG, NOW)).toBe(0)
  })

  it("the daily sweep escalates a request waiting past the window to the owner ONCE, and releases where the policy is off", async () => {
    const p = await createPendingTeamRequest(db(), ORG, { uid: "eng1", name: "م. فهد" }, { lines: [{ name: "اسمنت", unit: "كيس", quantity: 5 }], needBy: "2099-01-01", siteId: null, place: { label: "x", city: "الرياض", district: "" }, note: null, requestedFor: { kind: "member", id: "eng1", name: "م. فهد" } }, new Date("2026-10-18T08:00:00.000Z"))
    expect(await sweepTeamApprovals(db(), new Date("2026-10-19T08:00:00.000Z"))).toEqual({ released: 0, escalated: 0 })
    expect(await sweepTeamApprovals(db(), NOW)).toEqual({ released: 0, escalated: 1 })
    expect(await sweepTeamApprovals(db(), NOW)).toEqual({ released: 0, escalated: 0 })
    expect(notices(ORG).filter((n) => n.i18n?.message === "pn_team_request_escalated")).toHaveLength(1)
    mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG, teamApproval: false })
    expect(await sweepTeamApprovals(db(), NOW)).toEqual({ released: 1, escalated: 0 })
    expect(approval(p.id).st).toBe("rel")
  })
})

describe("«طلباتي» — the RFQ's closing day and the goods on their way (IN-15)", () => {
  it("carries the RFQ deadline while in an RFQ, and the earliest open delivery notice on its order — never a price", async () => {
    mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG })
    const t = await createTeamRequest(db(), ORG, { uid: "eng1", name: "م. فهد" }, { lines: [{ name: "الاسمنت العادي", unit: "كيس", quantity: 200 }], needBy: "2026-11-10", siteId: null, place: { label: "مجمع", city: "الرياض", district: "" }, requestedFor: { kind: "member", id: "eng1", name: "م. فهد" } }, new Date("2026-10-18T08:00:00.000Z"))
    const id = t.mrKey.split(":")[1]
    const src = { kind: "team_request", purchaseRequestId: id }
    mockDb.seed("rfqs/1", { organizationId: ORG, status: "New", rfqNumber: "RFQ-2026/001", deadline: "2026-10-24", products: [{ name: "الاسمنت العادي", unitOfMeasure: "كيس", needSource: src, needLine: 0 }] })
    let mine = await myRequests(db(), ORG, "eng1", NOW)
    expect(mine[0]).toMatchObject({ step: "rfq", rfqNumber: "RFQ-2026/001", rfqDeadline: "2026-10-24", transitDate: null })
    mockDb.seed("rfqs/1", { ...(mockDb.get("rfqs/1") as object), status: "Awarded" })
    mockDb.seed("purchaseOrders/9", { organizationId: ORG, status: "accepted", docNumber: "PO-2026/9", rfqId: "1", supplierName: "مورد سري", promisedDate: "2026-11-02", totalExVat: 999, lines: [{ id: "l0", name: "x", unit: "u", quantity: 10, unitPrice: 77, accepted: 0, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 0 }] })
    mockDb.seed("deliveries/d1", { organizationId: ORG, poId: "9", status: "pending_confirmation", deliveryDate: "2026-10-29" })
    mockDb.seed("deliveries/d2", { organizationId: ORG, poId: "9", status: "pending_confirmation", deliveryDate: "2026-10-27" })
    mockDb.seed("deliveries/d3", { organizationId: ORG, poId: "9", status: "confirmed", deliveryDate: "2026-10-20" })
    mine = await myRequests(db(), ORG, "eng1", NOW)
    expect(mine[0]).toMatchObject({ step: "order", poNumber: "PO-2026/9", transitDate: "2026-10-27" })
    for (const secret of ["مورد سري", "999", "77"]) expect(JSON.stringify(mine)).not.toContain(secret)
  })
})
