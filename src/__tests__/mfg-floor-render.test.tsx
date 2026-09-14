import { fireEvent, render, screen, within } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { DEFAULT_MFG_SETTINGS, emptyProgress, scheduleOrders, type MfgProduct, type MfgSettings } from "@/lib/manufacturing-engine"
import type { MfgDepartment } from "@/lib/manufacturing"
import type { DeliveryNote } from "@/lib/delivery-notes"
import { toNoteSlice, toOrderSlice, type WorkOrderV2 } from "@/lib/manufacturing-writes"
import { buildOrderViews } from "@/lib/manufacturing-view"
import type { MfgUi } from "@/components/manufacturing/MfgUiContext"
import type { MfgData } from "@/hooks/useMfgData"
import { MfgFloorView } from "@/components/manufacturing/MfgFloorView"

let mockLocale: "ar" | "en" = "en"
const mockMessages = (locale: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8"))

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
    // Plurals: take the `other` branch — enough to read a figure back.
    text = text.replace(/\{(\w+), plural,.*\bother \{([^{}]*)\}\}/g, (_m, name: string, branch: string) => branch.replace("#", String(vars?.[name] ?? "")))
    for (const [name, value] of Object.entries(vars || {})) text = text.replace(`{${name}}`, String(value))
    return text
  },
}))

const mockReplace = jest.fn()
let mockSearch = ""
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mockSearch) }))
jest.mock("@/i18n/routing", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement("a", { href, ...rest }, children),
    usePathname: () => "/contractor/manufacturing/floor",
    useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  }
})

let mockUi: MfgUi
jest.mock("@/components/manufacturing/MfgUiContext", () => ({ useMfgUi: () => mockUi }))

// ---------------------------------------------------------------------------
// Fixture: a stone line (cut → edge → pack) and a joinery line (carpentry → pack)
// ---------------------------------------------------------------------------

const TODAY = "2026-09-14"
const DEPTS: MfgDepartment[] = [
  { id: "cut", organizationId: "org", name: "Cut", order: 1, workers: 2, hoursPerDay: 8, hourlyRate: 70 },
  { id: "edge", organizationId: "org", name: "Edge", order: 2, workers: 2, hoursPerDay: 8, hourlyRate: 60 },
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

function order(id: string, n: number, product: MfgProduct, patch: Partial<WorkOrderV2> = {}): WorkOrderV2 {
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
    neededBy: "2026-09-30",
    createdAtIso: "2026-09-01T08:00:00.000Z",
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
  toWarehouseId: "w1",
  toWarehouseName: "Tower site store",
  toKind: "project",
  status: "in_transit",
  sentByUserId: "u1",
  sentByUserName: "Foreman Ali",
  sentAt: "2026-09-10T09:00:00.000Z",
  ...patch,
})

// Blocked from release: needs a site measurement.
const blocked = order("o1", 101, STONE, { projectId: "pr1", projectName: "Tower" })
// Running: 6 cut, 2 edged + 1 rejected at edge.
const running = order("o2", 102, STONE, {
  releasedAt: "2026-09-05T08:00:00.000Z",
  measurement: { at: "2026-09-04T08:00:00.000Z", by: "Surveyor" },
  progress: progress(STONE, [[6, 0, 4], [2, 1, 2], [0, 0, 0]]),
  source: { kind: "quotation", quotationNumber: "Q-ABC", contactName: "Client A" },
})
// Late and rushed: all packed, 4 on the road.
const late = order("o3", 103, STONE, {
  neededBy: "2026-09-13",
  releasedAt: "2026-09-01T08:00:00.000Z",
  measurement: { at: "2026-08-31T08:00:00.000Z", by: "Surveyor" },
  progress: progress(STONE, [[10, 0, 5], [10, 0, 4], [10, 0, 1]]),
  projectId: "pr1",
  projectName: "Tower",
  rush: { reason: "Owner handover", by: "Manager", at: "2026-09-12T08:00:00.000Z" },
})
// Joinery: released, nothing done yet.
const doors = order("o5", 105, WOOD, { releasedAt: "2026-09-10T08:00:00.000Z", quantity: 6 })

const ORDERS = [blocked, running, late, doors]
const NOTES = [
  note("n1", "o3", { sentAt: "2026-09-12T09:00:00.000Z", driverName: "Saeed", vehiclePlate: "ABC 1234", pieces: 12, crates: 3 }),
  note("n2", "o3", {
    status: "received",
    sentAt: "2026-09-08T09:00:00.000Z",
    receivedAt: "2026-09-09T08:00:00.000Z",
    receivedByUserName: "Engineer Omar",
    toKind: "central",
    toWarehouseName: "Central store",
    item: { name: "x", quantity: 2, unit: "m2", unitCost: 500 },
    brokenQuantity: 1,
  }),
  // A legacy order's note — not a v2 order, never listed.
  note("n9", "legacy", { noteNumber: "DN-LEGACY" }),
]

