import {
  CR_WARN_DAYS,
  agreementOrderCounts,
  barWidth,
  directoryCounts,
  directoryFiltered,
  effectiveCrExpiry,
  effectiveVat,
  filterDirectory,
  inviteErrors,
  inviteJoinUrl,
  inviteMessage,
  isUnverified,
  mailtoLink,
  makeOrBuyKeys,
  materialCategory,
  materialPurchases,
  ordersOfSupplier,
  ordersOnAgreement,
  ourRatings,
  readByManufacturing,
  recordErrors,
  recordFields,
  rfqInviteFacts,
  segmentFromParam,
  starAverage,
  supplierDocs,
  supplierFactsWithRecord,
  supplierRecordId,
  usualLeadDays,
  verifyRefusal,
  visibleSupplierSegments,
  waLink,
  waPhone,
  type SupplierRecord,
} from "@/lib/procurement/supplier-file"
import { materialKey, type PriceHistoryEntry } from "@/lib/procurement/prices"
import type { PoLine, PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "حديد تسليح", unit: "طن", quantity: 10, unitPrice: 2500, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1",
  organizationId: "org",
  docNumber: "PO-2026/001",
  status: "accepted",
  basis: "rfq",
  rfqId: null,
  rfqTitle: "",
  offerId: null,
  projectId: null,
  supplierOrgId: "s1",
  supplierUserId: "s1",
  supplierName: "Supplier",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 25000,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: null,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "u1",
  preparedByName: "Buyer",
  createdAt: "2026-09-01T08:00:00.000Z",
  approverKind: "manager",
  log: [],
  ...over,
})

const record = (over: Partial<SupplierRecord> = {}): SupplierRecord => ({ id: "org__s1", organizationId: "org", supplierOrgId: "s1", supplierName: "S", ...over })

const manager = { isOwner: false, canApprove: true }
const buyer = { isOwner: false, canApprove: false }

describe("supplier record — ours over the profile", () => {
  it("keys the record by org and supplier", () => {
    expect(supplierRecordId("org", "s1")).toBe("org__s1")
  })

  it("prefers our VAT and CR, falls back to the profile", () => {
    expect(effectiveVat(record({ vatNumber: " 300000000000003 " }), "311111111111113")).toBe("300000000000003")
    expect(effectiveVat(record({ vatNumber: "" }), "311111111111113")).toBe("311111111111113")
    expect(effectiveVat(null, null)).toBe("")
    expect(effectiveCrExpiry(record({ crExpiry: "2027-01-01" }), "2026-01-01")).toBe("2027-01-01")
    expect(effectiveCrExpiry(null, "2026-01-01T00:00:00Z")).toBe("2026-01-01")
    expect(effectiveCrExpiry(null, null)).toBeNull()
  })

  it("only `verified: false` is unverified — a legacy record blocks nothing", () => {
    expect(isUnverified(record({ verified: false }))).toBe(true)
    expect(isUnverified(record({ verified: true }))).toBe(false)
    expect(isUnverified(record())).toBe(false)
    expect(isUnverified(null)).toBe(false)
  })

  it("lays the record over what an approval reads", () => {
    const facts = { orgId: "s1", hasVatNumber: false, verified: true, crExpiry: "2026-01-01" }
    expect(supplierFactsWithRecord(facts, null)).toEqual(facts)
    expect(supplierFactsWithRecord(facts, record({ vatNumber: "300000000000003", verified: false, crExpiry: "2027-05-01" }))).toEqual({ orgId: "s1", hasVatNumber: true, verified: false, crExpiry: "2027-05-01" })
    expect(supplierFactsWithRecord(facts, record())).toEqual(facts)
  })
})

describe("the status column (S-34)", () => {
  const today = "2026-09-28"
  it("an expired CR wins over everything", () => {
    expect(supplierDocs("", "2026-09-01", today)).toMatchObject({ state: "cr_expired", crDays: -27 })
  })
  it("no VAT before a CR about to end", () => {
    expect(supplierDocs("", "2026-10-10", today).state).toBe("no_vat")
  })
  it(`the CR ending within ${CR_WARN_DAYS} days is said, with its date`, () => {
    expect(supplierDocs("300000000000003", "2026-11-27", today)).toMatchObject({ state: "cr_ending", crExpiry: "2026-11-27", crDays: 60 })
    expect(supplierDocs("300000000000003", "2026-11-28", today).state).toBe("ok")
  })
  it("valid with a VAT number and no CR on file", () => {
    expect(supplierDocs("300000000000003", null, today).state).toBe("ok")
  })
})

