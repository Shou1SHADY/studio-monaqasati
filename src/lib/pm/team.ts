// PM 1.0 — the project's team (PRD WF-24, TM-01, RL-05, RL-07, INV-11, INV-20).
// A seat is assigned with a project role, narrowed by removing duties, and
// closed with a reason and an exit date that is today or earlier — access ends
// at once, and whatever the person recorded or approved stays in their name
// (the seat is never deleted). One project manager, appointed or removed by the
// owner alone. Every assignment, duty change and exit is logged with who and
// when, and shown beside the person. Pure: no I/O.

import { PM_DUTIES, PM_ROLE_TEMPLATES, seatActive, type PmDuty, type PmProjectRole, type PmSeat } from "./access"

export interface SeatLogEntry {
  at: string
  by: string
  byName?: string | null
  act: "assign" | "duties" | "remove"
  role?: PmProjectRole
  off?: PmDuty[]
  to?: string
  why?: string
}

/** A seat as stored on `projects/{id}/members/{uid}`. */
export interface StoredSeat extends PmSeat {
  why?: string | null
  byOut?: string | null
  log?: SeatLogEntry[]
}

/** The template's duties minus the ticked ones: what `off` stores. `other` offers
 * every duty and grants none until ticked (PRD §3), which this also covers. */
export const offFromTicked = (role: PmProjectRole, ticked: readonly PmDuty[]): PmDuty[] => PM_ROLE_TEMPLATES[role].filter((d) => !ticked.includes(d))

/** The duties a new seat starts with ticked: the template — except `other`, which starts empty. */
export const defaultTicked = (role: PmProjectRole): PmDuty[] => (role === "other" ? [] : [...PM_ROLE_TEMPLATES[role]])

export type AssignBlock = "no_person" | "unnamed_other" | "pm_owner_only" | "pm_taken"

/** What stops an assignment (or a role change on a live seat). `admin` is the
 * owner's key: only it appoints the project manager or moves someone off that role. */
export function assignBlocks(input: {
  uid: string | null
  role: PmProjectRole
  roleName?: string | null
  /** The member's current live seat on this project, if any. */
  current: Pick<PmSeat, "role"> | null
  projectManagerId: string | null | undefined
  admin: boolean
}): AssignBlock[] {
  const out: AssignBlock[] = []
  if (!input.uid) out.push("no_person")
  if (input.role === "other" && !input.roleName?.trim()) out.push("unnamed_other")
  const touchesPm = input.role === "pm" || input.current?.role === "pm"
  if (touchesPm && !input.admin) out.push("pm_owner_only")
  if (input.role === "pm" && input.projectManagerId && input.projectManagerId !== input.uid) out.push("pm_taken")
  return out
}

export type RemoveBlock = "not_on_team" | "no_reason" | "no_date" | "future_date" | "pm_owner_only"

/** What stops closing a seat. The exit is today or earlier, never later — a
 * future date would leave someone seeing and approving after they left (TM-01). */
export function removeBlocks(input: { seat: Pick<PmSeat, "role" | "to"> | null; exitDate: string | null; reason: string | null; today: string; admin: boolean }): RemoveBlock[] {
  const out: RemoveBlock[] = []
  if (!input.seat || !seatActive(input.seat, input.today)) out.push("not_on_team")
  if (!input.reason?.trim()) out.push("no_reason")
  if (!input.exitDate) out.push("no_date")
  else if (input.exitDate > input.today) out.push("future_date")
  if (input.seat?.role === "pm" && !input.admin) out.push("pm_owner_only")
  return out
}

/** Seats read from the members docs, live first then by who joined earliest. */
export function orderSeats<T extends Pick<PmSeat, "to" | "from" | "role">>(seats: T[], today: string): T[] {
  const rank = (s: T) => (seatActive(s, today) ? 0 : 1)
  return [...seats].sort((a, b) => rank(a) - rank(b) || Number(b.role === "pm") - Number(a.role === "pm") || (a.from ?? "").localeCompare(b.from ?? ""))
}

/** Only known duties survive a write. */
export const cleanDuties = (xs: readonly unknown[]): PmDuty[] => PM_DUTIES.filter((d) => xs.includes(d))
