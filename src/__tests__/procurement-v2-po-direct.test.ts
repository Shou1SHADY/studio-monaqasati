/** @jest-environment node */
/**
 * Procurement 2.0 — NFR-01 / G-16 (WP-S1-11): the orders raised without an RFQ are the SERVER's. A direct purchase, an order on a price
 * agreement, a lump-sum service order, a retroactive order and a buyer's own small order each re-run the rules the screen showed and
 * store the approver class themselves: the limit INCLUDING VAT, the owner alone above it, a direct order over the cap with its reason
 * and the owner's hand, a retroactive order the owner's alone, a registered supplier who exists and is verified, a project and an
 * agreement that are the company's own. A browser can no longer write any of it (the ruleset has no create rule for orders).
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => (t === "bad" ? Promise.reject(new Error("bad")) : { uid: t }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "bkt",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))

import { POST as direct } from "@/app/api/procurement/po/direct/route"
import { POST as service } from "@/app/api/procurement/po/service/route"
import { POST as retroactive } from "@/app/api/procurement/po/retroactive/route"
import { POST as selfIssue } from "@/app/api/procurement/po/self-issue/route"
import { POST as approve } from "@/app/api/procurement/po/approve/route"
import type { PurchaseOrder } from "@/lib/procurement/types"

const ORG = "org1"
const can = (...ps: string[]) => (p: string) => ps.includes(p)
const person = (uid: string, orgId: string, name: string, perms: string[] | "all") => ({ uid, orgId, name, can: perms === "all" ? () => true : can(...perms) })

const req = (path: string, user: string, body: unknown) => new NextRequest(`http://localhost/api/procurement/po/${path}`, { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) })
type Json = { success?: boolean; data?: Record<string, unknown>; reason?: string; code?: string; params?: Record<string, unknown>; error?: boolean }
const run = async (route: (r: NextRequest) => Promise<Response>, path: string, user: string, body: Record<string, unknown>) => {
  const res = await route(req(path, user, body))
  return { status: res.status, json: (await res.json()) as Json }
}
const orders = () => mockDb.list("purchaseOrders") as unknown as Array<PurchaseOrder & Record<string, unknown>>
const only = () => orders()[0]

const directBody = (over: Record<string, unknown> = {}) => ({
  mode: "direct",
  title: "حديد",
  lines: [{ name: "حديد 12", unit: "طن", quantity: 1, unitPrice: 3000 }],
  supplier: { orgId: "sup1", name: "مصنع الجودة" },
  ...over,
})

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, ORG, "المالك", "all"),
    mgr: person("mgr", ORG, "منى", ["po.approve", "offers.accept", "po.expedite"]),
    clerk: person("clerk", ORG, "ريم", ["offers.accept", "po.expedite"]),
    viewer: person("viewer", ORG, "مشاهد", ["offers.view"]),
    stranger: person("stranger", "org2", "غريب", "all"),
  })
  mockDb.seed(`users/${ORG}`, { role: "Contractor", name: "المالك", companyName: "شركة المقاول" })
  mockDb.seed("users/sup1", { role: "Supplier", companyName: "مصنع الجودة", isVerified: true })
  mockDb.seed("users/supU", { role: "Supplier", companyName: "مورد غير موثّق", isVerified: false })
  mockDb.seed("projects/P1", { organizationId: ORG, name: "مجمع الياسمين" })
  mockDb.seed("projects/PX", { organizationId: "org2", name: "مشروع غريب" })
  mockDb.seed("priceAgreements/ag1", { organizationId: ORG, docNumber: "AG-2026/001", supplierOrgId: "sup1", supplierName: "مصنع الجودة", from: "2020-01-01", until: "2099-12-31", lines: [{ name: "حديد 12", unit: "طن", price: 3500 }], preparedById: "mgr", preparedByName: "منى", createdAt: "2026-01-01" })
  mockDb.seed("priceAgreements/ag2", { organizationId: "org2", docNumber: "AG-2026/009", supplierOrgId: "sup1", supplierName: "x", from: "2020-01-01", until: "2099-12-31", lines: [{ name: "حديد 12", unit: "طن", price: 1 }] })
})

describe("a direct purchase", () => {
  it("is born awaiting approval in the company's name, numbered from the yearly sequence, with the approver class the SERVER decides", async () => {
    const res = await run(direct, "direct", "clerk", directBody())
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ approverKind: "manager" })
    expect(only()).toMatchObject({
      organizationId: ORG,
      status: "awaiting_approval",
      basis: "direct",
      supplierOrgId: "sup1",
      supplierUserId: "sup1",
      supplierName: "مصنع الجودة",
      isGuestSupplier: false,
      totalExVat: 3000,
      vatRate: 0.15,
      shortCompetition: false,
      preparedById: "clerk",
      approverKind: "manager",
      termsList: [{ pct: 100, days: 30 }],
    })
    expect(only().docNumber).toMatch(/^PO-\d{4}\/001$/)
    expect((only().log as Array<{ action: string }>).map((l) => l.action)).toEqual(["created"])
    expect(mockDb.list("mfgCounters")).toHaveLength(1)
    expect((await run(direct, "direct", "clerk", directBody())).json.data?.docNumber).toMatch(/\/002$/)
  })

  it("G-16: the browser cannot choose its own approver class, company, total or number", async () => {
    await run(direct, "direct", "mgr", directBody({ approverKind: "manager", organizationId: "org2", totalExVat: 1, docNumber: "PO-1999/001", status: "approved", preparedById: "someone" }))
    expect(only()).toMatchObject({ organizationId: ORG, totalExVat: 3000, status: "awaiting_approval", preparedById: "mgr", approverKind: "owner" })
    expect(only().docNumber).not.toBe("PO-1999/001")
  })

  it("the preparer who could approve never approves his own — it goes to the owner", async () => {
    const res = await run(direct, "direct", "mgr", directBody())
    expect(res.json.data).toMatchObject({ approverKind: "owner" })
  })

  it("above the cap it needs its reason, then carries it as a tag and goes to the owner alone", async () => {
    const big = directBody({ lines: [{ name: "حديد 12", unit: "طن", quantity: 2, unitPrice: 3000 }] })
    const refused = await run(direct, "direct", "clerk", big)
    expect(refused.status).toBe(400)
    expect(refused.json.reason).toBe("reason_required")
    expect(orders()).toHaveLength(0)
    const ok = await run(direct, "direct", "clerk", { ...big, reason: "الوكيل الوحيد في المنطقة", reasonCode: "sole", approverKind: "manager" })
    expect(ok.status).toBe(200)
    expect(only()).toMatchObject({ approverKind: "owner", shortCompetition: true, awardReasonText: "الوكيل الوحيد في المنطقة", singleSourceReason: "sole", tags: { directOver: { why: "الوكيل الوحيد في المنطقة" } } })
    const manager = await run(approve, "approve", "mgr", { poId: only().id })
    expect(manager.json.reason).toBe("owner_only")
    expect((await run(approve, "approve", ORG, { poId: only().id })).status).toBe(200)
  })

  it("a registered supplier must exist as a supplier company and be verified; a company is never its own supplier", async () => {
    expect((await run(direct, "direct", "clerk", directBody({ supplier: { orgId: "supU", name: "x" } }))).json.reason).toBe("supplier_unverified")
    expect((await run(direct, "direct", "clerk", directBody({ supplier: { orgId: ORG, name: "x" } }))).json.reason).toBe("order_supplier_missing")
    expect((await run(direct, "direct", "clerk", directBody({ supplier: { orgId: "ghost", name: "x" } }))).json.reason).toBe("order_supplier_missing")
    expect((await run(direct, "direct", "clerk", directBody({ supplier: null }))).status).toBe(400)
    expect(orders()).toHaveLength(0)
    const guest = await run(direct, "direct", "clerk", directBody({ supplier: { name: "مؤسسة الحي" } }))
    expect(guest.status).toBe(200)
    expect(only()).toMatchObject({ supplierOrgId: "guest", isGuestSupplier: true, supplierUserId: null, supplierName: "مؤسسة الحي" })
  })

  it("a project that is not the company's is refused; the company's own is named on the order", async () => {
    expect((await run(direct, "direct", "clerk", directBody({ projectId: "PX" }))).status).toBe(403)
    expect(orders()).toHaveLength(0)
    await run(direct, "direct", "clerk", directBody({ projectId: "P1" }))
    expect(only()).toMatchObject({ projectId: "P1", projectName: "مجمع الياسمين" })
  })

  it("only whoever prepares orders raises one", async () => {
    expect((await run(direct, "direct", "viewer", directBody())).status).toBe(403)
    expect((await run(direct, "direct", "stranger", directBody())).json.data?.id).toBeDefined()
    expect(orders().every((o) => o.organizationId !== ORG)).toBe(true)
    const res = await direct(new NextRequest("http://localhost/api/procurement/po/direct", { method: "POST", body: "{}" }))
    expect(res.status).toBe(401)
  })

  it("a bad body is a 400, not a half-written order", async () => {
    expect((await run(direct, "direct", "clerk", directBody({ lines: [] }))).status).toBe(400)
    expect((await run(direct, "direct", "clerk", directBody({ lines: [{ name: "x", unit: "u", quantity: -1, unitPrice: 5 }] }))).status).toBe(400)
    expect((await run(direct, "direct", "clerk", directBody({ lines: [{ name: "x", unit: "u", quantity: 1, unitPrice: 99999999999 }] }))).status).toBe(400)
    expect(orders()).toHaveLength(0)
  })

  it("a line with no price is refused by name", async () => {
    const res = await run(direct, "direct", "clerk", directBody({ lines: [{ name: "حديد 12", unit: "طن", quantity: 1, unitPrice: null }] }))
    expect(res.json).toMatchObject({ reason: "price_missing", params: { item: "حديد 12" } })
  })
})

describe("an order on a price agreement", () => {
  const body = (over: Record<string, unknown> = {}) => ({ mode: "agreement", title: "حديد", lines: [{ name: "حديد 12", unit: "طن", quantity: 2, unitPrice: null }], agreementId: "ag1", callOffs: true, deliverBy: "2099-06-01", ...over })

  it("takes the agreement's supplier and prices, never above the direct cap's reason, and delivers in call-offs", async () => {
    const res = await run(direct, "direct", "clerk", body())
    expect(res.status).toBe(200)
    expect(only()).toMatchObject({ agreementId: "ag1", agreementNo: "AG-2026/001", supplierOrgId: "sup1", totalExVat: 7000, noOfficialQuote: false, shortCompetition: false, approverKind: "manager", deliveryMode: "calloff", requestedDeliveryDate: "2099-06-01" })
  })

  it("G-18: the limit is compared INCLUDING VAT — 140,000 before VAT is the owner's, not the manager's", async () => {
    const res = await run(direct, "direct", "clerk", body({ lines: [{ name: "حديد 12", unit: "طن", quantity: 40, unitPrice: null }] }))
    expect(only().totalExVat).toBe(140000)
    expect(res.json.data).toMatchObject({ approverKind: "owner" })
  })

  it("another company's agreement, a lapsed one and a line it does not cover are refused", async () => {
    expect((await run(direct, "direct", "clerk", body({ agreementId: "ag2" }))).json.reason).toBe("agreement_not_live")
    mockDb.seed("priceAgreements/ag3", { organizationId: ORG, docNumber: "AG-2026/003", supplierOrgId: "sup1", supplierName: "x", from: "2020-01-01", until: "2020-12-31", lines: [{ name: "حديد 12", unit: "طن", price: 1 }] })
    expect((await run(direct, "direct", "clerk", body({ agreementId: "ag3" }))).json.reason).toBe("agreement_not_live")
    expect((await run(direct, "direct", "clerk", body({ lines: [{ name: "اسمنت", unit: "كيس", quantity: 1, unitPrice: null }] }))).json.reason).toBe("agreement_line_missing")
    expect((await run(direct, "direct", "clerk", body({ deliverBy: "2020-01-01" }))).json.reason).toBe("delivery_date_missing")
    expect(orders()).toHaveLength(0)
  })
})

describe("a lump-sum service order", () => {
  const svc = (over: Record<string, unknown> = {}) => ({ description: "نقل حديد من الساحة", supplier: { orgId: "sup1", name: "مصنع الجودة" }, value: "3000", dueBy: "2099-01-01", ...over })

  it("is one lump-sum line born awaiting approval, marked as a service", async () => {
    const res = await run(service, "service", "clerk", svc({ projectId: "P1" }))
    expect(res.status).toBe(200)
    expect(only()).toMatchObject({ basis: "direct", orderKind: "service", totalExVat: 3000, projectId: "P1", approverKind: "manager", shortCompetition: false })
    expect(only().lines).toHaveLength(1)
    expect(only().lines[0]).toMatchObject({ unit: "مقطوعية", quantity: 1, unitPrice: 3000 })
  })

  it("above the direct cap it needs its reason, carries it, and goes to the owner", async () => {
    expect((await run(service, "service", "clerk", svc({ value: 8000 }))).json.reason).toBe("reason_required")
    await run(service, "service", "clerk", svc({ value: 8000, reason: "مورد النقل الوحيد المعتمد" }))
    expect(only()).toMatchObject({ approverKind: "owner", tags: { directOver: { why: "مورد النقل الوحيد المعتمد" } } })
  })

  it("refuses what the form refuses: no description, no value, a past day, an unverified or foreign supplier", async () => {
    expect((await run(service, "service", "clerk", svc({ value: "" }))).json.reason).toBe("price_missing")
    expect((await run(service, "service", "clerk", svc({ dueBy: "2020-01-01" }))).json.reason).toBe("date_invalid")
    expect((await run(service, "service", "clerk", svc({ supplier: { orgId: "supU", name: "x" } }))).json.reason).toBe("supplier_unverified")
    expect((await run(service, "service", "clerk", svc({ projectId: "PX" }))).status).toBe(403)
    expect((await run(service, "service", "viewer", svc())).status).toBe(403)
    expect(orders()).toHaveLength(0)
  })
})

describe("a retroactive order", () => {
  const retro = (over: Record<string, unknown> = {}) => ({ rfqTitle: "شراء نقدي", supplier: { name: "مستودع الحي" }, lines: [{ name: "أسمنت", unit: "كيس", quantity: 40, unitPrice: 18 }], totalExVat: 1, deliveryId: "d1", reason: "حاجة عاجلة في الموقع", ...over })
  beforeEach(() => {
    mockDb.seed("deliveries/d1", { contractorOrgId: ORG, status: "confirmed", source: "manual" })
    mockDb.seed("deliveries/d2", { contractorOrgId: "org2", status: "confirmed", source: "manual" })
    mockDb.seed("deliveries/d3", { contractorOrgId: ORG, status: "confirmed", source: "manual", poId: "other", poNumber: "PO-2026/009" })
  })

  it("is the owner's alone to approve, born with what was accepted, and stamps the receipt with its number — the total is recomputed from the lines", async () => {
    const res = await run(retroactive, "retroactive", "clerk", retro())
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ approverKind: "owner", deliveryLinked: true })
    expect(only()).toMatchObject({ basis: "retroactive", approverKind: "owner", status: "awaiting_approval", isGuestSupplier: true, supplierOrgId: "guest", totalExVat: 720, awardReasonText: "حاجة عاجلة في الموقع" })
    expect(only().lines[0]).toMatchObject({ id: "l1", quantity: 40, accepted: 40, unitPrice: 18 })
    expect(mockDb.get("deliveries/d1")).toMatchObject({ poId: only().id, poNumber: only().docNumber, regularisedByName: "ريم" })
    expect((await run(approve, "approve", "mgr", { poId: only().id })).json.reason).toBe("owner_only")
    const done = await run(approve, "approve", ORG, { poId: only().id })
    expect(done.status).toBe(200)
    expect(only()).toMatchObject({ status: "accepted", acceptanceRecordedBy: "buyer", closeOn: "payment" })
  })

  it("needs its reason; a receipt of another company or one already tied to an order is refused", async () => {
    expect((await run(retroactive, "retroactive", "clerk", retro({ reason: "  " }))).json.reason).toBe("reason_required")
    expect((await run(retroactive, "retroactive", "clerk", retro({ deliveryId: "d2" }))).json.reason).toBe("not_no_po")
    expect((await run(retroactive, "retroactive", "clerk", retro({ deliveryId: "d3" }))).json.reason).toBe("not_no_po")
    expect((await run(retroactive, "retroactive", "viewer", retro())).status).toBe(403)
    expect(orders()).toHaveLength(0)
    expect(mockDb.get("deliveries/d2")).not.toHaveProperty("poId")
  })

  it("without a receipt it still makes the order", async () => {
    const res = await run(retroactive, "retroactive", ORG, retro({ deliveryId: null }))
    expect(res.json.data).toMatchObject({ deliveryLinked: false })
  })
})

describe("R-32 · a buyer issues his own small direct order", () => {
  const draft = (over: Record<string, unknown> = {}) =>
    mockDb.seed("purchaseOrders/po1", {
      organizationId: ORG,
      docNumber: "PO-2026/001",
      status: "awaiting_approval",
      basis: "direct",
      rfqId: null,
      rfqTitle: "أسمنت",
      offerId: null,
      supplierOrgId: "sup1",
      supplierUserId: "sup1",
      supplierName: "مصنع الجودة",
      isGuestSupplier: false,
      lines: [{ id: "l1", name: "أسمنت", unit: "كيس", quantity: 100, unitPrice: 15, accepted: 0, rejected: 0, held: 0, cancelled: 0 }],
      totalExVat: 1500,
      vatRate: 0.15,
      offersCount: 0,
      shortCompetition: false,
      noOfficialQuote: true,
      preparedById: "clerk",
      preparedByName: "ريم",
      createdAt: "2026-10-10T08:00:00Z",
      approverKind: "manager",
      approvedAt: null,
      returnedReason: null,
      log: [],
      ...over,
    })

  it("under the limit read from the company's policies it is approved in his name, flagged, and stamped", async () => {
    draft()
    const res = await run(selfIssue, "self-issue", "clerk", { poId: "po1" })
    expect(res.status).toBe(200)
    expect(mockDb.get("purchaseOrders/po1")).toMatchObject({ selfIssued: true, approvedById: "clerk", closeOn: "payment" })
    expect(["approved", "sent"]).toContain((mockDb.get("purchaseOrders/po1") as { status: string }).status)
    const log = (mockDb.get("purchaseOrders/po1") as { log: Array<{ action: string; params: Record<string, unknown> }> }).log
    expect(log.find((l) => l.action === "approved")?.params).toMatchObject({ selfIssued: 1, limit: 2000 })
  })

  it("the limit is the company's, not the screen's: a lower stored limit refuses it", async () => {
    mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG, buyerSelfIssueLimit: 1000 })
    draft()
    const res = await run(selfIssue, "self-issue", "clerk", { poId: "po1" })
    expect(res.status).toBe(409)
    expect(res.json.reason).toBe("above_limit")
    expect(mockDb.get("purchaseOrders/po1")).toMatchObject({ status: "awaiting_approval" })
  })

  it("never on an RFQ award, never on another's order, never on a returned one", async () => {
    draft({ basis: "rfq", rfqId: "r1" })
    expect((await run(selfIssue, "self-issue", "clerk", { poId: "po1" })).json.reason).toBe("wrong_state")
    draft({ preparedById: "someone" })
    expect((await run(selfIssue, "self-issue", "clerk", { poId: "po1" })).json.reason).toBe("no_permission")
    draft({ returnedReason: "راجع السعر" })
    expect((await run(selfIssue, "self-issue", "clerk", { poId: "po1" })).json.reason).toBe("wrong_state")
  })

  it("a direct order over the cap is never self-issued, whatever the limit says", async () => {
    mockDb.seed(`procurementSettings/${ORG}`, { organizationId: ORG, buyerSelfIssueLimit: 20000 })
    draft({ totalExVat: 6000, lines: [{ id: "l1", name: "أسمنت", unit: "كيس", quantity: 400, unitPrice: 15, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], tags: { directOver: { why: "سبب" } } })
    expect((await run(selfIssue, "self-issue", "clerk", { poId: "po1" })).json.reason).toBe("owner_only")
  })
})
