/** @jest-environment node */
/**
 * Procurement 2.0 — the decision side WHOLE, across modules (QA pack 2/5, WF-01/06/09/10/11/12/13/14/15/16/17/19/25): the request a
 * teammate raised is published as an RFQ, a quote enters through each of the three doors, a visitor asks and the buyer answers
 * everyone, the buyer extends, shortlists, excludes and asks for a better price, the guest lowers it on his own page, the award
 * splits across two suppliers and closes the request early, one order is approved and sent, the off-platform supplier accepts and
 * reports a delivery on the order link, both sides talk, and a cancelled order is re-awarded. One in-memory Admin Firestore for the
 * whole road; per-act refusals live in the per-module tests, what is asserted here is that each module hands the next the right thing.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}
const mockVerifyOtp = jest.fn(async (..._a: unknown[]) => "ok" as "ok" | "wrong")

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
jest.mock("@/lib/org-identity-admin", () => ({ resolveIdentityAdmin: async (_db: unknown, _uid: string, base: unknown) => base }))
jest.mock("@/lib/email", () => ({
  sendEmail: async () => ({ sent: true }),
  buildRfqShareEmail: () => ({ subject: "s", html: "h" }),
  buildGuestOfferReceiptEmail: () => ({ subject: "s", html: "h" }),
}))
jest.mock("@/lib/sms", () => ({
  canSendCodes: () => true,
  isVerifyConfigured: () => false,
  isSmsConfigured: () => false,
  sendSms: async () => ({ sent: false }),
  sendWhatsApp: async () => ({ sent: false }),
  sendDirectMessage: async () => ({ sent: false }),
  startVerification: async () => ({ sent: true }),
  normalizePhoneE164: (p: string | undefined | null) => (p ? String(p) : null),
}))
jest.mock("@/lib/otp", () => ({
  OTP_CHALLENGES: "otpChallenges",
  maskPhone: (p: string) => p,
  issueOtp: async () => ({ challengeId: "ch1", code: "123456" }),
  issueRemoteOtp: async () => ({ challengeId: "ch1" }),
  verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
}))

import { POST as awardRoute } from "@/app/api/procurement/rfq/award/route"
import { POST as approveRoute } from "@/app/api/procurement/po/approve/route"
import { POST as sendRoute } from "@/app/api/procurement/po/send/route"
import { POST as cancelRoute } from "@/app/api/procurement/po/cancel/route"
import { POST as messageRoute } from "@/app/api/procurement/po/message/route"
import { POST as visitorOffer } from "@/app/api/rfq-share/[token]/offer/route"
import { GET as visitorView } from "@/app/api/rfq-share/[token]/route"
import { POST as guestAction } from "@/app/api/guest-offer/[token]/action/route"
import { GET as poView } from "@/app/api/po-link/[token]/route"
import { POST as poAccept } from "@/app/api/po-link/[token]/accept/route"
import { POST as poReport } from "@/app/api/po-link/[token]/report-delivery/route"
import { POST as poReply } from "@/app/api/po-link/[token]/reply/route"
import { createGuestOfferLink } from "@/lib/guest-offer"
import { createSupplierOffer } from "@/lib/supplier-offer-server"
import { quoteActSchema, runQuoteAct, type QuoteAct, type QuoteSupplier } from "@/lib/supplier-free/server-quote-acts"
import { createTeamRequest } from "@/lib/procurement/incoming-server"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { publishRfq, publishSchema } from "@/lib/procurement/rfq-server/publish"
import { runLifecycle, lifecycleSchema, type LifecycleInput } from "@/lib/procurement/rfq-server/lifecycle"
import { runInquiry, inquirySchema, type InquiryInput } from "@/lib/procurement/rfq-server/inquiry"
import { decideSchema, runOfferDecision, type DecideInput } from "@/lib/procurement/offer-decisions-server"
import { evaluateOffers } from "@/lib/procurement/offer-calc"
import type { RfqCaller } from "@/lib/procurement/rfq-server/common"
import type { Firestore } from "firebase-admin/firestore"

type Doc = Record<string, any>
const ORG = "org1"
const NOW = new Date("2026-10-22T09:00:00Z")
jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })

const db = () => mockDb as unknown as Firestore
const can = (...ps: string[]) => (p: string) => ps.includes(p)
const person = (uid: string, orgId: string, name: string, perms: string[] | "all") => ({ uid, orgId, name, can: perms === "all" ? () => true : can(...perms) })
const OWNER: RfqCaller = { uid: ORG, name: "المالك", orgId: ORG, can: () => true }
const BUYER_RFQ: RfqCaller = { uid: "buyer", name: "ريم", orgId: ORG, can: can("offers.accept", "po.expedite", "rfq.manage") }

const SUP_A: QuoteSupplier = { uid: "ua", name: "سامي", orgId: "supA", company: "مصنع النور", field: { specs: ["حديد"], cities: ["الرياض"], subIds: ["s1"] }, vatRate: 0.15, approved: true }
const SUP_B: QuoteSupplier = { uid: "ub", name: "بدر", orgId: "supB", company: "مؤسسة الفجر", field: { specs: ["حديد"], cities: ["الرياض"], subIds: ["s1"] }, vatRate: 0.15, approved: true }
const COMPANY_A = { uid: "ua", name: "سامي", orgId: "supA", company: "مصنع النور", approved: true, hasVat: true, field: { specs: ["حديد"], cities: ["الرياض"], subIds: ["s1"] } }

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

const req = (route: string, user: string, body: unknown) =>
  new NextRequest(`http://localhost/api/procurement/${route}`, { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) })
type Out = { status: number; json: { success?: boolean; data?: Doc; code?: string; reason?: string; error?: boolean } }
const call = async (route: (r: NextRequest) => Promise<Response>, path: string, user: string, body: unknown): Promise<Out> => {
  const res = await route(req(path, user, body))
  return { status: res.status, json: await res.json() }
}
const ctx = (token: string) => ({ params: Promise.resolve({ token }) })
const tokenOf = (url: string) => url.split("/").pop() as string
const orders = () => mockDb.list("purchaseOrders") as Doc[]
const notes = (uid: string) => mockDb.list(`users/${uid}/notifications`) as Doc[]
const decideAs = (c: Parameters<typeof runOfferDecision>[1], input: Record<string, unknown>) => runOfferDecision(db(), c, decideSchema.parse(input) as DecideInput, NOW)
const quoteAs = (s: QuoteSupplier, act: Record<string, unknown>) => runQuoteAct(db(), s, quoteActSchema.parse(act) as QuoteAct, NOW)
const decisionCaller = { uid: ORG, name: "المالك", orgId: ORG, can: () => true }
const pick = (li: number, offerId: string, rev = 1) => ({ li, offerId, rev })

const visitorForm = (lines: unknown[], extra: Record<string, string> = {}) => {
  const f = new FormData()
  f.set("companyName", "مؤسسة الرمال")
  f.set("phone", "0551234567")
  f.set("price", "1")
  f.set("challengeId", "ch1")
  f.set("code", "123456")
  f.set("validUntil", "2026-12-15")
  f.set("executionDuration", "7")
  f.set("executionDurationUnit", "أيام")
  f.set("vatRegistered", "false")
  f.set("lines", JSON.stringify(lines))
  for (const [k, v] of Object.entries(extra)) f.set(k, v)
  return f
}

let rfqId = ""
let teamKey = ""
let visitorToken = ""

beforeEach(async () => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockVerifyOtp.mockResolvedValue("ok")
  process.env.NEXT_PUBLIC_APP_URL = "https://uat.mdmaktech.sa"
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    [ORG]: person(ORG, ORG, "المالك", "all"),
    buyer: person("buyer", ORG, "ريم", ["offers.accept", "po.expedite", "rfq.manage"]),
    mgr: person("mgr", ORG, "منى", ["offers.accept", "po.approve", "po.expedite"]),
  })
  mockDb.seed(`users/${ORG}`, { role: "Contractor", organizationId: ORG, name: "المالك", companyName: "البنيان الحديثة" })
  mockDb.seed("users/buyer", { organizationId: ORG, organizationRole: "member", name: "ريم" })
  mockDb.seed("users/eng1", { organizationId: ORG, organizationRole: "member", name: "م. فهد" })
  mockDb.seed("users/ua", { role: "Supplier", organizationId: "supA", name: "سامي" })
  mockDb.seed("users/supA", { role: "Supplier", isVerified: true, companyName: "مصنع النور", taxNumber: "300123456700003", specializations: ["حديد"], coverageCities: ["الرياض"] })
  mockDb.seed("users/ub", { role: "Supplier", organizationId: "supB", name: "بدر" })
  mockDb.seed("users/supB", { role: "Supplier", isVerified: true, companyName: "مؤسسة الفجر", taxNumber: "300123456700004", specializations: ["حديد"], coverageCities: ["الرياض"] })

  const team = await createTeamRequest(
    db(),
    ORG,
    { uid: "eng1", name: "م. فهد" },
    {
      lines: [
        { name: "حديد 16", unit: "طن", quantity: 10 },
        { name: "إسمنت عادي", unit: "كيس", quantity: 200 },
      ],
      needBy: "2026-11-10",
      siteId: null,
      place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" },
      requestedFor: { kind: "member", id: "eng1", name: "م. فهد" },
    },
    new Date("2026-10-19T08:00:00Z")
  )
  teamKey = team.mrKey
  const source = { kind: "team_request", purchaseRequestId: teamKey.slice("team:".length) }
  const published = await publishRfq(
    db(),
    BUYER_RFQ,
    publishSchema.parse({
      title: "حديد وإسمنت — مجمع الياسمين",
      audience: "public",
      deadline: "2026-10-30",
      pricing: "line",
      doc: { products: [product("حديد 16", 10, "طن", { needSource: source, needLine: 0 }), product("إسمنت عادي", 200, "كيس", { needSource: source, needLine: 1 })], city: "الرياض", subCategoryIds: ["s1"] },
      reach: { count: 2, orgIds: [] },
    }),
    NOW
  )
  rfqId = published.id
  visitorToken = tokenOf(published.guestUrl as string)
  mockDb.seed(`rfqs/${rfqId}`, { ...(mockDb.get(`rfqs/${rfqId}`) as Doc), category: "حديد", city: "الرياض" })
})

afterAll(() => {
  delete process.env.NEXT_PUBLIC_APP_URL
})

const incomingDoc = () => mockDb.get(`procIncoming/${incomingDocId(ORG, teamKey)}`) as unknown as IncomingDoc

describe("WF-01 → WF-06 — the teammate's request becomes the RFQ, and the request knows it", () => {
  it("the published RFQ is open, numbered, public with its visitor link, and its two lines are linked from the request (G-13)", () => {
    expect(mockDb.get(`rfqs/${rfqId}`)).toMatchObject({ status: "New", rfqNumber: "RFQ-2026/001", visibility: "public", deadline: "2026-10-30" })
    const doc = incomingDoc()
    expect(doc.lines.map((l) => [l.ps, l.rfqId])).toEqual([["rfq", rfqId], ["rfq", rfqId]])
    expect(doc.st).toBe("rfq")
    expect(mockDb.list("rfqShareLinks")).toHaveLength(1)
  })
})

describe("WF-09 / WF-10 — a quote enters through each door and the buyer's comparison reads all three the same way", () => {
  async function threeOffers() {
    const a = await createSupplierOffer(mockDb as never, COMPANY_A, rfqId, { lines: [{ rfqProductIndex: 0, unitPrice: 3000 }, { rfqProductIndex: 1, unitPrice: 17 }], validUntil: "2026-11-30", executionDuration: "5", executionDurationUnit: "أيام" }, { now: NOW })
    const b = (await quoteAs(SUP_B, { action: "quote.new", rfqId, values: { prices: { i1: "3100", i2: "16" }, skip: {}, total: "", arrive: "", valid: "2026-11-30", note: "" } })) as { offerId: string }
    const res = await visitorOffer(
      new NextRequest(`http://localhost/api/rfq-share/${visitorToken}/offer`, {
        method: "POST",
        body: visitorForm([{ rfqProductIndex: 0, unitPrice: 3200 }, { rfqProductIndex: 1, unitPrice: 15 }]),
      }),
      ctx(visitorToken)
    )
    expect(res.status).toBe(200)
    const guest = mockDb.list("offers").find((o) => o.isGuestOffer) as Doc
    return { a: a.id, b: b.offerId, g: guest.id as string }
  }

  it("three offers, three doors: each is version 1, each carries its company, and the guest is not VAT-registered", async () => {
    const { a, b, g } = await threeOffers()
    for (const id of [a, b, g]) expect(mockDb.get(`offers/${id}`)).toMatchObject({ rfqId, rev: 1, status: "قيد المراجعة" })
    expect(mockDb.get(`offers/${a}`)).toMatchObject({ organizationId: "supA", vatRegistered: true })
    expect(mockDb.get(`offers/${g}`)).toMatchObject({ isGuestOffer: true, vatRegistered: false, vatRate: 0 })
    const keys = mockDb.list("procEvents").map((e) => String(e.id))
    expect(keys.filter((k) => k.endsWith(":V1") && k.includes("RFQ-2026_001:")).length).toBeGreaterThanOrEqual(3)
  })

  it("G-03/G-18 — one lowest-complete figure over the three, each total on its own VAT basis", async () => {
    const { a, b, g } = await threeOffers()
    const rfq = { ...(mockDb.get(`rfqs/${rfqId}`) as Doc), id: rfqId }
    const offers = [a, b, g].map((id) => ({ id, ...(mockDb.get(`offers/${id}`) as Doc) }))
    const ev = evaluateOffers(rfq as never, offers as never)
    const low = ev.lowestComplete
    expect(low).toBeTruthy()
    const totals = Object.fromEntries(Object.entries(ev.byId).map(([id, v]) => [id, (v as Doc).total ?? (v as Doc).totalExVat]))
    expect(Object.keys(totals).sort()).toEqual([a, b, g].sort())
    expect(ev.byId[low!.id].isLowestComplete).toBe(true)
  })

  it("G-07 — the doors close with the request: after the award the visitor link refuses a new offer", async () => {
    const { a, g } = await threeOffers()
    await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(0, a), pick(1, g)], acceptGuest: true, lowComp: { code: "urgent" } })
    const late = await visitorOffer(new NextRequest(`http://localhost/api/rfq-share/${visitorToken}/offer`, { method: "POST", body: visitorForm([{ rfqProductIndex: 0, unitPrice: 1 }, { rfqProductIndex: 1, unitPrice: 1 }], { phone: "0559999999" }) }), ctx(visitorToken))
    expect(late.status).toBeGreaterThanOrEqual(400)
    expect(mockDb.list("offers")).toHaveLength(3)
  })
})

describe("WF-11 — the question, the answer for everyone, and the extension", () => {
  it("a bidder asks, the buyer answers everybody, the visitor page reads the answer without the asker, and the buyer extends the deadline", async () => {
    const { id } = (await quoteAs(SUP_A, { action: "quote.ask", rfqId, question: "هل يُقبل التسليم على دفعتين؟" })) as { id: string }
    expect([...notes(ORG), ...notes("buyer")].map((n) => n.type)).toContain("rfq_question")

    await runInquiry(db(), OWNER, inquirySchema.parse({ action: "answer", rfqId, inquiryId: id, text: "نعم، خلال أسبوع.", scope: "all" }) as InquiryInput, NOW)
    const view = await (await visitorView(new NextRequest(`http://localhost/api/rfq-share/${visitorToken}`), ctx(visitorToken))).json()
    const text = JSON.stringify(view)
    expect(text).toContain("نعم، خلال أسبوع.")
    expect(text).toContain("هل يُقبل التسليم على دفعتين؟")
    expect(text).not.toContain("مصنع النور")
    expect(text).not.toContain("supA")

    const ext = await runLifecycle(db(), OWNER, lifecycleSchema.parse({ action: "extend", rfqId, deadline: "2026-11-04" }) as LifecycleInput, NOW)
    expect(ext.deadline).toBe("2026-11-04")
    expect(mockDb.get(`rfqs/${rfqId}`)).toMatchObject({ deadline: "2026-11-04" })
    expect((mockDb.get(`rfqs/${rfqId}`) as Doc).log.map((e: Doc) => e.action)).toEqual(expect.arrayContaining(["query_answered", "extended"]))
  })
})

describe("WF-14 / WF-15 / WF-12 / WF-13 — shortlist, exclude, a better price, the split award that closes the request", () => {
  let a = ""
  let b = ""
  let g = ""
  beforeEach(async () => {
    a = (await createSupplierOffer(mockDb as never, COMPANY_A, rfqId, { lines: [{ rfqProductIndex: 0, unitPrice: 3000 }, { rfqProductIndex: 1, unitPrice: 17 }], validUntil: "2026-11-30" }, { now: NOW })).id
    b = ((await quoteAs(SUP_B, { action: "quote.new", rfqId, values: { prices: { i1: "3100", i2: "16" }, skip: {}, total: "", arrive: "", valid: "2026-11-30", note: "" } })) as { offerId: string }).offerId
    await visitorOffer(new NextRequest(`http://localhost/api/rfq-share/${visitorToken}/offer`, { method: "POST", body: visitorForm([{ rfqProductIndex: 0, unitPrice: 3200 }, { rfqProductIndex: 1, unitPrice: 16.5 }]) }), ctx(visitorToken))
    g = (mockDb.list("offers").find((o) => o.isGuestOffer) as Doc).id
  })

  it("the buyer's decisions never touch the supplier's document; an excluded offer cannot be awarded; the guest's better price is the next version and the decisions stay", async () => {
    const before = JSON.stringify(mockDb.get(`offers/${b}`))
    await decideAs(decisionCaller, { action: "shortlist", offerId: b })
    await decideAs(decisionCaller, { action: "exclude", offerId: b, code: "spec" })
    expect(JSON.stringify(mockDb.get(`offers/${b}`))).toBe(before)
    expect((await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(1, b)], lowComp: { code: "urgent" }, why: { code: "other", text: "سبب مكتوب كافٍ" } })).json.code).toBe("offer_excluded")
    await decideAs(decisionCaller, { action: "restore", offerId: b })
    expect(mockDb.get(`offerDecisions/${b}`)).toMatchObject({ exclusion: null })

    await decideAs(decisionCaller, { action: "bafo", offerId: g, replyBy: "2026-10-28" })
    const link = await createGuestOfferLink({ offerId: g, rfqId, contractorId: ORG })
    const f = new FormData()
    f.set("action", "revise_price")
    f.set("rates", JSON.stringify({ "0": 3150, "1": 16.5 }))
    f.set("price", "34800")
    const decisions = JSON.stringify(mockDb.get(`offerDecisions/${g}`))
    const reply = await guestAction(new NextRequest(`http://localhost/api/guest-offer/${link.token}/action`, { method: "POST", body: f }), ctx(link.token))
    expect(reply.status).toBe(200)
    expect(mockDb.get(`offers/${g}`)).toMatchObject({ price: "34800", rev: 2 })
    expect(JSON.stringify(mockDb.get(`offerDecisions/${g}`))).toBe(decisions)

    const stale = await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(0, g, 1)], acceptGuest: true, lowComp: { code: "urgent" }, why: { code: "other", text: "الأقل في كل بند" } })
    expect(stale.json.code).toBe("offer_changed")
    const fresh = await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(0, g, 2)], acceptGuest: true, lowComp: { code: "urgent" }, why: { code: "other", text: "بعد السعر الأفضل" } })
    expect(fresh.status).toBe(200)
  })

  it("WF-12 — the split award: the iron to the portal supplier, the cement to the guest; two orders, the loser told, the request moved to «orders»", async () => {
    const res = await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(0, a), pick(1, g)], acceptGuest: true, lowComp: { code: "urgent" }, why: { code: "other", text: "الأقل في كل بند" } })
    expect(res.status).toBe(200)
    expect(orders()).toHaveLength(2)
    expect(new Set(orders().map((o) => o.offerId))).toEqual(new Set([a, g]))
    expect(mockDb.get(`rfqs/${rfqId}`)).toMatchObject({ status: "Awarded", awardSplit: true })
    expect(mockDb.get(`offers/${b}`)).toMatchObject({ outcome: { k: "lost" } })
    expect(notes("supB").map((n) => n.type)).toContain("rfq_outcome")
    const after = incomingDoc()
    expect(after.lines.map((l) => l.ps)).toEqual(["po", "po"])
    expect(after.st).toBe("po")
  })

  it("WF-13 — awarding before the deadline closes the request: «أُغلق مبكراً» is recorded and the deadline moves back", async () => {
    const res = await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(0, a), pick(1, g)], acceptGuest: true, lowComp: { code: "urgent" }, why: { code: "other", text: "الأقل في كل بند" } })
    expect(res.status).toBe(200)
    expect(res.json.data?.closedEarly).toBe(true)
    expect(mockDb.get(`rfqs/${rfqId}`)).toMatchObject({ closedEarly: { originalDeadline: "2026-10-30", reason: "award" } })
    expect(((mockDb.get(`rfqs/${rfqId}`) as Doc).deadline as string) < "2026-10-22").toBe(true)
  })
})

describe("WF-16 / WF-17 / WF-19 / WF-25 — approve, send, the order link, the conversation, and the cancelled order re-awarded", () => {
  let a = ""
  let g = ""
  let poA: Doc
  let poG: Doc
  beforeEach(async () => {
    a = (await createSupplierOffer(mockDb as never, COMPANY_A, rfqId, { lines: [{ rfqProductIndex: 0, unitPrice: 3000 }, { rfqProductIndex: 1, unitPrice: 17 }], validUntil: "2026-11-30" }, { now: NOW })).id
    await visitorOffer(new NextRequest(`http://localhost/api/rfq-share/${visitorToken}/offer`, { method: "POST", body: visitorForm([{ rfqProductIndex: 0, unitPrice: 3200 }, { rfqProductIndex: 1, unitPrice: 16.5 }]) }), ctx(visitorToken))
    g = (mockDb.list("offers").find((o) => o.isGuestOffer) as Doc).id
    const res = await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(0, a), pick(1, g)], acceptGuest: true, lowComp: { code: "urgent" }, why: { code: "other", text: "الأقل في كل بند" } })
    expect(res.status).toBe(200)
    poA = orders().find((o) => o.offerId === a) as Doc
    poG = orders().find((o) => o.offerId === g) as Doc
  })

  it("the portal supplier's order within the limit is sent by policy; the guest's waits for a send — and the buyer who prepared never approves his own", async () => {
    expect(poA.status).toBe("sent")
    expect(poG.status).toBe("approved")
    expect(poG.sentAt ?? null).toBeNull()
  })

  it("WF-17 — the buyer sends the guest's order by WhatsApp (a 22-character link, its hash stored); the supplier accepts and reports a delivery by a day — never a quantity", async () => {
    const sent = await call(sendRoute, "po/send", "buyer", { poId: poG.id, channel: "whatsapp" })
    expect(sent.status).toBe(200)
    const link = sent.json.data?.link as string
    expect(link).toMatch(/\/po\/[A-Za-z0-9_-]{22}$/)
    const token = tokenOf(link)
    expect(JSON.stringify([...mockDb.docs.values()])).not.toContain(token)

    const view = await (await poView(new NextRequest(`http://localhost/api/po-link/${token}`), ctx(token))).json()
    const text = JSON.stringify(view)
    expect(text).not.toContain(a)
    expect(text).not.toContain("مصنع النور")
    expect(text).not.toContain(String(poA.docNumber).slice(-3) === String(poG.docNumber).slice(-3) ? "__never__" : String(poA.docNumber))

    const post = (route: (r: NextRequest, c: ReturnType<typeof ctx>) => Promise<Response>, body: unknown) => route(new NextRequest(`http://localhost/api/po-link/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(token))
    const accepted = await post(poAccept, { date: "2026-11-05" })
    expect(accepted.status).toBe(200)
    expect(mockDb.get(`purchaseOrders/${poG.id}`)).toMatchObject({ status: "accepted", acceptanceRecordedBy: "link" })
    expect((await post(poReport, { offset: 1, note: "شاحنة 7 صباحاً", qty: 5 })).status).toBe(400)
    expect((await post(poReport, { offset: 1, note: "شاحنة 7 صباحاً" })).status).toBe(200)
    const notice = mockDb.list("deliveries")[0]
    expect(notice).toMatchObject({ poId: poG.id, status: "pending_confirmation", reportedBy: "link" })
    expect(Object.keys(notice).filter((k) => /qty|quantit|lines|accepted/i.test(k))).toEqual([])

    expect((await post(poReply, { text: "الشاحنة في الطريق" })).status).toBe(200)
    const back = await call(messageRoute, "po/message", "buyer", { poId: poG.id, text: "شكراً، سنستقبلها" })
    expect(back.status).toBe(200)
    expect(mockDb.list("poMessages").map((m) => m.by).sort()).toEqual(["sup", "us"])
  })

  it("WF-25 — cancel the portal supplier's order choosing «re-award»: the RFQ returns to comparison without his offer, the guest's order stays, round 2 awards the iron again", async () => {
    mockDb.seed("offers/oC", { rfqId, contractorOrgId: ORG, supplierId: "uc", organizationId: "supC", companyName: "مورد ج", status: "قيد المراجعة", lines: [{ rfqProductIndex: 0, unitPrice: 3300 }], skippedItems: [1], price: "0", vatRegistered: true, vatRate: 0.15, leadDays: 5, validUntil: "2026-11-30", offerPdfUrl: "x.pdf", versions: [{ n: 1 }], rev: 1 })
    const cancelled = await call(cancelRoute, "po/cancel", "buyer", { poId: poA.id, why: "nacc", then: "reaward" })
    expect(cancelled.status).toBe(200)
    expect(mockDb.get(`rfqs/${rfqId}`)).toMatchObject({ status: "New", awardReopened: { poId: poA.id } })
    expect(mockDb.get(`offerDecisions/${a}`)).toMatchObject({ exclusion: { code: "order_cancelled" } })
    expect((await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(0, a)] })).json.code).toBe("offer_excluded")
    expect((await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(1, "oC")] })).status).toBeGreaterThanOrEqual(400)
    const next = await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(0, "oC")], lowComp: { code: "urgent" }, why: { code: "other", text: "الأقل بعد الإلغاء" } })
    expect(next.status).toBe(200)
    expect(next.json.data?.round).toBe(2)
    expect(orders().filter((o) => o.status !== "cancelled")).toHaveLength(2)
  })
})

describe("WF-16 — an order above the manager's limit waits for the owner, then goes", () => {
  it("the buyer's award above the limit is «بانتظار الاعتماد», the preparer and the manager are refused, the owner approves and the order is sent (G-16, G-18)", async () => {
    const big = (await createSupplierOffer(mockDb as never, COMPANY_A, rfqId, { lines: [{ rfqProductIndex: 0, unitPrice: 20000 }, { rfqProductIndex: 1, unitPrice: 17 }], validUntil: "2026-11-30" }, { now: NOW })).id
    const lowRival = ((await quoteAs(SUP_B, { action: "quote.new", rfqId, values: { prices: { i1: "20500", i2: "18" }, skip: {}, total: "", arrive: "", valid: "2026-11-30", note: "" } })) as { offerId: string }).offerId
    expect(lowRival).toBeTruthy()
    const res = await call(awardRoute, "rfq/award", "buyer", { rfqId, picks: [pick(0, big), pick(1, big)], lowComp: { code: "urgent" } })
    expect(res.status).toBe(200)
    expect(res.json.data?.orders[0].state).toBe("waiting")
    const po = orders()[0]
    expect(po.status).toBe("awaiting_approval")
    expect(incomingDoc().st).toBe("po")

    expect((await call(approveRoute, "po/approve", "buyer", { poId: po.id })).status).toBeGreaterThanOrEqual(400)
    const manager = await call(approveRoute, "po/approve", "mgr", { poId: po.id })
    expect(manager.status).toBe(409)
    expect(manager.json.reason).toBe("above_limit")
    expect((mockDb.get(`purchaseOrders/${po.id}`) as Doc).status).toBe("awaiting_approval")

    const owner = await call(approveRoute, "po/approve", ORG, { poId: po.id })
    expect(owner.status).toBe(200)
    expect(mockDb.get(`purchaseOrders/${po.id}`)).toMatchObject({ status: "sent", approvedById: ORG })
    const sentPo = mockDb.get(`purchaseOrders/${po.id}`) as Doc
    expect(sentPo.log.map((e: Doc) => e.action)).toEqual(expect.arrayContaining(["approved", "sent"]))
    expect(mockDb.list("procEvents").some((e) => String(e.id).includes(`proc:PO:${String(sentPo.docNumber).replace("/", "_")}:V1`))).toBe(true)
  })
})
