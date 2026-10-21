/**
 * Procurement 2.0 §3–§4 — the four roles under the owner as seeded groups, what each holds, and the rules that bound them
 * (settings are the owner's, an order's limit includes VAT, the events outbox is one rule for two collections).
 */

import fs from "fs"
import path from "path"
import { SEEDED_GROUPS, can, type PermissionContext, type PermissionId, type TeamGroup } from "@/lib/permissions"
import { isRequesterOnly } from "@/lib/procurement/roles-matrix"
// eslint-disable-next-line @typescript-eslint/no-require-imports
const script = require("../../scripts/migrate-proc-roles.js") as {
  PROC_SEEDED_GROUPS: Array<{ key: string; name: string; permissions: string[] }>
  planFor: (input: { groups: Array<{ id: string; organizationId: string; key?: string | null; permissions: string[] }>; membersByGroup: Map<string, Array<{ id: string; name: string; email: string }>> }) => {
    create: Array<{ id: string; permissions: string[] }>
    seePrices: Array<{ group: string; members: Array<{ id: string }> }>
  }
}

const KEYS = ["procurement_manager", "procurement_officer", "supply_follower", "material_requester"] as const
const seeded = (key: string) => SEEDED_GROUPS.find((g) => g.key === key)!

/** The way `useProcActor` reads a member: from his default group, through `can()`. */
function member(key: (typeof KEYS)[number] | "supply_chain" | "finance") {
  const g = seeded(key)
  const group: TeamGroup = { id: `${key}_id`, organizationId: "o", key: g.key, name: g.name, permissions: g.permissions }
  const ctx: PermissionContext = { organizationRole: "member", defaultGroupId: group.id, groups: [group] }
  const has = (p: PermissionId) => can(p, ctx)
  const canPrepare = has("offers.accept")
  const canApprove = has("po.approve")
  return {
    has,
    canPrepare,
    canApprove,
    canExpedite: has("po.expedite") || canPrepare || canApprove,
    seesPrices: has("offers.view") || canPrepare || canApprove,
    isRequester: isRequesterOnly(has, false),
  }
}

describe("the seeded Procurement groups (PRD §3)", () => {
  it("there are four, named in Arabic, each with its translation in both languages", () => {
    expect(KEYS.map((k) => seeded(k).name)).toEqual(["مدير المشتريات", "مسؤول المشتريات", "متابع التوريد", "طالب مواد"])
    for (const file of ["en", "ar"]) {
      const text = fs.readFileSync(path.join(process.cwd(), "messages", `${file}.json`), "utf8")
      for (const k of KEYS) expect({ file, k, named: text.includes(`"team_group_${k}": `) }).toEqual({ file, k, named: true })
    }
  })

  it("the manager approves and prepares; the officer prepares and never approves", () => {
    const manager = member("procurement_manager")
    expect(manager).toMatchObject({ canApprove: true, canPrepare: true, seesPrices: true, isRequester: false })
    const officer = member("procurement_officer")
    expect(officer).toMatchObject({ canApprove: false, canPrepare: true, seesPrices: true, canExpedite: true, isRequester: false })
  })

  it("the follower follows dates and sees no price — the seeded supply chain, which holds offers.view, does", () => {
    const follower = member("supply_follower")
    expect(follower).toMatchObject({ canExpedite: true, seesPrices: false, canApprove: false, canPrepare: false, isRequester: false })
    expect(follower.has("offers.view")).toBe(false)
    expect(member("supply_chain").seesPrices).toBe(true)
  })

  it("the requester holds none of Procurement's permissions", () => {
    expect(member("material_requester")).toMatchObject({ isRequester: true, seesPrices: false, canExpedite: false, canApprove: false, canPrepare: false })
  })

  it("nobody here holds Finance's books or HR", () => {
    for (const k of KEYS) {
      const perms = seeded(k).permissions as string[]
      for (const p of ["invoices.manage", "accounting.post", "accounting.view", "employees.manage", "warehouses.manage", "deliveries.confirm"]) expect({ k, p, has: perms.includes(p) }).toEqual({ k, p, has: false })
    }
  })
})

describe("scripts/migrate-proc-roles.js", () => {
  it("carries exactly the seeded groups of the code", () => {
    expect(script.PROC_SEEDED_GROUPS).toEqual(KEYS.map((k) => ({ key: k, name: seeded(k).name, permissions: seeded(k).permissions })))
  })

  const group = (org: string, key: string, permissions: string[] = []) => ({ id: `${org}_${key}`, organizationId: org, key, permissions })

  it("creates the four for a company whose groups were seeded, never for one built by hand, never over one that exists", () => {
    const plan = script.planFor({
      groups: [group("a", "finance"), group("a", "procurement_manager"), group("b", "custom"), group("c", "viewer")],
      membersByGroup: new Map(),
    })
    expect(plan.create.map((g) => g.id).sort()).toEqual(["a_material_requester", "a_procurement_officer", "a_supply_follower", "c_material_requester", "c_procurement_manager", "c_procurement_officer", "c_supply_follower"])
  })

  it("lists, and never changes, the supply chain members who see prices", () => {
    const plan = script.planFor({
      groups: [group("a", "finance"), group("a", "supply_chain", ["offers.view", "po.expedite"]), group("z", "viewer"), group("z", "supply_chain", ["po.expedite"])],
      membersByGroup: new Map([
        ["a_supply_chain", [{ id: "u1", name: "Sara", email: "s@x" }]],
        ["z_supply_chain", [{ id: "u9", name: "Omar", email: "o@x" }]],
      ]),
    })
    expect(plan.seePrices).toEqual([{ group: "a_supply_chain", organizationId: "a", members: [{ id: "u1", name: "Sara", email: "s@x" }] }])
  })

  it("is idempotent: a company that has all four gets nothing", () => {
    const groups = [group("a", "finance"), ...KEYS.map((k) => group("a", k))]
    expect(script.planFor({ groups, membersByGroup: new Map() }).create).toEqual([])
  })
})

describe("firestore.rules (the three edits)", () => {
  const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8")
  const stripped = rules.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ")

  it("the manager's limit is compared including VAT, and an order without a vatRate keeps the old basis", () => {
    expect(stripped).toContain("resource.data.get('totalExVat', 0) * (1 + resource.data.get('vatRate', 0)) <= poManagerLimit()")
  })

  it("procurementSettings: the owner writes it all; whoever approves orders only the sites and the accountant's e-mail", () => {
    const block = stripped.slice(stripped.indexOf("match /procurementSettings/{orgId}"), stripped.indexOf("match /procTeamRequests"))
    expect(block).toContain("hasOnly(['organizationId', 'deliverySites', 'accountantEmail', 'updatedAt', 'updatedById'])")
    expect(block).not.toContain("hasAny([")
    expect(block).toContain("isOrgOwner()")
  })

  it("one outbox rule serves pmEvents and procEvents, create-only, the id being the organisation then the key", () => {
    const block = stripped.slice(stripped.indexOf("match /{outbox}/{eventId}"), stripped.indexOf("match /mfgCounters"))
    expect(block).toContain("outbox in ['pmEvents', 'procEvents']")
    expect(block).toContain("eventId == rd().organizationId + '__' + rd().key.replace('/', '_')")
    expect(block).not.toMatch(/allow (update|delete)[^;]*: if (?!false)/)
    expect(stripped).not.toContain("match /pmEvents/")
  })

  it("stays under the size Google released (150,113 was refused)", () => {
    expect(stripped.length).toBeLessThan(150_000)
  })
})
