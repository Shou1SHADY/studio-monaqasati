/**
 * PM 1.0 — the site (WF-19 DLY-01 · OBS-01, WF-20 HSE-01): one daily report a
 * day, never rewritten; obstacles and RFIs numbered apart, chased with dated
 * signed entries, closed not deleted, their response time counted; incidents
 * of four types with lost days only on a lost-time injury; permits valid
 * through their last day. Who may do what follows the site roles.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import {
  averageLabour,
  blockingObstacles,
  claimable,
  claimSeed,
  closeObstacleBlocks,
  dailyBlocks,
  daysSinceLti,
  expiredPermits,
  incidentBlocks,
  livePermits,
  lostDays,
  obstacleBlocks,
  obstacleDays,
  obstacleTone,
  permitBlocks,
  permitState,
  sortObstacles,
  sortPermits,
  unprotectedObstacles,
  type PmObstacle,
} from "@/lib/pm/site"
import { chaseObstacle, closeObstacle, fileDailyReport, issuePermit, logIncident, openObstacle, PmSiteError } from "@/lib/pm/site-writes"
import { draftClaim, PmClaimError } from "@/lib/pm/claim-writes"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const hse: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "hs1", role: "hse" }, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const se = { uid: "se1", name: "Yasser" }

const shift = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const T = "2026-09-28"
const today = todayDay()

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
  seed("projects/p1/boqItems/b1", { itemNo: "09-04-01", quantity: 10 })
  seed("projects/p1/boqItems/b2", { itemNo: "08-02-01", quantity: 5 })
})

describe("the daily report (DLY-01)", () => {
  it("needs what was done, whole counts, and one a day", () => {
    expect(dailyBlocks({ archived: false, done: " ", labour: 58, plant: 4, filed: false })).toEqual(["no_done"])
    expect(dailyBlocks({ archived: false, done: "Slab pour", labour: -1, plant: 1.5, filed: true })).toEqual(["bad_count", "already_filed"])
    expect(averageLabour([{ labour: 58 }, { labour: 54 }, { labour: 61 }])).toBe(58)
    expect(averageLabour([])).toBeNull()
  })

  it("is filed once today under the day, files optional, and never rewritten", async () => {
    const day = await fileDailyReport(db, site, "p1", se, { labour: 58, plant: 4, done: " Villa 4 slab pour ", obstacle: "", files: [{ url: "u", name: "IMG.jpg" }] })
    expect(day).toBe(today)
    expect(readDoc(`projects/p1/pmDaily/${today}`)).toMatchObject({ labour: 58, plant: 4, done: "Villa 4 slab pour", obstacle: null, files: [{ url: "u", name: "IMG.jpg" }], by: "se1" })
    await expect(fileDailyReport(db, site, "p1", se, { labour: 1, plant: 0, done: "again", obstacle: "" })).rejects.toMatchObject({ code: "blocked", blocks: ["already_filed"] })
  })

  it("is the daily duty's — the QS office and the manager's template hold none", async () => {
    await expect(fileDailyReport(db, qs, "p1", { uid: "qs1", name: null }, { labour: 1, plant: 0, done: "x", obstacle: "" })).rejects.toBeInstanceOf(PmAccessError)
    await expect(fileDailyReport(db, pm, "p1", { uid: "pm1", name: null }, { labour: 1, plant: 0, done: "x", obstacle: "" })).rejects.toBeInstanceOf(PmAccessError)
    await expect(fileDailyReport(db, hse, "p1", { uid: "hs1", name: null }, { labour: 1, plant: 0, done: "x", obstacle: "" })).resolves.toBe(today)
  })
})

describe("obstacles and RFIs (OBS-01)", () => {
  const base = { archived: false, type: "rfi", title: "Duct clash", party: "consultant", partyName: "", impact: "Halts ceilings", openOn: T, itemIds: ["b1"], knownItems: new Set(["b1"]), today: T }

  it("need what, to whom, impact, a real item and a date not in the future", () => {
    expect(obstacleBlocks(base)).toEqual([])
    expect(obstacleBlocks({ ...base, title: "", impact: " ", party: "other", openOn: shift(T, 1), itemIds: ["zz"] })).toEqual(["no_title", "no_impact", "no_party_name", "open_date", "bad_item"])
    expect(obstacleBlocks({ ...base, type: "x", party: "y" })).toEqual(["no_type", "no_party"])
  })

  it("count days open, or the days the answer took, and turn red after 10", () => {
    expect(obstacleDays({ openOn: shift(T, -12), closeOn: null }, T)).toBe(12)
    expect(obstacleDays({ openOn: shift(T, -64), closeOn: shift(T, -44) }, T)).toBe(20)
    expect(obstacleTone({ openOn: shift(T, -12), closeOn: null }, T)).toBe("late")
    expect(obstacleTone({ openOn: shift(T, -6), closeOn: null }, T)).toBe("wait")
    expect(obstacleTone({ openOn: shift(T, -6), closeOn: T }, T)).toBe("ok")
  })

  it("close on the answer's day — not before opening, never ahead, never twice", () => {
    expect(closeObstacleBlocks({ archived: false, openOn: T, on: shift(T, -1), today: T })).toEqual(["close_date"])
    expect(closeObstacleBlocks({ archived: false, openOn: T, on: shift(T, 1), today: T })).toEqual(["close_date"])
    expect(closeObstacleBlocks({ archived: false, openOn: T, closeOn: T, on: T, today: T })).toEqual(["closed"])
  })

  it("list open first, the longest wait on top", () => {
    const list = [
      { id: "a", openOn: shift(T, -3), closeOn: null },
      { id: "b", openOn: shift(T, -30), closeOn: shift(T, -28) },
      { id: "c", openOn: shift(T, -12), closeOn: null },
    ]
    expect(sortObstacles(list).map((o) => o.id)).toEqual(["c", "a", "b"])
  })

  it("an RFI stopping a line 10 days with no claim is unprotected; nobody to claim against is not claimable", () => {
    const o = (id: string, over: Partial<PmObstacle>): PmObstacle => ({ id, type: "rfi", seq: 1, title: "t", party: "consultant", itemIds: ["b1"], impact: "i", openOn: shift(T, -12), by: "se1", ...over })
    const list = [o("rfi-07", {}), o("rfi-05", { openOn: shift(T, -6) }), o("obs-02", { type: "obs" }), o("rfi-01", { itemIds: [] }), o("rfi-02", { closeOn: T })]
    expect(unprotectedObstacles(list, [], T).map((x) => x.id)).toEqual(["rfi-07"])
    expect(unprotectedObstacles(list, [{ obstacleId: "rfi-07" }], T)).toEqual([])
    expect(blockingObstacles(list).map((x) => x.id)).toEqual(["rfi-07", "rfi-05", "obs-02"])
    expect(claimable(o("x", { party: "none" }))).toBe(false)
    expect(claimSeed(o("rfi-07", { party: "client", title: "Floor level" }))).toEqual({ obstacleId: "rfi-07", cause: "Floor level", eventOn: shift(T, -12), causedBy: "client" })
  })

  it("are numbered apart by type, chased with dated signed entries, and closed with the answer", async () => {
    const input = { type: "rfi" as const, title: "Duct clash — villa 3", party: "consultant" as const, partyName: "Al-Bina", itemIds: ["b1", "b1"], impact: "Halts ceilings", openOn: today }
    expect(await openObstacle(db, site, "p1", se, input)).toBe("rfi-01")
    expect(await openObstacle(db, site, "p1", se, { ...input, type: "obs", party: "none", partyName: "", itemIds: [] })).toBe("obs-01")
    expect(await openObstacle(db, site, "p1", se, input)).toBe("rfi-02")
    expect(readDoc("projects/p1")).toMatchObject({ pm: { rfiCount: 2, obstacleCount: 1 } })
    expect(readDoc("projects/p1/pmObstacles/rfi-01")).toMatchObject({ itemIds: ["b1"], codes: ["09-04-01"], partyName: "Al-Bina", closeOn: null, chases: [] })

    expect(await chaseObstacle(db, site, "p1", se, "rfi-01")).toBe(1)
    expect(await chaseObstacle(db, pm, "p1", { uid: "pm1", name: "Khalid" }, "rfi-01")).toBe(2)
    expect(readDoc<PmObstacle>("projects/p1/pmObstacles/rfi-01")?.chases).toEqual([
      { on: today, by: "se1", byName: "Yasser" },
      { on: today, by: "pm1", byName: "Khalid" },
    ])

    await closeObstacle(db, site, "p1", se, "rfi-01", { on: today, answer: " Revised layout issued " })
    expect(readDoc("projects/p1/pmObstacles/rfi-01")).toMatchObject({ closeOn: today, answer: "Revised layout issued", closedBy: "se1" })
    await expect(chaseObstacle(db, site, "p1", se, "rfi-01")).rejects.toMatchObject({ blocks: ["closed"] })
    await expect(openObstacle(db, site, "p1", se, { ...input, itemIds: ["nope"] })).rejects.toBeInstanceOf(PmSiteError)
  })

  it("are raised by the site record (daily) or the manager (approve) — not by the QS office", async () => {
    const input = { type: "rfi" as const, title: "x", party: "client" as const, partyName: "", itemIds: [], impact: "y", openOn: today }
    await expect(openObstacle(db, qs, "p1", { uid: "qs1", name: null }, input)).rejects.toBeInstanceOf(PmAccessError)
    await expect(openObstacle(db, pm, "p1", { uid: "pm1", name: null }, input)).resolves.toBe("rfi-01")
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { lifecycle: "closed" } })
    await expect(openObstacle(db, site, "p1", se, input)).rejects.toMatchObject({ code: "archived" })
  })
})

describe("safety (HSE-01)", () => {
  it("incidents: type, what, action, a past date; lost days only on a lost-time injury", () => {
    const ok = { archived: false, type: "lti", what: "Slipped off scaffold", action: "Harness rule", day: T, lostDays: 21, today: T }
    expect(incidentBlocks(ok)).toEqual([])
    expect(incidentBlocks({ ...ok, type: "near", lostDays: 2 })).toEqual(["bad_days"])
    expect(incidentBlocks({ ...ok, type: "x", what: "", action: " ", day: shift(T, 1), lostDays: -1 })).toEqual(["no_type", "no_what", "no_action", "bad_date", "bad_days"])
  })

  it("counts days since the last lost-time injury, else since the start, and the lost days", () => {
    const inc = [
      { type: "near" as const, day: shift(T, -23), lostDays: 0 },
      { type: "lti" as const, day: shift(T, -118), lostDays: 21 },
      { type: "lti" as const, day: shift(T, -200), lostDays: 4 },
    ]
    expect(daysSinceLti(inc, shift(T, -300), T)).toEqual({ days: 118, fromLti: true })
    expect(daysSinceLti(inc.slice(0, 1), shift(T, -150), T)).toEqual({ days: 150, fromLti: false })
    expect(daysSinceLti([], null, T)).toBeNull()
    expect(lostDays(inc)).toBe(25)
  })

  it("permits: valid through their last day; ending today or tomorrow warns", () => {
    const p = [{ to: shift(T, 1) }, { to: shift(T, -1) }, { to: T }, { to: shift(T, 4) }]
    expect(livePermits(p, T)).toHaveLength(3)
    expect(expiredPermits(p, T)).toHaveLength(1)
    expect(p.map((x) => permitState(x, T))).toEqual(["soon", "expired", "today", "valid"])
    expect(sortPermits(p, T).map((x) => x.to)).toEqual([T, shift(T, 1), shift(T, 4), shift(T, -1)])
    expect(permitBlocks({ archived: false, title: " ", who: "", from: T, to: shift(T, -1) })).toEqual(["no_work", "no_who", "bad_period"])
  })

  it("is the HSE officer's — the site engineer's template leaves safety out (RL-06)", async () => {
    const input = { type: "lti" as const, what: "Ankle fracture", action: "Scaffolds inspected", day: today, lostDays: 21 }
    await expect(logIncident(db, site, "p1", se, input)).rejects.toBeInstanceOf(PmAccessError)
    expect(await logIncident(db, hse, "p1", { uid: "hs1", name: "Majed" }, input)).toBe(1)
    expect(await logIncident(db, hse, "p1", { uid: "hs1", name: "Majed" }, { ...input, type: "near", lostDays: 5 })).toBe(2)
    expect(readDoc("projects/p1/pmIncidents/01")).toMatchObject({ type: "lti", lostDays: 21, by: "hs1" })
    expect(readDoc("projects/p1/pmIncidents/02")).toMatchObject({ type: "near", lostDays: 0 })
    expect(await issuePermit(db, hse, "p1", { uid: "hs1", name: null }, { title: "Hot work — roof", who: "Al-Itqan", from: today, to: shift(today, 1) })).toBe(1)
    expect(readDoc("projects/p1")).toMatchObject({ pm: { incidentCount: 2, permitCount: 1 } })
  })
})

describe("a claim drafted from an obstacle (C-22)", () => {
  it("carries the obstacle as its evidence, and refuses one that does not exist", async () => {
    await openObstacle(db, site, "p1", se, { type: "rfi", title: "Floor level", party: "client", partyName: "", itemIds: ["b2"], impact: "Blocks slab", openOn: today })
    const claim = { kind: "time" as const, cause: "Floor level", eventOn: today, daysAsked: 12, amountAsked: 0 }
    await draftClaim(db, pm, "p1", { uid: "pm1", name: null }, { ...claim, obstacleId: "rfi-01" })
    expect(readDoc("projects/p1/pmClaims/01")).toMatchObject({ obstacleId: "rfi-01", status: "draft" })
    await expect(draftClaim(db, pm, "p1", { uid: "pm1", name: null }, { ...claim, obstacleId: "rfi-09" })).rejects.toMatchObject({ blocks: ["no_obstacle"] })
    await expect(draftClaim(db, pm, "p1", { uid: "pm1", name: null }, { ...claim, obstacleId: "rfi-09" })).rejects.toBeInstanceOf(PmClaimError)
    await draftClaim(db, pm, "p1", { uid: "pm1", name: null }, claim)
    expect(readDoc("projects/p1/pmClaims/02")).toMatchObject({ obstacleId: null })
  })
})
