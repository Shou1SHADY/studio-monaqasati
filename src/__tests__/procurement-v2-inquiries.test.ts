/** @jest-environment node */
/**
 * Procurement 2.0 — the RFQ's questions (WF-11, QA-01…05, G-06, B-07). Runs the real server code over an in-memory Admin
 * Firestore: a question from the portal or the visitors' link through the ONE `createInquiry` (maybe nameless, maybe about a
 * material), the buyer's answer «للجميع» (every invitee and the link read it, never who asked) or «للسائل فقط» (the asker
 * alone; impossible for a nameless one), a clarification of ours to every invitee, and the counters that follow.
 */

import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import { InquiryError, createInquiry, inquirySchema, runInquiry, type InquiryCaller, type InquiryInput } from "@/lib/procurement/rfq-server/inquiry"
import { answerOf, answerRefusal, inquiryCounts, inquiryOrder, isAnonymous, needsAnswer, publicInquiry, type InquiryDoc } from "@/lib/procurement/rfq-inquiries"
import { answeredQueries } from "@/lib/procurement/guest-supplier"
import { unansweredCount } from "@/lib/procurement/rfq-detail"
import { QuoteActError, questionsFor, quoteActSchema, runQuoteAct, type QuoteAct, type QuoteSupplier } from "@/lib/supplier-free/server-quote-acts"

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

import { POST as inquiryRoute } from "@/app/api/procurement/rfq/inquiry/route"

type Doc = Record<string, unknown>
const db = mockDb as never
const NOW = new Date("2026-10-13T06:00:00Z")

const OWNER: InquiryCaller = { uid: "org1", name: "Saad", orgId: "org1", can: () => true }
const EXPEDITER: InquiryCaller = { uid: "m2", name: "Salman", orgId: "org1", can: (p) => p === "po.expedite" }
const STRANGER: InquiryCaller = { uid: "x1", name: "Other", orgId: "org9", can: () => true }

const SUP_A: QuoteSupplier = { uid: "a1", name: "Sami", orgId: "supA", company: "Al Noor", field: { specs: ["حديد"], cities: ["الرياض"] }, vatRate: 0.15, approved: true }
const SUP_B: QuoteSupplier = { uid: "b1", name: "Bader", orgId: "supB", company: "Al Fajr", field: { specs: ["حديد"], cities: ["الرياض"] }, vatRate: 0.15, approved: true }

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
  invitedSupplierOrgIds: ["supA", "supB", "supC"],
  products: [
    { name: "زوايا حديد 50×50×5", quantity: 175, unitOfMeasure: "م" },
    { name: "خشب ألواح", quantity: 320, unitOfMeasure: "م" },
  ],
  log: [],
  ...over,
})

const inquiries = () => mockDb.list("rfqs/R1/inquiries")
const notices = (uid: string) => mockDb.list(`users/${uid}/notifications`)
const ask = (s: QuoteSupplier, question: string, li?: number) => runQuoteAct(db, s, quoteActSchema.parse({ action: "quote.ask", rfqId: "R1", question, ...(li != null ? { li } : {}) }) as QuoteAct, NOW) as Promise<{ id: string }>
const act = (c: InquiryCaller, input: Record<string, unknown>) => runInquiry(db, c, inquirySchema.parse(input) as InquiryInput, NOW)
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof InquiryError || e instanceof QuoteActError ? e.code : String(e)))
const visitor = (anon: boolean) => createInquiry(db, { rfq: { ...(mockDb.get("rfqs/R1") as Doc), id: "R1" }, question: "هل التسليم شامل التنزيل؟", asker: { kind: "visitor", anon, name: anon ? null : "فهد", phone: anon ? null : "0551234567" }, at: NOW.toISOString() })

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockDb.seed("rfqs/R1", rfq())
  mockDb.seed("users/org1", { role: "Contractor", organizationId: "org1", name: "Saad" })
  mockDb.seed("users/a1", { role: "Supplier", organizationId: "supA", name: "Sami" })
  mockDb.seed("users/b1", { role: "Supplier", organizationId: "supB", name: "Bader" })
  mockDb.seed("offers/o1", { rfqId: "R1", contractorOrgId: "org1", organizationId: "supB", supplierId: "b1", status: "قيد المراجعة" })
})

