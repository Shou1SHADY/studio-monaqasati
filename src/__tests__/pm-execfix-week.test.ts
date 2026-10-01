/**
 * PM 1.0 — the weekly plan and the look-ahead, two defects found against the
 * PRD (WWP-04/05, NFR-01): a plan not closed within its week could never be
 * closed, so its tasks never reached PPC or the reasons; and an obstacle
 * addressed to a party with no name typed printed the party's stored code.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { activityConstraints, currentWeek, lookObstacle, missReasonsTop, PM_WEEKS, ppcAverage, weekInHand, type LookFacts, type PmWeek } from "@/lib/pm/weekly-plan"
import { closeWeek, commitWeek } from "@/lib/pm/weekly-plan-writes"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const seA = { uid: "se1", name: "Omar" }

const week = (start: string, status: PmWeek["status"]) => ({ week: start, status })

describe("a week not closed in time is still closed (WWP-04/05)", () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it("the oldest open plan of an earlier week is the one in hand, before a new week is planned", () => {
    // Committed Sunday 4 Oct. On Saturday 17 Oct the week before last is no longer "current".
    const late = [week("2026-10-04", "open")]
    expect(currentWeek(late, "2026-10-17")).toBeNull()
    expect(weekInHand(late, "2026-10-17")?.week).toBe("2026-10-04")
    expect(weekInHand(late, "2026-12-01")?.week).toBe("2026-10-04")

    // Two left open: the oldest first, then the next — and this week's own plan after both.
    const two = [week("2026-10-18", "open"), week("2026-10-11", "open"), week("2026-10-04", "open"), week("2026-09-27", "done")]
    expect(weekInHand(two, "2026-10-20")?.week).toBe("2026-10-04")
    expect(weekInHand([week("2026-10-18", "open"), week("2026-10-11", "open"), week("2026-10-04", "done")], "2026-10-20")?.week).toBe("2026-10-11")

    // Nothing left open: as before — this week's plan, else the latest within seven days, else none.
    expect(weekInHand([week("2026-10-18", "open"), week("2026-10-04", "done")], "2026-10-20")?.week).toBe("2026-10-18")
    expect(weekInHand([week("2026-10-11", "done")], "2026-10-13")?.week).toBe("2026-10-11")
    expect(weekInHand([week("2026-10-04", "done")], "2026-10-20")).toBeNull()
  })

  it("closing it thirteen days later works as closing the current one, and it enters PPC and the reasons", async () => {
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { lifecycle: "live" } })
    jest.useFakeTimers().setSystemTime(new Date("2026-10-04T09:00:00"))
    const start = await commitWeek(db, site, "p1", seA, [
      { activityId: "a1", name: "Frame", qty: 10, ready: true },
      { activityId: "a2", name: "Slab", qty: 5, ready: false, open: ["mat"] },
    ])
    expect(start).toBe("2026-10-04")

    jest.setSystemTime(new Date("2026-10-17T09:00:00"))
    const weeks = listCollection<PmWeek>(`projects/p1/${PM_WEEKS}`)
    expect(ppcAverage(weeks)).toBeNull()
    const due = weekInHand(weeks, "2026-10-17")
    expect(due?.week).toBe("2026-10-04")

    expect(await closeWeek(db, site, "p1", seA, due!.week, [{ done: true }, { done: false, why: "mat" }])).toBe(50)
    const after = listCollection<PmWeek>(`projects/p1/${PM_WEEKS}`)
    expect(after[0]).toMatchObject({ status: "done", closedOn: "2026-10-17", closedBy: "se1" })
    expect(ppcAverage(after)).toBe(50)
    expect(missReasonsTop(after)).toEqual([{ k: "mat", n: 1 }])
    // Closed, it no longer stands before this week's plan.
    expect(weekInHand(after, "2026-10-17")).toBeNull()
  })
})

describe("the look-ahead names the party an obstacle waits on (NFR-01)", () => {
  const facts = (obstacles: LookFacts["obstacles"]): LookFacts => ({
    items: [{ id: "i1", code: "03-01", quantity: 100, rate: 10, executed: 0 }],
    activities: [{ id: "a1", seq: 1, name: "Slab", from: "2026-10-01", to: "2026-10-10", itemIds: ["i1"], pred: null, by: "u", at: "" }],
    obstacles,
    livePermits: 0,
    staleDrawings: 0,
    on: { docs: false, subm: false, wir: false, rfi: true, hse: false },
  })
  const rfi = (f: LookFacts) => activityConstraints(f.activities[0], f, "2026-09-28").find((c) => c.k === "rfi")?.detail

  it("carries the party's code and the typed name apart — never the code in the name's place", () => {
    const base = { title: "Duct clash", itemIds: ["i1"], closeOn: null }
    expect(lookObstacle({ ...base, party: "consultant", partyName: "" })).toEqual({ ...base, party: "consultant", partyName: null })
    expect(lookObstacle({ ...base, party: "consultant", partyName: " Al-Bina " })).toEqual({ ...base, party: "consultant", partyName: "Al-Bina" })
    expect(lookObstacle({ title: "x", party: "client" })).toEqual({ title: "x", party: "client", partyName: null, itemIds: [], closeOn: null })

    expect(rfi(facts([lookObstacle({ ...base, party: "consultant", partyName: "" })]))).toEqual({ kind: "obstacle", title: "Duct clash", party: "consultant", partyName: null })
    expect(rfi(facts([lookObstacle({ ...base, party: "consultant", partyName: "Al-Bina" })]))).toEqual({ kind: "obstacle", title: "Duct clash", party: "consultant", partyName: "Al-Bina" })
  })
})
