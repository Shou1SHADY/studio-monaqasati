"use client"

// The receipt drawer (PRD 3.0 §7.3, prototype `dGrn`): read-only by design —
// the gate recorded it, Procurement reads it and acts only on its
// consequences. A receipt is never edited after recording (a later receipt or
// a return to the supplier corrects it), so nothing here uploads or changes
// the record: attachments come with the receipt.
//
// On an order: who/what/where with links, the lines (notice · counted ·
// accepted · accepted before this receipt · open now), what follows (rejects
// decided here with the supplier — replacement date or discounted price —,
// held, short), attachments & checklist, the seven-step material trail, the
// log, and rating the supplier once the order is whole. With no order: what
// the receiver typed (unit prices and the invoice value for price roles) and
// the one door to regularise it. A pending notice opens the same drawer with
// the notice's facts and the "Record the receipt" door.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, ExternalLink, FileText, Info, Printer, ShieldAlert, Star, Truck } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { withSarSign } from "@/lib/riyal"
import type { Translator } from "@/lib/mfg-events"
import { displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { RECEIPT_CHECKS, acceptedOf, canRate, lineToArrive, round2 } from "@/lib/procurement/po"
import { procLinks } from "@/lib/procurement/events"
import { RFQ_HREF } from "@/lib/procurement/today"
import { receiptState, shortVsNotice, type ReceiptState } from "@/lib/procurement/receipts"
import {
  acceptedBefore,
  isNoPo,
  isoOf,
  noPoInvoiceValue,
  receiptLinesOf,
  receiptLog,
  receiptTrail,
  recordedBy,
  rejectTermsOf,
  type DeskDelivery,
  type DestKind,
  type RecordedBy,
  type TrailState,
} from "@/lib/procurement/receipt-desk"
import { printGoodsReceipt, type ReceiptPrintCompany } from "@/lib/procurement/receipt-print"
import type { PoLine, ProcActor, PurchaseOrder, ReceiptCheck, RejectDecision } from "@/lib/procurement/types"
import { ProcWriteError, decideReject, ratePurchaseOrder, type RatingInput } from "@/lib/procurement/writes"
import { RejectDecisionDialog } from "./PoActionDialogs"
import { PoRateDialog } from "./PoRateDialog"

const STATE_TONE: Record<ReceiptState, string> = {
  on_the_way: "bg-success/10 text-success",
  late_notice: "bg-destructive/10 text-destructive",
  received: "bg-success/10 text-success",
  received_with_rejects: "bg-amber-100 text-amber-800",
  received_held: "bg-module/10 text-module",
  received_short: "bg-amber-100 text-amber-800",
  manual_no_po: "bg-destructive/10 text-destructive",
}

export function ReceiptStatePill({ state, className }: { state: ReceiptState; className?: string }) {
  const tp = useTranslations("Portal.Procurement")
  return <Badge className={cn("border-none text-[11px] font-bold", STATE_TONE[state], className)}>{tp(`receiptState.${state}`)}</Badge>
}

export const RECORDED_TONE: Record<RecordedBy, string> = {
  procurement: "bg-destructive/10 text-destructive",
  inventory: "bg-cta/10 text-cta",
  projects: "bg-pm/10 text-pm",
}

/** Which module recorded a receipt — the prototype's `recM`. */
export function RecordedByPill({ by, manual }: { by: RecordedBy; manual?: boolean }) {
  const t = useTranslations("Portal.ProcReceipts")
  return <Badge className={cn("border-none text-[10px] font-bold", RECORDED_TONE[by])}>{manual ? t("recordedBy.manual") : t(`recordedBy.${by}`)}</Badge>
}

const fmt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n))

export interface ReceiptDrawerProps {
  delivery: DeskDelivery | null
  po: PurchaseOrder | null
  /** Every delivery of the org — for "accepted before this receipt" and the rating's facts. */
  deliveries: DeskDelivery[]
  onOpenChange: (open: boolean) => void
  actor: ProcActor
  orgName: string
  company: ReceiptPrintCompany
  warehouseName: (id: string | null | undefined) => string | null
  projectName: (id: string | null | undefined) => string | null
  placeKind: (d: DeskDelivery, po: PurchaseOrder | null) => DestKind | null
  now: Date
  onReceive?: (d: DeskDelivery) => void
  onRegularise?: (d: DeskDelivery) => void
}

