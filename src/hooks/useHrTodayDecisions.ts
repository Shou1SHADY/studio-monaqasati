"use client"

// HR 1.0 — Today's decisions for the viewer, ONE computation for the page and
// the tab rail (TD-01: the Today tab's count is the number of rows on Today):
// the computed rows (todayItems), the requests, penalties and letters waiting
// for this viewer's hand, and which HR roles the company's members hold
// (government relations' rows fall to the HR manager when nobody holds it).

import { useMemo } from "react"
import { useHrViolations, violationWaits } from "@/components/hr/HrViolationList"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrGrowth } from "@/hooks/useHrGrowth"
import { useHrLetters } from "@/hooks/useHrLetters"
import { useHrToday } from "@/hooks/useHrToday"
import { useHrTodayRoles } from "@/hooks/useHrTodayRoles"
import { growthTodayItems } from "@/lib/hr/growth-today"
import { lettersToSign } from "@/lib/hr/letters"
import { requestActions } from "@/lib/hr/requests"
import { featureSet } from "@/lib/hr/settings"
import { decisionCount, todayItems } from "@/lib/hr/today"

export function useHrTodayDecisions(access: HrAccess, today: string) {
  const world = useHrToday(access, today)
  // The members list is the HR manager's to read (build path, gaps, who holds government relations).
  const heldRoles = useHrTodayRoles(access, access.ctx.roles.has("manager"))
  const violations = useHrViolations(access)
  const { letters } = useHrLetters(access)
  // The optional growth features' rows (train / perf) — computed from what this viewer may read.
  const growth = useHrGrowth(access)
  return useMemo(() => {
    // TD-02 — what waits for this viewer's hand (cancelling is not a decision).
    const waiting = world.requests.filter((r) => requestActions(access.ctx, r, { today, financeAllowed: false }).some((a) => a !== "cancel"))
    const vWaiting = violations.filter((v) => violationWaits(access, v))
    // EM-08 — letters waiting for this viewer's signature are people's requests too.
    const lWaiting = access.allowed("letter.sign") ? lettersToSign(access.ctx, letters) : []
    const core = todayItems({
      ctx: access.ctx,
      today,
      renewWindowDays: access.settings.policies.renewWindowDays,
      ...world,
      visas: access.settings.establishment.visas ?? null,
      govHeld: heldRoles.isLoading ? undefined : heldRoles.held.has("gov"),
    })
    const grown = growthTodayItems({
      ctx: access.ctx,
      today,
      features: featureSet(access.settings),
      renewWindowDays: access.settings.policies.renewWindowDays,
      recordWeight: access.settings.policies.recordWeight,
      employees: world.employees,
      sites: world.sites,
      sessions: growth.sessions,
      cycle: growth.cycle,
      reviews: growth.reviews,
      pays: world.pays,
    })
    const rank = { red: 0, amber: 1, blue: 2 }
    const items = [...core, ...grown].sort((a, b) => rank[a.severity] - rank[b.severity])
    const count = decisionCount(items, waiting.length + vWaiting.length + lWaiting.length)
    const urgent = items.some((x) => x.severity === "red" && !x.waiting)
    return { world, items, waiting, violations, vWaiting, lWaiting, heldRoles, count, urgent }
  }, [world, access, today, violations, letters, heldRoles, growth])
}
