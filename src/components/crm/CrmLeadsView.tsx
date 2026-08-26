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
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Link, useRouter } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { deleteContactCascade } from "@/lib/crm-writes"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { useCrmListState, type CrmListConfig } from "@/hooks/useCrmListState"
import { cn } from "@/lib/utils"
import {
  CONTACT_TIERS,
  CONTACT_TYPES,
  HEALTH_BAND_CLASS,
  LEAD_STATUSES,
  PARTY_ROLES,
  PARTY_TYPES,
  STATUS_BADGE_CLASS,
  TIER_BADGE_CLASS,
  TYPE_BADGE_CLASS,
  contactHealth,
  contactPeople,
  formatSarCompact,
  isOpportunityOpen,
  opportunityState,
  partyRoles,
  toDate,
  type CrmContact,
  type LeadStatus,
} from "@/lib/crm"
import { CrmContactDialog } from "@/components/crm/CrmContactDialog"
import { CrmShowMore, CrmSortHeader, CrmToolbar } from "@/components/crm/CrmToolbar"
import {
  CRM_ROW_LINK_CLASS,
  CrmEmptyState,
  CrmListSkeleton,
  CrmShell,
  CrmStat,
  CrmStatRow,
  crmBasePath,
  type CrmPortal,
} from "@/components/crm/CrmShell"
import { summarizeLeads } from "@/lib/crm"

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
  const { orgId, contacts, opportunities, teamMembers, isLoading } = useCrmData({ opportunities: true })
  const router = useRouter()
  const base = crmBasePath(portal)

  const [view, setView] = useState<"grid" | "table">("grid")
  const [showAdd, setShowAdd] = useState(false)
  const [editContact, setEditContact] = useState<CrmContact | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CrmContact | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const summary = useMemo(() => summarizeLeads(contacts), [contacts])

  /** Per-party pipeline, computed once instead of inside every row. */
  const pipelineByContact = useMemo(() => {
    const map = new Map<string, { open: number; openValue: number; won: number }>()
    for (const opp of opportunities) {
      const row = map.get(opp.contactId) ?? { open: 0, openValue: 0, won: 0 }
      if (isOpportunityOpen(opp)) {
        row.open++
        row.openValue += opp.value || 0
      } else {
        const state = opportunityState(opp)
        if (state === "won" || state === "handed_over") row.won++
      }
      map.set(opp.contactId, row)
    }
    return map
  }, [opportunities])

  const healthOf = (contact: CrmContact) => contactHealth(contact, pipelineByContact.get(contact.id)?.won ?? 0)

  const listConfig = useMemo<CrmListConfig<CrmContact>>(
    () => ({
      segments: [
        { key: "all", label: t("crm_tab_all"), predicate: () => true },
        {
          key: "active",
          label: t("crm_leads_segment_active"),
          predicate: (c) => (pipelineByContact.get(c.id)?.open ?? 0) > 0,
        },
        {
          key: "contracted",
          label: t("crm_leads_segment_contracted"),
          predicate: (c) => (pipelineByContact.get(c.id)?.won ?? 0) > 0,
        },
        {
          key: "risk",
          label: t("crm_leads_segment_risk"),
          predicate: (c) => (c.overdueAmount || 0) > 0 || (c.paymentDays || 0) > 100,
        },
        {
          key: "incomplete",
          label: t("crm_leads_segment_incomplete"),
          predicate: (c) => contactPeople(c).length === 0 && !c.phone && !c.email,
        },
      ],
      facets: [
        {
          key: "type",
          label: t("crm_type"),
          options: CONTACT_TYPES.map((ct) => ({ value: ct, label: t(`crm_type_${ct}`) })),
          valueOf: (c) => c.type,
        },
        {
          key: "partyType",
          label: t("crm_party_type"),
          options: PARTY_TYPES.map((pt) => ({ value: pt, label: t(`crm_party_type_${pt}`) })),
          valueOf: (c) => c.partyType ?? null,
        },
        {
          key: "role",
          label: t("crm_party_roles"),
          options: PARTY_ROLES.map((r) => ({ value: r, label: t(`crm_party_role_${r}`) })),
          valueOf: (c) => partyRoles(c),
        },
        {
          key: "status",
          label: t("crm_status"),
          options: LEAD_STATUSES.map((s) => ({ value: s, label: t(`crm_status_${s}`) })),
          valueOf: (c) => c.status || "new",
        },
        {
          key: "tier",
          label: t("crm_tier"),
          options: CONTACT_TIERS.map((tr) => ({ value: tr, label: t(`crm_tier_${tr}`) })),
          valueOf: (c) => c.tier ?? null,
        },
        {
          key: "owner",
          label: t("crm_owner"),
          options: teamMembers.map((m) => ({ value: m.id, label: m.name })),
          valueOf: (c) => c.ownerId ?? null,
        },
      ],
      savedViews: [
        { key: "all", label: t("crm_view_all_parties"), segment: "all", sort: { key: "name", direction: 1 } },
        { key: "active", label: t("crm_leads_segment_active"), segment: "active", sort: { key: "pipeline", direction: -1 } },
        { key: "contracted", label: t("crm_leads_segment_contracted"), segment: "contracted", sort: { key: "name", direction: 1 } },
        { key: "risk", label: t("crm_leads_segment_risk"), segment: "risk", sort: { key: "overdue", direction: -1 } },
        { key: "incomplete", label: t("crm_leads_segment_incomplete"), segment: "incomplete", sort: { key: "name", direction: 1 } },
      ],
      groups: [
        { key: "partyType", label: t("crm_party_type"), keyOf: (c) => (c.partyType ? t(`crm_party_type_${c.partyType}`) : t("crm_not_specified")) },
        { key: "type", label: t("crm_type"), keyOf: (c) => t(`crm_type_${c.type}`) },
        { key: "owner", label: t("crm_owner"), keyOf: (c) => c.ownerName || t("crm_owner_none") },
        { key: "city", label: t("crm_city"), keyOf: (c) => c.city || "—" },
      ],
      sorts: [
        { key: "name", valueOf: (c) => c.name || "" },
        { key: "status", valueOf: (c) => STATUS_RANK[c.status || "new"] },
        { key: "recent", valueOf: (c) => -(toDate(c.createdAt)?.getTime() ?? 0) },
        { key: "pipeline", valueOf: (c) => pipelineByContact.get(c.id)?.openValue ?? 0 },
        { key: "payment", valueOf: (c) => c.paymentDays ?? 0 },
        { key: "overdue", valueOf: (c) => c.overdueAmount ?? 0 },
        { key: "health", valueOf: (c) => healthOf(c).score },
      ],
      searchText: (c) =>
        [c.name, c.company, c.phone, c.email, c.ownerName, c.city, c.crNumber]
          .concat(contactPeople(c).flatMap((p) => [p.name, p.title ?? "", p.phone ?? ""]))
          .filter(Boolean)
          .join(" "),
      isMine: (c) => !!c.ownerId && teamMembers.some((m) => m.id === c.ownerId),
      defaultSegment: "all",
      defaultSort: { key: "name", direction: 1 },
      pageSize: 18,
    }),
    [t, teamMembers, pipelineByContact]
  )

  const state = useCrmListState(contacts, listConfig, locale)

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

  const viewSwitch = (
    <div className="flex rounded-lg border p-0.5">
      {(["grid", "table"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => setView(mode)}
          aria-pressed={view === mode}
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
  )

  const cellPad = state.dense ? "py-1.5" : ""
  const columnCount = canManageCrm ? 9 : 8

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

      {!isLoading && contacts.length > 0 && (
        <CrmToolbar config={listConfig} state={state} extra={viewSwitch} />
      )}

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
      ) : state.filtered.length === 0 ? (
        <CrmEmptyState
          icon={Search}
          title={t("crm_no_results")}
          description={t("crm_no_results_desc")}
          action={<Button variant="outline" size="sm" onClick={state.clearAll}>{t("crm_clear_filters")}</Button>}
        />
      ) : view === "grid" ? (
        <div className="space-y-4">
          {state.grouped.map((bucket) => (
            <div key={bucket.key || "__all"} className="space-y-3">
              {bucket.label && (
                <h2 className="flex items-center gap-2 text-xs font-black text-foreground">
                  {bucket.label}
                  <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground" dir="ltr">
                    {bucket.rows.length}
                  </span>
                </h2>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {bucket.rows.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    href={`${base}/leads/${contact.id}`}
                    health={healthOf(contact)}
                    openDeals={pipelineByContact.get(contact.id)?.open ?? 0}
                    canManage={canManageCrm}
                    onEdit={() => setEditContact(contact)}
                    onDelete={() => setDeleteTarget(contact)}
                  />
                ))}
              </div>
            </div>
          ))}
          {state.hasMore && (
            <Button variant="outline" size="sm" className="w-full" onClick={state.showMore}>
              {t("crm_show_more", { count: state.matching - state.shown })}
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><CrmSortHeader state={state} sortKey="name" label={t("crm_col_name")} /></TableHead>
                  <TableHead className="hidden lg:table-cell">{t("crm_party_roles")}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t("crm_tier")}</TableHead>
                  <TableHead className="hidden sm:table-cell"><CrmSortHeader state={state} sortKey="status" label={t("crm_col_status")} /></TableHead>
                  <TableHead><CrmSortHeader state={state} sortKey="pipeline" label={t("crm_leads_col_pipeline")} /></TableHead>
                  <TableHead className="hidden lg:table-cell"><CrmSortHeader state={state} sortKey="payment" label={t("crm_leads_col_payment")} /></TableHead>
                  <TableHead><CrmSortHeader state={state} sortKey="health" label={t("crm_health")} /></TableHead>
                  <TableHead className="hidden md:table-cell">{t("crm_col_owner")}</TableHead>
                  {canManageCrm && <TableHead className="text-end">{t("crm_col_actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.grouped.map((bucket) => (
                  <GroupFragment key={bucket.key || "__all"} label={bucket.label} count={bucket.rows.length} colSpan={columnCount}>
                    {bucket.rows.map((contact) => {
                      const health = healthOf(contact)
                      const pipeline = pipelineByContact.get(contact.id)
                      const people = contactPeople(contact)
                      return (
                        <TableRow
                          key={contact.id}
                          className={cn(CRM_ROW_LINK_CLASS, "group/row")}
                          onClick={() => router.push(`${base}/leads/${contact.id}`)}
                        >
                          <TableCell className={cn("max-w-[220px] lg:max-w-[300px]", cellPad)}>
                            <Link
                              href={`${base}/leads/${contact.id}`}
                              onClick={(e) => e.stopPropagation()}
                              title={contact.name}
                              className="font-bold text-primary hover:underline line-clamp-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                            >
                              {contact.name}
                            </Link>
                            <p className="text-xs text-muted-foreground truncate">
                              {[contact.partyType ? t(`crm_party_type_${contact.partyType}`) : null, contact.city]
                                .filter(Boolean)
                                .join(" · ") || contact.company || "—"}
                            </p>
                          </TableCell>
                          <TableCell className={cellPad}>
                            <div className="flex flex-wrap gap-1">
                              {partyRoles(contact).map((role) => (
                                <Badge key={role} variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border">
                                  {t(`crm_party_role_${role}`)}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className={cellPad}>
                            {contact.tier ? (
                              <Badge variant="outline" className={cn("text-[10px]", TIER_BADGE_CLASS[contact.tier])}>
                                {contact.tier}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className={cellPad}>
                            <Badge variant="outline" className={cn("text-[10px]", STATUS_BADGE_CLASS[contact.status || "new"])}>
                              {t(`crm_status_${contact.status || "new"}`)}
                            </Badge>
                          </TableCell>
                          <TableCell className={cn("text-xs", cellPad)}>
                            {pipeline && pipeline.open > 0 ? (
                              <span>
                                <span className="font-bold text-foreground" dir="ltr">{pipeline.open}</span>
                                <span className="block text-muted-foreground" dir="ltr">
                                  {formatSarCompact(pipeline.openValue, locale)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className={cn("text-xs", cellPad)}>
                            {typeof contact.paymentDays === "number" ? (
                              <span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px]",
                                    contact.paymentDays > 100
                                      ? "bg-destructive/10 text-destructive border-destructive/20"
                                      : contact.paymentDays > 70
                                        ? "bg-warning/10 text-warning border-warning/20"
                                        : "bg-success/10 text-success border-success/20"
                                  )}
                                >
                                  <span dir="ltr">{t("crm_days_short", { days: contact.paymentDays })}</span>
                                </Badge>
                                {(contact.overdueAmount || 0) > 0 && (
                                  <span className="block text-destructive font-semibold mt-0.5" dir="ltr">
                                    {formatSarCompact(contact.overdueAmount, locale)}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className={cellPad}>
                            <Badge variant="outline" className={cn("text-[10px]", HEALTH_BAND_CLASS[health.band])}>
                              <span dir="ltr">{health.score}</span>
                            </Badge>
                          </TableCell>
                          <TableCell className={cn("text-xs text-muted-foreground", cellPad)}>
                            {contact.ownerName || t("crm_owner_none")}
                            {people.length > 0 && (
                              <span className="block text-[10px]">{t("crm_people_count", { count: people.length })}</span>
                            )}
                          </TableCell>
                          {canManageCrm && (
                            <TableCell className={cellPad}>
                              <div className="flex items-center gap-1 justify-end">
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                                  onClick={(e) => { e.stopPropagation(); setEditContact(contact) }} aria-label={`${t("crm_edit_title")} — ${contact.name}`}>
                                  <Pencil size={13} />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(contact) }} aria-label={`${t("crm_delete_btn")} — ${contact.name}`}>
                                  <Trash2 size={13} />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </GroupFragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <CrmShowMore state={state} />
        </div>
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

function GroupFragment({
  label,
  count,
  colSpan,
  children,
}: {
  label: string
  count: number
  colSpan: number
  children: React.ReactNode
}) {
  if (!label) return <>{children}</>
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={colSpan} className="py-2">
          <span className="flex items-center gap-2 text-xs font-black text-foreground">
            {label}
            <span className="rounded-full bg-background px-1.5 text-[10px] font-bold text-muted-foreground" dir="ltr">
              {count}
            </span>
          </span>
        </TableCell>
      </TableRow>
      {children}
    </>
  )
}

function ContactCard({
  contact,
  href,
  health,
  openDeals,
  canManage,
  onEdit,
  onDelete,
}: {
  contact: CrmContact
  href: string
  health: ReturnType<typeof contactHealth>
  openDeals: number
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const people = contactPeople(contact)
  // The first named person is the one someone will actually call.
  const primaryPerson = people[0]

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
            {(contact.partyType || contact.company) && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                <Building2 size={11} className="shrink-0" />
                {contact.partyType ? t(`crm_party_type_${contact.partyType}`) : contact.company}
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

        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {contact.tier && (
            <Badge variant="outline" className={cn("text-[10px]", TIER_BADGE_CLASS[contact.tier])}>
              {contact.tier}
            </Badge>
          )}
          <Badge variant="outline" className={cn("text-[10px]", HEALTH_BAND_CLASS[health.band])}>
            {t("crm_health")} <span dir="ltr" className="ms-1">{health.score}</span>
          </Badge>
          {openDeals > 0 && (
            <Badge variant="outline" className="text-[10px] bg-cta/10 text-cta border-cta/20">
              {t("crm_leads_open_deals", { count: openDeals })}
            </Badge>
          )}
        </div>

        {primaryPerson ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5 truncate">
              <User size={11} className="shrink-0" />
              <span className="font-semibold text-foreground">{primaryPerson.name}</span>
              {primaryPerson.title && <span className="truncate">· {primaryPerson.title}</span>}
            </p>
            {primaryPerson.phone && (
              <p className="flex items-center gap-1.5" dir="ltr">
                <Phone size={11} className="shrink-0" />
                {primaryPerson.phone}
              </p>
            )}
            {people.length > 1 && (
              <p className="text-[10px]">{t("crm_people_count", { count: people.length })}</p>
            )}
          </div>
        ) : (
          (contact.phone || contact.email) && (
            <div className="space-y-1 text-xs text-muted-foreground">
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
          )
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
