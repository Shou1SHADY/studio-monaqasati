"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Link } from "@/i18n/routing"
import { useTranslations, useLocale } from "next-intl"
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase"
import { doc } from "firebase/firestore"
import { cn } from "@/lib/utils"
import { usePermissions } from "@/hooks/usePermissions"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { useWorkQueue } from "@/hooks/useWorkQueue"
import { Lock } from "lucide-react"
import {
  CONTRACTOR_APP_GROUPS,
  CONTRACTOR_DASHBOARD_APP,
  type ContractorApp,
} from "@/lib/contractor-apps"

const ICON_TONE: Record<string, string> = {
  projects: "bg-cta/10 text-cta",
  rfqs: "bg-accent/10 text-accent",
  catalog: "bg-secondary/10 text-secondary",
  suppliers: "bg-secondary/10 text-secondary",
  warehouses: "bg-success/10 text-success",
  "goods-received": "bg-success/10 text-success",
  invoices: "bg-warning/10 text-warning",
  guarantees: "bg-warning/10 text-warning",
  employees: "bg-primary/10 text-primary",
  team: "bg-primary/10 text-primary",
  companies: "bg-primary/10 text-primary",
  chats: "bg-cta/10 text-cta",
  "team-chat": "bg-cta/10 text-cta",
  notifications: "bg-cta/10 text-cta",
  dashboard: "bg-accent/10 text-accent",
}

function AppTile({ app, badge, locked, t }: { app: ContractorApp; badge?: number; locked: boolean; t: ReturnType<typeof useTranslations<"Portal.Sidebar">> }) {
  const tone = ICON_TONE[app.id] || "bg-muted text-muted-foreground"
  const content = (
    <div
      className={cn(
        "relative flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-card p-4 text-center shadow-sm transition-all",
        locked
          ? "opacity-40 cursor-not-allowed"
          : "cursor-pointer hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
    >
      {!locked && !!badge && badge > 0 && (
        <span className="absolute top-2.5 start-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
      <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", tone)}>
        <app.icon className="h-5 w-5" strokeWidth={2.25} />
      </span>
      <span className="text-xs font-bold text-foreground">{t(app.titleKey)}</span>
      {locked && (
        <span className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
          <Lock className="h-2.5 w-2.5" />
          {t("apps_locked_tag")}
        </span>
      )}
    </div>
  )

  if (locked) {
    return (
      <div role="button" aria-disabled="true" tabIndex={-1}>
        {content}
      </div>
    )
  }
  return (
    <Link href={app.items[0].href} tabIndex={0}>
      {content}
    </Link>
  )
}

export default function ContractorAppsLauncher() {
  const t = useTranslations("Portal.Sidebar")
  const tc = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { can, isOrgOwner } = usePermissions()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = (profile?.organizationId as string | undefined) || user?.uid || ""
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)
  const firstName = (profile?.name as string | undefined)?.trim().split(/\s+/)[0] || ""

  const hourNow = new Date().getHours()
  const greeting = hourNow < 12 ? tc("greet_morning") : tc("greet_evening")

  const { items: queueItems } = useWorkQueue(myOrgId)
  const rfqBadge = queueItems.filter((i) => i.type === "rfq_decision" || i.type === "rfq_no_offers" || i.type === "rfq_closing_soon").length
  const goodsReceivedBadge = queueItems.filter((i) => i.type === "delivery_confirm").length
  const invoicesBadge = queueItems.filter((i) => i.type === "invoice_overdue").length
  const warehousesBadge = queueItems.filter((i) => i.type === "low_stock").length
  const APP_BADGES: Record<string, number> = {
    rfqs: rfqBadge,
    "goods-received": goodsReceivedBadge,
    invoices: invoicesBadge,
    warehouses: warehousesBadge,
  }

  const canSeeApp = (app: ContractorApp) => isOrgOwner || !app.requiredPermission || can(app.requiredPermission)

  return (
    <PortalLayout>
      <div className="space-y-8 pb-10">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {greeting}{locale === "ar" ? "،" : ","} {firstName || activeCompanyName}
          </p>
          <h1 className="mt-1 text-2xl font-black text-foreground">{t("apps_launcher_title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("apps_launcher_subtitle")}</p>
        </div>

        <div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            <AppTile app={CONTRACTOR_DASHBOARD_APP} locked={false} t={t} />
          </div>
        </div>

        {CONTRACTOR_APP_GROUPS.map((group) => (
          <div key={group.labelKey}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-sm font-bold text-muted-foreground">{t(group.labelKey)}</h2>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {group.apps.map((app) => (
                <AppTile
                  key={app.id}
                  app={app}
                  badge={APP_BADGES[app.id]}
                  locked={!canSeeApp(app)}
                  t={t}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </PortalLayout>
  )
}