const TRAIL_ICON: Record<TrailState, typeof CheckCircle2> = { ok: CheckCircle2, bad: AlertTriangle, now: Clock }
const TRAIL_TONE: Record<TrailState, string> = { ok: "bg-success/10 text-success", bad: "bg-destructive/10 text-destructive", now: "bg-amber-100 text-amber-800" }

export function ReceiptDrawer(props: ReceiptDrawerProps) {
  const { delivery: d, po, deliveries, onOpenChange, actor, orgName, company, warehouseName, projectName, placeKind, now, onReceive, onRegularise } = props
  const t = useTranslations("Portal.ProcReceipts")
  const tp = useTranslations("Portal.Procurement")
  const tOrders = useTranslations("Portal.ProcOrders")
  const tShared = useTranslations("Portal.Shared")
  const tPrint = useTranslations("Portal.ProcReceipts.print")
  const tc = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const [rejectLine, setRejectLine] = useState<PoLine | null>(null)
  const [rateOpen, setRateOpen] = useState(false)

  const lines = useMemo(() => (d ? receiptLinesOf(d) : []), [d])
  if (!d) return null
  const pending = d.status !== "confirmed"
  const state = receiptState(d, now)
  const noPo = isNoPo(d)
  const number = d.docNumber ? displayReceiptNumber(d.docNumber, locale) : `DEL-${d.id.slice(0, 8).toUpperCase()}`
  const when = d.confirmedAt || d.deliveryDate || null
  const placeId = d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId
  const place = warehouseName(placeId) || null
  const project = projectName(d.projectId || po?.projectId) || null
  const kind = placeKind(d, po)
  const by = recordedBy(d, kind)
  const receiverName = (d.receivedByName || "").split(" — ")[0] || "—"
  const priced = new Map(po ? po.lines.map((l) => [l.id, l]) : [])
  const seesPrices = actor.seesPrices
  const lineValues = seesPrices && po != null && po.lines.every((l) => l.unitPrice != null)
  const acceptedValue = lineValues ? round2(lines.reduce((s, l) => s + (l.accepted ?? acceptedOf(l)) * Number(priced.get(l.poLineId)?.unitPrice || 0), 0)) : null
  const rejects = lines.filter((l) => Number(l.rejected) > 0)
  const held = lines.filter((l) => Number(l.held) > 0)
  const shorts = lines.map((l) => ({ l, short: shortVsNotice(l) })).filter((x) => x.short > 0)
  const attachments = (d.attachmentUrls || []) as string[]
  const checks = (d.checklist || []) as ReceiptCheck[]
  const canAct = actor.isOwner || actor.canReceive
  const canPrepare = actor.isOwner || actor.canPrepare
  const canDecide = actor.isOwner || actor.canPrepare || actor.canApprove
  const rateable = Boolean(po) && canPrepare && canRate(po as PurchaseOrder, deliveries)
  const opts = { copy: tShared as unknown as Translator, locale: locale as "ar" | "en", orgName }

  const dateText = (iso: string | null | undefined) => {
    if (!iso) return "—"
    const dt = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
    if (Number.isNaN(dt.getTime())) return iso
    return dt.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { year: "numeric", month: "short", day: "numeric", ...(iso.length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}) })
  }
  const moduleName = t(`module.${by}`)

  const run = async (fn: () => Promise<unknown>, success: string): Promise<boolean> => {
    if (!firestore) return false
    try {
      await fn()
      toast({ title: tOrders(success as "toast.rated") })
      return true
    } catch (err) {
      if (err instanceof ProcWriteError) toast({ title: tp(`err_${err.code}` as "err_wrong_state"), variant: "destructive" })
      else {
        console.error(err)
        toast({ title: tOrders("toast.failed"), variant: "destructive" })
      }
      return false
    }
  }

  const print = () => {
    const ok = printGoodsReceipt({
      delivery: d,
      po,
      company,
      placeName: place,
      projectName: project,
      displayNumber: number,
      displayPoNumber: po ? displayPoNumber(po.docNumber, locale) : d.poNumber ? displayPoNumber(d.poNumber, locale) : null,
      withPrices: actor.seesPrices,
      locale,
      t: (k, p) => tPrint(k as "title", p),
      tp: (k, p) => tp(k as "doc.GR", p),
      now,
    })
    if (!ok) toast({ title: t("drawer.popupBlocked"), variant: "destructive" })
  }

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="space-y-2">
      <h3 className="text-[11px] font-bold text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
  const Stat = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
    <div className="min-w-0 rounded-lg border bg-muted/20 p-2.5">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <div className="truncate text-sm font-semibold" dir="auto">{value || "—"}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground" dir="auto">{sub}</div>}
    </div>
  )
  const Callout = ({ tone, children }: { tone: "red" | "blue" | "amber"; children: React.ReactNode }) => {
    const Icon = tone === "blue" ? Info : AlertTriangle
    return (
      <div className={cn("flex gap-2 rounded-md border p-3 text-xs leading-relaxed", tone === "red" && "border-destructive/30 bg-destructive/5 text-destructive", tone === "blue" && "border-cta/30 bg-cta/5 text-foreground", tone === "amber" && "border-amber-200 bg-amber-50 text-amber-900")}>
        <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">{children}</div>
      </div>
    )
  }

  const log = receiptLog(d, po)
  const LogSection = () =>
    log.length ? (
      <Section title={t("rlog.title")}>
        <ul className="space-y-1.5 text-xs">
          {log.map((e, i) => (
            <li key={`${e.action}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b pb-1.5 last:border-0">
              <span dir="auto">
                {t(`rlog.${e.action}`, { ...e.params, number: e.params.number ? (e.action === "recorded" ? displayReceiptNumber(String(e.params.number), locale) : displayPoNumber(String(e.params.number), locale)) : "" })}
                {e.by && <span className="text-muted-foreground"> — {e.by}</span>}
              </span>
              <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>{dateText(e.at)}</span>
            </li>
          ))}
        </ul>
      </Section>
    ) : null

  // ------------------------------------------------------------------
  // A receipt with no order
  // ------------------------------------------------------------------
  if (noPo && !pending) {
    const items = d.items || []
    const invoice = seesPrices ? noPoInvoiceValue(d) : null
    const expensed = d.regularisation === "expense"
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent side={isRtl ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-2xl" dir={isRtl ? "rtl" : "ltr"}>
          <SheetHeader className="text-start">
            <SheetTitle className="flex items-center gap-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
                <FileText size={18} aria-hidden="true" />
              </span>
              <span>{t("drawer.title", { number })}</span>
            </SheetTitle>
            <SheetDescription asChild>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {expensed ? <Badge variant="outline" className="text-[11px]">{t("log.expense")}</Badge> : <ReceiptStatePill state={state} />}
                <RecordedByPill by={by} manual />
                <span className="text-muted-foreground" suppressHydrationWarning>{dateText(when)}</span>
              </div>
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-5">
            <Callout tone={expensed ? "blue" : "red"}>{expensed ? t("drawer.expenseCallout") : t("drawer.noPoCallout")}</Callout>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={print} className="gap-1.5">
                <Printer size={15} aria-hidden="true" />
                {t("drawer.print")}
              </Button>
              {!expensed && canPrepare && onRegularise && (
                <Button onClick={() => onRegularise(d)} className="gap-1.5">
                  {t("drawer.regulariseOrExpense")}
                </Button>
              )}
            </div>
            <Section title={t("regularise.lines")}>
              <div className="divide-y rounded-lg border text-xs">
                {items.length ? (
                  items.map((it, i) => (
                    <div key={`${it.name}-${i}`} className="flex items-start justify-between gap-3 p-2.5">
                      <div className="min-w-0">
                        <p className="font-semibold" dir="auto">{it.name}</p>
                        {seesPrices && it.unitPrice != null && <p className="text-[11px] text-muted-foreground">{t("drawer.unitPrice", { price: withSarSign(fmt(it.unitPrice), locale) })}</p>}
                      </div>
                      <p className="shrink-0">
                        <b className="tabular-nums">{fmt(Number(it.quantity) || 0)}</b> <span dir="auto">{it.unitOfMeasure || it.unit || ""}</span>
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="p-2.5 text-muted-foreground">{t("drawer.noLines")}</p>
                )}
                {invoice != null && (
                  <div className="flex items-center justify-between gap-3 p-2.5">
                    <span>{t("drawer.invoiceAsTyped")}</span>
                    <b className="tabular-nums">{withSarSign(fmt(invoice), locale)}</b>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 p-2.5">
                  <span>{t("drawer.supplierAsWritten")}</span>
                  <span className="font-semibold" dir="auto">{d.supplierName || "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-3 p-2.5">
                  <span>{t("drawer.place")}</span>
                  <span dir="auto">{[place || t("manual.placeNone"), project].filter(Boolean).join(" · ")}</span>
                </div>
                <div className="flex items-start justify-between gap-3 p-2.5">
                  <span>{t("drawer.receiver")}</span>
                  <span className="text-end">
                    <b dir="auto">{d.receivedByName || "—"}</b>
                    <br />
                    <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>{t("drawer.recordedIn", { module: moduleName, date: dateText(when) })}</span>
                  </span>
                </div>
                {(d.receiptNote || d.notes) && <p className="p-2.5 text-muted-foreground" dir="auto">{d.receiptNote || d.notes}</p>}
              </div>
            </Section>
            <AttachmentsList urls={attachments} label={(n) => tc("goods_received_document_label", { num: n })} empty={t("drawer.noAttachments")} />
            <LogSection />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  const trail = po && !pending ? receiptTrail(d, po) : []
  const trailText = (key: string, variant: string, params: Record<string, string | number>): string => {
    switch (key) {
      case "requested":
        return t.has(`trail.requested_${variant}`) ? t(`trail.requested_${variant}` as "trail.requested_direct") : t("trail.requested_linked")
      case "purchased":
        return [po ? displayPoNumber(po.docNumber, locale) : "", String(params.supplier || ""), String(params.rfq || "")].filter(Boolean).join(" · ")
      case "notified":
        return variant === "none" ? t("trail.notified_none") : [t("trail.notified_for", { day: dateText(String(params.day || "")) }), params.note ? `${t("incoming.note")} ${params.note}` : "", String(params.driver || "")].filter(Boolean).join(" · ")
      case "forwarded":
        return variant === "link" ? t("trail.forwarded_link", params) : variant === "member" ? t("trail.forwarded_member", params) : variant === "unannounced" ? t("trail.forwarded_unannounced") : t("trail.forwarded_direct")
      case "received":
        return [place || project || "—", receiverName, number, variant === "link" ? t("trail.received_link") : ""].filter(Boolean).join(" · ")
      case "went":
        return [place ? t("drawer.wentToWarehouse", { name: place }) : project ? t("drawer.wentToProject", { name: project }) : t("drawer.wentNowhere"), variant === "held" ? t("drawer.heldIsolated") : ""].filter(Boolean).join(" · ")
      default:
        return variant === "closed" ? t("trail.finance_closed") : acceptedValue != null ? t("drawer.financeCeiling", { amount: withSarSign(fmt(acceptedValue), locale) }) : t("trail.finance_match")
    }
  }

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side={isRtl ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-2xl" dir={isRtl ? "rtl" : "ltr"}>
        <SheetHeader className="text-start">
          <SheetTitle className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
              <ClipboardCheck size={18} aria-hidden="true" />
            </span>
            <span>{pending ? t("drawer.noticeTitle") : t("drawer.title", { number })}</span>
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <ReceiptStatePill state={state} />
              {!pending && <RecordedByPill by={by} manual={d.source === "manual"} />}
              {d.noNotice && <Badge variant="outline" className="text-[11px] text-amber-800">{t("drawer.noNotice")}</Badge>}
              {d.selfReceived && <Badge variant="outline" className="text-[11px] text-destructive">{tp("exception.self_received")}</Badge>}
              <span className="text-muted-foreground" suppressHydrationWarning>{dateText(isoOf(when))}</span>
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {pending && canAct && onReceive && (
              <Button onClick={() => onReceive(d)} className="gap-1.5">
                <ClipboardCheck size={15} aria-hidden="true" />
                {t("drawer.record")}
              </Button>
            )}
            {!pending && (
              <Button variant="outline" onClick={print} className="gap-1.5">
                <Printer size={15} aria-hidden="true" />
                {t("drawer.print")}
              </Button>
            )}
            {(po || d.poId) && (
              <Button asChild variant="outline" className="gap-1.5">
                <Link href={procLinks.order(po?.id || (d.poId as string))}>
                  <ExternalLink size={15} aria-hidden="true" />
                  {t("drawer.openOrder")}
                </Link>
              </Button>
            )}
            {rateable && (
              <Button onClick={() => setRateOpen(true)} className="gap-1.5">
                <Star size={15} aria-hidden="true" />
                {t("drawer.rate")}
              </Button>
            )}
          </div>

          {/* Stats — each with its link and the line under it */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat
              label={t("drawer.supplier")}
              value={
                po && !po.isGuestSupplier ? (
                  <Link href={`/contractor/suppliers?supplier=${po.supplierOrgId}`} className="text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {po.supplierName}
                  </Link>
                ) : (
                  po?.supplierName || d.supplierName
                )
              }
            />
            <Stat
              label={tp("doc.PO")}
              value={
                po ? (
                  <Link href={procLinks.order(po.id)} className="text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {displayPoNumber(po.docNumber, locale)}
                  </Link>
                ) : d.poNumber ? (
                  displayPoNumber(d.poNumber, locale)
                ) : (
                  t("drawer.noPo")
                )
              }
              sub={
                po?.rfqId ? (
                  <Link href={RFQ_HREF(po.rfqId)} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {po.rfqTitle}
                  </Link>
                ) : (
                  po?.rfqTitle || d.rfqTitle || undefined
                )
              }
            />
            <Stat
              label={t("drawer.notice")}
              value={d.noNotice || d.source === "manual" ? <span dir="ltr">{d.paperNoteNumber || t("drawer.noNotice")}</span> : t("drawer.platformNotice")}
              sub={d.noNotice ? <span className="text-amber-700">{t("drawer.noPriorNotice")}</span> : d.paperNoteNumber ? <>{t("drawer.paperNoteSub")} <span dir="ltr">{d.paperNoteNumber}</span></> : undefined}
            />
            <Stat label={pending ? t("drawer.expected") : t("drawer.arrived")} value={dateText(isoOf(when))} sub={!pending && !d.noNotice && d.deliveryDate ? t("drawer.noticedFor", { date: dateText(d.deliveryDate.slice(0, 10)) }) : pending && d.deliveryWindow ? tp(`deliveryWindow.${d.deliveryWindow}` as "deliveryWindow.morning") : undefined} />
            <Stat label={t("drawer.place")} value={place || (project ? t("drawer.projectCustody") : pending ? "—" : t("drawer.generalStock"))} sub={kind ? `${t(`dest.${kind}`)}${project ? ` · ${project}` : ""}` : project || undefined} />
            <Stat label={t("drawer.receiver")} value={pending ? d.forwardedTo?.name || "—" : receiverName} sub={pending ? undefined : moduleName} />
          </div>

          {pending && d.forwardedTo?.note && (
            <Callout tone="blue">
              <b>{t("forward.noteLabel")}:</b> <span dir="auto">{d.forwardedTo.note}</span>
            </Callout>
          )}

          {/* Lines */}
          <Section title={pending ? t("drawer.noticeLines") : t("drawer.linesTitle")}>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("drawer.noLines")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-2 text-start font-semibold">{t("drawer.colLine")}</th>
                      <th className="px-2 py-2 text-end font-semibold">{t("drawer.colNotice")}</th>
                      {!pending && (
                        <>
                          <th className="px-2 py-2 text-end font-semibold">{t("drawer.colCounted")}</th>
                          <th className="px-2 py-2 text-end font-semibold">{t("drawer.colAccepted")}</th>
                          {po && <th className="px-2 py-2 text-end font-semibold">{t("drawer.colOpenNow")}</th>}
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const pl = priced.get(l.poLineId)
                      const short = shortVsNotice(l)
                      const counted = Number(l.counted) || 0
                      const over = Number(l.noticeQuantity) > 0 && l.counted != null ? Math.max(0, round2(counted - Number(l.noticeQuantity))) : 0
                      const acc = l.accepted ?? acceptedOf(l)
                      return (
                        <tr key={l.poLineId} className="border-t align-top">
                          <td className="px-2 py-2">
                            <p className="font-semibold" dir="auto">{l.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {l.unit}
                              {pl && <> · {t("drawer.onOrder", { qty: fmt(pl.quantity - pl.cancelled) })}</>}
                              {pl && !pending && <> · {t("drawer.acceptedBefore", { qty: fmt(acceptedBefore(d, deliveries, l.poLineId)) })}</>}
                            </p>
                          </td>
                          <td className="px-2 py-2 text-end tabular-nums">{Number(l.noticeQuantity) > 0 ? fmt(l.noticeQuantity) : <span className="text-muted-foreground">{t("drawer.noNoticeShort")}</span>}</td>
                          {!pending && (
                            <>
                              <td className="px-2 py-2 text-end tabular-nums">
                                {fmt(counted)}
                                {short > 0 && <p className="text-[11px] text-amber-700">{t("drawer.short", { qty: fmt(short) })}</p>}
                                {over > 0 && <p className="text-[11px] text-amber-700">{t("drawer.over", { qty: fmt(over) })}</p>}
                              </td>
                              <td className="px-2 py-2 text-end tabular-nums">
                                <span className="font-bold text-success">{fmt(acc)}</span>
                                {Number(l.rejected) > 0 && <p className="text-[11px] text-destructive">{t("drawer.rejected", { qty: fmt(l.rejected) })}{l.rejectReason ? ` — ${tp(`rejectReason.${l.rejectReason}`)}` : ""}</p>}
                                {Number(l.held) > 0 && <p className="text-[11px] text-module">{t("drawer.held", { qty: fmt(l.held) })}{l.holdReason ? ` — ${tp(`holdReason.${l.holdReason}`)}` : ""}</p>}
                              </td>
                              {po && <td className="px-2 py-2 text-end tabular-nums">{pl ? `${fmt(lineToArrive(pl))} ${pl.unit}` : "—"}</td>}
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!pending && lines.length > 0 && <p className="text-[11px] leading-relaxed text-muted-foreground">{t("drawer.footnote")}</p>}
            {acceptedValue != null && !pending && (
              <p className="text-xs">
                {t("drawer.acceptedValue")} <b className="tabular-nums">{withSarSign(fmt(acceptedValue), locale)}</b> <span className="text-muted-foreground">{t("drawer.exVat")}</span>
              </p>
            )}
          </Section>

          {/* What follows */}
          {!pending && (rejects.length > 0 || held.length > 0 || shorts.length > 0) && (
            <Section title={t("drawer.followsTitle")}>
              <div className="space-y-2">
                {rejects.map((l) => {
                  const pl = priced.get(l.poLineId)
                  const decided = pl?.rejectDecision
                  const reason = l.rejectReason ? tp(`rejectReason.${l.rejectReason}`) : ""
                  const terms = pl ? rejectTermsOf(pl) : { replaceBy: null, discountPrice: null }
                  const decidedText =
                    decided === "replace"
                      ? terms.replaceBy
                        ? t("drawer.decidedReplaceBy", { date: dateText(terms.replaceBy) })
                        : t("drawer.decidedReplace")
                      : decided === "discount"
                        ? seesPrices && terms.discountPrice != null
                          ? t("drawer.decidedDiscountAt", { price: withSarSign(fmt(terms.discountPrice), locale) })
                          : t("drawer.decidedDiscount")
                        : t("drawer.decidedReduce")
                  return (
                    <div key={`r-${l.poLineId}`} className={cn("rounded-md border p-2.5 text-xs", decided ? "border-cta/30 bg-cta/5" : "border-destructive/30 bg-destructive/5")}>
                      <p className={decided ? "" : "text-destructive"}>
                        {decided ? t("drawer.rejectDecidedTerms", { qty: fmt(l.rejected), unit: l.unit, reason, decision: decidedText }) : t("drawer.rejectPending", { qty: fmt(l.rejected), unit: l.unit, line: l.name, reason })}
                      </p>
                      {!decided && pl && po?.status === "accepted" && canDecide && (
                        <Button size="sm" className="mt-2 h-8 text-xs" onClick={() => setRejectLine(pl)}>
                          {t("drawer.decideWithSupplier")}
                        </Button>
                      )}
                    </div>
                  )
                })}
                {held.map((l) => (
                  <div key={`h-${l.poLineId}`} className="rounded-md border border-module/30 bg-module/5 p-2.5 text-xs">
                    <p>{t("drawer.heldFollowsIn", { qty: fmt(l.held), unit: l.unit, line: l.name, reason: l.holdReason ? tp(`holdReason.${l.holdReason}`) : "", module: moduleName })}</p>
                    <Badge variant="outline" className="mt-1.5 text-[10px]">{t("drawer.waitingOn", { module: t(`module.${kind === "prj" ? "projects" : "inventory"}`) })}</Badge>
                  </div>
                ))}
                {shorts.map(({ l, short }) => (
                  <div key={`s-${l.poLineId}`} className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                    {t("drawer.shortFollows", { counted: fmt(Number(l.counted) || 0), notice: fmt(l.noticeQuantity), short: fmt(short), unit: l.unit, line: l.name })}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Attachments & checklist */}
          <Section title={t("drawer.attachmentsTitle")}>
            {!pending && (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {RECEIPT_CHECKS.map((c) => (
                  <p key={c} className={cn("flex items-center gap-2 text-xs", checks.includes(c) ? "text-success" : "text-muted-foreground")}>
                    <span className="min-w-4 text-center font-bold">{checks.includes(c) ? `✓${c === "photos" && attachments.length ? ` ${attachments.length}` : ""}` : "—"}</span>
                    {tp(`checklist.${c}`)}
                  </p>
                ))}
              </div>
            )}
            <AttachmentsList urls={attachments} label={(n) => tc("goods_received_document_label", { num: n })} empty={t("drawer.noAttachments")} />
            {(d.deliveryPersonName || d.vehiclePlate || d.paperNoteNumber) && (
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <Truck size={12} aria-hidden="true" />
                <span dir="auto">{d.deliveryPersonName || t("drawer.driverUnknown")}</span>
                {d.vehiclePlate && <bdi>· {d.vehiclePlate}</bdi>}
                {d.paperNoteNumber && (
                  <span>
                    · {t("drawer.paperNote")} <span dir="ltr">{d.paperNoteNumber}</span>
                  </span>
                )}
              </p>
            )}
            {(d.receiptNote || d.notes) && <p className="rounded-md bg-muted/40 p-2 text-xs" dir="auto">{d.receiptNote || d.notes}</p>}
            {!pending && <p className="text-[11px] leading-relaxed text-muted-foreground">{t("drawer.retention")}</p>}
          </Section>

          {/* Where it went — the material trail */}
          {trail.length > 0 && (
            <Section title={t("drawer.whereTitle")}>
              <ol className="space-y-2">
                {trail.map((s) => {
                  const Icon = TRAIL_ICON[s.state]
                  return (
                    <li key={s.key} className="flex gap-2.5 text-xs">
                      <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", TRAIL_TONE[s.state])}>
                        <Icon size={13} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <b className="block">{t(`trail.${s.key}`)}</b>
                        <span className="text-muted-foreground" dir="auto" suppressHydrationWarning>
                          {s.at ? `${dateText(s.at)} · ` : ""}
                          {trailText(s.key, s.variant, s.params)}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ol>
            </Section>
          )}

          {!pending && d.selfReceived && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t("drawer.selfCallout")}</span>
            </div>
          )}
          {!pending && <Callout tone="blue">{d.selfReceived ? t("drawer.closingSelf", { name: receiverName, module: moduleName }) : t("drawer.closingBy", { name: receiverName, module: moduleName })}</Callout>}
          <LogSection />
        </div>

        {po && (
          <>
            <RejectDecisionDialog
              open={Boolean(rejectLine)}
              onOpenChange={(o) => !o && setRejectLine(null)}
              line={rejectLine}
              now={now}
              onSubmit={(v: { decision: RejectDecision; note: string | null; replaceBy: string | null; discountPrice: number | null }) =>
                rejectLine && firestore
                  ? run(() => decideReject(firestore, actor, po.id, { lineId: rejectLine.id, decision: v.decision, note: v.note, replaceBy: v.replaceBy, discountPrice: v.discountPrice }, opts), "toast.reject_decided")
                  : Promise.resolve(false)
              }
            />
            <PoRateDialog
              open={rateOpen}
              onOpenChange={setRateOpen}
              po={po}
              receipts={deliveries}
              onSubmit={(input: RatingInput) => (firestore ? run(() => ratePurchaseOrder(firestore, actor, po.id, { ...input, receipts: deliveries }, opts), "toast.rated") : Promise.resolve(false))}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function AttachmentsList({ urls, label, empty }: { urls: string[]; label: (n: number) => string; empty: string }) {
  if (!urls.length) return <p className="text-xs text-muted-foreground">{empty}</p>
  return (
    <div className="flex flex-wrap items-center gap-2">
      {urls.map((url, i) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-primary/5 px-2 py-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <FileText size={11} aria-hidden="true" />
          {label(i + 1)}
          <ExternalLink size={10} aria-hidden="true" />
        </a>
      ))}
    </div>
  )
}
