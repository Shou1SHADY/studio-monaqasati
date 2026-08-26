"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { FileStack } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import { CRM_OPPORTUNITIES, opportunityAddenda, type CrmOpportunity } from "@/lib/crm"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"

/**
 * Log a client-issued addendum.
 *
 * An addendum is the mechanism by which a tender's ground shifts after it was
 * published: the deadline moves, quantities are revised. Recording it here
 * updates the deal's live date and estimate *and* keeps the numbered trail, so
 * "which addendum changed this" has an answer months later.
 */
export function CrmAddendumDialog({
  open,
  onOpenChange,
  opportunity,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  opportunity: CrmOpportunity
}) {
  const t = useTranslations("Portal.Shared")

  const firestore = useFirestore()
  const { toast } = useToast()

  const [isSaving, setIsSaving] = useState(false)
  const [note, setNote] = useState("")
  const [newDate, setNewDate] = useState("")
  const [newValue, setNewValue] = useState("")

  const existing = opportunityAddenda(opportunity)
  const nextNumber = existing.length + 1

  useEffect(() => {
    if (!open) return
    setNote("")
    setNewDate(opportunity.expectedCloseDate ?? "")
    setNewValue(opportunity.value ? String(opportunity.value) : "")
  }, [open, opportunity])

  const handleSave = async () => {
    if (!firestore || isSaving) return
    if (!note.trim()) {
      toast({ title: t("crm_addendum_note_required"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const parsedValue = parseFloat(newValue)
      const value = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : opportunity.value

      await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opportunity.id), {
        addenda: [
          ...existing,
          {
            number: nextNumber,
            at: new Date().toISOString(),
            note: note.trim(),
            newDate: newDate || null,
            newValue: value,
          },
        ],
        // The addendum IS the change — applying it to the live fields is the
        // whole point, not a side effect.
        expectedCloseDate: newDate || opportunity.expectedCloseDate || null,
        value,
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("crm_addendum_logged") })
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
      id: "addendum",
      title: t("crm_addendum_btn"),
      validate: () => {
        return note.trim() ? null : t("crm_addendum_note_required")
      },
      content: (
        <>
            <div className="space-y-1.5">
              <Label htmlFor="add-note">{t("crm_addendum_note")} <RequiredMark /></Label>
              <Input
                id="add-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("crm_addendum_note_placeholder")}
                disabled={isSaving}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="add-date">{t("crm_addendum_new_date")}</Label>
                <input
                  id="add-date"
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  dir="ltr"
                  disabled={isSaving}
                  className={DATE_INPUT_CLASS}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-value">{t("crm_addendum_new_value")}</Label>
                <Input
                  id="add-value"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  dir="ltr"
                  disabled={isSaving}
                />
              </div>
            </div>
            <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {t("crm_addendum_effect")}
            </p>
        </>
      ),
    },
  ]

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={FileStack}
      title={t("crm_addendum_title", { number: nextNumber })}
      description={t("crm_addendum_desc")}
      steps={steps}
      isSaving={isSaving}
      submitLabel={t("crm_addendum_btn")}
      onSubmit={() => void handleSave()}
      size="md"
    />
  )
}
