// Project Management 1.0 — who may do what on a project (PRD §3, §4; S-09, S-10).
//
// A person's permission on a project is the intersection of three layers, each
// narrowing the one above and never granting: the system ceiling (what the
// company lets them do anywhere) ∩ their project role's template − the duties
// removed from them on this project. The riyal approval limit is never edited
// from a project.
//
// Every action is checked against one table (PM_GUARD) before any handler runs —
// the same table the rules and the server enforce. A button guard alone was how
// 55 handlers ended up unguarded in the prototype. Pure: no I/O.

/** The 14 duties a project assigns. Every one guards at least one action (RL-03). */
export const PM_DUTIES = [
  "measure",
  "daily",
  "qa",
  "hse",
  "req",
  "rcv",
  "sub",
  "approve",
  "vo",
  "prep",
  "ipc",
  "ipcOk",
  "client",
  "corr",
] as const
export type PmDuty = (typeof PM_DUTIES)[number]

/** Grouped as the assignment screen shows them — fourteen loose boxes do not read. */
export const PM_DUTY_GROUPS: Array<{ key: "site" | "supply" | "money"; duties: PmDuty[] }> = [
  { key: "site", duties: ["measure", "daily", "qa", "hse"] },
  { key: "supply", duties: ["req", "rcv", "sub"] },
  { key: "money", duties: ["approve", "vo", "prep", "ipc", "ipcOk", "client", "corr"] },
]

/** System keys: a project never narrows them. `money` sees amounts, `all` sees
 * every project, `create` creates projects and imports BOQs, `admin` governs. */
export const PM_SYSTEM_KEYS = ["money", "all", "admin", "create"] as const
export type PmSystemKey = (typeof PM_SYSTEM_KEYS)[number]
export type PmKey = PmDuty | PmSystemKey

/** Project roles. Exactly one `pm` per project; `other` is named and starts empty. */
export const PM_PROJECT_ROLES = ["pm", "site", "qs", "hse", "supervisor", "other"] as const
export type PmProjectRole = (typeof PM_PROJECT_ROLES)[number]

/** What each project role gives by default. `other` offers every duty to tick,
 * but grants none until ticked — which is stored as the removed list's complement. */
export const PM_ROLE_TEMPLATES: Record<PmProjectRole, readonly PmDuty[]> = {
  pm: PM_DUTIES,
  site: ["measure", "daily", "qa", "req", "rcv"],
  qs: ["measure", "prep", "ipc", "vo", "client", "corr", "sub"],
  hse: ["daily", "hse"],
  supervisor: ["daily"],
  other: PM_DUTIES,
}

/** The company-level ceilings the PRD ships with (§3), for seeding groups. */
export const PM_SYSTEM_CEILINGS: Record<"owner" | "pm" | "site" | "qs", readonly PmKey[]> = {
  owner: [...PM_DUTIES, ...PM_SYSTEM_KEYS],
  pm: ["money", "create", "approve", "measure", "ipc", "vo", "req", "client", "prep", "ipcOk", "rcv", "qa", "hse", "corr", "sub"],
  site: ["measure", "daily", "req", "rcv", "qa", "hse"],
  qs: ["money", "all", "ipc", "measure", "vo", "client", "prep", "corr", "sub"],
}

/** A seat on a project's team. `off` holds duties removed from this person here.
 * Leaving is dated, never deleted: `to` is the exit day (inclusive of history). */
export interface PmSeat {
  uid: string
  role: PmProjectRole
  /** Required for `other` — an unnamed role cannot be analysed (S-12). */
  roleName?: string | null
  off?: PmDuty[]
  from?: string | null
  to?: string | null
}

/** Whether a seat is live on `today` (`YYYY-MM-DD`). Someone removed with
 * today's date is off the team today — the prototype once read "0 days" as
 * "no date" and kept them approving. */
