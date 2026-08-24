"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Skeleton } from "@/components/ui/skeleton"
import { Crown, UsersRound } from "lucide-react"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where } from "firebase/firestore"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useTranslations, useLocale } from "next-intl"
import { cn } from "@/lib/utils"
import { useWorkQueue, type WorkQueueItem, type WorkQueueItemType } from "@/hooks/useWorkQueue"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { usePermissions } from "@/hooks/usePermissions"
import { CONTRACTOR_COMPONENTS, COMPONENT_ACCENT_CLASSES, type PortalComponentId } from "@/lib/portal-components"

// Which tile a queue item's badge count rolls up into, and the permission
// that gates showing that count at all (owners always pass — see can()).
const ITEM_TILE: Record<WorkQueueItemType, PortalComponentId> = {
  guarantee_expiring: "payments",
  rfq_decision: "procurement",
  rfq_closing_soon: "procurement",
  rfq_no_offers: "procurement",
  delivery_confirm: "procurement",
  project_waiting_approval: "project-management",
  low_stock: "warehouses",
  team_invite_pending: "users",
}

function describePriorityItem(item: WorkQueueItem, t: ReturnType<typeof useTranslations<"Portal.Contractor">>): string {
  switch (item.type) {
    case "guarantee_expiring":
      return item.data.isExpired
        ? t("queue_item_guarantee_expired", { itemName: (item.data.itemName as string) || "", days: Math.abs(item.data.daysLeft as number) })
        : t("queue_item_guarantee_expiring", { itemName: (item.data.itemName as string) || "", days: item.data.daysLeft as number })
    case "rfq_decision":
      return t("queue_item_rfq_decision", { rfqTitle: (item.data.rfqTitle as string) || t("rfq_not_set"), count: item.data.offerCount as number })
    case "rfq_closing_soon":
      return item.data.isOverdue
        ? t("queue_item_rfq_deadline_passed", { rfqTitle: (item.data.rfqTitle as string) || t("rfq_not_set") })
        : t("queue_item_rfq_closing_soon", { rfqTitle: (item.data.rfqTitle as string) || t("rfq_not_set"), hours: item.data.hoursLeft as number })
    case "rfq_no_offers":
      return t("queue_item_rfq_no_offers", { rfqTitle: (item.data.rfqTitle as string) || t("rfq_not_set"), days: item.data.daysOpen as number })
    case "delivery_confirm":
      return t("queue_item_delivery_confirm", { supplierName: (item.data.supplierName as string) || t("queue_generic_supplier") })
    case "project_waiting_approval":
      return t("queue_item_project_waiting_approval", { name: (item.data.projectName as string) || "", status: t(item.data.statusLabelKey as string) })
    case "low_stock":
      return t("queue_item_low_stock", { itemName: (item.data.itemName as string) || "", warehouseName: (item.data.warehouseName as string) || "" })
    case "team_invite_pending":
      return t("queue_item_team_invite_pending", { email: (item.data.email as string) || "" })
  }
}