describe("a question arrives — one door for the portal and the link (QA-01)", () => {
  it("a supplier's quote.ask is stored with his company, the material it is about, and tells the buying side", async () => {
    const { id } = await ask(SUP_A, "هل المقاس متوفر؟", 1)
    expect(mockDb.get(`rfqs/R1/inquiries/${id}`)).toMatchObject({ kind: "ask", question: "هل المقاس متوفر؟", li: 1, organizationId: "supA", supplierName: "Al Noor", from: { orgId: "supA", anon: false }, via: "portal", answer: null, reply: null })
    expect(mockDb.get("rfqs/R1")?.askCount).toBe(1)
    expect(notices("org1").map((n) => n.type)).toContain("rfq_question")
    expect(mockDb.list("procEvents").map((e) => e.id)).toEqual(["org1__proc:RFQ:RFQ-2026_011:ASK1"])
  })

  it("a line the RFQ does not have is dropped, not stored", async () => {
    const { id } = await ask(SUP_A, "؟", 9)
    expect(mockDb.get(`rfqs/R1/inquiries/${id}`)?.li).toBeNull()
  })

  it("a visitor's question is nameless unless his mobile was verified, and carries no company", async () => {
    const anon = await visitor(true)
    const named = await visitor(false)
    expect(mockDb.get(`rfqs/R1/inquiries/${anon.id}`)).toMatchObject({ via: "link", from: { orgId: null, anon: true }, supplierName: null })
    expect(mockDb.get(`rfqs/R1/inquiries/${named.id}`)).toMatchObject({ from: { orgId: null, anon: false }, supplierName: "فهد" })
    expect(isAnonymous(mockDb.get(`rfqs/R1/inquiries/${anon.id}`) as InquiryDoc)).toBe(true)
    expect(isAnonymous(mockDb.get(`rfqs/R1/inquiries/${named.id}`) as InquiryDoc)).toBe(false)
    expect(notices("org1").some((n) => (n.message as string).includes("هل التسليم"))).toBe(true)
  })

  it("each question takes the next number on the RFQ (the event key never repeats)", async () => {
    await ask(SUP_A, "الأول")
    await ask(SUP_B, "الثاني")
    expect(mockDb.get("rfqs/R1")?.askCount).toBe(2)
    expect(mockDb.list("procEvents").map((e) => e.id).sort()).toEqual(["org1__proc:RFQ:RFQ-2026_011:ASK1", "org1__proc:RFQ:RFQ-2026_011:ASK2"])
  })
})

describe("«أجب للجميع» (QA-02, G-06)", () => {
  it("publishes the answer, tells every invitee and bidder but the buyer, and the link reads it without the asker", async () => {
    const { id } = await ask(SUP_A, "هل المقاس متوفر؟", 0)
    const out = await act(OWNER, { action: "answer", rfqId: "R1", inquiryId: id, text: "نعم، متوفر", scope: "all" })
    expect(out).toMatchObject({ scope: "all" })
    const stored = mockDb.get(`rfqs/R1/inquiries/${id}`) as InquiryDoc
    expect(stored.answer).toMatchObject({ text: "نعم، متوفر", all: true, byName: "Saad" })
    expect(stored.reply).toBe("نعم، متوفر")
    expect(["supA", "supB", "supC", "b1", "a1"].filter((uid) => !notices(uid).some((n) => n.type === "inquiry_reply"))).toEqual([])
    expect(notices("org1").some((n) => n.type === "inquiry_reply")).toBe(false)
    const link = answeredQueries(inquiries() as never)
    expect(link).toEqual([{ question: "هل المقاس متوفر؟", answer: "نعم، متوفر", answeredAt: NOW.toISOString() }])
    expect(JSON.stringify(link)).not.toMatch(/Al Noor|supA|a1/)
    expect((mockDb.get("rfqs/R1")?.log as Doc[]).map((e) => e.action)).toEqual(["query_answered"])
    expect(mockDb.list("procEvents").map((e) => e.id)).toContain("org1__proc:RFQ:RFQ-2026_011:Q1")
  })

  it("another bidder reads it through questionsFor, still without who asked; the buyer may reword the question first", async () => {
    const { id } = await ask(SUP_A, "عندكم خشب؟؟ كم السعر", 1)
    await act(OWNER, { action: "answer", rfqId: "R1", inquiryId: id, text: "الألواح 4 م", scope: "all", question: "هل الألواح متوفرة بطول 4 م؟" })
    const b = await questionsFor(db, "supB", "R1")
    expect(b).toEqual([expect.objectContaining({ question: "هل الألواح متوفرة بطول 4 م؟", reply: "الألواح 4 م", mine: false })])
    const a = await questionsFor(db, "supA", "R1")
    expect(a[0]).toMatchObject({ mine: true, question: "عندكم خشب؟؟ كم السعر" })
  })
})