describe("verifying (S-35)", () => {
  it("the manager verifies an unverified supplier with a VAT number", () => {
    expect(verifyRefusal(manager, record({ verified: false }), "300000000000003")).toBeNull()
    expect(verifyRefusal({ isOwner: true, canApprove: false }, record({ verified: false }), "300000000000003")).toBeNull()
  })
  it("a buyer may not", () => {
    expect(verifyRefusal(buyer, record({ verified: false }), "300000000000003")).toBe("no_permission")
  })
  it("not without the VAT number", () => {
    expect(verifyRefusal(manager, record({ verified: false }), " ")).toBe("no_vat")
  })
  it("nothing to verify on a verified or legacy supplier", () => {
    expect(verifyRefusal(manager, record({ verified: true }), "300000000000003")).toBe("not_pending")
    expect(verifyRefusal(manager, null, "300000000000003")).toBe("not_pending")
  })
})

describe("the record form", () => {
  const ok = { vatNumber: "300 000 000 000 003", crExpiry: "2027-01-01", paymentTermsDays: "30", leadTimeDays: "7", kind: "mat" as const }
  it("accepts a clean record and cleans it", () => {
    expect(recordErrors(ok)).toEqual([])
    expect(recordFields(ok)).toEqual({ vatNumber: "300000000000003", crExpiry: "2027-01-01", paymentTermsDays: 30, leadTimeDays: 7, kind: "mat" })
  })
  it("empty VAT, CR and lead are allowed; cash in advance is 0", () => {
    const blank = { vatNumber: "", crExpiry: "", paymentTermsDays: "", leadTimeDays: "", kind: "sub" as const }
    expect(recordErrors(blank)).toEqual([])
    expect(recordFields(blank)).toEqual({ vatNumber: null, crExpiry: null, paymentTermsDays: 0, leadTimeDays: null, kind: "sub" })
  })
  it("refuses a VAT number that is not Saudi-shaped, a bad lead time and an unknown kind", () => {
    expect(recordErrors({ ...ok, vatNumber: "123" })).toContain("vat_format")
    expect(recordErrors({ ...ok, leadTimeDays: "2.5" })).toContain("lead_invalid")
    expect(recordErrors({ ...ok, paymentTermsDays: "-1" })).toContain("terms_invalid")
    expect(recordErrors({ ...ok, kind: "x" as "mat" })).toContain("kind_invalid")
  })
})

describe("response to invitations (S-36)", () => {
  const rfqs = [
    { id: "r1", status: "New", allowedSupplierOrgIds: ["s1"] },
    { id: "r2", status: "Awarded", invitedSupplierOrgIds: ["member-of-s1"] },
    { id: "r3", status: "Draft", allowedSupplierOrgIds: ["s1"] },
    { id: "r4", status: "New", allowedSupplierOrgIds: ["s2"] },
    { id: "r5", status: "New", allowedSupplierOrgIds: [] },
  ]
  it("counts RFQs that named him — by the company or any of its accounts — and those he answered", () => {
    const offers = [
      { rfqId: "r1", organizationId: "s1" },
      { rfqId: "r1", organizationId: "s1" },
      { rfqId: "r4", organizationId: "s1" },
    ]
    expect(rfqInviteFacts("s1", ["member-of-s1"], rfqs, offers)).toEqual({ invited: 2, responded: 1 })
  })
  it("a draft invited nobody; an offer from a member counts", () => {
    expect(rfqInviteFacts("s1", ["member-of-s1"], rfqs, [{ rfqId: "r2", supplierId: "member-of-s1" }])).toEqual({ invited: 2, responded: 1 })
  })
})

