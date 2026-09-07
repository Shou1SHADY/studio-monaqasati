"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Banknote, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import { formatCrmDate, formatSar, type CrmQuotation } from "@/lib/crm"
import { installmentStates, nextUnpaidInstallment, paymentRecipients, recordInstallmentPayment } from "@/lib/sales"

/**
 * Record a customer payment against one installment. Finance is notified in
 * the same write. Used from the quotation list, its detail page and the
 * Payments page, so the three never drift.
 */
export function RecordPaymentDialog({
  quotation,
  installmentId,
  onOpenChange,
  orgId,
  teamMembers,
  actorName,
}: {
  /** Null closes the dialog. */
  quotation: CrmQuotation | null
  /** Preselect this installment; defaults to the next unpaid one. */
  installmentId?: string | null
  onOpenChange: (open: boolean) => void
  orgId: string
  teamMembers: Array<{ id: string; defaultGroupId?: string | null }>
  actorName: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { groups } = usePermissions()

  const states = quotation ? installmentStates(quotation) : []
  const [picked, setPicked] = useState("")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!quotation) return
    const preset = installmentId ? states.find((s) => s.id === installmentId && !s.settled) : null
    const next = preset ?? nextUnpaidInstallment(quotation)
    setPicked(next?.id || "")
    setAmount(next ? String(next.remaining) : "")
    setNote("")
    // `states` derives from `quotation`; re-running on it would loop.
  }, [quotation?.id, installmentId])

  const label = (l: string) => l || t("crm_quote_installment_full")
  const pick = (id: string) => {
    setPicked(id)
    const s = states.find((x) => x.id === id)
    if (s) setAmount(String(s.remaining))
  }

  const confirm = async () => {
    if (!firestore || !user || !quotation || !picked || isSaving) return
    const parsed = parseFloat(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: t("crm_quote_amount_error"), variant: "destructive" })
      return
    }
    const state = states.find((s) => s.id === picked)
    // A payment may cover part of an installment (the rest stays due) but never
    // more than what remains on it — the excess belongs to the next installment.
    if (state && parsed > state.remaining + 0.005) {
      toast({ title: t("sales_amount_exceeds", { remaining: formatSar(state.remaining, locale) }), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const recipients = paymentRecipients({ ownerId: orgId, actorId: user.uid, members: teamMembers, groups })
      await recordInstallmentPayment(firestore, {
        quotation,
        installmentId: picked,
        amount: parsed,
        note: note.trim() || null,
        actor: { id: user.uid, name: actorName },
        recipients,
        notification: {
          title: t("sales_notif_paid_title"),
          message: t("sales_notif_paid_installment_msg", {
            contact: quotation.contactName || "—",
            label: label(state?.label || ""),
            number: quotation.quotationNumber,
            amount: formatSar(parsed, locale),
          }),
        },
      })
      toast({ title: t("sales_paid_toast", { count: recipients.length }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={!!quotation} onOpenChange={(open) => { if (!isSaving) onOpenChange(open) }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote size={18} className="text-success" aria-hidden="true" />
            {t("sales_record_payment_title")}
          </DialogTitle>
          <DialogDescription>
            {quotation && t("sales_record_payment_desc", { number: quotation.quotationNumber, contact: quotation.contactName || "—" })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("sales_pick_installment")}</Label>
            <div role="radiogroup" aria-label={t("sales_pick_installment")} className="space-y-1">
              {states.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={picked === s.id}
                  disabled={s.settled || isSaving}
                  onClick={() => pick(s.id)}
                  className={cn(
                    "w-full text-start flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                    picked === s.id ? "border-primary bg-primary/5" : "border-slate-200 hover:border-slate-300",
                    s.settled && "bg-success/5 border-success/30"
                  )}
                >
                  <span className="font-semibold" dir="auto">{label(s.label)} · {s.percent}%</span>
                  <span className="tabular-nums text-muted-foreground" dir="ltr">
                    {s.settled && s.payment
                      ? t("sales_installment_paid_line", { label: "", amount: formatSar(s.paid, locale), date: formatCrmDate(s.payment.paidAt, locale) }).trim()
                      : s.paid > 0
                        ? t("sales_installment_partial", { paid: formatSar(s.paid, locale), total: formatSar(s.amount, locale), remaining: formatSar(s.remaining, locale) })
                        : formatSar(s.amount, locale)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sales-paid-amount">{t("sales_paid_amount")}</Label>
            <Input id="sales-paid-amount" type="number" min="0" step="any" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isSaving} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sales-paid-note">{t("sales_payment_note")}</Label>
            <Textarea id="sales-paid-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={isSaving} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>{t("crm_cancel")}</Button>
          <Button onClick={confirm} disabled={isSaving || !picked} className="gap-2 bg-success hover:bg-success/90 text-white">
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {t("sales_confirm_paid")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
