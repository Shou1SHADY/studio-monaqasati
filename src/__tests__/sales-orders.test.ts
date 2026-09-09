/**
 * The sales-order engine's proof: quantities derive from delivery notes,
 * invoices derive from deliveries, deposits unwind pro-rata, coverage
 * allocates honestly, and nothing lets a typed number contradict a document.
 */

import {
  allocateCoverage,
  callOffFits,
  committedValue,
  computeInvoice,
  creditVerdict,
  deliveredQty,
  deliveredSales,
  deliveryNoteValue,
  depositNet,
  depositSatisfied,
  depositTotal,
  depositVat,
  frameworkUsage,
  hasUnknownCost,
  inTransitQty,
  isFullyDelivered,
  linesFromQuotationItems,
  nextSalesOrderNumber,
  orderGate,
  orderGross,
  orderLineProgress,
  orderMargin,
  orderNet,
  orderVat,
  resolvePrice,
  returnValue,
  unbilledDeliveries,
  type SalesDeliveryNote,
  type SalesInvoice,
  type SalesOrder,
} from "@/lib/sales-orders"

const baseOrder = (over: Partial<SalesOrder>): SalesOrder => ({
  id: "o1",
  organizationId: "org1",
  orderNumber: 1,
  type: "standard",
  status: "running",
  contactId: "c1",
  contactName: "شركة النرجس",
  payment: { kind: "credit", creditDays: 30 },
  vatPercent: 15,
  lines: [
    { name: "باب خشب HDF", unit: "قطعة", quantity: 40, unitPrice: 1180, unitCost: 800 },
    { name: "خدمة تركيب", unit: "زيارة", quantity: 4, unitPrice: 500, unitCost: null },
  ],
  createdByUserId: "u1",
  createdByUserName: "Tester",
  ...over,
})

