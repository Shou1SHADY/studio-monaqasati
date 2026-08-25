"use client"

import { useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { deleteDoc, doc } from "firebase/firestore"
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Coins,
  Contact,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Tag,
  Target,
  Trash2,
  User,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { deleteContactCascade } from "@/lib/crm-writes"
import { cn } from "@/lib/utils"
import {
  CRM_CONTACTS,
  CRM_OPPORTUNITIES,
  CRM_QUOTATIONS,
  OPPORTUNITY_STAGE_BADGE_CLASS,
  QUOTATION_STATUS_BADGE_CLASS,
  STATUS_BADGE_CLASS,
  TYPE_BADGE_CLASS,
  daysUntil,
  formatCrmDate,
  formatSar,
  summarizeOpportunities,
  type CrmContact,
  type CrmOpportunity,
  type CrmQuotation,
} from "@/lib/crm"
import { CrmContactDialog } from "@/components/crm/CrmContactDialog"
import { CrmOpportunityDialog } from "@/components/crm/CrmOpportunityDialog"
import { CrmQuotationDialog } from "@/components/crm/CrmQuotationDialog"
import { CrmEmptyState, crmBasePath, type CrmPortal } from "@/components/crm/CrmShell"

export function CrmLeadDetailView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const params = useParams()
  const contactId = String(params.id ?? "")
  const router = useRouter()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManageCrm = can("crm.manage")
  const base = crmBasePath(portal)

  const { orgId, opportunities, quotations, teamMembers, isLoading: isCrmLoading } = useCrmData({
    opportunities: true,
    quotations: true,
  })

  const contactRef = useMemoFirebase(() => {
    if (!firestore || !contactId) return null
    return doc(firestore, CRM_CONTACTS, contactId)
  }, [firestore, contactId])
  const { data: contactData, isLoading: contactLoading } = useDoc(contactRef)

  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showAddOpp, setShowAddOpp] = useState(false)
  const [editOpp, setEditOpp] = useState<CrmOpportunity | null>(null)
  const [deleteOpp, setDeleteOpp] = useState<CrmOpportunity | null>(null)
  const [showAddQuote, setShowAddQuote] = useState(false)
  const [editQuote, setEditQuote] = useState<CrmQuotation | null>(null)
  const [deleteQuote, setDeleteQuote] = useState<CrmQuotation | null>(null)

  const raw = contactData as (Omit<CrmContact, "id"> | null)
  // A contact from another organization must read as "not found", not as a
  // record to view: `crmContacts` is a shared collection and the doc id alone
  // is guessable. Firestore rules reject the read too — this is the UI half.
  const contact: CrmContact | null =
    raw && orgId && raw.organizationId === orgId ? ({ ...raw, id: contactId } as CrmContact) : null

  const contactOpportunities = useMemo(
    () => opportunities.filter((o) => o.contactId === contactId),
    [opportunities, contactId]
  )
  const contactQuotations = useMemo(
    () => quotations.filter((q) => q.contactId === contactId),
    [quotations, contactId]
  )
  const oppSummary = useMemo(() => summarizeOpportunities(contactOpportunities), [contactOpportunities])
  const quotedValue = useMemo(
    () => contactQuotations.reduce((sum, q) => sum + (q.amount || 0), 0),
    [contactQuotations]
  )

  const handleDeleteContact = async () => {
    if (!firestore || !contact) return
    setIsDeleting(true)
    try {
      await deleteContactCascade(firestore, contact.id, contact.organizationId)
      toast({ title: t("crm_deleted") })
      router.push(`${base}/leads`)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
      setIsDeleting(false)
    }
  }

  const handleDeleteOpp = async () => {
    if (!firestore || !deleteOpp) return
    try {
      await deleteDoc(doc(firestore, CRM_OPPORTUNITIES, deleteOpp.id))
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
      await deleteDoc(doc(firestore, CRM_QUOTATIONS, deleteQuote.id))
      toast({ title: t("crm_quote_deleted") })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setDeleteQuote(null)
    }
  }

  if (contactLoading || isCrmLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={32} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!contact) {
    return (
      <div dir={isRtl ? "rtl" : "ltr"}>
        <CrmEmptyState
          icon={Contact}
          title={t("crm_not_found_title")}
          description={t("crm_not_found_desc")}
          action={
            <Link href={`${base}/leads`}>
              <Button variant="outline">{t("crm_back_to_leads")}</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div className="flex items-center gap-3">
          <Link
            href={`${base}/leads`}
            aria-label={t("crm_back_to_leads")}
            className="text-muted-foreground hover:text-primary transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
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

        {/* This contact's pipeline at a glance — the reason to open the page. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MiniStat icon={Target} label={t("crm_opp_stat_open")} value={String(oppSummary.open)} />
          <MiniStat icon={Coins} label={t("crm_opp_stat_open_value")} value={formatSar(oppSummary.openValue, locale)} />
          <MiniStat icon={FileText} label={t("crm_quote_stat_total")} value={String(contactQuotations.length)} />
          <MiniStat icon={Coins} label={t("crm_quote_stat_value")} value={formatSar(quotedValue, locale)} />
        </div>

        <div className="rounded-xl border p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {contact.phone && (
            <InfoField icon={Phone} label={t("crm_phone")} accent="accent">
              <a href={`tel:${contact.phone}`} dir="ltr" className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                {contact.phone}
              </a>
            </InfoField>
          )}
          {contact.email && (
            <InfoField icon={Mail} label={t("crm_email")} accent="accent">
              <a href={`mailto:${contact.email}`} dir="ltr" className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded break-all">
                {contact.email}
              </a>
            </InfoField>
          )}
          <InfoField icon={User} label={t("crm_owner")}>
            {contact.ownerName || t("crm_owner_none")}
          </InfoField>
          {contact.source && (
            <InfoField icon={Tag} label={t("crm_source")}>{t(`crm_source_${contact.source}`)}</InfoField>
          )}
          {contact.entityType && (
            <InfoField icon={Building2} label={t("crm_entity_type")}>{t(`crm_entity_${contact.entityType}`)}</InfoField>
          )}
          {contact.notes && (
            <div className="sm:col-span-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3 whitespace-pre-wrap">
              {contact.notes}
            </div>
          )}
        </div>

        {/* Opportunities */}
        <section className="rounded-xl border overflow-hidden">
          <header className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/30">
            <h2 className="text-sm font-black text-foreground flex items-center gap-2">
              <Target size={15} className="text-primary" />
              {t("crm_opp_section_title")}
              {contactOpportunities.length > 0 && (
                <Badge variant="secondary" className="bg-primary/10 text-primary font-bold border-none">
                  {contactOpportunities.length}
                </Badge>
              )}
            </h2>
            {canManageCrm && (
              <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setShowAddOpp(true)}>
                <Plus size={13} />
                {t("crm_opp_add_btn")}
              </Button>
            )}
          </header>
          {contactOpportunities.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{t("crm_opp_empty")}</p>
          ) : (
            <ul className="divide-y">
              {contactOpportunities.map((opp) => {
                const days = daysUntil(opp.expectedCloseDate)
                const isOpen = opp.stage !== "won" && opp.stage !== "lost"
                return (
                  <li key={opp.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-foreground truncate">{opp.title}</p>
                        <Badge className={cn("text-[10px]", OPPORTUNITY_STAGE_BADGE_CLASS[opp.stage])}>
                          {t(`crm_opp_stage_${opp.stage}`)}
                        </Badge>
                        {opp.rfqId && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <FileText size={9} />
                            {t("crm_opp_linked_rfq")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold" dir="ltr">{formatSar(opp.value, locale)}</span>
                        {opp.expectedCloseDate && (
                          <span className={cn("flex items-center gap-1", isOpen && days !== null && days < 0 && "text-destructive font-semibold")}>
                            · <CalendarDays size={10} />
                            <span>{formatCrmDate(opp.expectedCloseDate, locale)}</span>
                            {isOpen && days !== null && days < 0 && <span>({t("crm_opp_overdue")})</span>}
                          </span>
                        )}
                      </p>
                    </div>
                    {canManageCrm && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                          onClick={() => setEditOpp(opp)} aria-label={`${t("crm_opp_edit_title")} — ${opp.title}`}>
                          <Pencil size={13} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteOpp(opp)} aria-label={`${t("crm_opp_delete_confirm_title")} — ${opp.title}`}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Quotations */}
        <section className="rounded-xl border overflow-hidden">
          <header className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/30">
            <h2 className="text-sm font-black text-foreground flex items-center gap-2">
              <FileText size={15} className="text-primary" />
              {t("crm_quote_section_title")}
              {contactQuotations.length > 0 && (
                <Badge variant="secondary" className="bg-primary/10 text-primary font-bold border-none">
                  {contactQuotations.length}
                </Badge>
              )}
            </h2>
            {canManageCrm && (
              <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setShowAddQuote(true)}>
                <Plus size={13} />
                {t("crm_quote_add_btn")}
              </Button>
            )}
          </header>
          {contactQuotations.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{t("crm_quote_empty")}</p>
          ) : (
            <ul className="divide-y">
              {contactQuotations.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{q.quotationNumber}</span>
                      <Badge className={cn("text-[10px]", QUOTATION_STATUS_BADGE_CLASS[q.status])}>
                        {t(`crm_quote_status_${q.status}`)}
                      </Badge>
                    </div>
                    <p className="text-sm font-bold text-foreground mt-0.5" dir="ltr">
                      {formatSar(q.amount, locale)}
                      {q.date && <span className="ms-1.5 text-xs text-muted-foreground font-normal">· {formatCrmDate(q.date, locale)}</span>}
                    </p>
                  </div>
                  {canManageCrm && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                        onClick={() => setEditQuote(q)} aria-label={`${t("crm_quote_edit_title")} — ${q.quotationNumber}`}>
                        <Pencil size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteQuote(q)} aria-label={`${t("crm_quote_delete_confirm_title")} — ${q.quotationNumber}`}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <CrmContactDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        contact={contact}
        orgId={orgId}
        teamMembers={teamMembers}
      />

      <CrmOpportunityDialog
        open={showAddOpp}
        onOpenChange={setShowAddOpp}
        orgId={orgId}
        contacts={[contact]}
        teamMembers={teamMembers}
        fixedContactId={contact.id}
      />
      <CrmOpportunityDialog
        key={editOpp?.id ?? "edit-opp"}
        open={!!editOpp}
        onOpenChange={(open) => { if (!open) setEditOpp(null) }}
        opportunity={editOpp ?? undefined}
        orgId={orgId}
        contacts={[contact]}
        teamMembers={teamMembers}
        fixedContactId={contact.id}
      />

      <CrmQuotationDialog
        open={showAddQuote}
        onOpenChange={setShowAddQuote}
        orgId={orgId}
        contactId={contact.id}
        contactName={contact.name}
      />
      <CrmQuotationDialog
        key={editQuote?.id ?? "edit-quote"}
        open={!!editQuote}
        onOpenChange={(open) => { if (!open) setEditQuote(null) }}
        quotation={editQuote ?? undefined}
        orgId={orgId}
        contactId={contact.id}
        contactName={contact.name}
      />

      <AlertDialog open={showDelete} onOpenChange={(open) => { if (!isDeleting) setShowDelete(open) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("crm_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("crm_delete_confirm_desc", { name: contact.name })} {t("crm_delete_cascade_note")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleDeleteContact() }}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90 gap-2"
            >
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
            <AlertDialogCancel>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void handleDeleteOpp() }} className="bg-destructive hover:bg-destructive/90 gap-2">
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
            <AlertDialogCancel>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void handleDeleteQuote() }} className="bg-destructive hover:bg-destructive/90 gap-2">
              <Trash2 size={14} />
              {t("crm_delete_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
        <Icon size={12} className="shrink-0" />
        <span className="truncate">{label}</span>
      </p>
      <p className="text-base font-black text-foreground mt-1 truncate" dir="ltr">{value}</p>
    </div>
  )
}

function InfoField({
  icon: Icon,
  label,
  accent = "primary",
  children,
}: {
  icon: React.ElementType
  label: string
  accent?: "primary" | "accent"
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 text-sm text-foreground">
      <Icon size={15} className={cn("shrink-0 mt-0.5", accent === "accent" ? "text-accent" : "text-primary")} />
      <div className="min-w-0">
        <span className="font-semibold text-muted-foreground text-xs block">{label}</span>
        {children}
      </div>
    </div>
  )
}
