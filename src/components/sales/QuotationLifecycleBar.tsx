"use client"

// Every act a quotation allows right now (Sales PRD §5 T4–T9), one step at a
// time: Issue → Log as sent → Convert to order | Close as lost; an expired
// quote is extended or revised; a change after issue is a NEW revision. Each
// dialog ends with what will happen in the system, and each act tells CRM —
// as a done activity on the client's file — what became of its request.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle, BadgeCheck, CalendarClock, CheckCircle2, ClipboardList, CopyPlus, Info, Loader2, Lock, PencilLine, Send, XCircle,
} from "lucide-react"
import { Link, useRouter } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useQuoteIssueContext } from "@/hooks/useQuoteIssueContext"
import { cn } from "@/lib/utils"
import { formatCrmDate, formatSar, quotationPhase, type CrmQuotation } from "@/lib/crm"
import { runQuotationAcceptance } from "@/lib/sales"
import {
  EXTENSION_DAYS,
  closeQuotationLost,
  convertBlocks,
  daysToExpiry,
  extendQuotation,
  issueBlocks,
  issueQuotation,
  logQuotationSent,
  logQuoteEventInCrm,
  quoteActions,
  quoteLifecycle,
  reviseQuotation,
  type ConvertBlock,
  type IssueBlock,
  type QuoteLifecycle,
} from "@/lib/sales-quotes"
import { displayDocNumber } from "@/lib/sales-numbering"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"

export const LIFECYCLE_BADGE: Record<QuoteLifecycle, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  issued: "bg-warning/10 text-warning border-warning/20",
  sent: "bg-cta/10 text-cta border-cta/20",
  expired: "bg-warning/10 text-warning border-warning/20",
  won: "bg-success/10 text-success border-success/20",
  lost: "bg-destructive/10 text-destructive border-destructive/20",
  superseded: "bg-muted text-muted-foreground border-border",
}

