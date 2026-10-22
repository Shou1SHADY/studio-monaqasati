/** @jest-environment node */
/**
 * Procurement 2.0 — the buyer's decisions about an offer, kept apart from the supplier's document (WF-14, WF-15, R-03,
 * R-16, G-15, G-16). Runs the real server code over an in-memory Admin Firestore: shortlist ★, exclusion with its reason
 * and restore, «اطلب سعراً أفضل» (one round per offer, never a higher price), «اطلب تأكيد السعر», a clarification — and the
 * guarantee that a supplier's edit, from any door, leaves the record exactly as it was.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import { DecisionError, decideSchema, runOfferDecision, type DecideInput, type DecisionCaller } from "@/lib/procurement/offer-decisions-server"
import { OFFER_DECISIONS, bafoOf, bafoOpen, bafoReplyBy, bafoReplyRefusal, exclusionOf, exclusionRefusal, legacyExclusionOf, liveOffers, revalOpen, statusForSupplier, suggestedExclusion } from "@/lib/procurement/offer-decisions"
import { offerTags, termsDiffer } from "@/lib/procurement/offer-labels"
import { planDecisionMove, planVersions } from "@/lib/procurement/offer-migration"
import { unansweredCount } from "@/lib/procurement/rfq-detail"
import { competingOffers } from "@/lib/procurement/award"
import { asSupplierSees } from "@/lib/procurement/supplier"
import { QuoteActError, quoteActSchema, questionsFor, runQuoteAct, type QuoteAct, type QuoteSupplier } from "@/lib/supplier-free/server-quote-acts"

const mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("tok:")) throw new Error("bad token")
      return { uid: t.slice(4) }
    },
  }),
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }), arrayUnion: (v: unknown) => [v] } }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1), permissionHolders: jest.fn(async () => []) }))

import { POST as decide } from "@/app/api/procurement/offers/decide/route"

type Doc = Record<string, unknown>
const db = mockDb as never

// 2026-10-13 09:00 in Riyadh.
const NOW = new Date("2026-10-13T06:00:00Z")
const LATER = new Date("2026-10-14T06:00:00Z")

const OWNER: DecisionCaller = { uid: "org1", name: "Saad", orgId: "org1", can: () => true }
const VIEWER: DecisionCaller = { uid: "m1", name: "Member", orgId: "org1", can: (p) => p === "offers.view" }
const STRANGER: DecisionCaller = { uid: "x1", name: "Other", orgId: "org9", can: () => true }

const SUP: QuoteSupplier = { uid: "su1", name: "Sami", orgId: "sup1", company: "Al Noor", field: { specs: ["حديد"], cities: ["الرياض"] }, vatRate: 0.15, approved: true }

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
    { name: "زوايا حديد 50×50×5", quantity: 175, unitOfMeasure: "م" },
    { name: "خشب ألواح", quantity: 320, unitOfMeasure: "م" },
  ],
  offersCount: 0,
  log: [],
  ...over,
})

const values = (over: Doc = {}) => ({ prices: { i1: "12.5", i2: "3.6" }, skip: {}, total: "", arrive: "", valid: "2026-10-27", note: "", ...over })
const run = (act: Record<string, unknown>, now = NOW, s: QuoteSupplier = SUP) => runQuoteAct(db, s, quoteActSchema.parse(act) as QuoteAct, now)
const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof DecisionError || e instanceof QuoteActError ? e.code : String(e)))
const decideAs = (c: DecisionCaller, input: Record<string, unknown>, now = NOW) => runOfferDecision(db, c, decideSchema.parse(input) as DecideInput, now)

async function newOffer(rfqId = "R1", s: QuoteSupplier = SUP): Promise<string> {
  const { offerId } = (await run({ action: "quote.new", rfqId, values: values() }, NOW, s)) as { offerId: string }
  return offerId
}

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockDb.seed("rfqs/R1", rfq())
  mockDb.seed("users/org1", { role: "Contractor", organizationId: "org1", name: "Saad" })
  mockDb.seed("users/su1", { role: "Supplier", organizationId: "sup1", name: "Sami" })
})

describe("the shortlist ★ (RFQ-09)", () => {
  it("is written to the decisions record and the RFQ's log, and the offer itself is not touched", async () => {
    const id = await newOffer()
    const before = JSON.stringify(mockDb.get(`offers/${id}`))
    const out = await decideAs(OWNER, { action: "shortlist", offerId: id })
    expect(out.decision.shortlist).toMatchObject({ byId: "org1", byName: "Saad" })
    expect(mockDb.get(`${OFFER_DECISIONS}/${id}`)).toMatchObject({ offerId: id, rfqId: "R1", organizationId: "org1", exclusion: null })
    expect(JSON.stringify(mockDb.get(`offers/${id}`))).toBe(before)
    expect((mockDb.get("rfqs/R1")?.log as Doc[]).map((e) => e.action)).toEqual(["shortlisted"])

    await decideAs(OWNER, { action: "unshortlist", offerId: id })
    expect(mockDb.get(`${OFFER_DECISIONS}/${id}`)?.shortlist).toBeNull()
    expect((mockDb.get("rfqs/R1")?.log as Doc[]).map((e) => e.action)).toEqual(["shortlisted", "unshortlisted"])
  })

  it("is refused twice, when not on the list, and for an excluded offer", async () => {
    const id = await newOffer()
    expect(await refusal(decideAs(OWNER, { action: "unshortlist", offerId: id }))).toBe("not_shortlisted")
    await decideAs(OWNER, { action: "shortlist", offerId: id })
    expect(await refusal(decideAs(OWNER, { action: "shortlist", offerId: id }))).toBe("already_shortlisted")
    const other = await newOffer("R1", { ...SUP, uid: "su2", orgId: "sup2", company: "Rival" })
    await decideAs(OWNER, { action: "exclude", offerId: other, code: "spec" })
    expect(await refusal(decideAs(OWNER, { action: "shortlist", offerId: other }))).toBe("offer_excluded")
  })
})

describe("exclusion with its reason, and restore (RFQ-12, WF-15, R-16)", () => {
  it("takes one of four reasons; «سبب آخر» needs words of its own (4 characters at least)", async () => {
    const id = await newOffer()
    expect(await refusal(decideAs(OWNER, { action: "exclude", offerId: id, code: "price" }))).toBe("reason_required")
    expect(await refusal(decideAs(OWNER, { action: "exclude", offerId: id, code: "other" }))).toBe("reason_text_short")
    expect(await refusal(decideAs(OWNER, { action: "exclude", offerId: id, code: "other", text: "عيب" }))).toBe("reason_text_short")
    expect(exclusionRefusal("other", "عيب في")).toBeNull()
    expect(exclusionRefusal("warranty", null)).toBeNull()
    expect(mockDb.get(`${OFFER_DECISIONS}/${id}`)).toBeUndefined()

    await decideAs(OWNER, { action: "exclude", offerId: id, code: "other", text: "التسليم بعد موعد الحاجة" })
    expect(mockDb.get(`${OFFER_DECISIONS}/${id}`)?.exclusion).toMatchObject({ code: "other", text: "التسليم بعد موعد الحاجة", byId: "org1" })
  })

  it("never writes the offer's status — the supplier is not told, and his screens do not read «lost»", async () => {
    const id = await newOffer()
    const written = mockDb.writes.length
    await decideAs(OWNER, { action: "exclude", offerId: id, code: "validity" })
    const offer = mockDb.get(`offers/${id}`) as Doc
    expect(offer.status).toBe("قيد المراجعة")
    expect(offer).not.toHaveProperty("exclusion")
    expect(mockDb.writes.slice(written).filter(([p]) => p.includes("/notifications/"))).toHaveLength(0)
    expect(statusForSupplier(offer)).toBe("قيد المراجعة")
  })

  it("leaves the comparison and stays in the record; «أعِده» brings it back", async () => {
    const a = await newOffer()
    const b = await newOffer("R1", { ...SUP, uid: "su2", orgId: "sup2", company: "Rival" })
    await decideAs(OWNER, { action: "exclude", offerId: a, code: "spec" })
    const offers = [{ ...(mockDb.get(`offers/${a}`) as Doc), id: a }, { ...(mockDb.get(`offers/${b}`) as Doc), id: b }] as Array<{ id: string; status?: string }>
    const decisions = { [a]: mockDb.get(`${OFFER_DECISIONS}/${a}`) as never }
    expect(liveOffers(offers, decisions).map((o) => o.id)).toEqual([b])
    expect(competingOffers(offers, decisions).map((o) => o.id)).toEqual([b])
    expect(exclusionOf(offers[0], decisions[a])?.code).toBe("spec")
    expect(await refusal(decideAs(OWNER, { action: "exclude", offerId: a, code: "spec" }))).toBe("already_excluded")

    await decideAs(OWNER, { action: "restore", offerId: a })
    expect(mockDb.get(`${OFFER_DECISIONS}/${a}`)?.exclusion).toBeNull()
    expect(competingOffers(offers, { [a]: mockDb.get(`${OFFER_DECISIONS}/${a}`) as never })).toHaveLength(2)
    expect((mockDb.get("rfqs/R1")?.log as Doc[]).map((e) => e.action)).toEqual(["offer_excluded", "offer_restored"])
    expect(await refusal(decideAs(OWNER, { action: "restore", offerId: a }))).toBe("not_excluded")
  })

  it("an offer excluded the old way (status «مرفوض») still reads excluded, maps its reasons, and restore returns it to review", async () => {
    const id = await newOffer()
    mockDb.seed(`offers/${id}`, { ...(mockDb.get(`offers/${id}`) as Doc), status: "مرفوض", exclusion: { code: "lead", byId: "org1", at: "2026-10-12T08:00:00.000Z" } })
    const offer = { ...(mockDb.get(`offers/${id}`) as Doc), id } as { id: string; status?: string }
    expect(legacyExclusionOf(offer)).toMatchObject({ code: "validity" })
    expect(liveOffers([offer], {})).toHaveLength(0)
    expect(statusForSupplier(offer)).toBe("قيد المراجعة")
    expect(asSupplierSees([offer], new Map())[0].status).toBe("قيد المراجعة")

    await decideAs(OWNER, { action: "restore", offerId: id })
    expect(mockDb.get(`offers/${id}`)).toMatchObject({ status: "قيد المراجعة", exclusion: null })
  })

  it("is refused on an awarded offer", async () => {
    const id = await newOffer()
    mockDb.seed(`offers/${id}`, { ...(mockDb.get(`offers/${id}`) as Doc), poId: "po1", status: "مقبول" })
    expect(await refusal(decideAs(OWNER, { action: "exclude", offerId: id, code: "spec" }))).toBe("offer_taken")
  })

  it("suggests a reason from the facts without applying it", () => {
    expect(suggestedExclusion({ warrantyShort: true, validityShort: true })).toBe("warranty")
    expect(suggestedExclusion({ warrantyShort: false, validityShort: true })).toBe("validity")
    expect(suggestedExclusion({ warrantyShort: false, validityShort: false })).toBeNull()
  })
})

describe("«اطلب سعراً أفضل» — one round per offer (RFQ-11, WF-14)", () => {
  it("is carried by the offer's own `bafo` key, not its status, with the day to answer by; the supplier is told and the event leaves", async () => {
    const id = await newOffer()
    await decideAs(OWNER, { action: "bafo", offerId: id, replyBy: "2026-10-16", note: "هل يمكنك تخفيض السعر؟" })
    const offer = mockDb.get(`offers/${id}`) as Doc
    expect(offer.status).toBe("قيد المراجعة")
    expect(offer.bafo).toMatchObject({ replyBy: "2026-10-16", note: "هل يمكنك تخفيض السعر؟", round: 1, answered: null, byId: "org1" })
    expect(bafoOpen(offer)).toBe(true)
    expect(statusForSupplier(offer)).toBe("مطلوب تخفيض")
    expect(bafoReplyBy(offer)).toBe("2026-10-16")
    const notice = mockDb.writes.find(([p]) => p === `users/su1/notifications/rfq_bafo__${id}`)
    expect(notice?.[1]).toMatchObject({ type: "rfq_bafo", offerId: id })
    expect(JSON.stringify(notice?.[1])).not.toMatch(/12\.5|3\.6/)
    expect(mockDb.get("procEvents/org1__proc:RFQ:RFQ-2026_011:sup1:CUT")).toMatchObject({ id: "rfq_cut", key: "proc:RFQ:RFQ-2026/011:sup1:CUT" })
    expect((mockDb.get("rfqs/R1")?.log as Doc[]).map((e) => e.action)).toEqual(["bafo_asked"])
  })

  it("is asked once per offer, by a day that is not past, while the RFQ is open, of a live offer", async () => {
    const id = await newOffer()
    expect(await refusal(decideAs(OWNER, { action: "bafo", offerId: id, replyBy: "2026-10-12" }))).toBe("date_invalid")
    await decideAs(OWNER, { action: "bafo", offerId: id, replyBy: "2026-10-13" })
    expect(await refusal(decideAs(OWNER, { action: "bafo", offerId: id, replyBy: "2026-10-18" }))).toBe("already_asked")

    const other = await newOffer("R1", { ...SUP, uid: "su2", orgId: "sup2", company: "Rival" })
    await decideAs(OWNER, { action: "exclude", offerId: other, code: "spec" })
    expect(await refusal(decideAs(OWNER, { action: "bafo", offerId: other, replyBy: "2026-10-18" }))).toBe("offer_excluded")
    const third = await newOffer("R1", { ...SUP, uid: "su3", orgId: "sup3", company: "Third" })
    mockDb.seed("rfqs/R1", { ...(mockDb.get("rfqs/R1") as Doc), status: "Awarded" })
    expect(await refusal(decideAs(OWNER, { action: "bafo", offerId: third, replyBy: "2026-10-18" }))).toBe("rfq_not_open")
  })

  it("an old `مطلوب تخفيض` offer reads as asked and open", () => {
    const old = { status: "مطلوب تخفيض", reductionBy: "2026-10-16", reductionAt: "2026-10-13T08:00:00.000Z", reductionNote: "x" }
    expect(bafoOf(old)).toMatchObject({ open: true, asked: true, replyBy: "2026-10-16" })
    expect(bafoReplyBy({ decidedAt: "2026-10-13T08:00:00.000Z" })).toBe("2026-10-16")
  })

  it("the reply is a lower price or the same one — never a higher", () => {
    expect(bafoReplyRefusal(6000, 5900)).toBeNull()
    expect(bafoReplyRefusal(6000, 6000)).toBeNull()
    expect(bafoReplyRefusal(6000, 6000.01)).toBe("price_higher")
  })
})

describe("«اطلب تأكيد السعر» (CMP-18)", () => {
  it("sets `reval` on the offer once, tells the supplier, and is answered by a new version with a new validity", async () => {
    const id = await newOffer()
    await decideAs(OWNER, { action: "confirm-price", offerId: id, note: "السعر منتهي" })
    const offer = mockDb.get(`offers/${id}`) as Doc
    expect(offer.reval).toMatchObject({ byId: "org1", answered: null })
    expect(revalOpen(offer)).toBe(true)
    expect(mockDb.writes.some(([p]) => p.startsWith(`users/su1/notifications/rfq_reval__${id}`))).toBe(true)
    expect(await refusal(decideAs(OWNER, { action: "confirm-price", offerId: id }))).toBe("already_asked")

    expect(await refusal(run({ action: "quote.version", offerId: id, mode: "reval", values: values({ valid: "2026-10-12" }) }, LATER))).toBe("blocked")
    await run({ action: "quote.version", offerId: id, mode: "reval", values: values({ valid: "2026-11-30" }) }, LATER)
    const after = mockDb.get(`offers/${id}`) as Doc & { versions: Doc[]; reval: Doc }
    expect(after.rev).toBe(2)
    expect(after.versions[1]).toMatchObject({ n: 2, reval: true, valid: "2026-11-30" })
    expect(after.reval.answered).toMatchObject({ n: 2 })
    expect(after.validUntil).toBe("2026-11-30")
    expect(await refusal(run({ action: "quote.version", offerId: id, mode: "reval", values: values({ valid: "2026-12-30" }) }, LATER))).toBe("not_asked")
  })
})

describe("a clarification asked on his offer (RFQ-10)", () => {
  it("is an inquiry from us, addressed to him; he sees it, answers it, and no other supplier sees either", async () => {
    const id = await newOffer()
    const other = await newOffer("R1", { ...SUP, uid: "su2", orgId: "sup2", company: "Rival" })
    const { id: qid } = await decideAs(OWNER, { action: "clarify", offerId: id, question: "هل السعر شامل التنزيل؟" })
    expect(qid).toBeTruthy()
    expect(mockDb.get(`rfqs/R1/inquiries/${qid}`)).toMatchObject({ kind: "our_question", question: "هل السعر شامل التنزيل؟", to: { orgId: "sup1", offerId: id }, reply: null, organizationId: "org1" })
    expect(mockDb.writes.some(([p]) => p === `users/su1/notifications/rfq_clarify__${qid}`)).toBe(true)
    expect(mockDb.get("procEvents/org1__proc:RFQ:RFQ-2026_011:Q1")).toMatchObject({ id: "rfq_answer" })

    expect((await questionsFor(db, "sup1", "R1")).map((q) => [q.id, q.fromBuyer, q.offerId])).toEqual([[qid, true, id]])
    expect(await questionsFor(db, "sup2", "R1")).toEqual([])

    expect(await refusal(run({ action: "quote.answer", rfqId: "R1", inquiryId: qid as string, answer: "نعم" }, NOW, { ...SUP, uid: "su2", orgId: "sup2" }))).toBe("not_yours")
    await run({ action: "quote.answer", rfqId: "R1", inquiryId: qid as string, answer: "نعم، شامل التنزيل" })
    expect(mockDb.get(`rfqs/R1/inquiries/${qid}`)).toMatchObject({ reply: "نعم، شامل التنزيل", answer: { all: false, byId: "su1" } })
    expect(await refusal(run({ action: "quote.answer", rfqId: "R1", inquiryId: qid as string, answer: "مرة ثانية" }))).toBe("wrong_state")
    expect(await questionsFor(db, "sup2", "R1")).toEqual([])
    expect(other).toBeTruthy()
    // A question WE asked waits on the supplier, never on us: it is not an unanswered query on the buyer's page.
    expect(unansweredCount([{ kind: "our_question", reply: null }, { reply: null }, { reply: "نعم" }])).toBe(1)
  })
})

describe("who may decide (G-16)", () => {
  it("a member who only sees offers may shortlist, nothing else; another company's RFQ is not found", async () => {
    const id = await newOffer()
    await decideAs(VIEWER, { action: "shortlist", offerId: id })
    expect(await refusal(decideAs(VIEWER, { action: "exclude", offerId: id, code: "spec" }))).toBe("no_permission")
    expect(await refusal(decideAs(VIEWER, { action: "bafo", offerId: id, replyBy: "2026-10-18" }))).toBe("no_permission")
    expect(await refusal(decideAs(STRANGER, { action: "shortlist", offerId: id }))).toBe("offer_missing")
    expect(await refusal(decideAs(OWNER, { action: "shortlist", offerId: "nope" }))).toBe("offer_missing")
  })
})

describe("G-15 — a supplier's edit never erases the buyer's decisions (R-03)", () => {
  it("exclusion + shortlist + BAFO survive his version 2: the record is unchanged, the revision is 2, his name is his", async () => {
    const id = await newOffer()
    await decideAs(OWNER, { action: "shortlist", offerId: id })
    await decideAs(OWNER, { action: "bafo", offerId: id, replyBy: "2026-10-16" })
    await decideAs(OWNER, { action: "exclude", offerId: id, code: "other", text: "التسليم بعيد عن الموقع" })
    const record = JSON.stringify(mockDb.get(`${OFFER_DECISIONS}/${id}`))
    const name = (mockDb.get(`offers/${id}`) as Doc).supplierName

    await run({ action: "quote.version", offerId: id, mode: "reduce", values: values({ prices: { i1: "12.2", i2: "3.5" } }) }, LATER)

    expect(JSON.stringify(mockDb.get(`${OFFER_DECISIONS}/${id}`))).toBe(record)
    const offer = mockDb.get(`offers/${id}`) as Doc & { versions: Doc[]; bafo: Doc }
    expect(offer.rev).toBe(2)
    expect(offer.versions.map((v) => v.n)).toEqual([1, 2])
    expect(offer.versions[0].total).toBe(3339.5)
    expect(offer.versions[1]).toMatchObject({ total: 3255, bafoReply: "lowered", by: "supplier" })
    expect(offer.supplierName).toBe(name)
    expect(offer.status).toBe("قيد المراجعة")
    expect(offer.bafo.answered).toMatchObject({ n: 2, kind: "lowered" })
    expect(exclusionOf(offer as never, mockDb.get(`${OFFER_DECISIONS}/${id}`) as never)).toMatchObject({ code: "other" })
    expect((mockDb.get("rfqs/R1")?.log as Doc[]).map((e) => e.action)).toEqual(["shortlisted", "bafo_asked", "offer_excluded", "offer_versioned"])
  })

  it("an ordinary edit of an excluded, shortlisted offer is allowed and changes nothing of the record", async () => {
    const id = await newOffer()
    await decideAs(OWNER, { action: "shortlist", offerId: id })
    await decideAs(OWNER, { action: "exclude", offerId: id, code: "spec" })
    const record = JSON.stringify(mockDb.get(`${OFFER_DECISIONS}/${id}`))
    await run({ action: "quote.version", offerId: id, mode: "edit", values: values({ prices: { i1: "13", i2: "3.6" } }) }, LATER)
    expect(JSON.stringify(mockDb.get(`${OFFER_DECISIONS}/${id}`))).toBe(record)
    expect(mockDb.get(`offers/${id}`)).toMatchObject({ rev: 2, status: "قيد المراجعة" })
  })

  it("the reply to «سعراً أفضل» cannot be higher than his own price, comes by the day given even after the deadline, and one round only", async () => {
    const id = await newOffer()
    await decideAs(OWNER, { action: "bafo", offerId: id, replyBy: "2026-10-22" })
    const afterDeadline = new Date("2026-10-21T06:00:00Z")
    expect(await refusal(run({ action: "quote.version", offerId: id, mode: "reduce", values: values({ prices: { i1: "13", i2: "3.6" } }) }, afterDeadline))).toBe("price_higher")
    await run({ action: "quote.version", offerId: id, mode: "reduce", values: values({ prices: { i1: "12.5", i2: "3.6" } }) }, afterDeadline)
    expect((mockDb.get(`offers/${id}`) as Doc & { versions: Doc[] }).versions[1].bafoReply).toBe("kept")
    expect(await refusal(run({ action: "quote.version", offerId: id, mode: "reduce", values: values({ prices: { i1: "12", i2: "3.6" } }) }, afterDeadline))).toBe("wrong_state")
    expect(await refusal(run({ action: "quote.version", offerId: id, mode: "edit", values: values() }, afterDeadline))).toBe("deadline")
  })

  it("his «my price is final» answers the round without a version", async () => {
    const id = await newOffer()
    await decideAs(OWNER, { action: "bafo", offerId: id, replyBy: "2026-10-16" })
    await run({ action: "quote.final", offerId: id, note: "هذا أفضل ما عندي" }, LATER)
    const offer = mockDb.get(`offers/${id}`) as Doc & { bafo: Doc }
    expect(offer.bafo.answered).toMatchObject({ kind: "kept", note: "هذا أفضل ما عندي" })
    expect(offer.rev).toBe(1)
    expect(bafoOpen(offer as never)).toBe(false)
  })
})

describe("what the offers list tells (names §5)", () => {
  const rfqTerms = { paymentTermsList: [{ pct: 30, days: 0 }, { pct: 70, days: 30 }] }
  it("derives the tags from the offer, the decision and the RFQ — never stored", () => {
    const offer = { createdAt: "2026-10-13T05:00:00.000Z", status: "قيد المراجعة", whole: true, vatRegistered: false, validUntil: "2026-10-10", advancePercent: 50, versions: [{ n: 1, at: "2026-10-13" }] }
    const codes = (o: object, d?: object) => offerTags({ offer: o as never, decision: d as never, rfq: rfqTerms, today: "2026-10-13" }).map((t) => t.code)
    expect(codes(offer, { shortlist: { at: "x", byId: "u", byName: "n" }, exclusion: null })).toEqual(["shortlisted", "new_today", "differs_terms", "whole_only", "unregistered", "expired"])
    const edited = { ...offer, versions: [{ n: 1, at: "2026-10-11" }, { n: 2, at: "2026-10-13" }], bafo: { at: "2026-10-12", byId: "u", byName: "n", replyBy: "2026-10-16", note: null, round: 1, answered: { at: "2026-10-13", n: 2, kind: "lowered" } } }
    expect(codes(edited)).toEqual(["bafo_lowered", "updated", "differs_terms", "whole_only", "unregistered", "expired", "version"])
    expect(offerTags({ offer: { ...offer, poId: "po1" } as never, rfq: rfqTerms, today: "2026-10-13" })[0].code).toBe("awarded")
    expect(offerTags({ offer: { status: "قيد المراجعة", bafo: { at: "x", byId: "u", byName: "n", replyBy: "2026-10-16", note: null, round: 1, answered: null } } as never, today: "2026-10-13" })).toEqual([{ code: "bafo_asked", value: "2026-10-16" }])
  })

  it("«يخالف شروط دفعك» only when the RFQ set terms and the offer states others", () => {
    expect(termsDiffer({ advancePercent: 30, creditDays: 30 }, rfqTerms)).toBe(false)
    expect(termsDiffer({ advancePercent: 50, creditDays: 30 }, rfqTerms)).toBe(true)
    expect(termsDiffer({}, rfqTerms)).toBe(false)
    expect(termsDiffer({ advancePercent: 50 }, {})).toBe(false)
  })
})

describe("POST /api/procurement/offers/decide", () => {
  const post = (uid: string | null, body: unknown) =>
    decide(new NextRequest("http://localhost/api/procurement/offers/decide", { method: "POST", headers: { "content-type": "application/json", ...(uid ? { authorization: `Bearer tok:${uid}` } : {}) }, body: JSON.stringify(body) }))

  it("needs a signed-in caller and a valid body", async () => {
    expect((await post(null, { action: "shortlist", offerId: "o" })).status).toBe(401)
    expect((await post("org1", { action: "nope" })).status).toBe(400)
  })

  it("answers {success, data} for the owner, and the code of a refusal with its status", async () => {
    const id = await newOffer()
    const ok = await post("org1", { action: "shortlist", offerId: id })
    expect(ok.status).toBe(200)
    expect((await ok.json()).data.decision.shortlist).toMatchObject({ byId: "org1" })
    const again = await post("org1", { action: "shortlist", offerId: id })
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe("already_shortlisted")
    const short = await post("org1", { action: "exclude", offerId: id, code: "other", text: "ab" })
    expect(short.status).toBe(422)
    expect((await short.json()).code).toBe("reason_text_short")
  })

  it("a user of another company finds no such offer", async () => {
    const id = await newOffer()
    mockDb.seed("users/x1", { role: "Contractor", organizationId: "org9", name: "Other" })
    const res = await post("x1", { action: "shortlist", offerId: id })
    expect(res.status).toBe(404)
  })
})

describe("moving old offers onto the new shape (dry-run scripts)", () => {
  it("gives an offer its versions: each replaced price oldest first, then the live one; an offer that has them is left alone", () => {
    const old = { price: "380", createdAt: "2026-10-10T08:00:00.000Z", updatedAt: "2026-10-12T08:00:00.000Z", validUntil: "2026-10-27", priceHistory: [{ price: "420", replacedAt: "2026-10-11T08:00:00.000Z" }, { price: "400", replacedAt: "2026-10-12T07:00:00.000Z" }] }
    const plan = planVersions(old)
    expect(plan?.rev).toBe(3)
    expect(plan?.versions.map((v) => [v.n, v.total])).toEqual([[1, 420], [2, 400], [3, 380]])
    expect(planVersions({ ...old, versions: [{ n: 1 }] })).toBeNull()
    expect(planVersions({ price: "100" })?.versions).toHaveLength(1)
  })

  it("moves an exclusion to the record and puts the offer back under review; a cut becomes `bafo`; an answered cut keeps its answer", () => {
    const excluded = planDecisionMove({ status: "مرفوض", exclusion: { code: "documents", at: "2026-10-12T08:00:00.000Z", byId: "org1" }, decidedByUserName: "Saad" })
    expect(excluded?.offerPatch).toEqual({ status: "قيد المراجعة", exclusion: null })
    expect(excluded?.decision?.exclusion).toMatchObject({ code: "other", text: "بلا وثائق أو رقم ضريبي", byName: "Saad" })
    const cut = planDecisionMove({ status: "مطلوب تخفيض", reductionBy: "2026-10-16", reductionAt: "2026-10-13T08:00:00.000Z", reductionNote: "x", decidedByUserId: "org1" })
    expect(cut?.offerPatch).toMatchObject({ status: "قيد المراجعة", bafo: { replyBy: "2026-10-16", note: "x", round: 1, answered: null } })
    const answered = planDecisionMove({ status: "قيد المراجعة", reductionAt: "2026-10-13T08:00:00.000Z", reductionBy: "2026-10-16", reductionReply: { at: "2026-10-14", kind: "final", note: "ثابت" }, versions: [{ n: 1 }] })
    expect(answered?.offerPatch).toMatchObject({ bafo: { answered: { at: "2026-10-14", n: 1, kind: "kept", note: "ثابت" } } })
    expect(planDecisionMove({ status: "قيد المراجعة" })).toBeNull()
  })
})
