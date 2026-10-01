"use client"

// The goods-received desk (PRD 3.0 §7.2 "Goods receipts", prototype `vGrn`):
// three segments — On the way (the suppliers' pending notices, and live orders
// whose promised day is near or past with no notice), Receipts (the log, with
// the state of each and whether its order is complete), No PO (manual receipts
// waiting to be regularised, or booked as a cash expense). Search runs across
// the segments, the place filter (a project, general stock, the workshop)
// narrows all three, the CSV exports the whole log without a money column.
// Procurement follows up — forwards, reminds, regularises — and never confirms
// a receipt itself unless it also holds the receiving permission.
// `?tab=` names the segment, `?delivery=<id>` opens the drawer.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { AlertTriangle, BellRing, ClipboardCheck, Download, ExternalLink, Forward, Loader2, MapPin, PackageCheck, Paperclip, PenLine, PlusCircle, Search, Truck } from "lucide-react"
import { ForwardReceiptDialog } from "@/components/procurement/ForwardReceiptDialog"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { useDateText } from "@/components/procurement/PoBits"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { ManualReceiptDialog } from "@/components/procurement/ManualReceiptDialog"
import { RECORDED_TONE, ReceiptDrawer, ReceiptStatePill, RecordedByPill, type ReceiptDrawerProps } from "@/components/procurement/ReceiptDrawer"
import { ReceiveDeliveryDialog } from "@/components/procurement/ReceiveDeliveryDialog"
import { RegulariseReceiptDialog } from "@/components/procurement/RegulariseReceiptDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import { useProcTeam } from "@/hooks/useProcTeam"
import { useProcurementNeeds } from "@/hooks/useProcurementNeeds"
import { useProcurementWorld, type ProcurementWorld } from "@/hooks/useProcurementWorld"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useSupplierIdentity } from "@/hooks/useSupplierIdentity"
import { Link, usePathname, useRouter } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import type { Translator } from "@/lib/mfg-events"
import { operatingPolicies, type NoticeRouting } from "@/lib/procurement/policies"
import { receiveRight } from "@/lib/procurement/policy-enforce"
import { procLinks } from "@/lib/procurement/events"
import { displayNoticeNumber, displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { lineToArrive, reminderCooldownUntil } from "@/lib/procurement/po"
import {
  LOG_COMPLETENESS,
  PLACE_GENERAL,
  PLACE_WORKSHOP,
  RECEIPT_SEGMENTS,
  completenessMatches,
  destKind,
  forwardState,
  incomingPill,
  incomingRowMatches,
  incomingRows,
  isoOf,
  landingWarehouseId,
  needForOrder,
  noticeNumberOf,
  receiptCsv,
  receiptCsvFilename,
  receiptCsvRows,
  receiptRowMatches,
  receiptRows,
  recordedBy,
  segmentCounts,
  shipmentOrdinal,
  suggestedReceiver,
  type DeskDelivery,
  type DestKind,
  type IncomingRow,
  type LogCompleteness,
  type ReceiptRow,
  type ReceiptSegment,
} from "@/lib/procurement/receipt-desk"
import type { ProcReceiver } from "@/lib/procurement/receivers"
import { type PurchaseSource, type RecordReceiptResult } from "@/lib/procurement/receipt-writes"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { ProcWriteError, remindSupplier } from "@/lib/procurement/writes"
import { poActs } from "@/lib/procurement/po-extras"

const isSegment = (v: string | null): v is ReceiptSegment => RECEIPT_SEGMENTS.includes(v as ReceiptSegment)
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)

type WarehouseLite = { id: string; name: string; projectId?: string | null }
type ProjectLite = { id: string; name: string; warehouseId?: string | null }

