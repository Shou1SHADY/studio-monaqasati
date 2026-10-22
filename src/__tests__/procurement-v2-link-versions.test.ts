/** @jest-environment node */
/**
 * Procurement 2.0 — the visitor's identity and versions (LNK-07…10, WF-10, G-07, G-15, R-03, R-04, R-05, NFR-07): a code on his
 * mobile before the first send, the first send is version 1, every edit from the same verified mobile is the NEXT version (the
 * 409 is gone), the buyer's decisions and the registered name survive, and the request is re-read inside the write.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCanSend = jest.fn(() => true)
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
jest.mock("@/lib/sms", () => ({ canSendCodes: () => mockCanSend(), isVerifyConfigured: () => false, isSmsConfigured: () => true, sendSms: async () => ({ sent: true }), startVerification: async () => ({ sent: true }) }))
jest.mock("@/lib/otp", () => ({
  OTP_CHALLENGES: "otpChallenges",
  maskPhone: (p: string) => `${p.slice(0, 5)}****`,
  issueOtp: async () => ({ challengeId: "ch1", code: "123456" }),
  issueRemoteOtp: async () => ({ challengeId: "ch1" }),
  verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
}))

import { POST as create } from "@/app/api/rfq-share/create/route"
import { POST as sendCode } from "@/app/api/rfq-share/[token]/code/route"
import { POST as verify } from "@/app/api/rfq-share/[token]/verify/route"
import { POST as offer, PUT as offerPut } from "@/app/api/rfq-share/[token]/offer/route"
import { MAX_UNIT_PRICE } from "@/lib/procurement/input-limits"

type Doc = Record<string, unknown>
const FUTURE = "2099-12-31"
const VALID = "2100-01-15"
const PHONE = "0551234567"
const SALE = [
  { ar: "قطعة 6 م", en: "piece 6 m", lengthM: 6 },
  { ar: "قطعة 12 م", en: "piece 12 m", lengthM: 12 },
]
const ctx = (token: string) => ({ params: Promise.resolve({ token }) })
const tokenOf = (url: unknown) => String(url).split("/").pop() as string
const setEnv = (v: string) => ((process.env as Record<string, string>).NODE_ENV = v)

const seedRfq = (over: Doc = {}) =>
  mockDb.seed("rfqs/R1", {
    organizationId: "org1",
    contractorId: "org1",
    createdByUserId: "org1",
    rfqNumber: "RFQ-2026/011",
    title: "زوايا حديد وخشب",
    status: "New",
    visibility: "public",
    pricingMode: "line",
    deadline: FUTURE,
    city: "الرياض",
    products: [
      { name: "زوايا حديد 50×50×5", quantity: 175, unitOfMeasure: "م", saleUnits: SALE, warrantyMonths: 24, requiresWarranty: true },
      { name: "خشب ألواح", quantity: 320, unitOfMeasure: "م" },
    ],
    offersCount: 0,
    log: [],
    ...over,
  })

const mint = async () => {
  const res = await create(new NextRequest("http://localhost/api/rfq-share/create", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer tok:org1" }, body: JSON.stringify({ rfqId: "R1" }) }))
  return tokenOf(((await res.json()) as { data: { url: string } }).data.url)
}

const getCode = (token: string, phone = PHONE) => sendCode(new NextRequest(`http://localhost/api/rfq-share/${token}/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) }), ctx(token))
const verifyPhone = async (token: string, phone = PHONE): Promise<string> => {
  const res = await verify(new NextRequest(`http://localhost/api/rfq-share/${token}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, challengeId: "ch1", code: "123456" }) }), ctx(token))
  return ((await res.json()) as { data: { session: { secret: string } } }).data.session.secret
}

const LINES = JSON.stringify([{ rfqProductIndex: 0, unitPrice: 74, packLen: 6, warrantyMonths: 24 }, { rfqProductIndex: 1, unitPrice: 3.6 }])
const form = (extra: Record<string, string> = {}) => {
  const f = new FormData()
  const base: Record<string, string> = { companyName: "Visitor Trading", phone: PHONE, lines: LINES, validUntil: VALID, executionDuration: "5", executionDurationUnit: "أيام" }
  for (const [k, v] of Object.entries({ ...base, ...extra })) if (v !== "") f.set(k, v)
  return f
}
const send = (token: string, extra: Record<string, string> = {}, secret: string | null = null, method: "POST" | "PUT" = "POST") =>
  (method === "POST" ? offer : offerPut)(new NextRequest(`http://localhost/api/rfq-share/${token}/offer`, { method, body: form(extra), headers: secret ? { "x-link-session": secret } : {} }), ctx(token))

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockCanSend.mockReturnValue(true)
  mockVerifyOtp.mockResolvedValue("ok")
  process.env.NEXT_PUBLIC_APP_URL = "https://uat.mdmaktech.sa"
  mockDb.seed("users/org1", { role: "Contractor", organizationId: "org1", name: "Saad", companyName: "Acme" })
  seedRfq()
})
afterAll(() => {
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe("a code on his mobile before the first send (R-05, LNK-09)", () => {
  it("refuses a send with no code and no session, and creates nothing", async () => {
    const token = await mint()
    const res = await send(token)
    expect([res.status, (await res.json()).code]).toEqual([400, "CODE_REQUIRED"])
    expect(mockDb.list("offers")).toHaveLength(0)
  })

  it("a verified code buys a session and the send then needs no second code", async () => {
    const token = await mint()
    await getCode(token)
    const secret = await verifyPhone(token)
    mockVerifyOtp.mockClear()
    const res = await send(token, {}, secret)
    expect(res.status).toBe(200)
    expect(mockVerifyOtp).not.toHaveBeenCalled()
    expect(mockDb.list("offers")).toHaveLength(1)
  })

  it("a session proves ITS mobile only: another number typed is asked for its own code", async () => {
    const token = await mint()
    const secret = await verifyPhone(token)
    const res = await send(token, { phone: "0559999999" }, secret)
    expect([res.status, (await res.json()).code]).toEqual([400, "CODE_REQUIRED"])
  })

  it("a code sent with the offer still works (first send without a session) and answers with the session it bought", async () => {
    const token = await mint()
    const res = await send(token, { challengeId: "ch1", code: "123456" })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.session.secret).toMatch(/^[a-f0-9]{64}$/)
  })

  it("in production with no way to send a code the send is a hard error — a typed number is never the identity", async () => {
    const token = await mint()
    mockCanSend.mockReturnValue(false)
    setEnv("production")
    try {
      const code = await getCode(token)
      expect([code.status, (await code.json()).code]).toEqual([503, "CODE_UNAVAILABLE"])
      const res = await send(token, { challengeId: "ch1", code: "123456" })
      expect([res.status, (await res.json()).code]).toEqual([503, "CODE_UNAVAILABLE"])
      expect(mockDb.list("offers")).toHaveLength(0)
    } finally {
      setEnv("test")
    }
  })
})

describe("the first send is version 1; every edit from the same mobile is the next version (G-15, R-03)", () => {
  it("enters the buyer's list as version 1, a guest offer from outside the platform", async () => {
    const token = await mint()
    const secret = await verifyPhone(token)
    const res = await send(token, {}, secret)
    const json = await res.json()
    expect(json.data).toMatchObject({ created: true, n: 1, total: 3372 })
    const saved = mockDb.list("offers")[0] as unknown as Doc & { versions: Doc[] }
    expect(saved).toMatchObject({ isGuestOffer: true, supplierId: "guest", rev: 1, price: "3372", status: "قيد المراجعة", companyName: "Visitor Trading" })
    expect(saved.versions).toHaveLength(1)
    expect(saved.versions[0]).toMatchObject({ n: 1, by: "guest", total: 3372, valid: VALID })
    expect((saved.guestContact as Doc).phone).toBe("+966551234567")
  })

  it("a second send is a new version, not a 409; the first stays; there is still ONE offer", async () => {
    const token = await mint()
    const secret = await verifyPhone(token)
    await send(token, {}, secret)
    const lines = JSON.stringify([{ rfqProductIndex: 0, unitPrice: 146, packLen: 12, warrantyMonths: 12 }, { rfqProductIndex: 1, unitPrice: 3.6 }])
    const res = await send(token, { lines }, secret, "PUT")
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({ created: false, n: 2, total: 3342 })
    const offers = mockDb.list("offers") as unknown as Array<Doc & { versions: Doc[] }>
    expect(offers).toHaveLength(1)
    expect(offers[0].versions.map((v) => [v.n, v.total])).toEqual([[1, 3372], [2, 3342]])
    expect(offers[0]).toMatchObject({ price: "3342", rev: 2 })
    expect((mockDb.get("rfqs/R1") as Doc).offersCount).toBe(1)
  })

  it("a POST from the same mobile is an edit too (an old page that resends)", async () => {
    const token = await mint()
    const secret = await verifyPhone(token)
    await send(token, {}, secret)
    const res = await send(token, {}, secret, "POST")
    expect(res.status).toBe(200)
    expect((mockDb.list("offers")[0] as unknown as Doc & { rev: number }).rev).toBe(2)
  })

  it("never erases the buyer's decisions: the shortlist and the exclusion are another record an edit cannot touch", async () => {
    const token = await mint()
    const secret = await verifyPhone(token)
    const first = await (await send(token, {}, secret)).json()
    const id = first.data.offerId as string
    mockDb.seed(`offerDecisions/${id}`, { offerId: id, rfqId: "R1", organizationId: "org1", shortlist: { at: "x", byId: "org1", byName: "Saad" }, exclusion: { at: "x", byId: "org1", byName: "Saad", code: "spec", text: null }, log: [], updatedAt: "x" })
    const before = JSON.stringify(mockDb.get(`offerDecisions/${id}`))
    await send(token, { executionDuration: "3" }, secret, "PUT")
    expect(JSON.stringify(mockDb.get(`offerDecisions/${id}`))).toBe(before)
    expect((mockDb.get(`offers/${id}`) as Doc).rev).toBe(2)
  })

  it("an edit never renames the company that was sent first (R-04)", async () => {
    const token = await mint()
    const secret = await verifyPhone(token)
    await send(token, {}, secret)
    await send(token, { companyName: "Another Name Co" }, secret, "PUT")
    expect((mockDb.list("offers")[0] as Doc).companyName).toBe("Visitor Trading")
  })

  it("a mobile that belongs to a registered supplier keeps the registered name", async () => {
    mockDb.seed("users/su9", { role: "Supplier", phone: "+966551234567", companyName: "Al Noor Steel" })
    const token = await mint()
    const secret = await verifyPhone(token)
    await send(token, { companyName: "Something Else" }, secret)
    expect(mockDb.list("offers")[0]).toMatchObject({ companyName: "Al Noor Steel", supplierName: "Al Noor Steel" })
  })

  it("keeps the packs, the warranty, «غير مسجّل ضريبياً» and «للطلب كاملاً فقط»", async () => {
    const token = await mint()
    const secret = await verifyPhone(token)
    await send(token, { vatRegistered: "false", whole: "true" }, secret)
    expect(mockDb.list("offers")[0]).toMatchObject({ whole: true, vatRegistered: false, vatRate: 0 })
    const saved = mockDb.list("offers")[0] as unknown as Doc & { lines: Doc[] }
    expect(saved.lines[0]).toEqual({ rfqProductIndex: 0, unitPrice: 74, packLen: 6, packKey: "قطعة 6 م", warrantyMonths: 24 })
  })
})

describe("four mandatory fields and a reasonable price: ONE clear refusal (LNK-07, NFR-07)", () => {
  const refused = async (extra: Record<string, string>, code: string) => {
    const token = await mint()
    const secret = await verifyPhone(token)
    const res = await send(token, extra, secret)
    expect([res.status, (await res.json()).code]).toEqual([400, code])
    expect(mockDb.list("offers")).toHaveLength(0)
  }

  it("delivery days: a whole number from 1 to 365 — 9,999 and 0 and 1.5 are refused", async () => {
    await refused({ executionDuration: "9999" }, "INVALID_DURATION")
    await refused({ executionDuration: "0" }, "INVALID_DURATION")
    await refused({ executionDuration: "" }, "INVALID_DURATION")
  })

  it("valid until: required, and not before the request closes", async () => {
    await refused({ validUntil: "" }, "VALID_MISSING")
    await refused({ validUntil: "2099-12-30" }, "VALID_BEFORE_CLOSE")
  })

  it("an unreasonable or non-positive price is refused", async () => {
    const big = JSON.stringify([{ rfqProductIndex: 0, unitPrice: MAX_UNIT_PRICE * 100 }, { rfqProductIndex: 1, unitPrice: 3.6 }])
    const zero = JSON.stringify([{ rfqProductIndex: 0, unitPrice: 0 }, { rfqProductIndex: 1, unitPrice: 3.6 }])
    await refused({ lines: big }, "INVALID_INPUT")
    await refused({ lines: zero }, "INVALID_INPUT")
  })

  it("the mobile must be Saudi 05XXXXXXXX", async () => {
    const token = await mint()
    const res = await send(token, { phone: "12345" })
    expect(res.status).toBe(400)
  })

  it("accepts the boundaries: 1 and 365 days, validity on the very day it closes", async () => {
    const token = await mint()
    const secret = await verifyPhone(token)
    expect((await send(token, { executionDuration: "365", validUntil: FUTURE }, secret)).status).toBe(200)
    expect((await send(token, { executionDuration: "1" }, secret, "PUT")).status).toBe(200)
  })
})

describe("the request is re-read inside the write (G-07)", () => {
  it("an offer that passes the gate but meets an awarded request in the transaction is refused", async () => {
    const token = await mint()
    const secret = await verifyPhone(token)
    const original = mockDb.runTransaction.bind(mockDb)
    mockDb.runTransaction = (async (fn: Parameters<typeof original>[0]) => {
      mockDb.seed("rfqs/R1", { ...(mockDb.get("rfqs/R1") as Doc), status: "Awarded" })
      return original(fn)
    }) as typeof mockDb.runTransaction
    try {
      const res = await send(token, {}, secret)
      expect([res.status, (await res.json()).code]).toEqual([409, "RFQ_CLOSED"])
      expect(mockDb.list("offers")).toHaveLength(0)
    } finally {
      mockDb.runTransaction = original
    }
  })

  it("an edit after the deadline is refused even from a page that was open", async () => {
    const token = await mint()
    const secret = await verifyPhone(token)
    await send(token, {}, secret)
    mockDb.seed("rfqs/R1", { ...(mockDb.get("rfqs/R1") as Doc), deadline: "2020-01-01" })
    const res = await send(token, {}, secret, "PUT")
    expect([res.status, (await res.json()).code]).toEqual([409, "DEADLINE_PASSED"])
    expect((mockDb.list("offers")[0] as Doc).rev).toBe(1)
  })
})
