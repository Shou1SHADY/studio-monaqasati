"use client"

// «سندات الاستلام» (PRD 2.0 §7.2, prototype `viewRcv`): ONE road and ONE receiver. Procurement follows the delivery until the supply is
// complete and never confirms it — only the receiver counts and confirms. Five segments: IN TRANSIT (every notice a supplier announced and
// nobody counted), AWAITING YOUR FORWARD (no receiver told yet), AWAITING COUNT (forwarded, the day has come), RECEIPTS (the receivers'
// documents) and NO PO (what was bought outside the platform, recorded by hand). Each notice offers only what Procurement does: forward,
// remind, see it as the receiver sees it, escalate. Every receipt opens as a PDF. `?tab=` names the segment, `?delivery=<id>` opens the
// drawer. The old `incoming` and `log` tab names still land where they used to.

import { getAuth } from "firebase/auth"
import { usePrintProfile } from "@/hooks/usePrintProfile"
import { printedNumber } from "@/lib/company-print-profile"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { BellRing, Download, Eye, ExternalLink, FileText, Forward, Loader2, MapPin, PackageCheck, Paperclip, PlusCircle, Siren, Truck } from "lucide-react"
import { ForwardReceiptDialog } from "@/components/procurement/ForwardReceiptDialog"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { useDateText } from "@/components/procurement/PoBits"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { ArrivalPickerDialog } from "@/components/procurement/ArrivalPickerDialog"
import { ManualDraftInbox, pendingDrafts } from "@/components/procurement/ManualDraftInbox"
import { ManualReceiptDialog } from "@/components/procurement/ManualReceiptDialog"
import { ReceiptDocumentDialog } from "@/components/procurement/ReceiptDocumentDialog"
import { ReceiptExportDialog } from "@/components/procurement/ReceiptExportDialog"
import { ReceiverPreviewDialog } from "@/components/procurement/ReceiverPreviewDialog"
import { RECORDED_TONE, ReceiptDrawer, ReceiptStatePill, RecordedByPill, type ReceiptDrawerProps } from "@/components/procurement/ReceiptDrawer"
import { RegulariseReceiptDialog } from "@/components/procurement/RegulariseReceiptDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useModules } from "@/hooks/useCompanyModules"
import { usePermissions } from "@/hooks/usePermissions"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import { useDeliverySiteList } from "@/hooks/useDeliverySiteList"
import { useProcTeam } from "@/hooks/useProcTeam"
import { useProcurementNeeds } from "@/hooks/useProcurementNeeds"
import { useProcurementWorld, type ProcurementWorld } from "@/hooks/useProcurementWorld"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useSupplierIdentity } from "@/hooks/useSupplierIdentity"
import { Link, usePathname, useRouter } from "@/i18n/routing"
import { addDays } from "@/lib/procurement/po"
import { cn } from "@/lib/utils"
import { procLinks } from "@/lib/procurement/events"
import { displayNoticeNumber, displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import {
  LOG_COMPLETENESS,
  PLACE_GENERAL,
  PLACE_WORKSHOP,
  RECEIPT_SEGMENTS,
  completenessMatches,
  destKind,
  isoOf,
  landingWarehouseId,
  needForOrder,
  noticePill,
  noticeNumberOf,
  noticeRowMatches,
  noticeRows,
  noticeRowsOf,
  receiptRowMatches,
  receiptRows,
  recordedBy,
  segmentCounts,
  shipmentOrdinal,
  siteFilterOf,
  suggestedReceiver,
  type DeskDelivery,
  type DestKind,
  type LogCompleteness,
  type NoticePill,
  type NoticeRow,
  type ReceiptRow,
  type ReceiptSegment,
} from "@/lib/procurement/receipt-desk"
import { selectStaleNotices } from "@/lib/procurement/auto-forward"
import { manualPlaces } from "@/lib/procurement/manual-receipt-form"
import { supplierIdentityOf, type ReceiptPrintInput } from "@/lib/procurement/receipt-print"
import type { ProcReceiver } from "@/lib/procurement/receivers"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { poActs } from "@/lib/procurement/po-extras"

const PAGE = 24
const LEGACY_TAB: Record<string, ReceiptSegment> = { incoming: "transit", log: "recs" }
const isSegment = (v: string | null): v is ReceiptSegment => RECEIPT_SEGMENTS.includes(v as ReceiptSegment)
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)

type WarehouseLite = { id: string; name: string; projectId?: string | null }
type ProjectLite = { id: string; name: string; warehouseId?: string | null }

