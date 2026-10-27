/** @jest-environment node */

import fs from "fs"
import type { AbstractIntlMessages } from "next-intl"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"
import { ROOT_PORTAL_SCOPE, scopeMessages, type PortalScope } from "@/i18n/message-scope"
import { LANDING_PROJECT_TYPE_KEYS, ROUTE_PORTAL_SCOPES } from "@/i18n/route-scopes"
import { translationNamespacesReachableFrom } from "@/test-utils/import-closure"

const size = (m: unknown) => Buffer.byteLength(JSON.stringify(m))

describe("scopeMessages", () => {
  const messages: AbstractIntlMessages = { Auth: { a: "A" }, Portal: { Errors: { e: "E" }, Shared: { s1: "1", s2: "2" }, PM: { p: "P" } } }

  it("drops the whole Portal tree from the root set except what the root scope names", () => {
    expect(scopeMessages(messages, ROOT_PORTAL_SCOPE)).toEqual({ Auth: { a: "A" }, Portal: { Errors: { e: "E" } } })
  })

  it("keeps a child whole, or only the named keys of it, and ignores a child that does not exist", () => {
    expect(scopeMessages(messages, { Shared: ["s2", "nope"], Missing: true, PM: true })).toEqual({ Auth: { a: "A" }, Portal: { Shared: { s2: "2" }, PM: { p: "P" } } })
  })

  it("gives a portal everything", () => {
    expect(scopeMessages(messages, "all")).toBe(messages)
  })
})

describe("what each public route may read from Portal", () => {
  const L = "src/app/[locale]"
  const rootScoped = [`${L}/about/page.tsx`, `${L}/contact/page.tsx`, `${L}/pricing/page.tsx`, `${L}/privacy/page.tsx`, `${L}/terms/page.tsx`, `${L}/login/page.tsx`, `${L}/register/page.tsx`, `${L}/verify-email/page.tsx`, `${L}/chat/[chatId]/page.tsx`, `${L}/rfq/[token]/page.tsx`, `${L}/portal/[token]/page.tsx`, `${L}/_not-found.tsx`, `${L}/layout.tsx`]
  const routeScoped: [string, PortalScope][] = [
    [`${L}/page.tsx`, ROUTE_PORTAL_SCOPES.landing],
    [`${L}/supplier-signup/page.tsx`, ROUTE_PORTAL_SCOPES.supplierSignup],
    [`${L}/offer/[token]/page.tsx`, ROUTE_PORTAL_SCOPES.offer],
    [`${L}/po/[token]/page.tsx`, ROUTE_PORTAL_SCOPES.po],
    [`${L}/receive/[token]/page.tsx`, ROUTE_PORTAL_SCOPES.receive],
  ]
  const portalChildren = (entry: string) => [...translationNamespacesReachableFrom(entry)].filter((n) => n.startsWith("Portal")).map((n) => n.split(".")[1] ?? "*")

  it.each(routeScoped)("%s reads only the Portal children its scope sends", (entry, scope) => {
    const allowed = new Set(Object.keys(scope))
    expect(portalChildren(entry).filter((c) => !allowed.has(c))).toEqual([])
  })

  it.each(rootScoped)("%s reads nothing from Portal beyond the root set", (entry) => {
    const allowed = new Set(Object.keys(ROOT_PORTAL_SCOPE))
    expect(portalChildren(entry).filter((c) => !allowed.has(c))).toEqual([])
  })

  it("the landing page's project-type keys are exactly the ones it sends, in both languages", () => {
    const source = fs.readFileSync(`${L}/content.tsx`, "utf8")
    for (const key of LANDING_PROJECT_TYPE_KEYS) {
      expect(source).toContain(`'${key}'`)
      expect((ar.Portal.Contractor as Record<string, string>)[key]).toBeTruthy()
      expect((en.Portal.Contractor as Record<string, string>)[key]).toBeTruthy()
    }
  })

  it("a public page no longer carries the portal's strings", () => {
    for (const messages of [ar, en]) {
      expect(size(scopeMessages(messages as AbstractIntlMessages, ROOT_PORTAL_SCOPE))).toBeLessThan(200 * 1024)
      expect(size(scopeMessages(messages as AbstractIntlMessages, ROUTE_PORTAL_SCOPES.landing))).toBeLessThan(250 * 1024)
      expect(size(scopeMessages(messages as AbstractIntlMessages, "all"))).toBeGreaterThan(1000 * 1024)
    }
  })
})
