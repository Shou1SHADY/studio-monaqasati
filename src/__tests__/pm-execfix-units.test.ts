/**
 * PM 1.0 — delivery units, four defects found against the PRD (ZN-01, IPC-05,
 * WF-25): an equal split rounded every share up, so the last unit could never
 * be completed; a unit whose planned day had come showed "Infinity%"; a unit's
 * handover freed half its retention whatever the contract's release term, and
 * by what the terms could hold rather than what is held; and units set up
 * before the BOQ existed stayed without quantities for good.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { recordProvisional } from "@/lib/pm/acceptance-writes"
import { PM_EVENTS, type PmEvent } from "@/lib/pm/events"
import { writeSheet } from "@/lib/pm/measurement-writes"
import { defaultTerms, type ContractTerms } from "@/lib/pm/terms"
import { handOverUnit, resplitUnits, setUpUnits } from "@/lib/pm/unit-writes"
import { planPassed, resplitBlocks, splitEqually, splitGaps, unitClaimable, unitFigures, unitNeed, unitRetention, unitTight, UNIT_DONE_AT, UNITS_MAX, UNITS_MIN, type PmUnit } from "@/lib/pm/units"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pmA = { uid: "pm1", name: "Abdullah" }
const seA = { uid: "se1", name: "Omar" }

/** The outbox event under its key, whatever its document id. */
const eventOf = (key: string) => listCollection<PmEvent>(PM_EVENTS).find((e) => e.key === key) ?? null

const unit = (id: string, lines: PmUnit["lines"], extra: Partial<PmUnit> = {}): PmUnit => ({ id, seq: Number(id), name: `Villa ${Number(id)}`, plan: null, ho: null, lines, ...extra })

