/** @jest-environment node */
/**
 * Procurement 2.0 — a request that no longer takes quotes, and what a visitor who quoted is still told (LNK-08, LNK-11, LNK-13,
 * G-06, G-07, R-02, R-21): no quote after the deadline / the award / the cancellation even from an open page; HIS result in the
 * four words; what is asked of him after the close; the questions and answers without names; the view count that ignores the
 * buyer's own preview.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

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
jest.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }), buildRfqShareEmail: () => ({ subject: "s", html: "h" }), buildGuestOfferReceiptEmail: () => ({ subject: "s", html: "h" }) }))
jest.mock("@/lib/sms", () => ({ canSendCodes: () => true, isVerifyConfigured: () => false, isSmsConfigured: () => true, sendSms: async () => ({ sent: true }), startVerification: async () => ({ sent: true }) }))
jest.mock("@/lib/otp", () => ({
  OTP_CHALLENGES: "otpChallenges",
  maskPhone: (p: string) => `${p.slice(0, 5)}****`,
  issueOtp: async () => ({ challengeId: "ch1", code: "123456" }),
  issueRemoteOtp: async () => ({ challengeId: "ch1" }),
  verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
}))

import { POST as create } from "@/app/api/rfq-share/create/route"
import { GET as viewLink } from "@/app/api/rfq-share/[token]/route"
import { POST as verify } from "@/app/api/rfq-share/[token]/verify/route"
import { POST as offer } from "@/app/api/rfq-share/[token]/offer/route"
import { POST as me } from "@/app/api/rfq-share/[token]/me/route"
import { POST as ask } from "@/app/api/rfq-share/[token]/ask/route"
import { POST as answer } from "@/app/api/rfq-share/[token]/answer/route"
import { POST as bafo } from "@/app/api/rfq-share/[token]/bafo/route"
import { GET as preview } from "@/app/api/rfq-share/preview/route"
import { openLinkSession } from "@/lib/links/session"
import type { Firestore } from "firebase-admin/firestore"

type Doc = Record<string, unknown>
const FUTURE = "2099-12-31"
const PHONE = "0551234567"
const E164 = "+966551234567"
const ctx = (token: string) => ({ params: Promise.resolve({ token }) })
const tokenOf = (url: unknown) => String(url).split("/").pop() as string
const json = (headers: Record<string, string> = {}) => ({ "content-type": "application/json", ...headers })

const seedRfq = (over: Doc = {}) =>
  mockDb.seed("rfqs/R1", {
    organizationId: "org1",
    contractorId: "org1",
    createdByUserId: "org1",
    rfqNumber: "RFQ-2026/011",
    title: "Villa project — Al Olaya site",
    status: "New",
    visibility: "public",
    pricingMode: "total",
    deadline: FUTURE,
    city: "Riyadh",
    district: "Al Olaya",
    locationCoords: { lat: 24.7136, lng: 46.6753 },
    products: [
      { name: "Cement", quantity: 100, unitOfMeasure: "bag", projectName: "Villa project", description: "Grey, 50 kg" },
      { name: "Sand", quantity: 20, unitOfMeasure: "ton" },
    ],
    log: [],
    offersCount: 0,
    ...over,
  })
const setRfq = (over: Doc) => mockDb.seed("rfqs/R1", { ...(mockDb.get("rfqs/R1") as Doc), ...over })

const mint = async () => {
  const res = await create(new NextRequest("http://localhost/api/rfq-share/create", { method: "POST", headers: json({ authorization: "Bearer tok:org1" }), body: JSON.stringify({ rfqId: "R1" }) }))
  return tokenOf(((await res.json()) as { data: { url: string } }).data.url)
}
const session = async (token: string, phone = PHONE): Promise<string> => {
  const res = await verify(new NextRequest(`http://localhost/api/rfq-share/${token}/verify`, { method: "POST", headers: json(), body: JSON.stringify({ phone, challengeId: "ch1", code: "123456" }) }), ctx(token))
  return ((await res.json()) as { data: { session: { secret: string } } }).data.session.secret
}
const quote = async (token: string, secret: string, phone = PHONE): Promise<string> => {
  const f = new FormData()
  for (const [k, v] of Object.entries({ companyName: "Visitor Trading", phone, price: "5000", validUntil: "2100-01-15", executionDuration: "5", executionDurationUnit: "أيام" })) f.set(k, v)
  const res = await offer(new NextRequest(`http://localhost/api/rfq-share/${token}/offer`, { method: "POST", body: f, headers: { "x-link-session": secret } }), ctx(token))
  return ((await res.json()) as { data: { offerId: string } }).data.offerId
}
const call = (h: typeof me, token: string, body: unknown, secret?: string) => h(new NextRequest(`http://localhost/api/rfq-share/${token}/x`, { method: "POST", headers: json(secret ? { "x-link-session": secret } : {}), body: JSON.stringify(body) }), ctx(token))
const getLink = (token: string, v = "") => viewLink(new NextRequest(`http://localhost/api/rfq-share/${token}${v ? `?v=${v}` : ""}`), ctx(token))
const meOf = async (token: string, secret: string) => ((await call(me, token, {}, secret)).json() as Promise<{ data: { offer: Doc | null; result: Doc | null; tasks: { bafo: Doc | null; questions: Doc[] } } }>).then((j) => j.data)

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockVerifyOtp.mockResolvedValue("ok")
  process.env.NEXT_PUBLIC_APP_URL = "https://uat.mdmaktech.sa"
  mockDb.seed("users/org1", { role: "Contractor", organizationId: "org1", name: "Saad", companyName: "Acme" })
  seedRfq()
})
afterAll(() => {
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe("a closed request takes no quote, whatever the open page says (G-07, R-02)", () => {
  it.each([
    ["the deadline passed", { deadline: "2020-01-01" }, "DEADLINE_PASSED"],
    ["it was awarded", { status: "Awarded", awardedAt: "2026-10-10T08:00:00.000Z" }, "RFQ_CLOSED"],
    ["it was cancelled", { status: "Cancelled", cancellation: { code: "need" } }, "RFQ_CLOSED"],
  ])("%s", async (_name, patch, code) => {
    const token = await mint()
    const secret = await session(token)
    setRfq(patch)
    const f = new FormData()
    for (const [k, v] of Object.entries({ companyName: "Visitor Trading", phone: PHONE, price: "5000", validUntil: "2100-01-15", executionDuration: "5" })) f.set(k, v)
    const res = await offer(new NextRequest(`http://localhost/api/rfq-share/${token}/offer`, { method: "POST", body: f, headers: { "x-link-session": secret } }), ctx(token))
    expect([res.status, (await res.json()).code]).toEqual([409, code])
    expect(mockDb.list("offers")).toHaveLength(0)
  })

  it("the page still opens, view-only, with the state a visitor needs to read", async () => {
    const token = await mint()
    for (const [patch, state] of [
      [{ deadline: "2020-01-01" }, "closed"],
      [{ status: "Awarded", awardedAt: "2026-10-10T08:00:00.000Z" }, "awarded"],
      [{ status: "Cancelled", cancellation: { code: "spec" } }, "cancelled"],
    ] as Array<[Doc, string]>) {
      setRfq({ deadline: FUTURE, status: "New", ...patch })
      const res = await getLink(token)
      const body = await res.json()
      expect([res.status, body.data.canSubmit, body.data.rfq.state]).toEqual([200, false, state])
    }
  })
})

describe("what the visitor is shown (LNK-01, LNK-02, G-06, B-06, B-07)", () => {
  it("the city and the district only; not the pin, the project's name, nor the buyer's own title", async () => {
    const token = await mint()
    const body = await (await getLink(token)).json()
    const text = JSON.stringify(body)
    expect(body.data.rfq.places).toEqual([{ city: "Riyadh", district: "Al Olaya" }])
    expect(text).not.toContain("24.7136")
    expect(text).not.toContain("locationCoords")
    expect(text).not.toContain("Villa project")
    expect(body.data.rfq.title).toBe("Cement و Sand")
    expect(body.data.rfq.lines[0]).toMatchObject({ name: "Cement", specs: "Grey, 50 kg", qty: 100, unit: "bag" })
  })

  it("carries no other supplier's name, price or mobile", async () => {
    mockDb.seed("offers/O1", { rfqId: "R1", companyName: "Rival Trading", price: "98765", guestContact: { phone: "+966500000001" } })
    const token = await mint()
    const text = JSON.stringify(await (await getLink(token)).json())
    for (const leak of ["Rival Trading", "98765", "+966500000001"]) expect(text).not.toContain(leak)
  })

  it("the questions answered to everyone and the buyer's notes — never who asked, never an answer kept for the asker or a question on one quote", async () => {
    const q = (id: string, d: Doc) => mockDb.seed(`rfqs/R1/inquiries/${id}`, { createdAt: `2026-10-0${id.length}T08:00:00.000Z`, ...d })
    q("a", { kind: "ask", question: "هل التنزيل عليكم؟", from: { orgId: "supX", anon: false }, supplierName: "Secret Asker Co", answer: { text: "نعم، علينا", all: true, at: "2026-10-05T08:00:00.000Z" } })
    q("bb", { kind: "ask", question: "سؤال خاص", supplierName: "Private Co", answer: { text: "جواب خاص", all: false, at: "2026-10-06T08:00:00.000Z" } })
    q("ccc", { kind: "our_question", question: "وضّح الضمان", to: { orgId: "supX", offerId: "O9" }, reply: "سرّي", answer: { text: "سرّي", all: false } })
    q("dddd", { kind: "note", question: "الموقع مفتوح من السابعة", createdAt: "2026-10-04T08:00:00.000Z" })
    q("eeeee", { kind: "ask", question: "بلا جواب بعد", supplierName: "Waiting Co" })
    q("ffffff", { kind: "ask", question: "سؤال بصياغة المشتري", editedQuestion: "هل السعر شامل النقل؟", answer: { text: "شامل", all: true, at: "2026-10-07T08:00:00.000Z" } })
    const token = await mint()
    const body = await (await getLink(token)).json()
    expect(body.data.queries.map((x: Doc) => [x.question, x.answer])).toEqual([
      ["", "الموقع مفتوح من السابعة"],
      ["هل التنزيل عليكم؟", "نعم، علينا"],
      ["هل السعر شامل النقل؟", "شامل"],
    ])
    const text = JSON.stringify(body)
    for (const leak of ["Secret Asker Co", "Private Co", "سرّي", "جواب خاص", "Waiting Co", "supX"]) expect(text).not.toContain(leak)
  })
})

describe("his result, in the four words, once the request is decided (LNK-11)", () => {
  const setup = async () => {
    const token = await mint()
    const secret = await session(token)
    const id = await quote(token, secret)
    return { token, secret, id }
  }

  it("open: his quote is in; after the deadline with no decision: under review", async () => {
    const { token, secret } = await setup()
    expect((await meOf(token, secret)).result).toMatchObject({ kind: "open" })
    setRfq({ deadline: "2020-01-01" })
    const got = await meOf(token, secret)
    expect(got.result).toMatchObject({ kind: "review" })
    expect(got.offer).toMatchObject({ n: 1, total: 5000, gross: 5750, vatRegistered: true, companyName: "Visitor Trading" })
  })

  it("awarded to someone else: not awarded to him", async () => {
    const { token, secret } = await setup()
    setRfq({ status: "Awarded", awardedAt: "2026-10-10T08:00:00.000Z" })
    expect((await meOf(token, secret)).result).toMatchObject({ kind: "lost" })
  })

  it("awarded to him: «رُسّي عليك» only once the order is out to him, with the order's link when it exists", async () => {
    const { token, secret, id } = await setup()
    setRfq({ status: "Awarded", awardedAt: "2026-10-10T08:00:00.000Z" })
    mockDb.seed(`offers/${id}`, { ...(mockDb.get(`offers/${id}`) as Doc), status: "مقبول", poId: "P1", poNumber: "PO-2026/014", awaitingOrderApproval: true })
    mockDb.seed("purchaseOrders/P1", { status: "awaiting_approval", lines: [], organizationId: "org1" })
    expect((await meOf(token, secret)).result).toMatchObject({ kind: "review" })

    mockDb.seed("purchaseOrders/P1", { status: "sent", lines: [], organizationId: "org1" })
    mockDb.seed(`offers/${id}`, { ...(mockDb.get(`offers/${id}`) as Doc), awaitingOrderApproval: false })
    const noLink = (await meOf(token, secret)).result
    expect(noLink).toMatchObject({ kind: "awarded", poNumber: "PO-2026/014", orderUrl: null })

    mockDb.seed("orderLinks/P1", { poId: "P1", organizationId: "org1", tokenHashes: [] })
    const withLink = (await meOf(token, secret)).result as { orderUrl: string }
    expect(withLink.orderUrl).toMatch(/^https:\/\/uat\.mdmaktech\.sa\/po\/[A-Za-z0-9_-]{22}$/)
  })

  it("cancelled: «أُلغي» with its reason", async () => {
    const { token, secret } = await setup()
    setRfq({ status: "Cancelled", cancellation: { code: "spec" }, cancelledAt: "2026-10-10T08:00:00.000Z" })
    expect((await meOf(token, secret)).result).toMatchObject({ kind: "cancelled", cancelCode: "spec" })
  })

  it("only HIS quote: another mobile's session reads nothing of his", async () => {
    const { token } = await setup()
    const other = await session(token, "0559999999")
    expect((await meOf(token, other)).offer).toBeNull()
  })

  it("needs a session on this very link", async () => {
    const { token } = await setup()
    const none = await call(me, token, {})
    expect([none.status, (await none.json()).code]).toEqual([401, "NO_SESSION"])
    const foreign = await openLinkSession(mockDb as unknown as Firestore, { kind: "rfq", linkId: "another-link", phone: E164 })
    const wrong = await call(me, token, {}, foreign.secret)
    expect([wrong.status, (await wrong.json()).code]).toEqual([403, "SESSION_SCOPE"])
  })
})

describe("what is asked of him after the close (LNK-11)", () => {
  const withBafo = async (bafoPatch: Doc = {}) => {
    const token = await mint()
    const secret = await session(token)
    const id = await quote(token, secret)
    mockDb.seed(`offers/${id}`, { ...(mockDb.get(`offers/${id}`) as Doc), bafo: { at: "2026-10-12T08:00:00.000Z", byId: "org1", byName: "Saad", replyBy: FUTURE, note: "نحتاج أقل", round: 1, answered: null }, ...bafoPatch })
    return { token, secret, id }
  }

  it("a better price: shown as a task, answerable after the deadline, never higher, one round; the first version stays", async () => {
    const { token, secret, id } = await withBafo()
    setRfq({ deadline: "2020-01-01" })
    const tasks = (await meOf(token, secret)).tasks
    expect(tasks.bafo).toMatchObject({ replyBy: FUTURE, note: "نحتاج أقل", total: 5000 })

    const higher = await call(bafo, token, { total: "6000" }, secret)
    expect([higher.status, (await higher.json()).code]).toEqual([400, "PRICE_HIGHER"])

    mockDb.seed(`offerDecisions/${id}`, { offerId: id, shortlist: { at: "x" }, exclusion: null, log: [] })
    const before = JSON.stringify(mockDb.get(`offerDecisions/${id}`))
    const ok = await call(bafo, token, { total: "4500", note: "أفضل ما عندي" }, secret)
    expect((await ok.json()).data).toMatchObject({ n: 2, kind: "lowered", total: 4500 })
    const saved = mockDb.get(`offers/${id}`) as Doc & { versions: Doc[]; bafo: Doc }
    expect(saved.versions.map((v) => [v.n, v.total])).toEqual([[1, 5000], [2, 4500]])
    expect(saved.versions[1]).toMatchObject({ by: "guest", bafoReply: "lowered" })
    expect(saved.bafo.answered).toMatchObject({ n: 2, kind: "lowered" })
    expect(JSON.stringify(mockDb.get(`offerDecisions/${id}`))).toBe(before)

    const again = await call(bafo, token, { total: "4000" }, secret)
    expect([again.status, (await again.json()).code]).toEqual([409, "NOT_ASKED"])
  })

  it("the same price answers too; a closed request or a passed reply-by day does not", async () => {
    const { token, secret } = await withBafo()
    expect((await (await call(bafo, token, { total: "5000" }, secret)).json()).data.kind).toBe("kept")

    const late = await withBafo({ bafo: { at: "2026-10-01T08:00:00.000Z", byId: "org1", byName: "Saad", replyBy: "2026-10-05", note: null, round: 1, answered: null } })
    const lateRes = await call(bafo, late.token, { total: "4000" }, late.secret)
    expect([lateRes.status, (await lateRes.json()).code]).toEqual([409, "REPLY_CLOSED"])
  })

  it("a question put to HIS quote: shown as a task and answered back to the buyer alone", async () => {
    const token = await mint()
    const secret = await session(token)
    const id = await quote(token, secret)
    mockDb.seed("rfqs/R1/inquiries/q1", { kind: "our_question", question: "هل السعر شامل التنزيل؟", to: { orgId: null, offerId: id }, userId: "org1", reply: null, createdAt: "2026-10-12T08:00:00.000Z" })
    mockDb.seed("rfqs/R1/inquiries/q2", { kind: "our_question", question: "سؤال لمورد آخر", to: { orgId: "supY", offerId: "O-other" }, reply: null, createdAt: "2026-10-12T08:00:00.000Z" })
    setRfq({ deadline: "2020-01-01" })
    expect((await meOf(token, secret)).tasks.questions).toEqual([{ id: "q1", question: "هل السعر شامل التنزيل؟" }])

    const foreign = await call(answer, token, { inquiryId: "q2", answer: "x" }, secret)
    expect([foreign.status, (await foreign.json()).code]).toEqual([403, "NOT_YOURS"])

    const ok = await call(answer, token, { inquiryId: "q1", answer: "نعم شامل" }, secret)
    expect(ok.status).toBe(200)
    expect(mockDb.get("rfqs/R1/inquiries/q1")).toMatchObject({ reply: "نعم شامل", answer: { text: "نعم شامل", all: false } })
    expect((await meOf(token, secret)).tasks.questions).toEqual([])
    const twice = await call(answer, token, { inquiryId: "q1", answer: "again" }, secret)
    expect(twice.status).toBe(409)
  })
})

describe("his own question (LNK-08)", () => {
  it("without a verified mobile it is nameless — the buyer can answer it only for everyone", async () => {
    const token = await mint()
    const res = await call(ask, token, { question: "هل التسليم ممكن غداً؟" })
    expect(res.status).toBe(200)
    const [inq] = mockDb.list("rfqs/R1/inquiries")
    expect(inq).toMatchObject({ kind: "ask", via: "link", from: { orgId: null, anon: true }, supplierName: null, visitorPhone: null })
    expect(JSON.stringify(inq)).not.toContain(E164)
  })

  it("with a verified mobile it carries his company", async () => {
    const token = await mint()
    const secret = await session(token)
    await quote(token, secret)
    await call(ask, token, { question: "هل التسليم ممكن غداً؟" }, secret)
    const [inq] = mockDb.list("rfqs/R1/inquiries")
    expect(inq).toMatchObject({ from: { anon: false }, supplierName: "Visitor Trading", visitorPhone: E164 })
  })

  it("is refused once the request is closed", async () => {
    const token = await mint()
    setRfq({ status: "Awarded" })
    const res = await call(ask, token, { question: "متأخر" })
    expect([res.status, (await res.json()).code]).toEqual([409, "RFQ_CLOSED"])
  })
})

describe("how many times it was opened — never by the buyer's own preview (LNK-13, R-21)", () => {
  const previewAs = (as = "") => preview(new NextRequest(`http://localhost/api/rfq-share/preview?rfqId=R1${as ? `&as=${as}` : ""}`, { headers: { authorization: "Bearer tok:org1" } }))

  it("counts a browser once in half an hour and a second browser as another; the preview counts nothing", async () => {
    const token = await mint()
    const A = "viewerAAAAAAAAAAAAAAA"
    const B = "viewerBBBBBBBBBBBBBBB"
    await getLink(token, A)
    await getLink(token, A)
    await getLink(token, B)
    await getLink(token)
    const link = mockDb.list("rfqShareLinks")[0]
    expect([link.views, link.reachedCount]).toEqual([2, 2])

    for (let i = 0; i < 3; i++) await previewAs()
    expect(mockDb.list("rfqShareLinks")[0]).toMatchObject({ views: 2, reachedCount: 2 })
    const body = await (await previewAs()).json()
    expect(body.data.stats).toMatchObject({ views: 2, reachedCount: 2 })
    expect(JSON.stringify(mockDb.list("rfqShareLinks")[0])).not.toContain(A)
  })

  it("shows the buyer the page through a visitor's eyes: his quote and his result — and another buyer is refused", async () => {
    const token = await mint()
    const secret = await session(token)
    const id = await quote(token, secret)
    setRfq({ deadline: "2020-01-01" })
    const body = await (await previewAs(id)).json()
    expect(body.data.visitors).toEqual([{ offerId: id, company: "Visitor Trading" }])
    expect(body.data.me.offer).toMatchObject({ total: 5000 })
    expect(body.data.me.result).toMatchObject({ kind: "review" })
    expect(body.data.rfq.state).toBe("closed")

    mockDb.seed("users/other", { role: "Contractor", organizationId: "other" })
    const denied = await preview(new NextRequest("http://localhost/api/rfq-share/preview?rfqId=R1", { headers: { authorization: "Bearer tok:other" } }))
    expect(denied.status).toBe(403)
    const anon = await preview(new NextRequest("http://localhost/api/rfq-share/preview?rfqId=R1"))
    expect(anon.status).toBe(401)
  })
})
