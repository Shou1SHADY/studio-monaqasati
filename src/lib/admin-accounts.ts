export interface AccountRow {
  id: string
  name: string
  organizationId?: string
  organizationRole?: string
}

export interface AccountCompany {
  /** The company document the component switches are stored under. */
  orgId: string
  /** The company's name: the owner's, for a team member's row. */
  name: string
  /** The owner's name when this row is a team member of another account, else null. */
  memberOf: string | null
}

/**
 * The company an account row belongs to. Component switches live on the company, which is its owner's account, so a
 * team member's row opens the same switches as the owner's — and says whose company it is.
 */
export function companyOf(row: AccountRow, rows: readonly AccountRow[]): AccountCompany {
  const orgId = row.organizationId || row.id
  const member = (row.organizationRole ?? "owner") !== "owner" && orgId !== row.id
  if (!member) return { orgId, name: row.name, memberOf: null }
  const owner = rows.find((r) => r.id === orgId)
  return { orgId, name: owner?.name ?? row.name, memberOf: owner?.name ?? null }
}

export interface CompanyUserDoc {
  id: string
  role?: unknown
  primaryRole?: unknown
  organizationId?: unknown
  organizationRole?: unknown
  [field: string]: unknown
}

export interface CompanyOrgDoc {
  id: string
  role?: unknown
  ownerUserId?: unknown
  [field: string]: unknown
}

export interface ListedCompany {
  /** The company id: its owner's uid for the primary company, the `organizations` doc id for a secondary one. */
  orgId: string
  /** Where the company's identity (name, documents, verification) is stored — and where Verify writes. */
  source: "user" | "org"
  /** The owner's account, when known — a secondary company names it in `ownerUserId`. */
  ownerUserId: string | null
  /** The identity document itself (`users/{orgId}` or `organizations/{orgId}`). */
  doc: Record<string, unknown> & { id: string }
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null)

/**
 * The companies of one role, for the admin's list — ONE row per company, never one per account. A package, a
 * verification and a subscription belong to a company; a team member is a user of his owner's company, not a company.
 *
 * - every owner (or legacy solo account) whose own, primary company has the role → that company, from `users/{uid}`
 *   (the account's role moves with the active company, so the primary one is judged by `primaryRole` when set);
 * - the secondary company an owner is switched into, and every `organizations` doc of the role → that company, from
 *   `organizations/{id}` (a legacy doc without a role takes its active owner's role).
 *
 * `orgOverlays` maps an owner's uid to the `organizations` doc of the company he is switched into, for docs the role
 * query did not return (useIdentityOverlays).
 */
export function companiesOfRole(
  role: string,
  users: readonly CompanyUserDoc[],
  orgs: readonly CompanyOrgDoc[],
  orgOverlays: ReadonlyMap<string, Record<string, unknown>> = new Map(),
): ListedCompany[] {
  const out = new Map<string, ListedCompany>()
  const orgById = new Map(orgs.map((o) => [o.id, o]))
  for (const u of users) {
    const active = str(u.organizationId) ?? u.id
    const member = (str(u.organizationRole) ?? "owner") !== "owner" && active !== u.id
    if (member) continue
    const primaryRole = str(u.primaryRole) ?? (active === u.id ? str(u.role) : null)
    if (primaryRole === role) out.set(u.id, { orgId: u.id, source: "user", ownerUserId: u.id, doc: u })
    if (active !== u.id) {
      const o = orgById.get(active) ?? (orgOverlays.get(u.id) as CompanyOrgDoc | undefined)
      if (o && (str(o.role) ?? str(u.role)) === role) out.set(active, { orgId: active, source: "org", ownerUserId: u.id, doc: { ...o, id: active } })
    }
  }
  for (const o of orgs) {
    if (str(o.role) === role && !out.has(o.id)) out.set(o.id, { orgId: o.id, source: "org", ownerUserId: str(o.ownerUserId), doc: o })
  }
  return [...out.values()]
}

/**
 * The role of the company a document stands for: a `users` doc is its owner's PRIMARY company (the account's `role`
 * follows whichever company is active, so `primaryRole` wins when set); an `organizations` doc is a secondary company.
 */
export function companyRoleOf(data: Record<string, unknown> | null | undefined, source: ListedCompany["source"]): string | null {
  if (!data) return null
  return source === "user" ? str(data.primaryRole) ?? str(data.role) : str(data.role)
}
