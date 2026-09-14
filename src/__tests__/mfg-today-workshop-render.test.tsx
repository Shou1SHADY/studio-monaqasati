/**
 * Render smoke test for Manufacturing → the manager's Today and the Workshop
 * list: both render from the real message files in both locales with no
 * missing key or placeholder; Today shows one decision card per order with its
 * next step; the Workshop shows counted filter chips and opens an order.
 */

import { fireEvent, render, screen, within } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { DEFAULT_MFG_SETTINGS, emptyProgress, nextStep, ownsCandidate, waitingOn, type Actor, type MfgProduct, type MfgSettings, type Persona } from "@/lib/manufacturing-engine"
import type { MfgDepartment } from "@/lib/manufacturing"
import type { WorkOrderV2 } from "@/lib/manufacturing-writes"
import { buildDecisions, buildWorld, myStations } from "@/lib/manufacturing-view"
import type { MfgUi } from "@/components/manufacturing/MfgUiContext"
import type { MfgData } from "@/hooks/useMfgData"
import { MfgTodayView } from "@/components/manufacturing/MfgTodayView"
import { MfgWorkshopView } from "@/components/manufacturing/MfgWorkshopView"
import { MfgShell } from "@/components/manufacturing/MfgShell"

// ---------------------------------------------------------------------------
// next-intl stand-in: the real message files, enough ICU to render them, and a
// loud marker for a missing key or value.
// ---------------------------------------------------------------------------

let mockLocale: "ar" | "en" = "en"
const mockMessageCache: Record<string, Record<string, unknown>> = {}
const mockMessages = (locale: string): Record<string, unknown> =>
  (mockMessageCache[locale] ||= JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8")))

function mockBranches(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < src.length) {
    const open = src.indexOf("{", i)
    if (open < 0) break
    const key = src.slice(i, open).trim()
    let depth = 0
    let j = open
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++
      else if (src[j] === "}" && --depth === 0) break
    }
    out[key] = src.slice(open + 1, j)
    i = j + 1
  }
  return out
}

function mockFormat(message: string, vars: Record<string, unknown>, locale: string): string {
  let out = ""
  let i = 0
  while (i < message.length) {
    if (message[i] !== "{") {
      out += message[i++]
      continue
    }
    let depth = 0
    let j = i
    for (; j < message.length; j++) {
      if (message[j] === "{") depth++
      else if (message[j] === "}" && --depth === 0) break
    }
    const body = message.slice(i + 1, j)
    const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(body)
    const name = plural ? plural[1] : body.trim()
    if (!(name in vars)) out += `MISSING_VAR:${name}`
    else if (plural) {
      const n = Number(vars[name])
      const branches = mockBranches(plural[2])
      const chosen = branches[`=${n}`] ?? branches[new Intl.PluralRules(locale).select(n)] ?? branches.other ?? ""
      out += mockFormat(chosen.replace(/#/g, String(n)), vars, locale)
    } else out += String(vars[name])
    i = j + 1
  }
  return out
}

jest.mock("next-intl", () => {
  const table = (namespace: string) =>
    namespace.split(".").reduce<Record<string, unknown> | undefined>((node, part) => node?.[part] as Record<string, unknown> | undefined, mockMessages(mockLocale))
  return {
    useLocale: () => mockLocale,
    useTranslations: (namespace: string) => {
      const t = (key: string, vars?: Record<string, unknown>) => {
        const raw = table(namespace)?.[key]
        return typeof raw === "string" ? mockFormat(raw, vars || {}, mockLocale) : `MISSING:${namespace}.${key}`
      }
      t.has = (key: string) => typeof table(namespace)?.[key] === "string"
      return t
    },
  }
})

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy(
    {},
    {
      get: (_target, name) => (name === "__esModule" ? false : (props: Record<string, unknown>) => React.createElement("svg", { "data-icon": String(name), "aria-hidden": props["aria-hidden"] })),
    }
  )
})

