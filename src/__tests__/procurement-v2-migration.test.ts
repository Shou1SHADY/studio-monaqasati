/** @jest-environment node */
/**
 * Procurement 2.0 — a package change is a MIGRATION of stored state, never a recomputation at read time (NFR-08, PKG-03/04, WF-22).
 * The admin saves a contractor's package; the job then stamps how in-flight orders end (`closeOn`), hands back the workshop questions
 * nobody will answer (once — re-opening revives nothing), and turns a closed connector's sites into ordinary ones. It never deletes a
 * document, never reopens a closed order, and running it again changes nothing. Ports qa_review R-34 and qa_boundary B-03 / B-13.
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
jest.mock("@/lib/company-modules-pending-server", () => ({ loadPending: async () => ({}) }))
jest.mock("@/lib/sms", () => ({
  isSmsConfigured: () => true,
  sendSms: async () => ({ sent: true }),
  sendWhatsApp: async () => ({ sent: true }),
  sendDirectMessage: async () => ({ sent: true }),
  normalizePhoneE164: (p: string | undefined | null) => (p ? String(p).replace(/\s/g, "") : null),
}))

import { POST as save } from "@/app/api/admin/company-modules/route"
import { POST as approve } from "@/app/api/procurement/po/approve/route"
import { POST as teamRoute } from "@/app/api/procurement/team-requests/route"
import { createTeamRequest, syncIncoming } from "@/lib/procurement/incoming-server"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { applyConnectorChange, applyPendingChanges, loadPackageSnapshot } from "@/lib/procurement/package-migration-server"
import { companyImpact } from "@/lib/procurement/package-impact-report"
import { planChange } from "@/lib/procurement/package-migration"
import { deliverySites, storedSites } from "@/lib/procurement/delivery-sites"
import { poState } from "@/lib/procurement/po-state"
import { closedByPayment, paidInFull, type PurchaseOrderX } from "@/lib/procurement/po-extras"
import type { PurchaseOrder } from "@/lib/procurement/types"
import type { Firestore } from "firebase-admin/firestore"

const ORG = "org1"
const NOW = new Date("2026-10-21T08:00:00.000Z")
const ASKED = new Date("2026-10-18T08:00:00.000Z")
const db = () => mockDb as unknown as Firestore
const incoming = () => mockDb.list("procIncoming") as unknown as IncomingDoc[]
const incDoc = (mrKey: string) => mockDb.get(`procIncoming/${incomingDocId(ORG, mrKey)}`) as unknown as IncomingDoc
const order = (id: string) => mockDb.get(`purchaseOrders/${id}`) as unknown as PurchaseOrderX & { closeOn?: string }
const stored = () => mockDb.get(`companyModules/${ORG}`) as { off: string[]; history: Array<Record<string, unknown>> }
const events = () => [...mockDb.docs].filter(([k]) => k.startsWith("procEvents/")).map(([, d]) => d) as unknown as Array<{ key: string; id: string }>

const req = (body: unknown) => new NextRequest("http://localhost/api/admin/company-modules", { method: "POST", headers: { authorization: "Bearer tok:adm", "content-type": "application/json" }, body: JSON.stringify(body) })
const saveOff = async (off: string[], ack = true) => {
  const res = await save(req({ orgId: ORG, off, ack }))
  return { status: res.status, json: (await res.json()) as { data?: { applied?: Record<string, Record<string, number>>; pending?: boolean; changed?: unknown[] } } }
}

const line = (over: Record<string, unknown> = {}) => ({ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 100, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const seedOrder = (id: string, over: Record<string, unknown> = {}) =>
  mockDb.seed(`purchaseOrders/${id}`, {
    organizationId: ORG,
    docNumber: `PO-2026/${id}`,
    status: "accepted",
    basis: "rfq",
    rfqId: null,
    offerId: null,
    supplierOrgId: "s1",
    supplierName: "مورد",
    isGuestSupplier: false,
    lines: [line()],
    totalExVat: 1000,
    vatRate: 0.15,
    approvedAt: "2026-10-01T08:00:00Z",
    approvedById: "mgr",
    sentAt: "2026-10-02T08:00:00Z",
    promisedDate: "2026-10-30",
    ver: 1,
    log: [],
    ...over,
  })

const pmRequest = (id: string, over: Record<string, unknown> = {}) =>
  mockDb.seed(`projects/P1/purchaseRequests/${id}`, {
    pm: true,
    seq: Number(id),
    title: "بلوك",
    status: "approved",
    needBy: "2026-11-11",
    requestedByUserId: "eng1",
    requestedByUserName: "م. فهد",
    approvedByName: "م. خالد",
    approvedOn: "2026-10-20",
    createdAt: "2026-10-19T08:00:00.000Z",
    lines: [{ itemId: "i1", code: "04", key: `k${id}`, name: `مادة ${id}`, unit: "حبة", qty: 100, inv: { k: "none", q: 0, kept: 100, on: "2026-10-20" } }],
    items: [{ name: `مادة ${id}`, unit: "حبة", quantity: 100, itemId: "i1" }],
    ...over,
  })

beforeEach(() => {
  mockDb = new FakeAdminDb()
  mockDb.seed("users/adm", { role: "Admin", name: "Admin A" })
  mockDb.seed(`users/${ORG}`, { role: "Contractor", organizationId: ORG, name: "المالك" })
  mockDb.seed("users/eng1", { organizationId: ORG, organizationRole: "member", name: "م. فهد", phone: "+966500000099" })
  mockDb.seed("projects/P1", { organizationId: ORG, name: "مجمع الياسمين", location: "الرياض - حي الياسمين" })
})

describe("NFR-08 · closing Project Management (B-13)", () => {
  it("an open project request and one already in an RFQ stay on the desk; the project's site becomes an ordinary site that keeps its project", async () => {
    pmRequest("03")
    pmRequest("04")
    mockDb.seed("rfqs/rfqX", { organizationId: ORG, status: "New", rfqNumber: "RFQ-2026/001", products: [{ name: "مادة 04", unitOfMeasure: "حبة", needSource: { kind: "project_request", projectId: "P1", purchaseRequestId: "04" }, needLine: 0 }] })
    await syncIncoming(db(), ORG, { now: NOW })
    expect(incoming().map((d) => d.mrKey).sort()).toEqual(["pm:P1:03", "pm:P1:04"])
    expect(incDoc("pm:P1:04").lines.every((l) => l.ps === "rfq")).toBe(true)
    mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG, deliverySites: [{ id: "prj_P1", kind: "project", name: "مجمع الياسمين", city: "الرياض", district: "الياسمين", address: "", receiverId: null, projectId: "P1" }] })
    mockDb.writes.length = 0

    const res = await saveOff(["project-management"])
    expect(res.status).toBe(200)
    await syncIncoming(db(), ORG, { now: NOW })

    expect(incoming().filter((d) => d.status === "open").map((d) => d.mrKey).sort()).toEqual(["pm:P1:03", "pm:P1:04"])
    expect(incDoc("pm:P1:04").lines.every((l) => l.ps === "rfq")).toBe(true)
    const sites = storedSites((mockDb.get(`procurementSettings/${ORG}`) as { deliverySites: unknown }).deliverySites)
    expect(sites).toEqual([expect.objectContaining({ id: "prj_P1", kind: "site", projectId: "P1" })])
    expect(deliverySites({ stored: sites, warehouses: [], projects: [], pmOn: false }).map((s) => s.id)).toEqual(["prj_P1"])
    expect(mockDb.writes.filter(([p]) => p.startsWith("projects/"))).toHaveLength(0)
    expect(stored().history[0]).toMatchObject({ connector: "pm", to: "off", state: "done", applied: { sitesConverted: 1 } })
  })

  it("B-13: the project sources disappear and the fallback appears — the team can now raise a «طلب مواد»", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [] })
    const asEng = (body: unknown) => new NextRequest("http://localhost/api/procurement/team-requests", { method: "POST", headers: { authorization: "Bearer tok:eng1", "content-type": "application/json" }, body: JSON.stringify(body) })
    const body = { action: "create", lines: [{ name: "اسمنت", unit: "كيس", quantity: 5 }], needBy: "2099-01-01", place: { label: "المستودع", city: "الرياض", district: "" } }
    expect((await teamRoute(asEng(body))).status).toBe(409)
    await saveOff(["project-management"])
    expect((await teamRoute(asEng(body))).status).toBe(200)
  })

  it("opening it links a manual site that carries a project's name, once", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management"], history: [] })
    mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG, deliverySites: [{ id: "s1", kind: "site", name: "مجمع الياسمين", city: "الرياض", district: "", address: "", receiverId: null }] })
    const first = await saveOff([])
    expect(first.json.data?.applied && Object.values(first.json.data.applied)[0]).toEqual({ sitesLinked: 1 })
    expect(storedSites((mockDb.get(`procurementSettings/${ORG}`) as { deliverySites: unknown }).deliverySites)[0]).toMatchObject({ id: "s1", kind: "site", projectId: "P1" })
  })
})

describe("NFR-08 · closing Manufacturing", () => {
  const ask = { st: "ask", at: ASKED.toISOString(), src: "proc", rv: 0, by: "buyer" }
  const answer = { st: "make", make: 12, wo: "WO-2026/052", at: ASKED.toISOString(), src: "proc", rv: 1, by: "buyer", on: ASKED.toISOString() }

  async function twoLines() {
    const made = await createTeamRequest(
      db(),
      ORG,
      { uid: "eng1", name: "م. فهد" },
      {
        lines: [{ name: "رخام", unit: "م²", quantity: 20 }, { name: "جرانيت", unit: "م²", quantity: 12 }],
        needBy: "2026-11-10",
        siteId: null,
        place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" },
        requestedFor: { kind: "member", id: "eng1", name: "م. فهد" },
      },
      ASKED
    )
    const d = incDoc(made.mrKey)
    mockDb.seed(`procIncoming/${incomingDocId(ORG, made.mrKey)}`, { ...d, lines: [{ ...d.lines[0], mk: ask }, { ...d.lines[1], mk: answer }] } as unknown as Record<string, unknown>)
    return made.mrKey
  }

  it("the unanswered question returns to the buyer once; the answer with a work order stays; re-opening revives neither", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [] })
    const mrKey = await twoLines()

    const closed = await saveOff(["manufacturing"])
    expect(closed.status).toBe(200)
    expect(incDoc(mrKey).lines[0].mk).toMatchObject({ st: "buy", auto: "closed" })
    expect(incDoc(mrKey).lines[1].mk).toMatchObject({ st: "make", wo: "WO-2026/052", make: 12 })
    expect(stored().history[0]).toMatchObject({ connector: "mfg", to: "off", state: "done", applied: { workshopAsksReturned: 1, workshopAnswersKept: 1 } })

    const reopened = await saveOff([])
    expect(reopened.status).toBe(200)
    await syncIncoming(db(), ORG, { now: NOW })
    expect(incDoc(mrKey).lines[0].mk).toMatchObject({ st: "buy", auto: "closed" })
    expect(incDoc(mrKey).lines[1].mk).toMatchObject({ st: "make", wo: "WO-2026/052" })
    expect(stored().history[1]).toMatchObject({ connector: "mfg", to: "on", state: "done", applied: {} })
  })

  it("a question already in an RFQ or an order is not the job's to touch", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [] })
    const mrKey = await twoLines()
    const d = incDoc(mrKey)
    mockDb.seed(`procIncoming/${incomingDocId(ORG, mrKey)}`, { ...d, lines: [{ ...d.lines[0], ps: "rfq", rfqId: "r1", rfqNumber: "RFQ-2026/1" }, d.lines[1]] } as unknown as Record<string, unknown>)
    await saveOff(["manufacturing"])
    expect(incDoc(mrKey).lines[0].mk).toMatchObject({ st: "ask" })
  })

  it("the workshop's own unanswered request is stamped returned, and the answer with a work order is left alone", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [] })
    mockDb.seed("manufacturingRequests/m1", { organizationId: ORG, status: "new", sourceKind: "project" })
    mockDb.seed("manufacturingRequests/m2", { organizationId: ORG, status: "accepted", sourceKind: "procurement", workOrderId: "wo1" })
    await saveOff(["manufacturing"])
    expect(mockDb.get("manufacturingRequests/m1")).toMatchObject({ status: "new", returned: true, returnedReason: "connector_closed" })
    expect(mockDb.get("manufacturingRequests/m2")).toEqual({ organizationId: ORG, status: "accepted", sourceKind: "procurement", workOrderId: "wo1" })
    const again = await saveOff([])
    expect(again.status).toBe(200)
    expect(mockDb.get("manufacturingRequests/m1")).toMatchObject({ returned: true })
  })
})

describe("NFR-08 · Finance: how an order ends is stamped on it", () => {
  const poCtx = { notices: [], financeOn: true, acceptanceDays: 1, now: NOW }
  const received = (over: Record<string, unknown> = {}) => ({ lines: [line({ accepted: 10 })], ...over })

  it("R-34 / B-03: opening Finance keeps the buyer's mark a reference — the order is stamped to close on payment, not closed, and still waits for Finance", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["hr", "payments"], history: [] })
    seedOrder("o7", received({ paymentMark: { state: "paid", day: "2026-10-05", byName: "المشتري", at: "2026-10-05T08:00:00Z" } }))
    const res = await saveOff(["hr"])
    expect(res.status).toBe(200)
    expect(order("o7")).toMatchObject({ status: "accepted", closeOn: "payment", paymentMark: { state: "paid" } })
    expect(order("o7").financePayments).toBeUndefined()
    expect(paidInFull(order("o7"))).toBe(false)
    expect(closedByPayment(order("o7"))).toBe(false)
    expect(poState(order("o7") as unknown as PurchaseOrder, poCtx)).toMatchObject({ k: "unpaid", who: "fin" })
    expect(stored().history[0]).toMatchObject({ connector: "fin", to: "on", state: "done", applied: { closeOnStamped: 1, commitmentsSent: 1 } })
    expect(events().filter((e) => e.id === "fin_commitment")).toHaveLength(1)
  })

  it("closing Finance stamps an order awaiting payment to close on receipt; a received one is then done, whatever the package says", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [] })
    seedOrder("a", { status: "approved", sentAt: null })
    seedOrder("b", { advancePercent: 30 })
    seedOrder("c", received())
    const res = await saveOff(["hr", "payments"])
    expect(res.status).toBe(200)
    for (const id of ["a", "b", "c"]) expect(order(id).closeOn).toBe("receipt")
    expect(poState(order("c") as unknown as PurchaseOrder, poCtx)).toMatchObject({ k: "done", who: "none" })
    expect(stored().history[0]).toMatchObject({ connector: "fin", to: "off", state: "done", applied: { closeOnStamped: 3 } })
  })

  it("a new approval takes the package of its moment, and an order approved before the stamp existed keeps the rule it always had", async () => {
    const asOwner = (poId: string) => new NextRequest("http://localhost/api/procurement/po/approve", { method: "POST", headers: { authorization: `Bearer tok:${ORG}`, "content-type": "application/json" }, body: JSON.stringify({ poId }) })
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [] })
    for (const id of ["n1", "n2"]) seedOrder(id, { status: "awaiting_approval", approvedAt: null, approvedById: null, sentAt: null, preparedById: "prep", approverKind: "manager" })
    expect((await approve(asOwner("n1"))).status).toBe(200)
    expect(order("n1").closeOn).toBe("payment")
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["hr", "payments"], history: [] })
    expect((await approve(asOwner("n2"))).status).toBe(200)
    expect(order("n2").closeOn).toBe("receipt")

    mockDb.seed("purchaseOrders/legacy", { organizationId: ORG, docNumber: "PO-2026/9", status: "accepted", basis: "rfq", supplierOrgId: "s", supplierName: "x", isGuestSupplier: false, totalExVat: 1, vatRate: 0.15, approvedAt: "2026-10-01T00:00:00Z", ...received(), log: [] })
    const legacy = order("legacy") as unknown as PurchaseOrder
    expect(legacy).not.toHaveProperty("closeOn")
    expect(poState(legacy, { ...poCtx, financeOn: true }).k).toBe("unpaid")
    expect(poState(legacy, { ...poCtx, financeOn: false }).k).toBe("done")
  })

  it("a closed, cancelled or unapproved order is never touched, in either direction", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [] })
    seedOrder("x1", { status: "closed", closedAt: "2026-10-10T00:00:00Z" })
    seedOrder("x2", { status: "cancelled" })
    seedOrder("x3", { status: "awaiting_approval", approvedAt: null })
    await saveOff(["hr", "payments"])
    await saveOff(["hr"])
    for (const id of ["x1", "x2", "x3"]) expect(order(id).closeOn).toBeUndefined()
    expect(order("x1").status).toBe("closed")
  })

  it("running the job again changes nothing", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [] })
    seedOrder("a")
    await saveOff(["hr", "payments"])
    const writes = mockDb.writes.length
    expect(await applyConnectorChange(db(), ORG, "fin", "off", { actor: { uid: "adm", name: "A" }, off: ["hr", "payments"] })).toEqual({})
    expect((await applyPendingChanges(db(), ORG, { actor: { uid: "adm", name: "A" } })).done).toEqual([])
    const again = await saveOff(["hr", "payments"])
    expect(again.json.data).toMatchObject({ unchanged: true })
    expect(mockDb.writes).toHaveLength(writes)
    expect(planChange(await loadPackageSnapshot(db(), ORG), "fin", "off").steps).toEqual([])
  })

  it("batches of 400: a company with a thousand live orders is stamped in three commits", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [] })
    for (let i = 0; i < 1000; i++) seedOrder(`b${i}`)
    mockDb.batches = 0
    await saveOff(["hr", "payments"])
    expect(mockDb.batches).toBe(3)
    expect(mockDb.list("purchaseOrders").every((o) => o.closeOn === "receipt")).toBe(true)
  })
})

describe("re-runnable by history id", () => {
  it("an entry left pending (the job failed) is run when the same package is saved again, and a finished one is never run twice", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["hr", "payments"], history: [{ id: "h1", connector: "fin", to: "off", state: "pending", applied: {} }] })
    seedOrder("a")
    const resumed = await saveOff(["hr", "payments"])
    expect(resumed.json.data).toMatchObject({ unchanged: true, applied: { h1: { closeOnStamped: 1 } } })
    expect(order("a").closeOn).toBe("receipt")
    expect(stored().history[0]).toMatchObject({ id: "h1", state: "done" })
    const writes = mockDb.writes.length
    await saveOff(["hr", "payments"])
    expect(mockDb.writes).toHaveLength(writes)
  })

  it("an entry the saved package has since put back the other way is superseded, never run against the opposite state", async () => {
    mockDb.seed(`companyModules/${ORG}`, { organizationId: ORG, off: [], history: [{ id: "h1", connector: "fin", to: "off", state: "pending", applied: {} }] })
    seedOrder("a")
    const run = await applyPendingChanges(db(), ORG, { actor: { uid: "adm", name: "A" } })
    expect(run.applied).toEqual({ h1: {} })
    expect(order("a").closeOn).toBeUndefined()
    expect(stored().history[0]).toMatchObject({ state: "done" })
  })
})

describe("the dry-run report over a company (scripts/package-impact.ts)", () => {
  it("counts, per closed connector, what the job would hand back — and writes nothing", async () => {
    pmRequest("03")
    mockDb.seed("manufacturingRequests/m1", { organizationId: ORG, status: "new", sourceKind: "project" })
    seedOrder("a")
    seedOrder("done", { status: "closed" })
    const before = mockDb.writes.length
    const report = companyImpact(await loadPackageSnapshot(db(), ORG), ["hr", "payments", "manufacturing"])
    expect(report).toMatchObject({ state: "pm", closed: ["fin", "mfg"], touches: 2 })
    expect(report.rows.find((r) => r.conn === "fin")).toMatchObject({ impact: { ordersAwaitingPayment: 1, advancesRequested: 0 }, steps: [{ kind: "stamp_close_on", orderIds: ["a"], closeOn: "receipt" }] })
    expect(report.rows.find((r) => r.conn === "mfg")?.impact).toEqual({ workshopAsksUnanswered: 1, workshopAnswersWithWorkOrder: 0 })
    expect(mockDb.writes).toHaveLength(before)
    expect(companyImpact(await loadPackageSnapshot(db(), ORG), [])).toMatchObject({ state: "full", closed: [], touches: 0 })
  })
})
