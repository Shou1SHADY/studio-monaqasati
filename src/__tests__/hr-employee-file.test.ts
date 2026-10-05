/**
 * HR 1.0 — the employee file's parity with Prototype-HR-v11 (slices 2 and 8):
 * the documents a person holds (and their numbers, inside `docs`), the
 * contract's end as a document date and its renew / do-not-renew decision,
 * the line manager (set, derived down the prototype's chain) and his
 * probation view, a move checked on its day (licence, iqama), dated ahead,
 * answering his open corrections and telling Projects, a raise asked for and
 * decided as the pay change — the HR manager's own by management — and the
 * facts the file and the list show.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import { bankOfIban, docRows, docsOf, worstDoc } from "@/lib/hr/documents"
import {
  assignBlocks,
  contractBlocks,
  leaveDaysIn,
  lineManagerBlocks,
  lineManagerChain,
  newEmployeeBlocks,
  nextDue,
  payChangeRefusal,
  sickBand,
  statusFact,
  thirtyDaysFrom,
  todayStateOf,
  type EmployeePay,
  type HrEmployee,
} from "@/lib/hr/employee"
import {
  applyDueMoves,
  assignEmployee,
  changePay,
  createEmployee,
  endContract,
  recordDocNumbers,
  recordProbationView,
  recordRenewal,
  renewContract,
  setLineManager,
} from "@/lib/hr/employee-writes"
import { todayDay } from "@/lib/hr/format"
import { recordInjury } from "@/lib/hr/injuries"
import { decideRequest, fileRequest } from "@/lib/hr/request-writes"
import { requestActions, type HrRequest } from "@/lib/hr/requests"
import { addDays } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { DEFAULT_HR_POLICIES } from "@/lib/hr/statutory"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const TODAY = todayDay()
const d = (n: number) => addDays(TODAY, n)
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e_hrm" })
const mgmt = ctx(["management"], { uid: "mg", employeeId: "e_mg" })
const actor = { uid: "hrm", name: "Sara" }

const person = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({
    id,
    organizationId: ORG,
    no: 10,
    names: { ar: `موظف ${id}`, en: `Employee ${id}` },
    nationality: "eg",
    gender: "m",
    idNo: "2123456789",
    trade: "mason",
    category: "labour",
    siteId: "s1",
    join: "2024-01-01",
    source: "local",
    contract: { type: "open" },
    probation: { end: "2024-03-30", decision: "confirmed" },
    status: "active",
    docs: { iqama: d(300), passport: d(700) },
    leaveTaken: 0,
    ...over,
  }) as HrEmployee
const put = (e: HrEmployee) => seed(`employees/${e.id}`, e as unknown as Record<string, unknown>)
const emp = (id: string) => readDoc<HrEmployee>(`employees/${id}`) as HrEmployee
const logOf = (id: string) => listCollection<{ kind: string; params: Record<string, unknown> }>(`employees/${id}/log`)
const blocked = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e instanceof HrWriteError ? (e.blocks[0] ?? e.code) : String(e)
  }
  return "no error"
}

beforeEach(() => resetFakeDb())

describe("documents a person holds (DC-01, the prototype's docs(e))", () => {
  it("no iqama for a Saudi, a licence only for a driver, the contract from the contract", () => {
    const types = (e: HrEmployee) => docRows(e, TODAY).map((r) => r.type)
    expect(types(person("a", { nationality: "sa" }))).toEqual(["passport", "insurance", "contract"])
    expect(types(person("b"))).toEqual(["iqama", "passport", "insurance", "contract"])
    expect(types(person("c", { trade: "driver" }))).toEqual(["iqama", "passport", "insurance", "contract", "licence"])
    expect(types(person("f", { trade: "forklift" }))).toContain("forklift")
    // Open-ended: nothing expires. Fixed: the contract's end — even where only `contract.end` was ever written.
    expect(docRows(person("o"), TODAY).find((r) => r.type === "contract")).toMatchObject({ open: true, state: "valid" })
    const fixed = person("x", { contract: { type: "fixed", end: d(20) } })
    expect(docRows(fixed, TODAY).find((r) => r.type === "contract")).toMatchObject({ expiry: d(20), state: "d30" })
    expect(docsOf(fixed).contract).toBe(d(20))
  })

  it("a visa arrival's iqama not issued yet: due within 90 days, expired after (DC-05)", () => {
    const arrival = person("v", { source: "visa", join: d(-10), docs: {} })
    expect(docRows(arrival, TODAY)[0]).toMatchObject({ type: "iqama", expiry: null, state: "d60", pendingDue: addDays(d(-10), 90) })
    expect(docRows(person("w", { source: "visa", join: d(-100), docs: {} }), TODAY)[0].state).toBe("expired")
  })

  it("worst first: expired over within 30 over the window; all in order reads as none", () => {
    expect(worstDoc(docRows(person("a", { docs: { iqama: d(20), passport: d(-1) } }), TODAY))?.type).toBe("passport")
    expect(worstDoc(docRows(person("a"), TODAY))).toBeNull()
  })

  it("the bank is the IBAN's code (PY-07)", () => {
    expect(bankOfIban("SA03 8000 0000 6080 1016 7519")).toBe("80")
    expect(bankOfIban("SA12345")).toBeNull()
  })
})

describe("the line manager (RL-04, the prototype's mgrOf)", () => {
  const sup = person("sup", { trade: "foreman", category: "staff" })
  const eng = person("eng", { trade: "siteEngineer", category: "staff", join: "2020-01-01" })
  const qs = person("qs", { trade: "quantitySurveyor", category: "staff" })
  const worker = person("w")
  const all = [sup, eng, qs, worker]
  const supervisorOf = (s: string) => (s === "s1" ? "sup" : null)

  it("set on the card wins; labour → the site's supervisor → a foreman; staff → the senior staff; the head himself → management", () => {
    expect(lineManagerChain({ ...worker, managerId: "qs" }, { employees: all, supervisorOf })).toEqual({ id: "qs", via: "explicit", derived: false })
    expect(lineManagerChain(worker, { employees: all, supervisorOf })).toEqual({ id: "sup", via: "supervisor", derived: true })
    expect(lineManagerChain(worker, { employees: all, supervisorOf: () => null })).toEqual({ id: "sup", via: "foreman", derived: true })
    // Staff answer to the senior staff member of the place (by the trade's reference wage, never a person's pay).
    expect(lineManagerChain(qs, { employees: all, supervisorOf })).toEqual({ id: "eng", via: "senior", derived: true })
    expect(lineManagerChain(eng, { employees: all, supervisorOf })).toEqual({ id: null, via: "management", derived: true })
    // A manager set but gone: derived again. The HR manager's own: management. Unassigned: management.
    expect(lineManagerChain({ ...worker, managerId: "gone" }, { employees: [...all, person("gone", { status: "left" })], supervisorOf }).via).toBe("supervisor")
    expect(lineManagerChain(qs, { employees: all, supervisorOf, isHrManager: true }).via).toBe("management")
    expect(lineManagerChain({ ...worker, siteId: null }, { employees: all, supervisorOf }).via).toBe("management")
  })

  it("never himself, never someone gone, never a circle", () => {
    expect(lineManagerBlocks(worker, "w", all)).toContain("self")
    expect(lineManagerBlocks(worker, "gone", [...all, person("gone", { status: "left" })])).toEqual(["not_active"])
    expect(lineManagerBlocks({ ...qs }, "eng", [{ ...eng, managerId: "qs" }])).toEqual(["circular"])
    expect(lineManagerBlocks({ ...worker, managerId: "qs" }, "qs", all)).toEqual(["same"])
  })

  it("setLineManager writes it and logs it; refuses himself", async () => {
    all.forEach(put)
    await setLineManager(db, hrm, "w", actor, "qs")
    expect(emp("w").managerId).toBe("qs")
    expect(logOf("w").map((l) => l.kind)).toEqual(["manager_set"])
    expect(await blocked(setLineManager(db, hrm, "w", actor, "w"))).toBe("self")
    expect(await blocked(setLineManager(db, ctx(["gov"]), "w", actor, "eng"))).toBe("no_role")
  })
})

describe("the line manager's probation view (EM-05) — attached, never blocking", () => {
  const onProbation = person("new", { join: d(-30), probation: { end: d(60) }, managerId: "boss" })
  beforeEach(() => {
    put(onProbation)
    put(person("boss", { userId: "bossUser", trade: "siteEngineer", category: "staff" }))
    seed("hrSites/s1", { organizationId: ORG, name: "Tower", type: "project", supervisorUserId: "supUser", active: true })
    seed(`users/hrm`, { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_hr" })
    seed("teamGroups/g_hr", { organizationId: ORG, permissions: ["employees.manage"] })
  })

  it("the manager on the card writes it; the HR manager is told", async () => {
    await recordProbationView(db, ctx([], { uid: "bossUser" }), "new", { uid: "bossUser", name: "Boss" }, { rating: 2, recommend: "extend", note: "slow start" })
    expect(emp("new").probationView).toMatchObject({ by: "bossUser", rating: 2, recommend: "extend", note: "slow start" })
    // Its own field: the probation itself is untouched (the rules let him write probationView only).
    expect(emp("new").probation).toEqual(onProbation.probation)
    expect(listCollection<{ type: string }>("users/hrm/notifications").map((n) => n.type)).toEqual(["hr_probation_view"])
    // A line manager with no HR role writes no log entry (the rules refuse it) — the view names him.
    expect(logOf("new")).toEqual([])
  })

  it("the workplace's supervisor may; someone else may not; nor once the probation is over", async () => {
    await recordProbationView(db, ctx(["supervisor"], { uid: "supUser", sites: ["s1"] }), "new", { uid: "supUser", name: "S" }, { rating: 3, recommend: "confirm" })
    expect(emp("new").probationView?.recommend).toBe("confirm")
    expect(await blocked(recordProbationView(db, ctx([], { uid: "stranger" }), "new", actor, { rating: 3, recommend: "confirm" }))).toBe("no_role")
    put(person("old"))
    expect(await blocked(recordProbationView(db, hrm, "old", actor, { rating: 3, recommend: "confirm" }))).toBe("not_on")
    expect(await blocked(recordProbationView(db, hrm, "new", actor, { rating: null, recommend: "confirm" }))).toBe("no_rating")
  })
})

describe("the contract's end (EX-01, the prototype's ct form)", () => {
  it("a new fixed-term contract records its end as a document date", async () => {
    await createEmployee(db, hrm, ORG, actor, {
      source: "local",
      nameAr: "سالم",
      nameEn: "Salem",
      nationality: "sa",
      gender: "m",
      trade: "accountant",
      siteId: null,
      join: TODAY,
      contractType: "fixed",
      contractEnd: d(365),
      basic: 8000,
      docs: { passport: d(900), no: { passport: " P123 ", insurance: "", licence: null } },
      education: "BSc Accounting",
      iban: "SA03 8000 0000 6080 1016 7519",
      bank: null,
    })
    const e = listCollection<HrEmployee>("employees")[0]
    expect(e.docs).toMatchObject({ contract: d(365), passport: d(900), no: { passport: "P123" } })
    expect(e.education).toBe("BSc Accounting")
    expect(listCollection<EmployeePay>("employeePay")[0]).toMatchObject({ iban: "SA0380000000608010167519", ibanState: "ok" })
  })

  it("a malformed IBAN is refused; the form asks the passport name and a well-formed ID", () => {
    const input = { source: "local" as const, nameAr: "أ", nameEn: "", nationality: "eg", gender: "m" as const, idNo: "1234", trade: "mason", siteId: null, join: TODAY, contractType: "open" as const, basic: 2000, docs: {}, iban: "SA12" }
    expect(newEmployeeBlocks(input, { visas: 1, today: TODAY }).blocks).toEqual(["bad_iban"])
    expect(newEmployeeBlocks(input, { visas: 1, today: TODAY, form: true }).blocks).toEqual(["no_name_en", "bad_id", "bad_iban"])
    expect(newEmployeeBlocks({ ...input, nameEn: "A", idNo: "2123456789", iban: "" }, { visas: 1, today: TODAY, form: true }).blocks).toEqual([])
  })

  it("renew moves contract.end and its document date together; do-not-renew starts the exit on the contract's end", async () => {
    put(person("f", { contract: { type: "fixed", end: d(30) }, docs: { iqama: d(300), contract: d(30) } }))
    expect(contractBlocks(emp("f"), "renew", d(10))).toEqual(["not_later"])
    await renewContract(db, hrm, "f", actor, { until: d(760) })
    expect(emp("f").contract.end).toBe(d(760))
    expect(emp("f").docs.contract).toBe(d(760))
    expect(logOf("f").map((l) => l.kind)).toEqual(["contract_renewed"])
    put(person("g", { contract: { type: "fixed", end: d(30) } }))
    await endContract(db, hrm, "g", actor)
    expect(emp("g")).toMatchObject({ status: "leaving", lastDay: d(30) })
    expect(readDoc<{ reason: string }>(`hrExits/${ORG}__g`)?.reason).toBe("contract_end")
    expect(await blocked(renewContract(db, hrm, "g", actor, { until: d(900) }))).toBe("left")
    put(person("o"))
    expect(await blocked(endContract(db, hrm, "o", actor))).toBe("not_fixed")
  })

  it("a contract is never 'renewed' as a document — that would leave contract.end behind (the old bug)", async () => {
    put(person("f", { contract: { type: "fixed", end: d(30) } }))
    expect(await blocked(recordRenewal(db, hrm, "f", actor, { type: "contract", expiry: d(400) }))).toBe("contract")
    expect(emp("f").contract.end).toBe(d(30))
  })
})

describe("renewals and numbers stay inside `docs` (government relations' rule: docs and nothing else)", () => {
  const changedKeys = (before: Record<string, unknown>, after: Record<string, unknown>) =>
    Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))

  it("an iqama renewed with its insurance, a passport with its number", async () => {
    const gov = ctx(["gov"], { uid: "gro" })
    put(person("r", { docs: { iqama: d(10), passport: d(900), insurance: d(5) } }))
    const before = emp("r") as unknown as Record<string, unknown>
    await recordRenewal(db, gov, "r", actor, { type: "iqama", expiry: d(375), insuranceToo: true })
    await recordRenewal(db, gov, "r", actor, { type: "passport", expiry: d(1900), number: "A9988" })
    const after = emp("r") as unknown as Record<string, unknown>
    expect(changedKeys(before, after).sort()).toEqual(["docs", "updatedAt"])
    expect(emp("r").docs).toMatchObject({ iqama: d(375), insurance: d(375), passport: d(1900), no: { passport: "A9988" } })
    await recordDocNumbers(db, gov, "r", actor, { insurance: "POL-1", gosi: "53-700010" })
    expect(emp("r").docs.no).toEqual({ passport: "A9988", insurance: "POL-1", gosi: "53-700010" })
    expect(changedKeys(before, emp("r") as unknown as Record<string, unknown>).sort()).toEqual(["docs", "updatedAt"])
    expect(await blocked(recordDocNumbers(db, gov, "r", actor, { gosi: "53-700010" }))).toBe("no_change")
  })
})

describe("a move (AS-01, AS-03, DC-06)", () => {
  beforeEach(() => {
    seed("hrSites/s1", { organizationId: ORG, name: "Tower", type: "project", projectId: "p1", active: true })
    seed("hrSites/s2", { organizationId: ORG, name: "Mall", type: "project", projectId: "p2", active: true })
    seed("hrSites/hq", { organizationId: ORG, name: "HQ", type: "hq", active: true })
    seed("projects/p2", { organizationId: ORG, projectManagerId: "pmUser" })
  })

  it("a driver with an expired licence is not moved to driving work — checked on the day the move takes effect", () => {
    const driver = person("drv", { trade: "driver", docs: { iqama: d(300), licence: d(5) } })
    expect(assignBlocks(driver, "s2", TODAY, TODAY, { type: "project" })).toEqual([])
    expect(assignBlocks(driver, "s2", d(10), TODAY, { type: "project" })).toEqual(["licence_expired"])
    expect(assignBlocks({ ...driver, docs: { licence: d(-1) } }, "hq", TODAY, TODAY, { type: "hq" })).toEqual([])
    expect(assignBlocks({ ...driver, docs: { licence: d(-1) } }, null, TODAY, TODAY)).toEqual([])
    expect(assignBlocks(person("m", { docs: { iqama: d(300) } }), "s2", TODAY, TODAY, { type: "project" })).toEqual([])
  })

  it("from today: moves now, answers his open corrections, tells the project's manager", async () => {
    put(person("w"))
    seed("hrAssignFixes/f1", { organizationId: ORG, employeeId: "w", siteId: "s2", fromSiteId: "s1", since: d(-3), state: "pending", by: "sup", employeeName: "w" })
    seed("hrAssignFixes/f2", { organizationId: ORG, employeeId: "w", siteId: "hq", fromSiteId: "s1", since: d(-3), state: "pending", by: "sup", employeeName: "w" })
    await assignEmployee(db, hrm, "w", actor, { siteId: "s2", effectiveOn: TODAY, manpowerRequestId: "mr1" })
    expect(emp("w")).toMatchObject({ siteId: "s2", siteSince: TODAY })
    expect(readDoc<{ state: string }>("hrAssignFixes/f1")?.state).toBe("done")
    expect(readDoc<{ state: string }>("hrAssignFixes/f2")?.state).toBe("declined")
    expect(logOf("w")[0]).toMatchObject({ kind: "moved", params: { to: "s2", mr: "mr1" } })
    expect(listCollection<{ type: string }>("users/pmUser/notifications").map((n) => n.type)).toEqual(["hr_assigned_to_project"])
  })

  it("dated ahead: he keeps his place until the day, then the move applies", async () => {
    put(person("w"))
    const r = await assignEmployee(db, hrm, "w", actor, { siteId: "hq", effectiveOn: d(5) })
    expect(r.scheduled).toBe(true)
    expect(emp("w")).toMatchObject({ siteId: "s1", move: { to: "hq", on: d(5) } })
    expect(await applyDueMoves(db, hrm, actor, [emp("w")], { today: d(4) })).toBe(0)
    expect(await applyDueMoves(db, hrm, actor, [emp("w")], { today: d(5) })).toBe(1)
    expect(emp("w")).toMatchObject({ siteId: "hq", siteSince: d(5), move: null })
    expect(logOf("w").map((l) => l.kind).sort()).toEqual(["move_scheduled", "moved"])
  })
})

describe("a raise asked for, decided as the pay change (EM-04); the HR manager's pay is management's (RL-02)", () => {
  beforeEach(() => {
    put(person("e_hrm", { userId: "hrm", trade: "hrOfficer", category: "staff", nationality: "sa", siteId: "hq" }))
    put(person("w"))
    seed("employeePay/e_hrm", { organizationId: ORG, employeeId: "e_hrm", basic: 10_000, housing: 2_500, transport: 1_000 })
    seed("employeePay/w", { organizationId: ORG, employeeId: "w", basic: 2_000, housing: 500, transport: 200 })
    seed("users/hrm", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_hr" })
    seed("teamGroups/g_hr", { organizationId: ORG, permissions: ["employees.manage"] })
    seed("users/mg", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_mg" })
    seed("teamGroups/g_mg", { organizationId: ORG, permissions: ["hr.management"] })
  })

  it("who changes whose pay", () => {
    expect(payChangeRefusal(hrm, { own: true, isHrManager: true })).toBe("own_request")
    expect(payChangeRefusal(mgmt, { own: false, isHrManager: true })).toBeNull()
    expect(payChangeRefusal(mgmt, { own: false, isHrManager: false })).toBe("no_role")
    expect(payChangeRefusal(hrm, { own: false, isHrManager: false })).toBeNull()
  })

  it("management changes the HR manager's pay — never a worker's, never the trade", async () => {
    await changePay(db, mgmt, "e_hrm", { uid: "mg", name: "GM" }, { basic: 11_000, effectiveOn: TODAY, reason: "annual review", kind: "raise" })
    expect(readDoc<EmployeePay>("employeePay/e_hrm")?.basic).toBe(11_000)
    // The step names its kind, why and who (the file's pay history) — the log never an amount.
    expect(readDoc<EmployeePay>("employeePay/e_hrm")?.steps?.find((s) => s.from === TODAY)).toMatchObject({ kind: "raise", reason: "annual review", byName: "GM" })
    expect(await blocked(changePay(db, mgmt, "w", { uid: "mg", name: "GM" }, { basic: 2_500, effectiveOn: TODAY, reason: "x", kind: "raise" }))).toBe("no_role")
    expect(await blocked(changePay(db, mgmt, "e_hrm", { uid: "mg", name: "GM" }, { basic: 12_000, effectiveOn: TODAY, reason: "x", kind: "promotion", trade: "manager" }))).toBe("no_role")
    expect(await blocked(changePay(db, hrm, "e_hrm", actor, { basic: 12_000, effectiveOn: TODAY, reason: "x", kind: "raise" }))).toBe("own_request")
  })

  it("the HR manager asks for his own raise; it goes to management, who approves it as the change", async () => {
    const { id, no } = await fileRequest(db, hrm, ORG, actor, { employeeId: "e_hrm", kind: "raise", raise: { basic: 11_500, kind: "raise", effectiveOn: TODAY, reason: "market rate" } }, { policies: DEFAULT_HR_POLICIES })
    expect(no).toMatch(/^RS-\d{4}\/\d+/)
    const r = readDoc<HrRequest>(`hrRequests/${id}`) as HrRequest
    expect(r).toMatchObject({ kind: "raise", deciderLevel: "management", state: "pending", raise: { basic: 11_500 } })
    // Approved only as the pay change: the list offers decline alone, and decideRequest refuses an approval.
    expect(requestActions(mgmt, { ...r, id }, { today: TODAY, financeAllowed: false })).toEqual(["decline"])
    expect(await blocked(decideRequest(db, mgmt, id, { uid: "mg", name: "GM" }, "approve", "", { policies: DEFAULT_HR_POLICIES }))).toBe("raise_via_pay")
    // The HR manager may not decide it — not even through the pay change.
    expect(await blocked(changePay(db, ctx(["manager"], { uid: "hrm2" }), "e_hrm", actor, { basic: 11_500, effectiveOn: TODAY, reason: "market rate", kind: "raise" }, { requestId: id }))).toBe("no_role")
    await changePay(db, mgmt, "e_hrm", { uid: "mg", name: "GM" }, { basic: 11_500, effectiveOn: TODAY, reason: "market rate", kind: "raise" }, { requestId: id })
    expect(readDoc<HrRequest>(`hrRequests/${id}`)).toMatchObject({ state: "approved", decision: { by: "mg" } })
    expect(readDoc<EmployeePay>("employeePay/e_hrm")?.basic).toBe(11_500)
    expect(logOf("e_hrm").map((l) => l.kind)).toEqual(expect.arrayContaining(["raise_filed", "pay_changed", "raise_approved"]))
  })

  it("a raise request refuses no change and a missing reason", async () => {
    expect(await blocked(fileRequest(db, hrm, ORG, actor, { employeeId: "w", kind: "raise", raise: { basic: 2_000, kind: "raise", effectiveOn: TODAY, reason: "x" } }, { policies: DEFAULT_HR_POLICIES }))).toBe("no_change")
    expect(await blocked(fileRequest(db, hrm, ORG, actor, { employeeId: "w", kind: "raise", raise: { basic: 2_400, kind: "raise", effectiveOn: TODAY, reason: " " } }, { policies: DEFAULT_HR_POLICIES }))).toBe("no_reason")
  })
})

describe("a work injury (DC-07)", () => {
  it("government relations records it, as the prototype lets hr and gov (owner default 4)", async () => {
    put(person("w"))
    const id = await recordInjury(db, ctx(["gov"], { uid: "gro" }), ORG, { uid: "gro", name: "G" }, { employeeId: "w", on: TODAY, description: "fell from a ladder" })
    expect(readDoc<{ recorded: { by: string } }>(`hrInjuries/${id}`)?.recorded.by).toBe("gro")
    expect(await blocked(recordInjury(db, ctx(["payroll"], { uid: "po" }), ORG, actor, { employeeId: "w", on: TODAY, description: "x" }))).toBe("no_role")
  })
})

describe("what the file and the list say (the prototype's stPill, nextDue, efAtt)", () => {
  it("status facts with their dates", () => {
    expect(statusFact(person("a", { status: "leaving", lastDay: d(9) }), {})).toEqual({ kind: "leaving", date: d(9) })
    expect(statusFact(person("a"), { leaveTo: d(4) })).toEqual({ kind: "leave", date: d(4) })
    expect(statusFact(person("a", { siteId: null, siteSince: d(-20) }), {})).toEqual({ kind: "unassigned", date: d(-20) })
    expect(statusFact(person("a"), { today: "absent" })).toEqual({ kind: "absent" })
    expect(statusFact(person("a"), {})).toBeNull()
    expect(todayStateOf("a", { listed: ["a"], ex: { a: { status: "sick" } } }, false)).toBe("sick")
    expect(todayStateOf("a", { listed: ["a"], ex: {} }, false)).toBe("present")
    expect(todayStateOf("a", undefined, false)).toBe("unrecorded")
    expect(todayStateOf("a", undefined, true)).toBe("leave")
  })

  it("next: the probation's end or the nearest document not yet expired", () => {
    const p = person("a", { probation: { end: d(10) }, docs: { iqama: d(5), passport: d(-3) } })
    expect(nextDue(p, docRows(p, TODAY), TODAY)).toEqual({ what: "iqama", date: d(5) })
    const q = person("b", { probation: { end: d(3) }, docs: { iqama: d(50) } })
    expect(nextDue(q, docRows(q, TODAY), TODAY)).toEqual({ what: "probation", date: d(3) })
  })

  it("leave days in a month, art. 117's band, the day leave becomes 30", () => {
    const reqs = [{ kind: "leave", state: "approved", leave: { from: "2026-03-28", to: "2026-04-03" } }, { kind: "leave", state: "declined", leave: { from: "2026-04-10", to: "2026-04-12" } }]
    expect(leaveDaysIn(reqs, "2026-04")).toBe(3)
    expect(leaveDaysIn(reqs, "2026-03")).toBe(4)
    expect([0, 30, 31, 90, 91, 120, 121].map(sickBand)).toEqual(["full", "full", "threeQuarters", "threeQuarters", "unpaid", "unpaid", "beyond"])
    expect(thirtyDaysFrom("2022-05-09")).toBe("2027-05-09")
  })
})
