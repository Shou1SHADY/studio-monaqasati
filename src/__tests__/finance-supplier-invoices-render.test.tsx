/**
 * Finance's supplier-invoice list (Supplier 1.0 boundary: "Finance — the invoice → three-way match with the PO and the
 * receipt, then scheduling") rendered for real over our orders, receipts, the supplier's invoices and the transfers
 * Finance reported: the match state, the next share due or "Paid", and a row opening the order.
 */

import { fireEvent, render, renderHook, screen } from "@testing-library/react"
import fs from "fs"
import path from "path"
import type { PoLine, PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"

const mockMessages: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", "en.json"), "utf8"))

function mockFormat(message: string, vars: Record<string, unknown>): string {
  return message.replace(/\{\s*(\w+)\s*(?:,[^{}]*(?:\{[^{}]*\}[^{}]*)*)?\}/g, (_m, name: string) => (name in vars ? String(vars[name]) : `MISSING_VAR:${name}`))
}

jest.mock("next-intl", () => {
  const table = (namespace: string, key: string) =>
    [...namespace.split("."), ...key.split(".")].reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), mockMessages)
  return {
    useLocale: () => "en",
    useTranslations: (namespace: string) => (key: string, vars?: Record<string, unknown>) => {
      const raw = table(namespace, key)
      return typeof raw === "string" ? mockFormat(raw, vars || {}) : `MISSING:${namespace}.${key}`
    },
  }
})

const mockData: Record<string, unknown[]> = { supplierInvoices: [], supplierTransfers: [] }
jest.mock("firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  where: (...args: unknown[]) => args,
  query: (c: { name: string }) => ({ name: c.name }),
}))
jest.mock("@/firebase", () => ({
  useFirestore: () => ({}),
  useMemoFirebase: (fn: () => unknown) => fn(),
  useCollection: (q: { name: string } | null) => ({ data: q ? mockData[q.name] : null, isLoading: false }),
}))

import { SupplierInvoiceRows, useSupplierInvoiceRows } from "@/components/accounting/SupplierInvoiceRows"

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar", unit: "t", quantity: 100, unitPrice: 1000, accepted: 100, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (id: string, docNumber: string, supplierName: string): PurchaseOrder =>
  ({ id, organizationId: "org", docNumber, status: "accepted", supplierOrgId: "s", supplierName, lines: [line()], totalExVat: 100000, vatRate: 0.15, termsList: [{ pct: 100, days: 30 }], log: [] }) as unknown as PurchaseOrder
const receipt = (poId: string, docNumber: string, accepted: number): ReceiptFact => ({
  id: `d-${docNumber}`,
  docNumber,
  status: "confirmed",
  poId,
  lines: [{ poLineId: "l1", name: "Rebar", unit: "t", noticeQuantity: accepted, counted: accepted, accepted, rejected: 0, held: 0 }],
})

const orders = [po("po1", "PO-2026/001", "Al-Hadid"), po("po2", "PO-2026/002", "Cement Co")]
const deliveries = [receipt("po1", "GR-2026/010", 40), receipt("po2", "GR-2026/011", 100)]

beforeEach(() => {
  mockData.supplierInvoices = [
    { id: "a", poId: "po1", buyerOrgId: "org", number: "INV-A", date: "2026-10-01", amountNet: 40000, vat: 0.15, grns: ["GR-2026/010"] },
    { id: "b", poId: "po2", buyerOrgId: "org", number: "INV-B", date: "2026-09-01", amountNet: 90000, vat: 0.15, grns: ["GR-2026/011"] },
    { id: "c", poId: "po-other", buyerOrgId: "org", number: "INV-C", date: "2026-09-01", amountNet: 1, vat: 0, grns: [] },
  ]
  // INV-B is paid in full; a transfer the supplier said never arrived pays nothing.
  mockData.supplierTransfers = [
    { id: "t1", poId: "po2", amount: 103500, state: "ok" },
    { id: "t2", poId: "po1", amount: 46000, state: "miss" },
  ]
})

describe("Finance — supplier invoices", () => {
  it("matches each invoice, schedules it, and lists the unpaid first", () => {
    const { result } = renderHook(() => useSupplierInvoiceRows("org", orders, deliveries))
    const rows = result.current.rows
    // An invoice on an order that is not ours is never shown.
    expect(rows.map((r) => r.inv.number)).toEqual(["INV-A", "INV-B"])
    expect(rows[0].match.state).toBe("match")
    expect(rows[0].schedule.next?.open).toBe(46000)
    expect(rows[1].match.state).toBe("under")
    expect(rows[1].schedule.next).toBeNull()

    const onOpen = jest.fn()
    render(<SupplierInvoiceRows rows={rows} onOpen={onOpen} />)
    expect(screen.getByText("Matches order and receipts")).toBeTruthy()
    expect(screen.getByText("Below its receipts")).toBeTruthy()
    expect(screen.getByText(/Billed .*10,000.* less than its receipts accepted/)).toBeTruthy()
    expect(screen.getByText("Paid")).toBeTruthy()
    expect(screen.getByText(/due Oct 31, 2026|overdue since Oct 31, 2026/)).toBeTruthy()
    fireEvent.click(screen.getByText("INV-A"))
    expect(onOpen).toHaveBeenCalledWith("po1")
  })

  it("flags an invoice naming a receipt we never confirmed", () => {
    mockData.supplierInvoices = [{ id: "x", poId: "po1", buyerOrgId: "org", number: "INV-X", date: "2026-10-01", amountNet: 40000, vat: 0.15, grns: ["GR-2026/999"] }]
    const { result } = renderHook(() => useSupplierInvoiceRows("org", orders, deliveries))
    render(<SupplierInvoiceRows rows={result.current.rows} onOpen={() => {}} />)
    expect(screen.getByText("Check it")).toBeTruthy()
    expect(screen.getByText(/not ours on this order/)).toBeTruthy()
  })
})
