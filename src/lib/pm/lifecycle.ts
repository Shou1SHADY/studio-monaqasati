// PM 1.0 — the project's life (PRD §7): plan → live ⇄ hold → done → closed.
// Execution state is kept apart from money — mixing them was the old system's
// flaw. "live" comes by the manager's Start or, automatically, at the first
// approved measurement; at that moment the original contract freezes.
// Pure: no I/O.

import { resolveProjectStatus } from "../project-status"

export const PM_LIFECYCLE = ["plan", "live", "hold", "done", "closed"] as const
export type PmLifecycle = (typeof PM_LIFECYCLE)[number]

/** Which lifecycle moves exist. done and closed are reached through the handover
 * and close gates (later slices), never from a status picker. */
const MOVES: Record<PmLifecycle, readonly PmLifecycle[]> = {
  plan: ["live"],
  live: ["hold", "done"],
  hold: ["live"],
  done: ["closed"],
  closed: [],
}

export const canMove = (from: PmLifecycle, to: PmLifecycle) => MOVES[from].includes(to)

/** A project made before PM 1.0 has no lifecycle; read its kanban status for
 * display only — never rewritten (the "map, never rewrite" rule of project-status). */
export function lifecycleOf(project: { pm?: { lifecycle?: string | null } | null; status?: string | null }): PmLifecycle {
  const own = project.pm?.lifecycle
  if (own && (PM_LIFECYCLE as readonly string[]).includes(own)) return own as PmLifecycle
  switch (resolveProjectStatus(project.status)) {
    case "working":
      return "live"
    case "hold":
      return "hold"
    case "remaining_payment":
      return "done"
    case "canceled":
      return "closed"
    default:
      return "plan"
  }
}

export type StartBlock = "not_plan" | "no_manager" | "no_boq" | "terms_invalid"

/** What stops "Start" (WF-03: a BOQ and a project manager; the original complete). */
export function startBlocks(input: { lifecycle: PmLifecycle; hasManager: boolean; boqItems: number; termProblems: number }): StartBlock[] {
  const out: StartBlock[] = []
  if (input.lifecycle !== "plan") out.push("not_plan")
  if (!input.hasManager) out.push("no_manager")
  if (input.boqItems === 0) out.push("no_boq")
  if (input.termProblems > 0) out.push("terms_invalid")
  return out
}

/** The effective end: start + original duration + approved extension (§8). */
export function plannedEnd(startDay: string, durationDays: number, extensionDays = 0): string {
  const d = new Date(`${startDay}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + durationDays + extensionDays)
  return d.toISOString().slice(0, 10)
}
