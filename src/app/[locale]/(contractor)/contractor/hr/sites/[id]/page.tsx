"use client"

import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { HrShell } from "@/components/hr/HrShell"
import { HrSitePanel } from "@/components/hr/HrSitePanel"
import { HrSiteAttendance } from "@/components/hr/HrSiteAttendance"
import { HrSiteWorkers } from "@/components/hr/HrSiteWorkers"
import { useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"

export default function HrSitePage() {
  const t = useTranslations("Portal.HR")
  const { id } = useParams<{ id: string }>()
  const { user } = useUser()
  const { profile } = usePermissions()
  return (
    <PortalLayout>
      <HrShell portal="contractor" tab="sites" description={t("site.page_desc")}>
        {(access) => {
          const actor = { uid: user?.uid ?? "", name: (profile?.name as string) || null }
          return (
            <div className="space-y-6">
              <HrSitePanel access={access} siteId={id} actor={actor} portal="contractor" />
              <HrSiteAttendance access={access} siteId={id} actor={actor} />
              <HrSiteWorkers access={access} siteId={id} />
            </div>
          )
        }}
      </HrShell>
    </PortalLayout>
  )
}
