/**
 * HR 1.0 — the UAT demo seed (scripts/seed-hr-demo.ts). The documents are built
 * by a pure function from the module's own rules; these tests hold the demo to
 * the flows it exists for: the paid payroll is exactly what the module computes,
 * last month can be prepared, every sheet the closing needs is closed, numbers
 * are well-formed and the sequences stay ahead of them, the employee's payslip
 * and letters are his to read, no log carries an amount, the supervisor's site
 * holds the injury and the correction, the visa arrival is illegal on a site,
 * and the exit waits for Inventory.
 */
import { dueDays, isRestDay, missingDays } from "@/lib/hr/attendance"
import { legalOnSite } from "@/lib/hr/documents"
import { isHoliday } from "@/lib/hr/holidays"
import { buildHrDemo, SERVER_TS, type HrDemoInput } from "@/lib/hr/demo-seed"
import { computePayroll, payrollBlocks, sitesToClose } from "@/lib/hr/payroll"
import { daysBetween } from "@/lib/hr/statutory"
import { mayObject } from "@/lib/hr/violations"

const TODAY = "2026-10-05"
const input: HrDemoInput = {
  orgId: "org-demo",
  today: TODAY,
  owner: { uid: "u-owner", name: "أحمد القحطاني" },
  finance: { uid: "u-finance", name: "سارة العتيبي" },
  supervisor: { uid: "u-supply", name: "خالد الحربي" },
  employee: { uid: "u-viewer", name: "فاطمة الزهراني" },
  project: { id: "p-1", name: "مشروع فلل النخيل السكني" },
  counters: { lastEmployeeNo: 4, yearly: { LV__2026: 7, LT__2026: 2 } },
}
const demo = buildHrDemo(input)
const { m0, m1, m2 } = demo.months

