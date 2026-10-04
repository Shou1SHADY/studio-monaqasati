"use client"

// People (PRD §5 "People", EM-01, RL-03): the register — search, workplace
// and status filters, the nearest document's state, and the wage only for
// those who may see pay (for everyone else the column does not exist).

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { FileUp, Search, UserPlus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import type { HrAccess } from "@/hooks/useHrAccess"
import { Link } from "@/i18n/routing"
import { displayName, EMPLOYEE_STATUSES, statusOn, type EmployeeStatus } from "@/lib/hr/employee"
import { empNo, hrMoney, nearestDocument, todayDay } from "@/lib/hr/format"
import type { DocState } from "@/lib/hr/documents"
import { wageOf } from "@/lib/hr/pay"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
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
  const { employees, sites, siteName, isLoading } = useHrPeople(access.orgId)
  const money = access.allowed("pay.view")
  const payMap = useOrgPay(access.orgId, money)
  const [search, setSearch] = useState("")
  const [site, setSite] = useState("__all__")
  const [status, setStatus] = useState<EmployeeStatus | "all">("active")
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
        if (status !== "all" && statusOn(e, today) !== status) return false
        if (site === UNASSIGNED_SITE) return !e.siteId
        return site === "__all__" || e.siteId === site
      }),
    [employees, search, status, site, t, today]
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
      <div className={cn("flex flex-wrap gap-1.5", search.trim() && "opacity-50")} role="group" aria-label={t("people.filter_status")}>
        {(["all", ...EMPLOYEE_STATUSES] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} aria-pressed={status === s} onClick={() => setStatus(s)} className="rounded-full">
            {t(s === "all" ? "people.all" : `status.${s}`)}
            {s !== "all" && (counts.get(s) ?? 0) > 0 && <span className="ms-1.5 tabular-nums opacity-70">{counts.get(s)}</span>}
          </Button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("people.col.no")}</th>
              <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("people.col.name")}</th>
              <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("people.col.trade")}</th>
              <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("people.col.site")}</th>
              <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("people.col.document")}</th>
              <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("people.col.status")}</th>
              {money && <th scope="col" className="px-3 py-2.5 text-end font-bold">{t("people.col.wage")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const doc = nearestDocument(e.docs, today, access.settings.policies.renewWindowDays)
              const pay = payMap.get(e.id)
              return (
                <tr key={e.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground" dir="ltr">
                    {empNo(e.no)}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/${portal}/hr/people/${e.id}`} className="font-bold text-foreground hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded" dir="auto">
                      {e.names ? displayName(e, locale) : (e as unknown as { name?: string }).name}
                    </Link>
                    <span className="block text-[11px] text-muted-foreground">{t(`nat.${e.nationality}` as "nat.sa")}</span>
                  </td>
                  <td className="px-3 py-2">{e.trade ? t(`trade.${e.trade}` as "trade.mason") : (e as unknown as { role?: string }).role || "—"}</td>
                  <td className="px-3 py-2">{siteName(e.siteId) ?? <span className="text-muted-foreground">{t("sites.unassigned")}</span>}</td>
                  <td className="px-3 py-2">
                    {doc ? <StatusPill tone={DOC_TONE[doc.state]}>{t("people.doc_line", { doc: t(`doc.${doc.type}`), state: t(`doc_state.${doc.state}`) })}</StatusPill> : <span className="text-xs text-muted-foreground">{t("people.no_docs")}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={STATUS_TONE[statusOn(e, today)]}>{t(`status.${statusOn(e, today)}`)}</StatusPill>
                  </td>
                  {money && (
                    <td className="px-3 py-2 text-end font-semibold tabular-nums" dir="ltr">
                      {pay ? hrMoney(wageOf(pay)) : "—"}
                    </td>
                  )}
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={money ? 7 : 6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t("people.none_match")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {adding && <NewEmployeeDialog open onOpenChange={setAdding} access={access} actorName={actorName} sites={sites} portal={portal} />}
      {importDialog}
    </div>
  )
}