function buildUi(opts: { settings?: MfgSettings; departments?: MfgDepartment[]; seesMoney?: boolean; canManage?: boolean; canReceive?: boolean } = {}): MfgUi {
  const settings = opts.settings || DEFAULT_MFG_SETTINGS
  const departments = opts.departments || DEPTS
  const productById = new Map([STONE, WOOD].map((p) => [p.id, p]))
  const notesByOrder = new Map<string, DeliveryNote[]>()
  for (const n of NOTES) notesByOrder.set(n.source.workOrderId, [...(notesByOrder.get(n.source.workOrderId) || []), n])
  const scheduleInputs = ORDERS.map((o) => ({ order: toOrderSlice(o), product: productById.get(o.productId!)!, notes: (notesByOrder.get(o.id) || []).map(toNoteSlice) }))
  const schedule = scheduleOrders(scheduleInputs, departments)
  const views = buildOrderViews({ v2Orders: ORDERS, productById, notesByOrder, schedule, settings }, TODAY)
  const data = {
    orgId: "org",
    ready: true,
    departments,
    products: [STONE, WOOD],
    productById,
    orders: ORDERS,
    v2Orders: ORDERS,
    notes: NOTES,
    notesByOrder,
    settings,
    schedule,
    scheduleInputs,
  } as unknown as MfgData
  return {
    portal: "contractor",
    base: "/contractor/manufacturing",
    data,
    perms: {
      canManage: opts.canManage ?? true,
      canWork: true,
      canQc: true,
      canCost: true,
      seesMoney: opts.seesMoney ?? true,
      canReceive: opts.canReceive ?? true,
      canRequest: true,
      canCreate: true,
    },
    today: TODAY,
    views,
    viewById: new Map(views.map((v) => [v.id, v])),
    kpis: { liveCount: 0, wipUnits: 0, lateCount: 0, readyUnits: 0, readyOrders: 0, bottleneck: null },
    decisions: [],
    openOrder: jest.fn(),
    openAction: jest.fn(),
    openNewOrder: jest.fn(),
  }
}

const column = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement

beforeEach(() => {
  mockLocale = "en"
  mockSearch = ""
  mockReplace.mockReset()
  mockUi = buildUi()
})

