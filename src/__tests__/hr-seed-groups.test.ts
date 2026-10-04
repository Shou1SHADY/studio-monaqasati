/**
 * HR 1.0 — the seeded groups (PRD RL-01, docs/hr-prd-status.md §3 #17). The seeded `finance` group held
 * `employees.manage`: every Finance member was the company's HR manager too, and no seeded group carried the
 * other four HR roles. Now each HR role has its own seeded group and Finance has none; existing companies are
 * fixed by scripts/migrate-hr-seed-groups.js, which takes the permission back ONLY from a seeded finance group
 * its owner never edited — these pin both.
 */
import fs from "fs"
import path from "path"
import { HR_ROLE_PERMISSION, HR_ROLES, hrRolesOf } from "@/lib/hr/access"
import { ALL_PERMISSION, FINANCE_SEEDS_WITH_HR, PERMISSION_SECTIONS, SEEDED_GROUPS } from "@/lib/permissions"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const script = require("../../scripts/migrate-hr-seed-groups.js") as {
  FINANCE_SEEDS_WITH_HR: string[][]
  HR_SEEDED_GROUPS: Array<{ key: string; name: string; permissions: string[] }>
  planFor: (input: {
    groups: Array<{ id: string; organizationId: string; key?: string | null; name?: string; permissions: string[] }>
    members: Map<string, number>
    orgsWithEmployees: Set<string>
    includeReview?: boolean
    seedHrGroups?: boolean
  }) => { strip: Array<{ id: string }>; review: Array<{ id: string }>; kept: Array<{ id: string; why: string }>; create: Array<{ id: string; permissions: string[] }> }
}

const seeded = (key: string) => SEEDED_GROUPS.find((g) => g.key === key)

describe("the seed (RL-01)", () => {
  it("Finance is no longer the HR manager", () => {
    expect(seeded("finance")?.permissions).not.toContain("employees.manage")
    // …and keeps its own hand in HR: advances above the limit, posting and paying the payroll (hrFinance()).
    expect(seeded("finance")?.permissions).toEqual(expect.arrayContaining(["invoices.manage", "accounting.post"]))
  })

  it("each of the five HR roles has one seeded group, carrying that role and nothing of another module", () => {
    const KEY = { manager: "hr_manager", gov: "hr_gov", payroll: "hr_payroll", supervisor: "hr_supervisor", management: "management" } as const
    for (const role of HR_ROLES) {
      const g = seeded(KEY[role])
      expect({ role, perms: g?.permissions }).toEqual({ role, perms: ["projects.view", HR_ROLE_PERMISSION[role]] })
      // The group gives exactly that role, the way the client and the rules read it.
      expect([...hrRolesOf({ owner: false, permissions: g!.permissions as string[] })]).toEqual([role])
    }
    // No other seeded group (Super Admin's '*' aside) carries an HR role.
    const others = SEEDED_GROUPS.filter((g) => !Object.values(KEY).includes(g.key as (typeof KEY)[keyof typeof KEY]) && !g.permissions.includes(ALL_PERMISSION))
    for (const g of others) for (const p of Object.values(HR_ROLE_PERMISSION)) expect({ g: g.key, p, has: (g.permissions as string[]).includes(p) }).toEqual({ g: g.key, p, has: false })
  })

  it("the team page shows every HR role in the HR section", () => {
    expect(PERMISSION_SECTIONS.find((s) => s.key === "hr")?.permissions.slice().sort()).toEqual(Object.values(HR_ROLE_PERMISSION).sort())
  })

  it("every seeded group has its name in both languages", () => {
    for (const file of ["en", "ar"]) {
      const text = fs.readFileSync(path.join(process.cwd(), "messages", `${file}.json`), "utf8")
      for (const g of SEEDED_GROUPS) expect({ file, key: g.key, named: text.includes(`"team_group_${g.key}": `) }).toEqual({ file, key: g.key, named: true })
    }
  })
})

