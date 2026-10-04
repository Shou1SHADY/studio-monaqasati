/**
 * HR 1.0 — the employee's lifecycle (DC-05, EM-03, EM-05; employee states):
 * an arrival's iqama clock binds the site once its 90 days have run; a
 * promotion never puts a non-Saudi in a Saudi-only trade; "end during
 * probation" starts the exit, and a probation past its end without a decision
 * is over (art. 53) — an imported long-service worker has none open; an
 * expected joiner is at work from his first day.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext } from "@/lib/hr/access"
import { iqamaOverdue, legalOnSite } from "@/lib/hr/documents"
import { assignBlocks, payChangeBlocks, probationBlocks, probationState, statusOn, type HrEmployee } from "@/lib/hr/employee"
import { changePay, decideProbation, startWork } from "@/lib/hr/employee-writes"
import { coverage } from "@/lib/hr/manpower"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const manager: HrContext = { uid: "hrm", owner: false, roles: new Set(["manager"]), employeeId: null, sites: [] }
const actor = { uid: "hrm", name: "Sara" }
const emp = (id: string) => readDoc<HrEmployee>(`employees/${id}`) as HrEmployee

const worker: Omit<HrEmployee, "id"> = {
  organizationId: ORG,
  no: 7,
  names: { ar: "رحيم" },
  nationality: "bd",
  gender: "m",
  trade: "mason",
  category: "labour",
  siteId: "s1",
  join: "2026-06-01",
  source: "visa",
  contract: { type: "open" },
  probation: { end: "2026-08-29", decision: null },
  status: "active",
  docs: { passport: "2030-01-01" },
  leaveTaken: 0,
}

beforeEach(() => resetFakeDb())

describe("an arrival's iqama (DC-05)", () => {
  it("legal on a site for the 90 days after arriving — not one day more without an iqama", () => {
    expect(legalOnSite(worker, "2026-08-30")).toBe(true)
    expect(iqamaOverdue(worker, "2026-08-31")).toBe(true)
    expect(legalOnSite(worker, "2026-08-31")).toBe(false)
    // Issued: the iqama's own date decides again.
    expect(legalOnSite({ ...worker, docs: { iqama: "2027-08-31" } }, "2026-10-01")).toBe(true)
    // Someone who did not arrive on a visa with no date recorded: a blank, not a block.
    expect(legalOnSite({ ...worker, source: "transfer" }, "2026-10-01")).toBe(true)
  })

  it("…so he can only be moved to unassigned, and coverage leaves him out by name", () => {
    expect(assignBlocks({ ...worker, siteId: null }, "s2", "2026-10-01", "2026-10-01")).toEqual(["iqama_expired"])
    const c = coverage({ trade: "mason", count: 1, from: "2026-10-01", today: "2026-10-01", siteId: "s9", employees: [{ ...worker, id: "e1", siteId: null }], sites: [], visas: 0 })
    expect(c.excluded.map((x) => x.reason)).toEqual(["iqama_expired"])
  })
})

describe("a promotion and a Saudi-only trade (EM-03)", () => {
  it("is blocked for a non-Saudi — in the rule and in the write", async () => {
    const input = { basic: 3_000, currentBasic: 2_200, effectiveOn: "2026-10-01", reason: "promoted", nationality: "bd", lastClosedMonthStart: null }
    expect(payChangeBlocks({ ...input, trade: "security" }).blocks).toEqual(["saudi_only"])
    expect(payChangeBlocks({ ...input, trade: "foreman" }).blocks).toEqual([])
    expect(payChangeBlocks({ ...input, nationality: "sa", trade: "security" }).blocks).toEqual([])
    seed("employees/e1", { ...worker, docs: { iqama: "2027-08-31" } })
    seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 2_200, housing: 550, transport: 220 })
    await expect(changePay(db, manager, "e1", actor, { basic: 3_000, effectiveOn: "2026-10-01", reason: "promoted", kind: "promotion", trade: "security" })).rejects.toMatchObject({ blocks: ["saudi_only"] })
    expect(emp("e1").trade).toBe("mason")
  })
})

describe("probation (EM-05, art. 53)", () => {
  it("past its end without a decision it is over — nothing to decide on an imported veteran", () => {
    const veteran = { ...worker, join: "2015-03-01", probation: { end: "2015-05-29", decision: null } }
    expect(probationState(veteran, "2026-10-01")).toBe("lapsed")
    expect(probationState(worker, "2026-08-01")).toBe("on")
    expect(probationState({ ...worker, probation: { end: "2026-08-29", decision: "confirmed" as const } }, "2026-08-01")).toBe("confirmed")
    expect(probationBlocks(veteran, "confirm", {}, "2026-10-01")).toEqual(["over"])
    expect(probationBlocks(worker, "confirm", {}, "2026-08-01")).toEqual([])
  })

  it("ending during probation starts the exit — leaving, last day set, custody asked, no gratuity reason", async () => {
    seed("employees/e1", { ...worker, docs: { iqama: "2027-08-31" } })
    await decideProbation(db, manager, "e1", actor, "end", { lastDay: "2026-08-10" }, { today: "2026-08-01" })
    expect(emp("e1")).toMatchObject({ status: "leaving", lastDay: "2026-08-10", probation: { decision: "ended", decidedOn: "2026-08-01" } })
    expect(readDoc(`hrExits/${ORG}__e1`)).toMatchObject({ reason: "probation", lastDay: "2026-08-10", custody: { state: "requested" } })
    expect(listCollection<{ kind: string }>("employees/e1/log").map((l) => l.kind)).toEqual(expect.arrayContaining(["probation_end", "exit_started"]))
  })

  it("the last day of an end during probation must fall inside it", async () => {
    seed("employees/e1", { ...worker, docs: { iqama: "2027-08-31" } })
    await expect(decideProbation(db, manager, "e1", actor, "end", { lastDay: "2026-09-10" }, { today: "2026-08-01" })).rejects.toMatchObject({ blocks: ["probation_over"] })
    expect(emp("e1").status).toBe("active")
  })
})

describe("an expected joiner (employee states)", () => {
  it("reads at work from his join day; recording the start makes it so on the record", async () => {
    const e = { ...worker, status: "expected" as const, join: "2026-10-04" }
    expect(statusOn(e, "2026-10-03")).toBe("expected")
    expect(statusOn(e, "2026-10-04")).toBe("active")
    seed("employees/e1", e)
    await expect(startWork(db, manager, "e1", actor, { on: "2026-10-06" }, { today: "2026-10-05" })).rejects.toMatchObject({ blocks: ["future"] })
    await startWork(db, manager, "e1", actor, { on: "2026-10-05" }, { today: "2026-10-05" })
    expect(emp("e1")).toMatchObject({ status: "active", join: "2026-10-05", probation: { end: "2027-01-02", decision: null } })
    expect(listCollection<{ kind: string }>("employees/e1/log").map((l) => l.kind)).toEqual(["started"])
    await expect(startWork(db, manager, "e1", actor, { on: "2026-10-05" }, { today: "2026-10-05" })).rejects.toMatchObject({ blocks: ["not_expected"] })
  })
})
