"use client"

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Banknote, Handshake, LayoutGrid, List, UserX, UsersRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToastAction } from "@/components/ui/toast"
import { CRM_ROW_LINK_CLASS, CrmEmptyState, CrmListSkeleton, CrmStat, CrmStatRow } from "@/components/crm/CrmShell"
import { CrmShowMore, CrmSortHeader, CrmToolbar } from "@/components/crm/CrmToolbar"
import { Link } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { staffName, type AdminCrm } from "@/hooks/useAdminCrm"
import { useCrmListState, type CrmListConfig } from "@/hooks/useCrmListState"
import { LEAD_CHANNELS, LEAD_SEGMENTS, formatCrmDate, inLeadSegment, leadCards, leadContactBuckets, type LeadRow } from "@/lib/admin-crm"
import { setLeadArchived } from "@/lib/admin-crm-writes"
import { cn } from "@/lib/utils"
import { LeadBoard } from "./LeadBoard"
import { LtrValue, Money, StageBadge } from "./parts"
import { useStageChange } from "./useStageChange"

type View = "board" | "list"
type Row = LeadRow & { dupes: number; client: string }

const NONE = "__none"
const STAGE_ORDER = ["new", "contacted", "demo", "negotiation", "converted", "lost"]

/**
 * ADM-01…03 on the subscribers' CRM components: one row of four numbers, then the shared toolbar — the segment strip
 * (where the lead ended up), search, saved views, the filters panel (who I want to see), the view menu — and the board
 * (open stages only) or the table. Search, segment and filters work together; the counts say «17 of 44».
 */
