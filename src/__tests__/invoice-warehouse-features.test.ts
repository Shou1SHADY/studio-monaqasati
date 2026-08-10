import {
  calculateInvoiceTotal,
  calculateVat,
  calculateGrandTotal,
  formatInvoiceNumber,
  isInvoiceOverdue,
  resolveInvoiceStatus,
  getInvoiceStatusVariant,
  formatCurrency,
  generateInvoiceNumber,
  type InvoiceStatus,
} from "../utils/invoice-utils"

describe("calculateInvoiceTotal", () => {
  it("sums quantity × unitPrice for each item", () => {
    const items = [
      { description: "A", quantity: 2, unitPrice: 100 },
      { description: "B", quantity: 3, unitPrice: 50 },
    ]
    expect(calculateInvoiceTotal(items)).toBe(350)
  })

  it("returns 0 for empty items", () => {
    expect(calculateInvoiceTotal([])).toBe(0)
  })

  it("handles single item", () => {
    expect(calculateInvoiceTotal([{ description: "X", quantity: 5, unitPrice: 200 }])).toBe(1000)
  })

  it("handles fractional unit prices", () => {
    const items = [{ description: "Y", quantity: 3, unitPrice: 1.5 }]
    expect(calculateInvoiceTotal(items)).toBeCloseTo(4.5)
  })
})

describe("calculateVat", () => {
  it("calculates 15% VAT correctly", () => {
    expect(calculateVat(1000, 15)).toBe(150)
  })

  it("calculates 5% VAT correctly", () => {
    expect(calculateVat(200, 5)).toBe(10)
  })

  it("calculates 0% VAT as zero", () => {
    expect(calculateVat(1000, 0)).toBe(0)
  })

  it("uses 15% as default rate", () => {
    expect(calculateVat(1000)).toBe(150)
  })

  it("rounds to nearest integer", () => {
    // 33 * 15 / 100 = 4.95 → rounds to 5
    expect(calculateVat(33, 15)).toBe(5)
  })
})

describe("calculateGrandTotal", () => {
  it("returns total + vat", () => {
    expect(calculateGrandTotal(1000, 15)).toBe(1150)
  })

  it("is 0 for 0% vat", () => {
    expect(calculateGrandTotal(500, 0)).toBe(500)
  })
})

describe("formatInvoiceNumber", () => {
  it("pads number with leading zeros", () => {
    expect(formatInvoiceNumber("INV", 1)).toBe("INV-0001")
    expect(formatInvoiceNumber("INV", 42)).toBe("INV-0042")
    expect(formatInvoiceNumber("INV", 1000)).toBe("INV-1000")
  })

  it("handles large numbers without truncation", () => {
    expect(formatInvoiceNumber("INV", 12345)).toBe("INV-12345")
  })

  it("supports custom prefix", () => {
    expect(formatInvoiceNumber("QUOTE", 7)).toBe("QUOTE-0007")
  })
})

describe("isInvoiceOverdue", () => {
  const pastDate = "2020-01-01"
  const futureDate = "2099-12-31"

  it("returns false for paid invoice regardless of date", () => {
    expect(isInvoiceOverdue(pastDate, "paid")).toBe(false)
  })

  it("returns true when due date is in the past and status is sent", () => {
    expect(isInvoiceOverdue(pastDate, "sent")).toBe(true)
  })

  it("returns true when due date is in the past and status is draft", () => {
    expect(isInvoiceOverdue(pastDate, "draft")).toBe(true)
  })

  it("returns false when due date is in the future", () => {
    expect(isInvoiceOverdue(futureDate, "sent")).toBe(false)
  })
})

describe("resolveInvoiceStatus", () => {
  const pastDate = "2020-01-01"
  const futureDate = "2099-12-31"

  it("keeps draft status regardless of due date", () => {
    expect(resolveInvoiceStatus(pastDate, "draft")).toBe("draft")
  })

  it("keeps paid status regardless of due date", () => {
    expect(resolveInvoiceStatus(pastDate, "paid")).toBe("paid")
  })

  it("resolves sent+past to overdue", () => {
    expect(resolveInvoiceStatus(pastDate, "sent")).toBe("overdue")
  })

  it("keeps sent+future as sent", () => {
    expect(resolveInvoiceStatus(futureDate, "sent")).toBe("sent")
  })

  it("keeps already-overdue as overdue", () => {
    expect(resolveInvoiceStatus(pastDate, "overdue")).toBe("overdue")
  })
})

describe("getInvoiceStatusVariant", () => {
  it("maps paid to default", () => {
    expect(getInvoiceStatusVariant("paid")).toBe("default")
  })

  it("maps sent to secondary", () => {
    expect(getInvoiceStatusVariant("sent")).toBe("secondary")
  })

  it("maps overdue to destructive", () => {
    expect(getInvoiceStatusVariant("overdue")).toBe("destructive")
  })

  it("maps draft to outline", () => {
    expect(getInvoiceStatusVariant("draft")).toBe("outline")
  })
})

describe("formatCurrency", () => {
  it("formats in English with SAR currency", () => {
    const result = formatCurrency(1250.5, "en")
    expect(result).toContain("SAR")
    expect(result).toContain("1,250")
  })

  it("formats in Arabic locale", () => {
    const result = formatCurrency(1250, "ar")
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain("ر")
  })

  it("includes 2 decimal places", () => {
    const result = formatCurrency(100, "en")
    expect(result).toContain("100.00")
  })
})

describe("generateInvoiceNumber", () => {
  it("returns a non-empty string", () => {
    const num = generateInvoiceNumber()
    expect(typeof num).toBe("string")
    expect(num.length).toBeGreaterThan(0)
  })

  it("starts with INV-", () => {
    const num = generateInvoiceNumber()
    expect(num.startsWith("INV-")).toBe(true)
  })

  it("contains the current year", () => {
    const year = new Date().getFullYear().toString()
    const num = generateInvoiceNumber()
    expect(num).toContain(year)
  })

  it("generates unique numbers on repeated calls", () => {
    const nums = new Set(Array.from({ length: 50 }, () => generateInvoiceNumber()))
    expect(nums.size).toBeGreaterThan(1)
  })
})
