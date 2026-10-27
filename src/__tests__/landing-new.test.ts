import { landingNewAllowed } from "@/lib/landing-new"

describe("the /landing-new design trial", () => {
  it("is served on UAT", () => {
    expect(landingNewAllowed(true, "production")).toBe(true)
  })
  it("is served in local development", () => {
    expect(landingNewAllowed(false, "development")).toBe(true)
  })
  it("is not found on production, so a uat → main merge cannot put it live", () => {
    expect(landingNewAllowed(false, "production")).toBe(false)
    expect(landingNewAllowed(false, undefined)).toBe(false)
  })
})
