"use client"

// Today (اليوم) — every role's first page (D1, TD-03), and each role sees its
// own: the manager's decisions grouped by order and who holds the rest, the
// lead's station queue, Quality's inspections and block notices, the cost
// controller's reconciliation, management's workshop in SAR. The role comes
// from the switcher in the frame; the screen stores nothing.

import { useTranslations } from "next-intl"
import { UserCog } from "lucide-react"
import { usePermissions } from "@/hooks/usePermissions"
import { useMfgUi } from "./MfgUiContext"
import { MfgEmpty, MfgPanel } from "./ui/MfgUi"
import { TodaySkeleton } from "./MfgTodayBits"
import { MfgTodayManager } from "./MfgTodayManager"
import { MfgTodayLead } from "./MfgTodayLead"
import { MfgTodayQc } from "./MfgTodayQc"
import { MfgTodayCost } from "./MfgTodayCost"
import { MfgTodayManagement } from "./MfgTodayManagement"

export function MfgTodayView() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { isLoading } = usePermissions()

  if (!ui.data.ready || isLoading) return <TodaySkeleton />

  switch (ui.persona) {
    case "manager":
      return <MfgTodayManager />
    case "lead":
      return <MfgTodayLead />
    case "qc":
      return <MfgTodayQc />
    case "cost":
      return <MfgTodayCost />
    case "management":
      return <MfgTodayManagement />
    default:
      return (
        <MfgPanel>
          <MfgEmpty icon={UserCog} title={t("mfw_no_role_title")} hint={t("mfw_no_role_hint")} />
        </MfgPanel>
      )
  }
}
