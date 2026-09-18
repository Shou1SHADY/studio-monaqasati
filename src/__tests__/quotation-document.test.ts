import {
  DEFAULT_QUOTATION_VAT_PERCENT,
  EMPTY_QUOTATION_BRANDING,
  addDaysToIsoDate,
  brandingFromProfile,
  formatDocumentDate,
  formatDocumentMoney,
  logoStoragePath,
  normalizeVatPercent,
  quotationDocumentTotals,
  sheetCustomerFromContact,
  sheetDataFromQuotation,
  validateLogoFile,
  validityDaysBetween,
} from "@/lib/quotation-document"
import { defaultInstallments, type CrmQuotation } from "@/lib/crm"

const schedule = defaultInstallments({ deposit: "دفعة مقدمة", balance: "المتبقي" })

describe("quotation document totals", () => {
  it("prints the stored net amount as the subtotal and adds VAT on top", () => {
    const totals = quotationDocumentTotals({
      items: [
        { name: "رخام", quantity: 3, unit: "م²", unitPrice: 250 },
        { name: "تركيب", quantity: 1, unit: "", unitPrice: 199.99 },
      ],
      amount: 0,
      vatPercent: 15,
      installments: null,
    })
    expect(totals.lines.map((l) => [l.index, l.total])).toEqual([[1, 750], [2, 199.99]])
    expect(totals.subtotal).toBe(949.99)
    expect(totals.vat).toBe(142.5)
    expect(totals.total).toBe(1092.49)
  })

  it("uses the lump-sum amount when there are no item lines", () => {
    const totals = quotationDocumentTotals({ items: null, amount: 1000, vatPercent: null, installments: null })
    expect(totals.lines).toEqual([])
    expect(totals.subtotal).toBe(1000)
    expect(totals.vatPercent).toBe(DEFAULT_QUOTATION_VAT_PERCENT)
    expect(totals.total).toBe(1150)
  })

  it("keeps a zero VAT rate but falls back to the standard rate for nonsense", () => {
    expect(normalizeVatPercent(0)).toBe(0)
    expect(normalizeVatPercent("5")).toBe(5)
    expect(normalizeVatPercent("")).toBe(15)
    expect(normalizeVatPercent("abc")).toBe(15)
    expect(normalizeVatPercent(120)).toBe(15)
    expect(quotationDocumentTotals({ items: null, amount: 1000, vatPercent: 0, installments: null }).total).toBe(1000)
  })

  it("splits the VAT-inclusive total across the schedule and makes the rows add up", () => {
    const totals = quotationDocumentTotals({ items: null, amount: 333.33, vatPercent: 15, installments: schedule })
    expect(totals.total).toBe(383.33)
    expect(totals.schedule.map((s) => s.percent)).toEqual([30, 70])
    expect(totals.schedule[0].amount).toBe(115)
    expect(totals.schedule[0].amount + totals.schedule[1].amount).toBeCloseTo(totals.total, 10)
  })

  it("reads no schedule as one full payment and never adjusts a schedule that is not 100%", () => {
    const full = quotationDocumentTotals({ items: null, amount: 100, vatPercent: 15, installments: [] })
    expect(full.schedule).toEqual([{ id: "full", label: "", percent: 100, amount: 115 }])
    const partial = quotationDocumentTotals({
      items: null,
      amount: 100,
      vatPercent: 0,
      installments: [
        { id: "a", label: "A", percent: 30 },
        { id: "b", label: "B", percent: 30 },
      ],
    })
    expect(partial.schedule.map((s) => s.amount)).toEqual([30, 30])
  })
})

describe("document formatting", () => {
  it("formats money with two decimals and Western digits", () => {
    expect(formatDocumentMoney(1234.5)).toBe("1,234.50")
    expect(formatDocumentMoney(undefined)).toBe("0.00")
  })

  it("formats dates in the Gregorian calendar with Western digits in both locales", () => {
    expect(formatDocumentDate("2026-09-13", "en")).toBe("13 September 2026")
    const ar = formatDocumentDate("2026-09-13", "ar")
    expect(ar).toContain("2026")
    expect(ar).toContain("13")
    expect(formatDocumentDate(null, "ar")).toBe("—")
    expect(formatDocumentDate("not a date", "en")).toBe("—")
  })

  it("adds days and measures validity on calendar dates", () => {
    expect(addDaysToIsoDate("2026-09-13", 30)).toBe("2026-10-13")
    expect(addDaysToIsoDate("2026-12-20", 15)).toBe("2027-01-04")
    expect(addDaysToIsoDate("13/09/2026", 1)).toBe("")
    expect(validityDaysBetween("2026-09-13", "2026-10-13")).toBe(30)
    expect(validityDaysBetween("2026-09-13", "2026-09-13")).toBe(0)
    expect(validityDaysBetween("2026-09-13", "2026-09-01")).toBeNull()
    expect(validityDaysBetween("2026-09-13", "")).toBeNull()
  })
})

