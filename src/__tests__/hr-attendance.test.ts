/**
 * HR 1.0 — attendance (AT-01…04, WF-04, WF-05): the sheet is everyone present
 * then exceptions; unrecorded days are filled only by a named declaration;
 * the month closes after it ends, never reopens; an office assumes presence.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import { closeBlocks, compactExceptions, dueDays, employeeMonth, isRestDay, missingDays, sheetBlocks, type WorkplaceMonth } from "@/lib/hr/attendance"
import { closeMonth, declareMissing, recordDay } from "@/lib/hr/attendance-writes"
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
    await expect(declareMissing(db, payroll, ORG, SITE, "2026-08", actor, { days: ["2026-08-03"], note: "n", employees: ["a"] }, { today: "2026-08-05" })).rejects.toMatchObject({ code: "no_role" })
  })

  it("no close with an unrecorded day; a named declaration fills it; the month never reopens", async () => {
    await recordDay(db, sup, ORG, SITE, "2026-08-01", actor, { listed: ["a"], ex: {} }, { today: "2026-08-01" })
    await expect(closeMonth(db, sup, ORG, SITE, "2026-08", actor, "block", { today: "2026-09-01" })).rejects.toMatchObject({ blocks: ["missing"] })
    const missing = missingDays(wm("s1"), "2026-08", "2026-09-01", { assumed: false })
    expect(missing).toHaveLength(26)
    await expect(declareMissing(db, sup, ORG, SITE, "2026-08", actor, { days: missing, note: " ", employees: ["a"] }, { today: "2026-09-01" })).rejects.toMatchObject({ blocks: ["no_note"] })
    await declareMissing(db, sup, ORG, SITE, "2026-08", actor, { days: missing, note: "Sheets lost in the rain", employees: ["a"] }, { today: "2026-09-01" })
    expect(wm("s1").declarations[0]).toMatchObject({ byName: "Khalid", note: "Sheets lost in the rain" })
    await closeMonth(db, sup, ORG, SITE, "2026-08", actor, "block", { today: "2026-09-01" })
    expect(wm("s1").closed).toMatchObject({ by: "sup", asIs: false, missing: [] })
    await expect(recordDay(db, sup, ORG, SITE, "2026-08-31", actor, { listed: ["a"], ex: {} }, { today: "2026-09-01" })).rejects.toMatchObject({ blocks: ["closed"] })
    await expect(closeMonth(db, sup, ORG, SITE, "2026-08", actor, "block", { today: "2026-09-02" })).rejects.toBeInstanceOf(HrWriteError)
  })

  it("under the warn policy the month closes as is, the unrecorded days kept on the closing", async () => {
    const r = await closeMonth(db, manager, ORG, SITE, "2026-08", actor, "warn", { today: "2026-09-01" })
    expect(r.asIs).toBe(true)
    expect(wm("s1").closed?.missing).toHaveLength(27)
  })

  it("an office closes with no records at all — presence is assumed", async () => {
    await closeMonth(db, manager, ORG, HQ, "2026-08", actor, "block", { today: "2026-09-01" })
    expect(wm("hq").closed).toMatchObject({ asIs: false, missing: [] })
  })
})
