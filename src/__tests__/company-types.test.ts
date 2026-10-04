import {
  COMPANY_TYPES,
  hasCompanyType,
  isAllCompanyTypes,
  leadCompanyTypes,
  normalizeCompanyTypes,
  toggleAllCompanyTypes,
  toggleCompanyType,
} from "@/lib/company-types"

describe("company types", () => {
  it("keeps the canonical order and drops unknown values and duplicates", () => {
    expect(normalizeCompanyTypes(["supplier", "plumber", "contractor", "supplier"])).toEqual(["contractor", "supplier"])
  })

  it("toggles one type on and off without disturbing the others", () => {
    expect(toggleCompanyType(["supplier"], "contractor")).toEqual(["contractor", "supplier"])
    expect(toggleCompanyType(["contractor", "supplier"], "contractor")).toEqual(["supplier"])
  })

  it("selects every type for 'all', and clears them when all are already on", () => {
    expect(toggleAllCompanyTypes(["supplier"])).toEqual([...COMPANY_TYPES])
    expect(isAllCompanyTypes(toggleAllCompanyTypes([]))).toBe(true)
    expect(toggleAllCompanyTypes([...COMPANY_TYPES])).toEqual([])
  })

  it("needs a type or a stated activity of two letters", () => {
    expect(hasCompanyType([], "")).toBe(false)
    expect(hasCompanyType([], " a ")).toBe(false)
    expect(hasCompanyType([], "Consultancy")).toBe(true)
    expect(hasCompanyType(["developer"], "")).toBe(true)
  })

  it("reads a demo request saved before types became a list", () => {
    expect(leadCompanyTypes({ businessType: "manufacturer" })).toEqual({ types: ["manufacturer"], other: "" })
    expect(leadCompanyTypes({ businessType: "other", businessOther: "Crane hire" })).toEqual({ types: [], other: "Crane hire" })
  })

  it("reads the new shapes from both forms", () => {
    expect(leadCompanyTypes({ businessTypes: ["supplier", "contractor"] }).types).toEqual(["contractor", "supplier"])
    expect(leadCompanyTypes({ companyTypes: ["developer"], companyTypeOther: "Brokerage" })).toEqual({ types: ["developer"], other: "Brokerage" })
    expect(leadCompanyTypes({})).toEqual({ types: [], other: "" })
  })
})
