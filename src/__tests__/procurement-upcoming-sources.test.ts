/**
 * Procurement 2.0 — «قادمة»'s sources and the team-approval rules, pure (gap report 01: IN-11, IN-12, IN-15, IN-17).
 * Stock: days of cover at the current issue rate and «يُتوقع وصوله خلال N أيام»; the workshop: a planned work order the stores
 * cannot cover after the released ones took theirs; the team: a request awaiting approval; the watch keys; «طلباتي»'s sentence;
 * the approval rules (who, not his own, a reason to return, withdraw, send again, escalate once) and Today's approval row.
 */

import { emptyProgress, type DeptCapacityFields, type MfgProduct } from "@/lib/manufacturing-engine"
import type { WorkOrderV2 } from "@/lib/manufacturing-writes"
import { issueKey, issueRates } from "@/lib/procurement/issue-rate"
import { daysOfCover, isWatchKey, sortUpcoming, upcomingFromStock, UPCOMING_COVER_DAYS } from "@/lib/procurement/upcoming"
import { upcomingFromWorkOrders } from "@/lib/procurement/upcoming-mfg"
import { upcomingFromTeamApprovals } from "@/lib/procurement/upcoming-team"
import { requesterLine } from "@/lib/procurement/my-request-line"
import {
  approveTeamRequest,
  approversFor,
  decisionRefusal,
  needsEscalation,
  newTeamApproval,
  resubmitRefusal,
  returnTeamRequest,
  returnWhy,
  teamApprovalView,
  withdrawRefusal,
  type TeamApprovalDoc,
} from "@/lib/procurement/team-approval"
import { teamApprovalTasks, withApprovalTasks } from "@/lib/procurement/team-approval-today"
import type { Task } from "@/lib/procurement/today"
import { resolvePolicies } from "@/lib/procurement/policies"
import { storedSites } from "@/lib/procurement/delivery-sites"

const NOW = new Date("2026-10-21T08:00:00.000Z")

describe("days of cover (IN-11)", () => {
  it("sums what left each warehouse over the window, per day", () => {
    const rates = issueRates(
      [
        { warehouseId: "w1", name: "Cement ", qty: 300, day: "2026-10-15" },
        { warehouseId: "w1", name: "cement", qty: 300, day: "2026-10-01" },
        { warehouseId: "w1", name: "Cement", qty: 999, day: "2026-09-01" },
        { warehouseId: "w2", name: "Cement", qty: 30, day: "2026-10-20" },
        { warehouseId: "w1", name: "Sand", qty: 0, day: "2026-10-20" },
      ],
      "2026-10-21"
    )
    expect(rates[issueKey("w1", "Cement")]).toBe(20)
    expect(rates[issueKey("w2", "cement")]).toBe(1)
    expect(rates[issueKey("w1", "Sand")]).toBeUndefined()
  })

  it("days = (stock − minimum) ÷ rate, none without a rate", () => {
    expect(daysOfCover(280, 100, 20)).toBe(9)
    expect(daysOfCover(280, 100, 0)).toBeNull()
    expect(daysOfCover(280, 100, null)).toBeNull()
  })

  it("an item far above its minimum is upcoming when it lasts only days; its eta is its cover", () => {
    const row = { id: "i1", warehouseId: "w1", warehouseName: "Main", name: "Cement", unit: "bag", quantity: 280, minStockLevel: 100 }
    expect(upcomingFromStock([row])).toEqual([])
    const [item] = upcomingFromStock([row], () => 20)
    expect(item).toMatchObject({ kind: "stock", etaDays: 9, perDay: 20 })
    expect(upcomingFromStock([row], () => (280 - 100) / (UPCOMING_COVER_DAYS + 5))).toEqual([])
    // Just above its minimum stays upcoming whatever the rate.
    expect(upcomingFromStock([{ ...row, quantity: 110 }])).toHaveLength(1)
  })
})

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
const DEPTS = [
  { id: "cut", name: "Cutting", workers: 2, hoursPerDay: 8, hourlyRate: 70 },
  { id: "qc", name: "QC & packing", workers: 1, hoursPerDay: 8, hourlyRate: 45, qcStation: true },
] as DeptCapacityFields[]
const order = (id: string, over: Partial<WorkOrderV2>): WorkOrderV2 =>
  ({
    id,
    organizationId: "org",
    orderNumber: 43,
    docNumber: `WO-2026/${id}`,
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
    releasedAt: null,
    neededBy: "2026-11-20",
    progress: emptyProgress(ROUTE),
    materials: [],
    scrapRecords: [],
    closures: [],
    survey: { at: "2026-09-01T09:00:00Z", by: "Badr", note: null },
    drawing: { code: "A", submittedAt: "2026-09-01T10:00:00Z", approverOrg: "client" },
    ...over,
  }) as WorkOrderV2

