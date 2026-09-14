"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Banknote, CheckCircle2, Search, Loader2, Lock, Hourglass, Send } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import { formatCrmDate, formatSar, formatSarCompact, type CrmQuotation } from "@/lib/crm"
import { collectInstallments, installmentStates, type InstallmentDue } from "@/lib/sales"
import { SALES_ORDERS, type SalesOrder } from "@/lib/sales-orders"
import {
  SALES_TRANSFER_NOTICES,
  installmentNoticeState,
  reportableInstallments,
  type TransferNotice,
} from "@/lib/sales-transfers"
import { CrmStat, CrmStatRow, type CrmPortal } from "@/components/crm/CrmShell"
import { SalesShell, salesBasePath } from "./SalesShell"
import { RecordPaymentDialog } from "./RecordPaymentDialog"
import { AnswerTransferDialog, NOTICE_STATE_CLASS, ReportTransferDialog, TransferNoticesList } from "./TransferNotices"

type Tab = "due" | "received" | "notices"

/** Every installment customers owe, and every payment received, across all
 * accepted quotations — Finance's view of Sales. */
export function PaymentsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { user } = useUser()
  const firestore = useFirestore()
  const { can } = usePermissions()
  const canRecordPayment = can("invoices.manage") || can("sales.approve")
  const canAnswerNotice = can("invoices.manage") || can("accounting.post") || can("sales.approve")
  const canReport = can("sales.manage") || can("sales.approve")
  const base = salesBasePath(portal)

  const { orgId, quotations, teamMembers, isLoading } = useCrmData({ quotations: true })
  const actorName = teamMembers.find((m) => m.id === user?.uid)?.name || user?.email || ""

  const noticesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_TRANSFER_NOTICES), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: noticesData } = useCollection(noticesQuery)
  const notices = useMemo(() => (noticesData || []) as TransferNotice[], [noticesData])

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, SALES_ORDERS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: ordersData } = useCollection(ordersQuery)
  const orderOfQuotation = (quotationId: string): SalesOrder | null =>
    (((ordersData || []) as SalesOrder[]).find((o) => o.quotationId === quotationId) as SalesOrder | undefined) ?? null

  const { due, received } = useMemo(() => collectInstallments(quotations), [quotations])
  const dueTotal = due.reduce((s, d) => s + d.installment.remaining, 0)
  const receivedTotal = received.reduce((s, d) => s + (d.entry?.paidAmount ?? 0), 0)
  const awaitingNotices = notices.filter((n) => n.status === "reported").length

  const [tab, setTab] = useState<Tab>("due")
  const [search, setSearch] = useState("")
  const needle = search.trim().toLowerCase()
  const rows = (tab === "due" ? due : tab === "received" ? received : []).filter(
    (d) =>
      !needle ||
      d.quotation.quotationNumber.toLowerCase().includes(needle) ||
      (d.quotation.contactName || "").toLowerCase().includes(needle) ||
      d.installment.label.toLowerCase().includes(needle)
  )

  const [pay, setPay] = useState<{ quotation: CrmQuotation; installmentId: string } | null>(null)
  const [report, setReport] = useState<{ quotation: CrmQuotation; installmentId: string } | null>(null)
  const [answering, setAnswering] = useState<TransferNotice | null>(null)
  const label = (l: string) => l || t("crm_quote_installment_full")

  const noticesOf = (quotationId: string) => notices.filter((n) => n.quotationId === quotationId)
  /** Whether this due row carries the report button — only the next unreported
   * instalment does, and any "not found" (PRD PAY-05). */
  const canReportRow = (d: InstallmentDue): boolean => {
    if (!canReport) return false
    const states = installmentStates(d.quotation)
    return reportableInstallments(states, noticesOf(d.quotation.id)).some((s) => s.id === d.installment.id)
  }

  return (
    <SalesShell portal={portal} title={t("sales_payments_title")} description={t("sales_payments_desc")} icon={Banknote}>
      {!isLoading && !canRecordPayment && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Lock size={12} aria-hidden="true" />
          {t("sales_no_payment_permission")}
        </p>
      )}

      <CrmStatRow>
        <CrmStat icon={Hourglass} label={t("sales_payments_due_total")} value={formatSarCompact(dueTotal, locale)} accent="warning" hint={t("sales_stat_due_count", { count: due.length })} />
        <CrmStat icon={CheckCircle2} label={t("sales_payments_received_total")} value={formatSarCompact(receivedTotal, locale)} accent="success" />
      </CrmStatRow>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {(["due", "received", "notices"] as Tab[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={tab === s}
              onClick={() => setTab(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === s ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              )}
            >
              {t(`sales_tab_${s}`)}
              <span className={cn("text-[10px] tabular-nums", tab === s ? "text-white/70" : "text-muted-foreground")}>
                {s === "due" ? due.length : s === "received" ? received.length : notices.length}
              </span>
              {s === "notices" && awaitingNotices > 0 && tab !== "notices" && (
                <span className="w-1.5 h-1.5 rounded-full bg-destructive" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("sales_search_placeholder")} aria-label={t("sales_search_placeholder")} className="h-9 ps-9" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : tab === "notices" ? (
        <TransferNoticesList notices={notices} canAnswer={canAnswerNotice} onAnswer={setAnswering} />
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <Banknote size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{tab === "due" ? t("sales_payments_empty_due") : t("sales_payments_empty_received")}</p>
        </div>
      ) : (
        <ul className="rounded-2xl border bg-white divide-y overflow-hidden">
          {rows.map((d: InstallmentDue) => (
            <li key={`${d.quotation.id}:${d.installment.id}:${d.entry?.paidAt ?? "due"}`} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`${base}/quotations/${d.quotation.id}`} className="font-mono text-xs text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                    {d.quotation.quotationNumber}
                  </Link>
                  <span className="text-sm font-bold text-foreground" dir="auto">{d.quotation.contactName || "—"}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5" dir="auto">
                  {label(d.installment.label)} · {t("sales_share_of", { percent: d.installment.percent, total: formatSar(d.quotation.amount, locale) })}
                  {d.entry ? (
                    <span className="text-success ms-1.5">
                      · {t("sales_paid_on", { date: formatCrmDate(d.entry.paidAt, locale) })}
                      {d.entry.paidByUserName && ` ${t("sales_paid_by", { name: d.entry.paidByUserName })}`}
                      {d.entry.note && ` — ${d.entry.note}`}
                    </span>
                  ) : (
                    d.installment.paid > 0 && (
                      <span className="text-warning ms-1.5">
                        · {t("sales_installment_partial", { paid: formatSar(d.installment.paid, locale), total: formatSar(d.installment.amount, locale), remaining: formatSar(d.installment.remaining, locale) })}
                      </span>
                    )
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0 flex-wrap">
                {!d.entry && (() => {
                  const state = installmentNoticeState(d.installment, noticesOf(d.quotation.id))
                  return state === "not_reported" ? null : (
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap", NOTICE_STATE_CLASS[state])}>
                      {t(`sales_tn_state_${state}`)}
                    </span>
                  )
                })()}
                <span className={cn("text-sm font-black tabular-nums", d.entry ? "text-success" : "text-warning")} dir="ltr">
                  {formatSar(d.entry ? d.entry.paidAmount : d.installment.remaining, locale)}
                </span>
                {!d.entry && canReportRow(d) && (
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setReport({ quotation: d.quotation, installmentId: d.installment.id })}>
                    <Send size={13} />
                    {t("sales_tn_report_btn")}
                  </Button>
                )}
                {!d.entry && canRecordPayment && (
                  <Button size="sm" className="h-8 gap-1.5" onClick={() => setPay({ quotation: d.quotation, installmentId: d.installment.id })}>
                    <Banknote size={13} />
                    {t("sales_record_payment_btn")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <RecordPaymentDialog
        quotation={pay?.quotation ?? null}
        installmentId={pay?.installmentId ?? null}
        onOpenChange={(open) => { if (!open) setPay(null) }}
        orgId={orgId}
        teamMembers={teamMembers}
        actorName={actorName}
      />
      <ReportTransferDialog
        target={report}
        order={report ? orderOfQuotation(report.quotation.id) : null}
        onOpenChange={(open) => { if (!open) setReport(null) }}
        actorName={actorName}
      />
      <AnswerTransferDialog
        notice={answering}
        quotation={answering ? quotations.find((q) => q.id === answering.quotationId) ?? null : null}
        order={answering ? orderOfQuotation(answering.quotationId) : null}
        onOpenChange={(open) => { if (!open) setAnswering(null) }}
        actorName={actorName}
      />
    </SalesShell>
  )
}
