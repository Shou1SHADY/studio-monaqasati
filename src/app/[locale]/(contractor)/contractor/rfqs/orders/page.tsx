"use client"

// Purchase orders (PRD 3.0 §7, tab 4): five segments with counts, a search
// that spans them, five columns, and the drawer. `?filter=<segment>` picks
// the segment and `?po=<id>` opens one order — the links notifications and
// Today use. Every figure is derived on render from the world; the page
// stores nothing.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { collection, query, where } from "firebase/firestore"
import { ClipboardList, FileSpreadsheet, LayoutGrid, Loader2 } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { PoDrawer } from "@/components/procurement/PoDrawer"
import { AccountantExportDialog } from "@/components/procurement/AccountantExportDialog"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Button } from "@/components/ui/button"
import { Money, PoStatusPill, PoTags, WhoTag, useStepSentence } from "@/components/procurement/PoBits"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DEFAULT_SEGMENT, PO_SEGMENTS, segmentCounts, segmentOf, visibleOrders, type PoSegment } from "@/components/procurement/PoModel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useModules } from "@/hooks/useCompanyModules"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { displayPoNumber } from "@/lib/procurement/format"
import { NO_SITE, inSiteFilter, orderSiteIds } from "@/lib/procurement/site-counts"
import { useDeliverySiteList } from "@/hooks/useDeliverySiteList"
import { poCommitment } from "@/lib/procurement/po"
import { advanceState, asX, inProjectFilter, netQuantity, openHolds, poProjectKeys } from "@/lib/procurement/po-extras"
import { lineUnitName, poNextStep, poSiteOf, type PoStateCtx } from "@/lib/procurement/po-state"
import type { StepNotice } from "@/lib/procurement/next-step"
import { GENERAL_STOCK, WORKSHOP, poInScope } from "@/lib/procurement/rfq-view"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { cn } from "@/lib/utils"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"

/** Keeps `?filter=` and `?po=` in the address bar without a navigation. */
function replaceParams(update: (params: URLSearchParams) => void) {
  try {
    const url = new URL(window.location.href)
    update(url.searchParams)
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  } catch {
    /* not in a browser */
  }
}

