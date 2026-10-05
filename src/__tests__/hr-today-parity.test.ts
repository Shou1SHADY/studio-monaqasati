/**
 * HR 1.0 — parity with the prototype, package D (docs/hr-prototype-parity.md slices 1 and 6):
 * Today's facts line, the prototype's grouping and the missing rows (licences, a stopped sheet,
 * renew-or-not, exit re-entry, final exit, waits with their age); the role panels' numbers; the
 * tab rail's counts, labels and the platforms rule; the settings' establishment file, the Ajeer
 * policy, the policy log and the reset to defaults; the reports' penalty words, the EOS accrual
 * and the file previews; the iqama-renewed and sheet-reminder notices.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import fs from "fs"
import path from "path"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { hrTabs, type HrContext, type HrRole } from "@/lib/hr/access"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { recordRenewal } from "@/lib/hr/employee-writes"
import type { HrExit } from "@/lib/hr/exit-writes"
import type { ManpowerRequest } from "@/lib/hr/manpower"
import type { HrNotificationDoc } from "@/lib/hr/notify"
import type { Payroll, PayrollLine } from "@/lib/hr/payroll"
import { costCentres, csvPreview, penaltyCell, penaltyCellParts } from "@/lib/hr/reports"
import type { HrRequest } from "@/lib/hr/requests"
import {
  appendSettingsLog,
  differsFromDefaults,
  normalizeHrSettings,
  nitaqatOf,
  perfLabelKey,
  settingsChanges,
  sitesLabelKey,
  withBusinessType,
  withDefaultFeatures,
  type HrFeature,
} from "@/lib/hr/settings"
import { saveHrSettings } from "@/lib/hr/settings-writes"
import type { HrSite } from "@/lib/hr/sites"
import { resolveHrPolicies } from "@/lib/hr/statutory"
import { hrTabCounts, leakage, monthProgress, requestFacts, sheetStopped, todayItems, todayKpis, tradesToday, type TodayInput } from "@/lib/hr/today"
import { recordExitVisa, remindSheet } from "@/lib/hr/today-writes"

const db = fakeFirestore as unknown as Firestore
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm" })
const TODAY = "2026-09-08" // a Tuesday
const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: "org", no: 1, names: { ar: id }, nationality: "eg", gender: "m", trade: "mason", category: "labour", siteId: "s1", join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31", decision: "confirmed" }, status: "active", docs: { iqama: "2027-01-01" }, leaveTaken: 0, ...over }) as HrEmployee
const sites: HrSite[] = [{ id: "s1", organizationId: "org", name: "Tower", type: "project", projectId: "p1", active: true, supervisorUserId: "sup" }]
// Every working day of September before today recorded at s1 — nothing stopped.
const recorded = (days: string[]): WorkplaceMonth => ({ id: "a", organizationId: "org", siteId: "s1", month: "2026-09", days: Object.fromEntries(days.map((d) => [d, { by: "sup", byName: null, at: "", listed: [], ex: {} }])), declarations: [], closed: null })
const SEPT_TO_7 = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-05", "2026-09-06", "2026-09-07"]
const input = (c: HrContext, over: Partial<TodayInput> = {}): TodayInput => ({
  ctx: c,
  today: TODAY,
  renewWindowDays: 60,
  employees: [emp("e1")],
  sites,
  lastMonth: [],
  thisMonth: [recorded(SEPT_TO_7)],
  injuries: [],
  exits: [],
  requests: [],
  payrolls: [{ kind: "main", month: "2026-08", key: "2026-08", state: "paid", lines: [], prepared: { by: "po" } } as unknown as Payroll],
  pays: new Map(),
  ...over,
})
const kinds = (c: HrContext, over: Partial<TodayInput> = {}) => todayItems(input(c, over)).map((x) => x.kind)

describe("Today — the missing R1 rows", () => {
  it("DC-06: drivers with an expired licence are ONE red row, with their names, for the HR manager only", () => {
    const employees = [emp("d1", { trade: "driver", docs: { iqama: "2027-01-01", licence: "2026-08-01" } }), emp("d2", { trade: "driver", docs: { iqama: "2027-01-01", licence: "2026-09-01" } }), emp("d3", { trade: "driver", docs: { iqama: "2027-01-01", licence: "2027-01-01" } })]
    const rows = todayItems(input(hrm, { employees })).filter((x) => x.kind === "licence_expired")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ group: "blocking", severity: "red", params: { count: 2 }, action: "keep_or_stop", href: "people?filter=docs" })
    expect(rows[0].facts?.[0]).toEqual({ k: "names", p: { names: "d1، d2", more: 0 } })
    expect(kinds(ctx(["gov"]), { employees })).not.toContain("licence_expired")
  })

  it("AT-03/04: a sheet stopped since a day — the HR manager and payroll remind the supervisor; the supervisor does not get it", () => {
    const stopped = { thisMonth: [recorded(["2026-09-01", "2026-09-02"])] }
    const row = todayItems(input(hrm, stopped)).find((x) => x.kind === "sheet_stopped")!
    expect(row).toMatchObject({ params: { site: "Tower", date: "2026-09-03" }, action: "remind", run: { kind: "remind", siteId: "s1" } })
    expect(row.facts?.[0]).toEqual({ k: "days_missing", p: { n: 4 } })
    expect(kinds(ctx(["payroll"], { uid: "po" }), stopped)).toContain("sheet_stopped")
    expect(kinds(ctx(["supervisor"], { uid: "sup", sites: ["s1"] }), stopped)).not.toContain("sheet_stopped")
    // Recorded through yesterday (Monday 7th): nothing stopped.
    expect(kinds(hrm)).not.toContain("sheet_stopped")
    // Nobody there before the 5th: the days before he came are not missing.
    expect(sheetStopped(null, "2026-09", TODAY, "2026-09-07")).toEqual({ thru: null, since: "2026-09-07", missing: 1 })
    // Without a supervisor the HR manager opens the sheet himself.
    const noSup = todayItems(input(hrm, { ...stopped, sites: [{ ...sites[0], supervisorUserId: null }] })).find((x) => x.kind === "sheet_stopped")!
    expect(noSup).toMatchObject({ action: "record", href: "sites/s1" })
    expect(noSup.run).toBeUndefined()
  })

  it("EX-01 / EM-05: a contract within 45 days asks renew-or-not on the file; a probation within 15 days; each says what no decision means", () => {
    const employees = [emp("c1", { contract: { type: "fixed", end: "2026-10-20" } }), emp("c2", { contract: { type: "fixed", end: "2026-11-01" } }), emp("p1", { probation: { end: "2026-09-22" } })]
    const items = todayItems(input(hrm, { employees }))
    expect(items.find((x) => x.key === "ct:c1")).toMatchObject({ action: "decide", href: "people/c1?act=contract" })
    expect(items.find((x) => x.key === "ct:c1")!.facts).toContainEqual({ k: "no_decision_renewed" })
    expect(items.some((x) => x.key === "ct:c2")).toBe(false) // 54 days
    expect(items.find((x) => x.key === "prob:p1")!.facts).toContainEqual({ k: "no_decision_confirmed" })
  })

  it("LV-08: an approved leave abroad asks government relations for the exit re-entry — the HR manager only when nobody holds it", () => {
    const leave = { id: "r1", kind: "leave", state: "approved", employeeId: "e1", employeeName: "e1", siteId: "s1", leave: { type: "annual", from: "2026-09-20", to: "2026-10-10", days: 21, balance: 30, travel: true } } as unknown as HrRequest
    const gov = todayItems(input(ctx(["gov"], { uid: "gro" }), { requests: [leave] })).find((x) => x.kind === "exit_reentry")!
    expect(gov).toMatchObject({ group: "due", action: "recorded", run: { kind: "exit_visa", requestId: "r1" } })
    expect(kinds(hrm, { requests: [leave] })).not.toContain("exit_reentry")
    expect(kinds(hrm, { requests: [leave], govHeld: false })).toContain("exit_reentry")
    expect(kinds(ctx(["gov"]), { requests: [{ ...leave, exitVisa: { by: "x", byName: null, at: "" } } as HrRequest] })).not.toContain("exit_reentry")
    expect(kinds(ctx(["gov"]), { requests: [{ ...leave, leave: { ...leave.leave!, travel: false } }] })).not.toContain("exit_reentry")
  })

  it("EX-06: a final exit within 14 days — no button before the settlement, recorded on the file after it", () => {
    const x = { id: "org__e1", employeeId: "e1", employeeName: "e1", state: "leaving", lastDay: "2026-09-15", custody: { state: "requested" } } as unknown as HrExit
    const gov = ctx(["gov"], { uid: "gro" })
    const before = todayItems(input(gov, { exits: [x] })).find((r) => r.kind === "final_exit")!
    expect(before).toMatchObject({ facts: [{ k: "after_settlement" }] })
    expect(before.action).toBeUndefined()
    const after = todayItems(input(gov, { exits: [{ ...x, state: "settled" }] })).find((r) => r.kind === "final_exit")!
    expect(after).toMatchObject({ action: "record", href: "people/e1" })
    expect(kinds(gov, { exits: [{ ...x, state: "paid", tasks: { finalExit: { by: "gro", byName: null, at: "" } } }] })).not.toContain("final_exit")
  })

  it("TD-03: our answer waiting for the plan's acceptance and the transfers Finance re-issues — source, age, no button", () => {
    const answered = { id: "m1", state: "answered", projectName: "Mall", count: 3, trade: "mason", from: "2026-10-01", siteId: null, answer: { plan: [], excluded: [], by: "hrm", byName: null, at: "2026-09-01T10:00:00Z" } } as unknown as ManpowerRequest
    const paidHeld = { kind: "main", month: "2026-08", key: "2026-08", state: "paid", prepared: { by: "po" }, paid: { by: "fin", byName: null, at: "2026-09-05T08:00:00Z" }, lines: [{ employeeId: "e1", held: true }] } as unknown as Payroll
    const items = todayItems(input(hrm, { manpower: [answered, { ...answered, id: "m2", accepted: { by: "pm", byName: null, at: "" } } as ManpowerRequest], payrolls: [paidHeld], pays: new Map([["e1", { employeeId: "e1", organizationId: "org", basic: 1, housing: 0, transport: 0, iban: "SA1", ibanState: "ok" } as EmployeePay]]) }))
    expect(items.filter((x) => x.kind === "wait_plan").map((x) => [x.key, x.source, x.since])).toEqual([["mpack:m1", "project-management", "2026-09-01T10:00:00Z"]])
    expect(items.find((x) => x.kind === "wait_reissue")).toMatchObject({ params: { n: 1 }, source: "payments", waiting: true })
    expect(leakage(items)).toBe(0)
    // A row that is ours with a write on the spot is never a wait.
    expect(leakage([{ key: "x", group: "other", severity: "blue", kind: "k", params: {}, waiting: true, run: { kind: "remind", siteId: "s1" } }])).toBe(1)
  })
})

describe("Today — the prototype's grouping, severities and facts", () => {
  it("expired documents block; a new IBAN and an assignment correction are people's requests; a payroll to approve is due", () => {
    const employees = [emp("e1", { siteId: null, docs: { iqama: "2026-09-01" } })]
    const gov = todayItems(input(ctx(["gov"]), { employees })).find((x) => x.kind === "doc_due")!
    expect(gov).toMatchObject({ group: "blocking", severity: "red", href: "people/e1?renew=iqama" })
    const pays = new Map([["e1", { employeeId: "e1", organizationId: "org", basic: 1, housing: 0, transport: 0, ibanState: "fixed" } as EmployeePay]])
    const fixes = [{ id: "f1", employeeId: "e1", employeeName: "e1", siteId: "s1", since: "2026-09-01", state: "pending", by: "sup", byName: "S", note: "seen daily" }] as never
    const payrolls = [{ kind: "main", month: "2026-08", key: "2026-08", state: "prepared", prepared: { by: "po" }, lines: [{ held: true }, { held: false }] }] as unknown as Payroll[]
    const items = todayItems(input(hrm, { pays, assignFixes: fixes, payrolls }))
    expect(items.find((x) => x.kind === "iban_approve")).toMatchObject({ group: "requests", facts: [{ k: "separation" }] })
    expect(items.find((x) => x.kind === "assign_fix")).toMatchObject({ group: "requests", facts: [{ k: "raised_by", p: { name: "S" } }, { k: "quote", p: { text: "seen daily" } }] })
    expect(items.find((x) => x.kind === "payroll_approve")).toMatchObject({ group: "due", facts: [{ k: "lines", p: { n: 2, held: 1 } }, { k: "not_preparer" }] })
  })

  it("DC-04: renewals are government relations' queue — the HR manager gets them only when nobody holds that role", () => {
    const employees = [emp("e1", { siteId: null, docs: { iqama: "2026-09-20" } })]
    expect(kinds(ctx(["gov"]), { employees })).toContain("doc_due")
    expect(kinds(hrm, { employees })).not.toContain("doc_due")
    expect(kinds(hrm, { employees, govHeld: true })).not.toContain("doc_due")
    expect(kinds(hrm, { employees, govHeld: false })).toContain("doc_due")
  })

  it("AS-02: a manpower request is red when the coverage is short, with the coverage line", () => {
    const m = { id: "m1", state: "open", projectName: "Mall", count: 3, trade: "mason", from: "2026-09-20", siteId: null } as unknown as ManpowerRequest
    const employees = [emp("b1", { siteId: null })]
    const row = todayItems(input(hrm, { employees, manpower: [m] })).find((x) => x.kind === "manpower")!
    expect(row).toMatchObject({ severity: "red", href: "sites?manpower=m1", facts: [{ k: "coverage", p: { onTime: 1, late: 0, short: 2 } }] })
  })

  it("the gov renewal row says passport first and on site; a return from leave has the card as its second door", () => {
    const e = emp("p1", { docs: { iqama: "2026-09-01", passport: "2026-08-20" } })
    const row = todayItems(input(ctx(["gov"]), { employees: [e] })).find((x) => x.kind === "doc_due")!
    expect(row.facts).toEqual(expect.arrayContaining([{ k: "on_site" }, { k: "order", p: { order: "passport,iqama" } }]))
    const late = { id: "r9", kind: "leave", state: "approved", employeeId: "e1", employeeName: "e1", siteId: "s1", leave: { type: "annual", from: "2026-08-01", to: "2026-09-04", days: 30, balance: 30, travel: false } } as unknown as HrRequest
    const sup = todayItems(input(ctx(["supervisor"], { uid: "sup", sites: ["s1"] }), { requests: [late] })).find((x) => x.key === "return:r9")!
    expect(sup).toMatchObject({ group: "blocking", href: "sites/s1", second: { action: "card", href: "people/e1" } })
  })

  it("a request's facts: the balance, the excess and the endorsement; an advance's figures only to pay roles", () => {
    const leave = { id: "r1", kind: "leave", employeeId: "e1", siteId: "s1", leave: { type: "annual", days: 25, balance: 20 }, endorsement: null } as unknown as HrRequest
    expect(requestFacts(leave, { employees: [emp("e1")], sites, pays: new Map(), seesPay: false })).toEqual([{ k: "site", p: { site: "Tower" } }, { k: "balance", p: { n: 20 } }, { k: "exceeds", p: { n: 5 } }, { k: "no_endorsement" }])
    const adv = { id: "r2", kind: "advance", employeeId: "e1", advance: { amount: 900, instalment: 300, months: 3, reason: "rent" } } as unknown as HrRequest
    const pays = new Map([["e1", { employeeId: "e1", organizationId: "org", basic: 2000, housing: 500, transport: 500 } as EmployeePay]])
    expect(requestFacts(adv, { employees: [emp("e1")], sites, pays, seesPay: false })).toEqual([])
    expect(requestFacts(adv, { employees: [emp("e1")], sites, pays, seesPay: true })).toEqual([
      { k: "trade", p: { trade: "mason" } },
      { k: "site", p: { site: "Tower" } },
      { k: "wage", p: { wage: 3000 } },
      { k: "instalment", p: { instalment: 300, n: 3 } },
      { k: "no_advance" },
      { k: "quote", p: { text: "rent" } },
    ])
  })
})

describe("Today — role panels and KPIs", () => {
  it("payroll's month: last month to close with its last recorded day; this month current or stopped since a day", () => {
    const p = monthProgress({ today: TODAY, sites, employees: [emp("e1", { join: "2025-01-01" })], lastMonth: [{ ...recorded([]), month: "2026-08", days: { "2026-08-30": { by: "s", byName: null, at: "", listed: [], ex: {} } } }], thisMonth: [recorded(["2026-09-01"])] })
    expect(p.toClose).toEqual([{ siteId: "s1", thru: "2026-08-30" }])
    expect(p.current).toEqual([{ siteId: "s1", people: 1, state: "stopped", thru: "2026-09-01", since: "2026-09-02" }])
  })

  it("the supervisor's workers by trade: present of working, expired iqamas flagged", () => {
    const wm = { ...recorded([]), days: { [TODAY]: { by: "sup", byName: null, at: "", listed: ["a", "b"], ex: { b: { status: "absent" } } } } } as WorkplaceMonth
    const rows = tradesToday({ today: TODAY, employees: [emp("a"), emp("b"), emp("c", { trade: "driver", docs: { iqama: "2026-01-01" } }), emp("x", { siteId: "s9" })], sites, thisMonth: [wm], requests: [], siteIds: ["s1"] })
    expect(rows).toEqual([
      { trade: "mason", total: 2, present: 1, expired: 0 },
      { trade: "driver", total: 1, present: 0, expired: 1 },
    ])
  })

  it("KPIs: bench cost on the HR manager's note; management's admin share, ending site and pay day; a supervisor's expired document is red", () => {
    const k = { ctx: hrm, today: TODAY, renewWindowDays: 60, sites: [...sites, { id: "s2", organizationId: "org", name: "Villa", type: "project", active: true, endDate: "2026-09-30" } as HrSite], thisMonth: [], requests: [], payDay: 5 }
    const employees = [emp("b1", { siteId: null }), emp("v1", { siteId: "s2" }), emp("w1", { docs: { iqama: "2026-09-01" } })]
    const pays = new Map(["b1", "v1", "w1"].map((id) => [id, { employeeId: id, organizationId: "org", basic: 1000, housing: 0, transport: 0 } as EmployeePay]))
    const payrolls = [{ kind: "main", month: "2026-08", key: "2026-08", state: "paid", paid: { by: "f", byName: null, at: "2026-09-07T09:00:00Z", date: "2026-09-07" }, lines: [{ gross: 1000, gosiEmployer: 0, net: 1000, costKind: "admin" }, { gross: 3000, gosiEmployer: 0, net: 3000, costKind: "direct" }] }] as unknown as Payroll[]
    const hr = todayKpis({ ...k, employees, pays, payrolls })
    expect(hr[0]).toMatchObject({ note: "note_cost", params: { bench: 1, cost: 1000 }, href: "people" })
    const mg = todayKpis({ ...k, ctx: ctx(["management"]), employees, pays, payrolls })
    expect(mg[0]).toMatchObject({ id: "bench", note: "note_ending", params: { site: "Villa", n: 1, endCost: 1000 } })
    expect(mg[1].params).toMatchObject({ admin: 25 })
    expect(mg[2]).toMatchObject({ note: "note_payday", params: { paid: 7, policy: 5 } })
    const sup = todayKpis({ ...k, ctx: ctx(["supervisor"], { sites: ["s1"] }), employees, pays: new Map(), payrolls: [] })
    expect(sup[2]).toMatchObject({ id: "my_docs", tone: "bad" })
    const moving = todayKpis({ ...k, employees, pays, payrolls: [], moving: true })
    expect(moving.map((x) => x.id)).toEqual(["new_people", "new_sites", "payroll"])
  })

  it("payroll's estimate says at how many workplaces the sheet is recorded through yesterday", () => {
    const k = todayKpis({ ctx: ctx(["payroll"]), today: TODAY, renewWindowDays: 60, employees: [emp("e1")], sites, thisMonth: [recorded(SEPT_TO_7)], requests: [], payrolls: [], pays: new Map() })
    expect(k[0].params).toMatchObject({ current: 1, of: 1 })
  })
})

describe("the tab rail (TD-01, TD-04, ST-06)", () => {
  it("counts: Today's decisions always, red when one blocks; manpower to answer; payrolls to approve; my open requests", () => {
    const items = todayItems(input(hrm, { employees: [emp("e1", { docs: { iqama: "2026-09-01" } })] }))
    const c = hrTabCounts({
      ctx: { ...hrm, employeeId: "me" },
      items,
      decisions: 4,
      urgent: true,
      employees: [emp("e1"), emp("x", { status: "left" })],
      manpower: [{ state: "open" }, { state: "answered" }] as ManpowerRequest[],
      payrolls: [],
      requests: [{ employeeId: "me", state: "pending" }, { employeeId: "me", state: "approved" }] as HrRequest[],
    })
    expect(c).toEqual({ today: { count: 4, urgent: true }, people: { count: 1 }, sites: { count: 1, urgent: false }, me: { count: 1 } })
    expect(hrTabCounts({ ctx: ctx(["gov"]), items: [], decisions: 0, urgent: false, employees: [], manpower: [{ state: "open" }] as ManpowerRequest[], payrolls: [], requests: [] })).toEqual({ today: { count: 0, urgent: false } })
  })

  it("labels: the workplaces in the company's word; the growth tab by its features", () => {
    expect([sitesLabelKey(null), sitesLabelKey("contractor"), sitesLabelKey("supplier"), sitesLabelKey("developer")]).toEqual(["sites", "sites_contractor", "sites_supplier", "sites_developer"])
    const f = (...x: HrFeature[]) => new Set(x)
    expect([perfLabelKey(f("perf", "train")), perfLabelKey(f("perf")), perfLabelKey(f("train"))]).toEqual(["perf", "perf_only", "train_only"])
  })

  it("platforms: government relations'; the HR manager's only when nobody holds it; never management's", () => {
    const all = new Set<HrFeature>(["hire", "perf", "train", "punch", "gov", "mudad"])
    expect(hrTabs(ctx(["gov"]), all)).toContain("platforms")
    expect(hrTabs(ctx(["management"]), all)).not.toContain("platforms")
    expect(hrTabs(ctx(["manager"]), all)).not.toContain("platforms")
    expect(hrTabs(ctx(["manager"]), all, { govHeld: true })).not.toContain("platforms")
    expect(hrTabs(ctx(["manager"]), all, { govHeld: false })).toContain("platforms")
  })
})

describe("settings (ST-01, ST-04, ST-06)", () => {
  it("the establishment's Saudization: ratio from the record, the Saudis short of the band or the margin to lose", () => {
    const people = [...Array(7)].map(() => ({ nationality: "eg", status: "active" })).concat([...Array(3)].map(() => ({ nationality: "sa", status: "active" })), [{ nationality: "sa", status: "left" }])
    expect(nitaqatOf(people, { minPct: 40 })).toEqual({ total: 10, saudis: 3, pct: 30, min: 40, short: 1, spare: 0 })
    expect(nitaqatOf(people, { minPct: 15 })).toMatchObject({ short: 0, spare: 1 })
    expect(nitaqatOf(people, {})).toMatchObject({ pct: 30, short: null })
  })

  it("new establishment fields survive normalising; a bad band or threshold does not", () => {
    const s = normalizeHrSettings({ establishment: { nameEn: " ACME ", mudad: "M-1", band: "mid_green", bandAsOf: "2026-09-01", minPct: 23.5 } })
    expect(s.establishment).toMatchObject({ nameEn: "ACME", mudad: "M-1", band: "mid_green", bandAsOf: "2026-09-01", minPct: 23.5 })
    expect(normalizeHrSettings({ establishment: { band: "blue" as never, minPct: 140 } }).establishment).toMatchObject({ band: null, minPct: null })
  })

  it("policies: Ajeer allowed with its ×1.4 by default; half a month is an advance limit", () => {
    expect(resolveHrPolicies(null)).toMatchObject({ ajeerAllowed: true, ajeerFactor: 1.4 })
    expect(resolveHrPolicies({ ajeerAllowed: false, ajeerFactor: 0.5, advanceMaxMonths: 0.5 })).toMatchObject({ ajeerAllowed: false, ajeerFactor: 1.4, advanceMaxMonths: 0.5 })
  })

  it("the reset to defaults is offered only when the features differ from the business type's", () => {
    const s = withBusinessType(normalizeHrSettings(null), "contractor")
    expect(differsFromDefaults(s)).toBe(false)
    const changed = { ...s, features: s.features.filter((f) => f !== "gov") }
    expect(differsFromDefaults(changed)).toBe(true)
    expect(withDefaultFeatures(changed).features.sort()).toEqual(s.features.sort())
  })

  it("every save logs what it changed — who, when, from and to — in the same document", async () => {
    resetFakeDb()
    const before = normalizeHrSettings(null)
    const after = { ...before, policies: { ...before.policies, payDay: 7 }, features: ["gov" as HrFeature] }
    expect(settingsChanges(before, after)).toEqual([
      { field: "features.gov", from: false, to: true },
      { field: "policies.payDay", from: 5, to: 7 },
    ])
    expect(appendSettingsLog(before, after, { uid: "hrm", name: "M" }, "t1")).toHaveLength(2)
    await saveHrSettings(db, hrm, "org", after, { name: "M" })
    await saveHrSettings(db, hrm, "org", { ...after, establishment: { ...after.establishment, band: "red" } }, { name: "M" })
    const stored = normalizeHrSettings(readDoc("hrSettings/org") as never)
    expect((stored.log ?? []).map((x) => [x.field, x.from, x.to, x.by])).toEqual([
      ["features.gov", false, true, "hrm"],
      ["policies.payDay", 5, 7, "hrm"],
      ["establishment.band", null, "red", "hrm"],
    ])
    await expect(saveHrSettings(db, ctx(["payroll"]), "org", after)).rejects.toMatchObject({ code: "no_role" })
  })
})

describe("reports (RP-02, PY-07)", () => {
  it("the penalties register writes the penalty, not a step number", () => {
    expect([penaltyCell("late15", 0), penaltyCell("late30", 0), penaltyCell("absentDay", 1), penaltyCell("fighting", 3), penaltyCell("late15", 9)]).toEqual(["warning", "fraction:0.1", "days:2", "termination", "fraction:0.2"])
    expect(penaltyCellParts("fraction:0.15")).toEqual({ kind: "fraction", pct: 15 })
    expect(penaltyCellParts("days:2")).toEqual({ kind: "days", days: 2 })
  })

  it("labour cost by cost centre carries the EOS accrual beside the cost, and each centre's share", () => {
    const lines = [
      { siteId: "s1", costKind: "direct", gross: 3000, gosiEmployer: 0, eosAccrual: 125 },
      { siteId: null, costKind: "admin", gross: 1000, gosiEmployer: 0, eosAccrual: 40 },
    ] as unknown as PayrollLine[]
    const c = costCentres({ lines })
    expect(c.total).toBe(4000)
    expect(c.rows.map((r) => [r.siteId, r.eos, r.cost, r.share])).toEqual([
      ["s1", 125, 3000, 75],
      ["__bench__", 40, 1000, 25],
    ])
  })

  it("a file is previewed before download: header, first rows, the count and each amount column's total", () => {
    const csv = '﻿id_no,name,iban,net\r\n2412345678,"Ali, A",SA03,1000.50\r\n2412345679,Omar,SA04,999.50\r\n'
    expect(csvPreview(csv, 1)).toEqual({ header: ["id_no", "name", "iban", "net"], rows: [["2412345678", "Ali, A", "SA03", "1000.50"]], count: 2, totals: [null, null, null, 2000] })
  })
})

describe("notices (DC-03, AT-03/04) and the on-the-spot writes", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("teamGroups/g-hr", { organizationId: "org", permissions: ["employees.manage"] })
    seed("users/org", { organizationId: "org", organizationRole: "owner" })
    seed("users/hrm", { organizationId: "org", organizationRole: "member", defaultGroupId: "g-hr" })
    seed("employees/e1", { organizationId: "org", no: 1, names: { ar: "أحمد" }, nationality: "eg", siteId: "s1", status: "active", docs: { iqama: "2026-01-01" } })
  })
  const inbox = (uid: string) => listCollection<HrNotificationDoc>(`users/${uid}/notifications`)

  it("an expired iqama renewed tells the HR manager he may be assigned again; a valid one renewed tells nobody", async () => {
    const gov = ctx(["gov"], { uid: "gro" })
    await recordRenewal(db, gov, "e1", { uid: "gro", name: "G" }, { type: "iqama", expiry: "2028-01-01" })
    expect(inbox("hrm").map((n) => [n.type, n.i18n.params.expiry])).toEqual([["hr_iqama_renewed", "2028-01-01"]])
    await recordRenewal(db, gov, "e1", { uid: "gro", name: "G" }, { type: "iqama", expiry: "2029-01-01" })
    expect(inbox("hrm")).toHaveLength(1)
  })

  it("the reminder reaches the workplace's supervisor once a day; only the HR manager or payroll sends it", async () => {
    const site = { ...sites[0] }
    await remindSheet(db, hrm, { uid: "hrm", name: "M" }, site, "2026-09-03", TODAY)
    await remindSheet(db, ctx(["payroll"], { uid: "po" }), { uid: "po", name: "P" }, site, "2026-09-03", TODAY)
    expect(inbox("sup").map((n) => [n.type, n.link, n.i18n.params.since])).toEqual([["hr_sheet_reminder", "hr/sites/s1", "2026-09-03"]])
    await expect(remindSheet(db, ctx(["supervisor"], { sites: ["s1"] }), { uid: "x", name: null }, site, "2026-09-03", TODAY)).rejects.toMatchObject({ code: "no_role" })
  })

  it("the exit re-entry visa is stamped once on the approved leave, by government relations, never on his own", async () => {
    seed("hrRequests/r1", { organizationId: "org", kind: "leave", state: "approved", employeeId: "e1", employeeUserId: "wu", leave: { from: "2026-09-20" } })
    await expect(recordExitVisa(db, ctx(["payroll"]), { uid: "po", name: null }, "r1")).rejects.toMatchObject({ code: "no_role" })
    await expect(recordExitVisa(db, ctx(["gov"], { uid: "wu", employeeId: "e1" }), { uid: "wu", name: null }, "r1")).rejects.toMatchObject({ code: "own_request" })
    await recordExitVisa(db, ctx(["gov"], { uid: "gro" }), { uid: "gro", name: "G" }, "r1")
    expect(readDoc("hrRequests/r1")).toMatchObject({ state: "approved", exitVisa: { by: "gro", byName: "G" } })
    await expect(recordExitVisa(db, ctx(["gov"], { uid: "gro" }), { uid: "gro", name: "G" }, "r1")).rejects.toMatchObject({ blocks: ["stale"] })
  })

  it("the rules let government relations stamp exitVisa once and nothing else on an approved leave", () => {
    const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8")
    const block = rules.slice(rules.indexOf("match /hrRequests/{requestId}"), rules.indexOf("match /hrLetters/{letterId}"))
    expect(block).toMatch(/changedKeys\(\)\.hasOnly\(\['exitVisa', 'updatedAt'\]\) && !\('exitVisa' in resource\.data\)\s+&& \(hrRole\('hr\.gov'\) \|\| hrManager\(\)\) && hrNotOwn\(\)/)
  })
})
