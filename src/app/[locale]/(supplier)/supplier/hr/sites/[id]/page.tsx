"use client"

import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { HrShell } from "@/components/hr/HrShell"
import { HrSiteAttendance } from "@/components/hr/HrSiteAttendance"
import { useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"

export default function HrSiteAttendancePage() {
  const t = useTranslations("Portal.HR")
  const { id } = useParams<{ id: string }>()
  const { user } = useUser()
  const { profile } = usePermissions()
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="sites" title={t("att.title")} description={t("att.description")}>
        {(access) => <HrSiteAttendance access={access} siteId={id} actor={{ uid: user?.uid ?? "", name: (profile?.name as string) || null }} />}
      </HrShell>
    </PortalLayout>
  )
}