const note = (over: Partial<SalesDeliveryNote>): SalesDeliveryNote => ({
  id: "d1",
  organizationId: "org1",
  noteNumber: "SD-AAAAAA",
  orderId: "o1",
  orderNumber: 1,
  contactId: "c1",
  status: "delivered",
  lines: [{ name: "باب خشب HDF", quantity: 24 }],
  deliveredAt: "2026-09-05T10:00:00.000Z",
  createdByUserId: "u1",
  createdByUserName: "Tester",
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────
// Quantities from documents
// ─────────────────────────────────────────────────────────────────────────────

describe("delivered and in-transit quantities", () => {
  const notes = [
    note({ id: "d1", lines: [{ name: "باب خشب HDF", quantity: 24 }] }),
    note({ id: "d2", lines: [{ name: "باب خشب HDF", quantity: 10 }] }),
    note({ id: "d3", status: "requested", lines: [{ name: "باب خشب HDF", quantity: 6 }] }),
    note({ id: "d4", status: "held", lines: [{ name: "باب خشب HDF", quantity: 2 }] }),
    note({ id: "d5", orderId: "OTHER", lines: [{ name: "باب خشب HDF", quantity: 99 }] }),
  ]

  it("sums only DELIVERED notes of the right order", () => {
    expect(deliveredQty("o1", "باب خشب HDF", notes)).toBe(34)
  })

  it("counts requested, authorized and held notes as in transit — the goods are spoken for", () => {
    expect(inTransitQty("o1", "باب خشب HDF", notes)).toBe(8)
  })

  it("matches names case-insensitively and trimmed", () => {
    expect(deliveredQty("o1", "  باب خشب hdf ", notes)).toBe(34)
  })

  it("derives remaining and open per line", () => {
    const order = baseOrder({})
    const lines = orderLineProgress(order, notes)
    const door = lines[0]
    expect(door).toMatchObject({ delivered: 34, inTransit: 8, remaining: 6, open: 0 })
    expect(door.deliveredValue).toBe(34 * 1180)
    // The service line has no notes at all.
    expect(lines[1]).toMatchObject({ delivered: 0, remaining: 4, open: 4 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Order money
// ─────────────────────────────────────────────────────────────────────────────

describe("order totals", () => {
  it("computes net, VAT and gross", () => {
    const order = baseOrder({})
    expect(orderNet(order)).toBe(40 * 1180 + 4 * 500)
    expect(orderVat(order)).toBe(Math.round((40 * 1180 + 4 * 500) * 0.15 * 100) / 100)
    expect(orderGross(order)).toBe(orderNet(order) + orderVat(order))
  })

  it("charges no VAT on an internal sale", () => {
    const order = baseOrder({ type: "internal", contactId: null, projectId: "p1" })
    expect(orderVat(order)).toBe(0)
    expect(orderGross(order)).toBe(orderNet(order))
  })

  it("computes margin only over lines whose cost is known, and flags the gap", () => {
    const order = baseOrder({})
    // Only the door line has a cost: (1180−800)/1180 = 32.2%
    expect(orderMargin(order)).toBe(Math.round(((1180 - 800) / 1180) * 100 * 100) / 100)
    expect(hasUnknownCost(order)).toBe(true)
    expect(orderMargin(baseOrder({ lines: [{ name: "x", unit: "", quantity: 1, unitPrice: 100, unitCost: null }] }))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Deposits
// ─────────────────────────────────────────────────────────────────────────────

describe("deposits", () => {
  const dep = baseOrder({
    payment: { kind: "deposit", depositPercent: 40, depositPaid: false },
  })

  it("computes the deposit from the order net", () => {
    expect(depositNet(dep)).toBe(Math.round(orderNet(dep) * 0.4 * 100) / 100)
    expect(depositVat(dep)).toBe(Math.round(depositNet(dep) * 0.15 * 100) / 100)
    expect(depositTotal(dep)).toBe(depositNet(dep) + depositVat(dep))
  })

  it("gates the order until the deposit is paid", () => {
    expect(depositSatisfied(dep)).toBe(false)
    expect(depositSatisfied({ ...dep, payment: { ...dep.payment, depositPaid: true } })).toBe(true)
    expect(depositSatisfied(baseOrder({}))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Invoices
// ─────────────────────────────────────────────────────────────────────────────

describe("invoices", () => {
  const invoice = (over: Partial<SalesInvoice>): SalesInvoice => ({
    id: "i1",
    organizationId: "org1",
    invoiceNumber: "SI-AAAAAA",
    contactId: "c1",
    deliveryNoteIds: ["d1"],
    vatPercent: 15,
    issueDate: "2026-09-06",
    dueDate: "2026-10-06",
    paid: false,
    createdByUserId: "u1",
    createdByUserName: "Tester",
    ...over,
  })

  it("values a delivery note at ITS order's prices", () => {
    const order = baseOrder({})
    expect(deliveryNoteValue(note({}), order)).toBe(24 * 1180)
    // A note line the order does not know contributes nothing.
    expect(deliveryNoteValue(note({ lines: [{ name: "غير معروف", quantity: 5 }] }), order)).toBe(0)
  })

  it("bills exactly the deliveries it references", () => {
    const order = baseOrder({})
    const notes = [note({ id: "d1" }), note({ id: "d2", lines: [{ name: "باب خشب HDF", quantity: 10 }] })]
    const inv = invoice({ deliveryNoteIds: ["d1", "d2"] })
    const calc = computeInvoice(inv, notes, [order])
    expect(calc.net).toBe(34 * 1180)
    expect(calc.depositRecovery).toBe(0)
    expect(calc.total).toBe(calc.billable + calc.vat)
  })

  it("recovers a paid deposit pro-rata to the delivered share", () => {
    const order = baseOrder({
      payment: { kind: "deposit", depositPercent: 40, depositPaid: true },
      lines: [{ name: "باب خشب HDF", unit: "قطعة", quantity: 40, unitPrice: 1000, unitCost: null }],
    })
    // Deliver half the order → recover half the 40% deposit.
    const half = note({ lines: [{ name: "باب خشب HDF", quantity: 20 }] })
    const calc = computeInvoice(invoice({}), [half], [order])
    expect(calc.net).toBe(20000)
    expect(calc.depositRecovery).toBe(8000) // 40,000 × 40% × (20,000/40,000)
    expect(calc.billable).toBe(12000)
    expect(calc.vat).toBe(1800)
    expect(calc.total).toBe(13800)
  })

  it("does not recover an unpaid deposit", () => {
    const order = baseOrder({ payment: { kind: "deposit", depositPercent: 40, depositPaid: false } })
    const calc = computeInvoice(invoice({}), [note({})], [order])
    expect(calc.depositRecovery).toBe(0)
  })

  it("computes an advance invoice from its own net, recovering nothing", () => {
    const calc = computeInvoice(invoice({ advance: true, deliveryNoteIds: [], advanceNet: 11840 }), [], [])
    expect(calc).toMatchObject({ net: 11840, depositRecovery: 0, billable: 11840 })
    expect(calc.total).toBe(11840 + Math.round(11840 * 0.15 * 100) / 100)
  })

  it("surfaces delivered-but-not-invoiced, excluding internal sales", () => {
    const external = baseOrder({ id: "o1" })
    const internal = baseOrder({ id: "o2", type: "internal", contactId: null, projectId: "p1" })
    const notes = [
      note({ id: "d1", orderId: "o1" }),
      note({ id: "d2", orderId: "o1", lines: [{ name: "باب خشب HDF", quantity: 5 }] }),
      note({ id: "d3", orderId: "o2", lines: [{ name: "باب خشب HDF", quantity: 7 }] }),
      note({ id: "d4", orderId: "o1", status: "requested" }),
    ]
    const invoices = [invoice({ deliveryNoteIds: ["d1"] })]
    const unbilled = unbilledDeliveries(notes, invoices, [external, internal])
    expect(unbilled.notes.map((n) => n.id)).toEqual(["d2"])
    expect(unbilled.value).toBe(5 * 1180)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Frameworks
// ─────────────────────────────────────────────────────────────────────────────

describe("frameworks", () => {
  const frame = baseOrder({
    id: "f1",
    type: "framework",
    frameworkCap: 420000,
    lines: [{ name: "درابزين", unit: "متر", quantity: 0, unitPrice: 400, unitCost: 280 }],
  })
  const co1 = baseOrder({
    id: "co1",
    frameworkId: "f1",
    lines: [{ name: "درابزين", unit: "متر", quantity: 380, unitPrice: 400, unitCost: 280 }],
  })

  it("tracks called-off value against the cap", () => {
    const usage = frameworkUsage(frame, [frame, co1])
    expect(usage.used).toBe(152000)
    expect(usage.remaining).toBe(268000)
    expect(usage.callOffs).toHaveLength(1)
  })

  it("refuses a call-off that busts the cap", () => {
    expect(callOffFits(frame, [frame, co1], 268000)).toBe(true)
    expect(callOffFits(frame, [frame, co1], 268001)).toBe(false)
  })

  it("ignores cancelled call-offs", () => {
    const cancelled = { ...co1, id: "co2", status: "cancelled" as const }
    expect(frameworkUsage(frame, [frame, co1, cancelled]).used).toBe(152000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Coverage
// ─────────────────────────────────────────────────────────────────────────────

describe("coverage allocation", () => {
  it("takes stock first, then work orders, and reports the honest gap", () => {
    const order = baseOrder({
      lines: [{ name: "باب خشب HDF", unit: "قطعة", quantity: 60, unitPrice: 1180, unitCost: null }],
    })
    const cov = allocateCoverage(
      [{ order, lines: orderLineProgress(order, []) }],
      [{ name: "باب خشب HDF", available: 25 }],
      [{ id: "w1", outputName: "باب خشب HDF", remainingQty: 20 }]
    )
    const line = cov.get("o1|باب خشب hdf")
    expect(line).toMatchObject({ fromStock: 25, fromManufacturing: 20, gap: 15 })
    expect(line?.workOrderIds).toEqual(["w1"])
  })

  it("gives scarce stock to the first order in the caller's priority order", () => {
    const first = baseOrder({ id: "oA", lines: [{ name: "بلوك", unit: "قطعة", quantity: 30, unitPrice: 4, unitCost: null }] })
    const second = baseOrder({ id: "oB", lines: [{ name: "بلوك", unit: "قطعة", quantity: 30, unitPrice: 4, unitCost: null }] })
    const cov = allocateCoverage(
      [
        { order: first, lines: orderLineProgress(first, []) },
        { order: second, lines: orderLineProgress(second, []) },
      ],
      [{ name: "بلوك", available: 40 }],
      []
    )
    expect(cov.get("oA|بلوك")).toMatchObject({ fromStock: 30, gap: 0 })
    expect(cov.get("oB|بلوك")).toMatchObject({ fromStock: 10, gap: 20 })
  })

  it("reserves nothing for an unpaid-deposit order", () => {
    const gated = baseOrder({
      id: "oD",
      status: "awaiting_deposit",
      payment: { kind: "deposit", depositPercent: 40, depositPaid: false },
      lines: [{ name: "بلوك", unit: "قطعة", quantity: 10, unitPrice: 4, unitCost: null }],
    })
    const cov = allocateCoverage(
      [{ order: gated, lines: orderLineProgress(gated, []) }],
      [{ name: "بلوك", available: 100 }],
      []
    )
    expect(cov.get("oD|بلوك")).toMatchObject({ fromStock: 0, gap: 10 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Recognition, credit, lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("recognition and reporting", () => {
  it("recognises sales at delivery, splitting external from internal", () => {
    const ext = baseOrder({ id: "o1" })
    const int = baseOrder({ id: "o2", type: "internal", contactId: null })
    const notes = [
      note({ id: "d1", orderId: "o1", deliveredAt: "2026-09-01T08:00:00Z" }),
      note({ id: "d2", orderId: "o2", deliveredAt: "2026-09-02T08:00:00Z", lines: [{ name: "باب خشب HDF", quantity: 3 }] }),
      note({ id: "d3", orderId: "o1", deliveredAt: "2026-07-01T08:00:00Z" }),
    ]
    const s = deliveredSales(notes, [ext, int], "2026-08-15", "2026-09-15")
    expect(s.external).toBe(24 * 1180)
    expect(s.internal).toBe(3 * 1180)
    expect(s.cost).toBe(24 * 800)
  })

  it("computes the standing committed value from running external orders", () => {
    const running = baseOrder({ id: "o1" })
    const closed = baseOrder({ id: "o2", status: "closed" })
    const frame = baseOrder({ id: "o3", type: "framework", frameworkCap: 100000 })
    const value = committedValue([running, closed, frame], [note({ orderId: "o1" })])
    expect(value).toBe((40 - 24) * 1180 + 4 * 500)
  })
})

describe("credit verdicts", () => {
  it("blocks on any overdue balance, warns near the limit, refuses over it", () => {
    expect(creditVerdict({ limit: 100000, outstanding: 20000, overdueDays: 12 }, 1)).toBe("overdue_block")
    expect(creditVerdict({ limit: 100000, outstanding: 50000, overdueDays: 0 }, 60000)).toBe("over_limit")
    expect(creditVerdict({ limit: 100000, outstanding: 50000, overdueDays: 0 }, 40000)).toBe("near_limit")
    expect(creditVerdict({ limit: 100000, outstanding: 10000, overdueDays: 0 }, 20000)).toBe("ok")
  })

  it("treats a zero limit as cash-only", () => {
    expect(creditVerdict({ limit: 0, outstanding: 0, overdueDays: 0 }, 500)).toBe("over_limit")
    expect(creditVerdict({ limit: 0, outstanding: 0, overdueDays: 0 }, 0)).toBe("ok")
  })
})

describe("lifecycle", () => {
  it("declares an order fully delivered only when every line is", () => {
    const order = baseOrder({})
    const partial = [note({})]
    const full = [
      note({ id: "d1", lines: [{ name: "باب خشب HDF", quantity: 40 }] }),
      note({ id: "d2", lines: [{ name: "خدمة تركيب", quantity: 4 }] }),
    ]
    expect(isFullyDelivered(order, partial)).toBe(false)
    expect(isFullyDelivered(order, full)).toBe(true)
    expect(isFullyDelivered(baseOrder({ lines: [] }), [])).toBe(false)
  })

  it("numbers orders sequentially past the highest", () => {
    expect(nextSalesOrderNumber([])).toBe(1)
    expect(nextSalesOrderNumber([{ orderNumber: 7 }, {}])).toBe(8)
  })

  it("builds lines from quotation items, taking costs from the price list and never inventing zeros", () => {
    const lines = linesFromQuotationItems(
      [
        { name: "باب خشب HDF", quantity: 10, unit: "قطعة", unitPrice: 1200 },
        { name: "بند حر", quantity: 2, unit: "قطعة", unitPrice: 900 },
      ],
      [{ name: "باب خشب hdf", cost: 810 }]
    )
    expect(lines[0].unitCost).toBe(810)
    expect(lines[1].unitCost).toBeNull()
  })
})

describe("returns", () => {
  const order = baseOrder({})
  const ret = {
    lines: [{ name: "باب خشب HDF", quantity: 3 }],
    orderId: "o1",
  }

  it("values returned goods at the order's prices", () => {
    expect(returnValue(ret, order)).toBe(3 * 1180)
    expect(returnValue({ ...ret, lines: [{ name: "مجهول", quantity: 5 }] }, order)).toBe(0)
    expect(returnValue(ret, undefined)).toBe(0)
  })
})

describe("gates", () => {
  const flags = [
    { name: "باب خشب HDF", requiresMeasurement: true },
    { name: "خدمة تركيب", requiresApproval: true },
  ]

  it("blocks on measurement only when the plant is actually needed", () => {
    const order = baseOrder({ measurementRecordedAt: null, approvalStatus: "not_required" })
    const lines = orderLineProgress(order, [])
    // 40 doors needed, only 10 free in stock → the rest must be made → gate.
    expect(orderGate(order, lines, flags, [{ name: "باب خشب HDF", available: 10 }])).toBe("measurement")
    // Fully coverable from stock → no measurement needed.
    expect(orderGate(order, lines, flags, [{ name: "باب خشب HDF", available: 100 }])).toBeNull()
  })

  it("opens the gate once the measurement is recorded", () => {
    const order = baseOrder({ measurementRecordedAt: "2026-09-09T10:00:00Z", approvalStatus: "not_required" })
    expect(orderGate(order, orderLineProgress(order, []), flags, [])).toBeNull()
  })

  it("blocks on client approval while a flagged line remains", () => {
    const order = baseOrder({ measurementRecordedAt: "2026-09-09T10:00:00Z", approvalStatus: "awaiting" })
    expect(orderGate(order, orderLineProgress(order, []), flags, [])).toBe("approval")
    const approved = baseOrder({ measurementRecordedAt: "2026-09-09T10:00:00Z", approvalStatus: "approved" })
    expect(orderGate(approved, orderLineProgress(approved, []), flags, [])).toBeNull()
  })

  it("never gates a closed order", () => {
    const order = baseOrder({ status: "closed", measurementRecordedAt: null })
    expect(orderGate(order, orderLineProgress(order, []), flags, [])).toBeNull()
  })
})

describe("price resolution", () => {
  const sources = {
    agreements: [{ contactId: "c6", itemName: "باب خشب HDF", price: 1180, validUntil: "2026-12-31" }],
    tiers: [{ itemName: "باب خشب HDF", tiers: [{ minQty: 40, price: 1150 }, { minQty: 20, price: 1195 }] }],
    listPrice: 1240,
  }

  it("prefers a live client agreement over everything", () => {
    expect(resolvePrice("باب خشب HDF", "c6", 100, "2026-09-09", sources)).toEqual({ price: 1180, source: "agreement" })
  })

  it("falls to the best quantity tier, then the list", () => {
    expect(resolvePrice("باب خشب HDF", "cX", 45, "2026-09-09", sources)).toEqual({ price: 1150, source: "tier" })
    expect(resolvePrice("باب خشب HDF", "cX", 25, "2026-09-09", sources)).toEqual({ price: 1195, source: "tier" })
    expect(resolvePrice("باب خشب HDF", "cX", 5, "2026-09-09", sources)).toEqual({ price: 1240, source: "list" })
  })

  it("ignores an expired agreement", () => {
    expect(resolvePrice("باب خشب HDF", "c6", 25, "2027-01-01", sources).source).toBe("tier")
    expect(resolvePrice("باب خشب HDF", "c6", 5, "2027-01-01", sources).source).toBe("list")
  })

  it("returns null when nothing prices the item", () => {
    expect(resolvePrice("مجهول", null, 1, "2026-09-09", { agreements: [], tiers: [], listPrice: null })).toEqual({
      price: null,
      source: null,
    })
  })
})
