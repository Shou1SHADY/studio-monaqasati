"use client"

import { useState } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Crown, UsersRound, History, ChevronLeft, ChevronRight, Lock, Eye, Check, KeyRound, Loader2 } from "lucide-react"
import { Link } from "@/i18n/routing"
import { can as resolvePermission, type PermissionId } from "@/lib/permissions"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where, addDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useTranslations, useLocale } from "next-intl"
import { cn } from "@/lib/utils"
import { useWorkQueue, type WorkQueueItem, type WorkQueueItemType } from "@/hooks/useWorkQueue"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { usePermissions } from "@/hooks/usePermissions"
import { CONTRACTOR_COMPONENTS, COMPONENT_ACCENT_CLASSES, isComponentVisible, type PortalComponentId } from "@/lib/portal-components"

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

// Solid accent classes for the tile hover-bar and decision-card rail — the
// shared COMPONENT_ACCENT_CLASSES only carries the soft 10% variants.
const ACCENT_SOLID: Record<string, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  accent: "bg-accent",
  success: "bg-success",
  cta: "bg-cta",
  warning: "bg-warning",
  destructive: "bg-destructive",
}

// Primary action label on each decision card, per item type.
const ITEM_ACTION_KEY: Record<WorkQueueItemType, string> = {
  guarantee_expiring: "action_guarantee_expiring",
  rfq_decision: "action_rfq_decision",
  rfq_closing_soon: "action_rfq_closing_soon",
  rfq_no_offers: "action_rfq_no_offers",
  delivery_confirm: "action_delivery_confirm",
  project_waiting_approval: "action_project_waiting_approval",
  low_stock: "action_low_stock",
  team_invite_pending: "action_team_invite_pending",
}

type TFn = ReturnType<typeof useTranslations<"Portal.Contractor">>

// Deadline/status chip on a decision card — real timing where the item has it,
// a generic "urgent" for top-tier items without one, nothing otherwise.
function cardChip(item: WorkQueueItem, t: TFn): { label: string; tone: "destructive" | "warning" } | null {
  switch (item.type) {
    case "rfq_closing_soon":
      return item.data.isOverdue
        ? { label: t("chip_overdue"), tone: "destructive" }
        : { label: t("chip_within_hours", { hours: item.data.hoursLeft as number }), tone: "warning" }
    case "guarantee_expiring":
      return item.data.isExpired
        ? { label: t("chip_overdue"), tone: "destructive" }
        : { label: t("chip_within_days", { days: item.data.daysLeft as number }), tone: "warning" }
    default:
      return item.tier <= 3 ? { label: t("home_card_urgent"), tone: "destructive" } : null
  }
}

function cardMetrics(item: WorkQueueItem, t: TFn): Array<{ label: string; value: string | number }> {
  switch (item.type) {
    case "rfq_decision":
      return [{ label: t("metric_offers_received"), value: item.data.offerCount as number }]
    case "rfq_no_offers":
      return [{ label: t("metric_days_open"), value: item.data.daysOpen as number }]
    case "low_stock":
      return [
        { label: t("metric_quantity"), value: item.data.quantity as number },
        { label: t("metric_min_level"), value: item.data.minStockLevel as number },
      ]
    case "guarantee_expiring":
      return item.data.isExpired ? [] : [{ label: t("metric_days_left"), value: item.data.daysLeft as number }]
    default:
      return []
  }
}