export function seatActive(seat: Pick<PmSeat, "to">, today: string): boolean {
  return !seat.to || seat.to > today
}

export interface PmContext {
  /** The person's system ceiling: which keys the company grants them anywhere. */
  ceiling: ReadonlySet<PmKey>
  /** Their live seat on this project, or null when they are not on its team. */
  seat: PmSeat | null
  /** An archived project is read-only forever, for everyone (RL-04, INV-21). */
  archived: boolean
}

/** The duties this person holds on this project, or null when they are not on
 * its team. Narrowing only: nothing outside the ceiling or the template is ever
 * returned, whatever the role is called. */
export function effectiveDuties(ceiling: ReadonlySet<PmKey>, seat: PmSeat | null): PmDuty[] | null {
  if (!seat) return null
  const removed = new Set(seat.off ?? [])
  return PM_ROLE_TEMPLATES[seat.role].filter((d) => ceiling.has(d) && !removed.has(d))
}

/** Can this person use `key` here? System keys come from the ceiling alone; a
 * duty needs the ceiling AND the seat. Someone with `all` and no seat keeps
 * their ceiling (the owner, the QS office); anyone else off the team holds no duty. */
export function pmCan(ctx: PmContext, key: PmKey): boolean {
  if (!ctx.ceiling.has(key)) return false
  if ((PM_SYSTEM_KEYS as readonly string[]).includes(key)) return true
  if (ctx.archived) return false
  const duties = effectiveDuties(ctx.ceiling, ctx.seat)
  if (duties === null) return ctx.ceiling.has("all")
  return duties.includes(key as PmDuty)
}

/** Whether this person sees the project at all: on its team, or holding `all`. */
export function pmSeesProject(ctx: Pick<PmContext, "ceiling" | "seat">): boolean {
  return Boolean(ctx.seat) || ctx.ceiling.has("all")
}

// ---------------------------------------------------------------------------
// The guard: action → requirement. One table, checked before every handler.
// ---------------------------------------------------------------------------

type Req = { all?: PmKey[]; any?: PmKey[] }

/** Every guarded action (PRD §4, 117 prototype actions grouped by what they do). */
export const PM_GUARD = {
  "measurement.write": { all: ["measure"] },
  "item.rate.set": { all: ["measure", "money"] },
  "daily.write": { all: ["daily"] },
  "qa.record": { all: ["qa"] },
  "submittal.record": { any: ["measure", "approve"] },
  "weeklyPlan.manage": { any: ["measure", "approve"] },
  "hse.record": { all: ["hse"] },
  "supply.request": { all: ["req"] },
  "store.move": { all: ["req"] },
  "plant.request": { all: ["req"] },
  "supply.stopUnarrived": { any: ["req", "approve"] },
  "supply.receive": { all: ["rcv"] },
  "subcontract.manage": { all: ["sub"] },
  "variation.log": { all: ["vo"] },
  "claim.draft": { any: ["prep", "approve"] },
  "addendum.draft": { any: ["prep", "approve"] },
  "item.price": { any: ["prep", "approve"] },
  "certificate.prepare": { all: ["prep", "ipc", "client"] },
  "certificate.certify": { all: ["ipcOk"] },
  "correspondence.write": { all: ["corr"] },
  "programme.manage": { all: ["approve"] },
  "request.decide": { all: ["approve"] },
  "reconciliation.manage": { all: ["approve"] },
  "document.manage": { all: ["approve"] },
  "project.edit": { all: ["approve"] },
  "consultantPortal.manage": { all: ["approve"] },
  "claim.submit": { all: ["approve"] },
  "claim.respond": { all: ["approve"] },
  "measurement.approve": { all: ["approve"] },
  "sections.manage": { all: ["approve"] },
  "project.start": { all: ["approve"] },
  "handover.provisional": { all: ["approve"] },
  "handover.final": { all: ["approve"] },
  "project.close": { all: ["approve"] },
  "project.archive": { all: ["approve"] },
  "deliveryUnit.manage": { all: ["approve"] },
  "addendum.sign": { all: ["approve"] },
  "change.decide": { all: ["approve"] },
  "store.approve": { all: ["approve"] },
  "variation.decide": { all: ["approve"] },
  "project.create": { all: ["create"] },
  "boq.import": { all: ["create"] },
  "terms.complete": { all: ["money"], any: ["all", "approve"] },
} as const satisfies Record<string, Req>
export type PmAction = keyof typeof PM_GUARD

