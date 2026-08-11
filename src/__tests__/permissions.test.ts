/**
 * Unit tests for src/lib/permissions.ts
 *
 * Covers:
 *  1. can() resolution — owner fast-path, project-group override, default group, implicit fallback
 *  2. ALL_PERMISSION wildcard (super_admin)
 *  3. PERMISSION_IDS catalog completeness and shape
 *  4. SEEDED_GROUPS structure and per-group permission sets
 *  5. permissionLabelKey / permissionDescKey helpers
 *  6. isSuperAdminGroup helper
 *  7. seededGroupDocId helper
 *  8. IMPLICIT_MEMBER_PERMISSIONS
 *  9. Edge cases (unknown groupId, empty groups array, null IDs)
 */

import {
  can,
  ALL_PERMISSION,
  PERMISSION_IDS,
  SEEDED_GROUPS,
  IMPLICIT_MEMBER_PERMISSIONS,
  permissionLabelKey,
  permissionDescKey,
  isSuperAdminGroup,
  seededGroupDocId,
  type PermissionId,
  type TeamGroup,
  type PermissionContext,
} from "../lib/permissions"

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeGroup(overrides: Partial<TeamGroup> & { permissions: TeamGroup["permissions"] }): TeamGroup {
  return {
    id: "g1",
    organizationId: "org1",
    name: "Test Group",
    ...overrides,
  }
}

