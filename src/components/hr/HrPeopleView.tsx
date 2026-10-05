"use client"

// People (PRD §5 "People", EM-01, RL-03): the register — search, workplace
// and status filters, the nearest document's state, and the wage only for
// those who may see pay (for everyone else the column does not exist).

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { FileUp, Search, UserPlus, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { DataTable, Figure, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useTableLabels } from "@/hooks/useTableLabels"
import { Link } from "@/i18n/routing"
import { displayName, EMPLOYEE_STATUSES, statusOn, type EmployeeStatus, type HrEmployee } from "@/lib/hr/employee"
import { empNo, hrMoney, nearestDocument, todayDay } from "@/lib/hr/format"
import type { DocState } from "@/lib/hr/documents"
import { wageOf } from "@/lib/hr/pay"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
import { inPeopleFilter, PEOPLE_FILTERS, type PeopleFilter } from "@/lib/hr/today"
import { matchesSearch } from "@/lib/search-text"
import { cn } from "@/lib/utils"
import type { HrPortal } from "./HrShell"
import { HrImportDialog } from "./HrImportDialog"
import { NewEmployeeDialog } from "./NewEmployeeDialog"

export const DOC_TONE: Record<DocState, PillTone> = { missing: "mute", valid: "ok", d60: "info", d30: "warn", expired: "bad" }
export const STATUS_TONE: Record<EmployeeStatus, PillTone> = { expected: "info", active: "ok", leave: "violet", leaving: "warn", left: "mute" }

export function HrPeopleView({ access, portal, actorName }: { access: HrAccess; portal: HrPortal; actorName: string }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const today = todayDay()
  const { employees, sites, siteName, isLoading } = useHrPeople(access)
  const money = access.allowed("pay.view")
  const payMap = useOrgPay(access.orgId, money)
  const tableLabels = useTableLabels()
  const [search, setSearch] = useState("")
  const [site, setSite] = useState("__all__")
  const [status, setStatus] = useState<EmployeeStatus | "all">("active")
  // Today's KPIs open People on the list they count (TD-04): ?filter=docs|iqama|iqama_site.
  const params = useSearchParams()
  const asked = params.get("filter") as PeopleFilter | null
  const [docFilter, setDocFilter] = useState<PeopleFilter | null>(asked && PEOPLE_FILTERS.includes(asked) ? asked : null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const importButton = access.allowed("employee.import") ? (
    <Button variant="outline" onClick={() => setImporting(true)}>
      <FileUp size={15} className="me-1.5" aria-hidden="true" />
      {t("imp.open")}
    </Button>
  ) : null
  const importDialog = importing ? <HrImportDialog access={access} actorName={actorName} employees={employees} sites={sites} onClose={() => setImporting(false)} /> : null

  const rows = useMemo(
    () =>
      employees.filter((e) => {
        // A search looks across the state filter (search-text rule).
        if (search.trim()) return matchesSearch(search, [e.names?.ar, e.names?.en, String(e.no), e.idNo, t(`trade.${e.trade}` as "trade.mason")])
        // A KPI's list counts everyone not left — it looks across the status chips, as the KPI does.
        if (docFilter) return inPeopleFilter(docFilter, e, today, access.settings.policies.renewWindowDays) && (site === "__all__" || (site === UNASSIGNED_SITE ? !e.siteId : e.siteId === site))
        if (status !== "all" && statusOn(e, today) !== status) return false
        if (site === UNASSIGNED_SITE) return !e.siteId
        return site === "__all__" || e.siteId === site
      }),
    [employees, search, status, site, t, docFilter, today, access.settings.policies.renewWindowDays]
  )
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of employees) m.set(statusOn(e, today), (m.get(statusOn(e, today)) ?? 0) + 1)
    return m
  }, [employees, today])

  if (!isLoading && employees.length === 0) {
    return (
      <>
        <EmptyState
          icon={Users}
          title={t("people.empty")}
          description={t("people.empty_desc")}
          action={
            access.allowed("employee.create") ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setAdding(true)}>
                  <UserPlus size={15} className="me-1.5" aria-hidden="true" />
                  {t("people.new")}
                </Button>
                {importButton}
              </div>
            ) : undefined
          }
        />
        {importDialog}
        {adding && <NewEmployeeDialog open onOpenChange={setAdding} access={access} actorName={actorName} sites={sites} portal={portal} />}
      </>
    )
  }


  const name = (e: HrEmployee) => (e.names ? displayName(e, locale) : ((e as unknown as { name?: string }).name ?? ""))
  const docOf = (e: HrEmployee) => nearestDocument(e.docs, today, access.settings.policies.renewWindowDays)
  const wageFor = (e: HrEmployee) => {
    const pay = payMap.get(e.id)
    return pay ? wageOf(pay) : null
  }
  const columns: DataColumn<HrEmployee>[] = [
    { key: "no", header: t("people.col.no"), cell: (e) => <Figure className="text-muted-foreground">{empNo(e.no)}</Figure>, sortValue: (e) => e.no, cardHidden: true },
    {
      key: "name",
      header: t("people.col.name"),
      cell: (e) => (
        <span className="block min-w-0">
          <Link href={`/${portal}/hr/people/${e.id}`} className="rounded font-semibold text-foreground hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
            {name(e)}
          </Link>
          <span className="block text-xs text-muted-foreground">
            {t(`nat.${e.nationality}` as "nat.sa")} · <Figure>{empNo(e.no)}</Figure>
          </span>
        </span>
      ),
      sortValue: name,
    },
    { key: "trade", header: t("people.col.trade"), cell: (e) => (e.trade ? t(`trade.${e.trade}` as "trade.mason") : (e as unknown as { role?: string }).role || "—"), sortValue: (e) => (e.trade ? t(`trade.${e.trade}` as "trade.mason") : ""), hideBelow: "lg" },
    { key: "site", header: t("people.col.site"), cell: (e) => siteName(e.siteId) ?? <span className="text-muted-foreground">{t("sites.unassigned")}</span>, sortValue: (e) => siteName(e.siteId) ?? "" },
    {
      key: "document",
      header: t("people.col.document"),
      cell: (e) => {
        const doc = docOf(e)
        return doc ? <StatusPill tone={DOC_TONE[doc.state]}>{t("people.doc_line", { doc: t(`doc.${doc.type}`), state: t(`doc_state.${doc.state}`) })}</StatusPill> : <span className="text-xs text-muted-foreground">{t("people.no_docs")}</span>
      },
      // The soonest expiry first; none last.
      sortValue: (e) => docOf(e)?.expiry ?? null,
    },
    { key: "status", header: t("people.col.status"), cell: (e) => <StatusPill tone={STATUS_TONE[statusOn(e, today)]}>{t(`status.${statusOn(e, today)}`)}</StatusPill>, sortValue: (e) => t(`status.${statusOn(e, today)}`) },
    ...(money
      ? [
          {
            key: "wage",
            header: t("people.col.wage"),
            numeric: true,
            cell: (e: HrEmployee) => {
              const w = wageFor(e)
              return w == null ? "—" : hrMoney(w)
            },
            sortValue: wageFor,
            footer: hrMoney(rows.reduce((sum, e) => sum + (wageFor(e) ?? 0), 0)),
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label={t("people.search")} placeholder={t("people.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" />
        </div>
        <div className="w-52">
          <SearchableSelect
            size="sm"
            className="h-10"
            ariaLabel={t("people.filter_site")}
            value={site}
            onChange={setSite}
            options={[{ value: "__all__", label: t("people.all_sites") }, ...sites.map((s) => ({ value: s.id, label: s.name })), { value: UNASSIGNED_SITE, label: t("sites.unassigned") }]}
            placeholder={t("people.filter_site")}
            searchPlaceholder={t("search")}
            noResultsText={t("no_results")}
          />
        </div>
        {importButton}
        {access.allowed("employee.create") && (
          <Button onClick={() => setAdding(true)}>
            <UserPlus size={15} className="me-1.5" aria-hidden="true" />
            {t("people.new")}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("people.filter_docs")}>
        {PEOPLE_FILTERS.map((f) => (
          <Button key={f} size="sm" variant={docFilter === f ? "default" : "outline"} aria-pressed={docFilter === f} onClick={() => setDocFilter(docFilter === f ? null : f)} className="rounded-full">
            {t(`people.filter.${f}`)}
            {docFilter === f && <X size={13} className="ms-1.5" aria-hidden="true" />}
          </Button>
        ))}
      </div>
      <div className={cn("flex flex-wrap gap-1.5", (search.trim() || docFilter) && "opacity-50")} role="group" aria-label={t("people.filter_status")}>
        {(["all", ...EMPLOYEE_STATUSES] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} aria-pressed={status === s} onClick={() => setStatus(s)} className="rounded-full">
            {t(s === "all" ? "people.all" : `status.${s}`)}
            {s !== "all" && (counts.get(s) ?? 0) > 0 && <span className="ms-1.5 tabular-nums opacity-70">{counts.get(s)}</span>}
          </Button>
        ))}
      </div>

      <DataTable
        caption={t("people.table")}
        labels={tableLabels}
        columns={columns}
        rows={rows}
        rowKey={(e) => e.id}
        cardTitleKey="name"
        pageSize={50}
        maxHeight="70vh"
        rowTone={(e) => (statusOn(e, today) === "left" ? "mute" : undefined)}
        empty={<EmptyState icon={Users} title={t("people.none_match")} />}
      />
      {adding && <NewEmployeeDialog open onOpenChange={setAdding} access={access} actorName={actorName} sites={sites} portal={portal} />}
      {importDialog}
    </div>
  )
}
