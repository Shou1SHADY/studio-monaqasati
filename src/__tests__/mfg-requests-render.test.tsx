/**
 * Render smoke test for Manufacturing → Requests & cost statements (PRD 1.2):
 * two doors and no "new request", a request read in its panel before it is
 * answered, the answer form's make/decline choice, the cost statement's
 * cost-controller actions and its REQ-09 block — in both locales, from the
 * real message files, with no missing key and no price anywhere.
 */

import { fireEvent, render, screen, within } from "@testing-library/react"
import fs from "fs"
import path from "path"
import { DEFAULT_MFG_SETTINGS, type MfgCostEstimate, type MfgProduct } from "@/lib/manufacturing-engine"
import type { ManufacturingRequest } from "@/lib/sales-orders"
import type { MfgDepartment } from "@/lib/manufacturing"
import type { MfgData } from "@/hooks/useMfgData"
import { MfgRequestsView } from "@/components/manufacturing/MfgRequestsView"
import { AnswerRequestForm, SendEstimateForm } from "@/components/manufacturing/MfgRequestForms"

let mockLocale: "ar" | "en" = "en"
const mockCache: Record<string, Record<string, unknown>> = {}
const mockMessages = (locale: string): Record<string, unknown> =>
  (mockCache[locale] ||= JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8")))

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
  useTranslations: (namespace: string) => {
    const table = () => namespace.split(".").reduce<Record<string, unknown> | undefined>((node, part) => node?.[part] as Record<string, unknown> | undefined, mockMessages(mockLocale))
    const t = (key: string, vars?: Record<string, unknown>) => {
      const raw = table()?.[key]
      return typeof raw === "string" ? mockFormat(raw, vars || {}, mockLocale) : `MISSING:${namespace}.${key}`
    }
    t.has = (key: string) => typeof table()?.[key] === "string"
    return t
  },
}))

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})

jest.mock("@/i18n/routing", () => ({ Link: () => null, usePathname: () => "/contractor/manufacturing/requests", useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))
jest.mock("@/firebase", () => ({ useFirestore: () => ({}) }))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/lib/manufacturing-writes", () => ({
  answerMakeRequest: jest.fn(),
  declineRequest: jest.fn(),
  answerCostingRequest: jest.fn(),
  sendCostStatement: jest.fn(),
  recalculateCostStatement: jest.fn(),
}))

const TODAY = new Date().toISOString().slice(0, 10)
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString()
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)

const departments = [
  { id: "cut", organizationId: "org", name: "Bridge-saw cutting", order: 1, workers: 2, hoursPerDay: 8, hourlyRate: 70 },
  { id: "drill", organizationId: "org", name: "Cut-outs & drilling", order: 2, workers: 1, hoursPerDay: 8, hourlyRate: 65 },
] as MfgDepartment[]

const counter: MfgProduct = {
  id: "p1",
  organizationId: "org",
  name: "Quartz vanity top",
  unit: "m²",
  family: "stone",
  requiresMeasurement: true,
  requiresDrawingApproval: true,
  requiresSlabApproval: true,
  wastePercent: 22,
  referenceBuyPrice: 980,
  route: [
    { departmentId: "cut", departmentName: "Bridge-saw cutting", hoursPerUnit: 0.3 },
    { departmentId: "drill", departmentName: "Cut-outs & drilling", hoursPerUnit: null },
  ],
  bom: [{ itemName: "Quartz slab", unit: "m²", qtyPerUnit: 1, departmentId: "cut", withWaste: true, unitCost: 300 }],
}

const baseRequest = {
  organizationId: "org",
  itemName: counter.name,
  unit: "m²",
  quantity: 8,
  lines: [{ productId: "p1", itemName: counter.name, unit: "m²", quantity: 8 }],
  createdByUserId: "u-sales",
  createdByUserName: "Reem",
}

const requests: ManufacturingRequest[] = [
  { ...baseRequest, id: "r1", requestNumber: "MR-2026/045", status: "new", sourceKind: "sales", kind: "make", orderId: "so1", orderNumber: 134, contactName: "Namaa", neededBy: daysAgo(-20), requestedAt: hoursAgo(30), note: "Show villa vanities" },
  { ...baseRequest, id: "r2", requestNumber: "MR-2026/041", status: "new", sourceKind: "procurement", kind: "make", projectName: "Clinics", purchaseRequestRef: "PR-2026/079", pmRequestRef: "MRQ-2026/063", costItemName: "Flooring", neededBy: daysAgo(-24), requestedAt: hoursAgo(2) },
  { ...baseRequest, id: "r3", requestNumber: "MR-2026/039", status: "rejected", sourceKind: "sales", kind: "make", orderId: "so2", orderNumber: 118, contactName: "Rawabi", rejectionReason: "Not our line", decidedByUserName: "Badr", decidedAt: hoursAgo(50), requestedAt: hoursAgo(60) },
]

