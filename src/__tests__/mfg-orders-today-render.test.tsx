/**
 * Render smoke test for Manufacturing → Today, Work orders, the order drawer,
 * every action form and the new-order wizard: each renders from the real
 * message files in both locales with no missing key or placeholder, the
 * decision and row clicks reach the session, and the forms submit the facts
 * their writes expect.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { DEFAULT_MFG_SETTINGS, buildDecisions, emptyProgress, scheduleOrders, type MfgProduct } from "@/lib/manufacturing-engine"
import type { MfgDepartment } from "@/lib/manufacturing"
import type { DeliveryNote } from "@/lib/delivery-notes"
import type { ManufacturingRequest } from "@/lib/sales-orders"
import * as writes from "@/lib/manufacturing-writes"
import { buildOrderViews, computeKpis } from "@/lib/manufacturing-view"
import type { MfgUi, OrderAction } from "@/components/manufacturing/MfgUiContext"
import type { MfgData } from "@/hooks/useMfgData"
import { MfgTodayView } from "@/components/manufacturing/MfgTodayView"
import { MfgOrdersView } from "@/components/manufacturing/MfgOrdersView"
import { MfgOrderDrawer } from "@/components/manufacturing/MfgOrderDrawer"
import { MfgActionForms } from "@/components/manufacturing/MfgActionForms"
import { MfgNewOrderWizard } from "@/components/manufacturing/MfgNewOrderWizard"

const mockWrites = jest.mocked(writes)

// ---------------------------------------------------------------------------
// next-intl stand-in: the real message files with enough ICU (plural + nested
// arguments) to render them, and a loud marker for a missing key or value.
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

jest.mock("next-intl", () => ({
  useLocale: () => mockLocale,
  useTranslations: (namespace: string) => (key: string, vars?: Record<string, unknown>) => {
    const table = namespace
      .split(".")
      .reduce<Record<string, unknown> | undefined>((node, part) => node?.[part] as Record<string, unknown> | undefined, mockMessages(mockLocale))
    const raw = table?.[key]
    return typeof raw === "string" ? mockFormat(raw, vars || {}, mockLocale) : `MISSING:${namespace}.${key}`
  },
}))

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

const mockReplace = jest.fn()
const mockPush = jest.fn()
jest.mock("@/i18n/routing", () => ({
  Link: () => null,
  usePathname: () => "/contractor/manufacturing",
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}), useCollection: () => ({ data: [], isLoading: false }), useMemoFirebase: () => null }))
const mockToast = jest.fn()
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }))
jest.mock("@/hooks/useOrgStock", () => ({
  stockKey: (n: string) => n.trim().toLowerCase(),
  useOrgStock: () => ({ loading: false, byName: new Map([["slab", 5]]), byWarehouse: new Map([["w-central", [{ id: "i1", name: "Slab", unit: "m2", quantity: 5 }]]]) }),
}))
jest.mock("@/lib/manufacturing-writes", () => {
  const actual = jest.requireActual<typeof import("@/lib/manufacturing-writes")>("@/lib/manufacturing-writes")
  const ok = () => jest.fn().mockResolvedValue(undefined)
  return {
    ...actual,
    recordMeasurementV2: ok(),
    recordDrawingApprovalV2: ok(),
    recordSlabApprovalV2: ok(),
    releaseWorkOrderV2: ok(),
    rushWorkOrderV2: ok(),
    reportStageOutput: ok(),
    requestStageMaterials: ok(),
    releaseStageMaterials: ok(),
    confirmStageMaterials: ok(),
    qcDecision: ok(),
    approveScrapV2: ok(),
    issueWorkOrderNoteV2: ok(),
    confirmWorkOrderNoteV2: ok(),
    decideBreakage: ok(),
    toggleChecklistItem: ok(),
    createWorkOrderFromProduct: jest.fn().mockResolvedValue({ id: "wo-new", orderNumber: 110 }),
  }
})
// The legacy stage-flow table has its own data hooks — not under test here.
jest.mock("@/components/manufacturing/ManufacturingView", () => ({ ManufacturingView: () => null }))

let mockUi: MfgUi
jest.mock("@/components/manufacturing/MfgUiContext", () => ({ useMfgUi: () => mockUi }))

// ---------------------------------------------------------------------------
// Fixture: a stone line (cut → edge → pack) and a joinery line
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10)
const daysFromToday = (n: number) => new Date(Date.now() + n * 86400000).toISOString()
const DEPTS: MfgDepartment[] = [
  { id: "cut", organizationId: "org", name: "Cut", order: 1, workers: 2, hoursPerDay: 8, hourlyRate: 70 },
  { id: "edge", organizationId: "org", name: "Edge", order: 2, workers: 2, hoursPerDay: 8, hourlyRate: 60, checklist: [{ key: "flat", label: "Flatness" }] },
  { id: "carp", organizationId: "org", name: "Carpentry", order: 3, workers: 3, hoursPerDay: 8, hourlyRate: 55 },
  { id: "pack", organizationId: "org", name: "Pack", order: 4, workers: 1, hoursPerDay: 8, hourlyRate: 45 },
]

const STONE: MfgProduct = {
  id: "p1",
  organizationId: "org",
  name: "Kitchen counter",
  unit: "m2",
  family: "stone",
  requiresMeasurement: true,
  requiresDrawingApproval: false,
  requiresSlabApproval: false,
  wastePercent: 20,
  salePrice: 1000,
  estimateValue: 700,
  referenceBuyPrice: 900,
  route: [
    { departmentId: "cut", departmentName: "Cut", hoursPerUnit: 0.5 },
    { departmentId: "edge", departmentName: "Edge", hoursPerUnit: 0.4 },
    { departmentId: "pack", departmentName: "Pack", hoursPerUnit: 0.1 },
  ],
  bom: [{ itemName: "Slab", unit: "m2", qtyPerUnit: 1, departmentId: "cut", withWaste: true, unitCost: 300 }],
}

const WOOD: MfgProduct = {
  ...STONE,
  id: "p2",
  name: "Wardrobe door",
  unit: "pc",
  family: "wood",
  requiresMeasurement: false,
  route: [
    { departmentId: "carp", departmentName: "Carpentry", hoursPerUnit: 2 },
    { departmentId: "pack", departmentName: "Pack", hoursPerUnit: 0.2 },
  ],
  bom: [],
}

function order(id: string, n: number, product: MfgProduct, patch: Partial<writes.WorkOrderV2> = {}): writes.WorkOrderV2 {
  return {
    id,
    organizationId: "org",
    orderNumber: n,
    title: `Order ${n}`,
    items: [],
    source: { kind: "manual" },
    status: "open",
    currentStageIndex: 0,
    stages: [],
    createdByUserId: "u1",
    createdByUserName: "Manager",
    productId: product.id,
    quantity: 10,
    neededBy: daysFromToday(16).slice(0, 10),
    createdAtIso: daysFromToday(-13),
    releasedAt: null,
    measurement: null,
    drawingApprovalStatus: "na",
    slabApproval: null,
    rush: null,
    progress: emptyProgress(product.route),
    materials: [],
    scrapRecords: [],
    ...patch,
  }
}

const progress = (product: MfgProduct, rows: Array<[number, number, number]>) =>
  product.route.map((r, i) => ({ departmentId: r.departmentId, done: rows[i][0], rejected: rows[i][1], rework: 0, hours: rows[i][2] }))

const note = (id: string, orderId: string, patch: Partial<DeliveryNote>): DeliveryNote => ({
  id,
  organizationId: "org",
  noteNumber: `DN-${id}`,
  source: { kind: "manufacturing", workOrderId: orderId, workOrderNumber: 0, title: "" },
  item: { name: "Kitchen counter", quantity: 4, unit: "m2", unitCost: 500 },
  toWarehouseId: "w-site",
  toWarehouseName: "Tower site store",
  toKind: "project",
  status: "in_transit",
  sentByUserId: "u1",
  sentByUserName: "Foreman Ali",
  sentAt: daysFromToday(-4),
  ...patch,
})

// Blocked from release: needs a site measurement.
const blocked = order("o1", 101, STONE, { projectId: "pr1", projectName: "Tower" })
// Running: 6 cut, 2 edged + 1 rejected at edge, a pending scrap, materials released at Cut.
const running = order("o2", 102, STONE, {
  releasedAt: daysFromToday(-9),
  measurement: { at: daysFromToday(-10), by: "Surveyor" },
  progress: progress(STONE, [[6, 0, 4], [2, 1, 2], [0, 0, 0]]),
  source: { kind: "quotation", quotationNumber: "Q-ABC", contactName: "Client A" },
  materials: [
    {
      id: "m1",
      requestNumber: "MR-1",
      itemName: "Slab",
      unit: "m2",
      quantity: 6,
      departmentId: "cut",
      lot: null,
      state: "released",
      unitCost: 300,
      warehouseId: "w-central",
      requestedByUserId: "u2",
      requestedByName: "Cutter",
      requestedAt: daysFromToday(-8),
      releasedByName: "Storekeeper",
      releasedAt: daysFromToday(-7),
    },
  ],
  scrapRecords: [
    { id: "s1", quantity: 1, value: 420, reason: "Chipped edge", departmentId: "edge", raisedByUserId: "u3", raisedByName: "QC Lead", raisedAt: daysFromToday(-1), status: "pending" },
  ],
  checklists: { edge: { flat: { by: "QC Lead", at: daysFromToday(-1) } } },
})
// Late and rushed: all packed, 4 on the road, 2 received with 1 broken.
const late = order("o3", 103, STONE, {
  neededBy: daysFromToday(-1).slice(0, 10),
  releasedAt: daysFromToday(-13),
  measurement: { at: daysFromToday(-14), by: "Surveyor" },
  progress: progress(STONE, [[10, 0, 5], [10, 0, 4], [10, 0, 1]]),
  projectId: "pr1",
  projectName: "Tower",
  rush: { reason: "Owner handover", by: "Manager", at: daysFromToday(-2) },
})
const doors = order("o5", 105, WOOD, { releasedAt: daysFromToday(-4), quantity: 6 })

const ORDERS = [blocked, running, late, doors]
const NOTES = [
  note("n1", "o3", { sentAt: daysFromToday(-2), driverName: "Saeed", vehiclePlate: "ABC 1234", pieces: 12, crates: 3 }),
  note("n2", "o3", {
    status: "received",
    sentAt: daysFromToday(-6),
    receivedAt: daysFromToday(-5),
    receivedByUserName: "Engineer Omar",
    toKind: "central",
    toWarehouseName: "Central store",
    item: { name: "x", quantity: 2, unit: "m2", unitCost: 500 },
    brokenQuantity: 1,
  }),
]
const REQUESTS = [
  { id: "r1", requestNumber: "MR-9", status: "new", requestedAt: daysFromToday(-2), contactName: "Client B", lines: [{}, {}] },
  { id: "r2", requestNumber: "MR-8", status: "rejected", requestedAt: daysFromToday(-4), decidedAt: daysFromToday(-1), decidedByUserName: "Manager", rejectionReason: "No capacity" },
] as unknown as ManufacturingRequest[]

function buildUi(): MfgUi {
  const settings = DEFAULT_MFG_SETTINGS
  const productById = new Map([STONE, WOOD].map((p) => [p.id, p]))
  const notesByOrder = new Map<string, DeliveryNote[]>()
  for (const n of NOTES) notesByOrder.set(n.source.workOrderId, [...(notesByOrder.get(n.source.workOrderId) || []), n])
  const scheduleInputs = ORDERS.map((o) => ({ order: writes.toOrderSlice(o), product: productById.get(o.productId!)!, notes: (notesByOrder.get(o.id) || []).map(writes.toNoteSlice) }))
  const schedule = scheduleOrders(scheduleInputs, DEPTS)
  const views = buildOrderViews({ v2Orders: ORDERS, productById, notesByOrder, schedule, settings }, TODAY)
  const decisions = buildDecisions({
    orders: ORDERS.map((o) => ({
      order: writes.toOrderSlice(o),
      product: productById.get(o.productId!)!,
      notes: (notesByOrder.get(o.id) || []).map((n) => ({ ...writes.toNoteSlice(n), id: n.id })),
    })),
    requests: [{ id: "r1", state: "new", ageHours: 48 }],
    estimates: [],
    schedule,
    departments: DEPTS,
    settings,
    today: TODAY,
  })
  const data = {
    orgId: "org",
    actor: { id: "u1", name: "Manager" },
    ready: true,
    departments: DEPTS,
    products: [STONE, WOOD],
    productById,
    orders: ORDERS,
    v2Orders: ORDERS,
    notes: NOTES,
    notesByOrder,
    requests: REQUESTS,
    estimates: [],
    settings,
    schedule,
    scheduleInputs,
    warehouses: [
      { id: "w-site", name: "Tower site store", projectId: "pr1" },
      { id: "w-central", name: "Central store", isCentral: true },
      { id: "w-out", name: "Distribution", isOutbound: true },
    ],
    projects: [{ id: "pr1", name: "Tower" }],
  } as unknown as MfgData
  return {
    portal: "contractor",
    base: "/contractor/manufacturing",
    data,
    perms: { canManage: true, canWork: true, canQc: true, canCost: true, seesMoney: true, canReceive: true, canRequest: true, canCreate: true },
    today: TODAY,
    views,
    viewById: new Map(views.map((v) => [v.id, v])),
    kpis: computeKpis(views, scheduleInputs, DEPTS, true),
    decisions,
    openOrder: jest.fn(),
    openAction: jest.fn(),
    openNewOrder: jest.fn(),
  }
}

const expectNoMissing = () => {
  expect(document.body.textContent).not.toMatch(/MISSING/)
  for (const el of Array.from(document.body.querySelectorAll("[aria-label],[placeholder]"))) {
    expect(`${el.getAttribute("aria-label") || ""}${el.getAttribute("placeholder") || ""}`).not.toMatch(/MISSING/)
  }
}

beforeEach(() => {
  mockLocale = "en"
  mockReplace.mockReset()
  mockPush.mockReset()
  mockToast.mockReset()
  jest.clearAllMocks()
  mockUi = buildUi()
})

describe("MfgTodayView", () => {
  it.each(["en", "ar"] as const)("renders decisions, load and incoming in %s with no missing text", (locale) => {
    mockLocale = locale
    render(<MfgTodayView />)
    expectNoMissing()
  })

  it("turns each decision into a direct action", () => {
    render(<MfgTodayView />)
    expect(screen.getByText("Decisions waiting for you")).toBeInTheDocument()
    expect(screen.getByText("Order #101 blocked: Measurements not taken")).toBeInTheDocument()
    expect(screen.getByText("Answer manufacturing request MR-9")).toBeInTheDocument()
    expect(screen.getByText("Manufacturing request MR-8 returned with a reason")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Record measurement/ }))
    expect(mockUi.openAction).toHaveBeenCalledWith("o1", { kind: "measurement" })

    fireEvent.click(screen.getByRole("button", { name: /^Answer$/ }))
    expect(mockPush).toHaveBeenCalledWith("/contractor/manufacturing/requests?open=r1")
  })
})

describe("MfgOrdersView", () => {
  it.each(["en", "ar"] as const)("renders the order table in %s with no missing text", (locale) => {
    mockLocale = locale
    render(<MfgOrdersView />)
    expectNoMissing()
  })

  it("lists live orders, switches segment through the URL and opens an order", () => {
    render(<MfgOrdersView />)
    const table = screen.getByRole("table")
    expect(within(table).getAllByRole("row", { name: /^Open order/ })).toHaveLength(3)
    expect(table.textContent).toContain("#102")
    expect(table.textContent).toContain("+3 at Edge")

    fireEvent.click(screen.getByRole("tab", { name: /All/ }))
    expect(mockReplace).toHaveBeenCalledWith("/contractor/manufacturing/orders?seg=all", { scroll: false })
    expect(within(screen.getByRole("table")).getByRole("row", { name: "Open order 101" })).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole("table")).getByRole("row", { name: "Open order 102" }))
    expect(mockUi.openOrder).toHaveBeenCalledWith("o2")
  })

  it("filters by search", () => {
    render(<MfgOrdersView />)
    fireEvent.click(screen.getByRole("tab", { name: /All/ }))
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "wardrobe" } })
    const table = screen.getByRole("table")
    expect(table.textContent).toContain("#105")
    expect(table.textContent).not.toContain("#102")
  })
})

describe("MfgOrderDrawer", () => {
  it.each([
    ["en", "o1"],
    ["en", "o2"],
    ["en", "o3"],
    ["ar", "o1"],
    ["ar", "o2"],
    ["ar", "o3"],
  ] as const)("renders order in %s (%s) with no missing text", (locale, id) => {
    mockLocale = locale
    render(<MfgOrderDrawer orderId={id} onClose={jest.fn()} />)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expectNoMissing()
  })

  it("offers the role's actions for a running order", () => {
    render(<MfgOrderDrawer orderId="o2" onClose={jest.fn()} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog.textContent).toContain("Chipped edge")
    expect(dialog.textContent).toContain("MR-1")

    fireEvent.click(within(dialog).getByRole("button", { name: /Report Cut output/ }))
    expect(mockUi.openAction).toHaveBeenCalledWith("o2", { kind: "output", index: 0 })

    fireEvent.click(within(dialog).getByRole("button", { name: /QC decision — Edge/ }))
    expect(mockUi.openAction).toHaveBeenCalledWith("o2", { kind: "qc", index: 1 })
  })
})

const ACTIONS: Array<[string, OrderAction]> = [
  ["o2", { kind: "output", index: 0 }],
  ["o2", { kind: "output", index: 1 }],
  ["o2", { kind: "qc", index: 1 }],
  ["o2", { kind: "materials", departmentId: "cut" }],
  ["o2", { kind: "approveScrap", scrapId: "s1" }],
  ["o2", { kind: "rush" }],
  ["o3", { kind: "note" }],
  ["o3", { kind: "confirmNote", noteId: "n1" }],
  ["o3", { kind: "breakage" }],
  ["o1", { kind: "measurement" }],
  ["o1", { kind: "slab" }],
  ["o1", { kind: "drawing" }],
  ["o1", { kind: "release" }],
  ["o5", { kind: "release" }],
]

describe("MfgActionForms", () => {
  it.each(ACTIONS.flatMap(([id, a]) => (["en", "ar"] as const).map((locale) => [locale, id, a.kind, a] as const)))(
    "renders in %s — %s %s — with no missing text",
    (locale, id, _kind, action) => {
      mockLocale = locale
      render(<MfgActionForms orderId={id} action={action} onClose={jest.fn()} />)
      expect(screen.getByRole("dialog")).toBeInTheDocument()
      expectNoMissing()
    }
  )

  it("reports department output with the good quantity", async () => {
    const onClose = jest.fn()
    render(<MfgActionForms orderId="o2" action={{ kind: "output", index: 0 }} onClose={onClose} />)
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/Good quantity/), { target: { value: "3" } })
    expect(dialog.textContent).toContain("Partial batch — 1 m2 stay in the department")
    expectNoMissing()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Report output/ }))
    })
    expect(mockWrites.reportStageOutput).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ index: 0, done: 3, rejected: 0 }))
    expect(onClose).toHaveBeenCalled()
  })

  it("refuses a measurement without a name", async () => {
    render(<MfgActionForms orderId="o1" action={{ kind: "measurement" }} onClose={jest.fn()} />)
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/Measured by/), { target: { value: " " } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Confirm/ }))
    })
    expect(dialog.textContent).toContain("Enter who took the measurements")
    expect(mockWrites.recordMeasurementV2).not.toHaveBeenCalled()
  })
})

describe("MfgNewOrderWizard", () => {
  it("creates a stock order in two steps and hands back its id", async () => {
    const onCreated = jest.fn()
    render(<MfgNewOrderWizard onClose={jest.fn()} onCreated={onCreated} />)
    const dialog = screen.getByRole("dialog")
    expectNoMissing()

    // Step 1 refuses a project order with no project chosen.
    fireEvent.change(within(dialog).getByLabelText(/Quantity/), { target: { value: "5" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /Next/ }))
    expect(dialog.textContent).toContain("Choose the project")

    fireEvent.click(within(dialog).getByRole("radio", { name: /To stock/ }))
    expect(dialog.textContent).toContain("Standard time for this quantity")
    fireEvent.click(within(dialog).getByRole("button", { name: /Next/ }))

    // Step 2: the date, reviewed against capacity, cost and stock.
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    fireEvent.change(within(dialog).getByLabelText(/Needed by/), { target: { value: due } })
    expect(dialog.textContent).toContain("Possible date")
    expect(dialog.textContent).toContain("Standard cost")
    expect(dialog.textContent).toContain("Reference buy price")
    expect(dialog.textContent).toContain("Needs site measurements before release")
    expect(dialog.textContent).toContain("Slab: 5 available of 6 m2")
    expectNoMissing()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Create order/ }))
    })
    expect(mockWrites.createWorkOrderFromProduct).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantity: 5, neededBy: due, source: { kind: "stock" }, organizationId: "org" })
    )
    expect(onCreated).toHaveBeenCalledWith("wo-new")
  })

  it("renders both steps in Arabic with no missing text", () => {
    mockLocale = "ar"
    render(<MfgNewOrderWizard onClose={jest.fn()} onCreated={jest.fn()} />)
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("radio", { name: /عرض سعر لعميل/ }))
    fireEvent.change(within(dialog).getByLabelText(/^العميل\*$/), { target: { value: "شركة البناء" } })
    fireEvent.change(within(dialog).getByLabelText(/الكمية/), { target: { value: "2" } })
    expectNoMissing()
    fireEvent.click(within(dialog).getByRole("button", { name: /التالي/ }))
    fireEvent.change(within(dialog).getByLabelText(/مطلوب في/), { target: { value: new Date(Date.now() + 86400000).toISOString().slice(0, 10) } })
    expectNoMissing()
  })
})