export function LeadsTab({ crm, view, onView }: { crm: AdminCrm; view: View; onView: (v: View) => void }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const me = crm.user?.uid ?? ""
  const myName = staffName(crm.staff.find((s) => s.id === me) ?? { id: me, email: crm.user?.email ?? "" })
  const stage = useStageChange({ uid: me, name: myName })

  const rows = useMemo<Row[]>(
    () => crm.leadRows.map((r) => ({ ...r, dupes: crm.matches.get(r.crmId)?.duplicates.length ?? 0, client: crm.matches.get(r.crmId)?.client ?? "" })),
    [crm.leadRows, crm.matches],
  )
  const cards = useMemo(() => leadCards(crm.leadRows), [crm.leadRows])

  const config: CrmListConfig<Row> = {
    segments: LEAD_SEGMENTS.map((s) => ({ key: s, label: t(`segment_${s}`), predicate: (r: Row) => inLeadSegment(r, s) })),
    facets: [
      { key: "channel", label: t("col_source"), options: LEAD_CHANNELS.map((c) => ({ value: c, label: t(`channel_${c}`) })), valueOf: (r) => r.channel },
      {
        key: "owner",
        label: t("owner_label"),
        options: [
          { value: me, label: t("filter_me") },
          { value: NONE, label: t("unassigned") },
          ...crm.staff.filter((s) => s.id !== me).map((s) => ({ value: s.id, label: staffName(s) })),
        ],
        valueOf: (r) => r.ownerUid || NONE,
      },
      { key: "kind", label: t("col_type"), options: (["contractor", "supplier"] as const).map((k) => ({ value: k, label: t(`kind_${k}`) })), valueOf: (r) => r.kind },
      { key: "contact", label: t("last_contact"), options: (["never", "over7", "within7"] as const).map((k) => ({ value: k, label: t(`contact_${k}`) })), valueOf: (r) => leadContactBuckets(r) },
      { key: "quality", label: t("data_quality"), options: [{ value: "dupes", label: t("filter_dupes") }], valueOf: (r) => (r.dupes ? "dupes" : null) },
    ],
    savedViews: [
      { key: "all", label: t("view_all_leads"), segment: "all" },
      { key: "mine", label: t("view_mine"), segment: "open", facets: { owner: [me] } },
      { key: "unowned", label: t("view_unowned"), segment: "open", facets: { owner: [NONE] } },
      { key: "silent", label: t("view_silent"), segment: "open", facets: { contact: ["over7"] } },
      { key: "never", label: t("view_never"), segment: "open", facets: { contact: ["never"] } },
      { key: "dupes", label: t("view_dupes"), segment: "all", facets: { quality: ["dupes"] } },
    ],
    groups: [
      { key: "owner", label: t("owner_label"), keyOf: (r) => r.ownerName || t("unassigned") },
      { key: "channel", label: t("col_source"), keyOf: (r) => t(`channel_${r.channel}`) },
      { key: "stage", label: t("col_stage"), keyOf: (r) => t(`stage_${r.stage}`) },
      { key: "kind", label: t("col_type"), keyOf: (r) => t(`kind_${r.kind}`) },
    ],
    sorts: [
      { key: "name", valueOf: (r) => r.name },
      { key: "stage", valueOf: (r) => STAGE_ORDER.indexOf(r.stage) },
      { key: "owner", valueOf: (r) => r.ownerName || "~" },
      { key: "received", valueOf: (r) => r.createdMs },
      { key: "contact", valueOf: (r) => r.silentDays },
      { key: "followUp", valueOf: (r) => r.nextFollowUp || "9999-12-31" },
      { key: "value", valueOf: (r) => r.expectedValue },
    ],
    searchText: (r) => [r.name, r.company, r.email, r.phone, r.city].join(" "),
    defaultSegment: "open",
    defaultSort: { key: "received", direction: -1 },
    pageSize: 25,
  }
  const state = useCrmListState(rows, config, locale)

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

  const board = view === "board" && state.segment === "open"
  const viewSwitch = (
    <div role="group" aria-label={t("view_label")} className="inline-flex h-10 items-center rounded-md border bg-muted/40 p-1">
      {(["board", "list"] as const).map((v) => {
        const Icon = v === "board" ? LayoutGrid : List
        return (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => onView(v)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{t(`view_${v}`)}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-6">
      <CrmStatRow>
        <CrmStat icon={UsersRound} label={t("kpi_total_leads")} value={cards.leads} onClick={() => state.applyView("all")} active={state.activeView === "all"} />
        <CrmStat icon={UserX} label={t("kpi_stale_leads")} value={cards.noContact} accent="warning" onClick={() => state.applyView("silent")} active={state.activeView === "silent"} />
        <CrmStat icon={Handshake} label={t("kpi_unowned")} value={cards.unowned} onClick={() => state.applyView("unowned")} active={state.activeView === "unowned"} />
        <CrmStat
          icon={Banknote}
          label={t("kpi_expected_value")}
          value={cards.valued ? <Money amount={cards.expectedValue} /> : "—"}
          accent="success"
          hint={cards.valued ? t("kpi_expected_hint", { n: cards.valued }) : t("kpi_expected_none")}
        />
      </CrmStatRow>

      <CrmToolbar config={config} state={state} extra={viewSwitch} countAll={board} />

      {crm.loading.leads ? (
        <CrmListSkeleton />
      ) : state.matching === 0 ? (
        <div className="rounded-xl border bg-card">
          <CrmEmptyState icon={UsersRound} title={rows.length === 0 ? t("empty_leads") : t("empty_filtered")} />
        </div>
      ) : board ? (
        <div className="rounded-xl border bg-card">
          <LeadBoard rows={state.filtered} matches={crm.matches} onMove={move} onRemove={(r) => void remove(r)} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <Table className={cn(state.dense && "[&_td]:py-1.5")}>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead><CrmSortHeader state={state} sortKey="name" label={t("col_lead")} /></TableHead>
                  <TableHead><CrmSortHeader state={state} sortKey="stage" label={t("col_stage")} /></TableHead>
                  <TableHead className="hidden md:table-cell"><CrmSortHeader state={state} sortKey="owner" label={t("col_owner")} /></TableHead>
                  <TableHead className="hidden lg:table-cell"><CrmSortHeader state={state} sortKey="value" label={t("kpi_expected_value")} /></TableHead>
                  <TableHead className="hidden sm:table-cell"><CrmSortHeader state={state} sortKey="received" label={t("col_received")} /></TableHead>
                  <TableHead className="hidden sm:table-cell"><CrmSortHeader state={state} sortKey="contact" label={t("last_contact")} /></TableHead>
                  <TableHead className="hidden lg:table-cell"><CrmSortHeader state={state} sortKey="followUp" label={t("col_follow_up")} /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.grouped.map((g) => [
                  g.label ? (
                    <TableRow key={`g-${g.key}`} className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={7} className="py-1.5 text-xs font-bold text-muted-foreground">
                        {g.label} <bdi className="font-normal">({g.rows.length})</bdi>
                      </TableCell>
                    </TableRow>
                  ) : null,
                  ...g.rows.map((r) => (
                    <TableRow key={r.crmId} className={CRM_ROW_LINK_CLASS}>
                      <TableCell>
                        <Link href={`/admin/crm/leads/${r.crmId}`} className="font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {r.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{[t(`channel_${r.channel}`), r.company].filter(Boolean).join(" · ")}</p>
                        <div className="mt-1 max-w-64 text-xs text-muted-foreground"><LtrValue value={r.email || r.phone} /></div>
                        {(r.dupes > 0 || r.client || r.archived) && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.archived && <Badge variant="outline" className="text-[11px]">{t("flag_removed")}</Badge>}
                            {r.client && <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[11px] text-warning">{t("flag_client", { name: r.client })}</Badge>}
                            {r.dupes > 0 && <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[11px] text-warning">{t("flag_duplicate", { count: r.dupes })}</Badge>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell><StageBadge stage={r.stage} label={t(`stage_${r.stage}`)} /></TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{r.ownerName || <span className="text-muted-foreground">{t("unassigned")}</span>}</TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">{r.expectedValue > 0 ? <Money amount={r.expectedValue} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">{formatCrmDate(r.createdMs, locale)}</TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {r.daysSinceContact === null ? <span className="font-medium text-warning">{t("never_contacted")}</span> : <span className={cn(r.stale && "font-medium text-warning")}>{t("days_ago", { n: r.daysSinceContact })}</span>}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {r.nextFollowUp ? <span className={cn(r.followUpDue && "font-medium text-destructive")}>{formatCrmDate(r.nextFollowUp, locale)}</span> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  )),
                ])}
              </TableBody>
            </Table>
          </div>
          <CrmShowMore state={state} />
        </div>
      )}
      {stage.dialog}
    </div>
  )
}