const line = { productId: "p1", productName: counter.name, quantity: 6, unit: "m²", materialCost: 2196, labourCost: 126, overheadCost: 57.6, hours: 1.8, totalCost: 2379.6 }
const estimates: MfgCostEstimate[] = [
  { id: "e1", organizationId: "org", estimateNumber: "CE-2026/005", requestId: null, contactId: null, contactName: "Namaa", requestedBy: "Reem", neededBy: daysAgo(-30), validityDays: 15, note: null, lines: [line], state: "draft" },
  { id: "e2", organizationId: "org", estimateNumber: "CE-2026/003", requestId: null, contactId: null, contactName: "Rawabi", requestedBy: "Reem", neededBy: daysAgo(-5), validityDays: 15, note: null, lines: [line], state: "sent", sentAt: daysAgo(20) },
]

const data = {
  orgId: "org",
  actor: { id: "u1", name: "Badr" },
  departments,
  products: [counter],
  productById: new Map([[counter.id, counter]]),
  requests,
  estimates,
  settings: DEFAULT_MFG_SETTINGS,
  salesOrders: new Map([["so1", { id: "so1", payment: { kind: "deposit", depositPercent: 30, depositPaid: false } }]]),
  stock: null,
  stockRows: new Map(),
  team: [],
} as unknown as MfgData

const mockUi = {
  portal: "contractor",
  base: "/contractor/manufacturing",
  data,
  perms: { canManage: true, canWork: false, canQc: false, canCost: true, canView: false, seesMoney: true },
  today: TODAY,
  nowMs: Date.now(),
  world: { views: [], viewById: new Map(), calcs: [], alloc: null, lost: new Map(), schedule: new Map() },
  views: [],
  viewById: new Map(),
  persona: "manager",
  personas: ["manager", "cost"],
  seesMoney: true,
  openGlobal: jest.fn(),
  openOrder: jest.fn(),
}

jest.mock("@/components/manufacturing/MfgUiContext", () => ({ useMfgUi: () => mockUi }))

const noLeaks = (text: string | null) => expect(text).not.toContain("MISSING")

beforeEach(() => {
  mockLocale = "en"
  mockUi.openGlobal.mockClear()
})

describe("MfgRequestsView", () => {
  it("shows the two doors, counted segments and no way to create a request", () => {
    const { container } = render(<MfgRequestsView />)
    noLeaks(container.textContent)
    expect(screen.getByRole("tab", { name: /Awaiting answer/ })).toHaveTextContent("2")
    expect(screen.getByText(/Two doors only/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /new request/i })).not.toBeInTheDocument()
    const card = screen.getByRole("article", { name: /MR-2026\/045/ })
    expect(within(card).getByText(/Overdue/)).toBeInTheDocument()
    expect(within(card).getByText("down payment awaiting Finance")).toBeInTheDocument()
  })

  it("opens the request panel first; the manager answers from there", () => {
    render(<MfgRequestsView />)
    fireEvent.click(within(screen.getByRole("article", { name: /MR-2026\/045/ })).getByRole("button", { name: /Read & answer/ }))
    const panel = screen.getByRole("dialog")
    noLeaks(panel.textContent)
    expect(within(panel).getByText("Line by line — computed verdict")).toBeInTheDocument()
    expect(within(panel).getByText(/Unanswered for/)).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole("button", { name: /Accept or decline/ }))
    expect(mockUi.openGlobal).toHaveBeenCalledWith({ kind: "answerRequest", requestId: "r1" })
  })

  it("lists cost statements with the cost controller's actions only", () => {
    render(<MfgRequestsView initialSegment="estimates" />)
    noLeaks(document.body.textContent)
    expect(screen.getByRole("button", { name: /Review & send to Sales/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Recalculate at today/ }))
    expect(mockUi.openGlobal).toHaveBeenCalledWith({ kind: "recalcEstimate", estimateId: "e2" })
    expect(screen.queryByRole("button", { name: /won|lost|quote/i })).not.toBeInTheDocument()
  })

  it("renders in Arabic without missing keys", () => {
    mockLocale = "ar"
    const { container } = render(<MfgRequestsView initialSegment="all" />)
    noLeaks(container.textContent)
  })
})

describe("the request forms", () => {
  it("answers a sales request: make or decline, the down-payment banner, a reason to decline", () => {
    render(<AnswerRequestForm requestId="r1" onClose={jest.fn()} />)
    const form = screen.getByRole("dialog")
    noLeaks(form.textContent)
    expect(within(form).getByRole("radio", { name: /Make it/ })).toBeInTheDocument()
    expect(within(form).getByText(/cannot be released before it/)).toBeInTheDocument()
    fireEvent.click(within(form).getByRole("radio", { name: /Decline/ }))
    fireEvent.click(within(form).getByRole("button", { name: /Decline and return it/ }))
    expect(within(form).getAllByText("Write the reason — the request returns with it").length).toBeGreaterThan(0)
  })

  it("blocks sending a statement whose route has a step without standard time", () => {
    render(<SendEstimateForm estimateId="e1" onClose={jest.fn()} />)
    const form = screen.getByRole("dialog")
    noLeaks(form.textContent)
    expect(within(form).getByText("Incomplete standard — no partial cost is sent")).toBeInTheDocument()
    expect(within(form).getByText(/no standard time at Cut-outs & drilling/)).toBeInTheDocument()
  })
})