describe("orders, ratings, agreements (S-35, S-37, S-43, S-44)", () => {
  const rating = { onTime: true, lateByDays: 0, inFull: true, rejectPercent: 0, conformity: 5, cooperation: 4, publishAnonymously: false, byId: "u", byName: "U" }
  const orders = [
    po({ id: "a", createdAt: "2026-09-01", agreementId: "ag1", rating: { ...rating, at: "2026-09-10" } }),
    po({ id: "b", createdAt: "2026-09-05", docNumber: "PO-2026/002", agreementId: "ag1" }),
    po({ id: "c", createdAt: "2026-09-03", supplierOrgId: "s2", agreementId: "ag2", rating: { ...rating, at: "2026-09-12" } }),
    po({ id: "d", createdAt: "2026-09-07", docNumber: "PO-2026/004", rating: { ...rating, at: "2026-09-20" } }),
  ]
  it("his orders, newest first", () => {
    expect(ordersOfSupplier(orders, "s1").map((o) => o.id)).toEqual(["d", "b", "a"])
  })
  it("our ratings of him, newest first", () => {
    expect(ourRatings(orders, "s1").map((r) => r.po.id)).toEqual(["d", "a"])
  })
  it("orders on each agreement", () => {
    expect(Object.fromEntries(agreementOrderCounts(orders))).toEqual({ ag1: 2, ag2: 1 })
    expect(ordersOnAgreement(orders, "ag1").map((o) => o.id)).toEqual(["b", "a"])
  })
  it("averages stars and draws bars honestly", () => {
    expect(starAverage([4, 5, 0])).toEqual({ avg: 4.5, n: 2 })
    expect(starAverage([])).toBeNull()
    expect(barWidth(null)).toBe(0)
    expect(barWidth(0)).toBe(4)
    expect(barWidth(140)).toBe(100)
  })
})

describe("a material (S-46, S-47)", () => {
  const key = materialKey("حديد تسليح", "طن")
  const h = (id: string, day: string, price: number): PriceHistoryEntry => ({ id, organizationId: "org", materialKey: key, name: "حديد تسليح", unit: "طن", supplierOrgId: "s1", supplierName: "S", price, day, kind: "po", poId: null, poNumber: null })
  it("the last purchases, newest first, at most ten", () => {
    const history = Array.from({ length: 12 }, (_, i) => h(`h${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`, 2000 + i))
    const got = materialPurchases(history, key)
    expect(got).toHaveLength(10)
    expect(got[0].id).toBe("h11")
  })
  it("usual lead time: the median of sent → last receipt over received orders", () => {
    const orders = [
      po({ id: "a", sentAt: "2026-09-01T00:00:00Z" }),
      po({ id: "b", sentAt: "2026-09-01T00:00:00Z" }),
      po({ id: "c", sentAt: "2026-09-01T00:00:00Z" }),
      po({ id: "x", lines: [line({ name: "أسمنت", unit: "كيس" })], sentAt: "2026-09-01T00:00:00Z" }),
    ]
    const receipts: ReceiptFact[] = [
      { id: "g1", poId: "a", status: "confirmed", deliveryDate: "2026-09-05" },
      { id: "g2", poId: "b", status: "confirmed", deliveryDate: "2026-09-08" },
      { id: "g3", poId: "c", status: "confirmed", deliveryDate: "2026-09-11" },
      { id: "g4", poId: "x", status: "confirmed", deliveryDate: "2026-09-30" },
    ] as ReceiptFact[]
    expect(usualLeadDays(orders, receipts, key)).toBe(7)
  })
  it("falls back to what the offers promised, then to nothing", () => {
    expect(usualLeadDays([po({ leadTimeDays: 4 }), po({ id: "b", leadTimeDays: 6 })], [], key)).toBe(5)
    expect(usualLeadDays([po()], [], key)).toBeNull()
  })
  it("category from the last order that named one", () => {
    expect(materialCategory([po({ category: "حديد ومعادن", createdAt: "2026-01-01" }), po({ id: "b", category: null, createdAt: "2026-02-01" })], key)).toBe("حديد ومعادن")
    expect(materialCategory([po()], key)).toBeNull()
  })
  it("marks the materials Manufacturing also makes, folded", () => {
    const keys = makeOrBuyKeys(["رخام كرّارة", null, "  "])
    expect(readByManufacturing(keys, "رخام كرّارة")).toBe(true)
    expect(readByManufacturing(keys, "حديد")).toBe(false)
  })
})

