"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where, addDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import {
  CalendarDays,
  Coins,
  ExternalLink,
  FileText,
  Link2,
  Link2Off,
  Loader2,
  Search,
  Trophy,
  Users,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  CRM_OPPORTUNITIES,
  daysUntil,
  formatCrmDate,
  formatSar,
  formatSarCompact,
  toDate,
  type CrmOpportunity,
  type OpportunityStage,
} from "@/lib/crm"
import {
  CrmEmptyState,
  CrmListSkeleton,
  CrmShell,
  CrmStat,
  CrmStatRow,
  crmBasePath,
  type CrmPortal,
} from "@/components/crm/CrmShell"

/** One row of the CRM's RFQ table, normalised from either side of the deal:
 * a contractor's own RFQs, or the RFQs a supplier has quoted on. */
interface RfqRow {
  rfqId: string
  title: string
  /** "draft" | "new" | "awarded" — the CRM's own vocabulary, not the raw
   * Arabic/English status strings the two collections happen to store. */
  status: "draft" | "new" | "awarded"
  rawStatus: string
  deadline: unknown
  createdAt: unknown
  offersCount: number | null
  myOfferValue: number | null
  href: string
}

const CONTRACTOR_STATUS_MAP: Record<string, RfqRow["status"]> = {
  Draft: "draft",
  New: "new",
  Awarded: "awarded",
}

/** Supplier-side status lives on the OFFER, in Arabic, as written by
 * SubmitOfferDialog and the contractor's award flow. */
const OFFER_STATUS_MAP: Record<string, RfqRow["status"]> = {
  "مقبول": "awarded",
  "تم التسليم": "awarded",
  "مرفوض": "draft",
}

const OFFER_STAGE_MAP: Record<string, OpportunityStage> = {
  "مقبول": "won",
  "تم التسليم": "won",
  "مرفوض": "lost",
  "مطلوب تخفيض": "negotiation",
}

const RFQ_STATUS_BADGE: Record<RfqRow["status"], string> = {
  draft: "bg-muted text-muted-foreground border-border",
  new: "bg-cta/10 text-cta border-cta/20",
  awarded: "bg-success/10 text-success border-success/20",
}

