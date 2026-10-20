"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { PortalHomeView, type HomeDecision, type HomeKpi } from "@/components/portal-home/PortalHomeView"
import { useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, query, where } from "firebase/firestore"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useTranslations } from "next-intl"
import { useWorkQueue, type WorkQueueItem, type WorkQueueItemType } from "@/hooks/useWorkQueue"
import { useMyTodoCounts } from "@/hooks/useMyTodoCounts"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { usePermissions } from "@/hooks/usePermissions"
import { useModuleComponents, useModules } from "@/hooks/useCompanyModules"
import type { PortalComponentId } from "@/lib/portal-components"
import { QUEUE_ITEM_TILE, liveQueueItems, queueActionKey, queueItemPermissions } from "@/lib/work-queue-tasks"

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
  sales_deposits_to_confirm: "action_sales_deposits_to_confirm",
  mfg_materials_to_issue: "action_mfg_materials_to_issue",
  mfg_requests_unanswered: "action_mfg_requests_unanswered",
  mfg_drawing_results_due: "action_mfg_drawing_results_due",
  mfg_client_drawings_due: "action_mfg_client_drawings_due",
  mfg_notes_to_receive: "action_mfg_notes_to_receive",
  mfg_custody_to_receive: "action_mfg_custody_to_receive",
  mfg_purchase_requests: "action_mfg_purchase_requests",
  po_approve: "action_po_approve",
  po_attention: "action_po_attention",
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
    case "po_attention":
      return [
        { label: t("metric_po_late"), value: item.data.late as number },
        { label: t("metric_po_not_accepted"), value: item.data.notAccepted as number },
        { label: t("metric_po_not_sent"), value: item.data.notSent as number },
      ]
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
      return item.data.forwardedTo
        ? t("queue_item_delivery_with_receiver", { supplierName: (item.data.supplierName as string) || t("queue_generic_supplier"), receiver: item.data.forwardedTo as string })
        : t("queue_item_delivery_confirm", { supplierName: (item.data.supplierName as string) || t("queue_generic_supplier") })
    case "project_waiting_approval":
      return t("queue_item_project_waiting_approval", { name: (item.data.projectName as string) || "", status: t(item.data.statusLabelKey as string) })
    case "low_stock":
      return t("queue_item_low_stock", { itemName: (item.data.itemName as string) || "", warehouseName: (item.data.warehouseName as string) || "" })
    case "team_invite_pending":
      return t("queue_item_team_invite_pending", { email: (item.data.email as string) || "" })
    case "sales_deposits_to_confirm":
      return t("queue_item_sales_deposits_to_confirm", { count: item.data.count as number })
    case "mfg_materials_to_issue":
      return t("queue_item_mfg_materials_to_issue", { count: item.data.count as number })
    case "mfg_requests_unanswered":
      return t("queue_item_mfg_requests_unanswered", { count: item.data.count as number })
    case "mfg_drawing_results_due":
      return t("queue_item_mfg_drawing_results_due", { count: item.data.count as number, projectName: (item.data.projectName as string) || "" })
    case "mfg_client_drawings_due":
      return t("queue_item_mfg_client_drawings_due", { count: item.data.count as number })
    case "mfg_notes_to_receive":
      return t("queue_item_mfg_notes_to_receive", { count: item.data.count as number })
    case "mfg_custody_to_receive":
      return t("queue_item_mfg_custody_to_receive", { count: item.data.count as number, projectName: (item.data.projectName as string) || "" })
    case "mfg_purchase_requests":
      return t("queue_item_mfg_purchase_requests", { count: item.data.count as number })
    case "po_approve":
      return t("queue_item_po_approve", { count: item.data.count as number })
    case "po_attention":
      return t("queue_item_po_attention", { count: item.data.count as number, late: item.data.late as number, notAccepted: item.data.notAccepted as number, notSent: item.data.notSent as number })
  }
}

