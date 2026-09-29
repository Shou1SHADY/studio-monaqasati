/**
 * Every need that reaches Purchasing in one shape: a work order's shortfall, a
 * project's internal request and a stock gap — and an order placed without an
 * RFQ, on an agreement or as a direct purchase under the cap.
 */

import { gapQuantity, mfgNeed, needCounts, needSourceParam, parseNeedSource, projectNeed, returnedNeeds, stockNeeds, type ProjectRequestDoc } from "@/lib/procurement/needs"
import { directOrderRefusal, directLinePrices, directTotal, isSingleSource } from "@/lib/procurement/direct"
import { DEFAULT_POLICIES, type PurchaseOrder } from "@/lib/procurement/types"
import { splitSiblings } from "@/lib/procurement/po"
import type { PurchaseRequestRecord } from "@/lib/manufacturing-engine"
import type { PriceAgreement } from "@/lib/procurement/prices"

const wo = { id: "wo1", ref: "WO-2026/004", context: "Marble slab" }
const req = (over: Partial<PurchaseRequestRecord> = {}): PurchaseRequestRecord => ({
  id: "r1",
  itemName: "Epoxy",
  unit: "can",
  quantity: 4,
  needBy: "2026-10-01",
  note: null,
  by: "Workshop",
  at: "2026-09-20T08:00:00.000Z",
  state: "sent",
  ...over,
})

describe("a work order's shortfall", () => {
  it("is Purchasing's move until an RFQ or an order answers it", () => {
    expect(mfgNeed(wo, req()).state).toBe("action")
    expect(mfgNeed(wo, req({ state: "ordered", rfqId: "q1" })).state).toBe("rfq")
    expect(mfgNeed(wo, req({ state: "ordered", poId: "p1", poNumber: "PO-2026/009" })).state).toBe("order")
    expect(mfgNeed(wo, req({ state: "declined", declinedReason: "wrong spec" })).endNote).toBe("wrong spec")
  })
})

describe("a project's internal request", () => {
  const pr = (over: Partial<ProjectRequestDoc> = {}): ProjectRequestDoc => ({ id: "pr1", title: "Level 2", items: [{ name: "Rebar", quantity: "3", unit: "t" }, { name: "", quantity: "1", unit: "" }], status: "approved", ...over })
  const p = { id: "p1", name: "Villas" }
  it("waits on the warehouse until approved, then is Purchasing's", () => {
    expect(projectNeed(p, pr({ status: "pending" }), "PR-1")).toMatchObject({ state: "waiting", waitingOn: "warehouse" })
    expect(projectNeed(p, pr(), "PR-1").state).toBe("action")
    expect(projectNeed(p, pr({ mfgRequestId: "m1" }), "PR-1")).toMatchObject({ state: "waiting", waitingOn: "workshop" })
    expect(projectNeed(p, pr({ rfqId: "q1" }), "PR-1").state).toBe("rfq")
    expect(projectNeed(p, pr({ poId: "o1" }), "PR-1").state).toBe("order")
    expect(projectNeed(p, pr({ status: "rejected" }), "PR-1").state).toBe("done")
  })
  it("buys only what Inventory did not issue from stock", () => {
    const withLines = (inv: { k: string; kept?: number } | null) => pr({ lines: [{ name: "Rebar", unit: "t", inv }] })
    expect(projectNeed(p, withLines({ k: "issue", kept: 1 }), "PR-1").lines).toEqual([expect.objectContaining({ name: "Rebar", quantity: 1 })])
    expect(projectNeed(p, withLines({ k: "issue", kept: 0 }), "PR-1").lines).toEqual([])
    expect(projectNeed(p, withLines({ k: "none" }), "PR-1").lines).toEqual([expect.objectContaining({ quantity: 3 })])
    expect(projectNeed(p, withLines(null), "PR-1").lines).toEqual([expect.objectContaining({ quantity: 3 })])
  })

  it("keeps only lines with a name and a quantity", () => {
    expect(projectNeed(p, pr(), "PR-1").lines).toEqual([{ name: "Rebar", unit: "t", quantity: 3 }])
  })
})

