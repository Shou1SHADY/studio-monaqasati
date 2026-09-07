"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Plus, Search, Loader2, FileText, Factory, CheckCircle2, Lock, ChevronLeft, ChevronRight } from "lucide-react"
import { Link, useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  QUOTATION_PHASES,
  QUOTATION_PHASE_BADGE_CLASS,
  QUOTATION_STATUSES,
  QUOTATION_STATUS_BADGE_CLASS,
  formatCrmDate,
  formatSar,
  quotationPhase,
  type QuotationPhase,
  type QuotationStatus,
} from "@/lib/crm"
import { WORK_ORDERS, type WorkOrder } from "@/lib/manufacturing"
import { isFullyPaid, paidSoFar, quotationMatchesSearch } from "@/lib/sales"
import { CrmQuotationDialog } from "@/components/crm/CrmQuotationDialog"
import type { CrmPortal } from "@/components/crm/CrmShell"
import { SalesShell, salesBasePath } from "./SalesShell"

type StatusFilter = QuotationStatus | "all"
type PhaseFilter = QuotationPhase | "all"

/** All quotations, filterable, each row opening its own page. */
export function QuotationsListView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const router = useRouter()
  const { can } = usePermissions()
  const canManage = can("sales.manage")
  const base = salesBasePath(portal)

  const { orgId, contacts, quotations, isLoading } = useCrmData({ quotations: true })

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: ordersData } = useCollection(ordersQuery)
  const finishedOrders = useMemo(
    () => ((ordersData || []) as WorkOrder[]).filter((o) => o.status === "done").sort((a, b) => (b.orderNumber || 0) - (a.orderNumber || 0)),
    [ordersData]
  )

  const [status, setStatus] = useState<StatusFilter>("all")
  const [phase, setPhase] = useState<PhaseFilter>("all")
  const [search, setSearch] = useState("")
  useEffect(() => {
    // Drill-downs from the dashboard arrive as `?status=` / `?phase=`.
    try {
      const params = new URLSearchParams(window.location.search)
      const s = params.get("status")
      const p = params.get("phase")
      if (s && (QUOTATION_STATUSES as string[]).includes(s)) setStatus(s as QuotationStatus)
      if (p && (QUOTATION_PHASES as string[]).includes(p)) setPhase(p as QuotationPhase)
    } catch {
      /* not in a browser */
    }
  }, [])

  const sorted = useMemo(() => [...quotations].sort((a, b) => (b.date || "").localeCompare(a.date || "")), [quotations])
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: quotations.length, draft: 0, sent: 0, accepted: 0, rejected: 0 }
    for (const q of quotations) c[q.status] += 1
    return c
  }, [quotations])
  const visible = sorted.filter(
    (q) => (status === "all" || q.status === status) && (phase === "all" || quotationPhase(q) === phase) && quotationMatchesSearch(q, search)
  )

  const [showNew, setShowNew] = useState(false)
  const Chevron = isRtl ? ChevronLeft : ChevronRight

  return (
    <SalesShell
      portal={portal}
      title={t("sales_page_title")}
      description={t("sales_quotations_desc")}
      action={
        <Button className="gap-2" onClick={() => setShowNew(true)} disabled={!canManage || isLoading}>
          <Plus size={16} />
          {t("sales_new_quote_btn")}
        </Button>
      }
    >
      {!isLoading && !canManage && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Lock size={12} aria-hidden="true" />
          {t("sales_no_permission")}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", ...QUOTATION_STATUSES] as StatusFilter[]).map((s) => (
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
              {s === "all" ? t("sales_filter_all") : t(`crm_quote_status_${s}`)}
              <span className={cn("text-[10px] tabular-nums", status === s ? "text-white/70" : "text-muted-foreground")}>{counts[s]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
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
            return (
              <li key={q.id}>
                <Link
                  href={`${base}/quotations/${q.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{q.quotationNumber}</span>
                      <Badge className={cn("text-[10px]", QUOTATION_PHASE_BADGE_CLASS[ph])}>{t(`crm_quote_phase_${ph}`)}</Badge>
                      <Badge className={cn("text-[10px]", QUOTATION_STATUS_BADGE_CLASS[q.status])}>{t(`crm_quote_status_${q.status}`)}</Badge>
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

      {showNew && (
        <CrmQuotationDialog
          open
          onOpenChange={(open) => { if (!open) setShowNew(false) }}
          orgId={orgId}
          contacts={contacts.map((c) => ({ id: c.id, name: c.name }))}
          finishedOrders={finishedOrders}
          onSaved={(id) => router.push(`${base}/quotations/${id}`)}
        />
      )}
    </SalesShell>
  )
}
