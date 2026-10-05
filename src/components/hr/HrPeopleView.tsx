"use client"

// People (PRD §5 "People", EM-01, RL-03; the prototype's VIEWS.people): the
// register — segments with live counts (all · sites · office · unassigned · on
// leave · documents due · leaving · left), counted AFTER the search and the
// filters; search across the segments; workplace and trade filters; worst
// document first, then the number. Each row: the person, his place (a
// project's end, "unassigned since"), his worst document (or "valid", with
// "passport first" when it applies), his status with its date or what comes
// next — and the wage only for those who may see pay (for everyone else the
// column does not exist).

import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { FileUp, Search, UserPlus, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import type { HrAccess } from "@/hooks/useHrAccess"
import { Link } from "@/i18n/routing"
import { onLeaveOn } from "@/lib/hr/attendance"
import { DOC_RANK, docRows, passportFirst, worstDoc, type DocState } from "@/lib/hr/documents"
import { displayName, nextDue, statusFact, statusOn, type EmployeeStatus, type HrEmployee } from "@/lib/hr/employee"
import { applyDueMoves } from "@/lib/hr/employee-writes"
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { wageOf } from "@/lib/hr/pay"
import { isOffice, UNASSIGNED_SITE, type HrSite } from "@/lib/hr/sites"
import { inPeopleFilter, PEOPLE_FILTERS, type PeopleFilter } from "@/lib/hr/today"
import { matchesSearch } from "@/lib/search-text"
import { cn } from "@/lib/utils"
import type { HrPortal } from "./HrShell"
import { HrImportDialog } from "./HrImportDialog"
import { NewEmployeeDialog } from "./NewEmployeeDialog"

export const DOC_TONE: Record<DocState, PillTone> = { missing: "mute", valid: "ok", d60: "info", d30: "warn", expired: "bad" }
export const STATUS_TONE: Record<EmployeeStatus, PillTone> = { expected: "info", active: "ok", leave: "violet", leaving: "warn", left: "mute" }

/** The register's segments (the prototype's PSEG, + leaving and left from the PRD). */
export const PEOPLE_SEGMENTS = ["all", "sites", "office", "unassigned", "leave", "docs", "leaving", "left"] as const
export type PeopleSegment = (typeof PEOPLE_SEGMENTS)[number]

/** Is a person in a segment? "All" is everyone not gone; a workplace segment by its kind (an office is HQ or a
 * department); documents = any not in order. Pure. */
export function inSegment(seg: PeopleSegment, e: HrEmployee, ctx: { site: HrSite | null; status: EmployeeStatus; onLeave: boolean; worst: number }): boolean {
  if (seg === "left") return ctx.status === "left"
  if (ctx.status === "left") return false
  switch (seg) {
    case "all":
      return true
    case "sites":
      return Boolean(e.siteId && e.siteId !== UNASSIGNED_SITE && ctx.site && !isOffice(ctx.site.type))
    case "office":
      return Boolean(ctx.site && isOffice(ctx.site.type))
    case "unassigned":
      return !e.siteId || e.siteId === UNASSIGNED_SITE
    case "leave":
      return ctx.status === "leave" || ctx.onLeave
    case "docs":
      return ctx.worst > 0
    case "leaving":
      return ctx.status === "leaving"
  }
}

type RowFacts = { site: HrSite | null; status: EmployeeStatus; onLeave: boolean; rank: number }
const segmentOf = (s: PeopleSegment, e: HrEmployee, facts: ReadonlyMap<string, RowFacts>) => {
  const f = facts.get(e.id)
  return Boolean(f) && inSegment(s, e, { site: f!.site, status: f!.status, onLeave: f!.onLeave, worst: f!.rank })
}

export function HrPeopleView({ access, portal, actorName }: { access: HrAccess; portal: HrPortal; actorName: string }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const { employees, sites, siteName, isLoading } = useHrPeople(access)
  const { requests } = useHrRequests(access)
  const money = access.allowed("pay.view")
  const payMap = useOrgPay(access.orgId, money)
  const window = access.settings.policies.renewWindowDays
  const [search, setSearch] = useState("")
  const [site, setSite] = useState("__all__")
  const [trade, setTrade] = useState("__all__")
  const [seg, setSeg] = useState<PeopleSegment>("all")
  // Today's KPIs open People on the list they count (TD-04): ?filter=docs|iqama|iqama_site.
  const params = useSearchParams()
  const asked = params.get("filter") as PeopleFilter | null
  const [docFilter, setDocFilter] = useState<PeopleFilter | null>(asked && PEOPLE_FILTERS.includes(asked) ? asked : null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)

  // AS-03 — moves dated ahead take effect on their day: the HR manager's list applies those now due.
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current || !firestore || isLoading || !access.allowed("employee.assign")) return
    const due = employees.filter((e) => e.move && e.move.on <= today)
    if (!due.length) return
    applied.current = true
    void applyDueMoves(firestore, access.ctx, { uid: access.ctx.uid, name: actorName || null }, due)
  }, [firestore, isLoading, employees, today, access, actorName])

  const importButton = access.allowed("employee.import") ? (
    <Button variant="outline" onClick={() => setImporting(true)}>
      <FileUp size={15} className="me-1.5" aria-hidden="true" />
      {t("imp.open")}
    </Button>
  ) : null
  const importDialog = importing ? <HrImportDialog access={access} actorName={actorName} employees={employees} sites={sites} onClose={() => setImporting(false)} /> : null

  const facts = useMemo(() => {
    const leaving = onLeaveOn(requests, today)
    return new Map(
      employees.map((e) => {
        const rows = docRows(e, today, window)
        const worst = worstDoc(rows)
        const st = statusOn(e, today)
        const leaveTo = leaving.has(e.id) ? (requests.find((r) => r.employeeId === e.id && r.kind === "leave" && r.state === "approved" && r.leave && r.leave.from <= today && r.leave.to >= today)?.leave?.to ?? null) : null
        return [e.id, { rows, worst, rank: worst ? DOC_RANK[worst.state] : 0, status: st, onLeave: leaving.has(e.id), fact: statusFact(e, { leaveTo }), next: nextDue(e, rows, today), site: sites.find((s) => s.id === e.siteId) ?? null }] as const
      })
    )
  }, [employees, requests, sites, today, window])

  // Search and filters first, then the segment (the prototype counts each segment after them).
  const filtered = useMemo(
    () =>
      employees.filter((e) => {
        if (search.trim() && !matchesSearch(search, [e.names?.ar, e.names?.en, String(e.no), e.idNo, t(`trade.${e.trade}` as "trade.mason"), siteName(e.siteId)])) return false
        if (site !== "__all__" && (site === UNASSIGNED_SITE ? Boolean(e.siteId) : e.siteId !== site)) return false
        if (trade !== "__all__" && e.trade !== trade) return false
        // A KPI's list counts everyone not left — it looks across the segments, as the KPI does.
        if (docFilter && !inPeopleFilter(docFilter, e, today, window)) return false
        return true
      }),
    [employees, search, site, trade, t, siteName, docFilter, today, window]
  )
  const counts = useMemo(() => {
    const m = new Map<PeopleSegment, number>()
    for (const s of PEOPLE_SEGMENTS) m.set(s, filtered.filter((e) => segmentOf(s, e, facts)).length)
    return m
  }, [filtered, facts])
  // A search looks across the segments (search-text rule) — the left included; a KPI's filter across all not left.
  const searching = Boolean(search.trim())
  const rows = useMemo(
    () =>
      filtered
        .filter((e) => (searching ? true : docFilter ? segmentOf("all", e, facts) : segmentOf(seg, e, facts)))
        .sort((a, b) => (facts.get(b.id)?.rank ?? 0) - (facts.get(a.id)?.rank ?? 0) || (a.no ?? 0) - (b.no ?? 0)),
    [filtered, searching, docFilter, seg, facts]
  )
  const trades = useMemo(() => [...new Set(employees.map((e) => e.trade).filter(Boolean))].map((k) => ({ value: k, label: t(`trade.${k}` as "trade.mason") })).sort((a, b) => a.label.localeCompare(b.label, locale)), [employees, t, locale])

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
        <div className="w-full sm:w-48">
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
        <div className="w-full sm:w-44">
          <SearchableSelect
            size="sm"
            className="h-10"
            ariaLabel={t("people.filter_trade")}
            value={trade}
            onChange={setTrade}
            options={[{ value: "__all__", label: t("people.all_trades") }, ...trades]}
            placeholder={t("people.filter_trade")}
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
      {docFilter && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("people.filter_docs")}>
          {PEOPLE_FILTERS.map((f) => (
            <Button key={f} size="sm" variant={docFilter === f ? "default" : "outline"} aria-pressed={docFilter === f} onClick={() => setDocFilter(docFilter === f ? null : f)} className="rounded-full">
              {t(`people.filter.${f}`)}
              {docFilter === f && <X size={13} className="ms-1.5" aria-hidden="true" />}
            </Button>
          ))}
        </div>
      )}
      <div className={cn("flex flex-wrap gap-1.5", (search.trim() || docFilter) && "opacity-50")} role="group" aria-label={t("people.segments")}>
        {PEOPLE_SEGMENTS.map((s) => (
          <Button key={s} size="sm" variant={seg === s ? "default" : "outline"} aria-pressed={seg === s} onClick={() => setSeg(s)} className="rounded-full">
            {t(`people.seg.${s}`)}
            <span className="ms-1.5 tabular-nums opacity-70">{counts.get(s) ?? 0}</span>
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
              <th scope="col" className="px-3 py-2.5 text-start font-bold">{t("people.col.status_next")}</th>
              {money && <th scope="col" className="px-3 py-2.5 text-end font-bold">{t("people.col.wage")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const f = facts.get(e.id)!
              const pay = payMap.get(e.id)
              return (
                <tr key={e.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground" dir="ltr">
                    {empNo(e.no)}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/${portal}/hr/people/${e.id}`} className="rounded font-bold text-foreground hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                      {e.names ? displayName(e, locale) : (e as unknown as { name?: string }).name}
                    </Link>
                    <span className="block text-[11px] text-muted-foreground">{t(`nat.${e.nationality}` as "nat.sa")}</span>
                  </td>
                  <td className="px-3 py-2">{e.trade ? t(`trade.${e.trade}` as "trade.mason") : (e as unknown as { role?: string }).role || "—"}</td>
                  <td className="px-3 py-2">
                    {siteName(e.siteId) ?? <span className="text-muted-foreground">{t("sites.unassigned")}</span>}
                    {f.site?.type === "project" && f.site.endDate && <span className="block text-[11px] text-muted-foreground">{t("people.site_ends", { date: hrDate(f.site.endDate, locale) })}</span>}
                    {!e.siteId && e.siteSince && <span className="block text-[11px] text-muted-foreground">{t("file.since", { date: hrDate(e.siteSince, locale) })}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {f.worst ? (
                      <StatusPill tone={DOC_TONE[f.worst.state]}>
                        {t("people.doc_line", { doc: t(`doc.${f.worst.type}`), state: f.worst.pendingDue && !f.worst.expiry ? t("file.not_issued") : f.worst.state === "expired" ? t("doc_state.expired") : hrDate(f.worst.expiry, locale) })}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="ok">{t("people.docs_valid")}</StatusPill>
                    )}
                    {passportFirst(e.docs ?? {}, today) && <span className="ms-1.5 text-[11px] font-semibold text-warning">{t("people.passport_first")}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusPill tone={STATUS_TONE[f.status]}>{t(`status.${f.status}`)}</StatusPill>
                      {f.fact && f.fact.kind !== "absent" && f.fact.kind !== "sick" && <span className="text-[11px] text-muted-foreground">{t(`people.fact.${f.fact.kind}`, { date: "date" in f.fact && f.fact.date ? hrDate(f.fact.date, locale) : "—" })}</span>}
                      {!f.fact && f.next && <span className="text-[11px] text-muted-foreground">{t("people.next", { what: f.next.what === "probation" ? t("file.probation") : t(`doc.${f.next.what}`), date: hrDate(f.next.date, locale) })}</span>}
                    </span>
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