export function CrmRfqsView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManageCrm = can("crm.manage")
  const { orgId, contacts, opportunities, teamMembers, isLoading: isCrmLoading } = useCrmData({ opportunities: true })
  const base = crmBasePath(portal)
  const isContractor = portal === "contractor"

  const [search, setSearch] = useState("")
  const [linkFilter, setLinkFilter] = useState<"all" | "linked" | "unlinked">("all")
  const [linkTarget, setLinkTarget] = useState<RfqRow | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)

  // Contractor: their own RFQs. Supplier: cannot list another org's RFQs by
  // owner, so the pipeline is derived from their own offers — which already
  // carry `rfqId`, `rfqTitle`, price and status.
  const rfqsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId || !isContractor) return null
    return query(collection(firestore, "rfqs"), where("organizationId", "==", orgId))
  }, [firestore, orgId, isContractor])
  const { data: rfqsData, isLoading: rfqsLoading } = useCollection(rfqsQuery)

  const offersQuery = useMemoFirebase(() => {
    if (!firestore || isUserLoading || !user) return null
    if (isContractor) {
      if (!orgId) return null
      return query(collection(firestore, "offers"), where("contractorOrgId", "==", orgId))
    }
    return query(collection(firestore, "offers"), where("organizationId", "==", orgId || user.uid))
  }, [firestore, isContractor, orgId, user, isUserLoading])
  const { data: offersData, isLoading: offersLoading } = useCollection(offersQuery)

  const rows = useMemo<RfqRow[]>(() => {
    const offers = (offersData || []) as Array<{
      id: string
      rfqId?: string
      rfqTitle?: string
      price?: string | number
      status?: string
      createdAt?: unknown
    }>

    if (isContractor) {
      const offerCounts = new Map<string, number>()
      for (const offer of offers) {
        if (!offer.rfqId) continue
        offerCounts.set(offer.rfqId, (offerCounts.get(offer.rfqId) || 0) + 1)
      }
      return ((rfqsData || []) as Array<Record<string, unknown>>).map((rfq) => {
        const id = String(rfq.id)
        const rawStatus = String(rfq.status ?? "New")
        return {
          rfqId: id,
          title: String(rfq.title ?? id),
          status: CONTRACTOR_STATUS_MAP[rawStatus] ?? "new",
          rawStatus,
          deadline: rfq.deadline,
          createdAt: rfq.createdAt,
          offersCount: offerCounts.get(id) ?? 0,
          myOfferValue: null,
          href: `/contractor/rfqs/${id}`,
        }
      })
    }

    // One row per RFQ the supplier has quoted, newest offer wins if they
    // somehow submitted more than one against the same request.
    const byRfq = new Map<string, RfqRow>()
    for (const offer of offers) {
      if (!offer.rfqId) continue
      const rawStatus = String(offer.status ?? "")
      const price = typeof offer.price === "number" ? offer.price : parseFloat(String(offer.price ?? ""))
      const row: RfqRow = {
        rfqId: offer.rfqId,
        title: offer.rfqTitle || offer.rfqId,
        status: OFFER_STATUS_MAP[rawStatus] ?? "new",
        rawStatus,
        deadline: null,
        createdAt: offer.createdAt,
        offersCount: null,
        myOfferValue: Number.isFinite(price) ? price : null,
        href: "/supplier/offers",
      }
      const existing = byRfq.get(offer.rfqId)
      const existingTime = toDate(existing?.createdAt)?.getTime() ?? 0
      const rowTime = toDate(row.createdAt)?.getTime() ?? 0
      if (!existing || rowTime >= existingTime) byRfq.set(offer.rfqId, row)
    }
    return Array.from(byRfq.values())
  }, [rfqsData, offersData, isContractor])

  /** rfqId -> the opportunity that is tracking it. */
  const linkedByRfq = useMemo(() => {
    const map = new Map<string, CrmOpportunity>()
    for (const opp of opportunities) {
      if (opp.rfqId) map.set(opp.rfqId, opp)
    }
    return map
  }, [opportunities])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((row) => {
        const linked = linkedByRfq.has(row.rfqId)
        if (linkFilter === "linked" && !linked) return false
        if (linkFilter === "unlinked" && linked) return false
        if (!q) return true
        return (
          row.title.toLowerCase().includes(q) ||
          row.rfqId.toLowerCase().includes(q) ||
          (linkedByRfq.get(row.rfqId)?.contactName || "").toLowerCase().includes(q)
        )
      })
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0))
  }, [rows, search, linkFilter, linkedByRfq])

  const stats = useMemo(() => {
    let open = 0
    let awarded = 0
    let linked = 0
    let value = 0
    for (const row of rows) {
      if (row.status === "new") open++
      if (row.status === "awarded") awarded++
      if (linkedByRfq.has(row.rfqId)) linked++
      value += row.myOfferValue ?? 0
    }
    return { total: rows.length, open, awarded, linked, value }
  }, [rows, linkedByRfq])

  const handleUnlink = async (row: RfqRow) => {
    const opp = linkedByRfq.get(row.rfqId)
    if (!firestore || !opp) return
    setUnlinkingId(row.rfqId)
    try {
      // The opportunity itself is real CRM work — unlinking detaches the RFQ
      // reference, it never deletes the deal the user has been tracking.
      await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), {
        rfqId: null,
        rfqTitle: null,
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("crm_rfq_unlinked_toast") })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setUnlinkingId(null)
    }
  }

  const isLoading = isCrmLoading || (isContractor && rfqsLoading) || offersLoading

  return (
    <CrmShell
      portal={portal}
      icon={FileText}
      title={t("crm_rfqs_page_title")}
      description={t(isContractor ? "crm_rfqs_page_desc_contractor" : "crm_rfqs_page_desc_supplier")}
    >
      <CrmStatRow>
        <CrmStat icon={FileText} label={t("crm_rfq_stat_total")} value={stats.total} accent="primary" />
        <CrmStat icon={CalendarDays} label={t("crm_rfq_stat_open")} value={stats.open} accent="cta" />
        <CrmStat icon={Trophy} label={t("crm_rfq_stat_awarded")} value={stats.awarded} accent="success" />
        {isContractor ? (
          <CrmStat icon={Link2} label={t("crm_rfq_stat_linked")} value={`${stats.linked}/${stats.total}`} accent="accent" />
        ) : (
          <CrmStat icon={Coins} label={t("crm_quote_stat_value")} value={formatSarCompact(stats.value, locale)} accent="accent" />
        )}
      </CrmStatRow>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("crm_rfq_search_placeholder")}
            className="ps-9"
            aria-label={t("crm_rfq_search_placeholder")}
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={linkFilter} onValueChange={(v) => setLinkFilter(v as typeof linkFilter)}>
            <SelectTrigger className="w-[170px]" aria-label={t("crm_rfq_filter_link")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("crm_rfq_filter_all")}</SelectItem>
              <SelectItem value="linked">{t("crm_rfq_filter_linked_only")}</SelectItem>
              <SelectItem value="unlinked">{t("crm_rfq_filter_unlinked_only")}</SelectItem>
            </SelectContent>
          </Select>
          {(search || linkFilter !== "all") && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setLinkFilter("all") }}
              className="gap-1 text-muted-foreground hover:text-destructive">
              <X size={13} />
              {t("crm_clear_filters")}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <CrmListSkeleton />
      ) : rows.length === 0 ? (
        <CrmEmptyState
          icon={FileText}
          title={t(isContractor ? "crm_rfq_empty_title_contractor" : "crm_rfq_empty_title_supplier")}
          description={t(isContractor ? "crm_rfq_empty_desc_contractor" : "crm_rfq_empty_desc_supplier")}
          action={
            <Link href={isContractor ? "/contractor/rfqs" : "/supplier/rfqs"}>
              <Button variant="outline" className="gap-2">
                <ExternalLink size={14} />
                {t("crm_rfq_open_btn")}
              </Button>
            </Link>
          }
        />
      ) : visible.length === 0 ? (
        <CrmEmptyState
          icon={Search}
          title={t("crm_no_results")}
          description={t("crm_no_results_desc")}
          action={<Button variant="outline" size="sm" onClick={() => { setSearch(""); setLinkFilter("all") }}>{t("crm_clear_filters")}</Button>}
        />
      ) : (
        <div className="rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("crm_rfq_col_title")}</TableHead>
                <TableHead>{t("crm_col_status")}</TableHead>
                <TableHead>{isContractor ? t("crm_rfq_col_offers") : t("crm_rfq_col_my_offer")}</TableHead>
                <TableHead>{t("crm_rfq_col_linked")}</TableHead>
                <TableHead className="text-end">{t("crm_col_actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const opp = linkedByRfq.get(row.rfqId)
                const days = isContractor ? daysUntil(row.deadline) : null
                return (
                  <TableRow key={row.rfqId}>
                    <TableCell>
                      <p className="font-bold text-foreground line-clamp-2">{row.title}</p>
                      {/* Each fragment is its own element with the separator
                          OUTSIDE any dir="ltr" wrapper — a bullet inside an
                          LTR span lands on the wrong visual side in RTL. */}
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono" dir="ltr">{row.rfqId.substring(0, 8)}</span>
                        {isContractor && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className={cn(days !== null && days < 0 && "text-destructive font-semibold")}>
                              {row.deadline
                                ? days !== null && days < 0
                                  ? t("crm_rfq_deadline_passed")
                                  : t("crm_rfq_days_left", { days: days ?? 0 })
                                : t("crm_rfq_no_deadline")}
                            </span>
                          </>
                        )}
                        {isContractor && !!row.deadline && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{formatCrmDate(row.deadline, locale)}</span>
                          </>
                        )}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px]", RFQ_STATUS_BADGE[row.status])}>
                        {t(`crm_rfq_status_${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {isContractor ? (
                        <span className="font-bold" dir="ltr">{row.offersCount ?? 0}</span>
                      ) : row.myOfferValue !== null ? (
                        <span className="font-bold" dir="ltr">{formatSar(row.myOfferValue, locale)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {opp ? (
                        <Link
                          href={`${base}/leads/${opp.contactId}`}
                          className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          {opp.contactName || t("crm_opp_open_contact")}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("crm_rfq_unlinked")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        {canManageCrm && (
                          opp ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                              onClick={() => void handleUnlink(row)}
                              disabled={unlinkingId === row.rfqId}
                            >
                              {unlinkingId === row.rfqId ? <Loader2 size={12} className="animate-spin" /> : <Link2Off size={12} />}
                              {t("crm_rfq_unlink_btn")}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-primary"
                              onClick={() => setLinkTarget(row)}
                              disabled={contacts.length === 0}
                            >
                              <Link2 size={12} />
                              {t("crm_rfq_link_btn")}
                            </Button>
                          )
                        )}
                        <Link href={row.href} aria-label={`${t("crm_rfq_open_btn")} — ${row.title}`}>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary">
                            <ExternalLink size={13} />
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <LinkRfqDialog
        row={linkTarget}
        onClose={() => setLinkTarget(null)}
        orgId={orgId}
        contacts={contacts}
        teamMembers={teamMembers}
      />
    </CrmShell>
  )
}

function LinkRfqDialog({
  row,
  onClose,
  orgId,
  contacts,
  teamMembers,
}: {
  row: RfqRow | null
  onClose: () => void
  orgId: string
  contacts: ReturnType<typeof useCrmData>["contacts"]
  teamMembers: ReturnType<typeof useCrmData>["teamMembers"]
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [contactId, setContactId] = useState("")
  const [ownerId, setOwnerId] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const handleLink = async () => {
    if (!firestore || !row || !contactId || isSaving) return
    setIsSaving(true)
    try {
      const contact = contacts.find((c) => c.id === contactId)
      const owner = teamMembers.find((m) => m.id === ownerId)
      await addDoc(collection(firestore, CRM_OPPORTUNITIES), {
        contactId,
        contactName: contact?.name ?? null,
        title: row.title,
        stage: OFFER_STAGE_MAP[row.rawStatus] ?? (row.status === "awarded" ? "won" : "proposal"),
        value: row.myOfferValue ?? 0,
        expectedCloseDate: toDate(row.deadline)?.toISOString().split("T")[0] ?? null,
        ownerId: owner?.id || null,
        ownerName: owner?.name || null,
        notes: null,
        rfqId: row.rfqId,
        rfqTitle: row.title,
        organizationId: orgId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("crm_rfq_link_saved") })
      setContactId("")
      setOwnerId("")
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(next) => { if (!next && !isSaving) { setContactId(""); setOwnerId(""); onClose() } }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{t("crm_rfq_link_title")}</DialogTitle>
          <DialogDescription>{t("crm_rfq_link_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-sm font-bold text-foreground line-clamp-2">{row?.title}</p>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5" dir="ltr">{row?.rfqId}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-contact">{t("crm_opp_contact")} *</Label>
            <Select value={contactId} onValueChange={setContactId} disabled={isSaving}>
              <SelectTrigger id="link-contact"><SelectValue placeholder={t("crm_opp_contact_placeholder")} /></SelectTrigger>
              <SelectContent className="max-h-72">
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.company ? ` — ${c.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Users size={11} />
              {t("crm_rfq_create_opp_hint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-owner">{t("crm_owner")}</Label>
            <Select value={ownerId || "__none__"} onValueChange={(v) => setOwnerId(v === "__none__" ? "" : v)} disabled={isSaving}>
              <SelectTrigger id="link-owner"><SelectValue placeholder={t("crm_owner_placeholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("crm_owner_none")}</SelectItem>
                {teamMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>{t("crm_cancel")}</Button>
          <Button onClick={() => void handleLink()} disabled={isSaving || !contactId} className="gap-2">
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
            {t("crm_rfq_link_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