export default function ContractorDashboard() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const t = useTranslations("Portal.Contractor")
  const tSidebar = useTranslations("Portal.Sidebar")
  const locale = useLocale()
  const isRtl = locale === "ar"

  const { profile } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const myOrgId = profile?.organizationId || user?.uid
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)
  const { can, isOrgOwner, groups } = usePermissions()

  const firstName = (profile?.name as string | undefined)?.trim().split(/\s+/)[0] || ""
  const hourNow = new Date().getHours()
  const greeting = hourNow < 12 ? t("greet_morning") : t("greet_evening")
  const todayLabel = new Date().toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { weekday: "long", day: "numeric", month: "long" })
  const myGroup = groups.find((g) => g.id === profile?.defaultGroupId)
  const roleChip = isOrgOwner ? t("role_owner_chip") : myGroup?.name || null

  const projectsQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "projects"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: projectsData } = useCollection(projectsQuery)
  const orgProjects = (projectsData || []) as { id: string; status?: string }[]
  const ongoingProjectsCount = orgProjects.filter((p) => p.status !== "canceled" && p.status !== "remaining_payment").length

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "employees"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: employeesData } = useCollection(employeesQuery)

  const contactsQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "crmContacts"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: contactsData } = useCollection(contactsQuery)

  // Each work-queue item type is only counted toward a tile's badge (and the
  // top-priorities card) if this member can actually act on it — a finance
  // member shouldn't be nudged about RFQ decisions they can't take.
  const itemPermission: Record<WorkQueueItemType, boolean> = {
    guarantee_expiring: can("offers.accept") || can("invoices.manage"),
    rfq_decision: can("offers.view") || can("rfq.manage"),
    rfq_closing_soon: can("rfq.manage") || can("rfq.create"),
    rfq_no_offers: can("rfq.manage") || can("rfq.create"),
    delivery_confirm: can("deliveries.confirm"),
    project_waiting_approval: can("projects.edit") || can("projects.publish"),
    low_stock: can("warehouses.manage"),
    team_invite_pending: can("team.manage"),
  }
  const { items: allQueueItems, isLoading: queueLoading } = useWorkQueue(myOrgId, user?.uid)
  const queueItems = allQueueItems.filter((item) => itemPermission[item.type])
  const top3 = queueItems.slice(0, 3)

  const badgeCountByTile = new Map<PortalComponentId, number>()
  queueItems.forEach((item) => {
    const tileId = ITEM_TILE[item.type]
    badgeCountByTile.set(tileId, (badgeCountByTile.get(tileId) || 0) + 1)
  })
  // Informational counts — not urgency-based, so they don't come from the work queue.
  badgeCountByTile.set("hr", (employeesData || []).length)
  badgeCountByTile.set("crm", (contactsData || []).length)

  const URGENT_TILES = new Set<PortalComponentId>(["procurement", "warehouses", "payments", "project-management"])

  if (!profile) {
    return (
      <PortalLayout>
        <div className="space-y-8 pb-10">
          <Skeleton className="h-40 rounded-3xl w-full" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
          <Skeleton className="h-48 rounded-2xl w-full" />
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <div className="space-y-8 pb-10">
        {/* Greeting — a flush hero band, not a boxed card: bleeds to the edges of
            the content column (cancels PortalLayout's own p-6/md:p-8) so the
            text reads as sitting directly on a colored backdrop, matching the
            reference design instead of floating as a rounded, shadowed card. */}
        <div
          className="relative overflow-hidden -mx-6 md:-mx-8 -mt-6 md:-mt-8 flex flex-col items-center text-center gap-2 py-12 sm:py-16 px-6 text-white"
          style={{
            background: "linear-gradient(115deg, #0b1a33 0%, #0a1426 46%, #060d1c 100%)",
          }}
        >
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <h1 suppressHydrationWarning className="text-2xl sm:text-3xl font-black text-white leading-[1.3]">
              {greeting}{locale === "ar" ? "،" : ","}{" "}
              <span className={cn("text-transparent bg-clip-text", isRtl ? "bg-gradient-to-l from-accent to-cyan-300" : "bg-gradient-to-r from-accent to-cyan-300")}>
                {firstName || activeCompanyName || t("welcome_fallback")}
              </span>
            </h1>
            {roleChip && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/15 backdrop-blur-md border border-accent/30 text-[11.5px] font-bold text-accent whitespace-nowrap">
                {isOrgOwner ? <Crown className="h-3 w-3" /> : <UsersRound className="h-3 w-3" />}
                {roleChip}
              </span>
            )}
          </div>
          <p suppressHydrationWarning className="text-[13px] text-slate-400 font-medium">
            {todayLabel}
            <span className="mx-1.5 text-slate-600">·</span>
            {t("home_ongoing_projects", { count: ongoingProjectsCount })}
          </p>
        </div>

        {/* Component tile grid — one tile per portal component, the badge is a
            real "needs attention" count where one exists (see ITEM_TILE above),
            or a simple total for components with no urgency signal (hr/crm). */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {CONTRACTOR_COMPONENTS.map((component) => {
            const accent = COMPONENT_ACCENT_CLASSES[component.accentToken]
            const count = badgeCountByTile.get(component.id) || 0
            const isUrgent = URGENT_TILES.has(component.id)
            return (
              <Link
                key={component.id}
                href={component.homeHref}
                className="group relative flex flex-col items-center gap-4 py-8 px-6 rounded-2xl bg-white border border-border/60 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="relative">
                  <span className={cn("h-[72px] w-[72px] rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105", accent.tile)}>
                    <component.icon size={30} />
                  </span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "absolute -top-2 h-6 min-w-6 px-1.5 rounded-full text-[11px] font-black text-white flex items-center justify-center shadow-sm ring-2 ring-white",
                        isRtl ? "-right-2" : "-left-2",
                        isUrgent ? "bg-destructive" : "bg-cta"
                      )}
                    >
                      {count}
                    </span>
                  )}
                </div>
                <span className="text-sm font-bold text-foreground text-center leading-tight">
                  {tSidebar(component.labelKey)}
                </span>
              </Link>
            )
          })}
        </div>

        {/* Top priorities — the 3 most urgent real items across the org that
            this member can act on, ranked by useWorkQueue's tier system. */}
        <div className="rounded-2xl border border-border/60 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border/60">
            <h2 className="text-sm font-black text-foreground">{t("home_priorities_title")}</h2>
          </div>
          {queueLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
            </div>
          ) : top3.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{t("home_priorities_empty")}</div>
          ) : (
            <div className="divide-y divide-border/60">
              {top3.map((item) => (
                <Link
                  key={item.id}
                  href={item.actionUrl}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/50 transition-colors"
                >
                  <span className={cn("h-2 w-2 rounded-full shrink-0", item.tier <= 3 ? "bg-destructive" : "bg-warning")} />
                  <span className="text-xs font-bold text-muted-foreground w-28 sm:w-32 shrink-0 truncate">
                    {tSidebar(CONTRACTOR_COMPONENTS.find((c) => c.id === ITEM_TILE[item.type])?.labelKey || "")}
                  </span>
                  <span className="text-sm text-foreground truncate flex-1 min-w-0">{describePriorityItem(item, t)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  )
}
