/**
 * The needs desk (prototype «طلبات الشراء الواردة», P-13/P-29…P-42): one row per
 * material line, its state, path, last order day and estimate; the segments,
 * the order, a buyer's scope, the merge hint, the selection, the manager's
 * roll-up per buyer — and what Today makes of them.
 */

import { mfgNeed, projectNeed, stockNeeds, type ProjectRequestDoc } from "@/lib/procurement/needs"
import { buildNeedRows, buyerRollups, inBuyerScope, lastOrderDayOf, mergeHint, needKpi, segmentCounts, selectionSummary, sortRows, type DeskFacts } from "@/lib/procurement/need-desk"
import { todayTasks, todayWaits, type ProcWorld } from "@/lib/procurement/today"
import { procRole, procTabCounts } from "@/lib/procurement/shell"
import { DEFAULT_POLICIES, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import { materialKey, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"

const NOW = new Date("2026-09-22T08:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const facts = (over: Partial<DeskFacts> = {}): DeskFacts => ({
  now: NOW,
  policies: DEFAULT_POLICIES,
  agreements: [],
  history: [],
  orders: [],
  rfqs: [],
  onHand: () => null,
  makeable: () => false,
  mfgRequests: {},
  ...over,
})

const project = { id: "p1", name: "Villas" }
const pr = (over: Partial<ProjectRequestDoc> = {}): ProjectRequestDoc => ({ id: "pr1", title: "L2", items: [{ name: "Cement", quantity: 100, unit: "bag" }, { name: "Sand", quantity: 10, unit: "m3" }], status: "approved", needBy: "2026-10-10", requestedByUserName: "Yasser", createdAt: hoursAgo(2), ...over })
const hist = (name: string, unit: string, price: number): PriceHistoryEntry => ({ id: `${name}-h`, organizationId: "org", materialKey: materialKey(name, unit), name, unit, supplierOrgId: "s1", supplierName: "Cement Co", price, day: "2026-09-01", kind: "po", poId: null, poNumber: null })
const agreement: PriceAgreement = { id: "a1", organizationId: "org", docNumber: "AG-2026/001", supplierOrgId: "s1", supplierName: "Cement Co", from: "2026-01-01", until: "2026-12-31", lines: [{ name: "Cement", unit: "bag", price: 18 }], preparedById: "m", preparedByName: "M", createdAt: "" }

describe("one row per material line", () => {
  it("cuts a project's request into its lines, which travel together", () => {
    const rows = buildNeedRows([projectNeed(project, pr(), "PR-1")], facts())
    expect(rows.map((r) => [r.key, r.name, r.open, r.state])).toEqual([
      ["project:p1:pr1#0", "Cement", 100, "open"],
      ["project:p1:pr1#1", "Sand", 10, "open"],
    ])
    expect(new Set(rows.map((r) => r.needKey)).size).toBe(1)
  })

  it("state: the stock check, then «مضت مهلة المخزون» after a day; the workshop reply, then «مضت مهلة الورشة»; being made", () => {
    const state = (p: Partial<ProjectRequestDoc>, f: Partial<DeskFacts> = {}) => buildNeedRows([projectNeed(project, pr(p), "PR-1")], facts(f))[0].state
    expect(state({ status: "pending" })).toBe("chk")
    expect(state({ status: "pending", createdAt: hoursAgo(30) })).toBe("late")
    expect(state({ mfgRequestId: "m1" }, { mfgRequests: { m1: { status: "new", at: hoursAgo(3) } } })).toBe("mfgw")
    expect(state({ mfgRequestId: "m1" }, { mfgRequests: { m1: { status: "new", at: hoursAgo(25) } } })).toBe("mfgl")
    expect(state({ mfgRequestId: "m1" }, { mfgRequests: { m1: { status: "accepted", at: hoursAgo(25) } } })).toBe("mfg")
    expect(state({ mfgRequestId: "m1" }, { mfgRequests: { m1: { status: "rejected", at: hoursAgo(25) } } })).toBe("open")
    expect(state({ status: "rejected" })).toBe("cx")
    expect(state({ rfqId: "q" })).toBe("rfq")
    expect(state({ poId: "o" })).toBe("po")
  })

  it("proceeding short after the window relies on the cover: the open quantity is the shortfall, «من» the total", () => {
    const rows = buildNeedRows([projectNeed(project, pr({ status: "pending", createdAt: hoursAgo(30), procDecision: { kind: "proceed_short", at: "", byName: "B", cover: [60, 0] } }), "PR-1")], facts())
    expect(rows.map((r) => [r.state, r.open, r.total])).toEqual([
      ["open", 40, 100],
      ["open", 10, 10],
    ])
  })
})

describe("the path and the last order day", () => {
  it("our workshop makes it → ask it first; «يُشترى — بلا سؤال» drops that", () => {
    const makeable = (n: string) => n === "Cement"
    expect(buildNeedRows([projectNeed(project, pr(), "PR-1")], facts({ makeable }))[0].path).toBe("mfg")
    expect(buildNeedRows([projectNeed(project, pr({ procDecision: { kind: "buy", at: "", byName: "B" } }), "PR-1")], facts({ makeable }))[0].path).toBe("rfq")
    // A work order's own shortfall never asks the workshop back.
    expect(buildNeedRows([mfgNeed({ id: "w", ref: "WO-1", context: "" }, { id: "r", itemName: "Cement", unit: "bag", quantity: 1, needBy: null, note: null, by: "", at: "", state: "sent" })], facts({ makeable }))[0].path).toBe("rfq")
  })

  it("need − lead − (RFQ window + award cycle) for an RFQ, − 1 day for an order; the lead from the last order that said so", () => {
    expect(lastOrderDayOf("2026-10-10", 10, "rfq", DEFAULT_POLICIES)).toBe("2026-09-25")
    expect(lastOrderDayOf("2026-10-10", 10, "agreement", DEFAULT_POLICIES)).toBe("2026-09-29")
    expect(lastOrderDayOf(null, 10, "rfq", DEFAULT_POLICIES)).toBeNull()
    const leadPo = { id: "o", createdAt: "2026-09-01", leadTimeDays: 3, lines: [{ name: "Sand", unit: "m3" }] } as unknown as PurchaseOrder
    const rows = buildNeedRows([projectNeed(project, pr(), "PR-1")], facts({ orders: [leadPo] }))
    expect(rows[1]).toMatchObject({ leadDays: 3, lastOrderDay: "2026-10-02", lastOrderIn: 10 })
  })

  it("estimates at the agreement price, else the last we paid; an agreement covering every line is the path", () => {
    const one = projectNeed(project, pr({ items: [{ name: "Cement", quantity: 100, unit: "bag" }] }), "PR-1")
    const [r] = buildNeedRows([one], facts({ agreements: [agreement], history: [hist("Cement", "bag", 20)] }))
    expect(r).toMatchObject({ path: "agreement", unitEstimate: 18, estimate: 1800 })
    const [d] = buildNeedRows([one], facts({ history: [hist("Cement", "bag", 20)] }))
    expect(d).toMatchObject({ path: "direct", estimate: 2000 })
  })
})

describe("the list", () => {
  const rows = buildNeedRows(
    [
      projectNeed(project, pr({ id: "a", needBy: "2026-10-30" }), "PR-A"),
      projectNeed(project, pr({ id: "b", needBy: "2026-09-25", items: [{ name: "Steel", quantity: 1, unit: "t", category: "steel" }] }), "PR-B"),
      projectNeed(project, pr({ id: "c", status: "pending" }), "PR-C"),
      projectNeed(project, pr({ id: "d", poId: "o" }), "PR-D"),
    ],
    facts()
  )

  it("counts the segments and sorts needs-action by the last order day", () => {
    expect(segmentCounts(rows)).toMatchObject({ act: 3, oth: 2, po: 2, all: 7 })
    expect(sortRows(rows.filter((r) => r.state === "open"), "act")[0].name).toBe("Steel")
    expect(needKpi(rows)).toEqual({ need: 3, overdue: 1 })
  })

  it("a buyer sees his categories — and every line nobody categorised", () => {
    expect(rows.filter((r) => inBuyerScope(r, ["cement"])).map((r) => r.name)).not.toContain("Steel")
    expect(rows.filter((r) => inBuyerScope(r, null))).toHaveLength(rows.length)
  })

  it("hints to combine RFQ lines of one project, and the selection sums them at the last price", () => {
    const hint = mergeHint(rows, new Set())
    expect(hint).toMatchObject({ by: "project", label: "Villas", lines: 3 })
    const sel = selectionSummary(rows, new Set(["project:p1:a"]), { agreements: [], policies: DEFAULT_POLICIES, now: NOW })
    expect(sel).toMatchObject({ lines: 2, value: null, directOk: false, agreement: null })
  })

  it("the manager gets one roll-up per buyer and the lines no buyer covers", () => {
    const { rollups, uncovered } = buyerRollups(rows, [{ uid: "u2", name: "Turki", categories: ["steel"] }])
    expect(rollups).toEqual([{ buyer: { uid: "u2", name: "Turki", categories: ["steel"] }, count: 1, overdue: 1, nearest: -12 }])
    expect(uncovered).toHaveLength(2)
  })
})

describe("Today reads the desk", () => {
  const rows = buildNeedRows([projectNeed(project, pr({ needBy: "2026-09-25", items: [{ name: "Steel", quantity: 1, unit: "t", category: "steel", samplePending: true }] }), "PR-B"), projectNeed(project, pr({ id: "c", status: "pending" }), "PR-C")], facts())
  const w: ProcWorld = { orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, needDesk: { rows, buyers: [], viewerCategories: null } }
  const BUYER: ProcActor = { uid: "b", name: "B", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
  const MANAGER: ProcActor = { ...BUYER, uid: "m", canApprove: true }
  const OWNER: ProcActor = { ...MANAGER, uid: "o", isOwner: true }

  it("a buyer gets one task per line, red past its last order day, opening the line", () => {
    const t = todayTasks(w, BUYER, NOW).filter((x) => x.kind === "need_line")
    expect(t[0]).toMatchObject({ group: "need", severity: "red", titleParams: { head: "none", path: "rfq", name: "Steel", qty: 1, unit: "t" }, subParams: { when: "past", n: 12 }, href: "/contractor/rfqs/requests?line=project%3Ap1%3Apr1%230", actionKey: "actions.openLine" })
  })

  it("the manager gets a roll-up for a buyer's lines; the owner with a team reads", () => {
    const withBuyer = { ...w, needDesk: { rows, buyers: [{ uid: "u2", name: "Turki", categories: ["steel"] }], viewerCategories: null } }
    expect(todayTasks(withBuyer, MANAGER, NOW).filter((x) => x.group === "need").map((x) => x.kind)).toEqual(["need_rollup"])
    const owner = todayTasks({ ...withBuyer, ownerHasTeam: true }, OWNER, NOW).filter((x) => x.group === "need")
    // The roll-up row has no «اطّلع» variant in the prototype: the owner's button reads «افتح الاحتياج» too.
    expect(owner.every((x) => x.kind === "need_rollup" && x.actionKey === "actions.openNeeds")).toBe(true)
  })

  it("waits: the stock check with Inventory, the sample with Projects", () => {
    expect(todayWaits(w, BUYER, NOW).map((x) => [x.kind, x.module])).toEqual([
      ["sample_approval", "projects"],
      ["stock_check", "inventory"],
      ["stock_check", "inventory"],
    ])
  })
})

describe("the shell", () => {
  it("names the viewer's authority", () => {
    const base = { isOwner: false, canApprove: false, canPrepare: false, canExpedite: false, canReceive: false, seesPrices: false }
    expect(procRole({ ...base, isOwner: true }, true)).toBe("owner")
    expect(procRole({ ...base, isOwner: true }, false)).toBe("owner_solo")
    expect(procRole({ ...base, canApprove: true }, true)).toBe("manager")
    expect(procRole({ ...base, canPrepare: true }, true)).toBe("buyer")
    expect(procRole({ ...base, canExpedite: true }, true)).toBe("expediter")
  })

  it("counts open RFQs (closed awaiting award too), live orders, and receipts = live notices + orders due within three days", () => {
    const po = (id: string, status: PurchaseOrder["status"], promisedDate: string | null) => ({ id, status, promisedDate, lines: [{ id: "l", name: "x", unit: "t", quantity: 1, unitPrice: 1, accepted: 0, rejected: 0, held: 0, cancelled: 0 }] }) as unknown as PurchaseOrder
    const c = procTabCounts({
      tasks: 0,
      incomingRequests: 4,
      rfqs: [{ status: "New", deadline: "2026-09-01" }, { status: "New" }, { status: "Draft" }],
      orders: [po("a", "accepted", "2026-09-24"), po("b", "accepted", "2026-10-30"), po("c", "sent", null), po("d", "awaiting_approval", null)],
      receipts: [{ id: "n", status: "pending_confirmation", poId: "b" }],
      now: NOW,
    })
    expect(c).toMatchObject({ requests: 4, rfqs: 2, orders: 3, receipts: 2 })
  })
})

it("a stock gap is a line with no need date, and still sorts", () => {
  const rows = buildNeedRows(stockNeeds([{ id: "i", warehouseId: "w", warehouseName: "Main", name: "Cement", unit: "bag", quantity: 1, minStockLevel: 10 }], { rfqs: [], orders: [] }), facts())
  expect(rows[0]).toMatchObject({ state: "open", lastOrderDay: null, open: 19 })
})