describe("a stock gap", () => {
  const row = { id: "i1", warehouseId: "w1", warehouseName: "Main", name: "Cement", unit: "bag", quantity: 4, minStockLevel: 10 }
  const order = { id: "o1", docNumber: "PO-2026/002", status: "sent", lines: [{ id: "l1", name: "cement", unit: "bag", quantity: 20, unitPrice: 18, accepted: 0, rejected: 0, held: 0, cancelled: 0 }] } as unknown as PurchaseOrder
  it("appears at or below the minimum, asking for twice the minimum back", () => {
    expect(gapQuantity(4, 10)).toBe(16)
    const [n] = stockNeeds([row, { ...row, id: "i2", quantity: 11 }, { ...row, id: "i3", minStockLevel: null }], { rfqs: [], orders: [] })
    expect(n).toMatchObject({ state: "action", stock: { onHand: 4, min: 10 } })
    expect(n.lines[0].quantity).toBe(16)
  })
  it("is in hand while an open RFQ or a live order names the material", () => {
    expect(stockNeeds([row], { rfqs: [{ id: "q1", status: "New", products: [{ name: "Cement" }] }], orders: [] })[0].state).toBe("rfq")
    expect(stockNeeds([row], { rfqs: [{ id: "q1", status: "Awarded", products: [{ name: "Cement" }] }], orders: [] })[0].state).toBe("action")
    expect(stockNeeds([row], { rfqs: [], orders: [order] })[0]).toMatchObject({ state: "order", poNumber: "PO-2026/002" })
  })
})

it("counts every state", () => {
  const needs = [mfgNeed(wo, req()), mfgNeed(wo, req({ id: "r2", state: "arrived" }))]
  expect(needCounts(needs)).toEqual({ action: 1, waiting: 0, rfq: 0, order: 0, done: 1, all: 2 })
})

it("round-trips the ?source= of every kind, and reads the older form", () => {
  for (const s of [
    { kind: "project_request", projectId: "p1", purchaseRequestId: "pr1" },
    { kind: "stock_gap", warehouseId: "w1", itemId: "i1" },
    { kind: "mfg_purchase", workOrderId: "wo1", purchaseRequestId: "r1" },
  ]) {
    expect(parseNeedSource(needSourceParam(s))).toEqual(s)
  }
  expect(parseNeedSource("wo1:r1")).toEqual({ kind: "mfg_purchase", workOrderId: "wo1", purchaseRequestId: "r1" })
  expect(parseNeedSource("")).toBeNull()
})

