"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
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
import {
  CONTACT_TYPES,
  LEAD_STATUSES,
  LEAD_SOURCES,
  ENTITY_TYPES,
  type ContactType,
  type LeadStatus,
  type LeadSource,
  type EntityType,
  type CrmContact,
} from "@/lib/crm"

export function CrmContactDialog({
  open,
  onOpenChange,
  contact,
  orgId,
  teamMembers,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact?: CrmContact
  orgId: string
  teamMembers: Array<{ id: string; name: string }>
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState(contact?.name ?? "")
  const [type, setType] = useState<ContactType>(contact?.type ?? "client")
  const [entityType, setEntityType] = useState<EntityType>(contact?.entityType ?? "company")
  const [company, setCompany] = useState(contact?.company ?? "")
  const [phone, setPhone] = useState(contact?.phone ?? "")
  const [email, setEmail] = useState(contact?.email ?? "")
  const [status, setStatus] = useState<LeadStatus>(contact?.status ?? "new")
  const [source, setSource] = useState<LeadSource>(contact?.source ?? "other")
  const [ownerId, setOwnerId] = useState(contact?.ownerId ?? "")
  const [notes, setNotes] = useState(contact?.notes ?? "")

  const reset = () => {
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
  }

  const handleSave = async () => {
    if (!firestore) return
    if (!name.trim()) {
      toast({ title: t("crm_validation_error"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const owner = teamMembers.find((m) => m.id === ownerId)
      const data = {
        name: name.trim(),
        type,
        entityType,
        company: company.trim() || null,
        phone: phone || null,
        email: email.trim() || null,
        status,
        source,
        ownerId: owner?.id || null,
        ownerName: owner?.name || null,
        notes: notes.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      if (contact) {
        await updateDoc(doc(firestore, "crmContacts", contact.id), data)
        toast({ title: t("crm_updated") })
      } else {
        await addDoc(collection(firestore, "crmContacts"), { ...data, createdAt: serverTimestamp() })
        toast({ title: t("crm_created") })
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
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) { onOpenChange(next); if (!next) reset() } }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contact ? t("crm_edit_title") : t("crm_add_title")}</DialogTitle>
          <DialogDescription>{t("crm_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="crm-name">{t("crm_name")} *</Label>
              <Input id="crm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("crm_name_placeholder")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("crm_type")} *</Label>
              <Select value={type} onValueChange={(v) => setType(v as ContactType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>{t(`crm_type_${ct}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("crm_entity_type")} *</Label>
              <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((et) => (
                    <SelectItem key={et} value={et}>{t(`crm_entity_${et}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="crm-company">{t("crm_company")}</Label>
              <Input id="crm-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t("crm_company_placeholder")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-phone">{t("crm_phone")}</Label>
            <PhoneInput id="crm-phone" value={phone} onChange={setPhone} disabled={isSaving} locale={locale} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crm-email">{t("crm_email")}</Label>
            <Input id="crm-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("crm_email_placeholder")} dir="ltr" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("crm_status")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_status_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("crm_source")}</Label>
              <Select value={source} onValueChange={(v) => setSource(v as LeadSource)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_source_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>{t("crm_owner")}</Label>
              <Select value={ownerId || "__none__"} onValueChange={(v) => setOwnerId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder={t("crm_owner_placeholder")} /></SelectTrigger>
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
            <Textarea id="crm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("crm_notes_placeholder")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>{t("wh_cancel")}</Button>
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : null}
            {t("wh_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
