/** @jest-environment node */
/**
 * Procurement 2.0 — what a link shows is its own, seen through the eyes of EVERY visitor (QA pack 3/5, B-06, B-07, B-14; QA pack 4/5, G-06, G-17):
 * the RFQ's visitor link, each off-platform bidder's own offer page and each order's link carry no other supplier's name, mobile, price or
 * order number; an answer «للجميع» is read without who asked; every token is 22 characters, unique, and stored only as a hash;
 * a cancelled order's link takes no act. One world, read once per identity — the packs' «نظيف بعين كل زائر».
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t.replace(/^tok:/, "") }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ name: "b", file: () => ({ save: async () => undefined }) }) }),
  getStorageBucketName: () => "b",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => xs, serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1), permissionHolders: jest.fn(async () => []) }))
jest.mock("@/lib/org-identity-admin", () => ({ resolveIdentityAdmin: async (_db: unknown, _uid: string, base: unknown) => base }))
jest.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }), buildRfqShareEmail: () => ({ subject: "s", html: "h" }), buildGuestOfferReceiptEmail: () => ({ subject: "s", html: "h" }) }))
jest.mock("@/lib/sms", () => ({ canSendCodes: () => true, isVerifyConfigured: () => false, isSmsConfigured: () => true, sendSms: async () => ({ sent: true }), startVerification: async () => ({ sent: true }) }))
jest.mock("@/lib/otp", () => ({ OTP_CHALLENGES: "otpChallenges", maskPhone: (p: string) => p, issueOtp: async () => ({ challengeId: "ch1", code: "123456" }), issueRemoteOtp: async () => ({ challengeId: "ch1" }), verifyOtp: async () => "ok" }))

import { POST as createLink } from "@/app/api/rfq-share/create/route"
import { GET as visitorView } from "@/app/api/rfq-share/[token]/route"
import { GET as guestOfferView } from "@/app/api/guest-offer/[token]/route"
import { GET as poView } from "@/app/api/po-link/[token]/route"
import { POST as poAccept } from "@/app/api/po-link/[token]/accept/route"
import { POST as poReport } from "@/app/api/po-link/[token]/report-delivery/route"
import { POST as poReply } from "@/app/api/po-link/[token]/reply/route"
import { GET as previewRoute } from "@/app/api/rfq-share/preview/route"
import { POST as cancelRoute } from "@/app/api/procurement/po/cancel/route"
import { createGuestOfferLink } from "@/lib/guest-offer"
import { mintOrderLink } from "@/lib/procurement/po-link-server"
import { createInquiry, runInquiry, inquirySchema, type InquiryInput } from "@/lib/procurement/rfq-server/inquiry"
import { hashToken } from "@/lib/links/hash"
import type { PurchaseOrder } from "@/lib/procurement/types"

type Doc = Record<string, any>
const ORG = "org1"
const FUTURE = "2099-12-31"
const NOW = new Date("2026-10-22T09:00:00Z")
jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] })
const ctx = (token: string) => ({ params: Promise.resolve({ token }) })
const tokenOf = (url: string) => url.split("/").pop() as string
const everything = () => JSON.stringify([...mockDb.docs])
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/

const BIDDERS = {
  platform: { name: "مصنع النور", phone: "+966550000001", price: "35123" },
  guest1: { name: "مؤسسة الرمال للتجارة", phone: "+966551110001", price: "41117" },
  guest2: { name: "شركة الوادي للمقاولات", phone: "+966552220002", price: "38219" },
} as const

let rfqToken = ""
const offerLinks: Record<"guest1" | "guest2", string> = { guest1: "", guest2: "" }
const orderLinks: Record<"po1" | "po2", string> = { po1: "", po2: "" }

const orderDoc = (n: number, supplier: string, total: number, over: Doc = {}) => ({
  organizationId: ORG,
  docNumber: `PO-2026/0${n}`,
  status: "sent",
  basis: "rfq",
  rfqId: "R1",
  rfqTitle: "رمل وإسمنت",
  offerId: `o${n}`,
  supplierOrgId: "guest",
  supplierUserId: null,
  supplierName: supplier,
  isGuestSupplier: true,
  lines: [{ id: "l1", name: "رمل أحمر", unit: "م³", quantity: 20, unitPrice: total / 20, accepted: 0, rejected: 0, held: 0, cancelled: 0 }],
  totalExVat: total,
  vatRate: 0.15,
  preparedById: "prep",
  preparedByName: "سعد المشتري",
  approvedById: "mgr",
  approvedByName: "منى المعتمدة",
  approvedAt: "2026-10-11T08:00:00Z",
  sentAt: "2026-10-12T08:00:00Z",
  sentChannel: "whatsapp",
  dueDate: "2026-10-30",
  paymentTerms: "30 يوماً",
  tags: { notLowest: { why: "سرعة التوريد" } },
  log: [],
  createdAt: "2026-10-10T08:00:00Z",
  ...over,
})

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://uat.mdmaktech.sa"
})
afterAll(() => {
  delete process.env.NEXT_PUBLIC_APP_URL
})

beforeEach(async () => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, { [ORG]: { uid: ORG, orgId: ORG, name: "المالك", can: () => true } })
  mockDb.seed(`users/${ORG}`, { role: "Contractor", organizationId: ORG, name: "المالك", companyName: "البنيان الحديثة" })
  mockDb.seed("users/prep", { organizationId: ORG })
  mockDb.seed("rfqs/R1", {
    organizationId: ORG,
    contractorId: ORG,
    createdByUserId: ORG,
    status: "New",
    title: "رمل وإسمنت",
    rfqNumber: "RFQ-2026/011",
    deadline: FUTURE,
    city: "الرياض",
    district: "السلي",
    locationCoords: { lat: 24.7136, lng: 46.6753 },
    pricingMode: "total",
    products: [{ name: "رمل أحمر", quantity: 20, unitOfMeasure: "م³" }],
    invitedSupplierOrgIds: ["supA"],
    log: [],
  })
  mockDb.seed("offers/oA", { rfqId: "R1", contractorOrgId: ORG, organizationId: "supA", supplierId: "ua", companyName: BIDDERS.platform.name, price: BIDDERS.platform.price, status: "قيد المراجعة", contactPhone: BIDDERS.platform.phone, versions: [{ n: 1 }], rev: 1 })
  mockDb.seed("offers/oG1", { rfqId: "R1", contractorOrgId: ORG, organizationId: "guest", supplierId: "guest", isGuestOffer: true, companyName: BIDDERS.guest1.name, supplierName: BIDDERS.guest1.name, price: BIDDERS.guest1.price, guestContact: { phone: BIDDERS.guest1.phone }, status: "قيد المراجعة", versions: [{ n: 1 }], rev: 1 })
  mockDb.seed("offers/oG2", { rfqId: "R1", contractorOrgId: ORG, organizationId: "guest", supplierId: "guest", isGuestOffer: true, companyName: BIDDERS.guest2.name, supplierName: BIDDERS.guest2.name, price: BIDDERS.guest2.price, guestContact: { phone: BIDDERS.guest2.phone }, status: "قيد المراجعة", versions: [{ n: 1 }], rev: 1 })
  mockDb.seed("users/ua", { role: "Supplier", organizationId: "supA", name: "سامي" })

  const minted = await createLink(new NextRequest("http://localhost/api/rfq-share/create", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tok:${ORG}` }, body: JSON.stringify({ rfqId: "R1" }) }))
  rfqToken = tokenOf(((await minted.json()) as { data: { url: string } }).data.url)
  offerLinks.guest1 = (await createGuestOfferLink({ offerId: "oG1", rfqId: "R1", contractorId: ORG })).token
  offerLinks.guest2 = (await createGuestOfferLink({ offerId: "oG2", rfqId: "R1", contractorId: ORG })).token

  const asked = await createInquiry(mockDb as never, { rfq: { ...(mockDb.get("rfqs/R1") as Doc), id: "R1" } as never, question: "هل التسليم شامل التنزيل؟", asker: { kind: "visitor", anon: false, name: BIDDERS.guest1.name, phone: BIDDERS.guest1.phone } as never, at: NOW.toISOString() })
  await runInquiry(mockDb as never, { uid: ORG, name: "المالك", orgId: ORG, can: () => true } as never, inquirySchema.parse({ action: "answer", rfqId: "R1", inquiryId: asked.id, text: "نعم، شامل التنزيل.", scope: "all" }) as InquiryInput, NOW)

  mockDb.seed("purchaseOrders/po1", orderDoc(14, "مؤسسة الرمال للتجارة", 1760))
  mockDb.seed("purchaseOrders/po2", orderDoc(15, "شركة الوادي للمقاولات", 987654))
  for (const id of ["po1", "po2"] as const) orderLinks[id] = tokenOf((await mintOrderLink(mockDb as never, { id, organizationId: ORG } as PurchaseOrder)) as string)
})

const text = async (res: Response) => JSON.stringify(await res.json())

describe("B-06 / G-06 — no visitor ever reads another supplier's name, mobile or price", () => {
  const read = {
    rfqLink: async () => text(await visitorView(new NextRequest(`http://localhost/api/rfq-share/${rfqToken}`), ctx(rfqToken))),
    guest1: async () => text(await guestOfferView(new NextRequest(`http://localhost/api/guest-offer/${offerLinks.guest1}`), ctx(offerLinks.guest1))),
    guest2: async () => text(await guestOfferView(new NextRequest(`http://localhost/api/guest-offer/${offerLinks.guest2}`), ctx(offerLinks.guest2))),
  }
  const OWN: Record<keyof typeof read, Array<keyof typeof BIDDERS>> = { rfqLink: [], guest1: ["guest1"], guest2: ["guest2"] }

  it.each(Object.keys(read) as Array<keyof typeof read>)("through the eyes of «%s»", async (who) => {
    const seen = await read[who]()
    expect(seen.length).toBeGreaterThan(50)
    for (const [key, b] of Object.entries(BIDDERS)) {
      if (OWN[who].includes(key as keyof typeof BIDDERS)) continue
      expect(seen).not.toContain(b.name)
      expect(seen).not.toContain(b.phone)
      expect(seen).not.toContain(b.price)
    }
    expect(seen).not.toContain("24.7136")
    expect(seen).not.toContain("46.6753")
  })

  it("a guest reads his OWN offer on his page, and only it", async () => {
    const seen = await read.guest1()
    expect(seen).toContain(BIDDERS.guest1.name)
    expect(seen).toContain(BIDDERS.guest1.price)
  })
})

describe("B-07 — an answer «للجميع» is read without who asked", () => {
  it("the visitor link carries the question and the answer, never the asker's name or mobile", async () => {
    const seen = await text(await visitorView(new NextRequest(`http://localhost/api/rfq-share/${rfqToken}`), ctx(rfqToken)))
    expect(seen).toContain("هل التسليم شامل التنزيل؟")
    expect(seen).toContain("نعم، شامل التنزيل.")
    expect(seen).not.toContain(BIDDERS.guest1.name)
    expect(seen).not.toContain(BIDDERS.guest1.phone)
  })
})

describe("B-14 — an order link carries its own order and nothing of another", () => {
  const view = async (token: string) => text(await poView(new NextRequest(`http://localhost/api/po-link/${token}`), ctx(token)))

  it("order 14's page has 2026/014 and its supplier's lines; not 2026/015, its supplier, its total, nor who prepared or approved it, nor why it is not the lowest", async () => {
    const seen = await view(orderLinks.po1)
    expect(seen).toContain("2026/014")
    expect(seen).not.toContain("2026/015")
    expect(seen).not.toContain("شركة الوادي")
    expect(seen).not.toContain("987654")
    expect(seen).not.toContain("سعد المشتري")
    expect(seen).not.toContain("منى المعتمدة")
    expect(seen).not.toContain("سرعة التوريد")
  })

  it("and the other way round", async () => {
    const seen = await view(orderLinks.po2)
    expect(seen).toContain("2026/015")
    expect(seen).not.toContain("2026/014")
    expect(seen).not.toContain("مؤسسة الرمال")
  })
})

describe("G-17 — a link is a permission with one scope", () => {
  it("every token is 22 characters and unique, and only hashes are stored", () => {
    const tokens = [rfqToken, offerLinks.guest1, offerLinks.guest2, orderLinks.po1, orderLinks.po2]
    for (const t of tokens) expect(t).toMatch(TOKEN_RE)
    expect(new Set(tokens).size).toBe(tokens.length)
    const stored = everything()
    for (const t of tokens) {
      expect(stored).not.toContain(t)
      expect(mockDb.get(`linkTokens/${hashToken(t)}`)).toBeTruthy()
    }
  })

  it("a token opens only its own scope: an order token is not an RFQ link and the reverse", async () => {
    expect((await visitorView(new NextRequest(`http://localhost/api/rfq-share/${orderLinks.po1}`), ctx(orderLinks.po1))).status).toBeGreaterThanOrEqual(400)
    expect((await poView(new NextRequest(`http://localhost/api/po-link/${rfqToken}`), ctx(rfqToken))).status).toBeGreaterThanOrEqual(400)
  })

  it("R-22 — a cancelled order's link shows it cancelled and takes no act", async () => {
    const cancelled = await cancelRoute(new NextRequest("http://localhost/api/procurement/po/cancel", { method: "POST", headers: { authorization: `Bearer ${ORG}`, "content-type": "application/json" }, body: JSON.stringify({ poId: "po1", why: "need", then: "none" }) }))
    expect(cancelled.status).toBe(200)
    const tok = orderLinks.po1
    const post = (route: (r: NextRequest, c: ReturnType<typeof ctx>) => Promise<Response>, body: unknown) => route(new NextRequest(`http://localhost/api/po-link/${tok}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(tok))
    const page = (await (await poView(new NextRequest(`http://localhost/api/po-link/${tok}`), ctx(tok))).json()) as { data: { view: Doc } }
    expect(page.data.view.state).toBe("cancelled")
    expect(Object.values(page.data.view.acts).every((v) => v === false)).toBe(true)
    for (const [route, body] of [[poAccept, {}], [poReport, { offset: 0 }], [poReply, { text: "مرحبا" }]] as const) expect((await post(route as never, body)).status).toBe(409)
  })
})

describe("B-10 / R-21 — the buyer's preview creates nothing and counts nothing", () => {
  it("opening the visitor page as the buyer writes no document and leaves the link's counters alone; the visitor's own open is counted once per browser", async () => {
    const link = () => JSON.stringify(mockDb.list("rfqShareLinks"))
    const before = link()
    mockDb.writes.length = 0
    const res = await previewRoute(new NextRequest("http://localhost/api/rfq-share/preview?rfqId=R1", { headers: { authorization: `Bearer ${ORG}` } }))
    expect(res.status).toBe(200)
    expect(mockDb.writes).toHaveLength(0)
    expect(link()).toBe(before)

    const viewer = "v".repeat(16)
    await visitorView(new NextRequest(`http://localhost/api/rfq-share/${rfqToken}?v=${viewer}`), ctx(rfqToken))
    const after = link()
    expect(after).not.toBe(before)
    await visitorView(new NextRequest(`http://localhost/api/rfq-share/${rfqToken}?v=${viewer}`), ctx(rfqToken))
    expect(link()).toBe(after)
  })
})
