"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, getDocs, query, where } from "firebase/firestore"
import { AlertTriangle, CheckCircle2, Hourglass, Loader2, Send, SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { INSTALLMENT_DEPOSIT_ID, formatCrmDate, formatSar, type CrmQuotation } from "@/lib/crm"
import { MFG_PRODUCTS } from "@/lib/manufacturing-engine"
import { installmentStates, loadFinanceRecipients } from "@/lib/sales"
import { MANUFACTURING_REQUESTS, type ManufacturingRequest, type SalesOrder } from "@/lib/sales-orders"
import { productionNeeds, requestProductionForAdvance } from "@/lib/sales-order-writes"
import { emitDownPaymentConfirmed } from "@/lib/mfg-events"
import {
  answerTransferNotice,
  reportTransfer,
  validateTransferReport,
  type InstallmentNoticeState,
  type TransferNotice,
} from "@/lib/sales-transfers"

export const NOTICE_STATE_CLASS: Record<InstallmentNoticeState, string> = {
  not_reported: "bg-muted text-muted-foreground border-border",
  awaiting_finance: "bg-cta/10 text-cta border-cta/20",
  confirmed: "bg-success/10 text-success border-success/20",
  not_found: "bg-destructive/10 text-destructive border-destructive/20",
}

/** The seller's half: "the client says they transferred — tell Finance".
 * Creates the numbered notice; nothing else on the order changes. */
export function ReportTransferDialog({
  target,
  order,
  onOpenChange,
  actorName,
}: {
  /** Null closes the dialog. */
  target: { quotation: CrmQuotation; installmentId: string } | null
  /** The sales order the quotation became, when known — carried for context. */
  order: SalesOrder | null
  onOpenChange: (open: boolean) => void
  actorName: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const installment = target
    ? installmentStates(target.quotation).find((s) => s.id === target.installmentId) ?? null
    : null

  const [amount, setAmount] = useState("")
  const [transferDate, setTransferDate] = useState("")
  const [bankRef, setBankRef] = useState("")
  const [note, setNote] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!target) return
    setAmount(installment ? String(installment.remaining) : "")
    setTransferDate(new Date().toLocaleDateString("en-CA"))
    setBankRef("")
    setNote("")
    // `installment` derives from `target`; re-running on it would loop.
  }, [target?.quotation.id, target?.installmentId])

  const parsed = parseFloat(amount)
  const mismatch =
    installment && Number.isFinite(parsed) && parsed > 0 && Math.abs(parsed - installment.remaining) > 0.005

  const submit = async () => {
    if (!firestore || !user || !target || !installment || isSaving) return
    const today = new Date().toLocaleDateString("en-CA")
    const error = validateTransferReport({ amount: parsed, transferDate, today })
    if (error) {
      toast({ title: t(error === "bad_amount" ? "sales_tn_error_amount" : "sales_tn_error_future"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const recipients = await loadFinanceRecipients(firestore, target.quotation.organizationId, user.uid)
      await reportTransfer(firestore, {
        quotation: target.quotation,
        order,
        installment: { id: installment.id, label: installment.label },
        amountStated: parsed,
        transferDate,
        bankRef,
        note,
        actor: { id: user.uid, name: actorName },
        recipients,
        notification: {
          title: t("sales_tn_notif_reported_title"),
          message: t("sales_tn_notif_reported_msg", {
            contact: target.quotation.contactName || "—",
            number: target.quotation.quotationNumber,
            amount: formatSar(parsed, locale),
          }),
        },
      })
      // PAY-07 / D8 — reporting the ADVANCE sends the production request: the
      // plant plans while Finance verifies, and executes nothing before it.
      let asked = 0
      if (order && order.status === "awaiting_deposit" && installment.id === (order.payment.advanceInstallmentId || INSTALLMENT_DEPOSIT_ID)) {
        try {
          const org = where("organizationId", "==", order.organizationId)
          const [cards, requests, warehouses] = await Promise.all([
            getDocs(query(collection(firestore, MFG_PRODUCTS), org)),
            getDocs(query(collection(firestore, MANUFACTURING_REQUESTS), org, where("orderId", "==", order.id))),
            getDocs(query(collection(firestore, "warehouses"), org)),
          ])
          const stock = new Map<string, number>()
          for (const wh of warehouses.docs) {
            const inv = await getDocs(collection(firestore, "warehouses", wh.id, "inventoryItems"))
            inv.forEach((d) => {
              const name = ((d.data().name as string) || "").trim()
              if (name) stock.set(name, (stock.get(name) || 0) + (Number(d.data().quantity) || 0))
            })
          }
          const needs = productionNeeds(
            order,
            cards.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || "", unit: (d.data().unit as string) || "", archived: !!d.data().archived })),
            stock,
            requests.docs.map((d) => d.data() as ManufacturingRequest)
          )
          asked = (await requestProductionForAdvance(firestore, { order, needs, actor: { id: user.uid, name: actorName } })).length
        } catch (err) {
          console.warn("production requests after the advance report skipped:", err)
        }
      }
      toast({ title: asked > 0 ? t("sales_tn_sent_toast_mfg", { count: asked }) : t("sales_tn_sent_toast") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!isSaving) onOpenChange(open) }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md w-[calc(100vw-2rem)] overflow-x-hidden max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pe-8">
            <Send size={18} className="text-cta" aria-hidden="true" />
            {t("sales_tn_report_title")}
          </DialogTitle>
          <DialogDescription>
            {target &&
              t("sales_tn_report_desc", {
                number: target.quotation.quotationNumber,
                contact: target.quotation.contactName || "—",
                label: installment?.label || t("crm_quote_installment_full"),
              })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 min-w-0">
          <div className="space-y-1.5">
            <Label htmlFor="tn-amount">{t("sales_tn_amount")}</Label>
            <Input id="tn-amount" type="number" min="0" step="any" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isSaving} />
            {mismatch && installment && (
              <p className="text-xs text-warning flex items-start gap-1.5">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
                {t("sales_tn_amount_mismatch", { amount: formatSar(installment.remaining, locale) })}
              </p>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tn-date">{t("sales_tn_date")}</Label>
              <Input id="tn-date" type="date" dir="ltr" value={transferDate} max={new Date().toLocaleDateString("en-CA")} onChange={(e) => setTransferDate(e.target.value)} disabled={isSaving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tn-bank">{t("sales_tn_bank_ref")}</Label>
              <Input id="tn-bank" value={bankRef} onChange={(e) => setBankRef(e.target.value)} disabled={isSaving} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tn-note">{t("sales_tn_note")}</Label>
            <Textarea id="tn-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={isSaving} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>{t("crm_cancel")}</Button>
          <Button onClick={submit} disabled={isSaving || !installment} className="gap-2">
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {t("sales_tn_send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Finance's half: read the notice, check the bank statement elsewhere, and
 * answer. "Not found" requires the message the seller reads to the client. */
export function AnswerTransferDialog({
  notice,
  quotation,
  order,
  onOpenChange,
  actorName,
}: {
  notice: TransferNotice | null
  quotation: CrmQuotation | null
  order: SalesOrder | null
  onOpenChange: (open: boolean) => void
  actorName: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState<"confirmed" | "not_found" | null>(null)

  useEffect(() => {
    if (notice) setMessage("")
  }, [notice?.id])

  const answer = async (result: "confirmed" | "not_found") => {
    if (!firestore || !user || !notice || saving) return
    if (result === "not_found" && !message.trim()) {
      toast({ title: t("sales_tn_answer_message_required"), variant: "destructive" })
      return
    }
    setSaving(result)
    try {
      const { released } = await answerTransferNotice(firestore, {
        notice,
        quotation,
        order,
        result,
        message,
        actor: { id: user.uid, name: actorName },
        notification: {
          title: t(result === "confirmed" ? "sales_tn_notif_confirmed_title" : "sales_tn_notif_not_found_title"),
          message: t(result === "confirmed" ? "sales_tn_notif_confirmed_msg" : "sales_tn_notif_not_found_msg", {
            number: notice.quotationNumber,
            amount: formatSar(notice.amountStated, locale),
          }),
        },
      })
      // finance.down_payment.confirmed — the workshop hears that this order's
      // work may now be released; the same notice the direct path sends, so
      // the two ways of confirming an advance end the same way.
      if (released && order) {
        await emitDownPaymentConfirmed(firestore, { copy: t, organizationId: order.organizationId, salesOrderId: order.id, salesOrderNumber: order.orderNumber, quotationId: order.quotationId ?? null, actor: { id: user.uid, name: actorName } })
      }
      toast({ title: t(result === "confirmed" ? "sales_tn_confirmed_toast" : "sales_tn_not_found_toast") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  return (
    <Dialog open={!!notice} onOpenChange={(open) => { if (!saving) onOpenChange(open) }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md w-[calc(100vw-2rem)] overflow-x-hidden max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pe-8">{notice && t("sales_tn_answer_title", { number: notice.noticeNumber })}</DialogTitle>
          <DialogDescription>
            {notice &&
              t("sales_tn_answer_desc", {
                contact: notice.contactName || "—",
                number: notice.quotationNumber,
                label: notice.installmentLabel || t("crm_quote_installment_full"),
              })}
          </DialogDescription>
        </DialogHeader>
        {notice && (
          <div className="space-y-4 py-2 min-w-0 text-sm">
            <div className="rounded-lg border bg-muted/30 px-3 py-2.5 space-y-1 text-xs">
              <p className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-muted-foreground">{t("sales_tn_amount")}</span>
                <b className="tabular-nums" dir="ltr">{formatSar(notice.amountStated, locale)}</b>
              </p>
              <p className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-muted-foreground">{t("sales_tn_date")}</span>
                <b dir="ltr">{formatCrmDate(notice.transferDate, locale)}</b>
              </p>
              {notice.bankRef && (
                <p className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-muted-foreground">{t("sales_tn_bank_ref")}</span>
                  <b dir="auto">{notice.bankRef}</b>
                </p>
              )}
              {notice.note && <p className="text-muted-foreground" dir="auto">{notice.note}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tn-answer-msg">{t("sales_tn_answer_message")}</Label>
              <Textarea id="tn-answer-msg" value={message} onChange={(e) => setMessage(e.target.value)} disabled={!!saving} />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/5" onClick={() => void answer("not_found")} disabled={!!saving}>
            {saving === "not_found" ? <Loader2 size={15} className="animate-spin" /> : <SearchX size={15} />}
            {t("sales_tn_answer_not_found")}
          </Button>
          <Button className="gap-2 bg-success hover:bg-success/90 text-white" onClick={() => void answer("confirmed")} disabled={!!saving}>
            {saving === "confirmed" ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {t("sales_tn_answer_confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The notices ledger: what sellers reported and what Finance answered.
 * Finance permissions get the answer buttons on reported rows. */
export function TransferNoticesList({
  notices,
  canAnswer,
  onAnswer,
}: {
  notices: TransferNotice[]
  canAnswer: boolean
  onAnswer: (notice: TransferNotice) => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()

  const sorted = useMemo(
    () => [...notices].sort((a, b) => (b.reportedAt || "").localeCompare(a.reportedAt || "")),
    [notices]
  )

  if (sorted.length === 0) {
    return (
      <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
        <Hourglass size={36} className="mx-auto mb-2 opacity-20" />
        <p className="text-sm">{t("sales_tn_empty")}</p>
      </div>
    )
  }

  const stateOf = (n: TransferNotice): InstallmentNoticeState =>
    n.status === "reported" ? "awaiting_finance" : n.status === "confirmed" ? "confirmed" : "not_found"

  return (
    <ul className="rounded-2xl border bg-white divide-y overflow-hidden">
      {sorted.map((n) => (
        <li key={n.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-muted-foreground">{n.noticeNumber}</span>
              <span className="text-sm font-bold text-foreground" dir="auto">{n.contactName || "—"}</span>
              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", NOTICE_STATE_CLASS[stateOf(n)])}>
                {t(`sales_tn_state_${stateOf(n)}`)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5" dir="auto">
              {n.quotationNumber} · {n.installmentLabel || t("crm_quote_installment_full")} ·{" "}
              {t("sales_tn_reported_line", { date: formatCrmDate(n.reportedAt, locale), by: n.createdByUserName })}
            </p>
            {n.financeMessage && (
              <p className="text-xs text-destructive mt-1" dir="auto">
                {t("sales_tn_finance_msg")} {n.financeMessage}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm font-black tabular-nums" dir="ltr">{formatSar(n.amountStated, locale)}</span>
            {n.status === "reported" && canAnswer && (
              <Button size="sm" className="h-8 gap-1.5" onClick={() => onAnswer(n)}>
                <CheckCircle2 size={13} />
                {t("sales_tn_answer_btn")}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