export default function PurchaseOrdersPage() {
  const t = useTranslations("Portal.ProcOrders")
  const locale = useLocale()
  const world = useProcurementWorld()
  const { actor, loading } = world
  const tp = useTranslations("Portal.Procurement")
  // A buyer sees the orders he prepared, and those in his categories (R-18).
  const { profile } = useResolvedProfile(actor.uid || null)
  const buyerCategories = ((profile as { procurementCategories?: string[] } | null)?.procurementCategories) || null
  const orders = useMemo(() => world.orders.filter((o) => poInScope(o, actor, buyerCategories)), [world.orders, actor, buyerCategories])
  const searchParams = useSearchParams()
  const [now] = useState(() => new Date())

  const filterParam = searchParams?.get("filter")
  const [segment, setSegment] = useState<PoSegment>(() => segmentOf(filterParam) ?? DEFAULT_SEGMENT)
  // The page's one search is the header's (review 2 #1): it filters this list live through `?search=` — and the expediter
  // lands here with it from another tab (P-09). Picking a segment drops it, as the old box did.
  const search = searchParams?.get("search") ?? ""
  const searching = search.trim().length > 0
  const pick = (s: PoSegment) => {
    setSegment(s)
    replaceParams((p) => {
      p.delete("search")
      if (s === DEFAULT_SEGMENT) p.delete("filter")
      else p.set("filter", s)
    })
  }

  // The project filter (the prototype's "all projects"): a line may serve its
  // own project, so an order answers to every project its lines serve — and to
  // general stock or the workshop when a line serves no project. The segment
  // counts are taken after it, as the prototype's are.
  const firestore = useFirestore()
  const { on } = useModules()
  const pmOn = on("project-management")
  // Without Finance the books live in another system: «صدّر للمحاسبة» hands the accountant a file (PUR-10).
  const exportsToAccountant = !on("payments") && actor.seesPrices && (actor.isOwner || actor.canPrepare || actor.canApprove)
  const [exporting, setExporting] = useState(false)
  const projectsQ = useMemoFirebase(() => (firestore && world.orgId && pmOn ? query(collection(firestore, "projects"), where("organizationId", "==", world.orgId)) : null), [firestore, world.orgId, pmOn])
  const { data: projectDocs } = useCollection<{ name?: string }>(projectsQ)
  const projectNames = useMemo(() => new Map((projectDocs || []).map((p) => [p.id, p.name || ""])), [projectDocs])
  const keysById = useMemo(() => new Map(orders.map((o) => [o.id, poProjectKeys(o, world.rfqs as Array<{ id: string; products?: Array<{ projectId?: string | null }> | null }>)])), [orders, world.rfqs])
  const keysOf = (o: PurchaseOrder) => (pmOn ? keysById.get(o.id) || [] : siteIdsById.get(o.id) || [])
  const projectLabel = (key: string): string => {
    if (!pmOn) return siteLabel(key)
    if (key === GENERAL_STOCK) return tp("rfqpo.list.general_stock")
    if (key === WORKSHOP) return tp("rfqpo.list.workshop")
    return projectNames.get(key) || orders.find((o) => o.projectId === key)?.projectName || tp("rfqpo.list.project_unknown")
  }
  const [project, setProject] = useState("all")
  const projectOptions = useMemo(() => Array.from(new Set(Array.from(keysById.values()).flat().filter((k) => k !== GENERAL_STOCK && k !== WORKSHOP))), [keysById])
  // Without Project Management the list answers to the delivery site instead of the project (PUR-10).
  const { sites: siteList } = useDeliverySiteList(world.orgId, pmOn, !pmOn)
  const siteIdsById = useMemo(() => new Map(orders.map((o) => [o.id, orderSiteIds(o, world.rfqs as Array<{ id: string; products?: Array<{ deliverySiteId?: string | null }> | null }>)])), [orders, world.rfqs])
  const siteOptions = useMemo(() => Array.from(new Set(Array.from(siteIdsById.values()).flat())), [siteIdsById])
  const siteLabel = (id: string) => siteList.find((x) => x.id === id)?.name || tp("rfqpo.list.site_unknown")
  const [site, setSite] = useState("all")
  const inProject = useMemo(
    () => orders.filter((o) => (pmOn ? inProjectFilter(keysById.get(o.id) || [], project) : inSiteFilter(siteIdsById.get(o.id) || [], site))),
    [orders, keysById, project, pmOn, siteIdsById, site]
  )

  const notices = world.deliveries
  const financeOn = on("payments")
  const stateCtx = useMemo<PoStateCtx>(() => ({ notices: notices as StepNotice[], financeOn, acceptanceDays: world.policies.supplierAcceptanceDays, now }), [notices, financeOn, world.policies.supplierAcceptanceDays, now])
  const stepText = useStepSentence()
  const counts = useMemo(() => segmentCounts(inProject, stateCtx), [inProject, stateCtx])
  const shown = useMemo(() => visibleOrders(inProject, segment, search, stateCtx, (n) => displayPoNumber(n, locale)), [inProject, segment, search, stateCtx, locale])

  // `?po=<id>` opens the drawer; opening and closing keep the address in step,
  // so a refresh lands on the same order and a copied link opens it.
  const poParam = searchParams?.get("po") || null
  const [openId, setOpenId] = useState<string | null>(poParam)
  useEffect(() => {
    if (poParam) setOpenId(poParam)
  }, [poParam])
  const openOrder = world.orders.find((o) => o.id === openId) || null
  const show = (id: string | null) => {
    setOpenId(id)
    replaceParams((p) => (id ? p.set("po", id) : p.delete("po")))
  }

  const supplierSub = (po: PurchaseOrder): string => {
    if (po.isGuestSupplier) return t("supplier_tag.off")
    return world.supplierFacts.get(po.supplierOrgId)?.verified === false ? t("supplier_tag.unverified") : ""
  }
  const siteText = (po: PurchaseOrder): string => {
    const site = poSiteOf(po)
    return site ? [site.name, site.district].filter(Boolean).join(" — ") : "—"
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <ProcurementHeader title={t("title")} description={t("desc")} />

        {/* The segments with their counts · a search that spans every segment · the project (the prototype's list head). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ProcChipGroup
            items={PO_SEGMENTS.map((s) => ({ id: s, label: t(`seg.${s}`), count: counts[s] }))}
            active={segment}
            onPick={pick}
            label={t("segments_label")}
            dimmed={searching}
          />
          <div className="flex flex-wrap items-center gap-2">
            {exportsToAccountant && (
              <Button variant="outline" className="h-10 gap-1.5 rounded-xl" onClick={() => setExporting(true)}>
                <FileSpreadsheet size={15} aria-hidden="true" />
                {t("export.open")}
              </Button>
            )}
            {!pmOn && (siteOptions.length > 0 || site !== "all") && (
              <Select value={site} onValueChange={setSite}>
                <SelectTrigger className="h-10 w-48 rounded-xl bg-card text-sm" aria-label={t("site_filter")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("site_all")}</SelectItem>
                  {siteOptions
                    .map((id) => ({ id, name: siteLabel(id) }))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                      </SelectItem>
                    ))}
                  <SelectItem value={NO_SITE}>{t("site_none")}</SelectItem>
                </SelectContent>
              </Select>
            )}
            {pmOn && (
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger className="h-10 w-48 rounded-xl bg-card text-sm" aria-label={t("project_filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("project_all")}</SelectItem>
                {projectOptions
                  .map((id) => ({ id, name: projectLabel(id) }))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                <SelectItem value={GENERAL_STOCK}>{tp("rfqpo.list.general_stock")}</SelectItem>
                <SelectItem value={WORKSHOP}>{tp("rfqpo.list.workshop")}</SelectItem>
              </SelectContent>
            </Select>
            )}
          </div>
        </div>

        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="animate-spin text-muted-foreground" size={28} aria-label={t("loading")} />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon={ClipboardList} title={searching ? t("empty_search", { term: search.trim() }) : t(`empty.${segment}`)} description={searching ? t("empty_search_hint") : t(`empty_hint.${segment}`)} />
        ) : (
          <>
            {/* Desktop: the table — order · supplier · location · value · next step · who we wait on (the prototype's columns) */}
            <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm md:block">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.order")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.supplier")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.location")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.value")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.next")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.who")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((po) => {
                    const next = poNextStep(po, stateCtx)
                    return (
                      <tr
                        key={po.id}
                        tabIndex={0}
                        role="button"
                        onClick={() => show(po.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            show(po.id)
                          }
                        }}
                        className="cursor-pointer transition-colors hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none"
                      >
                        <td className="px-4 py-3 align-top">
                          <span dir="ltr" className="font-black tabular-nums">
                            {displayPoNumber(po.docNumber, locale)}
                          </span>
                          <PoTags po={po} policies={world.policies} className="mt-1" />
                          <ProjectChips keys={keysOf(po)} label={projectLabel} />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <p className="font-bold" dir="auto">
                            {po.supplierName}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{supplierSub(po)}</p>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-muted-foreground" dir="auto">
                          {siteText(po)}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <ValueCell po={po} masked={!actor.seesPrices} />
                        </td>
                        <td className="max-w-[340px] px-4 py-3 align-top text-xs">
                          <p className="leading-relaxed" dir="auto">
                            {stepText(next)}
                          </p>
                          <PoStatusPill po={po} now={now} notices={notices} className="mt-1" />
                          <RowNotes po={po} />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <WhoTag who={next.state.who} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards */}
            <ul className="space-y-2 md:hidden">
              {shown.map((po) => {
                const next = poNextStep(po, stateCtx)
                return (
                  <li key={po.id}>
                    <button
                      type="button"
                      onClick={() => show(po.id)}
                      className="w-full rounded-xl border bg-card p-3 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span dir="ltr" className="font-bold tabular-nums">
                          {displayPoNumber(po.docNumber, locale)}
                        </span>
                        <WhoTag who={next.state.who} />
                      </div>
                      <p className="mt-1 font-bold" dir="auto">
                        {po.supplierName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{[supplierSub(po), siteText(po)].filter(Boolean).join(" · ")}</p>
                      <PoTags po={po} policies={world.policies} className="mt-1" />
                      <ProjectChips keys={keysOf(po)} label={projectLabel} />
                      <ul className="mt-2 space-y-0.5 text-xs">
                        {po.lines.slice(0, 3).map((l) => (
                          <li key={l.id} className="truncate" dir="auto">
                            {l.name} <span className="tabular-nums" dir="ltr">{netQuantity(l).toLocaleString("en-US")}</span> {lineUnitName(l, locale as "ar" | "en")}
                          </li>
                        ))}
                        {po.lines.length > 3 && <li className="text-[11px] text-muted-foreground">{t("more_lines", { count: po.lines.length - 3 })}</li>}
                      </ul>
                      <p className="mt-2 text-xs leading-relaxed" dir="auto">
                        {stepText(next)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <PoStatusPill po={po} now={now} notices={notices} />
                        <ValueCell po={po} masked={!actor.seesPrices} />
                      </div>
                      <RowNotes po={po} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <PoDrawer po={openOrder} world={world} open={Boolean(openOrder)} onOpenChange={(o) => !o && show(null)} now={now} />
      </div>
      {exportsToAccountant && <AccountantExportDialog open={exporting} onOpenChange={setExporting} orders={world.orders} receipts={world.deliveries} />}
    </PortalLayout>
  )
}

function ProjectChips({ keys, label }: { keys: string[]; label: (key: string) => string }) {
  if (!keys.length) return null
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {keys.map((k) => (
        <span
          key={k}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            k === GENERAL_STOCK || k === WORKSHOP ? "border-border bg-muted text-muted-foreground" : "border-cta/20 bg-cta/5 text-cta"
          )}
        >
          <LayoutGrid size={12} aria-hidden="true" />
          <span dir="auto">{label(k)}</span>
        </span>
      ))}
    </span>
  )
}

/** Held invoice, unpaid advance, budget referred to Projects — the prototype's row notes, on both layouts. */
function RowNotes({ po }: { po: PurchaseOrder }) {
  const tp = useTranslations("Portal.Procurement")
  const financeOn = useModules().on("payments")
  const px = asX(po)
  return (
    <>
      {financeOn && openHolds(px).length > 0 && <p className="mt-1 text-[11px] text-destructive">{tp("rfqpo.po.row_held")}</p>}
      {advanceState(px) === "requested" && <p className="mt-1 text-[11px] text-muted-foreground">{tp(financeOn ? "rfqpo.po.row_advance" : "rfqpo.po.row_advance_nofin")}</p>}
      {px.pmBudget?.state === "pending" && <p className="mt-1 text-[11px] text-warning">{tp("rfqpo.po.row_budget")}</p>}
    </>
  )
}

/** The order's value INCLUDING VAT (G-18: every figure names its basis), or without it for a supplier who is not registered. */
function ValueCell({ po, masked }: { po: PurchaseOrder; masked: boolean }) {
  const t = useTranslations("Portal.ProcOrders")
  return (
    <span className="flex flex-col">
      <Money value={poCommitment(po)} masked={masked} className="font-bold" />
      {!masked && <span className="text-[11px] text-muted-foreground">{t(Number(po.vatRate) > 0 ? "basis_incl" : "basis_no_vat")}</span>}
    </span>
  )
}
