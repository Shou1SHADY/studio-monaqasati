/**
 * HR 1.0 — attendance (AT-01…04, WF-04, WF-05): the sheet is everyone present
 * then exceptions; unrecorded days are filled only by a named declaration;
 * the month closes after it ends, never reopens; an office assumes presence.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import {
  arrivedOn,
  closeBlocks,
  compactExceptions,
  dayState,
  declarationRoster,
  declareBlocks,
  dueDays,
  employeeMonth,
  firstOnSite,
  isRestDay,
  missingDays,
  monthStatus,
  onLeaveOn,
  onSheet,
  sheetBlocks,
  type WorkplaceMonth,
} from "@/lib/hr/attendance"
import { closeMonth, declareMissing, recordDay } from "@/lib/hr/attendance-writes"
import { saveSite } from "@/lib/hr/site-writes"
import { benchSince, siteEndOf, siteLabel, siteWordOf, tradeRows } from "@/lib/hr/sites"
import { HrWriteError } from "@/lib/hr/write-guard"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const manager = ctx(["manager"], { uid: "hrm" })
const payroll = ctx(["payroll"], { uid: "pay" })
const sup = ctx(["supervisor"], { uid: "sup", sites: ["s1"] })
const actor = { uid: "sup", name: "Khalid" }
const SITE = { id: "s1", type: "project" as const }
const HQ = { id: "hq", type: "hq" as const }
const wm = (id: string) => readDoc<WorkplaceMonth>(`hrAttendance/${ORG}__${id}__2026-08`) as WorkplaceMonth

beforeEach(() => resetFakeDb())

describe("the rules", () => {
  it("Friday is the rest day; due days run through yesterday, the whole month once it is over", () => {
    expect(isRestDay("2026-08-07")).toBe(true)
    expect(isRestDay("2026-08-08")).toBe(false)
    expect(dueDays("2026-08", "2026-08-04")).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"])
    expect(dueDays("2026-08", "2026-09-10")).toHaveLength(27)
    expect(dueDays("2026-08", "2026-09-10", [{ from: "2026-08-10", days: 2 }])).toHaveLength(25)
  })

  it("missing = due days neither recorded nor declared; an office assumes presence", () => {
    const m = { days: { "2026-08-01": { by: "x", byName: null, at: "", listed: [], ex: {} } }, declarations: [{ days: ["2026-08-02"], employees: [], by: "x", byName: null, at: "", note: "n" }] }
    expect(missingDays(m, "2026-08", "2026-08-05", { assumed: false })).toEqual(["2026-08-03", "2026-08-04"])
    expect(missingDays(null, "2026-08", "2026-09-01", { assumed: true })).toEqual([])
  })

  it("a sheet: not in the future, not on a closed month, exceptions only for listed people, violations only by those who may", () => {
    const b = { day: "2026-08-03", today: "2026-08-03", closed: false, listed: ["a", "b"], ex: {}, mayRecordViolation: false }
    expect(sheetBlocks(b)).toEqual([])
    expect(sheetBlocks({ ...b, day: "2026-08-04" })).toEqual(["future"])
    expect(sheetBlocks({ ...b, ex: { c: { status: "absent" } } })).toEqual(["not_listed"])
    expect(sheetBlocks({ ...b, ex: { a: { ot: 14 } } })).toEqual(["bad_ot"])
    expect(sheetBlocks({ ...b, ex: { a: { violation: "late15" } } })).toEqual(["no_violation_role"])
  })

  it("present with nothing else is not written", () => {
    expect(compactExceptions({ a: {}, b: { ot: 0 }, c: { status: "sick" }, d: { ot: 2.3 } })).toEqual({ c: { status: "sick" }, d: { ot: 2.25 } })
  })

  it("closing: after month end only; unrecorded days block, or warn by policy", () => {
    const x = { month: "2026-08", today: "2026-08-31", closed: false, missing: [], policy: "block" as const }
    expect(closeBlocks(x).blocks).toEqual(["not_over"])
    expect(closeBlocks({ ...x, today: "2026-09-01", missing: ["2026-08-03"] }).blocks).toEqual(["missing"])
    expect(closeBlocks({ ...x, today: "2026-09-01", missing: ["2026-08-03"], policy: "warn" })).toEqual({ blocks: [], warnings: ["missing"] })
  })

  it("the person's month: present, exceptions, overtime, declared days apart", () => {
    const m = {
      days: {
        "2026-08-01": { by: "", byName: null, at: "", listed: ["a", "b"], ex: { b: { status: "absent" as const } } },
        "2026-08-02": { by: "", byName: null, at: "", listed: ["a", "b"], ex: { a: { ot: 3, violation: "late15" as const }, b: { status: "sick" as const } } },
      },
      declarations: [{ days: ["2026-08-03", "2026-08-04"], employees: ["a"], by: "", byName: null, at: "", note: "n" }],
    }
    expect(employeeMonth(m, "a")).toEqual({ present: 2, absent: 0, sick: 0, permission: 0, declared: 2, overtimeHours: 3, violations: [{ day: "2026-08-02", code: "late15" }] })
    expect(employeeMonth(m, "b")).toMatchObject({ present: 0, absent: 1, sick: 1, declared: 0 })
  })
})

describe("the writes", () => {
  it("the supervisor records his own site only; payroll may record, not declare", async () => {
    await recordDay(db, sup, ORG, SITE, "2026-08-01", actor, { listed: ["a", "b"], ex: { a: {}, b: { status: "absent" } } }, { today: "2026-08-01" })
    expect(wm("s1").days["2026-08-01"]).toMatchObject({ listed: ["a", "b"], ex: { b: { status: "absent" } }, byName: "Khalid" })
    await expect(recordDay(db, sup, ORG, { id: "s2", type: "project" }, "2026-08-01", actor, { listed: [], ex: {} }, { today: "2026-08-01" })).rejects.toMatchObject({ code: "not_your_site" })
    await recordDay(db, payroll, ORG, SITE, "2026-08-02", actor, { listed: ["a"], ex: {} }, { today: "2026-08-02" })
    await expect(declareMissing(db, payroll, ORG, SITE, "2026-08", actor, { days: ["2026-08-03"], note: "n", ack: true }, { today: "2026-08-05" })).rejects.toMatchObject({ code: "no_role" })
  })

  it("no close with an unrecorded day; a named declaration fills it; the month never reopens", async () => {
    seed("employees/a", { organizationId: ORG, siteId: "s1", status: "active", join: "2025-01-01" })
    await recordDay(db, sup, ORG, SITE, "2026-08-01", actor, { listed: ["a"], ex: {} }, { today: "2026-08-01" })
    await expect(closeMonth(db, sup, ORG, SITE, "2026-08", actor, "block", { today: "2026-09-01" })).rejects.toMatchObject({ blocks: ["missing"] })
    const missing = missingDays(wm("s1"), "2026-08", "2026-09-01", { assumed: false })
    expect(missing).toHaveLength(26)
    await expect(declareMissing(db, sup, ORG, SITE, "2026-08", actor, { days: missing, note: " ", ack: true }, { today: "2026-09-01" })).rejects.toMatchObject({ blocks: ["no_note"] })
    await expect(declareMissing(db, sup, ORG, SITE, "2026-08", actor, { days: missing, note: "Sheets lost in the rain", ack: false }, { today: "2026-09-01" })).rejects.toMatchObject({ blocks: ["no_ack"] })
    await declareMissing(db, sup, ORG, SITE, "2026-08", actor, { days: missing, note: "Sheets lost in the rain", ack: true }, { today: "2026-09-01" })
    expect(wm("s1").declarations[0]).toMatchObject({ byName: "Khalid", note: "Sheets lost in the rain", employees: ["a"], ack: true })
    await closeMonth(db, sup, ORG, SITE, "2026-08", actor, "block", { today: "2026-09-01" })
    expect(wm("s1").closed).toMatchObject({ by: "sup", asIs: false, missing: [] })
    await expect(recordDay(db, sup, ORG, SITE, "2026-08-31", actor, { listed: ["a"], ex: {} }, { today: "2026-09-01" })).rejects.toMatchObject({ blocks: ["past", "closed"] })
    await expect(closeMonth(db, sup, ORG, SITE, "2026-08", actor, "block", { today: "2026-09-02" })).rejects.toBeInstanceOf(HrWriteError)
  })

  it("under the warn policy the month closes as is, the unrecorded days kept on the closing", async () => {
    seed("employees/a", { organizationId: ORG, siteId: "s1", status: "active", join: "2025-01-01" })
    const r =await closeMonth(db, manager, ORG, SITE, "2026-08", actor, "warn", { today: "2026-09-01" })
    expect(r.asIs).toBe(true)
    expect(wm("s1").closed?.missing).toHaveLength(27)
  })

  it("an office closes with no records at all — presence is assumed", async () => {
    await closeMonth(db, manager, ORG, HQ, "2026-08", actor, "block", { today: "2026-09-01" })
    expect(wm("hq").closed).toMatchObject({ asIs: false, missing: [] })
  })
})

describe("an absent or sick day carries no overtime", () => {
  it("the sheet drops hours typed before the status changed", () => {
    expect(compactExceptions({ e1: { status: "absent", ot: 2 }, e2: { status: "sick", ot: 1 }, e3: { status: "permission", ot: 2 }, e4: { ot: 2 } })).toEqual({
      e1: { status: "absent" },
      e2: { status: "sick" },
      e3: { status: "permission", ot: 2 },
      e4: { ot: 2 },
    })
  })

  it("and a month already saved with them does not pay them", () => {
    const saved = { days: { "2026-08-03": { by: "s", byName: "S", at: "", listed: ["e1"], ex: { e1: { status: "absent" as const, ot: 2 } } } }, declarations: [] }
    expect(employeeMonth(saved, "e1")).toMatchObject({ absent: 1, overtimeHours: 0 })
  })
})

describe("who is on the day's sheet", () => {
  const e = (over: object) => ({ siteId: "s1", status: "active", join: "2026-09-15", ...over })

  it("nobody before the day he joined — a day back-filled later included", () => {
    expect(onSheet(e({}), "s1", "2026-09-10")).toBe(false)
    expect(onSheet(e({}), "s1", "2026-09-15")).toBe(true)
    expect(onSheet(e({ status: "expected" }), "s1", "2026-09-14")).toBe(false)
    expect(onSheet(e({ status: "expected" }), "s1", "2026-09-16")).toBe(true)
  })

  it("someone serving his notice stays on it to his last day; a settled leaver on the days he worked", () => {
    expect(onSheet(e({ status: "leaving", lastDay: "2026-11-30" }), "s1", "2026-10-20")).toBe(true)
    expect(onSheet(e({ status: "leaving", lastDay: "2026-11-30" }), "s1", "2026-12-01")).toBe(false)
    expect(onSheet(e({ status: "left", lastDay: "2026-10-03" }), "s1", "2026-10-02")).toBe(true)
    expect(onSheet(e({ status: "left", lastDay: "2026-10-03" }), "s1", "2026-10-04")).toBe(false)
    expect(onSheet(e({ status: "left" }), "s1", "2026-10-02")).toBe(false)
  })

  it("his own workplace only; the unassigned bench takes whoever has none", () => {
    expect(onSheet(e({}), "s2", "2026-09-20")).toBe(false)
    expect(onSheet(e({ siteId: null }), "__bench__", "2026-09-20")).toBe(true)
  })

  it("an approved leave — paid or not — covers its days, both ends included; a pending one covers nothing", () => {
    const reqs = [
      { employeeId: "e1", kind: "leave", state: "approved", leave: { from: "2026-09-06", to: "2026-09-10" } },
      { employeeId: "e2", kind: "leave", state: "pending", leave: { from: "2026-09-06", to: "2026-09-10" } },
      { employeeId: "e3", kind: "advance", state: "approved", leave: null },
    ]
    expect([...onLeaveOn(reqs, "2026-09-06")]).toEqual(["e1"])
    expect([...onLeaveOn(reqs, "2026-09-10")]).toEqual(["e1"])
    expect([...onLeaveOn(reqs, "2026-09-11")]).toEqual([])
  })
})

describe("a recorded day locks (WF-04): today's sheet, saved once", () => {
  it("the sheet blocks a past day and a day already on record", () => {
    const b = { day: "2026-08-03", today: "2026-08-03", closed: false, listed: ["a"], ex: {}, mayRecordViolation: false }
    expect(sheetBlocks({ ...b, day: "2026-08-02" })).toEqual(["past"])
    expect(sheetBlocks({ ...b, recorded: true })).toEqual(["recorded"])
  })

  it("the write refuses saving a recorded day again, and a past day — the declaration fills those", async () => {
    await recordDay(db, sup, ORG, SITE, "2026-08-03", actor, { listed: ["a"], ex: {} }, { today: "2026-08-03" })
    await expect(recordDay(db, sup, ORG, SITE, "2026-08-03", actor, { listed: ["a"], ex: { a: { status: "absent" } } }, { today: "2026-08-03" })).rejects.toMatchObject({ blocks: ["recorded"] })
    expect(wm("s1").days["2026-08-03"].ex).toEqual({})
    await expect(recordDay(db, manager, ORG, SITE, "2026-08-02", actor, { listed: ["a"], ex: {} }, { today: "2026-08-03" })).rejects.toMatchObject({ blocks: ["past"] })
  })
})

describe("missing days count from the first day someone was there (AT-04)", () => {
  it("a person counts from the day he joined or moved in", () => {
    expect(arrivedOn({ join: "2025-01-01", siteSince: "2026-08-20" })).toBe("2026-08-20")
    expect(arrivedOn({ join: "2026-08-10", siteSince: "2026-08-01" })).toBe("2026-08-10")
    expect(arrivedOn({ join: "2026-08-10" })).toBe("2026-08-10")
  })

  it("a workplace whose first worker came on the 20th has nothing missing before the 20th", () => {
    const first = firstOnSite([{ join: "2025-01-01", siteSince: "2026-08-20" }, { join: "2026-08-25" }], null, "2026-08")
    expect(first).toBe("2026-08-20")
    const m = missingDays(null, "2026-08", "2026-09-01", { assumed: false, from: first })
    expect(m[0]).toBe("2026-08-20")
    expect(m.every((d) => d >= "2026-08-20")).toBe(true)
    // Nobody there all month: nothing is missing.
    expect(missingDays(null, "2026-08", "2026-09-01", { assumed: false, from: firstOnSite([], null, "2026-08") })).toEqual([])
    // Someone there since before the month: from the 1st; a sheet listing someone counts too.
    expect(firstOnSite([{ join: "2024-01-01" }], null, "2026-08")).toBe("2026-08-01")
    expect(firstOnSite([], { days: { "2026-08-04": { by: "", byName: null, at: "", listed: ["x"], ex: {} } } }, "2026-08")).toBe("2026-08-04")
    // Someone who left before the month is not counted.
    expect(firstOnSite([{ join: "2024-01-01", lastDay: "2026-07-20" }], null, "2026-08")).toBeNull()
  })

  it("the write closes from the first arrival — a place that opened on the 20th closes with its own days recorded", async () => {
    seed("employees/m", { organizationId: ORG, siteId: "s1", status: "active", join: "2025-01-01", siteSince: "2026-08-27" })
    for (const d of ["2026-08-27", "2026-08-29", "2026-08-30", "2026-08-31"]) await recordDay(db, sup, ORG, SITE, d, actor, { listed: ["m"], ex: {} }, { today: d })
    await closeMonth(db, sup, ORG, SITE, "2026-08", actor, "block", { today: "2026-09-01" })
    expect(wm("s1").closed).toMatchObject({ asIs: false, missing: [] })
  })
})

describe("declared days are credited only to who was there (AT-04 — the month-end roster bug)", () => {
  it("each person from the day he joined or moved in, to his last day", () => {
    const days = ["2026-08-03", "2026-08-10", "2026-08-24"]
    const r = declarationRoster(
      [
        { id: "old", join: "2024-01-01" },
        { id: "mover", join: "2024-01-01", siteSince: "2026-08-20" },
        { id: "joiner", join: "2026-08-09" },
        { id: "late", join: "2026-08-30" },
        { id: "leaver", join: "2024-01-01", status: "leaving", lastDay: "2026-08-05" },
      ],
      days
    )
    expect(r.employees).toEqual(["old", "mover", "joiner", "leaver"])
    expect(r.manDays).toEqual({ old: 3, mover: 1, joiner: 2, leaver: 1 })
    expect(r.since).toEqual({ mover: "2026-08-20", joiner: "2026-08-09" })
    expect(r.until).toEqual({ leaver: "2026-08-05" })
    const m = { days: {}, declarations: [{ days, employees: r.employees, since: r.since, until: r.until, by: "", byName: null, at: "", note: "n" }] }
    expect(employeeMonth(m, "old").declared).toBe(3)
    expect(employeeMonth(m, "mover").declared).toBe(1)
    expect(employeeMonth(m, "joiner").declared).toBe(2)
    expect(employeeMonth(m, "leaver").declared).toBe(1)
    expect(employeeMonth(m, "late").declared).toBe(0)
  })

  it("the write credits the person who moved in mid-month only his own days", async () => {
    seed("employees/old", { organizationId: ORG, siteId: "s1", status: "active", join: "2024-01-01" })
    seed("employees/mover", { organizationId: ORG, siteId: "s1", status: "active", join: "2024-01-01", siteSince: "2026-08-20" })
    const missing = missingDays(null, "2026-08", "2026-09-01", { assumed: false, from: "2026-08-01" })
    const out = await declareMissing(db, manager, ORG, SITE, "2026-08", actor, { days: missing, note: "Book lost", ack: true }, { today: "2026-09-01" })
    const d = wm("s1").declarations[0]
    expect(d.employees.sort()).toEqual(["mover", "old"])
    expect(employeeMonth(wm("s1"), "old").declared).toBe(missing.length)
    expect(employeeMonth(wm("s1"), "mover").declared).toBe(missing.filter((x) => x >= "2026-08-20").length)
    expect(out.manDays).toBe(missing.length + missing.filter((x) => x >= "2026-08-20").length)
  })

  it("the statement is asked for: no tick, no declaration", () => {
    expect(declareBlocks({ days: ["2026-08-03"], note: "n", missing: ["2026-08-03"], closed: false, ack: false })).toEqual(["no_ack"])
    expect(declareBlocks({ days: ["2026-08-03"], note: "n", missing: ["2026-08-03"], closed: false, ack: true })).toEqual([])
  })
})

describe("the site page's readings", () => {
  it("the month: closed · up to date through its last record · behind since the first missing day", () => {
    const sheet = { by: "", byName: null, at: "", listed: ["a"], ex: {} }
    expect(monthStatus({ days: {}, declarations: [], closed: { by: "", byName: null, at: "", asIs: false, missing: [] } }, [])).toEqual({ state: "closed" })
    expect(monthStatus({ days: { "2026-08-03": sheet }, declarations: [], closed: null }, [])).toEqual({ state: "current", through: "2026-08-03" })
    expect(monthStatus({ days: { "2026-08-03": sheet }, declarations: [], closed: null }, ["2026-08-04", "2026-08-05"])).toEqual({ state: "behind", since: "2026-08-04", through: "2026-08-03", missing: 2 })
  })

  it("a person's day: leave first, then the exception, then the sheet — unrecorded until someone records it", () => {
    const sheet = { listed: ["a", "b"], ex: { b: { status: "sick" as const } } }
    const ctx = { onLeave: new Set(["c"]), assumed: false, day: "2026-08-03" }
    expect(dayState("a", sheet, ctx)).toBe("present")
    expect(dayState("b", sheet, ctx)).toBe("sick")
    expect(dayState("c", sheet, ctx)).toBe("leave")
    expect(dayState("d", null, ctx)).toBe("unrecorded")
    expect(dayState("d", null, { ...ctx, assumed: true })).toBe("present")
    expect(dayState("d", null, { ...ctx, day: "2026-08-07" })).toBe("rest")
  })
})

describe("workplaces (§5 Sites, ST-06, form site)", () => {
  it("the company's word for its workplaces follows its business type", () => {
    expect(siteWordOf("contractor")).toBe("contractor")
    expect(siteWordOf("supplier")).toBe("supplier")
    expect(siteWordOf("developer")).toBe("developer")
    expect(siteWordOf(null)).toBe("none")
  })

  it("a project site ends when Projects says it does: start + duration (+ extension); else the typed date", () => {
    expect(siteEndOf({ endDate: "2026-12-31" }, { pm: { startOn: "2026-01-01", durationDays: 100 } })).toBe("2026-04-11")
    expect(siteEndOf({ endDate: "2026-12-31" }, { pm: { startOn: "2026-01-01", durationDays: 100, grantedDays: 10 } })).toBe("2026-04-21")
    expect(siteEndOf({ endDate: "2026-12-31" }, null)).toBe("2026-12-31")
    expect(siteEndOf({ endDate: null }, { pm: null, endDate: "2027-01-01" })).toBe("2027-01-01")
  })

  it("by trade: assigned, present, expired iqamas — most first; the unassigned since the day they came off a site", () => {
    const people = [{ id: "a", trade: "mason" }, { id: "b", trade: "mason" }, { id: "c", trade: "carpenter" }]
    expect(tradeRows(people, new Set(["a", "c"]), (p) => p.id === "b")).toEqual([
      { trade: "mason", n: 2, p: 1, x: 1 },
      { trade: "carpenter", n: 1, p: 1, x: 0 },
    ])
    expect(benchSince({ siteId: null, siteSince: "2026-08-20", join: "2024-01-01" })).toBe("2026-08-20")
    expect(benchSince({ siteId: null, join: "2024-01-01" })).toBe("2024-01-01")
    expect(benchSince({ siteId: "s1", join: "2024-01-01" })).toBeNull()
  })

  it("the English name is kept and shown in English", async () => {
    const id = await saveSite(db, manager, ORG, { name: "برج الواحة", nameEn: " Oasis Tower ", type: "project", projectId: "p1" })
    expect(readDoc(`hrSites/${id}`)).toMatchObject({ name: "برج الواحة", nameEn: "Oasis Tower" })
    expect(siteLabel({ name: "برج الواحة", nameEn: "Oasis Tower" }, "en")).toBe("Oasis Tower")
    expect(siteLabel({ name: "برج الواحة", nameEn: "Oasis Tower" }, "ar")).toBe("برج الواحة")
    expect(siteLabel({ name: "برج الواحة" }, "en")).toBe("برج الواحة")
  })
})
