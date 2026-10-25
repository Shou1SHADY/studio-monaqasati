// «قادمة» from the team (REQ-05): a «طلب مواد» awaiting approval before Procurement is shown as «بانتظار اعتماد {name}» — read, never
// bought, and watchable: it lands in Incoming as `team:{id}` the moment it is approved. Pure.

import type { TeamApprovalView } from "./team-approval"
import type { UpcomingItem } from "./upcoming"

export function upcomingFromTeamApprovals(views: ReadonlyArray<TeamApprovalView>): UpcomingItem[] {
  return views
    .filter((v) => v.st === "wait")
    .map((v) => ({
      key: v.mrKey,
      kind: "team" as const,
      ref: v.no,
      place: v.place.label,
      by: v.requestedFor || v.requestedBy,
      since: v.sentAt.slice(0, 10),
      lines: v.lines.map((l) => ({ name: l.name, unit: l.unit, qty: l.qty })),
      needBy: v.needBy || null,
      stock: null,
      approvers: v.approvers,
    }))
}
