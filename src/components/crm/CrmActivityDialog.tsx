"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import type { TeamMember } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  ACTIVITY_TYPES,
  CRM_ACTIVITIES,
  type ActivityType,
  type CrmActivity,
  type CrmContact,
  type CrmOpportunity,
} from "@/lib/crm"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"

/**
 * Log a call, meeting, site visit, task or email.
 *
 * An activity always names a contact — a record of contact with nobody is not
 * a record of anything — and optionally a deal. When it is opened from a deal
 * both are fixed, so the form collapses to what actually needs typing.
 */
export function CrmActivityDialog({
  open,
  onOpenChange,
  orgId,
  activity,
  contacts,
  opportunities,
  teamMembers,
  fixedContactId,
  fixedOpportunityId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  activity?: CrmActivity
  contacts: CrmContact[]
  opportunities: CrmOpportunity[]
  teamMembers: TeamMember[]
  fixedContactId?: string
  fixedOpportunityId?: string
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const [isSaving, setIsSaving] = useState(false)
  const [type, setType] = useState<ActivityType>("call")
  const [title, setTitle] = useState("")
  const [contactId, setContactId] = useState("")
  const [opportunityId, setOpportunityId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [ownerId, setOwnerId] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (!open) return
    setType(activity?.type ?? "call")
    setTitle(activity?.title ?? "")
    setContactId(activity?.contactId ?? fixedContactId ?? "")
    setOpportunityId(activity?.opportunityId ?? fixedOpportunityId ?? "")
    setDueDate(activity?.dueDate ?? "")
    setOwnerId(activity?.ownerId ?? user?.uid ?? "")
    setNotes(activity?.notes ?? "")
  }, [open, activity, fixedContactId, fixedOpportunityId, user?.uid])

  // Only deals belonging to the chosen contact can be linked — offering the
  // whole org's pipeline here would let a call be filed against a stranger.
  const linkableOpportunities = opportunities.filter((o) => o.contactId === contactId)

  const handleSave = async () => {
    if (!firestore || isSaving) return
    if (!title.trim()) {
      toast({ title: t("crm_activity_validation_error"), variant: "destructive" })
      return
    }
    if (!contactId) {
      toast({ title: t("crm_opp_contact_required"), variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const contact = contacts.find((c) => c.id === contactId)
      const opp = opportunities.find((o) => o.id === opportunityId)
      const owner = teamMembers.find((m) => m.id === ownerId)
      const data = {
        type,
        title: title.trim(),
        contactId,
        contactName: contact?.name ?? activity?.contactName ?? null,
        opportunityId: opportunityId || null,
        opportunityTitle: opp?.title ?? (opportunityId ? activity?.opportunityTitle ?? null : null),
        dueDate: dueDate || null,
        ownerId: owner?.id || ownerId || null,
        ownerName: owner?.name || null,
        notes: notes.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      if (activity) {
        await updateDoc(doc(firestore, CRM_ACTIVITIES, activity.id), data)
      } else {
        await addDoc(collection(firestore, CRM_ACTIVITIES), { ...data, done: false, createdAt: serverTimestamp() })
      }
      toast({ title: t("crm_activity_saved") })
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
          <DialogTitle>{activity ? t("crm_activity_edit_title") : t("crm_activity_add_title")}</DialogTitle>
          <DialogDescription>{t("crm_activity_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4 py-2" onSubmit={(e) => { e.preventDefault(); void handleSave() }}>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium mb-1.5">{t("crm_activity_type")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {ACTIVITY_TYPES.map((at) => (
                <button
                  key={at}
                  type="button"
                  onClick={() => setType(at)}
                  aria-pressed={type === at}
                  disabled={isSaving}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    type === at ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                  )}
                >
                  {t(`crm_activity_type_${at}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="act-title">{t("crm_activity_title")} *</Label>
            <Input
              id="act-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("crm_activity_title_placeholder")}
              disabled={isSaving}
              autoFocus
            />
          </div>

          {!fixedContactId && (
            <div className="space-y-1.5">
              <Label htmlFor="act-contact">{t("crm_opp_contact")} *</Label>
              <Select
                value={contactId}
                onValueChange={(v) => { setContactId(v); setOpportunityId("") }}
                disabled={isSaving}
              >
                <SelectTrigger id="act-contact"><SelectValue placeholder={t("crm_opp_contact_placeholder")} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!fixedOpportunityId && contactId && linkableOpportunities.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="act-opp">{t("crm_activity_opportunity")}</Label>
              <Select
                value={opportunityId || "__none__"}
                onValueChange={(v) => setOpportunityId(v === "__none__" ? "" : v)}
                disabled={isSaving}
              >
                <SelectTrigger id="act-opp"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__none__">{t("crm_activity_no_opportunity")}</SelectItem>
                  {linkableOpportunities.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="act-due">{t("crm_activity_due")}</Label>
              <input
                id="act-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                dir="ltr"
                disabled={isSaving}
                className={DATE_INPUT_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-owner">{t("crm_owner")}</Label>
              <Select value={ownerId || "__none__"} onValueChange={(v) => setOwnerId(v === "__none__" ? "" : v)} disabled={isSaving}>
                <SelectTrigger id="act-owner"><SelectValue placeholder={t("crm_owner_placeholder")} /></SelectTrigger>
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
            <Label htmlFor="act-notes">{t("crm_notes")}</Label>
            <Textarea id="act-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isSaving} />
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