describe("HR demo seed", () => {
  it("relative months and unique, deterministic paths with nothing undefined", () => {
    expect([m0, m1, m2]).toEqual(["2026-10", "2026-09", "2026-08"])
    const paths = demo.writes.map((w) => w.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(JSON.stringify(buildHrDemo(input).writes)).toBe(JSON.stringify(demo.writes))
    const bad: string[] = []
    const scan = (v: unknown, at: string) => {
      if (v === undefined) bad.push(at)
      else if (typeof v === "number" && !Number.isFinite(v)) bad.push(at)
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) scan(x, `${at}.${k}`)
    }
    for (const w of demo.writes) scan(w.data, w.path)
    expect(bad).toEqual([])
    // serverTimestamp() stands only at the top level, where the script swaps it.
    for (const w of demo.writes) for (const [k, v] of Object.entries(w.data)) if (v === SERVER_TS) expect(["createdAt", "updatedAt"]).toContain(k)
    expect(paths.some((p) => p.includes("/notifications/"))).toBe(false)
  })

  it("the paid payroll of the month before last is exactly what computePayroll returns over the seeded records", () => {
    const again = computePayroll({ month: m2, employees: demo.employees, pays: demo.pays, sites: demo.sites, attendance: demo.attendance, requests: demo.requests, violations: demo.violations, previous: null })
    expect(again.missingPay).toEqual([])
    expect(demo.payroll.lines).toEqual(again.lines)
    expect(demo.payroll.state).toBe("paid")
    expect(demo.payroll.prepared.by).toBe("u-finance")
    expect(demo.payroll.approved?.by).toBe("u-owner")
    // The advance instalment came off the balance at approval — and the balance still covers the next one.
    const adv = demo.payroll.lines.find((l) => l.advance > 0)!
    expect(demo.pays.get(adv.employeeId)?.advance?.balance).toBe(2400 - adv.advance)
    // The arrival with no bank account is a held line: no payslip for him.
    const held = demo.payroll.lines.filter((l) => l.held)
    expect(held.map((l) => l.employeeId)).toEqual([demo.ids.visaArrival])
    expect(demo.payslips.map((p) => p.employeeId).sort()).toEqual(demo.payroll.lines.filter((l) => !l.held).map((l) => l.employeeId).sort())
    // The leaver of that month is not on it (his settlement pays it); the joiner of next week is on nothing.
    expect(demo.payroll.lines.some((l) => l.employeeId === demo.ids.leaver)).toBe(false)
    expect(demo.payroll.lines.some((l) => l.employeeId === demo.ids.expected)).toBe(false)
  })

  it("last month is closed everywhere the closing needs and its payroll can be prepared", () => {
    for (const month of [m1, m2]) {
      const need = sitesToClose(month, demo.sites, demo.employees, demo.attendance)
      expect(need.sort()).toEqual([demo.ids.projectSite, demo.ids.workshopSite].sort())
      for (const siteId of need) {
        const wm = demo.attendance.find((a) => a.month === month && a.siteId === siteId)
        expect(wm?.closed).toBeTruthy()
        expect(missingDays(wm!, month, TODAY, { assumed: false })).toEqual([])
      }
    }
    const { missingPay } = computePayroll({ month: m1, employees: demo.employees, pays: demo.pays, sites: demo.sites, attendance: demo.attendance, requests: demo.requests, violations: demo.violations, previous: demo.payroll.lines })
    expect(payrollBlocks({ month: m1, today: TODAY, sites: demo.sites, employees: demo.employees, attendance: demo.attendance, missingPay, state: null }).blocks).toEqual([])
    // Left open on request, the workshop blocks it until someone closes the month.
    const open = buildHrDemo({ ...input, leaveWorkshopOpen: true })
    expect(payrollBlocks({ month: m1, today: TODAY, sites: open.sites, employees: open.employees, attendance: open.attendance, missingPay: [], state: null }).unclosed).toEqual([open.ids.workshopSite])
  })

  it("sheets: no Friday or holiday recorded, a declaration last month, and this month one day left for a declaration", () => {
    for (const wm of demo.attendance) for (const day of Object.keys(wm.days)) expect(isRestDay(day) || isHoliday(day)).toBe(false)
    const lastProject = demo.attendance.find((a) => a.month === m1 && a.siteId === demo.ids.projectSite)!
    expect(lastProject.declarations).toHaveLength(1)
    expect(lastProject.declarations[0].employees.length).toBeGreaterThan(0)
    const thisMonth = demo.attendance.filter((a) => a.month === m0)
    expect(thisMonth.map((a) => a.siteId)).toEqual([demo.ids.projectSite])
    expect(thisMonth[0].closed).toBeNull()
    expect(missingDays(thisMonth[0], m0, TODAY, { assumed: false })).toEqual([dueDays(m0, TODAY)[0]])
    // Last month's exceptions are on the sheets: an absence, a sick day, a permission, overtime.
    const statuses = Object.values(lastProject.days).flatMap((s) => Object.values(s.ex).map((e) => e.status ?? (e.ot ? "ot" : "")))
    expect(new Set(statuses)).toEqual(new Set(["absent", "sick", "permission", "ot"]))
    // Nobody on approved leave is recorded with an exception on its days.
    const leave = demo.requests.find((r) => r.kind === "leave" && r.state === "approved")!
    for (const [day, s] of Object.entries(lastProject.days)) if (day >= leave.leave!.from && day <= leave.leave!.to) expect(s.ex[leave.employeeId]).toBeUndefined()
  })

  it("numbers are well-formed, follow the existing sequences, and the counters are at least the highest used", () => {
    const nos = demo.requests.map((r) => r.no)
    for (const no of nos) expect(no).toMatch(/^(LV|AV|HQ)-\d{4}\/\d{3}$/)
    expect(new Set(nos).size).toBe(nos.length)
    expect(nos.filter((n) => n.startsWith("LV-2026/")).sort()).toEqual(["LV-2026/008", "LV-2026/009"])
    const serials = demo.letters.filter((l) => l.state === "issued").map((l) => l.serial as string)
    for (const s of serials) expect(s).toMatch(/^LT-\d{4}\/\d{3}$/)
    expect(serials.sort()).toEqual(["LT-2026/003", "LT-2026/004"])
    const seq = (no: string) => ({ k: `${no.slice(0, 2)}__${no.slice(3, 7)}`, n: Number(no.slice(8)) })
    for (const no of [...nos, ...serials]) {
      const { k, n } = seq(no)
      const w = demo.writes.find((x) => x.path === `mfgCounters/org-demo__${k}`)!
      expect(w.mode).toBe("counter")
      expect(w.data.last as number).toBeGreaterThanOrEqual(n)
    }
    const maxNo = Math.max(...demo.employees.map((e) => e.no))
    expect(Math.min(...demo.employees.map((e) => e.no))).toBe(5)
    expect(demo.writes.find((w) => w.path === "hrCounters/org-demo")!.data.lastEmployeeNo).toBe(maxNo)
    expect(new Set(demo.employees.map((e) => e.idNo)).size).toBe(demo.employees.length)
    for (const e of demo.employees) expect(e.idNo).toMatch(e.nationality === "sa" ? /^1\d{9}$/ : /^2\d{9}$/)
    for (const p of demo.pays.values()) if (p.iban) expect(p.iban).toMatch(/^SA\d{22}$/)
  })

  it("the linked employee's payslip, letters and requests carry his user, and the letter's figures equal his pay", () => {
    const me = demo.ids.linkedEmployee!
    expect(demo.employees.find((e) => e.id === me)?.userId).toBe("u-viewer")
    expect(demo.employees.filter((e) => e.userId === "u-viewer")).toHaveLength(1)
    expect(demo.payslips.find((p) => p.employeeId === me)?.employeeUserId).toBe("u-viewer")
    const mine = demo.letters.filter((l) => l.employeeId === me)
    expect(mine.length).toBeGreaterThan(0)
    for (const l of mine) expect(l.employeeUserId).toBe("u-viewer")
    const pay = demo.pays.get(me)!
    for (const lp of demo.letterPay.filter((x) => x.employeeId === me)) expect([lp.employeeUserId, lp.basic, lp.housing, lp.transport]).toEqual(["u-viewer", pay.basic, pay.housing, pay.transport])
    const pendingLeave = demo.requests.find((r) => r.employeeId === me && r.kind === "leave")!
    expect([pendingLeave.state, pendingLeave.employeeUserId, pendingLeave.filedBy.by, pendingLeave.onBehalf]).toEqual(["pending", "u-viewer", "u-viewer", false])
    // A letter waits for the HR manager on Today.
    expect(demo.letters.some((l) => l.state === "pending" && l.signerLevel === "manager")).toBe(true)
  })

  it("no log carries an amount (RL-03)", () => {
    expect(demo.logs.length).toBeGreaterThan(demo.employees.length)
    for (const l of demo.logs) {
      for (const k of Object.keys(l.entry.params)) expect(k).not.toMatch(/amount|basic|housing|transport|wage|net|gross|salary|pay|fee|advance/i)
      expect(l.path.startsWith(`employees/${l.employeeId}/log/`)).toBe(true)
    }
    expect(new Set(demo.employees.map((e) => e.id))).toEqual(new Set(demo.logs.filter((l) => l.entry.kind === "created").map((l) => l.employeeId)))
  })

  it("the supervisor's site holds the injury and the pending correction raised by ID number", () => {
    const site = demo.sites.find((s) => s.id === demo.ids.projectSite)!
    expect([site.supervisorUserId, site.projectId]).toEqual(["u-supply", "p-1"])
    expect(demo.injuries.map((i) => [i.siteId, i.recorded.by, i.report])).toEqual([[site.id, "u-supply", null]])
    expect(demo.injuries[0].due >= demo.injuries[0].on).toBe(true)
    const fix = demo.assignFixes[0]
    expect([fix.siteId, fix.by, fix.state, fix.employeeId]).toEqual([site.id, "u-supply", "pending", null])
    expect(demo.employees.some((e) => e.idNo === fix.idNo && e.siteId !== site.id)).toBe(true)
    expect(demo.manpower.map((m) => [m.projectId, m.state])).toEqual([["p-1", "open"]])
  })

  it("a visa arrival past 90 days without an iqama is illegal on his site; the probationer and the expected joiner are there", () => {
    const visa = demo.employees.find((e) => e.id === demo.ids.visaArrival)!
    expect([visa.source, visa.docs.iqama, visa.nationality !== "sa"]).toEqual(["visa", undefined, true])
    expect(daysBetween(visa.join, TODAY)).toBeGreaterThan(90)
    expect(visa.siteId).toBe(demo.ids.projectSite)
    expect(legalOnSite(visa, TODAY)).toBe(false)
    expect(demo.employees.find((e) => e.id === demo.ids.expected)?.status).toBe("expected")
    const p = demo.employees.find((e) => e.id === demo.ids.probation)!
    expect(p.probation.end > TODAY && !p.probation.decision).toBe(true)
  })

  it("penalties: one applied inside its objection window, one recorded on this month's sheet", () => {
    const applied = demo.violations.find((v) => v.state === "applied")!
    expect(mayObject(applied, TODAY)).toBe(true)
    expect(applied.deductMonth).toBe(m0)
    const recorded = demo.violations.find((v) => v.state === "recorded")!
    expect(recorded.source).toBe("sheet")
    const sheet = demo.attendance.find((a) => a.month === m0)!.days[recorded.on]
    expect(sheet.ex[recorded.employeeId]?.violation).toBe(recorded.code)
  })

  it("the exit is started with the custody not cleared; the finished leaver is settled, paid and certified", () => {
    const leaving = demo.exits.find((x) => x.employeeId === demo.ids.leaving)!
    expect([leaving.state, leaving.custody.state]).toEqual(["leaving", "requested"])
    expect(demo.employees.find((e) => e.id === demo.ids.leaving)?.status).toBe("leaving")
    expect(demo.settlements.some((s) => s.employeeId === demo.ids.leaving)).toBe(false)
    const done = demo.exits.find((x) => x.employeeId === demo.ids.leaver)!
    expect([done.state, done.custody.state]).toEqual(["paid", "cleared"])
    const st = demo.settlements.find((s) => s.employeeId === demo.ids.leaver)!
    expect(st.state).toBe("paid")
    expect(st.lastMonthDays).toBe(20)
    expect(st.gratuity).toBeGreaterThan(0)
    expect(demo.letters.find((l) => l.employeeId === demo.ids.leaver)?.kind).toBe("exp")
  })

  it("the settings make the module set up, and the grants are payroll for Finance and supervisor for the site", () => {
    expect(demo.settings.businessType).toBe("contractor")
    expect(demo.settings.establishment.visas).toBeGreaterThanOrEqual(2)
    expect(demo.grants).toEqual([
      { member: "finance", permission: "hr.payroll" },
      { member: "supervisor", permission: "hr.supervisor" },
    ])
  })

  it("stays coherent on other days: the first of a month, and without a project or linked employee", () => {
    for (const today of ["2026-11-01", "2027-01-02", "2026-03-31"]) {
      const d = buildHrDemo({ ...input, today, project: null, counters: null })
      const again = computePayroll({ month: d.months.m2, employees: d.employees, pays: d.pays, sites: d.sites, attendance: d.attendance, requests: d.requests, violations: d.violations, previous: null })
      expect(d.payroll.lines).toEqual(again.lines)
      const { missingPay } = computePayroll({ month: d.months.m1, employees: d.employees, pays: d.pays, sites: d.sites, attendance: d.attendance, requests: d.requests, violations: d.violations, previous: d.payroll.lines })
      expect(payrollBlocks({ month: d.months.m1, today, sites: d.sites, employees: d.employees, attendance: d.attendance, missingPay, state: null }).blocks).toEqual([])
      expect(d.manpower).toEqual([])
    }
    const solo = buildHrDemo({ ...input, employee: null })
    expect(solo.ids.linkedEmployee).toBeNull()
    expect(solo.employees.some((e) => e.userId)).toBe(false)
  })

  it("staff logins are employees too: one linked Saudi record each, on the payroll and with a payslip of their own", () => {
    const staff = [
      { uid: "u-gm", name: "سائد", trade: "manager", site: "office" as const },
      { uid: "u-acc", name: "محمود", trade: "accountant", site: "office" as const },
      { uid: "u-sup", name: "عبدالرحمن", trade: "foreman", site: "project" as const },
    ]
    const d = buildHrDemo({ ...input, employee: null, staff })
    for (const m of staff) {
      const recs = d.employees.filter((e) => e.userId === m.uid)
      expect(recs).toHaveLength(1)
      expect(recs[0]).toMatchObject({ nationality: "sa", trade: m.trade, names: { ar: m.name } })
      expect(d.pays.get(recs[0].id)).toBeTruthy()
      expect(d.payroll.lines.some((l) => l.employeeId === recs[0].id)).toBe(true)
      expect(d.payslips.find((p) => p.employeeId === recs[0].id)?.employeeUserId).toBe(m.uid)
    }
    // Numbers stay unique and consecutive after the demo's own people.
    const nos = d.employees.map((e) => e.no).sort((a, b) => a - b)
    expect(new Set(nos).size).toBe(nos.length)
    expect(() => buildHrDemo({ ...input, staff: [{ uid: "x", name: "x", trade: "astronaut", site: "office" }] })).toThrow(/unknown trade/)
  })
})