export default function GoodsReceivedPage() {
  const t = useTranslations("Portal.ProcReceipts")
  const tProc = useTranslations("Portal.Procurement")
  const tc = useTranslations("Portal.Contractor")
  const tPrint = useTranslations("Portal.ProcReceipts.print")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const world = useProcurementWorld()
  const { on } = useModules()
  const pmOn = on("project-management")
  const financeOn = on("payments")
  const mfgOn = on("manufacturing")
  const { actor, orgId, orgName, orders, deliveries, policies, loading } = world
  const { user } = useUser()
  const { can } = usePermissions()
  const { profile } = useResolvedProfile(user?.uid)
  const { receivers } = useProcReceivers(orgId)
  const team = useProcTeam(actor.isOwner ? orgId : null, actor)
  const now = useMemo(() => new Date(), [])
  const escalateAfter = policies.escalateAfterDays

  const rawTab = searchParams.get("tab")
  const tab: ReceiptSegment = isSegment(rawTab) ? rawTab : rawTab && LEGACY_TAB[rawTab] ? LEGACY_TAB[rawTab] : "transit"
  const openDeliveryId = searchParams.get("delivery")
  const setQuery = useCallback(
    (next: { tab?: ReceiptSegment; delivery?: string | null }) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next.tab) params.set("tab", next.tab)
      if (next.delivery === null) params.delete("delivery")
      else if (next.delivery) params.set("delivery", next.delivery)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  // The page's one search is the header's: it filters these lists live through `?search=` (review 2 #1).
  const term = searchParams.get("search") || ""
  const [placeFilter, setPlaceFilter] = useState<string>("all")
  const [logFilter, setLogFilter] = useState<LogCompleteness>("all")
  const [limit, setLimit] = useState(PAGE)
  const [manualOpen, setManualOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [arrivalOpen, setArrivalOpen] = useState(false)
  const [regulariseTarget, setRegulariseTarget] = useState<DeskDelivery | null>(null)
  const [forwardTarget, setForwardTarget] = useState<DeskDelivery | null>(null)
  const [previewTarget, setPreviewTarget] = useState<DeskDelivery | null>(null)
  const [escalating, setEscalating] = useState<string | null>(null)
  const [forwardingStale, setForwardingStale] = useState(false)

  const warehousesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const projectsQ = useMemoFirebase(() => (firestore && orgId && pmOn ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId, pmOn])
  const { data: warehousesData } = useCollection(warehousesQ)
  const { data: projectsData } = useCollection(projectsQ)
  const warehouses = useMemo(() => (warehousesData || []) as WarehouseLite[], [warehousesData])
  const projects = useMemo(() => (projectsData || []) as ProjectLite[], [projectsData])
  const warehouseName = useCallback((id: string | null | undefined) => (id ? warehouses.find((w) => w.id === id)?.name || null : null), [warehouses])
  const projectName = useCallback((id: string | null | undefined) => (id ? projects.find((p) => p.id === id)?.name || null : null), [projects])
  const placeKind = useCallback(
    (d: DeskDelivery, po: PurchaseOrder | null): DestKind | null => {
      const id = d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId
      return destKind(id ? warehouses.find((w) => w.id === id) || { projectId: null } : null, d.projectId || po?.projectId)
    },
    [warehouses]
  )
  // The stores a manual purchase can be delivered to: the central one first, even before anything has been received into it.
  const manualSites = useMemo(() => {
    const central = `central_${orgId}`
    const list = [...warehouses].sort((a, b) => (a.id === central ? -1 : b.id === central ? 1 : a.name.localeCompare(b.name)))
    return list.some((w) => w.id === central) || !orgId ? list : [{ id: central, name: tc("wh_central_name"), projectId: null }, ...list]
  }, [warehouses, orgId, tc])

  // RC-04/RC-05: every delivery site — warehouses, work sites and (with Projects) project sites — in every package.
  const { sites: deliverySiteList } = useDeliverySiteList(orgId, pmOn)
  const liveSites = useMemo(() => deliverySiteList.filter((s) => !s.retired && (mfgOn || s.kind !== "workshop")), [deliverySiteList, mfgOn])
  const places = useMemo(() => manualPlaces({ sites: deliverySiteList, warehouses, orgId, centralName: tc("wh_central_name"), mfgOn }), [deliverySiteList, warehouses, orgId, tc, mfgOn])

  const desk = deliveries as DeskDelivery[]
  const filter = useMemo(() => {
    const site = liveSites.find((s) => s.id === placeFilter)
    return { term, projectId: placeFilter === "all" || site ? null : placeFilter, site: site ? siteFilterOf(site, warehouses) : null }
  }, [term, placeFilter, liveSites, warehouses])
  const counts = useMemo(() => segmentCounts(desk, orders, filter, now, escalateAfter), [desk, orders, filter, now, escalateAfter])
  const notices = useMemo(() => noticeRows(desk, orders, now, escalateAfter).filter((r) => noticeRowMatches(r, filter)), [desk, orders, filter, now, escalateAfter])
  const recs = useMemo(() => receiptRows(desk, orders, "recs", now).filter((r) => receiptRowMatches(r, filter)), [desk, orders, filter, now])
  const nopo = useMemo(() => receiptRows(desk, orders, "nopo", now).filter((r) => receiptRowMatches(r, filter)), [desk, orders, filter, now])
  const recsShown = useMemo(() => recs.filter((r) => completenessMatches(r, logFilter)), [recs, logFilter])
  const isNoticeTab = tab === "transit" || tab === "fwd" || tab === "count"
  const noticeShown = useMemo(() => (isNoticeTab ? noticeRowsOf(tab, notices) : []), [isNoticeTab, tab, notices])

  const openDelivery = useMemo(() => (openDeliveryId ? desk.find((d) => d.id === openDeliveryId) || null : null), [desk, openDeliveryId])
  // The order behind a delivery: named on it, or — for a notice written before the order existed (a guest's, an older one) — the one raised
  // over its offer.
  const poOf = useCallback(
    (d: DeskDelivery | null) => {
      if (!d) return null
      const id = d.poId || orders.find((o) => o.offerId && o.offerId === d.offerId)?.id || null
      return id ? orders.find((o) => o.id === id) || null : null
    },
    [orders]
  )

  useEffect(() => {
    if (openDeliveryId && !loading && !openDelivery) toast({ title: t("drawer.notFound"), variant: "destructive" })
    // Only when the id or the loading state changes — not on every list refresh.
  }, [openDeliveryId, loading])
  useEffect(() => setLimit(PAGE), [tab, term, placeFilter, logFilter])

  // Today's «حوّل للمستلم» links here with `forward=1` (P-20): open the forward dialog on that notice instead of its drawer, once.
  const forwardAsked = searchParams.get("forward") === "1"
  useEffect(() => {
    if (!forwardAsked || !openDelivery) return
    if (actor.isOwner || actor.canExpedite) setForwardTarget(openDelivery)
    const params = new URLSearchParams(searchParams.toString())
    params.delete("forward")
    params.delete("delivery")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [forwardAsked, openDelivery, searchParams, router, pathname, actor.isOwner, actor.canExpedite])

  const print = usePrintProfile()
  const company = useMemo(() => {
    const p = (profile || {}) as { companyName?: string; name?: string; crNumber?: string; taxNumber?: string; city?: string; location?: string; phone?: string; phoneNumber?: string; email?: string }
    return { name: p.companyName || orgName || p.name || "", cr: printedNumber(p.crNumber, print.crNumber), vat: printedNumber(p.taxNumber, print.taxNumber), address: [p.location, p.city].filter(Boolean).join(" · ") || null, phone: p.phone || p.phoneNumber || null, email: p.email || null }
  }, [profile, orgName, print.crNumber, print.taxNumber])

  // The owner of a company with a procurement team only reads here: receiving stays with Inventory and Projects.
  const ownerReadOnly = actor.isOwner && team.ownerHasTeam
  // Receiving is the receiver's: only a holder of the receiving permission is shown the door for a truck that came with no notice.
  const mayCountArrival = !ownerReadOnly && actor.canReceive
  // Follow-up (forward, remind, escalate) is the expediter's; a manual receipt and its regularisation are Procurement's (S-12, S-13).
  const canFollow = actor.isOwner || actor.canExpedite
  const canPrepare = actor.isOwner || actor.canPrepare || actor.canApprove
  const mayConfirmDrafts = actor.isOwner || can("warehouses.receive") || can("warehouses.manage")
  const stale = useMemo(
    () => (canFollow ? selectStaleNotices({ orgId, deliveries: desk, policies, receivers, projects, orders: orders.map((o) => ({ id: o.id, projectId: o.projectId ?? null })), now }).length : 0),
    [canFollow, orgId, desk, policies, receivers, projects, orders, now]
  )

  const authed = async (url: string, body: unknown) => {
    const u = getAuth().currentUser
    if (!u) throw new Error("auth")
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify(body) })
  }

  /** «حوّل المتأخر كله»: what the daily job leaves to a person because it is old — one press, the same receivers. */
  const forwardStale = async () => {
    setForwardingStale(true)
    try {
      const res = await authed("/api/procurement/auto-forward", { overdue: true })
      const body = (await res.json().catch(() => null)) as { data?: { forwarded?: number } } | null
      if (res.ok) toast({ title: t("incoming.staleForwarded", { n: body?.data?.forwarded ?? 0 }) })
      else toast({ title: t("incoming.staleFailed"), variant: "destructive" })
    } catch {
      toast({ title: t("incoming.staleFailed"), variant: "destructive" })
    } finally {
      setForwardingStale(false)
    }
  }

  /** «ذكّر المستلم» (PUR-06): the receiver it was forwarded to, reminded in his inbox or by a message. */
  const remindReceiver = async (d: DeskDelivery) => {
    try {
      const res = await authed("/api/receipt-links/remind", { deliveryId: d.id })
      const body = (await res.json().catch(() => null)) as { code?: string } | null
      if (res.ok) toast({ title: t("incoming.receiverReminded", { name: d.forwardedTo?.name || "" }) })
      else toast({ title: t(body?.code === "TOO_SOON" ? "incoming.remindTooSoon" : body?.code === "LINK_CLOSED" ? "incoming.remindLinkClosed" : "incoming.remindFailed"), variant: "destructive" })
    } catch {
      toast({ title: t("incoming.remindFailed"), variant: "destructive" })
    }
  }

  /** «صعّد» (TDY-05): once, to the project manager of the site — or the owner without Projects. */
  const escalate = async (d: DeskDelivery) => {
    setEscalating(d.id)
    try {
      const res = await authed("/api/procurement/notice/escalate", { deliveryId: d.id })
      const body = (await res.json().catch(() => null)) as { data?: { to?: string; toName?: string | null; days?: number } } | null
      if (res.ok) toast({ title: t(body?.data?.to === "project_manager" ? "escalate.doneManager" : "escalate.doneOwner", { name: body?.data?.toName || "", days: body?.data?.days ?? 0 }) })
      else toast({ title: t("escalate.failed"), variant: "destructive" })
    } catch {
      toast({ title: t("escalate.failed"), variant: "destructive" })
    } finally {
      setEscalating(null)
    }
  }

  /** The printable input of one receipt, as the list's «PDF» button and the export build it (the drawer adds the supplier's full identity). */
  const printInputFor = useCallback(
    (d: DeskDelivery, supplier: ReceiptPrintInput["supplier"] = undefined): ReceiptPrintInput => {
      const po = poOf(d)
      const placeId = d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId || d.manualDraft?.warehouseId
      const vat = po ? world.supplierRecords.find((r) => r.supplierOrgId === po.supplierOrgId)?.vatNumber : null
      const ordinal = noticeNumberOf(d, desk, po)
      return {
        delivery: d,
        po,
        company,
        supplier: supplier === undefined ? supplierIdentityOf(null, vat) : supplier,
        noticeNumber: ordinal ? displayNoticeNumber(ordinal, locale) : null,
        placeName: warehouseName(placeId) || po?.projectName || d.deliverySiteName || null,
        projectName: projectName(d.projectId || po?.projectId),
        displayNumber: d.docNumber ? displayReceiptNumber(d.docNumber, locale) : `DEL-${d.id.slice(0, 8).toUpperCase()}`,
        displayPoNumber: po ? displayPoNumber(po.docNumber, locale) : d.poNumber ? displayPoNumber(d.poNumber, locale) : null,
        withPrices: actor.seesPrices,
        locale,
        t: (k, p) => tPrint(k as "title", p),
        tp: (k, p) => tProc(k as "doc.GR", p),
        now,
      }
    },
    [poOf, world.supplierRecords, company, desk, locale, warehouseName, projectName, actor.seesPrices, tPrint, tProc, now]
  )
  // RC-01: «PDF» opens the receipt as its A4 page inside the app (download · print · close), not a self-printing pop-up.
  const [docInput, setDocInput] = useState<ReceiptPrintInput | null>(null)
  const openPdf = (d: DeskDelivery) => setDocInput(printInputFor(d))

  const segTitle: Record<ReceiptSegment, string> = { transit: t("segments.transit"), fwd: t("segments.fwd"), count: t("segments.count"), recs: t("segments.recs"), nopo: t("segments.nopo") }
  const forwardPo = forwardTarget ? poOf(forwardTarget) : null
  const forwardPlace = forwardTarget ? forwardTarget.landedWarehouseId || landingWarehouseId(forwardTarget.projectId || forwardPo?.projectId, projects, orgId) : null
  const previewPo = previewTarget ? poOf(previewTarget) : null
  const previewPlace = previewTarget ? previewTarget.landedWarehouseId || landingWarehouseId(previewTarget.projectId || previewPo?.projectId, projects, orgId) : null

  return (
    <PortalLayout>
      <div className="space-y-5">
        <ProcurementHeader
          title={t("title")}
          description={t("subtitle")}
          sharedAction={
            <Button variant="outline" className="gap-2 rounded-xl border border-border bg-card text-muted-foreground shadow-none hover:bg-card hover:text-foreground" onClick={() => setExportOpen(true)} disabled={loading}>
              <Download size={16} aria-hidden="true" />
              {t("csv.button")}
            </Button>
          }
          action={
            <div className="flex flex-wrap gap-2">
              {mayCountArrival && (
                <Button variant="outline" className="gap-2 rounded-xl" onClick={() => setArrivalOpen(true)}>
                  <Truck size={16} aria-hidden="true" />
                  {t("arrival.button")}
                </Button>
              )}
              {canPrepare && (
                <Button className="gap-2 rounded-xl bg-module text-module-foreground hover:bg-module/90" onClick={() => setManualOpen(true)}>
                  <PlusCircle size={18} aria-hidden="true" />
                  {t("manual.button")}
                </Button>
              )}
            </div>
          }
        />

        {/* Segments + tools */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <ProcChipGroup items={RECEIPT_SEGMENTS.map((s) => ({ id: s, label: segTitle[s], count: counts[s] }))} active={tab} onPick={(s) => setQuery({ tab: s })} label={t("title")} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <NativeSelect value={placeFilter} onChange={(e) => setPlaceFilter(e.target.value)} aria-label={t("placeFilter")} className={cn("h-10 w-full sm:w-56", placeFilter !== "all" && "border-module text-module")}>
              <option value="all">{t("allPlaces")}</option>
              {liveSites.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value={PLACE_GENERAL}>{t("place.general")}</option>
              {mfgOn && <option value={PLACE_WORKSHOP}>{t("place.workshop")}</option>}
            </NativeSelect>
          </div>
        </div>

        {mayConfirmDrafts && pendingDrafts(desk).length > 0 && <ManualDraftInbox deliveries={desk} warehouseName={warehouseName} />}

        {loading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="animate-spin text-muted-foreground" size={40} aria-hidden="true" />
          </div>
        ) : isNoticeTab ? (
          <>
            {stale > 0 && tab !== "count" && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-800">{t("incoming.staleHint", { n: stale })}</p>
                <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={forwardingStale} onClick={() => void forwardStale()}>
                  {forwardingStale ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Forward size={13} aria-hidden="true" />}
                  {t("incoming.forwardStale", { n: stale })}
                </Button>
              </div>
            )}
            <NoticeList
              rows={noticeShown.slice(0, limit)}
              total={noticeShown.length}
              all={desk}
              locale={locale}
              canFollow={canFollow}
              followsPo={(po) => canFollow && (!po || poActs(po, actor, policies.ownerStepsBack).acts)}
              escalating={escalating}
              receivers={receivers}
              forwardWindowDays={policies.forwardWindowDays}
              placeOf={(d, po) => d.landedWarehouseId || landingWarehouseId(d.projectId || po?.projectId, projects, orgId)}
              warehouseName={warehouseName}
              projectName={projectName}
              onForward={setForwardTarget}
              onPreview={setPreviewTarget}
              onRemindReceiver={(d) => void remindReceiver(d)}
              onEscalate={(d) => void escalate(d)}
              onOpen={(id) => setQuery({ delivery: id })}
              onMore={() => setLimit((n) => n + PAGE)}
            />
            <p className="rounded-xl border border-cta/20 bg-cta/5 p-3 text-xs leading-relaxed text-cta">{t("caption.notices")}</p>
          </>
        ) : (
          <>
            <ReceiptList
              all={desk}
              rows={(tab === "recs" ? recsShown : nopo).slice(0, limit)}
              total={tab === "recs" ? recsShown.length : nopo.length}
              locale={locale}
              onOpen={(id) => setQuery({ delivery: id })}
              onPdf={openPdf}
              warehouseName={warehouseName}
              projectName={projectName}
              placeKind={placeKind}
              nopo={tab === "nopo"}
              logFilter={tab === "recs" ? logFilter : null}
              onLogFilter={setLogFilter}
              onMore={() => setLimit((n) => n + PAGE)}
            />
            <p className="rounded-xl border border-cta/20 bg-cta/5 p-3 text-xs leading-relaxed text-cta">{t("caption.receipts")}</p>
          </>
        )}

        {openDelivery && (
          <ReceiptDrawerWithFacts
            world={world}
            delivery={openDelivery}
            po={poOf(openDelivery)}
            deliveries={desk}
            onOpenChange={(o) => !o && setQuery({ delivery: null })}
            actor={actor}
            orgName={orgName}
            company={company}
            warehouseName={warehouseName}
            projectName={projectName}
            placeKind={placeKind}
            now={now}
            onRegularise={(d) => setRegulariseTarget(d)}
            onForward={actor.isOwner || actor.canExpedite ? (d) => setForwardTarget(d) : undefined}
            onRemind={actor.isOwner || actor.canExpedite ? (d) => void remindReceiver(d) : undefined}
            onEscalate={actor.isOwner || actor.canExpedite ? (d) => void escalate(d) : undefined}
            onPreview={setPreviewTarget}
            policies={policies}
            ownerReadOnly={ownerReadOnly}
          />
        )}

        {forwardTarget && (
          <ForwardReceiptDialog
            open={Boolean(forwardTarget)}
            onOpenChange={(o) => !o && setForwardTarget(null)}
            delivery={forwardTarget}
            po={forwardPo}
            orgId={orgId}
            placeWarehouseId={forwardPlace}
            placeName={warehouseName(forwardPlace) || tc("wh_central_name")}
            noticeNumber={noticeNumberOf(forwardTarget, desk, forwardPo)}
          />
        )}
        {previewTarget && (
          <ReceiverPreviewDialog
            open
            onOpenChange={(o) => !o && setPreviewTarget(null)}
            delivery={previewTarget}
            po={previewPo}
            placeName={warehouseName(previewPlace) || tc("wh_central_name")}
            companyName={company.name}
            noticeNumber={noticeNumberOf(previewTarget, desk, previewPo)}
          />
        )}

        <ManualReceiptDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          actor={actor}
          orgId={orgId}
          orders={orders}
          places={places}
          onDone={(deliveryId, tabAfter) => {
            setManualOpen(false)
            setQuery({ tab: tabAfter, delivery: deliveryId })
          }}
        />
        <ReceiptDocumentDialog input={docInput} onOpenChange={(o) => !o && setDocInput(null)} />
        <ArrivalPickerDialog open={arrivalOpen} onOpenChange={setArrivalOpen} orders={orders} />
        <ReceiptExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          deliveries={desk}
          orders={orders}
          warehouses={manualSites}
          printInput={(d) => printInputFor(d)}
          withPrices={actor.seesPrices}
          financeOn={financeOn}
          reasonLabel={(code) => (tProc.has(`rejectReason.${code}`) ? tProc(`rejectReason.${code}` as "rejectReason.other") : code)}
        />

        {regulariseTarget && (
          <RegulariseReceiptDialog
            delivery={regulariseTarget}
            actor={actor}
            orgId={orgId}
            orders={orders}
            placeName={warehouseName(regulariseTarget.landedWarehouseId || (regulariseTarget as { warehouseId?: string | null }).warehouseId)}
            onOpenChange={(o) => !o && setRegulariseTarget(null)}
            onDone={(next) => {
              setRegulariseTarget(null)
              if (next.poId) router.push(procLinks.order(next.poId))
            }}
          />
        )}
      </div>
    </PortalLayout>
  )
}

