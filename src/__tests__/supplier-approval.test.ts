/**
 * Supplier onboarding (owner, 18 Oct 2026): every supplier company uploads its commercial registration and its tax
 * registration certificate and is approved by the platform admin before it sends a quotation — from any screen. The
 * free plan's monthly allowance is the admin's setting, off by default. Runs the real server code over an in-memory
 * Admin Firestore, and reads the rules that keep the approval the admin's alone.
 */

import fs from "fs"
import path from "path"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import { approvalState, missingApprovalDocs, monthlyLimitOf, quoteCountId, riyadhMonth } from "@/lib/supplier-approval"
import { createSupplierOffer, SupplierOfferError, BUYER_OFFER_KEYS } from "@/lib/supplier-offer-server"
import { monthlyLimitFor, quoteUsage } from "@/lib/supplier-approval-server"
import { QuoteActError, quoteActSchema, runQuoteAct, type QuoteAct, type QuoteSupplier } from "@/lib/supplier-free/server-quote-acts"

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1), permissionHolders: jest.fn(async () => []) }))

type Doc = Record<string, unknown>
const FILE = { url: "https://files/x.pdf", name: "x.pdf" }
// 2026-10-13 09:00 in Riyadh.
const NOW = new Date("2026-10-13T06:00:00Z")

describe("approvalState — what the account page and the screens show", () => {
  it("is approved only by the admin's isVerified, whatever the documents", () => {
    expect(approvalState({ isVerified: true })).toBe("approved")
    expect(approvalState({ isVerified: false, verificationRequested: true, legalDocuments: { cr: FILE, vat: FILE } })).toBe("pending")
  })
  it("needs BOTH the commercial registration and the tax certificate before it can be sent for review", () => {
    expect(approvalState({ legalDocuments: { cr: FILE } })).toBe("missing")
    expect(missingApprovalDocs({ cr: FILE, addr: FILE, iban: FILE })).toEqual(["vat"])
    expect(approvalState({ legalDocuments: { cr: FILE, vat: FILE } })).toBe("ready")
    // A request with a document missing is not "pending": the admin has nothing to approve.
    expect(approvalState({ verificationRequested: true, legalDocuments: { cr: FILE } })).toBe("missing")
    // Older accounts stored a bare address.
    expect(missingApprovalDocs({ cr: "https://a", vat: " " })).toEqual(["vat"])
  })
})

describe("the monthly allowance", () => {
  it("reads a stored limit safely and counts by Riyadh month", () => {
    expect(monthlyLimitOf(30)).toBe(30)
    for (const bad of [null, undefined, 0, -3, 2.5, "x", 5000]) expect(monthlyLimitOf(bad)).toBeNull()
    expect(riyadhMonth(new Date("2026-10-31T22:00:00Z"))).toBe("2026-11")
    expect(riyadhMonth(new Date("2026-10-31T20:00:00Z"))).toBe("2026-10")
  })
  it("applies to free companies only, and only when the admin set one", async () => {
    const db = new FakeAdminDb()
    expect(await monthlyLimitFor(db as never, "sup")).toBeNull()
    db.seed("platformSettings/supplierQuota", { freeMonthlyQuotes: 30 })
    expect(await monthlyLimitFor(db as never, "sup")).toBe(30) // no plan document = free
    db.seed("companyPlans/full1", { supplierPlan: "full" })
    expect(await monthlyLimitFor(db as never, "full1")).toBeNull()
    db.seed(`supplierQuoteCounts/${quoteCountId("sup", "2026-10")}`, { count: 7 })
    expect(await quoteUsage(db as never, "sup", NOW)).toEqual({ month: "2026-10", used: 7, limit: 30 })
    expect(await quoteUsage(db as never, "full1", NOW)).toMatchObject({ used: 0, limit: null })
  })
})

// ---- The free journey's new quote -------------------------------------------------------------------------------------

const rfq = (over: Doc = {}): Doc => ({
  organizationId: "con",
  contractorId: "con",
  title: "بلوك",
  category: "طوب وبلوك",
  city: "الرياض",
  status: "New",
  visibility: "public",
  pricingMode: "line",
  deadline: "2026-10-20",
  products: [{ name: "بلوك مفرغ", quantity: 100, unitOfMeasure: "حبة" }],
  offersCount: 0,
  ...over,
})
const SUP: QuoteSupplier = { uid: "su", name: "Sami", orgId: "sup", company: "Al Noor", field: { specs: ["طوب وبلوك"], cities: ["الرياض"] }, vatRate: 0.15, approved: true }
const newQuote = (db: FakeAdminDb, s: QuoteSupplier) =>
  runQuoteAct(db as never, s, quoteActSchema.parse({ action: "quote.new", rfqId: "r1", values: { prices: { i1: "2.5" }, skip: {}, total: "", arrive: "", valid: "2026-10-27", note: "" } }) as QuoteAct, NOW)
