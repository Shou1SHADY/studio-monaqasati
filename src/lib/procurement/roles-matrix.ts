// Settings → «الأدوار» (Procurement 1.5, PUR-08): what each Procurement role does, in the
// customer's words, as the screens and the server apply it. The owner holds every act unless
// he stepped back (question 1). What follows the package shows by it: «يعلّم الدفع» only
// without Finance, «يرفع طلب مواد» only without Project Management — and then every column
// holds it, the expediter's included: any member raises one from his tasks or «طلباتي»
// (`/contractor/rfqs/my-requests`), whatever tabs he can open. Receiving is not a Procurement
// act, nor paying while Finance is in the company. Pure.

export const ROLE_COLUMNS = ["owner", "manager", "buyer", "expediter"] as const
export type RoleColumn = (typeof ROLE_COLUMNS)[number]
export type RoleCell = boolean | "limit"
export type RoleRowId = "prices" | "publish" | "award" | "approve" | "expedite" | "invite" | "mark_paid" | "raise_request"

export interface RoleRow {
  id: RoleRowId
  cells: Record<RoleColumn, RoleCell>
}

export function roleRows(ctx: { financeOn: boolean; pmOn: boolean; ownerStepsBack: boolean }): RoleRow[] {
  const owner = (act: boolean) => (ctx.ownerStepsBack ? act : true)
  const rows: RoleRow[] = [
    { id: "prices", cells: { owner: true, manager: true, buyer: true, expediter: false } },
    { id: "publish", cells: { owner: owner(false), manager: true, buyer: true, expediter: false } },
    { id: "award", cells: { owner: owner(false), manager: true, buyer: true, expediter: false } },
    { id: "approve", cells: { owner: true, manager: "limit", buyer: false, expediter: false } },
    { id: "expedite", cells: { owner: owner(false), manager: true, buyer: true, expediter: true } },
    { id: "invite", cells: { owner: owner(false), manager: true, buyer: true, expediter: false } },
  ]
  if (!ctx.financeOn) rows.push({ id: "mark_paid", cells: { owner: true, manager: true, buyer: false, expediter: false } })
  if (!ctx.pmOn) rows.push({ id: "raise_request", cells: { owner: true, manager: true, buyer: true, expediter: true } })
  return rows
}
