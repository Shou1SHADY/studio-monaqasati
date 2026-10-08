"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CalendarPlus, Handshake, LayoutGrid, Pencil, Table2, UserX, UsersRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { IconButton } from "@/components/module-ui/IconButton"
import { CRM_CARD_LINK_CLASS, CRM_ROW_LINK_CLASS, CrmEmptyState, CrmListSkeleton, CrmStat, CrmStatRow } from "@/components/crm/CrmShell"
import { CrmShowMore, CrmSortHeader, CrmToolbar } from "@/components/crm/CrmToolbar"
import { Link } from "@/i18n/routing"
import { staffName, type AdminCrm } from "@/hooks/useAdminCrm"
import { useCrmListState, type CrmListConfig } from "@/hooks/useCrmListState"
import { CLIENT_SEGMENTS, CLIENT_STAGES, clientCards, clientContactBuckets, formatCrmDate, type ClientRow } from "@/lib/admin-crm"
import { cn } from "@/lib/utils"
import { ActivityDialog } from "./ActivityDialog"
import { LtrValue, StageBadge } from "./parts"

const NONE = "__none"

/**
 * ADM-10: the clients that hold an account, on the subscribers' «Clients» components — a row of numbers, the status
 * strip, the shared toolbar, and a table or cards. Each row opens the client's file; «log activity» is on the row.
 * A lost (churned) client needs no owner and no call, so the «no owner» and «silent» filters — like their cards —
 * leave it out.
 */
