// Today's row for a team «طلب مواد» awaiting the viewer's approval (REQ-05): «ط.م-… · طلب مواد من فهد بانتظار اعتمادك», how many
// days it has waited, and «اعتمد أو أعد» — red once it waited past the window (the owner is also told once by the daily job). Only
// what the viewer may decide is a row. Pure.

import type { TeamApprovalView } from "./team-approval"
import type { Task } from "./today"

export const TEAM_APPROVAL_HREF = (id: string) => `/contractor/rfqs/my-requests?approval=${encodeURIComponent(id)}`

export function teamApprovalTasks(views: ReadonlyArray<TeamApprovalView>): Task[] {
  return views
    .filter((v) => v.st === "wait" && v.canDecide)
    .map((v) => ({
      id: `team_approval:${v.id}`,
      kind: "team_approval" as const,
      chip: "req" as const,
      tier: v.overdue ? ("red" as const) : ("normal" as const),
      severity: v.overdue ? ("red" as const) : ("amber" as const),
      due: -v.waitingDays,
      titleKey: "task.team_approval.title",
      titleParams: { ref: v.no, name: v.requestedFor || v.requestedBy },
      subKey: "task.team_approval.sub",
      subParams: { place: v.place.label, count: v.lines.length, days: v.waitingDays },
      subNs: "ProcToday" as const,
      amount: null,
      basis: null,
      href: TEAM_APPROVAL_HREF(v.id),
      actionKey: "actions.decideRequest",
    }))
}

/** Today's list with the approval rows in it: red first, then the nearest date — the order `todayTasks` keeps. */
export function withApprovalTasks(tasks: ReadonlyArray<Task>, approvals: ReadonlyArray<Task>): Task[] {
  const tierOf = (t: Task) => (t.tier === "red" ? 0 : 1)
  return [...tasks, ...approvals].sort((a, b) => tierOf(a) - tierOf(b) || a.due - b.due)
}
