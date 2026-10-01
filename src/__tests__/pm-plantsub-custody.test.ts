/**
 * PM 1.0 — subcontractor custody reconciliation (STK-04): the gap is what the
 * COUNT found — the book as of that count less the count, less what was already
 * recovered against it. An issue after the count is not part of it, a recovery
 * never exceeds it, and a count is never dated before the one already recorded.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { addDays } from "@/lib/pm/programme"
import { todayDay } from "@/lib/pm/format"
import type { PmStoreLine, StoreItem, StoreMove } from "@/lib/pm/store"
import { custodyFigures, ledgerCustody, moveBlocks, recoveryBlocks, subStoreBlocks, type CustodyMove } from "@/lib/pm/subcontract"
import { openCustody, recordCustodyMove, recordRecovery, recordStoreRecovery, recordSubStoreMove, registerSubcontract } from "@/lib/pm/subcontract-writes"

const db = fakeFirestore as unknown as Firestore
const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const pmA = { uid: "pm1", name: "PM" }
const KEY = "n:al-itqan"

// 500 m² measured × 1.25 = 625 theoretical, 1% waste = 6.25 allowed → he has earned 631.25.
const items: StoreItem[] = [{ id: "i1", code: "04-02-01", description: "Plaster", unit: "m2", quantity: 1000, executed: 500 }]
const contracts = [{ partyKey: KEY, lines: [{ itemId: "i1", code: null, description: null, unit: null, qty: 1000, rate: 40, value: 40000, certified: 0 }] }]
const mv = (t: StoreMove["t"], q: number, on: string, extra: Partial<StoreMove> = {}): StoreMove => ({ t, q, on, by: "pm1", sub: t === "op" ? null : KEY, ...extra })
const line = (moves: StoreMove[]): Pick<PmStoreLine, "moves" | "rates"> => ({ rates: { i1: { r: 1.25, w: 1, ex0: 0, src: "rate" } }, moves })

describe("the gap on the store ledger (STK-04)", () => {
  const counted = [mv("op", 2000, "2026-09-01"), mv("iss", 800, "2026-09-02"), mv("cnt", 150, "2026-09-20")]

  it("issued 800, earned 631.25, book 168.75, counted 150 → 18.75 short", () => {
    expect(ledgerCustody(line(counted), items, contracts, KEY)).toMatchObject({ issued: 800, theoretical: 625, allowed: 6.25, book: 168.75, gap: 18.75 })
  })

  it("an issue after the count grows what he holds, not the gap", () => {
    const f = ledgerCustody(line([...counted, mv("iss", 100, "2026-09-25")]), items, contracts, KEY)
    expect(f).toMatchObject({ issued: 900, book: 268.75, gap: 18.75 })
    // The same day, entered after the count: still after it.
    expect(ledgerCustody(line([...counted, mv("iss", 100, "2026-09-20")]), items, contracts, KEY).gap).toBe(18.75)
    // A return after the count is material coming back — it is not his waste either.
    expect(ledgerCustody(line([...counted, mv("back", 30, "2026-09-26")]), items, contracts, KEY).gap).toBe(18.75)
  })

  it("what was recovered against the count closes the gap; a new count starts afresh", () => {
    const part = [...counted, mv("back", 10, "2026-09-21", { recovery: true })]
    expect(ledgerCustody(line(part), items, contracts, KEY).gap).toBe(8.75)
    const all = [...part, mv("back", 8.75, "2026-09-22", { recovery: true })]
    expect(ledgerCustody(line(all), items, contracts, KEY).gap).toBe(0)
    // Recount: the book now carries both recoveries (150), he shows 140 → 10 short.
    expect(ledgerCustody(line([...all, mv("cnt", 140, "2026-09-28")]), items, contracts, KEY)).toMatchObject({ book: 150, gap: 10 })
  })

  it("a recovery above the open gap, or with no count behind it, is refused", () => {
    expect(recoveryBlocks({ archived: false, q: 18.75, rate: 3, gap: 18.75 })).toEqual([])
    expect(recoveryBlocks({ archived: false, q: 40, rate: 3, gap: 18.75 })).toEqual(["over_gap"])
    expect(recoveryBlocks({ archived: false, q: 1, rate: 3, gap: 0 })).toEqual(["over_gap"])
    expect(recoveryBlocks({ archived: false, q: 1, rate: 3, gap: null })).toEqual(["over_gap"])
    expect(recoveryBlocks({ archived: false, q: 0, rate: 0, gap: 5 })).toEqual(["bad_qty", "bad_rate"])
  })

  it("a count dated before the last count is refused with a reason", () => {
    const base = { archived: false, hasSub: true, q: 100, hold: 1000, custody: { issued: 800, cap: 631.25 }, note: null, today: "2026-09-28" }
    expect(subStoreBlocks({ ...base, t: "cnt", day: "2026-09-19", lastCount: "2026-09-20" })).toEqual(["older_count"])
    expect(subStoreBlocks({ ...base, t: "cnt", day: "2026-09-20", lastCount: "2026-09-20" })).toEqual([])
    expect(subStoreBlocks({ ...base, t: "cnt", day: "2026-09-19", lastCount: null })).toEqual([])
    expect(moveBlocks({ archived: false, kind: "cnt", q: 100, issued: 800, day: "2026-09-19", today: "2026-09-28", lastCount: "2026-09-20" })).toEqual(["older_count"])
    expect(moveBlocks({ archived: false, kind: "iss", q: 100, issued: 800, day: "2026-09-19", today: "2026-09-28", lastCount: "2026-09-20" })).toEqual([])
  })
})

describe("the gap on a custody line recorded before the ledger", () => {
  const m = (t: CustodyMove["t"], q: number, day: string, extra: Partial<CustodyMove> = {}): CustodyMove => ({ t, q, day, by: "se1", ...extra })
  const c = { perUnit: 12.5, waste: 4, executedAtStart: 10, unitCost: 3 }
  const counted = [m("iss", 1000, "2026-09-01"), m("back", 50, "2026-09-10"), m("cnt", 100, "2026-09-20")]

  it("is fixed by the count: later issues do not grow it, recoveries against it close it", () => {
    expect(custodyFigures({ ...c, moves: counted }, 70)).toMatchObject({ issued: 950, book: 170, gap: 70, gapValue: 210 })
    expect(custodyFigures({ ...c, moves: [...counted, m("iss", 100, "2026-09-25")] }, 70)).toMatchObject({ issued: 1050, book: 270, gap: 70 })
    expect(custodyFigures({ ...c, moves: [...counted, m("back", 40, "2026-09-25", { recovery: true })] }, 70)).toMatchObject({ gap: 30, gapValue: 90 })
    expect(custodyFigures({ ...c, moves: [...counted, m("back", 70, "2026-09-25", { recovery: true })] }, 70)).toMatchObject({ gap: 0, gapValue: 0 })
  })
})

describe("the writes", () => {
  const today = todayDay()
  beforeEach(() => {
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
    seed("projects/p1/boqItems/i1", { itemNo: "04-02-01", quantity: 1000, unitPrice: 55, executedQuantity: 500, descriptionAr: "لياسة", unit: "م2" })
    seed("projects/p1/pmStore/m1", { key: "cement|bag", name: "Cement", unit: "bag", rates: { i1: { r: 1.25, w: 1, ex0: 0, src: "rate" } }, moves: [{ t: "op", q: 2000, on: "2026-09-01", by: "pm1" }], recoveries: [] })
  })

  const setUp = async () => {
    await registerSubcontract(db, owner, "p1", { uid: "own", name: "Owner" }, { party: { name: "Al-Itqan" }, retentionPct: 10, startOn: "2026-09-01", endOn: null, note: null, lines: [{ itemId: "i1", qty: 1000, rate: 40 }] })
    await recordSubStoreMove(db, pm, "p1", pmA, "m1", { t: "iss", partyKey: KEY, q: 800, day: today, note: "bulk issue" })
    return recordSubStoreMove(db, pm, "p1", pmA, "m1", { t: "cnt", partyKey: KEY, q: 150, day: today, note: null })
  }

  it("the count fixes the gap — a later issue leaves it, and a recovery cannot be booked twice", async () => {
    expect((await setUp()).gap).toBe(18.75)
    const more = await recordSubStoreMove(db, pm, "p1", pmA, "m1", { t: "iss", partyKey: KEY, q: 100, day: today, note: "second floor" })
    expect(more.gap).toBe(18.75)

    await expect(recordStoreRecovery(db, pm, "p1", pmA, "m1", { partyKey: KEY, q: 118.75, rate: 3, double: false, note: null })).rejects.toMatchObject({ blocks: ["over_gap"] })
    expect(await recordStoreRecovery(db, pm, "p1", pmA, "m1", { partyKey: KEY, q: 18.75, rate: 3, double: false, note: null })).toBe(56.25)
    await expect(recordStoreRecovery(db, pm, "p1", pmA, "m1", { partyKey: KEY, q: 18.75, rate: 3, double: false, note: null })).rejects.toMatchObject({ blocks: ["over_gap"] })
    expect(readDoc<PmStoreLine>("projects/p1/pmStore/m1")!.recoveries).toHaveLength(1)
  })

  it("a count dated before the one on record is refused", async () => {
    await setUp()
    await expect(recordSubStoreMove(db, pm, "p1", pmA, "m1", { t: "cnt", partyKey: KEY, q: 160, day: addDays(today, -1), note: null })).rejects.toMatchObject({ blocks: ["older_count"] })
    expect(readDoc<PmStoreLine>("projects/p1/pmStore/m1")!.moves.filter((x) => x.t === "cnt")).toHaveLength(1)
  })

  it("the earlier custody lines hold the same line: no second recovery of one gap, no older count", async () => {
    await registerSubcontract(db, owner, "p1", { uid: "own", name: "Owner" }, { party: { name: "Al-Itqan" }, retentionPct: 10, startOn: "2026-09-01", endOn: null, note: null, lines: [{ itemId: "i1", qty: 1000, rate: 40 }] })
    await openCustody(db, pm, "p1", pmA, { subcontractSeq: 1, itemId: "i1", material: "Block", unit: "pc", unitCost: 3, perUnit: 12.5, waste: 4, issueQty: 6000, day: today, note: null })
    expect((await recordCustodyMove(db, pm, "p1", pmA, 1, { t: "cnt", q: 5960, day: today, note: null })).gap).toBe(40)
    expect((await recordCustodyMove(db, pm, "p1", pmA, 1, { t: "iss", q: 100, day: today, note: null })).gap).toBe(40)
    expect(await recordRecovery(db, pm, "p1", pmA, 1, { q: 40, rate: 3, double: false, note: null })).toBe(120)
    await expect(recordRecovery(db, pm, "p1", pmA, 1, { q: 40, rate: 3, double: false, note: null })).rejects.toMatchObject({ blocks: ["over_gap"] })
    await expect(recordCustodyMove(db, pm, "p1", pmA, 1, { t: "cnt", q: 5900, day: addDays(today, -1), note: null })).rejects.toMatchObject({ blocks: ["older_count"] })
  })
})