export type PmRefusal = "archived" | "no_duty" | "not_on_team"

/** The one check every handler runs first. Null means allowed. */
export function pmRefusal(ctx: PmContext, action: PmAction): PmRefusal | null {
  const req: Req = PM_GUARD[action]
  const keys = [...(req.all ?? []), ...(req.any ?? [])]
  const needsDuty = keys.some((k) => !(PM_SYSTEM_KEYS as readonly string[]).includes(k))
  if (needsDuty && ctx.archived) return "archived"
  if (needsDuty && !ctx.seat && !ctx.ceiling.has("all")) return "not_on_team"
  const allOk = (req.all ?? []).every((k) => pmCan(ctx, k))
  const anyOk = !req.any || req.any.some((k) => pmCan(ctx, k))
  return allOk && anyOk ? null : "no_duty"
}

export const pmAllowed = (ctx: PmContext, action: PmAction): boolean => pmRefusal(ctx, action) === null

// ---------------------------------------------------------------------------
// Rules that need the action's data, so they live beside the guard, not in it.
// ---------------------------------------------------------------------------

/** Internal certificate approval: `ipcOk`, never by the person who prepared it —
 * unless the company records self-approval (a small firm with one person). */
export function mayApproveCertificate(ctx: PmContext, actorUid: string, preparedBy: string, selfApprovalAllowed = false): boolean {
  if (!pmCan(ctx, "ipcOk")) return false
  return actorUid !== preparedBy || selfApprovalAllowed
}

/** A subcontractor certificate: `ipcOk`, within the person's riyal limit, never by its preparer. */
export function mayApproveSubCertificate(ctx: PmContext, actorUid: string, preparedBy: string, amount: number, approvalLimit: number): boolean {
  return pmCan(ctx, "ipcOk") && actorUid !== preparedBy && amount <= approvalLimit
}

/** Withdrawing an addendum: whoever drafted it, or `approve`. */
export function mayWithdrawAddendum(ctx: PmContext, actorUid: string, draftedBy: string): boolean {
  if (ctx.archived) return false
  return actorUid === draftedBy ? pmCan(ctx, "prep") || pmCan(ctx, "approve") : pmCan(ctx, "approve")
}

/** Team changes: `all`, or `approve` on one's own project. Appointing or removing
 * the project manager is the owner's alone (`admin`). */
export function mayManageTeam(ctx: PmContext, touchesProjectManager: boolean): boolean {
  if (ctx.archived) return false
  if (touchesProjectManager) return ctx.ceiling.has("admin")
  return ctx.ceiling.has("all") || pmCan(ctx, "approve")
}

/** A handover is answered only by the manager it is addressed to. */
export function mayAnswerHandover(actorUid: string, addressedTo: string): boolean {
  return actorUid === addressedTo
}

/** Team integrity: exactly one live project manager, and every `other` role named. */
export function teamProblems(seats: PmSeat[], today: string): Array<"no_pm" | "two_pms" | "unnamed_other"> {
  const live = seats.filter((s) => seatActive(s, today))
  const pms = live.filter((s) => s.role === "pm").length
  const out: Array<"no_pm" | "two_pms" | "unnamed_other"> = []
  if (pms === 0) out.push("no_pm")
  if (pms > 1) out.push("two_pms")
  if (live.some((s) => s.role === "other" && !s.roleName?.trim())) out.push("unnamed_other")
  return out
}