describe("logo files", () => {
  it("accepts png/jpg/webp/svg up to 2 MB", () => {
    expect(validateLogoFile({ type: "image/png", size: 1000 })).toBeNull()
    expect(validateLogoFile({ type: "image/svg+xml", size: 2 * 1024 * 1024 })).toBeNull()
    expect(validateLogoFile({ type: "image/gif", size: 1000 })).toBe("type")
    expect(validateLogoFile({ type: "image/jpeg", size: 2 * 1024 * 1024 + 1 })).toBe("size")
  })

  it("stores logos under the org with a safe object name", () => {
    expect(logoStoragePath("org1", "My Logo (Final).PNG", 42)).toBe("quotation-branding/org1/42-my-logo-final-.png")
    expect(logoStoragePath("org1", "شعار", 42)).toBe("quotation-branding/org1/42-logo")
  })
})

describe("letterhead and sheet data", () => {
  it("builds the letterhead from the resolved company profile", () => {
    const branding = brandingFromProfile(
      { companyName: " مؤسسة البناء ", crNumber: "1010", taxNumber: "300", city: "الرياض", location: "حي العليا", phoneNumber: "0500", website: "x.sa" },
      { logoUrl: "https://logo", email: "a@b.sa", cityLabel: (c) => `[${c}]` }
    )
    expect(branding).toEqual({
      logoUrl: "https://logo",
      companyName: "مؤسسة البناء",
      crNumber: "1010",
      vatNumber: "300",
      address: "حي العليا - [الرياض]",
      phone: "0500",
      email: "a@b.sa",
      website: "x.sa",
    })
    expect(brandingFromProfile(null, {})).toEqual(EMPTY_QUOTATION_BRANDING)
  })

  it("does not repeat the company when it is the contact's own name", () => {
    expect(sheetCustomerFromContact({ name: "Acme", company: "Acme" }, null).company).toBeNull()
    expect(sheetCustomerFromContact(null, "Fallback").name).toBe("Fallback")
  })

  it("prints a saved quotation under its own snapshot, falling back for older ones", () => {
    const base: CrmQuotation = {
      id: "q1",
      contactId: "c1",
      contactName: "Client",
      quotationNumber: "Q-ABC",
      amount: 500,
      status: "sent",
      date: "2026-09-01",
      validityDays: 10,
      organizationId: "org",
    }
    const fallback = { ...EMPTY_QUOTATION_BRANDING, companyName: "Current Co" }
    const old = sheetDataFromQuotation(base, { fallbackBranding: fallback })
    expect(old.branding.companyName).toBe("Current Co")
    expect(old.validUntil).toBe("2026-09-11")
    expect(old.vatPercent).toBeNull()

    const snap = { ...EMPTY_QUOTATION_BRANDING, companyName: "Issued Co", logoUrl: "https://old-logo" }
    const issued = sheetDataFromQuotation(
      { ...base, branding: snap, validUntil: "2026-09-30", vatPercent: 5, terms: "T" },
      { fallbackBranding: fallback }
    )
    expect(issued.branding).toBe(snap)

    // A quotation written BEFORE the owner uploaded a logo: the snapshot keeps
    // its identity, and only the missing logo comes from the org's default —
    // otherwise it would print bare for ever (a sent quote's branding is locked).
    const bare = { ...EMPTY_QUOTATION_BRANDING, companyName: "Issued Co", logoUrl: null }
    const withDefault = { ...fallback, logoUrl: "https://org-logo" }
    const early = sheetDataFromQuotation({ ...base, branding: bare }, { fallbackBranding: withDefault })
    expect(early.branding.companyName).toBe("Issued Co")
    expect(early.branding.logoUrl).toBe("https://org-logo")
    // its own logo always wins over the default
    expect(sheetDataFromQuotation({ ...base, branding: snap }, { fallbackBranding: withDefault }).branding.logoUrl).toBe("https://old-logo")
    expect(issued.validUntil).toBe("2026-09-30")
    expect(issued.vatPercent).toBe(5)
    expect(issued.terms).toBe("T")
  })
})