describe("an order without an RFQ", () => {
  const today = "2026-09-28"
  const ag = { id: "a1", docNumber: "AG-2026/001", supplierOrgId: "s1", supplierName: "Cement Co", from: "2026-01-01", until: "2026-12-31", lines: [{ name: "Cement", unit: "bag", price: 18 }] } as PriceAgreement
  const base = { reason: "", supplierName: "", policies: DEFAULT_POLICIES, today }
  it("takes the agreement's price, whatever was typed", () => {
    const lines = [{ name: "Cement", unit: "bag", quantity: 100, unitPrice: 99 }]
    expect(directOrderRefusal({ ...base, mode: "agreement", lines, agreement: ag })).toBeNull()
    expect(directTotal(directLinePrices({ mode: "agreement", lines, agreement: ag }))).toBe(1800)
  })
  it("refuses an ended agreement or a line it does not cover", () => {
    const lines = [{ name: "Cement", unit: "bag", quantity: 1, unitPrice: null }]
    expect(directOrderRefusal({ ...base, mode: "agreement", lines, agreement: { ...ag, until: "2026-09-01" } })?.code).toBe("agreement_not_live")
    expect(directOrderRefusal({ ...base, mode: "agreement", lines: [...lines, { name: "Sand", unit: "m3", quantity: 1, unitPrice: null }], agreement: ag })).toEqual({ code: "agreement_line_missing", params: { item: "Sand" } })
  })
  it("a direct purchase needs a supplier and a price on every line; a reason only above the cap (single source)", () => {
    const lines = [{ name: "Epoxy", unit: "can", quantity: 10, unitPrice: 120 }]
    expect(directOrderRefusal({ ...base, mode: "direct", lines })?.code).toBe("order_supplier_missing")
    expect(directOrderRefusal({ ...base, mode: "direct", supplierName: "X", lines: [{ ...lines[0], unitPrice: null }] })?.code).toBe("price_missing")
    expect(directOrderRefusal({ ...base, mode: "direct", supplierName: "X", lines })).toBeNull()
    const big = [{ ...lines[0], quantity: 50 }]
    expect(isSingleSource({ mode: "direct", lines: big, agreement: null, policies: DEFAULT_POLICIES })).toBe(true)
    expect(directOrderRefusal({ ...base, mode: "direct", supplierName: "X", lines: big })?.code).toBe("reason_required")
    expect(directOrderRefusal({ ...base, mode: "direct", supplierName: "X", reason: "sole", lines: big })).toBeNull()
  })
  it("asks for a deliver-by date that is not in the past, when the caller requires one", () => {
    const lines = [{ name: "Epoxy", unit: "can", quantity: 1, unitPrice: 10 }]
    expect(directOrderRefusal({ ...base, mode: "direct", supplierName: "X", lines, requireDeliverBy: true, deliverBy: "" })?.code).toBe("delivery_date_missing")
    expect(directOrderRefusal({ ...base, mode: "direct", supplierName: "X", lines, requireDeliverBy: true, deliverBy: "2026-09-01" })?.code).toBe("delivery_date_missing")
    expect(directOrderRefusal({ ...base, mode: "direct", supplierName: "X", lines, requireDeliverBy: true, deliverBy: "2026-10-01" })).toBeNull()
  })
})

describe("an order on a price agreement", () => {
  const direct = (id: string, over: Partial<PurchaseOrder> = {}) =>
    ({ id, basis: "direct", status: "awaiting_approval", supplierOrgId: "s1", supplierName: "S", isGuestSupplier: false, createdAt: "2026-09-20T00:00:00.000Z", lines: [], totalExVat: 3000, ...over }) as unknown as PurchaseOrder
  it("is not split-checked, and does not count against other direct orders", () => {
    const onAgreement = direct("a", { agreementId: "ag1" })
    expect(splitSiblings(onAgreement, [direct("b")], DEFAULT_POLICIES)).toEqual([])
    expect(splitSiblings(direct("b"), [onAgreement], DEFAULT_POLICIES)).toEqual([])
    expect(splitSiblings(direct("b"), [direct("c")], DEFAULT_POLICIES).map((o) => o.id)).toEqual(["c"])
  })
})

describe("what an order gives back (orders #108, receipts #159)", () => {
  it("a quantity cancelled on the request's order comes back as an action need; nothing else does", () => {
    const p = { id: "p1", name: "Villa" }
    const need = projectNeed(p, { id: "r1", status: "approved", poId: "po1", items: [{ name: "Rebar", quantity: 10, unit: "t" }, { name: "Sand", quantity: 5, unit: "m3" }] } as never, "PR-1")
    const po = { id: "po1", docNumber: "PO-2026/001", lines: [{ id: "l1", name: "Rebar", unit: "t", quantity: 10, accepted: 6, rejected: 0, held: 0, cancelled: 4 }, { id: "l2", name: "Sand", unit: "m3", quantity: 5, accepted: 5, rejected: 0, held: 0, cancelled: 0 }] } as never
    const back = returnedNeeds([need], [po])
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ state: "action", poId: null, returnedFrom: "PO-2026/001", lines: [expect.objectContaining({ name: "Rebar", quantity: 4 })] })
    expect(returnedNeeds([need], [{ ...(po as object), lines: [] } as never])).toEqual([])
  })
})