describe("«للسائل فقط» (QA-02)", () => {
  it("reaches the asker alone: no other invitee is told, the link and other bidders do not read it", async () => {
    const { id } = await ask(SUP_A, "سؤال يخصني: حدود الدفعة المقدمة؟")
    const out = await act(OWNER, { action: "answer", rfqId: "R1", inquiryId: id, text: "٣٠٪", scope: "asker" })
    expect(out.scope).toBe("asker")
    expect(notices("supA").some((n) => n.type === "inquiry_reply" && (n.i18n as Doc).message === "pn_rfq_answer_asker")).toBe(true)
    expect(notices("supB").some((n) => n.type === "inquiry_reply")).toBe(false)
    expect(answeredQueries(inquiries() as never)).toEqual([])
    expect(await questionsFor(db, "supB", "R1")).toEqual([])
    expect(await questionsFor(db, "supA", "R1")).toEqual([expect.objectContaining({ reply: "٣٠٪", mine: true })])
  })

  it("is impossible for a nameless question — it can only be answered for everyone", async () => {
    const { id } = await visitor(true)
    expect(await refusal(act(OWNER, { action: "answer", rfqId: "R1", inquiryId: id, text: "x", scope: "asker" }))).toBe("anonymous_to_all")
    expect((await act(OWNER, { action: "answer", rfqId: "R1", inquiryId: id, text: "نعم", scope: "all" })).scope).toBe("all")
    expect(answeredQueries(inquiries() as never)).toHaveLength(1)
  })

  it("is refused twice, on an empty answer, for a stranger and for a member who only expedites", async () => {
    const { id } = await ask(SUP_A, "؟")
    expect(await refusal(act(OWNER, { action: "answer", rfqId: "R1", inquiryId: id, text: "ج", scope: "all" }))).toBeNull()
    expect(await refusal(act(OWNER, { action: "answer", rfqId: "R1", inquiryId: id, text: "ج2", scope: "all" }))).toBe("already_answered")
    const other = await ask(SUP_B, "؟؟")
    expect(await refusal(act(STRANGER, { action: "answer", rfqId: "R1", inquiryId: other.id, text: "ج", scope: "all" }))).toBe("rfq_missing")
    expect(await refusal(act(EXPEDITER, { action: "answer", rfqId: "R1", inquiryId: other.id, text: "ج", scope: "all" }))).toBe("no_permission")
    expect(() => inquirySchema.parse({ action: "answer", rfqId: "R1", inquiryId: other.id, text: "  ", scope: "all" })).toThrow()
    expect(() => inquirySchema.parse({ action: "answer", rfqId: "R1", inquiryId: other.id, text: "x", scope: "everyone" })).toThrow()
  })
})

