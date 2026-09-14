import { render, screen, fireEvent, within } from "@testing-library/react"
import fs from "fs"
import path from "path"
import type { MfgDepartment } from "@/lib/manufacturing"
import { DEFAULT_MFG_SETTINGS, type MfgProduct } from "@/lib/manufacturing-engine"
import { MfgProductsView } from "@/components/manufacturing/MfgProductsView"
import { MfgSettingsView } from "@/components/manufacturing/MfgSettingsView"
import { departmentDeleteGuard } from "@/components/manufacturing/MfgSetDepartments"
import type { MfgData } from "@/hooks/useMfgData"

// next-intl ships ESM only — resolve the real message files so the copy under
// test is the copy that ships, and flag any key that doesn't exist.
let mockLocale: "ar" | "en" = "en"
const mockMessageCache: Record<string, Record<string, unknown>> = {}
const mockMessages = (locale: string): Record<string, unknown> =>
  (mockMessageCache[locale] ||= JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8")))

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        name === "__esModule" ? false : (props: Record<string, unknown>) => React.createElement("svg", { "data-icon": String(name), "aria-hidden": props["aria-hidden"] }),
    }
  )
})

jest.mock("next-intl", () => ({
  useLocale: () => mockLocale,
  useTranslations: (namespace: string) => (key: string, vars?: Record<string, string | number>) => {
    const table = namespace
      .split(".")
      .reduce<Record<string, unknown> | undefined>((node, part) => node?.[part] as Record<string, unknown> | undefined, mockMessages(mockLocale))
    let text = typeof table?.[key] === "string" ? (table[key] as string) : `MISSING:${namespace}.${key}`
    for (const [name, value] of Object.entries(vars || {})) text = text.split(`{${name}}`).join(String(value))
    return text
  },
}))

jest.mock("@/i18n/routing", () => ({ Link: () => null, usePathname: () => "/", useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}) }))

const mockToast = jest.fn()
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }))

const departments: MfgDepartment[] = [
  { id: "d-cut", organizationId: "org", name: "Cutting", order: 1, workers: 2, hoursPerDay: 8, hourlyRate: 40 },
  { id: "d-polish", organizationId: "org", name: "Polishing", order: 2, workers: 1, hoursPerDay: 8, hourlyRate: 35 },
  { id: "d-pack", organizationId: "org", name: "Packing", order: 3, workers: 1, hoursPerDay: 8, hourlyRate: null, checklist: [{ key: "c1", label: "Crates labelled" }] },
]

const products: MfgProduct[] = [
  {
    id: "p-stairs",
    organizationId: "org",
    name: "Marble stairs",
    unit: "m²",
    family: "stone",
    requiresMeasurement: true,
    requiresDrawingApproval: true,
    requiresSlabApproval: false,
    wastePercent: 20,
    salePrice: null,
    estimateValue: null,
    referenceBuyPrice: 900,
    route: [
      { departmentId: "d-cut", departmentName: "Cutting", hoursPerUnit: 0.5 },
      { departmentId: "d-polish", departmentName: "Polishing", hoursPerUnit: 0.25 },
    ],
    bom: [{ itemName: "Carrara slab", unit: "m²", qtyPerUnit: 1, departmentId: "d-cut", withWaste: true, unitCost: 300, lotted: true }],
  },
]

const data = {
  orgId: "org",
  actor: { id: "u1", name: "Manager" },
  ready: true,
  canManage: true,
  canWork: true,
  canQc: true,
  canCost: false,
  seesMoney: true,
  departments,
  products,
  productById: new Map(products.map((p) => [p.id, p])),
  orders: [],
  v2Orders: [],
  notes: [],
  notesByOrder: new Map(),
  requests: [],
  estimates: [],
  settings: DEFAULT_MFG_SETTINGS,
  schedule: new Map(),
  scheduleInputs: [],
  warehouses: [],
  projects: [],
} as unknown as MfgData

const mockUi = {
  portal: "contractor",
  base: "/contractor/manufacturing",
  data,
  perms: { canManage: true, canWork: true, canQc: true, canCost: false, seesMoney: true, canReceive: false, canRequest: true, canCreate: true },
  today: "2026-09-14",
  views: [],
  viewById: new Map(),
  kpis: { liveCount: 0, wipUnits: 0, lateCount: 0, readyUnits: 0, readyOrders: 0, bottleneck: null },
  decisions: [],
  openOrder: jest.fn(),
  openAction: jest.fn(),
  openNewOrder: jest.fn(),
}

jest.mock("@/components/manufacturing/MfgUiContext", () => ({
  useMfgUi: () => mockUi,
  decisionAllowed: () => true,
}))

beforeEach(() => {
  mockLocale = "en"
  mockToast.mockClear()
})