export function QuotationLifecycleBar({
  quotation: q,
  orgId,
  base,
  actor,
  canManage,
  canApprove,
}: {
  quotation: CrmQuotation
  orgId: string
  /** `/contractor/sales` or `/supplier/sales`. */
  base: string
  actor: { id: string; name: string }
  canManage: boolean
  canApprove: boolean
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const router = useRouter()
  const { toast } = useToast()
  const issue = useQuoteIssueContext(orgId)

  const today = new Date().toISOString().slice(0, 10)
  const state = quoteLifecycle(q, today)
  const actions = quoteActions(q, today)
  const left = daysToExpiry(q, today)
  const number = displayDocNumber(q.quotationNumber, locale)

  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | "convert" | "lost">(null)
  const [promiseDate, setPromiseDate] = useState("")
  const [lostReason, setLostReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const blocks: IssueBlock[] = state === "draft" && issue.isReady ? issueBlocks(q, issue.context) : []
  const converts: ConvertBlock[] = dialog === "convert" ? convertBlocks(q, today, issue.context) : []

  const blockText = (b: IssueBlock): string =>
    b.kind === "below_cost"
      ? t("sales_below_cost_blocked", { name: b.name })
      : b.kind === "over_cap"
        ? t("sales_discount_cap_blocked", { name: b.name, discount: b.discountPercent, cap: b.capPercent })
        : b.kind === "advance_required"
          ? t("sales_q_block_advance", { items: b.names.join(" · ") })
          : t(`sales_q_block_${b.kind}`)

  const run = async (key: string, act: () => Promise<void>) => {
    if (!firestore || busy) return
    setBusy(key)
    setError(null)
    try {
      await act()
    } catch (err) {
      console.error(err)
      const code = err instanceof Error ? err.message : ""
      const key = code.startsWith("blocked:") ? "sales_q_issue_blocked" : `sales_q_err_${code}`
      const msg = t.has(key) ? t(key) : t("crm_save_error")
      setError(msg)
      toast({ title: msg, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const doIssue = () =>
    run("issue", async () => {
      const context = await issue.reload()
      const issued = await issueQuotation(firestore, { quotationId: q.id, context, actor })
      toast({ title: t("sales_q_issued_toast", { number: displayDocNumber(issued.quotationNumber, locale) }) })
    })

  const doLogSent = () =>
    run("sent", async () => {
      const sent = await logQuotationSent(firestore, { quotationId: q.id, actor })
      // quote.sent → CRM: an activity on the client's file (INT-01).
      await logQuoteEventInCrm(firestore, {
        quotation: q,
        title: t("sales_q_crm_sent", { number: q.quotationNumber }),
        notes: t("sales_q_crm_sent_notes", { amount: formatSar(q.amount, locale), until: sent.validUntil || "" }),
        actor,
      })
      toast({ title: t("sales_q_sent_toast", { date: formatCrmDate(sent.validUntil || "", locale) }) })
    })

  const doExtend = () =>
    run("extend", async () => {
      await extendQuotation(firestore, { quotationId: q.id, today, actor })
      toast({ title: t("sales_q_extended_toast", { days: EXTENSION_DAYS }) })
    })

  const doRevise = () =>
    run("revise", async () => {
      const id = await reviseQuotation(firestore, { quotationId: q.id, today, actor })
      toast({ title: t("sales_q_revised_toast") })
      router.push(`${base}/quotations/new?draft=${id}`)
    })

  const doLost = () =>
    run("lost", async () => {
      if (!lostReason.trim()) throw new Error("reason_required")
      await closeQuotationLost(firestore, { quotationId: q.id, reason: lostReason, actor })
      // quote.outcome (lost) → CRM, with its reason.
      await logQuoteEventInCrm(firestore, { quotation: q, title: t("sales_q_crm_lost", { number: q.quotationNumber }), notes: lostReason.trim(), actor })
      toast({ title: t("sales_q_lost_toast") })
      setDialog(null)
    })

  const doConvert = () =>
    run("convert", async () => {
      // Stock that covered a line at quote time may be gone by acceptance (SO-04).
      const context = await issue.reload()
      const fresh = convertBlocks(q, today, context)
      if (fresh.length) throw new Error(`convert_${fresh[0]}`)
      if (!promiseDate || promiseDate < today) throw new Error("promise_required")
      const result = await runQuotationAcceptance(firestore, {
        orgId,
        user: actor,
        promiseDate,
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
          vatPercent: q.vatPercent ?? null,
        },
        notification: {
          title: t("sales_notif_approved_title"),
          message: (advance) =>
            t("sales_notif_approved_msg", {
              contact: q.contactName || "—",
              number: q.quotationNumber,
              amount: formatSar(q.amount, locale),
              deposit: advance ? t("sales_notif_approved_deposit", { label: advance.label || t("crm_quote_installment_full"), percent: advance.percent, amount: formatSar(advance.amount, locale) }) : "",
            }),
        },
      })
      // quote.outcome (won) → CRM: the deal's owner closes it as won there.
      await logQuoteEventInCrm(firestore, { quotation: q, title: t("sales_q_crm_won", { number: q.quotationNumber }), notes: null, actor })
      if (result.notified > 0) toast({ title: t("crm_quote_finance_notified") })
      toast({ title: t("sales_q_converted_toast") })
      setDialog(null)
      if (result.salesOrderId) router.push(`${base}/orders?open=${result.salesOrderId}`)
    })

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn("text-[10px]", LIFECYCLE_BADGE[state])}>{t(`sales_q_state_${state}`)}</Badge>
        {state === "sent" && left != null && (
          <span className={cn("text-[11px] font-semibold", left <= 3 ? "text-warning" : "text-muted-foreground")}>
            {t("sales_q_valid_left", { days: left, date: formatCrmDate(q.validUntil || "", locale) })}
          </span>
        )}
        {state === "expired" && <span className="text-[11px] font-semibold text-warning">{t("sales_q_expired_on", { date: formatCrmDate(q.validUntil || "", locale) })}</span>}
        {state === "lost" && q.lostReason && <span className="text-[11px] text-muted-foreground" dir="auto">{t("sales_q_lost_reason_line", { reason: q.lostReason })}</span>}
        {state === "superseded" && q.supersededById && (
          <Link href={`${base}/quotations/${q.supersededById}`} className="rounded-sm text-[11px] font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("sales_q_open_newer")}
          </Link>
        )}
        {state === "won" && q.salesOrderId && (
          <Link href={`${base}/orders?open=${q.salesOrderId}`} className="flex items-center gap-1 rounded-sm text-[11px] font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ClipboardList size={12} aria-hidden="true" />
            {t("sales_q_open_order")}
          </Link>
        )}
      </div>

      {canManage && actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {(state === "draft" || state === "issued") && (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={`${base}/quotations/new?draft=${q.id}`}>
                <PencilLine size={14} aria-hidden="true" />
                {state === "draft" ? t("sales_q_open_composer") : t("sales_q_edit_texts")}
              </Link>
            </Button>
          )}
          {actions.includes("issue") && (
            <Button size="sm" className="gap-1.5" disabled={!!busy || !issue.isReady || blocks.length > 0} onClick={doIssue} aria-describedby={blocks.length ? `issue-blocks-${q.id}` : undefined}>
              {busy === "issue" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <BadgeCheck size={14} aria-hidden="true" />}
              {t("sales_q_issue_btn")}
            </Button>
          )}
          {actions.includes("log_sent") && (
            <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={doLogSent}>
              {busy === "sent" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
              {t("sales_q_log_sent_btn")}
            </Button>
          )}
          {actions.includes("convert") && (
            <Button size="sm" className="gap-1.5 bg-success text-white hover:bg-success/90" disabled={!!busy || !canApprove} onClick={() => { setPromiseDate(""); setError(null); setDialog("convert") }}>
              <CheckCircle2 size={14} aria-hidden="true" />
              {t("sales_q_convert_btn")}
            </Button>
          )}
          {actions.includes("extend") && (
            <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={doExtend}>
              {busy === "extend" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CalendarClock size={14} aria-hidden="true" />}
              {t("sales_q_extend_btn", { days: EXTENSION_DAYS })}
            </Button>
          )}
          {actions.includes("revise") && (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={doRevise}>
              {busy === "revise" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CopyPlus size={14} aria-hidden="true" />}
              {t("sales_q_revise_btn")}
            </Button>
          )}
          {actions.includes("close_lost") && (
            <Button size="sm" variant="outline" className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive hover:text-white" disabled={!!busy} onClick={() => { setLostReason(""); setError(null); setDialog("lost") }}>
              <XCircle size={14} aria-hidden="true" />
              {t("sales_q_lost_btn")}
            </Button>
          )}
          {actions.includes("convert") && !canApprove && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Lock size={11} aria-hidden="true" />
              {t("crm_quote_accept_locked")}
            </span>
          )}
        </div>
      )}

      {state === "issued" && <p className="text-[11px] text-muted-foreground">{t("sales_q_issued_hint")}</p>}

      {blocks.length > 0 && (
        <div id={`issue-blocks-${q.id}`} className="space-y-1.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5" role="status">
          <p className="flex items-center gap-2 text-xs font-black text-warning">
            <AlertTriangle size={13} aria-hidden="true" />
            {t("sales_q_blocks_title")}
          </p>
          <ul className="list-disc space-y-1 ps-5 text-xs text-slate-700">
            {blocks.map((b, i) => (
              <li key={`${b.kind}-${i}`}>{blockText(b)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Convert to order ── */}
      <Dialog open={dialog === "convert"} onOpenChange={(open) => { if (!open && !busy) setDialog(null) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sales_q_convert_title", { number })}</DialogTitle>
            <DialogDescription>{t("sales_q_convert_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {converts.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5" role="alert">
                <ul className="list-disc space-y-1 ps-5 text-xs font-semibold text-destructive">
                  {converts.map((b) => (
                    <li key={b}>{t(`sales_q_convert_block_${b}`)}</li>
                  ))}
                </ul>
                {converts.includes("advance_required") && (
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={!!busy} onClick={() => { setDialog(null); void doRevise() }}>
                    <CopyPlus size={13} aria-hidden="true" />
                    {t("sales_q_convert_revise")}
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor={`promise-${q.id}`}>
                    {t("sales_q_promise_date")}
                    <span className="ms-0.5 text-destructive">*</span>
                  </Label>
                  <input id={`promise-${q.id}`} type="date" dir="ltr" min={today} value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} className={DATE_INPUT_CLASS} aria-describedby={`promise-hint-${q.id}`} />
                  <p id={`promise-hint-${q.id}`} className="text-[11px] text-muted-foreground">
                    {q.leadTime ? t("sales_q_promise_hint_lead", { lead: q.leadTime }) : t("sales_q_promise_hint")}
                  </p>
                </div>
                <p className="flex items-start gap-1.5 rounded-lg border border-cta/20 bg-cta/5 px-3 py-2 text-[11px] text-cta">
                  <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {t("sales_q_convert_effect")}
                </p>
              </>
            )}
            {error && <p className="text-xs font-semibold text-destructive" role="alert">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={!!busy}>{t("crm_cancel")}</Button>
            <Button onClick={doConvert} disabled={!!busy || converts.length > 0 || !promiseDate} className="gap-1.5 bg-success text-white hover:bg-success/90">
              {busy === "convert" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
              {t("sales_q_convert_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Close as lost ── */}
      <Dialog open={dialog === "lost"} onOpenChange={(open) => { if (!open && !busy) setDialog(null) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sales_q_lost_title", { number })}</DialogTitle>
            <DialogDescription>{t("sales_q_lost_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor={`lost-${q.id}`}>
                {t("sales_q_lost_reason")}
                <span className="ms-0.5 text-destructive">*</span>
              </Label>
              <Textarea id={`lost-${q.id}`} rows={3} dir="auto" value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
            </div>
            <p className="flex items-start gap-1.5 rounded-lg border border-cta/20 bg-cta/5 px-3 py-2 text-[11px] text-cta">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t("sales_q_lost_effect")}
            </p>
            {error && <p className="text-xs font-semibold text-destructive" role="alert">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={!!busy}>{t("crm_cancel")}</Button>
            <Button onClick={doLost} disabled={!!busy || !lostReason.trim()} className="gap-1.5 bg-destructive text-white hover:bg-destructive/90">
              {busy === "lost" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
              {t("sales_q_lost_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
