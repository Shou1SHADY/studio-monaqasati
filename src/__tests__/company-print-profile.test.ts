import { printProfileErrors, printProfileFields, printedNumber } from "@/lib/company-print-profile"

describe("what a team member's document prints", () => {
  it("prefers the company's own number, then what the owner chose to print, else nothing", () => {
    expect(printedNumber("1010123456", "9999999999")).toBe("1010123456")
    expect(printedNumber("", "9999999999")).toBe("9999999999")
    expect(printedNumber(undefined, " 9999999999 ")).toBe("9999999999")
    expect(printedNumber(undefined, "")).toBeNull()
    expect(printedNumber(null, undefined)).toBeNull()
  })

  it("keeps the print profile empty until the owner fills it in", () => {
    expect(printProfileFields({})).toEqual({ crNumber: "", taxNumber: "" })
    expect(printProfileFields({ crNumber: " 1010123456 ", taxNumber: 300000000000003 })).toEqual({ crNumber: "1010123456", taxNumber: "300000000000003" })
  })

  it("accepts blank numbers and Saudi-shaped ones, and refuses the rest", () => {
    expect(printProfileErrors({})).toEqual([])
    expect(printProfileErrors({ crNumber: "1010123456", taxNumber: "300000000000003" })).toEqual([])
    expect(printProfileErrors({ taxNumber: "3000 0000 0000 003" })).toEqual([])
    expect(printProfileErrors({ crNumber: "12345" })).toEqual(["cr_format"])
    expect(printProfileErrors({ taxNumber: "400000000000004" })).toEqual(["vat_format"])
    expect(printProfileErrors({ crNumber: "abc", taxNumber: "1" })).toEqual(["cr_format", "vat_format"])
  })
})
