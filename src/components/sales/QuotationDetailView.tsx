"use client"

import { useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { doc, updateDoc, serverTimestamp } from "firebase/firestore"
import {
  ArrowRight, Pencil, Banknote, CheckCircle2, XCircle, Send, RotateCcw, Loader2, FileText,
  Factory, Contact, Clock, CalendarDays, Boxes, Lock,
} from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  CRM_QUOTATIONS,
  QUOTATION_PHASE_BADGE_CLASS,
  QUOTATION_STATUS_BADGE_CLASS,
  formatCrmDate,
  formatSar,
  quotationPhase,
  type QuotationStatus,
} from "@/lib/crm"
import {
  QUOTATION_STATUS_ACTIONS,
  installmentStates,
  isAwaitingPayment,
  isFullyPaid,
  paidSoFar,
  quotationTimeline,
  runQuotationAcceptance,
  statusStamp,
} from "@/lib/sales"
import { CrmQuotationDialog } from "@/components/crm/CrmQuotationDialog"
import { CrmEmptyState, crmBasePath, type CrmPortal } from "@/components/crm/CrmShell"
import { SalesShell, SalesSection, salesBasePath } from "./SalesShell"
import { RecordPaymentDialog } from "./RecordPaymentDialog"

/** One quotation, fully: lines, payment schedule, the customer, the linked
 * work order, its story so far — and every action it allows right now. */