const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof QuoteActError || e instanceof SupplierOfferError ? e.code : String(e)))

describe("free journey — quote.new", () => {
  it("refuses a company the admin has not approved, and writes nothing", async () => {
    const db = new FakeAdminDb()
    db.seed("rfqs/r1", rfq())
    expect(await code(newQuote(db, { ...SUP, approved: false }))).toBe("not_approved")
    expect(db.list("offers")).toHaveLength(0)
  })
  it("counts each new quote of the month and stops at the free limit", async () => {
    const db = new FakeAdminDb()
    db.seed("rfqs/r1", rfq())
    db.seed("rfqs/r2", rfq())
    expect(await code(newQuote(db, { ...SUP, monthlyLimit: 2 }))).toBeNull()
    expect(db.get(`supplierQuoteCounts/${quoteCountId("sup", "2026-10")}`)).toMatchObject({ count: 1, orgId: "sup" })
    db.seed(`supplierQuoteCounts/${quoteCountId("sup", "2026-10")}`, { count: 2 })
    const r2 = runQuoteAct(db as never, { ...SUP, monthlyLimit: 2 }, quoteActSchema.parse({ action: "quote.new", rfqId: "r2", values: { prices: { i1: "2.5" }, skip: {}, total: "", arrive: "", valid: "2026-10-27", note: "" } }) as QuoteAct, NOW)
    expect(await code(r2)).toBe("quota")
  })
})

// ---- The full portal, the AI assistant and the mobile app --------------------------------------------------------------

const COMPANY = { uid: "su", name: "Sami", orgId: "sup", company: "Al Noor", approved: true }

describe("/api/supplier/offers — createSupplierOffer", () => {
  it("writes the quote in HIS company's name, born under review, with the RFQ's own parties", async () => {
    const db = new FakeAdminDb()
    db.seed("rfqs/r1", rfq({ title: "Blocks", projectId: "p1" }))
    const body = { price: "400", deliveryBatches: [{ location: "x" }], supplierId: "someone-else", organizationId: "other", contractorOrgId: "evil", status: "مقبول", outcome: "won", directAward: true, versions: [] }
    const { id } = await createSupplierOffer(db as never, COMPANY, "r1", body, { now: NOW })
    const saved = db.get(`offers/${id}`) as Doc
    expect(saved).toMatchObject({ supplierId: "su", organizationId: "sup", status: "قيد المراجعة", contractorOrgId: "con", contractorId: "con", rfqTitle: "Blocks", projectId: "p1", price: "400" })
    for (const k of BUYER_OFFER_KEYS) expect(saved).not.toHaveProperty(k)
    expect(db.get("rfqs/r1")?.offersCount).toBe(1)
  })
  it("refuses an unapproved company, a closed or missing request, and a full month", async () => {
    const db = new FakeAdminDb()
    db.seed("rfqs/r1", rfq())
    db.seed("rfqs/closed", rfq({ status: "Awarded" }))
    expect(await code(createSupplierOffer(db as never, { ...COMPANY, approved: false }, "r1", { price: "1" }, { now: NOW }))).toBe("not_approved")
    expect(await code(createSupplierOffer(db as never, COMPANY, "closed", { price: "1" }, { now: NOW }))).toBe("rfq_closed")
    expect(await code(createSupplierOffer(db as never, COMPANY, "nope", { price: "1" }, { now: NOW }))).toBe("rfq_missing")
    db.seed(`supplierQuoteCounts/${quoteCountId("sup", "2026-10")}`, { count: 30 })
    expect(await code(createSupplierOffer(db as never, COMPANY, "r1", { price: "1" }, { monthlyLimit: 30, now: NOW }))).toBe("quota")
    expect(db.list("offers")).toHaveLength(0)
  })
  it("keeps the server's list of buyer keys equal to the rules'", () => {
    const rules = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8")
    const list = rules.match(/function buyerOfferKeys\(\) \{\s*return \[([^\]]*)\]/)?.[1] || ""
    expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...BUYER_OFFER_KEYS])
  })
})

describe("the rules keep the approval the admin's", () => {
  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8")
  const block = (name: string) => rules.slice(rules.indexOf(`match /${name}/`), rules.indexOf("\n    }\n", rules.indexOf(`match /${name}/`)))
  it("a user never sets isVerified on himself — only the admin's branch may change it", () => {
    expect(block("users")).toContain("'procurementCategories', 'isVerified'])")
  })
  it("a company is never born approved nor approves itself", () => {
    const org = block("organizations")
    expect(org).toContain("!rd().keys().hasAny(['isVerified'])")
    expect(org).toContain("!changedKeys().hasAny(['isVerified'])")
  })
  it("no browser branch lets a supplier create a quote", () => {
    const create = block("offers").match(/allow create: if ([\s\S]*?);\n/)?.[1] || ""
    expect(create).not.toMatch(/isSupplier\(\)/)
  })
})