/** The drawer, with what only it reads: the need behind the order (for the trail) and the supplier's identity (for the print) — loaded while it is open. */
function ReceiptDrawerWithFacts({ world, ...props }: ReceiptDrawerProps & { world: ProcurementWorld }) {
  const { needs } = useProcurementNeeds(world)
  const po = props.po
  const need = useMemo(() => (po ? needForOrder(needs, po) : null), [needs, po])
  const supplierOrgId = po ? po.supplierOrgId : (props.delivery as (DeskDelivery & { supplierGuessOrgId?: string | null }) | null)?.supplierGuessOrgId
  const supplier = useSupplierIdentity(supplierOrgId, po ? world.supplierRecords.find((r) => r.supplierOrgId === po.supplierOrgId)?.vatNumber : null)
  return <ReceiptDrawer {...props} need={need} supplier={supplier} />
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function useWhenText() {
  const locale = useLocale()
  return (iso: string | null | undefined) => {
    if (!iso) return ""
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { month: "short", day: "numeric", ...(iso.length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}) })
  }
}

function MoreButton({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  const t = useTranslations("Portal.ProcReceipts")
  if (shown >= total) return null
  return (
    <div className="flex justify-center border-t p-3">
      <Button type="button" variant="outline" size="sm" onClick={onMore}>
        {t("showMore", { n: total - shown })}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The notices: in transit · awaiting your forward · awaiting count
// ---------------------------------------------------------------------------

interface NoticeListProps {
  rows: NoticeRow[]
  total: number
  all: DeskDelivery[]
  locale: string
  canFollow: boolean
  /** Follow-up on an order: the owner only reads others' orders once the company has buyers (poActs). */
  followsPo: (po: PurchaseOrder | null | undefined) => boolean
  escalating: string | null
  receivers: ProcReceiver[]
  forwardWindowDays: number
  placeOf: (d: DeskDelivery, po: PurchaseOrder | null) => string | null
  warehouseName: (id: string | null | undefined) => string | null
  projectName: (id: string | null | undefined) => string | null
  onForward: (d: DeskDelivery) => void
  onPreview: (d: DeskDelivery) => void
  onRemindReceiver: (d: DeskDelivery) => void
  onEscalate: (d: DeskDelivery) => void
  onOpen: (id: string) => void
  onMore: () => void
}

function NoticeList(props: NoticeListProps) {
  const { rows, total, all, locale, followsPo, escalating, receivers, forwardWindowDays, placeOf, warehouseName, projectName, onForward, onPreview, onRemindReceiver, onEscalate, onOpen, onMore } = props
  const t = useTranslations("Portal.ProcReceipts")
  const dayText = useDateText()
  const tc = useTranslations("Portal.Contractor")
  const when = useWhenText()

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="space-y-1 border-b px-4 py-3">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold">
          {t("incoming.panelTitle")}
          <Badge className="border-none bg-module/10 text-[11px] font-bold tabular-nums text-module">{total}</Badge>
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("incoming.panelSub")}</p>
      </header>
      {!rows.length ? (
        <Empty text={t("empty.incoming")} />
      ) : (
        <ul className="divide-y">
          {rows.map((r) => {
            const d = r.delivery
            const po = r.po
            const supplier = d.supplierName || po?.supplierName
            const project = projectName(d.projectId || po?.projectId)
            const place = placeOf(d, po)
            const placeName = warehouseName(place) || tc("wh_central_name")
            const suggested = suggestedReceiver(receivers, place)
            const fw = d.forwardedTo || null
            const ship = shipmentOrdinal(d, all, po)
            const pill = noticePill(r)
            const noticeNo = noticeNumberOf(d, all, po)
            const fwModule = fw?.userId ? receivers.find((x) => x.userId === fw.userId)?.module : null
            const attachments = (d.attachmentUrls || []).length
            const autoOn = r.day ? addDays(r.day, -forwardWindowDays) : ""
            const tone = r.stage === "fwd" ? "bg-destructive/10 text-destructive" : r.escalate ? "bg-destructive/10 text-destructive" : r.uncounted > 0 ? "bg-amber-100 text-amber-800" : "bg-cta/10 text-cta"
            return (
              <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 gap-3">
                  <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl", tone)}>
                    <Truck size={17} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm">
                      {po && <span className="font-bold">{displayPoNumber(po.docNumber, locale)}</span>}
                      <span className="font-bold" dir="auto">
                        {po ? `· ${supplier || "—"}` : supplier || "—"}
                      </span>
                      <span className="text-muted-foreground">
                        · {t("hub.delivery")} {r.day ? dayText(r.day) : "—"}
                      </span>
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <MapPin size={11} aria-hidden="true" />
                      <span dir="auto">{placeName}</span>
                      {project && <span dir="auto">· {project}</span>}
                      {noticeNo && (
                        <Badge variant="outline" className="text-[10px]">
                          <bdi>{displayNoticeNumber(noticeNo, locale)}</bdi>
                        </Badge>
                      )}
                      {ship && <span>· {ship.m ? t("incoming.shipmentOf", { n: ship.n, m: ship.m }) : t("incoming.shipment", { n: ship.n })}</span>}
                      {d.notes && (
                        <span dir="auto" className="text-foreground">
                          · {d.notes}
                        </span>
                      )}
                      {attachments > 0 && (
                        <span className="inline-flex items-center gap-0.5" aria-label={t("incoming.attachments", { n: attachments })}>
                          <Paperclip size={11} aria-hidden="true" />
                          {attachments}
                        </span>
                      )}
                    </p>
                    {fw ? (
                      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                        <span dir="auto">{t("incoming.forwardedTo", { name: fw.name })}</span>
                        {fw.auto && <Badge className="border-none bg-module/10 text-[10px] font-bold text-module">{t("incoming.autoForwarded")}</Badge>}
                        {fw.userId && fwModule && <Badge className={cn("border-none text-[10px] font-bold", RECORDED_TONE[fwModule])}>{t(`module.${fwModule}`)}</Badge>}
                        <span>·</span>
                        <span className={cn(r.escalate && "font-semibold text-destructive")}>{r.uncounted > 0 ? t("hub.awaitingCount", { days: r.uncounted }) : t("hub.notDue")}</span>
                        <span>·</span>
                        {fw.userId ? <span>{t("hub.inAccount")}</span> : <span>{t("incoming.byLink")}</span>}
                        <span>· {fw.auto ? t("incoming.forwardedAuto", { when: when(fw.at) }) : t("incoming.forwardedBy", { name: fw.byName, when: when(fw.at) })}</span>
                        {d.escalation && (
                          <span className="font-semibold text-destructive">
                            · {t("hub.escalated", { name: d.escalation.toName || t(d.escalation.toKind === "project_manager" ? "escalate.projectManager" : "escalate.owner") })}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="flex flex-wrap items-center gap-x-1.5 text-[11px]">
                        <b className="text-destructive">{t("incoming.forwardNow")}</b>
                        <span className="text-muted-foreground">
                          · {suggested ? t("hub.autoForwardOn", { date: autoOn ? dayText(autoOn) : "—", name: suggested.name }) : t("incoming.noReceiver")}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                    <NoticePillBadge pill={pill} />
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:justify-end">
                    {fw && (
                      <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => onPreview(d)}>
                        <Eye size={12} aria-hidden="true" />
                        {t("hub.preview")}
                      </Button>
                    )}
                    {followsPo(po) && r.escalate && (
                      <Button size="sm" className="h-8 gap-1 bg-destructive text-xs text-destructive-foreground hover:bg-destructive/90" disabled={escalating === d.id} onClick={() => onEscalate(d)}>
                        {escalating === d.id ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Siren size={12} aria-hidden="true" />}
                        {t("hub.escalate")}
                      </Button>
                    )}
                    {followsPo(po) && fw && (
                      <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => onRemindReceiver(d)}>
                        <BellRing size={12} aria-hidden="true" />
                        {t("incoming.remindReceiver")}
                      </Button>
                    )}
                    {followsPo(po) && (
                      <Button size="sm" variant={fw ? "outline" : "default"} className="h-8 gap-1 text-xs" onClick={() => onForward(d)}>
                        <Forward size={12} aria-hidden="true" />
                        {fw ? t("forward.again") : t("forward.button")}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onOpen(d.id)}>
                      {t("incoming.details")}
                    </Button>
                    {po && (
                      <Button asChild size="sm" variant="outline" className="h-8 gap-1 text-xs">
                        <Link href={procLinks.order(po.id)}>
                          <ExternalLink size={12} aria-hidden="true" />
                          {t("incoming.openOrder")}
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <MoreButton shown={rows.length} total={total} onMore={onMore} />
    </section>
  )
}

function NoticePillBadge({ pill }: { pill: NoticePill }) {
  const t = useTranslations("Portal.ProcReceipts")
  const bad = "bg-destructive/10 text-destructive"
  const warn = "bg-amber-100 text-amber-800"
  const ok = "bg-success/10 text-success"
  const [tone, text] =
    pill.kind === "to_forward"
      ? [pill.tone === "bad" ? bad : warn, t("incoming.toForward")]
      : pill.kind === "escalate"
        ? [bad, t("hub.pastWindow", { days: pill.days })]
        : pill.kind === "uncounted"
          ? [warn, t("hub.uncounted")]
          : pill.kind === "auto_forwarded"
            ? [warn, t("incoming.autoForwarded")]
            : [ok, pill.days == null ? t("segments.transit") : t("incoming.inDays", { days: pill.days })]
  return <Badge className={cn("border-none text-[11px] font-bold", tone)}>{text}</Badge>
}

// ---------------------------------------------------------------------------
// Receipts / No PO
// ---------------------------------------------------------------------------

interface ReceiptListProps {
  /** Every delivery — a notice's number is its place among its order's notices. */
  all: DeskDelivery[]
  rows: ReceiptRow[]
  total: number
  locale: string
  onOpen: (id: string) => void
  onPdf: (d: DeskDelivery) => void
  warehouseName: (id: string | null | undefined) => string | null
  projectName: (id: string | null | undefined) => string | null
  placeKind: (d: DeskDelivery, po: PurchaseOrder | null) => DestKind | null
  nopo: boolean
  logFilter: LogCompleteness | null
  onLogFilter: (f: LogCompleteness) => void
  onMore: () => void
}

function ReceiptList({ all, rows, total, locale, onOpen, onPdf, warehouseName, projectName, placeKind, nopo, logFilter, onLogFilter, onMore }: ReceiptListProps) {
  const t = useTranslations("Portal.ProcReceipts")
  const tp = useTranslations("Portal.Procurement")
  const when = useWhenText()
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          {t("log.panelTitle")}
          <Badge variant="outline" className="text-[11px] tabular-nums">
            {total}
          </Badge>
        </h2>
        {logFilter && (
          <Select value={logFilter} onValueChange={(v) => onLogFilter(v as LogCompleteness)}>
            <SelectTrigger className={cn("h-9 w-full sm:w-64", logFilter !== "all" && "border-module text-module")} aria-label={t("log.filterLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOG_COMPLETENESS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`log.filter_${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>
      {!rows.length ? (
        <Empty text={nopo ? t("empty.nopo") : t("empty.log")} hint={nopo ? t("empty.nopoHint") : undefined} />
      ) : (
        <table className="w-full text-sm">
          <thead className="hidden bg-muted/50 text-xs text-muted-foreground md:table-header-group">
            <tr>
              <th className="px-3 py-2 text-start font-semibold">{t("hub.colReceipt")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("hub.colOrder")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("hub.colWhere")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("hub.colAccepted")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("hub.colStatus")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("hub.colSource")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = r.delivery
              const number = d.docNumber ? displayReceiptNumber(d.docNumber, locale) : `DEL-${d.id.slice(0, 8).toUpperCase()}`
              const placeId = d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId || d.manualDraft?.warehouseId
              const place = warehouseName(placeId)
              const project = projectName(d.projectId || r.po?.projectId)
              const kind = placeKind(d, r.po)
              const by = recordedBy(d, kind)
              const time = isoOf(d.confirmedAt)
              const noticeNo = noticeNumberOf(d, all, r.po)
              const counted = r.lines.reduce((s, l) => s + (Number(l.counted) || 0), 0)
              const accepted = r.lines.reduce((s, l) => s + (Number(l.accepted) || 0), 0)
              const draft = d.manualDraft?.state === "draft"
              const source = d.source === "manual" ? "manual" : d.noNotice ? "noNotice" : d.confirmedVia === "login" ? "login" : d.confirmedVia === "sms_code" || d.receiverReport ? "link" : "none"
              return (
                <tr key={d.id} onClick={() => onOpen(d.id)} className="grid cursor-pointer grid-cols-1 gap-1 border-t px-3 py-3 hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none md:table-row md:px-0 md:py-0" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(d.id)}>
                  <td className="md:px-3 md:py-2.5">
                    <p className="font-bold">{number}</p>
                    <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span dir="ltr">{time && time.length > 10 ? when(time) : r.day || "—"}</span>
                    </p>
                  </td>
                  <td className="md:px-3 md:py-2.5">
                    <p className="font-semibold" dir="auto">
                      {r.po ? displayPoNumber(r.po.docNumber, locale) : d.poNumber ? displayPoNumber(d.poNumber, locale) : <span className="font-bold text-destructive">{t("log.noPo")}</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground" dir="auto">
                      {d.supplierName || r.po?.supplierName || "—"}
                      {noticeNo && (
                        <>
                          {" · "}
                          <bdi>{displayNoticeNumber(noticeNo, locale)}</bdi>
                        </>
                      )}
                      {d.invoiceNumber && (
                        <>
                          {" · "}
                          {t("hub.invoiceNo")} <span dir="ltr">{d.invoiceNumber}</span>
                        </>
                      )}
                    </p>
                  </td>
                  <td className="md:px-3 md:py-2.5">
                    <p className="text-xs">
                      <span dir="auto">{place || project || (nopo ? "—" : t("log.generalStock"))}</span>
                      {kind && <span className="ms-1 text-[11px] text-muted-foreground">{t(`dest.${kind}`)}</span>}
                    </p>
                    <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span dir="auto">{(d.receivedByName || "—").split(" — ")[0]}</span>
                      <RecordedByPill by={by} manual={d.source === "manual"} />
                    </p>
                  </td>
                  <td className="md:px-3 md:py-2.5">
                    <p className="text-sm font-semibold tabular-nums">
                      {fmt(accepted)} / {fmt(counted)}
                    </p>
                    <p className="line-clamp-1 text-[11px] text-muted-foreground" dir="auto">
                      {r.lines.map((l) => l.name).join(" · ")}
                    </p>
                  </td>
                  <td className="md:px-3 md:py-2.5">
                    {draft ? (
                      <Badge className="border-none bg-amber-100 text-[11px] font-bold text-amber-800">{t("hub.draft")}</Badge>
                    ) : d.regularisation === "expense" ? (
                      <Badge variant="outline" className="text-[11px]">
                        {t("log.expense")}
                      </Badge>
                    ) : d.source === "manual" ? (
                      <ReceiptStatePill state={r.state} />
                    ) : r.rejected > 0 ? (
                      <Badge className="border-none bg-destructive/10 text-[11px] font-bold text-destructive">{t("hub.hasRejected")}</Badge>
                    ) : r.held > 0 ? (
                      <ReceiptStatePill state="received_held" />
                    ) : (
                      <Badge className="border-none bg-success/10 text-[11px] font-bold text-success">{t("hub.matched")}</Badge>
                    )}
                    {r.complete != null && <p className={cn("mt-1 text-[11px]", r.complete ? "text-success" : "text-amber-700")}>{r.complete ? t("log.complete") : t("log.incompleteLeft", { qty: fmt(r.remaining ?? 0) })}</p>}
                    {d.selfReceived && d.source !== "manual" && <p className="text-[11px] text-destructive">{tp("exception.self_received")}</p>}
                  </td>
                  <td className="md:px-3 md:py-2.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", source === "manual" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{t(`hub.src_${source}`)}</span>
                  </td>
                  <td className="md:px-3 md:py-2.5 md:text-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPdf(d)
                      }}
                    >
                      <FileText size={12} aria-hidden="true" />
                      PDF
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <MoreButton shown={rows.length} total={total} onMore={onMore} />
    </section>
  )
}

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-16 text-center">
      <PackageCheck size={40} className="text-muted-foreground/30" aria-hidden="true" />
      <p className="text-sm font-medium text-muted-foreground">{text}</p>
      {hint && <p className="max-w-md text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