export function QuotationDetailView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const params = useParams()
  const id = String(params.id ?? "")
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManage = can("sales.manage")
  const canApprove = can("sales.approve") || can("crm.close")
  const canRecordPayment = can("invoices.manage") || can("sales.approve")
  const base = salesBasePath(portal)
  const crmBase = crmBasePath(portal)

  const { orgId, quotations, teamMembers, isLoading } = useCrmData({ quotations: true })
  const actorName = teamMembers.find((m) => m.id === user?.uid)?.name || user?.email || ""
  // The org-scoped list is the source: a quotation from another company is
  // simply "not found", the same way the CRM contact page treats it.
  const q = useMemo(() => quotations.find((x) => x.id === id) ?? null, [quotations, id])

  const [showEdit, setShowEdit] = useState(false)
  const [payInstallment, setPayInstallment] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<"accepted" | "rejected" | null>(null)
  const [isChanging, setIsChanging] = useState(false)

  const changeStatus = async (to: QuotationStatus) => {
    if (!firestore || !user || !q || isChanging) return
    setIsChanging(true)
    try {
      const now = new Date().toISOString()
      await updateDoc(doc(firestore, CRM_QUOTATIONS, q.id), { status: to, ...statusStamp(q.status, to, now), updatedAt: serverTimestamp() })
      if (to === "accepted") {
        try {
          const result = await runQuotationAcceptance(firestore, {
            orgId,
            user: { id: user.uid, name: actorName },
            quotation: {
              id: q.id,
              quotationNumber: q.quotationNumber,
              contactId: q.contactId,
              contactName: q.contactName ?? null,
              opportunityId: q.opportunityId ?? null,
              amount: q.amount,
              items: q.items ?? null,
              installments: q.installments ?? null,
              phase: quotationPhase(q),
              workOrderId: q.workOrderId ?? null,
            },
            notification: {
              title: t("sales_notif_approved_title"),
              message: (deposit) =>
                t("sales_notif_approved_msg", {
                  contact: q.contactName || "—",
                  number: q.quotationNumber,
                  amount: formatSar(q.amount, locale),
                  deposit: deposit
                    ? t("sales_notif_approved_deposit", { label: deposit.label || t("crm_quote_installment_full"), percent: deposit.percent, amount: formatSar(deposit.amount, locale) })
                    : "",
                }),
            },
          })
          if (result.notified > 0) toast({ title: t("crm_quote_finance_notified") })
          if (result.workOrderId) toast({ title: t("crm_quote_work_order_created") })
        } catch (err) {
          console.error("Work order auto-create failed:", err)
          toast({ title: t("crm_quote_work_order_failed"), variant: "destructive" })
        }
      }
      toast({ title: t("sales_status_updated") })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsChanging(false)
      setConfirm(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={32} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!q) {
    return (
      <SalesShell portal={portal} title={t("sales_page_title")} description={t("sales_quotations_desc")}>
        <CrmEmptyState
          icon={FileText}
          title={t("sales_detail_not_found")}
          description={t("sales_detail_not_found_desc")}
          action={
            <Link href={`${base}/quotations`}>
              <Button variant="outline">{t("sales_detail_back")}</Button>
            </Link>
          }
        />
      </SalesShell>
    )
  }

  const phase = quotationPhase(q)
  const states = installmentStates(q)
  const fully = isFullyPaid(q)
  const paid = paidSoFar(q)
  const timeline = quotationTimeline(q)
  const actions = QUOTATION_STATUS_ACTIONS[q.status]
  const itemsTotal = (q.items || []).reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const label = (l: string) => l || t("crm_quote_installment_full")

  const actionButton = (to: QuotationStatus) => {
    if (to === "accepted") {
      return (
        <Button key={to} size="sm" className="gap-1.5 bg-success hover:bg-success/90 text-white" disabled={!canApprove || isChanging} onClick={() => setConfirm("accepted")}>
          <CheckCircle2 size={14} />
          {t("sales_action_accept")}
        </Button>
      )
    }
    if (to === "rejected") {
      return (
        <Button key={to} size="sm" variant="outline" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive hover:text-white" disabled={!canManage || isChanging} onClick={() => setConfirm("rejected")}>
          <XCircle size={14} />
          {t("sales_action_reject")}
        </Button>
      )
    }
    const reopen = q.status === "rejected"
    return (
      <Button key={to} size="sm" variant="outline" className="gap-1.5" disabled={!canManage || isChanging} onClick={() => changeStatus(to)}>
        {reopen ? <RotateCcw size={14} /> : <Send size={14} />}
        {reopen ? t("sales_action_reopen") : t("sales_action_mark_sent")}
      </Button>
    )
  }

  return (
    <SalesShell portal={portal} title={t("sales_page_title")} description={t("sales_quotations_desc")}>
      <Link
        href={`${base}/quotations`}
        className="text-xs font-semibold text-muted-foreground hover:text-primary flex items-center gap-1 w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        <ArrowRight size={12} className={cn(!isRtl && "rotate-180")} aria-hidden="true" />
        {t("sales_detail_back")}
      </Link>

      {/* Header card: identity, money, and every action available right now. */}
      <div className="rounded-2xl border bg-white p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-muted-foreground">{q.quotationNumber}</span>
              <Badge className={cn("text-[10px]", QUOTATION_PHASE_BADGE_CLASS[phase])}>{t(`crm_quote_phase_${phase}`)}</Badge>
              <Badge className={cn("text-[10px]", QUOTATION_STATUS_BADGE_CLASS[q.status])}>{t(`crm_quote_status_${q.status}`)}</Badge>
              {fully && (
                <Badge className="text-[10px] bg-success/10 text-success border-success/20 gap-1">
                  <CheckCircle2 size={10} aria-hidden="true" />
                  {t("crm_quote_paid_badge")}
                </Badge>
              )}
            </div>
            <h2 className="text-xl font-black text-foreground" dir="auto">
              {q.contactId ? (
                <Link href={`${crmBase}/leads/${q.contactId}`} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                  {q.contactName || t("sales_col_customer")}
                </Link>
              ) : (
                q.contactName || "—"
              )}
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
              {q.date && (
                <span className="flex items-center gap-1"><CalendarDays size={12} aria-hidden="true" />{formatCrmDate(q.date, locale)}</span>
              )}
              {q.validityDays != null && <span>{t("sales_validity_line", { days: q.validityDays })}</span>}
            </p>
          </div>
          <div className="text-start md:text-end shrink-0">
            <p className="text-2xl font-black tabular-nums" dir="ltr">{formatSar(q.amount, locale)}</p>
            {q.status === "accepted" && (
              <p className={cn("text-xs font-semibold mt-1", fully ? "text-success" : "text-warning")}>
                {fully ? t("sales_paid_full") : t("sales_outstanding", { amount: formatSar(Math.max(0, q.amount - paid), locale) })}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap border-t pt-4">
          {canManage && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowEdit(true)} disabled={isChanging}>
              <Pencil size={14} />
              {t("sales_edit_btn")}
            </Button>
          )}
          {actions.map(actionButton)}
          {canRecordPayment && isAwaitingPayment(q) && (
            <Button size="sm" className="gap-1.5" onClick={() => setPayInstallment("")}>
              <Banknote size={14} />
              {t("sales_record_payment_btn")}
            </Button>
          )}
          {actions.includes("accepted") && !canApprove && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Lock size={11} aria-hidden="true" />
              {t("crm_quote_accept_locked")}
            </span>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <SalesSection title={t("sales_section_items")} icon={Boxes}>
            {q.items && q.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-start font-semibold px-5 py-2">{t("sales_col_item")}</th>
                      <th className="text-end font-semibold px-3 py-2">{t("sales_col_qty")}</th>
                      <th className="text-start font-semibold px-3 py-2">{t("sales_col_unit")}</th>
                      <th className="text-end font-semibold px-3 py-2">{t("sales_col_unit_price")}</th>
                      <th className="text-end font-semibold px-5 py-2">{t("sales_col_total")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {q.items.map((i, idx) => (
                      <tr key={idx}>
                        <td className="px-5 py-2.5 font-semibold" dir="auto">{i.name}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{i.quantity}</td>
                        <td className="px-3 py-2.5" dir="auto">{i.unit}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{formatSar(i.unitPrice, locale)}</td>
                        <td className="px-5 py-2.5 text-end tabular-nums font-bold" dir="ltr">{formatSar(i.quantity * i.unitPrice, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/20">
                      <td colSpan={4} className="px-5 py-2.5 text-xs font-bold text-muted-foreground">{t("crm_quote_items_total")}</td>
                      <td className="px-5 py-2.5 text-end tabular-nums font-black" dir="ltr">{formatSar(itemsTotal, locale)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="p-6 text-sm text-muted-foreground text-center">{t("sales_no_items")}</p>
            )}
          </SalesSection>

          <SalesSection title={t("sales_section_schedule")} icon={Banknote}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-start font-semibold px-5 py-2">{t("sales_col_installment")}</th>
                    <th className="text-end font-semibold px-3 py-2">{t("sales_col_share")}</th>
                    <th className="text-end font-semibold px-3 py-2">{t("sales_col_total")}</th>
                    <th className="text-start font-semibold px-5 py-2">{t("sales_col_status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {states.map((s) => (
                    <tr key={s.id}>
                      <td className="px-5 py-2.5 font-semibold" dir="auto">{label(s.label)}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{s.percent}%</td>
                      <td className="px-3 py-2.5 text-end tabular-nums font-bold" dir="ltr">{formatSar(s.amount, locale)}</td>
                      <td className="px-5 py-2.5">
                        {s.settled && s.payment ? (
                          <span className="text-xs text-success font-semibold" dir="auto">
                            {t("sales_installment_paid")} · {formatSar(s.paid, locale)} · {formatCrmDate(s.payment.paidAt, locale)}
                            {s.payment.paidByUserName && ` ${t("sales_paid_by", { name: s.payment.paidByUserName })}`}
                          </span>
                        ) : q.status === "accepted" ? (
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-warning font-semibold" dir="auto">
                              {s.paid > 0
                                ? t("sales_installment_partial", { paid: formatSar(s.paid, locale), total: formatSar(s.amount, locale), remaining: formatSar(s.remaining, locale) })
                                : t("sales_installment_due")}
                            </span>
                            {canRecordPayment && (
                              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setPayInstallment(s.id)}>
                                <Banknote size={12} />
                                {t("sales_record_payment_btn")}
                              </Button>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SalesSection>
        </div>

        <div className="space-y-4">
          <SalesSection title={t("sales_section_customer")} icon={Contact}>
            <div className="p-5 space-y-2 text-sm">
              <p className="font-bold" dir="auto">{q.contactName || "—"}</p>
              {q.contactId && (
                <Link href={`${crmBase}/leads/${q.contactId}`} className="text-xs font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                  {t("crm_nav_leads")}
                </Link>
              )}
              {q.paymentTerms && <p className="text-xs text-muted-foreground" dir="auto">{q.paymentTerms}</p>}
              {q.notes && <p className="text-xs text-muted-foreground whitespace-pre-line" dir="auto">{q.notes}</p>}
            </div>
          </SalesSection>

          <SalesSection title={t("sales_section_work_order")} icon={Factory}>
            <div className="p-5 text-sm space-y-2">
              {q.workOrderNumber != null ? (
                <>
                  <p className="font-bold">{t("sales_work_order_line", { number: q.workOrderNumber })}</p>
                  <Link href={`/${portal}/manufacturing`} className="text-xs font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                    {t("sales_open_manufacturing")}
                  </Link>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("sales_no_work_order")}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {t(phase === "post_manufacturing" ? "crm_quote_phase_hint_post" : "crm_quote_phase_hint_pre")}
              </p>
            </div>
          </SalesSection>

          <SalesSection title={t("sales_section_timeline")} icon={Clock}>
            <ol className="p-5 space-y-3">
              {timeline.map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", e.kind === "accepted" || e.kind === "payment" ? "bg-success" : e.kind === "rejected" ? "bg-destructive" : e.kind === "work_order" ? "bg-warning" : "bg-cta")} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-semibold" dir="auto">
                      {e.kind === "payment"
                        ? t("sales_timeline_payment", { label: label(e.label || ""), amount: formatSar(e.amount ?? 0, locale) })
                        : e.kind === "work_order"
                          ? t("sales_timeline_work_order", { number: e.number ?? "" })
                          : t(`sales_timeline_${e.kind}`)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatCrmDate(e.at, locale)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </SalesSection>
        </div>
      </div>

      {showEdit && (
        <CrmQuotationDialog
          open
          onOpenChange={(open) => { if (!open) setShowEdit(false) }}
          orgId={orgId}
          contactId={q.contactId}
          contactName={q.contactName}
          quotation={q}
        />
      )}
      <RecordPaymentDialog
        quotation={payInstallment !== null ? q : null}
        installmentId={payInstallment || null}
        onOpenChange={(open) => { if (!open) setPayInstallment(null) }}
        orgId={orgId}
        teamMembers={teamMembers}
        actorName={actorName}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open && !isChanging) setConfirm(null) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "accepted" ? t("sales_accept_confirm_title") : t("sales_reject_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === "accepted" ? t("sales_accept_confirm_desc") : t("sales_reject_confirm_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isChanging}>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isChanging}
              onClick={(e) => { e.preventDefault(); if (confirm) void changeStatus(confirm) }}
              className={confirm === "accepted" ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90"}
            >
              {isChanging ? <Loader2 size={15} className="animate-spin" /> : confirm === "accepted" ? t("sales_action_accept") : t("sales_action_reject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SalesShell>
  )
}