describe("MfgProductsView", () => {
  it("renders product cards with route, flags and make-vs-buy", () => {
    const { container } = render(<MfgProductsView data={data} />)
    expect(container.textContent).not.toContain("MISSING:")
    const card = screen.getByRole("button", { name: /Marble stairs/ })
    expect(within(card).getByText("Cutting")).toBeInTheDocument()
    expect(within(card).getByText("Polishing")).toBeInTheDocument()
    expect(within(card).getByText("made to measure")).toBeInTheDocument()
    // 300 × 1.2 waste + 0.75 h × 32 overhead + 0.5×40 + 0.25×35 labour = 412.75 → make wins against 900.
    expect(within(card).getByText("make wins")).toBeInTheDocument()
  })

  it("opens the product drawer with route, BOM and cost", () => {
    render(<MfgProductsView data={data} />)
    fireEvent.click(screen.getByRole("button", { name: /Marble stairs/ }))
    const drawer = screen.getByRole("dialog")
    expect(drawer.textContent).not.toContain("MISSING:")
    expect(within(drawer).getByText("Bill of materials per unit")).toBeInTheDocument()
    expect(within(drawer).getByText("Carrara slab")).toBeInTheDocument()
    expect(within(drawer).getByText("Cost of one unit")).toBeInTheDocument()
    expect(within(drawer).getByText("No work order has been made from this card yet")).toBeInTheDocument()
  })

  it("walks the new-product form: validation, route, then the BOM step", () => {
    render(<MfgProductsView data={data} />)
    fireEvent.click(screen.getByRole("button", { name: /New product/ }))
    const form = screen.getByRole("dialog")
    expect(form.textContent).not.toContain("MISSING:")
    fireEvent.click(within(form).getByRole("button", { name: /Next/ }))
    expect(within(form).getByText("Enter the product name")).toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText(/Product name/), { target: { value: "Vanity top" } })
    fireEvent.click(within(form).getByRole("button", { name: /Next/ }))
    expect(within(form).getByText("Pick at least one department")).toBeInTheDocument()

    fireEvent.click(within(form).getByRole("checkbox", { name: "Cutting" }))
    fireEvent.click(within(form).getByRole("button", { name: /Next/ }))
    expect(within(form).getByText("Bill of materials per unit")).toBeInTheDocument()
    fireEvent.click(within(form).getByRole("button", { name: /Add item/ }))
    expect(within(form).getByLabelText("Qty per unit")).toBeInTheDocument()
    expect(form.textContent).not.toContain("MISSING:")
  })

  it("renders in Arabic without missing keys", () => {
    mockLocale = "ar"
    const { container } = render(<MfgProductsView data={data} />)
    expect(container.textContent).not.toContain("MISSING:")
  })
})

describe("MfgSettingsView", () => {
  it("renders the departments table, lines, permissions and finance", () => {
    const { container } = render(<MfgSettingsView data={data} />)
    expect(container.textContent).not.toContain("MISSING:")
    const table = screen.getAllByRole("table")[0]
    expect(within(table).getByText("Cutting")).toBeInTheDocument()
    expect(within(table).getByText("Packing")).toBeInTheDocument()
    expect(screen.getByText("Production lines")).toBeInTheDocument()
    expect(screen.getByText("Setting the sale price is nobody's permission here")).toBeInTheDocument()
    expect(screen.getByText("What goes to Finance")).toBeInTheDocument()
  })

  it("refuses to delete a department that sits on a product route", () => {
    const { deleteDoc } = jest.requireMock<{ deleteDoc: jest.Mock }>("firebase/firestore")
    render(<MfgSettingsView data={data} />)
    fireEvent.click(screen.getByRole("button", { name: "Delete Cutting" }))
    expect(screen.getByText("Cutting cannot be deleted")).toBeInTheDocument()
    expect(screen.getByText(/take it off those routes first/)).toBeInTheDocument()
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }))
    expect(deleteDoc).not.toHaveBeenCalled()
    // No confirmation dialog opens for a refused delete.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("lets a free department through to the confirmation", () => {
    render(<MfgSettingsView data={data} />)
    fireEvent.click(screen.getByRole("button", { name: "Delete Packing" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("No order holds work in it and no product route runs through it")).toBeInTheDocument()
  })

  it("renders in Arabic without missing keys", () => {
    mockLocale = "ar"
    const { container } = render(<MfgSettingsView data={data} />)
    expect(container.textContent).not.toContain("MISSING:")
  })
})

describe("departmentDeleteGuard", () => {
  it("counts product routes and leaves free departments alone", () => {
    expect(departmentDeleteGuard("d-cut", { views: [], orders: [], products })).toEqual({ orders: 0, products: 1 })
    expect(departmentDeleteGuard("d-pack", { views: [], orders: [], products })).toBeNull()
  })
})
