/**
 * HR 1.0 — the return from leave (AT-05, WF-07 step 6): the return is
 * recorded ("started today"); the days after the leave's end are absence
 * without leave; ten days in a row make the written warning due and fifteen
 * make termination possible under art. 80. The sheet marks someone not back
 * absent until his return is recorded.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import fs from "fs"
import path from "path"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext } from "@/lib/hr/access"
import type { HrEmployee } from "@/lib/hr/employee"
import { recordReturn } from "@/lib/hr/request-writes"
import { leaveReturn, notBackOn, type HrRequest } from "@/lib/hr/requests"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const hrm: HrContext = { uid: "hrm", owner: false, roles: new Set(["manager"]), employeeId: null, sites: [] }
const sup: HrContext = { uid: "sup", owner: false, roles: new Set(["supervisor"]), employeeId: null, sites: ["s1"] }
const otherSup: HrContext = { ...sup, uid: "sup2", sites: ["s9"] }
const who = (c: HrContext) => ({ uid: c.uid, name: c.uid })

const leave = (over: Partial<HrRequest> = {}): HrRequest =>
  ({
    id: "r1",
    organizationId: ORG,
    no: "LV-2026/001",
    kind: "leave",
    employeeId: "e1",
    employeeUserId: null,
    employeeName: "أحمد",
    siteId: "s1",
    lineManagerId: null,
    lineManagerUserId: null,
    deciderLevel: "manager",
    filedBy: { by: "hrm", byName: null, at: "" },
    onBehalf: true,
    state: "approved",
    leave: { type: "annual", from: "2026-09-01", to: "2026-09-10", days: 10, balance: 20, fromBalance: 10, unpaidDays: 0, travel: true },
    createdAt: "",
    ...over,
  }) as HrRequest

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { organizationId: ORG, no: 1, names: { ar: "أحمد" }, siteId: "s1", status: "active", join: "2024-01-01" } as Partial<HrEmployee>)
})

describe("the rule (AT-05, art. 80)", () => {
  it("on leave, due back, late — warning due at 10 days in a row, termination possible at 15", () => {
    expect(leaveReturn(leave(), "2026-09-05")).toBeNull()
    expect(leaveReturn(leave(), "2026-09-11")).toEqual({ daysLate: 1, stage: "due" })
    expect(leaveReturn(leave(), "2026-09-20")).toEqual({ daysLate: 10, stage: "warning" })
    expect(leaveReturn(leave(), "2026-09-25")).toEqual({ daysLate: 15, stage: "termination" })
    expect(leaveReturn(leave({ returned: { on: "2026-09-11", by: "sup", byName: null, at: "", lateDays: 0 } }), "2026-09-25")).toBeNull()
    expect(leaveReturn(leave({ state: "cancelled" }), "2026-09-25")).toBeNull()
  })

  it("the sheet: not back on the days after the leave until the day he returned", () => {
    const r = leave({ returned: { on: "2026-09-14", by: "sup", byName: null, at: "", lateDays: 3 } })
    expect([...notBackOn([r], "2026-09-12")]).toEqual(["e1"])
    expect([...notBackOn([r], "2026-09-14")]).toEqual([])
    expect([...notBackOn([r], "2026-09-10")]).toEqual([])
    expect([...notBackOn([leave()], "2026-09-30")]).toEqual(["e1"])
  })
})

describe("recording the return", () => {
  it("by the site's supervisor: the days after the end are counted late and logged", async () => {
    seed("hrRequests/r1", { ...leave() })
    await expect(recordReturn(db, otherSup, "r1", who(otherSup), { on: "2026-09-14" }, { today: "2026-09-14" })).rejects.toMatchObject({ code: "not_your_site" })
    await expect(recordReturn(db, sup, "r1", who(sup), { on: "2026-09-15" }, { today: "2026-09-14" })).rejects.toMatchObject({ blocks: ["future"] })
    await expect(recordReturn(db, sup, "r1", who(sup), { on: "2026-09-08" }, { today: "2026-09-14" })).rejects.toMatchObject({ blocks: ["before_end"] })
    await recordReturn(db, sup, "r1", who(sup), { on: "2026-09-14" }, { today: "2026-09-14" })
    expect(readDoc<HrRequest>("hrRequests/r1")?.returned).toMatchObject({ on: "2026-09-14", by: "sup", lateDays: 3 })
    expect(listCollection<{ kind: string; params: Record<string, unknown> }>("employees/e1/log")).toEqual([expect.objectContaining({ kind: "leave_returned", params: { no: "LV-2026/001", on: "2026-09-14", late: 3 } })])
    await expect(recordReturn(db, hrm, "r1", who(hrm), { on: "2026-09-14" }, { today: "2026-09-14" })).rejects.toMatchObject({ blocks: ["stale"] })
  })

  it("on time is the day after the leave's end — no late days", async () => {
    seed("hrRequests/r1", { ...leave() })
    await recordReturn(db, hrm, "r1", who(hrm), { on: "2026-09-11" }, { today: "2026-09-20" })
    expect(readDoc<HrRequest>("hrRequests/r1")?.returned).toMatchObject({ lateDays: 0 })
  })

  it("the rules let the site's supervisor or the HR manager write the return once, and nothing else", () => {
    const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8")
    const block = rules.slice(rules.indexOf("match /hrRequests/{requestId}"), rules.indexOf("match /hrCounters/{orgId}"))
    expect(block).toMatch(/changedKeys\(\)\.hasOnly\(\['returned', 'updatedAt'\]\)\s*&& !\('returned' in resource\.data\)/)
    expect(block).toMatch(/hrManager\(\) \|\| \(resource\.data\.get\('siteId', null\) is string && hrSupervises\(resource\.data\.siteId\)\)/)
  })
})
