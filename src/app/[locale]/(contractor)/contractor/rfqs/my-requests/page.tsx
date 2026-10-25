"use client"

// «طلباتي» (Procurement 2.0, REQ-01): the materials a member asked Procurement for and where each stands — four steps, no prices,
// no suppliers. «طلب مواد جديد» is the way in; with Project Management the request is raised from the project, so this page says
// so. Open to every member of a company without Project Management, whatever his Procurement permissions («طالب مواد» holds none).

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Building2, ClipboardList, MapPin, Send } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { GuideLink } from "@/components/procurement/guide/GuideLink"
import { MyTeamRequests } from "@/components/procurement/MyTeamRequests"
import { RaiseMaterialRequest } from "@/components/procurement/RaiseMaterialRequest"
import { Button } from "@/components/ui/button"
import { useUser } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { useProcActor } from "@/hooks/useProcActor"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { Link } from "@/i18n/routing"
import { REQUESTER_STEPS } from "@/lib/procurement/incoming-state"

const HOW = [
  { id: "pick", icon: ClipboardList },
  { id: "place", icon: MapPin },
  { id: "send", icon: Send },
] as const

export default function MyMaterialRequestsPage() {
  const t = useTranslations("Portal.ProcMyRequests")
  const tp = useTranslations("Portal.Shared")
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const { on, loading } = useModules()
  const { isRequester } = useProcActor()
  const [refreshKey, setRefreshKey] = useState(0)
  const projectsOn = !loading && on("project-management")

  return (
    <PortalLayout>
      <div className="mx-auto max-w-4xl space-y-5 py-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[14rem] flex-1">
            {isRequester && <p className="mb-1 text-xs font-semibold text-muted-foreground">{t("role_line")}</p>}
            <h1 className="text-2xl font-black text-foreground">{t("title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("desc")}</p>
            <GuideLink variant="mine" className="mt-2" />
          </div>
          <RaiseMaterialRequest orgId={organizationId || ""} variant="default" fullName openOnRaise onSent={() => setRefreshKey((k) => k + 1)} />
        </header>
        {projectsOn ? (
          <EmptyState
            icon={Building2}
            title={tp("tr_pm_on_title")}
            description={tp("tr_pm_on_desc")}
            action={
              <Button asChild variant="outline">
                <Link href="/contractor/projects">{tp("tr_pm_on_cta")}</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="grid gap-3 sm:grid-cols-3" aria-label={t("how_label")}>
              {HOW.map(({ id, icon: Icon }, i) => (
                <li key={id} className="rounded-2xl border bg-card p-4">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-module/10 text-xs text-module">{i + 1}</span>
                    <Icon size={15} className="text-muted-foreground" aria-hidden="true" />
                    {t(`how_${id}_t`)}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">{t(`how_${id}_d`)}</p>
                </li>
              ))}
            </ul>
            <details className="rounded-2xl border bg-card p-4 text-sm">
              <summary className="cursor-pointer font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("flow_title")}</summary>
              <ol className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                {REQUESTER_STEPS.map((s) => (
                  <li key={s}>
                    <b className="text-foreground">{t(`step_${s}`)}</b> — {t(`flow_${s}`)}
                  </li>
                ))}
              </ol>
            </details>
            <MyTeamRequests refreshKey={refreshKey} />
            <p className="text-xs text-muted-foreground">{t("footer")}</p>
          </>
        )}
      </div>
    </PortalLayout>
  )
}
