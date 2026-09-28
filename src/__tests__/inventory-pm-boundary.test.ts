/**
 * The PM boundary as Inventory and Procurement meet it: returns from a project
 * store confirmed into a main warehouse (stock credited in the same act),
 * Inventory's reply on a PM material-request line (only `lines[i].inv`), and
 * Procurement's Today reading the projects' SRET / NOPO / EQH events.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import {
  awaitingReply,
  buildReply,
  doneReturns,
  landingRow,
  onHandOf,
  pendingReturns,
  replyBlocks,
  replyRows,
  returnBlocks,
  type DeskProject,
} from "@/lib/inventory/project-supply"
import { InvDeskError, receiveProjectReturn, replyOnRequestLine } from "@/lib/inventory/project-supply-writes"
import { materialKeyOf, storeIdOf, type PmStoreLine } from "@/lib/pm/store"
import type { PmMaterialRequest, ReqLine } from "@/lib/pm/supply"
import { PmSupplyError } from "@/lib/pm/supply-writes"
import { pmBoundaryTasks, PROJECT_HREF, todayTasks, type PmBoundaryFact, type ProcWorld, type TodayActor } from "@/lib/procurement/today"
import { DEFAULT_POLICIES } from "@/lib/procurement/types"

const db = fakeFirestore as unknown as Firestore
const keeper = { uid: "k1", name: "Keeper", allowed: true }
const projects: DeskProject[] = [
  { id: "p1", name: "Tower", no: "PJ-2026/001" },
  { id: "p2", name: "Villa", no: null },
]
const block = materialKeyOf("Block 20", "pc")
const sid = storeIdOf(block)
const storeLine = (moves: PmStoreLine["moves"]): PmStoreLine => ({ id: sid, key: block, name: "Block 20", unit: "pc", rates: {}, moves })

describe("returns waiting on Inventory", () => {
  const stores = {
    p1: [
      storeLine([
        { t: "rc", q: 500, on: "2026-09-01", by: "se1" },
        { t: "ret", q: 40, on: "2026-09-10", by: "se1", byName: "Site", st: "wait", warehouseId: "w1", warehouseName: "Main" },
        { t: "ret", q: 10, on: "2026-09-12", by: "se1", st: "done", warehouseId: "w1", warehouseName: "Main", invOn: "2026-09-13", invByName: "Keeper" },
      ]),
    ],
    p2: [storeLine([{ t: "ret", q: 5, on: "2026-09-25", by: "se2", st: "wait", warehouseId: "w1" }])],
  }
  it("lists every waiting return across projects, oldest first; confirmed ones apart", () => {
    const rows = pendingReturns(projects, stores, "2026-09-29")
    expect(rows.map((r) => [r.projectId, r.index, r.qty, r.age])).toEqual([
      ["p1", 1, 40, 19],
      ["p2", 0, 5, 4],
    ])
    expect(doneReturns(projects, stores, 10).map((r) => [r.qty, r.invByName])).toEqual([[10, "Keeper"]])
  })
  it("lands on the same material — by Inventory's merge key, then by folded Arabic — never a block, remnant or unit row", () => {
    const rows = [
      { id: "a", name: "Block 20", unit: "pc", quantity: 3, lot: "L1" },
      { id: "b", name: "block 20 ", unit: "PC", quantity: 7 },
      { id: "c", name: "أسمنت", unit: "كيس", quantity: 2 },
      { id: "d", name: "Rebar", unit: "t", trackingMode: "unit" },
    ]
    expect(landingRow(rows, "Block 20", "pc")?.id).toBe("b")
    expect(landingRow(rows, "اسمنت", "كيس")?.id).toBe("c")
    expect(landingRow(rows, "Rebar", "t")).toBeNull()
    expect(onHandOf(rows, "Block 20", "pc")).toBe(7)
    expect(onHandOf(rows, "Sand", "m3")).toBeNull()
  })
  it("refuses without the keeper's permission, a return not waiting, a missing or foreign warehouse, an archived project", () => {
    const move = { t: "ret" as const, st: "wait" as const, warehouseId: "w1" }
    expect(returnBlocks({ allowed: true, archived: false, move, warehouseOrg: "org", projectOrg: "org" })).toEqual([])
    expect(returnBlocks({ allowed: false, archived: true, move, warehouseOrg: "org", projectOrg: "org" })).toEqual(["no_permission", "archived"])
    expect(returnBlocks({ allowed: true, archived: false, move: { ...move, st: "done" }, warehouseOrg: "org", projectOrg: "org" })).toEqual(["not_waiting"])
    expect(returnBlocks({ allowed: true, archived: false, move, warehouseOrg: null, projectOrg: "org" })).toEqual(["no_warehouse"])
    expect(returnBlocks({ allowed: true, archived: false, move, warehouseOrg: "other", projectOrg: "org" })).toEqual(["other_org"])
  })
})

describe("receiveProjectReturn (fake Firestore)", () => {
  const P = "projects/p1"
  beforeEach(() => {
    resetFakeDb()
    seed(P, { organizationId: "org", name: "Tower", pm: { no: "PJ-2026/001", lifecycle: "live" } })
    seed("warehouses/w1", { organizationId: "org", name: "Main", isCentral: true })
    seed(`${P}/pmStore/${sid}`, { key: block, name: "Block 20", unit: "pc", rates: {}, moves: [{ t: "rc", q: 500, on: "2026-09-01", by: "se1" }, { t: "ret", q: 40, on: "2026-09-10", by: "se1", st: "wait", warehouseId: "w1", warehouseName: "Main" }] })
  })
  it("closes the move and adds the quantity to the matching row", async () => {
    seed("warehouses/w1/inventoryItems/row1", { name: "block 20", unit: "pc", quantity: 100, organizationId: "org", warehouseId: "w1" })
    await receiveProjectReturn(db, keeper, { projectId: "p1", storeId: sid, index: 1 })
    expect(readDoc<PmStoreLine>(`${P}/pmStore/${sid}`)!.moves[1]).toMatchObject({ st: "done", invBy: "k1", invByName: "Keeper" })
    expect(readDoc<{ quantity: number }>("warehouses/w1/inventoryItems/row1")!.quantity).toBe(140)
    await expect(receiveProjectReturn(db, keeper, { projectId: "p1", storeId: sid, index: 1 })).rejects.toMatchObject({ blocks: ["not_waiting"] })
  })
  it("opens a new row when the warehouse has none", async () => {
    await receiveProjectReturn(db, keeper, { projectId: "p1", storeId: sid, index: 1 })
    const rows = listCollection<{ name: string; quantity: number; organizationId: string }>("warehouses/w1/inventoryItems")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: "Block 20", quantity: 40, organizationId: "org" })
  })
  it("refuses a member without warehouses.manage / receive, and a warehouse of another company", async () => {
    await expect(receiveProjectReturn(db, { ...keeper, allowed: false }, { projectId: "p1", storeId: sid, index: 1 })).rejects.toBeInstanceOf(InvDeskError)
    seed("warehouses/w1", { organizationId: "other", name: "Theirs" })
    await expect(receiveProjectReturn(db, keeper, { projectId: "p1", storeId: sid, index: 1 })).rejects.toMatchObject({ blocks: ["other_org"] })
    expect(readDoc<PmStoreLine>(`${P}/pmStore/${sid}`)!.moves[1].st).toBe("wait")
  })
  it("the PM-side confirmation re-checks the warehouse inside its own transaction", async () => {
    const { confirmStoreReturn } = await import("@/lib/pm/supply-writes")
    seed("warehouses/w1", { organizationId: "other" })
    await expect(confirmStoreReturn(db, "p1", keeper, sid, 1, { itemId: null })).rejects.toBeInstanceOf(PmSupplyError)
  })
})

describe("Inventory's reply on a request line", () => {
  const line = (over: Partial<ReqLine> = {}): ReqLine => ({ itemId: "i1", code: "04-01", key: block, name: "Block 20", unit: "pc", qty: 100, receipts: [{ grn: "GR-01", q: 20, rej: 0, on: "2026-09-20", by: "se1" }], ...over })
  const req = (over: Partial<PmMaterialRequest> = {}): PmMaterialRequest => ({ id: "01", pm: true, seq: 1, title: "Block", lines: [line()], status: "approved", requestedByUserId: "se1", needBy: "2026-10-05", ...over })

  it("waits on an approved PM request not yet ordered, on a line open, not a held/refused change, not answered", () => {
    expect(awaitingReply(req(), line())).toBe(true)
    expect(awaitingReply(req({ status: "pending" }), line())).toBe(false)
    expect(awaitingReply(req({ poId: "po1" }), line())).toBe(false)
    expect(awaitingReply(req({ pm: false }), line())).toBe(false)
    expect(awaitingReply(req(), line({ chg: { st: "wait" } }))).toBe(false)
    expect(awaitingReply(req(), line({ inv: { k: "none", on: "2026-09-21" } }))).toBe(false)
    expect(awaitingReply(req(), line({ cl: { t: "short", on: "2026-09-21", by: "pm1" } }))).toBe(false)
    expect(awaitingReply(req(), line({ receipts: [{ grn: "GR-01", q: 100, rej: 0, on: "2026-09-20", by: "se1" }] }))).toBe(false)
  })
  it("lists lines by need-by date, with what is still owed", () => {
    const rows = replyRows(projects, { p1: [req({ id: "02", seq: 2, needBy: "2026-10-09" }), req()], p2: [req({ id: "03", needBy: null })] })
    expect(rows.map((r) => [r.projectId, r.requestId, r.owed])).toEqual([
      ["p1", "01", 80],
      ["p1", "02", 80],
      ["p2", "03", 80],
    ])
  })
  it("issue = all owed from a main store; partial between; none with a reason; never above stock on hand", () => {
    const base = { allowed: true, archived: false, request: req(), line: line() }
    expect(replyBlocks({ ...base, kind: "issue", q: 0, why: null, warehouseId: "w1", onHand: 80 })).toEqual([])
    expect(replyBlocks({ ...base, kind: "issue", q: 0, why: null, warehouseId: "w1", onHand: 50 })).toEqual(["over_stock"])
    expect(replyBlocks({ ...base, kind: "issue", q: 0, why: null, warehouseId: null, onHand: null })).toEqual(["no_warehouse"])
    expect(replyBlocks({ ...base, kind: "part", q: 80, why: "linked", warehouseId: "w1", onHand: null })).toEqual(["bad_qty"])
    expect(replyBlocks({ ...base, kind: "part", q: 30, why: null, warehouseId: "w1", onHand: null })).toEqual(["no_reason"])
    expect(replyBlocks({ ...base, kind: "none", q: 0, why: "none", warehouseId: null, onHand: null })).toEqual([])
    expect(replyBlocks({ ...base, allowed: false, archived: true, kind: "none", q: 0, why: "none", warehouseId: null, onHand: null })).toEqual(["no_permission", "archived"])
    expect(replyBlocks({ ...base, line: line({ inv: { k: "none", on: "x" } }), kind: "none", q: 0, why: "none", warehouseId: null, onHand: null })).toEqual(["not_waiting"])
  })
  it("stores issue | none as the project reads it; a partial is an issue with what is kept and why", () => {
    const common = { owed: 80, whyText: "Committed to another project", warehouseId: "w1", warehouseName: "Main", note: null, on: "2026-09-29", by: "k1", byName: "Keeper" }
    expect(buildReply({ ...common, kind: "issue", q: 0, why: null })).toMatchObject({ k: "issue", q: 80, kept: 0, why: null, warehouseName: "Main" })
    expect(buildReply({ ...common, kind: "part", q: 30, why: "linked" })).toMatchObject({ k: "issue", q: 30, kept: 50, whyK: "linked", why: "Committed to another project" })
    expect(buildReply({ ...common, kind: "none", q: 0, why: "none" })).toMatchObject({ k: "none", q: 0, kept: 80, warehouseId: null })
  })

  describe("replyOnRequestLine (fake Firestore)", () => {
    const P = "projects/p1"
    beforeEach(() => {
      resetFakeDb()
      seed(P, { organizationId: "org", pm: { no: "PJ-2026/001", lifecycle: "live" } })
      seed(`${P}/purchaseRequests/01`, { pm: true, seq: 1, status: "approved", requestedByUserId: "se1", items: [{ name: "Block 20", quantity: 100, unit: "pc" }], lines: [line(), line({ name: "Sand", unit: "m3", key: materialKeyOf("Sand", "m3"), receipts: [] })] })
    })
    const input = { projectId: "p1", requestId: "01", index: 1, kind: "part" as const, q: 40, why: "none" as const, whyText: "No stock", warehouseId: "w1", warehouseName: "Main", onHand: 40, note: null }
    it("writes only the line's reply, once", async () => {
      await replyOnRequestLine(db, keeper, input)
      const d = readDoc<{ lines: ReqLine[]; items: unknown[] }>(`${P}/purchaseRequests/01`)!
      expect(d.lines[1].inv).toMatchObject({ k: "issue", q: 40, kept: 60, byName: "Keeper", warehouseId: "w1" })
      expect(d.lines[0].inv).toBeUndefined()
      expect(d.items).toEqual([{ name: "Block 20", quantity: 100, unit: "pc" }])
      await expect(replyOnRequestLine(db, keeper, input)).rejects.toMatchObject({ blocks: ["not_waiting"] })
    })
    it("refuses without the keeper's permission, and on an archived project", async () => {
      await expect(replyOnRequestLine(db, { ...keeper, allowed: false }, input)).rejects.toMatchObject({ blocks: ["no_permission"] })
      seed(P, { organizationId: "org", pm: { no: "PJ-2026/001", lifecycle: "closed" } })
      await expect(replyOnRequestLine(db, keeper, input)).rejects.toMatchObject({ blocks: ["archived"] })
    })
  })
})

describe("Procurement reads the projects' SRET / NOPO / EQH", () => {
  const NOW = new Date("2026-09-29T09:00:00Z")
  const ev = (over: Partial<PmBoundaryFact>): PmBoundaryFact => ({ key: "k", kind: "SRET", projectId: "p1", projectNo: "PJ-2026/001", amount: 0, params: {}, at: "2026-09-27T08:00:00Z", ...over })
  const events = [
    ev({ key: "prj:SRET:1", kind: "SRET", amount: 900, params: { material: "Block 20", unit: "pc", qty: 30, why: "nc", project: "Tower" } }),
    ev({ key: "prj:SRET:2", kind: "SRET", params: { material: "Tiles", unit: "m2", qty: 5, why: "dmg" } }),
    ev({ key: "prj:NOPO:1", kind: "NOPO", amount: 120, params: { material: "Sand", unit: "m3", qty: 4 } }),
    ev({ key: "prj:EQH:1", kind: "EQH", params: { request: "03", what: "Crane 50t", qty: 1, from: "2026-10-01", to: "2026-10-10", operator: true } }),
    ev({ key: "prj:NOPO:old", kind: "NOPO", at: "2026-08-01T08:00:00Z" }),
  ]
  it("one informational row each, opening the project on the tab that holds it; old ones drop off", () => {
    const rows = pmBoundaryTasks(events, NOW)
    expect(rows.map((r) => [r.kind, r.titleKey, r.href, r.priority])).toEqual([
      ["pm_supplier_return", "task.pm_supplier_return.title_nc", PROJECT_HREF("p1", "pmStore"), 3],
      ["pm_supplier_return", "task.pm_supplier_return.title_charged", PROJECT_HREF("p1", "pmStore"), 3],
      ["pm_cash_inbound", "task.pm_cash_inbound.title", PROJECT_HREF("p1", "pmStore"), 3],
      ["pm_hire", "task.pm_hire.title", PROJECT_HREF("p1", "pmReq"), 3],
    ])
    expect(rows[3].titleParams).toMatchObject({ request: "03", what: "Crane 50t", fromDay: "2026-10-01", toDay: "2026-10-10" })
    expect(rows[3].subParams).toMatchObject({ operator: 1, qty: 1 })
    expect(rows[1].subParams.project).toBe("PJ-2026/001")
  })
  const actor = (over: Partial<TodayActor> = {}): TodayActor => ({ uid: "u", name: "U", isOwner: false, canApprove: false, canPrepare: false, canExpedite: false, canReceive: false, seesPrices: false, ...over })
  const world: ProcWorld = { orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, pmEvents: events }
  it("the manager and the buyer see them — amounts only for who sees prices; an expediter does not", () => {
    const buyer = todayTasks(world, actor({ canPrepare: true, canExpedite: true, seesPrices: true }), NOW).filter((x) => x.kind.startsWith("pm_"))
    expect(buyer).toHaveLength(4)
    expect(buyer.find((x) => x.id === "pm:prj:SRET:1")).toMatchObject({ amount: 900, group: "delivery", actionKey: "actions.openProject" })
    expect(buyer.find((x) => x.kind === "pm_hire")?.group).toBe("need")
    const sourcer = todayTasks(world, actor({ canSource: true }), NOW).filter((x) => x.kind.startsWith("pm_"))
    expect(sourcer.find((x) => x.id === "pm:prj:SRET:1")?.amount).toBeNull()
    expect(todayTasks(world, actor({ canExpedite: true }), NOW).filter((x) => x.kind.startsWith("pm_"))).toEqual([])
    const ownerRO = todayTasks({ ...world, ownerHasTeam: true }, actor({ isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, seesPrices: true }), NOW).filter((x) => x.kind.startsWith("pm_"))
    expect(ownerRO.every((x) => x.actionKey === "actions.view")).toBe(true)
  })
})
