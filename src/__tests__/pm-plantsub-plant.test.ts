/**
 * PM 1.0 — plant on site (EQP-12…15, NFR-06): the off-hire dates run in order
 * and the charge stops at the desk's confirmation; "idle" means idle or standby
 * and is priced by the day-cost rule; a state we do not know costs nothing and
 * is shown as unknown; each logged day names who logged it; and a unit received
 * without a day rate can be given one by someone who sees money.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { addDays } from "@/lib/pm/programme"
import { dayBlocks, dayCost, dayLog, dayState, deskBlocks, idleCharge, idleSince, plantCost, rateBlocks, unrated, utilisation, type PmPlant } from "@/lib/pm/plant"
import { logPlantDay, plantRateRefusal, recordOffHireConfirmation, requestOffHire, setPlantDayRate } from "@/lib/pm/plant-writes"

const db = fakeFirestore as unknown as Firestore
const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const seA = { uid: "se1", name: "Site" }
const pmA = { uid: "pm1", name: "PM" }

type Costed = Pick<PmPlant, "dayRate" | "category" | "days" | "qty" | "offOk">
const p = (days: PmPlant["days"], extra: Partial<PmPlant> = {}): Costed => ({ dayRate: 900, category: "heavy", qty: 1, days, ...extra })

describe("the day-cost rule (EQP-12, NFR-06)", () => {
  it("a state we do not know costs nothing and reads as unknown", () => {
    const x = p({ "2026-09-01": "work", "2026-09-02": "xyz" as never, "2026-09-03": "idle" })
    expect(dayCost(x, "2026-09-02")).toBe(0)
    expect(dayState(x, "2026-09-02")).toBe("unknown")
    expect(dayState(x, "2026-09-04")).toBeNull()
    expect(dayLog(x).map((d) => d.st)).toEqual(["idle", "unknown", "work"])
    expect(plantCost(x)).toBe(1800)
  })

  it("a day logged with who logged it is priced as its state", () => {
    const x = p({ "2026-09-01": { st: "work", by: "se1", byName: "Site", on: "2026-09-01" }, "2026-09-09": { st: "stby", by: "se1", byName: "Site", on: "2026-09-10" } })
    expect(dayState(x, "2026-09-09")).toBe("stby")
    expect(dayCost(x, "2026-09-01")).toBe(900)
    expect(dayCost(x, "2026-09-09")).toBe(600)
    expect(dayLog(x)[0]).toEqual({ day: "2026-09-09", st: "stby", by: "se1", byName: "Site" })
    expect(utilisation(x)).toBe(50)
  })

  it("nothing is charged after the day the desk confirmed the off-hire (EQP-14)", () => {
    const days = { "2026-09-01": "work", "2026-09-02": "work", "2026-09-03": "idle", "2026-09-04": "work" } as const
    expect(plantCost(p(days))).toBe(3600)
    const off = p(days, { offOk: { on: "2026-09-02", by: "pm1" } })
    expect(dayCost(off, "2026-09-02")).toBe(900)
    expect(dayCost(off, "2026-09-03")).toBe(0)
    expect(dayCost(off, "2026-09-04")).toBe(0)
    expect(plantCost(off)).toBe(1800)
  })
})

describe("idle ≥ 5 days and what it costs (EQP-15)", () => {
  it("breakdown days are not idle days — and they charge nothing", () => {
    const down = p({ "2026-09-01": "work", "2026-09-02": "down", "2026-09-03": "down", "2026-09-04": "down", "2026-09-05": "down", "2026-09-06": "down" })
    expect(idleSince(down)).toBe(0)
    expect(idleCharge(down)).toBe(0)
  })

  it("five idle days after work: three inside ±3 at the full rate, two at two-thirds", () => {
    const idle = p({ "2026-09-01": "work", "2026-09-02": "idle", "2026-09-03": "idle", "2026-09-04": "stby", "2026-09-05": "idle", "2026-09-06": "idle" })
    expect(idleSince(idle)).toBe(5)
    expect(idleCharge(idle)).toBe(3900)
    // Two units of the same booking cost twice.
    expect(idleCharge({ ...idle, qty: 2 })).toBe(7800)
  })

  it("transit and breakdown between idle days neither count nor end the streak; work ends it", () => {
    const mixed = p({ "2026-09-01": "idle", "2026-09-02": "work", "2026-09-10": "idle", "2026-09-11": "down", "2026-09-12": "move", "2026-09-13": "idle" })
    expect(idleSince(mixed)).toBe(2)
    expect(idleCharge(mixed)).toBe(1200)
    expect(idleSince(p({ "2026-09-10": "idle", "2026-09-11": "stby" }))).toBe(2)
  })
})

describe("the dates of an off-hire run in order (EQP-14)", () => {
  const plant = { status: "req" as const, offOk: null, offReq: { on: "2026-09-20", ready: "2026-09-21", why: "done" as const, by: "se1" }, from: "2026-09-01" }
  const base = { archived: false, plant, no: "OH-7", today: "2026-09-28" }

  it("the confirmation is not dated before the request, before the unit arrived, or ahead", () => {
    expect(deskBlocks({ ...base, on: "2026-09-20" })).toEqual([])
    expect(deskBlocks({ ...base, on: "2026-09-28" })).toEqual([])
    expect(deskBlocks({ ...base, on: "2026-09-19" })).toEqual(["before_request"])
    expect(deskBlocks({ ...base, on: "2026-08-30" })).toEqual(["before_request"])
    expect(deskBlocks({ ...base, on: "2026-09-29" })).toEqual(["bad_day"])
    expect(deskBlocks({ ...base, on: "", no: " " })).toEqual(["no_number", "bad_day"])
    expect(deskBlocks({ ...base, on: "2026-09-21", plant: { ...plant, offOk: { on: "2026-09-21", by: "pm1" } } })).toEqual(["wrong_state"])
    expect(deskBlocks({ ...base, on: "2026-09-21", plant: { ...plant, status: "use" } })).toEqual(["wrong_state"])
  })

  it("a day after the confirmation is not logged", () => {
    const d = { archived: false, status: "req" as const, from: "2026-09-01", today: "2026-09-28", st: "idle" }
    expect(dayBlocks({ ...d, day: "2026-09-25", offOn: "2026-09-24" })).toEqual(["after_off"])
    expect(dayBlocks({ ...d, day: "2026-09-24", offOn: "2026-09-24" })).toEqual([])
    expect(dayBlocks({ ...d, day: "2026-09-25", offOn: null })).toEqual([])
  })
})

describe("a unit with no day rate (EQP-12/13)", () => {
  it("is not counted — said so, unless it is a tool", () => {
    expect(unrated({ category: "heavy", dayRate: null })).toBe(true)
    expect(unrated({ category: "light", dayRate: 0 })).toBe(true)
    expect(unrated({ category: "heavy", dayRate: 900 })).toBe(false)
    expect(unrated({ category: "tool", dayRate: null })).toBe(false)
  })

  it("a rate is set on a unit still on site, above zero, never on a tool", () => {
    const base = { archived: false, status: "use" as const, category: "heavy" as const, dayRate: 900 }
    expect(rateBlocks(base)).toEqual([])
    expect(rateBlocks({ ...base, status: "req" })).toEqual([])
    expect(rateBlocks({ ...base, status: "back" })).toEqual(["returned"])
    expect(rateBlocks({ ...base, category: "tool" })).toEqual(["tool_rate"])
    expect(rateBlocks({ ...base, dayRate: 0 })).toEqual(["rate_required"])
    expect(rateBlocks({ ...base, dayRate: Number.NaN })).toEqual(["rate_required"])
  })

  it("by someone who sees money and holds req or approve on the project", () => {
    expect(plantRateRefusal(owner)).toBeNull()
    expect(plantRateRefusal(pm)).toBeNull()
    expect(plantRateRefusal(qs)).toBe("no_duty")
    expect(plantRateRefusal(site)).toBe("no_duty")
    expect(plantRateRefusal({ ...pm, archived: true })).toBe("archived")
    expect(plantRateRefusal({ ...pm, seat: null })).toBe("not_on_team")
  })
})

describe("the writes", () => {
  const today = todayDay()
  const from = addDays(today, -20)
  const unit = (over: Record<string, unknown> = {}) => ({
    seq: 1,
    tag: "M-114",
    name: "Excavator",
    category: "heavy",
    ownership: "hire",
    qty: 1,
    dayRate: 1200,
    from,
    to: addDays(today, 30),
    status: "use",
    handover: { on: from, meter: 100, condition: "ok", by: "se1" },
    days: {},
    by: "se1",
    ...over,
  })
  beforeEach(() => {
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live", plantCount: 1 } })
    seed("projects/p1/pmPlant/01", unit())
  })

  it("a logged day names who logged it, and a rewrite of a past day names the rewriter", async () => {
    const day = addDays(today, -3)
    await logPlantDay(db, site, "p1", seA, 1, { day, st: "work" })
    expect(readDoc<PmPlant>("projects/p1/pmPlant/01")!.days[day]).toEqual({ st: "work", by: "se1", byName: "Site", on: today })
    const other: PmContext = { ...site, seat: { uid: "se2", role: "site" } }
    await logPlantDay(db, other, "p1", { uid: "se2", name: "Other" }, 1, { day, st: "down" })
    expect(readDoc<PmPlant>("projects/p1/pmPlant/01")!.days[day]).toEqual({ st: "down", by: "se2", byName: "Other", on: today })
    await expect(logPlantDay(db, site, "p1", seA, 1, { day, st: "xyz" as never })).rejects.toMatchObject({ blocks: ["no_state"] })
  })

  it("the desk's confirmation is not dated before the request, and no day is logged after it", async () => {
    await requestOffHire(db, site, "p1", seA, 1, { ready: today, why: "done" })
    await expect(recordOffHireConfirmation(db, pm, "p1", pmA, 1, { no: "OH-7", on: addDays(today, -1) })).rejects.toMatchObject({ blocks: ["before_request"] })
    await expect(recordOffHireConfirmation(db, pm, "p1", pmA, 1, { no: "OH-7", on: addDays(from, -2) })).rejects.toMatchObject({ blocks: ["before_request"] })
    await expect(recordOffHireConfirmation(db, pm, "p1", pmA, 1, { no: "OH-7", on: addDays(today, 1) })).rejects.toMatchObject({ blocks: ["bad_day"] })
    await recordOffHireConfirmation(db, pm, "p1", pmA, 1, { no: "OH-7", on: today })
    expect(readDoc<PmPlant>("projects/p1/pmPlant/01")).toMatchObject({ offNo: "OH-7", offOk: { on: today, by: "pm1" } })
    await expect(recordOffHireConfirmation(db, pm, "p1", pmA, 1, { no: "OH-8", on: today })).rejects.toMatchObject({ blocks: ["wrong_state"] })
  })

  it("a day after a recorded confirmation is refused", async () => {
    const ok = addDays(today, -4)
    seed("projects/p1/pmPlant/01", unit({ status: "req", offReq: { on: addDays(today, -5), ready: ok, why: "done", by: "se1" }, offNo: "OH-7", offOk: { on: ok, by: "pm1" } }))
    await expect(logPlantDay(db, site, "p1", seA, 1, { day: addDays(today, -2), st: "idle" })).rejects.toMatchObject({ blocks: ["after_off"] })
    await logPlantDay(db, site, "p1", seA, 1, { day: ok, st: "idle" })
    expect(Object.keys(readDoc<PmPlant>("projects/p1/pmPlant/01")!.days)).toEqual([ok])
  })

  it("a unit received without a rate gets one from a money holder — with who and when", async () => {
    seed("projects/p1/pmPlant/01", unit({ dayRate: null, days: { [addDays(today, -2)]: "work", [addDays(today, -1)]: "work" } }))
    expect(plantCost(readDoc<PmPlant>("projects/p1/pmPlant/01")!)).toBe(0)

    await expect(setPlantDayRate(db, site, "p1", seA, 1, { dayRate: 900 })).rejects.toBeInstanceOf(PmAccessError)
    await expect(setPlantDayRate(db, qs, "p1", { uid: "qs1", name: "QS" }, 1, { dayRate: 900 })).rejects.toMatchObject({ code: "no_duty" })
    await expect(setPlantDayRate(db, pm, "p1", pmA, 1, { dayRate: 0 })).rejects.toMatchObject({ blocks: ["rate_required"] })
    await setPlantDayRate(db, pm, "p1", pmA, 1, { dayRate: 900 })

    const after = readDoc<PmPlant>("projects/p1/pmPlant/01")!
    expect(after).toMatchObject({ dayRate: 900, rateSet: { on: today, by: "pm1", byName: "PM", was: null } })
    expect(plantCost(after)).toBe(1800)
  })

  it("no rate on a tool or on a unit that went back", async () => {
    seed("projects/p1/pmPlant/01", unit({ category: "tool", dayRate: null }))
    await expect(setPlantDayRate(db, pm, "p1", pmA, 1, { dayRate: 50 })).rejects.toMatchObject({ blocks: ["tool_rate"] })
    seed("projects/p1/pmPlant/01", unit({ dayRate: null, status: "back" }))
    await expect(setPlantDayRate(db, pm, "p1", pmA, 1, { dayRate: 900 })).rejects.toMatchObject({ blocks: ["returned"] })
  })
})