export function ClientsTab({ crm }: { crm: AdminCrm }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const me = crm.user?.uid ?? ""
  const actor = { uid: me, name: staffName(crm.staff.find((s) => s.id === me) ?? { id: me, email: crm.user?.email ?? "" }) }
  const [view, setView] = useState<"table" | "cards">("table")
  const [logFor, setLogFor] = useState<ClientRow | null>(null)
  const cards = useMemo(() => clientCards(crm.clientRows), [crm.clientRows])

  const config: CrmListConfig<ClientRow> = {
    segments: CLIENT_SEGMENTS.map((s) => ({ key: s, label: s === "all" ? t("filter_all") : t(`stage_${s}`), predicate: (r: ClientRow) => s === "all" || r.stage === s })),
    facets: [
      { key: "role", label: t("col_type"), options: [{ value: "Contractor", label: t("role_contractor") }, { value: "Supplier", label: t("role_supplier") }], valueOf: (r) => r.role },
      {
        key: "owner",
        label: t("owner_label"),
        options: [
          { value: me, label: t("filter_me") },
          { value: NONE, label: t("unassigned") },
          ...crm.staff.filter((s) => s.id !== me).map((s) => ({ value: s.id, label: staffName(s) })),
        ],
        valueOf: (r) => r.ownerUid || (r.stage === "churned" ? null : NONE),
      },
      {
        key: "contact",
        label: t("last_contact"),
        options: (["never", "over30", "within30"] as const).map((k) => ({ value: k, label: t(`contact_${k}`) })),
        valueOf: (r) => (r.stage === "churned" ? [] : clientContactBuckets(r)),
      },
    ],
    savedViews: [
      { key: "all", label: t("view_all_clients"), segment: "all" },
      { key: "mine", label: t("view_my_clients"), segment: "all", facets: { owner: [me] } },
      { key: "unowned", label: t("view_unowned"), segment: "all", facets: { owner: [NONE] } },
      { key: "silent", label: t("view_silent_clients"), segment: "all", facets: { contact: ["never", "over30"] } },
      { key: "at_risk", label: t("stage_at_risk"), segment: "at_risk" },
    ],
    groups: [
      { key: "owner", label: t("owner_label"), keyOf: (r) => r.ownerName || t("unassigned") },
      { key: "role", label: t("col_type"), keyOf: (r) => t(r.role === "Contractor" ? "role_contractor" : "role_supplier") },
      { key: "stage", label: t("col_status"), keyOf: (r) => t(`stage_${r.stage}`) },
    ],
    sorts: [
      { key: "name", valueOf: (r) => r.name },
      { key: "role", valueOf: (r) => r.role },
      { key: "stage", valueOf: (r) => CLIENT_STAGES.indexOf(r.stage) },
      { key: "contact", valueOf: (r) => (r.daysSinceContact === null ? Number.MAX_SAFE_INTEGER : r.daysSinceContact) },
      { key: "owner", valueOf: (r) => r.ownerName || "~" },
      { key: "since", valueOf: (r) => r.sinceMs },
    ],
    searchText: (r) => [r.name, r.email, r.phone, r.city].join(" "),
    defaultSegment: "all",
    defaultSort: { key: "contact", direction: -1 },
    pageSize: 25,
  }
  const state = useCrmListState(crm.clientRows, config, locale)

  const viewSwitch = (
    <div role="group" aria-label={t("view_label")} className="inline-flex h-10 items-center rounded-md border bg-muted/40 p-1">
      {(["cards", "table"] as const).map((v) => {
        const Icon = v === "cards" ? LayoutGrid : Table2
        return (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
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

  const lastContact = (r: ClientRow) =>
    r.daysSinceContact === null ? (
      <span className="font-medium text-warning">{t("never_contacted")}</span>
    ) : (
      <span className={cn(r.stale && "font-medium text-destructive")}>{t("days_ago", { n: r.daysSinceContact })}</span>
    )
  const role = (r: ClientRow) => <Badge variant="outline" className="whitespace-nowrap">{t(r.role === "Contractor" ? "role_contractor" : "role_supplier")}</Badge>
  const actions = (r: ClientRow) => (
    <div className="relative z-10 flex shrink-0 gap-1">
      <Link href={`/admin/crm/customers/${r.id}`} aria-label={t("open_client_file")} title={t("open_client_file")} className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Pencil size={14} aria-hidden="true" />
      </Link>
      <IconButton icon={CalendarPlus} iconSize={14} label={t("activity_log")} onClick={() => setLogFor(r)} />
    </div>
  )

  return (
    <div className="space-y-6">
      <CrmStatRow>
        <CrmStat icon={UsersRound} label={t("kpi_total")} value={cards.total} onClick={() => state.applyView("all")} active={state.activeView === "all"} />
        <CrmStat icon={UserX} label={t("kpi_stale")} value={cards.noContact} accent="warning" onClick={() => state.applyView("silent")} active={state.activeView === "silent"} />
        <CrmStat icon={Handshake} label={t("kpi_unowned")} value={cards.unowned} onClick={() => state.applyView("unowned")} active={state.activeView === "unowned"} />
        <CrmStat icon={AlertTriangle} label={t("stage_at_risk")} value={cards.atRisk} accent="destructive" danger={cards.atRisk > 0} onClick={() => state.applyView("at_risk")} active={state.activeView === "at_risk"} />
      </CrmStatRow>

      <CrmToolbar config={config} state={state} extra={viewSwitch} />

      {crm.loading.clients ? (
        <CrmListSkeleton />
      ) : state.matching === 0 ? (
        <div className="rounded-xl border bg-card">
          <CrmEmptyState icon={UsersRound} title={crm.clientRows.length === 0 ? t("empty") : t("empty_filtered")} />
        </div>
      ) : view === "cards" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {state.visible.map((r) => (
              <article key={r.id} className={cn(CRM_CARD_LINK_CLASS, "space-y-3 p-4")}>
                <Link href={`/admin/crm/customers/${r.id}`} className="absolute inset-0 rounded-lg focus-visible:outline-none" aria-label={r.name} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{[r.city, r.ownerName || t("unassigned")].filter(Boolean).join(" · ")}</p>
                  </div>
                  <StageBadge stage={r.stage} label={t(`stage_${r.stage}`)} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {role(r)}
                  <span className="text-muted-foreground">{t("last_contact")}:</span>
                  {lastContact(r)}
                </div>
                <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
                  <span>{t("client_since")}: {formatCrmDate(r.sinceMs, locale)}</span>
                  {actions(r)}
                </div>
              </article>
            ))}
          </div>
          {state.hasMore && (
            <div className="overflow-hidden rounded-xl border bg-card">
              <CrmShowMore state={state} />
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <Table className={cn(state.dense && "[&_td]:py-1.5")}>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead><CrmSortHeader state={state} sortKey="name" label={t("col_client")} /></TableHead>
                  <TableHead><CrmSortHeader state={state} sortKey="role" label={t("col_type")} /></TableHead>
                  <TableHead><CrmSortHeader state={state} sortKey="stage" label={t("col_status")} /></TableHead>
                  <TableHead className="hidden sm:table-cell"><CrmSortHeader state={state} sortKey="contact" label={t("last_contact")} /></TableHead>
                  <TableHead className="hidden md:table-cell"><CrmSortHeader state={state} sortKey="owner" label={t("col_owner")} /></TableHead>
                  <TableHead className="hidden lg:table-cell"><CrmSortHeader state={state} sortKey="since" label={t("client_since")} /></TableHead>
                  <TableHead className="w-24"><span className="sr-only">{t("col_actions")}</span></TableHead>
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
                    <TableRow key={r.id} className={CRM_ROW_LINK_CLASS}>
                      <TableCell>
                        <Link href={`/admin/crm/customers/${r.id}`} className="font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {r.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{r.city}</p>
                        <div className="max-w-64 text-xs text-muted-foreground"><LtrValue value={r.email || r.phone} /></div>
                      </TableCell>
                      <TableCell>{role(r)}</TableCell>
                      <TableCell><StageBadge stage={r.stage} label={t(`stage_${r.stage}`)} /></TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">{lastContact(r)}</TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{r.ownerName || <span className="text-muted-foreground">{t("unassigned")}</span>}</TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">{formatCrmDate(r.sinceMs, locale)}</TableCell>
                      <TableCell>{actions(r)}</TableCell>
                    </TableRow>
                  )),
                ])}
              </TableBody>
            </Table>
          </div>
          <CrmShowMore state={state} />
        </div>
      )}

      <ActivityDialog
        open={logFor !== null}
        onOpenChange={(o) => !o && setLogFor(null)}
        parties={logFor ? [{ id: logFor.id, label: logFor.name, contacts: crm.records[logFor.id]?.contacts?.length ? (crm.records[logFor.id]?.contacts ?? []) : [{ id: "origin", name: logFor.name, title: "", phone: logFor.phone, email: logFor.email, primary: true }] }] : []}
        staff={crm.staff}
        actor={actor}
        presetClientId={logFor?.id}
      />
    </div>
  )
}
