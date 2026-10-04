import { factsFromProfile, publicFactsPatch } from "@/lib/company-public-facts"
import { supplierFactsFromProfile } from "@/lib/procurement/award"

describe("public facts of a profile write", () => {
  it("takes only the facts the write names, so a partial write never blanks the rest", () => {
    expect(publicFactsPatch({ taxNumber: "3000 0000 0000 03" })).toEqual({ vat: "30000000000003" })
    expect(publicFactsPatch({ crNumber: "1010123456" })).toEqual({ hasCr: true })
    expect(publicFactsPatch({ crNumber: "  " })).toEqual({ hasCr: false })
    expect(publicFactsPatch({ legalDocuments: { cr: { url: "u", expiryDate: "2027-05-01T00:00:00Z" } } })).toEqual({ crExpiry: "2027-05-01" })
    expect(publicFactsPatch({ legalDocuments: { vat: { url: "u" } } })).toEqual({ crExpiry: "" })
    expect(publicFactsPatch({ name: "Acme", city: "Riyadh", iban: "SA00" })).toEqual({})
    expect(publicFactsPatch(null)).toEqual({})
  })

  it("never carries the registration number, the certificate files or the bank details", () => {
    const patch = publicFactsPatch({ crNumber: "1010123456", legalDocuments: { cr: { url: "https://x/cr.pdf", expiryDate: "2027-05-01" } }, iban: "SA00", bankName: "B", taxNumber: "3" })
    expect(Object.keys(patch).sort()).toEqual(["crExpiry", "hasCr", "vat"])
    expect(JSON.stringify(patch)).not.toContain("1010123456")
    expect(JSON.stringify(patch)).not.toContain("cr.pdf")
  })

  it("keeps the old profile fields on top while they exist, and fills what they lack from the public facts", () => {
    const legacy = { taxNumber: "NEWER", legalDocuments: { cr: { expiryDate: "2027-09-01" } } }
    expect(factsFromProfile(legacy, { vat: "STALE", crExpiry: "2026-01-01" })).toEqual({ vat: "NEWER", crExpiry: "2027-09-01" })
    expect(factsFromProfile({ taxNumber: "" }, { vat: "FACT", crExpiry: "2027-05-01" })).toEqual({ vat: "FACT", crExpiry: "2027-05-01" })
    expect(factsFromProfile(legacy, null)).toEqual({ vat: "NEWER", crExpiry: "2027-09-01" })
  })

  it("is the public facts alone once the old fields are removed", () => {
    expect(factsFromProfile(null, { vat: "NEW" })).toEqual({ vat: "NEW", crExpiry: "" })
    expect(factsFromProfile({ isVerified: true } as never, { vat: "NEW", crExpiry: "2027-05-01" })).toEqual({ vat: "NEW", crExpiry: "2027-05-01" })
    expect(factsFromProfile(null, null)).toEqual({ vat: "", crExpiry: "" })
  })
})

describe("what an approval knows about a supplier", () => {
  it("is unknown for a supplier with no profile, as before", () => {
    expect(supplierFactsFromProfile("s1", null)).toEqual({ orgId: "s1", hasVatNumber: null, verified: null, crExpiry: null })
  })

  it("reads the old profile exactly as before when there are no public facts", () => {
    expect(supplierFactsFromProfile("s1", { taxNumber: "300000000000003", isVerified: true, legalDocuments: { cr: { expiryDate: "2027-05-01" } } })).toEqual({ orgId: "s1", hasVatNumber: true, verified: true, crExpiry: "2027-05-01" })
    expect(supplierFactsFromProfile("s1", { taxNumber: "", isVerified: false })).toEqual({ orgId: "s1", hasVatNumber: false, verified: false, crExpiry: null })
  })

  it("still knows the tax number and the expiry once the old profile fields are gone", () => {
    expect(supplierFactsFromProfile("s1", { isVerified: true }, { vat: "300000000000003", crExpiry: "2027-05-01" })).toEqual({ orgId: "s1", hasVatNumber: true, verified: true, crExpiry: "2027-05-01" })
    expect(supplierFactsFromProfile("s1", { isVerified: true }, { hasCr: true })).toEqual({ orgId: "s1", hasVatNumber: false, verified: true, crExpiry: null })
  })
})
