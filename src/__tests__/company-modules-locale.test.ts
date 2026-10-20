/**
 * Review of 20 Oct 2026: on an English address (`/en/contractor/…`) the module switches were
 * ignored — the portal read as none, so every switched-off module counted as on and ModuleGate
 * never blocked a page. The locale prefix is stripped first.
 */
import { pathWithoutLocale, portalOfPath } from "@/lib/company-modules"

describe("the portal of an address, in either language", () => {
  it("reads the portal with or without the locale", () => {
    expect(portalOfPath("/contractor/rfqs")).toBe("contractor")
    expect(portalOfPath("/en/contractor/rfqs")).toBe("contractor")
    expect(portalOfPath("/ar/supplier")).toBe("supplier")
    expect(portalOfPath("/en")).toBeNull()
    expect(portalOfPath("/admin")).toBeNull()
    expect(portalOfPath(null)).toBeNull()
  })
  it("strips only a locale segment", () => {
    expect(pathWithoutLocale("/en/contractor/rfqs")).toBe("/contractor/rfqs")
    expect(pathWithoutLocale("/en")).toBe("/")
    expect(pathWithoutLocale("/enterprise/x")).toBe("/enterprise/x")
  })
})
