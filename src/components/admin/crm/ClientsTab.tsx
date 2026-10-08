"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Loader2, Search, UserX, UsersRound, Handshake } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Link } from "@/i18n/routing"
import type { AdminCrm } from "@/hooks/useAdminCrm"
import { CLIENT_SEGMENTS, clientCards, formatCrmDate, type ClientSegment } from "@/lib/admin-crm"
import { matchesSearch } from "@/lib/search-text"
import { cn } from "@/lib/utils"
import { CrmKpi, LtrValue, SegmentStrip, StageBadge } from "./parts"

/** ADM-10: the clients that hold an account — one row each, opening the client's file. */
export function ClientsTab({ crm }: { crm: AdminCrm }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const [segment, setSegment] = useState<ClientSegment>("all")
  const [search, setSearch] = useState("")
  const cards = useMemo(() => clientCards(crm.clientRows), [crm.clientRows])
  const counts = useMemo(() => Object.fromEntries(CLIENT_SEGMENTS.map((s) => [s, s === "all" ? crm.clientRows.length : crm.clientRows.filter((r) => r.stage === s).length])) as Record<ClientSegment, number>, [crm.clientRows])
  const visible = useMemo(
    () =>
      crm.clientRows
        .filter((r) => search.trim() !== "" || segment === "all" || r.stage === segment)
        .filter((r) => !search.trim() || matchesSearch(search, [r.name, r.email, r.phone, r.city]))
        .sort((a, b) => Number(b.stale) - Number(a.stale) || a.name.localeCompare(b.name)),
    [crm.clientRows, segment, search],
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <CrmKpi icon={UsersRound} label={t("kpi_total")} value={cards.total} />
        <CrmKpi icon={UserX} label={t("kpi_stale")} value={cards.noContact} tone={cards.noContact > 0 ? "warning" : undefined} />
        <CrmKpi icon={Handshake} label={t("kpi_unowned")} value={cards.unowned} />
        <CrmKpi icon={AlertTriangle} label={t("stage_at_risk")} value={cards.atRisk} tone={cards.atRisk > 0 ? "danger" : undefined} />
      </div>
      <Card className="overflow-hidden border-none shadow-sm">
        <div className="space-y-3 border-b p-4">
          <SegmentStrip label={t("segments_label")} items={CLIENT_SEGMENTS} value={segment} onChange={setSegment} labelOf={(s) => (s === "all" ? t("filter_all") : t(`stage_${s}`))} counts={counts} />
          <div className="relative md:max-w-md">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search_placeholder")} aria-label={t("search_placeholder")} className="ps-9" />
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">{t("showing_of", { shown: visible.length, total: search.trim() ? crm.clientRows.length : counts[segment] })}</p>
        </div>
        <CardContent className="overflow-x-auto p-0">
          {crm.loading.clients ? (
            <div className="flex justify-center p-16">
              <Loader2 className="animate-spin text-primary" size={28} />
            </div>
          ) : visible.length === 0 ? (
            <p className="p-12 text-center text-sm text-muted-foreground">{crm.clientRows.length === 0 ? t("empty") : t("empty_filtered")}</p>
          ) : (
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>{t("col_client")}</TableHead>
                  <TableHead>{t("col_type")}</TableHead>
                  <TableHead>{t("col_status")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("last_contact")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("col_owner")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("client_since")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30">
                    <TableCell>
                      <Link href={`/admin/crm/customers/${r.id}`} className="font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {r.name}
                      </Link>
                      <div className="max-w-64 text-xs text-muted-foreground"><LtrValue value={r.email || r.phone} /></div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{t(r.role === "Contractor" ? "role_contractor" : "role_supplier")}</Badge></TableCell>
                    <TableCell><StageBadge stage={r.stage} label={t(`stage_${r.stage}`)} /></TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">
                      {r.daysSinceContact === null ? <span className="font-medium text-warning">{t("never_contacted")}</span> : <span className={cn(r.stale && "font-medium text-destructive")}>{t("days_ago", { n: r.daysSinceContact })}</span>}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{r.ownerName || <span className="text-muted-foreground">{t("unassigned")}</span>}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{formatCrmDate(r.sinceMs, locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
