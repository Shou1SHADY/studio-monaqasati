"use client"

// Admin → a contractor → «اعرض كما يراها» (AD-01, prototype «افتح بوابته كما يراها»): what the contractor's SAVED package
// shows them, read-only. Never impersonation — it reads `companyModules/{orgId}` and the owner's name, nothing of the
// company's records: the subscription panel their Settings show, the pages and sections their menu holds for someone with
// every permission, and «how Procurement works» for that package. No link here leads into their portal.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { ArrowRight, Eye, Loader2, Workflow } from "lucide-react"
import { Link } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { SubscriptionPanel } from "@/components/procurement/SubscriptionPanel"
import { GuideSources } from "@/components/procurement/guide/GuideSources"
import { GuideStations } from "@/components/procurement/guide/GuideStations"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { applyModuleSwitches, COMPANY_MODULES, offSet } from "@/lib/company-modules"
import { COMPONENT_ACCENT_CLASSES, CONTRACTOR_COMPONENTS, type PortalComponentDef } from "@/lib/portal-components"
import { flowSources, flowStations } from "@/lib/procurement/guide"
import { packageLabel, packageOf } from "@/lib/procurement/package"
import { subscriptionStatusOf } from "@/lib/subscription-status"
import { cn } from "@/lib/utils"
import { PackageChips } from "./PackageIcons"
import { SubscriptionStatusPill } from "./SubscriptionStatusPill"

/** The contractor's menu for a stored package: the modules that stay (in the switcher's order) and the ones it leaves out. */
export function previewModules(off: ReadonlySet<string>): { shown: PortalComponentDef[]; hidden: PortalComponentDef[] } {
  const applied = applyModuleSwitches(CONTRACTOR_COMPONENTS, off, "contractor").filter((c) => c.launcher !== false)
  const ids = new Set(applied.map((c) => c.id))
  const byOrder = (a: PortalComponentDef, b: PortalComponentDef) => a.displayOrder - b.displayOrder
  return { shown: [...applied].sort(byOrder), hidden: CONTRACTOR_COMPONENTS.filter((c) => !ids.has(c.id)).sort(byOrder) }
}

const noLink = () => false

export function ContractorPackagePreview({ orgId }: { orgId: string }) {
  const t = useTranslations("Portal.AdminPackages.preview")
  const tp = useTranslations("Portal.ProcPackage")
  const tSide = useTranslations("Portal.Sidebar")
  const firestore = useFirestore()
  const ownerRef = useMemoFirebase(() => (firestore ? doc(firestore, "users", orgId) : null), [firestore, orgId])
  const modulesRef = useMemoFirebase(() => (firestore ? doc(firestore, COMPANY_MODULES, orgId) : null), [firestore, orgId])
  const { data: owner, isLoading: ownerLoading } = useDoc(ownerRef)
  const { data: stored, isLoading: modulesLoading } = useDoc(modulesRef)

  const off = useMemo(() => offSet(stored as { off?: unknown } | null, "contractor"), [stored])
  const offList = useMemo(() => [...off].sort(), [off])
  const pkg = packageOf(offList)
  const { shown, hidden } = useMemo(() => previewModules(off), [off])
  const stations = useMemo(() => flowStations(pkg), [pkg])
  const sources = useMemo(() => flowSources(pkg), [pkg])
  const name = String((owner as { name?: unknown } | null)?.name ?? "")
  const labels = { core: tp("base.core.short"), inv: tp("base.inv.short"), pm: tp("conn.pm.short"), fin: tp("conn.fin.short"), mfg: tp("conn.mfg.short") }

  return (
    <PortalLayout>
      <div className="space-y-5 pb-16 text-start" data-testid="package-preview">
        <Link href={`/admin/contractors/${orgId}`} className="inline-flex items-center gap-1.5 rounded text-sm font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowRight size={14} className="rtl:rotate-0 ltr:rotate-180" aria-hidden="true" />
          {t("back", { name })}
        </Link>

        {ownerLoading || modulesLoading ? (
          <div className="flex justify-center p-16">
            <Loader2 className="animate-spin text-primary" size={28} aria-hidden="true" />
          </div>
        ) : (
          <>
            <header className="space-y-2">
              <StatusPill tone="info">
                <Eye size={12} aria-hidden="true" />
                {t("badge")}
              </StatusPill>
              <h1 className="text-2xl font-black text-foreground">{name ? `${name} — ${t("title")}` : t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("sub")}</p>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <b className="text-module" data-testid="preview-package-label">
                  {packageLabel(pkg, tp)}
                </b>
                <SubscriptionStatusPill status={subscriptionStatusOf((stored as { subscription?: unknown } | null)?.subscription)} />
                <PackageChips pkg={pkg} labels={labels} />
              </p>
            </header>

            <section className="rounded-2xl border bg-card p-4 shadow-sm" aria-labelledby="preview-pages">
              <h2 id="preview-pages" className="text-sm font-black">
                {t("pages")}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("pages_sub")}</p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="preview-modules">
                {shown.map((c) => {
                  const Icon = c.icon
                  return (
                    <li key={c.id} data-module={c.id} className="rounded-xl border p-3">
                      <p className="flex items-center gap-2 text-sm font-bold">
                        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", COMPONENT_ACCENT_CLASSES[c.accentToken].tile)}>
                          <Icon size={15} aria-hidden="true" />
                        </span>
                        {tSide(c.labelKey)}
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {c.sections.flatMap((sec) => sec.items).map((item) => (
                          <li key={item.href} className={cn("rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground", item.comingSoon && "opacity-60")}>
                            {tSide(item.titleKey)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                })}
              </ul>
              {hidden.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground" data-testid="preview-hidden">
                  <b>{t("hidden")}:</b> {hidden.map((c) => tSide(c.labelKey)).join(" · ")}
                </p>
              )}
            </section>

            <SubscriptionPanel off={offList} />

            <section className="space-y-3" aria-labelledby="preview-flow">
              <h2 id="preview-flow" className="flex items-center gap-2 text-base font-black">
                <Workflow size={16} className="text-module" aria-hidden="true" />
                {t("flow")}
              </h2>
              <GuideSources sources={sources} allowed={noLink} />
              <GuideStations stations={stations} limit={t("limit")} allowed={noLink} />
            </section>
          </>
        )}
      </div>
    </PortalLayout>
  )
}
