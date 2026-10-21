// Settings → «الأدوار» (Procurement 2.0 PRD §4): what each Procurement role does, in the customer's words, as the screens and
// the server apply it — thirteen rows (without Projects) and five columns. The owner holds every act unless he stepped back (question 1).
// What follows the package shows by it: «يرفع طلب مواد» and the requester's column only without Project Management (with it,
// requests come from the projects), «يعلّم الدفع» only without Finance, «يسأل الورشة» only with Manufacturing. Receiving is not a
// Procurement act, nor paying while Finance is in the company. Pure.

import { PERMISSION_SECTIONS, type PermissionId } from "@/lib/permissions"

export const ROLE_COLUMNS = ["owner", "manager", "buyer", "expediter", "requester"] as const
export type RoleColumn = (typeof ROLE_COLUMNS)[number]
/** `limit`: up to the manager's approval limit · `sites`: delivery sites and receivers only, never the policies. */
export type RoleCell = boolean | "limit" | "sites"
export type RoleRowId =
  | "prices"
  | "publish"
  | "compare"
  | "award"
  | "approve"
  | "approve_over"
  | "cancel"
  | "escalate"
  | "expedite"
  | "manual_receipt"
  | "raise_request"
  | "settings"
  | "subscription"
  | "mark_paid"
  | "ask_workshop"

export interface RoleRow {
  id: RoleRowId
  cells: Record<RoleColumn, RoleCell>
}

export interface RoleContext {
  financeOn: boolean
  pmOn: boolean
  mfgOn?: boolean
  ownerStepsBack: boolean
}

/** The requester's column exists only where requests are raised by the team, i.e. without Project Management. */
export const roleColumns = (ctx: Pick<RoleContext, "pmOn">): RoleColumn[] => (ctx.pmOn ? ROLE_COLUMNS.filter((c) => c !== "requester") : [...ROLE_COLUMNS])

export function roleRows(ctx: RoleContext): RoleRow[] {
  const owner = (act: boolean) => (ctx.ownerStepsBack ? act : true)
  const row = (id: RoleRowId, owner_: boolean, manager: RoleCell, buyer: RoleCell, expediter: RoleCell, requester: RoleCell = false): RoleRow => ({
    id,
    cells: { owner: owner_, manager, buyer, expediter, requester },
  })
  const rows: RoleRow[] = [
    row("prices", true, true, true, false),
    row("publish", owner(false), true, true, false),
    row("compare", owner(false), true, true, false),
    row("award", owner(false), true, true, false),
    row("approve", true, "limit", false, false),
    row("approve_over", true, false, false, false),
    row("cancel", owner(false), true, true, false),
    row("escalate", owner(false), true, true, true),
    row("expedite", owner(false), true, true, true),
    row("manual_receipt", owner(false), true, true, false),
    row("settings", true, "sites", false, false),
    row("subscription", true, true, false, false),
  ]
  if (!ctx.pmOn) rows.splice(10, 0, row("raise_request", true, true, true, false, true))
  if (!ctx.financeOn) rows.push(row("mark_paid", true, true, false, false))
  if (ctx.mfgOn) rows.push(row("ask_workshop", owner(false), true, true, false))
  return rows
}

const PROCUREMENT_PERMISSIONS: readonly PermissionId[] = PERMISSION_SECTIONS.find((s) => s.key === "procurement")?.permissions ?? []

/** The requester is no permission: he is a member who holds none of Procurement's — his only entry is «طلباتي». */
export const isRequesterOnly = (has: (permission: PermissionId) => boolean, isOwner: boolean): boolean => !isOwner && PROCUREMENT_PERMISSIONS.every((p) => !has(p))
