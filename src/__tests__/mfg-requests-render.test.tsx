/**
 * Render smoke test for Manufacturing → Requests & estimates: the segments,
 * a screened request card with its verdict, the two-step answer form, the
 * estimate card's quote logging, the new-request deep link, and both locales
 * rendering from the real message files with no missing key or placeholder.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { DEFAULT_MFG_SETTINGS, addDaysISO, buildEstimateLines, type MfgCostEstimate, type MfgProduct } from "@/lib/manufacturing-engine"
import type { ManufacturingRequest } from "@/lib/sales-orders"
import type { MfgDepartment } from "@/lib/manufacturing"
import * as writes from "@/lib/manufacturing-writes"
import { MfgRequestsView } from "@/components/manufacturing/MfgRequestsView"

const mockWrites = jest.mocked(writes)

// ---------------------------------------------------------------------------
// next-intl stand-in: the real message files, with enough ICU (plural + nested
// arguments) to render them — and a loud marker for any missing key or value.
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
let mockSearch = new URLSearchParams()
jest.mock("@/i18n/routing", () => ({
  Link: () => null,
  usePathname: () => "/contractor/manufacturing/requests",
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
}))
jest.mock("next/navigation", () => ({ useSearchParams: () => mockSearch, usePathname: () => "/", useRouter: () => ({}) }))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}) }))
const mockToast = jest.fn()
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }))
jest.mock("@/hooks/useOrgStock", () => ({
  stockKey: (n: string) => n.trim().toLowerCase(),
  useOrgStock: () => ({ loading: false, byName: new Map([["لوح خشب", 4]]), byWarehouse: new Map([["w1", []]]) }),
}))

jest.mock("@/lib/manufacturing-writes", () => ({
  answerMfgRequestV2: jest.fn().mockResolvedValue({ workOrderIds: ["wo1"], estimateId: null }),
  createMfgRequestV2: jest.fn().mockResolvedValue("r-new"),
  createCostEstimate: jest.fn().mockResolvedValue("e-new"),
  sendCostEstimate: jest.fn().mockResolvedValue(undefined),
  logEstimateQuote: jest.fn().mockResolvedValue(undefined),
  markEstimateWon: jest.fn().mockResolvedValue(["wo2"]),
  markEstimateLost: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@/lib/sales-order-writes", () => ({
  acceptManufacturingRequest: jest.fn().mockResolvedValue("wo-legacy"),
  rejectManufacturingRequest: jest.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// The Manufacturing session a page would provide
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10)
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString()

const DEPTS: MfgDepartment[] = [
  { id: "d1", organizationId: "org", name: "القص", order: 0, workers: 2, hoursPerDay: 8, hourlyRate: 60 },
  { id: "d2", organizationId: "org", name: "التجميع", order: 1, workers: 2, hoursPerDay: 8, hourlyRate: 60 },
]

const PRODUCT: MfgProduct = {
  id: "p1",
  organizationId: "org",
  name: "باب خشب",
  unit: "قطعة",
  family: "wood",
  requiresMeasurement: true,
  requiresDrawingApproval: false,
  requiresSlabApproval: false,
  wastePercent: 20,
  salePrice: null,
  estimateValue: null,
  referenceBuyPrice: 400,
  route: [
    { departmentId: "d1", departmentName: "القص", hoursPerUnit: 0.2 },
    { departmentId: "d2", departmentName: "التجميع", hoursPerUnit: 0.2 },
  ],
  bom: [{ itemName: "لوح خشب", unit: "لوح", qtyPerUnit: 1, departmentId: "d1", withWaste: true, unitCost: 100 }],
}

const baseRequest = {
  organizationId: "org",
  createdByUserId: "u2",
  itemName: "باب خشب",
  unit: "قطعة",
  quantity: 10,
}

const REQUESTS: ManufacturingRequest[] = [
  {
    ...baseRequest,
    id: "r1",
    requestNumber: "MR-NEW111",
    status: "new",
    sourceKind: "project",
    projectId: "pr1",
    projectName: "برج الريان",
    neededBy: addDaysISO(TODAY, 20),
    lines: [{ productId: "p1", itemName: "باب خشب", unit: "قطعة", quantity: 10 }],
    note: "للدور الأرضي",
    createdByUserName: "م. خالد",
    requestedAt: hoursAgo(2),
  },
  {
    ...baseRequest,
    id: "r2",
    requestNumber: "MR-OLD222",
    status: "new",
    orderId: "so1",
    orderNumber: 12,
    contactName: "شركة الأفق",
    itemName: "درابزين",
    unit: "م",
    quantity: 30,
    neededBy: null,
    createdByUserName: "ريم",
    requestedAt: hoursAgo(30),
  },
  {
    ...baseRequest,
    id: "r3",
    requestNumber: "MR-ANS333",
    status: "accepted",
    sourceKind: "project",
    projectName: "برج الريان",
    lines: [{ productId: "p1", itemName: "باب خشب", unit: "قطعة", quantity: 4, makeQuantity: 4 }],
    answerRoute: "make",
    answerNote: "نصنّعها كاملة",
    decidedByUserName: "م. سامي",
    decidedAt: hoursAgo(5),
    workOrderIds: ["wo-x"],
    createdByUserName: "م. خالد",
    requestedAt: hoursAgo(40),
  },
]

const estimate = (over: Partial<MfgCostEstimate>): MfgCostEstimate => ({
  id: "e1",
  organizationId: "org",
  estimateNumber: "CE-SENT01",
  requestId: null,
  contactId: null,
  contactName: "مجموعة النخبة",
  requestedBy: "ريم",
  neededBy: addDaysISO(TODAY, 30),
  validityDays: 15,
  note: null,
  lines: buildEstimateLines([{ product: PRODUCT, quantity: 10 }], DEPTS, DEFAULT_MFG_SETTINGS),
  state: "sent",
  ...over,
})

const ESTIMATES = [estimate({}), estimate({ id: "e2", estimateNumber: "CE-QUOT02", state: "quoted", quoteNumber: "Q-77", quotedPrice: 2500 })]

const perms = { canManage: true, canWork: true, canQc: true, canCost: true, seesMoney: true, canReceive: true, canRequest: true, canCreate: true }

const mockUi = {
  portal: "contractor",
  base: "/contractor/manufacturing",
  data: {
    orgId: "org",
    actor: { id: "u1", name: "م. سامي" },
    ready: true,
    canManage: true,
    canWork: true,
    canQc: true,
    canCost: true,
    seesMoney: true,
    departments: DEPTS,
    products: [PRODUCT],
    productById: new Map([[PRODUCT.id, PRODUCT]]),
    orders: [],
    v2Orders: [],
    notes: [],
    notesByOrder: new Map(),
    requests: REQUESTS,
    estimates: ESTIMATES,
    settings: DEFAULT_MFG_SETTINGS,
    schedule: new Map(),
    scheduleInputs: [],
    warehouses: [{ id: "w1", name: "المستودع" }],
    projects: [{ id: "pr1", name: "برج الريان" }],
  },
  perms,
  today: TODAY,
  views: [],
  viewById: new Map(),
  kpis: { liveCount: 0, wipUnits: 0, lateCount: 0, readyUnits: 0, readyOrders: 0, bottleneck: null },
  decisions: [],
  openOrder: jest.fn(),
  openAction: jest.fn(),
  openNewOrder: jest.fn(),
}
jest.mock("@/components/manufacturing/MfgUiContext", () => ({ useMfgUi: () => mockUi }))

const noMissing = () => {
  expect(document.body.textContent).not.toContain("MISSING")
}

beforeEach(() => {
  mockLocale = "en"
  mockSearch = new URLSearchParams()
  mockUi.perms = { ...perms }
  jest.clearAllMocks()
})

describe("MfgRequestsView", () => {
  it("renders the segments with counts and screens a new request", () => {
    render(<MfgRequestsView />)
    noMissing()
    const tabs = screen.getByRole("tablist")
    expect(within(tabs).getByRole("tab", { name: /Awaiting answer\s*2/ })).toBeInTheDocument()
    expect(within(tabs).getByRole("tab", { name: /Cost estimates\s*2/ })).toBeInTheDocument()
    expect(within(tabs).getByRole("tab", { name: /Answered\s*1/ })).toBeInTheDocument()
    expect(within(tabs).getByRole("tab", { name: /All\s*5/ })).toBeInTheDocument()

    // The project request is screened: make, with the date it is ready by.
    const card = screen.getByRole("heading", { name: "MR-NEW111 — برج الريان" }).closest("article")!
    expect(within(card).getByText("Make")).toBeInTheDocument()
    expect(within(card).getByText(/^Ready .* before the need$/)).toBeInTheDocument()
    expect(within(card).getByText(/Awaiting answer · 22 hours left/)).toBeInTheDocument()

    // The legacy sales request is past the window and has no product card.
    const legacy = screen.getByRole("heading", { name: "MR-OLD222 — شركة الأفق" }).closest("article")!
    expect(within(legacy).getByText(/Answer overdue by 6 hours/)).toBeInTheDocument()
    expect(within(legacy).getByText("No product card")).toBeInTheDocument()
    expect(within(legacy).getByText(/via sales order #12/)).toBeInTheDocument()
  })

  it("opens the answer form, moves to the details step and answers into work orders", async () => {
    render(<MfgRequestsView />)
    const card = screen.getByRole("heading", { name: "MR-NEW111 — برج الريان" }).closest("article")!
    fireEvent.click(within(card).getByRole("button", { name: /Read & answer/ }))

    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Answer MR-NEW111")).toBeInTheDocument()
    expect(within(dialog).getByRole("radio", { name: /To manufacturing/ })).toHaveAttribute("aria-checked", "true")
    expect(within(dialog).getByText(/Your answer is logged in your name \(م. سامي\) and returns to م. خالد/)).toBeInTheDocument()
    noMissing()

    fireEvent.click(within(dialog).getByRole("button", { name: /Next/ }))
    expect(within(dialog).getByText("We make")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Quantity we make of باب خشب")).toHaveValue(10)
    expect(within(dialog).getByText("Creates 1 work order for what we make — in م. خالد's name")).toBeInTheDocument()
    noMissing()

    // Over-asking is refused inline, not silently clamped.
    fireEvent.change(within(dialog).getByLabelText("Quantity we make of باب خشب"), { target: { value: "12" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm the answer/ }))
    expect(within(dialog).getByText("At most 10")).toBeInTheDocument()
    expect(mockWrites.answerMfgRequestV2).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText("Quantity we make of باب خشب"), { target: { value: "6" } })
    expect(within(dialog).getByText(/4 units go back to procurement/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Confirm the answer/ }))
    })
    expect(mockWrites.answerMfgRequestV2).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ route: "make", makeLines: [expect.objectContaining({ makeQuantity: 6 })] })
    )
  })

  it("requires a reason to return a request to procurement", () => {
    render(<MfgRequestsView />)
    const card = screen.getByRole("heading", { name: "MR-NEW111 — برج الريان" }).closest("article")!
    fireEvent.click(within(card).getByRole("button", { name: /Read & answer/ }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("radio", { name: /To procurement/ }))
    fireEvent.click(within(dialog).getByRole("button", { name: /Next/ }))
    fireEvent.click(within(dialog).getByRole("button", { name: /Return to procurement/ }))
    expect(within(dialog).getAllByText(/Write the reason/).length).toBeGreaterThan(0)
    expect(mockWrites.answerMfgRequestV2).not.toHaveBeenCalled()
  })

  it("locks answering for someone who is not the workshop manager", () => {
    mockUi.perms = { ...perms, canManage: false }
    render(<MfgRequestsView />)
    expect(screen.queryByRole("button", { name: /Read & answer/ })).not.toBeInTheDocument()
    expect(screen.getAllByText("Only the workshop manager answers").length).toBe(2)
  })

  it("opens a request's drawer with its line-by-line screening", () => {
    render(<MfgRequestsView />)
    const card = screen.getByRole("heading", { name: "MR-NEW111 — برج الريان" }).closest("article")!
    fireEvent.click(within(card).getByRole("button", { name: /Details/ }))
    const drawer = screen.getByRole("dialog")
    expect(within(drawer).getByText("What is requested — line by line")).toBeInTheDocument()
    expect(within(drawer).getByText(/Material: لوح خشب — needs 12 لوح/)).toBeInTheDocument()
    expect(within(drawer).getByText("available 4")).toBeInTheDocument()
    expect(within(drawer).getByRole("button", { name: "Answer the request" })).toBeInTheDocument()
    noMissing()
  })

  it("shows cost estimates and logs a quote below the floor only with a named approval", () => {
    render(<MfgRequestsView initialSegment="estimates" />)
    noMissing()
    const sent = screen.getByRole("heading", { name: "CE-SENT01 — مجموعة النخبة" }).closest("article")!
    expect(within(sent).getByText("Set in Sales — not the workshop's call")).toBeInTheDocument()
    const quoted = screen.getByRole("heading", { name: "CE-QUOT02 — مجموعة النخبة" }).closest("article")!
    expect(within(quoted).getByRole("button", { name: /Won — create work orders/ })).toBeInTheDocument()

    fireEvent.click(within(sent).getByRole("button", { name: /Log the quote issued by sales/ }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/Quote number/), { target: { value: "Q-1" } })
    fireEvent.change(within(dialog).getByLabelText(/Quoted price/), { target: { value: "100" } })
    fireEvent.change(within(dialog).getByLabelText(/Issued by/), { target: { value: "ريم" } })
    expect(within(dialog).getByLabelText(/Finance approval/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: /Log the quote/ }))
    expect(mockWrites.logEstimateQuote).not.toHaveBeenCalled()
    noMissing()
  })

  it("opens the new-request form from ?new=1 and shows the expected answer", () => {
    mockSearch = new URLSearchParams("new=1")
    render(<MfgRequestsView />)
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Request manufacturing")).toBeInTheDocument()
    expect(within(dialog).getByText("What answer to expect")).toBeInTheDocument()
    expect(mockReplace).toHaveBeenCalledWith("/contractor/manufacturing/requests")
    fireEvent.click(within(dialog).getByRole("button", { name: /Send request/ }))
    expect(within(dialog).getByText("Pick the date it is needed by")).toBeInTheDocument()
    expect(mockWrites.createMfgRequestV2).not.toHaveBeenCalled()
    noMissing()
  })

  it("renders in Arabic without missing keys", () => {
    mockLocale = "ar"
    render(<MfgRequestsView />)
    noMissing()
    expect(screen.getByRole("tab", { name: /بانتظار الرد/ })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: /اقرأ وردّ/ })[0])
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /التالي/ }))
    noMissing()
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "إلغاء" }))
    fireEvent.click(screen.getByRole("tab", { name: /الكل/ }))
    noMissing()
  })
})
