"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Link, useRouter } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { CrmContactDialog } from "@/components/contractor/CrmContactDialog"
import {
  Contact, ArrowRight, Pencil, Trash2, Loader2, Mail, Phone, Building2, User,
  Plus, Target, FileText, Tag,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  TYPE_BADGE_CLASS,
  STATUS_BADGE_CLASS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_BADGE_CLASS,
  QUOTATION_STATUSES,
  QUOTATION_STATUS_BADGE_CLASS,
  generateQuotationNumber,
  type CrmContact,
  type CrmOpportunity,
  type OpportunityStage,
  type CrmQuotation,
  type QuotationStatus,
} from "@/lib/crm"

function OpportunityDialog({
  open,
  onOpenChange,
  contactId,
  orgId,
  opportunity,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactId: string
  orgId: string
  opportunity?: CrmOpportunity
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [title, setTitle] = useState(opportunity?.title ?? "")
  const [stage, setStage] = useState<OpportunityStage>(opportunity?.stage ?? "new")
  const [value, setValue] = useState(opportunity?.value?.toString() ?? "")
  const [expectedCloseDate, setExpectedCloseDate] = useState(opportunity?.expectedCloseDate ?? "")
  const [notes, setNotes] = useState(opportunity?.notes ?? "")

  const handleSave = async () => {
    if (!firestore) return
    if (!title.trim()) {
      toast({ title: t("crm_opp_validation_error"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const data = {
        title: title.trim(),
        stage,
        value: Math.max(0, parseFloat(value) || 0),
        expectedCloseDate: expectedCloseDate || null,
        notes: notes.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      if (opportunity) {
        await updateDoc(doc(firestore, "crmContacts", contactId, "opportunities", opportunity.id), data)
      } else {
        await addDoc(collection(firestore, "crmContacts", contactId, "opportunities"), { ...data, createdAt: serverTimestamp() })
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
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{opportunity ? t("crm_opp_edit_title") : t("crm_opp_add_title")}</DialogTitle>
          <DialogDescription>{t("crm_opp_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="opp-title">{t("crm_opp_title")} *</Label>
            <Input id="opp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("crm_opp_title_placeholder")} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("crm_opp_stage")}</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as OpportunityStage)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OPPORTUNITY_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`crm_opp_stage_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-value">{t("crm_opp_value")}</Label>
              <Input id="opp-value" type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opp-date">{t("crm_opp_close_date")}</Label>
            <input id="opp-date" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} dir="ltr"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opp-notes">{t("crm_notes")}</Label>
            <Textarea id="opp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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

function QuotationDialog({
  open,
  onOpenChange,
  contactId,
  orgId,
  quotation,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactId: string
  orgId: string
  quotation?: CrmQuotation
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [amount, setAmount] = useState(quotation?.amount?.toString() ?? "")
  const [status, setStatus] = useState<QuotationStatus>(quotation?.status ?? "draft")
  const [date, setDate] = useState(quotation?.date ?? new Date().toISOString().split("T")[0])
  const [notes, setNotes] = useState(quotation?.notes ?? "")

  const handleSave = async () => {
    if (!firestore) return
    setIsSaving(true)
    try {
      const data = {
        amount: Math.max(0, parseFloat(amount) || 0),
        status,
        date: date || null,
        notes: notes.trim() || null,
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      if (quotation) {
        await updateDoc(doc(firestore, "crmContacts", contactId, "quotations", quotation.id), data)
      } else {
        await addDoc(collection(firestore, "crmContacts", contactId, "quotations"), {
          ...data,
          quotationNumber: generateQuotationNumber(),
          createdAt: serverTimestamp(),
        })
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

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) onOpenChange(next) }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{quotation ? t("crm_quote_edit_title") : t("crm_quote_add_title")}</DialogTitle>
          <DialogDescription>{t("crm_quote_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="quote-amount">{t("crm_quote_amount")} *</Label>
              <Input id="quote-amount" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("crm_quote_status")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as QuotationStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
            <input id="quote-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quote-notes">{t("crm_notes")}</Label>
            <Textarea id="quote-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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

export default function CrmContactDetailPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const params = useParams()
  const contactId = params.id as string
  const router = useRouter()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManageCrm = can("crm.manage")

  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showAddOpp, setShowAddOpp] = useState(false)
  const [editOpp, setEditOpp] = useState<CrmOpportunity | null>(null)
  const [deleteOpp, setDeleteOpp] = useState<CrmOpportunity | null>(null)
  const [showAddQuote, setShowAddQuote] = useState(false)
  const [editQuote, setEditQuote] = useState<CrmQuotation | null>(null)
  const [deleteQuote, setDeleteQuote] = useState<CrmQuotation | null>(null)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

  const contactRef = useMemoFirebase(() => {
    if (!firestore || !contactId) return null
    return doc(firestore, "crmContacts", contactId)
  }, [firestore, contactId])
  const { data: contactData, isLoading } = useDoc(contactRef)
  const contact = contactData ? ({ id: contactId, ...contactData } as CrmContact) : null

  const teamQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "users"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: teamData } = useCollection(teamQuery)
  const teamMembers = ((teamData || []) as { id: string; name?: string; email?: string }[])
    .map((m) => ({ id: m.id, name: m.name || m.email || m.id }))

  const oppsQuery = useMemoFirebase(() => {
    if (!firestore || !contactId) return null
    return collection(firestore, "crmContacts", contactId, "opportunities")
  }, [firestore, contactId])
  const { data: oppsData } = useCollection(oppsQuery)
  const opportunities = ((oppsData || []) as CrmOpportunity[])

  const quotesQuery = useMemoFirebase(() => {
    if (!firestore || !contactId) return null
    return collection(firestore, "crmContacts", contactId, "quotations")
  }, [firestore, contactId])
  const { data: quotesData } = useCollection(quotesQuery)
  const quotations = ((quotesData || []) as CrmQuotation[])

  const handleDeleteContact = async () => {
    if (!firestore || !contact) return
    setIsDeleting(true)
    try {
      await deleteDoc(doc(firestore, "crmContacts", contact.id))
      toast({ title: t("crm_deleted") })
      router.push("/contractor/crm")
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
      setIsDeleting(false)
    }
  }

  const handleDeleteOpp = async () => {
    if (!firestore || !deleteOpp) return
    try {
      await deleteDoc(doc(firestore, "crmContacts", contactId, "opportunities", deleteOpp.id))
      toast({ title: t("crm_opp_deleted") })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setDeleteOpp(null)
    }
  }

  const handleDeleteQuote = async () => {
    if (!firestore || !deleteQuote) return
    try {
      await deleteDoc(doc(firestore, "crmContacts", contactId, "quotations", deleteQuote.id))
      toast({ title: t("crm_quote_deleted") })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setDeleteQuote(null)
    }
  }

  if (isLoading || !contact) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 size={32} className="animate-spin text-muted-foreground" />
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div className="flex items-center gap-3">
          <Link href="/contractor/crm" className="text-muted-foreground hover:text-primary transition-colors">
            <ArrowRight size={18} className={cn(isRtl ? "" : "rotate-180")} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Contact size={20} className="text-primary shrink-0" />
              <h1 className="text-xl font-black text-primary truncate">{contact.name}</h1>
              <Badge className={cn("text-[10px]", TYPE_BADGE_CLASS[contact.type])}>{t(`crm_type_${contact.type}`)}</Badge>
              <Badge variant="outline" className={cn("text-[10px]", STATUS_BADGE_CLASS[contact.status || "new"])}>
                {t(`crm_status_${contact.status || "new"}`)}
              </Badge>
            </div>
            {contact.company && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Building2 size={11} />
                {contact.company}
              </p>
            )}
          </div>
          {canManageCrm && (
            <div className="flex items-center gap-1 shrink-0">
              <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-primary" onClick={() => setShowEdit(true)} aria-label={t("crm_edit_title")}>
                <Pencil size={16} />
              </Button>
              <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setShowDelete(true)} aria-label={t("crm_delete_btn")}>
                <Trash2 size={16} />
              </Button>
            </div>
          )}
        </div>

        {/* Contact info */}
        <div className="rounded-xl border p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {contact.phone && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Phone size={15} className="text-accent shrink-0" />
              <span>
                <span className="font-semibold text-slate-500 text-xs block">{t("crm_phone")}</span>
                <span dir="ltr">{contact.phone}</span>
              </span>
            </div>
          )}
          {contact.email && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Mail size={15} className="text-accent shrink-0" />
              <span>
                <span className="font-semibold text-slate-500 text-xs block">{t("crm_email")}</span>
                <span dir="ltr">{contact.email}</span>
              </span>
            </div>
          )}
          {contact.ownerName && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <User size={15} className="text-primary shrink-0" />
              <span>
                <span className="font-semibold text-slate-500 text-xs block">{t("crm_owner")}</span>
                {contact.ownerName}
              </span>
            </div>
          )}
          {contact.source && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Tag size={15} className="text-primary shrink-0" />
              <span>
                <span className="font-semibold text-slate-500 text-xs block">{t("crm_source")}</span>
                {t(`crm_source_${contact.source}`)}
              </span>
            </div>
          )}
          {contact.entityType && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Building2 size={15} className="text-primary shrink-0" />
              <span>
                <span className="font-semibold text-slate-500 text-xs block">{t("crm_entity_type")}</span>
                {t(`crm_entity_${contact.entityType}`)}
              </span>
            </div>
          )}
          {contact.notes && (
            <div className="sm:col-span-2 text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
              {contact.notes}
            </div>
          )}
        </div>

        {/* Opportunities */}
        <div className="rounded-xl border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/30">
            <h2 className="text-sm font-black text-foreground flex items-center gap-2">
              <Target size={15} className="text-primary" />
              {t("crm_opp_section_title")}
              {opportunities.length > 0 && (
                <Badge variant="secondary" className="bg-primary/10 text-primary font-bold border-none">{opportunities.length}</Badge>
              )}
            </h2>
            {canManageCrm && (
              <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setShowAddOpp(true)}>
                <Plus size={13} />
                {t("crm_opp_add_btn")}
              </Button>
            )}
          </div>
          {opportunities.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{t("crm_opp_empty")}</div>
          ) : (
            <div className="divide-y">
              {opportunities.map((opp) => (
                <div key={opp.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm text-foreground truncate">{opp.title}</p>
                      <Badge className={cn("text-[10px]", OPPORTUNITY_STAGE_BADGE_CLASS[opp.stage])}>{t(`crm_opp_stage_${opp.stage}`)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">
                      {opp.value.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")} {locale === "ar" ? "ر.س" : "SAR"}
                      {opp.expectedCloseDate && <span className="mx-1.5">·</span>}
                      {opp.expectedCloseDate}
                    </p>
                  </div>
                  {canManageCrm && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => setEditOpp(opp)} aria-label={t("crm_opp_edit_title")}>
                        <Pencil size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteOpp(opp)} aria-label={t("crm_opp_delete_confirm_title")}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quotations */}
        <div className="rounded-xl border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/30">
            <h2 className="text-sm font-black text-foreground flex items-center gap-2">
              <FileText size={15} className="text-primary" />
              {t("crm_quote_section_title")}
              {quotations.length > 0 && (
                <Badge variant="secondary" className="bg-primary/10 text-primary font-bold border-none">{quotations.length}</Badge>
              )}
            </h2>
            {canManageCrm && (
              <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setShowAddQuote(true)}>
                <Plus size={13} />
                {t("crm_quote_add_btn")}
              </Button>
            )}
          </div>
          {quotations.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{t("crm_quote_empty")}</div>
          ) : (
            <div className="divide-y">
              {quotations.map((q) => (
                <div key={q.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{q.quotationNumber}</span>
                      <Badge className={cn("text-[10px]", QUOTATION_STATUS_BADGE_CLASS[q.status])}>{t(`crm_quote_status_${q.status}`)}</Badge>
                    </div>
                    <p className="text-sm font-bold text-foreground mt-0.5" dir="ltr">
                      {q.amount.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")} {locale === "ar" ? "ر.س" : "SAR"}
                      {q.date && <span className="mx-1.5 text-xs text-muted-foreground font-normal">· {q.date}</span>}
                    </p>
                  </div>
                  {canManageCrm && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => setEditQuote(q)} aria-label={t("crm_quote_edit_title")}>
                        <Pencil size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteQuote(q)} aria-label={t("crm_quote_delete_confirm_title")}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showEdit && (
        <CrmContactDialog
          open={showEdit}
          onOpenChange={setShowEdit}
          contact={contact}
          orgId={myOrgId}
          teamMembers={teamMembers}
          t={t}
          locale={locale}
        />
      )}

      <OpportunityDialog open={showAddOpp} onOpenChange={setShowAddOpp} contactId={contactId} orgId={myOrgId} t={t} locale={locale} />
      {editOpp && (
        <OpportunityDialog
          open={!!editOpp}
          onOpenChange={(open) => { if (!open) setEditOpp(null) }}
          contactId={contactId}
          orgId={myOrgId}
          opportunity={editOpp}
          t={t}
          locale={locale}
        />
      )}

      <QuotationDialog open={showAddQuote} onOpenChange={setShowAddQuote} contactId={contactId} orgId={myOrgId} t={t} locale={locale} />
      {editQuote && (
        <QuotationDialog
          open={!!editQuote}
          onOpenChange={(open) => { if (!open) setEditQuote(null) }}
          contactId={contactId}
          orgId={myOrgId}
          quotation={editQuote}
          t={t}
          locale={locale}
        />
      )}

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("crm_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("crm_delete_confirm_desc", { name: contact.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("wh_cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContact} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90 gap-2">
              {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {t("crm_delete_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteOpp} onOpenChange={(open) => { if (!open) setDeleteOpp(null) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("crm_opp_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("crm_opp_delete_confirm_desc", { name: deleteOpp?.title ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("wh_cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteOpp} className="bg-destructive hover:bg-destructive/90 gap-2">
              <Trash2 size={14} />
              {t("crm_delete_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteQuote} onOpenChange={(open) => { if (!open) setDeleteQuote(null) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("crm_quote_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("crm_quote_delete_confirm_desc", { number: deleteQuote?.quotationNumber ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("wh_cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteQuote} className="bg-destructive hover:bg-destructive/90 gap-2">
              <Trash2 size={14} />
              {t("crm_delete_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  )
}
