/**
 * PM 1.0 Execution parity (V3-pm-exec 01–03, 09): the heavy-plant gates —
 * registration with the regulator and the service due by the meter — shown on
 * the row and refused at the handover (again inside the write); the hours of a
 * working day; the day-rate explanation, the idle charge and the hours run; and
 * the project-sequenced record numbers.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { projectDocNo } from "@/lib/pm/exec-numbers"
import { todayDay } from "@/lib/pm/format"
import { dayBlocks, dayCost, dayRateOf, dayState, handoverBlocks, hoursRun, idleCharge, meterNow, plantGates, serviceLeft, workedNear, type PmPlant } from "@/lib/pm/plant"
import { logPlantDay, receivePlant } from "@/lib/pm/plant-writes"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const who = { uid: "se1", name: "Site" }
const seA = { uid: "se1", name: "Omar" }
const today = todayDay()

const unit = (over: Partial<PmPlant> = {}): PmPlant => ({
  id: "01",
  seq: 1,
  tag: "M-114",
  name: "Excavator",
  category: "heavy",
  ownership: "hire",
  qty: 1,
  dayRate: 1200,
  from: "2026-09-01",
  to: "2026-12-01",
  status: "use",
  handover: { on: "2026-09-01", meter: 8420, condition: "ok", by: "se1" },
  days: {},
  by: "se1",
  hercNo: "HE-441209",
  licenceTo: "2027-06-01",
  serviceAt: 9000,
  ...over,
})

describe("heavy plant gates on the row (V3-pm-exec-01)", () => {
  it("an unregistered heavy unit is a red gate; tools and light plant carry none", () => {
    expect(plantGates(unit({ hercNo: null }), "2026-09-28")).toEqual([{ k: "herc", lv: "bad" }])
    expect(plantGates(unit({ hercNo: " " }), "2026-09-28")).toEqual([{ k: "herc", lv: "bad" }])
    expect(plantGates(unit(), "2026-09-28")).toEqual([])
    expect(plantGates(unit({ category: "light", hercNo: null }), "2026-09-28")).toEqual([])
  })

  it("the service gate reads the meter: handover reading plus the hours worked since", () => {
    expect(meterNow(unit({ hours: { "2026-09-02": 8, "2026-09-03": 9.5 } }))).toBe(8437.5)
    expect(serviceLeft(unit())).toBe(580)
    expect(plantGates(unit({ serviceAt: 8550 }), "2026-09-28")).toEqual([{ k: "srv", lv: "warn", hours: 130 }])
    expect(plantGates(unit({ serviceAt: 8430, hours: { "2026-09-02": 10, "2026-09-03": 10 } }), "2026-09-28")).toEqual([{ k: "srv", lv: "bad", hours: 10 }])
    expect(serviceLeft(unit({ serviceAt: null }))).toBeNull()
  })

  it("licence and registration together", () => {
    expect(plantGates(unit({ hercNo: null, licenceTo: "2026-09-01" }), "2026-09-28")).toEqual([
      { k: "herc", lv: "bad" },
      { k: "lic", lv: "bad" },
    ])
    expect(plantGates(unit({ licenceTo: "2026-10-10" }), "2026-09-28")).toEqual([{ k: "lic", lv: "warn" }])
  })
})

describe("the handover refuses an unregistered or overdue unit (V3-pm-exec-01)", () => {
  const base = { archived: false, name: "Crane", qty: 1, from: "2026-09-20", to: "2026-10-20", category: "lift" as const, meter: 3240, licenceTo: "2027-01-01", condition: "ok" as const, today: "2026-09-28" }
  it("in the rule the dialog shows", () => {
    expect(handoverBlocks({ ...base, hercNo: null })).toEqual(["not_registered"])
    expect(handoverBlocks({ ...base, hercNo: "HE-1", serviceAt: 3240 })).toEqual(["service_overdue"])
    expect(handoverBlocks({ ...base, hercNo: "HE-1", serviceAt: 3500 })).toEqual([])
    expect(handoverBlocks({ ...base, category: "light", meter: null, hercNo: null, serviceAt: null })).toEqual([])
  })

  it("and again inside the write, storing what it received", async () => {
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/014", lifecycle: "live", plantCount: 0 } })
    const input = { tag: "M-201", name: "Crane", category: "lift" as const, ownership: "hire" as const, supplier: "Rent Co", qty: 1, from: today, to: today, meter: 3240, condition: "ok" as const }
    await expect(receivePlant(db, site, "p1", seA, input)).rejects.toMatchObject({ code: "blocked", blocks: ["not_registered"] })
    await expect(receivePlant(db, site, "p1", seA, { ...input, hercNo: "HE-1", serviceAt: 3200 })).rejects.toMatchObject({ blocks: ["service_overdue"] })
    expect(readDoc("projects/p1/pmPlant/01")).toBeNull()
    await receivePlant(db, site, "p1", seA, { ...input, hercNo: " HE-443901 ", serviceAt: 3500 })
    expect(readDoc("projects/p1/pmPlant/01")).toMatchObject({ hercNo: "HE-443901", serviceAt: 3500 })
  })
})

describe("the plant day (V3-pm-exec-02)", () => {
  it("hours belong to a working day, 0–24", () => {
    const b = { archived: false, status: "use" as const, day: "2026-09-10", from: "2026-09-01", today: "2026-09-28" }
    expect(dayBlocks({ ...b, st: "work", hours: 25 })).toEqual(["bad_hours"])
    expect(dayBlocks({ ...b, st: "work", hours: -1 })).toEqual(["bad_hours"])
    expect(dayBlocks({ ...b, st: "work", hours: 9 })).toEqual([])
    expect(dayBlocks({ ...b, st: "idle", hours: 40 })).toEqual([])
  })

  it("the write keeps the hours of a working day and drops them when the day is re-logged", async () => {
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", status: "working", pm: { no: "PJ-2026/014", lifecycle: "live", plantCount: 1 } })
    const { id: _id, ...stored } = unit({ from: today })
    seed("projects/p1/pmPlant/01", stored)
    await logPlantDay(db, site, "p1", who, 1, { day: today, st: "work", hours: 7.5 })
    expect(readDoc<PmPlant>("projects/p1/pmPlant/01")).toMatchObject({ days: { [today]: { st: "work", by: "se1" } }, hours: { [today]: 7.5 } })
    await logPlantDay(db, site, "p1", who, 1, { day: today, st: "idle" })
    const after = readDoc<PmPlant>("projects/p1/pmPlant/01")!
    expect(dayState(after, today)).toBe("idle")
    expect(after.hours?.[today]).toBeUndefined()
    await expect(logPlantDay(db, owner, "p1", who, 1, { day: today, st: "work", hours: 30 })).rejects.toMatchObject({ blocks: ["bad_hours"] })
  })

  it("the day rate and why an idle day is full or two-thirds", () => {
    const p = unit({ qty: 2, days: { "2026-09-01": "work", "2026-09-04": "idle", "2026-09-10": "idle" } })
    expect(dayRateOf(p)).toBe(2400)
    expect(dayRateOf(unit({ category: "tool" }))).toBe(0)
    expect(workedNear(p, "2026-09-04")).toBe(true)
    expect(dayCost(p, "2026-09-04")).toBe(2400)
    expect(workedNear(p, "2026-09-10")).toBe(false)
    expect(dayCost(p, "2026-09-10")).toBe(1600)
  })
})

describe("off-hire and hand-back (V3-pm-exec-03)", () => {
  it("what standing idle has cost: what the day rule charged each idle day — full within three days of work, two-thirds beyond", () => {
    // The figure must equal what those days are charged (plantCost), not a flat share of them.
    expect(idleCharge(unit({ days: { "2026-09-01": "work", "2026-09-02": "idle", "2026-09-03": "idle", "2026-09-04": "stby" } }))).toBe(3600)
    expect(idleCharge(unit({ days: { "2026-09-01": "work", "2026-09-06": "idle", "2026-09-07": "idle", "2026-09-08": "stby" } }))).toBe(2400)
    expect(idleCharge(unit({ category: "tool", days: { "2026-09-02": "idle" } }))).toBe(0)
  })

  it("hours run = the return reading less the handover's, once above it", () => {
    expect(hoursRun(8420, 8612)).toBe(192)
    expect(hoursRun(8420, 8420)).toBeNull()
    expect(hoursRun(8420, null)).toBeNull()
    expect(hoursRun(null, 9000)).toBeNull()
  })
})

describe("Execution record numbers (V3-pm-exec-09)", () => {
  it("carry the project's sequence; the stored seq stays numeric", () => {
    expect(projectDocNo("PJ-2026/014", 7)).toBe("014/07")
    expect(projectDocNo("PJ-2026/014", 12)).toBe("014/12")
    expect(projectDocNo(null, 3)).toBe("03")
  })
})