describe("a planned work order the stores cannot cover (IN-12)", () => {
  const products = new Map([[COUNTER.id, COUNTER]])

  it("draws on what released orders left; only the shortfall is upcoming, under the order's number", () => {
    const stock = { onHand: new Map([["statuario slab", 14]]), lots: [] }
    const items = upcomingFromWorkOrders({ orders: [order("r", { releasedAt: "2026-09-02T08:00:00Z" }), order("p", {})], products, departments: DEPTS, stock })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: "wo:p", kind: "workorder", needBy: "2026-11-20", workOrder: { no: "WO-2026/p", product: "Marble countertop" }, lines: [{ name: "Statuario slab", qty: 6 }] })
  })

  it("nothing when the stores cover it, or the order is released / cancelled", () => {
    const plenty = { onHand: new Map([["statuario slab", 50]]), lots: [] }
    expect(upcomingFromWorkOrders({ orders: [order("p", {})], products, departments: DEPTS, stock: plenty })).toEqual([])
    const none = { onHand: new Map<string, number>(), lots: [] }
    expect(upcomingFromWorkOrders({ orders: [order("p", { status: "cancelled" })], products, departments: DEPTS, stock: none })).toEqual([])
  })

  it("its watch key is accepted, as is a team request's", () => {
    expect(isWatchKey("wo:p")).toBe(true)
    expect(isWatchKey("team:abc")).toBe(true)
    expect(isWatchKey("wo:")).toBe(false)
    expect(isWatchKey("wo:a:b")).toBe(false)
  })
})

const owner = { uid: "own", name: "Owner" }
const pending = (over: Partial<Parameters<typeof newTeamApproval>[0]> = {}): TeamApprovalDoc =>
  newTeamApproval({ organizationId: "own", id: "t1", no: "MAT-2026/004", seq: 4, lines: [{ name: "Cement", unit: "bag", quantity: 5 }], needBy: "2026-11-01", siteId: "s1", place: { label: "Site", city: "Riyadh", district: "" }, note: null, requestedBy: { id: "eng", name: "Fahd" }, requestedFor: { kind: "member", id: "eng", name: "Fahd" }, approvers: approversFor(owner, { uid: "mgr", name: "Manager" }), at: "2026-10-18T08:00:00.000Z", ...over })

