/**
 * Procurement PRD 3.0 — the award as the offers screen decides it: when a
 * reason is mandatory (prices stored as strings, numbers, "12,500"; rejected
 * offers out of the comparison), what the dialog reviews, the exclusion and
 * award-reason payloads written beside the unchanged status literals.
 */

import {
  AWARD_REASON_MIN_TEXT,
  EXCLUSION_CODES,
  awardReasonRequired,
  awardReasonSchema,
  awardSupplierOrgId,
  awardTotal,
  buildAwardReason,
  buildExclusion,
  competingOffers,
  isExclusionCode,
  parseAwardReason,
  reviewAward,
  supplierFactsFromProfile,
} from "@/lib/procurement/award"
import { DEFAULT_POLICIES } from "@/lib/procurement/types"

const NOW = new Date("2026-09-22T09:00:00+03:00")

const offers = [
  { id: "a", price: "12000", status: "قيد المراجعة" },
  { id: "b", price: 11500, status: "قيد المراجعة" }, // an Mdmak-style numeric price
  { id: "c", price: "9,900", status: "مرفوض" }, // rejected — the lowest figure, out of the running
  { id: "d", price: "13,250", status: "مطلوب تخفيض" },
]

describe("competingOffers", () => {
  it("drops rejected offers and nothing else", () => {
    expect(competingOffers(offers).map((o) => o.id)).toEqual(["a", "b", "d"])
  })
})

describe("awardReasonRequired", () => {
  it("is false for the lowest live price, whatever its type", () => {
    expect(awardReasonRequired(offers[1], offers)).toBe(false)
  })
  it("is true above the lowest live price", () => {
    expect(awardReasonRequired(offers[0], offers)).toBe(true)
    expect(awardReasonRequired(offers[3], offers)).toBe(true)
  })
  it("ignores a rejected offer's lower price", () => {
    // Without c the lowest is b (11,500); a at 12,000 still needs one — but
    // if only c were cheaper, no reason would be asked.
    expect(awardReasonRequired({ id: "b", price: 11500 }, [offers[1], offers[2]])).toBe(false)
  })
  it("never asks with a single offer or with no usable price", () => {
    expect(awardReasonRequired(offers[0], [offers[0]])).toBe(false)
    expect(awardReasonRequired({ id: "x", price: "" }, offers)).toBe(false)
  })
})

describe("awardReasonSchema / parseAwardReason", () => {
  it("accepts a coded reason with no text", () => {
    expect(parseAwardReason("delivery_time", "")).toEqual({ code: "delivery_time", text: null })
  })
  it("keeps a note on a coded reason", () => {
    expect(parseAwardReason("quality", "  matches the approved sample  ")).toEqual({ code: "quality", text: "matches the approved sample" })
  })
  it("requires at least 8 characters for `other`", () => {
    expect(parseAwardReason("other", "short")).toBeNull()
    expect(awardReasonSchema.safeParse({ code: "other", text: "1234567" }).success).toBe(false)
    expect(parseAwardReason("other", "the only one with stock ready")).toEqual({ code: "other", text: "the only one with stock ready" })
    expect(AWARD_REASON_MIN_TEXT).toBe(8)
  })
  it("refuses an unknown or missing code", () => {
    expect(parseAwardReason("cheap", "")).toBeNull()
    expect(parseAwardReason(null, "")).toBeNull()
  })
})

describe("buildAwardReason", () => {
  it("stamps who and when beside the code", () => {
    expect(buildAwardReason({ code: "payment_terms", text: " net 60 " }, "u1", "2026-09-22T06:00:00.000Z")).toEqual({ code: "payment_terms", text: "net 60", byId: "u1", at: "2026-09-22T06:00:00.000Z" })
    expect(buildAwardReason({ code: "availability" }, "u1", "t").text).toBeNull()
  })
})

describe("awardTotal / awardSupplierOrgId", () => {
  it("prefers the summed batches, else the parsed price", () => {
    expect(awardTotal({ price: "1,000", totalBatchesPrice: 2500 })).toBe(2500)
    expect(awardTotal({ price: "1,000" })).toBe(1000)
    expect(awardTotal({ price: null })).toBeNull()
  })
  it("names the supplier's org, never a guest's", () => {
    expect(awardSupplierOrgId({ isGuestOffer: true, supplierId: "guest", organizationId: "guest" })).toBeNull()
    expect(awardSupplierOrgId({ supplierId: "u9", organizationId: "org9" })).toBe("org9")
    expect(awardSupplierOrgId({ supplierId: "u9" })).toBe("u9")
    expect(awardSupplierOrgId({ supplierId: "mdmak-system", organizationId: null })).toBeNull()
  })
})

