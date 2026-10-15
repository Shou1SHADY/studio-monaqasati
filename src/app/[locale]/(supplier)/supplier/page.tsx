"use client"

// The supplier's home: the same portal home a contractor lands on
// (PortalHomeView — tiles for every module, locked ones with "request access",
// what was touched last, the decisions of the day), fed with the supplier's
// numbers: the RFQs open to him, his offers, and the orders waiting for his
// acceptance. Browsing and answering RFQs lives in Sales → RFQs. A free
// supplier lands on the same view, fed from his free world (FreeHome).

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { PortalLayout } from "@/components/layout/portal-layout"
import { PortalHomeView, type HomeDecision, type HomeKpi } from "@/components/portal-home/PortalHomeView"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useActiveCompanyName } from "@/hooks/useActiveCompanyName"
import { useModuleComponents, useModules } from "@/hooks/useCompanyModules"
import { useMyTodoCounts } from "@/hooks/useMyTodoCounts"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useSupplierOrdersById } from "@/hooks/useSupplierOrdersById"
import { displayPoNumber } from "@/lib/procurement/format"
import type { PortalComponentId } from "@/lib/portal-components"
import { recentOffers, supplierDecisions, supplierHomeCounts, type HomeOffer, type HomeRfq } from "@/lib/supplier-home"
import { PlanSwitch } from "@/components/supplier-free/PlanSwitch"
import { FreeHome } from "@/components/supplier-free/FreeHome"

function LegacySupplierDashboard() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const t = useTranslations("Portal.Supplier")
  const tHome = useTranslations("Portal.Home")
  const locale = useLocale()

  const { profile } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const myOrgId = (profile?.organizationId as string | undefined) || user?.uid
  const activeCompanyName = useActiveCompanyName(profile, user?.uid)
  const { can } = usePermissions()
  const modules = useModuleComponents("supplier")
  const { on } = useModules()
  const seesRfqs = can("offers.view")
  const specializations = useMemo(() => {
    const list = (profile as { specializations?: unknown } | null)?.specializations
    return Array.isArray(list) ? (list.filter((s) => typeof s === "string") as string[]) : []
  }, [profile])
  const specsKey = specializations.slice(0, 30).join("|")

  // The RFQs open to this supplier — in his specializations when he named any.
  const rfqsQuery = useMemoFirebase(() => {
    if (!firestore || !user || !seesRfqs || !profile) return null
    const specs = specsKey ? specsKey.split("|") : []
    return specs.length > 0
      ? query(collection(firestore, "rfqs"), where("status", "==", "New"), where("category", "in", specs))
      : query(collection(firestore, "rfqs"), where("status", "==", "New"))
  }, [firestore, user, seesRfqs, profile, specsKey])
  const { data: rfqs } = useCollection(rfqsQuery)

  const offersQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId || !seesRfqs) return null
    return query(collection(firestore, "offers"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId, seesRfqs])
  const { data: offers } = useCollection(offersQuery)

  const { ordersById, ready: ordersReady } = useSupplierOrdersById(myOrgId)
  const orders = useMemo(() => [...ordersById.values()], [ordersById])

  const contactsQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId || !on("crm") || !can("crm.manage")) return null
    return query(collection(firestore, "crmContacts"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId, on, can])
  const { data: contacts } = useCollection(contactsQuery)

  // HR records are read by HR roles only (HR 1.0, RL-03) — others see no headcount.
  const seesHr = can("employees.manage") || can("hr.gov") || can("hr.payroll") || can("hr.management")
  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId || !seesHr || !on("hr")) return null
    return query(collection(firestore, "employees"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId, seesHr, on])
  const { data: employees } = useCollection(employeesQuery)

  const { counts: todoCounts } = useMyTodoCounts(myOrgId, user?.uid, "supplier")

  const now = Date.now()
  const rfqList = (rfqs || []) as HomeRfq[]
  const offerList = (offers || []) as HomeOffer[]
  const counts = supplierHomeCounts({ rfqs: rfqList, offers: offerList, orders, now })
  const items = supplierDecisions({ rfqs: rfqList, offers: offerList, orders, now, seesRfqs })

  const badges = new Map<PortalComponentId, number>()
  if (counts.ordersToAccept > 0) badges.set("project-management", counts.ordersToAccept)
  if (seesRfqs && counts.unanswered > 0) badges.set("procurement", counts.unanswered)
  if (todoCounts.due > 0) badges.set("activities", todoCounts.due)
  const urgentTiles = new Set<PortalComponentId>(["project-management", ...(todoCounts.overdue > 0 ? (["activities"] as const) : [])])

  const tileStats: Partial<Record<PortalComponentId, string>> = {
    "project-management": t("tile_stats_orders", { total: counts.ordersTotal, delivery: counts.ordersInDelivery }),
    procurement: seesRfqs ? t("tile_stats_sales", { open: counts.openRfqs, offers: offerList.length }) : undefined,
    crm: contacts ? tHome("tile_stats_crm", { count: contacts.length }) : undefined,
    hr: employees ? tHome("tile_stats_hr", { count: employees.length }) : undefined,
    activities: tHome("tile_stats_activities", { overdue: todoCounts.overdue, today: todoCounts.today, planned: todoCounts.planned }),
  }

  const kpis: HomeKpi[] = [
    { key: "decisions", allowed: true, value: items.length, label: tHome("home_kpi_decisions_label"), dot: items.length > 0 },
    { key: "rfqs", allowed: seesRfqs, value: counts.openRfqs, label: t("home_kpi_open_rfqs"), dot: false },
    { key: "pending", allowed: seesRfqs, value: counts.pendingOffers, label: t("home_kpi_pending_offers"), dot: false },
    { key: "orders", allowed: true, value: counts.ordersInDelivery, label: t("home_kpi_orders_in_delivery"), dot: false },
  ]
    .filter((k) => k.allowed)
    .slice(0, 3)
    .map(({ allowed: _allowed, ...k }) => k)

  const decisions: HomeDecision[] = items.map((d) =>
    d.kind === "po_to_accept"
      ? {
          id: d.id,
          moduleId: "project-management",
          title: t("decision_po_to_accept", { number: displayPoNumber(d.docNumber, locale), rfq: d.rfqTitle || "—" }),
          chip: d.waitingDays > 0 ? { label: t("decision_waiting_days", { days: d.waitingDays }), tone: d.waitingDays >= 2 ? "destructive" : "warning" } : null,
          actionLabel: t("decision_po_action"),
          href: d.href,
        }
      : {
          id: d.id,
          moduleId: "procurement",
          title: t("decision_rfq_to_answer", { title: d.title || "—" }),
          chip: d.daysLeft === null ? null : d.daysLeft === 0 ? { label: t("decision_closes_today"), tone: "destructive" } : d.daysLeft <= 3 ? { label: t("decision_closes_in", { days: d.daysLeft }), tone: "warning" } : null,
          metrics: d.daysLeft === null ? [] : [{ label: t("decision_metric_days_left"), value: d.daysLeft }],
          actionLabel: t("decision_rfq_action"),
          href: d.href,
        }
  )

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
        recent={recentOffers(offerList)}
        decisions={{ loading: !ordersReady, items: decisions }}
      />
    </PortalLayout>
  )
}

export default function Page() {
  return <PlanSwitch free={<FreeHome />} full={<LegacySupplierDashboard />} />
}
