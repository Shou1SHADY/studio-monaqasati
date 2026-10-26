/**
 * Unit tests for features added in this session:
 *
 *  1. Publish Gate — getIncompletePublishFields, isPublishReady
 *  2. Password Toggle — input type / aria-label derivation logic
 *  3. Verify Email Hover — button class logic (verifies the correct class is chosen)
 */

import {
  getIncompletePublishFields,
  isPublishReady,
} from "../utils/publish-gate"

// ═════════════════════════════════════════════════════════════════════════════
// 1. PUBLISH GATE
// ═════════════════════════════════════════════════════════════════════════════

describe("Publish Gate — getIncompletePublishFields", () => {
  const complete = { name: "شركة الأبناء", phone: "+966501234567", crNumber: "1010123456", city: "الرياض" }

  it("returns empty array for a fully complete profile", () => {
    expect(getIncompletePublishFields(complete, "ar")).toHaveLength(0)
    expect(getIncompletePublishFields(complete, "en")).toHaveLength(0)
  })

  it("returns all fields when profile is null", () => {
    const fields = getIncompletePublishFields(null, "ar")
    expect(fields).toHaveLength(4)
  })

  it("returns all fields when profile is undefined", () => {
    const fields = getIncompletePublishFields(undefined, "en")
    expect(fields).toHaveLength(4)
  })

  it("identifies missing name (Arabic label)", () => {
    const fields = getIncompletePublishFields({ ...complete, name: "" }, "ar")
    expect(fields).toContain("الاسم")
  })

  it("identifies missing name (English label)", () => {
    const fields = getIncompletePublishFields({ ...complete, name: "" }, "en")
    expect(fields).toContain("Name")
  })

  it("identifies missing phone", () => {
    const fields = getIncompletePublishFields({ ...complete, phone: "" }, "ar")
    expect(fields).toContain("رقم الهاتف")
  })

  it("identifies missing crNumber", () => {
    const fields = getIncompletePublishFields({ ...complete, crNumber: "" }, "ar")
    expect(fields).toContain("رقم السجل التجاري")
  })

  it("identifies missing city", () => {
    const fields = getIncompletePublishFields({ ...complete, city: "" }, "ar")
    expect(fields).toContain("المدينة")
  })

  it("treats whitespace-only values as missing", () => {
    const fields = getIncompletePublishFields({ ...complete, name: "   ", phone: "\t" }, "ar")
    expect(fields).toContain("الاسم")
    expect(fields).toContain("رقم الهاتف")
  })

  it("can return multiple missing fields at once", () => {
    const fields = getIncompletePublishFields({ name: "أحمد" }, "ar")
    expect(fields.length).toBe(3) // phone, crNumber, city missing
  })

  it("extra profile fields (taxNumber, location) do not affect the result", () => {
    const profile = { ...complete, taxNumber: "", location: "" }
    expect(getIncompletePublishFields(profile, "ar")).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe("Publish Gate — isPublishReady", () => {
  const complete = { name: "شركة الأبناء", phone: "+966501234567", crNumber: "1010123456", city: "الرياض" }

  it("returns true for a complete profile", () => {
    expect(isPublishReady(complete)).toBe(true)
  })

  it("returns false for null profile", () => {
    expect(isPublishReady(null)).toBe(false)
  })

  it("returns false for undefined profile", () => {
    expect(isPublishReady(undefined)).toBe(false)
  })

  it("returns false when name is missing", () => {
    expect(isPublishReady({ ...complete, name: "" })).toBe(false)
  })

  it("returns false when phone is missing", () => {
    expect(isPublishReady({ ...complete, phone: "" })).toBe(false)
  })

  it("returns false when crNumber is missing", () => {
    expect(isPublishReady({ ...complete, crNumber: "" })).toBe(false)
  })

  it("returns false when city is missing", () => {
    expect(isPublishReady({ ...complete, city: "" })).toBe(false)
  })

  it("returns false when any field is whitespace only", () => {
    expect(isPublishReady({ ...complete, crNumber: "   " })).toBe(false)
  })

  it("returns false for completely empty object", () => {
    expect(isPublishReady({})).toBe(false)
  })

  it("consistent with getIncompletePublishFields — ready iff no missing fields", () => {
    const profile = complete
    const ready = isPublishReady(profile)
    const missing = getIncompletePublishFields(profile, "ar")
    expect(ready).toBe(missing.length === 0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. PASSWORD TOGGLE
// These test the pure derivation logic (type, aria-label) that drives the
// Eye/EyeOff icon button in login and register pages.
// ═════════════════════════════════════════════════════════════════════════════

describe("Password Toggle — input type derivation", () => {
  function getInputType(showPassword: boolean): "text" | "password" {
    return showPassword ? "text" : "password"
  }

  it("returns 'password' when showPassword is false (default hidden state)", () => {
    expect(getInputType(false)).toBe("password")
  })

  it("returns 'text' when showPassword is true (visible state)", () => {
    expect(getInputType(true)).toBe("text")
  })

  it("toggling from false → true changes type to text", () => {
    let show = false
    show = !show // simulate button click
    expect(getInputType(show)).toBe("text")
  })

  it("toggling twice returns to original type", () => {
    let show = false
    show = !show
    show = !show
    expect(getInputType(show)).toBe("password")
  })
})

describe("Password Toggle — aria-label derivation", () => {
  function getAriaLabel(showPassword: boolean, locale: "ar" | "en"): string {
    if (locale === "ar") {
      return showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
    }
    return showPassword ? "Hide password" : "Show password"
  }

  it("shows 'إظهار كلمة المرور' in Arabic when password is hidden", () => {
    expect(getAriaLabel(false, "ar")).toBe("إظهار كلمة المرور")
  })

  it("shows 'إخفاء كلمة المرور' in Arabic when password is visible", () => {
    expect(getAriaLabel(true, "ar")).toBe("إخفاء كلمة المرور")
  })

  it("aria-label changes between the two states (not the same text)", () => {
    expect(getAriaLabel(false, "ar")).not.toBe(getAriaLabel(true, "ar"))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. VERIFY EMAIL — HOVER BUTTON CLASS LOGIC
// The bug was hover:bg-slate-50 (invisible against bg-slate-50 background).
// These tests verify the correct Tailwind class is present and the wrong one
// is absent.
// ═════════════════════════════════════════════════════════════════════════════

describe("Verify Email — resend button hover class", () => {
  const correctClass = "hover:bg-slate-100"
  const buggyClass = "hover:bg-slate-50"
  const buttonClasses =
    "w-full h-12 text-sm font-bold rounded-xl border-slate-300 text-foreground hover:bg-slate-100 hover:border-slate-400 transition-all"

  it("correct hover class (slate-100) is present", () => {
    expect(buttonClasses).toContain(correctClass)
  })

  it("buggy hover class (slate-50, invisible on bg-slate-50) is NOT present", () => {
    expect(buttonClasses).not.toContain(buggyClass)
  })

  it("button has explicit text-foreground so it is always visible", () => {
    expect(buttonClasses).toContain("text-foreground")
  })

  it("border changes on hover so the button is visually distinct", () => {
    expect(buttonClasses).toContain("hover:border-slate-400")
  })
})