describe("the platform directory (S-40, S-41)", () => {
  const entries = [
    { orgId: "a", name: "مؤسسة الأفق", city: "الرياض", categories: ["حديد ومعادن"] },
    { orgId: "b", name: "Gulf Steel", city: "الدمام", categories: ["حديد ومعادن", "أسمنت وخرسانة"] },
    { orgId: "c", name: "حجر نجد", city: "الرياض", categories: ["أرضيات وتشطيبات"] },
  ]
  it("filters by category, city and every search word, Arabic-folded", () => {
    expect(filterDirectory(entries, { q: "", category: "حديد ومعادن", city: "" }).map((e) => e.orgId)).toEqual(["a", "b"])
    expect(filterDirectory(entries, { q: "", category: "حديد ومعادن", city: "الرياض" }).map((e) => e.orgId)).toEqual(["a"])
    expect(filterDirectory(entries, { q: "افق", category: "", city: "" }).map((e) => e.orgId)).toEqual(["a"])
    expect(filterDirectory(entries, { q: "steel", category: "", city: "" }, (c) => (c === "حديد ومعادن" ? "Steel" : c)).map((e) => e.orgId)).toEqual(["a", "b"])
  })
  it("counts each option over the whole directory", () => {
    const c = directoryCounts(entries)
    expect(c.categories[0]).toEqual(["حديد ومعادن", 2])
    expect(Object.fromEntries(c.cities)).toEqual({ الرياض: 2, الدمام: 1 })
  })
  it("knows when a filter is on", () => {
    expect(directoryFiltered({ q: " ", category: "", city: "" })).toBe(false)
    expect(directoryFiltered({ q: "", category: "", city: "x" })).toBe(true)
  })
})

describe("invitations (S-38, S-39)", () => {
  it("normalises a Saudi mobile for wa.me", () => {
    expect(waPhone("0501234567")).toBe("966501234567")
    expect(waPhone("+966 50 123 4567")).toBe("966501234567")
    expect(waPhone("00966501234567")).toBe("966501234567")
    expect(waPhone("501234567")).toBe("966501234567")
    expect(waPhone("٠٥٠١٢٣٤٥٦٧")).toBe("966501234567")
  })
  it("builds the links with the text encoded", () => {
    expect(waLink("0501234567", "a b")).toBe("https://wa.me/966501234567?text=a%20b")
    expect(mailtoLink("x@y.com", "S", "B & C")).toBe("mailto:x%40y.com?subject=S&body=B%20%26%20C")
    expect(inviteJoinUrl("https://mdmaktech.sa/", "abc")).toBe("https://mdmaktech.sa/register?invite=abc")
  })
  it("puts the sender's note before the fixed sentence", () => {
    expect(inviteMessage("  hi ", "join: url")).toBe("hi\n\njoin: url")
    expect(inviteMessage("", "join: url")).toBe("join: url")
  })
  it("the channel decides which contact is required", () => {
    expect(inviteErrors({ companyName: "", phone: "", email: "", channel: "wa" })).toEqual(["name_missing", "phone_missing"])
    expect(inviteErrors({ companyName: "X", phone: "0501234567", email: "", channel: "wa" })).toEqual([])
    expect(inviteErrors({ companyName: "X", phone: "", email: "", channel: "email" })).toEqual(["email_missing"])
    expect(inviteErrors({ companyName: "X", phone: "", email: "nope", channel: "email" })).toEqual(["email_invalid"])
    expect(inviteErrors({ companyName: "X", phone: "12", email: "a@b.co", channel: "email" })).toEqual(["phone_invalid"])
  })
})

describe("price segments are for those who see prices (S-31)", () => {
  it("hides agreements and history from a viewer without prices", () => {
    expect(visibleSupplierSegments(false)).toEqual(["mine", "platform"])
    expect(visibleSupplierSegments(true)).toEqual(["mine", "platform", "agreements", "history"])
  })
  it("guards ?segment=", () => {
    expect(segmentFromParam("agreements", false)).toBe("mine")
    expect(segmentFromParam("history", false)).toBe("mine")
    expect(segmentFromParam("agreements", true)).toBe("agreements")
    expect(segmentFromParam("platform", false)).toBe("platform")
    expect(segmentFromParam("nonsense", true)).toBe("mine")
    expect(segmentFromParam(null, true)).toBe("mine")
  })
})
