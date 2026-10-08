"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Banknote, LayoutGrid, List, Loader2, Search, UserX, UsersRound, Handshake } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ToastAction } from "@/components/ui/toast"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Link } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { AdminCrm } from "@/hooks/useAdminCrm"
import {
  LEAD_SEGMENTS,
  NO_LEAD_FILTERS,
  countLeadFilters,
  formatCrmDate,
  inLeadSegment,
  leadCards,
  leadSegmentCounts,
  matchesLeadFilters,
  type LeadFilters,
  type LeadRow,
  type LeadSegment,
} from "@/lib/admin-crm"
import { setLeadArchived } from "@/lib/admin-crm-writes"
import { staffName } from "@/hooks/useAdminCrm"
import { useStageChange } from "./useStageChange"
import { matchesSearch } from "@/lib/search-text"
import { cn } from "@/lib/utils"
import { ActiveFilterChips, LeadFiltersButton, LeadViewsButton } from "./LeadFilters"
import { LeadBoard } from "./LeadBoard"
import { CrmKpi, LtrValue, Money, SegmentStrip, StageBadge } from "./parts"

type View = "board" | "list"

/** ADM-01…03: four cards, one segment strip, one toolbar, then the board (four open columns) or the table. */
export function LeadsTab({ crm, view, onView }: { crm: AdminCrm; view: View; onView: (v: View) => void }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const me = crm.user?.uid ?? ""
  const [segment, setSegment] = useState<LeadSegment>("open")
  const [filters, setFilters] = useState<LeadFilters>(NO_LEAD_FILTERS)
  const [search, setSearch] = useState("")
  const myName = staffName(crm.staff.find((s) => s.id === me) ?? { id: me, email: crm.user?.email ?? "" })
  const stage = useStageChange({ uid: me, name: myName })

  const cards = useMemo(() => leadCards(crm.leadRows), [crm.leadRows])
  const counts = useMemo(() => leadSegmentCounts(crm.leadRows), [crm.leadRows])

  // The strip answers "where is it"; the filters answer "which do I want". A search looks across the strip.
  const inSegment = useMemo(() => crm.leadRows.filter((r) => inLeadSegment(r, segment)), [crm.leadRows, segment])
  const searching = search.trim() !== ""
  // A search looks across the strip, so «N of M» counts against the pool it searched.
  const pool = useMemo(() => (searching ? crm.leadRows.filter((r) => !r.archived || segment === "removed") : inSegment), [crm.leadRows, inSegment, searching, segment])
  const visible = useMemo(() => {
    return pool
      .filter((r) => matchesLeadFilters(r, filters, { meUid: me, hasDuplicates: Boolean(crm.matches.get(r.crmId)?.duplicates.length) }))
      .filter((r) => !searching || matchesSearch(search, [r.name, r.company, r.email, r.phone, r.city]))
      .sort((a, b) => b.createdMs - a.createdMs || a.name.localeCompare(b.name))
  }, [pool, crm.matches, filters, search, searching, me])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast({ title: ok })
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }
  const move = (crmId: string, to: string) => {
    const r = crm.leadRows.find((x) => x.crmId === crmId)
    if (r) stage.ask(crmId, r.name, r.stage, to)
  }
  // Removing is one click on the board, so the toast carries its undo.
  const remove = async (r: LeadRow) => {
    if (!firestore) return
    try {
      await setLeadArchived(firestore, r, true, me)
      toast({
        title: t("lead_removed"),
        description: r.name,
        action: (
          <ToastAction altText={t("undo")} onClick={() => void run(() => setLeadArchived(firestore, r, false, me), t("lead_restored"))}>
            {t("undo")}
          </ToastAction>
        ),
      })
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  // The first card counts every live lead, so it opens «all»; the others count open leads and open «open».
  const applyCard = (patch: Partial<LeadFilters>, to: LeadSegment = "open") => {
    setSegment(to)
    setSearch("")
    setFilters({ ...NO_LEAD_FILTERS, ...patch })
  }
  const filtered = countLeadFilters(filters) > 0 || search.trim() !== ""
  const loading = crm.loading.leads

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <CrmKpi icon={UsersRound} label={t("kpi_total_leads")} value={cards.leads} onClick={() => applyCard({}, "all")} active={!filtered && segment === "all"} />
        <CrmKpi icon={UserX} label={t("kpi_stale_leads")} value={cards.noContact} tone={cards.noContact > 0 ? "warning" : undefined} onClick={() => applyCard({ contact: "over7" })} active={filters.contact === "over7"} />
        <CrmKpi icon={Handshake} label={t("kpi_unowned")} value={cards.unowned} onClick={() => applyCard({ owner: "none" })} active={filters.owner === "none"} />
        <CrmKpi
          icon={Banknote}
          label={t("kpi_expected_value")}
          value={cards.valued ? <Money amount={cards.expectedValue} /> : "—"}
          hint={cards.valued ? t("kpi_expected_hint", { n: cards.unvalued }) : t("kpi_expected_none")}
        />
      </div>

      <Card className="overflow-hidden border-none shadow-sm">
        <div className="space-y-3 border-b p-4">
          <SegmentStrip
            label={t("segments_label")}
            items={LEAD_SEGMENTS}
            value={segment}
            onChange={setSegment}
            labelOf={(s) => t(`segment_${s}`)}
            counts={counts}
            // What «converted» means is a hint on the tab, not a line across the page (ADM-02).
            hintOf={(s) => (s === "converted" ? t("converted_hint") : undefined)}
          />
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative md:flex-1">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search_leads_placeholder")} aria-label={t("search_leads_placeholder")} className="ps-9" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LeadViewsButton onPick={setFilters} />
              <LeadFiltersButton value={filters} onApply={setFilters} staff={crm.staff} />
              <div role="group" aria-label={t("view_label")} className="inline-flex rounded-lg border bg-muted/40 p-1">
                {(["board", "list"] as const).map((v) => {
                  const Icon = v === "board" ? LayoutGrid : List
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={view === v}
                      onClick={() => onView(v)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon size={14} aria-hidden="true" />
                      {t(`view_${v}`)}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {t("showing_of", { shown: visible.length, total: pool.length })}
          </p>
        </div>
        <ActiveFilterChips value={filters} onChange={setFilters} staff={crm.staff} />

        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <div className="flex justify-center p-16">
              <Loader2 className="animate-spin text-primary" size={28} />
            </div>
          ) : visible.length === 0 ? (
            <p className="p-12 text-center text-sm text-muted-foreground">{crm.leadRows.length === 0 ? t("empty_leads") : t("empty_filtered")}</p>
          ) : view === "board" && segment === "open" ? (
            <LeadBoard rows={visible} matches={crm.matches} onMove={move} onRemove={(r) => void remove(r)} />
          ) : (
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>{t("col_lead")}</TableHead>
                  <TableHead>{t("col_stage")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("col_owner")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("col_received")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("last_contact")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("col_follow_up")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const m = crm.matches.get(r.crmId)
                  return (
                    <TableRow key={r.crmId} className="hover:bg-muted/30">
                      <TableCell>
                        <Link href={`/admin/crm/leads/${r.crmId}`} className="font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {r.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{[t(`channel_${r.channel}`), r.company].filter(Boolean).join(" · ")}</p>
                        <div className="mt-1 max-w-64 text-xs text-muted-foreground"><LtrValue value={r.email || r.phone} /></div>
                        {(m?.duplicates.length || m?.client || r.archived) && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.archived && <Badge variant="outline" className="text-[11px]">{t("flag_removed")}</Badge>}
                            {m?.client && <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[11px] text-warning">{t("flag_client", { name: m.client })}</Badge>}
                            {m?.duplicates.length ? <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[11px] text-warning">{t("flag_duplicate", { count: m.duplicates.length })}</Badge> : null}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <StageBadge stage={r.stage} label={t(`stage_${r.stage}`)} />
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{r.ownerName || <span className="text-muted-foreground">{t("unassigned")}</span>}</TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">{formatCrmDate(r.createdMs, locale)}</TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {r.daysSinceContact === null ? <span className="font-medium text-warning">{t("never_contacted")}</span> : <span className={cn(r.stale && "font-medium text-warning")}>{t("days_ago", { n: r.daysSinceContact })}</span>}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {r.nextFollowUp ? <span className={cn(r.followUpDue && "font-medium text-warning")}>{formatCrmDate(r.nextFollowUp, locale)}</span> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {stage.dialog}
    </div>
  )
}
