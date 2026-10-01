/**
 * PM 1.0 parity (P2E): plant off-hire and hand-back are the site record
 * (CAN('daily')), booked plant, the obstacle chase anyone on the project logs,
 * and the supply helpers — the store/buy split, the main-store stock and
 * catalogue, the site-overheads budget left, and an order against the estimate.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmAllowed, pmCeiling, type PmContext } from "@/lib/pm/access"
import { handBackPlant, recordOffHireConfirmation, requestOffHire } from "@/lib/pm/plant-writes"
import { lineSplit, mainStock, plantBooked, poVsEstimate, siteOverheadLeft, stockCatalogue } from "@/lib/pm/supply"
import { todayDay } from "@/lib/pm/format"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const seA = { uid: "se1", name: "Omar" }
const pmA = { uid: "pm1", name: "Abdullah" }

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live", plantCount: 1 } })
  seed("projects/p1/pmPlant/01", {
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
    handover: { on: "2026-09-01", meter: 100, condition: "ok", by: "se1" },
    days: {},
    by: "se1",
  })
})

describe("plant on site — off-hire and hand-back are the daily duty (row 100)", () => {
  it("the site engineer requests the off-hire and hands it back; the PM (no daily) cannot", async () => {
    await expect(requestOffHire(db, pm, "p1", pmA, 1, { ready: "2099-01-01", why: "done" })).rejects.toBeInstanceOf(PmAccessError)
    await requestOffHire(db, site, "p1", seA, 1, { ready: "2099-01-01", why: "done" })
    expect(readDoc("projects/p1/pmPlant/01")).toMatchObject({ status: "req" })
    await recordOffHireConfirmation(db, site, "p1", seA, 1, { no: "OH-7", on: todayDay() })
    await expect(handBackPlant(db, pm, "p1", pmA, 1, { meter: 150, condition: "ok" })).rejects.toBeInstanceOf(PmAccessError)
    await handBackPlant(db, site, "p1", seA, 1, { meter: 150, condition: "ok" })
    expect(readDoc("projects/p1/pmPlant/01")).toMatchObject({ status: "back" })
  })
})

describe("booked plant (row 101)", () => {
  const base = { status: "go" as const, got: null, from: "2026-10-10", rep: { k: "alloc" as const, unit: "M-9", on: "2026-09-20", by: "d" } }
  it("reserved by the desk for a period not started, nothing arrived", () => {
    expect(plantBooked(base, "2026-09-29")).toBe(true)
    expect(plantBooked({ ...base, from: "2026-09-29" }, "2026-09-29")).toBe(false)
    expect(plantBooked({ ...base, got: { plantSeq: 2, on: "2026-10-10", by: "u" } }, "2026-09-29")).toBe(false)
    expect(plantBooked({ ...base, rep: { ...base.rep, k: "none" } }, "2026-09-29")).toBe(false)
    expect(plantBooked({ ...base, status: "wait" }, "2026-09-29")).toBe(false)
  })
})

describe("the obstacle chase has no duty gate (row 84)", () => {
  it("anyone holding a duty on the project chases; recording/closing stays daily|approve", () => {
    expect(pmAllowed(qs, "obstacle.chase")).toBe(true)
    expect(pmAllowed(qs, "obstacle.record")).toBe(false)
    expect(pmAllowed(site, "obstacle.chase")).toBe(true)
    const outsider: PmContext = { ...site, seat: null }
    expect(pmAllowed(outsider, "obstacle.chase")).toBe(false)
    expect(pmAllowed({ ...site, archived: true }, "obstacle.chase")).toBe(false)
  })
})

describe("supply helpers", () => {
  it("splits a line into the main store's issue and the rest bought (rows 22/23)", () => {
    expect(lineSplit({ qty: 100, inv: null })).toBeNull()
    expect(lineSplit({ qty: 100, inv: { k: "issue", q: 60, on: "d" } })).toEqual({ store: 60, buy: 40 })
    expect(lineSplit({ qty: 100, inv: { k: "issue", q: 140, on: "d" } })).toEqual({ store: 100, buy: 0 })
    expect(lineSplit({ qty: 100, inv: { k: "none", on: "d" } })).toEqual({ store: 0, buy: 100 })
  })

  it("reads the main stores: on hand by folded material, and a catalogue once each (rows 45/48)", () => {
    const rows = [
      { name: "أسمنت بورتلاندي", unit: "كيس", quantity: 40 },
      { name: "اسمنت بورتلاندي", unit: "كيس", quantity: 10 },
      { name: "Marble slab", unit: "m2", quantity: 5, lot: "B-12" },
      { name: "Gloves", unit: "pair", quantity: -3 },
    ]
    expect(mainStock(rows, "أسمنت بورتلاندي", "كيس")).toBe(50)
    expect(mainStock(rows, "Marble slab", "m2")).toBe(0)
    expect(mainStock(rows, "Gloves", "pair")).toBe(0)
    expect(stockCatalogue(rows).map((c) => c.name)).toEqual(["Gloves", "أسمنت بورتلاندي"])
  })

  it("the site-overheads budget left, null with none recorded (row 46)", () => {
    expect(siteOverheadLeft(50_000, 12_500)).toBe(37_500)
    expect(siteOverheadLeft(undefined, 900)).toBeNull()
    expect(siteOverheadLeft(0, 0)).toBeNull()
  })

  it("an order against the items' estimated unit cost (row 86)", () => {
    const est = (id: string) => ({ i1: 100, i2: 0 })[id as "i1" | "i2"] ?? 0
    expect(poVsEstimate([{ quantity: 10, cancelled: 0, unitPrice: 110, boqItemId: "i1" }], est)).toBe(10)
    expect(poVsEstimate([{ quantity: 10, cancelled: 5, unitPrice: 90, boqItemId: "i1" }, { quantity: 3, cancelled: 0, unitPrice: 500, boqItemId: "i2" }], est)).toBe(-10)
    expect(poVsEstimate([{ quantity: 10, cancelled: 0, unitPrice: 90, boqItemId: null }], est)).toBeNull()
  })
})
