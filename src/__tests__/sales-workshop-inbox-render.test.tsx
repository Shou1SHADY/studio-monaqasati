/**
 * Render test for what the workshop waits on Sales for (D11): a shop drawing
 * sent to the client is answered from the Sales orders page — found whichever
 * sales order it belongs to, and found at all when the work order names none
 * and carries only its quotation (`Q-…`). Both locales, from the real message
 * files, with no missing key.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { emptyProgress, type MfgProduct } from "@/lib/manufacturing-engine"
import type { WorkOrderV2 } from "@/lib/manufacturing-writes"
import type { SalesOrder } from "@/lib/sales-orders"
import { SalesOrderWorkshopSection, SalesWorkshopInbox } from "@/components/sales/SalesOrderWorkshopSection"

let mockLocale: "ar" | "en" = "en"
const mockCache: Record<string, Record<string, unknown>> = {}
const mockMessages = (locale: string): Record<string, unknown> =>
  (mockCache[locale] ||= JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8")))

/** Simple `{var}` substitution — none of these strings pluralise. */
const mockFormat = (message: string, vars: Record<string, unknown>) =>
  message.replace(/\{(\w+)\}/g, (_m, name: string) => (name in vars ? String(vars[name]) : `MISSING_VAR:${name}`))

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

// The section reads stations and delivery notes; neither matters to a drawing.
jest.mock("firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  query: (c: unknown) => c,
  where: () => ({}),
}))
jest.mock("@/firebase", () => ({
  useFirestore: () => ({}),
  useMemoFirebase: (factory: () => unknown) => factory(),
  useCollection: () => ({ data: [] }),
}))
const mockToast = jest.fn()
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }))

const mockRecordDrawingResult = jest.fn((..._args: unknown[]) => Promise.resolve())
const mockRequestOrderChange = jest.fn((..._args: unknown[]) => Promise.resolve())
jest.mock("@/lib/manufacturing-writes", () => ({
  ...jest.requireActual<typeof import("@/lib/manufacturing-writes")>("@/lib/manufacturing-writes"),
  recordDrawingResult: (...args: unknown[]) => mockRecordDrawingResult(...args),
  requestOrderChange: (...args: unknown[]) => mockRequestOrderChange(...args),
}))
const mockEmit = jest.fn((..._args: unknown[]) => Promise.resolve(1))
jest.mock("@/lib/mfg-events", () => ({
  ...jest.requireActual<typeof import("@/lib/mfg-events")>("@/lib/mfg-events"),
  emitMfgEvent: (...args: unknown[]) => mockEmit(...args),
}))

const ROUTE = [
  { departmentId: "cut", departmentName: "Cutting", hoursPerUnit: 0.1 },
  { departmentId: "qc", departmentName: "QC", hoursPerUnit: 0.02 },
]
const COUNTER: MfgProduct = {
  id: "pr1",
  organizationId: "org",
  name: "Marble countertop",
  unit: "m²",
  family: "stone",
  requiresMeasurement: true,
  requiresDrawingApproval: true,
  requiresSlabApproval: false,
  wastePercent: 0,
  referenceBuyPrice: null,
  route: ROUTE,
  bom: [{ itemName: "Statuario slab", unit: "m²", qtyPerUnit: 1, departmentId: "cut", withWaste: false, unitCost: 900 }],
}

const AT_CLIENT = { revision: 1, approverOrg: "client", submittedAt: "2026-09-16T08:00:00Z", submittedBy: "Badr", submittedById: "badr", code: null, fileUrl: null, fileName: null, note: null, previousC: null } as unknown as WorkOrderV2["drawing"]

const workOrder = (over: Partial<WorkOrderV2>): WorkOrderV2 =>
  ({
    id: "w1",
    organizationId: "org",
    orderNumber: 43,
    docNumber: "WO-2026/043",
    title: "Countertop",
    items: [],
    source: { kind: "manual" },
    sourceKind: "client",
    status: "open",
    currentStageIndex: 0,
    stages: [],
    createdByUserId: "badr",
    createdByUserName: "Badr",
    productId: "pr1",
    productName: "Marble countertop",
    quantity: 10,
    createdAtIso: "2026-09-01T08:00:00Z",
    releasedAt: "2026-09-02T08:00:00Z",
    progress: emptyProgress(ROUTE),
    materials: [],
    scrapRecords: [],
    closures: [],
    survey: { at: "2026-09-01T09:00:00Z", by: "Badr", note: null },
    drawing: AT_CLIENT,
    ...over,
  }) as WorkOrderV2

