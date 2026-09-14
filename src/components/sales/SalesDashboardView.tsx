"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Plus, Loader2, FileText, Banknote, HandCoins, CheckCircle2, Hourglass, TrendingUp, ChevronLeft, ChevronRight, AlertTriangle, Inbox, Send, SearchX } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  QUOTATION_STATUSES,
  QUOTATION_STATUS_BADGE_CLASS,
  formatCrmDate,
  formatSar,
  formatSarCompact,
  type CrmQuotation,
  type QuotationStatus,
} from "@/lib/crm"
import { installmentStates, salesDashboard } from "@/lib/sales"
import { SALES_ORDERS, type SalesOrder } from "@/lib/sales-orders"
import {
  SALES_QUOTE_REQUESTS,
  SALES_TRANSFER_NOTICES,
  installmentNoticeState,
  type QuoteRequest,
  type TransferNotice,
} from "@/lib/sales-transfers"
import { CrmStat, CrmStatRow, type CrmPortal } from "@/components/crm/CrmShell"
import { SalesShell, SalesSection, salesBasePath } from "./SalesShell"
import { RecordPaymentDialog } from "./RecordPaymentDialog"

const STATUS_BAR: Record<QuotationStatus, string> = {
  draft: "bg-slate-300",
  sent: "bg-cta",
  accepted: "bg-success",
  rejected: "bg-destructive/60",
}

/** The Sales home: totals, the pipeline by status, what customers owe, and
 * the latest quotations — each block linking into its own page. */
