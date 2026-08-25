"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Building2,
  Contact,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Trophy,
  User,
  Users,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
import { useFirestore } from "@/firebase"
import { deleteContactCascade } from "@/lib/crm-writes"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  CONTACT_TYPES,
  LEAD_STATUSES,
  STATUS_BADGE_CLASS,
  TYPE_BADGE_CLASS,
  contactMatchesSearch,
  summarizeLeads,
  toDate,
  type ContactType,
  type CrmContact,
  type LeadStatus,
} from "@/lib/crm"
import { CrmContactDialog } from "@/components/crm/CrmContactDialog"
import {
  CrmEmptyState,
  CrmListSkeleton,
  CrmShell,
  CrmStat,
  CrmStatRow,
  crmBasePath,
  type CrmPortal,
} from "@/components/crm/CrmShell"

type SortKey = "name" | "recent" | "status"

/** Status ordering for the "Status" sort — pipeline order, not alphabetical. */
const STATUS_RANK: Record<LeadStatus, number> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  proposal: 3,
  won: 4,
  lost: 5,
}

export function CrmLeadsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManageCrm = can("crm.manage")
  const { orgId, contacts, teamMembers, isLoading } = useCrmData()
  const base = crmBasePath(portal)

  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<ContactType | "all">("all")
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all")
  const [ownerFilter, setOwnerFilter] = useState<string>("all")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [view, setView] = useState<"grid" | "table">("grid")

  const [showAdd, setShowAdd] = useState(false)
  const [editContact, setEditContact] = useState<CrmContact | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CrmContact | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const summary = useMemo(() => summarizeLeads(contacts), [contacts])

  const typeCounts = useMemo(() => {
    const counts = { all: contacts.length } as Record<ContactType | "all", number>
    for (const ct of CONTACT_TYPES) counts[ct] = 0
    for (const c of contacts) if (c.type in counts) counts[c.type]++
    return counts
  }, [contacts])

  const visible = useMemo(() => {
    const filtered = contacts.filter((c) => {
      if (typeFilter !== "all" && c.type !== typeFilter) return false
      if (statusFilter !== "all" && (c.status || "new") !== statusFilter) return false
      if (ownerFilter !== "all") {
        if (ownerFilter === "__none__" ? !!c.ownerId : c.ownerId !== ownerFilter) return false
      }
      return contactMatchesSearch(c, search)
    })

    const collator = new Intl.Collator(locale === "ar" ? "ar" : "en")
    return filtered.sort((a, b) => {
      if (sortKey === "name") return collator.compare(a.name || "", b.name || "")
      if (sortKey === "status") {
        const diff = STATUS_RANK[a.status || "new"] - STATUS_RANK[b.status || "new"]
        return diff !== 0 ? diff : collator.compare(a.name || "", b.name || "")
      }
      const aTime = toDate(a.createdAt)?.getTime() ?? 0
      const bTime = toDate(b.createdAt)?.getTime() ?? 0
      return bTime - aTime
    })
  }, [contacts, typeFilter, statusFilter, ownerFilter, search, sortKey, locale])

  const hasActiveFilters =
    !!search || typeFilter !== "all" || statusFilter !== "all" || ownerFilter !== "all"

  const clearFilters = () => {
    setSearch("")
    setTypeFilter("all")
    setStatusFilter("all")
    setOwnerFilter("all")
  }

  const handleDelete = async () => {
    if (!firestore || !deleteTarget) return
    setIsDeleting(true)
    try {
      await deleteContactCascade(firestore, deleteTarget.id, deleteTarget.organizationId || orgId)
      toast({ title: t("crm_deleted") })
      setDeleteTarget(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const addButton = canManageCrm ? (
    <Button onClick={() => setShowAdd(true)} className="gap-2">
      <Plus size={16} />
      {t("crm_add_btn")}
    </Button>
  ) : undefined

  return (
    <CrmShell
      portal={portal}
      icon={Contact}
      title={t("crm_leads_page_title")}
      description={t("crm_leads_page_desc")}
      action={addButton}
    >
      <CrmStatRow>
        <CrmStat icon={Users} label={t("crm_stat_total")} value={summary.total} accent="primary" />
        <CrmStat icon={Contact} label={t("crm_stat_open")} value={summary.open} accent="cta" />
        <CrmStat icon={Trophy} label={t("crm_stat_won")} value={summary.won} accent="success" />
        <CrmStat icon={Trophy} label={t("crm_stat_win_rate")} value={`${summary.winRate}%`} accent="accent" />
      </CrmStatRow>

      {/* Relationship-type rail — always rendered so a filtered-to-empty list
          still offers a way back, which the old tabs did not. */}
      <div className="flex flex-wrap gap-2">
        {(["all", ...CONTACT_TYPES] as const).map((ct) => (
          <button
            key={ct}
            type="button"
            onClick={() => setTypeFilter(ct)}
            aria-pressed={typeFilter === ct}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              typeFilter === ct
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted"
            )}
          >
            {ct === "all" ? t("crm_tab_all") : t(`crm_type_${ct}`)}
            <span
              className={cn(
                "ms-1.5 rounded-full px-1.5 text-xs",
                typeFilter === ct ? "bg-white/20" : "bg-background/70"
              )}
            >
              {typeCounts[ct] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("crm_search_placeholder")}
            className="ps-9"
            aria-label={t("crm_search_placeholder")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as LeadStatus | "all")}>
            <SelectTrigger className="w-[150px]" aria-label={t("crm_filter_status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("crm_filter_all_statuses")}</SelectItem>
              {LEAD_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{t(`crm_status_${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-[150px]" aria-label={t("crm_filter_owner")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("crm_filter_all_owners")}</SelectItem>
              <SelectItem value="__none__">{t("crm_owner_none")}</SelectItem>
              {teamMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="w-[150px]" aria-label={t("crm_sort_label")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{t("crm_sort_name")}</SelectItem>
              <SelectItem value="recent">{t("crm_sort_recent")}</SelectItem>
              <SelectItem value="status">{t("crm_sort_status")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex rounded-lg border p-0.5">
            {(["grid", "table"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                aria-pressed={view === mode}
                aria-label={t(mode === "grid" ? "crm_view_grid" : "crm_view_table")}
                className={cn(
                  "px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t(mode === "grid" ? "crm_view_grid" : "crm_view_table")}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground hover:text-destructive">
              <X size={13} />
              {t("crm_clear_filters")}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <CrmListSkeleton />
      ) : contacts.length === 0 ? (
        <CrmEmptyState
          icon={Contact}
          title={t("crm_empty_title")}
          description={t("crm_empty_desc")}
          action={canManageCrm ? (
            <Button onClick={() => setShowAdd(true)} variant="outline" className="gap-2">
              <Plus size={14} />
              {t("crm_add_btn")}
            </Button>
          ) : undefined}
        />
      ) : visible.length === 0 ? (
        <CrmEmptyState
          icon={Search}
          title={t("crm_no_results")}
          description={t("crm_no_results_desc")}
          action={<Button variant="outline" size="sm" onClick={clearFilters}>{t("crm_clear_filters")}</Button>}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {t("crm_showing_count", { shown: visible.length, total: contacts.length })}
          </p>
          {view === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visible.map((contact) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  href={`${base}/leads/${contact.id}`}
                  canManage={canManageCrm}
                  onEdit={() => setEditContact(contact)}
                  onDelete={() => setDeleteTarget(contact)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("crm_col_name")}</TableHead>
                    <TableHead>{t("crm_col_type")}</TableHead>
                    <TableHead>{t("crm_col_status")}</TableHead>
                    <TableHead>{t("crm_col_contact")}</TableHead>
                    <TableHead>{t("crm_col_owner")}</TableHead>
                    {canManageCrm && <TableHead className="text-end">{t("crm_col_actions")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <Link
                          href={`${base}/leads/${contact.id}`}
                          className="font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          {contact.name}
                        </Link>
                        {contact.company && (
                          <p className="text-xs text-muted-foreground truncate">{contact.company}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn("text-[10px]", TYPE_BADGE_CLASS[contact.type])}>
                          {t(`crm_type_${contact.type}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px]", STATUS_BADGE_CLASS[contact.status || "new"])}>
                          {t(`crm_status_${contact.status || "new"}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {contact.phone && <span className="block" dir="ltr">{contact.phone}</span>}
                        {contact.email && <span className="block truncate" dir="ltr">{contact.email}</span>}
                        {!contact.phone && !contact.email && "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {contact.ownerName || t("crm_owner_none")}
                      </TableCell>
                      {canManageCrm && (
                        <TableCell>
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                              onClick={() => setEditContact(contact)} aria-label={t("crm_edit_title")}>
                              <Pencil size={13} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(contact)} aria-label={t("crm_delete_btn")}>
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <CrmContactDialog open={showAdd} onOpenChange={setShowAdd} orgId={orgId} teamMembers={teamMembers} />
      <CrmContactDialog
        key={editContact?.id ?? "edit"}
        open={!!editContact}
        onOpenChange={(open) => { if (!open) setEditContact(null) }}
        contact={editContact ?? undefined}
        orgId={orgId}
        teamMembers={teamMembers}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null) }}>
        <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("crm_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("crm_delete_confirm_desc", { name: deleteTarget?.name ?? "" })}{" "}
              {t("crm_delete_cascade_note")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleDelete() }}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90 gap-2"
            >
              {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {t("crm_delete_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmShell>
  )
}

function ContactCard({
  contact,
  href,
  canManage,
  onEdit,
  onDelete,
}: {
  contact: CrmContact
  href: string
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useTranslations("Portal.Shared")

  return (
    <div className="group relative rounded-xl border bg-card p-4 transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring">
      {/* Whole-card link sits UNDER the action buttons: the overlay is
          absolute, the action row is relative + z-raised, so the buttons stay
          clickable without the card losing its single large hit target. */}
      <Link href={href} className="absolute inset-0 rounded-xl focus:outline-none" aria-label={contact.name} />
      <div className="pointer-events-none">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <p className="font-bold text-primary truncate">{contact.name}</p>
            {contact.company && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                <Building2 size={11} className="shrink-0" />
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
        <p className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
          <User size={11} className="shrink-0" />
          {contact.ownerName || t("crm_owner_none")}
        </p>
      </div>
      {canManage && (
        <div className="relative z-10 flex items-center gap-1 justify-end mt-3 pt-3 border-t">
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
            onClick={onEdit} aria-label={`${t("crm_edit_title")} — ${contact.name}`}>
            <Pencil size={13} />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete} aria-label={`${t("crm_delete_btn")} — ${contact.name}`}>
            <Trash2 size={13} />
          </Button>
        </div>
      )}
    </div>
  )
}
