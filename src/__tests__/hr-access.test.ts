/**
 * HR 1.0 — roles, the guard, tabs and settings (RL-01…04, ES-00, ST-01…06).
 * Mirrors qa_guards.js: the HR manager's own leave goes to management; a
 * supervisor never endorses his own; every staff role has "My file"; an
 * employee sees only "My file"; all features off leaves the core tabs.
 */

import {
  hrAllowed,
  hrRefusal,
  hrRolesOf,
  hrTabs,
  lineManagerOf,
  mayApprovePayroll,
  mayDecideRequest,
  mayEndorse,
  seesPay,
  type HrContext,
  type HrRole,
} from "@/lib/hr/access"
import { defaultFeatures, featureSet, HR_FEATURES, normalizeHrSettings, withBusinessType } from "@/lib/hr/settings"
import { PERMISSION_IDS } from "@/lib/permissions"

const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const ALL = new Set(HR_FEATURES)
const NONE = new Set<never>()

describe("roles come from the team group (RL-01)", () => {
  it("each role has its permission; the owner and '*' are HR manager and management", () => {
    expect([...hrRolesOf({ owner: false, permissions: ["hr.gov", "hr.payroll"] })].sort()).toEqual(["gov", "payroll"])
    expect([...hrRolesOf({ owner: true, permissions: [] })].sort()).toEqual(["management", "manager"])
    expect([...hrRolesOf({ owner: false, permissions: ["*"] })].sort()).toEqual(["management", "manager"])
    for (const p of ["employees.manage", "hr.gov", "hr.payroll", "hr.supervisor", "hr.management"]) expect(PERMISSION_IDS).toContain(p)
  })
})

describe("the guard and pay (RL-02, RL-03)", () => {
  it("pay is hidden from government relations and supervisors — and seen on one's own file", () => {
    expect(seesPay(ctx(["gov"]))).toBe(false)
    expect(seesPay(ctx(["supervisor"]))).toBe(false)
    expect(seesPay(ctx(["payroll"]))).toBe(true)
    expect(seesPay(ctx(["supervisor"], { employeeId: "e1" }), "e1")).toBe(true)
    expect(seesPay(ctx(["supervisor"], { employeeId: "e1" }), "e2")).toBe(false)
  })

  it("payroll prepares and fixes IBANs, never approves; the approver did not prepare", () => {
    expect(hrAllowed(ctx(["payroll"]), "payroll.prepare")).toBe(true)
    expect(hrAllowed(ctx(["payroll"]), "payroll.approve")).toBe(false)
    expect(hrAllowed(ctx(["payroll"]), "iban.approve")).toBe(false)
    expect(hrAllowed(ctx(["manager"]), "iban.fix")).toBe(false)
    expect(mayApprovePayroll(ctx(["manager"], { uid: "m" }), "m")).toBe(false)
    expect(mayApprovePayroll(ctx(["manager"], { uid: "m" }), "p")).toBe(true)
  })

  it("a supervisor acts on his own sites only", () => {
    const sup = ctx(["supervisor"], { sites: ["s1"] })
    expect(hrRefusal(sup, "attendance.record", { site: "s1" })).toBeNull()
    expect(hrRefusal(sup, "attendance.record", { site: "s2" })).toBe("not_your_site")
    expect(hrRefusal(ctx(["payroll"]), "attendance.record", { site: "s2" })).toBeNull()
    expect(hrRefusal(sup, "payroll.prepare")).toBe("no_role")
  })
})

describe("nobody approves his own request (RL-02, LV-05)", () => {
  const manager = ctx(["manager"], { employeeId: "hrm" })
  const management = ctx(["management"], { employeeId: "ceo" })

  it("the HR manager's own leave is not his to decide — it goes to management", () => {
    expect(mayDecideRequest(manager, { employeeId: "hrm", isHrManager: true })).toBe("own_request")
    expect(mayDecideRequest(management, { employeeId: "hrm", isHrManager: true })).toBeNull()
    expect(mayDecideRequest(manager, { employeeId: "w1", isHrManager: false })).toBeNull()
    expect(mayDecideRequest(management, { employeeId: "w1", isHrManager: false })).toBe("no_role")
  })

  it("a supervisor never endorses his own leave; he endorses his site's workers and his reports", () => {
    const sup = ctx(["supervisor"], { employeeId: "sup1", sites: ["s1"] })
    expect(mayEndorse(sup, { employeeId: "sup1", site: "s1" })).toBe(false)
    expect(mayEndorse(sup, { employeeId: "w1", site: "s1" })).toBe(true)
    expect(mayEndorse(sup, { employeeId: "w2", site: "s2" })).toBe(false)
    expect(mayEndorse(ctx([], { employeeId: "lm" }), { employeeId: "w3", site: "s9", lineManagerId: "lm" })).toBe(true)
  })

  it("the line manager is a relation, never oneself (RL-04)", () => {
    const sup = (s: string) => (s === "s1" ? "sup1" : null)
    expect(lineManagerOf({ id: "w1", siteId: "s1" }, sup)).toBe("sup1")
    expect(lineManagerOf({ id: "w1", managerId: "m9", siteId: "s1" }, sup)).toBe("m9")
    expect(lineManagerOf({ id: "sup1", siteId: "s1" }, sup)).toBeNull()
    expect(lineManagerOf({ id: "x", managerId: "x" }, sup)).toBeNull()
  })
})

describe("tabs (RL-01, TD-01, ES-00, ST-02)", () => {
  it("Today first; every staff role with a record has My file; an employee sees only My file", () => {
    for (const r of ["manager", "gov", "payroll", "supervisor", "management"] as HrRole[]) {
      const tabs = hrTabs(ctx([r], { employeeId: "e" }), ALL)
      expect(tabs[0]).toBe("today")
      expect(tabs).toContain("me")
    }
    expect(hrTabs(ctx([], { employeeId: "e" }), ALL)).toEqual(["me"])
    expect(hrTabs(ctx(["gov"]), ALL)).toEqual(["today", "people", "hiring", "platforms", "reports"])
    expect(hrTabs(ctx(["management"]), ALL)).not.toContain("settings")
  })

  it("all features off leaves the core: today, people, sites, payroll, reports, settings", () => {
    expect(hrTabs(ctx(["manager"]), NONE)).toEqual(["today", "people", "sites", "payroll", "reports", "settings"])
  })
})

describe("settings (ST-01…06)", () => {
  it("a new company starts with the core; the business type sets defaults once", () => {
    const s = normalizeHrSettings(null)
    expect(s.features).toEqual([])
    const c = withBusinessType(s, "contractor")
    expect(c.features).toEqual(["hire", "train", "punch", "gov", "mudad"])
    expect(defaultFeatures("developer")).toEqual(["hire", "perf", "punch", "gov", "mudad"])
    const changed = { ...c, features: [] }
    expect(withBusinessType(changed, "developer").features).toEqual([])
    expect(featureSet(c).has("perf")).toBe(false)
  })

  it("unknown features and bad policies are dropped", () => {
    const s = normalizeHrSettings({ features: ["hire", "fly"] as never, policies: { payDay: 99 } as never })
    expect(s.features).toEqual(["hire"])
    expect(s.policies.payDay).toBe(5)
  })
})