describe("scripts/migrate-hr-seed-groups.js", () => {
  const sortSets = (sets: readonly (readonly string[])[]) => sets.map((s) => [...s].sort().join(",")).sort()

  it("knows the same old finance seeds and the same HR groups as the code", () => {
    expect(sortSets(script.FINANCE_SEEDS_WITH_HR)).toEqual(sortSets(FINANCE_SEEDS_WITH_HR))
    for (const s of script.HR_SEEDED_GROUPS) expect(s).toEqual({ key: s.key, name: seeded(s.key)?.name, permissions: seeded(s.key)?.permissions })
    expect(script.HR_SEEDED_GROUPS.map((s) => s.key).sort()).toEqual(["hr_gov", "hr_manager", "hr_payroll", "hr_supervisor", "management"])
    // The current seed is not among them: a group seeded from now on is never a candidate.
    expect(sortSets(FINANCE_SEEDS_WITH_HR)).not.toContain([...seeded("finance")!.permissions].sort().join(","))
  })

  const fin = (org: string, perms: string[], over: Record<string, unknown> = {}) => ({ id: `${org}_finance`, organizationId: org, key: "finance", name: "المالية", permissions: perms, ...over })
  const [aug12, , , sep22] = FINANCE_SEEDS_WITH_HR.map((s) => [...s])

  it("strips only an untouched seeded finance group — never an edited one, never a group the owner made", () => {
    const plan = script.planFor({
      groups: [
        fin("a", sep22),
        fin("b", [...aug12].reverse()), // order does not matter
        fin("c", [...sep22, "crm.manage"]), // the owner added to it
        fin("d", sep22.filter((p) => p !== "offers.accept")), // the owner removed from it
        { id: "e_hr", organizationId: "e", key: null, name: "HR", permissions: ["employees.manage"] }, // made by hand
        fin("f", sep22, { id: "f_custom" }), // key finance, not the seeded id
        fin("g", ["projects.view", "invoices.manage"]), // nothing to take
      ],
      members: new Map(),
      orgsWithEmployees: new Set(),
    })
    expect(plan.strip.map((g) => g.id).sort()).toEqual(["a_finance", "b_finance"])
    expect(plan.kept.map((g) => g.id).sort()).toEqual(["c_finance", "d_finance", "e_hr", "f_custom"])
    expect(plan.review).toEqual([])
  })

  it("a company that runs HR through its finance members alone is left for review — until the owner says so", () => {
    const groups = [fin("a", sep22), { id: "a_viewer", organizationId: "a", key: "viewer", name: "مشاهد", permissions: ["projects.view"] }]
    const members = new Map([["a_finance", 2]])
    const runs = new Set(["a"])
    expect(script.planFor({ groups, members, orgsWithEmployees: runs }).review.map((g) => g.id)).toEqual(["a_finance"])
    expect(script.planFor({ groups, members, orgsWithEmployees: runs, includeReview: true }).strip.map((g) => g.id)).toEqual(["a_finance"])
    // No HR records, no members, or another HR group with members: stripped.
    expect(script.planFor({ groups, members, orgsWithEmployees: new Set() }).strip.map((g) => g.id)).toEqual(["a_finance"])
    expect(script.planFor({ groups, members: new Map(), orgsWithEmployees: runs }).strip.map((g) => g.id)).toEqual(["a_finance"])
    const withHr = [...groups, { id: "a_hrm", organizationId: "a", key: null, name: "HR", permissions: ["employees.manage"] }]
    expect(script.planFor({ groups: withHr, members: new Map([["a_finance", 2], ["a_hrm", 1]]), orgsWithEmployees: runs }).strip.map((g) => g.id)).toEqual(["a_finance"])
  })

  it("--seed-hr-groups creates the missing HR groups of a seeded company, at their ids, never over one that exists", () => {
    const groups = [fin("a", sep22), { id: "a_hr_manager", organizationId: "a", key: "hr_manager", name: "x", permissions: ["employees.manage", "crm.manage"] }, { id: "z_custom", organizationId: "z", key: null, name: "c", permissions: ["projects.view"] }]
    const plan = script.planFor({ groups, members: new Map(), orgsWithEmployees: new Set(), seedHrGroups: true })
    expect(plan.create.map((g) => g.id).sort()).toEqual(["a_hr_gov", "a_hr_payroll", "a_hr_supervisor", "a_management"])
    expect(script.planFor({ groups, members: new Map(), orgsWithEmployees: new Set() }).create).toEqual([])
  })

  it("is a dry run unless --apply, and writes nothing but the removal and the creations", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "scripts", "migrate-hr-seed-groups.js"), "utf8")
    expect(src).toMatch(/const apply = process\.argv\.includes\("--apply"\)/)
    expect(src).toMatch(/if \(!apply\) \{[\s\S]*?return/)
    expect(src).toMatch(/FieldValue\.arrayRemove\(HR\)/)
    expect(src).toMatch(/batch\.create\(/)
    expect(src).not.toMatch(/batch\.set\(|batch\.delete\(|\.doc\([^)]*\)\.(set|delete)\(/)
    expect(src).toMatch(/if \(require\.main === module\)/)
  })
})