describe("reviewAward", () => {
  const policies = { ...DEFAULT_POLICIES, competitionThreshold: 10_000, minOffers: 3 }
  it("shows this price against the lowest live one and asks for a reason", () => {
    const r = reviewAward({ id: "a", price: "12000", status: "قيد المراجعة", offerPdfUrl: "x.pdf" }, offers, policies, null, NOW)
    expect(r.thisPrice).toBe(12000)
    expect(r.lowestPrice).toBe(11500)
    expect(r.competing).toBe(3)
    expect(r.needsReason).toBe(true)
    expect(r.shortCompetition).toBe(false) // three still competing
    expect(r.noOfficialQuote).toBe(false)
    expect(r.guest).toBe(false)
    expect(r.blocks).toEqual([])
  })
  it("flags short competition and a missing official quote as notes", () => {
    const two = [offers[0], offers[1]]
    const r = reviewAward({ id: "a", price: "12000" }, two, policies, null, NOW)
    expect(r.shortCompetition).toBe(true)
    expect(r.noOfficialQuote).toBe(true)
  })
  it("lists what will stop the order's approval from the supplier's facts", () => {
    const r = reviewAward({ id: "b", price: 11500, supplierId: "u2", organizationId: "org2" }, offers, policies, { orgId: "org2", hasVatNumber: false, verified: false, crExpiry: "2026-09-01" }, NOW)
    expect(r.blocks.map((b) => b.code)).toEqual(["supplier_cr_expired", "supplier_unverified", "supplier_no_vat"])
  })
  it("never blocks a guest (no record to fail) but says so", () => {
    const r = reviewAward({ id: "g", price: "9000", isGuestOffer: true, supplierId: "guest" }, [...offers, { id: "g", price: "9000" }], policies, { orgId: "guest", hasVatNumber: false, verified: false, crExpiry: null }, NOW)
    expect(r.guest).toBe(true)
    expect(r.blocks).toEqual([])
    expect(r.needsReason).toBe(false)
  })
})

describe("supplierFactsFromProfile", () => {
  it("reads VAT, verification and CR expiry like the approval does", () => {
    expect(supplierFactsFromProfile("o1", { taxNumber: " 3001 ", isVerified: true, legalDocuments: { cr: { expiryDate: "2027-01-31T00:00:00.000Z" } } })).toEqual({ orgId: "o1", hasVatNumber: true, verified: true, crExpiry: "2027-01-31" })
    expect(supplierFactsFromProfile("o1", { taxNumber: "", isVerified: false })).toEqual({ orgId: "o1", hasVatNumber: false, verified: false, crExpiry: null })
  })
  it("is unknown for a missing profile", () => {
    expect(supplierFactsFromProfile("o1", null)).toEqual({ orgId: "o1", hasVatNumber: null, verified: null, crExpiry: null })
  })
})

describe("exclusion", () => {
  it("has the five codes", () => {
    expect([...EXCLUSION_CODES]).toEqual(["price", "terms", "incomplete", "not_qualified", "other"])
    expect(isExclusionCode("terms")).toBe(true)
    expect(isExclusionCode("spec")).toBe(false)
  })
  it("builds the payload written beside `مرفوض`", () => {
    expect(buildExclusion({ code: "incomplete", note: "  two lines unpriced ", byId: "u1", at: "2026-09-22T06:00:00.000Z" })).toEqual({ code: "incomplete", note: "two lines unpriced", byId: "u1", at: "2026-09-22T06:00:00.000Z" })
  })
  it("is null without a code — a plain rejection, as before", () => {
    expect(buildExclusion({ code: null, note: "whatever", byId: "u1" })).toBeNull()
    expect(buildExclusion({ code: "", byId: "u1" })).toBeNull()
  })
  it("stamps now when no time is given", () => {
    const x = buildExclusion({ code: "other", byId: "u1" })
    expect(x?.note).toBeNull()
    expect(typeof x?.at).toBe("string")
  })
})