export function SalesDashboardView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const { user } = useUser()
  const { can } = usePermissions()
  const canManage = can("sales.manage")
  const canRecordPayment = can("invoices.manage") || can("sales.approve")
  const base = salesBasePath(portal)

  const { orgId, quotations, teamMembers, isLoading } = useCrmData({ quotations: true })
  const actorName = teamMembers.find((m) => m.id === user?.uid)?.name || user?.email || ""
  const firestore = useFirestore()

  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_QUOTE_REQUESTS), where("organizationId", "==", orgId), where("status", "==", "new"))
  }, [firestore, orgId])
  const { data: requestsData } = useCollection(requestsQuery)
  const openRequests = useMemo(() => (requestsData || []) as QuoteRequest[], [requestsData])

  const noticesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_TRANSFER_NOTICES), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: noticesData } = useCollection(noticesQuery)
  const notices = useMemo(() => (noticesData || []) as TransferNotice[], [noticesData])

  const salesOrdersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_ORDERS), where("organizationId", "==", orgId), where("status", "==", "awaiting_deposit"))
  }, [firestore, orgId])
  const { data: gatedOrdersData } = useCollection(salesOrdersQuery)
  const gatedOrders = useMemo(() => (gatedOrdersData || []) as SalesOrder[], [gatedOrdersData])

  // "Needs your decision" — one action per row, nearest risk first: a quote
  // Finance could not match, a request past its due date, an order stuck on
  // its advance, a request waiting to be priced.
  const decisions = useMemo(() => {
    const rows: Array<{ key: string; tone: "destructive" | "warning" | "cta"; icon: typeof Send; text: string; action: string; href: string }> = []
    for (const q of quotations) {
      const qNotices = notices.filter((n) => n.quotationId === q.id)
      if (qNotices.length === 0) continue
      for (const s of installmentStates(q)) {
        if (installmentNoticeState(s, qNotices) === "not_found") {
          rows.push({
            key: `nf:${q.id}:${s.id}`,
            tone: "destructive",
            icon: SearchX,
            text: t("sales_dec_not_found", { number: q.quotationNumber, contact: q.contactName || "—" }),
            action: t("sales_dec_action_recheck"),
            href: `${base}/payments`,
          })
        }
      }
    }
    const today = new Date().toISOString().slice(0, 10)
    for (const r of openRequests) {
      rows.push({
        key: `rq:${r.id}`,
        tone: r.dueDate && r.dueDate < today ? "destructive" : "cta",
        icon: Inbox,
        text: t("sales_dec_rq", { number: r.requestNumber, contact: r.contactName || "—" }),
        action: t("sales_dec_action_price"),
        href: `${base}/quotations/new?request=${r.id}`,
      })
    }
    for (const o of gatedOrders) {
      rows.push({
        key: `adv:${o.id}`,
        tone: "warning",
        icon: Send,
        text: t("sales_dec_awaiting_advance", { number: o.orderNumber, contact: o.contactName || "—" }),
        action: t("sales_dec_action_report"),
        href: `${base}/payments`,
      })
    }
    const rank = { destructive: 0, warning: 1, cta: 2 }
    return rows.sort((a, b) => rank[a.tone] - rank[b.tone])
  }, [quotations, notices, openRequests, gatedOrders, t, base])

  const data = useMemo(() => salesDashboard(quotations), [quotations])
  const [pay, setPay] = useState<{ quotation: CrmQuotation; installmentId: string } | null>(null)
  const Chevron = isRtl ? ChevronLeft : ChevronRight
  const label = (l: string) => l || t("crm_quote_installment_full")

  return (
    <SalesShell
      portal={portal}
      title={t("sales_page_title")}
      description={t("sales_dashboard_desc")}
      action={
        // A new quotation opens the builder page (form + live A4 preview).
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
      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : (
        <>
          {decisions.length > 0 && (
            <SalesSection title={t("sales_dec_title")} icon={AlertTriangle}>
              <ul className="divide-y">
                {decisions.map((d) => (
                  <li key={d.key}>
                    <Link
                      href={d.href}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <d.icon
                        size={16}
                        className={cn("shrink-0", d.tone === "destructive" ? "text-destructive" : d.tone === "warning" ? "text-warning" : "text-cta")}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-semibold min-w-0 flex-1" dir="auto">{d.text}</span>
                      <span className="text-xs font-bold text-cta shrink-0">{d.action}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SalesSection>
          )}

          <CrmStatRow>
            <CrmStat icon={TrendingUp} label={t("sales_stat_quoted")} value={formatSarCompact(data.totals.quoted, locale)} accent="cta" />
            <CrmStat icon={CheckCircle2} label={t("sales_stat_accepted")} value={formatSarCompact(data.totals.accepted, locale)} accent="primary" />
            <CrmStat icon={Hourglass} label={t("sales_stat_awaiting")} value={formatSarCompact(data.totals.awaitingPayment, locale)} accent="warning" hint={t("sales_stat_due_count", { count: data.dueCount })} />
            <CrmStat icon={HandCoins} label={t("sales_stat_paid")} value={formatSarCompact(data.totals.paid, locale)} accent="success" />
          </CrmStatRow>

          <div className="grid lg:grid-cols-3 gap-4">
            <SalesSection title={t("sales_funnel_title")} icon={FileText}>
              <ul className="divide-y">
                {QUOTATION_STATUSES.map((s) => {
                  const count = data.statusCounts[s]
                  const share = quotations.length ? Math.round((count / quotations.length) * 100) : 0
                  return (
                    <li key={s}>
                      <Link
                        href={`${base}/quotations?status=${s}`}
                        className="block px-5 py-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-semibold">{t(`crm_quote_status_${s}`)}</span>
                          <span className="tabular-nums font-black">{count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
                          <div className={cn("h-full rounded-full", STATUS_BAR[s])} style={{ width: `${share}%` }} />
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </SalesSection>

            <SalesSection
              className="lg:col-span-2"
              title={t("sales_due_title")}
              icon={Banknote}
              action={
                <Link href={`${base}/payments`} className="text-xs font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                  {t("sales_open_payments")}
                </Link>
              }
            >
              {data.due.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">{t("sales_no_due")}</p>
              ) : (
                <ul className="divide-y">
                  {data.due.map((d) => (
                    <li key={`${d.quotation.id}:${d.installment.id}`} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-foreground truncate" dir="auto">
                          {d.quotation.contactName || "—"}
                          <Link href={`${base}/quotations/${d.quotation.id}`} className="ms-2 font-mono text-xs font-normal text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                            {d.quotation.quotationNumber}
                          </Link>
                        </p>
                        <p className="text-xs text-muted-foreground" dir="auto">
                          {label(d.installment.label)} · {d.installment.percent}%
                          {d.installment.paid > 0 && <span className="text-warning ms-1.5">· {t("sales_installment_partial", { paid: formatSar(d.installment.paid, locale), total: formatSar(d.installment.amount, locale), remaining: formatSar(d.installment.remaining, locale) })}</span>}
                        </p>
                      </div>
                      <span className="text-sm font-black tabular-nums text-warning" dir="ltr">{formatSar(d.installment.remaining, locale)}</span>
                      {canRecordPayment && (
                        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setPay({ quotation: d.quotation, installmentId: d.installment.id })}>
                          <Banknote size={13} />
                          {t("sales_record_payment_btn")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SalesSection>
          </div>

          <SalesSection
            title={t("sales_recent_title")}
            icon={FileText}
            action={
              <Link href={`${base}/quotations`} className="text-xs font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                {t("sales_view_all")}
              </Link>
            }
          >
            {data.recent.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">{t("sales_empty")}</p>
            ) : (
              <ul className="divide-y">
                {data.recent.map((q) => (
                  <li key={q.id}>
                    <Link
                      href={`${base}/quotations/${q.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground">{q.quotationNumber}</span>
                          <Badge className={cn("text-[10px]", QUOTATION_STATUS_BADGE_CLASS[q.status])}>{t(`crm_quote_status_${q.status}`)}</Badge>
                        </div>
                        <p className="text-sm font-bold text-foreground truncate mt-0.5" dir="auto">
                          {q.contactName || "—"}
                          {q.date && <span className="ms-1.5 text-xs text-muted-foreground font-normal">· {formatCrmDate(q.date, locale)}</span>}
                        </p>
                      </div>
                      <span className="text-sm font-black tabular-nums" dir="ltr">{formatSar(q.amount, locale)}</span>
                      <Chevron size={16} className="text-muted-foreground shrink-0" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SalesSection>
        </>
      )}

      <RecordPaymentDialog
        quotation={pay?.quotation ?? null}
        installmentId={pay?.installmentId ?? null}
        onOpenChange={(open) => { if (!open) setPay(null) }}
        orgId={orgId}
        teamMembers={teamMembers}
        actorName={actorName}
      />
    </SalesShell>
  )
}
