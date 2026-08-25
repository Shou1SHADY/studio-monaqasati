"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { collection, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"
import type { TeamMember } from "@/hooks/useCrmData"
import {
  CRM_OPPORTUNITIES,
  OPPORTUNITY_STAGES,
  type CrmContact,
  type CrmOpportunity,
  type OpportunityStage,
} from "@/lib/crm"

export const DATE_INPUT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50"

export function CrmOpportunityDialog({
  open,
  onOpenChange,
  orgId,
  opportunity,
  contacts,
  teamMembers,
  /** Pre-selected (and locked) when opened from a contact's own page. */
  fixedContactId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  opportunity?: CrmOpportunity
  contacts: CrmContact[]
  teamMembers: TeamMember[]
  fixedContactId?: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [contactId, setContactId] = useState("")
  const [title, setTitle] = useState("")
  const [stage, setStage] = useState<OpportunityStage>("new")
  const [value, setValue] = useState("")
  const [expectedCloseDate, setExpectedCloseDate] = useState("")
  const [ownerId, setOwnerId] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (!open) return
    setContactId(opportunity?.contactId ?? fixedContactId ?? "")
    setTitle(opportunity?.title ?? "")
    setStage(opportunity?.stage ?? "new")
    setValue(opportunity?.value != null ? String(opportunity.value) : "")
    setExpectedCloseDate(opportunity?.expectedCloseDate ?? "")
    setOwnerId(opportunity?.ownerId ?? "")
    setNotes(opportunity?.notes ?? "")
  }, [open, opportunity, fixedContactId])

  const handleSave = async () => {
    if (!firestore || isSaving) return
    if (!title.trim()) {
      toast({ title: t("crm_opp_validation_error"), variant: "destructive" })
      return
    }
    if (!contactId) {
      toast({ title: t("crm_opp_contact_required"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const contact = contacts.find((c) => c.id === contactId)
      const owner = teamMembers.find((m) => m.id === ownerId)
      const parsedValue = parseFloat(value)
      const data = {
        contactId,
        contactName: contact?.name ?? opportunity?.contactName ?? null,
        title: title.trim(),
        stage,
        value: Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0,
        expectedCloseDate: expectedCloseDate || null,
        ownerId: owner?.id || null,
        ownerName: owner?.name || null,
        notes: notes.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      if (opportunity) {
        await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opportunity.id), data)
      } else {
        await addDoc(collection(firestore, CRM_OPPORTUNITIES), { ...data, createdAt: serverTimestamp() })
      }
      toast({ title: t("crm_opp_saved") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) onOpenChange(next) }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{opportunity ? t("crm_opp_edit_title") : t("crm_opp_add_title")}</DialogTitle>
          <DialogDescription>{t("crm_opp_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4 py-2" onSubmit={(e) => { e.preventDefault(); void handleSave() }}>
          {!fixedContactId && (
            <div className="space-y-1.5">
              <Label htmlFor="opp-contact">{t("crm_opp_contact")} *</Label>
              <Select value={contactId} onValueChange={setContactId} disabled={isSaving}>
                <SelectTrigger id="opp-contact"><SelectValue placeholder={t("crm_opp_contact_placeholder")} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.company ? ` — ${c.company}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="opp-title">{t("crm_opp_title")} *</Label>
            <Input id="opp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("crm_opp_title_placeholder")} disabled={isSaving} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="opp-stage">{t("crm_opp_stage")}</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as OpportunityStage)} disabled={isSaving}>
                <SelectTrigger id="opp-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OPPORTUNITY_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_opp_stage_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-value">{t("crm_opp_value")}</Label>
              <Input id="opp-value" type="number" min="0" step="any" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" disabled={isSaving} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="opp-date">{t("crm_opp_close_date")}</Label>
              <input id="opp-date" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} dir="ltr" disabled={isSaving} className={DATE_INPUT_CLASS} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-owner">{t("crm_owner")}</Label>
              <Select value={ownerId || "__none__"} onValueChange={(v) => setOwnerId(v === "__none__" ? "" : v)} disabled={isSaving}>
                <SelectTrigger id="opp-owner"><SelectValue placeholder={t("crm_owner_placeholder")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("crm_owner_none")}</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opp-notes">{t("crm_notes")}</Label>
            <Textarea id="opp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isSaving} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>{t("crm_cancel")}</Button>
            <Button type="submit" disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("crm_save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