const mockPush = jest.fn()
jest.mock("@/i18n/routing", () => ({
  Link: () => null,
  usePathname: () => "/contractor/manufacturing/workshop",
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}))
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }))
jest.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: false, can: () => true, groups: [] }) }))
jest.mock("@/firebase", () => ({ useFirestore: () => null, useCollection: () => ({ data: null, isLoading: false, error: null }), useMemoFirebase: () => null }))
jest.mock("@/components/manufacturing/ManufacturingView", () => ({ ManufacturingView: () => null }))

let mockUi: MfgUi
jest.mock("@/components/manufacturing/MfgUiContext", () => ({ useMfgUi: () => mockUi }))

// ---------------------------------------------------------------------------
// Fixture: a stone line (cut → polish → QC & packing), three orders
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10)
const NOW = Date.now()
const daysFromToday = (n: number) => new Date(NOW + n * 86400000).toISOString()

const DEPTS: MfgDepartment[] = [
  { id: "cut", organizationId: "org", name: "Cutting", order: 1, workers: 2, hoursPerDay: 8, hourlyRate: 70, leadUserId: "u-lead", leadUserName: "Abu Sami" } as MfgDepartment,
  { id: "polish", organizationId: "org", name: "Polishing", order: 2, workers: 2, hoursPerDay: 8, hourlyRate: 60 },
  { id: "qc", organizationId: "org", name: "QC & packing", order: 3, workers: 1, hoursPerDay: 8, hourlyRate: 50 },
]

const PRODUCT: MfgProduct = {
  id: "p1",
  organizationId: "org",
  name: "Kitchen counter",
  unit: "m²",
  family: "stone",
  requiresMeasurement: false,
  requiresDrawingApproval: false,
  requiresSlabApproval: false,
  wastePercent: 20,
  referenceBuyPrice: 900,
  route: [
    { departmentId: "cut", departmentName: "Cutting", hoursPerUnit: 0.5 },
    { departmentId: "polish", departmentName: "Polishing", hoursPerUnit: 0.4 },
    { departmentId: "qc", departmentName: "QC & packing", hoursPerUnit: 0.1 },
  ],
  bom: [{ itemName: "Blade", unit: "pc", qtyPerUnit: 0.01, departmentId: "cut", withWaste: false, unitCost: 50, custody: true }],
}

function order(id: string, n: number, patch: Partial<WorkOrderV2> = {}): WorkOrderV2 {
  return {
    id,
    organizationId: "org",
    orderNumber: n,
    docNumber: `WO-2026/${String(n).padStart(3, "0")}`,
    title: `Order ${n}`,
    items: [],
    source: { kind: "manual" },
    status: "open",
    currentStageIndex: 0,
    stages: [],
    createdByUserId: "u-mgr",
    createdByUserName: "Manager",
    productId: PRODUCT.id,
    sourceKind: "stock",
    quantity: 10,
    neededBy: daysFromToday(20).slice(0, 10),
    createdAtIso: daysFromToday(-5),
    releasedAt: null,
    progress: emptyProgress(PRODUCT.route),
    materials: [],
    scrapRecords: [],
    ...patch,
  } as WorkOrderV2
}

const progress = (rows: Array<[number, number]>) => PRODUCT.route.map((r, i) => ({ departmentId: r.departmentId, done: rows[i][0], rejected: rows[i][1], rework: 0, hours: 0 }))

const ORDERS: WorkOrderV2[] = [
  // Not released yet — the manager's release.
  order("o1", 57),
  // In production and past due: 4 cut, 4 of them at polishing.
  order("o2", 58, {
    releasedAt: daysFromToday(-8),
    neededBy: daysFromToday(-2).slice(0, 10),
    progress: progress([[4, 0], [0, 1], [0, 0]]),
    rejects: [{ id: "r1", index: 1, departmentId: "polish", quantity: 1, defect: "chip", cause: "cut", photoAttached: false, note: null, by: "Abu Ammar", byId: "u-x", at: daysFromToday(-1) }],
    slabApproval: { at: daysFromToday(-7), by: "Lama", lot: "BLK-114" },
  }),
  // In production at QC & packing.
  order("o3", 59, { releasedAt: daysFromToday(-6), progress: progress([[10, 0], [10, 0], [0, 0]]) }),
]

