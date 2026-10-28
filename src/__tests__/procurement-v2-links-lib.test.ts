/** @jest-environment node */
/**
 * Procurement 2.0 (NFR-04, G-17, LNK-01) — the link library: 22-character random tokens, stored only as a hash, legacy
 * 64-hex tokens that keep resolving, an origin that follows the deployment, a session scoped to one link and a per-mobile
 * rate limit that fails closed.
 */

import fs from "fs"
import path from "path"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()

jest.mock("@/lib/firebaseAdmin", () => ({ getAdminFirestore: () => mockDb }))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "SERVER_TS", increment: (n: number) => ({ __inc: n }) } }))

import { LINK_TOKEN_LEN, isLegacyLinkToken, isLinkToken, mintToken, tokenFormat } from "@/lib/links/token"
import { LINK_TOKEN_INDEX, MAX_TOKENS_PER_LINK, findLinkByToken, hashToken, mintLinkToken } from "@/lib/links/hash"
import { DEFAULT_PUBLIC_BASE_URL, linkUrl, publicBaseUrl } from "@/lib/links/url"
import { LINK_SESSION_TTL_MS, LINK_SESSIONS, openLinkSession, readLinkSession } from "@/lib/links/session"
import { LINK_RATE_LIMITS, RATE_RULES, consumeMobileRate, consumeRate } from "@/lib/links/rate"
import { createGuestOfferLink, ensureGuestOfferLink, recordGuestNotification, resolveGuestOfferToken } from "@/lib/guest-offer"
import type { Firestore } from "firebase-admin/firestore"

const db = mockDb as unknown as Firestore
const everything = () => JSON.stringify([...mockDb.docs])

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe("the token (G-17: 22 random characters, at least 128 bits)", () => {
  it("is 22 base64url characters, never repeats, and carries 128 bits from the server's random source", () => {
    const seen = new Set<string>()
    const chars = new Set<string>()
    for (let i = 0; i < 3000; i++) {
      const t = mintToken()
      expect(t).toHaveLength(LINK_TOKEN_LEN)
      expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/)
      expect(Buffer.from(t, "base64url")).toHaveLength(16)
      seen.add(t)
      for (const c of t) chars.add(c)
    }
    expect(seen.size).toBe(3000)
    expect(chars.size).toBeGreaterThan(60)
  })

  it("is told apart from the legacy 64-hex token and from anything else", () => {
    const fresh = mintToken()
    expect(tokenFormat(fresh)).toBe("new")
    expect(isLinkToken(fresh)).toBe(true)
    expect(tokenFormat("a".repeat(64))).toBe("legacy")
    expect(isLegacyLinkToken("a".repeat(64))).toBe(true)
    expect(tokenFormat("short")).toBeNull()
    expect(tokenFormat("a".repeat(23))).toBeNull()
    expect(tokenFormat(`${fresh}!`)).toBeNull()
    expect(tokenFormat(undefined)).toBeNull()
  })
})

