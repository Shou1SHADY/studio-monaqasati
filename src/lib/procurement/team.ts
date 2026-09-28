// Procurement's team (the prototype's USERS): the buyers and the categories
// each buys, whether the owner has a team, and the viewer's own scope. Pure —
// the hook (`useProcTeam`) hands in the members with a `can` already resolved.
//
// A buyer is whoever prepares orders (offers.accept) or runs RFQs (rfq.manage)
// without approving them; `procurementCategories` on his user document scopes
// him. No categories = every category: a hidden need is a site that stops.

import type { PermissionId } from "../permissions"
import type { BuyerScope } from "./need-desk"
import type { ProcActor } from "./types"

export interface TeamMemberFact {
  id: string
  name: string
  procurementCategories?: unknown
  can: (permission: PermissionId) => boolean
  isOwner: boolean
}

export interface ProcTeam {
  buyers: BuyerScope[]
  /** Anyone besides the owner prepares, sources or approves orders. */
  ownerHasTeam: boolean
  /** The viewer's categories when he is a buyer; null = all. */
  viewerCategories: string[] | null
}

export const cleanCategories = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()))) : []

const sources = (m: Pick<TeamMemberFact, "can">) => m.can("offers.accept") || m.can("rfq.manage")

export function procTeam(members: TeamMemberFact[], viewer: Pick<ProcActor, "isOwner" | "canApprove" | "canPrepare"> & { canSource?: boolean }, viewerCategoriesRaw: unknown): ProcTeam {
  const staff = members.filter((m) => !m.isOwner && (sources(m) || m.can("po.approve")))
  const buyers = staff.filter((m) => sources(m) && !m.can("po.approve")).map((m) => ({ uid: m.id, name: m.name, categories: cleanCategories(m.procurementCategories) }))
  const isBuyer = !viewer.isOwner && !viewer.canApprove && (viewer.canPrepare || Boolean(viewer.canSource))
  const own = cleanCategories(viewerCategoriesRaw)
  return { buyers, ownerHasTeam: staff.length > 0, viewerCategories: isBuyer && own.length ? own : null }
}

/** Who may set a buyer's categories: the owner, or the procurement manager
 * (po.approve) — mirrored by the users rule that lets them write that one field. */
export const canAssignCategories = (viewer: { isOwner: boolean; canApprove: boolean }): boolean => viewer.isOwner || viewer.canApprove

/** The server's gate on a supplier invitation: the owner (`can` passes every
 * permission for him), the procurement manager or a buyer. */
export const mayInviteSuppliers = (can: (permission: PermissionId) => boolean): boolean => can("po.approve") || can("offers.accept")

