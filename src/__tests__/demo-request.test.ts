import { addDays, demoRequestSchema, escapeHtml, isValidDemoDate, riyadhToday } from "@/lib/demo-request"

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
const today = riyadhToday(NOW)
const nextWorkday = (from: string) => {
  let d = from
  while ([5, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1)
  return d
}

const base = {
  name: "Ahmad Ali",
  company: "Modern Co",
  phone: "+966 50 123 4567",
  email: "A@B.sa",
  preferredDate: nextWorkday(addDays(today, 3)),
  businessTypes: ["manufacturer"],
  businessOther: "",
}

describe("demo request date", () => {
  it("counts the day in Riyadh, not UTC", () => {
    expect(riyadhToday(Date.UTC(2026, 9, 1, 22, 0, 0))).toBe("2026-10-02")
    expect(riyadhToday(Date.UTC(2026, 9, 1, 20, 59, 0))).toBe("2026-10-01")
  })

  it("accepts today and up to 120 days ahead, nothing earlier or later", () => {
    expect(isValidDemoDate(nextWorkday(today), NOW)).toBe(true)
    expect(isValidDemoDate(addDays(today, -1), NOW)).toBe(false)
    expect(isValidDemoDate(nextWorkday(addDays(today, 121)), NOW)).toBe(false)
  })

  it("is only offered Sunday to Thursday", () => {
    expect(isValidDemoDate("2026-10-02", NOW)).toBe(false)
    expect(isValidDemoDate("2026-10-03", NOW)).toBe(false)
    expect(isValidDemoDate("2026-10-04", NOW)).toBe(true)
    expect(isValidDemoDate("2026-10-08", NOW)).toBe(true)
  })

  it("rejects malformed and impossible dates", () => {
    expect(isValidDemoDate("", NOW)).toBe(false)
    expect(isValidDemoDate("2026-13-01", NOW)).toBe(false)
    expect(isValidDemoDate("2026-02-30", NOW)).toBe(false)
    expect(isValidDemoDate("tomorrow", NOW)).toBe(false)
  })
})

describe("demo request schema", () => {
  const realNow = Date.now
  beforeAll(() => {
    Date.now = () => NOW
  })
  afterAll(() => {
    Date.now = realNow
  })

  it("accepts a manufacturer with a date", () => {
    const r = demoRequestSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.email).toBe("a@b.sa")
  })

  it("requires a date", () => {
    expect(demoRequestSchema.safeParse({ ...base, preferredDate: "" }).success).toBe(false)
    const { preferredDate: _d, ...rest } = base
    expect(demoRequestSchema.safeParse(rest).success).toBe(false)
  })

  it("requires at least one company type or a stated activity", () => {
    const { businessTypes: _t, ...rest } = base
    expect(demoRequestSchema.safeParse(rest).success).toBe(false)
    expect(demoRequestSchema.safeParse({ ...base, businessTypes: [] }).success).toBe(false)
    expect(demoRequestSchema.safeParse({ ...base, businessTypes: ["plumber"] }).success).toBe(false)
  })

  it("accepts a manufacturer who is also contractor, supplier and developer", () => {
    const r = demoRequestSchema.safeParse({ ...base, businessTypes: ["manufacturer", "contractor", "supplier", "developer"] })
    expect(r.success).toBe(true)
  })

  it("accepts a stated activity on its own, but not a one-letter one", () => {
    expect(demoRequestSchema.safeParse({ ...base, businessTypes: [], businessOther: "Engineering office" }).success).toBe(true)
    expect(demoRequestSchema.safeParse({ ...base, businessTypes: [], businessOther: " x " }).success).toBe(false)
  })
})
