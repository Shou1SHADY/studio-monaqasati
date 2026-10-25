/** @jest-environment node */
/**
 * Procurement 2.0 — «انشر» on the server (WP-S2-07): the rows are checked where they cannot be skipped (ED-01), the deadline is
 * today or later (R-32), the number is drawn with the document, the visitor link exists only for «عام» unless asked (R-06, ED-08),
 * and a direct award is an OPEN private RFQ to one supplier, estimated from the last prices, with a reason above the cap (R-09,
 * WF-28, R-36). The lines an RFQ takes are linked to their request, and only those (G-13).
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

let mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("tok:")) throw new Error("bad token")
      return { uid: t.slice(4) }
    },
  }),
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }), arrayUnion: (v: unknown) => [v], delete: () => "DEL" } }))
jest.mock("@/lib/sms", () => ({ isSmsConfigured: () => false, sendSms: async () => ({ sent: false }), sendWhatsApp: async () => ({ sent: false }), sendDirectMessage: async () => ({ sent: false }), normalizePhoneE164: (p: string | undefined | null) => (p ? String(p) : null) }))

import { POST as publishRoute } from "@/app/api/procurement/rfq/publish/route"
import { createTeamRequest } from "@/lib/procurement/incoming-server"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { RfqError, type RfqCaller } from "@/lib/procurement/rfq-server/common"
import { publishRfq, publishSchema, reachInCities, type PublishInput } from "@/lib/procurement/rfq-server/publish"
import { TERM_PRESETS, deadlineProblem, directEstimate, directReasonRefusal, presetOfTerms, rowProblems } from "@/lib/procurement/rfq-publish-rules"
import type { PriceHistoryEntry } from "@/lib/procurement/prices"
import { materialKey } from "@/lib/procurement/prices"
import { requestReaches } from "@/lib/supplier-free/quote-rules"
import { findLinkByToken } from "@/lib/links/hash"
import type { Firestore } from "firebase-admin/firestore"

const ORG = "org1"
const NOW = new Date("2026-10-22T08:00:00.000Z")
const db = () => mockDb as unknown as Firestore
const OWNER: RfqCaller = { uid: ORG, name: "Saad", orgId: ORG, can: () => true }
const NOBODY: RfqCaller = { uid: "m9", name: "Viewer", orgId: ORG, can: (p) => p === "projects.view" }

const product = (over: Record<string, unknown> = {}) => ({
  name: "حديد 16",
  quantity: 10,
  unitOfMeasure: "طن",
  category: "حديد",
  subCategory: "اسياخ",
  material: { nodeId: "n1", subId: "s1", rootId: "r1", path: [{ ar: "حديد", en: "Steel" }], specs: [] },
  deliveryCity: "الرياض",
  ...over,
})

const input = (over: Partial<PublishInput> & { products?: Array<Record<string, unknown>> } = {}): PublishInput => {
  const { products, ...rest } = over
  return publishSchema.parse({
    title: "حديد — مجمع الياسمين",
    audience: "public",
    deadline: "2026-10-25",
    pricing: "line",
    doc: { products: products ?? [product()], city: "الرياض", subCategoryIds: ["s1"] },
    reach: { count: 3, orgIds: [] },
    ...rest,
  })
}

const rfqs = () => mockDb.list("rfqs") as unknown as Array<Record<string, unknown> & { id: string }>
const links = () => mockDb.list("rfqShareLinks")
const events = () => [...mockDb.docs].filter(([k]) => k.startsWith("procEvents/")).map(([, d]) => d) as unknown as Array<{ id: string; key: string }>
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof RfqError ? e.code : String(e)))

beforeEach(() => {
  mockDb = new FakeAdminDb()
  mockDb.seed(`users/${ORG}`, { organizationId: ORG, name: "المالك" })
  mockDb.seed("users/sup1", { role: "Supplier", name: "مورد", legalDocuments: {} })
})

describe("the rules (pure)", () => {
  it("ED-01 · every row has a material or its category, a quantity above zero and a unit; every place a city", () => {
    expect(rowProblems([product()], "")).toBeNull()
    expect(rowProblems([], "")).toEqual({ code: "rows_missing" })
    expect(rowProblems([product({ material: undefined, category: "" })], "")).toEqual({ code: "rows_missing", params: { no: 1 } })
    expect(rowProblems([product(), product({ quantity: 0 })], "")).toEqual({ code: "rows_missing", params: { no: 2 } })
    expect(rowProblems([product({ unitOfMeasure: " " })], "")).toEqual({ code: "rows_missing", params: { no: 1 } })
    expect(rowProblems([product({ deliveryCity: "" })], "")).toEqual({ code: "city_missing", params: { no: 1 } })
    expect(rowProblems([product({ deliveryCity: "" })], "جدة")).toBeNull()
  })

  it("R-32 · yesterday is refused, today and later pass", () => {
    expect(deadlineProblem("2026-10-21", "2026-10-22")).toEqual({ code: "date_invalid" })
    expect(deadlineProblem("2026-10-22", "2026-10-22")).toBeNull()
    expect(deadlineProblem("2026-10-23", "2026-10-22")).toBeNull()
  })

  it("ED-06 · the estimate is the last price (the material's own, else its category's) × quantity × 1.15 — never what the buyer typed", () => {
    const h = (name: string, price: number, unit = "طن"): PriceHistoryEntry => ({ id: name + price, organizationId: ORG, materialKey: materialKey(name, unit), name, unit, supplierOrgId: "s", supplierName: "S", price, day: "2026-09-01", kind: "po", poId: null, poNumber: null })
    const own = directEstimate([product()], [h("حديد 16", 100)])
    expect(own).toEqual({ total: 1150, missing: 0 })
    const category = directEstimate([product({ name: "حديد 12" })], [h("اسياخ حديد التسليح", 200)])
    expect(category).toEqual({ total: 2300, missing: 0 })
    expect(directEstimate([product({ name: "شيء آخر", category: "x", subCategory: "y" })], [h("حديد 16", 100)])).toEqual({ total: 0, missing: 1 })
  })

  it("R-09 · above the cap a reason is required, «سبب آخر» needs four letters", () => {
    expect(directReasonRefusal(null, false)).toBeNull()
    expect(directReasonRefusal(null, true)).toEqual({ code: "reason_required" })
    expect(directReasonRefusal({ code: "other", text: "abc" }, true)).toEqual({ code: "reason_required" })
    expect(directReasonRefusal({ code: "other", text: "abcd" }, true)).toBeNull()
    expect(directReasonRefusal({ code: "urgent" }, true)).toBeNull()
  })

  it("ED-07 · the three term chips are stored as the list the award freezes", () => {
    expect(TERM_PRESETS.t30).toEqual([{ pct: 100, days: 30 }])
    expect(presetOfTerms([{ pct: "100", days: "0" }])).toBe("tdel")
    expect(presetOfTerms([{ pct: "30", days: "0" }, { pct: "70", days: "0" }])).toBe("tadv")
    expect(presetOfTerms([{ pct: "50", days: "15" }, { pct: "50", days: "45" }])).toBeNull()
  })
})

describe("WF-06 · the publish", () => {
  it("draws RFQ-2026/001 with the document, writes the RFQ open and public, makes the visitor link and leaves the V1 event", async () => {
    const res = await publishRfq(db(), OWNER, input(), NOW)
    expect(res).toMatchObject({ number: "RFQ-2026/001", reached: 3, direct: false, dirOver: false })
    expect(res.guestUrl).toMatch(/\/rfq\/[A-Za-z0-9_-]{22}$/)
    expect(rfqs()[0]).toMatchObject({ status: "New", visibility: "public", audience: "public", organizationId: ORG, rfqNumber: "RFQ-2026/001", deadline: "2026-10-25", pubVer: 1 })
    expect((mockDb.get(`mfgCounters/${ORG}__RFQ__2026`) as { last: number }).last).toBe(1)
    expect(events().map((e) => e.id)).toContain("rfq_publish")
    const token = res.guestUrl!.split("/").pop()!
    expect(await findLinkByToken(db(), "rfq", token)).toMatchObject({ ok: true })
    const second = await publishRfq(db(), OWNER, input(), NOW)
    expect(second.number).toBe("RFQ-2026/002")
  })

  it("publishing a saved draft keeps its id and gives it its number; publishing it again changes nothing", async () => {
    mockDb.seed("rfqs/D1", { status: "Draft", organizationId: ORG, contractorId: ORG, createdByUserId: ORG, createdByUserName: "Saad", log: [] })
    const a = await publishRfq(db(), OWNER, input({ rfqId: "D1" }), NOW)
    expect(a.id).toBe("D1")
    expect(rfqs()).toHaveLength(1)
    const b = await publishRfq(db(), OWNER, input({ rfqId: "D1" }), NOW)
    expect(b.number).toBe(a.number)
    expect((mockDb.get(`mfgCounters/${ORG}__RFQ__2026`) as { last: number }).last).toBe(1)
  })

  it("ED-01 · a row with no material, quantity or unit is refused and spends no number", async () => {
    expect(await refusal(publishRfq(db(), OWNER, input({ products: [product({ material: undefined, category: "" })] }), NOW))).toBe("rows_missing")
    expect(() => input({ products: [product({ quantity: 0 })] })).toThrow()
    expect(mockDb.get(`mfgCounters/${ORG}__RFQ__2026`)).toBeUndefined()
    expect(rfqs()).toHaveLength(0)
  })

  it("R-32 · a deadline of yesterday is refused (400), today is accepted", async () => {
    expect(await refusal(publishRfq(db(), OWNER, input({ deadline: "2026-10-21" }), NOW))).toBe("date_invalid")
    expect(mockDb.get(`mfgCounters/${ORG}__RFQ__2026`)).toBeUndefined()
    expect((await publishRfq(db(), OWNER, input({ deadline: "2026-10-22" }), NOW)).closesOn).toBe("2026-10-22")
  })

  it("a member who runs no RFQs may not publish", async () => {
    expect(await refusal(publishRfq(db(), NOBODY, input(), NOW))).toBe("no_permission")
  })

  it("the route answers { success, data } to a signed-in buyer and 401 to nobody", async () => {
    const call = (token: string | null, body: unknown) => publishRoute(new NextRequest("http://x/api", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }))
    expect((await call(null, input())).status).toBe(401)
    const ok = await call(`tok:${ORG}`, input({ deadline: "2099-01-01" }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ success: true, data: { number: "RFQ-2026/001" } })
    const bad = await call(`tok:${ORG}`, input({ deadline: "2026-10-01" }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: true, reason: "date_invalid" })
  })
})

describe("R-06 / ED-08 · the visitor link", () => {
  it("«خاص» has no link by default — and the RFQ reaches only the chosen supplier", async () => {
    const res = await publishRfq(db(), OWNER, input({ audience: "private", recipients: ["sup1"] }), NOW)
    expect(res.guestUrl).toBeNull()
    expect(links()).toHaveLength(0)
    expect(rfqs()[0]).toMatchObject({ visibility: "private", allowedSupplierOrgIds: ["sup1"] })
    expect(requestReaches(rfqs()[0], "sup1", { specs: [], cities: [] })).toBe(true)
    expect(requestReaches(rfqs()[0], "other", { specs: ["حديد"], cities: ["الرياض"] })).toBe(false)
  })

  it("a private RFQ gets a link only when asked, and the link records who asked", async () => {
    const res = await publishRfq(db(), OWNER, input({ audience: "private", recipients: ["sup1"], link: true }), NOW)
    expect(res.guestUrl).toMatch(/\/rfq\//)
    expect(links()[0]).toMatchObject({ explicitBy: { uid: ORG } })
  })

  it("«عام» can switch the link off", async () => {
    expect((await publishRfq(db(), OWNER, input({ link: false }), NOW)).guestUrl).toBeNull()
  })

  it("a private RFQ with no supplier left is refused", async () => {
    expect(await refusal(publishRfq(db(), OWNER, input({ audience: "private", recipients: [] }), NOW))).toBe("recipients_missing")
    mockDb.seed(`supplierRecords/${ORG}__sup2`, { organizationId: ORG, supplierOrgId: "sup2", verified: false })
    expect(await refusal(publishRfq(db(), OWNER, input({ audience: "private", recipients: ["sup2"] }), NOW))).toBe("recipients_missing")
  })
})

describe("WF-28 / R-09 / R-36 · a direct award is an open private RFQ to one supplier", () => {
  const priced = () => mockDb.seed("priceHistory/h1", { organizationId: ORG, materialKey: materialKey("حديد 16", "طن"), name: "حديد 16", unit: "طن", supplierOrgId: "s", supplierName: "S", price: 100, day: "2026-09-01", kind: "po" })

  it("over the cap without a reason is refused; with one it is stored and the order will need the owner", async () => {
    priced()
    const big = { audience: "direct" as const, directSupplierOrgId: "sup1", products: [product({ quantity: 100 })] }
    expect(await refusal(publishRfq(db(), OWNER, input(big), NOW))).toBe("reason_required")
    expect(await refusal(publishRfq(db(), OWNER, input({ ...big, directWhy: { code: "other", text: "abc" } }), NOW))).toBe("reason_required")
    const res = await publishRfq(db(), OWNER, input({ ...big, directWhy: { code: "only" } }), NOW)
    expect(res).toMatchObject({ direct: true, dirOver: true, directEst: 11500, guestUrl: null })
    expect(rfqs()[0]).toMatchObject({ status: "New", audience: "direct", visibility: "private", allowedSupplierOrgIds: ["sup1"], dirOver: true, directWhy: "مورّد وحيد لهذه المادة", directWhyCode: "only", deadline: "2026-10-25" })
    expect(rfqs()[0].directAward).toBeUndefined()
    expect(links()).toHaveLength(0)
    expect(mockDb.list("offers")).toHaveLength(0)
    expect(mockDb.list("purchaseOrders")).toHaveLength(0)
  })

  it("under the cap no reason is asked; with no past price the estimate is zero and says how many rows lack one", async () => {
    priced()
    const small = await publishRfq(db(), OWNER, input({ audience: "direct", directSupplierOrgId: "sup1" }), NOW)
    expect(small).toMatchObject({ dirOver: false, directEst: 1150 })
    const none = await publishRfq(db(), OWNER, input({ audience: "direct", directSupplierOrgId: "sup1", products: [product({ name: "مادة جديدة", category: "x", subCategory: "y" })] }), NOW)
    expect(none).toMatchObject({ dirOver: false, directEst: 0 })
    expect(rfqs().find((r) => r.id === none.id)).toMatchObject({ directMissing: 1 })
  })

  it("an unverified supplier is not sent a direct award", async () => {
    mockDb.seed(`supplierRecords/${ORG}__sup1`, { organizationId: ORG, supplierOrgId: "sup1", verified: false })
    expect(await refusal(publishRfq(db(), OWNER, input({ audience: "direct", directSupplierOrgId: "sup1" }), NOW))).toBe("direct_blocked")
    expect(await refusal(publishRfq(db(), OWNER, input({ audience: "direct" }), NOW))).toBe("direct_supplier_missing")
  })

  it("the award of such an RFQ needs the owner (requiredApprover reads the tag)", async () => {
    const { requiredApprover } = await import("@/lib/procurement/po")
    const { DEFAULT_POLICIES } = await import("@/lib/procurement/types")
    const po = { basis: "rfq", totalExVat: 100, vatRate: 0.15, lines: [], tags: { directOver: { why: "x" } } } as never
    expect(requiredApprover(po, DEFAULT_POLICIES)).toBe("owner")
    expect(requiredApprover({ ...(po as object), tags: {} } as never, DEFAULT_POLICIES)).toBe("manager")
  })
})

describe("G-13 · the lines an RFQ takes are linked to their request — only those", () => {
  it("a request taken in part leaves the rest for «جديدة»", async () => {
    mockDb.seed("users/eng1", { organizationId: ORG, organizationRole: "member", name: "فهد" })
    const req = await createTeamRequest(
      db(),
      ORG,
      { uid: "eng1", name: "فهد" },
      {
        lines: [
          { name: "الاسمنت العادي", unit: "كيس", quantity: 200 },
          { name: "حديد 16", unit: "طن", quantity: 12 },
        ],
        needBy: "2026-11-10",
        siteId: null,
        place: { label: "مجمع الياسمين", city: "الرياض", district: "" },
        requestedFor: { kind: "member", id: "eng1", name: "فهد" },
      },
      NOW
    )
    const source = { kind: "team_request", purchaseRequestId: req.mrKey.slice("team:".length) }
    const res = await publishRfq(db(), OWNER, input({ products: [product({ name: "حديد 16", needSource: source, needLine: 1 })] }), NOW)
    expect(res.linkedRequests).toBe(1)
    const after = mockDb.get(`procIncoming/${incomingDocId(ORG, req.mrKey)}`) as unknown as IncomingDoc
    expect(after.lines[1]).toMatchObject({ ps: "rfq", rfqId: res.id, rfqNumber: res.number })
    expect(after.lines[0].ps ?? null).toBeNull()
    expect(after.st).toBe("part")
  })
})

describe("ED-21 · the public reach re-checked on the delivery city", () => {
  beforeEach(() => {
    mockDb.seed("users/ryd", { role: "Supplier", coverageCities: ["الرياض", "الخرج"] })
    mockDb.seed("users/jed", { role: "Supplier", coverageCities: ["جدة"] })
    mockDb.seed("users/own", { role: "Supplier", city: "جدة" })
    mockDb.seed("users/none", { role: "Supplier" })
    mockDb.seed("users/co_owner", { role: "Supplier", coverageCities: ["الدمام"] })
    mockDb.seed("organizations/co", { coverageCities: ["الرياض"] })
  })

  it("keeps those who serve the city, those with no city data, and a company's own list over its owner's; the count follows", async () => {
    const res = await publishRfq(db(), OWNER, input({ reach: { count: 6, orgIds: ["ryd", "jed", "own", "none", "co", "ghost"] } }), NOW)
    const rfq = rfqs()[0]
    expect(rfq.reachedOrgIds).toEqual(["ryd", "none", "co", "ghost"])
    expect(rfq.reachedCount).toBe(4)
    expect(res.reached).toBe(4)
  })

  it("several places: a supplier in ANY of their cities is kept", async () => {
    await publishRfq(db(), OWNER, input({ doc: { products: [product()], city: "الرياض", cities: ["الرياض", "جدة"], subCategoryIds: ["s1"] }, reach: { count: 3, orgIds: ["ryd", "jed", "own"] } }), NOW)
    expect(rfqs()[0].reachedOrgIds).toEqual(["ryd", "jed", "own"])
  })

  it("an RFQ that names no city is nationwide", async () => {
    expect(await reachInCities(db(), ["ryd", "jed"], {})).toEqual(["ryd", "jed"])
  })

  it("private and direct are untouched: no public reach is stored", async () => {
    await publishRfq(db(), OWNER, input({ audience: "private", recipients: ["sup1"], reach: { count: 2, orgIds: ["jed"] } }), NOW)
    expect(rfqs()[0].reachedOrgIds).toEqual([])
    expect(rfqs()[0].allowedSupplierOrgIds).toEqual(["sup1"])
  })
})
