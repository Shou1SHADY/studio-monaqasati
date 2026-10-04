/**
 * HR 1.0 — moving in (ST-05, WF-01 step 8): the ten-step build path computed
 * from the record, each step locked behind the one it needs, and the gaps panel.
 */
import type { HrRole } from "@/lib/hr/access"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import { BUILD_STEPS, buildSteps, nextStep, setupGaps, type BuildInput } from "@/lib/hr/build-path"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { Payroll } from "@/lib/hr/payroll"
import type { HrSite } from "@/lib/hr/sites"

const TODAY = "2026-10-04"
const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: "org", no: 1, names: { ar: id }, nationality: "eg", gender: "m", trade: "mason", category: "labour", siteId: "s1", join: "2026-08-01", source: "local", contract: { type: "open" }, probation: { end: "2026-10-29" }, status: "active", docs: { iqama: "2027-01-01" }, leaveTaken: 0, ...over }) as HrEmployee
const site: HrSite = { id: "s1", organizationId: "org", name: "Tower", type: "project", active: true, supervisorUserId: "sup" }
const empty: BuildInput = { today: TODAY, settings: { establishment: {}, businessType: null }, settingsSaved: false, employees: [], sites: [], teamMembers: 0, lastMonth: [], thisMonth: [], payrolls: [] }
const wm = (month: string, closed: boolean): WorkplaceMonth => ({ id: "w", organizationId: "org", siteId: "s1", month, days: { [`${month}-02`]: { by: "sup", byName: null, at: "", listed: ["e1"], ex: {} } }, declarations: [], closed: closed ? { by: "sup", byName: null, at: "", asIs: false, missing: [] } : null })

describe("ST-05 — the build path", () => {
  it("ten steps; a new company has done none, and the employee onwards wait for what they need", () => {
    const s = buildSteps(empty)
    expect(s.map((x) => x.key)).toEqual([...BUILD_STEPS])
    expect(s.filter((x) => x.done)).toEqual([])
    expect(s.filter((x) => x.locked).map((x) => x.key)).toEqual(["employees", "attendance", "documents", "close", "payroll", "files"])
    expect(nextStep(s)?.key).toBe("establishment")
  })

  it("each step from the record: establishment with its business type, a workplace, the policies saved, a team, people, a sheet, documents", () => {
    const s = buildSteps({ ...empty, settings: { establishment: { name: "X", cr: "1010" }, businessType: "contractor" }, settingsSaved: true, sites: [site], teamMembers: 2, employees: [emp("e1"), emp("e2", { nationality: "sa", docs: {} }), emp("e3", { source: "visa", docs: {} })], thisMonth: [wm("2026-10", false)] })
    const done = Object.fromEntries(s.map((x) => [x.key, x.done]))
    expect(done).toMatchObject({ establishment: true, sites: true, policies: true, team: true, employees: true, attendance: true, documents: true, close: false, payroll: false, files: false })
    expect(s.find((x) => x.key === "employees")?.count).toBe(3)
    expect(nextStep(s)?.key).toBe("close")
    // A non-Saudi with no iqama and no arrival keeps "documents" open.
    expect(buildSteps({ ...empty, sites: [site], employees: [emp("e4", { docs: {} })] }).find((x) => x.key === "documents")?.done).toBe(false)
  })

  it("close → payroll → files, in that order", () => {
    const base = { ...empty, sites: [site], employees: [emp("e1")] }
    expect(buildSteps({ ...base, lastMonth: [wm("2026-09", false)] }).find((x) => x.key === "close")?.done).toBe(false)
    const closed = buildSteps({ ...base, lastMonth: [wm("2026-09", true)] })
    expect(closed.find((x) => x.key === "close")?.done).toBe(true)
    expect(closed.find((x) => x.key === "payroll")).toMatchObject({ done: false, locked: false })
    const paid = buildSteps({ ...base, lastMonth: [wm("2026-09", true)], payrolls: [{ kind: "main", month: "2026-09", state: "paid" }] as unknown as Payroll[] })
    expect(paid.slice(-2).map((x) => x.done)).toEqual([true, true])
    // Joined this month: nobody was on last month, nothing to close yet.
    expect(buildSteps({ ...empty, sites: [site], employees: [emp("n1", { join: "2026-10-01" })] }).find((x) => x.key === "close")).toMatchObject({ done: false, locked: true })
  })
})

describe("ST-05 — what turned out missing", () => {
  it("a site with no supervisor, a non-Saudi with no iqama, a line with no IBAN, a role nobody holds, the HR manager off the record", () => {
    const gaps = setupGaps({
      ctx: { employeeId: null, roles: new Set<HrRole>(["manager"]) },
      employees: [emp("e1", { docs: {} }), emp("e2"), emp("e3", { status: "left", docs: {} })],
      sites: [{ ...site, supervisorUserId: null }, { id: "hq", organizationId: "org", name: "HQ", type: "hq", active: true }],
      pays: new Map<string, EmployeePay>([["e2", { employeeId: "e2", organizationId: "org", basic: 1, housing: 0, transport: 0, iban: "SA1" }]]),
      heldRoles: new Set(),
    })
    expect(gaps.map((g) => g.kind)).toEqual(["site_no_supervisor", "no_iqama", "no_iban", "no_payroll_officer", "no_gov_officer", "manager_not_on_record"])
    expect(gaps[0].params).toEqual({ site: "Tower" })
    const none = setupGaps({ ctx: { employeeId: "me", roles: new Set<HrRole>(["manager"]) }, employees: [emp("e2")], sites: [site], pays: null, heldRoles: new Set(["payroll", "gov"]) })
    expect(none).toEqual([])
  })
})
