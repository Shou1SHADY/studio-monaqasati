"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, deleteDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { CrmContactDialog } from "@/components/contractor/CrmContactDialog"
import { Contact, Plus, Pencil, Trash2, Loader2, Mail, Phone, Building2, User } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  CONTACT_TYPES,
  TYPE_BADGE_CLASS,
  STATUS_BADGE_CLASS,
  type ContactType,
  type CrmContact,
} from "@/lib/crm"

export default function ContractorCrmPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManageCrm = can("crm.manage")

  const [showAdd, setShowAdd] = useState(false)
  const [editContact, setEditContact] = useState<CrmContact | null>(null)
  const [deleteContact, setDeleteContact] = useState<CrmContact | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [activeType, setActiveType] = useState<ContactType | "all">("all")

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

  const contactsQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "crmContacts"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: contactsData, isLoading } = useCollection(contactsQuery)
  const list = ((contactsData || []) as CrmContact[]).slice().sort((a, b) => a.name.localeCompare(b.name, locale))
  const filtered = activeType === "all" ? list : list.filter((c) => c.type === activeType)

  const teamQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "users"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: teamData } = useCollection(teamQuery)
  const teamMembers = ((teamData || []) as { id: string; name?: string; email?: string }[])
    .map((m) => ({ id: m.id, name: m.name || m.email || m.id }))

  const counts = CONTACT_TYPES.reduce((acc, ct) => {
    acc[ct] = list.filter((c) => c.type === ct).length
    return acc
  }, {} as Record<ContactType, number>)

  const handleDelete = async () => {
    if (!firestore || !deleteContact) return
    setIsDeleting(true)
    try {
      await deleteDoc(doc(firestore, "crmContacts", deleteContact.id))
      toast({ title: t("crm_deleted") })
      setDeleteContact(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary flex items-center gap-2">
              <Contact size={22} />
              {t("crm_page_title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("crm_page_desc")}</p>
          </div>
          {canManageCrm && (
            <Button onClick={() => setShowAdd(true)} className="gap-2 shrink-0">
              <Plus size={16} />
              {t("crm_add_btn")}
            </Button>
          )}
        </div>

        {/* Type tabs */}
        {list.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveType("all")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                activeType === "all" ? "bg-primary text-white" : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
              )}
            >
              {t("crm_tab_all")}
              <span className="ms-1.5 bg-white/20 rounded-full px-1.5 text-xs">{list.length}</span>
            </button>
            {CONTACT_TYPES.map((ct) => (
              <button
                key={ct}
                onClick={() => setActiveType(ct)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                  activeType === ct ? "bg-primary text-white" : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
                )}
              >
                {t(`crm_type_${ct}`)}
                {counts[ct] > 0 && <span className="ms-1.5 bg-white/20 rounded-full px-1.5 text-xs">{counts[ct]}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Contact list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Contact size={48} className="text-muted-foreground/20" />
            <p className="font-bold text-muted-foreground">{t("crm_empty_title")}</p>
            <p className="text-sm text-muted-foreground/70">{t("crm_empty_desc")}</p>
            {canManageCrm && (
              <Button onClick={() => setShowAdd(true)} variant="outline" className="gap-2 mt-2">
                <Plus size={14} />
                {t("crm_add_btn")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((contact) => (
              <div key={contact.id} className="relative rounded-xl border p-4 hover:shadow-md transition-shadow">
                <Link href={`/contractor/crm/${contact.id}`} className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={contact.name} />
                <div className="relative pointer-events-none">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="font-bold text-primary truncate">{contact.name}</p>
                      {contact.company && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                          <Building2 size={11} />
                          {contact.company}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge className={cn("text-[10px]", TYPE_BADGE_CLASS[contact.type])}>
                        {t(`crm_type_${contact.type}`)}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[10px]", STATUS_BADGE_CLASS[contact.status || "new"])}>
                        {t(`crm_status_${contact.status || "new"}`)}
                      </Badge>
                    </div>
                  </div>
                  {(contact.phone || contact.email) && (
                    <div className="space-y-1 mt-3 text-xs text-muted-foreground">
                      {contact.phone && (
                        <p className="flex items-center gap-1.5" dir="ltr">
                          <Phone size={11} className="shrink-0" />
                          {contact.phone}
                        </p>
                      )}
                      {contact.email && (
                        <p className="flex items-center gap-1.5 truncate" dir="ltr">
                          <Mail size={11} className="shrink-0" />
                          {contact.email}
                        </p>
                      )}
                    </div>
                  )}
                  {contact.ownerName && (
                    <p className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                      <User size={11} className="shrink-0" />
                      {contact.ownerName}
                    </p>
                  )}
                </div>
                {canManageCrm && (
                  <div className="relative flex items-center gap-1 justify-end mt-3 pt-3 border-t">
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                      onClick={() => setEditContact(contact)} aria-label={t("crm_edit_title")}>
                      <Pencil size={13} />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteContact(contact)} aria-label={t("crm_delete_btn")}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <CrmContactDialog open={showAdd} onOpenChange={setShowAdd} orgId={myOrgId} teamMembers={teamMembers} t={t} locale={locale} />
      {editContact && (
        <CrmContactDialog
          open={!!editContact}
          onOpenChange={(open) => { if (!open) setEditContact(null) }}
          contact={editContact}
          orgId={myOrgId}
          teamMembers={teamMembers}
          t={t}
          locale={locale}
        />
      )}

      <AlertDialog open={!!deleteContact} onOpenChange={(open) => { if (!open) setDeleteContact(null) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("crm_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("crm_delete_confirm_desc", { name: deleteContact?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("wh_cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90 gap-2">
              {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {t("crm_delete_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  )
}
