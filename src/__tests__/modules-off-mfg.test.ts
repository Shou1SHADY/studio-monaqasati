/**
 * Manufacturing switched off: the core modules stop offering or reading anything that exists only because
 * of it. Behaviour with the module on (the default) is what the other suites already pin.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/accounting/hooks", () => ({
  onQuotationPaymentRecorded: jest.fn(),
  onSalesCreditNoteIssued: jest.fn(),
  onSalesDelivered: jest.fn(),
  onSalesInvoiceIssued: jest.fn(),
  onSalesInvoicePaid: jest.fn(),
}))

const mockRead = new Set<string>()
const mockNone: unknown[] = []
const mockDb = {}
jest.mock("@/firebase", () => ({
  useFirestore: () => mockDb,
  useMemoFirebase: (fn: () => unknown) => fn(),
  useCollection: (q: { path?: string } | null) => {
    if (q?.path) mockRead.add(q.path)
    return { data: mockNone, isLoading: false }
  },
  useDoc: () => ({ data: null, isLoading: false }),
}))

import { renderHook } from "@testing-library/react"
import type { Firestore } from "firebase/firestore"
import { fakeFirestore, listCollection, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { CrmQuotation } from "@/lib/crm"
import type { LineCoverage, ManufacturingRequest, SalesOrder } from "@/lib/sales-orders"
import { todayDecisions, type SalesWorld, type TodayViewer } from "@/lib/sales-today"
import { executionBlocks } from "@/lib/sales-reports"
import { runQuotationAcceptance } from "@/lib/sales"
import { useWorkQueue } from "@/hooks/useWorkQueue"

const db = fakeFirestore as unknown as Firestore
const MANAGER: TodayViewer = { canSell: true, canDecideReturns: true, seesCost: true }
const NOW = Date.parse("2026-09-17T08:00:00Z")

const order = {
  id: "so1",
  organizationId: "org",
  orderNumber: 40,
  type: "standard",
  status: "running",
  contactId: "c1",
  contactName: "Al-Diyar",
  payment: { kind: "credit", creditDays: 30 },
  vatPercent: 15,
  lines: [{ name: "HDF door", unit: "pc", quantity: 120, unitPrice: 1000, unitCost: 700 }],
  promiseDate: "2026-09-10",
} as SalesOrder

const request = (over: Partial<ManufacturingRequest>) =>
  ({ id: "m1", requestNumber: "MR-2026/087", orderId: "so1", orderNumber: 40, itemName: "HDF door", quantity: 40, status: "new", sourceKind: "sales", requestedAt: "2026-09-10T07:00:00Z", rejectionReason: "No capacity", ...over }) as ManufacturingRequest

const coverage: [string, LineCoverage] = ["so1|hdf door", { name: "HDF door", needed: 0, fromStock: 0, fromManufacturing: 0, gap: 40, workOrderIds: [] }]

const world = (over: Partial<SalesWorld> = {}): SalesWorld => ({
  today: "2026-09-17",
  nowMs: NOW,
  quotations: [],
  requests: [],
  orders: [order],
  notes: [],
  returns: [],
  notices: [],
  mfgRequests: [],
  coverage: new Map([coverage]),
  gates: new Map([["so1", "measurement"]]),
  answerWindowHours: 24,
  costDrifts: [],
  ...over,
})

describe("Sales Today with Manufacturing off", () => {
  const declined = world({ mfgRequests: [request({ status: "rejected" })] })
  const kinds = (w: SalesWorld, manufacturing?: boolean) => todayDecisions(w, MANAGER, manufacturing).map((d) => d.kind)

  it("keeps the workshop's decisions by default", () => {
    expect(kinds(declined)).toEqual(expect.arrayContaining(["gate_closed", "mfg_request_declined", "promise_overdue"]))
    expect(kinds(declined, true)).toEqual(kinds(declined))
  })

  it("drops the closed gate and the declined request; a line nothing covers is still the seller's to adjust", () => {
    const off = kinds(declined, false)
    expect(off).not.toContain("gate_closed")
    expect(off).not.toContain("mfg_request_declined")
    expect(off).toEqual(expect.arrayContaining(["line_no_supply", "promise_overdue"]))
  })

  it("an unanswered request past the window is not raised either", () => {
    const stale = world({ orders: [{ ...order, promiseDate: "2026-10-30" } as SalesOrder], coverage: new Map(), gates: new Map(), mfgRequests: [request({})] })
    expect(kinds(stale)).toContain("mfg_request_unanswered")
    expect(kinds(stale, false)).not.toContain("mfg_request_unanswered")
  })
})

describe("Sales Reports with Manufacturing off", () => {
  const w = world({ mfgRequests: [request({})] })

  it("counts gated orders and unanswered requests by default", () => {
    expect(executionBlocks(w)).toMatchObject({ gatedOrders: 1, unansweredRequests: 1, uncoveredOrders: 1 })
  })

  it("counts neither with the module off; the rest is untouched", () => {
    expect(executionBlocks(w, false)).toEqual({ ...executionBlocks(w), gatedOrders: 0, unansweredRequests: 0 })
  })
})

describe("accepting a quotation in a company with no product cards", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("manufacturingDepartments/d1", { organizationId: "org1", name: "Cutting", order: 1 })
    seed("crmQuotations/q1", { organizationId: "org1", status: "sent", quotationNumber: "QT-2026/001", contactId: "c1" })
  })

  const input = (over: { manufacturingOn?: boolean } = {}) => ({
    orgId: "org1",
    user: { id: "reem", name: "Reem" },
    promiseDate: "2026-11-01",
    quotation: {
      id: "q1",
      quotationNumber: "QT-2026/001",
      contactId: "c1",
      contactName: "Al-Diyar",
      amount: 68000,
      items: [{ name: "Steel canopy", quantity: 4, unit: "pc", unitPrice: 17000 }],
      installments: [{ id: "full", label: "After delivery", percent: 100, beforeProduction: false }],
      phase: "pre_manufacturing" as const,
      workOrderId: null,
      vatPercent: 15,
    } as unknown as CrmQuotation & { phase: "pre_manufacturing"; workOrderId: null },
    notification: { title: "t", message: () => "m" },
    ...over,
  })

  it("opens the legacy work order by default", async () => {
    const result = await runQuotationAcceptance(db, input() as unknown as Parameters<typeof runQuotationAcceptance>[1])
    expect(result.workOrderId).toBeTruthy()
    expect(listCollection("workOrders")).toHaveLength(1)
  })

  it("opens none with manufacturingOn false, and the sales order is still born", async () => {
    const result = await runQuotationAcceptance(db, input({ manufacturingOn: false }) as unknown as Parameters<typeof runQuotationAcceptance>[1])
    expect(result.workOrderId).toBeNull()
    expect(result.salesOrderId).toBeTruthy()
    expect(listCollection("workOrders")).toEqual([])
  })
})

describe("the dashboard queue", () => {
  const collectionsRead = (manufacturing?: boolean) => {
    mockRead.clear()
    renderHook(() => useWorkQueue("org", "u1", manufacturing === undefined ? {} : { manufacturing }))
    return new Set(mockRead)
  }

  it("reads the workshop's work orders, notes in transit and requests by default", () => {
    expect(collectionsRead()).toEqual(expect.objectContaining(new Set(["workOrders", "deliveryNotes", "manufacturingRequests"])))
  })

  it("reads none of them with the module off, and everything else as before", () => {
    const off = collectionsRead(false)
    for (const name of ["workOrders", "deliveryNotes", "manufacturingRequests"]) expect(off.has(name)).toBe(false)
    for (const name of ["rfqs", "offers", "salesOrders", "purchaseOrders"]) expect(off.has(name)).toBe(true)
  })
})
