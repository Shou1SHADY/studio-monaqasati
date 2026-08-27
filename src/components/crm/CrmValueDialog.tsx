"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { ShieldCheck, ShieldAlert, Coins } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import { useCrmApproval } from "@/hooks/useCrmApproval"
import { cn } from "@/lib/utils"
import {
  CRM_OPPORTUNITIES,
  CRM_QUOTATIONS,
  WON_REASONS,
  formatSar,
  generateQuotationNumber,
  historyEntry,
  stageHistory,
  type CrmOpportunity,
  type CrmQuotation,
  type WonReason,
} from "@/lib/crm"

/** Which rung of the value ladder this dialog is filling in. */
export type ValueStep = "estimate" | "cost" | "submitted" | "award"

/**
 * One dialog for the four rungs of the value ladder, because they are the same
 * interaction — type a figure, see what it implies, save — and splitting them
 * into four components would have duplicated the margin maths four times.
 *
 * Two rungs have consequences beyond the number:
 *  - `submitted` writes a new quotation version, so the price that was actually
 *    sent to the client is never overwritten by a re-price, and routes the
 *    figure for approval when it exceeds the member's limit.
 *  - `award` closes the deal as won and captures who we were bidding against.
 */
export function CrmValueDialog({
  open,
  onOpenChange,
  step,
  opportunity,
  orgId,
  /** Highest existing version number, so a re-price becomes v2, v3 … */
  quotationCount = 0,
  currentUserName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  step: ValueStep
  opportunity: CrmOpportunity
  orgId: string
  quotationCount?: number
  currentUserName?: string | null
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()

  const firestore = useFirestore()
  const { toast } = useToast()
  const { approvalLimit, needsEscalation } = useCrmApproval()

  const [isSaving, setIsSaving] = useState(false)
  const [amount, setAmount] = useState("")
  const [validityDays, setValidityDays] = useState("30")
  const [paymentTerms, setPaymentTerms] = useState("")
  const [bidderCount, setBidderCount] = useState("")
  const [ourRank, setOurRank] = useState("1")
  const [wonReason, setWonReason] = useState<WonReason | "">("")
  const [wonNote, setWonNote] = useState("")

  useEffect(() => {
    if (!open) return
    const seed =
      step === "estimate"
        ? opportunity.value
        : step === "cost"
          ? opportunity.approvedCost
          : step === "submitted"
            // A first offer defaults to cost + 12%, which is a starting point to
            // argue with rather than a number anyone has to compute by hand.
            ? opportunity.submittedPrice || (opportunity.approvedCost ? Math.round(opportunity.approvedCost * 1.12) : null)
            : opportunity.awardedValue || opportunity.submittedPrice
    setAmount(seed != null && seed > 0 ? String(seed) : "")
    setValidityDays("30")
    setPaymentTerms("")
    setBidderCount(opportunity.bidderCount != null ? String(opportunity.bidderCount) : "")
    setOurRank(opportunity.ourRank != null ? String(opportunity.ourRank) : "1")
    setWonReason(opportunity.wonReason ?? "")
    setWonNote(opportunity.wonNote ?? "")
  }, [open, step, opportunity])

  const parsed = useMemo(() => {
    const n = parseFloat(amount)
    return Number.isFinite(n) && n > 0 ? n : 0
  }, [amount])

  // Margin previewed against whichever cost figure exists — the approved cost
  // for a submitted price, the estimate for a cost being entered.
  const previewMargin = useMemo(() => {
    if (step === "cost" && parsed > 0 && opportunity.value > 0) {
      return Math.round(((opportunity.value - parsed) / opportunity.value) * 1000) / 10
    }
    if ((step === "submitted" || step === "award") && parsed > 0 && (opportunity.approvedCost || 0) > 0) {
      return Math.round(((parsed - (opportunity.approvedCost || 0)) / parsed) * 1000) / 10
    }
    return null
  }, [step, parsed, opportunity.value, opportunity.approvedCost])

  const escalates = step === "submitted" && parsed > 0 && needsEscalation(parsed)
  const isPartial = step === "award" && parsed > 0 && (opportunity.submittedPrice || 0) > 0 && parsed < (opportunity.submittedPrice || 0)

  const handleSave = async () => {
    if (!firestore || isSaving) return
    if (parsed <= 0) {
      toast({ title: t("crm_value_required"), variant: "destructive" })
      return
    }
    if (step === "award" && !wonReason) {
      toast({ title: t("crm_won_reason_required"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const oppRef = doc(firestore, CRM_OPPORTUNITIES, opportunity.id)

      if (step === "estimate") {
        await updateDoc(oppRef, { value: parsed, updatedAt: serverTimestamp() })
      } else if (step === "cost") {
        await updateDoc(oppRef, { approvedCost: parsed, updatedAt: serverTimestamp() })
      } else if (step === "submitted") {
        const version = quotationCount + 1
        const quotation: Omit<CrmQuotation, "id"> = {
          contactId: opportunity.contactId,
          contactName: opportunity.contactName ?? null,
          opportunityId: opportunity.id,
          version,
          quotationNumber: generateQuotationNumber(),
          amount: parsed,
          status: "sent",
          date: new Date().toISOString().slice(0, 10),
          validityDays: parseInt(validityDays, 10) || null,
          paymentTerms: paymentTerms.trim() || null,
          notes: null,
          organizationId: orgId,
        }
        await addDoc(collection(firestore, CRM_QUOTATIONS), {
          ...quotation,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        await updateDoc(oppRef, {
          submittedPrice: parsed,
          approvalStatus: escalates ? "pending" : "approved",
          approvalAmount: parsed,
          approvedByName: escalates ? null : currentUserName || null,
          updatedAt: serverTimestamp(),
        })
      } else {
        // The award is the ONLY path to "won". It writes the outcome, the
        // reason, and the history entry together so none can exist alone.
        const alreadyWon = opportunity.stage === "won"
        await updateDoc(oppRef, {
          awardedValue: parsed,
          stage: "won",
          state: opportunity.state === "handed_over" ? "handed_over" : "won",
          wonReason: wonReason || null,
          wonNote: wonNote.trim() || null,
          bidderCount: parseInt(bidderCount, 10) || null,
          ourRank: parseInt(ourRank, 10) || null,
          ...(alreadyWon ? {} : { stageHistory: [...stageHistory(opportunity), historyEntry("won", currentUserName)] }),
          updatedAt: serverTimestamp(),
        })
      }

      toast({
        title:
          step === "submitted" && escalates
            ? t("crm_price_escalated")
            : step === "award"
              ? t("crm_award_recorded")
              : t("crm_value_saved"),
      })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const steps: CrmFormStep[] = [
    {
      id: "value",
      title: t(`crm_value_${step}_label`),
      validate: () => {
        if (parsed <= 0) return t("crm_value_required")
        if (step === "award" && !wonReason) return t("crm_won_reason_required")
        return null
      },
      content: (
        <>
            <div className="space-y-1.5">
              <Label htmlFor="value-amount">{t(`crm_value_${step}_label`)} <RequiredMark /></Label>
              <Input
                id="value-amount"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                dir="ltr"
                disabled={isSaving}
                autoFocus
              />
            </div>

            {step === "submitted" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="value-validity">{t("crm_value_validity")}</Label>
                  <Input id="value-validity" type="number" min="1" inputMode="numeric" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} dir="ltr" disabled={isSaving} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="value-terms">{t("crm_value_payment_terms")}</Label>
                  <Input id="value-terms" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder={t("crm_value_payment_terms_placeholder")} disabled={isSaving} />
                </div>
              </div>
            )}

            {step === "award" && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="value-bidders">{t("crm_value_bidders")}</Label>
                    <Input id="value-bidders" type="number" min="0" inputMode="numeric" value={bidderCount} onChange={(e) => setBidderCount(e.target.value)} dir="ltr" disabled={isSaving} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="value-rank">{t("crm_value_rank")}</Label>
                    <Input id="value-rank" type="number" min="1" inputMode="numeric" value={ourRank} onChange={(e) => setOurRank(e.target.value)} dir="ltr" disabled={isSaving} />
                  </div>
                </div>

                {/* Why we won, next to what we won. A pipeline that only
                    explains its losses teaches half a lesson. */}
                <div className="space-y-1.5">
                  <Label htmlFor="value-won-reason">{t("crm_won_reason")} <RequiredMark /></Label>
                  <Select value={wonReason} onValueChange={(v) => setWonReason(v as WonReason)} disabled={isSaving}>
                    <SelectTrigger id="value-won-reason">
                      <SelectValue placeholder={t("crm_won_reason_placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {WON_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>{t(`crm_won_reason_${r}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="value-won-note">{t("crm_won_note")}</Label>
                  <Textarea
                    id="value-won-note"
                    rows={2}
                    value={wonNote}
                    onChange={(e) => setWonNote(e.target.value)}
                    placeholder={t("crm_won_note_placeholder")}
                    disabled={isSaving}
                  />
                </div>
              </>
            )}

            {/* Consequence preview — what saving this number will mean. */}
            {(previewMargin !== null || escalates || isPartial || step === "submitted") && (
              <div className="rounded-lg border bg-muted/30 divide-y text-sm">
                {previewMargin !== null && (
                  <p className="px-3 py-2 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{t("crm_margin")}</span>
                    <span className={cn("font-black", previewMargin >= 12 ? "text-success" : "text-warning")} dir="ltr">
                      {previewMargin}%
                    </span>
                  </p>
                )}
                {step === "submitted" && (
                  <p className="px-3 py-2 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{t("crm_approval_limit")}</span>
                    <span className="font-bold" dir="ltr">
                      {approvalLimit === Number.POSITIVE_INFINITY ? "∞" : formatSar(approvalLimit, locale)}
                    </span>
                  </p>
                )}
                {step === "submitted" && parsed > 0 && (
                  <p className="px-3 py-2 flex items-center gap-2">
                    {escalates ? (
                      <>
                        <ShieldAlert size={14} className="text-warning shrink-0" />
                        <span className="text-warning font-semibold">{t("crm_approval_needs_higher")}</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={14} className="text-success shrink-0" />
                        <span className="text-success font-semibold">{t("crm_approval_within_limit")}</span>
                      </>
                    )}
                  </p>
                )}
                {isPartial && (
                  <p className="px-3 py-2 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{t("crm_award_partial")}</span>
                    <span className="font-black text-warning" dir="ltr">
                      {Math.round((parsed / (opportunity.submittedPrice || 1)) * 100)}%
                    </span>
                  </p>
                )}
              </div>
            )}
        </>
      ),
    },
  ]

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Coins}
      title={t(`crm_value_${step}_title`)}
      description={t(`crm_value_${step}_desc`)}
      steps={steps}
      isSaving={isSaving}
      submitLabel={t("crm_save")}
      onSubmit={() => void handleSave()}
      size="md"
    />
  )
}
