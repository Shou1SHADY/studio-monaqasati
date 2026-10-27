/** @jest-environment node */
/**
 * /supplier-signup is a public page like the others: its metadata carries the canonical and hreflang pair
 * (Arabic unprefixed, English under /en), its title and description are in the message files, and the sitemap lists it
 * in both languages.
 */

jest.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const bundle = (JSON.parse((jest.requireActual("fs") as typeof import("fs")).readFileSync(`${process.cwd()}/messages/${locale}.json`, "utf8")) as Record<string, Record<string, string>>)[namespace]
    return (key: string) => bundle[key]
  },
}))
jest.mock("@/app/[locale]/supplier-signup/SupplierSignupContent", () => ({ SupplierSignupContent: () => null }))

import { generateMetadata } from "@/app/[locale]/supplier-signup/page"
import sitemap from "@/app/sitemap"
import { SITE_URL } from "@/lib/app-env"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

describe("the page's metadata", () => {
  it.each([
    ["ar", ar.SupplierSignup, SITE_URL],
    ["en", en.SupplierSignup, `${SITE_URL}/en`],
  ] as const)("in %s: its own title and description, canonical and hreflang pair", async (locale, t, own) => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale }) })
    expect(String(meta.title)).toContain(t.metaTitle)
    expect(meta.description).toBe(t.metaDesc)
    expect(meta.alternates?.canonical).toBe(`${own}/supplier-signup`)
    expect(meta.alternates?.languages).toEqual({
      ar: `${SITE_URL}/supplier-signup`,
      en: `${SITE_URL}/en/supplier-signup`,
      "x-default": `${SITE_URL}/supplier-signup`,
    })
  })
})

describe("the sitemap", () => {
  it("lists the page in Arabic and English", () => {
    const urls = sitemap().map((e) => e.url)
    expect(urls).toContain(`${SITE_URL}/supplier-signup`)
    expect(urls).toContain(`${SITE_URL}/en/supplier-signup`)
  })
})
