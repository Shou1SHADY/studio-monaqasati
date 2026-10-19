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
