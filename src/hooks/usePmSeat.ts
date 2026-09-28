"use client"

// Which of the four PM seats the viewer holds company-wide (the prototype's
// ROLES): the owner, a project manager (`pm.manage`), QS & cost control
// (`pm.cost`) or a site engineer (everyone else with Projects). It orders the
// decision groups and picks the figures a portfolio page opens with.

import { usePermissions } from "@/hooks/usePermissions"

export type PmSeat = "owner" | "pm" | "qs" | "site"

export function usePmSeat(): PmSeat {
  const { isOrgOwner, can } = usePermissions()
  if (isOrgOwner) return "owner"
  if (can("pm.manage")) return "pm"
  if (can("pm.cost")) return "qs"
  return "site"
}
