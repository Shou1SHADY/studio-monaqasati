"use client"

// The goods-received desk (PRD 3.0 §7.2 "Goods receipts"): three segments —
// On the way (the suppliers' pending notices, and live orders whose promised
// day is near or past with no notice), Receipts (the log, with the state of
// each), No PO (manual receipts waiting to be regularised by a retroactive
// order, or booked as a cash expense). Search runs across the segments, the
// project filter narrows all three, the CSV exports the whole log without a
// money column. `?tab=` names the segment, `?delivery=<id>` opens the drawer;
// the receive screen and the drawer live in src/components/procurement.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { AlertTriangle, ClipboardCheck, Download, ExternalLink, Forward, Loader2, PackageCheck, PenLine, PlusCircle, Search, Truck } from "lucide-react"
import { ForwardReceiptDialog } from "@/components/procurement/ForwardReceiptDialog"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { ManualReceiptDialog } from "@/components/procurement/ManualReceiptDialog"
import { ReceiptDrawer, ReceiptStatePill } from "@/components/procurement/ReceiptDrawer"
import { ReceiveDeliveryDialog } from "@/components/procurement/ReceiveDeliveryDialog"
import { RegulariseReceiptDialog } from "@/components/procurement/RegulariseReceiptDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { Link, usePathname, useRouter } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { procLinks } from "@/lib/procurement/events"
import { displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { lineToArrive } from "@/lib/procurement/po"
import {
  RECEIPT_SEGMENTS,
  incomingRowMatches,
  forwardState,
  incomingRows,
  receiptCsv,
  receiptCsvFilename,
  receiptCsvRows,
  receiptRowMatches,
  receiptRows,
  segmentCounts,
  type DeskDelivery,
  type IncomingRow,
  type ReceiptRow,
  type ReceiptSegment,
} from "@/lib/procurement/receipt-desk"
import { markReceiptAsExpense, type PurchaseSource, type RecordReceiptResult } from "@/lib/procurement/receipt-writes"
import type { PurchaseOrder } from "@/lib/procurement/types"

const isSegment = (v: string | null): v is ReceiptSegment => RECEIPT_SEGMENTS.includes(v as ReceiptSegment)
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)

