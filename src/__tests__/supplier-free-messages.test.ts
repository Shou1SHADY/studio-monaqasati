/**
 * Supplier 1.0 — both languages carry every string, every message formats with its own placeholders, and the plural
 * forms read right (Arabic has six). The free journey writes no emoji and no code in place of a word.
 */

import { intlMock, setLocale } from "@/test-utils/render-world"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

const A = (ar as unknown as { SupplierFree: Record<string, string> }).SupplierFree
const E = (en as unknown as { SupplierFree: Record<string, string> }).SupplierFree

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1])
const t = (locale: "ar" | "en", key: string, vars: Record<string, unknown> = {}) => {
  setLocale(locale)
  return intlMock.useTranslations("SupplierFree")(key, vars)
}

describe("SupplierFree messages", () => {
  it("both languages have the same keys", () => {
    expect(Object.keys(A).sort()).toEqual(Object.keys(E).sort())
    expect(Object.keys(A).length).toBeGreaterThan(800)
  })

  it("every message formats with its own placeholders and none is missing a variable", () => {
    const bad: string[] = []
    for (const locale of ["ar", "en"] as const) {
      const dict = locale === "ar" ? A : E
      for (const [k, v] of Object.entries(dict)) {
        const params = Object.fromEntries(placeholders(v).map((p) => [p, p === "n" ? 3 : "x"]))
        const out = t(locale, k, params)
        if (/MISSING/.test(out)) bad.push(`${locale}.${k}: ${out}`)
      }
    }
    expect(bad).toEqual([])
  })

  it("the same placeholders in both languages", () => {
    const sig = (s: string) => JSON.stringify([...new Set(placeholders(s))].sort())
    const diff = Object.keys(A)
      .filter((k) => sig(A[k]) !== sig(E[k]))
      .map((k) => `${k}: ${placeholders(A[k])} vs ${placeholders(E[k])}`)
    expect(diff).toEqual([])
  })

  it("plurals: Arabic one · two · few · many, English one · other", () => {
    const p = (locale: "ar" | "en", key: string, n: number) => t(locale, key, { n, c: String(n) })
    expect([1, 2, 3, 11].map((n) => p("ar", "pl_day", n))).toEqual(["يوم", "يومين", "3 أيام", "11 يوماً"])
    expect([1, 2, 3, 11].map((n) => p("ar", "pl_item", n))).toEqual(["بند واحد", "بندان", "3 بنود", "11 بنداً"])
    expect([1, 5].map((n) => p("en", "pl_day", n))).toEqual(["1 day", "5 days"])
    expect([1, 4].map((n) => p("en", "pl_late", n))).toEqual(["1 day late", "4 days late"])
  })

  it("no emoji and no document code stands in for a word", () => {
    const text = [...Object.values(A), ...Object.values(E)].join("\n")
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(text).not.toMatch(/ط\.ش|ا\.س|إ\.ت|ع\.ش/)
    expect(text).not.toMatch(/\bGRN-|\bPO-|\bASN-/)
  })

  it("the supplier's money page is not called 'collection', and requests are not 'opportunities'", () => {
    expect(A.navInvoices).toBe("الفواتير والحوالات")
    expect(A.navOpps).toBe("طلبات التسعير")
    expect(E.navInvoices).toBe("Invoices & transfers")
    expect(E.navOpps).toBe("Quote requests")
  })
})
