"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { collection, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import { FileText } from "lucide-react"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"
import {
  CRM_QUOTATIONS,
  QUOTATION_STATUSES,
  generateQuotationNumber,
  type CrmQuotation,
  type QuotationStatus,
} from "@/lib/crm"
import { createWorkOrderFromQuotation } from "@/lib/manufacturing"
import { useUser } from "@/firebase"

export function CrmQuotationDialog({
  open,
  onOpenChange,
  orgId,
  contactId,
  contactName,
  quotation,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  contactId: string
  contactName?: string | null
  quotation?: CrmQuotation
}) {
  const t = useTranslations("Portal.Shared")

  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [amount, setAmount] = useState("")
  const [status, setStatus] = useState<QuotationStatus>("draft")
  const [date, setDate] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (!open) return
    setAmount(quotation?.amount != null ? String(quotation.amount) : "")
    setStatus(quotation?.status ?? "draft")
    setDate(quotation?.date ?? new Date().toISOString().split("T")[0])
    setNotes(quotation?.notes ?? "")
  }, [open, quotation])

  const handleSave = async () => {
    if (!firestore || isSaving) return
    const parsed = parseFloat(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: t("crm_quote_amount_error"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const data = {
        contactId,
        contactName: contactName ?? null,
        amount: parsed,
        status,
        date: date || null,
        notes: notes.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      let quotationId = quotation?.id
      let quotationNumber = quotation?.quotationNumber
      if (quotation) {
        await updateDoc(doc(firestore, CRM_QUOTATIONS, quotation.id), data)
      } else {
        quotationNumber = generateQuotationNumber()
        const ref = await addDoc(collection(firestore, CRM_QUOTATIONS), {
          ...data,
          quotationNumber,
          createdAt: serverTimestamp(),
        })
        quotationId = ref.id
      }

      // Acceptance is the manufacturing trigger: the first flip to "accepted"
      // spawns a work order routed through the org's department chain —
      // unless one already exists for this quotation, or every requested good
      // is already sitting in a warehouse (see the lib).
      const becameAccepted = status === "accepted" && quotation?.status !== "accepted"
      if (becameAccepted && quotationId && user && !(quotation as { workOrderId?: string } | undefined)?.workOrderId) {
        try {
          const workOrderId = await createWorkOrderFromQuotation(firestore, {
            organizationId: orgId,
            quotationId,
            quotationNumber: quotationNumber || "",
            amount: parsed,
            contactId,
            contactName: contactName ?? null,
            opportunityId: quotation?.opportunityId ?? null,
            userId: user.uid,
            userName: user.email || "",
          })
          if (workOrderId) toast({ title: t("crm_quote_work_order_created") })
        } catch (err) {
          console.error("Work order auto-create failed:", err)
          toast({ title: t("crm_quote_work_order_failed"), variant: "destructive" })
        }
      }

      toast({ title: t("crm_quote_saved") })
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
      id: "quotation",
      title: t("crm_quote_add_title"),
      validate: () => {
        return null
      },
      content: (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="quote-amount">{t("crm_quote_amount")} <RequiredMark /></Label>
                <Input id="quote-amount" type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" disabled={isSaving} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quote-status">{t("crm_quote_status")}</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as QuotationStatus)} disabled={isSaving}>
                  <SelectTrigger id="quote-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUOTATION_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{t(`crm_quote_status_${s}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-date">{t("crm_quote_date")}</Label>
              <input id="quote-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" disabled={isSaving} className={DATE_INPUT_CLASS} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-notes">{t("crm_notes")}</Label>
              <Textarea id="quote-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isSaving} />
            </div>
        </>
      ),
    },
  ]

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={FileText}
      title={quotation ? t("crm_quote_edit_title") : t("crm_quote_add_title")}
      description={t("crm_quote_dialog_desc")}
      steps={steps}
      isSaving={isSaving}
      submitLabel={t("crm_save")}
      onSubmit={() => void handleSave()}
      size="md"
    />
  )
}
