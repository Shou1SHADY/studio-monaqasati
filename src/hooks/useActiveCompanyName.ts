"use client"

// The display name of the org a user is currently switched into — falls back to
// their own profile name for accounts with no orgMemberships (pre-multi-company).

export interface OrgMembership {
  organizationId: string
  companyName: string
  isPrimary?: boolean
}

export function resolveActiveCompanyName(profile: {
  organizationId?: string
  companyName?: string
  name?: string
  orgMemberships?: OrgMembership[]
} | null | undefined, fallbackOrgId?: string): string | undefined {
  const activeOrgId = profile?.organizationId || fallbackOrgId
  const memberships = profile?.orgMemberships || []
  return memberships.find((m) => m.organizationId === activeOrgId)?.companyName
    || profile?.companyName
    || profile?.name
}
