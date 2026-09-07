"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Plus, Loader2, FileText, Banknote, HandCoins, CheckCircle2, Hourglass, TrendingUp, ChevronLeft, ChevronRight } from "lucide-react"
import { Link, useRouter } from "@/i18n/routing"
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
import { WORK_ORDERS, type WorkOrder } from "@/lib/manufacturing"
import { salesDashboard } from "@/lib/sales"
import { CrmQuotationDialog } from "@/components/crm/CrmQuotationDialog"
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
  const firestore = useFirestore()
  const router = useRouter()
  const { user } = useUser()
  const { can } = usePermissions()
  const canManage = can("sales.manage")
  const canRecordPayment = can("invoices.manage") || can("sales.approve")
  const base = salesBasePath(portal)

  const { orgId, contacts, quotations, teamMembers, isLoading } = useCrmData({ quotations: true })
  const actorName = teamMembers.find((m) => m.id === user?.uid)?.name || user?.email || ""

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: ordersData } = useCollection(ordersQuery)
  const finishedOrders = useMemo(
    () => ((ordersData || []) as WorkOrder[]).filter((o) => o.status === "done").sort((a, b) => (b.orderNumber || 0) - (a.orderNumber || 0)),
    [ordersData]
  )

  const data = useMemo(() => salesDashboard(quotations), [quotations])
  const [showNew, setShowNew] = useState(false)
  const [pay, setPay] = useState<{ quotation: CrmQuotation; installmentId: string } | null>(null)
  const Chevron = isRtl ? ChevronLeft : ChevronRight
  const label = (l: string) => l || t("crm_quote_installment_full")

  return (
    <SalesShell
      portal={portal}
      title={t("sales_page_title")}
      description={t("sales_dashboard_desc")}
      action={
        <Button className="gap-2" onClick={() => setShowNew(true)} disabled={!canManage || isLoading}>
          <Plus size={16} />
          {t("sales_new_quote_btn")}
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : (
        <>
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
                        <p className="text-xs text-muted-foreground" dir="auto">{label(d.installment.label)} · {d.installment.percent}%</p>
                      </div>
                      <span className="text-sm font-black tabular-nums text-warning" dir="ltr">{formatSar(d.installment.amount, locale)}</span>
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
