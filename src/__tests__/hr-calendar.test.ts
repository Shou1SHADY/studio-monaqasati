/**
 * HR 1.0 — the calendar (LV-02, AT-06, WF-05; §17 "Riyadh time; the public
 * holidays are a yearly table"): a holiday inside a leave is not counted, a
 * holiday is not an unrecorded day on a workplace's sheet, and "today" is the
 * day in Riyadh — not the UTC day, which reads 00:00–03:00 as yesterday.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext } from "@/lib/hr/access"
import { dueDays, missingDays } from "@/lib/hr/attendance"
import { closeMonth } from "@/lib/hr/attendance-writes"
import { riyadhDay } from "@/lib/hr/format"
import { holidayOn, isRamadan, publicHolidays } from "@/lib/hr/holidays"
import { leaveDays } from "@/lib/hr/leave"
import { leaveDaysInMonth } from "@/lib/hr/payroll"
import { leaveQuote, type HrRequest } from "@/lib/hr/requests"
import type { HrEmployee } from "@/lib/hr/employee"

const db = fakeFirestore as unknown as Firestore

beforeEach(() => resetFakeDb())

describe("the official holidays (art. 112 implementing regulations, Umm al-Qura)", () => {
  it("2026: Founding Day, Eid al-Fitr from the day after 29 Ramadan, Eid al-Adha from Arafah, National Day", () => {
    expect(publicHolidays(2026)).toEqual([
      { key: "founding", from: "2026-02-22", days: 1 },
      { key: "fitr", from: "2026-03-19", days: 4 },
      { key: "adha", from: "2026-05-26", days: 4 },
      { key: "national", from: "2026-09-23", days: 1 },
    ])
    expect(holidayOn("2026-03-22")).toMatchObject({ from: "2026-03-19" })
    expect(holidayOn("2026-03-23")).toBeNull()
    expect(isRamadan("2026-03-01")).toBe(true)
    expect(isRamadan("2026-03-20")).toBe(false)
  })

  it("a leave over Eid counts its working days only — with no calendar passed in (LV-02)", () => {
    expect(leaveDays("2026-03-15", "2026-03-28")).toBe(10)
    const emp: Pick<HrEmployee, "join" | "gender" | "hajjTaken" | "leaveTaken" | "openingLeave" | "sick" | "docs" | "nationality"> = {
      join: "2020-01-01",
      gender: "m",
      leaveTaken: 0,
      docs: {},
      nationality: "sa",
    }
    expect(leaveQuote(emp, { type: "annual", from: "2026-09-20", to: "2026-09-26" }).days).toBe(6)
  })

  it("payroll counts an unpaid leave's days the way the request did — Eid is not docked", () => {
    const r = { id: "r", employeeId: "e1", kind: "leave", state: "approved", leave: { type: "unpaid", from: "2026-03-16", to: "2026-03-24", days: 5, unpaidDays: 5, fromBalance: 0 } } as unknown as HrRequest
    expect(leaveDaysInMonth([r], "e1", "2026-03").unpaid).toEqual(["2026-03-16", "2026-03-17", "2026-03-18", "2026-03-23", "2026-03-24"])
  })

  it("a holiday is not an unrecorded day on the sheet (WF-05)", () => {
    const due = dueDays("2026-03", "2026-04-02")
    expect(due).not.toContain("2026-03-19")
    expect(due).not.toContain("2026-03-21")
    expect(missingDays(null, "2026-09", "2026-10-01", { assumed: false })).not.toContain("2026-09-23")
  })

  it("a month with Eid closes once its working days are recorded", async () => {
    const days: Record<string, unknown> = {}
    for (const d of dueDays("2026-03", "2026-04-02", [])) if (!holidayOn(d)) days[d] = { by: "sup", byName: null, at: "", listed: [], ex: {} }
    seed("hrAttendance/org__s1__2026-03", { organizationId: "org", siteId: "s1", month: "2026-03", days, declarations: [], closed: null })
    const sup: HrContext = { uid: "sup", owner: false, roles: new Set(["supervisor"]), employeeId: null, sites: ["s1"] }
    await expect(closeMonth(db, sup, "org", { id: "s1", type: "project" }, "2026-03", { uid: "sup", name: null }, "block", { today: "2026-04-02" })).resolves.toEqual({ asIs: false })
  })
})

describe("today is the day in Riyadh", () => {
  it("00:00–03:00 Riyadh is still the UTC day before — but it is today in Riyadh", () => {
    expect(riyadhDay(new Date("2026-10-03T22:30:00Z"))).toBe("2026-10-04")
    expect(riyadhDay(new Date("2026-10-04T20:59:00Z"))).toBe("2026-10-04")
    expect(riyadhDay(new Date("2026-10-04T21:00:00Z"))).toBe("2026-10-05")
  })
})
