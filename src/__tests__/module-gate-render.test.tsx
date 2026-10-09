/**
 * The route gate: a page of a module the company switched off becomes a notice, a page waits while the
 * switches load, and nothing else — the portal home, other modules, the admin portal — is ever touched.
 */
import { render, screen } from "@testing-library/react"
import type { OptionalModule } from "@/lib/company-modules"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})
jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}|${Object.values(params).join(",")}` : key),
}))
jest.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

let path = "/contractor/hr"
jest.mock("next/navigation", () => ({ usePathname: () => path }))
let state: { off: ReadonlySet<OptionalModule>; loading: boolean } = { off: new Set(), loading: false }
jest.mock("@/hooks/useCompanyModules", () => ({ useCompanyModules: () => state }))

import { ModuleGate } from "@/components/layout/ModuleGate"

const setup = (p: string, off: OptionalModule[] = [], loading = false) => {
  path = p
  state = { off: new Set(off), loading }
  return render(
    <ModuleGate>
      <p>the page</p>
    </ModuleGate>
  )
}

describe("the module gate", () => {
  it("shows the page when nothing is switched off", () => {
    setup("/contractor/hr")
    expect(screen.getByText("the page")).toBeInTheDocument()
  })

  it("replaces a switched-off module's page with a notice that names it and leads home", () => {
    setup("/contractor/hr", ["hr"])
    expect(screen.queryByText("the page")).not.toBeInTheDocument()
    expect(screen.getByText("module_off_title")).toBeInTheDocument()
    expect(screen.getByText("module_off_desc|module_name_hr")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "module_off_home" })).toHaveAttribute("href", "/contractor")
  })

  it("blocks a project page, but not the portal home, when Project Management is off", () => {
    const { unmount } = setup("/contractor/projects/abc", ["project-management"])
    expect(screen.getByText("module_off_desc|module_name_project_management")).toBeInTheDocument()
    unmount()
    setup("/contractor", ["project-management"])
    expect(screen.getByText("the page")).toBeInTheDocument()
  })

  it("leaves every other module alone", () => {
    setup("/contractor/rfqs", ["hr", "manufacturing", "project-management"])
    expect(screen.getByText("the page")).toBeInTheDocument()
  })

  it("blocks a supplier's HR on its own side", () => {
    setup("/supplier/hr", ["hr"])
    expect(screen.getByRole("link", { name: "module_off_home" })).toHaveAttribute("href", "/supplier")
  })

  it("makes an optional module's page wait while the switches load, and lets other pages through", () => {
    const { unmount } = setup("/contractor/manufacturing", [], true)
    expect(screen.queryByText("the page")).not.toBeInTheDocument()
    expect(screen.queryByText("module_off_title")).not.toBeInTheDocument()
    unmount()
    setup("/contractor/rfqs", [], true)
    expect(screen.getByText("the page")).toBeInTheDocument()
  })

  it("does nothing in the admin portal", () => {
    setup("/admin/crm", ["hr"])
    expect(screen.getByText("the page")).toBeInTheDocument()
  })
})