describe("the token at rest (NFR-04: only its hash is stored)", () => {
  it("writes the hash on the link and in the lookup index, never the token", async () => {
    mockDb.seed("rfqShareLinks/L1", { rfqId: "R1", revoked: false, tokenHashes: [] })
    const token = await mintLinkToken(db, "rfq", "L1")
    const hash = hashToken(token)

    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toBe(token)
    expect(mockDb.get("rfqShareLinks/L1")?.tokenHashes).toEqual([hash])
    expect(mockDb.get(`${LINK_TOKEN_INDEX}/${hash}`)).toMatchObject({ kind: "rfq", linkId: "L1" })
    expect(everything()).not.toContain(token)
    expect(mockDb.get("rfqShareLinks/L1")?.token).toBeUndefined()
  })

  it("finds the link by the hash of the presented token, and only for the kind it was minted for", async () => {
    mockDb.seed("rfqShareLinks/L1", { rfqId: "R1", tokenHashes: [] })
    mockDb.seed("guestOfferLinks/G1", { offerId: "O1", tokenHashes: [] })
    const rfqToken = await mintLinkToken(db, "rfq", "L1")
    const offerToken = await mintLinkToken(db, "offer", "G1")

    expect(await findLinkByToken(db, "rfq", rfqToken)).toMatchObject({ ok: true, linkId: "L1", legacy: false })
    expect(await findLinkByToken(db, "offer", offerToken)).toMatchObject({ ok: true, linkId: "G1" })
    expect(await findLinkByToken(db, "offer", rfqToken)).toMatchObject({ ok: false, code: "NOT_FOUND", status: 404 })
    expect(await findLinkByToken(db, "rfq", mintToken())).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(await findLinkByToken(db, "rfq", "nope")).toMatchObject({ ok: false, code: "INVALID_TOKEN", status: 400 })
  })

  it("a link keeps several tokens (each handed out once) and drops the oldest past the cap", async () => {
    mockDb.seed("rfqShareLinks/L1", { rfqId: "R1", tokenHashes: [] })
    const first = await mintLinkToken(db, "rfq", "L1")
    const second = await mintLinkToken(db, "rfq", "L1")
    expect(first).not.toBe(second)
    expect((await findLinkByToken(db, "rfq", first)).ok).toBe(true)
    expect((await findLinkByToken(db, "rfq", second)).ok).toBe(true)

    for (let i = 0; i < MAX_TOKENS_PER_LINK; i++) await mintLinkToken(db, "rfq", "L1")
    expect(mockDb.get("rfqShareLinks/L1")?.tokenHashes).toHaveLength(MAX_TOKENS_PER_LINK)
    expect(await findLinkByToken(db, "rfq", first)).toMatchObject({ ok: false, code: "NOT_FOUND" })
  })

  it("a token whose index entry points at another link does not open it", async () => {
    mockDb.seed("rfqShareLinks/L1", { rfqId: "R1", tokenHashes: [] })
    mockDb.seed("rfqShareLinks/L2", { rfqId: "R2", tokenHashes: [] })
    const t1 = await mintLinkToken(db, "rfq", "L1")
    const forged = mockDb.get(`${LINK_TOKEN_INDEX}/${hashToken(t1)}`)
    mockDb.seed(`${LINK_TOKEN_INDEX}/${hashToken(t1)}`, { ...forged, linkId: "L2" })
    expect(await findLinkByToken(db, "rfq", t1)).toMatchObject({ ok: false, code: "NOT_FOUND" })
  })
})