// The contractor's home: the shared portal home (PortalHomeView), fed with the
// contractor's numbers — the work queue's decisions, projects, RFQs, guarantees.
export default function ContractorDashboard() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const t = useTranslations("Portal.Contractor")
  const tHome = useTranslations("Portal.Home")

  const { profile } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const myOrgId = profile?.organizationId || user?.uid
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)
  const { can, isOrgOwner } = usePermissions()
  const modules = useModuleComponents("contractor")
  const switches = useModules()
  const { on, linkable } = switches

  // HR records are read by HR roles only (HR 1.0, RL-03) — others see no headcount. A workplace supervisor
  // reads his own workplaces' people only (RL-01): the rules refuse him this company-wide query.
  const seesHr = can("employees.manage") || can("hr.gov") || can("hr.payroll") || can("hr.management")
  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId || !seesHr || !on("hr")) return null
    return query(collection(firestore, "employees"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId, seesHr, on])
  const { data: employeesData } = useCollection(employeesQuery)

  const contactsQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "crmContacts"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: contactsData } = useCollection(contactsQuery)

  // Each work-queue item type is only counted toward a tile's badge (and the
  // decisions) if this member can actually act on it — a finance member
  // shouldn't be nudged about RFQ decisions they can't take.
  const itemPermission = queueItemPermissions(can)
  const { items: allQueueItems, isLoading: queueLoading, stats, recentItems } = useWorkQueue(myOrgId, user?.uid, { isOrgOwner, manufacturing: on("manufacturing") })
  // What the company switched off leaves the list: its own decisions, anything that only opens one of its pages,
  // and a tender link into Projects becomes the core RFQ page.
  const toTender = (url: string) => (on("project-management") ? url : url.replace(/^\/contractor\/projects\/[^/]+\/tenders\/([^/?]+)\/offers/, "/contractor/rfqs/$1/offers"))
  const liveRecent = recentItems.map((item) => ({ ...item, href: toTender(item.href) })).filter((item) => linkable(item.href))
  const queueItems = liveQueueItems(allQueueItems, switches).filter(
    (item) => itemPermission[item.type] && modules.some((c) => c.id === QUEUE_ITEM_TILE[item.type] && c.launcher !== false)
  )
  const { counts: todoCounts } = useMyTodoCounts(myOrgId, user?.uid, "contractor")

  const badges = new Map<PortalComponentId, number>()
  queueItems.forEach((item) => {
    const tileId = QUEUE_ITEM_TILE[item.type]
    badges.set(tileId, (badges.get(tileId) || 0) + 1)
  })
  if (todoCounts.due > 0) badges.set("activities", todoCounts.due)

  // Informational one-liner under each tile title — real org numbers, muted styling.
  const tileStats: Partial<Record<PortalComponentId, string>> = {
    crm: tHome("tile_stats_crm", { count: (contactsData || []).length }),
    "project-management": t("tile_stats_projects", { total: stats.projectsTotal, ongoing: stats.projectsOngoing }),
    procurement: t("tile_stats_procurement", { open: stats.rfqsOpen, offers: stats.offersTotal }),
    warehouses: t("tile_stats_inventory", { items: stats.inventoryItemsTotal, warehouses: stats.warehousesTotal }),
    payments: t("tile_stats_finance", { count: stats.guaranteesActive }),
    hr: tHome("tile_stats_hr", { count: (employeesData || []).length }),
    activities: tHome("tile_stats_activities", { overdue: todoCounts.overdue, today: todoCounts.today, planned: todoCounts.planned }),
  }
  const urgentTiles = new Set<PortalComponentId>(["procurement", "warehouses", "payments", "project-management", ...(todoCounts.overdue > 0 ? (["activities"] as const) : [])])

  // Role-aware hero KPIs — the first 3 stats this member is allowed to see, so
  // the hero keeps the same size and shape for every role.
  const guaranteesExpiringCount = allQueueItems.filter((i) => i.type === "guarantee_expiring").length
  const canFinance = can("invoices.manage") || can("offers.accept")
  const kpis: HomeKpi[] = [
    { key: "projects", allowed: on("project-management") && (can("projects.view") || can("projects.edit")), value: stats.projectsOngoing, label: t("home_kpi_ongoing_label"), dot: false },
    { key: "decisions", allowed: true, value: queueItems.length, label: tHome("home_kpi_decisions_label"), dot: queueItems.length > 0 },
    { key: "rfqs", allowed: can("rfq.manage") || can("rfq.create"), value: stats.rfqsOpen, label: t("home_kpi_open_rfqs_label"), dot: false },
    { key: "offers", allowed: can("offers.view"), value: stats.offersTotal, label: t("home_kpi_offers_label"), dot: false },
    { key: "guarantees", allowed: canFinance, value: stats.guaranteesActive, label: t("home_kpi_guarantees_label"), dot: false },
    { key: "guarantees_exp", allowed: canFinance, value: guaranteesExpiringCount, label: t("home_kpi_guarantees_exp_label"), dot: guaranteesExpiringCount > 0 },
  ]
    .filter((k) => k.allowed)
    .slice(0, 3)
    .map(({ allowed: _allowed, ...k }) => k)

  const decisions: HomeDecision[] = queueItems.map((item) => ({
    id: item.id,
    moduleId: QUEUE_ITEM_TILE[item.type],
    title: describePriorityItem(item, t),
    chip: cardChip(item, t),
    metrics: cardMetrics(item, t),
    actionLabel: t(queueActionKey(item, ITEM_ACTION_KEY)),
    href: item.actionUrl,
  }))

  return (
    <PortalLayout>
      <PortalHomeView
        profile={profile as Record<string, unknown> | null}
        orgId={myOrgId}
        companyName={activeCompanyName}
        modules={modules}
        kpis={kpis}
        tileStats={tileStats}
        badges={badges}
        urgentTiles={urgentTiles}
        recent={liveRecent}
        decisions={{ loading: queueLoading, items: decisions }}
      />
    </PortalLayout>
  )
}