const project = (terms: ContractTerms, pmExtra: Record<string, unknown> = {}) =>
  seed("projects/p1", { organizationId: "org", budget: 100_000, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/004", lifecycle: "live", startedAt: "2026-07-01", terms, original: terms, ...pmExtra } })

describe("an equal split shares out exactly the line's quantity (ZN-01)", () => {
  it("rounds each share down and gives the last unit the remainder — for any quantity, 2 to 40 units", () => {
    expect(splitEqually([{ id: "a", quantity: 1 }], 6, "Villa").map((u) => u.lines.a.q)).toEqual([0.16, 0.16, 0.16, 0.16, 0.16, 0.2])
    for (const quantity of [1, 0.1, 0.3, 3, 7, 12.34, 100, 999.99, 1234.5]) {
      for (let n = UNITS_MIN; n <= UNITS_MAX; n++) {
        const shares = splitEqually([{ id: "a", quantity }], n, "Villa").map((u) => u.lines.a?.q ?? 0)
        expect(Math.round(shares.reduce((t, q) => t + q, 0) * 1e6) / 1e6).toBe(quantity)
        // Never above an even share, except the last, which takes what rounding left.
        expect(shares.slice(0, -1).every((q) => q <= quantity / n + 1e-9)).toBe(true)
      }
    }
  })

  it("on a lump sum the last of six units reaches its handover threshold", async () => {
    resetFakeDb()
    project({ ...defaultTerms({ retention: 0.1 }), basis: "lump" })
    seed("projects/p1/boqItems/i1", { itemNo: "01", quantity: "1", unitPrice: "60000", executedQuantity: 0 })
    await setUpUnits(db, pm, "p1", pmA, { count: 6, label: "Villa" })
    for (const id of ["01", "02", "03", "04", "05", "06"]) {
      const share = readDoc<PmUnit>(`projects/p1/pmUnits/${id}`)!.lines.i1.q
      await writeSheet(db, pm, "p1", pmA, { day: "2026-09-20", lines: [{ itemId: "i1", qty: share, unit: id }] })
    }
    expect(readDoc<{ executedQuantity: number }>("projects/p1/boqItems/i1")?.executedQuantity).toBe(1)
    const last = readDoc<PmUnit>("projects/p1/pmUnits/06")!
    expect(unitFigures(last, [{ id: "i1", rate: 60_000 }]).progress).toBeGreaterThanOrEqual(UNIT_DONE_AT)
    await expect(handOverUnit(db, pm, "p1", pmA, "06")).resolves.toBeDefined()
  })
})

describe("a planned day that has come needs no weekly rate", () => {
  it("there is no rate to state once no time is left — and the date is still at risk", () => {
    expect(unitNeed(20, "2026-10-06", "2026-09-29")).toBe(80)
    expect(unitNeed(20, "2026-09-29", "2026-09-29")).toBeNull()
    expect(unitNeed(20, "2026-09-01", "2026-09-29")).toBeNull()
    expect(unitNeed(20, null, "2026-09-29")).toBeNull()
    expect(planPassed("2026-09-29", "2026-09-29")).toBe(true)
    expect(planPassed("2026-09-30", "2026-09-29")).toBe(false)
    expect(planPassed(null, "2026-09-29")).toBe(false)

    const items = [{ id: "a", quantity: 100, rate: 1000, executed: 10 }]
    const u = unit("01", { a: { q: 50, ex: 10 } }, { plan: "2026-09-29" })
    expect(unitTight(u, unitFigures(u, items), "2026-07-21", "2026-09-29")).toBe(true)
    expect(unitTight({ ...u, ho: { on: "2026-09-28", by: "u" } }, unitFigures(u, items), "2026-07-21", "2026-09-29")).toBe(false)
  })
})

describe("a unit's handover follows the contract's release term (IPC-05, WF-25)", () => {
  const half = { retention: 0.1, retentionCap: 0.05, retentionRelease: "half" as const }
  const full = { ...half, retentionRelease: "full" as const }

  it("frees nothing on a full release; on half, half of what is held against its share", () => {
    expect(unitRetention(50_000, full, { held: 3000, of: 100_000 })).toBe(0)
    expect(unitRetention(50_000, full)).toBe(0)
    // 3,000 held on a 100,000 BOQ: 1,500 of it stands against a 50,000 unit — half is 750, not 1,250.
    expect(unitRetention(50_000, half, { held: 3000, of: 100_000 })).toBe(750)
    // Never above what the terms could hold on it, whatever the held figure says.
    expect(unitRetention(50_000, half, { held: 10_000, of: 100_000 })).toBe(1250)
    expect(unitRetention(50_000, half, { held: 0, of: 100_000 })).toBe(0)
  })

  it("never more than the half the term has not freed yet", () => {
    expect(unitClaimable(50_000, half, { held: 3000, of: 100_000, freed: 0 })).toBe(750)
    expect(unitClaimable(50_000, half, { held: 3000, of: 100_000, freed: 1000 })).toBe(500)
    // The project's provisional already sent half of everything held.
    expect(unitClaimable(50_000, half, { held: 3000, of: 100_000, freed: 1500 })).toBe(0)
    expect(unitClaimable(50_000, full, { held: 3000, of: 100_000, freed: 0 })).toBe(0)
  })

  const world = async (release: "half" | "full", held: number) => {
    resetFakeDb()
    project({ ...defaultTerms({ retention: 0.1 }), basis: "rem", retentionRelease: release }, { retentionHeld: held })
    seed("projects/p1/boqItems/i1", { itemNo: "01", quantity: "100", unitPrice: "1000", executedQuantity: 0 })
    await setUpUnits(db, pm, "p1", pmA, { count: 2, label: "Villa" })
    await writeSheet(db, pm, "p1", pmA, { day: "2026-09-20", lines: [{ itemId: "i1", qty: 50, unit: "01" }] })
  }

  it("on a full release the unit's event carries no retention, and nothing is marked freed", async () => {
    await world("full", 3000)
    expect(await handOverUnit(db, pm, "p1", pmA, "01")).toEqual({ claimable: 0 })
    expect(eventOf("prj:HND:PJ-2026/004:U01:prov")).toMatchObject({ kind: "HND", amount: 0 })
    expect(readDoc<{ pm: { retentionFreed?: number } }>("projects/p1")?.pm.retentionFreed ?? 0).toBe(0)
    expect(readDoc<PmUnit>("projects/p1/pmUnits/01")?.ho).toMatchObject({ by: "pm1" })
  })

  it("on a half release it frees half of what is actually held against the unit, and the project's provisional the rest of its half", async () => {
    await world("half", 3000)
    expect(await handOverUnit(db, pm, "p1", pmA, "01")).toEqual({ claimable: 750 })
    expect(eventOf("prj:HND:PJ-2026/004:U01:prov")).toMatchObject({ amount: 750 })
    expect(readDoc<{ pm: { retentionFreed: number } }>("projects/p1")?.pm.retentionFreed).toBe(750)

    await writeSheet(db, pm, "p1", pmA, { day: "2026-09-21", lines: [{ itemId: "i1", qty: 50, unit: "02" }] })
    await recordProvisional(db, pm, "p1", pmA)
    expect(eventOf("prj:HND:PJ-2026/004:prov")).toMatchObject({ amount: 750 })
    // The other unit, after the project's provisional sent its half: nothing is left to free before the final.
    expect(await handOverUnit(db, pm, "p1", pmA, "02")).toEqual({ claimable: 0 })
    expect(readDoc<{ pm: { retentionFreed: number } }>("projects/p1")?.pm.retentionFreed).toBe(1500)
  })
})

describe("units and a BOQ that came later", () => {
  beforeEach(() => {
    resetFakeDb()
    project({ ...defaultTerms({ retention: 0.1 }), basis: "rem" }, { lifecycle: "plan" })
  })

  it("the set-up is refused, with its reason, while the project has no BOQ lines", async () => {
    await expect(setUpUnits(db, pm, "p1", pmA, { count: 3, label: "Villa" })).rejects.toMatchObject({ name: "PmUnitError", code: "no_boq" })
    seed("projects/p1/boqItems/i0", { itemNo: "00", quantity: "0", unitPrice: "10" })
    await expect(setUpUnits(db, pm, "p1", pmA, { count: 3, label: "Villa" })).rejects.toMatchObject({ code: "no_boq" })
    expect(listCollection("projects/p1/pmUnits")).toEqual([])
    seed("projects/p1/boqItems/i1", { itemNo: "01", quantity: "90", unitPrice: "1000" })
    expect(await setUpUnits(db, pm, "p1", pmA, { count: 3, label: "Villa" })).toBe(3)
  })

  const legacy = () => {
    // As they were created before the fix: in planning, before the BOQ was imported.
    seed("projects/p1/pmUnits/01", { seq: 1, name: "Villa 1", plan: "2026-12-01", ho: null, lines: {}, by: "pm1" })
    seed("projects/p1/pmUnits/02", { seq: 2, name: "Villa 2", plan: null, ho: null, lines: {}, by: "pm1" })
    seed("projects/p1/pmUnits/03", { seq: 3, name: "Villa 3", plan: null, ho: null, lines: {}, by: "pm1" })
  }

  it("the approver splits again once the BOQ exists — the shares are replaced, the units stay", async () => {
    legacy()
    await expect(resplitUnits(db, pm, "p1")).rejects.toMatchObject({ code: "no_boq" })
    seed("projects/p1/boqItems/i1", { itemNo: "01", quantity: "100", unitPrice: "1000" })
    await expect(resplitUnits(db, site, "p1")).rejects.toBeInstanceOf(PmAccessError)
    expect(await resplitUnits(db, pm, "p1")).toBe(3)
    expect(listCollection<PmUnit>("projects/p1/pmUnits").map((u) => [u.name, u.plan, u.lines.i1])).toEqual([
      ["Villa 1", "2026-12-01", { q: 33.33, ex: 0 }],
      ["Villa 2", null, { q: 33.33, ex: 0 }],
      ["Villa 3", null, { q: 33.34, ex: 0 }],
    ])

    // And again when the BOQ grows — as long as nothing was measured on a unit and none is handed over.
    seed("projects/p1/boqItems/i2", { itemNo: "02", quantity: "9", unitPrice: "50" })
    expect(splitGaps(listCollection<PmUnit>("projects/p1/pmUnits"), [{ id: "i1", quantity: 100 }, { id: "i2", quantity: 9 }])).toBe(1)
    expect(await resplitUnits(db, pm, "p1")).toBe(3)
    expect(readDoc<PmUnit>("projects/p1/pmUnits/02")?.lines).toEqual({ i1: { q: 33.33, ex: 0 }, i2: { q: 3, ex: 0 } })
    expect(splitGaps(listCollection<PmUnit>("projects/p1/pmUnits"), [{ id: "i1", quantity: 100 }, { id: "i2", quantity: 9 }])).toBe(0)
  })

  it("no second split once a measurement names a unit, or a unit is handed over", async () => {
    expect(resplitBlocks([unit("01", {}), unit("02", {})], [])).toEqual([])
    expect(resplitBlocks([unit("01", {}), unit("02", {}, { ho: { on: "2026-09-01", by: "u" } })], [])).toEqual(["handed"])
    expect(resplitBlocks([unit("01", { a: { q: 5, ex: 1 } })], [])).toEqual(["measured"])
    expect(resplitBlocks([unit("01", {})], [{ status: "wait", lines: [{ unit: "01" }] }])).toEqual(["measured"])
    // A returned sheet moved nothing and never will; a sheet naming no unit is the project's.
    expect(resplitBlocks([unit("01", {})], [{ status: "no", lines: [{ unit: "01" }] }, { status: "ok", lines: [{ unit: null }] }])).toEqual([])

    seed("projects/p1/boqItems/i1", { itemNo: "01", quantity: "100", unitPrice: "1000" })
    await setUpUnits(db, pm, "p1", pmA, { count: 2, label: "Villa" })
    // A waiting sheet that names a unit — re-read inside the transaction, by the project's sheet count.
    await writeSheet(db, site, "p1", seA, { day: "2026-09-20", lines: [{ itemId: "i1", qty: 10, unit: "01" }] })
    expect(readDoc<{ status: string }>("projects/p1/pmSheets/01")?.status).toBe("wait")
    await expect(resplitUnits(db, pm, "p1")).rejects.toMatchObject({ code: "measured" })

    resetFakeDb()
    project({ ...defaultTerms({ retention: 0.1 }), basis: "rem" })
    seed("projects/p1/boqItems/i1", { itemNo: "01", quantity: "100", unitPrice: "1000" })
    seed("projects/p1/pmUnits/01", { seq: 1, name: "Villa 1", plan: null, ho: { on: "2026-09-01", by: "pm1" }, lines: {} })
    seed("projects/p1/pmUnits/02", { seq: 2, name: "Villa 2", plan: null, ho: null, lines: {} })
    await expect(resplitUnits(db, pm, "p1")).rejects.toMatchObject({ code: "handed" })
    expect(readDoc<PmUnit>("projects/p1/pmUnits/02")?.lines).toEqual({})
  })
})
