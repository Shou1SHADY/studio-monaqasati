"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Plus, Search, Loader2, FileText, Factory, CheckCircle2, Lock, ChevronLeft, ChevronRight } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  QUOTATION_PHASES,
  QUOTATION_PHASE_BADGE_CLASS,
  formatCrmDate,
  formatSar,
  quotationPhase,
  type QuotationPhase,
} from "@/lib/crm"
import { isFullyPaid, paidSoFar, quotationMatchesSearch } from "@/lib/sales"
import { daysToExpiry, quoteLifecycle, type QuoteLifecycle } from "@/lib/sales-quotes"
import { displayDocNumber } from "@/lib/sales-numbering"
import { useSalesScope } from "@/hooks/useSalesScope"
import { LIFECYCLE_BADGE } from "./QuotationLifecycleBar"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { useUser } from "@/firebase"
import { SalesShell, salesBasePath } from "./SalesShell"
import { QuoteRequestsInbox } from "./QuoteRequestsInbox"
import { SalesMfgCostingPanel } from "./SalesMfgCostingPanel"

/** Live · issued (not yet sent) · expired · draft · won · lost · all. A
 * superseded revision shows only under "all" — it is history, not work. */
type StateFilter = "sent" | "issued" | "expired" | "draft" | "won" | "lost" | "all"
const STATE_FILTERS: StateFilter[] = ["sent", "issued", "expired", "draft", "won", "lost", "all"]
type PhaseFilter = QuotationPhase | "all"
type SortKey = "expiry" | "value" | "newest"
const SORTS: SortKey[] = ["expiry", "value", "newest"]