const SETTINGS: MfgSettings = { ...DEFAULT_MFG_SETTINGS }
const STOPS = [{ id: "s1", organizationId: "org", departmentId: "cut", date: TODAY, hours: 2, kind: "machine" as const, note: "Saw bearing", by: "Abu Sami", byId: "u-lead", at: daysFromToday(0) }]
const NOTICES = [{ id: "n1", organizationId: "org", lot: "BLK-114", itemName: "Carrara slab", defect: "crack" as const, note: "Hairline across the block", photosAttached: false, orderIds: ["o2"], by: "Lama", byId: "u-qc", at: daysFromToday(-1) }]
const ACTOR: Actor = { uid: "u-mgr", manage: true, work: false, qc: false, cost: false, view: false }

function buildUi(persona: Persona = "manager", actor: Actor = ACTOR): MfgUi {
  const world = buildWorld({
    today: TODAY,
    nowMs: NOW,
    settings: SETTINGS,
    departments: DEPTS,
    products: new Map([[PRODUCT.id, PRODUCT]]),
    orders: ORDERS,
    notesByOrder: new Map(),
    salesOrders: new Map(),
    stops: STOPS,
    notices: NOTICES,
    stock: null,
  })
  const decisions = buildDecisions({ world, requests: [], estimates: [], departments: DEPTS, settings: SETTINGS, actor, persona, today: TODAY, nowMs: NOW })
  const data = {
    orgId: "org",
    actor: { id: "u-mgr", name: "Badr" },
    engineActor: actor,
    ready: true,
    canManage: true,
    canWork: false,
    canQc: false,
    canCost: false,
    canView: false,
    seesMoney: true,
    departments: DEPTS,
    products: [PRODUCT],
    productById: new Map([[PRODUCT.id, PRODUCT]]),
    orders: ORDERS,
    v2Orders: ORDERS,
    notes: [],
    notesByOrder: new Map(),
    requests: [],
    estimates: [],
    settings: SETTINGS,
    salesOrders: new Map(),
    stops: STOPS,
    notices: NOTICES,
    fleet: [],
    team: [{ id: "u-mgr", name: "Badr", manage: true, work: false, qc: false, cost: false, view: false }],
    stock: null,
    stockRows: new Map(),
    stockLoading: false,
    warehouses: [],
    projects: [],
  } as unknown as MfgData
  return {
    portal: "contractor",
    base: "/contractor/manufacturing",
    data,
    perms: { canManage: true, canWork: false, canQc: false, canCost: false, canView: false, seesMoney: true },
    today: TODAY,
    nowMs: NOW,
    world,
    views: world.views,
    viewById: world.viewById,
    personas: [persona],
    persona,
    setPersona: jest.fn(),
    stations: myStations(actor, DEPTS, persona),
    decisions,
    seesMoney: persona === "manager" || persona === "cost" || persona === "management",
    nextStepOf: (v) => nextStep(v.candidates, actor, DEPTS, SETTINGS),
    waitingOf: (v) => waitingOn(v.candidates, actor, DEPTS, SETTINGS),
    owns: (c) => ownsCandidate(c, actor, DEPTS, SETTINGS),
    openOrder: jest.fn(),
    openAction: jest.fn(),
    openCandidate: jest.fn(),
    openGlobal: jest.fn(),
  }
}

beforeEach(() => {
  mockLocale = "en"
  mockUi = buildUi()
  jest.clearAllMocks()
})

const noMissing = (container: HTMLElement) => {
  expect(container.textContent).not.toMatch(/MISSING/)
}

describe("MfgTodayView — the workshop manager", () => {
  it.each(["en", "ar"] as const)("renders every string in %s", (locale) => {
    mockLocale = locale
    const { container } = render(<MfgTodayView />)
    noMissing(container)
  })

  it("shows one decision card per order with its first action", () => {
    render(<MfgTodayView />)
    const release = screen.getByRole("button", { name: /Release/ })
    fireEvent.click(release)
    expect(mockUi.openCandidate).toHaveBeenCalledWith("o1", expect.objectContaining({ key: "release" }))
    expect(screen.getAllByText(/WO-2026\/057/).length).toBeGreaterThan(0)
  })

  it("lands a KPI on the Workshop filtered the way it counted", () => {
    render(<MfgTodayView />)
    fireEvent.click(screen.getByRole("button", { name: /Late or at risk/ }))
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/contractor/manufacturing/workshop?late=1"))
  })
})

