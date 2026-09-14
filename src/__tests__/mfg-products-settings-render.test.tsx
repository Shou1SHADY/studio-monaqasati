/**
 * Render smoke test for Manufacturing → Products and Settings (PRD 1.2): the
 * product card list (route with unestimated steps marked, no price), the
 * product panel and form, the station registry refusing a delete that would
 * orphan a route, the switches, read-only policies, boundaries and the
 * permissions matrix — in both locales from the real message files.
 */

import { fireEvent, render, screen, within } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { DEFAULT_MFG_SETTINGS, type MfgProduct } from "@/lib/manufacturing-engine"
import type { MfgDepartment } from "@/lib/manufacturing"
import type { MfgData } from "@/hooks/useMfgData"
import { MfgProductsView } from "@/components/manufacturing/MfgProductsView"
import { MfgProductForm } from "@/components/manufacturing/MfgPrdForm"
import { MfgSettingsView } from "@/components/manufacturing/MfgSettingsView"
import { stationUsage } from "@/components/manufacturing/MfgPrdBits"

let mockLocale: "ar" | "en" = "en"
const mockCache: Record<string, Record<string, unknown>> = {}
const mockMessages = (locale: string): Record<string, unknown> =>
  (mockCache[locale] ||= JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8")))

/** Enough ICU for these screens: plain arguments and the `other`/`=n` plural branch. */
function mockFormat(message: string, vars: Record<string, unknown>): string {
  return message.replace(/\{(\w+), plural,((?:[^{}]|\{[^{}]*\})*)\}/g, (_m, name: string, body: string) => {
    const n = Number(vars[name])
    const exact = new RegExp(`=${n}\\s*\\{([^}]*)\\}`).exec(body)
    const other = /other\s*\{([^}]*)\}/.exec(body)
    return (exact?.[1] ?? other?.[1] ?? "").replace(/#/g, String(n))
  }).replace(/\{(\w+)\}/g, (_m, name: string) => (name in vars ? String(vars[name]) : `MISSING_VAR:${name}`))
}

jest.mock("next-intl", () => ({
  useLocale: () => mockLocale,
  useTranslations: (namespace: string) => {
    const table = () => namespace.split(".").reduce<Record<string, unknown> | undefined>((node, part) => node?.[part] as Record<string, unknown> | undefined, mockMessages(mockLocale))
    const t = (key: string, vars?: Record<string, unknown>) => {
      const raw = table()?.[key]
      return typeof raw === "string" ? mockFormat(raw, vars || {}) : `MISSING:${namespace}.${key}`
    }
    t.has = (key: string) => typeof table()?.[key] === "string"
    return t
  },
}))

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})

jest.mock("@/i18n/routing", () => ({ Link: () => null, usePathname: () => "/contractor/manufacturing/products", useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}) }))
const mockToast = jest.fn()
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }))
jest.mock("@/lib/manufacturing-writes", () => ({
  createMfgProduct: jest.fn(),
  updateMfgProduct: jest.fn(),
  updateStation: jest.fn(),
  saveMfgFeatures: jest.fn(),
}))

const departments = [
  { id: "cut", organizationId: "org", name: "Bridge-saw cutting", order: 1, workers: 2, hoursPerDay: 8, hourlyRate: 70, leadUserId: "u6", leadUserName: "Abu Sami" },
  { id: "drill", organizationId: "org", name: "Cut-outs & drilling", order: 2, workers: 1, hoursPerDay: 8, hourlyRate: 65 },
  { id: "pack", organizationId: "org", name: "QC & packing", order: 3, workers: 2, hoursPerDay: 8, hourlyRate: 45, qcStation: true },
] as MfgDepartment[]

const vanity: MfgProduct = {
  id: "p1",
  organizationId: "org",
  name: "Quartz vanity top",
  unit: "m²",
  family: "stone",
  requiresMeasurement: true,
  requiresDrawingApproval: true,
  requiresSlabApproval: false,
  wastePercent: 22,
  salePrice: 4200,
  referenceBuyPrice: 980,
  route: [
    { departmentId: "cut", departmentName: "Bridge-saw cutting", hoursPerUnit: 0.3 },
    { departmentId: "drill", departmentName: "Cut-outs & drilling", hoursPerUnit: null },
  ],
  bom: [
    { itemName: "Quartz slab", unit: "m²", qtyPerUnit: 1, departmentId: "cut", withWaste: true, unitCost: 300 },
    { itemName: "Saw blade", unit: "pc", qtyPerUnit: 0.02, departmentId: "cut", withWaste: false, unitCost: 250, custody: true },
  ],
}