/** All quotations, filterable, each row opening its own page. */
export function QuotationsListView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const { can } = usePermissions()
  const canManage = can("sales.manage")
  const base = salesBasePath(portal)

  const { user } = useUser()
  const { orgId, quotations: allQuotations, contacts, teamMembers, isLoading } = useCrmData({ quotations: true })
  const actorName = teamMembers.find((m) => m.id === user?.uid)?.name || user?.email || ""
  // A rep sees only his own clients' quotes (D10).
  const scope = useSalesScope(contacts)
  const quotations = useMemo(() => allQuotations.filter(scope.mine), [allQuotations, scope.mine])
  const today = new Date().toISOString().slice(0, 10)

  const [status, setStatus] = useState<StateFilter>("sent")
  const [phase, setPhase] = useState<PhaseFilter>("all")
  const [sort, setSort] = useState<SortKey>("expiry")
  const [search, setSearch] = useState("")
  useEffect(() => {
    // Drill-downs from the dashboard arrive as `?status=` / `?phase=`.
    try {
      const params = new URLSearchParams(window.location.search)
      const s = params.get("state") || params.get("status")
      const p = params.get("phase")
      // Older links said `?status=accepted|rejected`.
      const mapped = s === "accepted" ? "won" : s === "rejected" ? "lost" : s
      if (mapped && (STATE_FILTERS as string[]).includes(mapped)) setStatus(mapped as StateFilter)
      if (p && (QUOTATION_PHASES as string[]).includes(p)) setPhase(p as QuotationPhase)
    } catch {
      /* not in a browser */
    }
  }, [])

  const stateOf = useMemo(() => new Map<string, QuoteLifecycle>(quotations.map((q) => [q.id, quoteLifecycle(q, today)])), [quotations, today])
  const sorted = useMemo(() => {
    const list = [...quotations]
    if (sort === "value") return list.sort((a, b) => (b.amount || 0) - (a.amount || 0))
    if (sort === "newest") return list.sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    // Nearest expiry first; what has no clock running goes last, newest first.
    return list.sort((a, b) => {
      const da = daysToExpiry(a, today)
      const db = daysToExpiry(b, today)
      if (da == null && db == null) return (b.date || "").localeCompare(a.date || "")
      if (da == null) return 1
      if (db == null) return -1
      return da - db
    })
  }, [quotations, sort, today])
  const counts = useMemo(() => {
    const c: Record<StateFilter, number> = { all: quotations.length, sent: 0, issued: 0, expired: 0, draft: 0, won: 0, lost: 0 }
    for (const q of quotations) {
      const st = stateOf.get(q.id)
      if (st && st !== "superseded") c[st] += 1
    }
    return c
  }, [quotations, stateOf])
  const visible = sorted.filter(
    (q) => (status === "all" || stateOf.get(q.id) === status) && (phase === "all" || quotationPhase(q) === phase) && quotationMatchesSearch(q, search)
  )

  const Chevron = isRtl ? ChevronLeft : ChevronRight

  return (
    <SalesShell
      portal={portal}
      title={t("sales_page_title")}
      description={t("sales_quotations_desc")}
      action={
        // A new quotation is a document: it opens the builder page (form +
        // live A4 preview) rather than a dialog.
        !canManage || isLoading ? (
          <Button className="gap-2" disabled>
            <Plus size={16} />
            {t("sales_new_quote_btn")}
          </Button>
        ) : (
          <Button asChild className="gap-2">
            <Link href={`${base}/quotations/new`}>
              <Plus size={16} />
              {t("sales_new_quote_btn")}
            </Link>
          </Button>
        )
      }
    >
      {!isLoading && !canManage && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Lock size={12} aria-hidden="true" />
          {t("sales_no_permission")}
        </p>
      )}

      {orgId && <QuoteRequestsInbox portal={portal} orgId={orgId} actorName={actorName} mine={scope.mine} />}

      {/* Cost statements from Manufacturing for non-standard lines (REQ-02) —
          renders nothing for an org that has no workshop. */}
      <SalesMfgCostingPanel portal={portal} contacts={contacts} canManage={canManage} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {STATE_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                status === s ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              )}
            >
              {s === "all" ? t("sales_filter_all") : t(`sales_q_state_${s}`)}
              <span className={cn("text-[10px] tabular-nums", status === s ? "text-white/70" : "text-muted-foreground")}>{counts[s]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-9 w-40 text-xs" aria-label={t("sales_q_sort")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((k) => (
                <SelectItem key={k} value={k}>{t(`sales_q_sort_${k}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={phase} onValueChange={(v) => setPhase(v as PhaseFilter)}>
            <SelectTrigger className="h-9 w-44 text-xs" aria-label={t("sales_filter_phase")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("sales_filter_phase")}: {t("sales_filter_all")}</SelectItem>
              {QUOTATION_PHASES.map((p) => (
                <SelectItem key={p} value={p}>{t(`crm_quote_phase_${p}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("sales_search_placeholder")} aria-label={t("sales_search_placeholder")} className="h-9 ps-9" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <FileText size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{t("sales_empty")}</p>
        </div>
      ) : (
        <ul className="rounded-2xl border bg-white divide-y overflow-hidden">
          {visible.map((q) => {
            const ph = quotationPhase(q)
            const fully = isFullyPaid(q)
            const paid = paidSoFar(q)
            const st = stateOf.get(q.id) || "draft"
            const left = daysToExpiry(q, today)
            return (
              <li key={q.id}>
                <Link
                  href={`${base}/quotations/${q.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground" dir="ltr">{displayDocNumber(q.quotationNumber, locale)}</span>
                      <Badge className={cn("text-[10px]", QUOTATION_PHASE_BADGE_CLASS[ph])}>{t(`crm_quote_phase_${ph}`)}</Badge>
                      <Badge className={cn("text-[10px]", LIFECYCLE_BADGE[st])}>{t(`sales_q_state_${st}`)}</Badge>
                      {st === "sent" && left != null && left <= 3 && (
                        <Badge className="border-warning/20 bg-warning/10 text-[10px] text-warning">{t("sales_q_expires_in", { days: left })}</Badge>
                      )}
                      {fully && (
                        <Badge className="text-[10px] bg-success/10 text-success border-success/20 gap-1">
                          <CheckCircle2 size={10} aria-hidden="true" />
                          {t("crm_quote_paid_badge")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-bold text-foreground mt-1 flex items-center gap-2 flex-wrap" dir="auto">
                      {q.contactName || "—"}
                      {q.workOrderNumber != null && (
                        <span className="text-xs font-semibold text-cta flex items-center gap-1">
                          <Factory size={11} aria-hidden="true" />
                          {t("crm_quote_work_order_ref", { number: q.workOrderNumber })}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {q.date && formatCrmDate(q.date, locale)}
                      {q.status === "accepted" && (
                        <span className={cn("ms-1.5 font-semibold", fully ? "text-success" : paid > 0 ? "text-warning" : "")}>
                          · {fully ? t("sales_paid_full") : t("sales_progress_line", { paid: formatSar(paid, locale), total: formatSar(q.amount, locale) })}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="text-sm font-black tabular-nums shrink-0" dir="ltr">{formatSar(q.amount, locale)}</span>
                  <Chevron size={16} className="text-muted-foreground shrink-0" aria-hidden="true" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </SalesShell>
  )
}
