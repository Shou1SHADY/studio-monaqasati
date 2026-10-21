"use client"

// «كيف تعمل المشتريات؟» — one page, opened from the sidebar, from Incoming and from «طلباتي» (FLW-01): where requests come
// from for the package, the eight stations with who owns each and what the requester sees, and what never changes between
// packages. The package chips only change what this page SHOWS (FLW-02): nothing is written, and no button here creates a
// request — every button is a plain link to the real page (B-10, R-30).

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { ArrowRight, Check, Layers, Loader2, NotebookPen, Plus } from "lucide-react"
import { Link } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { flowSources, flowStations, legendRoles, MY_REQUESTS_HREF, type GuideLinkDef } from "@/lib/procurement/guide"
import { CONNECTORS, packageOf, samePackage, type Connector } from "@/lib/procurement/package"
import { resolvePolicies } from "@/lib/procurement/policies"
import { visibleProcTabs } from "@/lib/procurement/shell"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"
import { GuideSources } from "./GuideSources"
import { GuideStations } from "./GuideStations"
import { RoleChip } from "./RoleChip"

export function ProcGuide() {
  const t = useTranslations("Portal.ProcGuide")
  const tp = useTranslations("Portal.ProcPackage")
  const firestore = useFirestore()
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const { off, loading } = useModules()
  const { can, isLoading: permissionsLoading } = usePermissions()
  const settingsRef = useMemoFirebase(() => (firestore && organizationId ? doc(firestore, PROCUREMENT_SETTINGS, organizationId) : null), [firestore, organizationId])
  const { data: settings } = useDoc(settingsRef)

  const actual = useMemo(() => packageOf([...off]), [off])
  const [preview, setPreview] = useState<typeof actual | null>(null)
  const pkg = preview ?? actual
  const differs = preview !== null && !samePackage(preview, actual)

  const tabs = visibleProcTabs(can)
  const allowed = (link: GuideLinkDef) => !link.tab || tabs.some((x) => x.id === link.tab)
  const backHref = tabs[0]?.href ?? MY_REQUESTS_HREF
  const limit = sarLtr(resolvePolicies(settings as Parameters<typeof resolvePolicies>[0]).managerApprovalLimit.toLocaleString("en-US"))

  const stations = useMemo(() => flowStations(pkg, actual), [pkg, actual])
  const sources = useMemo(() => flowSources(pkg, actual), [pkg, actual])
  const toggle = (c: Connector) => setPreview({ ...pkg, [c]: !pkg[c] })

  return (
    <PortalLayout>
      {loading || permissionsLoading ? (
        <div className="flex justify-center p-16">
          <Loader2 className="animate-spin text-primary" size={28} aria-hidden="true" />
        </div>
      ) : (
        <div className="mx-auto max-w-4xl space-y-4 pb-10 text-start">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-module/5 px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2">
              <Layers size={15} className="text-module" aria-hidden="true" />
              <b>{t("strip.label")}</b>
              {t("strip.title")}
            </span>
            <Link
              href={backHref}
              className="ms-auto inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-bold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowRight size={13} className="rtl:rotate-0 ltr:rotate-180" aria-hidden="true" />
              {t("strip.back")}
            </Link>
          </div>

          <header>
            <h1 className="text-[22px] font-black text-foreground">{t("head.title")}</h1>
            <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{t("head.desc")}</p>
          </header>

          <div className="flex flex-wrap items-center gap-2" data-testid="guide-package">
            <span className="text-xs font-bold text-muted-foreground">{t("pkg.label")}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-module bg-module/10 px-3 py-1.5 text-xs font-semibold text-module">
              <Check size={12} aria-hidden="true" />
              {t("pkg.base")}
            </span>
            {CONNECTORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={pkg[c]}
                onClick={() => toggle(c)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  pkg[c] ? "border-module bg-module/10 text-module" : "bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                {pkg[c] ? <Check size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                {tp(`conn.${c}.name`)}
              </button>
            ))}
            <span className="text-[11px] text-muted-foreground">
              {differs ? (
                <>
                  {t("pkg.preview")}{" "}
                  <button type="button" onClick={() => setPreview(null)} className="font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t("pkg.mine")}
                  </button>
                </>
              ) : (
                t("pkg.caption")
              )}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5" data-testid="guide-legend">
            {legendRoles(pkg).map((r) => (
              <RoleChip key={r} role={r} />
            ))}
          </div>

          <h2 className="flex items-center gap-2 text-base font-black">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">1</span>
            {t("h2.sources")}
          </h2>
          <GuideSources sources={sources} allowed={allowed} />

          <GuideStations stations={stations} limit={limit} allowed={allowed} />

          <p className="flex gap-2 rounded-xl border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
            <NotebookPen size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t("note")}
          </p>
        </div>
      )}
    </PortalLayout>
  )
}
