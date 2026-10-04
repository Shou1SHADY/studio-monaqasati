import { factsFromProfile, publicFactsPatch } from "@/lib/company-public-facts"
import { supplierFactsFromProfile } from "@/lib/procurement/award"
import { VAT_ON_FILE, displayVat, effectiveVat, profileVatMark, supplierDocs } from "@/lib/procurement/supplier-file"

describe("public facts of a profile write", () => {
  it("takes only the facts the write names, so a partial write never blanks the rest", () => {
    expect(publicFactsPatch({ taxNumber: "3000 0000 0000 03" })).toEqual({ hasVat: true })
    expect(publicFactsPatch({ taxNumber: "  " })).toEqual({ hasVat: false })
    expect(publicFactsPatch({ crNumber: "1010123456" })).toEqual({ hasCr: true })
    expect(publicFactsPatch({ crNumber: "  " })).toEqual({ hasCr: false })
    expect(publicFactsPatch({ legalDocuments: { cr: { url: "u", expiryDate: "2027-05-01T00:00:00Z" } } })).toEqual({ crExpiry: "2027-05-01" })
    expect(publicFactsPatch({ legalDocuments: { vat: { url: "u" } } })).toEqual({ crExpiry: "" })
    expect(publicFactsPatch({ name: "Acme", city: "Riyadh", iban: "SA00" })).toEqual({})
    expect(publicFactsPatch(null)).toEqual({})
  })

  it("never carries a number, the certificate files or the bank details: any signed-in user, a team member included, can read it", () => {
    const patch = publicFactsPatch({ crNumber: "1010123456", legalDocuments: { cr: { url: "https://x/cr.pdf", expiryDate: "2027-05-01" } }, iban: "SA00", bankName: "B", taxNumber: "300000000000003" })
    expect(Object.keys(patch).sort()).toEqual(["crExpiry", "hasCr", "hasVat"])
    const text = JSON.stringify(patch)
    for (const secret of ["1010123456", "cr.pdf", "SA00", "300000000000003"]) expect(text).not.toContain(secret)
  })

  it("keeps the old profile fields on top while they exist, and fills what they lack from the public facts", () => {
    const legacy = { taxNumber: "300000000000003", legalDocuments: { cr: { expiryDate: "2027-09-01" } } }
    expect(factsFromProfile(legacy, { hasVat: false, crExpiry: "2026-01-01" })).toEqual({ vat: "300000000000003", hasVat: true, crExpiry: "2027-09-01" })
    expect(factsFromProfile({ taxNumber: "" }, { hasVat: true, crExpiry: "2027-05-01" })).toEqual({ vat: "", hasVat: true, crExpiry: "2027-05-01" })
    expect(factsFromProfile(legacy, null)).toEqual({ vat: "300000000000003", hasVat: true, crExpiry: "2027-09-01" })
  })

  it("is the public facts alone once the old fields are removed: it knows a tax number exists, not what it is", () => {
    expect(factsFromProfile(null, { hasVat: true })).toEqual({ vat: "", hasVat: true, crExpiry: "" })
    expect(factsFromProfile({ isVerified: true } as never, { hasVat: true, crExpiry: "2027-05-01" })).toEqual({ vat: "", hasVat: true, crExpiry: "2027-05-01" })
    expect(factsFromProfile(null, { hasVat: false })).toEqual({ vat: "", hasVat: false, crExpiry: "" })
    expect(factsFromProfile(null, null)).toEqual({ vat: "", hasVat: false, crExpiry: "" })
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

  it("still knows a tax number exists and the expiry once the old profile fields are gone", () => {
    expect(supplierFactsFromProfile("s1", { isVerified: true }, { hasVat: true, crExpiry: "2027-05-01" })).toEqual({ orgId: "s1", hasVatNumber: true, verified: true, crExpiry: "2027-05-01" })
    expect(supplierFactsFromProfile("s1", { isVerified: true }, { hasCr: true })).toEqual({ orgId: "s1", hasVatNumber: false, verified: true, crExpiry: null })
  })
})

describe("a tax number we know exists but may not read", () => {
  const withNumber = { profileVat: "300000000000003", profileHasVat: true }
  const flagOnly = { profileVat: null, profileHasVat: true }
  const none = { profileVat: null, profileHasVat: false }

  it("counts as on file for every presence check, so approvals and the sourcing rule keep working", () => {
    expect(profileVatMark(withNumber)).toBe("300000000000003")
    expect(profileVatMark(flagOnly)).toBe(VAT_ON_FILE)
    expect(profileVatMark(none)).toBe("")
    expect(supplierDocs(effectiveVat(null, profileVatMark(flagOnly)), null, "2026-10-04").state).toBe("ok")
    expect(supplierDocs(effectiveVat(null, profileVatMark(none)), null, "2026-10-04").state).toBe("no_vat")
  })

  it("is never what a screen shows: the number shown is ours or the supplier's own, never the marker", () => {
    expect(displayVat({ vatNumber: "OURS" }, "THEIRS")).toBe("OURS")
    expect(displayVat(null, "THEIRS")).toBe("THEIRS")
    expect(displayVat(null, "")).toBe("")
  })
})
