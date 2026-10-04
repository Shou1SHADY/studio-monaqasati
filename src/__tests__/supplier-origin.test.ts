import {
  filterDirectory,
  isInternationalSupplier,
  phoneIsInternational,
  recordErrors,
  recordFields,
  type DirectoryEntry,
} from "@/lib/procurement/supplier-file"

describe("international supplier detection", () => {
  it("reads a non-Saudi country code as international, in the + and 00 spellings", () => {
    expect(phoneIsInternational("+971 50 123 4567")).toBe(true)
    expect(phoneIsInternational("00201001234567")).toBe(true)
    expect(phoneIsInternational("+86 (138) 0013-8000")).toBe(true)
  })

  it("treats Saudi numbers in any usual spelling, and unreadable ones, as local", () => {
    expect(phoneIsInternational("+966501234567")).toBe(false)
    expect(phoneIsInternational("00966501234567")).toBe(false)
    expect(phoneIsInternational("0501234567")).toBe(false)
    expect(phoneIsInternational("966501234567")).toBe(false)
    expect(phoneIsInternational("")).toBe(false)
    expect(phoneIsInternational(null)).toBe(false)
    expect(phoneIsInternational("+12")).toBe(false)
  })

  it("lets our own call override the phone number either way", () => {
    expect(isInternationalSupplier({ phone: "+971501234567", record: { origin: "local" } })).toBe(false)
    expect(isInternationalSupplier({ phone: "0501234567", record: { origin: "international" } })).toBe(true)
    expect(isInternationalSupplier({ phone: "+971501234567", record: { origin: null } })).toBe(true)
    expect(isInternationalSupplier({ phone: "0501234567", record: null })).toBe(false)
  })

  it("saves 'auto' as no call at all, and refuses an unknown origin", () => {
    const base = { vatNumber: "", crExpiry: "", paymentTermsDays: 30, leadTimeDays: "", kind: "mat" as const }
    expect(recordFields({ ...base, origin: "auto" }).origin).toBeNull()
    expect(recordFields(base).origin).toBeNull()
    expect(recordFields({ ...base, origin: "international" }).origin).toBe("international")
    expect(recordErrors({ ...base, origin: "international" })).toEqual([])
    expect(recordErrors({ ...base, origin: "moon" as never })).toEqual(["origin_invalid"])
  })
})

describe("directory origin filter", () => {
  const entries: DirectoryEntry[] = [
    { orgId: "a", name: "Riyadh Steel", city: null, categories: [], international: false },
    { orgId: "b", name: "Dubai Cables", city: null, categories: [], international: true },
    { orgId: "c", name: "Unknown", city: null, categories: [] },
  ]
  const f = { q: "", category: "", city: "" }

  it("keeps everyone when no origin is chosen", () => {
    expect(filterDirectory(entries, f).map((e) => e.orgId)).toEqual(["a", "b", "c"])
  })

  it("keeps only international suppliers, or only the rest", () => {
    expect(filterDirectory(entries, { ...f, origin: "international" }).map((e) => e.orgId)).toEqual(["b"])
    expect(filterDirectory(entries, { ...f, origin: "local" }).map((e) => e.orgId)).toEqual(["a", "c"])
  })
})

describe("the platform admin's classification", () => {
  it("sits between our own call and the phone: ours wins, then the admin's, then the number", () => {
    expect(isInternationalSupplier({ phone: "+8613800000000", platformOrigin: "local" })).toBe(false)
    expect(isInternationalSupplier({ phone: "0501234567", platformOrigin: "international" })).toBe(true)
    expect(isInternationalSupplier({ phone: "0501234567", platformOrigin: "international", record: { origin: "local" } })).toBe(false)
    expect(isInternationalSupplier({ phone: "+8613800000000", platformOrigin: null })).toBe(true)
    expect(isInternationalSupplier({ phone: "0501234567", platformOrigin: "somewhere" })).toBe(false)
  })
})
