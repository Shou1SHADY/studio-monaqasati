// Kanban-style project status set, replacing the old active/paused/completed 3-value enum.
// Legacy values are mapped for display only — never rewritten in place — so existing
// projects keep working until the next explicit save picks a new-set value.

export const PROJECT_STATUSES = [
  "todo",
  "waiting_approval",
  "pricing",
  "approved_waiting_start",
  "working",
  "hold",
  "remaining_payment",
  "canceled",
] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

const LEGACY_STATUS_MAP: Record<string, ProjectStatus> = {
  active: "working",
  paused: "hold",
  completed: "working",
}

/** Resolves any stored status (new-set or legacy) to a value from PROJECT_STATUSES for display. */
export function resolveProjectStatus(raw: string | undefined | null): ProjectStatus {
  if (!raw) return "todo"
  if ((PROJECT_STATUSES as readonly string[]).includes(raw)) return raw as ProjectStatus
  return LEGACY_STATUS_MAP[raw] || "todo"
}

export function projectStatusLabelKey(status: ProjectStatus): string {
  return `proj_status_${status}`
}

export const PROJECT_STATUS_BADGE_CLASSES: Record<ProjectStatus, string> = {
  todo: "bg-slate-100 text-slate-600 border-slate-200",
  waiting_approval: "bg-amber-100 text-amber-700 border-amber-200",
  pricing: "bg-blue-100 text-blue-700 border-blue-200",
  approved_waiting_start: "bg-cyan-100 text-cyan-700 border-cyan-200",
  working: "bg-accent/10 text-accent border-accent/20",
  hold: "bg-orange-100 text-orange-700 border-orange-200",
  remaining_payment: "bg-rose-100 text-rose-700 border-rose-200",
  canceled: "bg-destructive/10 text-destructive border-destructive/20",
}
