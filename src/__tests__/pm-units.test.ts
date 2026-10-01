/**
 * PM 1.0 — delivery units (the prototype's وحدات التسليم). The BOQ stays one;
 * each line's quantity is split, and execution reaches a unit only through an
 * approved measurement naming it. A unit hands over when complete with nothing
 * open on it, sending half its retention to Finance — and no handover event
 * ever sends retention another one already sent.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { recordProvisional } from "@/lib/pm/acceptance-writes"
import { PM_EVENTS, pmEventDocId } from "@/lib/pm/events"
import { writeSheet } from "@/lib/pm/measurement-writes"
import { raisePunch, recordConfirmation, recordFix } from "@/lib/pm/punch-writes"
import { defaultTerms } from "@/lib/pm/terms"
import { handOverUnit, PmUnitError, setUpUnits } from "@/lib/pm/unit-writes"
import { attributeToUnits, commonItems, splitEqually, unattributed, unitBlocks, unitFigures, unitRetention, unitTight, type PmUnit } from "@/lib/pm/units"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pmA = { uid: "pm1", name: "Abdullah" }
const seA = { uid: "se1", name: "Omar" }

const unit = (id: string, lines: PmUnit["lines"], extra: Partial<PmUnit> = {}): PmUnit => ({ id, seq: Number(id), name: `Villa ${Number(id)}`, plan: null, ho: null, lines, ...extra })

describe("the pure rules", () => {
  const items = [
    { id: "a", quantity: 100, rate: 1000, executed: 30 },
    { id: "b", quantity: 10, rate: 500, executed: 0 },
    { id: "c", quantity: 0, rate: 0, executed: 0 },
  ]

  it("splits every line with a quantity evenly and attributes nothing", () => {
    const units = splitEqually(items, 2, "Villa")
    expect(units.map((u) => u.name)).toEqual(["Villa 1", "Villa 2"])
    expect(units[0].lines).toEqual({ a: { q: 50, ex: 0 }, b: { q: 5, ex: 0 } })
  })

  it("prior execution stays unattributed; lines no unit holds are project-wide", () => {
    const units = [unit("01", { a: { q: 50, ex: 10 } }), unit("02", { a: { q: 50, ex: 0 } })]
    expect(unattributed(units, items)).toBe(20_000)
    expect(commonItems(units, items).map((i) => i.id)).toEqual(["b", "c"])
    expect(unitFigures(units[0], items)).toMatchObject({ contract: 50_000, earned: 10_000, progress: 20 })
  })

  it("a unit hands over complete, with no open punch item or inspection on it", () => {
    const u = unit("01", { a: { q: 50, ex: 50 } })
    expect(unitBlocks(u, items, { punch: [], inspections: [] })).toEqual([])
    expect(unitBlocks(u, items, { punch: [{ unit: "01" }, { unit: "02" }], inspections: [{ unit: "01" }] }).map((b) => [b.key, b.n])).toEqual([
      ["punch", 1],
      ["wir", 1],
    ])
    expect(unitBlocks(unit("02", { a: { q: 50, ex: 20 } }), items, { punch: [], inspections: [] })).toEqual([{ key: "progress", pct: 40 }])
    expect(unitBlocks(unit("03", {}), items, { punch: [], inspections: [] })).toEqual([{ key: "no_alloc" }])
  })

  it("half the unit's retention, at the lower of the rate and the cap — on a half release; nothing when all waits for the final", () => {
    expect(unitRetention(50_000, { retention: 0.1, retentionCap: 0.05, retentionRelease: "half" })).toBe(1250)
    expect(unitRetention(50_000, { retention: 0.1, retentionCap: 0.05, retentionRelease: "full" })).toBe(0)
  })

  it("a date is unrealistic when it needs a pace the unit has never reached", () => {
    const u = unit("01", { a: { q: 50, ex: 10 } }, { plan: "2026-10-06" })
    const f = unitFigures(u, items)
    // 20% in 10 weeks = 2%/week; 80% left in 1 week.
    expect(unitTight(u, f, "2026-07-21", "2026-09-29")).toBe(true)
    expect(unitTight({ ...u, plan: "2030-01-01" }, f, "2026-07-21", "2026-09-29")).toBe(false)
    expect(unitTight({ ...u, plan: null }, f, "2026-07-21", "2026-09-29")).toBe(false)
  })

  it("approved quantity reaches the named unit, capped at its share; a handed-over unit takes none", () => {
    const units = [unit("01", { a: { q: 50, ex: 45 } }), unit("02", { a: { q: 50, ex: 0 } }, { ho: { on: "2026-09-01", by: "u" } })]
    expect(attributeToUnits(units, [{ itemId: "a", unit: "01", approved: 10 }, { itemId: "a", unit: "02", approved: 5 }, { itemId: "a", approved: 3 }])).toEqual({ "01": { a: { q: 50, ex: 50 } } })
  })
})

describe("the writes", () => {
  beforeEach(() => {
    resetFakeDb()
    const terms = { ...defaultTerms({ retention: 0.1 }), basis: "rem" as const }
    seed("projects/p1", { organizationId: "org", budget: 100_000, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/004", lifecycle: "live", startedAt: "2026-07-01", terms, original: terms, retentionHeld: 10_000 } })
    seed("projects/p1/boqItems/i1", { itemNo: "01", quantity: "100", unitPrice: "1000", executedQuantity: 0 })
  })

  it("sets the units up once, by the approver", async () => {
    await expect(setUpUnits(db, site, "p1", seA, { count: 2, label: "Villa" })).rejects.toBeInstanceOf(PmAccessError)
    expect(await setUpUnits(db, pm, "p1", pmA, { count: 2, label: "Villa" })).toBe(2)
    expect(readDoc("projects/p1/pmUnits/02")).toMatchObject({ name: "Villa 2", lines: { i1: { q: 50, ex: 0 } }, ho: null })
    await expect(setUpUnits(db, pm, "p1", pmA, { count: 3, label: "Villa" })).rejects.toMatchObject({ code: "exists" })
    await expect(setUpUnits(db, pm, "p1", pmA, { count: 1, label: "Villa" })).rejects.toBeInstanceOf(PmUnitError)
  })

  it("an approved measurement moves the unit it names; the handover waits for its punch item, then frees half its retention once", async () => {
    await setUpUnits(db, pm, "p1", pmA, { count: 2, label: "Villa" })
    await writeSheet(db, pm, "p1", pmA, { day: "2026-09-20", lines: [{ itemId: "i1", qty: 50, unit: "01" }] })
    expect(readDoc<{ executedQuantity: number }>("projects/p1/boqItems/i1")?.executedQuantity).toBe(50)
    expect(readDoc("projects/p1/pmUnits/01")).toMatchObject({ lines: { i1: { q: 50, ex: 50 } } })
    expect(readDoc("projects/p1/pmUnits/02")).toMatchObject({ lines: { i1: { q: 50, ex: 0 } } })

    const n = await raisePunch(db, site, "p1", seA, { what: "Paint", location: "Kitchen", unit: "01", severity: "b", source: "cons" })
    await expect(handOverUnit(db, pm, "p1", pmA, "01")).rejects.toMatchObject({ code: "blocked", blocks: ["punch"] })
    await expect(handOverUnit(db, pm, "p1", pmA, "02")).rejects.toMatchObject({ blocks: ["progress"] })
    await recordFix(db, site, "p1", seA, n)
    await recordConfirmation(db, site, "p1", seA, n)

    // 50,000 × min(10%, 5%) × ½
    expect(await handOverUnit(db, pm, "p1", pmA, "01")).toEqual({ claimable: 1250 })
    expect(readDoc(`${PM_EVENTS}/${pmEventDocId("org", "prj:HND:PJ-2026/004:U01:prov")}`)).toMatchObject({ kind: "HND", amount: 1250, params: { stage: "unit", unit: "Villa 1" } })
    expect(readDoc<{ pm: { retentionFreed: number } }>("projects/p1")?.pm.retentionFreed).toBe(1250)
    await expect(handOverUnit(db, pm, "p1", pmA, "01")).rejects.toMatchObject({ code: "done" })

    // The project's provisional then sends half the held retention LESS what the unit already sent.
    await writeSheet(db, pm, "p1", pmA, { day: "2026-09-21", lines: [{ itemId: "i1", qty: 50, unit: "02" }] })
    await recordProvisional(db, pm, "p1", pmA)
    expect(readDoc(`${PM_EVENTS}/${pmEventDocId("org", "prj:HND:PJ-2026/004:prov")}`)).toMatchObject({ amount: 3750 })
    expect(readDoc<{ pm: { retentionFreed: number } }>("projects/p1")?.pm.retentionFreed).toBe(5000)
  })
})
