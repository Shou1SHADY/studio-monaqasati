/**
 * Manufacturing's boundary with the other modules: who hears about an event
 * and in which language, what Sales may promise of stock the workshop holds,
 * which gate a sales order reads from its work orders, and the ledger entry a
 * received remnant rides on.
 */

import fs from "fs"
import path from "path"
import { buildNotification, holdersOf, notificationCopy, notificationHref, resolveRecipients, type TeamSnapshot } from "@/lib/mfg-events"
import { emptyProgress, type DeptCapacityFields, type MfgProduct } from "@/lib/manufacturing-engine"
import { belongsToSalesOrder, clientDrawingsDue, clientRefOf, heldByItem, salesOrderOfWorkOrder, workshopGatesFor, workshopHolds } from "@/lib/manufacturing-view"
import { allocateCoverage, orderGate, orderLineProgress, type SalesOrder } from "@/lib/sales-orders"
import { postMfgRemnantReceipt } from "@/lib/accounting/posting-rules"
import { ACC } from "@/lib/accounting/accounts"
import type { WorkOrderV2 } from "@/lib/manufacturing-writes"

const ROOT = path.join(__dirname, "..", "..")

// ─────────────────────────────────────────────────────────────────────────────
// Recipients
// ─────────────────────────────────────────────────────────────────────────────

const team: TeamSnapshot = {
  ownerId: "owner",
  members: [
    { id: "owner", organizationRole: "owner" },
    { id: "badr", defaultGroupId: "g-manager" },
    { id: "lama", defaultGroupId: "g-qc" },
    { id: "noura", defaultGroupId: "g-cost" },
    { id: "sami", defaultGroupId: "g-hands" },
    { id: "salma", defaultGroupId: "g-store" },
    { id: "admin", defaultGroupId: "g-all" },
    { id: "pm", defaultGroupId: "g-hands" },
  ],
  groups: [
    { id: "g-manager", permissions: ["manufacturing.manage"] },
    { id: "g-qc", permissions: ["manufacturing.qc"] },
    { id: "g-cost", permissions: ["manufacturing.cost"] },
    { id: "g-hands", permissions: ["manufacturing.work"] },
    { id: "g-store", permissions: ["warehouses.manage"] },
    { id: "g-all", permissions: ["*"] },
    { id: "g-pm", permissions: ["projects.edit"] },
  ],
  projectMembers: new Map([["p1", new Map([["pm", "g-pm"]])]]),
  departments: [
    { id: "cut", name: "Cutting", workers: 2, hoursPerDay: 8, hourlyRate: 70, leadUserId: "sami" },
    { id: "pol", name: "Polishing", workers: 2, hoursPerDay: 8, hourlyRate: 60 },
    { id: "qc", name: "QC & packing", workers: 1, hoursPerDay: 8, hourlyRate: 45, qcStation: true },
  ] as DeptCapacityFields[],
}

