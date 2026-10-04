/**
 * HR 1.0 — "opening balance" from the card (IM-04, WF-02 step 6): for one
 * employee who joined before the system, the HR manager enters once the leave
 * balance as of today (at most what could have accrued) and the outstanding
 * advance; the balance then reads back exactly that, and the log names the
 * act, never an amount.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext } from "@/lib/hr/access"
import { openingBlocks, type EmployeePay, type HrEmployee } from "@/lib/hr/employee"
import { recordOpeningBalance } from "@/lib/hr/employee-writes"
import { leaveBalance } from "@/lib/hr/leave"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const hrm: HrContext = { uid: "hrm", owner: false, roles: new Set(["manager"]), employeeId: null, sites: [] }
const gov: HrContext = { ...hrm, uid: "gro", roles: new Set(["gov"]) }
const actor = { uid: "hrm", name: "Sara" }
const TODAY = "2026-10-05"

const veteran: Omit<HrEmployee, "id"> = {
  organizationId: ORG,
  no: 4,
  names: { ar: "سالم" },
  nationality: "eg",
  gender: "m",
  trade: "mason",
  category: "labour",
  siteId: "s1",
  join: "2022-04-17",
  source: "local",
  contract: { type: "open" },
  probation: { end: "2022-07-15", decision: null },
  status: "active",
  docs: {},
  leaveTaken: 0,
}

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { ...veteran })
  seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 3_000, housing: 750, transport: 300, advance: null })
})

describe("the rule", () => {
  it("once, for someone who joined over 30 days ago and took no leave here, at most what could accrue", () => {
    expect(openingBlocks(veteran, { leave: 12, advance: 0 }, null, TODAY)).toEqual([])
    expect(openingBlocks(veteran, { leave: 200, advance: 0 }, null, TODAY)).toEqual(["above_accrued"])
    expect(openingBlocks(veteran, { leave: -1, advance: 0 }, null, TODAY)).toEqual(["bad_leave"])
    expect(openingBlocks({ ...veteran, join: "2026-09-20" }, { leave: 0, advance: 0 }, null, TODAY)).toEqual(["too_recent"])
    expect(openingBlocks({ ...veteran, opening: { leave: 3, at: "", by: "x", byName: null } }, { leave: 1, advance: 0 }, null, TODAY)).toEqual(["recorded"])
    expect(openingBlocks({ ...veteran, leaveTaken: 5 }, { leave: 1, advance: 0 }, null, TODAY)).toEqual(["leave_taken"])
    const owing = { basic: 3_000, housing: 750, transport: 300, advance: { amount: 900, balance: 600, instalment: 405 } } as Pick<EmployeePay, "basic" | "housing" | "transport" | "advance">
    expect(openingBlocks(veteran, { leave: 1, advance: 500 }, owing, TODAY)).toEqual(["advance_exists"])
  })
})

describe("the write", () => {
  it("the balance reads back exactly what was entered; the advance lands on pay; the log has no amount", async () => {
    await expect(recordOpeningBalance(db, gov, "e1", actor, { leave: 12, advance: 0 }, { today: TODAY })).rejects.toMatchObject({ code: "no_role" })
    await recordOpeningBalance(db, hrm, "e1", actor, { leave: 9, advance: 1_200 }, { today: TODAY })
    const e = readDoc<HrEmployee>("employees/e1") as HrEmployee
    expect(leaveBalance(e.join, TODAY, e.leaveTaken, e.openingLeave ?? 0)).toBe(9)
    expect(e.opening).toMatchObject({ leave: 9, by: "hrm" })
    expect(readDoc<EmployeePay>("employeePay/e1")?.advance).toEqual({ amount: 1_200, balance: 1_200, instalment: 405 })
    const log = listCollection<{ kind: string; params: Record<string, unknown> }>("employees/e1/log")
    expect(log).toEqual([expect.objectContaining({ kind: "opening_recorded", params: { leave: 9, advance: 1 } })])
    await expect(recordOpeningBalance(db, hrm, "e1", actor, { leave: 3, advance: 0 }, { today: TODAY })).rejects.toMatchObject({ blocks: ["recorded"] })
  })
})