describe("a legacy link (64-hex plaintext token) keeps resolving", () => {
  const legacy = "ab".repeat(32)

  it("resolves by the plaintext field and is left exactly as it was", async () => {
    mockDb.seed("rfqShareLinks/OLD", { token: legacy, rfqId: "R1", revoked: false, expiresAt: "2030-01-01T00:00:00.000Z" })
    const before = JSON.stringify(mockDb.get("rfqShareLinks/OLD"))
    expect(await findLinkByToken(db, "rfq", legacy)).toMatchObject({ ok: true, linkId: "OLD", legacy: true })
    expect(JSON.stringify(mockDb.get("rfqShareLinks/OLD"))).toBe(before)
    expect(mockDb.writes).toHaveLength(0)
  })

  it("resolves by its hash once the migration has hashed it, with or without the plaintext", async () => {
    const hash = hashToken(legacy)
    mockDb.seed("rfqShareLinks/OLD", { rfqId: "R1", revoked: false, tokenHashes: [hash] })
    mockDb.seed(`${LINK_TOKEN_INDEX}/${hash}`, { kind: "rfq", linkId: "OLD" })
    expect(await findLinkByToken(db, "rfq", legacy)).toMatchObject({ ok: true, linkId: "OLD", legacy: false })
  })

  it("a guest offer link keeps its 60-day expiry: resolving it, notifying on it or being handed again never moves it", async () => {
    const expiresAt = new Date(Date.now() + 5 * 86_400_000).toISOString()
    mockDb.seed("guestOfferLinks/GO", { token: legacy, offerId: "O1", rfqId: "R1", revoked: false, expiresAt, channel: "link" })
    mockDb.seed("offers/O1", { rfqId: "R1", isGuestOffer: true, guestContact: { phone: "+966551234567" } })
    mockDb.seed("rfqs/R1", { title: "Cement" })

    expect(await resolveGuestOfferToken(legacy)).toMatchObject({ ok: true, linkId: "GO" })
    await recordGuestNotification("GO", "reduction_requested", "whatsapp")
    const again = await ensureGuestOfferLink("O1", mockDb.get("offers/O1")!)

    expect(again.linkId).toBe("GO")
    expect(mockDb.get("guestOfferLinks/GO")?.expiresAt).toBe(expiresAt)
    expect(await resolveGuestOfferToken(again.token)).toMatchObject({ ok: true, linkId: "GO" })
    expect(again.token).not.toBe(legacy)
    expect(everything()).not.toContain(again.token)
  })

  it("an expired guest offer link stays expired; a buyer who needs it again gets a new link, not a revived one", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    mockDb.seed("guestOfferLinks/GO", { offerId: "O1", rfqId: "R1", revoked: false, expiresAt: past, tokenHashes: [] })
    mockDb.seed("offers/O1", { rfqId: "R1", isGuestOffer: true })
    const oldToken = await mintLinkToken(db, "offer", "GO")
    expect(await resolveGuestOfferToken(oldToken)).toMatchObject({ ok: false, code: "LINK_EXPIRED", status: 410 })

    const fresh = await ensureGuestOfferLink("O1", mockDb.get("offers/O1")!)
    expect(fresh.linkId).not.toBe("GO")
    expect(mockDb.get("guestOfferLinks/GO")?.expiresAt).toBe(past)
    expect(await resolveGuestOfferToken(fresh.token)).toMatchObject({ ok: true })
  })

  it("a new guest offer link stores no plaintext and lives 60 days from its creation", async () => {
    const info = await createGuestOfferLink({ offerId: "O9", rfqId: "R9", email: "a@b.sa", phone: "+966551234567" })
    expect(everything()).not.toContain(info.token)
    const link = mockDb.get(`guestOfferLinks/${info.linkId}`)!
    expect(link.token).toBeUndefined()
    const days = (Date.parse(link.expiresAt as string) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(59.9)
    expect(days).toBeLessThanOrEqual(60)
  })
})

describe("the link origin follows the deployment (C-1)", () => {
  it("is production's domain when nothing is configured, and the configured origin otherwise", () => {
    expect(publicBaseUrl()).toBe(DEFAULT_PUBLIC_BASE_URL)
    expect(DEFAULT_PUBLIC_BASE_URL).toBe("https://mdmak.sa")
    process.env.NEXT_PUBLIC_APP_URL = "https://uat.mdmaktech.sa/"
    expect(publicBaseUrl()).toBe("https://uat.mdmaktech.sa")
    expect(linkUrl("rfq", "T")).toBe("https://uat.mdmaktech.sa/rfq/T")
    expect(linkUrl("offer", "T")).toBe("https://uat.mdmaktech.sa/offer/T")
    expect(linkUrl("po", "T")).toBe("https://uat.mdmaktech.sa/po/T")
    process.env.NEXT_PUBLIC_APP_URL = "https://mdmaktech.sa"
    expect(linkUrl("rfq", "T")).toBe("https://mdmaktech.sa/rfq/T")
  })

  it("never hands out a link to a developer machine, and ignores junk", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:9002"
    expect(publicBaseUrl()).toBe(DEFAULT_PUBLIC_BASE_URL)
    process.env.NEXT_PUBLIC_APP_URL = "not a url"
    expect(publicBaseUrl()).toBe(DEFAULT_PUBLIC_BASE_URL)
  })

  it("is not hard-wired to production where links are minted", () => {
    for (const f of ["src/lib/rfq-share.ts", "src/lib/guest-offer.ts", "src/app/api/rfq-share/create/route.ts"]) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8")
      expect(src).not.toContain("PUBLIC_BASE_URL")
      expect(src).not.toMatch(/https:\/\/(www\.)?mdmaktech\.sa/)
    }
  })
})

