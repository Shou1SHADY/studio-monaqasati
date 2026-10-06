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
import { cn } from "@/lib/utils"

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
  const [tab, setTab] = useState<Tab>(() => (isTab(searchParams.get("tab")) ? (searchParams.get("tab") as Tab) : "dashboard"))
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

  const select = (next: Tab) => {
    setTab(next)
    const url = new URL(window.location.href)
    url.searchParams.set("tab", next)
    window.history.replaceState(null, "", url)
  }

  return (
    <PortalLayout>
      <div className="space-y-6" dir={locale === "ar" ? "rtl" : "ltr"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-headline text-2xl font-black text-foreground md:text-3xl">
              <Handshake size={26} className="shrink-0 text-primary" aria-hidden="true" />
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

        <div role="tablist" aria-label={t("page_title")} className="flex gap-1 overflow-x-auto border-b">
          {TABS.map((k) => {
            const Icon = ICON[k]
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => select(k)}
                className={cn(
                  "-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-bold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={16} aria-hidden="true" />
                {t(`tab_${k}`)}
                {counts[k] !== null && (
                  <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground" dir="ltr">
                    {counts[k]}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {tab === "dashboard" && <DashboardTab crm={crm} />}
        {tab === "clients" && <ClientsTab crm={crm} />}
        {tab === "leads" && <LeadsTab crm={crm} view={view} onView={setView} />}
        {tab === "activities" && <ActivitiesTab crm={crm} dialogOpen={activityOpen} onDialogOpen={setActivityOpen} />}
      </div>
      <AddLeadDialog open={addLeadOpen} onOpenChange={setAddLeadOpen} ownerName={myName} />
    </PortalLayout>
  )
}
