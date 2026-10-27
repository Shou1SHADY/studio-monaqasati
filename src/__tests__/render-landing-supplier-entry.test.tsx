jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("next/image", () => ({ __esModule: true, default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }))
jest.mock("next/dynamic", () => ({ __esModule: true, default: () => () => null }))

/**
 * A supplier is no longer sent to a demo request: every supplier door on the public site (navigation, hero, the
 * supplier section, the closing call to action, the footer, `?join=supplier`, the Join form) leads to /supplier-signup,
 * while the contractor's demo request stays where it was.
 */

import fs from "fs"
import path from "path"
import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { installDomShims, missingKeys, pushed, setLocale } from "@/test-utils/render-world"
import HomeContent from "@/app/[locale]/content"
import { OnboardingWizard } from "@/components/OnboardingWizard"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

installDomShims()
jest.setTimeout(30_000)

type Landing = { Landing: Record<string, Record<string, string>> }
const words = (locale: "ar" | "en") => (locale === "ar" ? (ar as unknown as Landing) : (en as unknown as Landing)).Landing

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

const hrefsOf = (name: string) => screen.getAllByRole("link", { name }).map((a) => a.getAttribute("href"))

beforeEach(() => {
  setLocale("ar")
  missingKeys.clear()
  pushed.length = 0
  window.history.pushState({}, "", "/")
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => null })) as unknown as typeof fetch
})

describe.each(["ar", "en"] as const)("the landing page in %s", (locale) => {
  const open = async () => {
    setLocale(locale)
    render(<HomeContent />)
    await flush()
  }

  it("sends the supplier links to /supplier-signup and leaves the contractor's demo where it was", async () => {
    await open()
    const L = words(locale)
    expect(hrefsOf(L.Navbar.suppliers_portal)).toEqual(["/supplier-signup", "/supplier-signup"])
    expect(hrefsOf(L.Navbar.contractors_portal)).toEqual(["/#demo"])
    expect(hrefsOf(L.HeroAction.supplier_signup_cta)).toEqual(["/supplier-signup"])
    expect(hrefsOf(L.HeroAction.demo_cta)).toEqual(["#demo"])
    expect(hrefsOf(L.Supplier.cta)).toEqual(["/supplier-signup"])
    expect(hrefsOf(L.CTA.supplier_link)).toEqual(["/supplier-signup"])
    expect(hrefsOf(L.Footer.l_suppliers)).toEqual(["/supplier-signup", "/supplier-signup"])
    expect(hrefsOf(L.Footer.l_contractors)).toEqual(["/#demo"])
    expect(hrefsOf(L.Contractor.cta)).toEqual(["/#demo"])
    expect([...missingKeys]).toEqual([])
  })
})

describe("the phone menu", () => {
  it("lists the supplier door as the sign-up and the contractor door as the demo", async () => {
    render(<HomeContent />)
    await flush()
    fireEvent.click(screen.getByRole("button", { name: "فتح القائمة" }))
    const L = words("ar")
    expect(hrefsOf(L.Navbar.suppliers_portal)).toEqual(["/supplier-signup", "/supplier-signup", "/supplier-signup"])
    expect(hrefsOf(L.Navbar.contractors_portal)).toEqual(["/#demo", "/#demo"])
  })
})

describe("arriving with ?join", () => {
  it("?join=supplier goes straight to the supplier sign-up and opens no form", async () => {
    window.history.pushState({}, "", "/?join=supplier")
    render(<HomeContent />)
    await flush()
    expect(pushed).toEqual(["/supplier-signup"])
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("?join=1 still opens the Join form for everyone else", async () => {
    window.history.pushState({}, "", "/?join=1")
    render(<HomeContent />)
    await flush()
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(pushed).toEqual([])
  })
})

describe("the Join form", () => {
  it("tells a supplier he needs no request and links his free sign-up, closing the form on the way", () => {
    const onClose = jest.fn()
    render(<OnboardingWizard open onClose={onClose} />)
    const l = words("ar").Onboarding
    expect(screen.getByText(new RegExp(l.supplier_notice.slice(0, 10)))).toBeTruthy()
    const link = screen.getByRole("link", { name: l.supplier_notice_link })
    expect(link.getAttribute("href")).toBe("/supplier-signup")
    fireEvent.click(link)
    expect(onClose).toHaveBeenCalled()
  })

  it("still carries the company type picker and the request fields for contractors", () => {
    render(<OnboardingWizard open onClose={() => {}} />)
    const l = words("ar")
    expect(screen.getByText(l.CompanyType.contractor)).toBeTruthy()
    expect(screen.getByText(l.CompanyType.supplier)).toBeTruthy()
    expect(screen.getByRole("button", { name: l.Onboarding.submit })).toBeTruthy()
  })
})

describe("no supplier entry point still points to the demo", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8")

  it("the navigation, supplier section and footer of the landing page name /supplier-signup next to their supplier labels", () => {
    const content = read("src/app/[locale]/content.tsx")
    const below = read("src/app/[locale]/BelowFoldSections.tsx")
    expect(content).toMatch(/href="\/supplier-signup"[^>]*>\s*\{tNav\('suppliers_portal'\)\}/)
    expect(content).toMatch(/tNav\('suppliers_portal'\),\s*href: '\/supplier-signup'/)
    expect(below).toMatch(/<Link href="\/supplier-signup">\s*<Button[^>]*>\s*\{tSupplier\('cta'\)\}/)
    expect(below).toMatch(/tFooter\('l_suppliers'\), href: '\/supplier-signup'/)
    for (const src of [content, below]) {
      expect(src).not.toMatch(/#demo['"][^\n]*suppliers_portal|suppliers_portal[^\n]*#demo|l_suppliers[^\n]*#demo|tSupplier\('cta'\)[^\n]*#demo/)
    }
  })

  it("the landing assistant offers the supplier sign-up as a call to action, and tells suppliers there is no demo to ask for", () => {
    const flow = read("src/ai/flows/landing-chat-flow.ts")
    expect(flow).toContain("/supplier-signup")
    expect(flow).not.toContain("There is no public sign-up form. Getting started begins")
  })

  it("the login page and the Join form link the supplier sign-up; the register page's fallbacks reach the Join form, not the demo section", () => {
    expect(read("src/app/[locale]/login/page.tsx")).toContain('href="/supplier-signup"')
    expect(read("src/components/OnboardingWizard.tsx")).toContain('href="/supplier-signup"')
    expect(read("src/app/[locale]/register/page.tsx")).not.toContain("#demo")
  })

  it("the sitemap lists the new page", () => {
    expect(read("src/app/sitemap.ts")).toContain("'/supplier-signup'")
  })
})