describe("the visitor session (scoped to one link)", () => {
  it("opens for the link it was bought on and no other (an RFQ A session cannot act on RFQ B)", async () => {
    const { secret, expiresAt } = await openLinkSession(db, { kind: "rfq", linkId: "LA", phone: "+966551234567" })
    expect(secret).toMatch(/^[a-f0-9]{64}$/)
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(LINK_SESSION_TTL_MS)

    expect(await readLinkSession(db, secret, { kind: "rfq", linkId: "LA" })).toEqual({ ok: true, phone: "+966551234567" })
    expect(await readLinkSession(db, secret, { kind: "rfq", linkId: "LB" })).toMatchObject({ ok: false, code: "SESSION_SCOPE", status: 403 })
    expect(await readLinkSession(db, secret, { kind: "offer", linkId: "LA" })).toMatchObject({ ok: false, code: "SESSION_SCOPE" })
  })

  it("stores only a hash of the secret, refuses a missing, wrong or expired one", async () => {
    const { secret } = await openLinkSession(db, { kind: "rfq", linkId: "LA", phone: "+966551234567" }, 1_000_000)
    expect(everything()).not.toContain(secret)
    expect(mockDb.list(LINK_SESSIONS)).toHaveLength(1)

    expect(await readLinkSession(db, null, { kind: "rfq", linkId: "LA" })).toMatchObject({ ok: false, code: "NO_SESSION", status: 401 })
    expect(await readLinkSession(db, "f".repeat(64), { kind: "rfq", linkId: "LA" })).toMatchObject({ ok: false, code: "NO_SESSION" })
    expect(await readLinkSession(db, "short", { kind: "rfq", linkId: "LA" })).toMatchObject({ ok: false, code: "NO_SESSION" })
    expect(await readLinkSession(db, secret, { kind: "rfq", linkId: "LA" }, 1_000_000 + LINK_SESSION_TTL_MS + 1)).toMatchObject({ ok: false, code: "SESSION_EXPIRED", status: 401 })
    expect(await readLinkSession(db, secret, { kind: "rfq", linkId: "LA" }, 1_000_000 + LINK_SESSION_TTL_MS - 1)).toMatchObject({ ok: true })
  })
})

describe("the per-mobile rate limit (G-17)", () => {
  const phone = "+966551234567"

  it("lets a mobile have its quota in an hour across every link and blocks the next attempt with a clear code", async () => {
    const results = []
    for (let i = 0; i < RATE_RULES.otp.max; i++) results.push(await consumeMobileRate(db, "otp", phone, 1_000))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results[results.length - 1]).toEqual({ ok: true, remaining: 0 })

    const blocked = await consumeMobileRate(db, "otp", phone, 2_000)
    expect(blocked).toEqual({ ok: false, code: "RATE_LIMITED", status: 429, retryAfterSec: 3599 })
    expect(await consumeMobileRate(db, "otp", "+966559999999", 2_000)).toMatchObject({ ok: true })
    expect(await consumeMobileRate(db, "write", phone, 2_000)).toMatchObject({ ok: true })
  })

  it("starts a new window after the hour", async () => {
    for (let i = 0; i < RATE_RULES.otp.max; i++) await consumeMobileRate(db, "otp", phone, 1_000)
    expect(await consumeMobileRate(db, "otp", phone, 1_000 + RATE_RULES.otp.windowMs)).toEqual({ ok: true, remaining: RATE_RULES.otp.max - 1 })
  })

  it("keeps the mobile out of the counter's document", async () => {
    await consumeMobileRate(db, "otp", phone, 1_000)
    expect(mockDb.list(LINK_RATE_LIMITS)).toHaveLength(1)
    expect(everything()).not.toContain("551234567")
  })

  it("fails closed when the counter cannot be used", async () => {
    const broken = { collection: () => ({ doc: () => ({}) }), runTransaction: async () => Promise.reject(new Error("unavailable")) } as unknown as Firestore
    expect(await consumeRate(broken, "otp:x", { max: 5, windowMs: 1000 })).toEqual({ ok: false, code: "RATE_UNAVAILABLE", status: 503 })
  })
})