export default function GoodsReceivedPage() {
  const t = useTranslations("Portal.ProcReceipts")
  const tProc = useTranslations("Portal.Procurement")
  const tOrders = useTranslations("Portal.ProcOrders")
  const tShared = useTranslations("Portal.Shared")
  const tc = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const world = useProcurementWorld()
  const { actor, orgId, orgName, orders, deliveries, rfqs, policies, loading } = world
  const { user } = useUser()
  const { profile } = useResolvedProfile(user?.uid)
  const { receivers } = useProcReceivers(orgId)
  const team = useProcTeam(actor.isOwner ? orgId : null, actor)
  const now = useMemo(() => new Date(), [])

  const tab: ReceiptSegment = isSegment(searchParams.get("tab")) ? (searchParams.get("tab") as ReceiptSegment) : "incoming"
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

  const [term, setTerm] = useState("")
  const [placeFilter, setPlaceFilter] = useState<string>("all")
  const [logFilter, setLogFilter] = useState<LogCompleteness>("all")
  const [manualOpen, setManualOpen] = useState(false)
  const [receiveTarget, setReceiveTarget] = useState<{ delivery: DeskDelivery | null; po: PurchaseOrder | null } | null>(null)
  const [regulariseTarget, setRegulariseTarget] = useState<DeskDelivery | null>(null)
  const [forwardTarget, setForwardTarget] = useState<DeskDelivery | null>(null)
  const [reminding, setReminding] = useState<string | null>(null)

  const warehousesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const projectsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: warehousesData } = useCollection(warehousesQ)
  const { data: projectsData } = useCollection(projectsQ)
  const warehouses = useMemo(() => (warehousesData || []) as WarehouseLite[], [warehousesData])
  const projects = useMemo(() => (projectsData || []) as ProjectLite[], [projectsData])
  const warehouseName = useCallback((id: string | null | undefined) => (id ? warehouses.find((w) => w.id === id)?.name || null : null), [warehouses])
  const projectName = useCallback((id: string | null | undefined) => (id ? projects.find((p) => p.id === id)?.name || null : null), [projects])
  const placeKind = useCallback((d: DeskDelivery, po: PurchaseOrder | null): DestKind | null => {
    const id = d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId
    return destKind(id ? warehouses.find((w) => w.id === id) || { projectId: null } : null, d.projectId || po?.projectId)
  }, [warehouses])

  const desk = deliveries as DeskDelivery[]
  const filter = useMemo(() => ({ term, projectId: placeFilter === "all" ? null : placeFilter }), [term, placeFilter])
  const counts = useMemo(() => segmentCounts(desk, orders, filter, now), [desk, orders, filter, now])
  const incoming = useMemo(() => incomingRows(desk, orders, now).filter((r) => incomingRowMatches(r, filter)), [desk, orders, filter, now])
  const log = useMemo(() => receiptRows(desk, orders, "log", now).filter((r) => receiptRowMatches(r, filter)), [desk, orders, filter, now])
  const nopo = useMemo(() => receiptRows(desk, orders, "nopo", now).filter((r) => receiptRowMatches(r, filter)), [desk, orders, filter, now])
  const logShown = useMemo(() => log.filter((r) => completenessMatches(r, logFilter)), [log, logFilter])

  const openDelivery = useMemo(() => (openDeliveryId ? desk.find((d) => d.id === openDeliveryId) || null : null), [desk, openDeliveryId])
  // The order behind a delivery: named on it, or — for a notice written
  // before the order existed (a guest's, an older one) — the one raised over
  // its offer. Either way the receipt lands on the order's lines.
  const poOf = useCallback(
    (d: DeskDelivery | null) => {
      if (!d) return null
      const id = d.poId || orders.find((o) => o.offerId && o.offerId === d.offerId)?.id || null
      return id ? orders.find((o) => o.id === id) || null : null
    },
    [orders]
  )
  const alreadyPosted = useCallback((po: PurchaseOrder | null, except?: string) => (po ? desk.filter((d) => d.poId === po.id && d.status === "confirmed" && d.id !== except).reduce((s, d) => s + (Number(d.postedNet) || 0), 0) : 0), [desk])
  const purchaseSourceOf = useCallback(
    (d: DeskDelivery | null, po: PurchaseOrder | null): PurchaseSource => po?.purchaseSource ?? (d?.rfqId ? rfqs.find((r) => r.id === d.rfqId)?.purchaseSource ?? null : null),
    [rfqs]
  )
  /** A legacy notice is worth its awarded offer's price (ex-VAT) — what the books read. */
  const legacyNetOf = useCallback(
    (d: DeskDelivery | null) => {
      if (!d?.offerId) return null
      const o = world.offers.find((x) => x.id === d.offerId)
      if (!o) return null
      const raw = o.totalBatchesPrice ?? o.price
      const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[,\s]/g, ""))
      return Number.isFinite(n) && n > 0 ? n : null
    },
    [world.offers]
  )

  useEffect(() => {
    if (openDeliveryId && !loading && !openDelivery) toast({ title: t("drawer.notFound"), variant: "destructive" })
    // Only when the id or the loading state changes — not on every list refresh.
  }, [openDeliveryId, loading])

  // Today's «حوّل للمستلم» links here with `forward=1` (P-20): open the forward
  // dialog on that receipt instead of its drawer, once.
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

  const company = useMemo(() => {
    const p = (profile || {}) as { companyName?: string; name?: string; crNumber?: string; taxNumber?: string; city?: string; location?: string; phone?: string; phoneNumber?: string; email?: string }
    return { name: p.companyName || orgName || p.name || "", cr: p.crNumber || null, vat: p.taxNumber || null, address: [p.location, p.city].filter(Boolean).join(" · ") || null, phone: p.phone || p.phoneNumber || null, email: p.email || null }
  }, [profile, orgName])

  // The gate's right — or the buyer's, when the firm has no separate receiver (`buyerReceives`).
  // The owner of a company with a procurement team only reads here: receiving
  // stays in Inventory and Projects, regularising with his buyers.
  const ownerReadOnly = actor.isOwner && team.ownerHasTeam
  const canReceive = !ownerReadOnly && receiveRight(actor, policies) !== null
  const routing = operatingPolicies(policies).noticeRouting
  // Follow-up (forward, remind) is the expediter's; a manual receipt and its
  // regularisation are Procurement's — buyer or manager (S-12, S-13).
  const canFollow = actor.isOwner || actor.canExpedite
  const canPrepare = actor.isOwner || actor.canPrepare || actor.canApprove

  const exportCsv = () => {
    const words = {
      headers: {
        receipt: t("csv.receipt"),
        date: t("csv.date"),
        supplier: t("csv.supplier"),
        po: t("csv.po"),
        material: t("csv.material"),
        perNotice: t("csv.perNotice"),
        counted: t("csv.counted"),
        accepted: t("csv.accepted"),
        rejected: t("csv.rejected"),
        held: t("csv.held"),
        place: t("csv.place"),
        receiver: t("csv.receiver"),
        recordedIn: t("csv.recordedIn"),
      },
      recordedManual: t("csv.recordedManual"),
      modules: { procurement: t("module.procurement"), inventory: t("module.inventory"), projects: t("module.projects") },
      noPo: t("csv.noPo"),
      noNotice: t("csv.noNotice"),
    }
    const rows = receiptCsvRows(desk, orders, (id) => warehouseName(id) || "", words, placeKind)
    const blob = new Blob([receiptCsv(rows, words)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = receiptCsvFilename(now)
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: t("csv.exported") })
  }

  const onReceived = (r: RecordReceiptResult) => {
    setReceiveTarget(null)
    setQuery({ tab: "log", delivery: r.deliveryId })
  }

  const remind = async (po: PurchaseOrder) => {
    if (!firestore) return
    setReminding(po.id)
    try {
      await remindSupplier(firestore, actor, po.id, { copy: tShared as unknown as Translator, locale: locale as "ar" | "en", orgName })
      toast({ title: tOrders(po.supplierUserId ? "toast.reminded_portal" : "toast.reminded_offline") })
    } catch (err) {
      if (err instanceof ProcWriteError) toast({ title: tProc(`err_${err.code}` as "err_wrong_state"), variant: "destructive" })
      else {
        console.error(err)
        toast({ title: tOrders("toast.failed"), variant: "destructive" })
      }
    } finally {
      setReminding(null)
    }
  }

  const segTitle: Record<ReceiptSegment, string> = { incoming: t("segments.incoming"), log: t("segments.log"), nopo: t("segments.nopo") }
  const segInfo: Record<ReceiptSegment, string> = { incoming: t("info.incoming"), log: t("info.log"), nopo: t("info.nopo") }
  const forwardPo = forwardTarget ? poOf(forwardTarget) : null
  const forwardPlace = forwardTarget ? forwardTarget.landedWarehouseId || landingWarehouseId(forwardTarget.projectId || forwardPo?.projectId, projects, orgId) : null

  return (
    <PortalLayout>
      <div className="space-y-5">
        <ProcurementHeader
          title={t("title")}
          description={t("subtitle")}
          sharedAction={
            <Button variant="outline" className="gap-2 rounded-xl border border-border bg-card text-muted-foreground shadow-none hover:bg-card hover:text-foreground" onClick={exportCsv} disabled={loading}>
              <Download size={16} aria-hidden="true" />
              {t("csv.button")}
            </Button>
          }
          action={
            <div className="flex flex-wrap gap-2">
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
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" aria-hidden="true" />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="h-10 w-full ps-9 sm:w-64" dir="auto" />
            </div>
            <Select value={placeFilter} onValueChange={setPlaceFilter}>
              <SelectTrigger className={cn("h-10 w-full sm:w-52", placeFilter !== "all" && "border-module text-module")} aria-label={t("projectFilter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allProjects")}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
                <SelectItem value={PLACE_GENERAL}>{t("place.general")}</SelectItem>
                <SelectItem value={PLACE_WORKSHOP}>{t("place.workshop")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="rounded-xl border border-cta/20 bg-cta/5 p-3 text-xs leading-relaxed text-cta">{segInfo[tab]}</p>

        {loading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="animate-spin text-muted-foreground" size={40} aria-hidden="true" />
          </div>
        ) : tab === "incoming" ? (
          <IncomingList
            rows={incoming}
            all={desk}
            locale={locale}
            now={now}
            routing={routing}
            canReceive={canReceive}
            canFollow={canFollow}
            followsPo={(po) => canFollow && (!po || poActs(po, actor).acts)}
            reminding={reminding}
            receivers={receivers}
            placeOf={(d, po) => (d ? d.landedWarehouseId || landingWarehouseId(d.projectId || po?.projectId, projects, orgId) : landingWarehouseId(po?.projectId, projects, orgId))}
            warehouseName={warehouseName}
            projectName={projectName}
            onReceive={(d, po) => setReceiveTarget({ delivery: d, po })}
            onForward={setForwardTarget}
            onRemind={remind}
            onOpen={(id) => setQuery({ delivery: id })}
          />
        ) : (
          <ReceiptList
            all={desk}
            rows={tab === "log" ? logShown : nopo}
            total={tab === "log" ? logShown.length : nopo.length}
            locale={locale}
            onOpen={(id) => setQuery({ delivery: id })}
            warehouseName={warehouseName}
            projectName={projectName}
            placeKind={placeKind}
            nopo={tab === "nopo"}
            logFilter={tab === "log" ? logFilter : null}
            onLogFilter={setLogFilter}
          />
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
            onReceive={(d) => setReceiveTarget({ delivery: d, po: poOf(d) })}
            onRegularise={(d) => setRegulariseTarget(d)}
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
        {receiveTarget && (
          <ReceiveDeliveryDialog
            open
            onOpenChange={(o) => !o && setReceiveTarget(null)}
            delivery={receiveTarget.delivery}
            po={receiveTarget.po}
            policies={policies}
            actor={actor}
            orgId={orgId}
            projectName={projectName(receiveTarget.delivery?.projectId || receiveTarget.po?.projectId)}
            alreadyPostedNet={alreadyPosted(receiveTarget.po, receiveTarget.delivery?.id)}
            legacyNet={legacyNetOf(receiveTarget.delivery)}
            purchaseSource={purchaseSourceOf(receiveTarget.delivery, receiveTarget.po)}
            warehouses={warehouses}
            defaultWarehouseId={null}
            onDone={onReceived}
          />
        )}

        <ManualReceiptDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          actor={actor}
          orgId={orgId}
          orders={orders}
          policies={policies}
          warehouses={warehouses}
          projects={projects}
          alreadyPostedNet={(po) => alreadyPosted(po)}
          projectName={projectName}
          onDone={(deliveryId, tabAfter) => {
            setManualOpen(false)
            setQuery({ tab: tabAfter, delivery: deliveryId })
          }}
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

/** The drawer, with what only it reads: the need behind the order (for the
 * trail) and the supplier's identity (for the print) — loaded while it is open. */
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

// ---------------------------------------------------------------------------
// On the way
// ---------------------------------------------------------------------------

interface IncomingListProps {
  rows: IncomingRow[]
  all: DeskDelivery[]
  locale: string
  now: Date
  routing: NoticeRouting
  canReceive: boolean
  canFollow: boolean
  /** Follow-up on an order: the owner only reads others' orders once the company has buyers (poActs). */
  followsPo: (po: PurchaseOrder | null | undefined) => boolean
  reminding: string | null
  receivers: ProcReceiver[]
  placeOf: (d: DeskDelivery | null, po: PurchaseOrder | null) => string | null
  warehouseName: (id: string | null | undefined) => string | null
  projectName: (id: string | null | undefined) => string | null
  onReceive: (d: DeskDelivery | null, po: PurchaseOrder | null) => void
  onForward: (d: DeskDelivery) => void
  onRemind: (po: PurchaseOrder) => void
  onOpen: (id: string) => void
}

function IncomingList(props: IncomingListProps) {
  const { rows, all, locale, now, routing, canReceive, followsPo, reminding, receivers, placeOf, warehouseName, projectName, onReceive, onForward, onRemind, onOpen } = props
  const t = useTranslations("Portal.ProcReceipts")
  const dayText = useDateText()
  const tp = useTranslations("Portal.Procurement")
  const tc = useTranslations("Portal.Contractor")
  const when = useWhenText()

  return (
    <section className="rounded-xl border bg-card">
      <header className="space-y-1 border-b px-4 py-3">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold">
          {t("incoming.panelTitle")}
          <Badge className="border-none bg-module/10 text-[11px] font-bold tabular-nums text-module">{rows.length}</Badge>
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{routing === "both" ? t("incoming.panelSubBoth") : t("incoming.panelSub")}</p>
      </header>
      {!rows.length ? (
        <Empty text={t("empty.incoming")} />
      ) : (
        <ul className="divide-y">
          {rows.map((r) => {
            const po: PurchaseOrder | null = r.po
            const notice = r.kind === "notice" ? r.delivery : null
            const duePo = r.kind === "due" ? r.po : null
            const supplier = notice ? notice.supplierName || po?.supplierName : duePo?.supplierName
            const items = notice
              ? notice.lines?.length
                ? notice.lines.map((l) => `${fmt(l.noticeQuantity)} ${l.unit} ${l.name}`)
                : (notice.items || []).map((it) => `${it.quantity ?? ""} ${it.unitOfMeasure || it.unit || ""} ${it.name || ""}`.trim())
              : (duePo?.lines || []).filter((l) => lineToArrive(l) > 0).map((l) => `${fmt(lineToArrive(l))} ${l.unit} ${l.name}`)
            const project = projectName(notice ? notice.projectId || po?.projectId : duePo?.projectId)
            const place = placeOf(notice, po)
            const placeName = warehouseName(place) || tc("wh_central_name")
            const suggested = suggestedReceiver(receivers, place)
            const fw = notice?.forwardedTo || null
            const fwState = notice ? forwardState(notice) : "none"
            const ship = notice ? shipmentOrdinal(notice, all, po) : null
            const pill = incomingPill(r, routing)
            const noticeNo = notice ? noticeNumberOf(notice, all, po) : null
            const remindBlocked = po ? reminderCooldownUntil(po, now) != null : true
            const fwModule = fw?.userId ? receivers.find((x) => x.userId === fw.userId)?.module : null
            const attachments = (notice?.attachmentUrls || []).length
            return (
              <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-bold" dir="auto">{supplier || "—"}</span>
                    {po && <span className="text-muted-foreground">· {displayPoNumber(po.docNumber, locale)}</span>}
                    {noticeNo && (
                      <Badge variant="outline" className="text-[10px]">
                        <bdi>{displayNoticeNumber(noticeNo, locale)}</bdi>
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {items.length ? items.join(" · ") : notice ? notice.rfqTitle || "—" : po?.rfqTitle}
                    {ship && <> · {ship.m ? t("incoming.shipmentOf", { n: ship.n, m: ship.m }) : t("incoming.shipment", { n: ship.n })}</>}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                    <MapPin size={11} aria-hidden="true" />
                    <span dir="auto">{placeName}</span>
                    {project && <span dir="auto">· {project}</span>}
                    <span>·</span>
                    {fw ? (
                      <>
                        <span dir="auto">{t("incoming.forwardedTo", { name: fw.name })}</span>
                        {fw.userId ? (
                          fwModule && <Badge className={cn("border-none text-[10px] font-bold", RECORDED_TONE[fwModule])}>{t(`module.${fwModule}`)}</Badge>
                        ) : (
                          <>
                            <span dir="ltr">{fw.phoneMasked}</span>
                            <Badge className="border-none bg-module/10 text-[10px] font-bold text-module">{t("incoming.byLink")}</Badge>
                          </>
                        )}
                        <span>{fw.auto ? t("incoming.forwardedAuto", { when: when(fw.at) }) : t("incoming.forwardedBy", { name: fw.byName, when: when(fw.at) })}</span>
                      </>
                    ) : suggested ? (
                      <>
                        <span dir="auto">{t("incoming.suggested", { name: suggested.name })}</span>
                        <Badge className={cn("border-none text-[10px] font-bold", RECORDED_TONE[suggested.module])}>{t(`module.${suggested.module}`)}</Badge>
                      </>
                    ) : (
                      <span>{t("incoming.noReceiver")}</span>
                    )}
                  </p>
                  {notice && (
                    <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                      <Truck size={11} aria-hidden="true" />
                      <span dir="auto">{notice.deliveryPersonName || t("incoming.driverUnknown")}</span>
                      {notice.driverPhone && (
                        <a href={`tel:${notice.driverPhone.replace(/\s/g, "")}`} dir="ltr" className="font-semibold text-cta underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {notice.driverPhone}
                        </a>
                      )}
                      {notice.vehiclePlate && <bdi>· {notice.vehiclePlate}</bdi>}
                      <span>·</span>
                      {notice.paperNoteNumber ? (
                        <span>
                          {t("incoming.note")} <span dir="ltr">{notice.paperNoteNumber}</span>
                        </span>
                      ) : (
                        <span>{t("incoming.noNoteYet")}</span>
                      )}
                      {(notice.qualityPapers?.length ?? 0) > 0 && <span>· {(notice.qualityPapers ?? []).map((q) => t(`incoming.paper_${q}`)).join(" · ")}</span>}
                      {attachments > 0 && (
                        <span className="inline-flex items-center gap-0.5" aria-label={t("incoming.attachments", { n: attachments })}>
                          <Paperclip size={11} aria-hidden="true" />
                          {attachments}
                        </span>
                      )}
                    </p>
                  )}
                  {fwState === "signed" && notice && (
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-success">
                      <PenLine size={11} aria-hidden="true" />
                      <span dir="auto">{t("forward.signedBy", { name: notice.receiverReport!.receiverName })}</span>
                    </p>
                  )}
                  {r.kind === "due" && (
                    <p className="flex items-center gap-1.5 text-[11px] text-amber-800">
                      <AlertTriangle size={11} aria-hidden="true" />
                      {t("incoming.dueHint")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                    <span className="text-sm font-bold tabular-nums">{r.day ? dayText(r.day) : "—"}</span>
                    <span className="text-[11px] text-muted-foreground">{notice ? (notice.deliveryWindow ? tp(`deliveryWindow.${notice.deliveryWindow}` as "deliveryWindow.morning") : "") : t("incoming.supplierDate")}</span>
                    <IncomingPillBadge pill={pill} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {notice && (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onOpen(notice.id)}>
                        {t("incoming.details")}
                      </Button>
                    )}
                    {po && (
                      <Button asChild size="sm" variant="outline" className="h-8 gap-1 text-xs">
                        <Link href={procLinks.order(po.id)}>
                          <ExternalLink size={12} aria-hidden="true" />
                          {t("incoming.openOrder")}
                        </Link>
                      </Button>
                    )}
                    {followsPo(po) && notice && fwState !== "signed" && (
                      <Button size="sm" variant={fwState === "forwarded" ? "outline" : "default"} className="h-8 gap-1 text-xs" onClick={() => onForward(notice)}>
                        <Forward size={12} aria-hidden="true" />
                        {fwState === "forwarded" ? t("forward.again") : t("forward.button")}
                      </Button>
                    )}
                    {duePo && followsPo(duePo) && (
                      <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={remindBlocked || reminding === duePo.id} onClick={() => onRemind(duePo)} title={remindBlocked ? tp("err_reminded_recently") : undefined}>
                        {reminding === duePo.id ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <BellRing size={12} aria-hidden="true" />}
                        {t("incoming.remind")}
                      </Button>
                    )}
                    {canReceive && (
                      <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => onReceive(notice, po)}>
                        <ClipboardCheck size={12} aria-hidden="true" />
                        {notice ? t("incoming.record") : t("incoming.recordNoNotice")}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function IncomingPillBadge({ pill }: { pill: ReturnType<typeof incomingPill> }) {
  const t = useTranslations("Portal.ProcReceipts")
  const bad = "bg-destructive/10 text-destructive"
  const warn = "bg-amber-100 text-amber-800"
  const ok = "bg-success/10 text-success"
  const [tone, text] =
    pill.kind === "to_forward"
      ? [pill.tone === "bad" ? bad : warn, t("incoming.toForward")]
      : pill.kind === "auto_forwarded"
        ? [warn, t("incoming.autoForwarded")]
      : pill.kind === "due_late"
        ? [bad, t("incoming.lateNoNotice", { days: pill.days })]
        : pill.kind === "due_no_notice"
          ? [warn, t("incoming.noNoticeYet")]
          : pill.kind === "after_promise"
            ? [bad, t("incoming.afterPromise", { days: pill.days })]
            : pill.kind === "passed_no_receipt"
              ? [bad, t("incoming.passedNoReceipt")]
              : [ok, pill.days == null ? t("segments.incoming") : t("incoming.inDays", { days: pill.days })]
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
  warehouseName: (id: string | null | undefined) => string | null
  projectName: (id: string | null | undefined) => string | null
  placeKind: (d: DeskDelivery, po: PurchaseOrder | null) => DestKind | null
  nopo: boolean
  logFilter: LogCompleteness | null
  onLogFilter: (f: LogCompleteness) => void
}

function ReceiptList({ all, rows, total, locale, onOpen, warehouseName, projectName, placeKind, nopo, logFilter, onLogFilter }: ReceiptListProps) {
  const t = useTranslations("Portal.ProcReceipts")
  const tp = useTranslations("Portal.Procurement")
  const when = useWhenText()
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          {t("log.panelTitle")}
          <Badge variant="outline" className="text-[11px] tabular-nums">{total}</Badge>
        </h2>
        {logFilter && (
          <Select value={logFilter} onValueChange={(v) => onLogFilter(v as LogCompleteness)}>
            <SelectTrigger className={cn("h-9 w-full sm:w-64", logFilter !== "all" && "border-module text-module")} aria-label={t("log.filterLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOG_COMPLETENESS.map((f) => (
                <SelectItem key={f} value={f}>{t(`log.filter_${f}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>
      {!rows.length ? (
        <Empty text={nopo ? t("empty.nopo") : t("empty.log")} />
      ) : (
        <table className="w-full text-sm">
          <thead className="hidden bg-muted/50 text-xs text-muted-foreground md:table-header-group">
            <tr>
              <th className="px-3 py-2 text-start font-semibold">{t("log.colReceipt")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("log.colSupplierPo")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("log.colAccepted")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("log.colWhere")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("log.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = r.delivery
              const number = d.docNumber ? displayReceiptNumber(d.docNumber, locale) : `DEL-${d.id.slice(0, 8).toUpperCase()}`
              const placeId = d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId
              const place = warehouseName(placeId)
              const project = projectName(d.projectId || r.po?.projectId)
              const kind = placeKind(d, r.po)
              const by = recordedBy(d, kind)
              const time = isoOf(d.confirmedAt)
              const noticeNo = noticeNumberOf(d, all, r.po)
              return (
                <tr key={d.id} onClick={() => onOpen(d.id)} className="grid cursor-pointer grid-cols-1 gap-1 border-t px-3 py-3 hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none md:table-row md:px-0 md:py-0" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(d.id)}>
                  <td className="md:px-3 md:py-2.5">
                    <p className="font-bold">{number}</p>
                    <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span dir="ltr">{time && time.length > 10 ? when(time) : r.day || "—"}</span>
                      <RecordedByPill by={by} manual={d.source === "manual"} />
                    </p>
                  </td>
                  <td className="md:px-3 md:py-2.5">
                    <p className="font-semibold" dir="auto">{d.supplierName || r.po?.supplierName || "—"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.po ? displayPoNumber(r.po.docNumber, locale) : d.poNumber ? displayPoNumber(d.poNumber, locale) : <span className="font-bold text-destructive">{t("log.noPo")}</span>}
                      {noticeNo && (
                        <>
                          {" · "}
                          <bdi>{displayNoticeNumber(noticeNo, locale)}</bdi>
                        </>
                      )}
                      {d.paperNoteNumber && !d.noNotice && (
                        <>
                          {" · "}
                          {t("incoming.note")} <span dir="ltr">{d.paperNoteNumber}</span>
                        </>
                      )}
                    </p>
                  </td>
                  <td className="md:px-3 md:py-2.5">
                    <p className="text-xs" dir="auto">{r.lines.map((l) => `${l.name} ${fmt(l.accepted ?? 0)} ${l.unit}`).join(" · ") || "—"}</p>
                    <p className="flex flex-wrap gap-x-2 text-[11px]">
                      {r.rejected > 0 && <span className="text-destructive">{t("log.rejected", { qty: fmt(r.rejected) })}</span>}
                      {r.held > 0 && <span className="text-module">{t("log.held", { qty: fmt(r.held) })}</span>}
                      {r.short > 0 && <span className="text-amber-700">{t("log.short", { qty: fmt(r.short) })}</span>}
                    </p>
                  </td>
                  <td className="md:px-3 md:py-2.5">
                    <p className="text-xs">
                      <span dir="auto">{place || project || (nopo ? "—" : t("log.generalStock"))}</span>
                      {kind && <span className="ms-1 text-[11px] text-muted-foreground">{t(`dest.${kind}`)}</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground" dir="auto">{d.receivedByName || "—"}</p>
                  </td>
                  <td className="md:px-3 md:py-2.5">
                    {d.regularisation === "expense" ? <Badge variant="outline" className="text-[11px]">{t("log.expense")}</Badge> : <ReceiptStatePill state={r.state} />}
                    {r.complete != null && (
                      <p className={cn("mt-1 text-[11px]", r.complete ? "text-success" : "text-amber-700")}>{r.complete ? t("log.complete") : t("log.incompleteLeft", { qty: fmt(r.remaining ?? 0) })}</p>
                    )}
                    {d.source === "manual" && <p className="text-[11px] text-destructive">{t("log.recordedManually")}</p>}
                    {d.selfReceived && d.source !== "manual" && <p className="text-[11px] text-destructive">{tp("exception.self_received")}</p>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-16 text-center">
      <PackageCheck size={40} className="text-muted-foreground/30" aria-hidden="true" />
      <p className="text-sm font-medium text-muted-foreground">{text}</p>
    </div>
  )
}