export default function GoodsReceivedPage() {
  const t = useTranslations("Portal.ProcReceipts")
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
  const [projectFilter, setProjectFilter] = useState<string>("all")
  const [manualOpen, setManualOpen] = useState(false)
  const [receiveTarget, setReceiveTarget] = useState<{ delivery: DeskDelivery | null; po: PurchaseOrder | null } | null>(null)
  const [regulariseTarget, setRegulariseTarget] = useState<DeskDelivery | null>(null)
  const [forwardTarget, setForwardTarget] = useState<DeskDelivery | null>(null)

  const warehousesQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const projectsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: warehousesData } = useCollection(warehousesQ)
  const { data: projectsData } = useCollection(projectsQ)
  const warehouses = useMemo(() => ((warehousesData || []) as Array<{ id: string; name: string; projectId?: string | null }>), [warehousesData])
  const projects = useMemo(() => ((projectsData || []) as Array<{ id: string; name: string; warehouseId?: string | null }>), [projectsData])
  const warehouseName = useCallback((id: string | null | undefined) => (id ? warehouses.find((w) => w.id === id)?.name || null : null), [warehouses])
  const projectName = useCallback((id: string | null | undefined) => (id ? projects.find((p) => p.id === id)?.name || null : null), [projects])

  const desk = deliveries as DeskDelivery[]
  const filter = useMemo(() => ({ term, projectId: projectFilter === "all" ? null : projectFilter }), [term, projectFilter])
  const counts = useMemo(() => segmentCounts(desk, orders, filter, now), [desk, orders, filter, now])
  const incoming = useMemo(() => incomingRows(desk, orders, now).filter((r) => incomingRowMatches(r, filter)), [desk, orders, filter, now])
  const log = useMemo(() => receiptRows(desk, orders, "log", now).filter((r) => receiptRowMatches(r, filter)), [desk, orders, filter, now])
  const nopo = useMemo(() => receiptRows(desk, orders, "nopo", now).filter((r) => receiptRowMatches(r, filter)), [desk, orders, filter, now])

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

  // The drawer's project filter follows the segment: a `?delivery=` link from
  // the bell may name a delivery of another segment — the drawer opens anyway.
  useEffect(() => {
    if (openDeliveryId && !loading && !openDelivery) toast({ title: t("drawer.notFound"), variant: "destructive" })
    // Only when the id or the loading state changes — not on every list refresh.
  }, [openDeliveryId, loading])

  const company = useMemo(() => {
    const p = (profile || {}) as { companyName?: string; name?: string; crNumber?: string; taxNumber?: string; city?: string; location?: string; phone?: string; phoneNumber?: string; email?: string }
    return { name: p.companyName || orgName || p.name || "", cr: p.crNumber || null, vat: p.taxNumber || null, address: [p.location, p.city].filter(Boolean).join(" · ") || null, phone: p.phone || p.phoneNumber || null, email: p.email || null }
  }, [profile, orgName])

  const canReceive = actor.isOwner || actor.canReceive

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
      recordedGate: t("csv.recordedGate"),
      noPo: t("csv.noPo"),
      noNotice: t("csv.noNotice"),
    }
    const rows = receiptCsvRows(desk, orders, (id) => warehouseName(id) || "", words)
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

  const markExpense = async (d: DeskDelivery) => {
    if (!firestore) return
    try {
      await markReceiptAsExpense(firestore, actor, d.id)
      toast({ title: t("regularise.expenseDone") })
    } catch (err) {
      console.error(err)
      toast({ title: t("toast.failed"), variant: "destructive" })
    }
  }

  const segTitle: Record<ReceiptSegment, string> = { incoming: t("segments.incoming"), log: t("segments.log"), nopo: t("segments.nopo") }
  const segInfo: Record<ReceiptSegment, string> = { incoming: t("info.incoming"), log: t("info.log"), nopo: t("info.nopo") }

  return (
    <PortalLayout>
      <div className="space-y-5">
        <ProcurementHeader
          icon={PackageCheck}
          title={t("title")}
          description={t("subtitle")}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={loading}>
                <Download size={16} aria-hidden="true" />
                {t("csv.button")}
              </Button>
              {canReceive && (
                <Button className="gap-2" onClick={() => setManualOpen(true)}>
                  <PlusCircle size={18} aria-hidden="true" />
                  {t("manual.button")}
                </Button>
              )}
            </div>
          }
        />

        {/* Segments + tools */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="tablist" aria-label={t("title")} className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1">
            {RECEIPT_SEGMENTS.map((s) => (
              <button
                key={s}
                role="tab"
                type="button"
                aria-selected={tab === s}
                onClick={() => setQuery({ tab: s })}
                className={cn(
                  "flex min-h-[40px] items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  tab === s ? "bg-background text-module shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {segTitle[s]}
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === s ? "bg-module/10 text-module" : "bg-muted text-muted-foreground")}>{counts[s]}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" aria-hidden="true" />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="h-10 w-full ps-9 sm:w-64" dir="auto" />
            </div>
            {projects.length > 0 && (
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="h-10 w-full sm:w-52" aria-label={t("projectFilter")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allProjects")}</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <p className="rounded-lg border border-module/20 bg-module/5 p-3 text-xs leading-relaxed text-foreground/80">{segInfo[tab]}</p>

        {loading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="animate-spin text-muted-foreground" size={40} aria-hidden="true" />
          </div>
        ) : tab === "incoming" ? (
          <IncomingList rows={incoming} locale={locale} canReceive={canReceive} onReceive={(d, po) => setReceiveTarget({ delivery: d, po })} onForward={setForwardTarget} onOpen={(id) => setQuery({ delivery: id })} projectName={projectName} />
        ) : (
          <ReceiptList rows={tab === "log" ? log : nopo} locale={locale} onOpen={(id) => setQuery({ delivery: id })} warehouseName={warehouseName} projectName={projectName} nopo={tab === "nopo"} />
        )}

        {openDelivery && (
          <ReceiptDrawer
            delivery={openDelivery}
            po={poOf(openDelivery)}
            onOpenChange={(o) => !o && setQuery({ delivery: null })}
            actor={actor}
            company={company}
            warehouseName={warehouseName}
            projectName={projectName}
            now={now}
            onReceive={(d) => setReceiveTarget({ delivery: d, po: poOf(d) })}
            onRegularise={(d) => setRegulariseTarget(d)}
            onMarkExpense={markExpense}
          />
        )}

        {forwardTarget && (
          <ForwardReceiptDialog
            open={Boolean(forwardTarget)}
            onOpenChange={(o) => !o && setForwardTarget(null)}
            deliveryId={forwardTarget.id}
            supplierName={forwardTarget.supplierName || ""}
            orgId={orgId}
            projectId={forwardTarget.projectId || null}
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
            onOpenChange={(o) => !o && setRegulariseTarget(null)}
            onDone={(poId) => {
              setRegulariseTarget(null)
              router.push(procLinks.order(poId))
            }}
          />
        )}
      </div>
    </PortalLayout>
  )
}

// ---------------------------------------------------------------------------
// On the way
// ---------------------------------------------------------------------------

function IncomingList({ rows, locale, canReceive, onReceive, onForward, onOpen, projectName }: { rows: IncomingRow[]; locale: string; canReceive: boolean; onReceive: (d: DeskDelivery | null, po: PurchaseOrder | null) => void; onForward: (d: DeskDelivery) => void; onOpen: (id: string) => void; projectName: (id: string | null | undefined) => string | null }) {
  const t = useTranslations("Portal.ProcReceipts")
  const tp = useTranslations("Portal.Procurement")
  if (!rows.length) return <Empty text={t("empty.incoming")} />
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const po: PurchaseOrder | null = r.po
        const supplier = r.kind === "notice" ? r.delivery.supplierName || po?.supplierName : r.po.supplierName
        const items = r.kind === "notice" ? (r.delivery.lines?.length ? r.delivery.lines.map((l) => `${fmt(l.noticeQuantity)} ${l.unit} ${l.name}`) : (r.delivery.items || []).map((it) => `${it.quantity ?? ""} ${it.unitOfMeasure || it.unit || ""} ${it.name || ""}`.trim())) : r.po.lines.filter((l) => lineToArrive(l) > 0).map((l) => `${fmt(lineToArrive(l))} ${l.unit} ${l.name}`)
        const project = projectName(r.kind === "notice" ? r.delivery.projectId || po?.projectId : r.po.projectId)
        const pill =
          r.kind === "due" ? (
            <Badge className={cn("border-none text-[11px] font-bold", r.daysLate > 0 ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-800")}>{r.daysLate > 0 ? t("incoming.lateNoNotice", { days: r.daysLate }) : t("incoming.noNoticeYet")}</Badge>
          ) : r.state === "late_notice" ? (
            <Badge className="border-none bg-destructive/10 text-[11px] font-bold text-destructive">{tp("receiptState.late_notice")}</Badge>
          ) : r.afterPromise > 0 ? (
            <Badge className="border-none bg-destructive/10 text-[11px] font-bold text-destructive">{t("incoming.afterPromise", { days: r.afterPromise })}</Badge>
          ) : (
            <Badge className="border-none bg-success/10 text-[11px] font-bold text-success">{r.daysFromNow == null ? tp("receiptState.on_the_way") : t("incoming.inDays", { days: r.daysFromNow })}</Badge>
          )
        return (
          <div key={r.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-bold" dir="auto">{supplier || "—"}</span>
                {po && <span className="text-muted-foreground">· {displayPoNumber(po.docNumber, locale)}</span>}
                {r.kind === "notice" && r.delivery.paperNoteNumber && <Badge variant="outline" className="text-[10px]" dir="ltr">{r.delivery.paperNoteNumber}</Badge>}
              </p>
              <p className="text-xs text-muted-foreground" dir="auto">{items.length ? items.join(" · ") : r.kind === "notice" ? r.delivery.rfqTitle || "—" : po?.rfqTitle}</p>
              {project && <p className="text-[11px] text-muted-foreground">{project}</p>}
              {r.kind === "notice" && (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Truck size={11} aria-hidden="true" />
                  <span dir="auto">{r.delivery.deliveryPersonName || t("incoming.driverUnknown")}</span>
                  {r.delivery.vehiclePlate && <span dir="ltr">· {r.delivery.vehiclePlate}</span>}
                </p>
              )}
              {r.kind === "notice" && forwardState(r.delivery) === "forwarded" && (
                <p className="flex items-center gap-1.5 text-[11px] text-module">
                  <Forward size={11} aria-hidden="true" />
                  <span dir="auto">{t("forward.forwardedTo", { name: r.delivery.forwardedTo!.name, phone: r.delivery.forwardedTo!.phoneMasked })}</span>
                </p>
              )}
              {r.kind === "notice" && forwardState(r.delivery) === "signed" && (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-success">
                  <PenLine size={11} aria-hidden="true" />
                  <span dir="auto">{t("forward.signedBy", { name: r.delivery.receiverReport!.receiverName })}</span>
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
                <span className="text-sm font-bold tabular-nums" dir="ltr">{r.day || "—"}</span>
                {pill}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.kind === "notice" && (
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onOpen(r.delivery.id)}>
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
                {canReceive && r.kind === "notice" && forwardState(r.delivery) !== "signed" && (
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => onForward(r.delivery)}>
                    <Forward size={12} aria-hidden="true" />
                    {forwardState(r.delivery) === "forwarded" ? t("forward.again") : t("forward.button")}
                  </Button>
                )}
                {canReceive && (
                  <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => onReceive(r.kind === "notice" ? r.delivery : null, po)}>
                    <ClipboardCheck size={12} aria-hidden="true" />
                    {r.kind === "notice" ? t("incoming.record") : t("incoming.recordNoNotice")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Receipts / No PO
// ---------------------------------------------------------------------------

function ReceiptList({ rows, locale, onOpen, warehouseName, projectName, nopo }: { rows: ReceiptRow[]; locale: string; onOpen: (id: string) => void; warehouseName: (id: string | null | undefined) => string | null; projectName: (id: string | null | undefined) => string | null; nopo: boolean }) {
  const t = useTranslations("Portal.ProcReceipts")
  const tp = useTranslations("Portal.Procurement")
  if (!rows.length) return <Empty text={nopo ? t("empty.nopo") : t("empty.log")} />
  return (
    <div className="overflow-hidden rounded-lg border">
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
            const place = warehouseName(d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId)
            const project = projectName(d.projectId || r.po?.projectId)
            return (
              <tr key={d.id} onClick={() => onOpen(d.id)} className="grid cursor-pointer grid-cols-1 gap-1 border-t px-3 py-3 hover:bg-muted/30 md:table-row md:px-0 md:py-0" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(d.id)}>
                <td className="md:px-3 md:py-2.5">
                  <p className="font-bold">{number}</p>
                  <p className="text-[11px] text-muted-foreground" dir="ltr">{r.day || "—"}</p>
                  {d.source === "manual" && <Badge variant="outline" className="mt-1 text-[10px]">{t("log.recordedManually")}</Badge>}
                </td>
                <td className="md:px-3 md:py-2.5">
                  <p className="font-semibold" dir="auto">{d.supplierName || r.po?.supplierName || "—"}</p>
                  <p className="text-[11px] text-muted-foreground">{r.po ? displayPoNumber(r.po.docNumber, locale) : d.poNumber ? displayPoNumber(d.poNumber, locale) : <span className="font-bold text-destructive">{t("log.noPo")}</span>}</p>
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
                  <p className="text-xs">{place || project || (nopo ? "—" : t("log.generalStock"))}</p>
                  <p className="text-[11px] text-muted-foreground" dir="auto">{d.receivedByName || "—"}</p>
                </td>
                <td className="md:px-3 md:py-2.5">
                  {d.regularisation === "expense" ? <Badge variant="outline" className="text-[11px]">{t("log.expense")}</Badge> : <ReceiptStatePill state={r.state} />}
                  {r.complete != null && (
                    <p className={cn("mt-1 text-[11px]", r.complete ? "text-success" : "text-amber-700")}>{r.complete ? t("log.complete") : t("log.incomplete")}</p>
                  )}
                  {d.selfReceived && <p className="text-[11px] text-destructive">{tp("exception.self_received")}</p>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/30 p-16 text-center">
      <PackageCheck size={40} className="text-muted-foreground/30" aria-hidden="true" />
      <p className="text-sm font-medium text-muted-foreground">{text}</p>
    </div>
  )
}
