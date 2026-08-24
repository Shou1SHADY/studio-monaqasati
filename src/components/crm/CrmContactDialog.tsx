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
import { PhoneInput } from "@/components/shared/PhoneInput"
import { Loader2 } from "lucide-react"
import type { TeamMember } from "@/hooks/useCrmData"
import { renameContactReferences } from "@/lib/crm-writes"
import {
  CONTACT_TYPES,
  CRM_CONTACTS,
  ENTITY_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  type ContactType,
  type CrmContact,
  type EntityType,
  type LeadSource,
  type LeadStatus,
} from "@/lib/crm"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function CrmContactDialog({
  open,
  onOpenChange,
  contact,
  orgId,
  teamMembers,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact?: CrmContact
  orgId: string
  teamMembers: TeamMember[]
  onSaved?: (contactId: string) => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<ContactType>("client")
  const [entityType, setEntityType] = useState<EntityType>("company")
  const [company, setCompany] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<LeadStatus>("new")
  const [source, setSource] = useState<LeadSource>("other")
  const [ownerId, setOwnerId] = useState("")
  const [notes, setNotes] = useState("")
  const [emailError, setEmailError] = useState(false)

  // Re-seed from `contact` every time the dialog opens. Without this the
  // "add" dialog — which stays mounted between openings — would still be
  // holding the values typed into it last time.
  useEffect(() => {
    if (!open) return
    setName(contact?.name ?? "")
    setType(contact?.type ?? "client")
    setEntityType(contact?.entityType ?? "company")
    setCompany(contact?.company ?? "")
    setPhone(contact?.phone ?? "")
    setEmail(contact?.email ?? "")
    setStatus(contact?.status ?? "new")
    setSource(contact?.source ?? "other")
    setOwnerId(contact?.ownerId ?? "")
    setNotes(contact?.notes ?? "")
    setEmailError(false)
  }, [open, contact])

  const handleSave = async () => {
    if (!firestore || isSaving) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast({ title: t("crm_validation_error"), variant: "destructive" })
      return
    }
    const trimmedEmail = email.trim()
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setEmailError(true)
      return
    }

    setIsSaving(true)
    try {
      const owner = teamMembers.find((m) => m.id === ownerId)
      const data = {
        name: trimmedName,
        type,
        entityType,
        company: company.trim() || null,
        phone: phone || null,
        email: trimmedEmail || null,
        status,
        source,
        ownerId: owner?.id || null,
        ownerName: owner?.name || null,
        notes: notes.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }

      if (contact) {
        await updateDoc(doc(firestore, CRM_CONTACTS, contact.id), data)
        // `contactName` is denormalised onto opportunities and quotations so
        // the org-wide lists render in one query — a rename has to reach them.
        if (contact.name !== trimmedName) {
          await renameContactReferences(firestore, contact.id, orgId, trimmedName)
        }
        toast({ title: t("crm_updated") })
        onSaved?.(contact.id)
      } else {
        const created = await addDoc(collection(firestore, CRM_CONTACTS), { ...data, createdAt: serverTimestamp() })
        toast({ title: t("crm_created") })
        onSaved?.(created.id)
      }
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
          <DialogTitle>{contact ? t("crm_edit_title") : t("crm_add_title")}</DialogTitle>
          <DialogDescription>{t("crm_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 py-2"
          onSubmit={(e) => { e.preventDefault(); void handleSave() }}
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="crm-name">{t("crm_name")} *</Label>
              <Input id="crm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("crm_name_placeholder")} disabled={isSaving} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-type">{t("crm_type")} *</Label>
              <Select value={type} onValueChange={(v) => setType(v as ContactType)} disabled={isSaving}>
                <SelectTrigger id="crm-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>{t(`crm_type_${ct}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-entity">{t("crm_entity_type")} *</Label>
              <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)} disabled={isSaving}>
                <SelectTrigger id="crm-entity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((et) => (
                    <SelectItem key={et} value={et}>{t(`crm_entity_${et}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="crm-company">{t("crm_company")}</Label>
              <Input id="crm-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t("crm_company_placeholder")} disabled={isSaving} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-phone">{t("crm_phone")}</Label>
            <PhoneInput id="crm-phone" value={phone} onChange={setPhone} disabled={isSaving} locale={locale} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-email">{t("crm_email")}</Label>
            <Input
              id="crm-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(false) }}
              onBlur={(e) => setEmailError(!!e.target.value.trim() && !EMAIL_RE.test(e.target.value.trim()))}
              placeholder={t("crm_email_placeholder")}
              dir="ltr"
              disabled={isSaving}
              aria-invalid={emailError}
              aria-describedby={emailError ? "crm-email-error" : undefined}
            />
            {emailError && (
              <p id="crm-email-error" className="text-xs text-destructive">{t("crm_email_invalid")}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="crm-status">{t("crm_status")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus)} disabled={isSaving}>
                <SelectTrigger id="crm-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_status_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-source">{t("crm_source")}</Label>
              <Select value={source} onValueChange={(v) => setSource(v as LeadSource)} disabled={isSaving}>
                <SelectTrigger id="crm-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_source_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="crm-owner">{t("crm_owner")}</Label>
              <Select value={ownerId || "__none__"} onValueChange={(v) => setOwnerId(v === "__none__" ? "" : v)} disabled={isSaving}>
                <SelectTrigger id="crm-owner"><SelectValue placeholder={t("crm_owner_placeholder")} /></SelectTrigger>
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
            <Label htmlFor="crm-notes">{t("crm_notes")}</Label>
            <Textarea id="crm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("crm_notes_placeholder")} disabled={isSaving} />
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
