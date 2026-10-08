"use client"

import { useModules } from "@/hooks/useCompanyModules"
import { usePrintProfile } from "@/hooks/usePrintProfile"
import { printedNumber } from "@/lib/company-print-profile"
import { useState, useEffect } from "react"
import { useTranslations, useLocale } from 'next-intl'
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { RfqCard } from "@/components/procurement/RfqCard"
import { RfqTable } from "@/components/procurement/RfqTable"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { offersSealed } from "@/lib/procurement/award"
import { DEADLINE_FILTERS, GENERAL_STOCK, RFQ_SEGMENTS, WORKSHOP, bulkDeleteSplit, bulkPublishPatch, estimateAtLastPrice, inRfqSegment, lineProjectNames, offerersByRfq, optionCount, passesFilters, isBuyer, rfqCategories, rfqInScope, rfqNeedSources, rfqPage, rfqProjectKeys, segmentCounts, sortRfqs, type DeadlineFilter, type NeedLinkedRfq, type RfqFilterKey, type RfqFilters, type RfqSegment } from "@/lib/procurement/rfq-view"
import { actsOnRfq, ownerReadsRfqs, runsRfqs } from "@/lib/procurement/rfq-access"
import { materialInScope } from "@/lib/procurement/need-desk"
import { useRfqRunner } from "@/hooks/useRfqRunner"
import { RfqExtendDialog, type ExtendTarget } from "@/components/procurement/RfqExtendDialog"
import { printRfqWithLink, rfqPrintModel } from "@/components/procurement/RfqPrint"
import { guestLinkUrl } from "@/components/procurement/rfq/guestLinkUrl"
import { logRfqDocument } from "@/lib/procurement/rfq-writes"
import { unlinkNeedsFromRfq } from "@/lib/procurement/needs-writes"
import { useSupplierRecipientOptions } from "@/components/contractor/SupplierRecipientsPicker"
import { displayDocNumber } from "@/lib/procurement/format"
import { cn } from "@/lib/utils"
import { matchesSearch } from "@/lib/search-text"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
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
import { Search, Loader2, Send, X, Trash2, LayoutGrid, List } from "lucide-react"
import { ShareRfqLinkDialog } from "@/components/contractor/ShareRfqLinkDialog"
import { MfgPurchaseRequestsPanel } from "@/components/contractor/MfgPurchaseRequestsPanel"
import { RfqOffersSheet, type SheetRfq } from "@/components/contractor/RfqOffersSheet"
import { Link } from "@/i18n/routing"
import { useFirestore, useUser, useMemoFirebase, useCollection } from "@/firebase"
import { collection, query, where, doc, updateDoc, deleteDoc, arrayRemove } from "firebase/firestore"
import { releaseBoqDrawsForRfq } from "@/lib/boq-draws"
import { notifyFavoriteSuppliersOfPublish } from "@/lib/notify-favorites"
import { useSearchParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES, displayCategory, displayCity } from "@/lib/constants"
import type { RfqRow } from "@/components/procurement/RfqCard"
import { getIncompletePublishFields } from "@/utils/publish-gate"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"