/** The user's case: a client order that names no sales order, only Q-MFGE2E. */
const ORPHAN = workOrder({ id: "w-orphan", docNumber: "WO-2026/044", salesOrderId: null, source: { kind: "quotation", quotationId: "q-e2e", quotationNumber: "Q-MFGE2E" } })
/** Born of the same quotation as SO-12, without naming it. */
const QUOTE_LINKED = workOrder({ id: "w-quoted", docNumber: "WO-2026/045", salesOrderId: null, source: { kind: "quotation", quotationId: "q12", quotationNumber: "Q-AB12CD" } })
const NAMED = workOrder({ id: "w-named", docNumber: "WO-2026/046", salesOrderId: "so13", salesOrderNumber: 13 })

const salesOrder = (over: Partial<SalesOrder>): SalesOrder =>
  ({
    id: "so12",
    organizationId: "org",
    orderNumber: 12,
    type: "standard",
    status: "running",
    contactId: "c1",
    contactName: "Al-Noor Est.",
    payment: { kind: "credit" },
    vatPercent: 15,
    lines: [{ name: "Marble countertop", unit: "m²", quantity: 10, unitPrice: 1, unitCost: null }],
    measurementRecordedAt: null,
    createdByUserId: "u1",
    createdByUserName: "Reem",
    quotationId: "q12",
    quotationNumber: "Q-AB12CD",
    ...over,
  }) as SalesOrder

const SO12 = salesOrder({})
const SO13 = salesOrder({ id: "so13", orderNumber: 13, contactName: "Dar Al-Bina", quotationId: null, quotationNumber: null })
const ACTOR = { id: "reem", name: "Reem" }

function renderInbox(over: Partial<Parameters<typeof SalesWorkshopInbox>[0]> = {}) {
  const onOpenOrder = jest.fn()
  const utils = render(
    <SalesWorkshopInbox salesOrders={[SO12, SO13]} workOrders={[ORPHAN, QUOTE_LINKED, NAMED]} products={[COUNTER]} orgId="org" actor={ACTOR} canManage onOpenOrder={onOpenOrder} {...over} />
  )
  return { ...utils, onOpenOrder }
}

const rowOf = (ref: string) => screen.getByText(ref).closest("li") as HTMLElement

beforeEach(() => {
  mockLocale = "en"
  jest.clearAllMocks()
})

