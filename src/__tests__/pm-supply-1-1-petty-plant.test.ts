/**
 * PM 1.1 — direct purchases and plant (qa_fixes FX-41, FX-30, EQP-14 duty):
 * the monthly direct-purchase cap BLOCKS, per calendar month (STK-08); the
 * look-ahead's plant constraint counts a request still awaiting approval
 * (WWP-02); off-hire and hand-back are requested by `req` (owner's decision).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmAllowed, pmCeiling, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { monthOf, pettyBlocks, pettyMonth, pettySpentBefore } from "@/lib/pm/supply"
import { logDirectPurchase } from "@/lib/pm/supply-writes"
import { activityConstraints, type LookFacts } from "@/lib/pm/weekly-plan"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const siteActor = { uid: "se1", name: "Site" }

describe("STK-08 (FX-41) — the monthly cap blocks, per calendar month", () => {
  it("pure: the calendar month, not a rolling 30 days", () => {
    const list = [{ day: "2026-09-30", amount: 9000 }, { day: "2026-10-02", amount: 2000 }]
    expect(pettyMonth(list, "2026-10-20")).toBe(2000)
    expect(pettyMonth(list, "2026-09-05")).toBe(9000)
  })
  it("pure: past 15,000 in the month is refused at save", () => {
    const base = { archived: false, what: "Nails", supplier: "Shop", day: "2026-10-10", today: "2026-10-10" }
    expect(pettyBlocks({ ...base, amount: 2500, monthSpent: 13000 })).toEqual(["over_month"])
    expect(pettyBlocks({ ...base, amount: 2000, monthSpent: 13000 })).toEqual([])
  })
  it("pure: the transaction's tally wins when it is the same month and higher", () => {
    expect(pettySpentBefore(1000, { ym: "2026-10", sum: 4000 }, "2026-10-09")).toBe(4000)
    expect(pettySpentBefore(1000, { ym: "2026-09", sum: 14000 }, "2026-10-09")).toBe(1000)
  })

  it("the write refuses the purchase that crosses the month's cap and keeps the tally", async () => {
    resetFakeDb()
    const today = todayDay()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "live", pettyCount: 5 } })
    for (let i = 1; i <= 5; i++) seed(`projects/p1/pmPetty/0${i}`, { seq: i, what: "x", supplier: "y", amount: 2900, day: today })
    await expect(logDirectPurchase(db, site, "p1", siteActor, { what: "Nails", supplier: "Shop", amount: 600, receipt: null, day: today })).rejects.toMatchObject({ blocks: ["over_month"] })
    await logDirectPurchase(db, site, "p1", siteActor, { what: "Nails", supplier: "Shop", amount: 400, receipt: null, day: today })
    expect(readDoc<{ pm: { pettyMonth: unknown } }>("projects/p1")?.pm.pettyMonth).toEqual({ ym: monthOf(today), sum: 14900 })
  })
})

describe("WWP-02 (FX-30) — the plant constraint counts a request awaiting approval", () => {
  const facts = (status: string): LookFacts => ({
    items: [],
    activities: [{ id: "a1", name: "Excavation", from: "2026-10-05", to: "2026-10-20", itemIds: [] } as unknown as LookFacts["activities"][number]],
    obstacles: [],
    livePermits: 0,
    staleDrawings: 0,
    plant: [{ activityId: "a1", status, what: "Excavator" }],
    on: { docs: false, subm: false, wir: false, rfi: false, hse: false, stock: false, eqp: true },
  })
  const crew = (status: string) => activityConstraints(facts(status).activities[0], facts(status), "2026-10-01").find((c) => c.k === "crew")
  it("approved or awaiting approval and not on site → fails; rejected → no constraint", () => {
    expect(crew("go")?.ok).toBe(false)
    expect(crew("wait")?.ok).toBe(false)
    expect(crew("rej")?.ok ?? null).toBeNull()
  })
})

describe("off-hire and hand-back follow `req` (PM 1.1, owner's decision)", () => {
  it("a daily-only seat no longer asks for it; a req holder does", () => {
    const hse: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "h", role: "hse" }, archived: false }
    expect(pmAllowed(hse, "plant.return")).toBe(false)
    expect(pmAllowed(site, "plant.return")).toBe(true)
  })
})