export default function ContractorRfqsPage() {
  const { on } = useModules()
  // With Project Management off a project tender is an ordinary RFQ: it opens on the core pages.
  const pmOn = on("project-management")
  const mfgOn = on("manufacturing")
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "")
  const searching = searchQuery.trim().length > 0
  const [segment, setSegment] = useState<RfqSegment>("all")
  const [selectedRfqs, setSelectedRfqs] = useState<string[]>([])
  const [isPublishing, setIsPublishing] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [extendTarget, setExtendTarget] = useState<ExtendTarget | null>(null)
  const [shareTarget, setShareTarget] = useState<any>(null)
  // Offers at a glance: the RFQ whose offers are open side by side (customer review, 27 Sep 2026).
  const [glanceRfq, setGlanceRfq] = useState<SheetRfq | null>(null)
  const [filters, setFilters] = useState<RfqFilters>({})
  const setFilter = (key: RfqFilterKey, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value === "all" ? null : value }))
    setSelectedRfqs([])
    setPages(1)
  }
  const t = useTranslations("Portal.Contractor")
  const tp = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { user, isUserLoading } = useUser()
  const { can } = usePermissions()
  // One gate for running RFQs (rfq-access.ts): whoever runs them, the owner
  // only without staff, a buyer on his own RFQs only.
  const { runner } = useRfqRunner()
  const runs = runsRfqs(runner)
  const ownerReads = ownerReadsRfqs(runner)
  const actsOn = (rfq: RfqRow) => actsOnRfq(rfq, runner)
  const canCreate = runs && (can("rfq.create") || can("projects.publish") || can("offers.accept") || can("po.approve"))
  const [pages, setPages] = useState(1)
  const { profile } = useResolvedProfile(isUserLoading ? null : user?.uid)

  const filtersOn = Object.values(filters).some(Boolean)
  const hasActiveFilters = Boolean(searchQuery) || filtersOn
  const clearFilters = () => {
    setSearchQuery("")
    setFilters({})
    setSelectedRfqs([])
    setPages(1)
  }

  useEffect(() => {
    setSearchQuery(searchParams.get("search") || "")
  }, [searchParams])