describe("Sales → Orders: the workshop inbox", () => {
  it("renders nothing while the workshop waits on nothing", () => {
    const answered = { ...AT_CLIENT!, code: "A" } as WorkOrderV2["drawing"]
    const { container } = renderInbox({
      workOrders: [
        workOrder({ drawing: answered }),
        workOrder({ id: "w2", drawing: null }),
        workOrder({ id: "w3", drawing: { ...AT_CLIENT!, approverOrg: "consultant" } as WorkOrderV2["drawing"] }), // the project's to answer
        workOrder({ id: "w4", status: "cancelled" }),
      ],
    })
    expect(container).toBeEmptyDOMElement()
  })

  it("lists every drawing at the client — named, quotation-linked, and one that names no sales order", () => {
    renderInbox()
    expect(screen.getByRole("heading", { name: /The workshop is waiting on the client/ })).toBeInTheDocument()

    // Carries only its quotation: shown under that number, marked, and still actionable.
    const orphan = rowOf("WO-2026/044")
    expect(within(orphan).getByText("Q-MFGE2E")).toBeInTheDocument()
    expect(within(orphan).getByText("No sales order linked")).toBeInTheDocument()
    expect(within(orphan).getByRole("button", { name: "Record the client's result" })).toBeEnabled()

    // Born of SO-12's quotation: read as SO-12's, with its client.
    const quoted = rowOf("WO-2026/045")
    expect(within(quoted).getByText("SO-12")).toBeInTheDocument()
    expect(within(quoted).getByText("Al-Noor Est.")).toBeInTheDocument()
    expect(within(quoted).queryByText("No sales order linked")).toBeNull()

    const named = rowOf("WO-2026/046")
    expect(within(named).getByText("SO-13")).toBeInTheDocument()
    expect(within(named).getByText("Dar Al-Bina")).toBeInTheDocument()
  })

  it("opens the sales order a row belongs to", () => {
    const { onOpenOrder } = renderInbox()
    fireEvent.click(within(rowOf("WO-2026/045")).getByRole("button", { name: "Open the sales order" }))
    expect(onOpenOrder).toHaveBeenCalledWith("so12")
    expect(within(rowOf("WO-2026/044")).queryByRole("button", { name: "Open the sales order" })).toBeNull()
  })

  it("records the client's result on an order with no sales order, and tells the workshop", async () => {
    renderInbox()
    const row = rowOf("WO-2026/044")
    fireEvent.click(within(row).getByRole("button", { name: "Record the client's result" }))

    // B and C must say what the client asked for.
    fireEvent.click(within(row).getAllByRole("radio")[1])
    fireEvent.click(within(row).getByRole("button", { name: /Record result B/ }))
    expect(within(row).getByRole("alert")).toBeInTheDocument()
    expect(mockRecordDrawingResult).not.toHaveBeenCalled()

    fireEvent.change(within(row).getByRole("textbox"), { target: { value: "Ease the edge profile" } })
    fireEvent.click(within(row).getByRole("button", { name: /Record result B/ }))

    await waitFor(() => expect(mockRecordDrawingResult).toHaveBeenCalledTimes(1))
    expect(mockRecordDrawingResult.mock.calls[0][1]).toEqual({ orderId: "w-orphan", code: "B", notes: "Ease the edge profile", approverName: null, actor: ACTOR })
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1))
    expect(mockEmit.mock.calls[0][1]).toMatchObject({
      kind: "drawing_result",
      workOrderId: "w-orphan",
      link: "manufacturing/workshop?order=w-orphan",
      to: [{ permission: "manufacturing.manage" }, { users: ["badr"] }],
      params: { ref: "WO-2026/044", code: "B" },
    })
  })

  it("names the sales order's client as the approver when there is one", async () => {
    renderInbox()
    const row = rowOf("WO-2026/045")
    fireEvent.click(within(row).getByRole("button", { name: "Record the client's result" }))
    fireEvent.click(within(row).getByRole("button", { name: /Record result A/ }))
    await waitFor(() => expect(mockRecordDrawingResult).toHaveBeenCalledTimes(1))
    expect(mockRecordDrawingResult.mock.calls[0][1]).toMatchObject({ orderId: "w-quoted", code: "A", notes: null, approverName: "Al-Noor Est." })
  })

  it("without the Sales permission the rows are read-only", () => {
    renderInbox({ canManage: false })
    expect(screen.getByText("WO-2026/044")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Record the client's result" })).toBeNull()
    expect(screen.getByText(/needs the Sales management permission/)).toBeInTheDocument()
  })

  it.each(["en", "ar"] as const)("has every string in %s", (locale) => {
    mockLocale = locale
    const { container } = renderInbox()
    fireEvent.click(within(container.querySelectorAll("li")[0] as HTMLElement).getAllByRole("button")[0])
    expect(container.textContent).not.toMatch(/MISSING/)
  })
})

describe("a sales order's own workshop section", () => {
  const section = (order: SalesOrder, workOrders: WorkOrderV2[]) =>
    render(<SalesOrderWorkshopSection order={order} workOrders={workOrders} products={[COUNTER]} orgId="org" actor={ACTOR} canManage portal="contractor" />)

  it("shows the order born of its quotation, never another order's", () => {
    section(SO12, [ORPHAN, QUOTE_LINKED, NAMED])
    expect(screen.getByText("WO-2026/045")).toBeInTheDocument()
    expect(screen.queryByText("WO-2026/044")).toBeNull()
    expect(screen.queryByText("WO-2026/046")).toBeNull()
  })

  it("a named order stays with the order it names even when another shares its quotation", () => {
    const stolen = workOrder({ id: "w-x", docNumber: "WO-2026/047", salesOrderId: "so13", source: { kind: "quotation", quotationId: "q12", quotationNumber: "Q-AB12CD" } })
    const { container } = section(SO12, [stolen])
    expect(container).toBeEmptyDOMElement()
  })
})