describe("MfgFloorView — department board", () => {
  it("renders the columns in department order with their cards", () => {
    const { container } = render(<MfgFloorView />)
    expect(container.textContent).not.toContain("MISSING:")

    const headings = screen.getAllByRole("heading").map((h) => h.textContent)
    expect(headings).toEqual(["Awaiting release", "Cut", "Edge", "Carpentry", "Pack", "Ready to deliver", "Awaiting QC decision"])

    // Awaiting release: the measurement-blocked order with its full quantity.
    const release = column("Awaiting release")
    expect(within(release).getByText("#101")).toBeInTheDocument()
    expect(within(release).getByText("Blocked")).toBeInTheDocument()
    expect(release.textContent).toContain("No capacity consumed before release")

    // Cut holds 4 of the running order; Edge holds 3; Carpentry holds all 6 doors.
    expect(within(column("Cut")).getByText("#102")).toBeInTheDocument()
    expect(column("Cut").textContent).toContain("4 m2")
    expect(column("Edge").textContent).toContain("3 m2")
    expect(column("Carpentry").textContent).toContain("6 pc")
    expect(within(column("Carpentry")).getByText("No materials")).toBeInTheDocument()

    // Capacity: workers × hours and the queue.
    expect(column("Carpentry").textContent).toContain("3×8=24")
    expect(screen.getAllByText("Bottleneck")).toHaveLength(1)

    // Ready: the late rushed order, inspected, with its idle value for money roles.
    const ready = column("Ready to deliver")
    expect(within(ready).getByText("#103")).toBeInTheDocument()
    expect(within(ready).getByText("Inspected")).toBeInTheDocument()
    expect(within(ready).getByText("Rush")).toBeInTheDocument()
    expect(ready.textContent).toMatch(/SAR [\d,]+ standing idle/)

    // QC: the rejected piece at Edge.
    expect(column("Awaiting QC decision").textContent).toContain("1 m2")
  })

  it("opens the order drawer from a card", () => {
    render(<MfgFloorView />)
    fireEvent.click(within(column("Edge")).getByRole("button", { name: /#102/ }))
    expect(mockUi.openOrder).toHaveBeenCalledWith("o2")
  })

  it("limits columns and cards to a production line", () => {
    render(<MfgFloorView />)
    const lines = screen.getByRole("group", { name: "Production lines" })
    expect(within(lines).getAllByRole("button").map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"])

    fireEvent.click(within(lines).getByRole("button", { name: /Joinery/ }))
    const headings = screen.getAllByRole("heading").map((h) => h.textContent)
    expect(headings).toEqual(["Awaiting release", "Carpentry", "Pack", "Ready to deliver"])
    expect(screen.queryByText("#101")).not.toBeInTheDocument()
    expect(within(column("Carpentry")).getByText("#105")).toBeInTheDocument()
  })

  it("hides money from roles without cost visibility and shows workers when time is off", () => {
    mockUi = buildUi({ seesMoney: false, settings: { ...DEFAULT_MFG_SETTINGS, features: { ...DEFAULT_MFG_SETTINGS.features, time: false } } })
    render(<MfgFloorView />)
    expect(column("Ready to deliver").textContent).toContain("Awaiting shipment")
    expect(column("Ready to deliver").textContent).not.toContain("SAR")
    expect(column("Carpentry").textContent).toContain("3 workers")
    expect(screen.queryByText("Bottleneck")).not.toBeInTheDocument()
  })

  it("points managers to Settings when there are no departments", () => {
    mockUi = buildUi({ departments: [] })
    render(<MfgFloorView />)
    expect(screen.getByText("No departments yet")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Open Settings/ })).toHaveAttribute("href", "/contractor/manufacturing/settings")

    mockUi = buildUi({ departments: [], canManage: false })
    render(<MfgFloorView />)
    expect(screen.getAllByText("No departments yet")).toHaveLength(2)
    expect(screen.getAllByRole("link", { name: /Open Settings/ })).toHaveLength(1)
  })

  it("renders in Arabic without missing keys", () => {
    mockLocale = "ar"
    const { container } = render(<MfgFloorView />)
    expect(container.textContent).not.toContain("MISSING:")
    expect(screen.getByRole("heading", { name: "بانتظار الإطلاق" })).toBeInTheDocument()
  })
})

describe("MfgFloorView — delivery notes", () => {
  it("switches segment through the URL", () => {
    render(<MfgFloorView />)
    fireEvent.click(screen.getByRole("tab", { name: /Delivery notes/ }))
    expect(mockReplace).toHaveBeenCalledWith("/contractor/manufacturing/floor?seg=notes", { scroll: false })
    // The table shows at once, before the soft navigation lands.
    expect(screen.getByText("DN-n1")).toBeInTheDocument()
  })

  it("lists v2 notes newest first and confirms receipt through the action form", () => {
    mockSearch = "seg=notes"
    const { container } = render(<MfgFloorView />)
    expect(container.textContent).not.toContain("MISSING:")
    expect(screen.getByRole("tab", { name: /Delivery notes/ })).toHaveAttribute("aria-selected", "true")

    const rows = screen.getAllByRole("row").slice(1)
    expect(rows.map((r) => within(r).getByText(/^DN-/).textContent)).toEqual(["DN-n1", "DN-n2"])
    expect(screen.queryByText("DN-LEGACY")).not.toBeInTheDocument()

    expect(rows[0].textContent).toContain("Shipped — awaiting receipt")
    expect(rows[0].textContent).toContain("Saeed")
    expect(rows[0].textContent).toContain("ABC 1234")
    expect(rows[1].textContent).toContain("Received with breakage")
    expect(rows[1].textContent).toContain("Received by Engineer Omar")
    expect(rows[1].textContent).toContain("1 broken")
    expect(within(rows[1]).queryByRole("button", { name: /Confirm receipt/ })).not.toBeInTheDocument()

    fireEvent.click(within(rows[0]).getByRole("button", { name: "Confirm receipt — DN-n1" }))
    expect(mockUi.openAction).toHaveBeenCalledWith("o3", { kind: "confirmNote", noteId: "n1" })
    expect(mockUi.openOrder).not.toHaveBeenCalled()

    fireEvent.click(rows[1])
    expect(mockUi.openOrder).toHaveBeenCalledWith("o3")
  })

  it("offers no confirmation to people who cannot receive", () => {
    mockSearch = "seg=notes"
    mockUi = buildUi({ canManage: false, canReceive: false })
    render(<MfgFloorView />)
    expect(screen.queryByRole("button", { name: /Confirm receipt/ })).not.toBeInTheDocument()
  })

  it("renders the notes in Arabic without missing keys", () => {
    mockLocale = "ar"
    mockSearch = "seg=notes"
    const { container } = render(<MfgFloorView />)
    expect(container.textContent).not.toContain("MISSING:")
    expect(screen.getByRole("button", { name: "تأكيد الاستلام — DN-n1" })).toBeInTheDocument()
  })
})
