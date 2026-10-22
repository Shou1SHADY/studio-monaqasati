/** @jest-environment node */
/**
 * Procurement 2.0 — the constants of PRD §16 as checks on the DATABASE and across views (QA pack 4/5, G-01…G-05, G-13…G-16, G-18).
 * A world is built through the real server acts (the worked example RFQ-2026/011 and a two-site RFQ), then each guard is read over what was
 * stored and over every view that shows the same number: the evaluation, the rows and the best-of cards, the comparison model and the
 * order the award wrote. The packs call the prototype's own functions; these call ours.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "bkt",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => xs, serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))
jest.mock("@/lib/procurement/incoming-server", () => ({ syncIncoming: jest.fn(async () => ({ created: 0, refreshed: 0, told: 0, migrated: 0 })) }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1), permissionHolders: jest.fn(async () => []) }))

import { POST as awardRoute } from "@/app/api/procurement/rfq/award/route"
import { POST as sendRoute } from "@/app/api/procurement/po/send/route"
import { POST as approveRoute } from "@/app/api/procurement/po/approve/route"
import { calcOffer, evaluateOffers } from "@/lib/procurement/offer-calc"
import { bestCards, buildOfferRows, type RowOffer } from "@/lib/procurement/rfq-offers-view"
import { buildCompareModel } from "@/lib/procurement/compare-model"
import { resolvePolicies } from "@/lib/procurement/policies"
import { INCOMING_SEGMENTS, deriveRequest, incomingSegmentCounts, lineKind, replyClockOf, segmentOfRequest, summaryOf, buyLineIndexes, type IncomingDoc, type IncomingLine, type RequestSt } from "@/lib/procurement/incoming-state"
import { DEFAULT_RESOLVED_POLICIES } from "@/lib/procurement/policies"
import { runQuoteAct, quoteActSchema, type QuoteAct, type QuoteSupplier } from "@/lib/supplier-free/server-quote-acts"
import { runOfferDecision, decideSchema, type DecideInput } from "@/lib/procurement/offer-decisions-server"
import type { PlanOffer, PlanRfq } from "@/lib/procurement/award-plan"

type Doc = Record<string, any>
const ORG = "org1"
const NOW = new Date("2026-10-22T09:00:00Z")
jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })
const can = (...ps: string[]) => (p: string) => ps.includes(p)
const person = (uid: string, name: string, perms: string[] | "all") => ({ uid, orgId: ORG, name, can: perms === "all" ? () => true : can(...perms) })

const prod = (name: string, quantity: number, over: Doc = {}) => ({ name, quantity, unitOfMeasure: "م", deliverySiteId: "s1", deliveryCity: "الرياض", needBy: "2026-11-05", ...over })
const rfqDoc = (over: Doc = {}) => ({
  organizationId: ORG,
  contractorId: ORG,
  createdByUserId: "buyer",
  rfqNumber: "RFQ-2026/011",
  title: "حديد وخشب",
  status: "New",
  deadline: "2026-10-30",
  pricingMode: "line",
  products: [prod("زوايا حديد 50×50×5 مم", 175, { saleUnits: [{ ar: "قطعة 6 م", lengthM: 6 }, { ar: "قطعة 12 م", lengthM: 12 }] }), prod("خشب ألواح", 320, { saleUnits: [{ ar: "لوح 4 م", lengthM: 4 }] })],
  allowedSupplierOrgIds: ["supA", "supS", "supM", "supAmal"],
  paymentTermsList: null,
  log: [],
  ...over,
})
const offerDoc = (supplier: string, lines: Array<Doc>, over: Doc = {}) => ({
  rfqId: "r1",
  contractorOrgId: ORG,
  supplierId: `u_${supplier}`,
  organizationId: supplier,
  companyName: `مورد ${supplier}`,
  status: "قيد المراجعة",
  lines,
  price: "0",
  vatRegistered: true,
  vatRate: 0.15,
  leadDays: 5,
  validUntil: "2026-11-30",
  offerPdfUrl: `https://f/${supplier}.pdf`,
  versions: [{ n: 1 }],
  rev: 1,
  ...over,
})

function worldExample() {
  mockDb.seed("rfqs/r1", rfqDoc())
  mockDb.seed("offers/oA", offerDoc("supA", [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6 }]))
  mockDb.seed("offers/oS", offerDoc("supS", [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12 }, { rfqProductIndex: 1, unitPrice: 3.7 }], { leadDays: 7 }))
  mockDb.seed("offers/oM", offerDoc("supM", [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6 }, { rfqProductIndex: 1, unitPrice: 3.7 }], { leadDays: 3 }))
  mockDb.seed("offers/oAmal", offerDoc("supAmal", [{ rfqProductIndex: 0, unitPrice: 80, packLen: 6 }, { rfqProductIndex: 1, unitPrice: 13.5, packLen: 4 }], { vatRegistered: false, vatRate: 0, leadDays: 6, offerPdfUrl: null }))
}

const call = async (route: (r: NextRequest) => Promise<Response>, path: string, user: string, body: unknown) => {
  const res = await route(new NextRequest(`http://localhost/api/procurement/${path}`, { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
  return { status: res.status, json: (await res.json()) as { data?: Doc; code?: string; reason?: string } }
}
const award = (rfqId: string, picks: Array<{ li: number; offerId: string; rev?: number }>, extra: Doc = {}) =>
  call(awardRoute, "rfq/award", "buyer", { rfqId, picks: picks.map((p) => ({ rev: 1, ...p })), ...extra })
const orders = () => mockDb.list("purchaseOrders") as Doc[]
const live = (o: Doc) => o.status !== "cancelled"
const gross = (po: Doc) => Math.round(po.totalExVat * (1 + (po.vatRate ?? 0)) * 100) / 100

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, "المالك", "all"),
    buyer: person("buyer", "ريم", ["offers.accept", "po.expedite"]),
    mgr: person("mgr", "منى", ["offers.accept", "po.approve", "po.expedite"]),
  })
  mockDb.seed("users/org1", { companyName: "المقاول", organizationId: ORG })
})

describe("G-01 — a request is in one state and in one segment (exhaustive over what its lines can be)", () => {
  const clock = replyClockOf(NOW, DEFAULT_RESOLVED_POLICIES)
  const line = (no: number, kind: string): IncomingLine => {
    const base: IncomingLine = { no, name: `m${no}`, unit: "u", qty: 10, v: 1 }
    switch (kind) {
      case "buy":
        return { ...base, stk: { st: "none", at: "2026-10-20T08:00:00Z", by: "x" } as never }
      case "wait":
        return { ...base, stk: { st: "wait", at: NOW.toISOString(), until: "2026-10-23", src: "proc" } as never }
      case "rfq":
        return { ...base, ps: "rfq", rfqId: "q1" }
      case "po":
        return { ...base, ps: "po", poId: "p1", poNumber: "PO-2026/001" }
      case "fail":
        return { ...base, ps: "fail", fail: { code: "avail", why: "x", alt: "", at: "x", by: "x" } }
      case "covered":
        return { ...base, stk: { st: "issue", give: 10, at: "2026-10-20T08:00:00Z", by: "x" } as never }
      case "gone":
        return { ...base, gone: { kind: "withdrawn" } }
      default:
        return { ...base, ps: "po", poId: "p1", poNumber: "PO-2026/001", rcv: true }
    }
  }
  const KINDS = ["buy", "wait", "rfq", "po", "fail", "covered", "gone", "received"]

  it("512 line combinations × a draft or not: each makes ONE state, ONE segment, and the segment counts add up to the requests", () => {
    const facts: Array<{ st: RequestSt; buyLines: number }> = []
    for (const a of KINDS) for (const b of KINDS) for (const c of KINDS) for (const prep of [false, true]) {
      const lines = [line(1, a), line(2, b), line(3, c)]
      const st = deriveRequest(lines, { prep, clock })
      const buyLines = buyLineIndexes(lines, clock).length
      const seg = segmentOfRequest(st, buyLines)
      expect(INCOMING_SEGMENTS).toContain(seg)
      expect(seg).not.toBe("all")
      facts.push({ st, buyLines })
    }
    const counts = incomingSegmentCounts(facts)
    const sum = (counts.new + counts.prepared + counts.rfq + counts.order + counts.done + counts.ended)
    expect(counts.all).toBe(facts.length)
    expect(sum).toBe(facts.length)
    expect(new Set(facts.map((f) => f.st)).size).toBeGreaterThanOrEqual(7)
  })

  it("a line is exactly one kind to the desk", () => {
    for (const k of KINDS) expect(typeof lineKind(line(1, k), clock)).toBe("string")
    const doc = { st: "new", lines: [line(1, "buy")] } as unknown as IncomingDoc
    expect(summaryOf(doc, clock)).toEqual({ st: "new", buyLines: 1 })
  })
})

describe("G-02 / G-03 / G-18 — ONE number for the effective price and the lowest complete offer, in every view and on the order", () => {
  const rfq = rfqDoc() as unknown as PlanRfq
  const offers = (): PlanOffer[] => ["oA", "oS", "oM", "oAmal"].map((id) => ({ id, ...(mockDb.get(`offers/${id}`) as Doc) }) as unknown as PlanOffer)
  const plan = () => ({ today: "2026-10-22", policies: resolvePolicies(null), decisions: {}, locked: {}, liveOfferIds: new Set<string>() })

  beforeEach(() => worldExample())

  it("G-03 — 3,840.43 including VAT: the evaluation, the rows, the best-of card, the comparison model and the order the award writes", async () => {
    const list = offers()
    const ev = evaluateOffers(rfq as never, list as never)
    expect(ev.lowestComplete?.id).toBe("oA")
    const { rows, ev: rowsEv } = buildOfferRows({ rfq: rfq as never, offers: list as unknown as RowOffer[], decisions: {}, today: "2026-10-22", tiePercent: 0.5 })
    const cards = bestCards({ rows, ev: rowsEv, rfq: rfq as never, limit: 3, hasRecord: () => true })
    const model = buildCompareModel({ rfq, offers: list, ctx: { ...plan() }, picks: {}, history: [], experienceOf: () => null, verifiedOf: () => true })
    const column = model.columns.find((c) => c.offer.id === "oA")!
    expect(model.lowestCompleteId).toBe("oA")
    const figures = [ev.lowestComplete?.grossH, rows.find((r) => r.rank === 1)?.grossH, cards.lowest?.grossH, column.facts.grossH]
    expect(new Set(figures).size).toBe(1)
    expect(figures[0]).toBe(384043)

    const res = await award("r1", [{ li: 0, offerId: "oA" }, { li: 1, offerId: "oA" }], { why: { code: "other", text: "أقل عرض كامل وأقرب توريد" } })
    expect([res.status, res.json.code]).toEqual([200, undefined])
    expect(gross(orders()[0])).toBe(3840.43)
  })

  it("G-02 — pieces = ⌈need ÷ length⌉, total = pieces × price, effective = total ÷ need: the evaluation, the comparison cell and the order line agree", async () => {
    const list = offers()
    const sharq = list.find((o) => o.id === "oS")!
    const calc = calcOffer(rfq as never, sharq as never)
    expect(calc.lines[0].pack).toMatchObject({ pcs: 15, received: 180, extra: 5 })
    const model = buildCompareModel({ rfq, offers: list, ctx: { ...plan() }, picks: {}, history: [], experienceOf: () => null, verifiedOf: () => true })
    const cell = model.rows[0].cells["oS"]
    expect(cell).toMatchObject({ state: "price", rateH: 14600, effective: true })
    expect(cell.pack).toMatchObject({ pcs: 15, received: 180 })
    expect(cell.effH).toBe(1251)
    expect(cell.totalH).toBe(219000)

    const res = await award("r1", [{ li: 0, offerId: "oS" }], { lowComp: { code: "urgent" } })
    expect(res.status).toBe(200)
    const line0 = orders()[0].lines[0]
    expect(line0).toMatchObject({ quantity: 15, unitPrice: 146, pk: 12, need: 175 })
    expect(line0.quantity * line0.unitPrice).toBe(2190)
    expect(Math.round((2190 / 175) * 1000) / 1000).toBe(12.514)
  })

  it("G-18 — every total on its own VAT basis: a registered supplier's order is ×1.15, the unregistered one's carries no VAT, and both read the same on the evaluation", async () => {
    const list = offers()
    const ev = evaluateOffers(rfq as never, list as never)
    const amal = ev.byId["oAmal"]
    expect(amal.grossH).toBe(amal.netH)
    expect(Math.abs((ev.byId["oA"].grossH as number) - (ev.byId["oA"].netH as number) * 1.15)).toBeLessThanOrEqual(1)
    const res = await award("r1", [{ li: 0, offerId: "oAmal" }, { li: 1, offerId: "oAmal" }], { lowComp: { code: "urgent" }, why: { code: "other", text: "سبب مكتوب كافٍ" } })
    expect(res.status).toBe(200)
    expect(orders()[0]).toMatchObject({ vatRate: 0, noVat: true })
    expect(gross(orders()[0])).toBe((amal.grossH as number) / 100)
  })
})

describe("G-04 / G-05 / G-13 / G-16 — read over what the award stored", () => {
  beforeEach(async () => {
    worldExample()
    mockDb.seed("rfqs/r2", rfqDoc({ rfqNumber: "RFQ-2026/012", products: [prod("حديد", 10, { deliverySiteId: "s1" }), prod("خشب", 20, { deliverySiteId: "s2" }), prod("دهان", 5, { deliverySiteId: "s1" })] }))
    mockDb.seed("offers/p1", offerDoc("supA", [{ rfqProductIndex: 0, unitPrice: 10 }, { rfqProductIndex: 1, unitPrice: 5 }, { rfqProductIndex: 2, unitPrice: 40 }], { rfqId: "r2" }))
    mockDb.seed("offers/p2", offerDoc("supS", [{ rfqProductIndex: 0, unitPrice: 12 }, { rfqProductIndex: 1, unitPrice: 4 }, { rfqProductIndex: 2, unitPrice: 41 }], { rfqId: "r2" }))
    expect((await award("r1", [{ li: 0, offerId: "oM" }, { li: 1, offerId: "oAmal" }], { why: { code: "fastest" }, lowComp: { code: "urgent" } })).status).toBe(200)
    expect((await award("r2", [{ li: 0, offerId: "p1" }, { li: 1, offerId: "p2" }, { li: 2, offerId: "p1" }], { lowComp: { code: "urgent" }, why: { code: "other", text: "نفضّل المورد الأول" } })).status).toBe(200)
  })

  it("G-05 — one order per supplier × delivery site; every line sits in the site its order names", () => {
    for (const rfqId of ["r1", "r2"]) {
      const rfq = mockDb.get(`rfqs/${rfqId}`) as Doc
      const mine = orders().filter((o) => o.rfqId === rfqId && live(o))
      const keys = mine.map((o) => `${o.supplierOrgId}|${o.siteKey}`)
      expect(new Set(keys).size).toBe(keys.length)
      for (const o of mine) for (const l of o.lines) expect(o.siteKey).toContain(rfq.products[l.rfqProductIndex].deliverySiteId)
    }
    const r2 = orders().filter((o) => o.rfqId === "r2")
    expect(r2).toHaveLength(2)
    expect(r2.find((o) => o.supplierOrgId === "supA")?.lines.map((l: Doc) => l.rfqProductIndex)).toEqual([0, 2])
  })

  it("G-04 — an order that is not on the lowest offer carries its reason, as a tag and as the stored code", () => {
    const rfq1 = mockDb.get("rfqs/r1") as Doc
    const offers = ["oA", "oS", "oM", "oAmal"].map((id) => ({ id, ...(mockDb.get(`offers/${id}`) as Doc) }))
    const ev = evaluateOffers(rfq1 as never, offers as never)
    const bad = orders().filter((o) => o.rfqId === "r1" && live(o)).filter((o) => o.lines.some((l: Doc) => !(ev.lines.find((e) => e.rfqProductIndex === l.rfqProductIndex)?.lowestIds ?? []).includes(o.offerId))).filter((o) => !o.tags?.notLowest && !o.awardWhy)
    expect(bad.map((o) => o.docNumber)).toEqual([])
    expect(orders().some((o) => o.tags?.notLowest)).toBe(true)
  })

  it("G-13 — a request line is carried by one order at most (no line twice in live orders)", () => {
    for (const rfqId of ["r1", "r2"]) {
      const seen = new Set<number>()
      for (const o of orders().filter((x) => x.rfqId === rfqId && live(x))) for (const l of o.lines) {
        expect(seen.has(l.rfqProductIndex)).toBe(false)
        seen.add(l.rfqProductIndex)
      }
    }
    expect(mockDb.get("offers/oM")).toMatchObject({ awardedLines: [0] })
  })

  it("G-16 — the controls are constraints, not texts: nothing is sent before it is approved, and the approval is the server's", async () => {
    mockDb.seed("purchaseOrders/waiting", { ...(orders()[0] as Doc), status: "awaiting_approval", sentAt: null, approvedAt: null, preparedById: "buyer" })
    const sent = await call(sendRoute, "po/send", "buyer", { poId: "waiting", channel: "portal" })
    expect(sent.status).toBeGreaterThanOrEqual(400)
    expect((mockDb.get("purchaseOrders/waiting") as Doc).status).toBe("awaiting_approval")
    expect((await call(approveRoute, "po/approve", "buyer", { poId: "waiting" })).status).toBeGreaterThanOrEqual(400)
    mockDb.seed("rfqs/r3", rfqDoc({ products: [prod("حديد", 100)] }))
    mockDb.seed("offers/t1", offerDoc("supA", [{ rfqProductIndex: 0, unitPrice: 300 }], { rfqId: "r3" }))
    mockDb.seed("offers/t2", offerDoc("supS", [{ rfqProductIndex: 0, unitPrice: 320 }], { rfqId: "r3" }))
    expect((await award("r3", [{ li: 0, offerId: "t1" }])).json.code).toBe("lowcomp_reason_required")
  })
})

describe("G-15 — the supplier's edit, from any door, never erases the buyer's decisions or renames him", () => {
  const SUP: QuoteSupplier = { uid: "su1", name: "Sami", orgId: "sup1", company: "Al Noor", field: { specs: ["حديد"], cities: ["الرياض"] }, vatRate: 0.15, approved: true }
  const values = (p0: string) => ({ prices: { i1: p0, i2: "3.6" }, skip: {}, total: "", arrive: "", valid: "2026-11-27", note: "" })

  it("shortlisted + asked for a better price, then he edits through the free-journey act: the record, the name and the first version are untouched", async () => {
    mockDb.seed("rfqs/R1", { ...rfqDoc(), category: "حديد", city: "الرياض", visibility: "public", products: [{ name: "x", quantity: 175, unitOfMeasure: "م" }, { name: "y", quantity: 320, unitOfMeasure: "م" }] })
    mockDb.seed("users/org1", { role: "Contractor", organizationId: ORG, name: "Saad" })
    const { offerId } = (await runQuoteAct(mockDb as never, SUP, quoteActSchema.parse({ action: "quote.new", rfqId: "R1", values: values("12.5") }) as QuoteAct, NOW)) as { offerId: string }
    const caller = { uid: ORG, name: "Saad", orgId: ORG, can: () => true }
    await runOfferDecision(mockDb as never, caller, decideSchema.parse({ action: "shortlist", offerId }) as DecideInput, NOW)
    await runOfferDecision(mockDb as never, caller, decideSchema.parse({ action: "bafo", offerId, replyBy: "2026-10-28" }) as DecideInput, NOW)
    const record = JSON.stringify(mockDb.get(`offerDecisions/${offerId}`))
    const name = (mockDb.get(`offers/${offerId}`) as Doc).companyName
    await runQuoteAct(mockDb as never, SUP, quoteActSchema.parse({ action: "quote.version", offerId, mode: "edit", values: values("12.4") }) as QuoteAct, NOW)
    expect(JSON.stringify(mockDb.get(`offerDecisions/${offerId}`))).toBe(record)
    expect((mockDb.get(`offers/${offerId}`) as Doc).companyName).toBe(name)
    expect((mockDb.get(`offers/${offerId}`) as Doc).versions.map((v: Doc) => v.n)).toEqual([1, 2])
  })
})
