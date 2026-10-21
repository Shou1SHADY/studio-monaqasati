"use client"

// «طلباتي» for any member (Procurement 1.5, PUR-10, question 4): the materials he asked
// Procurement for and where each stands, with «طلب مواد» to ask again — open to every member of a
// company without Project Management, whatever his Procurement permissions. With Project Management
// the request is raised from the project, so this page says so.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Building2 } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { MyTeamRequests } from "@/components/procurement/MyTeamRequests"
import { RaiseMaterialRequest } from "@/components/procurement/RaiseMaterialRequest"
import { Button } from "@/components/ui/button"
import { useUser } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { Link } from "@/i18n/routing"

export default function MyMaterialRequestsPage() {
  const t = useTranslations("Portal.Shared")
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const { on, loading } = useModules()
  const [refreshKey, setRefreshKey] = useState(0)
  const projectsOn = !loading && on("project-management")

  return (
    <PortalLayout>
      <div className="mx-auto max-w-4xl space-y-5 py-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[14rem] flex-1">
            <h1 className="text-2xl font-black text-foreground">{t("tr_page_title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("tr_page_desc")}</p>
          </div>
          <RaiseMaterialRequest orgId={organizationId || ""} variant="default" onSent={() => setRefreshKey((k) => k + 1)} />
        </header>
        {projectsOn ? (
          <EmptyState
            icon={Building2}
            title={t("tr_pm_on_title")}
            description={t("tr_pm_on_desc")}
            action={
              <Button asChild variant="outline">
                <Link href="/contractor/projects">{t("tr_pm_on_cta")}</Link>
              </Button>
            }
          />
        ) : (
          <MyTeamRequests refreshKey={refreshKey} />
        )}
      </div>
    </PortalLayout>
  )
}