describe("the team-approval rules (IN-17)", () => {
  it("the policy is off unless stored on; a site keeps the manager it names", () => {
    expect(resolvePolicies(null).teamApproval).toBe(false)
    expect(resolvePolicies({ teamApproval: true }).teamApproval).toBe(true)
    expect(storedSites([{ id: "s1", name: "S", city: "R", managerId: "mgr" }, { id: "s2", name: "T", city: "R" }]).map((x) => x.managerId ?? null)).toEqual(["mgr", null])
    expect("managerId" in storedSites([{ id: "s2", name: "T", city: "R" }])[0]).toBe(false)
  })

  it("approvers: the owner, plus the site's manager when named and not the owner", () => {
    expect(approversFor(owner, null).map((a) => a.uid)).toEqual(["own"])
    expect(approversFor(owner, { uid: "own", name: "Owner" }).map((a) => a.uid)).toEqual(["own"])
    expect(approversFor(owner, { uid: "mgr", name: "M" }).map((a) => a.role)).toEqual(["owner", "site"])
  })

  it("refuses: not waiting, not an approver, his own (owner excepted), a return without a reason", () => {
    const d = pending()
    expect(decisionRefusal(d, { uid: "mgr", name: "M", isOwner: false }, { kind: "approve" })).toBeNull()
    expect(decisionRefusal(d, { uid: "x", name: "X", isOwner: false }, { kind: "approve" })).toBe("not_approver")
    expect(decisionRefusal(pending({ requestedBy: { id: "mgr", name: "M" }, requestedFor: { kind: "member", id: "mgr", name: "M" } }), { uid: "mgr", name: "M", isOwner: false }, { kind: "approve" })).toBe("own_request")
    expect(decisionRefusal(pending({ requestedFor: { kind: "member", id: "mgr", name: "M" } }), { uid: "mgr", name: "M", isOwner: false }, { kind: "approve" })).toBe("own_request")
    expect(decisionRefusal(pending({ requestedBy: { id: "own", name: "O" } }), { uid: "own", name: "O", isOwner: true }, { kind: "approve" })).toBeNull()
    expect(decisionRefusal(d, { uid: "mgr", name: "M", isOwner: false }, { kind: "return", code: "other", note: "no" })).toBe("reason_required")
    expect(decisionRefusal(d, { uid: "mgr", name: "M", isOwner: false }, { kind: "return", code: null })).toBe("reason_required")
    expect(decisionRefusal({ ...d, st: "appr" }, { uid: "own", name: "O", isOwner: true }, { kind: "approve" })).toBe("not_waiting")
    expect(decisionRefusal(null, { uid: "own", name: "O", isOwner: true }, { kind: "approve" })).toBe("not_found")
  })

  it("the owner approving his own is flagged; a return keeps the reason the requester reads", () => {
    const own = approveTeamRequest(pending({ requestedBy: { id: "own", name: "O" }, requestedFor: { kind: "member", id: "own", name: "O" } }), { uid: "own", name: "O", isOwner: true }, "2026-10-21T08:00:00.000Z")
    expect(own.decided).toMatchObject({ ownerSelf: true })
    expect(own.log.at(-1)?.act).toBe("approved_own")
    expect(returnWhy("qty", null)).toBe("راجع الكميات")
    expect(returnWhy("qty", "half of it")).toBe("راجع الكميات — half of it")
    expect(returnWhy("other", "the site has it")).toBe("the site has it")
    const ret = returnTeamRequest(pending(), { uid: "mgr", name: "M", isOwner: false }, "dup", "مكرر مع طلب آخر", "2026-10-21T08:00:00.000Z")
    expect(ret).toMatchObject({ st: "ret", returned: { why: "مكرر مع طلب آخر", byName: "M" } })
  })

  it("withdraw while it waits or is returned; send again only a returned one, only its requester", () => {
    expect(withdrawRefusal(pending(), "eng")).toBeNull()
    expect(withdrawRefusal(pending(), "mgr")).toBe("not_yours")
    expect(withdrawRefusal({ ...pending(), st: "appr" }, "eng")).toBe("not_waiting")
    expect(resubmitRefusal(pending(), "eng")).toBe("not_returned")
    expect(resubmitRefusal({ ...pending(), st: "ret" }, "eng")).toBeNull()
    expect(resubmitRefusal({ ...pending(), st: "ret" }, "mgr")).toBe("not_yours")
  })

  it("escalates once, past the window", () => {
    expect(needsEscalation(pending(), new Date("2026-10-19T08:00:00.000Z"), 2)).toBe(false)
    expect(needsEscalation(pending(), NOW, 2)).toBe(true)
    expect(needsEscalation({ ...pending(), escalatedAt: "2026-10-20T08:00:00.000Z" }, NOW, 2)).toBe(false)
  })

  it("«قادمة» reads it as awaiting approval by its approvers; Today hands it only to who may decide, red past the window", () => {
    const view = teamApprovalView(pending(), { uid: "mgr", isOwner: false }, NOW, 2)
    expect(view).toMatchObject({ canDecide: true, overdue: true, waitingDays: 3, approvers: ["Owner", "Manager"] })
    expect(upcomingFromTeamApprovals([view])[0]).toMatchObject({ key: "team:t1", kind: "team", ref: "MAT-2026/004", approvers: ["Owner", "Manager"] })
    const tasks = teamApprovalTasks([view, teamApprovalView(pending({ id: "t2" }), { uid: "eng", isOwner: false }, NOW, 2)])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ kind: "team_approval", chip: "req", tier: "red", href: "/contractor/rfqs/my-requests?approval=t1", subParams: { days: 3 } })
    const other = { id: "x", tier: "normal", due: 2 } as Task
    expect(withApprovalTasks([other], tasks).map((t) => t.id)).toEqual(["team_approval:t1", "x"])
  })

  it("approval rows sort with the rest (requests first by kind)", () => {
    const items = sortUpcoming([...upcomingFromStock([{ id: "i", warehouseId: "w", warehouseName: "W", name: "Sand", unit: "m3", quantity: 105, minStockLevel: 100 }]), ...upcomingFromTeamApprovals([teamApprovalView(pending(), { uid: "own", isOwner: true }, NOW, 2)])])
    expect(items.map((i) => i.kind)).toEqual(["team", "stock"])
  })
})

describe("«طلباتي»'s sentence (IN-15)", () => {
  const fmt = (d: string) => `<${d}>`
  const base = { failed: null, rfqNumber: null, poNumber: null, promisedDate: null, rfqDeadline: null, transitDate: null }
  it("in an RFQ with its number and closing day; in an order with its number and the supplier's date; on its way", () => {
    expect(requesterLine({ ...base, step: "rfq", rfqNumber: "RFQ-1", rfqDeadline: "2026-10-24" }, fmt)).toEqual({ key: "line_rfq_ref_date", values: { rfq: "RFQ-1", date: "<2026-10-24>" } })
    expect(requesterLine({ ...base, step: "rfq" }, fmt).key).toBe("line_rfq")
    expect(requesterLine({ ...base, step: "order", poNumber: "PO-9", promisedDate: "2026-11-02" }, fmt, (n) => `#${n}`)).toEqual({ key: "line_order_ref_date", values: { po: "#PO-9", date: "<2026-11-02>" } })
    expect(requesterLine({ ...base, step: "order", poNumber: "PO-9", transitDate: "2026-10-27" }, fmt)).toEqual({ key: "line_transit", values: { date: "<2026-10-27>" } })
    expect(requesterLine({ ...base, step: "failed", failed: { why: "x", alt: "" } }, fmt).key).toBe("line_failed")
    expect(requesterLine({ ...base, step: "placed" }, fmt).key).toBe("line_placed")
  })
})
