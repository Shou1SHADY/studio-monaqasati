"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Building2, ClipboardList, Handshake, LayoutGrid, Plus, UserPlus } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { AddLeadDialog } from "@/components/admin/AddLeadDialog"
import { ActivitiesTab } from "@/components/admin/crm/ActivitiesTab"
import { ClientsTab } from "@/components/admin/crm/ClientsTab"
import { DashboardTab } from "@/components/admin/crm/DashboardTab"
import { LeadsTab } from "@/components/admin/crm/LeadsTab"
import { Button } from "@/components/ui/button"
import { staffName, useAdminCrm } from "@/hooks/useAdminCrm"
import { CrmTabRail } from "@/components/crm/CrmShell"

const TABS = ["dashboard", "clients", "leads", "activities"] as const
type Tab = (typeof TABS)[number]
const ICON = { dashboard: LayoutGrid, clients: Building2, leads: UserPlus, activities: ClipboardList } as const

const isTab = (v: string | null): v is Tab => TABS.includes(v as Tab)

/**
 * Platform staff's client CRM (ADM-01): the same four tabs as the subscribers' CRM — dashboard,
 * clients, leads, activities — so the team learns one layout. "Clients" and "Leads" are two
 * tabs that are never merged: a lead becomes a client when its account is created.
 */
export default function AdminCrmPage() {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const searchParams = useSearchParams()
  const crm = useAdminCrm()
  // The tab is the URL (ADM-01): each tab has its own link, and back/forward move between them.
  const raw = searchParams.get("tab")
  const tab: Tab = isTab(raw) ? raw : "dashboard"
  const [view, setView] = useState<"board" | "list">("board")
  const [addLeadOpen, setAddLeadOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  const me = crm.user?.uid ?? ""
  const myName = staffName(crm.staff.find((s) => s.id === me) ?? { id: me, email: crm.user?.email ?? "" })
  const counts: Record<Tab, number | null> = {
    dashboard: null,
    clients: crm.clientRows.length,
    leads: crm.leadRows.filter((r) => !r.archived).length,
    activities: crm.activities.filter((a) => a.status === "scheduled").length,
  }

  return (
    <PortalLayout>
      <div className="space-y-6" dir={locale === "ar" ? "rtl" : "ltr"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-headline text-2xl font-black text-primary">
              <Handshake size={22} className="shrink-0" aria-hidden="true" />
              {t("page_title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("page_subtitle")}</p>
          </div>
          {tab === "leads" && (
            <Button onClick={() => setAddLeadOpen(true)} className="gap-1.5">
              <Plus size={15} aria-hidden="true" />
              {t("add_lead")}
            </Button>
          )}
          {tab === "activities" && (
            <Button onClick={() => setActivityOpen(true)} className="gap-1.5">
              <Plus size={15} aria-hidden="true" />
              {t("activity_log")}
            </Button>
          )}
        </div>

        <CrmTabRail
          label={t("page_title")}
          tabs={TABS.map((k) => ({ key: k, href: `/admin/crm?tab=${k}`, label: t(`tab_${k}`), icon: ICON[k], count: counts[k] }))}
          isActive={(x) => x.key === tab}
        />

        {tab === "dashboard" && <DashboardTab crm={crm} />}
        {tab === "clients" && <ClientsTab crm={crm} />}
        {tab === "leads" && <LeadsTab crm={crm} view={view} onView={setView} />}
        {tab === "activities" && <ActivitiesTab crm={crm} dialogOpen={activityOpen} onDialogOpen={setActivityOpen} />}
      </div>
      <AddLeadDialog open={addLeadOpen} onOpenChange={setAddLeadOpen} ownerName={myName} />
    </PortalLayout>
  )
}
