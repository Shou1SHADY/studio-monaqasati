// Team permission system — single source of truth for the permission catalog,
// seeded groups, and permission resolution. Used by UI gating, API routes,
// and mirrored by firestore.rules (keep the ids in sync when changing).

export const ALL_PERMISSION = "*" as const

export const PERMISSION_IDS = [
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
  "employees.manage",
  "invoices.manage",
  "warehouses.manage",
  "crm.manage",
  // Closing a deal — recording an award, marking it lost, handing it to
  // Projects. Split from `crm.manage` so a sales rep can work the pipeline
  // without being able to declare a win.
  "crm.close",
  "manufacturing.manage",
  // The Sales module: quotations before/after manufacturing and recording a
  // customer's payment. Deliberately separate from `invoices.manage`
  // (Finance) — Sales is its own component, not a Finance page.
  "sales.manage",
  "team.manage",
] as const

export type PermissionId = (typeof PERMISSION_IDS)[number]
export type PermissionValue = PermissionId | typeof ALL_PERMISSION

// Translation key (Portal.Shared namespace) for each permission's label/description.
export function permissionLabelKey(id: PermissionId): string {
  return `perm_${id.replace(".", "_")}`
}
export function permissionDescKey(id: PermissionId): string {
  return `perm_${id.replace(".", "_")}_desc`
}

export interface TeamGroup {
  id: string
  organizationId: string
  // Seeded groups carry a key so the UI can render a translated name;
  // custom groups use the free-text `name` as-is.
  key?: SeededGroupKey | null
  name: string
  permissions: PermissionValue[]
  isSystem?: boolean
  createdAt?: unknown
  updatedAt?: unknown
}

export type SeededGroupKey = "super_admin" | "finance" | "supply_chain" | "viewer"

// Default groups created for an organization the first time the owner opens
// the team page. Doc id is deterministic (`${orgId}_${key}`) so concurrent
// seeding can never duplicate.
export const SEEDED_GROUPS: Array<{
  key: SeededGroupKey
  name: string // fallback display name (Arabic-first, matches default locale)
  permissions: PermissionValue[]
  isSystem: boolean
}> = [
  {
    key: "super_admin",
    name: "مشرف عام",
    permissions: [ALL_PERMISSION],
    isSystem: true,
  },
  {
    key: "finance",
    name: "المالية",
    permissions: [
      "projects.view",
      "projects.publish",
      "offers.view",
      "offers.accept",
      "invoices.manage",
      "employees.manage",
    ],
    isSystem: false,
  },
  {
    key: "supply_chain",
    name: "سلاسل الإمداد",
    permissions: [
      "projects.view",
      "rfq.create",
      "rfq.manage",
      "offers.view",
      "suppliers.manage",
      "deliveries.confirm",
      "warehouses.manage",
    ],
    isSystem: false,
  },
  {
    key: "viewer",
    name: "مشاهد",
    permissions: ["projects.view"],
    isSystem: false,
  },
]

export function seededGroupDocId(organizationId: string, key: SeededGroupKey): string {
  return `${organizationId}_${key}`
}

// Permissions every org member has implicitly, even with no group at all.
// Per product decision: unassigned members get read-only project access.
export const IMPLICIT_MEMBER_PERMISSIONS: PermissionValue[] = ["projects.view"]

export interface PermissionContext {
  /** The caller's user profile (needs organizationRole, defaultGroupId). */
  organizationRole?: string | null
  defaultGroupId?: string | null
  /** All groups of the caller's organization (from teamGroups). */
  groups: TeamGroup[]
  /**
   * The caller's group id on the specific project being checked (from
   * projects/{id}/members). Overrides defaultGroupId when present.
   * Pass `undefined` when checking org-wide (non-project) actions.
   */
  projectGroupId?: string | null
}

function groupGrants(group: TeamGroup | undefined, permission: PermissionId): boolean {
  if (!group) return false
  return group.permissions.includes(ALL_PERMISSION) || group.permissions.includes(permission)
}

/**
 * Resolve whether the caller can perform `permission`.
 * Resolution order: org owner → project-level group → default group → implicit.
 */
export function can(permission: PermissionId, ctx: PermissionContext): boolean {
  if (ctx.organizationRole === "owner") return true

  const effectiveGroupId = ctx.projectGroupId ?? ctx.defaultGroupId ?? null
  if (effectiveGroupId) {
    const group = ctx.groups.find((g) => g.id === effectiveGroupId)
    if (groupGrants(group, permission)) return true
    // A project-level assignment fully replaces the default group for that
    // project; only fall through to implicit permissions, not to the default.
    return IMPLICIT_MEMBER_PERMISSIONS.includes(permission)
  }

  return IMPLICIT_MEMBER_PERMISSIONS.includes(permission)
}

/** Convenience: is this group the locked Super Admin system group? */
export function isSuperAdminGroup(group: Pick<TeamGroup, "key" | "permissions">): boolean {
  return group.key === "super_admin" || group.permissions.includes(ALL_PERMISSION)
}