describe("MfgTodayView — the other roles", () => {
  const ROLES: Array<[Persona, Actor]> = [
    ["lead", { uid: "u-lead", manage: false, work: true, qc: false, cost: false, view: false }],
    ["qc", { uid: "u-qc", manage: false, work: false, qc: true, cost: false, view: false }],
    ["cost", { uid: "u-cost", manage: false, work: false, qc: false, cost: true, view: false }],
    ["management", { uid: "u-view", manage: false, work: false, qc: false, cost: false, view: true }],
  ]
  it.each(ROLES.flatMap(([p, a]) => (["en", "ar"] as const).map((l) => [p, a, l] as const)))("renders %s in %s", (persona, actor, locale) => {
    mockLocale = locale
    mockUi = buildUi(persona, actor)
    const { container } = render(<MfgTodayView />)
    noMissing(container)
  })

  it("gives the lead his numbered queue with one button per row", () => {
    mockUi = buildUi("lead", ROLES[0][1])
    render(<MfgTodayView />)
    expect(screen.getByText("My work today — in order")).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: /Record output/ })[0])
    expect(mockUi.openCandidate).toHaveBeenCalledWith("o2", expect.objectContaining({ key: "output", departmentId: "cut" }))
  })

  it("shows the no-role state to someone without a manufacturing role", () => {
    mockUi = { ...buildUi(), persona: null, personas: [] }
    const { container } = render(<MfgTodayView />)
    expect(container.textContent).toContain("You hold no manufacturing role yet")
  })
})

describe("MfgShell — the frame", () => {
  it.each(["en", "ar"] as const)("renders the title, the role switcher and the stock-order action in %s", (locale) => {
    mockLocale = locale
    mockUi = { ...buildUi(), personas: ["manager", "cost"] }
    const { container } = render(
      <MfgShell tab="workshop">
        <div />
      </MfgShell>
    )
    noMissing(container)
    if (locale === "en") {
      expect(screen.getByRole("heading", { name: "Manufacturing" })).toBeInTheDocument()
      expect(screen.getByRole("combobox", { name: "Today as" })).toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: /Stock work order/ }))
      expect(mockUi.openGlobal).toHaveBeenCalledWith({ kind: "stockOrder" })
      expect(screen.queryByRole("button", { name: /request/i })).toBeNull()
    }
  })
})

describe("MfgWorkshopView — the orders list", () => {
  it.each(["en", "ar"] as const)("renders every string in %s", (locale) => {
    mockLocale = locale
    const { container } = render(<MfgWorkshopView />)
    noMissing(container)
  })

  it("counts each filter and the late flag", () => {
    render(<MfgWorkshopView />)
    const filters = screen.getByRole("group", { name: "Filter orders" })
    const prod = within(filters).getByRole("button", { name: /In production/ })
    expect(prod).toHaveTextContent("2")
    const toRelease = within(filters).getByRole("button", { name: /To release/ })
    expect(toRelease).toHaveTextContent("1")
    const late = within(filters).getByRole("button", { name: /Late/ })
    expect(late).toHaveTextContent("1")
    // Filters with nothing in them are hidden.
    expect(within(filters).queryByRole("button", { name: /In transit/ })).toBeNull()
  })

  it.each(["en", "ar"] as const)("renders the board in %s", (locale) => {
    mockLocale = locale
    const { container } = render(<MfgWorkshopView initialView="board" />)
    noMissing(container)
    expect(container.querySelectorAll("section[aria-label]").length).toBe(3)
  })

  it("filters and opens an order", () => {
    render(<MfgWorkshopView />)
    fireEvent.click(within(screen.getByRole("group", { name: "Filter orders" })).getByRole("button", { name: /To release/ }))
    const open = screen.getByRole("button", { name: /Open WO-2026\/057/ })
    expect(screen.queryByRole("button", { name: /Open WO-2026\/058/ })).toBeNull()
    fireEvent.click(open)
    expect(mockUi.openOrder).toHaveBeenCalledWith("o1")
  })
})
