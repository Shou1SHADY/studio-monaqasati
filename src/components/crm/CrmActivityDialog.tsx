"use client"
import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { CalendarClock, CheckSquare, ClipboardList, Mail, MapPin, Paperclip, Phone, Trash2, UserRound, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/module-ui/IconButton"
import { addOpportunityFiles, oppFileAllowed } from "@/lib/crm-opportunity-writes"
import { guessFileKind } from "@/components/crm/OppFilesPanel"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore, useStorage, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import type { TeamMember } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  ACTIVITY_TYPES,
  CRM_ACTIVITIES,
  type ActivityType,
  type CrmActivity,
  type CrmContact,
  type CrmOpportunity,
  type OpportunityFileKind,
} from "@/lib/crm"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"
const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  call: Phone,
  meeting: CalendarClock,
  site_visit: MapPin,
  task: CheckSquare,
  email: Mail,
}
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
  const firestore = useFirestore()
  const storage = useStorage()
  const { user } = useUser()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [type, setType] = useState<ActivityType>("call")
  const [title, setTitle] = useState("")
  const [contactId, setContactId] = useState("")
  const [opportunityId, setOpportunityId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const [attachments, setAttachments] = useState<Array<{ file: File; kind: OpportunityFileKind }>>([])
  const fileInput = useRef<HTMLInputElement>(null)
  // No owner field (OPP-10 #4): an activity is recorded in the name of whoever adds it.
  const me = teamMembers.find((m) => m.id === user?.uid)
  const myName = me?.name || user?.displayName || user?.email || ""
  useEffect(() => {
    if (!open) return
    setType(activity?.type ?? "call")
    setTitle(activity?.title ?? "")
    setContactId(activity?.contactId ?? fixedContactId ?? "")
    setOpportunityId(activity?.opportunityId ?? fixedOpportunityId ?? "")
    setDueDate(activity?.dueDate ?? "")
    setNotes(activity?.notes ?? "")
    setAttachments([])
  }, [open, activity, fixedContactId, fixedOpportunityId])

  const pickFiles = (list: FileList | null) => {
    if (!list) return
    const next: Array<{ file: File; kind: OpportunityFileKind }> = []
    for (const file of Array.from(list)) {
      const check = oppFileAllowed(file)
      if (check !== "ok") {
        toast({ variant: "destructive", title: t(`crm_file_err_${check}`, { name: file.name }) })
        continue
      }
      next.push({ file, kind: guessFileKind(file) })
    }
    setAttachments((p) => [...p, ...next])
    if (fileInput.current) fileInput.current.value = ""
  }
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
      const data = {
        type,
        title: title.trim(),
        contactId,
        contactName: contact?.name ?? activity?.contactName ?? null,
        opportunityId: opportunityId || null,
        opportunityTitle: opp?.title ?? (opportunityId ? activity?.opportunityTitle ?? null : null),
        dueDate: dueDate || null,
        // The person who adds it; an edit keeps whoever added it.
        ownerId: activity?.ownerId ?? user?.uid ?? null,
        ownerName: activity?.ownerName ?? (myName || null),
        notes: notes.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      let activityId = activity?.id ?? ""
      if (activity) {
        await updateDoc(doc(firestore, CRM_ACTIVITIES, activity.id), data)
      } else {
        activityId = (await addDoc(collection(firestore, CRM_ACTIVITIES), { ...data, done: false, createdAt: serverTimestamp() })).id
      }
      // The visit report, the site photo, the client's letter: kept on the deal, linked to this activity.
      if (attachments.length && opp && user) {
        await addOpportunityFiles(firestore, storage, opp, { uid: user.uid, name: myName }, attachments, "activity", { id: activityId, title: title.trim() }).catch((err) => {
          console.error(err)
          toast({ variant: "destructive", title: t("crm_files_failed") })
        })
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
  const steps: CrmFormStep[] = [
    {
      id: "activity",
      title: t("crm_activity_add_title"),
      validate: () => {
        if (!title.trim()) return t("crm_activity_validation_error")
        if (!contactId) return t("crm_opp_contact_required")
        return null
      },
      content: (
        <>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium mb-1.5">{t("crm_activity_type")}</legend>
              <div className="flex flex-wrap gap-1.5">
                {ACTIVITY_TYPES.map((at) => {
                  const TypeIcon = ACTIVITY_ICONS[at]
                  return (
                  <button
                    key={at}
                    type="button"
                    onClick={() => setType(at)}
                    aria-pressed={type === at}
                    disabled={isSaving}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      type === at ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <TypeIcon size={14} aria-hidden="true" />
                    {t(`crm_activity_type_${at}`)}
                  </button>
                  )
                })}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="act-title">{t("crm_activity_title")} <RequiredMark /></Label>
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
                <Label htmlFor="act-contact">{t("crm_opp_contact")} <RequiredMark /></Label>
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
            <div className="grid grid-cols-1 gap-4 sm:max-w-xs">
              <div className="space-y-1.5">
                <Label htmlFor="act-due">{t(type === "meeting" || type === "site_visit" ? "crm_activity_when" : "crm_activity_due")}</Label>
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-notes">{t("crm_notes")}</Label>
              <Textarea id="act-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isSaving} />
            </div>
            {opportunityId && (
              <div className="space-y-1.5">
                <Label>{t("crm_activity_attachments_label")}</Label>
                <div className="space-y-1.5 rounded-lg border border-dashed p-3">
                  {attachments.map((a, i) => (
                    <div key={`${a.file.name}-${i}`} className="flex items-center gap-2 text-sm">
                      <Paperclip size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                      <bdi dir="auto" className="min-w-0 flex-1 truncate">{a.file.name}</bdi>
                      <IconButton icon={Trash2} iconSize={13} label={t("crm_delete_btn")} onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))} />
                    </div>
                  ))}
                  <input ref={fileInput} type="file" multiple className="sr-only" aria-label={t("crm_files_attach")} onChange={(e) => pickFiles(e.target.files)} />
                  <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-cta" onClick={() => fileInput.current?.click()} disabled={isSaving}>
                    <Paperclip size={13} aria-hidden="true" />
                    {t("crm_files_attach")}
                  </Button>
                </div>
              </div>
            )}
            <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-[11px] text-muted-foreground">
              <UserRound size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t("crm_activity_recorded_as", { name: activity?.ownerName || myName || "—" })}
            </p>
        </>
      ),
    },
  ]
  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={ClipboardList}
      title={activity ? t("crm_activity_edit_title") : t("crm_activity_add_title")}
      description={t("crm_activity_dialog_desc")}
      steps={steps}
      isSaving={isSaving}
      submitLabel={t("crm_save")}
      onSubmit={() => void handleSave()}
      size="md"
    />
  )
}
