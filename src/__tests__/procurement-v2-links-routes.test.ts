/** @jest-environment node */
/**
 * Procurement 2.0 (LNK-01, G-06, G-07, G-17, R-02, R-05, R-06, B-06, B-07, B-14) — the visitor link routes over an
 * in-memory Admin Firestore: what create hands out and refuses, what a visitor is shown, what he may do, per-mobile limits.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockSendEmail = jest.fn(async (_m: { to: string; subject: string; html: string }) => ({ sent: true }))
const mockSendSms = jest.fn(async (_m: { to: string; body: string }) => ({ sent: true }))
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
jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "SERVER_TS", increment: (n: number) => ({ __inc: n }), arrayUnion: (v: unknown) => [v] },
}))
jest.mock("@/lib/org-identity-admin", () => ({ resolveIdentityAdmin: async (_db: unknown, _uid: string, base: unknown) => base }))
jest.mock("@/lib/email", () => ({
  sendEmail: (m: { to: string; subject: string; html: string }) => mockSendEmail(m),
  buildRfqShareEmail: (a: { shareUrl: string }) => ({ subject: "s", html: a.shareUrl }),
  buildGuestOfferReceiptEmail: (a: { offerUrl: string }) => ({ subject: "s", html: a.offerUrl }),
}))
jest.mock("@/lib/sms", () => ({
  canSendCodes: () => mockCanSend(),
  isVerifyConfigured: () => false,
  isSmsConfigured: () => true,
  sendSms: (m: { to: string; body: string }) => mockSendSms(m),
  startVerification: async () => ({ sent: true }),
}))
jest.mock("@/lib/otp", () => ({
  OTP_CHALLENGES: "otpChallenges",
  maskPhone: (p: string) => `${p.slice(0, 5)}****`,
  issueOtp: async () => ({ challengeId: "ch1", code: "123456" }),
  issueRemoteOtp: async () => ({ challengeId: "ch1" }),
  verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
}))

import { POST as create } from "@/app/api/rfq-share/create/route"
import { GET as viewLink } from "@/app/api/rfq-share/[token]/route"
import { POST as sendCode } from "@/app/api/rfq-share/[token]/code/route"
import { POST as submitOffer } from "@/app/api/rfq-share/[token]/offer/route"
import { GET as viewOffer } from "@/app/api/guest-offer/[token]/route"
import { mintLinkToken, hashToken } from "@/lib/links/hash"
import { RATE_RULES, consumeMobileRate } from "@/lib/links/rate"
import { readLinkSession } from "@/lib/links/session"
import { deadlineEnd } from "@/lib/procurement/guest-supplier"
import { createGuestOfferLink } from "@/lib/guest-offer"
import { SHARE_ERROR_CODES } from "@/lib/rfq-share-errors"
import type { Firestore } from "firebase-admin/firestore"

const db = mockDb as unknown as Firestore
const everything = () => JSON.stringify([...mockDb.docs])
const FUTURE = "2099-12-31"
const URL_RE = /^https:\/\/uat\.mdmaktech\.sa\/rfq\/([A-Za-z0-9_-]{22})$/

const asUser = (uid: string, body: unknown) =>
  new NextRequest("http://localhost/api/rfq-share/create", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tok:${uid}` }, body: JSON.stringify(body) })
const createFor = async (body: Record<string, unknown>, uid = "u1") => {
  const res = await create(asUser(uid, body))
  return { status: res.status, json: (await res.json()) as { success?: boolean; error?: boolean; code?: string; data?: Record<string, unknown> } }
}
const ctx = (token: string) => ({ params: Promise.resolve({ token }) })
const getLink = (token: string) => viewLink(new NextRequest(`http://localhost/api/rfq-share/${token}`), ctx(token))
const tokenOf = (url: unknown) => String(url).split("/").pop() as string

const seedRfq = (over: Record<string, unknown> = {}, id = "R1") =>
  mockDb.seed(`rfqs/${id}`, {
    status: "New",
    title: "Cement for the villa",
    rfqNumber: "RFQ-2026/011",
    organizationId: "org1",
    contractorId: "u1",
    deadline: FUTURE,
    city: "Riyadh",
    district: "Al Olaya",
    locationCoords: { lat: 24.7136, lng: 46.6753 },
    products: [{ name: "Cement", quantity: 100, unitOfMeasure: "bag" }],
    ...over,
  })

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockSendEmail.mockClear()
  mockSendSms.mockClear()
  mockCanSend.mockReturnValue(true)
  mockVerifyOtp.mockResolvedValue("ok")
  process.env.NEXT_PUBLIC_APP_URL = "https://uat.mdmaktech.sa"
  mockDb.seed("users/u1", { role: "Contractor", organizationId: "org1", name: "Saad", companyName: "Acme" })
  mockDb.seed("users/u2", { role: "Contractor", organizationId: "org2", name: "Other", companyName: "Other Co" })
  seedRfq()
})

afterAll(() => {
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe("minting the RFQ's link (LNK-01, NFR-04)", () => {
  it("hands out a 22-character link on this deployment's origin and stores only its hash", async () => {
    const { status, json } = await createFor({ rfqId: "R1" })
    expect(status).toBe(200)
    const url = String(json.data?.url)
    expect(url).toMatch(URL_RE)
    const token = tokenOf(url)

    expect(json.data).not.toHaveProperty("token")
    expect(everything()).not.toContain(token)
    const link = mockDb.list("rfqShareLinks")[0]
    expect(link).not.toHaveProperty("token")
    expect(link.tokenHashes).toEqual([hashToken(token)])
    expect(link.expiresWith).toBe("deadline")
    expect(link.expiresAt).toBe(deadlineEnd(FUTURE))
    expect(json.data?.expiresAt).toBe(deadlineEnd(FUTURE))
  })

  it("points a UAT link at UAT and a production link at production, never at a hard-coded domain", async () => {
    const uat = await createFor({ rfqId: "R1" })
    expect(String(uat.json.data?.url).startsWith("https://uat.mdmaktech.sa/rfq/")).toBe(true)
    delete process.env.NEXT_PUBLIC_APP_URL
    const prod = await createFor({ rfqId: "R1" })
    expect(String(prod.json.data?.url).startsWith("https://mdmaktech.sa/rfq/")).toBe(true)
  })

  it("reuses the RFQ's link (one link, one invitation list) and gives each ask its own token, all of which open the same page", async () => {
    const a = await createFor({ rfqId: "R1" })
    const b = await createFor({ rfqId: "R1", channel: "whatsapp" })
    const c = await createFor({ rfqId: "R1" })

    expect(mockDb.list("rfqShareLinks")).toHaveLength(1)
    expect(a.json.data?.url).toBeTruthy()
    expect(c.json.data?.url).not.toBe(a.json.data?.url)
    expect(b.json.data?.url).toBeNull()
    expect(mockDb.list("rfqShareLinks")[0].tokenHashes).toHaveLength(2)
    expect(mockDb.list("rfqShareLinks")[0].channel).toBe("whatsapp")

    for (const r of [a, c]) {
      const g = await getLink(tokenOf(r.json.data?.url))
      expect([g.status, g.status === 200 ? "" : await g.json(), r.json.data?.url]).toEqual([200, "", r.json.data?.url])
    }
  })

  it("e-mailing the link sends the token it mints and still stores none", async () => {
    const { json } = await createFor({ rfqId: "R1", email: "Supplier@Example.sa" })
    expect(json.data?.emailSent).toBe(true)
    const sent = mockSendEmail.mock.calls[0][0]
    expect(sent.to).toBe("supplier@example.sa")
    expect(sent.html).toMatch(URL_RE)
    expect(everything()).not.toContain(tokenOf(sent.html))
  })

  it("refuses a private or direct-award RFQ unless the buyer says so, and keeps who did (R-06, LNK-01)", async () => {
    seedRfq({ visibility: "private" }, "RP")
    seedRfq({ directAward: true }, "RD")

    for (const id of ["RP", "RD"]) {
      const refused = await createFor({ rfqId: id })
      expect(refused.status).toBe(409)
      expect(refused.json.code).toBe("LINK_NOT_DEFAULT")
      expect(refused.json.error).toBe(true)
    }
    expect(mockDb.list("rfqShareLinks")).toHaveLength(0)
    expect(mockDb.list("linkTokens")).toHaveLength(0)

    const ok = await createFor({ rfqId: "RP", explicit: true })
    expect(ok.status).toBe(200)
    expect(mockDb.list("rfqShareLinks")[0].explicitBy).toMatchObject({ uid: "u1", name: "Saad" })
    const stillRefused = await createFor({ rfqId: "RD" })
    expect(stillRefused.json.code).toBe("LINK_NOT_DEFAULT")
  })

  it("a public RFQ needs no opt-in and records none", async () => {
    await createFor({ rfqId: "R1" })
    expect(mockDb.list("rfqShareLinks")[0]).not.toHaveProperty("explicitBy")
  })

  it("answers every refusal with a code the share dialog has a sentence for", async () => {
    seedRfq({ status: "Awarded" }, "RA")
    expect((await createFor({ rfqId: "RA" })).json.code).toBe("RFQ_NOT_PUBLISHED")
    expect((await createFor({ rfqId: "R1" }, "u2")).json.code).toBe("FORBIDDEN")
    expect((await createFor({ rfqId: "NOPE" })).json.code).toBe("RFQ_NOT_FOUND")
    expect((await createFor({})).json.code).toBe("INVALID_INPUT")
    expect(SHARE_ERROR_CODES).toContain("LINK_NOT_DEFAULT")
  })
})

describe("what the visitor is shown (LNK-01, G-06, B-06, B-07, B-14)", () => {
  it("is the city and the district, never the site's pin", async () => {
    const token = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    const res = await getLink(token)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.rfq.places).toEqual([{ city: "Riyadh", district: "Al Olaya" }])
    expect(body.data.rfq).not.toHaveProperty("locationCoords")
    expect(JSON.stringify(body)).not.toContain("24.7136")
    expect(JSON.stringify(body)).not.toContain("46.6753")
  })

  it("carries no other supplier's name or price", async () => {
    mockDb.seed("offers/O1", { rfqId: "R1", companyName: "Rival Trading", price: "98765", guestContact: { phone: "+966500000001" } })
    const token = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    const text = JSON.stringify(await (await getLink(token)).json())
    expect(text).not.toContain("Rival Trading")
    expect(text).not.toContain("98765")
    expect(text).not.toContain("+966500000001")
  })

  it("a guest offer link shows only its own offer", async () => {
    mockDb.seed("offers/O1", { rfqId: "R1", companyName: "Mine Trading", price: "111", supplierName: "Mine Trading", isGuestOffer: true, status: "قيد المراجعة" })
    mockDb.seed("offers/O2", { rfqId: "R1", companyName: "Rival Trading", price: "98765", isGuestOffer: true })
    mockDb.seed("rfqs/R1", { ...mockDb.get("rfqs/R1")!, locationCoords: { lat: 24.7136, lng: 46.6753 } })
    const info = await createGuestOfferLink({ offerId: "O1", rfqId: "R1", contractorId: "u1" })
    const res = await viewOffer(new NextRequest(`http://localhost/api/guest-offer/${info.token}`), ctx(info.token))
    const text = JSON.stringify(await res.json())
    expect(res.status).toBe(200)
    expect(text).toContain("Mine Trading")
    expect(text).not.toContain("Rival Trading")
    expect(text).not.toContain("98765")
    expect(text).not.toContain("24.7136")
  })

  it("an old 64-hex link still opens, a malformed token is refused as invalid", async () => {
    mockDb.seed("rfqShareLinks/OLD", { token: "cd".repeat(32), rfqId: "R1", revoked: false, expiresWith: "deadline", expiresAt: deadlineEnd(FUTURE), invites: [] })
    expect((await getLink("cd".repeat(32))).status).toBe(200)
    const bad = await getLink("short")
    expect(bad.status).toBe(400)
    expect((await bad.json()).code).toBe("INVALID_TOKEN")
    expect((await getLink("x".repeat(22))).status).toBe(404)
  })
})

describe("the link ends with the RFQ (G-07, R-02, NFR-04)", () => {
  it("opens while the RFQ takes offers and is view-only after the deadline and once the RFQ is decided (a visitor reads his result)", async () => {
    const token = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    const open = await (await getLink(token)).json()
    expect(open.data.canSubmit).toBe(true)

    mockDb.seed("rfqs/R1", { ...mockDb.get("rfqs/R1")!, deadline: "2020-01-01" })
    const closed = await getLink(token)
    expect(closed.status).toBe(200)
    expect((await closed.json()).data.canSubmit).toBe(false)

    mockDb.seed("rfqs/R1", { ...mockDb.get("rfqs/R1")!, deadline: FUTURE, status: "Awarded" })
    const decided = await getLink(token)
    expect(decided.status).toBe(200)
    const body = await decided.json()
    expect(body.data.canSubmit).toBe(false)
    expect(body.data.rfq.state).toBe("awarded")
  })

  it("a revoked link is gone for every token it ever had", async () => {
    const a = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    const b = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    const linkId = mockDb.list("rfqShareLinks")[0].id
    mockDb.seed(`rfqShareLinks/${linkId}`, { ...mockDb.get(`rfqShareLinks/${linkId}`)!, revoked: true })
    for (const t of [a, b]) expect((await getLink(t)).status).toBe(410)
  })

  it("refuses an offer on a link whose RFQ has closed even though the page was open (G-07)", async () => {
    const token = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    mockDb.seed("rfqs/R1", { ...mockDb.get("rfqs/R1")!, status: "Awarded" })
    const res = await submitOffer(offerRequest(token, { challengeId: "ch1", code: "123456" }), ctx(token))
    expect([res.status, (await res.json()).code]).toEqual([409, "RFQ_CLOSED"])
  })
})

const code = (token: string, phone: string) =>
  sendCode(new NextRequest(`http://localhost/api/rfq-share/${token}/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) }), ctx(token))

function offerRequest(token: string, extra: Record<string, string> = {}, phone = "0551234567") {
  const form = new FormData()
  form.set("companyName", "Visitor Trading")
  form.set("phone", phone)
  form.set("price", "1500")
  form.set("validUntil", "2100-01-15")
  form.set("executionDuration", "5")
  for (const [k, v] of Object.entries(extra)) form.set(k, v)
  return new NextRequest(`http://localhost/api/rfq-share/${token}/offer`, { method: "POST", body: form })
}

describe("one mobile cannot spend the platform's SMS or flood it with offers (G-17)", () => {
  it("lets a mobile ask for its quota of codes in an hour across all links, then answers 429 with a clear code", async () => {
    const t1 = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    seedRfq({}, "R2")
    mockDb.seed("users/u1", { ...mockDb.get("users/u1")!, organizationId: "org1" })
    const t2 = tokenOf((await createFor({ rfqId: "R2" })).json.data?.url)

    for (let i = 0; i < RATE_RULES.otp.max; i++) expect((await code(i % 2 ? t1 : t2, "0551234567")).status).toBe(200)
    const sixth = await code(t1, "0551234567")
    expect(sixth.status).toBe(429)
    expect((await sixth.json()).code).toBe("RATE_LIMITED")
    expect(Number(sixth.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(mockSendSms).toHaveBeenCalledTimes(RATE_RULES.otp.max)

    expect((await code(t1, "0559999999")).status).toBe(200)
  })

  it("refuses to send a code when the counter cannot be reached rather than letting it through", async () => {
    const token = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    const original = mockDb.runTransaction.bind(mockDb)
    mockDb.runTransaction = (async () => {
      throw new Error("unavailable")
    }) as typeof mockDb.runTransaction
    try {
      const res = await code(token, "0551234567")
      expect(res.status).toBe(503)
      expect((await res.json()).code).toBe("RATE_UNAVAILABLE")
      expect(mockSendSms).not.toHaveBeenCalled()
    } finally {
      mockDb.runTransaction = original
    }
  })

  it("blocks the offer that would be one too many from a mobile", async () => {
    const token = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    for (let i = 0; i < RATE_RULES.write.max; i++) await consumeMobileRate(db, "write", "+966551234567")
    const res = await submitOffer(offerRequest(token, { challengeId: "ch1", code: "123456" }), ctx(token))
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("RATE_LIMITED")
    expect(mockDb.list("offers")).toHaveLength(0)
  })
})

describe("a verified code buys a session on this link only (R-05)", () => {
  it("asks for the code first, and answers a verified submit with a session and a hashed guest link", async () => {
    const token = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    const noCode = await submitOffer(offerRequest(token), ctx(token))
    expect(noCode.status).toBe(400)
    expect((await noCode.json()).code).toBe("CODE_REQUIRED")
    expect(mockDb.list("offers")).toHaveLength(0)

    const res = await submitOffer(offerRequest(token, { challengeId: "ch1", code: "123456" }), ctx(token))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.offerUrl).toMatch(/^https:\/\/uat\.mdmaktech\.sa\/offer\/[A-Za-z0-9_-]{22}$/)
    expect(everything()).not.toContain(tokenOf(json.data.offerUrl))
    expect(everything()).not.toContain(json.data.session.secret)

    const linkId = mockDb.list("rfqShareLinks")[0].id
    expect(await readLinkSession(db, json.data.session.secret, { kind: "rfq", linkId })).toEqual({ ok: true, phone: "+966551234567" })
    expect(await readLinkSession(db, json.data.session.secret, { kind: "rfq", linkId: "another-rfq-link" })).toMatchObject({ ok: false, code: "SESSION_SCOPE" })
  })

  it("a wrong code opens nothing and creates nothing", async () => {
    const token = tokenOf((await createFor({ rfqId: "R1" })).json.data?.url)
    mockVerifyOtp.mockResolvedValue("wrong")
    const res = await submitOffer(offerRequest(token, { challengeId: "ch1", code: "000000" }), ctx(token))
    expect(res.status).toBe(400)
    expect(mockDb.list("offers")).toHaveLength(0)
    expect(mockDb.list("linkSessions")).toHaveLength(0)
  })
})

describe("a minted token is gone from view the moment it is handed out", () => {
  it("never appears again in what the buyer is told about the link", async () => {
    const first = await createFor({ rfqId: "R1" })
    const token = tokenOf(first.json.data?.url)
    const again = await createFor({ rfqId: "R1", channel: "link" })
    expect(JSON.stringify(again.json)).not.toContain(token)
    const link = mockDb.list("rfqShareLinks")[0]
    expect(JSON.stringify(link)).not.toContain(token)
    expect(await mintLinkToken(db, "rfq", link.id)).not.toBe(token)
  })
})