const data = {
  orgId: "org",
  actor: { id: "u1", name: "Badr" },
  departments,
  products: [vanity],
  productById: new Map([[vanity.id, vanity]]),
  orders: [],
  requests: [],
  estimates: [],
  settings: DEFAULT_MFG_SETTINGS,
  stock: { onHand: new Map([["quartz slab", 40]]), lots: [] },
  stockRows: new Map(),
  team: [{ id: "u6", name: "Abu Sami", manage: false, work: true, qc: false, cost: false, view: false }],
} as unknown as MfgData

const mockUi = {
  portal: "contractor",
  base: "/contractor/manufacturing",
  data,
  perms: { canManage: true, canWork: false, canQc: false, canCost: false, canView: false, seesMoney: true },
  today: "2026-09-14",
  nowMs: Date.now(),
  world: { views: [], viewById: new Map(), calcs: [], alloc: null, lost: new Map(), schedule: new Map() },
  views: [],
  viewById: new Map(),
  persona: "manager",
  personas: ["manager"],
  seesMoney: true,
  openGlobal: jest.fn(),
  openOrder: jest.fn(),
}

jest.mock("@/components/manufacturing/MfgUiContext", () => ({ useMfgUi: () => mockUi }))

beforeEach(() => {
  mockLocale = "en"
  mockToast.mockClear()
  mockUi.openGlobal.mockClear()
})

describe("Products", () => {
  it("lists cards with the route, unestimated steps marked, and no sale price", () => {
    const { container } = render(<MfgProductsView />)
    expect(container.textContent).not.toContain("MISSING")
    const card = screen.getByRole("button", { name: /Quartz vanity top/ })
    expect(within(card).getByText("Bridge-saw cutting")).toBeInTheDocument()
    expect(within(card).getByText("(1 not estimated)")).toBeInTheDocument()
    expect(card.textContent).not.toContain("4,200")
  })

  it("opens the product panel with route, BOM flags and the edit action", () => {
    render(<MfgProductsView />)
    fireEvent.click(screen.getByRole("button", { name: /Quartz vanity top/ }))
    const panel = screen.getByRole("dialog")
    expect(panel.textContent).not.toContain("MISSING")
    expect(within(panel).getByText("not estimated — excluded from scheduling")).toBeInTheDocument()
    expect(within(panel).getByText("station custody — not requested per order")).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole("button", { name: /Edit product & route/ }))
    expect(mockUi.openGlobal).toHaveBeenCalledWith({ kind: "product", productId: "p1" })
  })

  it("validates the product form's first step", () => {
    render(<MfgProductForm onClose={jest.fn()} />)
    const form = screen.getByRole("dialog")
    expect(form.textContent).not.toContain("MISSING")
    fireEvent.click(within(form).getByRole("button", { name: /Next/ }))
    expect(within(form).getAllByText("Enter the product name").length).toBeGreaterThan(0)
  })

  it("renders in Arabic without missing keys", () => {
    mockLocale = "ar"
    const { container } = render(<MfgProductsView />)
    expect(container.textContent).not.toContain("MISSING")
  })
})

describe("Settings", () => {
  it("renders the registry, switches, policies, boundaries and the permissions matrix", () => {
    const { container } = render(<MfgSettingsView />)
    expect(container.textContent).not.toContain("MISSING")
    expect(screen.getByText("Station registry and capacity")).toBeInTheDocument()
    expect(screen.getByText("Time & capacity")).toBeInTheDocument()
    expect(screen.getByText("Edited in Finance → Accounting settings, not here.")).toBeInTheDocument()
    expect(screen.getByText("Module boundaries")).toBeInTheDocument()
    const lastRow = screen.getByText("Set a price, confirm a payment, issue or receive for another module").closest("tr")!
    expect(within(lastRow).queryByText("Yes")).not.toBeInTheDocument()
  })

  it("refuses to delete a station that sits on a product route, naming why", () => {
    render(<MfgSettingsView />)
    fireEvent.click(screen.getByRole("button", { name: "Delete Bridge-saw cutting" }))
    expect(screen.getAllByText("Bridge-saw cutting cannot be deleted").length).toBeGreaterThan(0)
    expect(screen.getByText(/take it off/)).toBeInTheDocument()
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("counts where a station is used", () => {
    expect(stationUsage("cut", [], [vanity])).toEqual({ ordersInHand: 0, routes: 1 })
    expect(stationUsage("pack", [], [vanity])).toEqual({ ordersInHand: 0, routes: 0 })
  })

  it("renders in Arabic without missing keys", () => {
    mockLocale = "ar"
    const { container } = render(<MfgSettingsView />)
    expect(container.textContent).not.toContain("MISSING")
  })
})
