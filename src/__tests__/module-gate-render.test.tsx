/**
 * The route gate: a page of a module the company switched off becomes a notice, a page waits while the
 * switches load, and nothing else — the portal home, other modules, the admin portal — is ever touched.
 */
import { render, screen } from "@testing-library/react"
import type { OptionalModule } from "@/lib/company-modules"
import type { SubscriptionState } from "@/lib/subscription-status"

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

let trial: { state: SubscriptionState; loading: boolean } = { state: { phase: "active", endsAt: null, daysLeft: null }, loading: false }
jest.mock("@/hooks/useCompanyTrial", () => ({ useCompanyTrial: () => trial }))

import { ModuleGate } from "@/components/layout/ModuleGate"
import { SupplierPlanContext } from "@/hooks/usePortalRegistry"

const setup = (p: string, off: OptionalModule[] = [], loading = false) => {
  path = p
  trial = { state: { phase: "active", endsAt: null, daysLeft: null }, loading: false }
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

  describe("a contractor with Finance switched off (HR goes with it)", () => {
    const financeOff: OptionalModule[] = ["payments", "hr"]

    it.each(["/contractor/accounting", "/contractor/accounting/sales-desk", "/contractor/accounting/journal", "/contractor/invoices", "/contractor/guarantees", "/contractor/receipts"])(
      "turns %s into a notice that names Finance and leads home",
      (p) => {
        setup(p, financeOff)
        expect(screen.queryByText("the page")).not.toBeInTheDocument()
        expect(screen.getByText("module_off_desc|module_name_payments")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "module_off_home" })).toHaveAttribute("href", "/contractor")
      }
    )

    it("turns the HR pages into a notice too, because HR went off with Finance", () => {
      setup("/contractor/hr/people", financeOff)
      expect(screen.getByText("module_off_desc|module_name_hr")).toBeInTheDocument()
    })

    it.each(["/contractor/receipts/abc123", "/contractor/goods-received", "/contractor/sales/payments", "/contractor/rfqs", "/contractor/warehouses", "/contractor/projects/abc", "/contractor/manufacturing", "/contractor"])(
      "leaves %s open — the delivery receipt, Procurement, Sales, Inventory, Projects and Manufacturing keep working",
      (p) => {
        setup(p, financeOff)
        expect(screen.getByText("the page")).toBeInTheDocument()
      }
    )

    it("makes the Finance pages wait while the switches load, but not the delivery receipt", () => {
      const { unmount } = setup("/contractor/accounting", [], true)
      expect(screen.queryByText("the page")).not.toBeInTheDocument()
      unmount()
      setup("/contractor/receipts/abc123", [], true)
      expect(screen.getByText("the page")).toBeInTheDocument()
    })
  })

  it("does nothing in the admin portal", () => {
    setup("/admin/crm", ["hr"])
    expect(screen.getByText("the page")).toBeInTheDocument()
  })

  describe("a company on a trial", () => {
    const running = (daysLeft: number): SubscriptionState => ({ phase: "trial", endsAt: "2026-11-15T09:00:00.000Z", daysLeft })
    const ended: SubscriptionState = { phase: "expired", endsAt: "2026-11-15T09:00:00.000Z", daysLeft: 0 }
    const withTrial = (p: string, sub: SubscriptionState, loading = false) => {
      path = p
      state = { off: new Set(), loading: false }
      trial = { state: sub, loading }
      return render(
        <ModuleGate>
          <p>the page</p>
        </ModuleGate>
      )
    }

    it("sees the page with the days left above it while the trial runs", () => {
      withTrial("/contractor/rfqs", running(9))
      expect(screen.getByText("the page")).toBeInTheDocument()
      expect(screen.getByText(/trial_banner\|9,/)).toBeInTheDocument()
    })

    it.each(["/contractor", "/contractor/rfqs", "/contractor/rfqs/orders", "/contractor/profile", "/contractor/warehouses", "/contractor/hr/people"])(
      "gets no screen at all at %s once the trial has ended — only the locked page",
      (p) => {
        withTrial(p, ended)
        expect(screen.queryByText("the page")).not.toBeInTheDocument()
        expect(screen.getByText("trial_locked_title")).toBeInTheDocument()
        expect(screen.getByText(/trial_locked_desc\|/)).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "trial_locked_contact" })).toHaveAttribute("href", "/contact")
      }
    )

    it("waits for the trial to be read before showing any page, so an ended trial never flashes the screen", () => {
      withTrial("/contractor/rfqs", { phase: "active", endsAt: null, daysLeft: null }, true)
      expect(screen.queryByText("the page")).not.toBeInTheDocument()
      expect(screen.queryByText("trial_locked_title")).not.toBeInTheDocument()
    })

    it("an active company sees no banner and no lock", () => {
      setup("/contractor/rfqs")
      expect(screen.getByText("the page")).toBeInTheDocument()
      expect(screen.queryByText(/trial_banner/)).not.toBeInTheDocument()
      expect(screen.queryByText("trial_locked_title")).not.toBeInTheDocument()
    })

    it("the admin portal is never locked", () => {
      withTrial("/admin/crm", ended)
      expect(screen.getByText("the page")).toBeInTheDocument()
    })
  })
})

describe("a supplier on a paid trial", () => {
  const withPlan = (trialState: { phase: "none" | "running" | "ended"; endsAt: string | null; daysLeft: number | null }) => {
    path = "/supplier/rfqs"
    state = { off: new Set(), loading: false }
    trial = { state: { phase: "active", endsAt: null, daysLeft: null }, loading: false }
    return render(
      <SupplierPlanContext.Provider value={{ plan: "full", loading: false, orgId: "s1", trial: trialState }}>
        <ModuleGate>
          <p>the page</p>
        </ModuleGate>
      </SupplierPlanContext.Provider>
    )
  }

  it("keeps working, and sees the days left above the page", () => {
    withPlan({ phase: "running", endsAt: "2026-11-17T09:00:00.000Z", daysLeft: 5 })
    expect(screen.getByText("the page")).toBeInTheDocument()
    expect(screen.getByText(/paid_trial_banner\|5,/)).toBeInTheDocument()
  })

  it("is never locked when the trial is over — the page stays and no banner is left", () => {
    withPlan({ phase: "ended", endsAt: "2026-11-01T09:00:00.000Z", daysLeft: 0 })
    expect(screen.getByText("the page")).toBeInTheDocument()
    expect(screen.queryByText(/paid_trial_banner/)).not.toBeInTheDocument()
    expect(screen.queryByText("trial_locked_title")).not.toBeInTheDocument()
  })

  it("a plain subscription shows no banner", () => {
    withPlan({ phase: "none", endsAt: null, daysLeft: null })
    expect(screen.queryByText(/paid_trial_banner/)).not.toBeInTheDocument()
  })
})
