/**
 * HR 1.0 — punches, devices, geofence and shifts (PRD PT-01…08, SH-01…06,
 * forms 20–23; optional: punch). A punch is evidence and a person decides:
 * nothing deducted or marked absent by itself; the day's sheet stays the
 * record, recorded once its exceptions are decided; device files are reviewed
 * before saving; a shift belongs to the day it starts and changes from a date.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import { hrAllowed } from "@/lib/hr/access"
import { compactExceptions, type WorkplaceMonth } from "@/lib/hr/attendance"
import { recordDay } from "@/lib/hr/attendance-writes"
import {
  appPunchOn,
  dayPunches,
  deviceDay,
  deviceRows,
  fenceCheck,
  importLateDays,
  lateCode,
  mergePunch,
  punchDay,
  punchExceptions,
  punchTodayItems,
  readyDays,
  reviewDeviceFile,
  scheduleOf,
  siteDay,
  siteDayExceptions,
  sourceBlocks,
  sourceOf,
  type PunchMonth,
  type PunchSite,
  type PunchWorld,
  type SiteDay,
} from "@/lib/hr/punches"
import { appPunchBlocks, decidePunch, importDeviceFile, punchFromApp, recordPunchDay, saveSiteShifts, setEmployeeShift } from "@/lib/hr/punch-writes"
import { decideRequest } from "@/lib/hr/request-writes"
import { attfixTypesFor } from "@/lib/hr/requests"
import { REPORT_IDS, REPORTS, reportRows, visibleReports, type ReportWorld } from "@/lib/hr/reports"
import { defaultShifts, nextShift, shiftHeader, shiftIdOn, shiftMoves, shiftOf, shiftsBlocks, shiftSetBlocks, type SiteShifts } from "@/lib/hr/shifts"
import { leakage } from "@/lib/hr/today"
import { DEFAULT_HR_POLICIES } from "@/lib/hr/statutory"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const manager = ctx(["manager"], { uid: "hrm" })
const payroll = ctx(["payroll"], { uid: "pay" })
const sup = ctx(["supervisor"], { uid: "sup", sites: ["wh"] })
const actor = { uid: "hrm", name: "Sara" }

// 2026-10-06 is a Tuesday; the 5th a Monday; the 2nd a Friday.
const TODAY = "2026-10-06"
const YDAY = "2026-10-05"
const WH: PunchSite = { id: "wh", name: "Warehouse", type: "warehouse", att: { source: "device" } }
const OFFICE: PunchSite = { id: "hq", name: "HQ", type: "hq", att: { source: "app", geo: { lat: 24.7, lng: 46.7, r: 100 } } }
const SHIFTS: SiteShifts = { on: true, list: [{ id: "m", in: "07:00", out: "15:00" }, { id: "n", in: "23:00", out: "07:00" }] }
const WS: PunchSite = { id: "ws", name: "Workshop", type: "workshop", att: { source: "device" }, shifts: SHIFTS }

const emp = (id: string, over: Record<string, unknown> = {}) => ({ id, no: Number(id.replace(/\D/g, "")) || 1, siteId: "wh", status: "active", join: "2025-01-01", trade: "mason", ...over })

const sd = (over: Partial<SiteDay>): SiteDay => ({
  site: WH,
  source: "device",
  day: YDAY,
  today: TODAY,
  nowMin: 9 * 60,
  people: [{ id: "a" }, { id: "b" }],
  onLeave: new Set(),
  punches: {},
  decisions: {},
  recorded: false,
  closed: false,
  fileCovers: true,
  ...over,
})

beforeEach(() => resetFakeDb())

describe("the source and the schedule (PT-01, AT-06, SH-02)", () => {
  it("punch off — or the unassigned — is the supervisor's sheet; otherwise the HR manager's choice, or by type", () => {
    expect(sourceOf(WH, false)).toBe("sheet")
    expect(sourceOf({ id: "__bench__", type: null }, true)).toBe("sheet")
    expect(sourceOf({ id: "x", type: "workshop" }, true)).toBe("device")
    expect(sourceOf({ id: "x", type: "project" }, true)).toBe("sheet")
    expect(sourceOf({ id: "x", type: "hq" }, true)).toBe("app")
    expect(sourceOf({ id: "x", type: "project", att: { source: "app" } }, true)).toBe("app")
  })

  it("the schedule by type; a night shift ends the next morning; Ramadan six hours", () => {
    expect(scheduleOf(WH, null, TODAY)).toEqual({ in: 420, out: 960, night: false })
    expect(scheduleOf(WS, { shift: { id: "n", from: "2026-01-01" } }, TODAY)).toEqual({ in: 1380, out: 1860, night: true })
    // 1 Ramadan 1447 falls in February 2026.
    expect(scheduleOf(WH, null, "2026-03-01").out - scheduleOf(WH, null, "2026-03-01").in).toBe(360)
  })

  it("form am — readable times, grace 0–60, a radius of 30 m or more, both coordinates or none", () => {
    expect(sourceBlocks({ source: "app", schedule: { in: "08:00", out: "17:00" }, grace: 15, geo: { lat: 24, lng: 46, r: 150 } })).toEqual([])
    expect(sourceBlocks({ source: "app", schedule: { in: "08:00", out: "08:00" }, grace: 90, geo: { lat: 24, lng: null, r: 20 } })).toEqual(["bad_time", "bad_grace", "bad_radius", "bad_point"])
  })

  it("the fence: radius + 30 m; no centre — no check", () => {
    expect(fenceCheck(OFFICE, { lat: 24.7, lng: 46.7 })).toMatchObject({ inside: true, d: 0 })
    // ~120 m north: outside 100 m, inside 100 + 30.
    expect(fenceCheck(OFFICE, { lat: 24.7011, lng: 46.7 }).inside).toBe(true)
    expect(fenceCheck(OFFICE, { lat: 24.703, lng: 46.7 }).inside).toBe(false)
    expect(fenceCheck(WH, { lat: 24.7, lng: 46.7 })).toMatchObject({ inside: null, d: null })
  })
})

describe("exceptions — the system proposes, a person decides (PT-04, PT-05)", () => {
  it("late beyond grace, a missing out-punch yesterday, overtime of half an hour or more, outside the fence", () => {
    const x = siteDayExceptions(sd({ punches: { a: { in: "07:20", out: null, src: "dev" }, b: { in: "06:58", out: "17:10", src: "app", geo: false } } }))
    expect(x.map((e) => [e.kind, e.employeeId, e.min ?? e.h ?? null])).toEqual([
      ["late", "a", 20],
      ["noout", "a", null],
      ["fence", "b", null],
      ["ot", "b", 1],
    ])
    expect(lateCode(20)).toBe("late30")
  })

  it("no punch: not before shift start + 2 h today, not before a device file covers the day, not on an app day nobody punched", () => {
    const today = sd({ day: TODAY, punches: { b: { in: "07:00", out: null, src: "dev" } } })
    expect(siteDayExceptions({ ...today, nowMin: 8 * 60 }).filter((e) => e.kind === "nop")).toEqual([])
    expect(siteDayExceptions({ ...today, nowMin: 9 * 60 + 1 }).filter((e) => e.kind === "nop").map((e) => e.employeeId)).toEqual(["a"])
    expect(siteDayExceptions({ ...today, nowMin: 12 * 60, fileCovers: false }).filter((e) => e.kind === "nop")).toEqual([])
    expect(siteDayExceptions(sd({ source: "app", site: OFFICE, punches: {} }))).toEqual([])
    // On leave is never absent; a Friday asks nothing.
    expect(siteDayExceptions(sd({ onLeave: new Set(["a", "b"]) }))).toEqual([])
    expect(siteDayExceptions(sd({ day: "2026-10-02" })).filter((e) => e.kind === "nop")).toEqual([])
  })

  it("a decision closes its exception; a recorded day, a closed month or the sheet asks nothing", () => {
    const base = sd({ punches: { a: { in: "07:20", out: "18:00", src: "dev" } } })
    expect(siteDayExceptions(base).map((e) => e.kind)).toEqual(["late", "ot", "nop"])
    const stamp = { by: "u", byName: null, at: "" }
    expect(siteDayExceptions({ ...base, decisions: { a: { late: { ...stamp, v: "excused" }, ot: { ...stamp, v: "nowork", h: 2 } }, b: { nop: { ...stamp, v: "absent" } } } })).toEqual([])
    expect(siteDayExceptions({ ...base, recorded: true })).toEqual([])
    expect(siteDayExceptions({ ...base, closed: true })).toEqual([])
    expect(siteDayExceptions({ ...base, source: "sheet" })).toEqual([])
  })

  it("a night worker's out the next morning is missing only two hours after the shift ends", () => {
    const night = sd({ site: WS, people: [{ id: "a", shift: { id: "n", from: "2026-01-01" } }], punches: { a: { in: "23:00", out: null, src: "dev" } } })
    expect(siteDayExceptions({ ...night, nowMin: 8 * 60 }).map((e) => e.kind)).toEqual([])
    expect(siteDayExceptions({ ...night, nowMin: 9 * 60 + 5 }).map((e) => e.kind)).toEqual(["noout"])
  })
})

describe("the day recorded from punches", () => {
  const stamp = { by: "u", byName: null, at: "" }
  it("blocked while no punch, a missing out or overtime waits; late never blocks", () => {
    const d = sd({ punches: { a: { in: "07:20", out: "16:00", src: "dev" } } })
    expect(punchDay(d).blocks).toEqual(["open"])
    const decided = { ...d, decisions: { b: { nop: { ...stamp, v: "absent" as const } } } }
    expect(punchDay(decided)).toMatchObject({ blocks: [], listed: ["a", "b"], ex: { b: { status: "absent" } }, present: 1, absent: 1 })
  })

  it("approved punch overtime is overtime; refused is not; a permission is a permission", () => {
    const d = sd({
      punches: { a: { in: "07:00", out: "18:00", src: "dev" } },
      decisions: { a: { ot: { ...stamp, v: "ok", h: 2 } }, b: { nop: { ...stamp, v: "permission" } } },
    })
    expect(punchDay(d)).toMatchObject({ blocks: [], ex: { a: { ot: 2 }, b: { status: "permission" } } })
    const refused = { ...d, decisions: { ...d.decisions, a: { ot: { ...stamp, v: "err" as const, h: 2 } } } }
    expect(punchDay(refused).ex.a).toBeUndefined()
  })

  it("not today, not twice, not with no file; on a rest day only those who punched are listed", () => {
    expect(punchDay(sd({ day: TODAY })).blocks).toContain("today")
    expect(punchDay(sd({ recorded: true })).blocks).toContain("recorded")
    expect(punchDay(sd({ fileCovers: false })).blocks).toContain("no_file")
    expect(punchDay(sd({ day: "2026-10-02", punches: { a: { in: "07:00", out: "16:00", src: "dev" } } })).listed).toEqual(["a"])
  })
})

describe("the device file (form impdev, PT-02, SH-05)", () => {
  it("columns: employee no · date · time — a header skipped, day-first dates, a date-time in one column", () => {
    expect(deviceDay("05/10/2026")).toBe("2026-10-05")
    expect(deviceDay("2026/10/05")).toBe("2026-10-05")
    expect(deviceDay("31/02/2026")).toBe(null)
    expect(deviceRows([["No", "Date", "Time"], ["7", "2026-10-05", "07:01:33"], ["8", "05/10/2026 06:59", ""], ["x", "", ""]])).toEqual([
      { line: 2, no: "7", day: "2026-10-05", time: "07:01" },
      { line: 3, no: "8", day: "2026-10-05", time: "06:59" },
      { line: 4, no: "x", day: null, time: null },
    ])
  })

  it("the review: first in / last out, duplicates within five minutes, unknown numbers, on leave, assigned elsewhere, late, dawn", () => {
    const employees = [emp("e1"), emp("e2"), emp("e3", { siteId: "hq" }), emp("e4"), emp("e5", { siteId: "ws", shift: { id: "n", from: "2026-01-01" } })]
    const requests = [{ employeeId: "e4", kind: "leave", state: "approved", leave: { from: "2026-10-01", to: "2026-10-10" } }] as unknown as Parameters<typeof reviewDeviceFile>[1]["requests"]
    const rows = deviceRows([
      ["1", "2026-10-05", "07:30"],
      ["1", "2026-10-05", "07:32"],
      ["1", "2026-10-05", "16:05"],
      ["2", "2026-10-05", "06:55"],
      ["3", "2026-10-05", "07:00"],
      ["4", "2026-10-05", "07:00"],
      ["99", "2026-10-05", "07:00"],
      ["1", "2026-10-09", "07:00"],
    ])
    const r = reviewDeviceFile(rows, { site: WH, employees, requests, today: TODAY })
    expect(r.saved).toEqual([
      { employeeId: "e1", day: YDAY, in: "07:30", out: "16:05" },
      { employeeId: "e2", day: YDAY, in: "06:55", out: null },
    ])
    expect(r).toMatchObject({ dup: 1, unknown: ["99"], future: 1, late: 1, leave: [{ employeeId: "e4", day: YDAY }], other: [{ employeeId: "e3", day: YDAY, siteId: "hq", in: "07:00" }] })
    // A night worker's 06:58 on the 6th closes the shift that started on the 5th.
    const night = reviewDeviceFile(deviceRows([["5", "2026-10-05", "22:58"], ["5", "2026-10-06", "07:04"]]), { site: WS, employees, requests: [], today: TODAY })
    expect(night).toMatchObject({ dawn: 1, saved: [{ employeeId: "e5", day: YDAY, in: "22:58", out: "07:04" }] })
  })

  it("a second file merges: the earliest in, the latest out; a correction stays one", () => {
    const sc = scheduleOf(WH, null, YDAY)
    expect(mergePunch({ in: "07:05", out: null, src: "dev" }, { in: "16:10", out: null }, sc)).toEqual({ in: "07:05", out: "16:10", src: "dev", geo: null })
    expect(mergePunch({ in: "07:00", out: "15:00", src: "fix" }, { in: "06:50", out: null }, sc).src).toBe("fix")
  })

  it("a silent device: the last file more than a day old (PT-03)", () => {
    expect(importLateDays({ at: `${YDAY}T09:00:00Z` }, TODAY)).toBe(null)
    expect(importLateDays({ at: "2026-10-03T09:00:00Z" }, TODAY)).toBe(3)
    expect(importLateDays(null, TODAY)).toBe(null)
  })
})

describe("shifts (SH-01…06)", () => {
  it("the shift from its date; the one before it until then; the workplace's first when none", () => {
    const e = { shift: { id: "n" as const, from: "2026-10-10", prev: "m" as const } }
    expect(shiftIdOn(e, "2026-10-09")).toBe("m")
    expect(shiftIdOn(e, "2026-10-10")).toBe("n")
    expect(shiftOf({}, WS, TODAY)?.id).toBe("m")
    expect(shiftOf(e, { shifts: { on: false, list: [] } }, TODAY)).toBe(null)
  })

  it("form shifts — on with none ticked is refused; a workshop starts with three", () => {
    expect(shiftsBlocks({ on: true, list: [] })).toEqual(["none_chosen"])
    expect(shiftsBlocks({ on: true, list: [{ id: "m", in: "07:00", out: "07:00" }] })).toEqual(["same_time"])
    expect(shiftsBlocks({ on: false, list: [] })).toEqual([])
    expect(defaultShifts("workshop").list.map((s) => s.id)).toEqual(["m", "e", "n"])
    expect(defaultShifts("warehouse").list.map((s) => s.id)).toEqual(["m", "e"])
  })

  it("a shift no longer run moves its workers to the first one from today; switching off clears them", () => {
    const people = [{ id: "a", shift: { id: "n" as const, from: "2026-01-01" } }, { id: "b", shift: { id: "m" as const, from: "2026-01-01" } }, { id: "c" }]
    expect(shiftMoves(people, { on: true, list: [SHIFTS.list[0]] }, TODAY)).toEqual([{ id: "a", shift: { id: "m", from: TODAY, prev: "n" } }])
    expect(shiftMoves(people, { on: false, list: [] }, TODAY)).toEqual([{ id: "a", shift: null }, { id: "b", shift: null }])
  })

  it("form shiftset — a run shift, from today or later, not the one already in force", () => {
    const list = SHIFTS.list
    expect(shiftSetBlocks({ list, shiftId: "n", from: "2026-10-07", today: TODAY, current: "m" })).toEqual([])
    expect(shiftSetBlocks({ list, shiftId: "e", from: YDAY, today: TODAY, current: "m" })).toEqual(["not_run", "past"])
    expect(shiftSetBlocks({ list, shiftId: "m", from: TODAY, today: TODAY, current: "m" })).toEqual(["same"])
    expect(shiftSetBlocks({ list: null, shiftId: "m", from: TODAY, today: TODAY, current: null })).toEqual(["no_shifts"])
    expect(nextShift({ shift: { id: "m", from: "2026-01-01" } }, list, "n", "2026-10-07")).toEqual({ id: "n", from: "2026-10-07", prev: "m" })
  })

  it("the sheet by shift: present / on it, and the second shifts (SH-04, SH-06)", () => {
    const people = [{ id: "a" }, { id: "b", shift: { id: "n" as const, from: "2026-01-01" } }, { id: "c" }]
    expect(shiftHeader(people, WS, TODAY, (id) => id !== "c", (id) => id === "a")).toEqual({
      rows: [
        { shift: SHIFTS.list[0], present: 1, total: 2 },
        { shift: SHIFTS.list[1], present: 1, total: 1 },
      ],
      second: 1,
    })
    // A second shift is kept only with the hours it adds.
    expect(compactExceptions({ a: { ot: 8, second: true }, b: { second: true } })).toEqual({ a: { ot: 8, second: true } })
  })
})

describe("the world: exceptions across workplaces, Today, reports", () => {
  const months = [{ siteId: "wh", month: "2026-10", days: {}, closed: null, imports: [{ by: "u", byName: null, at: "2026-10-01T08:00:00Z", rows: 1, saved: 1, dup: 0, dawn: 0, unknown: [], days: [YDAY] }], pd: { [YDAY]: { e1: { in: "07:40", out: "16:00", src: "dev" as const } } } }]
  const world = (over: Partial<PunchWorld> = {}): PunchWorld => ({
    today: TODAY,
    nowMin: 600,
    punch: true,
    employees: [emp("e1"), emp("e2")],
    sites: [WH],
    months: months as PunchWorld["months"],
    requests: [],
    ...over,
  })

  it("the week's undecided exceptions, scoped to the viewer's workplaces", () => {
    expect(punchExceptions(world()).map((x) => [x.kind, x.employeeId, x.day])).toEqual([
      ["nop", "e2", YDAY],
      ["late", "e1", YDAY],
    ])
    expect(punchExceptions(world({ scope: ["hq"] }))).toEqual([])
    expect(punchExceptions(world({ punch: false }))).toEqual([])
  })

  it("Today: the HR manager decides them; HR and payroll see a silent device; payroll the overtime before closing; nothing another module holds has a button", () => {
    const items = punchTodayItems(manager, world())
    expect(items.map((x) => x.kind)).toEqual(["punch_exceptions", "device_silent"])
    expect(items[1]).toMatchObject({ href: "attendance?import=wh", action: "import", group: "blocking" })
    expect(punchTodayItems(payroll, world({ months: [{ ...months[0], pd: { [YDAY]: { e1: { in: "07:00", out: null, src: "dev" } } } }] as PunchWorld["months"] })).map((x) => x.kind)).toEqual(["device_silent", "punch_ot"])
    expect(punchTodayItems(ctx(["gov"]), world())).toEqual([])
    expect(leakage(items)).toBe(0)
  })

  it("days ready: everything decided, recorded once", () => {
    const decided = { ...months[0], pdx: { [YDAY]: { e1: { late: { by: "u", byName: null, at: "", v: "excused" as const } }, e2: { nop: { by: "u", byName: null, at: "", v: "absent" as const } } } } }
    expect(readyDays(world({ months: [decided] as PunchWorld["months"] }), WH).map((d) => [d.day, d.present, d.absent])).toEqual([[YDAY, 1, 1]])
  })

  it("the lateness and roster reports are offered only with punch on", () => {
    const ids = (f: string[]) => visibleReports(manager, new Set(f as never[])).map((r) => r.id)
    expect(ids([])).toEqual(REPORT_IDS.filter((id) => !REPORTS[id].feature))
    expect(ids(["punch"])).toEqual([...REPORT_IDS])
    const w = {
      today: TODAY,
      locale: "en",
      employees: [{ ...emp("e1"), names: { ar: "أ", en: "A" }, no: 1, siteId: "ws", shift: { id: "n", from: "2026-01-01" } }],
      sites: [WS],
      pays: new Map(),
      payrolls: [],
      month: "2026-09",
      attendance: [],
      requests: [],
      violations: [],
      exits: [],
      punch: { months: [{ siteId: "ws", month: "2026-10", days: { [TODAY]: { by: "", byName: null, at: "", listed: ["e1"], ex: { e1: { ot: 8, second: true } } } }, closed: null }], nowMin: 600 },
    } as unknown as ReportWorld
    expect(reportRows("roster", w)).toEqual([[1, "A", "mason", "Workshop", "n", "23:00", "07:00 +1", "yes"]])
    for (const id of ["late", "roster"] as const) for (const r of reportRows(id, w)) expect(r).toHaveLength(REPORTS[id].columns.length)
  })

  it("the correction types: forgotten punch and outside the fence only where people punch", () => {
    expect(attfixTypesFor(sourceOf(WH, true) !== "sheet")).toEqual(["miss", "out", "abs"])
    expect(attfixTypesFor(sourceOf({ id: "p", type: "project" }, true) !== "sheet")).toEqual(["abs"])
  })
})

// ---------------------------------------------------------------------------
// The writes
// ---------------------------------------------------------------------------

const seedWorld = () => {
  seed("hrSites/wh", { organizationId: ORG, name: "Warehouse", type: "warehouse", active: true, supervisorUserId: "sup", att: { source: "device" } })
  seed("hrSites/ws", { organizationId: ORG, name: "Workshop", type: "workshop", active: true, shifts: SHIFTS })
  seed("hrSites/hq", { organizationId: ORG, name: "HQ", type: "hq", active: true, att: OFFICE.att })
  seed("employees/e1", { organizationId: ORG, no: 1, names: { ar: "أ" }, siteId: "wh", status: "active", join: "2025-01-01", trade: "mason", userId: "u_e1" })
  seed("employees/e2", { organizationId: ORG, no: 2, names: { ar: "ب" }, siteId: "wh", status: "active", join: "2025-01-01", trade: "mason" })
  seed("employees/e5", { organizationId: ORG, no: 5, names: { ar: "ج" }, siteId: "ws", status: "active", join: "2025-01-01", trade: "mason", shift: { id: "n", from: "2026-01-01" } })
  seed("employees/e9", { organizationId: ORG, no: 9, names: { ar: "د" }, siteId: "hq", status: "active", join: "2025-01-01", trade: "clerk", userId: "u_e9" })
}
const month = (site: string) => readDoc<WorkplaceMonth & PunchMonth>(`hrAttendance/${ORG}__${site}__2026-10`)
const review = () =>
  reviewDeviceFile(deviceRows([["1", YDAY, "07:25"], ["1", YDAY, "16:00"], ["2", YDAY, "07:00"], ["9", YDAY, "08:00"]]), {
    site: WH,
    employees: [emp("e1", { no: 1 }), emp("e2", { no: 2 }), emp("e9", { no: 9, siteId: "hq" })],
    requests: [],
    today: TODAY,
  })

describe("writing punches", () => {
  it("a device file: the workplace's supervisor or payroll — never another workplace's; saved beside the sheet, never in it", async () => {
    seedWorld()
    await expect(importDeviceFile(db, ctx(["supervisor"], { uid: "x", sites: ["ws"] }), ORG, WH, actor, review(), [])).rejects.toMatchObject({ code: "not_your_site" })
    expect(await importDeviceFile(db, sup, ORG, WH, actor, review(), [])).toEqual({ saved: 2, skipped: 0 })
    const m = month("wh")!
    expect(m.pd?.[YDAY]).toEqual({ e1: { in: "07:25", out: "16:00", src: "dev", geo: null }, e2: { in: "07:00", out: null, src: "dev", geo: null } })
    expect(m.xs?.[YDAY]).toEqual({ e9: "hq" })
    expect(m.days).toEqual({})
    expect(m.imports?.[0]).toMatchObject({ by: "hrm", saved: 2, days: [YDAY] })
    // A second file merges into the first.
    await importDeviceFile(db, payroll, ORG, WH, actor, reviewDeviceFile(deviceRows([["2", YDAY, "16:30"]]), { site: WH, employees: [emp("e2", { no: 2 })], requests: [], today: TODAY }), [])
    expect(month("wh")!.pd?.[YDAY]?.e2).toEqual({ in: "07:00", out: "16:30", src: "dev", geo: null })
  })

  it("a closed month takes no punches", async () => {
    seedWorld()
    seed(`hrAttendance/${ORG}__wh__2026-10`, { organizationId: ORG, siteId: "wh", month: "2026-10", days: {}, declarations: [], closed: { by: "x", byName: null, at: "", asIs: false, missing: [] } })
    expect(await importDeviceFile(db, manager, ORG, WH, actor, review(), [])).toEqual({ saved: 0, skipped: 3 })
  })

  it("decisions in the decider's name, before the day is recorded; refused overtime is told to the employee", async () => {
    seedWorld()
    await importDeviceFile(db, manager, ORG, WH, actor, review(), [])
    await decidePunch(db, manager, ORG, WH, actor, { day: YDAY, employeeId: "e1", kind: "late", v: "excused", min: 25 })
    await decidePunch(db, manager, ORG, WH, actor, { day: YDAY, employeeId: "e2", kind: "out" })
    await decidePunch(db, manager, ORG, WH, actor, { day: YDAY, employeeId: "e1", kind: "ot", v: "wait", h: 1 })
    const pdx = month("wh")!.pdx![YDAY]
    expect(pdx.e1).toMatchObject({ late: { v: "excused", by: "hrm" }, ot: { v: "wait", h: 1 } })
    expect(pdx.e2.out?.v).toBe("16:00")
    expect(listCollection<{ kind: string }>("employees/e1/log").map((l) => l.kind).sort()).toEqual(["punch_late_excused", "punch_ot_refused"])
    expect(listCollection<{ type: string; i18n: { params: Record<string, unknown> } }>("users/u_e1/notifications")).toEqual([expect.objectContaining({ type: "hr_ot_refused", i18n: expect.objectContaining({ params: expect.objectContaining({ why: "@hr_ot_why.wait", h: 1 }) }) })])
    await expect(decidePunch(db, payroll, ORG, WH, actor, { day: YDAY, employeeId: "e1", kind: "late", v: "violation", min: 25 })).rejects.toMatchObject({ code: "no_role" })
  })

  it("a late arrival made a violation opens its record for the HR manager (WF-09)", async () => {
    seedWorld()
    await decidePunch(db, manager, ORG, WH, actor, { day: YDAY, employeeId: "e1", kind: "late", v: "violation", min: 40 }, { today: TODAY })
    expect(readDoc(`hrViolations/${ORG}__e1__${YDAY}__late60`)).toMatchObject({ code: "late60", on: YDAY })
  })

  it("the day recorded from its punches — once, the day after; refused while an exception waits", async () => {
    seedWorld()
    await importDeviceFile(db, manager, ORG, WH, actor, review(), [])
    const w = (): PunchWorld => ({
      today: TODAY,
      nowMin: 600,
      punch: true,
      employees: [emp("e1"), emp("e2")],
      sites: [WH],
      months: [month("wh")!] as PunchWorld["months"],
      requests: [],
    })
    await expect(recordPunchDay(db, manager, ORG, siteDay(w(), WH, YDAY), actor)).rejects.toMatchObject({ blocks: ["open"] })
    await decidePunch(db, manager, ORG, WH, actor, { day: YDAY, employeeId: "e2", kind: "out" })
    expect(await recordPunchDay(db, manager, ORG, siteDay(w(), WH, YDAY), actor)).toEqual({ present: 2, absent: 0 })
    expect(month("wh")!.days[YDAY]).toMatchObject({ listed: ["e1", "e2"], ex: {}, src: "punch" })
    await expect(recordPunchDay(db, manager, ORG, siteDay(w(), WH, YDAY), actor)).rejects.toMatchObject({ blocks: ["recorded"] })
    // The typed sheet of a past day stays refused (WF-04) — only a day recorded from punches may come after it.
    await expect(recordDay(db, manager, ORG, { id: "wh", type: "warehouse" }, "2026-10-01", actor, { listed: ["e1"], ex: {} }, { today: TODAY })).rejects.toMatchObject({ blocks: ["past"] })
  })

  it("his own punch: in once a day, out after it, the day before kept as `py`", async () => {
    seedWorld()
    const e9 = () => ({ id: "e9", ...(readDoc<Record<string, unknown>>("employees/e9") as object) }) as Parameters<typeof punchFromApp>[1]
    await punchFromApp(db, e9(), "app", "in", { inside: true, d: 12 }, { today: YDAY })
    expect(readDoc<{ pn: { day: string; in: unknown; out: unknown; inside: boolean } }>("employees/e9")!.pn).toMatchObject({ day: YDAY, out: null, inside: true })
    // The server stamps the time (the fake stores it as an ISO string).
    expect(readDoc<{ pn: { in: unknown } }>("employees/e9")!.pn.in).toBeTruthy()
    await expect(punchFromApp(db, e9(), "app", "in", { inside: true, d: 12 }, { today: YDAY })).rejects.toMatchObject({ blocks: ["done"] })
    await punchFromApp(db, e9(), "app", "out", { inside: false, d: 400 }, { today: YDAY })
    expect(readDoc<{ pn: { outInside: boolean } }>("employees/e9")!.pn.outInside).toBe(false)
    await punchFromApp(db, e9(), "app", "in", { inside: true, d: 5 }, { today: TODAY })
    const after = readDoc<{ pn: { day: string }; py: { day: string } }>("employees/e9")!
    expect([after.pn.day, after.py.day]).toEqual([TODAY, YDAY])
    expect(appPunchBlocks({ status: "active" }, "device", "in", TODAY)).toEqual(["not_app"])
    // The app punch reads as the day's punch, outside the fence flagged.
    expect(appPunchOn(after as never, YDAY)).toMatchObject({ src: "app", geo: false })
    expect(Object.keys(dayPunches(null, YDAY, [{ id: "e9", ...(after as object) }]))).toEqual(["e9"])
  })

  it("a worker's shift from a date: the HR manager or his own workplace's supervisor; logged", async () => {
    seedWorld()
    seed("hrSites/ws", { organizationId: ORG, name: "Workshop", type: "workshop", active: true, shifts: SHIFTS, supervisorUserId: "sup2" })
    const sup2 = ctx(["supervisor"], { uid: "sup2", sites: ["ws"] })
    await expect(setEmployeeShift(db, sup, "e5", actor, { shiftId: "m", from: "2026-10-07" }, { today: TODAY })).rejects.toMatchObject({ code: "not_your_site" })
    await expect(setEmployeeShift(db, sup2, "e5", actor, { shiftId: "m", from: YDAY }, { today: TODAY })).rejects.toMatchObject({ blocks: ["past"] })
    await setEmployeeShift(db, sup2, "e5", actor, { shiftId: "m", from: "2026-10-07" }, { today: TODAY })
    expect(readDoc<{ shift: unknown }>("employees/e5")!.shift).toEqual({ id: "m", from: "2026-10-07", prev: "n" })
    expect(listCollection<{ kind: string; params: unknown }>("employees/e5/log")).toEqual([expect.objectContaining({ kind: "shift_changed", params: { was: "n", now: "m", on: "2026-10-07" } })])
    expect(hrAllowed(payroll, "shift.set")).toBe(false)
  })

  it("the workplace's shifts: the HR manager's; a removed shift moves its workers", async () => {
    seedWorld()
    await expect(saveSiteShifts(db, sup, ORG, "ws", actor, { on: true, list: [] }, [])).rejects.toMatchObject({ code: "no_role" })
    const r = await saveSiteShifts(db, manager, ORG, "ws", actor, { on: true, list: [SHIFTS.list[0]] }, [{ id: "e5", shift: { id: "n", from: "2026-01-01" } }], { today: TODAY })
    expect(r).toEqual({ moved: 1 })
    expect(readDoc<{ shifts: SiteShifts }>("hrSites/ws")!.shifts).toEqual({ on: true, list: [SHIFTS.list[0]] })
    expect(readDoc<{ shift: unknown }>("employees/e5")!.shift).toEqual({ id: "m", from: TODAY, prev: "n" })
  })

  it("an approved forgotten punch puts a corrected punch on the day — shift start to end, no overtime", async () => {
    seedWorld()
    seed("hrRequests/q1", {
      organizationId: ORG,
      no: "AQ-2026/001",
      kind: "attfix",
      employeeId: "e2",
      employeeName: "ب",
      siteId: "wh",
      deciderLevel: "manager",
      state: "pending",
      attfix: { type: "miss", day: YDAY, reason: "forgot" },
      createdAt: `${TODAY}T08:00:00Z`,
    })
    await decideRequest(db, manager, "q1", actor, "approve", "", { policies: DEFAULT_HR_POLICIES, today: TODAY })
    expect(month("wh")!.pd?.[YDAY]?.e2).toEqual({ in: "07:00", out: "16:00", src: "fix", geo: true })
    expect(readDoc<{ state: string }>("hrRequests/q1")!.state).toBe("approved")
  })
})
