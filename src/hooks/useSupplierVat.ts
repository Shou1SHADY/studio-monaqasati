"use client"

import { useCompanyIdentity } from "@/hooks/useCompanyIdentity"

/**
 * A supplier's tax number, for the screens that show or prefill it. It lives in the
 * supplier's identity document (closed to its own team members, open to us, who are
 * outside it); until the old profile field is removed that field still answers first.
 * Lists never need it: they read only whether a supplier has one.
 */
export function useSupplierVat(orgId: string | null | undefined, legacyVat: string | null | undefined, enabled = true): string {
  const { identity } = useCompanyIdentity(orgId, Boolean(orgId) && enabled, { taxNumber: legacyVat ?? "" })
  return typeof identity.taxNumber === "string" ? identity.taxNumber : ""
}
