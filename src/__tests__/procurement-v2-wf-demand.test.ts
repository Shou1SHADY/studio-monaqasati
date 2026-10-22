/** @jest-environment node */
/**
 * Procurement 2.0 — the demand side WHOLE, across modules (QA pack 2/5, WF-01…WF-08, WF-26, WF-27, WF-28): a teammate's request and a
 * project's approved request arrive in «الواردة», the stores and the workshop answer before anything is bought, what is left is
 * published — one request in part, two requests together — onto a delivery place created from the editor, and then the RFQ is
 * cancelled (the lines go home), the buyer cannot buy a line (the requester is told with the reason), or a direct award above the
 * cap waits for the owner. One in-memory Admin Firestore; each module is the real one.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}
const mockSendSms = jest.fn(async (_m: { to: string; body: string }) => ({ sent: true }))
const mockSendWhatsApp = jest.fn(async (_m: { to: string; body: string }) => ({ sent: true }))

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (t === "bad") throw new Error("bad token")
      return { uid: t.replace(/^tok:/, "") }
    },
  }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ name: "bkt", file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "bkt",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => xs, serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }), delete: () => "DEL" } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1), permissionHolders: jest.fn(async () => []) }))
jest.mock("@/lib/sms", () => ({
  isSmsConfigured: () => true,
  sendSms: (m: { to: string; body: string }) => mockSendSms(m),
  sendWhatsApp: (m: { to: string; body: string }) => mockSendWhatsApp(m),
  sendDirectMessage: async () => ({ sent: true }),
  normalizePhoneE164: (p: string | undefined | null) => (p ? String(p).replace(/\s/g, "") : null),
}))

import { POST as incomingRoute } from "@/app/api/procurement/incoming/route"
import { POST as sitesRoute } from "@/app/api/procurement/delivery-sites/route"
import { POST as awardRoute } from "@/app/api/procurement/rfq/award/route"
import { POST as approveRoute } from "@/app/api/procurement/po/approve/route"
import { createSupplierOffer } from "@/lib/supplier-offer-server"
import { createTeamRequest, failIncoming, myRequests, notifyFailed, syncIncoming } from "@/lib/procurement/incoming-server"
import { incomingDocId, lineBuyQty, replyClockOf, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { publishRfq, publishSchema, type PublishInput } from "@/lib/procurement/rfq-server/publish"
import { runLifecycle, lifecycleSchema, type LifecycleInput } from "@/lib/procurement/rfq-server/lifecycle"
import { DEFAULT_RESOLVED_POLICIES } from "@/lib/procurement/policies"
import { WORKSHOP_MAKE_SUBS } from "@/lib/procurement/stock-check"
import { incomingNeed } from "@/lib/procurement/incoming-need"
import { incomingFromNeed } from "@/lib/procurement/rfq-editor"
import type { MaterialPick } from "@/lib/materials/types"
import type { RfqCaller } from "@/lib/procurement/rfq-server/common"
import type { Firestore } from "firebase-admin/firestore"

type Doc = Record<string, any>
const ORG = "org1"
const NOW = new Date("2026-10-22T09:00:00Z")
const ASKED = new Date("2026-10-21T08:00:00Z")
jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })

const db = () => mockDb as unknown as Firestore
const can = (...ps: string[]) => (p: string) => ps.includes(p)
const person = (uid: string, orgId: string, name: string, perms: string[] | "all") => ({ uid, orgId, name, can: perms === "all" ? () => true : can(...perms) })
const BUYER: RfqCaller = { uid: "buyer", name: "ريم", orgId: ORG, can: can("offers.accept", "po.expedite", "rfq.manage") }
const clockNow = replyClockOf(NOW, DEFAULT_RESOLVED_POLICIES)

const stone = (): MaterialPick => ({ nodeId: WORKSHOP_MAKE_SUBS[0], subId: WORKSHOP_MAKE_SUBS[0], rootId: "floors", path: [{ ar: "الارضيات", en: "Floors" }], specs: [] })
const product = (name: string, quantity: number, unit: string, over: Doc = {}) => ({
  name,
  quantity,
  unitOfMeasure: unit,
  category: "حديد",
  subCategory: "اسياخ",
  material: { nodeId: `n-${name}`, subId: "s1", rootId: "r1", path: [{ ar: "حديد", en: "Steel" }], specs: [] },
  deliveryCity: "الرياض",
  ...over,
})
const publish = (products: Doc[], over: Partial<PublishInput> & Doc = {}) =>
  publishRfq(
    db(),
    BUYER,
    publishSchema.parse({ title: "طلب عروض", audience: "public", deadline: "2026-10-30", pricing: "line", doc: { products, city: "الرياض", subCategoryIds: ["s1"] }, reach: { count: 2, orgIds: [] }, ...over }),
    NOW
  )

const doc = (mrKey: string) => mockDb.get(`procIncoming/${incomingDocId(ORG, mrKey)}`) as unknown as IncomingDoc
const sourceOf = (mrKey: string) => {
  const [kind, a, b] = mrKey.split(":")
  return kind === "team" ? { kind: "team_request", purchaseRequestId: a } : { kind: "project_request", projectId: a, purchaseRequestId: b }
}
const req = (route: string, user: string, body: unknown) =>
  new NextRequest(`http://localhost/api/procurement/${route}`, { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) })
const call = async (route: (r: NextRequest) => Promise<Response>, path: string, user: string, body: unknown) => {
  const res = await route(req(path, user, body))
  return { status: res.status, json: (await res.json()) as { success?: boolean; data?: Doc; code?: string; reason?: string } }
}
const notes = (uid: string) => mockDb.list(`users/${uid}/notifications`) as Doc[]
const orders = () => mockDb.list("purchaseOrders") as Doc[]
const by = { uid: "eng1", name: "م. فهد" }
const raise = (lines: Array<{ name: string; unit: string; quantity: number; material?: MaterialPick }>, now = ASKED, over: Doc = {}) =>
  createTeamRequest(db(), ORG, by, { lines, needBy: "2026-11-22", siteId: null, place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" }, requestedFor: { kind: "member", id: "eng1", name: "م. فهد" }, ...over } as never, now)

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockSendSms.mockClear()
  mockSendWhatsApp.mockClear()
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, ORG, "المالك", "all"),
    buyer: person("buyer", ORG, "ريم", ["offers.accept", "po.expedite", "rfq.manage"]),
    mgr: person("mgr", ORG, "منى", ["offers.accept", "po.approve", "po.expedite"]),
    keeper: person("keeper", ORG, "أمين", ["warehouses.manage"]),
    lead: person("lead", ORG, "رئيس الورشة", ["manufacturing.manage"]),
  })
  mockDb.seed(`users/${ORG}`, { organizationId: ORG, name: "المالك", companyName: "البنيان الحديثة" })
  mockDb.seed("users/eng1", { organizationId: ORG, organizationRole: "member", name: "م. فهد" })
  for (const uid of ["buyer", "keeper", "lead", "mgr"]) {
    mockDb.seed(`teamGroups/g-${uid}`, { organizationId: ORG, name: uid, permissions: (mockCallers[uid] as { can: (p: string) => boolean }) ? [] : [] })
    mockDb.seed(`users/${uid}`, { organizationId: ORG, organizationRole: "member", name: uid, defaultGroupId: `g-${uid}` })
  }
  mockDb.seed("teamGroups/g-buyer", { organizationId: ORG, name: "buyer", permissions: ["rfq.manage", "offers.accept"] })
  mockDb.seed("teamGroups/g-keeper", { organizationId: ORG, name: "keeper", permissions: ["warehouses.manage"] })
  mockDb.seed("teamGroups/g-lead", { organizationId: ORG, name: "lead", permissions: ["manufacturing.manage"] })
  mockDb.seed("warehouses/w1", { organizationId: ORG, name: "المستودع المركزي" })
  mockDb.seed(`companyModules/${ORG}`, { off: ["project-management"] })
})

describe("WF-01 / WF-02 — the request comes in numbered, the requester follows it, and one filed for a person with no account tells him by SMS only", () => {
  it("a teammate's request is MAT-numbered, asked of the stores at once (proc:ISS), and he reads «تم الاستلام» with no price", async () => {
    const t = await raise([{ name: "الاسمنت العادي", unit: "كيس", quantity: 200 }])
    expect(doc(t.mrKey)).toMatchObject({ src: "team", st: "new", no: "MAT-2026/001", requestedById: "eng1" })
    expect(mockDb.list("procEvents").map((e) => String(e.id))).toContain(`org1__proc:ISS:${t.mrKey.replace(/:/g, ".")}:1`)
    const mine = await myRequests(db(), ORG, "eng1", NOW)
    expect(mine[0]).toMatchObject({ no: "MAT-2026/001", step: "placed" })
    expect(JSON.stringify(mine)).not.toMatch(/price|supplier|unitPrice/)
  })

  it("WF-02 — a receiver without an account gets the SMS and never WhatsApp", async () => {
    mockDb.seed("procurementReceivers/r1", { organizationId: ORG, name: "سالم القحطاني", phone: "+966500000001", active: true })
    const res = await call(
      (r) => import("@/app/api/procurement/team-requests/route").then((m) => m.POST(r)),
      "team-requests",
      ORG,
      { action: "create", lines: [{ name: "رمل لياسة", unit: "م³", quantity: 12 }], needBy: "2099-01-01", place: { label: "الخرج", city: "الخرج", district: "" }, requestedFor: { kind: "receiver", id: "r1" } }
    )
    expect(res.status).toBe(200)
    expect(mockSendSms).toHaveBeenCalledWith(expect.objectContaining({ to: "+966500000001" }))
    expect(mockSendWhatsApp).not.toHaveBeenCalled()
  })
})

describe("WF-03 — a project's approved request arrives whole, and a closed connector brings in nothing new (B-13)", () => {
  const pmRequest = (id = "03") =>
    mockDb.seed(`projects/P1/purchaseRequests/${id}`, {
      pm: true,
      seq: 3,
      title: "بلوك الدور الثاني",
      status: "approved",
      needBy: "2026-11-11",
      requestedByUserId: "eng1",
      requestedByUserName: "م. فهد العتيبي",
      approvedByName: "م. خالد",
      approvedOn: "2026-10-20",
      createdAt: "2026-10-19T08:00:00.000Z",
      lines: [{ itemId: "i1", code: "04-01-01", key: "k1", name: "بلك اسمنتي مفرغ 20", unit: "حبة", qty: 2000 }],
      items: [{ name: "بلك اسمنتي مفرغ 20", unit: "حبة", quantity: 2000, itemId: "i1" }],
    })

  it("brings it in once with its project, then publishes it: the line is linked and the request moves to «في عروض»", async () => {
    mockDb.seed("projects/P1", { organizationId: ORG, name: "مجمع الياسمين", location: "الرياض - حي الياسمين" })
    mockDb.seed(`companyModules/${ORG}`, { off: [] })
    pmRequest()
    expect((await syncIncoming(db(), ORG, { now: NOW })).created).toBe(1)
    await syncIncoming(db(), ORG, { now: NOW })
    expect(mockDb.list("procIncoming")).toHaveLength(1)
    expect(doc("pm:P1:03")).toMatchObject({ src: "pm", projectName: "مجمع الياسمين", st: "new" })
    const res = await publish([product("بلك اسمنتي مفرغ 20", 2000, "حبة", { needSource: sourceOf("pm:P1:03"), needLine: 0 })])
    expect(res.linkedRequests).toBe(1)
    expect(doc("pm:P1:03")).toMatchObject({ st: "rfq" })
    expect(doc("pm:P1:03").lines[0]).toMatchObject({ ps: "rfq", rfqId: res.id })
  })

  it("B-13 — with Projects out of the package a new project request is not brought in", async () => {
    mockDb.seed("projects/P1", { organizationId: ORG, name: "مجمع الياسمين" })
    pmRequest()
    expect((await syncIncoming(db(), ORG, { now: NOW })).created).toBe(0)
    expect(mockDb.list("procIncoming")).toHaveLength(0)
  })
})

describe("WF-04 / WF-05 — what the stores and the workshop already have is not bought; only the rest is published", () => {
  it("2,000 blocks: 500 issued from stock leave 1,500 to publish; the RFQ carries 1,500 and the line is in it", async () => {
    const t = await raise([{ name: "البلك الاسمنتي", unit: "حبة", quantity: 2000 }])
    expect((await call(incomingRoute, "incoming", "keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "part", give: 500, warehouseId: "w1", why: "الباقي غير متوفر" })).status).toBe(200)
    const buy = lineBuyQty(doc(t.mrKey).lines[0], clockNow)
    expect(buy).toBe(1500)
    const res = await publish([product("البلك الاسمنتي", buy, "حبة", { needSource: sourceOf(t.mrKey), needLine: 0 })])
    expect((mockDb.get(`rfqs/${res.id}`) as Doc).products[0].quantity).toBe(1500)
    expect(doc(t.mrKey).lines[0]).toMatchObject({ ps: "rfq", rfqId: res.id, stk: { st: "part", give: 500 } })
  })

  it("WF-05 — «نصنّع أم نشتري؟»: the workshop makes 300 of 380 stone; 80 are published; the buyer cannot answer for the workshop", async () => {
    const t = await raise([{ name: "أرضيات رخام بيج", unit: "م²", quantity: 380, material: stone() }])
    await call(incomingRoute, "incoming", "keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "none" })
    expect((await call(incomingRoute, "incoming", "buyer", { action: "ask-mfg", mrKey: t.mrKey, lines: [1] })).status).toBe(200)
    expect((await call(incomingRoute, "incoming", "buyer", { action: "mfg-reply", mrKey: t.mrKey, line: 1, kind: "part", make: 300, wo: "أت-2026/061" })).status).toBe(403)
    expect((await call(incomingRoute, "incoming", "lead", { action: "mfg-reply", mrKey: t.mrKey, line: 1, kind: "part", make: 300, wo: "أت-2026/061" })).status).toBe(200)
    const buy = lineBuyQty(doc(t.mrKey).lines[0], clockNow)
    expect(buy).toBe(80)
    const res = await publish([product("أرضيات رخام بيج", buy, "م²", { needSource: sourceOf(t.mrKey), needLine: 0 })])
    expect((mockDb.get(`rfqs/${res.id}`) as Doc).products[0].quantity).toBe(80)
  })
})

describe("WF-07 → WF-08 → WF-26 — two requests in one RFQ onto a new delivery place, and the cancelled RFQ gives the lines back", () => {
  it("one RFQ for the cement of two requests: both lines linked to it, the new place saved by the server and kept on the products, then cancelled — both requests are «جديدة» again with their lines free", async () => {
    const a = await raise([{ name: "الاسمنت العادي", unit: "كيس", quantity: 200 }])
    const b = await raise([{ name: "الاسمنت العادي", unit: "كيس", quantity: 100 }], ASKED, { place: { label: "مستودع الخرج", city: "الخرج", district: "الصناعية" } })
    await call(incomingRoute, "incoming", "buyer", { action: "proceed", mrKey: a.mrKey })
    await call(incomingRoute, "incoming", "buyer", { action: "proceed", mrKey: b.mrKey })

    const site = await call(sitesRoute, "delivery-sites", "mgr", { site: { kind: "warehouse", name: "مستودع الخرج", city: "الخرج", district: "الصناعية", address: "طريق الخرج", mapUrl: "maps.app.goo.gl/x" } })
    expect(site.status).toBe(200)
    const siteId = site.json.data?.site.id as string
    expect((mockDb.get(`procurementSettings/${ORG}`) as Doc).deliverySites.map((s: Doc) => s.id)).toContain(siteId)
    expect((await call(sitesRoute, "delivery-sites", "buyer", { site: { kind: "site", name: "x", city: "الرياض" } })).status).toBe(403)

    const res = await publish([
      product("الاسمنت العادي", 200, "كيس", { needSource: sourceOf(a.mrKey), needLine: 0, deliverySiteId: "prj-main", deliveryCity: "الرياض" }),
      product("الاسمنت العادي", 100, "كيس", { needSource: sourceOf(b.mrKey), needLine: 0, deliverySiteId: siteId, deliveryCity: "الخرج" }),
    ])
    expect(res.linkedRequests).toBe(2)
    expect((mockDb.get(`rfqs/${res.id}`) as Doc).products.map((p: Doc) => p.deliverySiteId)).toEqual(["prj-main", siteId])
    expect(doc(a.mrKey).lines[0]).toMatchObject({ ps: "rfq", rfqId: res.id })
    expect(doc(b.mrKey).lines[0]).toMatchObject({ ps: "rfq", rfqId: res.id })

    const cancelled = await runLifecycle(db(), BUYER, lifecycleSchema.parse({ action: "cancel", rfqId: res.id, code: "need" }) as LifecycleInput, NOW)
    expect(cancelled.count).toBe(2)
    for (const k of [a.mrKey, b.mrKey]) {
      expect(doc(k).st).toBe("new")
      expect(doc(k).lines[0].ps ?? null).toBeNull()
    }
    expect(mockDb.get(`rfqs/${res.id}`)).toMatchObject({ status: "Cancelled" })
  })
})

describe("WF-27 — «تعذّر الشراء»: the buyer closes what is left, names the reason and an alternative, and the requester is told", () => {
  it("only the lines still to buy close; the requester's notification carries the reason and the alternative; the request ends «تعذّر»", async () => {
    const t = await raise([{ name: "الاسمنت العادي", unit: "كيس", quantity: 200 }, { name: "حديد 16", unit: "طن", quantity: 12 }], new Date("2026-10-18T08:00:00Z"))
    await publish([product("حديد 16", 12, "طن", { needSource: sourceOf(t.mrKey), needLine: 1 })])
    const res = await failIncoming(db(), ORG, { uid: "buyer", name: "ريم" }, { mrKey: t.mrKey, code: "avail", alt: "مكافئ من الخرج" }, { now: NOW })
    expect(res).toMatchObject({ moved: true })
    await notifyFailed(db(), doc(t.mrKey), { uid: "buyer", name: "ريم" }, NOW.toISOString())
    expect(doc(t.mrKey).lines.map((l) => l.ps ?? null)).toEqual(["fail", "rfq"])
    expect(notes("eng1").some((n) => n.type === "team_request_declined" && JSON.stringify(n).includes("مكافئ من الخرج"))).toBe(true)
    const mine = await myRequests(db(), ORG, "eng1", NOW)
    expect(JSON.stringify(mine)).not.toMatch(/price|supplier/)
  })
})

describe("WF-28 — a direct award above the cap: the reason is asked, the supplier quotes privately, and the order waits for the owner alone", () => {
  const COMPANY = { uid: "ua", name: "سامي", orgId: "supA", company: "مصنع النور", approved: true, hasVat: true, field: { specs: ["حديد"], cities: ["الرياض"], subIds: ["s1"] } }
  beforeEach(() => {
    mockDb.seed("users/ua", { role: "Supplier", organizationId: "supA", name: "سامي" })
    mockDb.seed("users/supA", { role: "Supplier", isVerified: true, companyName: "مصنع النور", taxNumber: "300123456700003" })
    mockDb.seed("priceHistory/h1", { organizationId: ORG, materialKey: "حديد 16|طن", name: "حديد 16", unit: "طن", supplierOrgId: "s", supplierName: "S", price: 2800, day: "2026-09-01", kind: "po" })
  })

  it("over the cap without a reason is refused; with «مورّد وحيد» it publishes private to him; his quote is awarded and the order carries the tag and needs the owner", async () => {
    const direct = { audience: "direct" as const, directSupplierOrgId: "supA" }
    await expect(publish([product("حديد 16", 12, "طن")], { ...direct } as never)).rejects.toMatchObject({ code: "reason_required" })
    const res = await publish([product("حديد 16", 12, "طن")], { ...direct, directWhy: { code: "only" } } as never)
    expect(res).toMatchObject({ direct: true, dirOver: true, guestUrl: null })
    const rfq = mockDb.get(`rfqs/${res.id}`) as Doc
    expect(rfq).toMatchObject({ visibility: "private", allowedSupplierOrgIds: ["supA"], dirOver: true })

    const offer = await createSupplierOffer(mockDb as never, COMPANY, res.id, { lines: [{ rfqProductIndex: 0, unitPrice: 2750 }], validUntil: "2026-11-30" }, { now: NOW })
    const award = await call(awardRoute, "rfq/award", "buyer", { rfqId: res.id, picks: [{ li: 0, offerId: offer.id, rev: 1 }], lowComp: { code: "urgent" } })
    expect(award.status).toBe(200)
    const po = orders()[0]
    expect(po).toMatchObject({ status: "awaiting_approval", approverKind: "owner" })
    expect(po.tags?.directOver).toBeTruthy()
    const mgr = await call(approveRoute, "po/approve", "mgr", { poId: po.id })
    expect(mgr.status).toBeGreaterThanOrEqual(400)
    expect(mgr.json.reason).toBe("owner_only")
    expect((mockDb.get(`purchaseOrders/${po.id}`) as Doc).status).toBe("awaiting_approval")
    expect((await call(approveRoute, "po/approve", ORG, { poId: po.id })).status).toBe(200)
  })
})

describe("R-01 — «أضف من الواردة» takes the NET quantity and only what is still to be bought", () => {
  it("2,000 blocks with 500 issued from stock come into the editor as 1,500; the line already in an RFQ and the one still waiting for the stores do not come at all", async () => {
    const t = await raise([{ name: "البلك الاسمنتي", unit: "حبة", quantity: 2000 }, { name: "حديد 16", unit: "طن", quantity: 12 }, { name: "رمل لياسة", unit: "م³", quantity: 30 }])
    await call(incomingRoute, "incoming", "keeper", { action: "stock-reply", mrKey: t.mrKey, line: 1, kind: "part", give: 500, warehouseId: "w1", why: "الباقي غير متوفر" })
    await call(incomingRoute, "incoming", "keeper", { action: "stock-reply", mrKey: t.mrKey, line: 2, kind: "none" })
    await publish([product("حديد 16", 12, "طن", { needSource: sourceOf(t.mrKey), needLine: 1 })])
    const need = incomingNeed(doc(t.mrKey), clockNow)
    const taken = incomingFromNeed(need, [])
    expect(taken.lines.map((l) => [l.name, l.quantity])).toEqual([["البلك الاسمنتي", 1500]])
    expect(need.lines.map((l) => l.lineKind)).toEqual(["buy", "rfq", "wait"])
    expect(incomingFromNeed(need, [], null, new Set([0])).lines[0].quantity).toBe(1500)
  })
})
