/** @jest-environment node */
/**
 * Procurement 2.0 — the orders gaps against the prototype (PO-01…15): the line's specification and path ride from the RFQ (and from
 * a need's material) onto the order, its print and its link; «رابط الأمر كما يراه» is a READ-ONLY preview (no token, no read receipt,
 * no act); a notice recorded on the supplier's behalf says so and by whom; an open change request puts the order under «يحتاج
 * تصرّفنا»; a direct order above the cap takes «سبب آخر» only with its own words.
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

import { POST as preview } from "@/app/api/procurement/po/message/preview/route"
import { POST as direct } from "@/app/api/procurement/po/direct/route"
import { lineSpecOf, pathOfMaterial, specCells, specOfMaterial } from "@/lib/procurement/po-line-spec"
import { OTHER_REASON_MIN, SINGLE_SOURCE_REASONS, directOrderRefusal, directPoLines } from "@/lib/procurement/direct"
import { lineView } from "@/lib/po-link"
import { noticeSent } from "@/lib/procurement/po-extras"
import { orderFacts } from "@/lib/procurement/po-messages"
import { pendingChangeAsk, poSeg, type PoStateCtx } from "@/lib/procurement/po-state"
import { buildPoPrintModel } from "@/components/procurement/PoModel"
import { resolvePolicies } from "@/lib/procurement/policies"
import type { PoLine, PurchaseOrder } from "@/lib/procurement/types"

const ORG = "org1"
const person = (uid: string, orgId: string, name: string, perms: string[] | "all") => ({ uid, orgId, name, can: perms === "all" ? () => true : (p: string) => perms.includes(p) })
const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "حديد تسليح", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/008",
  status: "sent",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "حديد",
  offerId: "o1",
  supplierOrgId: "guest",
  supplierUserId: null,
  supplierName: "مؤسسة الندى",
  isGuestSupplier: true,
  lines: [line({ spec: "16 مم · G60", path: "الحديد › حديد التسليح" })],
  totalExVat: 30000,
  vatRate: 0.15,
  preparedById: "prep",
  preparedByName: "سعد",
  createdAt: "2026-10-10T08:00:00Z",
  approverKind: "manager",
  approvedAt: "2026-10-11T08:00:00Z",
  sentAt: "2026-10-12T08:00:00Z",
  sentChannel: "whatsapp",
  log: [{ at: "2026-10-12T08:00:00Z", byId: "mgr", byName: "منى", action: "sent", params: { channel: "whatsapp" } }],
  chat: { seq: 1, usSeq: 0, supSeq: 1, lastAt: "2026-10-13T08:00:00Z", lastText: "جاهزون", lastBy: "sup", lastFile: false, readBy: {}, supReadSeq: 0 },
  ...over,
})
const post = async (route: (r: NextRequest) => Promise<Response>, path: string, user: string, body: unknown) => {
  const res = await route(new NextRequest(`http://localhost/api/procurement/po/${path}`, { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
  return { status: res.status, json: (await res.json()) as { success?: boolean; data?: Record<string, unknown>; reason?: string } }
}

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, ORG, "المالك", "all"),
    clerk: person("clerk", ORG, "ريم", ["po.expedite", "offers.accept"]),
    viewer: person("viewer", ORG, "قارئ", []),
    stranger: person("stranger", "org2", "غريب", "all"),
  })
  mockDb.seed(`users/${ORG}`, { role: "Contractor", name: "المالك", companyName: "شركة البناء" })
  mockDb.seed("users/sup1", { role: "Supplier", companyName: "مصنع الجودة", isVerified: true })
})

describe("PO-01 — the line's specification and path", () => {
  it("reads the RFQ product's spec words and the tree path above the material; an old product gives nothing", () => {
    const material = { path: [{ ar: "الحديد" }, { ar: "حديد التسليح" }, { ar: "أسياخ" }], specs: [{ name: { ar: "القطر" }, value: { ar: "16 مم" } }, { name: { ar: "الدرجة" }, value: { ar: "G60" } }], brand: { ar: "سابك" } }
    expect(specOfMaterial(material)).toBe("القطر 16 مم · الدرجة G60 · سابك")
    expect(pathOfMaterial(material)).toBe("الحديد › حديد التسليح")
    expect(lineSpecOf({ description: "16 مم · G60", material })).toEqual({ spec: "16 مم · G60", path: "الحديد › حديد التسليح" })
    expect(lineSpecOf({ material })).toEqual({ spec: "القطر 16 مم · الدرجة G60 · سابك", path: "الحديد › حديد التسليح" })
    expect(lineSpecOf({ description: "  ", category: "الإسمنت", subCategory: "الإسمنت" })).toEqual({ path: "الإسمنت" })
    expect(lineSpecOf({ category: "مواد", subCategory: "رمل" })).toEqual({ path: "مواد › رمل" })
    expect(lineSpecOf({})).toEqual({})
    expect(lineSpecOf(null)).toEqual({})
  })

  it("splits the spec into the chips under the name", () => {
    expect(specCells("16 مم · G60")).toEqual(["16 مم", "G60"])
    expect(specCells(null)).toEqual([])
  })

  it("a direct order's line keeps the need's spec and path; the order link and the print carry the spec", () => {
    const [l] = directPoLines([{ name: "حديد", unit: "طن", quantity: 2, unitPrice: 3000, spec: " 16 مم · G60 ", path: "الحديد" }])
    expect(l).toMatchObject({ spec: "16 مم · G60", path: "الحديد" })
    expect(directPoLines([{ name: "حديد", unit: "طن", quantity: 2, unitPrice: 3000 }])[0]).not.toHaveProperty("spec")
    expect(lineView(line({ spec: "16 مم · G60" })).spec).toBe("16 مم · G60")
    expect(lineView(line()).spec).toBeNull()
    const print = buildPoPrintModel(order({ status: "accepted" }) as unknown as PurchaseOrder, { name: "شركة البناء" }, true)
    expect(print.lines[0].spec).toBe("16 مم · G60")
  })

  it("the direct route stores the spec and path on the order line", async () => {
    const res = await post(direct, "direct", "clerk", { mode: "direct", title: "حديد", lines: [{ name: "حديد 16", unit: "طن", quantity: 1, unitPrice: 3000, spec: "16 مم · G60", path: "الحديد › حديد التسليح" }], supplier: { orgId: "sup1", name: "مصنع الجودة" } })
    expect(res.status).toBe(200)
    expect(mockDb.list("purchaseOrders")[0].lines).toEqual([expect.objectContaining({ name: "حديد 16", spec: "16 مم · G60", path: "الحديد › حديد التسليح" })])
  })
})

describe("PO-02 — «رابط الأمر كما يراه» is a read-only preview", () => {
  it("returns the supplier's page for the order's own company and writes NOTHING — no token, no read receipt", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    mockDb.writes.length = 0
    const res = await post(preview, "message/preview", "clerk", { poId: "po1" })
    expect(res.status).toBe(200)
    const view = res.json.data?.view as { no: string; lines: Array<{ spec: string | null }>; unread: number; state: string; acts: { accept: boolean } }
    expect(view).toMatchObject({ no: "2026/008", state: "awaiting", unread: 0 })
    expect(view.lines[0].spec).toBe("16 مم · G60")
    expect(mockDb.writes).toEqual([])
    expect(mockDb.list("orderLinks")).toEqual([])
    expect((mockDb.get("purchaseOrders/po1") as { chat: { supReadSeq: number } }).chat.supReadSeq).toBe(0)
  })

  it("refuses another company, someone who may not talk to the supplier, an unsent or a cancelled order", async () => {
    mockDb.seed("purchaseOrders/po1", order())
    mockDb.seed("purchaseOrders/draft", order({ status: "approved", sentAt: null }))
    mockDb.seed("purchaseOrders/gone", order({ status: "cancelled" }))
    expect((await post(preview, "message/preview", "stranger", { poId: "po1" })).json.reason).toBe("order_missing")
    expect((await post(preview, "message/preview", "viewer", { poId: "po1" })).json.reason).toBe("no_permission")
    expect((await post(preview, "message/preview", "clerk", { poId: "draft" })).json.reason).toBe("wrong_state")
    expect((await post(preview, "message/preview", "clerk", { poId: "gone" })).json.reason).toBe("wrong_state")
    expect((await post(preview, "message/preview", "bad", { poId: "po1" })).status).toBe(401)
    expect(mockDb.writes.filter(([p]) => !p.startsWith("purchaseOrders/") && !p.startsWith("users/"))).toEqual([])
  })
})

describe("PO-04 — a notice recorded on the supplier's behalf", () => {
  it("the notice row names who recorded it; the supplier's own keep their channel", () => {
    expect(noticeSent({ createdAt: "2026-10-14T07:00:00Z", reportedBy: "onBehalf", recordedOnBehalf: { byName: "ريم" }, isGuestDelivery: true, notes: "صباحاً" })).toEqual({ at: "2026-10-14T07:00:00Z", via: "onBehalf", note: "صباحاً", by: "ريم" })
    expect(noticeSent({ createdAt: "2026-10-14T07:00:00Z", reportedBy: "link", isGuestDelivery: true })).toEqual({ at: "2026-10-14T07:00:00Z", via: "link", note: null })
  })

  it("the conversation's fact says so too", () => {
    const po = order({
      log: [
        { at: "2026-10-12T08:00:00Z", byId: "mgr", byName: "منى", action: "sent", params: { channel: "whatsapp" } },
        { at: "2026-10-14T07:00:00Z", byId: "clerk", byName: "ريم", action: "delivery_reported", note: null, params: { date: "2026-10-15", seq: 1, via: "onBehalf" } },
        { at: "2026-10-15T07:00:00Z", byId: "link:po1", byName: "مؤسسة الندى", action: "delivery_reported", note: null, params: { date: "2026-10-16", seq: 2, via: "link" } },
      ],
    }) as unknown as PurchaseOrder
    const reported = orderFacts(po).filter((f) => f.kind === "reported")
    expect(reported[0].params).toMatchObject({ date: "2026-10-15", by: "ريم" })
    expect(reported[1].params).not.toHaveProperty("by")
  })
})

describe("PO-13 — an open change request needs us", () => {
  const ctx: PoStateCtx = { notices: [], financeOn: true, acceptanceDays: 3, now: new Date("2026-10-13T10:00:00Z") }
  it("counts the order under «يحتاج تصرّفنا» until the buyer writes back", () => {
    const asked = order({ changeAsked: { at: "2026-10-13T08:00:00Z", seq: 1, text: "أطلب تعديل الموعد يومين" } }) as unknown as PurchaseOrder
    expect(poSeg(order() as unknown as PurchaseOrder, ctx)).toBe("wait")
    expect(pendingChangeAsk(asked)?.text).toBe("أطلب تعديل الموعد يومين")
    expect(poSeg(asked, ctx)).toBe("act")
    const answered = order({ changeAsked: { at: "2026-10-13T08:00:00Z", seq: 1, text: "x" }, chat: { seq: 2, usSeq: 2, supSeq: 1 } }) as unknown as PurchaseOrder
    expect(pendingChangeAsk(answered)).toBeNull()
    expect(poSeg(answered, ctx)).toBe("wait")
  })
})

describe("PO-15 — «سبب آخر» above the direct-order cap", () => {
  const policies = resolvePolicies(null)
  const over = { mode: "direct" as const, lines: [{ name: "حديد", unit: "طن", quantity: 100, unitPrice: 3000 }], supplierName: "مصنع", agreement: null, policies, today: "2026-10-22" }
  it("is a fourth reason, accepted only with its own words", () => {
    expect(SINGLE_SOURCE_REASONS).toEqual(["sole", "match", "urgent", "other"])
    expect(directOrderRefusal({ ...over, reason: "abc", reasonCode: "other" })?.code).toBe("reason_required")
    expect(directOrderRefusal({ ...over, reason: "x".repeat(OTHER_REASON_MIN), reasonCode: "other" })).toBeNull()
    expect(directOrderRefusal({ ...over, reason: "عاجل يوقف التنفيذ", reasonCode: "urgent" })).toBeNull()
  })

  it("the route refuses a bare «سبب آخر» and stores the typed note as the order's reason", async () => {
    const big = { mode: "direct", title: "حديد", lines: [{ name: "حديد 12", unit: "طن", quantity: 100, unitPrice: 3000 }], supplier: { orgId: "sup1", name: "مصنع الجودة" } }
    expect((await post(direct, "direct", "clerk", { ...big, reason: "لا", reasonCode: "other" })).json.reason).toBe("reason_required")
    const ok = await post(direct, "direct", "clerk", { ...big, reason: "استكمال أمر سابق بسعره", reasonCode: "other" })
    expect(ok.status).toBe(200)
    expect(mockDb.list("purchaseOrders")[0]).toMatchObject({ awardReasonText: "استكمال أمر سابق بسعره", singleSourceReason: "other", tags: { directOver: { why: "استكمال أمر سابق بسعره" } } })
  })
})
