/** @jest-environment node */
/**
 * Procurement 2.0 — every door a quote enters through runs the same rules on the server (G-07, NFR-07, G-15, R-20, R-18):
 * the full portal / assistant / mobile route, the free journey's acts, the visitor link and the guest's own page. A request
 * that is closed, late or not his is refused; a price is positive, finite and under the ceiling; a pack is one the line
 * offers and the total is ours to compute; every quote is born as version 1 and every edit is the next one.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import { buildQuote, currentVersionOf, leadDaysFrom, leadDaysRefusal, legacyVersionOf, nextVersions, offerRev, quotingGate, versionFromQuote, type QuoteRfq } from "@/lib/procurement/offer-versions"
import { MAX_UNIT_PRICE } from "@/lib/procurement/input-limits"
import { calcOffer, evaluateOffers } from "@/lib/procurement/offer-calc"
import { quoteBlocks, versionOf, type QuoteValues } from "@/lib/supplier-free/quote-rules"
import { rfqItems } from "@/lib/supplier-free/quote-rules"
import { createSupplierOffer, SupplierOfferError } from "@/lib/supplier-offer-server"
import { QuoteActError, quoteActSchema, runQuoteAct, type QuoteAct, type QuoteSupplier } from "@/lib/supplier-free/server-quote-acts"

const mockDb = new FakeAdminDb()
const mockVerifyOtp = jest.fn(async (..._a: unknown[]) => "ok" as "ok" | "wrong")

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
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }), arrayUnion: (v: unknown) => [v] } }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1), permissionHolders: jest.fn(async () => []) }))
jest.mock("@/lib/org-identity-admin", () => ({ resolveIdentityAdmin: async (_db: unknown, _uid: string, base: unknown) => base }))
jest.mock("@/lib/email", () => ({
  sendEmail: async () => ({ sent: true }),
  buildRfqShareEmail: () => ({ subject: "s", html: "h" }),
  buildGuestOfferReceiptEmail: () => ({ subject: "s", html: "h" }),
}))
jest.mock("@/lib/sms", () => ({ canSendCodes: () => true, isVerifyConfigured: () => false, isSmsConfigured: () => true, sendSms: async () => ({ sent: true }), startVerification: async () => ({ sent: true }) }))
jest.mock("@/lib/otp", () => ({
  OTP_CHALLENGES: "otpChallenges",
  maskPhone: (p: string) => p,
  issueOtp: async () => ({ challengeId: "ch1", code: "123456" }),
  issueRemoteOtp: async () => ({ challengeId: "ch1" }),
  verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
}))

import { POST as supplierOffers } from "@/app/api/supplier/offers/route"
import { POST as visitorOffer } from "@/app/api/rfq-share/[token]/offer/route"
import { POST as guestAction } from "@/app/api/guest-offer/[token]/action/route"
import { POST as createLink } from "@/app/api/rfq-share/create/route"
import { createGuestOfferLink } from "@/lib/guest-offer"

type Doc = Record<string, unknown>
const db = mockDb as never

// 2026-10-13 09:00 in Riyadh.
const NOW = new Date("2026-10-13T06:00:00Z")
const FUTURE = "2099-12-31"

const SALE = [
  { ar: "قطعة 6 م", en: "piece 6 m", lengthM: 6, from: "list" },
  { ar: "قطعة 12 م", en: "piece 12 m", lengthM: 12, from: "list" },
]
// RFQ-2026/011: 175 m of angle iron (sold by the 6 m and 12 m piece, a 24-month warranty asked), 320 m of timber.
const rfq = (over: Doc = {}): Doc => ({
  organizationId: "org1",
  contractorId: "org1",
  createdByUserId: "org1",
  rfqNumber: "RFQ-2026/011",
  title: "زوايا حديد وخشب",
  category: "حديد",
  city: "الرياض",
  status: "New",
  visibility: "public",
  pricingMode: "line",
  deadline: "2026-10-20",
  products: [
    { name: "زوايا حديد 50×50×5", quantity: 175, unitOfMeasure: "م", saleUnits: SALE, warrantyMonths: 24, requiresWarranty: true },
    { name: "خشب ألواح", quantity: 320, unitOfMeasure: "م" },
  ],
  offersCount: 0,
  log: [],
  ...over,
})

const COMPANY = { uid: "su1", name: "Sami", orgId: "sup1", company: "Al Noor", approved: true, hasVat: true, field: { specs: ["حديد"], cities: ["الرياض"], subIds: [] as string[] } }
const SUP: QuoteSupplier = { uid: "su1", name: "Sami", orgId: "sup1", company: "Al Noor", field: { specs: ["حديد"], cities: ["الرياض"] }, vatRate: 0.15, approved: true }
const code = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof SupplierOfferError || e instanceof QuoteActError ? e.code : String(e)))
const asRfq = (r: Doc) => r as unknown as QuoteRfq

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockVerifyOtp.mockResolvedValue("ok")
  mockDb.seed("rfqs/R1", rfq())
})

describe("buildQuote — the one place a quote becomes numbers (R-20, R-18, NFR-07)", () => {
  const pieces = (rate: unknown, packLen: unknown, extra: Doc = {}) => buildQuote(asRfq(rfq()), { lines: [{ rfqProductIndex: 0, unitPrice: rate, packLen, ...extra }, { rfqProductIndex: 1, unitPrice: 3.6 }] }, { registered: true })

  it("prices by the sale unit: 30 × «قطعة 6 م» at 74 is 2,220 for the 175 m asked, 180 m received", () => {
    const out = pieces(74, 6)
    expect(out.ok && out.quote.lines[0]).toEqual({ rfqProductIndex: 0, unitPrice: 74, packLen: 6, packKey: "قطعة 6 م" })
    expect(out.ok && out.quote.total).toBe(2220 + 1152)
    const o = calcOffer(asRfq(rfq()) as never, { lines: out.ok ? out.quote.lines : [] })
    expect(o.lines[0].pack).toMatchObject({ pcs: 30, received: 180, extra: 5 })
    const twelve = pieces(146, 12)
    expect(twelve.ok && twelve.quote.total).toBe(2190 + 1152)
  })

  it("the example's ranking holds: 12.50/m and 146 per 12 m tie within half a percent; 80 per 6 m does not", () => {
    const offer = (rate: number, pack?: number) => {
      const q = buildQuote(asRfq(rfq()), { lines: [{ rfqProductIndex: 0, unitPrice: rate, packLen: pack }, { rfqProductIndex: 1, unitPrice: 3.6 }] }, { registered: true })
      return { id: `${rate}-${pack}`, lines: q.ok ? q.quote.lines : [] }
    }
    const ev = evaluateOffers(asRfq(rfq()) as never, [offer(12.5), offer(146, 12), offer(80, 6)])
    expect(ev.lowestComplete?.id).toBe("12.5-undefined")
    expect(ev.byId["146-12"].isLowestComplete).toBe(true)
    expect(ev.byId["80-6"].isLowestComplete).toBe(false)
  })

  it("refuses a pack the line does not offer, and a pack on a line that has none", () => {
    expect(pieces(74, 7)).toEqual({ ok: false, refusal: { code: "pack_not_offered", indexes: [0] } })
    const out = buildQuote(asRfq(rfq()), { lines: [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6, packLen: 6 }] }, { registered: true })
    expect(out).toEqual({ ok: false, refusal: { code: "pack_not_offered", indexes: [1] } })
  })

  it("a price is positive, finite and under the ceiling", () => {
    expect(pieces(0, undefined)).toMatchObject({ ok: false, refusal: { code: "price_invalid" } })
    expect(pieces(-4, undefined)).toMatchObject({ ok: false, refusal: { code: "price_invalid" } })
    expect(pieces("abc", undefined)).toMatchObject({ ok: false, refusal: { code: "price_invalid" } })
    expect(pieces(Infinity, undefined)).toMatchObject({ ok: false })
    expect(pieces(MAX_UNIT_PRICE + 1, undefined)).toMatchObject({ ok: false, refusal: { code: "price_too_big", indexes: [0] } })
    expect(pieces(MAX_UNIT_PRICE, undefined)).toMatchObject({ ok: true })
    const total = buildQuote(asRfq(rfq({ pricingMode: "total" })), { total: 0 }, { registered: true })
    expect(total).toMatchObject({ ok: false, refusal: { code: "price_invalid" } })
    expect(buildQuote(asRfq(rfq({ pricingMode: "total" })), { total: MAX_UNIT_PRICE + 1 }, { registered: true })).toMatchObject({ refusal: { code: "price_too_big" } })
  })

  it("keeps the partial-offer rules: a line is priced or marked, never blank or both", () => {
    expect(buildQuote(asRfq(rfq()), { lines: [{ rfqProductIndex: 0, unitPrice: 12.5 }] }, { registered: true })).toMatchObject({ ok: false, refusal: { code: "line_prices_incomplete", indexes: [1] } })
    const partial = buildQuote(asRfq(rfq()), { lines: [{ rfqProductIndex: 0, unitPrice: 12.5 }], skipped: [1] }, { registered: true })
    expect(partial.ok && partial.quote.skipped).toEqual([1])
    expect(buildQuote(asRfq(rfq()), { lines: [{ rfqProductIndex: 0, unitPrice: 12.5 }], skipped: [0, 1] }, { registered: true })).toMatchObject({ refusal: { code: "line_contradictory" } })
    expect(buildQuote(asRfq(rfq()), { lines: [], skipped: [0, 1] }, { registered: true })).toMatchObject({ refusal: { code: "no_line_priced" } })
  })

  it("the warranty offered is whole months (0 = none); VAT follows his registration; «للطلب كاملاً فقط» travels", () => {
    expect(pieces(74, 6, { warrantyMonths: 12 }).ok).toBe(true)
    const none = pieces(74, 6, { warrantyMonths: 0 })
    expect(none.ok && none.quote.lines[0].warrantyMonths).toBe(0)
    expect(pieces(74, 6, { warrantyMonths: 1.5 })).toMatchObject({ ok: false, refusal: { code: "warranty_invalid" } })
    expect(pieces(74, 6, { warrantyMonths: 500 })).toMatchObject({ ok: false, refusal: { code: "warranty_invalid" } })
    const free = buildQuote(asRfq(rfq()), { lines: [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6 }], whole: true }, { registered: false })
    expect(free.ok && free.quote).toMatchObject({ vatRegistered: false, vatRate: 0, whole: true })
  })

  it("a total-priced request of several materials is a lump sum; of one it is not", () => {
    const lump = buildQuote(asRfq(rfq({ pricingMode: "total" })), { total: "5,000" }, { registered: true })
    expect(lump.ok && lump.quote).toMatchObject({ mode: "total", total: 5000, lump: 5000, lines: [] })
    const one = buildQuote(asRfq(rfq({ pricingMode: "total", products: [{ name: "x", quantity: 4, unitOfMeasure: "م" }] })), { total: 100 }, { registered: true })
    expect(one.ok && one.quote.lump).toBeNull()
  })

  it("a duration is a whole number of days from 1 to 365", () => {
    expect(leadDaysFrom("2", "أسابيع")).toBe(14)
    expect(leadDaysFrom("5", "أيام")).toBe(5)
    expect(leadDaysFrom("", "أيام")).toBeNull()
    for (const days of [0, -3, 366, 1.5, NaN]) expect(leadDaysRefusal(days)).toBe("duration_invalid")
    expect(leadDaysRefusal(1)).toBeNull()
    expect(leadDaysRefusal(365)).toBeNull()
    expect(leadDaysRefusal(leadDaysFrom("13", "أشهر"))).toBe("duration_invalid")
  })
})

describe("versions: V1, V2…, and an old offer reads as V1", () => {
  it("keeps every version and numbers the next; a legacy offer is its own first version", () => {
    const legacy = { price: "400", createdAt: "2026-10-10T08:00:00.000Z", validUntil: "2026-10-27", lines: [{ rfqProductIndex: 0, unitPrice: 4 }], deliveryBatches: [{ deliveryDate: "2026-10-30" }] }
    expect(offerRev(legacy)).toBe(1)
    expect(currentVersionOf(legacy)).toMatchObject({ n: 1, total: 400, valid: "2026-10-27", arrive: "2026-10-30" })
    const next = versionFromQuote({ mode: "line", lines: [{ rfqProductIndex: 0, unitPrice: 3.5 }], skipped: [], total: 350, lump: null, whole: false, vatRegistered: true, vatRate: 0.15 }, { at: "2026-10-13", valid: "2026-11-01", by: "guest" })
    const all = nextVersions(legacy, next)
    expect(all.map((v) => [v.n, v.total])).toEqual([[1, 400], [2, 350]])
    expect(offerRev({ ...legacy, versions: all })).toBe(2)
    expect(nextVersions({ ...legacy, versions: all }, next).map((v) => v.n)).toEqual([1, 2, 3])
    expect(legacyVersionOf({}).total).toBe(0)
  })
})

describe("G-07 — the request must take quotes: open, in time, and (for the portal) reaching him", () => {
  it("the one rule: `New`, and the deadline's own day is still open", () => {
    expect(quotingGate({ status: "New", deadline: "2026-10-13" }, "2026-10-13")).toBeNull()
    expect(quotingGate({ status: "New", deadline: "2026-10-12" }, "2026-10-13")).toBe("deadline")
    expect(quotingGate({ status: "Awarded", deadline: "2026-10-20" }, "2026-10-13")).toBe("rfq_closed")
    expect(quotingGate({ status: "Cancelled" }, "2026-10-13")).toBe("rfq_closed")
    expect(quotingGate(undefined, "2026-10-13")).toBe("rfq_closed")
  })

  describe("door 1 — the full portal, the assistant, the mobile app (`createSupplierOffer`)", () => {
    const send = (body: Doc, over: Partial<typeof COMPANY> = {}, rfqId = "R1") => createSupplierOffer(db, { ...COMPANY, ...over }, rfqId, body, { now: NOW })
    const line = (rate: number, extra: Doc = {}) => ({ rfqProductIndex: 0, unitPrice: rate, ...extra })
    const body = (over: Doc = {}): Doc => ({ lines: [line(12.5, { warrantyMonths: 24 }), { rfqProductIndex: 1, unitPrice: 3.6 }], validUntil: "2026-10-27", deliveryBatches: [{ location: "x", deliveryDate: "2026-10-30", price: "1", quantity: "495" }], ...over })

    it("refuses an awarded or cancelled request, and a deadline that has passed — but not its own last day", async () => {
      mockDb.seed("rfqs/awarded", rfq({ status: "Awarded" }))
      mockDb.seed("rfqs/late", rfq({ deadline: "2026-10-12" }))
      mockDb.seed("rfqs/today", rfq({ deadline: "2026-10-13" }))
      expect(await code(send(body(), {}, "awarded"))).toBe("rfq_closed")
      expect(await code(send(body(), {}, "late"))).toBe("deadline")
      expect(await code(send(body(), {}, "today"))).toBeNull()
      expect(mockDb.list("offers")).toHaveLength(1)
    })

    it("refuses a request that does not reach him: private and not invited, or another field", async () => {
      mockDb.seed("rfqs/private", rfq({ visibility: "private" }))
      mockDb.seed("rfqs/field", rfq({ category: "دهانات" }))
      mockDb.seed("rfqs/invited", rfq({ visibility: "private", allowedSupplierOrgIds: ["sup1"] }))
      expect(await code(send(body(), {}, "private"))).toBe("not_reached")
      expect(await code(send(body(), {}, "field"))).toBe("not_reached")
      expect(await code(send(body(), {}, "invited"))).toBeNull()
    })

    it("a second quote of the same company is an edit, not another offer — until the first is withdrawn", async () => {
      expect(await code(send(body()))).toBeNull()
      expect(await code(send(body()))).toBe("already_quoted")
      const [first] = mockDb.list("offers")
      mockDb.seed(`offers/${first.id}`, { ...first, status: "مسحوب", withdrawnAt: "2026-10-13T07:00:00.000Z" })
      expect(await code(send(body()))).toBeNull()
    })

    it("recomputes the total from the lines (the browser's is dropped), by the sale unit, and is born as version 1 with its flags", async () => {
      const lines = [line(74, { packLen: 6, warrantyMonths: 24 }), { rfqProductIndex: 1, unitPrice: 3.6 }]
      const { id } = await send(body({ price: "1", lines, whole: true, executionDuration: "2", executionDurationUnit: "أسابيع", vatRegistered: true, versions: [{ n: 9 }], rev: 9 }), { hasVat: false })
      const saved = mockDb.get(`offers/${id}`) as Doc & { versions: Doc[]; lines: Doc[]; deliveryBatches: Doc[] }
      expect(saved.price).toBe("3372")
      expect(saved.lines[0]).toEqual({ rfqProductIndex: 0, unitPrice: 74, packLen: 6, packKey: "قطعة 6 م", warrantyMonths: 24 })
      expect(saved).toMatchObject({ whole: true, vatRegistered: false, vatRate: 0, leadDays: 14, rev: 1, status: "قيد المراجعة" })
      expect(saved.versions).toHaveLength(1)
      expect(saved.versions[0]).toMatchObject({ n: 1, total: 3372, vatRate: 0, whole: true, leadDays: 14, by: "supplier", valid: "2026-10-27", arrive: "2026-10-30" })
      expect(saved.deliveryBatches).toHaveLength(1)
      expect(mockDb.get("procEvents/org1__proc:RFQ:RFQ-2026_011:sup1:V1")).toMatchObject({ id: "rfq_offer", refs: { offer: id } })
    })

    it("refuses a pack the line does not offer, a bad price, a warranty that is not months and a duration out of range", async () => {
      expect(await code(send(body({ lines: [line(74, { packLen: 5 }), { rfqProductIndex: 1, unitPrice: 3.6 }] })))).toBe("pack_not_offered")
      expect(await code(send(body({ lines: [line(0), { rfqProductIndex: 1, unitPrice: 3.6 }] })))).toBe("price_invalid")
      expect(await code(send(body({ lines: [line(-5), { rfqProductIndex: 1, unitPrice: 3.6 }] })))).toBe("price_invalid")
      expect(await code(send(body({ lines: [line(MAX_UNIT_PRICE + 1), { rfqProductIndex: 1, unitPrice: 3.6 }] })))).toBe("price_too_big")
      expect(await code(send(body({ lines: [line(12.5, { warrantyMonths: 2.5 }), { rfqProductIndex: 1, unitPrice: 3.6 }] })))).toBe("warranty_invalid")
      expect(await code(send(body({ executionDuration: "0", executionDurationUnit: "أيام" })))).toBe("duration_invalid")
      expect(await code(send(body({ executionDuration: "400", executionDurationUnit: "أيام" })))).toBe("duration_invalid")
      expect(mockDb.list("offers")).toHaveLength(0)
      // A zero beside «not supplied» is that mark, not a price.
      expect(await code(send(body({ lines: [line(0), { rfqProductIndex: 1, unitPrice: 3.6 }], skippedItems: [0] })))).toBeNull()
      expect(mockDb.list("offers")[0]).toMatchObject({ price: "1152", skippedItems: [0] })
    })

    it("a lump-sum body (the assistant, an older app) is checked and kept: positive, finite, under the ceiling", async () => {
      expect(await code(send({ price: "0" }))).toBe("price_invalid")
      expect(await code(send({ price: "nope" }))).toBe("price_invalid")
      expect(await code(send({}))).toBe("price_invalid")
      expect(await code(send({ price: String(MAX_UNIT_PRICE + 1) }))).toBe("price_too_big")
      expect(await code(send({ price: "5000" }))).toBeNull()
      expect(mockDb.list("offers")[0]).toMatchObject({ price: "5000", lump: 5000, rev: 1 })
    })
  })

  describe("door 1 — over HTTP: /api/supplier/offers", () => {
    beforeEach(() => mockDb.seed("rfqs/R1", rfq({ deadline: FUTURE })))
    const post = (uid: string, rfqId: string, offer: Doc) =>
      supplierOffers(new NextRequest("http://localhost/api/supplier/offers", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tok:${uid}` }, body: JSON.stringify({ rfqId, offer }) }))
    const seedSupplier = () => {
      mockDb.seed("users/su1", { role: "Supplier", organizationId: "sup1", name: "Sami" })
      mockDb.seed("users/sup1", { role: "Supplier", isVerified: true, companyName: "Al Noor", taxNumber: "300123456700003", specializations: ["حديد"], coverageCities: ["الرياض"] })
    }
    const offer = { lines: [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6 }, { rfqProductIndex: 1, unitPrice: 3.6 }], validUntil: "2026-10-27" }

    it("answers 409 for a closed or late request and 403 for one that is not his — the checks the route used to skip", async () => {
      seedSupplier()
      mockDb.seed("rfqs/awarded", rfq({ status: "Awarded" }))
      mockDb.seed("rfqs/late", rfq({ deadline: "2020-01-01" }))
      mockDb.seed("rfqs/other", rfq({ category: "دهانات", deadline: FUTURE }))
      mockDb.seed("rfqs/awarded", rfq({ status: "Awarded", deadline: FUTURE }))
      const closed = await post("su1", "awarded", offer)
      expect([closed.status, (await closed.json()).code]).toEqual([409, "rfq_closed"])
      const late = await post("su1", "late", offer)
      expect([late.status, (await late.json()).code]).toEqual([409, "deadline"])
      const other = await post("su1", "other", offer)
      expect([other.status, (await other.json()).code]).toEqual([403, "not_reached"])
      expect(mockDb.list("offers")).toHaveLength(0)
    })

    it("a good quote is written by the server, in his company's name, with its VAT from his tax number", async () => {
      seedSupplier()
      const res = await post("su1", "R1", { ...offer, executionDuration: "10", executionDurationUnit: "أيام" })
      expect(res.status).toBe(200)
      const saved = mockDb.list("offers")[0]
      expect(saved).toMatchObject({ supplierId: "su1", organizationId: "sup1", price: "3372", vatRegistered: true, vatRate: 0.15, leadDays: 10, rev: 1 })
      const dup = await post("su1", "R1", offer)
      expect([dup.status, (await dup.json()).code]).toEqual([409, "already_quoted"])
    })
  })

  describe("door 2 — the free journey's acts (`quote.new`, `quote.version`)", () => {
    const run = (act: Record<string, unknown>, now = NOW, s: QuoteSupplier = SUP) => runQuoteAct(db, s, quoteActSchema.parse(act) as QuoteAct, now)
    const values = (over: Doc = {}) => ({ prices: { i1: "74", i2: "3.6" }, skip: {}, total: "", arrive: "", valid: "2026-10-27", note: "", packs: { i1: "6" }, warranty: { i1: "24" }, whole: false, ...over })

    it("refuses a closed request, a late one, and one that is not his", async () => {
      mockDb.seed("rfqs/awarded", rfq({ status: "Awarded" }))
      mockDb.seed("rfqs/late", rfq({ deadline: "2026-10-12" }))
      mockDb.seed("rfqs/other", rfq({ category: "دهانات" }))
      expect(await code(run({ action: "quote.new", rfqId: "awarded", values: values() }))).toBe("rfq_closed")
      expect(await code(run({ action: "quote.new", rfqId: "late", values: values() }))).toBe("deadline")
      expect(await code(run({ action: "quote.new", rfqId: "other", values: values() }))).toBe("not_reached")
    })

    it("prices by the sale unit: the stored total is pieces × price, the line carries the pack and the warranty, VAT follows his number", async () => {
      const { offerId } = (await run({ action: "quote.new", rfqId: "R1", values: values({ whole: true }) }, NOW, { ...SUP, vatRate: 0 })) as { offerId: string }
      const saved = mockDb.get(`offers/${offerId}`) as Doc & { versions: Doc[]; lines: Doc[] }
      expect(saved.price).toBe("3372")
      expect(saved.lines[0]).toMatchObject({ packLen: 6, packKey: "قطعة 6 م", warrantyMonths: 24, unitPrice: 74 })
      expect(saved).toMatchObject({ whole: true, vatRegistered: false, vatRate: 0, rev: 1 })
      expect(saved.versions[0]).toMatchObject({ n: 1, total: 3372, by: "supplier", whole: true })
      expect(mockDb.get("procEvents/org1__proc:RFQ:RFQ-2026_011:sup1:V1")).toMatchObject({ id: "rfq_offer" })
    })

    it("blocks a pack the line does not offer, a price over the ceiling, a missing warranty and an arrival over a year away", async () => {
      expect(await code(run({ action: "quote.new", rfqId: "R1", values: values({ packs: { i1: "7" } }) }))).toBe("blocked")
      expect(await code(run({ action: "quote.new", rfqId: "R1", values: values({ prices: { i1: String(MAX_UNIT_PRICE + 1), i2: "3.6" } }) }))).toBe("blocked")
      expect(await code(run({ action: "quote.new", rfqId: "R1", values: values({ warranty: {} }) }))).toBe("blocked")
      expect(await code(run({ action: "quote.new", rfqId: "R1", values: values({ arrive: "2028-01-01" }) }))).toBe("blocked")
      expect(mockDb.list("offers")).toHaveLength(0)
      expect(await code(run({ action: "quote.new", rfqId: "R1", values: values({ warranty: { i1: "0" } }) }))).toBeNull()
    })

    it("an edit is the next version: the first stays, the new pack and total replace the live ones, a late edit is refused", async () => {
      const { offerId } = (await run({ action: "quote.new", rfqId: "R1", values: values() })) as { offerId: string }
      await run({ action: "quote.version", offerId, mode: "edit", values: values({ prices: { i1: "146", i2: "3.6" }, packs: { i1: "12" } }) })
      const saved = mockDb.get(`offers/${offerId}`) as Doc & { versions: Doc[]; lines: Doc[] }
      expect(saved.versions.map((v) => [v.n, v.total])).toEqual([[1, 3372], [2, 3342]])
      expect(saved.lines[0]).toMatchObject({ packLen: 12, unitPrice: 146 })
      expect(saved).toMatchObject({ price: "3342", rev: 2 })
      expect(await code(run({ action: "quote.version", offerId, mode: "edit", values: values() }, new Date("2026-10-21T06:00:00Z")))).toBe("deadline")
    })
  })

  describe("door 3 — the visitor's link and the guest's own page", () => {
    const ctx = (token: string) => ({ params: Promise.resolve({ token }) })
    const tokenOf = (url: unknown) => String(url).split("/").pop() as string
    const form = (extra: Record<string, string> = {}) => {
      const f = new FormData()
      f.set("companyName", "Visitor Trading")
      f.set("phone", "0551234567")
      f.set("price", "1500")
      f.set("challengeId", "ch1")
      f.set("code", "123456")
      for (const [k, v] of Object.entries(extra)) f.set(k, v)
      return f
    }
    const submit = (token: string, extra: Record<string, string> = {}) => visitorOffer(new NextRequest(`http://localhost/api/rfq-share/${token}/offer`, { method: "POST", body: form(extra) }), ctx(token))
    const mint = async () => {
      mockDb.seed("users/org1", { role: "Contractor", organizationId: "org1", name: "Saad", companyName: "Acme" })
      process.env.NEXT_PUBLIC_APP_URL = "https://uat.mdmaktech.sa"
      const res = await createLink(new NextRequest("http://localhost/api/rfq-share/create", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer tok:org1" }, body: JSON.stringify({ rfqId: "R1" }) }))
      return tokenOf(((await res.json()) as { data: { url: string } }).data.url)
    }
    const lines = JSON.stringify([{ rfqProductIndex: 0, unitPrice: 74, packLen: 6, warrantyMonths: 24 }, { rfqProductIndex: 1, unitPrice: 3.6 }])
    beforeEach(() => mockDb.seed("rfqs/R1", rfq({ deadline: FUTURE })))
    afterAll(() => {
      delete process.env.NEXT_PUBLIC_APP_URL
    })

    it("refuses an offer once the deadline has passed even from a page that was open (G-07)", async () => {
      const token = await mint()
      mockDb.seed("rfqs/R1", { ...(mockDb.get("rfqs/R1") as Doc), deadline: "2020-01-01" })
      const res = await submit(token, { lines })
      expect([res.status, (await res.json()).code]).toEqual([409, "DEADLINE_PASSED"])
      expect(mockDb.list("offers")).toHaveLength(0)
    })

    it("prices by the pack, takes «غير مسجّل ضريبياً» and «للطلب كاملاً فقط», and is born as version 1", async () => {
      const token = await mint()
      const res = await submit(token, { lines, vatRegistered: "false", whole: "true", executionDuration: "5", executionDurationUnit: "أيام", price: "1" })
      expect(res.status).toBe(200)
      const saved = mockDb.list("offers")[0] as unknown as Doc & { versions: Doc[]; lines: Doc[] }
      expect(saved).toMatchObject({ price: "3372", whole: true, vatRegistered: false, vatRate: 0, leadDays: 5, rev: 1, isGuestOffer: true })
      expect(saved.lines[0]).toEqual({ rfqProductIndex: 0, unitPrice: 74, packLen: 6, packKey: "قطعة 6 م", warrantyMonths: 24 })
      expect(saved.versions[0]).toMatchObject({ n: 1, total: 3372, by: "guest", vatRate: 0 })
      expect(mockDb.list("procEvents")).toHaveLength(1)
    })

    it("refuses a pack the line does not offer, a price over the ceiling and a duration out of range", async () => {
      const token = await mint()
      const bad = (l: unknown) => JSON.stringify(l)
      const pack = await submit(token, { lines: bad([{ rfqProductIndex: 0, unitPrice: 74, packLen: 5 }, { rfqProductIndex: 1, unitPrice: 3.6 }]) })
      expect([pack.status, (await pack.json()).code]).toEqual([400, "PACK_NOT_OFFERED"])
      const big = await submit(token, { lines: bad([{ rfqProductIndex: 0, unitPrice: MAX_UNIT_PRICE + 1 }, { rfqProductIndex: 1, unitPrice: 3.6 }]) })
      expect(big.status).toBe(400)
      const days = await submit(token, { lines, executionDuration: "999", executionDurationUnit: "أيام" })
      expect([days.status, (await days.json()).code]).toEqual([400, "INVALID_DURATION"])
      expect(mockDb.list("offers")).toHaveLength(0)
    })

    describe("the guest's own page: the reply to «اطلب سعراً أفضل»", () => {
      const reply = (token: string, fields: Record<string, string>) => {
        const f = new FormData()
        f.set("action", "revise_price")
        for (const [k, v] of Object.entries(fields)) f.set(k, v)
        return guestAction(new NextRequest(`http://localhost/api/guest-offer/${token}/action`, { method: "POST", body: f }), ctx(token))
      }
      const seedOffer = async (over: Doc = {}) => {
        mockDb.seed("rfqs/R1", rfq({ pricingMode: "total", products: [{ name: "Cement", quantity: 100, unitOfMeasure: "bag" }] }))
        mockDb.seed("offers/G1", {
          rfqId: "R1",
          supplierId: "guest",
          organizationId: "guest",
          isGuestOffer: true,
          companyName: "Visitor Trading",
          supplierName: "Visitor Trading",
          contractorId: "org1",
          contractorOrgId: "org1",
          status: "قيد المراجعة",
          price: "1500",
          versions: [{ n: 1, at: "2026-10-12", arrive: null, valid: "2026-10-30", note: "", fileUrl: null, total: 1500, by: "guest" }],
          rev: 1,
          bafo: { at: "2026-10-13T05:00:00.000Z", byId: "org1", byName: "Saad", replyBy: FUTURE, note: null, round: 1, answered: null },
          ...over,
        })
        const link = await createGuestOfferLink({ offerId: "G1", rfqId: "R1", contractorId: "org1" })
        return link.token
      }

      it("is the offer's next version: lower or the same, the decisions untouched, the event left", async () => {
        const token = await seedOffer()
        mockDb.seed("offerDecisions/G1", { offerId: "G1", rfqId: "R1", organizationId: "org1", shortlist: { at: "x", byId: "org1", byName: "Saad" }, exclusion: null, log: [], updatedAt: "x" })
        const record = JSON.stringify(mockDb.get("offerDecisions/G1"))
        const res = await reply(token, { price: "1400", note: "أفضل ما عندي" })
        expect(res.status).toBe(200)
        const saved = mockDb.get("offers/G1") as Doc & { versions: Doc[]; bafo: Doc }
        expect(saved).toMatchObject({ price: "1400", rev: 2, status: "قيد المراجعة" })
        expect(saved.versions.map((v) => [v.n, v.total])).toEqual([[1, 1500], [2, 1400]])
        expect(saved.versions[1]).toMatchObject({ by: "guest", bafoReply: "lowered" })
        expect(saved.bafo.answered).toMatchObject({ n: 2, kind: "lowered" })
        expect(JSON.stringify(mockDb.get("offerDecisions/G1"))).toBe(record)
        expect(mockDb.get("procEvents/org1__proc:RFQ:RFQ-2026_011:G1:V2")).toMatchObject({ id: "rfq_offer" })
        const again = await reply(token, { price: "1300" })
        expect([again.status, (await again.json()).code]).toEqual([409, "ACTION_NOT_ALLOWED"])
      })

      it("refuses a higher price, a closed request and a day that has passed", async () => {
        const token = await seedOffer()
        const higher = await reply(token, { price: "1600" })
        expect([higher.status, (await higher.json()).code]).toEqual([400, "PRICE_HIGHER"])
        const same = await reply(token, { price: "1500" })
        expect(same.status).toBe(200)
        expect((mockDb.get("offers/G1") as Doc & { versions: Doc[] }).versions[1].bafoReply).toBe("kept")

        const second = await seedOffer({ bafo: { at: "2026-10-01T05:00:00.000Z", byId: "org1", byName: "Saad", replyBy: "2026-10-05", note: null, round: 1, answered: null } })
        const lateReply = await reply(second, { price: "1400" })
        expect([lateReply.status, (await lateReply.json()).code]).toEqual([409, "REPLY_CLOSED"])

        const third = await seedOffer()
        mockDb.seed("rfqs/R1", { ...(mockDb.get("rfqs/R1") as Doc), status: "Awarded" })
        const closed = await reply(third, { price: "1400" })
        expect([closed.status, (await closed.json()).code]).toEqual([409, "RFQ_CLOSED"])
      })
    })
  })
})

describe("the free journey's rules (`quoteBlocks`, `versionOf`) agree with offer-calc", () => {
  const shape = { pricing: "item" as const, items: rfqItems(rfq()), deadline: "2026-10-20" }
  const L = { daysTo: (iso: string, from: string = "2026-10-13") => Math.round((Date.parse(iso) - Date.parse(from)) / 864e5) }
  const v = (over: Partial<QuoteValues> = {}): QuoteValues => ({ prices: { i1: "74", i2: "3.6" }, skip: {}, total: "", arrive: "", valid: "2026-10-27", note: "", packs: { i1: "6" }, warranty: { i1: "24" }, ...over })

  it("reads the request's sale units and warranty into its items", () => {
    expect(shape.items[0]).toMatchObject({ packs: [{ len: 6, name: "قطعة 6 م" }, { len: 12, name: "قطعة 12 م" }], warranty: 24 })
    expect(shape.items[1].packs).toBeUndefined()
  })

  it("the live line «30 قطعة = 180 م · 2,220» is pieces × price, and the form's net is the server's total", () => {
    const check = quoteBlocks(shape, v(), "new", L)
    expect(check.blocks).toEqual([])
    expect(check.packs.i1).toMatchObject({ pcs: 30, received: 180, extra: 5 })
    expect(check.lines.i1).toBe(2220)
    expect(check.net).toBe(3372)
    expect(versionOf(shape, v(), "2026-10-13").total).toBe(check.net)
  })

  it("blocks, in the form and again on the server: an unoffered pack, a price over the ceiling, a missing warranty, a far arrival", () => {
    const codes = (x: QuoteValues) => quoteBlocks(shape, x, "new", L).blocks.map((b) => b.code)
    expect(codes(v({ packs: { i1: "7" } }))).toEqual(["pack"])
    expect(codes(v({ prices: { i1: String(MAX_UNIT_PRICE + 1), i2: "3.6" } }))).toEqual(["big"])
    expect(codes(v({ warranty: {} }))).toEqual(["warranty"])
    expect(codes(v({ warranty: { i1: "x" } }))).toEqual(["warranty"])
    expect(codes(v({ arrive: "2030-01-01" }))).toEqual(["arrive"])
    expect(codes(v())).toEqual([])
  })

  it("a confirmation of the price asks only for a validity — the closed deadline does not block it", () => {
    const late = { ...shape, deadline: "2026-10-01" }
    expect(quoteBlocks(late, v(), "edit", L).blocks.map((b) => b.code)).toEqual(["deadline"])
    expect(quoteBlocks(late, v(), "reval", L).blocks).toEqual([])
    expect(quoteBlocks(late, v({ valid: "" }), "reval", L).blocks.map((b) => b.code)).toEqual(["valid"])
  })
})