describe("event recipients (NT-01)", () => {
  it("a permission reaches the owner, its holders and '*' groups", () => {
    expect(holdersOf(team, "manufacturing.manage").sort()).toEqual(["admin", "badr", "owner"])
  })

  it("never tells the actor of their own act", () => {
    expect(resolveRecipients(team, [{ permission: "manufacturing.manage" }], "badr").sort()).toEqual(["admin", "owner"])
  })

  it("a station is its lead; the QC station is Quality; a lead-less station falls back to the managers", () => {
    expect(resolveRecipients(team, [{ station: "cut" }], "x")).toEqual(["sami"])
    expect(resolveRecipients(team, [{ station: "qc" }], "x").sort()).toEqual(["admin", "lama", "owner"])
    expect(resolveRecipients(team, [{ station: "pol" }], "x").sort()).toEqual(["admin", "badr", "owner"])
    expect(resolveRecipients(team, [{ station: "missing" }], "x")).toEqual([])
  })

  it("a project permission adds the project's own members", () => {
    const to = resolveRecipients(team, [{ projectPermission: "projects.edit", projectId: "p1" }], "x")
    expect(to).toContain("pm")
    expect(to).not.toContain("sami")
  })

  it("explicit users are deduplicated and blanks dropped", () => {
    expect(resolveRecipients(team, [{ users: ["lama", null, undefined, "", "lama"] }, { permission: "manufacturing.qc" }], "x").sort()).toEqual(["admin", "lama", "owner"])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Copy — the reader's language, not the sender's
// ─────────────────────────────────────────────────────────────────────────────

const messages = (locale: "en" | "ar") => JSON.parse(fs.readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")).Portal.Shared as Record<string, string>

/** Plain `{name}` substitution — enough for these checks (ICU syntax parity is guarded by i18n-coverage). */
const translator = (dict: Record<string, string>) => {
  const t = ((key: string, params?: Record<string, string | number>) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`))) as ((key: string, params?: Record<string, string | number>) => string) & { has: (key: string) => boolean }
  t.has = (key: string) => key in dict
  return t
}

describe("notification copy", () => {
  const kinds = (() => {
    const src = fs.readFileSync(path.join(ROOT, "src", "lib", "mfg-events.ts"), "utf8")
    const block = src.slice(src.indexOf("export type MfgEventKind ="), src.indexOf("/** Who is told."))
    return Array.from(block.matchAll(/\|\s*"([a-z_]+)"/g), (m) => m[1])
  })()

  it("every event kind has a title and a message in both languages", () => {
    expect(kinds.length).toBeGreaterThan(30)
    for (const locale of ["en", "ar"] as const) {
      const dict = messages(locale)
      const missing = kinds.flatMap((k) => [`mfn_${k}_title`, `mfn_${k}`]).filter((key) => !(key in dict))
      expect({ locale, missing }).toEqual({ locale, missing: [] })
    }
  })

  it("renders from keys in the reader's language and translates @key params", () => {
    const n = buildNotification(
      { kind: "scrap_approved", organizationId: "org", actor: { id: "noura", name: "Noura" }, to: [], params: { ref: "WO-2026/053", classification: "@mfo_scrap_class_abnormal" }, workOrderId: "wo53" },
      "badr",
      "2026-09-13T09:00:00Z"
    )
    expect(n.i18n).toEqual({ title: "mfn_scrap_approved_title", message: "mfn_scrap_approved", params: { actor: "Noura", ref: "WO-2026/053", classification: "@mfo_scrap_class_abnormal" } })
    const en = notificationCopy(n, translator(messages("en")))
    const ar = notificationCopy(n, translator(messages("ar")))
    expect(en.message).toContain("Noura")
    expect(en.message).toContain(messages("en").mfo_scrap_class_abnormal)
    expect(ar.message).toContain(messages("ar").mfo_scrap_class_abnormal)
    expect(en.title).not.toEqual(ar.title)
  })

  it("stores text rendered in the sender's language — push and the mobile app read it", () => {
    const n = buildNotification(
      { kind: "materials_issued", copy: translator(messages("ar")), organizationId: "org", actor: { id: "salma", name: "سلمى" }, to: [], params: { number: "WR-2026/181", ref: "WO-2026/055", dept: "القص", warehouse: "الرئيسي" } },
      "sami",
      "2026-09-13T09:00:00Z"
    )
    expect(n.title).toContain("WR-2026/181")
    expect(n.message).toContain("سلمى")
    expect(n.message).not.toMatch(/\{\w+\}/)
  })

  it("falls back to the stored text for notifications without keys", () => {
    expect(notificationCopy({ title: "Old", message: "Plain" }, translator(messages("en")))).toEqual({ title: "Old", message: "Plain" })
    expect(notificationCopy({ title: "Old", message: "Plain", i18n: { title: "nope_title" } }, translator(messages("en")))).toEqual({ title: "Old", message: "Plain" })
  })

  it("portal-relative links open under the reader's portal; absolute ones as they are", () => {
    expect(notificationHref("manufacturing/workshop?order=o1", "supplier")).toBe("/supplier/manufacturing/workshop?order=o1")
    expect(notificationHref("/contractor/sales/orders", "supplier")).toBe("/contractor/sales/orders")
    expect(notificationHref(null, "contractor")).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Stock the workshop holds — promised once
// ─────────────────────────────────────────────────────────────────────────────

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
const workOrder = (over: Partial<WorkOrderV2>): WorkOrderV2 =>
  ({
    id: "w1",
    organizationId: "org",
    orderNumber: 43,
    docNumber: "WO-2026/043",
    title: "Countertop",
    items: [],
    source: { kind: "manual" },
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
    drawing: { code: "A", submittedAt: "2026-09-01T10:00:00Z", approverOrg: "client" },
    ...over,
  }) as WorkOrderV2

describe("workshop holds (MAT-04)", () => {
  const products = new Map([[COUNTER.id, COUNTER]])
  const depts = team.departments

  it("a released order reserves what the store has and reports the rest as short", () => {
    const holds = workshopHolds({ orders: [workOrder({})], products, departments: depts, stock: { onHand: new Map([["statuario slab", 6]]), lots: [] } })
    expect(holds).toHaveLength(1)
    expect(holds[0]).toMatchObject({ itemName: "Statuario slab", onHand: 6, reserved: 6, short: 4, free: 0 })
    expect(holds[0].orders).toEqual([{ id: "w1", ref: "WO-2026/043", quantity: 6 }])
    expect(heldByItem(holds).get("statuario slab")).toBe(6)
  })

  it("an unreleased, cancelled or done order holds nothing", () => {
    const stock = { onHand: new Map([["statuario slab", 20]]), lots: [] }
    expect(workshopHolds({ orders: [workOrder({ releasedAt: null })], products, departments: depts, stock })).toEqual([])
    expect(workshopHolds({ orders: [workOrder({ status: "cancelled" })], products, departments: depts, stock })).toEqual([])
  })

  it("Sales coverage offers only what the workshop does not hold", () => {
    const so: SalesOrder = {
      id: "so1",
      organizationId: "org",
      orderNumber: 9,
      type: "standard",
      status: "running",
      contactId: "c1",
      payment: { kind: "credit", creditDays: 30 },
      vatPercent: 15,
      lines: [{ name: "Statuario slab", unit: "m²", quantity: 8, unitPrice: 1400, unitCost: 900 }],
      createdByUserId: "u1",
      createdByUserName: "Rep",
    }
    const lines = orderLineProgress(so, [])
    const free = allocateCoverage([{ order: so, lines }], [{ name: "Statuario slab", available: 10 }], [])
    expect(free.get("so1|statuario slab")).toMatchObject({ fromStock: 8, gap: 0 })
    const held = allocateCoverage([{ order: so, lines }], [{ name: "Statuario slab", available: 10 }], [], new Map([["statuario slab", 6]]))
    expect(held.get("so1|statuario slab")).toMatchObject({ fromStock: 4, gap: 4 })
  })

  it("a work order made for one sales order never covers another", () => {
    const mk = (id: string): SalesOrder => ({
      id,
      organizationId: "org",
      orderNumber: 1,
      type: "standard",
      status: "running",
      contactId: "c1",
      payment: { kind: "credit" },
      vatPercent: 15,
      lines: [{ name: "Marble countertop", unit: "m²", quantity: 10, unitPrice: 1, unitCost: null }],
      createdByUserId: "u1",
      createdByUserName: "Rep",
    })
    const a = mk("soA")
    const b = mk("soB")
    const cov = allocateCoverage(
      [
        { order: a, lines: orderLineProgress(a, []) },
        { order: b, lines: orderLineProgress(b, []) },
      ],
      [],
      [{ id: "w1", outputName: "Marble countertop", remainingQty: 10, salesOrderId: "soB" }]
    )
    expect(cov.get("soA|marble countertop")).toMatchObject({ fromManufacturing: 0, gap: 10 })
    expect(cov.get("soB|marble countertop")).toMatchObject({ fromManufacturing: 10, gap: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gates read from the work order (T5, T7)
// ─────────────────────────────────────────────────────────────────────────────

describe("sales order gates from its work orders", () => {
  const products = new Map([[COUNTER.id, COUNTER]])

  it("a made-to-measure order without a survey gates on measurement", () => {
    const { gates, lineKeys } = workshopGatesFor("so1", [workOrder({ salesOrderId: "so1", survey: null, measurement: null })], products)
    expect(gates).toEqual([{ gate: "measurement", orderId: "w1", ref: "WO-2026/043" }])
    expect(lineKeys.has("marble countertop")).toBe(true)
  })

  it("only a drawing at the client is Sales' gate; a draft or an A is not", () => {
    const atClient = workshopGatesFor("so1", [workOrder({ salesOrderId: "so1", drawing: { submittedAt: "2026-09-02T08:00:00Z", approverOrg: "client", code: null } as WorkOrderV2["drawing"] })], products)
    expect(atClient.gates.map((g) => g.gate)).toEqual(["approval"])
    expect(workshopGatesFor("so1", [workOrder({ salesOrderId: "so1", drawing: null })], products).gates).toEqual([])
    expect(workshopGatesFor("so1", [workOrder({ salesOrderId: "so1" })], products).gates).toEqual([])
    expect(workshopGatesFor("other", [workOrder({ salesOrderId: "so1", survey: null })], products).gates).toEqual([])
  })

  it("lines made on work orders ignore the sales order's own flags", () => {
    const so: SalesOrder = {
      id: "so1",
      organizationId: "org",
      orderNumber: 3,
      type: "standard",
      status: "running",
      contactId: "c1",
      payment: { kind: "credit" },
      vatPercent: 15,
      lines: [{ name: "Marble countertop", unit: "m²", quantity: 10, unitPrice: 1, unitCost: null }],
      measurementRecordedAt: null,
      createdByUserId: "u1",
      createdByUserName: "Rep",
    }
    const flags = [{ name: "Marble countertop", requiresMeasurement: true }]
    const lines = orderLineProgress(so, [])
    expect(orderGate(so, lines, flags, [])).toBe("measurement")
    expect(orderGate(so, lines, flags, [], new Set(["marble countertop"]))).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A client order Sales can always find (D11) — even one that names no sales order
// ─────────────────────────────────────────────────────────────────────────────

describe("a client work order and its sales order", () => {
  const products = new Map([[COUNTER.id, COUNTER]])
  const atClient = { submittedAt: "2026-09-02T08:00:00Z", approverOrg: "client", code: null, revision: 1 } as WorkOrderV2["drawing"]
  const fromQuote = (over: Partial<WorkOrderV2> = {}) =>
    workOrder({ salesOrderId: null, sourceKind: "client", source: { kind: "quotation", quotationId: "q1", quotationNumber: "Q-MFGE2E" }, ...over })

  it("belongs to the sales order it names — a shared quotation never overrides that", () => {
    const named = fromQuote({ salesOrderId: "so1" })
    expect(belongsToSalesOrder(named, { id: "so1" })).toBe(true)
    expect(belongsToSalesOrder(named, { id: "so2", quotationId: "q1", quotationNumber: "Q-MFGE2E" })).toBe(false)
  })

  it("naming none, belongs to the sales order born of the same quotation — by id, else by number", () => {
    expect(belongsToSalesOrder(fromQuote(), { id: "so1", quotationId: "q1" })).toBe(true)
    expect(belongsToSalesOrder(fromQuote(), { id: "so1", quotationId: "q2", quotationNumber: "Q-MFGE2E" })).toBe(false)
    const numberOnly = fromQuote({ source: { kind: "quotation", quotationNumber: "Q-MFGE2E" } })
    expect(belongsToSalesOrder(numberOnly, { id: "so1", quotationNumber: "Q-MFGE2E" })).toBe(true)
    expect(belongsToSalesOrder(numberOnly, { id: "so1", quotationNumber: "Q-OTHER1" })).toBe(false)
    // Neither side naming a quotation is not a match.
    expect(belongsToSalesOrder(workOrder({ salesOrderId: null }), { id: "so1", quotationId: null, quotationNumber: null })).toBe(false)
  })

  it("finds its sales order among many, or none", () => {
    const orders = [{ id: "so1", quotationId: "q9" }, { id: "so2", quotationId: "q1" }]
    expect(salesOrderOfWorkOrder(fromQuote(), orders)?.id).toBe("so2")
    expect(salesOrderOfWorkOrder(fromQuote({ source: { kind: "quotation", quotationId: "q404" } }), orders)).toBeNull()
  })

  it("the sales order's gate counts the quotation-born order too", () => {
    const so = { id: "so1", quotationId: "q1", quotationNumber: "Q-MFGE2E" }
    expect(workshopGatesFor(so, [fromQuote({ drawing: atClient })], products).gates.map((g) => g.gate)).toEqual(["approval"])
    expect(workshopGatesFor("so1", [fromQuote({ drawing: atClient })], products).gates).toEqual([])
  })

  it("every drawing at the client is due from Sales — linked or not, oldest first", () => {
    const linked = workOrder({ id: "w1", salesOrderId: "so1", drawing: { ...atClient!, submittedAt: "2026-09-05T08:00:00Z" } })
    const orphan = fromQuote({ id: "w2", drawing: atClient })
    const due = clientDrawingsDue(
      [
        linked,
        orphan,
        workOrder({ id: "w3", salesOrderId: "so1" }), // already an A
        workOrder({ id: "w4", drawing: { ...atClient!, approverOrg: "consultant" } }), // the project's, not Sales'
        workOrder({ id: "w5", status: "cancelled", drawing: atClient }),
        workOrder({ id: "w6", productId: "gone", drawing: atClient }), // no product card to compute from
      ],
      products
    )
    expect(due.map((o) => o.id)).toEqual(["w2", "w1"])
  })

  it("names the client's side as Sales does: the sales order, else the quotation", () => {
    expect(clientRefOf(fromQuote(), { orderNumber: 12 })).toBe("SO-12")
    expect(clientRefOf(fromQuote({ salesOrderNumber: 7 }))).toBe("SO-7")
    expect(clientRefOf(fromQuote())).toBe("Q-MFGE2E")
    expect(clientRefOf(workOrder({ salesOrderId: null }))).toBe("")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ledger — remnants back into stock (INV-06)
// ─────────────────────────────────────────────────────────────────────────────

describe("remnant receipt posting", () => {
  it("moves the remnant value from WIP to raw materials, keyed by the remnant", () => {
    const r = postMfgRemnantReceipt({ workOrderId: "w1", orderNumber: 43, remnantId: "r2", date: "2026-09-13", value: 540, itemName: "Statuario slab", projectId: "p1", projectName: "Villa" })
    expect(r.sourceType).toBe("mfg_remnant_receipt")
    expect(r.sourceId).toBe("w1__r2")
    const debit = r.lines.reduce((a, l) => a + (l.debit || 0), 0)
    const credit = r.lines.reduce((a, l) => a + (l.credit || 0), 0)
    expect(debit).toBe(540)
    expect(credit).toBe(540)
    expect(r.lines.find((l) => l.debit)?.account).toBe(ACC.inventoryMaterials)
    expect(r.lines.find((l) => l.credit)?.account).toBe(ACC.inventoryWip)
    expect(r.lines.every((l) => l.project === "p1")).toBe(true)
    expect(postMfgRemnantReceipt({ workOrderId: "w1", orderNumber: 43, remnantId: "r3", date: "2026-09-13", value: 0, itemName: "x" }).empty).toBe(true)
  })
})
