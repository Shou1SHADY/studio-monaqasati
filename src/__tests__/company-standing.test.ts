import { COMPANY_STANDING_KEYS, withCompanyStanding } from "@/lib/identity-fields"

// A member's own users doc is born isVerified/profileCompleted false and never
// changes; the company's standing decides whether he may raise an RFQ or send
// an offer, and the owner alone is asked to complete the profile.
describe("a team member reads his company's standing", () => {
  const member = { name: "Ali", phone: "+966500000001", organizationRole: "member", isVerified: false, profileCompleted: false }

  it("takes verified / completed from the company, keeps his own name and phone — never the legal documents (DEV-60)", () => {
    const company = { name: "Owner", phone: "+966500000000", isVerified: true, profileCompleted: true, legalDocuments: { cr: { url: "cr" }, vat: { url: "vat" } } }
    expect(withCompanyStanding({ ...member, legalDocuments: { cr: { url: "own" } } }, company)).toEqual({
      name: "Ali",
      phone: "+966500000001",
      organizationRole: "member",
      isVerified: true,
      profileCompleted: true,
    })
  })

  it("an unverified company stays unverified for its member", () => {
    expect(withCompanyStanding(member, { isVerified: false, profileCompleted: true })).toMatchObject({ isVerified: false, profileCompleted: true })
  })

  it("never keeps the member's own copy when the company has none", () => {
    const out = withCompanyStanding({ ...member, isVerified: true }, null)
    for (const k of COMPANY_STANDING_KEYS) expect(k in out).toBe(false)
  })
})
