/**
 * PM 1.0 — Supply: material requests on BOQ items (technical approval, change
 * requests, stop what has not arrived, project-side receipt), the project store
 * ledger (use per item × rate, moves with approval, where the materials went),
 * needs within 30 days, direct purchases under a cap, equipment requests.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import {
  decideRefusal,
  materialKeyOf,
  moveBlocks,
  newMove,
  storeAllowance,
  storeBalance,
  storeIdOf,
  storeNeedLeft,
  storeState,
  whereWent,
  withRate,
  type PmStoreLine,
  type StoreItem,
} from "@/lib/pm/store"
import {
  approveBlocks,
  buildLines,
  lineKind,
  lineNeed,
  linePhase,
  needsWithin,
  pettyBlocks,
  pettyMonth,
  plantBlocks,
  procurementItems,
  receivable,
  receivedLine,
  reqPct,
  reqState,
  requestOf,
  requestSample,
  stoppedLine,
  type PmMaterialRequest,
  type ReqLine,
} from "@/lib/pm/supply"
import {
  approveMaterialRequest,
  createMaterialRequest,
  decideChange,
  decideStoreMove,
  logDirectPurchase,
  logStoreMove,
  PmSupplyError,
  receiveOnProject,
  requestPlant,
  stopLine,
  withdrawMaterialRequest,
} from "@/lib/pm/supply-writes"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const siteActor = { uid: "se1", name: "Site" }
const pmActor = { uid: "pm1", name: "PM" }

const item = (over: Partial<StoreItem> = {}): StoreItem => ({ id: "i1", code: "04-02-01", description: "Plaster", unit: "m2", quantity: 10000, executed: 2000, ...over })
const cement = materialKeyOf("Cement", "bag")
const store = (over: Partial<PmStoreLine> = {}): PmStoreLine => ({ id: storeIdOf(cement), key: cement, name: "Cement", unit: "bag", rates: { i1: { r: 0.2, w: 5, ex0: 1000, src: "rate" } }, moves: [{ t: "rc", q: 300, on: "2026-09-01", by: "se1" }], ...over })
const line = (over: Partial<ReqLine> = {}): ReqLine => ({ itemId: "i1", code: "04-02-01", key: cement, name: "Cement", unit: "bag", qty: 100, receipts: [], ...over })
const req = (over: Partial<PmMaterialRequest> = {}): PmMaterialRequest => ({ id: "01", pm: true, seq: 1, title: "Cement", lines: [line()], status: "approved", requestedByUserId: "se1", ...over })

describe("the store ledger", () => {
  it("use is executed since tracking × rate; balance = in − used − out", () => {
    const x = store()
    expect(storeBalance(x, [item()])).toBe(100) // 300 − (2000 − 1000) × 0.2
    expect(storeAllowance(x, [item()])).toBe(10)
    expect(storeNeedLeft(x, [item()])).toBe(1680) // 8000 × 0.2 × 1.05
  })
  it("states: negative, pending, needs closing, closed", () => {
    expect(storeState(store(), [item({ executed: 3000 })])).toBe("neg")
    const pend = store({ moves: [...store().moves, newMove({ t: "loss", q: 5, on: "2026-09-02", by: "se1", byName: null, why: "dmg" })] })
    expect(storeState(pend, [item()])).toBe("pend")
    expect(storeState(store(), [item({ quantity: 2000 })])).toBe("close")
    expect(storeState(store(), [item({ quantity: 2450, executed: 2450 })])).toBe("done")
  })
  it("a non-conforming loss goes back to the supplier; declared use needs an unrated item", () => {
    expect(newMove({ t: "loss", q: 1, on: "d", by: "u", byName: null, why: "nc" }).t).toBe("sret")
    expect(moveBlocks({ archived: false, t: "use", q: 1, balance: 10, itemId: "i1", itemRated: true })).toContain("item_rated")
    expect(moveBlocks({ archived: false, t: "ret", q: 50, balance: 10, warehouseId: "w" })).toContain("over_balance")
    expect(moveBlocks({ archived: false, t: "rx", q: 50, balance: 0, from: "oth", note: "" })).toContain("source_text")
  })
  it("never approved by whoever logged it, except the owner; theft is not the supplier's", () => {
    const m = newMove({ t: "loss", q: 1, on: "d", by: "u1", byName: null, why: "theft" })
    expect(decideRefusal(m, "ok", "u1", false)).toBe("self")
    expect(decideRefusal(m, "ok", "u1", true)).toBeNull()
    expect(decideRefusal(m, "sup", "u2", false)).toBe("sup_not_loss")
  })
  it("a corrected rate keeps the tracking start; a new one starts now", () => {
    expect(withRate(store(), "i1", 0.25, 5, 2000).i1.ex0).toBe(1000)
    expect(withRate(store({ rates: {} }), "i1", 0.25, 5, 2000).i1.ex0).toBe(2000)
  })
  it("where the materials went, at cost; uncosted lines are counted apart", () => {
    const w = whereWent([store(), store({ id: "b", key: "b", name: "B" })], [item()], (x) => (x.name === "Cement" ? 15 : null))
    expect(w.received).toBe(4500)
    expect(w.measured).toBe(3000)
    expect(w.now).toBe(1500)
    expect(w.uncosted).toBe(1)
  })
})

describe("requests", () => {
  it("line kinds: first on an item with no list, own, change, general", () => {
    const stores = [store()]
    expect(lineKind(stores, { itemId: "i2", name: "Sand", unit: "m3" })).toBe("first")
    expect(lineKind(stores, { itemId: "i1", name: "Cement", unit: "bag" })).toBe("own")
    expect(lineKind(stores, { itemId: "i1", name: "Mesh", unit: "m2" })).toBe("change")
    expect(lineKind(stores, { itemId: null, name: "Gloves", unit: "pc" })).toBe("general")
    const built = buildLines(stores, [item()], [{ itemId: "i1", name: "Mesh", unit: "m2", qty: 5, why: "consultant" }])
    expect(built[0].chg).toEqual({ st: "wait", why: "consultant" })
  })
  it("state, received %, phases and what Procurement sees", () => {
    expect(reqState(req({ status: "pending" }))).toBe("wait")
    expect(reqState(req({ status: "rejected", withdrawn: true }))).toBe("cx")
    const half = req({ lines: [line({ receipts: [{ grn: "01", q: 50, rej: 0, on: "d", by: "u" }] })], poId: "po1" })
    expect(reqPct(half)).toBe(0.5)
    expect(linePhase(half, half.lines[0])).toBe("part")
    expect(receivable(req(), line())).toBe(false)
    expect(receivable(req({ poId: "po1" }), line())).toBe(true)
    expect(procurementItems({ lines: [line({ chg: { st: "wait" } }), line({ name: "Sand" })] })).toEqual([{ name: "Sand", unit: "bag", quantity: 100 }])
  })
  it("a closed line shows what arrived; stopping with nothing received cancels", () => {
    expect(stoppedLine(line(), { on: "d", by: "u" }).cl?.t).toBe("cancel")
    const r = receivedLine(line(), { grn: "01", q: 40, rej: 0, on: "d", by: "u", short: true }, "d", "u")
    expect(r.cl?.t).toBe("short")
    expect(procurementItems({ lines: [r] })[0].quantity).toBe(40)
    expect(reqState(req({ lines: [r] }))).toBe("shut")
    expect(receivedLine(line(), { grn: "01", q: 100, rej: 0, on: "d", by: "u" }, "d", "u").cl?.t).toBe("full")
  })
  it("need = remaining × rate × (1 + waste) − on hand − on the way", () => {
    expect(lineNeed({ key: cement, stores: [store()], items: [item()], requests: [req()] })).toBe(1480)
  })
  it("a rejected or missing sample blocks approval; all-change requests too", () => {
    expect(requestSample(req(), [{ id: "i1", pmSample: true, pmSub: "rej" }])).toBe("rej")
    expect(approveBlocks({ archived: false, request: req({ status: "pending" }), sample: "none" })).toContain("sample_missing")
    expect(approveBlocks({ archived: false, request: req({ status: "pending", lines: [line({ chg: { st: "wait" } })] }), sample: null })).toContain("all_changes")
  })
  it("needs within 30 days come from the activity window, less what is on hand", () => {
    const n = needsWithin({ stores: [store()], items: [item()], requests: [], activities: [{ from: "2026-09-01", to: "2026-12-29", itemIds: ["i1"] }], startOn: "2026-08-01", today: "2026-09-30" })
    expect(n.gaps).toHaveLength(1)
    expect(n.gaps[0].gap).toBeGreaterThan(0)
  })
  it("reads a legacy request's items as general lines", () => {
    const r = requestOf({ id: "x", title: "old", items: [{ name: "Nails", quantity: "3", unit: "kg" }], status: "approved", requestedByUserId: "u" })
    expect(r.lines[0]).toMatchObject({ itemId: null, qty: 3 })
  })
})

describe("caps and plant", () => {
  it("direct purchases: per purchase cap and a rolling month", () => {
    expect(pettyBlocks({ archived: false, what: "x", supplier: "y", amount: 3500, day: "2026-09-01", today: "2026-09-02" })).toContain("over_one")
    expect(pettyMonth([{ day: "2026-09-01", amount: 1000 }, { day: "2026-07-01", amount: 9000 }], "2026-09-20")).toBe(1000)
  })
  it("plant: an activity is required when the project has a programme; other is stated", () => {
    const base = { archived: false, category: "heavy" as const, what: "Excavator", activityId: null, hasActivities: true, from: "2026-10-01", to: "2026-10-05", qty: 1, whyK: "oth" as const, why: "" }
    expect(plantBlocks(base)).toEqual(expect.arrayContaining(["no_activity", "why_text"]))
  })
})

describe("writes", () => {
  const P = "projects/p1"
  beforeEach(() => {
    resetFakeDb()
    seed(P, { organizationId: "org", name: "Villas", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "live" } })
    seed(`${P}/boqItems/i1`, { itemNo: "04-02-01", descriptionAr: "لياسة", unit: "m2", quantity: 10000, executedQuantity: 2000 })
    seed(`${P}/pmStore/${storeIdOf(cement)}`, { key: cement, name: "Cement", unit: "bag", rates: { i1: { r: 0.2, w: 5, ex0: 1000, src: "rate" } }, moves: [{ t: "rc", q: 300, on: "2026-09-01", by: "se1" }] })
  })

  it("the site asks, the manager approves, the site receives into the store", async () => {
    const seq = await createMaterialRequest(db, site, "p1", siteActor, { title: "", needBy: null, notes: "grade 42.5", lines: [{ itemId: "i1", name: "Cement", unit: "bag", qty: 100 }] })
    expect(seq).toBe(1)
    const d = readDoc<Record<string, unknown>>(`${P}/purchaseRequests/01`)
    expect(d).toMatchObject({ pm: true, status: "pending", items: [{ name: "Cement", quantity: 100, unit: "bag" }] })
    await expect(approveMaterialRequest(db, site, "p1", siteActor, "01")).rejects.toBeInstanceOf(PmAccessError)
    expect(await approveMaterialRequest(db, pm, "p1", pmActor, "01")).toBe("approved")
    await expect(receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 60, rej: 0, dn: "DN-1", note: null, short: false })).rejects.toBeInstanceOf(PmSupplyError)
    seed(`${P}/purchaseRequests/01`, { ...(readDoc<Record<string, unknown>>(`${P}/purchaseRequests/01`) as Record<string, unknown>), poId: "po1", poNumber: "PO-2026/001" })
    expect(await receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 60, rej: 5, dn: "DN-1", note: null, short: false })).toBe("01")
    const s = readDoc<PmStoreLine>(`${P}/pmStore/${storeIdOf(cement)}`)
    expect(s?.moves.at(-1)).toMatchObject({ t: "rc", q: 60, grn: "01", rej: 5 })
    await stopLine(db, site, "p1", siteActor, "01", 0, "need", null)
    const after = requestOf({ id: "01", ...(readDoc<Record<string, unknown>>(`${P}/purchaseRequests/01`) as Record<string, unknown>) })
    expect(after.lines[0].cl?.t).toBe("short")
    expect(reqState(after)).toBe("shut")
  })

  it("a change on the client opens a draft variation; the requester withdraws a pending request", async () => {
    await createMaterialRequest(db, site, "p1", siteActor, { title: "Mesh", needBy: null, notes: null, lines: [{ itemId: "i1", name: "Mesh", unit: "m2", qty: 60, why: "consultant" }] })
    const { voSeq } = await decideChange(db, pm, "p1", pmActor, "01", 0, { st: "own", voSeq: null, ref: "SI-17" })
    expect(voSeq).toBe(1)
    expect(readDoc(`${P}/pmVariations/01`)).toMatchObject({ status: "draft", instructionNo: "SI-17" })
    await withdrawMaterialRequest(db, site, "p1", siteActor, "01")
    expect(readDoc(`${P}/purchaseRequests/01`)).toMatchObject({ status: "rejected", withdrawn: true })
  })

  it("a loss waits for someone else; the approved loss reaches Finance", async () => {
    await logStoreMove(db, site, "p1", siteActor, storeIdOf(cement), { t: "loss", q: 10, why: "dmg" })
    await expect(decideStoreMove(db, { ...pm, seat: { uid: "se1", role: "pm" } }, "p1", siteActor, storeIdOf(cement), 1, "ok", 15)).rejects.toBeInstanceOf(PmAccessError)
    await decideStoreMove(db, pm, "p1", pmActor, storeIdOf(cement), 1, "ok", 15)
    const ev = listCollection<{ kind: string; amount: number }>("pmEvents")
    expect(ev[0]).toMatchObject({ kind: "LOSS", amount: 150 })
  })

  it("direct purchases over the cap are refused; within it they reach Finance; plant from the PM goes straight out", async () => {
    await expect(logDirectPurchase(db, site, "p1", siteActor, { what: "Nails", supplier: "Shop", amount: 3200, receipt: null, day: todayDay() })).rejects.toBeInstanceOf(PmSupplyError)
    await logDirectPurchase(db, site, "p1", siteActor, { what: "Nails", supplier: "Shop", amount: 640, receipt: "4471", day: todayDay() })
    expect(listCollection<{ kind: string }>("pmEvents")[0].kind).toBe("CASH")
    const out = await requestPlant(db, pm, "p1", pmActor, { category: "light", what: "Generator", activityId: null, activityName: null, hasActivities: false, from: "2026-10-01", to: "2026-10-10", qty: 1, operator: false, whyK: "site", why: null })
    expect(out.status).toBe("go")
  })
})
