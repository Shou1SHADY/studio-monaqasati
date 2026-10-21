/**
 * Procurement 2.0 — what a package change means for the records a company already has (NFR-08, PKG-04, WF-22): the
 * planner counts and plans, never deletes, never touches a closed order or a reply with a live work order. Ports
 * qa_review R-34 and qa_boundary B-03 / B-13.
 */

import {
  CONNECTOR_IMPACT,
  IMPACT_KEYS,
  emptySnapshot,
  measureImpact,
  planChange,
  planPackageChange,
  savedOff,
  sitesToLink,
  type PackageSnapshot,
  type SnapshotOrder,
} from "@/lib/procurement/package-migration"
import { BASE_PACKAGE, FULL_PACKAGE } from "@/lib/procurement/package"
import { readImpactReport, impactQuiet } from "@/lib/procurement/package-impact-report"

const order = (id: string, over: Record<string, unknown> = {}): SnapshotOrder =>
  ({ id, docNumber: `PO-2026/${id}`, status: "accepted", approvedAt: "2026-10-01T08:00:00Z", totalExVat: 1000, vatRate: 0.15, lines: [{ id: "l1", name: "x", unit: "u", quantity: 10, unitPrice: 100, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], log: [], ...over }) as unknown as SnapshotOrder

const snap = (over: Partial<PackageSnapshot> = {}): PackageSnapshot => ({ ...emptySnapshot(), ...over })

const teamRequest = (id: string, status = "open") => ({ id, status, number: `MAT-2026/${id}`, lines: [], place: { label: "", city: "", district: "" }, requestedById: "u1" }) as never

describe("measureImpact", () => {
  it("counts the open team requests, and not the withdrawn, declined or received ones", () => {
    const s = snap({
      teamRequests: [teamRequest("t1"), teamRequest("t2"), teamRequest("t3", "withdrawn"), teamRequest("t4", "declined"), teamRequest("t5")],
      rfqs: [],
      orders: [order("o5", { purchaseSource: { kind: "team_request", purchaseRequestId: "t5" }, lines: [{ id: "l1", name: "x", unit: "u", quantity: 10, unitPrice: 1, accepted: 10, rejected: 0, held: 0, cancelled: 0 }] })],
    })
    expect(measureImpact(s).teamRequestsOpen).toBe(2)
  })

  it("counts project requests still open, and those already in an RFQ or an order as in flight", () => {
    const s = snap({
      projectRequests: [
        { id: "r1", status: "approved" },
        { id: "r2", status: "approved", rfqId: "rfq1" },
        { id: "r3", status: "approved", lineLinks: { "0": { poId: "po1" } } },
        { id: "r4", status: "rejected" },
        { id: "r5", status: "approved", withdrawn: true },
        { id: "r6", status: "approved", lines: [{ cl: { at: "2026-10-01" } }] },
        { id: "r7", status: "pending" },
      ],
    })
    const impact = measureImpact(s)
    expect(impact.projectRequestsOpen).toBe(4)
    expect(impact.projectRequestsInFlight).toBe(2)
  })

  it("counts orders awaiting Finance's payment, requested advances and the buyer's payment marks", () => {
    const s = snap({
      orders: [
        order("a"),
        order("b", { advancePercent: 30 }),
        order("c", { advancePercent: 30, advancePaidDay: "2026-10-05" }),
        order("d", { paymentMark: { state: "part", day: "2026-10-05", byName: "B", at: "x" } }),
        order("e", { status: "closed" }),
        order("f", { status: "cancelled", paymentMark: { state: "paid", day: "2026-10-05", byName: "B", at: "x" } }),
        order("g", { approvedAt: null, status: "awaiting_approval" }),
      ],
    })
    const impact = measureImpact(s)
    expect(impact.ordersAwaitingPayment).toBe(4)
    expect(impact.advancesRequested).toBe(1)
    expect(impact.buyerPaymentMarks).toBe(1)
  })

  it("an order Finance already paid in full is not awaiting payment", () => {
    const paid = order("p", { financePayments: [{ id: "p1", kind: "inv", amount: 1150, at: "2026-10-03T00:00:00Z" }] })
    expect(measureImpact(snap({ orders: [paid] })).ordersAwaitingPayment).toBe(0)
  })

  it("separates the workshop's unanswered questions from the answers that already have a work order", () => {
    const s = snap({
      workshopAsks: [
        { id: "m1", status: "new", sourceKind: "project" },
        { id: "m2", status: "accepted", workOrderId: "wo1" },
        { id: "m3", status: "partial", workOrderIds: ["wo2"] },
        { id: "m4", status: "accepted" },
        { id: "m5", status: "rejected" },
        { id: "m6", status: "new", returned: true },
      ],
    })
    const impact = measureImpact(s)
    expect(impact.workshopAsksUnanswered).toBe(1)
    expect(impact.workshopAnswersWithWorkOrder).toBe(2)
  })

  it("links a manual site that carries a project's name, once, and never one already tied", () => {
    const sites = [
      { id: "s1", kind: "site", name: "برج الياسمين" },
      { id: "s2", kind: "warehouse", name: "مستودع", warehouseId: "w1" },
      { id: "s3", kind: "site", name: "المشروع الثاني", projectId: "p2" },
      { id: "s4", kind: "site", name: "برج  الياسمين" },
    ]
    const projects = [{ id: "p1", name: "برج الياسمين" }, { id: "p2", name: "المشروع الثاني" }]
    expect(sitesToLink(sites, projects)).toEqual([{ siteId: "s1", projectId: "p1" }])
  })

  it("every impact key is about some connector's change, and none is left out", () => {
    const used = new Set(Object.values(CONNECTOR_IMPACT).flatMap((o) => [...o.on, ...o.off]))
    expect([...used].sort()).toEqual([...IMPACT_KEYS].sort())
  })
})

describe("planChange — nothing is deleted, nothing in flight is stopped", () => {
  it("closing Projects keeps every open project request and every one already in an RFQ; project sites become ordinary sites", () => {
    const s = snap({
      projectRequests: [{ id: "r1", status: "approved" }, { id: "r2", status: "approved", rfqId: "rfq1" }],
      sites: [{ id: "prj_p1", kind: "project", name: "برج", projectId: "p1" }, { id: "s2", kind: "site", name: "ورشة" }],
    })
    const plan = planChange(s, "pm", "off")
    expect(plan.impact).toEqual({ projectRequestsOpen: 2, projectRequestsInFlight: 1 })
    expect(plan.steps).toEqual([{ kind: "sites_to_ordinary", siteIds: ["prj_p1"] }])
    expect(plan.steps.some((x) => JSON.stringify(x).includes("r1") || JSON.stringify(x).includes("rfq1"))).toBe(false)
  })

  it("opening Projects keeps the team's open requests and links a manual site named like a project", () => {
    const s = snap({ teamRequests: [teamRequest("t1")], sites: [{ id: "s1", kind: "site", name: "برج الياسمين" }], projects: [{ id: "p1", name: "برج الياسمين" }] })
    const plan = planChange(s, "pm", "on")
    expect(plan.impact).toEqual({ teamRequestsOpen: 1, sitesToLink: 1 })
    expect(plan.steps).toEqual([{ kind: "link_sites", links: [{ siteId: "s1", projectId: "p1" }] }])
  })

  it("closing Manufacturing returns the unanswered question once and leaves the answer with a live work order alone", () => {
    const s = snap({
      workshopAsks: [{ id: "ask1", status: "new" }, { id: "wo-answer", status: "accepted", workOrderId: "wo1" }],
    })
    const plan = planChange(s, "mfg", "off")
    expect(plan.steps).toEqual([
      { kind: "return_workshop_asks", requestIds: ["ask1"], reason: "connector_closed" },
      { kind: "keep_workshop_answers", requestIds: ["wo-answer"] },
    ])
  })

  it("re-opening Manufacturing revives neither the returned question nor the answer: no step touches them", () => {
    const afterClose = snap({ workshopAsks: [{ id: "ask1", status: "new", returned: true }, { id: "wo-answer", status: "accepted", workOrderId: "wo1" }] })
    const plan = planChange(afterClose, "mfg", "on")
    expect(plan.steps).toEqual([])
    expect(planChange(afterClose, "mfg", "off").steps).toEqual([{ kind: "keep_workshop_answers", requestIds: ["wo-answer"] }])
  })

  it("opening Manufacturing adds the workshop's store as a delivery site, once", () => {
    const s = snap({ workshopWarehouses: [{ id: "w9", name: "مستودع الورشة" }], sites: [] })
    expect(planChange(s, "mfg", "on").steps).toEqual([{ kind: "add_workshop_site", warehouseId: "w9" }])
    const done = snap({ workshopWarehouses: [{ id: "w9" }], sites: [{ id: "s", kind: "workshop", name: "x", warehouseId: "w9" }] })
    expect(planChange(done, "mfg", "on").steps).toEqual([])
  })

  it("R-34 / B-03: opening Finance keeps the buyer's mark a reference — the order is stamped to close on payment, never closed", () => {
    const marked = order("m", { paymentMark: { state: "paid", day: "2026-10-05", byName: "B", at: "x" } })
    const plan = planChange(snap({ orders: [marked] }), "fin", "on")
    expect(plan.impact).toEqual({ buyerPaymentMarks: 1 })
    expect(plan.steps).toContainEqual({ kind: "stamp_close_on", orderIds: ["m"], closeOn: "payment" })
    expect(plan.steps.some((x) => x.kind === ("close" as never))).toBe(false)
  })

  it("B-13: closing Finance stamps an order awaiting payment to close on receipt", () => {
    const plan = planChange(snap({ orders: [order("w", { advancePercent: 20 })] }), "fin", "off")
    expect(plan.impact).toEqual({ ordersAwaitingPayment: 1, advancesRequested: 1 })
    expect(plan.steps).toEqual([{ kind: "stamp_close_on", orderIds: ["w"], closeOn: "receipt" }])
  })

  it("a closed or cancelled order is never touched, in either direction", () => {
    const s = snap({ orders: [order("c1", { status: "closed" }), order("c2", { status: "cancelled" }), order("c3", { status: "awaiting_approval", approvedAt: null })] })
    expect(planChange(s, "fin", "off").steps).toEqual([])
    expect(planChange(s, "fin", "on").steps).toEqual([])
  })

  it("planning again after the job ran gives no step (the job is re-runnable)", () => {
    const before = snap({ orders: [order("w")] })
    expect(planChange(before, "fin", "off").steps).toHaveLength(1)
    const after = snap({ orders: [order("w", { closeOn: "receipt" })] })
    expect(planChange(after, "fin", "off").steps).toEqual([])
    expect(planChange(after, "fin", "off").impact.ordersAwaitingPayment).toBe(0)
    const reopened = snap({ orders: [order("w", { closeOn: "payment" })] })
    expect(planChange(reopened, "fin", "on").steps).toEqual([{ kind: "send_commitments", orderIds: ["w"] }])
  })
})

describe("planPackageChange", () => {
  it("names only the connectors that changed, in the admin's reading order", () => {
    const plan = planPackageChange(snap(), [], ["manufacturing", "project-management"])
    expect(plan.changes.map((c) => [c.conn, c.to])).toEqual([["pm", "off"], ["mfg", "off"]])
    expect(plan.to).toEqual({ pm: false, fin: true, mfg: false })
  })

  it("closing Finance on a company with HR says HR goes with it; a company with HR already off does not", () => {
    expect(planPackageChange(snap(), [], ["payments", "hr"]).hrDependent).toBe(true)
    expect(planPackageChange(snap(), ["hr"], ["payments", "hr"]).hrDependent).toBe(false)
  })

  it("is quiet when no record is touched, and says so only then", () => {
    expect(planPackageChange(snap(), [], ["manufacturing"]).quiet).toBe(true)
    expect(planPackageChange(snap({ workshopAsks: [{ id: "a", status: "new" }] }), [], ["manufacturing"]).quiet).toBe(false)
    expect(planPackageChange(snap(), [], []).changes).toEqual([])
  })

  it("carries the 300+ flag from the snapshot", () => {
    expect(planPackageChange(snap({ projectsCapped: true }), [], ["project-management"]).projectsCapped).toBe(true)
  })

  it("the saved list keeps HR as it was and adds what a closed connector forces", () => {
    expect(savedOff(BASE_PACKAGE, [])).toEqual(["hr", "manufacturing", "payments", "project-management"])
    expect(savedOff(FULL_PACKAGE, ["hr", "payments"])).toEqual(["hr"])
  })
})

describe("the impact report as the admin's screen reads it", () => {
  it("keeps known connectors and whole positive counts, drops everything else", () => {
    const report = readImpactReport({
      changes: [{ conn: "mfg", to: "off", impact: { workshopAsksUnanswered: 2.9, workshopAnswersWithWorkOrder: -1, nonsense: 5 } }, { conn: "xx", to: "off" }, { conn: "pm", to: "maybe" }],
      hrDependent: true,
      projectsCapped: true,
      scanCap: 300,
      warnings: [{ module: "manufacturing", items: [{ key: "notes", count: 3 }, { key: "nope", count: 1 }] }, { module: "zzz", items: [] }],
    })
    expect(report.changes).toEqual([{ conn: "mfg", to: "off", impact: { workshopAsksUnanswered: 2, workshopAnswersWithWorkOrder: 0 } }])
    expect(report.warnings).toEqual([{ module: "manufacturing", items: [{ key: "notes", count: 3 }] }])
    expect(report.hrDependent && report.projectsCapped).toBe(true)
    expect(impactQuiet(report)).toBe(false)
    expect(impactQuiet(readImpactReport({ changes: [{ conn: "mfg", to: "on", impact: {} }] }))).toBe(true)
    expect(impactQuiet(readImpactReport(null))).toBe(true)
  })
})