function makeCtx(overrides: Partial<PermissionContext>): PermissionContext {
  return {
    organizationRole: null,
    defaultGroupId: null,
    groups: [],
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. can() — owner fast-path
// ─────────────────────────────────────────────────────────────────────────────

describe("can() — org owner", () => {
  it("grants every permission to the org owner", () => {
    const ctx = makeCtx({ organizationRole: "owner", groups: [] })
    PERMISSION_IDS.forEach((p) => {
      expect(can(p, ctx)).toBe(true)
    })
  })

  it("grants owner access even when they have no group", () => {
    expect(can("projects.delete", makeCtx({ organizationRole: "owner" }))).toBe(true)
  })

  it("ignores the group when the user is the owner", () => {
    const ctx = makeCtx({
      organizationRole: "owner",
      defaultGroupId: "viewer_group",
      groups: [makeGroup({ id: "viewer_group", permissions: ["projects.view"] })],
    })
    expect(can("projects.delete", ctx)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. can() — default group resolution
// ─────────────────────────────────────────────────────────────────────────────

describe("can() — default group", () => {
  const rfqGroup = makeGroup({ id: "rfq_group", permissions: ["rfq.create", "rfq.manage", "projects.view"] })
  const ctx = makeCtx({
    defaultGroupId: "rfq_group",
    groups: [rfqGroup],
  })

  it("grants a permission the group explicitly carries", () => {
    expect(can("rfq.create", ctx)).toBe(true)
  })

  it("grants a second permission the group carries", () => {
    expect(can("rfq.manage", ctx)).toBe(true)
  })

  it("denies a permission the group does not carry", () => {
    expect(can("projects.delete", ctx)).toBe(false)
  })

  it("denies a finance permission to an rfq group", () => {
    expect(can("invoices.manage", ctx)).toBe(false)
  })

  it("falls back to IMPLICIT_MEMBER_PERMISSIONS when group does not carry the permission", () => {
    const viewerCtx = makeCtx({
      defaultGroupId: "viewer",
      groups: [makeGroup({ id: "viewer", permissions: ["projects.view"] })],
    })
    expect(can("projects.view", viewerCtx)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. can() — project-level group override
// ─────────────────────────────────────────────────────────────────────────────

describe("can() — project-level group override", () => {
  const defaultGroup = makeGroup({ id: "default", permissions: ["projects.view"] })
  const projectGroup = makeGroup({ id: "project_rfq", permissions: ["rfq.create", "rfq.manage", "projects.view", "projects.edit"] })

  const ctx = makeCtx({
    defaultGroupId: "default",
    projectGroupId: "project_rfq",
    groups: [defaultGroup, projectGroup],
  })

  it("uses the project-level group, not the default group", () => {
    expect(can("rfq.create", ctx)).toBe(true)
    expect(can("projects.edit", ctx)).toBe(true)
  })

  it("denies a permission the project group does not carry, even if default would (never true here)", () => {
    expect(can("employees.manage", ctx)).toBe(false)
  })

  it("does NOT fall back to default group when projectGroupId is set", () => {
    const restrictedProjectCtx = makeCtx({
      defaultGroupId: "default",
      projectGroupId: "project_viewer",
      groups: [
        defaultGroup,
        makeGroup({ id: "project_viewer", permissions: ["projects.view"] }),
      ],
    })
    // default group has only projects.view, project group also only projects.view
    // so projects.edit should be denied
    expect(can("projects.edit", restrictedProjectCtx)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. can() — implicit member permissions (no group at all)
// ─────────────────────────────────────────────────────────────────────────────

describe("can() — implicit member permissions (no group)", () => {
  const ctx = makeCtx({ organizationRole: "member", defaultGroupId: null, groups: [] })

  it("grants projects.view implicitly (per product decision)", () => {
    expect(can("projects.view", ctx)).toBe(true)
  })

  it("denies projects.edit without a group", () => {
    expect(can("projects.edit", ctx)).toBe(false)
  })

  it("denies rfq.create without a group", () => {
    expect(can("rfq.create", ctx)).toBe(false)
  })

  it("denies every write permission without a group", () => {
    const writePerms: PermissionId[] = [
      "projects.edit",
      "projects.publish",
      "projects.delete",
      "rfq.create",
      "rfq.manage",
      "offers.accept",
      "suppliers.manage",
      "deliveries.confirm",
      "employees.manage",
      "invoices.manage",
      "warehouses.manage",
      "team.manage",
    ]
    writePerms.forEach((p) => {
      expect(can(p, ctx)).toBe(false)
    })
  })

  it("denies offers.view without a group (not in IMPLICIT_MEMBER_PERMISSIONS)", () => {
    expect(can("offers.view", ctx)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. can() — wildcard (ALL_PERMISSION) in a group
// ─────────────────────────────────────────────────────────────────────────────

describe("can() — wildcard group (super_admin)", () => {
  const superGroup = makeGroup({ id: "sg", permissions: [ALL_PERMISSION] })
  const ctx = makeCtx({ defaultGroupId: "sg", groups: [superGroup] })

  it("grants every permission via wildcard", () => {
    PERMISSION_IDS.forEach((p) => {
      expect(can(p, ctx)).toBe(true)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. can() — unknown / missing group ID
// ─────────────────────────────────────────────────────────────────────────────

describe("can() — unknown groupId", () => {
  const ctx = makeCtx({
    defaultGroupId: "nonexistent_group",
    groups: [makeGroup({ id: "some_other_group", permissions: ["rfq.create"] })],
  })

  it("falls back to implicit permissions when the group is not found", () => {
    expect(can("projects.view", ctx)).toBe(true)   // in IMPLICIT_MEMBER_PERMISSIONS
    expect(can("rfq.create", ctx)).toBe(false)      // not implicit
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. PERMISSION_IDS catalog
// ─────────────────────────────────────────────────────────────────────────────

describe("PERMISSION_IDS", () => {
  it("contains exactly 14 permissions", () => {
    expect(PERMISSION_IDS).toHaveLength(14)
  })

  it("contains the three new permissions added in the latest batch", () => {
    expect(PERMISSION_IDS).toContain("employees.manage")
    expect(PERMISSION_IDS).toContain("invoices.manage")
    expect(PERMISSION_IDS).toContain("warehouses.manage")
  })

  it("contains all core permissions", () => {
    const required: PermissionId[] = [
      "projects.view",
      "projects.edit",
      "projects.publish",
      "projects.delete",
      "rfq.create",
      "rfq.manage",
      "offers.view",
      "offers.accept",
      "suppliers.manage",
      "deliveries.confirm",
      "team.manage",
    ]
    required.forEach((p) => expect(PERMISSION_IDS).toContain(p))
  })

  it("has no duplicate IDs", () => {
    expect(new Set(PERMISSION_IDS).size).toBe(PERMISSION_IDS.length)
  })

  it("all IDs follow the 'noun.verb' pattern", () => {
    PERMISSION_IDS.forEach((p) => {
      expect(p).toMatch(/^[a-z]+\.[a-z_]+$/)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. SEEDED_GROUPS structure and per-group permissions
// ─────────────────────────────────────────────────────────────────────────────

describe("SEEDED_GROUPS", () => {
  it("defines exactly 4 seeded groups", () => {
    expect(SEEDED_GROUPS).toHaveLength(4)
  })

  it("includes super_admin, finance, supply_chain, viewer groups", () => {
    const keys = SEEDED_GROUPS.map((g) => g.key)
    expect(keys).toContain("super_admin")
    expect(keys).toContain("finance")
    expect(keys).toContain("supply_chain")
    expect(keys).toContain("viewer")
  })

  describe("super_admin group", () => {
    const g = SEEDED_GROUPS.find((x) => x.key === "super_admin")!

    it("exists", () => expect(g).toBeDefined())
    it("is a system group", () => expect(g.isSystem).toBe(true))
    it("has the wildcard permission", () => expect(g.permissions).toContain(ALL_PERMISSION))
    it("grants every permission via wildcard context simulation", () => {
      const group = { ...g, id: "sa_id", organizationId: "org1" }
      const ctx = makeCtx({ defaultGroupId: "sa_id", groups: [group] })
      PERMISSION_IDS.forEach((p) => expect(can(p, ctx)).toBe(true))
    })
  })

  describe("finance group", () => {
    const g = SEEDED_GROUPS.find((x) => x.key === "finance")!

    it("exists", () => expect(g).toBeDefined())
    it("is not a system group", () => expect(g.isSystem).toBe(false))
    it("grants invoices.manage", () => expect(g.permissions).toContain("invoices.manage"))
    it("grants employees.manage", () => expect(g.permissions).toContain("employees.manage"))
    it("grants offers.accept", () => expect(g.permissions).toContain("offers.accept"))
    it("does NOT grant rfq.create", () => expect(g.permissions).not.toContain("rfq.create"))
    it("does NOT grant warehouses.manage", () => expect(g.permissions).not.toContain("warehouses.manage"))
    it("does NOT grant projects.delete", () => expect(g.permissions).not.toContain("projects.delete"))

    it("finance context grants invoices.manage", () => {
      const group = { ...g, id: "fin_id", organizationId: "org1" }
      expect(can("invoices.manage", makeCtx({ defaultGroupId: "fin_id", groups: [group] }))).toBe(true)
    })

    it("finance context denies rfq.create", () => {
      const group = { ...g, id: "fin_id", organizationId: "org1" }
      expect(can("rfq.create", makeCtx({ defaultGroupId: "fin_id", groups: [group] }))).toBe(false)
    })
  })

  describe("supply_chain group", () => {
    const g = SEEDED_GROUPS.find((x) => x.key === "supply_chain")!

    it("exists", () => expect(g).toBeDefined())
    it("grants warehouses.manage", () => expect(g.permissions).toContain("warehouses.manage"))
    it("grants rfq.create", () => expect(g.permissions).toContain("rfq.create"))
    it("grants rfq.manage", () => expect(g.permissions).toContain("rfq.manage"))
    it("grants deliveries.confirm", () => expect(g.permissions).toContain("deliveries.confirm"))
    it("grants suppliers.manage", () => expect(g.permissions).toContain("suppliers.manage"))
    it("does NOT grant employees.manage", () => expect(g.permissions).not.toContain("employees.manage"))
    it("does NOT grant invoices.manage", () => expect(g.permissions).not.toContain("invoices.manage"))

    it("supply_chain context grants warehouses.manage", () => {
      const group = { ...g, id: "sc_id", organizationId: "org1" }
      expect(can("warehouses.manage", makeCtx({ defaultGroupId: "sc_id", groups: [group] }))).toBe(true)
    })

    it("supply_chain context denies invoices.manage", () => {
      const group = { ...g, id: "sc_id", organizationId: "org1" }
      expect(can("invoices.manage", makeCtx({ defaultGroupId: "sc_id", groups: [group] }))).toBe(false)
    })
  })

  describe("viewer group", () => {
    const g = SEEDED_GROUPS.find((x) => x.key === "viewer")!

    it("exists", () => expect(g).toBeDefined())
    it("only grants projects.view", () => {
      expect(g.permissions).toHaveLength(1)
      expect(g.permissions).toContain("projects.view")
    })
    it("viewer context grants projects.view", () => {
      const group = { ...g, id: "v_id", organizationId: "org1" }
      expect(can("projects.view", makeCtx({ defaultGroupId: "v_id", groups: [group] }))).toBe(true)
    })
    it("viewer context denies projects.edit", () => {
      const group = { ...g, id: "v_id", organizationId: "org1" }
      expect(can("projects.edit", makeCtx({ defaultGroupId: "v_id", groups: [group] }))).toBe(false)
    })
    it("viewer context denies rfq.create", () => {
      const group = { ...g, id: "v_id", organizationId: "org1" }
      expect(can("rfq.create", makeCtx({ defaultGroupId: "v_id", groups: [group] }))).toBe(false)
    })
  })

  it("every seeded group has a key, name, permissions, and isSystem field", () => {
    SEEDED_GROUPS.forEach((g) => {
      expect(typeof g.key).toBe("string")
      expect(g.key.length).toBeGreaterThan(0)
      expect(typeof g.name).toBe("string")
      expect(g.name.length).toBeGreaterThan(0)
      expect(Array.isArray(g.permissions)).toBe(true)
      expect(g.permissions.length).toBeGreaterThan(0)
      expect(typeof g.isSystem).toBe("boolean")
    })
  })

  it("no seeded group carries a permission not in PERMISSION_IDS (or is wildcard)", () => {
    SEEDED_GROUPS.forEach((g) => {
      g.permissions.forEach((p) => {
        if (p === ALL_PERMISSION) return
        expect(PERMISSION_IDS).toContain(p)
      })
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. IMPLICIT_MEMBER_PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("IMPLICIT_MEMBER_PERMISSIONS", () => {
  it("is a non-empty array", () => {
    expect(IMPLICIT_MEMBER_PERMISSIONS.length).toBeGreaterThan(0)
  })

  it("contains projects.view (read-only access for unassigned members)", () => {
    expect(IMPLICIT_MEMBER_PERMISSIONS).toContain("projects.view")
  })

  it("does not contain any write permissions", () => {
    const writeable: PermissionId[] = [
      "projects.edit",
      "projects.publish",
      "projects.delete",
      "rfq.create",
      "rfq.manage",
      "offers.accept",
      "suppliers.manage",
      "deliveries.confirm",
      "employees.manage",
      "invoices.manage",
      "warehouses.manage",
      "team.manage",
    ]
    writeable.forEach((p) => {
      expect(IMPLICIT_MEMBER_PERMISSIONS).not.toContain(p)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. permissionLabelKey / permissionDescKey helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("permissionLabelKey", () => {
  it("replaces the dot with an underscore", () => {
    expect(permissionLabelKey("projects.view")).toBe("perm_projects_view")
  })

  it("handles multi-part verb correctly", () => {
    expect(permissionLabelKey("employees.manage")).toBe("perm_employees_manage")
  })

  it("generates the right key for all permission IDs", () => {
    const expected: Record<PermissionId, string> = {
      "projects.view": "perm_projects_view",
      "projects.edit": "perm_projects_edit",
      "projects.publish": "perm_projects_publish",
      "projects.delete": "perm_projects_delete",
      "rfq.create": "perm_rfq_create",
      "rfq.manage": "perm_rfq_manage",
      "offers.view": "perm_offers_view",
      "offers.accept": "perm_offers_accept",
      "suppliers.manage": "perm_suppliers_manage",
      "deliveries.confirm": "perm_deliveries_confirm",
      "employees.manage": "perm_employees_manage",
      "invoices.manage": "perm_invoices_manage",
      "warehouses.manage": "perm_warehouses_manage",
      "team.manage": "perm_team_manage",
    }
    PERMISSION_IDS.forEach((p) => {
      expect(permissionLabelKey(p)).toBe(expected[p])
    })
  })
})

describe("permissionDescKey", () => {
  it("appends _desc to the label key", () => {
    expect(permissionDescKey("projects.view")).toBe("perm_projects_view_desc")
  })

  it("generates _desc keys for all permission IDs", () => {
    PERMISSION_IDS.forEach((p) => {
      expect(permissionDescKey(p)).toBe(`perm_${p.replace(".", "_")}_desc`)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 11. isSuperAdminGroup helper
// ─────────────────────────────────────────────────────────────────────────────

describe("isSuperAdminGroup", () => {
  it("returns true for a group with key === 'super_admin'", () => {
    expect(isSuperAdminGroup({ key: "super_admin", permissions: ["projects.view"] })).toBe(true)
  })

  it("returns true for a group carrying the wildcard permission (custom super-group)", () => {
    expect(isSuperAdminGroup({ key: null, permissions: [ALL_PERMISSION] })).toBe(true)
  })

  it("returns false for a non-admin group without the wildcard", () => {
    expect(isSuperAdminGroup({ key: "finance", permissions: ["invoices.manage"] })).toBe(false)
  })

  it("returns false for the viewer group", () => {
    expect(isSuperAdminGroup({ key: "viewer", permissions: ["projects.view"] })).toBe(false)
  })

  it("returns false for a group with undefined key and no wildcard", () => {
    expect(isSuperAdminGroup({ key: undefined, permissions: ["rfq.create"] })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 12. seededGroupDocId helper
// ─────────────────────────────────────────────────────────────────────────────

describe("seededGroupDocId", () => {
  it("formats as orgId_key", () => {
    expect(seededGroupDocId("org123", "finance")).toBe("org123_finance")
  })

  it("handles different org IDs", () => {
    expect(seededGroupDocId("my-org-xyz", "supply_chain")).toBe("my-org-xyz_supply_chain")
  })

  it("is deterministic — same inputs always produce the same ID", () => {
    const id1 = seededGroupDocId("org1", "viewer")
    const id2 = seededGroupDocId("org1", "viewer")
    expect(id1).toBe(id2)
  })

  it("produces unique IDs for different org + key combos", () => {
    const ids = new Set([
      seededGroupDocId("org1", "super_admin"),
      seededGroupDocId("org1", "finance"),
      seededGroupDocId("org1", "supply_chain"),
      seededGroupDocId("org1", "viewer"),
      seededGroupDocId("org2", "super_admin"),
    ])
    expect(ids.size).toBe(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 13. Role-based UI gating — permission scenarios that the UI depends on
// ─────────────────────────────────────────────────────────────────────────────

describe("UI gating scenarios", () => {
  const makeGroupCtx = (key: "super_admin" | "finance" | "supply_chain" | "viewer") => {
    const seeded = SEEDED_GROUPS.find((g) => g.key === key)!
    const group: TeamGroup = { id: `${key}_id`, organizationId: "org1", key, name: seeded.name, permissions: seeded.permissions, isSystem: seeded.isSystem }
    return makeCtx({ defaultGroupId: group.id, groups: [group] })
  }

  describe("RFQs page — canManageRfqs = can('rfq.manage')", () => {
    it("supply_chain can manage RFQs", () => {
      expect(can("rfq.manage", makeGroupCtx("supply_chain"))).toBe(true)
    })
    it("finance cannot manage RFQs", () => {
      expect(can("rfq.manage", makeGroupCtx("finance"))).toBe(false)
    })
    it("viewer cannot manage RFQs", () => {
      expect(can("rfq.manage", makeGroupCtx("viewer"))).toBe(false)
    })
    it("super_admin can manage RFQs", () => {
      expect(can("rfq.manage", makeGroupCtx("super_admin"))).toBe(true)
    })
  })

  describe("Employees page — canManageEmployees = can('employees.manage')", () => {
    it("finance can manage employees", () => {
      expect(can("employees.manage", makeGroupCtx("finance"))).toBe(true)
    })
    it("supply_chain cannot manage employees", () => {
      expect(can("employees.manage", makeGroupCtx("supply_chain"))).toBe(false)
    })
    it("viewer cannot manage employees", () => {
      expect(can("employees.manage", makeGroupCtx("viewer"))).toBe(false)
    })
  })

  describe("Invoices page — canManageInvoices = can('invoices.manage')", () => {
    it("finance can manage invoices", () => {
      expect(can("invoices.manage", makeGroupCtx("finance"))).toBe(true)
    })
    it("supply_chain cannot manage invoices", () => {
      expect(can("invoices.manage", makeGroupCtx("supply_chain"))).toBe(false)
    })
  })

  describe("Warehouses page — canManageWarehouses = can('warehouses.manage')", () => {
    it("supply_chain can manage warehouses", () => {
      expect(can("warehouses.manage", makeGroupCtx("supply_chain"))).toBe(true)
    })
    it("finance cannot manage warehouses", () => {
      expect(can("warehouses.manage", makeGroupCtx("finance"))).toBe(false)
    })
  })

  describe("Guarantees page — can('offers.accept')", () => {
    it("finance can accept/reject guarantees", () => {
      expect(can("offers.accept", makeGroupCtx("finance"))).toBe(true)
    })
    it("supply_chain cannot accept/reject guarantees", () => {
      expect(can("offers.accept", makeGroupCtx("supply_chain"))).toBe(false)
    })
  })

  describe("Goods Received page — canConfirmDeliveries = can('deliveries.confirm')", () => {
    it("supply_chain can confirm deliveries", () => {
      expect(can("deliveries.confirm", makeGroupCtx("supply_chain"))).toBe(true)
    })
    it("finance cannot confirm deliveries", () => {
      expect(can("deliveries.confirm", makeGroupCtx("finance"))).toBe(false)
    })
  })

  describe("Team page — can('team.manage')", () => {
    it("super_admin can manage team", () => {
      expect(can("team.manage", makeGroupCtx("super_admin"))).toBe(true)
    })
    it("finance cannot manage team via group (only owner can by default)", () => {
      expect(can("team.manage", makeGroupCtx("finance"))).toBe(false)
    })
    it("supply_chain cannot manage team", () => {
      expect(can("team.manage", makeGroupCtx("supply_chain"))).toBe(false)
    })
    it("viewer cannot manage team", () => {
      expect(can("team.manage", makeGroupCtx("viewer"))).toBe(false)
    })
  })

  describe("ContractorCatalog — can('rfq.create')", () => {
    it("supply_chain can create RFQs from catalog", () => {
      expect(can("rfq.create", makeGroupCtx("supply_chain"))).toBe(true)
    })
    it("viewer cannot create RFQs from catalog", () => {
      expect(can("rfq.create", makeGroupCtx("viewer"))).toBe(false)
    })
    it("finance cannot create RFQs from catalog", () => {
      expect(can("rfq.create", makeGroupCtx("finance"))).toBe(false)
    })
  })

  describe("Suppliers page — canManageSuppliers = can('suppliers.manage')", () => {
    it("supply_chain can manage suppliers", () => {
      expect(can("suppliers.manage", makeGroupCtx("supply_chain"))).toBe(true)
    })
    it("finance cannot manage suppliers", () => {
      expect(can("suppliers.manage", makeGroupCtx("finance"))).toBe(false)
    })
  })

  describe("Sidebar — role-based link visibility", () => {
    it("viewer sees projects.view (implicit) but not new-project link (projects.edit)", () => {
      const ctx = makeGroupCtx("viewer")
      expect(can("projects.view", ctx)).toBe(true)
      expect(can("projects.edit", ctx)).toBe(false)
    })

    it("supply_chain sees rfq.create (new-rfq link)", () => {
      expect(can("rfq.create", makeGroupCtx("supply_chain"))).toBe(true)
    })

    it("viewer cannot see new-rfq link", () => {
      expect(can("rfq.create", makeGroupCtx("viewer"))).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 14. Separation of concerns — two roles never get each other's key permissions
// ─────────────────────────────────────────────────────────────────────────────

describe("role separation — finance vs supply_chain", () => {
  const makeGroupCtx = (key: "finance" | "supply_chain") => {
    const seeded = SEEDED_GROUPS.find((g) => g.key === key)!
    const group: TeamGroup = { id: `${key}_id`, organizationId: "org1", key, name: seeded.name, permissions: seeded.permissions, isSystem: seeded.isSystem }
    return makeCtx({ defaultGroupId: group.id, groups: [group] })
  }

  it("finance does not get warehouses.manage", () => {
    expect(can("warehouses.manage", makeGroupCtx("finance"))).toBe(false)
  })
  it("supply_chain does not get employees.manage", () => {
    expect(can("employees.manage", makeGroupCtx("supply_chain"))).toBe(false)
  })
  it("supply_chain does not get invoices.manage", () => {
    expect(can("invoices.manage", makeGroupCtx("supply_chain"))).toBe(false)
  })
  it("finance does not get rfq.create", () => {
    expect(can("rfq.create", makeGroupCtx("finance"))).toBe(false)
  })
  it("finance does not get deliveries.confirm", () => {
    expect(can("deliveries.confirm", makeGroupCtx("finance"))).toBe(false)
  })
  it("supply_chain does not get offers.accept", () => {
    expect(can("offers.accept", makeGroupCtx("supply_chain"))).toBe(false)
  })
})
