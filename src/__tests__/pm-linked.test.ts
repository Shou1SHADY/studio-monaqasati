/**
 * PM 1.0 — what the project store ledger links together: subcontractor custody
 * on the ledger (E-25), the look-ahead's materials and plant constraints (E-21),
 * equipment requests answered, received on site or hired instead (E-29), the
 * hold with its day and reason (G-27), the change flow on the client, boundary
 * events for returns / supplier returns / cash inbound, and self-approval by the
 * company's setting.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { holdBlocks, holdProject, resumeProject } from "@/lib/pm/hold-writes"
import { receivePlant } from "@/lib/pm/plant-writes"
import { decideRefusal, materialKeyOf, storeBalance, storeIdOf, type PmStoreLine, type StoreItem } from "@/lib/pm/store"
import { engineerHold, ledgerCustody, ledgerCustodyRows, ledgerRecoveryDue, rateVsEstimate, subEstimate, subShare, subStoreBlocks, type PmSubcontract } from "@/lib/pm/subcontract"
import { prepareSubCertificate, recordStoreRecovery, recordSubStoreMove } from "@/lib/pm/subcontract-writes"
import { changeOptions, plantHireable, plantReceivable, plantReplyBlocks, plantState, type ReqLine } from "@/lib/pm/supply"
import { confirmStoreReturn, decideStoreMove, hirePlantInstead, logStoreMove, PmSupplyError, receiveOnProject, recordPlantReply, requestPlant } from "@/lib/pm/supply-writes"
import { activityConstraints, missingMaterials, type LookFacts } from "@/lib/pm/weekly-plan"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const siteActor = { uid: "se1", name: "Site" }
const pmActor = { uid: "pm1", name: "PM" }
const today = todayDay()

const block = materialKeyOf("Block 20", "pc")
const item = (over: Partial<StoreItem> = {}): StoreItem => ({ id: "i1", code: "04-01", description: "Blockwork", unit: "m2", quantity: 1000, executed: 300, ...over })
const contract = (over: Partial<PmSubcontract> = {}): PmSubcontract => ({
  id: "01",
  seq: 1,
  party: { name: "Al-Itqan" },
  partyKey: "n:al-itqan",
  retention: 0.1,
  startOn: "2026-09-01",
  endOn: null,
  note: null,
  lines: [{ itemId: "i1", code: "04-01", description: null, unit: "m2", qty: 1000, rate: 40, value: 40000, certified: 0 }],
  value: 40000,
  by: "pm1",
  on: "2026-09-01",
  ...over,
})
const line = (moves: PmStoreLine["moves"], over: Partial<PmStoreLine> = {}): PmStoreLine => ({
  id: storeIdOf(block),
  key: block,
  name: "Block 20",
  unit: "pc",
  rates: { i1: { r: 12.5, w: 4, ex0: 100, src: "rate" } },
  moves,
  ...over,
})

describe("custody on the store ledger (E-25)", () => {
  const issued = line([
    { t: "rc", q: 5000, on: "2026-09-01", by: "se1" },
    { t: "iss", q: 3000, on: "2026-09-02", by: "se1", sub: "n:al-itqan" },
    { t: "back", q: 200, on: "2026-09-10", by: "se1", sub: "n:al-itqan" },
  ])
  it("his theoretical use is the store's rate × his share of the executed work since tracking began", () => {
    const f = ledgerCustody(issued, [item()], [contract()], "n:al-itqan")
    expect(f.issued).toBe(2800)
    expect(f.theoretical).toBe(2500)
    expect(f.allowed).toBe(100)
    expect(f.cap).toBe(2600)
    expect(f.book).toBe(200)
    expect(f.gap).toBeNull()
  })
  it("an item let to two subcontractors splits by the quantity each holds", () => {
    const two = [contract({ lines: [{ ...contract().lines[0], qty: 600 }] }), contract({ id: "02", seq: 2, party: { name: "B" }, partyKey: "n:b", lines: [{ ...contract().lines[0], qty: 400 }] })]
    expect(subShare(two, "n:al-itqan", "i1")).toBeCloseTo(0.6)
    expect(ledgerCustody(issued, [item()], two, "n:al-itqan").theoretical).toBe(1500)
  })
  it("custody moves never move the store balance; the engineer holds the balance less subs' books", () => {
    expect(storeBalance(issued, [item()])).toBe(5000 - 2500)
    expect(engineerHold(issued, [item()], [contract()])).toBe(2500 - 200)
  })
  it("a count below the book is his gap, priced at our cost", () => {
    const counted = line([...issued.moves, { t: "cnt", q: 50, on: "2026-09-20", by: "se1", sub: "n:al-itqan" }])
    const [row] = ledgerCustodyRows([counted], [item()], [contract()], () => 2)
    expect(row.gap).toBe(150)
    expect(row.gapValue).toBe(300)
    expect(row.name).toBe("Al-Itqan")
  })
  it("an issue comes from what the engineer holds; beyond his entitlement it needs a reason", () => {
    const base = { archived: false, t: "iss" as const, hasSub: true, hold: 1000, custody: { issued: 2800, cap: 2600 }, note: null, day: today, today }
    expect(subStoreBlocks({ ...base, q: 1200 })).toEqual(["over_hold"])
    expect(subStoreBlocks({ ...base, q: 100 })).toEqual(["over_cap_reason"])
    expect(subStoreBlocks({ ...base, q: 100, note: "redone on the consultant's instruction" })).toEqual([])
    expect(subStoreBlocks({ ...base, t: "back", q: 3000 })).toEqual(["over_return"])
    expect(subStoreBlocks({ ...base, t: "cnt", q: 0, hasSub: false })).toEqual(["no_sub"])
  })
  it("recoveries awaiting deduction are read from the ledger lines", () => {
    expect(ledgerRecoveryDue([{ recoveries: [{ sub: "n:al-itqan", q: 1, rate: 2, double: false, amount: 2, on: today, by: "x", certSeq: null }, { sub: "n:al-itqan", q: 1, rate: 2, double: false, amount: 5, on: today, by: "x", certSeq: 1 }] }], "n:al-itqan")).toBe(2)
  })
})

describe("the subcontract register against our estimate", () => {
  it("rate vs estimate and the margin effect on the scope with an estimate", () => {
    expect(rateVsEstimate(44, 40)).toBeCloseTo(10)
    expect(rateVsEstimate(44, 0)).toBeNull()
    expect(subEstimate([{ qty: 100, rate: 44, estCost: 40 }, { qty: 10, rate: 5, estCost: 0 }])).toEqual({ estimate: 4000, value: 4400, diff: 400, known: 1 })
  })
})

describe("look-ahead: materials on site and plant (E-21)", () => {
  const facts = (over: Partial<LookFacts> = {}): LookFacts => ({
    items: [{ id: "i1", code: "04-01", quantity: 1000, rate: 40, executed: 300, unit: "m2" }],
    activities: [],
    obstacles: [],
    livePermits: 0,
    staleDrawings: 0,
    on: { docs: false, subm: false, wir: false, rfi: false, hse: false, stock: true, eqp: true },
    ...over,
  })
  const act = { id: "01", seq: 1, name: "Blockwork L2", from: "2026-10-10", to: "2026-10-30", itemIds: ["i1"], pred: null, by: "pm1", at: "" }
  const empty = line([{ t: "rc", q: 2500, on: "2026-09-01", by: "se1" }])
  it("a material with nothing on the project and nothing coming blocks; an approved request within a week clears it", () => {
    expect(missingMaterials(act, facts({ stores: [empty] }), "2026-10-01")).toEqual(["Block 20"])
    const coming: ReqLine = { itemId: "i1", code: "04-01", key: block, name: "Block 20", unit: "pc", qty: 1000 }
    expect(missingMaterials(act, facts({ stores: [empty], requests: [{ status: "approved", withdrawn: false, needBy: "2026-10-12", lines: [coming] }] }), "2026-10-01")).toEqual([])
    expect(activityConstraints(act, facts({ stores: [line([{ t: "rc", q: 9000, on: "2026-09-01", by: "se1" }])] }), "2026-10-01").find((c) => c.k === "mat")?.ok).toBe(true)
  })
  it("plant: not evaluated without a request; blocked until the approved request is received on site", () => {
    expect(activityConstraints(act, facts(), "2026-10-01").find((c) => c.k === "crew")?.ok).toBeNull()
    const waiting = facts({ plant: [{ activityId: "01", status: "go", what: "Mixer" }] })
    expect(activityConstraints(act, waiting, "2026-10-01").find((c) => c.k === "crew")).toMatchObject({ ok: false, detail: { kind: "plant", what: "Mixer" } })
    const got = facts({ plant: [{ activityId: "01", status: "go", what: "Mixer", got: { plantSeq: 1 } }] })
    expect(activityConstraints(act, got, "2026-10-01").find((c) => c.k === "crew")?.ok).toBe(true)
  })
})

describe("equipment requests answered (E-29)", () => {
  it("a reply is recorded once, on an approved request; received when allocated or hired; hired when busy or none", () => {
    const go = { status: "go" as const, rep: null }
    expect(plantReplyBlocks({ archived: false, r: go, k: "alloc", unit: "", on: today, today })).toEqual(["no_unit"])
    expect(plantReplyBlocks({ archived: false, r: { status: "wait", rep: null }, k: "none", on: today, today })).toEqual(["not_with_desk"])
    expect(plantReceivable({ status: "go", rep: { k: "alloc", on: today, by: "x" }, got: null })).toBe(true)
    expect(plantHireable({ status: "go", rep: { k: "late", on: today, by: "x" }, got: null })).toBe(true)
    expect(plantHireable({ status: "go", rep: { k: "alloc", on: today, by: "x" }, got: null })).toBe(false)
    expect(plantState({ status: "go", rep: null, got: null })).toBe("desk")
  })
})

describe("the change on the client", () => {
  const l = (st: "wait" | "own"): ReqLine => ({ itemId: "i1", code: "04-01", key: block, name: "Block 20", unit: "pc", qty: 10, chg: { st, voSeq: st === "own" ? 3 : null } })
  it("«on us» comes back only when the client rejected the variation; above the limit it is the owner's", () => {
    expect(changeOptions({ line: l("own"), voStatus: "wait", estimate: null, limit: 75000 }).clientRejected).toBe(false)
    expect(changeOptions({ line: l("own"), voStatus: "rej", estimate: null, limit: 75000 }).clientRejected).toBe(true)
    expect(changeOptions({ line: l("wait"), voStatus: null, estimate: 90000, limit: 75000 }).usOverLimit).toBe(true)
  })
  it("self-approval of a store move follows the company's setting", () => {
    const m = { t: "use" as const, q: 1, on: today, by: "u1", st: "wait" as const }
    expect(decideRefusal(m, "ok", "u1", false)).toBe("self")
    expect(decideRefusal(m, "ok", "u1", true)).toBeNull()
  })
})

describe("hold (G-27)", () => {
  it("postponing needs a live project, a reason and a day not ahead", () => {
    expect(holdBlocks({ archived: false, lifecycle: "live", to: "hold", why: "", since: today, today })).toEqual(["no_reason"])
    expect(holdBlocks({ archived: false, lifecycle: "plan", to: "hold", why: "x", since: today, today })).toEqual(["not_live"])
    expect(holdBlocks({ archived: false, lifecycle: "live", to: "live", today })).toEqual(["not_held"])
  })
})

describe("writes", () => {
  const P = "projects/p1"
  const sid = storeIdOf(block)
  beforeEach(() => {
    resetFakeDb()
    seed(P, { organizationId: "org", name: "Villas", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/001", lifecycle: "live", plantCount: 4 } })
    seed(`${P}/boqItems/i1`, { itemNo: "04-01", descriptionAr: "بلوك", unit: "m2", quantity: 1000, executedQuantity: 300 })
    const { id: _id, ...doc } = contract()
    void _id
    seed(`${P}/pmSubcontracts/01`, doc)
    seed(`${P}/pmStore/${sid}`, { key: block, name: "Block 20", unit: "pc", rates: { i1: { r: 12.5, w: 4, ex0: 250, src: "rate" } }, moves: [{ t: "rc", q: 5000, on: "2026-09-01", by: "se1" }] })
  })

  it("issues, counts and recovers on the ledger; the certificate deducts the recovery once", async () => {
    await recordSubStoreMove(db, site, "p1", siteActor, sid, { t: "iss", partyKey: "n:al-itqan", q: 1000, day: today, note: "reason: second floor" })
    const out = await recordSubStoreMove(db, site, "p1", siteActor, sid, { t: "cnt", partyKey: "n:al-itqan", q: 300, day: today, note: null, files: [{ url: "https://x/s.pdf", name: "s.pdf" }] })
    expect(out.gap).toBe(50)
    const led = readDoc<PmStoreLine>(`${P}/pmStore/${sid}`)!
    expect(led.moves.map((m) => m.t)).toEqual(["rc", "iss", "cnt"])
    expect(led.moves[2].files).toHaveLength(1)
    await expect(recordSubStoreMove(db, site, "p1", siteActor, sid, { t: "iss", partyKey: "n:nobody", q: 1, day: today, note: null })).rejects.toMatchObject({ blocks: expect.arrayContaining(["no_sub"]) })

    const amount = await recordStoreRecovery(db, pm, "p1", pmActor, sid, { partyKey: "n:al-itqan", q: 50, rate: 2, double: false, note: null })
    expect(amount).toBe(100)
    seed(`${P}/boqItems/i1`, { itemNo: "04-01", descriptionAr: "بلوك", unit: "m2", quantity: 1000, executedQuantity: 400 })
    const cert = await prepareSubCertificate(db, pm, "p1", pmActor, { partyKey: "n:al-itqan", percents: { "1:0": 30 } })
    expect(cert.recovery).toBe(100)
    expect(readDoc<PmStoreLine>(`${P}/pmStore/${sid}`)!.recoveries?.[0].certSeq).toBe(cert.seq)
  })

  it("a return reaches Inventory, which confirms it; a cash inbound approved reaches Procurement", async () => {
    await logStoreMove(db, site, "p1", siteActor, sid, { t: "ret", q: 100, warehouseId: "w1", warehouseName: "Main" })
    expect(readDoc(`pmEvents/prj:RET:PJ-2026_001:${sid}:1`)).toMatchObject({ kind: "RET", params: { qty: 100, warehouseId: "w1" } })
    await confirmStoreReturn(db, "p1", { uid: "inv1", name: "Keeper" }, sid, 1)
    expect(readDoc<PmStoreLine>(`${P}/pmStore/${sid}`)!.moves[1]).toMatchObject({ st: "done", invByName: "Keeper" })

    await logStoreMove(db, site, "p1", siteActor, sid, { t: "rx", q: 10, from: "cash" })
    await expect(decideStoreMove(db, pm, "p1", siteActor, sid, 2, "ok", 3)).rejects.toBeInstanceOf(PmAccessError)
    await decideStoreMove(db, pm, "p1", pmActor, sid, 2, "ok", 3)
    expect(readDoc(`pmEvents/prj:NOPO:PJ-2026_001:${sid}:2`)).toMatchObject({ kind: "NOPO", amount: 30 })
  })

  it("the logger approves their own move only when the company allows it", async () => {
    await logStoreMove(db, pm, "p1", pmActor, sid, { t: "loss", q: 5, why: "dmg" })
    await expect(decideStoreMove(db, pm, "p1", pmActor, sid, 1, "ok", null)).rejects.toBeInstanceOf(PmAccessError)
    seed("pmSettings/org", { organizationId: "org", selfApproval: true })
    await decideStoreMove(db, pm, "p1", pmActor, sid, 1, "ok", null)
    expect(readDoc<PmStoreLine>(`${P}/pmStore/${sid}`)!.moves[1]).toMatchObject({ st: "ok", self: true })
  })

  it("a receipt without a project store is expensed — no ledger line", async () => {
    const key = materialKeyOf("Sand", "m3")
    seed(`${P}/purchaseRequests/01`, { pm: true, seq: 1, status: "approved", poId: "po1", requestedByUserId: "se1", lines: [{ itemId: "i1", code: "04-01", key, name: "Sand", unit: "m3", qty: 10 }] })
    await receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 4, rej: 0, dn: "DN1", note: null, short: false, withStore: false, files: [{ url: "https://x/d.jpg", name: "d.jpg" }] })
    expect(readDoc(`${P}/pmStore/${storeIdOf(key)}`)).toBeNull()
    expect(readDoc<{ lines: ReqLine[] }>(`${P}/purchaseRequests/01`)!.lines[0].receipts?.[0].files).toHaveLength(1)
  })

  it("equipment: numbered apart from units on site, answered, hired instead, or received on site", async () => {
    const base = { category: "light" as const, what: "Mixer", activityId: null, activityName: null, hasActivities: false, from: today, to: today, qty: 1, operator: false, whyK: "scope" as const, why: null }
    const first = await requestPlant(db, pm, "p1", pmActor, base)
    expect(first).toEqual({ seq: 5, status: "go" })
    expect(readDoc<{ pm: { plantReqCount: number; plantCount: number } }>(P)!.pm).toMatchObject({ plantReqCount: 5, plantCount: 4 })

    await recordPlantReply(db, site, "p1", siteActor, 5, { k: "none", text: null, on: today })
    await expect(hirePlantInstead(db, site, "p1", siteActor, 5)).rejects.toBeInstanceOf(PmAccessError)
    await hirePlantInstead(db, pm, "p1", pmActor, 5)
    expect(readDoc(`pmEvents/prj:EQH:PJ-2026_001:05`)).toMatchObject({ kind: "EQH", params: { what: "Mixer" } })
    await expect(recordPlantReply(db, site, "p1", siteActor, 5, { k: "alloc", unit: "M-1", on: today })).rejects.toBeInstanceOf(PmSupplyError)

    const unit = await receivePlant(db, site, "p1", siteActor, { tag: "H-7", name: "Mixer", category: "light", ownership: "hire", supplier: "Rent Co", qty: 1, from: today, to: today, condition: "ok", requestSeq: 5 })
    expect(unit).toBe(5)
    expect(readDoc<{ got: { plantSeq: number } }>(`${P}/pmPlantRequests/05`)!.got.plantSeq).toBe(5)
    await expect(receivePlant(db, site, "p1", siteActor, { tag: "H-8", name: "Mixer", category: "light", ownership: "hire", qty: 1, from: today, to: today, condition: "ok", requestSeq: 5 })).rejects.toMatchObject({ blocks: ["not_receivable"] })
  })

  it("hold stores its day and reason; resume clears them and logs the hold", async () => {
    await expect(holdProject(db, site, "p1", { why: "Owner redesign", since: today })).rejects.toBeInstanceOf(PmAccessError)
    await holdProject(db, owner, "p1", { why: "Owner redesign", since: "2026-09-01" })
    expect(readDoc<{ status: string; pm: Record<string, unknown> }>(P)).toMatchObject({ status: "hold", pm: { lifecycle: "hold", holdSince: "2026-09-01", holdWhy: "Owner redesign" } })
    await resumeProject(db, pm, "p1", pmActor)
    const after = readDoc<{ status: string; pm: { lifecycle: string; holdSince: null; holdLog: unknown[] } }>(P)!
    expect(after.pm).toMatchObject({ lifecycle: "live", holdSince: null })
    expect(after.pm.holdLog).toHaveLength(1)
  })
})