const handleBatchPublish = async () => {
    if (isPublishing || !firestore || selectedRfqs.length === 0) return;

    // Gate: profile must have mandatory fields filled before publishing
    const missingFields = getIncompletePublishFields(profile, locale)
    if (missingFields.length > 0) {
      toast({
        title: t("rfqs_profile_incomplete_title"),
        description: t("rfqs_profile_incomplete_desc", { fields: missingFields.join(locale === "ar" ? "، " : ", ") }),
        variant: "destructive",
      })
      return
    }

    const candidates = filteredRfqs.filter((rfq: any) => selectedRfqs.includes(rfq.id) && actsOn(rfq));
    const eligible = candidates.filter((rfq: any) => rfq.status === "Draft");
    const skipped = selectedRfqs.length - eligible.length;
    if (eligible.length === 0) {
      toast({ title: t("rfq_bulk_publish_none_eligible"), variant: "destructive" });
      return
    }

    setIsPublishing(true);
    let published = 0;
    const failedIds: string[] = [];
    const publicIds: string[] = [];
    for (const rfq of eligible) {
      // A private draft stays private: publishing never widens its audience.
      const patch = bulkPublishPatch(rfq, new Date().toISOString())
      if (!patch) continue
      try {
        await updateDoc(doc(firestore, "rfqs", rfq.id), patch);
        published++;
        if (patch.visibility === "public") publicIds.push(rfq.id)
      } catch (error) {
        console.error(error)
        failedIds.push(rfq.id)
      }
    }
    toast({
      title: t("rfq_batch_publish_title"),
      description: t("rfq_bulk_publish_result", { published, skipped })
        + (failedIds.length > 0 ? t("rfq_bulk_publish_failed_suffix", { failed: failedIds.length }) : ""),
      variant: failedIds.length > 0 ? "destructive" : undefined,
    });
    void notifyFavoriteSuppliersOfPublish(user, publicIds)
    // Keep failed items selected so the user can retry; drop everything else.
    setSelectedRfqs(failedIds);
    setIsPublishing(false);
  };

  const toggleSelectRfq = (id: string) => {
    setSelectedRfqs(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    const allIds = filteredRfqs.filter((rfq: any) => actsOn(rfq)).map((rfq: any) => rfq.id);
    setSelectedRfqs(prev => prev.length === allIds.length ? [] : allIds);
  };

  const handleBatchDelete = async () => {
    if (isBulkDeleting || !firestore) return
    const candidates = filteredRfqs.filter((rfq: any) => selectedRfqs.includes(rfq.id) && actsOn(rfq));
    // Only a draft is deleted. A published RFQ may already hold offers: it is
    // withdrawn with «ألغِ الطلب» and a reason on its own page, never erased.
    const { drafts: eligible, toCancel } = bulkDeleteSplit(candidates as RfqRow[])
    const skipped = selectedRfqs.length - eligible.length;
    if (eligible.length === 0) {
      toast({ title: t("rfq_bulk_delete_none_eligible"), description: toCancel.length ? tp("rfqx.bulk.cancel_instead", { count: toCancel.length }) : undefined, variant: "destructive" });
      setShowBulkDeleteDialog(false)
      return
    }

    setIsBulkDeleting(true)
    let deleted = 0
    const failedIds: string[] = []
    for (const rfq of eligible) {
      try {
        if (rfq.projectId) {
          // Hand the RFQ's BOQ draws back before it goes.
          await releaseBoqDrawsForRfq(firestore, rfq.projectId, rfq.id)
          await updateDoc(doc(firestore, "projects", rfq.projectId), { rfqIds: arrayRemove(rfq.id) })
        }
        await unlinkNeedsFromRfq(firestore, rfq.id, rfqNeedSources(rfq as NeedLinkedRfq))
        await deleteDoc(doc(firestore, "rfqs", rfq.id))
        deleted++
      } catch (error) {
        console.error(error)
        failedIds.push(rfq.id)
      }
    }
    toast({
      title: t("rfq_delete_success"),
      description: t("rfq_bulk_delete_result", { deleted, skipped })
        + (failedIds.length > 0 ? t("rfq_bulk_delete_failed_suffix", { failed: failedIds.length }) : "")
        + (toCancel.length > 0 ? ` — ${tp("rfqx.bulk.cancel_instead", { count: toCancel.length })}` : ""),
      variant: failedIds.length > 0 ? "destructive" : undefined,
    })
    // Keep failed items selected so the user can retry; drop everything else.
    setSelectedRfqs(failedIds)
    setIsBulkDeleting(false)
    setShowBulkDeleteDialog(false)
  };

  const handleDelete = async () => {
    if (!firestore || !deleteTarget || deleteTarget.status !== "Draft") return
    setIsDeleting(true)
    try {
      // Hand the tender's BOQ draws back before deleting it — matches the
      // Firestore rule's allowed "release" transition on a locked row.
      if (deleteTarget.projectId) {
        await releaseBoqDrawsForRfq(firestore, deleteTarget.projectId, deleteTarget.id)
        await updateDoc(doc(firestore, "projects", deleteTarget.projectId), { rfqIds: arrayRemove(deleteTarget.id) })
      }
      // Its needs go back to the desk before it goes (R-19).
      const stuck = await unlinkNeedsFromRfq(firestore, deleteTarget.id, rfqNeedSources(deleteTarget as NeedLinkedRfq))

      await deleteDoc(doc(firestore, "rfqs", deleteTarget.id))
      toast({
        title: t("rfq_delete_success"),
        description: stuck > 0 ? tp("p2c.rfq.needs_not_released", { count: stuck }) : undefined,
      })
      setDeleteTarget(null)
    } catch (error) {
      console.error(error)
      toast({
        title: t("rfq_delete_failed"),
        variant: "destructive"
      })
    } finally {
      setIsDeleting(false)
    }
  }

  // الإصلاح: منع إرسال الاستعلام حتى يكتمل تحميل حالة المستخدم من Firebase Auth
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null;
    
    // The org's whole RFQ set (the same query the procurement world listens
    // to, so the SDK shares one listener): every chip, option count and
    // «n من m» counts ALL of them (R-33/R-35); only the cards are paged below.
    return query(collection(firestore, "rfqs"), where("organizationId", "==", profile?.organizationId || user.uid))
  }, [firestore, user, isUserLoading, profile?.organizationId])

  // Projects belonging to this org, used only to populate the project filter dropdown.
  const projectsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "projects"),
      where("organizationId", "==", profile?.organizationId || user.uid)
    )
  }, [firestore, user, isUserLoading, profile?.organizationId])
  const { data: projects } = useCollection(projectsQuery)
  const projectNameOf = (id: string | null | undefined): string | null => (id ? ((projects || []).find((p: any) => p.id === id) as { name?: string } | undefined)?.name ?? null : null)
  const labelOfKey = (key: string, carried?: string | null): string => {
    if (key === GENERAL_STOCK) return tp("rfqpo.list.general_stock")
    if (key === WORKSHOP) return tp("rfqpo.list.workshop")
    return projectNameOf(key) || carried || tp("rfqpo.list.project_unknown")
  }
  // One label per place its lines are charged to (R-35).
  const projectLabels = (rfq: RfqRow): string[] => {
    const carried = lineProjectNames(rfq)
    return rfqProjectKeys(rfq).map((k) => labelOfKey(k, carried.get(k)))
  }
  const projectLabel = (rfq: RfqRow): string => projectLabels(rfq).join(" · ")
  // Sealed rounds and the estimate at the last price paid (the prototype's list).
  const procWorld = useProcurementWorld()
  const { history: priceHistory } = useProcurementPrices(procWorld.orgId)
  const [now] = useState(() => new Date())
  const projectOptions = (projects || [])
    .map((p: any) => ({ value: p.id, label: p.name || p.id }))
    .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, locale === "ar" ? "ar" : "en"))

  const acceptedOffersQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "offers"),
      // The org's accepted offers, not only those on tenders this member
      // created — a colleague's awarded tender must not become editable.
      where("contractorOrgId", "==", profile?.organizationId || user.uid),
      where("status", "==", "مقبول")
    )
  }, [firestore, user, isUserLoading, profile?.organizationId])

  const { data: acceptedOffers } = useCollection(acceptedOffersQuery)
  const acceptedRfqIds = new Set((acceptedOffers || []).map((o: any) => o.rfqId))
  const directSupplierOf = (rfq: RfqRow): string | null => {
    if (!rfq.directAward) return null
    const o = (acceptedOffers || []).find((x: any) => x.rfqId === rfq.id) as { supplierName?: string; companyName?: string } | undefined
    return o?.companyName || o?.supplierName || null
  }

  // Who an extension can still invite: the connected suppliers and favourites (as the form's private list).
  const linksQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "contractorSupplierLinks"), where("contractorOrgId", "==", profile?.organizationId || user.uid), where("status", "==", "active"))
  }, [firestore, user, isUserLoading, profile?.organizationId])
  const { data: supplierLinks } = useCollection(linksQuery)
  const supplierOptions = useSupplierRecipientOptions(supplierLinks as any[], ((profile as { favoriteSuppliers?: string[] } | null)?.favoriteSuppliers) || [], t("suppliers_registered_supplier"))

  // The document carries the guest link when the round has one, and the RFQ's log says it went out (R-39).
  const print = usePrintProfile()
  const printOne = async (rfq: RfqRow) => {
    const p = (profile || {}) as { companyName?: string; name?: string; taxNumber?: string; crNumber?: string }
    const number = rfq.rfqNumber ? displayDocNumber(rfq.rfqNumber, locale) : `#${rfq.id.slice(0, 6)}`
    const model = rfqPrintModel(rfq as Parameters<typeof rfqPrintModel>[0], { name: p.companyName || procWorld.orgName || p.name || "", vat: printedNumber(p.taxNumber, print.taxNumber), cr: printedNumber(p.crNumber, print.crNumber) }, number, displayCity(rfq.city || "", locale), procWorld.policies)
    const link = actsOn(rfq) ? guestLinkUrl(user, rfq) : Promise.resolve(null)
    if (!(await printRfqWithLink(model, locale, (k, params) => tp(`rfqpo.print.${k}`, params), link))) {
      toast({ title: tp("rfqpo.popup_blocked"), variant: "destructive" })
      return
    }
    if (firestore && actsOn(rfq)) void logRfqDocument(firestore, runner, rfq.id).catch((err) => console.warn("print not logged:", (err as { code?: string })?.code || err))
  }

  const { data: rfqs, isLoading: isCollectionLoading, error } = useCollection(rfqsQuery)
  const isLoading = isUserLoading || (isCollectionLoading && !rfqs && !error)

  // Every status is loaded so the chips can count; the chip filters here. A
  // search looks in every status: whoever types a tender's name does not know
  // — and should not need to know — whether it is a draft or awarded. A buyer
  // sees the RFQs he raised (the prototype's `rfqMine`).
  const allRfqs = ((rfqs || []) as RfqRow[]).filter((r) => rfqInScope(r, procWorld.actor))
  // His categories still scope the workshop's shortfalls he is asked to buy.
  const buyerCategories = ((profile as { procurementCategories?: string[] } | null)?.procurementCategories) || null
  const shortfallInScope = isBuyer(procWorld.actor) && buyerCategories?.length ? (name: string, unit: string) => materialInScope(name, unit, buyerCategories, procWorld) : undefined
  const counts = segmentCounts(allRfqs, filters, now)
  // A supplier's name finds the RFQs he offered on (R-10).
  const offerers = offerersByRfq(procWorld.offers)
  const filteredRfqs = sortRfqs((allRfqs as any[]).filter((rfq: any) => {
    if (!searching && !inRfqSegment(rfq, segment)) return false
    if (!passesFilters(rfq, filters, now)) return false
    if (searching && !matchesSearch(searchQuery, [rfq.title, rfq.rfqNumber, rfq.rfqNumber ? displayDocNumber(rfq.rfqNumber, locale) : null, rfq.category, rfq.subCategory, rfq.city, rfq.id, rfq.description, ...projectLabels(rfq), directSupplierOf(rfq), ...(offerers.get(rfq.id) || []), ...(Array.isArray(rfq.products) ? rfq.products.map((p: { name?: string; description?: string }) => p?.name || p?.description) : [])])) {
      return false
    }
    return true
  }))
  const { shown: shownRfqs, hasMore } = rfqPage(filteredRfqs, pages)

  const projectKeys = Array.from(new Set(allRfqs.flatMap((r) => rfqProjectKeys(r))))
  const filterOptions: Record<RfqFilterKey, Array<{ value: string; label: string }>> = {
    project: [
      ...projectOptions.map((o: { value: string; label: string }) => o),
      { value: GENERAL_STOCK, label: tp("rfqpo.list.general_stock") },
      { value: WORKSHOP, label: tp("rfqpo.list.workshop") },
      ...projectKeys.filter((k) => k !== GENERAL_STOCK && k !== WORKSHOP && !projectOptions.some((o: { value: string }) => o.value === k)).map((k) => ({ value: k, label: labelOfKey(k, allRfqs.map((r) => lineProjectNames(r).get(k)).find(Boolean)) })),
    ],
    category: Array.from(new Set([...PREDEFINED_CATEGORIES, ...allRfqs.flatMap((r) => rfqCategories(r))])).map((c) => ({ value: c, label: displayCategory(c, locale) })),
    city: Array.from(new Set([...SAUDI_CITIES, ...allRfqs.map((r) => r.city || "").filter(Boolean)])).map((c) => ({ value: c, label: displayCity(c, locale) })),
    deadline: DEADLINE_FILTERS.map((d: DeadlineFilter) => ({ value: d, label: tp(`rfqpo.list.deadline_${d}`) })),
  }
  const ALL_LABEL: Record<RfqFilterKey, string> = { project: t("rfq_all_projects"), category: t("rfq_all_categories"), city: t("rfq_all_cities"), deadline: t("rfq_all_deadlines") }
  // The prototype keeps an option only while it would leave something —
  // except projects and deadlines, and whatever is picked now.
  const optionsFor = (key: RfqFilterKey) =>
    filterOptions[key]
      .map((o) => ({ ...o, n: optionCount(allRfqs, segment, filters, key, o.value, now) }))
      .filter((o) => o.n > 0 || key === "project" || key === "deadline" || filters[key] === o.value)

  const canEdit = (rfq: any) => {
    if (rfq.status === "Awarded") return false
    if (acceptedRfqIds.has(rfq.id)) return false
    return true
  }

  const canDelete = (rfq: any) => rfq.status === "Draft" && actsOn(rfq)

  const glanceHref = glanceRfq ? (glanceRfq.projectId && pmOn ? `/contractor/projects/${glanceRfq.projectId}/tenders/${glanceRfq.id}/offers` : `/contractor/rfqs/${glanceRfq.id}/offers`) : ""

  return (
    <PortalLayout>
      <RfqOffersSheet rfq={glanceRfq} offersHref={glanceHref} open={glanceRfq !== null} onOpenChange={(o) => !o && setGlanceRfq(null)} />
      <div className="space-y-5">
        <ProcurementHeader
          title={t("rfqv_title")}
          description={t("rfqv_desc", { sealed: procWorld.policies.sealOffersUntilDeadline ? 1 : 0 })}
          action={
            canCreate ? (
              <Button asChild className="gap-2 rounded-xl bg-module text-module-foreground hover:bg-module/90">
                <Link href="/contractor/rfqs/new">
                  <Send size={16} aria-hidden="true" />
                  {t("rfqv_new")}
                </Link>
              </Button>
            ) : ownerReads ? (
              <span className="text-xs font-semibold text-muted-foreground">{tp("rfqx.owner_reads")}</span>
            ) : null
          }
        />

        {/* Manufacturing's material shortfalls and supplier claims — shown to whoever runs RFQs, who acts on them here (MAT-05) */}
        {canCreate && mfgOn && (
          <MfgPurchaseRequestsPanel
            canStartRfq={canCreate}
            canMarkArrived={can("rfq.manage") || can("warehouses.manage")}
            canClaim={canCreate}
            inScope={shortfallInScope}
          />
        )}

        {/* Status chips with their counts · the view toggle (the prototype's list head). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className={cn("inline-flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1", searching && "opacity-60")} role="group" aria-label={t("rfq_status_filter")}>
            {RFQ_SEGMENTS.map((chip) => {
              const on = segment === chip && !searching
              return (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setSearchQuery("")
                    setSegment(chip)
                    setSelectedRfqs([])
                    setPages(1)
                  }}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "bg-module/10 text-module" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(`rfqv_chip_${({ all: "all", draft: "Draft", open: "New", done: "Awarded" } as const)[chip]}`)}
                  <span className="text-xs tabular-nums">{counts[chip]}</span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} aria-hidden="true" />
              <Input placeholder={t("rfq_search_placeholder")} value={searchQuery} onChange={(e) => {
                setSearchQuery(e.target.value)
                setPages(1)
              }} className="h-9 w-full rounded-xl bg-card ps-9 sm:w-60" aria-label={t("rfq_search_placeholder")} />
            </div>
            <div className="flex items-center rounded-xl border bg-card p-1">
              {(["grid", "list"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  title={t(mode === "grid" ? "rfqv_view_cards" : "rfqv_view_list")}
                  aria-label={t(mode === "grid" ? "rfqv_view_cards" : "rfqv_view_list")}
                  aria-pressed={viewMode === mode}
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    viewMode === mode ? "bg-module/10 text-module" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode === "grid" ? <LayoutGrid size={15} aria-hidden="true" /> : <List size={15} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filters · how many are shown */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto lg:min-w-[720px]">
            {(["project", "category", "city", "deadline"] as const).map((key) => (
              <SearchableSelect
                key={key}
                size="md"
                value={filters[key] || "all"}
                onChange={(v) => setFilter(key, v)}
                options={[{ value: "all", label: ALL_LABEL[key] }, ...optionsFor(key).map((o) => ({ value: o.value, label: `${o.label} · ${o.n}` }))]}
                placeholder={ALL_LABEL[key]}
                searchPlaceholder={ALL_LABEL[key]}
                noResultsText={t("newrfq_no_results")}
                ariaLabel={ALL_LABEL[key]}
              />
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded font-semibold hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X size={12} aria-hidden="true" />
                {t("rfq_clear_filters")}
              </button>
            )}
            <span>{t("rfqv_shown", { shown: filteredRfqs.length, total: allRfqs.length })}</span>
          </div>
        </div>

        {/* Bulk actions — the list view carries the selection. */}
        {selectedRfqs.length > 0 && runs && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-module/30 bg-module/5 px-3 py-2">
            {filteredRfqs.some((r: any) => selectedRfqs.includes(r.id) && r.status === "Draft") && (
              <Button onClick={handleBatchPublish} disabled={isPublishing} size="sm" className="gap-2 rounded-lg bg-module text-module-foreground hover:bg-module/90">
                {isPublishing ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                {t("rfq_batch_publish", { count: selectedRfqs.length })}
              </Button>
            )}
            <Button onClick={() => setShowBulkDeleteDialog(true)} disabled={isBulkDeleting} variant="outline" size="sm" className="gap-2 rounded-lg border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive">
              <Trash2 size={14} />
              {t("rfq_delete_selected", { count: selectedRfqs.length })}
            </Button>
            <Button onClick={() => setSelectedRfqs([])} variant="ghost" size="sm" className="gap-2 rounded-lg text-muted-foreground">
              <X size={14} />
              {t("rfq_deselect_all")}
            </Button>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center gap-4 p-20 text-muted-foreground">
            <Loader2 className="animate-spin" size={40} />
            <p>{t("rfq_loading")}</p>
          </div>
        )}
        {error && (
          <div className="space-y-4 rounded-xl border border-destructive/20 bg-destructive/5 p-10 text-center">
            <p className="font-bold text-destructive">{t("rfq_error_fetching")}</p>
            {process.env.NODE_ENV === "development" && <p className="break-all text-sm text-destructive/80" dir="ltr">{error.message}</p>}
          </div>
        )}
        {!isLoading && !error && filteredRfqs.length === 0 && (
          <div className="space-y-4 rounded-2xl border border-dashed bg-card p-16 text-center">
            <p className="font-bold text-foreground">{tp("rfqx.empty.title")}</p>
            <p className="text-muted-foreground">{hasActiveFilters ? tp("rfqx.empty.filtered") : tp("rfqx.empty.none")}</p>
            {hasActiveFilters && (
              <Button type="button" variant="outline" className="rounded-xl" onClick={clearFilters}>
                {t("rfq_clear_filters")}
              </Button>
            )}
            {!hasActiveFilters && (
              <div className="flex flex-wrap items-center justify-center gap-3">
                {canCreate && (
                  <Button asChild className="gap-2 rounded-xl bg-module text-module-foreground hover:bg-module/90">
                    <Link href="/contractor/rfqs/new">
                      <Send size={16} />
                      {t("rfqv_new")}
                    </Link>
                  </Button>
                )}
                <Button asChild variant="outline" className="rounded-xl">
                  <Link href="/contractor/rfqs/requests">{tp("rfqx.empty.incoming")}</Link>
                </Button>
              </div>
            )}
          </div>
        )}

        {!isLoading && filteredRfqs.length > 0 && viewMode === "grid" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {shownRfqs.map((rfq: any) => {
              const offersHref = rfq.projectId && pmOn ? `/contractor/projects/${rfq.projectId}/tenders/${rfq.id}/offers` : `/contractor/rfqs/${rfq.id}/offers`
              const editHref = rfq.projectId && pmOn ? `/contractor/projects/${rfq.projectId}/tenders/new?edit=${rfq.id}` : `/contractor/rfqs/new?edit=${rfq.id}`
              return (
                <RfqCard
                  key={rfq.id}
                  rfq={rfq}
                  projectLabels={projectLabels(rfq)}
                  sealed={offersSealed(rfq, procWorld.policies, now)}
                  now={now}
                  offersHref={offersHref}
                  editHref={editHref}
                  directSupplier={directSupplierOf(rfq)}
                  canManage={actsOn(rfq) && canEdit(rfq)}
                  canDelete={canDelete(rfq)}
                  onGlance={() => setGlanceRfq(rfq)}
                  onShare={() => setShareTarget(rfq)}
                  onDelete={() => setDeleteTarget(rfq)}
                  onPrint={() => void printOne(rfq)}
                  onExtend={() =>
                    setExtendTarget({
                      id: rfq.id,
                      title: rfq.title || "",
                      passed: Boolean(rfq.deadline) && String(rfq.deadline).slice(0, 10) < new Date().toISOString().slice(0, 10),
                      invited: [...(rfq.allowedSupplierOrgIds || []), ...(rfq.invitedSupplierOrgIds || [])],
                      categories: [rfq.category, ...((rfq.products || []) as Array<{ category?: string }>).map((p) => p.category)].filter((c): c is string => Boolean(c)),
                    })
                  }
                />
              )
            })}
          </div>
        )}

        {!isLoading && filteredRfqs.length > 0 && viewMode === "list" && (
          <RfqTable
            rows={shownRfqs.map((rfq: any) => ({
              rfq,
              projectLabel: projectLabel(rfq),
              sealed: offersSealed(rfq, procWorld.policies, now),
              estimate: procWorld.actor.seesPrices ? estimateAtLastPrice(rfq, priceHistory) : null,
              directSupplier: directSupplierOf(rfq),
            }))}
            now={now}
            seesPrices={procWorld.actor.seesPrices}
            selected={selectedRfqs}
            selectable={(rfq) => actsOn(rfq)}
            hrefOf={(rfq) => (rfq.projectId && pmOn ? `/contractor/projects/${rfq.projectId}/tenders/${rfq.id}/offers` : `/contractor/rfqs/${rfq.id}/offers`)}
            onToggle={toggleSelectRfq}
            onToggleAll={selectAll}
            onGlance={(rfq) => setGlanceRfq(rfq as SheetRfq)}
          />
        )}

        {hasMore && (
          <div className="p-2 text-center">
            <Button onClick={() => setPages((n) => n + 1)} variant="outline" className="rounded-xl font-bold">
              {t("rfq_load_more")}
            </Button>
          </div>
        )}
      </div>

      <ShareRfqLinkDialog
        rfq={shareTarget}
        isOpen={!!shareTarget}
        onClose={() => setShareTarget(null)}
        onPrint={shareTarget ? () => void printOne(shareTarget) : null}
      />

      <RfqExtendDialog target={extendTarget} actor={runner} options={supplierOptions} orgId={procWorld.orgId} onOpenChange={(o) => !o && setExtendTarget(null)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rfq_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rfq_delete_confirm_desc", { title: deleteTarget?.title || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="animate-spin" size={14} /> : null}
              {t("rfq_delete_tender")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBulkDeleteDialog} onOpenChange={(open) => !open && setShowBulkDeleteDialog(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rfq_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rfq_bulk_delete_confirm_desc", { count: selectedRfqs.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBatchDelete}
              disabled={isBulkDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isBulkDeleting ? <Loader2 className="animate-spin" size={14} /> : null}
              {t("rfq_delete_selected", { count: selectedRfqs.length })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  )
}