describe("a clarification from us to every invitee (QA-03)", () => {
  it("is a note: stored as its own answer, told to every invitee and bidder, and shown on the link with no question and no author", async () => {
    const out = await act(OWNER, { action: "note", rfqId: "R1", text: "التسليم بعد 14 أكتوبر" })
    expect(out.told).toBeGreaterThanOrEqual(4)
    const [note] = inquiries()
    expect(note).toMatchObject({ kind: "note", question: "التسليم بعد 14 أكتوبر", answer: { all: true } })
    expect(["supA", "supB", "supC", "b1"].filter((uid) => !notices(uid).some((n) => (n.i18n as Doc).message === "pn_rfq_clarification"))).toEqual([])
    expect(answeredQueries(inquiries() as never)).toEqual([{ question: "", answer: "التسليم بعد 14 أكتوبر", answeredAt: NOW.toISOString(), clarification: true }])
    expect(unansweredCount(inquiries() as never)).toBe(0)
    expect(inquiryCounts(inquiries() as InquiryDoc[])).toEqual({ total: 1, unanswered: 0 })
  })

  it("is refused on a closed RFQ", async () => {
    mockDb.seed("rfqs/R1", rfq({ status: "Awarded" }))
    expect(await refusal(act(OWNER, { action: "note", rfqId: "R1", text: "x" }))).toBe("rfq_not_open")
  })

  it("a note shows to a supplier in questionsFor as an answer with no question", async () => {
    await act(OWNER, { action: "note", rfqId: "R1", text: "توضيح" })
    expect(await questionsFor(db, "supB", "R1")).toEqual([expect.objectContaining({ question: "", reply: "توضيح", note: true })])
  })
})

describe("the tab's counters and order (QA-01, QA-05)", () => {
  it("the unanswered ones are shaded first and counted; our own questions and notes never wait on us", () => {
    const list: InquiryDoc[] = [
      { id: "1", kind: "ask", question: "a", createdAt: "2026-10-10T00:00:00Z" },
      { id: "2", kind: "ask", question: "b", createdAt: "2026-10-12T00:00:00Z", answer: { text: "c", all: true, at: "x", byId: "u", byName: "n" } },
      { id: "3", kind: "our_question", question: "d", createdAt: "2026-10-11T00:00:00Z" },
      { id: "4", kind: "note", question: "e", createdAt: "2026-10-09T00:00:00Z" },
      { id: "5", question: "old", reply: "yes", sentToAll: true, createdAt: "2026-10-08T00:00:00Z" },
    ]
    expect(list.filter(needsAnswer).map((q) => q.id)).toEqual(["1"])
    expect(inquiryCounts(list)).toEqual({ total: 5, unanswered: 1 })
    expect(unansweredCount(list)).toBe(1)
    expect(inquiryOrder(list).map((q) => q.id)).toEqual(["1", "2", "3", "4", "5"])
    expect(answerOf(list[4])).toMatchObject({ text: "yes", all: true })
    expect(publicInquiry(list[2])).toBeNull()
    expect(answerRefusal(list[1], "all", "x")).toBe("already_answered")
    expect(answerRefusal(list[2], "all", "x")).toBe("not_a_question")
  })
})

describe("the route", () => {
  const call = (token: string | null, body: unknown) =>
    inquiryRoute(new Request("http://x/api/procurement/rfq/inquiry", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }))

  it("answers 401 without a token, 400 on a bad body and 200 with the result", async () => {
    const { id } = await ask(SUP_A, "؟")
    expect((await call(null, {})).status).toBe(401)
    expect((await call("tok:org1", { action: "answer" })).status).toBe(400)
    const ok = await call("tok:org1", { action: "answer", rfqId: "R1", inquiryId: id, text: "نعم", scope: "all" })
    expect(ok.status).toBe(200)
    expect((await ok.json()).data).toMatchObject({ action: "answer", rfqId: "R1", id, scope: "all" })
    const again = await call("tok:org1", { action: "answer", rfqId: "R1", inquiryId: id, text: "نعم", scope: "all" })
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe("already_answered")
  })

  it("answers 403 to a supplier", async () => {
    const { id } = await ask(SUP_A, "؟")
    const res = await call("tok:a1", { action: "answer", rfqId: "R1", inquiryId: id, text: "x", scope: "all" })
    expect([403, 404]).toContain(res.status)
  })
})
