"use client"

// HR 1.0 — the numbers on the tab rail (TD-04: a number is the count of the
// screen it opens), as the prototype's TABS: Today = the decisions waiting for
// this viewer (red when one blocks), People = the people in his scope, Sites =
// manpower requests to answer, Payroll = payrolls to approve (HR manager) or
// months to prepare (payroll), My file = his own requests still open.

import { useMemo } from "react"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrTodayDecisions } from "@/hooks/useHrTodayDecisions"
import type { HrTab } from "@/lib/hr/access"
import { todayDay } from "@/lib/hr/format"
import { hrTabCounts } from "@/lib/hr/today"

export type TabCounts = Partial<Record<HrTab, { count: number; urgent?: boolean }>>

export function useHrTodayCounts(access: HrAccess): { counts: TabCounts; govHeld: boolean | undefined } {
  const today = todayDay()
  const d = useHrTodayDecisions(access, today)
  return useMemo(
    () => ({
      counts: {
        ...hrTabCounts({ ctx: access.ctx, items: d.items, decisions: d.count, urgent: d.urgent, employees: d.world.employees, manpower: d.world.manpower, payrolls: d.world.payrolls, requests: d.world.requests }),
        // GV-02 — the Platforms tab counts the tasks past their day (the prototype's TABS).
        ...(d.platforms.late ? { platforms: { count: d.platforms.late, urgent: true } } : {}),
      },
      govHeld: d.heldRoles.isLoading || !access.ctx.roles.has("manager") ? undefined : d.heldRoles.held.has("gov"),
    }),
    [access.ctx, d]
  )
}
