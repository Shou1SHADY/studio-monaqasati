import {
  validateEmployee,
  parseSalary,
  formatSalary,
  totalPayroll,
} from "../utils/employee-utils"

describe("validateEmployee", () => {
  it("returns no errors for valid input", () => {
    expect(validateEmployee({ name: "Ahmed Ali", role: "Engineer", salary: 8000 })).toEqual([])
  })

  it("requires name", () => {
    const errors = validateEmployee({ name: "", role: "Engineer", salary: 5000 })
    expect(errors).toContain("name_required")
  })

  it("requires name (whitespace only)", () => {
    const errors = validateEmployee({ name: "   ", role: "Engineer", salary: 5000 })
    expect(errors).toContain("name_required")
  })

  it("requires role", () => {
    const errors = validateEmployee({ name: "Ahmed", role: "", salary: 5000 })
    expect(errors).toContain("role_required")
  })

  it("rejects negative salary", () => {
    const errors = validateEmployee({ name: "Ahmed", role: "Engineer", salary: -100 })
    expect(errors).toContain("salary_invalid")
  })

  it("rejects NaN salary string", () => {
    const errors = validateEmployee({ name: "Ahmed", role: "Engineer", salary: "abc" })
    expect(errors).toContain("salary_invalid")
  })

  it("accepts zero salary", () => {
    const errors = validateEmployee({ name: "Ahmed", role: "Intern", salary: 0 })
    expect(errors).not.toContain("salary_invalid")
  })

  it("accepts salary as a valid string number", () => {
    const errors = validateEmployee({ name: "Ahmed", role: "Driver", salary: "4500" })
    expect(errors).toEqual([])
  })

  it("rejects unreasonably high salary", () => {
    const errors = validateEmployee({ name: "Ahmed", role: "CEO", salary: 2_000_000 })
    expect(errors).toContain("salary_too_high")
  })

  it("accumulates multiple errors", () => {
    const errors = validateEmployee({ name: "", role: "", salary: -1 })
    expect(errors).toContain("name_required")
    expect(errors).toContain("role_required")
    expect(errors).toContain("salary_invalid")
    expect(errors.length).toBe(3)
  })
})

describe("parseSalary", () => {
  it("parses a numeric string", () => {
    expect(parseSalary("5000")).toBe(5000)
  })

  it("parses a number", () => {
    expect(parseSalary(7500)).toBe(7500)
  })

  it("parses a string with commas", () => {
    expect(parseSalary("10,000")).toBe(10000)
  })

  it("returns 0 for empty string", () => {
    expect(parseSalary("")).toBe(0)
  })

  it("returns 0 for invalid string", () => {
    expect(parseSalary("abc")).toBe(0)
  })

  it("clamps negative to 0", () => {
    expect(parseSalary(-500)).toBe(0)
  })
})

describe("formatSalary", () => {
  it("formats in Arabic locale with SAR", () => {
    const result = formatSalary(5000, "ar")
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain("ر")
  })

  it("formats in English locale with SAR", () => {
    const result = formatSalary(5000, "en")
    expect(result).toContain("SAR")
    expect(result).toContain("5,000")
  })

  it("formats zero", () => {
    const result = formatSalary(0, "en")
    expect(result).toContain("0")
  })
})

describe("totalPayroll", () => {
  it("sums all salaries", () => {
    const employees = [{ salary: 5000 }, { salary: 3000 }, { salary: 7000 }]
    expect(totalPayroll(employees)).toBe(15000)
  })

  it("returns 0 for empty array", () => {
    expect(totalPayroll([])).toBe(0)
  })

  it("handles missing salary gracefully", () => {
    const employees = [{ salary: 5000 }, { salary: 0 }]
    expect(totalPayroll(employees)).toBe(5000)
  })
})