function relativeTimeLabel(ms: number, t: TFn): string {
  const diff = Date.now() - ms
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t("time_ago_now")
  if (minutes < 60) return t("time_ago_minutes", { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t("time_ago_hours", { count: hours })
  return t("time_ago_days", { count: Math.floor(hours / 24) })
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
  const { toast } = useToast()

  const { profile } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const myOrgId = profile?.organizationId || user?.uid
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)
  const { can, isOrgOwner, groups } = usePermissions()

  const firstName = (profile?.name as string | undefined)?.trim().split(/\s+/)[0] || ""
  const hourNow = new Date().getHours()
  const greeting = hourNow < 12 ? t("greet_morning") : t("greet_evening")
  const todayLabel = new Date().toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { weekday: "long", day: "numeric", month: "long" })
  const myGroup = groups.find((g) => g.id === profile?.defaultGroupId)

  // Owner-only "preview as group": renders the whole dashboard exactly as a
  // member of that permission group would see it, via the same resolver used
  // for real members. Purely visual — no data or writes are affected.
  const [previewGroupId, setPreviewGroupId] = useState<string | null>(null)
  const previewGroup = isOrgOwner && previewGroupId ? groups.find((g) => g.id === previewGroupId) : undefined
  const effectiveCan = previewGroup
    ? (permission: PermissionId) =>
        resolvePermission(permission, { organizationRole: "member", defaultGroupId: previewGroup.id, groups, projectGroupId: undefined })
    : can
  const effectiveIsOwner = previewGroup ? false : isOrgOwner

  const roleChip = previewGroup ? previewGroup.name : isOrgOwner ? t("role_owner_chip") : myGroup?.name || null

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
    guarantee_expiring: effectiveCan("offers.accept") || effectiveCan("invoices.manage"),
    rfq_decision: effectiveCan("offers.view") || effectiveCan("rfq.manage"),
    rfq_closing_soon: effectiveCan("rfq.manage") || effectiveCan("rfq.create"),
    rfq_no_offers: effectiveCan("rfq.manage") || effectiveCan("rfq.create"),
    delivery_confirm: effectiveCan("deliveries.confirm"),
    project_waiting_approval: effectiveCan("projects.edit") || effectiveCan("projects.publish"),
    low_stock: effectiveCan("warehouses.manage"),
    team_invite_pending: effectiveCan("team.manage"),
  }
  const { items: allQueueItems, isLoading: queueLoading, stats, recentItems } = useWorkQueue(myOrgId, user?.uid)
  const queueItems = allQueueItems.filter((item) => itemPermission[item.type])
  const top3 = queueItems.slice(0, 3)
  const ongoingProjectsCount = stats.projectsOngoing

  const badgeCountByTile = new Map<PortalComponentId, number>()
  queueItems.forEach((item) => {
    const tileId = ITEM_TILE[item.type]
    badgeCountByTile.set(tileId, (badgeCountByTile.get(tileId) || 0) + 1)
  })

  // Informational one-liner under each tile title — real org numbers, muted styling.
  const tileStats: Partial<Record<PortalComponentId, string>> = {
    crm: t("tile_stats_crm", { count: (contactsData || []).length }),
    "project-management": t("tile_stats_projects", { total: stats.projectsTotal, ongoing: stats.projectsOngoing }),
    procurement: t("tile_stats_procurement", { open: stats.rfqsOpen, offers: stats.offersTotal }),
    warehouses: t("tile_stats_inventory", { items: stats.inventoryItemsTotal, warehouses: stats.warehousesTotal }),
    payments: t("tile_stats_finance", { count: stats.guaranteesActive }),
    hr: t("tile_stats_hr", { count: (employeesData || []).length }),
  }

  const URGENT_TILES = new Set<PortalComponentId>(["procurement", "warehouses", "payments", "project-management"])
  const sortedComponents = [...CONTRACTOR_COMPONENTS].sort((a, b) => a.displayOrder - b.displayOrder)
  const ChevronIcon = isRtl ? ChevronLeft : ChevronRight

  // Permission-aware tiles: a module the member can't open anything inside is
  // shown locked (or hidden via the toggle) — same gate as sidebar/launcher.
  const accessibleById = new Map(sortedComponents.map((c) => [c.id, isComponentVisible(c, effectiveCan)]))
  const accessibleCount = sortedComponents.filter((c) => accessibleById.get(c.id)).length
  const lockedCount = sortedComponents.length - accessibleCount
  const [showLocked, setShowLocked] = useState(true)
  const gridComponents = showLocked ? sortedComponents : sortedComponents.filter((c) => accessibleById.get(c.id))

  // Role-aware hero KPIs — the first 3 stats this member is allowed to see, so
  // the hero keeps the same size and shape for every role. Finance-leaning
  // members fall through to real guarantees data (invoices aren't live yet).
  const guaranteesExpiringCount = allQueueItems.filter((i) => i.type === "guarantee_expiring").length
  const canFinance = effectiveCan("invoices.manage") || effectiveCan("offers.accept")
  const kpis = [
    { key: "projects", allowed: effectiveCan("projects.view") || effectiveCan("projects.edit"), value: ongoingProjectsCount, label: t("home_kpi_ongoing_label"), dot: false },
    { key: "decisions", allowed: true, value: queueItems.length, label: t("home_kpi_decisions_label"), dot: queueItems.length > 0 },
    { key: "rfqs", allowed: effectiveCan("rfq.manage") || effectiveCan("rfq.create"), value: stats.rfqsOpen, label: t("home_kpi_open_rfqs_label"), dot: false },
    { key: "offers", allowed: effectiveCan("offers.view"), value: stats.offersTotal, label: t("home_kpi_offers_label"), dot: false },
    { key: "guarantees", allowed: canFinance, value: stats.guaranteesActive, label: t("home_kpi_guarantees_label"), dot: false },
    { key: "guarantees_exp", allowed: canFinance, value: guaranteesExpiringCount, label: t("home_kpi_guarantees_exp_label"), dot: guaranteesExpiringCount > 0 },
  ].filter((k) => k.allowed).slice(0, 3)

  // Modules each group can open — shown in the preview picker ("4 of 7 modules").
  const groupModuleCount = (groupId: string) => {
    const groupCan = (permission: PermissionId) =>
      resolvePermission(permission, { organizationRole: "member", defaultGroupId: groupId, groups, projectGroupId: undefined })
    return sortedComponents.filter((c) => isComponentVisible(c, groupCan)).length
  }

  // Access requests this member already sent — locked tiles show "request sent"
  // instead of the button, and the create is skipped while one is pending.
  const myAccessRequestsQuery = useMemoFirebase(() => {
    if (!firestore || !user || isOrgOwner || !myOrgId) return null
    return query(
      collection(firestore, "accessRequests"),
      where("requesterId", "==", user.uid),
      where("organizationId", "==", myOrgId)
    )
  }, [firestore, user, isOrgOwner, myOrgId])
  const { data: myAccessRequests } = useCollection(myAccessRequestsQuery)
  const pendingRequestModules = new Set(
    ((myAccessRequests || []) as { moduleId?: string; status?: string }[])
      .filter((r) => r.status === "pending")
      .map((r) => r.moduleId)
  )
  const [justRequested, setJustRequested] = useState<Set<string>>(new Set())
  const [requestingModule, setRequestingModule] = useState<string | null>(null)

  const handleRequestAccess = async (componentId: PortalComponentId, moduleLabel: string) => {
    if (!firestore || !user || !myOrgId || requestingModule) return
    setRequestingModule(componentId)
    try {
      const requesterName =
        (profile?.name as string) || (profile?.companyName as string) || user.email || ""
      await addDoc(collection(firestore, "accessRequests"), {
        organizationId: myOrgId,
        requesterId: user.uid,
        requesterName,
        moduleId: componentId,
        status: "pending",
        createdAt: new Date().toISOString(),
      })
      await addDoc(collection(firestore, "users", myOrgId, "notifications"), {
        title: t("access_request_notif_title"),
        message: t("access_request_notif_msg", { name: requesterName, module: moduleLabel }),
        type: "access_request",
        createdAt: new Date().toISOString(),
        read: false,
      })
      setJustRequested((prev) => new Set(prev).add(componentId))
      toast({ title: t("access_request_sent_toast") })
    } catch (err) {
      console.error(err)
      toast({ title: t("generic_error_title"), variant: "destructive" })
    } finally {
      setRequestingModule(null)
    }
  }

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
      <div className="space-y-6 pb-10">
        {/* Owner-only: preview the dashboard as one of the org's permission groups. */}
        {isOrgOwner && groups.length > 0 && (
          <div className="flex justify-end -mb-2">
            <Select value={previewGroupId ?? "owner"} onValueChange={(v) => setPreviewGroupId(v === "owner" ? null : v)}>
              <SelectTrigger
                className="h-8 gap-1.5 rounded-lg border-border bg-white text-foreground text-[11.5px] font-semibold hover:bg-muted/50 w-auto"
                aria-label={t("home_preview_label")}
              >
                <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align={isRtl ? "start" : "end"}>
                <div className="px-2 py-1.5 text-[10.5px] font-bold text-muted-foreground">{t("home_preview_label")}</div>
                <SelectItem value="owner" className="text-xs">{t("home_preview_owner")}</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id} className="text-xs">
                    {g.name}
                    <span className="text-muted-foreground ms-1.5">
                      {t("home_preview_modules", { count: groupModuleCount(g.id), total: sortedComponents.length })}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Hero — rounded card, greeting block at the start, KPIs at the end,
            over a navy→blue gradient with a brick-outline wall and a teal glow. */}
        <div
          className="relative overflow-hidden rounded-[20px] text-white px-6 py-5 sm:px-7 flex items-center gap-5 flex-wrap shadow-[0_14px_34px_rgba(11,26,43,.2)]"
          style={{
            background: "linear-gradient(115deg, #0a1a2a 0%, #123152 55%, #0d4d75 100%)",
          }}
        >
          <svg className="absolute inset-0 h-full w-full opacity-50 pointer-events-none" aria-hidden="true">
            <defs>
              <pattern id="hero-bricks" width="64" height="36" patternUnits="userSpaceOnUse">
                <path d="M6 2h52l-6 14H0z" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
                <path d="M38 20h52l-6 14H32z" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
                <path d="M-26 20h52l-6 14h-52z" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#hero-bricks)" />
          </svg>
          <span
            className={cn("absolute -top-[230px] h-[440px] w-[440px] rounded-full pointer-events-none", isRtl ? "-right-[110px]" : "-left-[110px]")}
            style={{ background: "radial-gradient(circle, rgba(44,182,236,.3), rgba(44,182,236,0) 65%)" }}
          />

          <div className="relative min-w-0">
            <h1 suppressHydrationWarning className="flex items-center gap-3 flex-wrap text-xl sm:text-2xl font-bold leading-[1.4] text-white">
              <span>
                {greeting}{locale === "ar" ? "،" : ","}{" "}
                <em className="not-italic text-cyan-300">{firstName || activeCompanyName || t("welcome_fallback")}</em>
              </span>
              {roleChip && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-[11.5px] font-bold text-slate-200 whitespace-nowrap">
                  {effectiveIsOwner ? <Crown className="h-3 w-3" /> : <UsersRound className="h-3 w-3" />}
                  {roleChip}
                </span>
              )}
            </h1>
            <p suppressHydrationWarning className="mt-0.5 flex items-center gap-2.5 flex-wrap text-[12.5px] text-slate-300/80 font-medium">
              {activeCompanyName && (
                <>
                  <span>{activeCompanyName}</span>
                  <i className="h-[3px] w-[3px] rounded-full bg-slate-500" />
                </>
              )}
              <span>{todayLabel}</span>
              <i className="h-[3px] w-[3px] rounded-full bg-slate-500" />
              <span>
                {effectiveIsOwner || lockedCount === 0
                  ? t("home_perms_all")
                  : t("home_perms_partial", { n: accessibleCount, total: sortedComponents.length })}
              </span>
            </p>
          </div>

          {/* Live KPIs — end side on desktop, full-width divider row on mobile. */}
          <div className="relative flex items-stretch ms-auto max-sm:basis-full max-sm:w-full max-sm:ms-0 max-sm:border-t max-sm:border-white/10 max-sm:pt-3">
            {kpis.map((kpi, i) => (
              <div
                key={kpi.key}
                className={cn(
                  "px-5 sm:px-6 text-start max-sm:flex-1 max-sm:px-3",
                  i > 0 && "border-s border-white/[.13]"
                )}
              >
                <b className="block text-[21px] font-bold leading-[1.25] tabular-nums whitespace-nowrap">
                  {kpi.value}
                </b>
                <span className="flex items-center gap-1.5 text-xs text-slate-300/80 whitespace-nowrap">
                  {kpi.dot && <span className="h-1.5 w-1.5 rounded-full bg-red-300" />}
                  {kpi.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Component tile grid — one tile per portal component. Each tile carries
            a real stats line (org totals) and a "needs action" footer fed by the
            work queue. Modules outside this member's permissions render locked
            (same gate as sidebar/launcher) behind an optional toggle. */}
        <div className="flex items-center justify-between gap-3 flex-wrap -mb-3">
          <h2 className="text-sm font-black text-foreground">{t("tiles_section_title")}</h2>
          {lockedCount > 0 && (
            <label className="flex items-center gap-2 text-[11.5px] font-medium text-muted-foreground cursor-pointer select-none">
              <span className="text-muted-foreground/60">{t("tiles_locked_count", { count: lockedCount })}</span>
              <Checkbox checked={showLocked} onCheckedChange={(v) => setShowLocked(v === true)} className="h-3.5 w-3.5" />
              {t("tiles_show_locked")}
            </label>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {gridComponents.map((component) => {
            const accent = COMPONENT_ACCENT_CLASSES[component.accentToken]
            const count = badgeCountByTile.get(component.id) || 0
            const isUrgent = URGENT_TILES.has(component.id)
            const statsLine = tileStats[component.id]
            const accessible = accessibleById.get(component.id)

            if (!accessible) {
              return (
                <div
                  key={component.id}
                  className="flex flex-col gap-2 p-[18px] rounded-[18px] bg-white border border-dashed border-border min-h-[174px] text-start"
                >
                  <span className="relative h-[46px] w-[46px] rounded-[14px] grid place-items-center mb-0.5 bg-muted text-muted-foreground/60">
                    <component.icon size={23} strokeWidth={1.65} />
                    <span className={cn("absolute -bottom-1 h-[18px] w-[18px] rounded-full bg-white border border-border grid place-items-center text-muted-foreground", isRtl ? "-left-1" : "-right-1")}>
                      <Lock size={10} />
                    </span>
                  </span>
                  <span className="text-[15px] font-bold text-muted-foreground leading-[1.4]">
                    {tSidebar(component.labelKey)}
                  </span>
                  <span className="text-xs text-muted-foreground/50">—</span>
                  <div className="mt-auto pt-2.5 border-t border-border/40 flex items-center min-h-[34px]">
                    {previewGroup || isOrgOwner ? (
                      <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/60">
                        <Lock size={13} />
                        {t("tile_no_permission")}
                      </span>
                    ) : pendingRequestModules.has(component.id) || justRequested.has(component.id) ? (
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-success">
                        <Check size={13} />
                        {t("tile_request_sent")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRequestAccess(component.id, tSidebar(component.labelKey))}
                        disabled={requestingModule === component.id}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-cta/30 text-cta text-xs font-semibold hover:bg-cta/5 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {requestingModule === component.id ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                        {t("tile_request_access")}
                      </button>
                    )}
                  </div>
                </div>
              )
            }

            return (
              <Link
                key={component.id}
                href={component.homeHref}
                className="group relative overflow-hidden flex flex-col gap-2 p-[18px] rounded-[18px] bg-white border border-border/60 shadow-sm hover:shadow-lg hover:-translate-y-[3px] min-h-[174px] text-start transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span
                  className={cn(
                    "absolute top-0 start-0 h-[3px] w-0 group-hover:w-full transition-[width] duration-300",
                    ACCENT_SOLID[component.accentToken]
                  )}
                />
                <span className={cn("h-[46px] w-[46px] rounded-[14px] grid place-items-center mb-0.5 transition-transform group-hover:scale-105", accent.tile)}>
                  <component.icon size={23} strokeWidth={1.65} />
                </span>
                <span className="text-[15px] font-bold text-foreground leading-[1.4]">
                  {tSidebar(component.labelKey)}
                </span>
                {statsLine && (
                  <span className="text-xs text-muted-foreground leading-relaxed" suppressHydrationWarning>
                    {statsLine}
                  </span>
                )}
                <div className="mt-auto pt-2.5 border-t border-border/40 flex items-center gap-2 text-xs font-semibold whitespace-nowrap">
                  {count > 0 ? (
                    <span className={cn("flex items-center gap-2", isUrgent ? "text-destructive" : "text-cta")}>
                      <span className="h-[7px] w-[7px] rounded-full bg-current shrink-0" />
                      <b className="font-bold">{count}</b> {t("tile_needs_action_word")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/70">{t("tile_all_clear")}</span>
                  )}
                </div>
              </Link>
            )
          })}

          {/* Continue where you left off — most recently touched projects/RFQs. */}
          {recentItems.length > 0 && (
            <div className="flex flex-col rounded-[18px] bg-muted/30 border border-border/60 p-[18px] gap-3 min-h-[174px] text-start">
              <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <History size={13} />
                {t("home_continue_title")}
              </span>
              <div className="flex flex-col gap-0.5 -mx-2">
                {recentItems.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="h-[7px] w-[7px] rounded-full bg-accent shrink-0" />
                    <span className="text-xs font-semibold text-foreground truncate flex-1 min-w-0">{item.name}</span>
                    <span className="text-[10.5px] text-muted-foreground whitespace-nowrap" suppressHydrationWarning>
                      {relativeTimeLabel(item.ms, t)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Needs your decision today — the 3 most urgent real items across the
            org that this member can act on, ranked by useWorkQueue's tier
            system, as action cards with a primary CTA per item. */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-foreground">{t("home_priorities_title")}</h2>
            {queueItems.length > 3 && (
              <span className="text-[12.5px] font-semibold text-cta">
                {t("home_priorities_more", { count: queueItems.length - 3 })}
              </span>
            )}
          </div>
          {queueLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
            </div>
          ) : top3.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-white shadow-sm p-8 text-center text-sm text-muted-foreground">
              {t("home_priorities_empty")}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {top3.map((item) => {
                const moduleComponent = CONTRACTOR_COMPONENTS.find((c) => c.id === ITEM_TILE[item.type])
                const moduleAccent = moduleComponent ? COMPONENT_ACCENT_CLASSES[moduleComponent.accentToken] : null
                const chip = cardChip(item, t)
                const metrics = cardMetrics(item, t)
                const ModuleIcon = moduleComponent?.icon
                return (
                  <div
                    key={item.id}
                    className="relative overflow-hidden flex flex-col gap-3 rounded-[18px] border border-border/60 bg-white shadow-sm p-[18px] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                  >
                    {/* Accent rail in the module's color, like the reference cards. */}
                    <span
                      className={cn(
                        "absolute start-0 top-0 bottom-0 w-[3px]",
                        moduleComponent ? ACCENT_SOLID[moduleComponent.accentToken] : "bg-accent"
                      )}
                    />
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold", moduleAccent?.tile || "bg-muted text-muted-foreground")}>
                        {ModuleIcon && <ModuleIcon size={13} strokeWidth={1.9} />}
                        {moduleComponent ? tSidebar(moduleComponent.labelKey) : ""}
                      </span>
                      {chip && (
                        <span
                          className={cn(
                            "ms-auto inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap",
                            chip.tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
                          )}
                          suppressHydrationWarning
                        >
                          {chip.label}
                        </span>
                      )}
                    </div>
                    <h3 className="text-[13.5px] font-semibold leading-[1.65] text-foreground line-clamp-2 min-h-[45px]">
                      {describePriorityItem(item, t)}
                    </h3>
                    {metrics.length > 0 && (
                      <div className="flex items-stretch gap-4 flex-wrap rounded-xl bg-muted/30 border border-border/50 px-3 py-2.5">
                        {metrics.map((m) => (
                          <div key={m.label} className="leading-[1.3]">
                            <span className="block text-[10.5px] text-muted-foreground">{m.label}</span>
                            <b className="text-[13px] font-bold text-foreground tabular-nums" suppressHydrationWarning>{m.value}</b>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-auto flex items-center gap-2">
                      <Link
                        href={item.actionUrl}
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[10px] bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {t(ITEM_ACTION_KEY[item.type])}
                        <ChevronIcon size={14} />
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  )
}
