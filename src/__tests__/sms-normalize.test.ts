import { normalizePhoneE164 } from "@/lib/sms"

describe("normalizePhoneE164", () => {
  it("keeps valid E.164 numbers as-is", () => {
    expect(normalizePhoneE164("+966501234567")).toBe("+966501234567")
    expect(normalizePhoneE164("+201001234567")).toBe("+201001234567")
    expect(normalizePhoneE164("+39021234567")).toBe("+39021234567")
  })

  it("converts 00-prefixed international numbers", () => {
    expect(normalizePhoneE164("00966501234567")).toBe("+966501234567")
  })

  it("normalizes Saudi local formats", () => {
    expect(normalizePhoneE164("0501234567")).toBe("+966501234567")
    expect(normalizePhoneE164("501234567")).toBe("+966501234567")
    expect(normalizePhoneE164("966501234567")).toBe("+966501234567")
  })

  it("strips spaces, dashes and parentheses", () => {
    expect(normalizePhoneE164("050 123 4567")).toBe("+966501234567")
    expect(normalizePhoneE164("050-123-4567")).toBe("+966501234567")
    expect(normalizePhoneE164("+966 (50) 123-4567")).toBe("+966501234567")
  })

  it("rejects garbage and unusable values", () => {
    expect(normalizePhoneE164("")).toBeNull()
    expect(normalizePhoneE164(null)).toBeNull()
    expect(normalizePhoneE164(undefined)).toBeNull()
    expect(normalizePhoneE164("abc")).toBeNull()
    expect(normalizePhoneE164("12345")).toBeNull()
    expect(normalizePhoneE164("+12")).toBeNull()
  })
})
