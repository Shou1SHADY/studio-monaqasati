"use client"

// The employee file's page, for both portals. Who reaches it (RL-01): every HR
// role with the People tab — and a workplace supervisor, who has no People tab
// but opens his own workers' files from his site; for him the page sits under
// "Workplaces" and reads only his workplaces' people (a worker elsewhere is
// "not found"), never their pay (RL-03).

import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { hrRolesOf, hrTabs } from "@/lib/hr/access"
import { HrEmployeeFile } from "./HrEmployeeFile"
import { HrShell, type HrPortal } from "./HrShell"

/** The tab the file belongs to: People, or — for a role without it (the supervisor) — Workplaces. */
export function fileTab(input: { owner: boolean; permissions: readonly string[] }): "people" | "sites" {
  return hrTabs({ roles: hrRolesOf(input), employeeId: null }, new Set()).includes("people") ? "people" : "sites"
}

export function HrEmployeeFilePage({ portal }: { portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const { id } = useParams<{ id: string }>()
  const { user } = useUser()
  const { profile, groups, isOrgOwner } = usePermissions()
  const group = groups.find((g) => g.id === (profile?.defaultGroupId as string | undefined))
  const tab = fileTab({ owner: isOrgOwner, permissions: (group?.permissions as string[] | undefined) ?? [] })
  return (
    <PortalLayout>
      <HrShell portal={portal} tab={tab} title={t("file.title")} description={t("file.description")}>
        {(access) => <HrEmployeeFile access={access} portal={portal} employeeId={id} actor={{ uid: user?.uid ?? "", name: (profile?.name as string) || null }} />}
      </HrShell>
    </PortalLayout>
  )
}
