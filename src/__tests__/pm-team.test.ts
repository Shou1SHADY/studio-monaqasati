/**
 * PM 1.0 — Team & permissions (WF-24, TM-01, RL-05, RL-07, INV-11, INV-20).
 * An exit dated today closes access today; only the owner appoints or removes
 * the project manager; with none, only the owner approves; seats are closed,
 * never deleted, and every change is logged.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { listCollection, readDoc, resetFakeDb, seed, fakeFirestore } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmAllowed, pmCeiling, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { assignBlocks, defaultTicked, offFromTicked, orderSeats, PM_HANDED_OVER, removeBlocks } from "@/lib/pm/team"
import { assignSeat, removeSeat } from "@/lib/pm/team-writes"

const db = fakeFirestore as unknown as Firestore
const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const pmCtx: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const qsCtx: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: null, archived: false }
const siteCtx: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const ownerActor = { uid: "owner", name: "Owner" }
const pmActor = { uid: "pm1", name: "Abdullah" }

function seedProject(over: Record<string, unknown> = {}) {
  seed("projects/p1", { organizationId: "owner", name: "Tower", projectManagerId: "pm1", projectManagerName: "Abdullah", pm: { no: "PJ-2026/001", lifecycle: "live" }, ...over })
  seed("projects/p1/members/pm1", { userId: "pm1", pmRole: "pm", off: [], from: "2026-09-01", to: null })
}

beforeEach(() => resetFakeDb())

describe("the pure rules", () => {
  it("`other` starts empty and must be named; its ticks are stored as the complement", () => {
    expect(defaultTicked("other")).toEqual([])
    expect(offFromTicked("other", ["measure"])).toHaveLength(13)
    expect(assignBlocks({ uid: "u", role: "other", roleName: " ", current: null, projectManagerId: "pm1", admin: true })).toEqual(["unnamed_other"])
  })

  it("only the owner appoints the PM or moves someone off it; a new PM replaces the old one in one step (RL-07, INV-11)", () => {
    expect(assignBlocks({ uid: "u", role: "pm", current: null, projectManagerId: null, admin: false })).toEqual(["pm_owner_only"])
    expect(assignBlocks({ uid: "u", role: "pm", current: null, projectManagerId: "pm1", admin: true })).toEqual([])
    expect(assignBlocks({ uid: "u", role: "pm", current: null, projectManagerId: "pm1", admin: false })).toEqual(["pm_owner_only"])
    expect(assignBlocks({ uid: "pm1", role: "site", current: { role: "pm" }, projectManagerId: "pm1", admin: false })).toEqual(["pm_owner_only"])
    expect(assignBlocks({ uid: "u", role: "pm", current: null, projectManagerId: null, admin: true })).toEqual([])
  })

  it("an exit needs a reason and a date of today or earlier (TM-01)", () => {
    const seat = { role: "site" as const, to: null }
    expect(removeBlocks({ seat, exitDate: "2026-09-28", reason: "moved", today: "2026-09-27", admin: false })).toEqual(["future_date"])
    expect(removeBlocks({ seat, exitDate: "2026-09-27", reason: "", today: "2026-09-27", admin: false })).toEqual(["no_reason"])
    expect(removeBlocks({ seat, exitDate: "2026-09-27", reason: "moved", today: "2026-09-27", admin: false })).toEqual([])
    expect(removeBlocks({ seat: { role: "pm", to: null }, exitDate: "2026-09-27", reason: "x", today: "2026-09-27", admin: false })).toEqual(["pm_owner_only"])
  })

  it("live seats first, the PM on top", () => {
    const seats = [
      { role: "site" as const, from: "2026-01-01", to: "2026-02-01", uid: "a" },
      { role: "qs" as const, from: "2026-01-02", to: null, uid: "b" },
      { role: "pm" as const, from: "2026-03-01", to: null, uid: "c" },
    ]
    expect(orderSeats(seats, "2026-09-27").map((s) => s.uid)).toEqual(["c", "b", "a"])
  })

  it("without a project manager only the owner approves (TM-01, INV-20)", () => {
    const other: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "x", role: "other", roleName: "Deputy", off: [] }, archived: false }
    expect(pmAllowed(other, "measurement.approve")).toBe(true)
    expect(pmAllowed({ ...other, managerless: true }, "measurement.approve")).toBe(false)
    expect(pmAllowed({ ...owner, managerless: true }, "measurement.approve")).toBe(true)
  })
})

describe("the writes", () => {
  it("the PM seats a site engineer with a duty removed; the record says who and what", async () => {
    seedProject()
    await assignSeat(db, pmCtx, "p1", pmActor, { uid: "se1", name: "Omar", role: "site", off: ["rcv"], groupId: "g-site" })
    const m = readDoc<Record<string, any>>("projects/p1/members/se1")!
    expect(m).toMatchObject({ userId: "se1", pmRole: "site", off: ["rcv"], from: todayDay(), to: null, groupId: "g-site" })
    expect(m.log).toHaveLength(1)
    expect(m.log[0]).toMatchObject({ by: "pm1", act: "assign", role: "site", off: ["rcv"] })
  })

  it("a site engineer cannot manage the team; the QS office can through `all`", async () => {
    seedProject()
    await expect(assignSeat(db, siteCtx, "p1", { uid: "se1", name: null }, { uid: "x", name: "X", role: "supervisor", off: [], groupId: null })).rejects.toBeInstanceOf(PmAccessError)
    await assignSeat(db, qsCtx, "p1", { uid: "qs1", name: "Q" }, { uid: "x", name: "X", role: "supervisor", off: [], groupId: null })
    expect(readDoc("projects/p1/members/x")).toMatchObject({ pmRole: "supervisor" })
  })

  it("an exit dated today closes the seat at once and keeps it; a future date is refused", async () => {
    seedProject()
    seed("projects/p1/members/se1", { userId: "se1", pmRole: "site", off: [], from: "2026-09-01", to: null })
    await expect(removeSeat(db, pmCtx, "p1", pmActor, "se1", { exitDate: "2999-01-01", reason: "moved" })).rejects.toMatchObject({ code: "blocked", blocks: ["future_date"] })
    await removeSeat(db, pmCtx, "p1", pmActor, "se1", { exitDate: todayDay(), reason: "moved to Jeddah" })
    const m = readDoc<Record<string, any>>("projects/p1/members/se1")!
    expect(m).toMatchObject({ to: todayDay(), why: "moved to Jeddah", byOut: "pm1" })
    expect(m.log.at(-1)).toMatchObject({ act: "remove", to: todayDay() })
    expect(listCollection("projects/p1/members")).toHaveLength(2)
  })

  it("only the owner removes the PM, and the project is then managerless", async () => {
    seedProject()
    await expect(removeSeat(db, qsCtx, "p1", { uid: "qs1", name: null }, "pm1", { exitDate: todayDay(), reason: "left" })).rejects.toMatchObject({ code: "owner_only" })
    await removeSeat(db, owner, "p1", ownerActor, "pm1", { exitDate: todayDay(), reason: "left the company" })
    expect(readDoc("projects/p1")).toMatchObject({ projectManagerId: null })
  })

  it("the owner replaces the PM in one step: the old seat closes «handed over», the project names the new one", async () => {
    seedProject()
    await assignSeat(db, owner, "p1", ownerActor, { uid: "pm2", name: "Fahad", role: "pm", off: [], groupId: null })
    expect(readDoc("projects/p1")).toMatchObject({ projectManagerId: "pm2", projectManagerName: "Fahad" })
    expect(readDoc("projects/p1/members/pm1")).toMatchObject({ to: todayDay(), why: PM_HANDED_OVER, byOut: "owner" })
    expect(readDoc("projects/p1/members/pm2")).toMatchObject({ pmRole: "pm", from: todayDay(), to: null })
  })

  it("a seat's first day is today or earlier — never later", async () => {
    seedProject()
    await expect(assignSeat(db, owner, "p1", ownerActor, { uid: "x", name: "X", role: "site", off: [], groupId: null, from: "2999-01-01" })).rejects.toMatchObject({ blocks: ["future_from"] })
    await assignSeat(db, owner, "p1", ownerActor, { uid: "x", name: "X", role: "site", off: [], groupId: null, from: "2026-01-05" })
    expect(readDoc("projects/p1/members/x")).toMatchObject({ from: "2026-01-05" })
  })

  it("nothing changes on an archived project, not even for the owner (RL-04)", async () => {
    seedProject({ pm: { no: "PJ-2026/001", lifecycle: "closed" } })
    await expect(assignSeat(db, owner, "p1", ownerActor, { uid: "x", name: "X", role: "site", off: [], groupId: null })).rejects.toMatchObject({ code: "archived" })
    await expect(removeSeat(db, owner, "p1", ownerActor, "pm1", { exitDate: todayDay(), reason: "x" })).rejects.toMatchObject({ code: "archived" })
  })
})
