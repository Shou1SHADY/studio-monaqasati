/** @jest-environment node */
/**
 * Procurement 2.0 — the package across modules (QA pack 2/5, WF-21, WF-22; B-02, B-03, B-09, B-13 in motion): the platform admin saves a
 * subscriber's package and the contractor's server acts obey it AT ONCE — opening Projects closes the team's «طلب مواد» but leaves the open
 * one open; closing Manufacturing closes «اسأل الورشة»; opening Finance takes the payment mark away from the buyer. And WF-21: without Finance the payment
 * is an optional status and a file for the accountant — it never stops the order closing — and the day Finance comes the same order waits for Finance's payment.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}
const mockEmails: Array<{ to: string; subject: string; html: string }> = []

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ name: "bkt", file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "bkt",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => xs, serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))
jest.mock("@/lib/company-modules-pending-server", () => ({ loadPending: async () => ({}) }))
jest.mock("@/lib/materials/tree-server", () => ({ serverMaterialTree: async () => ({ subs: [{ id: "x" }] }) }))
jest.mock("@/lib/email", () => ({
  sendEmail: async (m: { to: string; subject: string; html: string }) => {
    mockEmails.push(m)
    return { sent: true }
  },
}))
jest.mock("@/lib/sms", () => ({ isSmsConfigured: () => false, sendSms: async () => ({ sent: false }), sendWhatsApp: async () => ({ sent: false }), sendDirectMessage: async () => ({ sent: false }), normalizePhoneE164: (p: string | undefined | null) => (p ? String(p) : null) }))

import { POST as savePackage } from "@/app/api/admin/company-modules/route"
import { POST as teamRoute } from "@/app/api/procurement/team-requests/route"
import { POST as incomingRoute } from "@/app/api/procurement/incoming/route"
import { POST as paymentRoute } from "@/app/api/procurement/payment-mark/route"
import { POST as invoiceRoute } from "@/app/api/procurement/invoice-file/route"
import { POST as accountantRoute } from "@/app/api/procurement/to-accountant/route"
import { createTeamRequest, syncIncoming } from "@/lib/procurement/incoming-server"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { poState } from "@/lib/procurement/po-state"
import { packageOf } from "@/lib/procurement/package"
import { WORKSHOP_MAKE_SUBS } from "@/lib/procurement/stock-check"
import type { PurchaseOrder } from "@/lib/procurement/types"
import type { Firestore } from "firebase-admin/firestore"

type Doc = Record<string, any>
const ORG = "org1"
const NOW = new Date("2026-10-22T09:00:00Z")
jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })
const db = () => mockDb as unknown as Firestore
const can = (...ps: string[]) => (p: string) => ps.includes(p)
const person = (uid: string, name: string, perms: string[] | "all") => ({ uid, orgId: ORG, name, can: perms === "all" ? () => true : can(...perms) })

const post = async (route: (r: NextRequest) => Promise<Response>, url: string, user: string, body: unknown) => {
  const res = await route(new NextRequest(`http://localhost/api/${url}`, { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
  return { status: res.status, json: (await res.json()) as { success?: boolean; code?: string; data?: Doc } }
}
const incoming = () => mockDb.list("procIncoming") as unknown as IncomingDoc[]
const stone = { nodeId: WORKSHOP_MAKE_SUBS[0], subId: WORKSHOP_MAKE_SUBS[0], rootId: "floors", path: [{ ar: "الارضيات", en: "Floors" }], specs: [] }
const savePkg = (off: string[], extra: Doc = {}) => post(savePackage, "admin/company-modules", "adm", { orgId: ORG, off, ack: true, ...extra })
const modules = () => mockDb.get(`companyModules/${ORG}`) as { off: string[]; history?: Doc[] }

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockEmails.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, "المالك", "all"),
    buyer: person("buyer", "ريم", ["rfq.manage", "offers.accept"]),
    mgr: person("mgr", "منى", ["po.approve", "offers.accept"]),
    eng1: person("eng1", "م. فهد", []),
  })
  mockDb.seed("users/adm", { role: "Admin", name: "إدارة المنصة" })
  mockDb.seed(`users/${ORG}`, { role: "Contractor", organizationId: ORG, name: "المالك", companyName: "شركة البنيان" })
  mockDb.seed("users/eng1", { organizationId: ORG, organizationRole: "member", name: "م. فهد" })
  mockDb.seed("users/buyer", { organizationId: ORG, organizationRole: "member", name: "ريم", defaultGroupId: "g-buyer" })
  mockDb.seed("teamGroups/g-buyer", { organizationId: ORG, name: "buyer", permissions: ["rfq.manage", "offers.accept"] })
  mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management", "manufacturing"] })
  mockDb.seed("projects/P1", { organizationId: ORG, name: "مجمع الياسمين" })
  mockDb.seed("projects/P1/purchaseRequests/03", { pm: true, seq: 3, status: "approved", needBy: "2026-11-11", requestedByUserId: "eng1", requestedByUserName: "م. فهد", createdAt: "2026-10-19T08:00:00.000Z", lines: [{ itemId: "i1", code: "x", key: "k1", name: "بلك", unit: "حبة", qty: 100 }], items: [{ name: "بلك", unit: "حبة", quantity: 100, itemId: "i1" }] })
})

const teamBody = { action: "create", lines: [{ name: "رمل لياسة", unit: "م³", quantity: 5 }], needBy: "2099-01-01", place: { label: "المستودع", city: "الرياض", district: "" } }

describe("WF-22 — the admin saves a package and the contractor's server obeys at once", () => {
  it("opening Projects: the team's «طلب مواد» is refused from then on, the request already open stays open, and the project's requests start arriving", async () => {
    expect((await post(teamRoute, "procurement/team-requests", "eng1", teamBody)).status).toBe(200)
    expect(incoming().map((d) => d.src)).toEqual(["team"])

    const saved = await savePkg(["manufacturing"], { needs: { pm: 1, fin: 1, mfg: 0 } })
    expect(saved.status).toBe(200)
    expect(modules().off).toEqual(["manufacturing"])
    expect(packageOf(modules().off)).toEqual({ pm: true, fin: true, mfg: false })
    expect(modules().history?.length).toBeGreaterThan(0)

    const refused = await post(teamRoute, "procurement/team-requests", "eng1", teamBody)
    expect([refused.status, refused.json.code]).toEqual([409, "PROJECTS_ON"])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(incoming().map((d) => d.src).sort()).toEqual(["pm", "team"])
    const team = incoming().find((d) => d.src === "team") as IncomingDoc
    expect(team.st).toBe("new")
  })

  it("closing Projects again hides nothing already open and brings nothing new (B-13); the team's «طلب مواد» comes back", async () => {
    await savePkg(["manufacturing"])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(incoming().map((d) => d.mrKey)).toEqual(["pm:P1:03"])
    mockDb.seed("projects/P1/purchaseRequests/04", { pm: true, seq: 4, status: "approved", needBy: "2026-11-12", requestedByUserId: "eng1", requestedByUserName: "م. فهد", createdAt: "2026-10-20T08:00:00.000Z", lines: [{ itemId: "i1", code: "x", key: "k1", name: "إسمنت", unit: "كيس", qty: 50 }], items: [{ name: "إسمنت", unit: "كيس", quantity: 50, itemId: "i1" }] })
    await savePkg(["project-management", "manufacturing"])
    await syncIncoming(db(), ORG, { now: NOW })
    expect(incoming().map((d) => d.mrKey)).toEqual(["pm:P1:03"])
    expect((await post(teamRoute, "procurement/team-requests", "eng1", teamBody)).status).toBe(200)
  })

  it("opening Manufacturing opens «اسأل الورشة»; closing it closes the question again (B-04, B-05)", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management", "manufacturing"] })
    const made = await createTeamRequest(db(), ORG, { uid: "eng1", name: "م. فهد" }, { lines: [{ name: "أرضيات رخام بيج", unit: "م²", quantity: 380, material: stone as never }], needBy: "2026-11-22", siteId: null, place: { label: "مجمع الياسمين", city: "الرياض", district: "" }, requestedFor: { kind: "member", id: "eng1", name: "م. فهد" } }, NOW)
    const ask = () => post(incomingRoute, "procurement/incoming", "buyer", { action: "ask-mfg", mrKey: made.mrKey, lines: [1] })
    expect((await ask()).json.code).toBe("CONNECTOR_OFF")
    await savePkg(["project-management"])
    expect((await ask()).status).toBe(200)
    expect((mockDb.get(`procIncoming/${incomingDocId(ORG, made.mrKey)}`) as unknown as IncomingDoc).lines[0].mk).toMatchObject({ st: "ask" })
  })

  it("a save that changes nothing changes nothing, and a bad caller or company is refused", async () => {
    const before = mockDb.writes.length
    const same = await savePkg(["project-management", "manufacturing"])
    expect(same.status).toBe(200)
    expect(mockDb.writes.length).toBe(before)
    expect((await post(savePackage, "admin/company-modules", "buyer", { orgId: ORG, off: [] })).status).toBe(403)
    expect((await post(savePackage, "admin/company-modules", "adm", { orgId: "nobody", off: [] })).status).toBe(404)
  })
})

describe("WF-21 — without Finance the payment is a status and a file for the accountant", () => {
  const received = (over: Doc = {}) => ({
    organizationId: ORG,
    docNumber: "PO-2026/001",
    status: "accepted",
    approvedAt: "2026-10-12T08:00:00Z",
    supplierAcceptedAt: "2026-10-13T08:00:00Z",
    basis: "rfq",
    rfqId: "r1",
    supplierOrgId: "sup1",
    supplierName: "مصنع الجودة",
    lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 10, rejected: 0, held: 0, cancelled: 0 }],
    totalExVat: 30000,
    vatRate: 0.15,
    createdAt: "2026-10-10T08:00:00Z",
    log: [],
    ...over,
  })
  const state = (financeOn: boolean) => poState({ id: "po1", ...(mockDb.get("purchaseOrders/po1") as Doc) } as unknown as PurchaseOrder, { notices: [], financeOn, acceptanceDays: 1, now: NOW }).k

  beforeEach(() => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["payments", "hr"] })
    mockDb.seed("purchaseOrders/po1", received())
    mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG, accountantEmail: "accounts@example.sa" })
  })

  it("the buyer marks it «دُفع جزء»: recorded on the order, optional, and the order is complete anyway", async () => {
    expect(state(false)).toBe("done")
    const res = await post(paymentRoute, "procurement/payment-mark", "mgr", { poId: "po1", kind: "status", state: "part", day: "2026-10-20", amount: 10000, reference: "حوالة 4417" })
    expect(res.status).toBe(200)
    expect((mockDb.get("purchaseOrders/po1") as Doc).paymentMark).toMatchObject({ state: "part", day: "2026-10-20", amount: 10000, reference: "حوالة 4417" })
    expect(state(false)).toBe("done")
  })

  it("the supplier's invoice is a file on the order, and «أرسلها للمحاسب» sends that file — and no other address — to the accountant", async () => {
    const form = new FormData()
    form.set("poId", "po1")
    form.set("number", "INV-77")
    form.set("file", new File([new Uint8Array([37, 80, 68, 70])], "invoice.pdf", { type: "application/pdf" }))
    const up = await invoiceRoute(new NextRequest("http://localhost/api/procurement/invoice-file", { method: "POST", headers: { authorization: "Bearer mgr" }, body: form }))
    expect(up.status).toBe(200)
    const file = ((await up.json()) as { data: { file: { url: string; name: string } } }).data.file
    expect((mockDb.get("purchaseOrders/po1") as Doc).invoiceFiles).toHaveLength(1)

    const foreign = await post(accountantRoute, "procurement/to-accountant", "mgr", { kind: "invoice", poId: "po1", url: "https://evil.example/x.pdf", name: "x" })
    expect([foreign.status, foreign.json.code]).toEqual([400, "NOT_THIS_ORDER"])
    expect(mockEmails).toHaveLength(0)
    const sent = await post(accountantRoute, "procurement/to-accountant", "mgr", { kind: "invoice", poId: "po1", url: file.url, name: file.name })
    expect(sent.status).toBe(200)
    expect(mockEmails).toHaveLength(1)
    expect(mockEmails[0].to).toBe("accounts@example.sa")
    expect(mockEmails[0].html).toContain("PO-2026/001")
  })

  it("the day Finance is in the package the same order waits for Finance's payment (B-03) and the buyer's routes are shut (B-02)", async () => {
    await post(paymentRoute, "procurement/payment-mark", "mgr", { poId: "po1", kind: "status", state: "paid", day: "2026-10-20" })
    expect(state(false)).toBe("done")
    await savePkg([])
    expect(packageOf(modules().off).fin).toBe(true)
    expect(state(true)).toBe("unpaid")
    const again = await post(paymentRoute, "procurement/payment-mark", "mgr", { poId: "po1", kind: "status", state: "paid", day: "2026-10-21" })
    expect([again.status, again.json.code]).toEqual([409, "FINANCE_ON"])
    const send = await post(accountantRoute, "procurement/to-accountant", "mgr", { kind: "invoice", poId: "po1", url: "https://x/y.pdf", name: "y" })
    expect([send.status, send.json.code]).toEqual([409, "FINANCE_ON"])
  })
})
