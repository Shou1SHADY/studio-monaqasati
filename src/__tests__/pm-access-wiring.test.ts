/**
 * PM 1.0 — the guard reaches real people (PRD §3–4, RL-01/02, TM-01, S-10).
 * The system ceiling comes from the member's DEFAULT group (pm.manage · pm.cost ·
 * pm.site; owner and '*' = everything), the seat from `projects/{id}/members`,
 * and firestore.rules carries the same templates and ceilings as access.ts.
 */

import fs from "fs"
import path from "path"
import {
  PM_CEILING_PERMISSIONS,
  PM_DUTIES,
  PM_ROLE_TEMPLATES,
  PM_SYSTEM_CEILINGS,
  PM_SYSTEM_KEYS,
  PmAccessError,
  assertPm,
  pmAllowed,
  pmCeiling,
  seatActive,
  seatFromMember,
  type PmContext,
} from "@/lib/pm/access"
import { PERMISSION_IDS, PERMISSION_SECTIONS } from "@/lib/permissions"

const sorted = (xs: Iterable<string>) => [...xs].sort()

describe("the system ceiling comes from the default group (RL-01, S-10)", () => {
  it("owner and a '*' group hold the owner's ceiling, admin included", () => {
    expect(sorted(pmCeiling({ owner: true, permissions: [] }))).toEqual(sorted(PM_SYSTEM_CEILINGS.owner))
    expect(pmCeiling({ owner: false, permissions: ["*"] }).has("admin")).toBe(true)
  })

  it("each pm.* permission carries its system role; several add up; none holds nothing", () => {
    expect(sorted(pmCeiling({ owner: false, permissions: ["pm.manage"] }))).toEqual(sorted(PM_SYSTEM_CEILINGS.pm))
    expect(sorted(pmCeiling({ owner: false, permissions: ["pm.cost"] }))).toEqual(sorted(PM_SYSTEM_CEILINGS.qs))
    expect(sorted(pmCeiling({ owner: false, permissions: ["pm.site"] }))).toEqual(sorted(PM_SYSTEM_CEILINGS.site))
    const both = pmCeiling({ owner: false, permissions: ["pm.site", "pm.cost"] })
    expect(both.has("daily") && both.has("all")).toBe(true)
    expect(pmCeiling({ owner: false, permissions: ["projects.edit", "invoices.manage"] }).size).toBe(0)
  })

  it("a project manager's ceiling has no daily report and no `all` (PRD §3)", () => {
    const c = pmCeiling({ owner: false, permissions: ["pm.manage"] })
    expect(c.has("daily")).toBe(false)
    expect(c.has("all")).toBe(false)
    expect(c.has("money") && c.has("create")).toBe(true)
  })

  it("the three ids are real permissions, in the Projects section of the group editor", () => {
    for (const id of Object.keys(PM_CEILING_PERMISSIONS)) {
      expect(PERMISSION_IDS).toContain(id)
      expect(PERMISSION_SECTIONS.find((s) => s.key === "projects")?.permissions).toContain(id)
    }
  })
})

describe("the seat is read from the members doc", () => {
  it("a pre-PM member with no project role holds no seat", () => {
    expect(seatFromMember({ userId: "u1", groupId: "g" })).toBeNull()
    expect(seatFromMember({ userId: "u1", pmRole: "boss" })).toBeNull()
    expect(seatFromMember(null)).toBeNull()
  })

  it("reads role, removed duties (unknown ones dropped), name and dates", () => {
    expect(seatFromMember({ userId: "u1", pmRole: "other", roleName: "Surveyor", off: ["daily", "fly"], from: "2026-09-01", to: null })).toEqual({
      uid: "u1",
      role: "other",
      roleName: "Surveyor",
      off: ["daily"],
      from: "2026-09-01",
      to: null,
    })
  })

  it("an exit dated today removes the person today (TM-01)", () => {
    expect(seatActive({ to: "2026-09-27" }, "2026-09-27")).toBe(false)
    expect(seatActive({ to: null }, "2026-09-27")).toBe(true)
  })
})

describe("every write asserts the guard itself (RL-02)", () => {
  const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "s", role: "site" }, archived: false }
  const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }

  it("refuses with the reason and the action", () => {
    expect(() => assertPm(site, "addendum.sign")).toThrow(PmAccessError)
    try {
      assertPm(site, "terms.complete")
    } catch (e) {
      expect(e).toMatchObject({ code: "no_duty", action: "terms.complete" })
    }
    expect(() => assertPm(owner, "addendum.sign")).not.toThrow()
  })

  it("archived refuses the owner too (RL-04)", () => {
    expect(() => assertPm({ ...owner, archived: true }, "measurement.approve")).toThrow(expect.objectContaining({ code: "archived" }))
    expect(pmAllowed({ ...owner, archived: true }, "project.create")).toBe(true) // a system key is not a change to this project
  })
})

describe("firestore.rules mirror access.ts", () => {
  const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8")
  const list = (text: string) => sorted(text.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean))

  it("pmRoleDuties carries every project role's template", () => {
    const body = rules.slice(rules.indexOf("function pmRoleDuties(role)"), rules.indexOf("function pmCeilingOf("))
    for (const [role, duties] of Object.entries(PM_ROLE_TEMPLATES)) {
      const m =
        role === "pm" || role === "other"
          ? body.match(/role == 'pm' \|\| role == 'other'\s*\? \[([^\]]*)\]/)
          : body.match(new RegExp(`role == '${role}' \\? \\[([^\\]]*)\\]`))
      expect(m).not.toBeNull()
      expect(list(m![1])).toEqual(sorted(duties))
    }
  })

  it("pmCeilingOf carries each system role's ceiling", () => {
    const body = rules.slice(rules.indexOf("function pmCeilingOf("), rules.indexOf("function pmPerms()"))
    for (const [perm, role] of Object.entries(PM_CEILING_PERMISSIONS)) {
      const m = body.match(new RegExp(`p\\.hasAny\\(\\['${perm.replace(".", "\\.")}'\\]\\) && key in \\[([^\\]]*)\\]`))
      expect(m).not.toBeNull()
      expect(list(m![1])).toEqual(sorted(PM_SYSTEM_CEILINGS[role]))
    }
  })

  it("the rules know every duty and system key they may be asked about", () => {
    for (const k of [...PM_DUTIES, ...PM_SYSTEM_KEYS.filter((k) => k !== "admin" && k !== "create")]) expect(rules).toContain(`'${k}'`)
  })
})
