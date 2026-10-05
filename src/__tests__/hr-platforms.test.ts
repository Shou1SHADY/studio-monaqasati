/**
 * HR — government platforms, Nitaqat's what-if and the pre-Mudad check (GV-01…05, PY-08, ST-04; optional
 * features `gov` and `mudad`, package F2). The task list is computed from the record and closes only by a
 * recorded act; a reconciliation compares their report with the record — differences only, never a wage for
 * government relations; the pre-Mudad check lists what Mudad will flag, each justified once.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { changePay } from "@/lib/hr/employee-writes"
import type { HrExit } from "@/lib/hr/exit-writes"
import type { HrInjury } from "@/lib/hr/injuries"
import type { Payroll, PayrollLine } from "@/lib/hr/payroll"
import { preparePayroll } from "@/lib/hr/payroll-writes"
import { justifyMudadFinding, recordMudadStatus, recordPlatformDone, saveReconciliation } from "@/lib/hr/platform-writes"
import {
  documentedBasic,
  mudadFindings,
  nitaqatAfter,
  parseReconCsv,
  platformTasks,
  platformTodayItems,
  reconcile,
  reconTasks,
  taskKey,
  unjustified,
  type GovDoc,
  type PlatformWorld,
} from "@/lib/hr/platforms"
import type { HrRequest } from "@/lib/hr/requests"
import { appendSettingsLog, normalizeHrSettings, nitaqatOf } from "@/lib/hr/settings"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const TODAY = "2026-10-05"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const gov = ctx(["gov"], { uid: "gro" })
const hrm = ctx(["manager"], { uid: "hrm" })
const po = ctx(["payroll"], { uid: "po" })
const mg = ctx(["management"], { uid: "mg" })
const actor = { uid: "gro", name: "Gov" }

const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: ORG, no: Number(id.replace(/\D/g, "")) || 9, names: { ar: `موظف ${id}` }, nationality: "eg", gender: "m", idNo: `2${id.padStart(9, "0").slice(-9)}`, trade: "mason", category: "labour", siteId: "s1", join: "2024-01-01", source: "local", contract: { type: "open" }, probation: { end: "2024-03-31" }, status: "active", docs: { iqama: "2027-06-01", insurance: "2027-06-01" }, leaveTaken: 0, ...over }) as HrEmployee

const world = (over: Partial<PlatformWorld> = {}): PlatformWorld => ({ today: TODAY, employees: [], requests: [], exits: [], injuries: [], payrolls: [], docs: [], switches: null, renewWindowDays: 60, ...over })
const codes = (w: PlatformWorld) => platformTasks(w).map((x) => `${x.pf}:${x.code}`).sort()

describe("GV-02 — the task list is computed from the record", () => {
  it("a joiner: Qiwa contract and GOSI registration in 7 days, a transfer's services in 3, a Saudi's HRDF support (HRDF off by default)", () => {
    const sa = emp("e1", { nationality: "sa", join: "2026-10-01", source: "transfer", docs: {} })
    expect(codes(world({ employees: [sa] }))).toEqual(["gosi:reg", "qiwa:ct", "qiwa:xfer"])
    expect(codes(world({ employees: [sa], switches: { hrdf: true } }))).toContain("hrdf:sup")
    const t = platformTasks(world({ employees: [sa] }))
    expect(t.find((x) => x.code === "ct")?.due).toBe("2026-10-08")
    expect(t.find((x) => x.code === "xfer")?.due).toBe("2026-10-04")
    expect(t.find((x) => x.code === "xfer")?.late).toBe(true)
  })

  it("documents: iqama to issue for a visa arrival (90 days), to renew in the window, insurance to add or renew, a driver's licence", () => {
    const arrival = emp("e2", { source: "visa", join: "2026-09-01", docs: { insurance: "2027-01-01" } })
    const renew = emp("e3", { docs: { iqama: "2026-11-01", insurance: "2026-10-20" } })
    const driver = emp("e4", { trade: "driver", nationality: "sa", docs: { licence: "2026-11-15" } })
    const t = platformTasks(world({ employees: [arrival, renew, driver] }))
    expect(t.find((x) => x.employeeId === "e2" && x.code === "iq")).toMatchObject({ pf: "muqeem", due: "2026-11-30", action: { kind: "doc", doc: "iqama" } })
    expect(t.find((x) => x.employeeId === "e3" && x.code === "ren")?.due).toBe("2026-11-01")
    expect(t.find((x) => x.employeeId === "e3" && x.code === "ins")).toMatchObject({ pf: "chi", params: { missing: 0 } })
    expect(t.find((x) => x.employeeId === "e4")).toMatchObject({ pf: "traffic", code: "dl" })
  })

  it("a leaver: GOSI exclusion and insurance removal from the last day; final exit only once settled; closed by the exit's own tasks", () => {
    const e = emp("e5", { status: "leaving", lastDay: "2026-10-01" })
    const x = { id: `${ORG}__e5`, organizationId: ORG, employeeId: "e5", employeeName: "موظف e5", lastDay: "2026-10-01", state: "leaving", tasks: {} } as unknown as HrExit
    expect(codes(world({ employees: [e], exits: [x] }))).toEqual(["chi:rem", "gosi:excl"])
    expect(codes(world({ employees: [e], exits: [{ ...x, state: "settled" }] }))).toEqual(["chi:rem", "gosi:excl", "muqeem:fexit"])
    expect(codes(world({ employees: [e], exits: [{ ...x, tasks: { gosi: { by: "g", byName: null, at: "" }, insurance: { by: "g", byName: null, at: "" } } }] }))).toEqual([])
  })

  it("art. 80 absence at day 15, an unreported injury, an exit re-entry before a trip — never one's own", () => {
    const e = emp("e6")
    const leave = (over: Partial<HrRequest>) => ({ id: "r1", kind: "leave", state: "approved", employeeId: "e6", leave: { from: "2026-09-01", to: "2026-09-15", travel: true }, ...over }) as unknown as HrRequest
    expect(codes(world({ employees: [e], requests: [leave({})] }))).toEqual(["qiwa:abs"])
    const trip = leave({ id: "r2", leave: { from: "2026-10-20", to: "2026-11-10", travel: true } as HrRequest["leave"] })
    expect(platformTasks(world({ employees: [e], requests: [trip] }))[0]).toMatchObject({ code: "erv", due: "2026-10-18", action: { kind: "exit_visa", requestId: "r2" } })
    expect(codes(world({ employees: [e], requests: [trip], selfId: "e6" }))).toEqual([])
    const inj = { id: "i1", employeeId: "e6", employeeName: "x", due: "2026-10-07", report: null } as unknown as HrInjury
    expect(codes(world({ employees: [e], injuries: [inj] }))).toEqual(["gosi:inj"])
  })

  it("a paid month asks Mudad for its upload and status (pay roles read payrolls); a recorded status closes it", () => {
    const p = { key: "2026-09", month: "2026-09", kind: "main", state: "paid", paid: { by: "f", byName: null, at: "2026-10-03T08:00:00Z", date: "2026-10-03" }, lines: [] } as unknown as Payroll
    expect(platformTasks(world({ payrolls: [p] }))[0]).toMatchObject({ pf: "mudad", code: "up", due: "2026-10-06", action: { kind: "mudad", payrollKey: "2026-09" } })
    expect(platformTasks(world({ payrolls: [{ ...p, mudad: { pct: 98 } } as unknown as Payroll] }))).toEqual([])
  })

  it("a recorded act closes a task; a platform switched off shows none", () => {
    const e = emp("e7", { join: "2026-10-01" })
    const done: GovDoc = { id: "x", organizationId: ORG, kind: "done", key: taskKey("qiwa", "ct", "e7"), pf: "qiwa", by: "g", byName: null, at: "" }
    expect(codes(world({ employees: [e], docs: [done] }))).toEqual(["gosi:reg"])
    expect(codes(world({ employees: [e], switches: { qiwa: false, gosi: false } }))).toEqual([])
  })

  it("a pay change's Qiwa task carries no amount, and disappears after 60 days", () => {
    const e = emp("e8")
    const task: GovDoc = { id: "t", organizationId: ORG, kind: "task", key: taskKey("qiwa", "pay", "e8", "2026-10-01"), pf: "qiwa", code: "pay", employeeId: "e8", on: "2026-10-01", by: "h", byName: null, at: "" }
    expect(platformTasks(world({ employees: [e], docs: [task] }))[0]).toMatchObject({ code: "pay", due: "2026-10-08", params: { on: "2026-10-01" } })
    expect(platformTasks(world({ employees: [e], docs: [{ ...task, on: "2026-07-01" }] }))).toEqual([])
  })
})

describe("GV-04 — reconciliation by import: differences only", () => {
  const a = emp("e1", { no: 1, idNo: "2000000001", docs: { iqama: "2027-01-01" } })
  const b = emp("e2", { no: 2, idNo: "2000000002", docs: { iqama: "2027-02-01" } })
  const left = emp("e3", { no: 3, status: "left" })
  const sa = emp("e4", { no: 4, nationality: "sa" })

  it("reads their file: a header, ISO or day/month/year dates, unreadable rows counted", () => {
    expect(parseReconCsv("no,expiry\n1,2027-01-01\n2,1/2/2027\nabc,1\n", "muqeem")).toEqual({ rows: [{ no: "1", value: "2027-01-01" }, { no: "2", value: "2027-02-01" }], bad: 1 })
    expect(parseReconCsv("2000000001;4500", "gosi").rows).toEqual([{ no: "2000000001", value: 4500 }])
  })

  it("value differs · missing there · extra there (left here) · unknown — by employee or ID number", () => {
    const r = reconcile("muqeem", [{ no: "2000000001", value: "2028-01-01" }, { no: "3", value: "2027-01-01" }, { no: "999", value: null }], [a, b, left, sa], (e) => e.docs.iqama ?? null, "2026-10-05")
    expect(r.diffs.map((d) => `${d.k}:${d.employeeId ?? d.no}`).sort()).toEqual(["diff:e1", "gone:e3", "miss:e2", "unk:999"])
    expect(r.matched).toBe(0)
    // GOSI lists Saudis too — e4 is missing there.
    expect(reconcile("gosi", [], [a, sa], null, "2026-10-05").diffs.map((d) => d.employeeId)).toEqual(["e1", "e4"])
  })

  it("RL-03 — without the viewer's right to the value, only presence is compared: no value travels", () => {
    const r = reconcile("gosi", [{ no: "1", value: 9999 }], [a], null, "2026-10-05")
    expect(r.diffs).toEqual([])
    expect(r.matched).toBe(1)
  })

  it("missing and extra become tasks (GOSI skips a joiner still in his window); an open one is not repeated", () => {
    const fresh = emp("e5", { join: "2026-09-20" })
    const diffs = [
      { k: "miss" as const, employeeId: "e5", no: "5" },
      { k: "gone" as const, employeeId: "e3", no: "3" },
      { k: "diff" as const, employeeId: "e1", no: "1", ours: 1, theirs: 2 },
    ]
    expect(reconTasks("gosi", diffs, [fresh, left, a], "2026-10-05", { wageTasks: true, open: new Set() }).map((x) => x.code)).toEqual(["gone", "wage"])
    expect(reconTasks("gosi", diffs, [fresh, left, a], "2026-10-05", { wageTasks: false, open: new Set([`gosi:gone:e3:2026-10-01`]) })).toEqual([])
  })
})

describe("the writes", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("employees/e1", emp("e1", { no: 1, docs: { iqama: "2027-01-01" } }) as unknown as Record<string, unknown>)
    seed("employeePay/e1", { employeeId: "e1", organizationId: ORG, basic: 4000, housing: 1000, transport: 400 })
  })

  it("«سجّل أنه تمّ»: the act recorded once with its reference and a line in the person's log; never twice; never by a role without it", async () => {
    const task = { key: taskKey("gosi", "reg", "e1"), pf: "gosi" as const, code: "reg" as const, employeeId: "e1", action: { kind: "done" as const } }
    await recordPlatformDone(db, gov, ORG, actor, task, { ref: " G-77 " })
    expect(readDoc(`hrGovTasks/${ORG}__gosi:reg:e1`)).toMatchObject({ kind: "done", ref: "G-77", by: "gro", organizationId: ORG })
    expect(listCollection("employees/e1/log")[0]).toMatchObject({ kind: "platform_done", params: { pf: "gosi", task: "reg", ref: "G-77" } })
    await expect(recordPlatformDone(db, gov, ORG, actor, task, {})).rejects.toMatchObject({ code: "blocked" })
    await expect(recordPlatformDone(db, po, ORG, actor, { ...task, key: "other" }, {})).rejects.toMatchObject({ code: "no_role" })
  })

  it("a reconciliation saves who differs — never a value — and its tasks; Muqeem's date taken into the documents", async () => {
    const diffs = [
      { k: "diff" as const, employeeId: "e1", no: "1", ours: "2027-01-01", theirs: "2028-01-01" },
      { k: "unk" as const, employeeId: null, no: "77" },
    ]
    await saveReconciliation(db, gov, ORG, actor, { pf: "muqeem", diffs, n: 2, matched: 0, take: true }, { employees: [emp("e1")], docs: [], today: TODAY })
    const rec = readDoc<GovDoc>(`hrGovTasks/${ORG}__recon:muqeem`)!
    expect(rec).toMatchObject({ kind: "recon", n: 2, diff: 2, rows: [{ k: "diff", employeeId: "e1", no: "1" }, { k: "unk", employeeId: null, no: "77" }] })
    expect(JSON.stringify(rec)).not.toContain("2028-01-01")
    expect(readDoc<HrEmployee>("employees/e1")?.docs.iqama).toBe("2028-01-01")
    expect(listCollection("employees/e1/log").map((l) => (l as { kind: string }).kind)).toContain("iqama_from_muqeem")
  })

  it("RL-03 — government relations cannot save a WAGE comparison, nor take Qiwa's basic; the HR manager can", async () => {
    const diffs = [{ k: "diff" as const, employeeId: "e1", no: "1", ours: 4000, theirs: 3800 }]
    await expect(saveReconciliation(db, gov, ORG, actor, { pf: "qiwa", diffs, n: 1, matched: 0, take: true }, { employees: [emp("e1")], docs: [], today: TODAY })).rejects.toMatchObject({ code: "no_role" })
    await saveReconciliation(db, hrm, ORG, { uid: "hrm", name: "H" }, { pf: "qiwa", diffs, n: 1, matched: 0, take: true }, { employees: [emp("e1")], docs: [], today: TODAY })
    expect(readDoc<EmployeePay>("employeePay/e1")).toMatchObject({ qiwaBasic: 3800 })
    expect(JSON.stringify(readDoc(`hrGovTasks/${ORG}__recon:qiwa`))).not.toContain("3800")
  })

  it("a pay change writes its Qiwa task — the change's day, no amount", async () => {
    await changePay(db, hrm, "e1", { uid: "hrm", name: "H" }, { basic: 4500, effectiveOn: "2026-11-01", reason: "review", kind: "raise" }, { today: TODAY })
    const t = readDoc<GovDoc>(`hrGovTasks/${ORG}__qiwa:pay:e1:2026-11-01`)
    expect(t).toMatchObject({ kind: "task", pf: "qiwa", code: "pay", employeeId: "e1", on: "2026-11-01" })
    expect(JSON.stringify(t)).not.toMatch(/4500|4000/)
  })

  it("PY-08 / GV-05 — a justification once, the Mudad status once on a paid month, by payroll or the HR manager; recomputing keeps the justification", async () => {
    seed(`hrPayrolls/${ORG}__2026-09`, { organizationId: ORG, key: "2026-09", month: "2026-09", kind: "main", state: "prepared", lines: [], prepared: { by: "po", byName: null, at: "" } })
    await justifyMudadFinding(db, po, ORG, { uid: "po", name: "P" }, "2026-09", "e1_low", "written_consent")
    await expect(justifyMudadFinding(db, po, ORG, { uid: "po", name: "P" }, "2026-09", "e1_low", "again")).rejects.toMatchObject({ code: "blocked" })
    await expect(justifyMudadFinding(db, mg, ORG, { uid: "mg", name: "M" }, "2026-09", "e1_half", "x")).rejects.toMatchObject({ code: "no_role" })
    await preparePayroll(db, po, ORG, "2026-09", { uid: "po", name: "P" }, { lines: [], sitesToClose: [], missingPay: [] }, { today: TODAY })
    expect(readDoc<{ just: Record<string, { why: string }> }>(`hrPayrolls/${ORG}__2026-09`)?.just.e1_low.why).toBe("written_consent")
    // The status waits for the payment.
    await expect(recordMudadStatus(db, po, ORG, { uid: "po", name: "P" }, "2026-09", { pct: 97, note: null })).rejects.toMatchObject({ code: "blocked" })
    seed(`hrPayrolls/${ORG}__2026-08`, { organizationId: ORG, key: "2026-08", month: "2026-08", kind: "main", state: "paid", lines: [], prepared: { by: "po", byName: null, at: "" } })
    await expect(recordMudadStatus(db, po, ORG, { uid: "po", name: "P" }, "2026-08", { pct: 120, note: null })).rejects.toMatchObject({ code: "blocked", blocks: ["bad_pct"] })
    await recordMudadStatus(db, po, ORG, { uid: "po", name: "P" }, "2026-08", { pct: 97, note: " ok " })
    expect(readDoc(`hrPayrolls/${ORG}__2026-08`)).toMatchObject({ mudad: { pct: 97, note: "ok", by: "po" } })
    await expect(recordMudadStatus(db, po, ORG, { uid: "po", name: "P" }, "2026-08", { pct: 99, note: null })).rejects.toMatchObject({ code: "blocked" })
  })
})

describe("PY-08 — the pre-Mudad check", () => {
  const line = (over: Partial<PayrollLine>): PayrollLine =>
    ({ employeeId: "e1", name: "A", held: false, heldReason: null, gross: 5000, net: 4500, monthWage: 5000, gosiEmployee: 0, advance: 0, penalties: 0, sickDeduction: 0, unpaidDeduction: 0, basic: 4000, attendance: { present: 26, absent: 0, sick: 0, permission: 0, declared: 0, overtimeHours: 0 }, ...over }) as PayrollLine
  const payroll = (lines: PayrollLine[], over: Partial<Payroll> = {}) => ({ kind: "main", state: "prepared", month: "2026-09", lines, paid: null, ...over }) as Payroll

  it("held · basic ≠ Qiwa · over half (art. 93) · zero · below 90% without absence; paid after the pay day", () => {
    const f = mudadFindings(
      payroll(
        [
          line({ employeeId: "h", held: true, heldReason: "no_iban" }),
          line({ employeeId: "q" }),
          line({ employeeId: "half", advance: 2000, gosiEmployee: 600 }),
          line({ employeeId: "z", net: 0 }),
          line({ employeeId: "low", net: 4000 }),
        ],
        { state: "paid", paid: { by: "f", byName: null, at: "", date: "2026-10-09" } }
      ),
      { payDay: 5, documentedBasic: (id) => (id === "q" ? 3800 : null) }
    )
    expect(f.map((x) => x.key)).toEqual(["month_late", "h_held", "q_basic", "half_half", "z_zero", "low_low"])
    expect(f[2].params).toEqual({ ours: 4000, theirs: 3800 })
    expect(unjustified(f, { h_held: { why: "x" } }).length).toBe(5)
  })

  it("a supplementary is not checked", () => {
    expect(mudadFindings(payroll([line({ net: 0 })], { kind: "supplementary" }), { payDay: 5 })).toEqual([])
  })

  it("the documented basic: the basic before an undocumented change; once recorded, Qiwa's own value only if taken after", () => {
    const pay = { basic: 4500, housing: 0, transport: 0, steps: [{ from: "2026-01-01", basic: 4000, housing: 0, transport: 0 }, { from: "2026-10-01", basic: 4500, housing: 0, transport: 0 }] } as EmployeePay
    const change: GovDoc = { id: "t", organizationId: ORG, kind: "task", key: "qiwa:pay:e1:2026-10-01", pf: "qiwa", code: "pay", employeeId: "e1", on: "2026-10-01", by: "h", byName: null, at: "2026-09-20" }
    expect(documentedBasic("e1", pay, [change])).toBe(4000)
    const done: GovDoc = { ...change, id: "d", kind: "done", at: "2026-10-02T10:00:00Z" }
    expect(documentedBasic("e1", pay, [change, done])).toBeNull()
    expect(documentedBasic("e1", { ...pay, qiwaBasic: 4400, qiwaAt: "2026-10-03T00:00:00Z" }, [change, done])).toBe(4400)
    expect(documentedBasic("e1", { ...pay, qiwaBasic: 4400, qiwaAt: "2026-09-01T00:00:00Z" }, [change, done])).toBeNull()
  })
})

describe("ST-04 — Nitaqat's what-if", () => {
  it("a hire or an exit moves the ratio and the safety margin", () => {
    const base = { total: 10, saudis: 3 }
    expect(nitaqatAfter(base, 30, { saudis: 0, others: 0 })).toMatchObject({ pct: 30, short: 0, spare: 0 })
    expect(nitaqatAfter(base, 30, { saudis: 0, others: 2 })).toMatchObject({ total: 12, pct: 25, short: 1 })
    expect(nitaqatAfter(base, 30, { saudis: 2, others: 0 })).toMatchObject({ total: 12, saudis: 5, spare: 1 })
    expect(nitaqatAfter(base, 30, { saudis: -5, others: 0 })).toMatchObject({ saudis: 0 })
    expect(nitaqatAfter(base, null, { saudis: 1, others: 0 }).short).toBeNull()
    // Same arithmetic as the panel's.
    const people = [...Array(3)].map((_, i) => emp(`s${i}`, { nationality: "sa" })).concat([...Array(7)].map((_, i) => emp(`n${i}`)))
    const n = nitaqatOf(people, { minPct: 35 })
    expect(nitaqatAfter(n, 35, { saudis: 0, others: 0 })).toMatchObject({ short: n.short, spare: n.spare, pct: n.pct })
  })
})

describe("Today — the `gov` and `mudad` rows", () => {
  const tasks = platformTasks(world({ employees: [emp("e1", { join: "2026-10-01" })] }))
  const base = { today: TODAY, tasks, payrolls: [] as Payroll[], payDay: 5 }

  it("government relations goes to Platforms; the HR manager too when nobody holds the role, to the documents when someone does; never without `gov`", () => {
    const row = (c: HrContext, govHeld: boolean | undefined, features = new Set(["gov"])) => platformTodayItems({ ...base, ctx: c, features, govHeld }).find((x) => x.key === "platforms")
    expect(row(gov, true)).toMatchObject({ href: "platforms", action: "platforms", params: { count: 2, late: 0 }, facts: [{ k: "pf_qiwa", p: { n: 1 } }, { k: "pf_gosi", p: { n: 1 } }] })
    expect(row(hrm, false)?.href).toBe("platforms")
    expect(row(hrm, true)?.href).toBe("people?filter=docs")
    expect(row(po, false)).toBeUndefined()
    expect(row(mg, false)).toBeUndefined()
    expect(row(gov, true, new Set())).toBeUndefined()
  })

  it("`mudad`: a payroll with unjustified findings, and a paid month without its Mudad status — for payroll and the HR manager only", () => {
    const lines = [{ employeeId: "z", name: "Z", held: false, gross: 100, net: 0, monthWage: 100, gosiEmployee: 0, advance: 0, penalties: 0, sickDeduction: 0, unpaidDeduction: 0, attendance: { absent: 0, sick: 0, overtimeHours: 0, declared: 0 } } as unknown as PayrollLine]
    const prepared = { key: "2026-09", month: "2026-09", kind: "main", state: "prepared", lines } as Payroll
    const paid = { key: "2026-08", month: "2026-08", kind: "main", state: "paid", lines: [], paid: { by: "f", byName: null, at: "", date: "2026-09-04" } } as unknown as Payroll
    const rows = (c: HrContext, features = new Set(["mudad"])) => platformTodayItems({ ...base, tasks: [], ctx: c, features, govHeld: true, payrolls: [prepared, paid] }).map((x) => x.kind)
    expect(rows(po)).toEqual(["mudad_check", "mudad_status"])
    expect(rows(hrm)).toEqual(["mudad_check", "mudad_status"])
    expect(rows(gov)).toEqual([])
    expect(rows(po, new Set())).toEqual([])
    const justified = { ...prepared, just: { z_zero: { why: "x" } } } as Payroll
    expect(platformTodayItems({ ...base, tasks: [], ctx: po, features: new Set(["mudad"]), govHeld: true, payrolls: [justified] })).toEqual([])
  })
})

describe("GV-03 — platform switches ride the settings and are logged", () => {
  it("kept through normalisation, logged when changed", () => {
    const before = normalizeHrSettings({ features: ["gov"] })
    expect(before.platforms).toEqual({})
    const after = normalizeHrSettings({ ...before, platforms: { hrdf: true, qiwa: "x" as unknown as boolean } })
    expect(after.platforms).toEqual({ hrdf: true })
    expect(appendSettingsLog(before, after, { uid: "h" }, "2026-10-05T00:00:00Z").map((l) => [l.field, l.from, l.to])).toEqual([["platforms.hrdf", null, true]])
  })
})
