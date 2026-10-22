"use client"

import { useModules } from "@/hooks/useCompanyModules"
import { usePrintProfile } from "@/hooks/usePrintProfile"
import { printedNumber } from "@/lib/company-print-profile"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { RfqCard, type RfqCardRow, type RfqRow } from "@/components/procurement/RfqCard"
import { RfqListFilters } from "@/components/procurement/RfqListFilters"
import { RfqTable } from "@/components/procurement/RfqTable"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { GENERAL_STOCK, WORKSHOP, isBuyer, rfqInScope, rfqNeedSources, type NeedLinkedRfq } from "@/lib/procurement/rfq-view"
import { RFQ_LIST_PAGE, buildRfqRows, defaultView, listCounts, listFacets, listFilterActive, listRfqs, type ListLayout, type ListOffer, type ListView, type RfqListFilter } from "@/lib/procurement/rfq-list"
import { actsOnRfq, ownerReadsRfqs, runsRfqs } from "@/lib/procurement/rfq-access"
import { materialInScope } from "@/lib/procurement/need-desk"
import { useRfqRunner } from "@/hooks/useRfqRunner"
import { RfqExtendDialog, type ExtendTarget } from "@/components/procurement/RfqExtendDialog"
import { RfqLifecycleDialogs, useRfqLifecycle, type LifecycleRfq } from "@/components/procurement/rfq/RfqLifecycleBar"
import { printRfqWithLink, rfqPrintModel } from "@/components/procurement/RfqPrint"
import { guestLinkUrl } from "@/components/procurement/rfq/guestLinkUrl"
import { logRfqDocument } from "@/lib/procurement/rfq-writes"
import { unlinkNeedsFromRfq } from "@/lib/procurement/needs-writes"
import { useSupplierRecipientOptions } from "@/components/contractor/SupplierRecipientsPicker"
import { riyadhDay } from "@/lib/hr/format"
import { rfqDisplayNumber } from "@/lib/procurement/format"
import { projectSiteId } from "@/lib/procurement/delivery-sites"
import { useDeliverySiteList } from "@/hooks/useDeliverySiteList"
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
import { FileSearch, Loader2, Send } from "lucide-react"
import { LinkComposer } from "@/components/procurement/rfq/LinkComposer"
import { MfgPurchaseRequestsPanel } from "@/components/contractor/MfgPurchaseRequestsPanel"
import { RfqOffersSheet, type SheetRfq } from "@/components/contractor/RfqOffersSheet"
import { Link } from "@/i18n/routing"
import { useFirestore, useUser, useMemoFirebase, useCollection } from "@/firebase"
import { collection, query, where, doc, updateDoc, deleteDoc, arrayRemove } from "firebase/firestore"
import { releaseBoqDrawsForRfq } from "@/lib/boq-draws"
import { OFFER_DECISIONS, type DecisionMap, type OfferDecision } from "@/lib/procurement/offer-decisions"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { keyLabel } from "@/lib/materials/subs"
import { useSearchParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { displayCategory, displayCity } from "@/lib/constants"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"

const LAYOUT_KEY = "mdmak.proc.rfqLayout"

function ReopenHost({ rfq, onClose }: { rfq: LifecycleRfq; onClose: () => void }) {
  const state = useRfqLifecycle(rfq)
  const { setDialog } = state
  const opened = useRef(false)
  useEffect(() => setDialog("extend"), [setDialog])
  useEffect(() => {
    if (state.dialog) opened.current = true
    else if (opened.current) onClose()
  }, [state.dialog, onClose])
  return <RfqLifecycleDialogs rfq={rfq} state={state} />
}

type Narrowing = Omit<RfqListFilter, "view">

export default function ContractorRfqsPage() {
  const { on } = useModules()
  const mfgOn = on("manufacturing")
  const pmOn = on("project-management")
  const searchParams = useSearchParams()
  const [narrow, setNarrow] = useState<Narrowing>({ q: searchParams.get("search") || "", site: "", category: "", reach: "", sort: "close" })
  const [chosenView, setChosenView] = useState<ListView | null>(null)
  const [limit, setLimit] = useState(RFQ_LIST_PAGE)
  const [layout, setLayout] = useState<ListLayout>("cards")
  const [deleteTarget, setDeleteTarget] = useState<RfqRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [extendTarget, setExtendTarget] = useState<ExtendTarget | null>(null)
  const [shareTarget, setShareTarget] = useState<RfqRow | null>(null)
  const [reopenTarget, setReopenTarget] = useState<RfqRow | null>(null)
  const [glanceRfq, setGlanceRfq] = useState<SheetRfq | null>(null)
  const t = useTranslations("Portal.Contractor")
  const tp = useTranslations("Portal.Procurement")
  const tl = useTranslations("Portal.Procurement.rfqlist")
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
  const { profile } = useResolvedProfile(isUserLoading ? null : user?.uid)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAYOUT_KEY)
      if (saved === "cards" || saved === "rows") setLayout(saved)
    } catch {
      /* private window or blocked storage: the default layout stays */
    }
  }, [])
  const chooseLayout = (next: ListLayout) => {
    setLayout(next)
    try {
      window.localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      /* the choice just does not outlive the page */
    }
  }

  const urlSearch = searchParams.get("search") || ""
  useEffect(() => {
    setNarrow((n) => (n.q === urlSearch ? n : { ...n, q: urlSearch }))
    setLimit(RFQ_LIST_PAGE)
  }, [urlSearch])

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

  // The org's whole RFQ set (the same query the procurement world listens
  // to, so the SDK shares one listener): every chip, option count and
  // «n من m» counts ALL of them (R-33/R-35); only the cards are paged below.
  const rfqsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "rfqs"), where("organizationId", "==", profile?.organizationId || user.uid))
  }, [firestore, user, isUserLoading, profile?.organizationId])

  // Projects belonging to this org: the name of a project's delivery site when the sites list does not know it.
  const projectsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(collection(firestore, "projects"), where("organizationId", "==", profile?.organizationId || user.uid))
  }, [firestore, user, isUserLoading, profile?.organizationId])
  const { data: projects } = useCollection(projectsQuery)

  const procWorld = useProcurementWorld()
  const { sites } = useDeliverySiteList(procWorld.orgId, pmOn)
  const today = riyadhDay()

  // The buyer's decisions on every offer of the company: the lowest complete offer on a card leaves out what he excluded, exactly
  // as the RFQ page and Today do. Read only by whoever sources — the rules show them to no one else.
  const sources = procWorld.actor.canPrepare || procWorld.actor.canApprove || procWorld.actor.isOwner || can("rfq.manage")
  const decisionsQuery = useMemoFirebase(() => (firestore && procWorld.orgId && sources ? query(collection(firestore, OFFER_DECISIONS), where("organizationId", "==", procWorld.orgId)) : null), [firestore, procWorld.orgId, sources])
  const { data: decisionDocs } = useCollection<OfferDecision>(decisionsQuery)
  const decisions = useMemo<DecisionMap>(() => Object.fromEntries(((decisionDocs || []) as Array<OfferDecision & { id: string }>).map((d) => [d.id, d])), [decisionDocs])

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
    const model = rfqPrintModel(rfq as Parameters<typeof rfqPrintModel>[0], { name: p.companyName || procWorld.orgName || p.name || "", vat: printedNumber(p.taxNumber, print.taxNumber), cr: printedNumber(p.crNumber, print.crNumber) }, rfqDisplayNumber(rfq, locale), displayCity(rfq.city || "", locale))
    const link = actsOn(rfq) ? guestLinkUrl(user, rfq) : Promise.resolve(null)
    if (!(await printRfqWithLink(model, locale, (k, params) => tp(`rfqpo.print.${k}`, params), link))) {
      toast({ title: tp("rfqpo.popup_blocked"), variant: "destructive" })
      return
    }
    if (firestore && actsOn(rfq)) void logRfqDocument(firestore, runner, rfq.id).catch((err) => console.warn("print not logged:", (err as { code?: string })?.code || err))
  }

  const { data: rfqs, isLoading: isCollectionLoading, error } = useCollection(rfqsQuery)
  const isLoading = isUserLoading || (isCollectionLoading && !rfqs && !error)

  // A buyer sees the RFQs he raised (the prototype's `rfqMine`).
  const allRfqs = useMemo(() => ((rfqs || []) as unknown as RfqRow[]).filter((r) => rfqInScope(r, procWorld.actor)), [rfqs, procWorld.actor])
  // His categories still scope the workshop's shortfalls he is asked to buy.
  const buyerCategories = ((profile as { procurementCategories?: string[] } | null)?.procurementCategories) || null
  const shortfallInScope = isBuyer(procWorld.actor) && buyerCategories?.length ? (name: string, unit: string) => materialInScope(name, unit, buyerCategories, procWorld) : undefined

  const { index: treeIndex } = useMaterialTree()
  const categoryLabel = useCallback((key: string) => keyLabel(treeIndex, key, locale, displayCategory), [treeIndex, locale])
  const siteLabel = useCallback(
    (key: string, rfq: RfqRow): string => {
      if (key === GENERAL_STOCK) return tp("rfqpo.list.general_stock")
      if (key === WORKSHOP) return tp("rfqpo.list.workshop")
      const known = sites.find((s) => s.id === key)?.name
      if (known) return known
      const project = ((projects || []) as Array<{ id: string; name?: string }>).find((p) => projectSiteId(p.id) === key)?.name
      if (project) return project
      const line = (rfq.products || []).find((p) => p?.deliverySiteId === key || (p?.projectId && projectSiteId(p.projectId) === key))
      return line?.projectName || (line?.deliveryCity ? displayCity(line.deliveryCity, locale) : "") || tp("rfqpo.list.site_unknown")
    },
    [sites, projects, tp, locale]
  )

  const rows = useMemo(
    () =>
      buildRfqRows<RfqRow>({
        rfqs: allRfqs,
        offers: procWorld.offers as unknown as ListOffer[],
        decisions,
        orders: procWorld.orders,
        today,
        tiePercent: procWorld.policies.tieBandPct,
        locale,
        siteLabel,
        categoryLabel,
      }),
    [allRfqs, procWorld.offers, procWorld.orders, procWorld.policies.tieBandPct, decisions, today, locale, siteLabel, categoryLabel]
  )

  const seesPrices = procWorld.actor.seesPrices
  const filter: RfqListFilter = { ...narrow, view: chosenView ?? defaultView(listCounts(rows, { ...narrow, view: "all" })) }
  const page = listRfqs(rows, filter, today, limit)
  const facets = listFacets(rows, filter)
  const siteNames = useMemo(() => new Map(rows.flatMap((r) => r.siteKeys.map((k, i) => [k, r.siteLabels[i]] as const))), [rows])
  const hasActiveFilters = listFilterActive(filter)

  const onFilter = (next: RfqListFilter) => {
    if (next.view !== filter.view) setChosenView(next.view)
    setNarrow({ q: next.q, site: next.site, category: next.category, reach: next.reach, sort: next.sort })
    setLimit(RFQ_LIST_PAGE)
  }
  const clearFilters = () => onFilter({ ...filter, q: "", site: "", category: "", reach: "" })

  const directSupplierOf = (row: RfqCardRow): string | null => {
    if (!row.direct) return null
    const o = procWorld.offers.find((x) => x.rfqId === row.id && x.status === "مقبول")
    return o?.companyName || o?.supplierName || null
  }

  const openExtend = (rfq: RfqRow) =>
    setExtendTarget({
      id: rfq.id,
      title: rfq.title || "",
      passed: Boolean(rfq.deadline) && String(rfq.deadline).slice(0, 10) < today,
      invited: [...(rfq.allowedSupplierOrgIds || []), ...(rfq.invitedSupplierOrgIds || [])],
      categories: [rfq.category, ...((rfq.products || []) as Array<{ category?: string | null }>).map((p) => p.category)].filter((c): c is string => Boolean(c)),
    })

  const closeReopen = useCallback(() => setReopenTarget(null), [])
  const shareRfq = useMemo(() => (shareTarget ? { id: shareTarget.id, title: shareTarget.title || "" } : null), [shareTarget])

  const emptyView = !isLoading && !error && page.matched === 0
  const nothingAtAll = allRfqs.length === 0

  return (
    <PortalLayout>
      <RfqOffersSheet rfq={glanceRfq} offersHref={glanceRfq ? `/contractor/rfqs/${glanceRfq.id}/offers` : ""} open={glanceRfq !== null} onOpenChange={(o) => !o && setGlanceRfq(null)} />
      <div className="space-y-5">
        <ProcurementHeader
          title={t("rfqv_title")}
          description={t("rfqv_desc")}
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

        {!nothingAtAll && (
          <RfqListFilters
            filter={filter}
            onFilter={onFilter}
            counts={page.counts}
            facets={facets}
            siteLabel={(key) => siteNames.get(key) ?? key}
            categoryLabel={categoryLabel}
            layout={layout}
            onLayout={chooseLayout}
            matched={page.matched}
            total={page.total}
          />
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

        {emptyView && nothingAtAll && (
          <div className="space-y-4 rounded-2xl border border-dashed bg-card p-16 text-center">
            <p className="font-bold text-foreground">{tp("rfqx.empty.title")}</p>
            <p className="text-muted-foreground">{tp("rfqx.empty.none")}</p>
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
          </div>
        )}
        {emptyView && !nothingAtAll && (
          <EmptyState
            icon={FileSearch}
            title={hasActiveFilters ? tl("empty_filtered") : tl(`empty_${filter.view}`)}
            action={
              hasActiveFilters ? (
                <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={clearFilters}>
                  {tl("clear")}
                </Button>
              ) : filter.view !== "all" ? (
                <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => onFilter({ ...filter, view: "all" })}>
                  {tl("show_all")}
                </Button>
              ) : undefined
            }
          />
        )}

        {!isLoading && page.matched > 0 && layout === "cards" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {page.rows.map((row) => (
              <RfqCard
                key={row.id}
                row={row}
                seesPrices={seesPrices}
                canAct={actsOn(row.rfq)}
                canDelete={row.state === "draft" && actsOn(row.rfq)}
                directSupplier={directSupplierOf(row)}
                onGlance={() => setGlanceRfq(row.rfq as SheetRfq)}
                onShare={() => setShareTarget(row.rfq)}
                onDelete={() => setDeleteTarget(row.rfq)}
                onPrint={() => void printOne(row.rfq)}
                onExtend={() => openExtend(row.rfq)}
                onReopen={(r) => setReopenTarget(r.rfq)}
              />
            ))}
          </div>
        )}

        {!isLoading && page.matched > 0 && layout === "rows" && (
          <RfqTable rows={page.rows} seesPrices={seesPrices} canActOn={(row) => actsOn(row.rfq)} onGlance={(row) => setGlanceRfq(row.rfq as SheetRfq)} onReopen={(r) => setReopenTarget(r.rfq)} />
        )}

        {page.more > 0 && (
          <div className="p-2 text-center">
            <Button onClick={() => setLimit((n) => n + RFQ_LIST_PAGE)} variant="outline" className="rounded-xl font-bold">
              {tl("show_more", { count: page.more })}
            </Button>
          </div>
        )}
      </div>

      <LinkComposer
        rfq={shareRfq}
        isOpen={!!shareTarget}
        onClose={() => setShareTarget(null)}
        onPrint={shareTarget ? () => void printOne(shareTarget) : null}
      />

      <RfqExtendDialog target={extendTarget} options={supplierOptions} orgId={procWorld.orgId} onOpenChange={(o) => !o && setExtendTarget(null)} />

      {reopenTarget && <ReopenHost key={reopenTarget.id} rfq={reopenTarget as LifecycleRfq} onClose={closeReopen} />}

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
    </PortalLayout>
  )
}
