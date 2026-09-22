"use client"

// The receipt drawer (PRD 3.0 §7.3 `dGrn`): read-only by design — the gate
// recorded it, Procurement reads it and acts only on its consequences. Line by
// line (notice · counted · rejected + reason · held + reason · accepted · open
// now), "what follows" (rejects → Procurement decides on the order; held →
// awaiting release; short vs notice → nothing to decide), attachments & the
// checklist, where it went, driver/vehicle/paper note, the trail (received
// by/at, self-received, no notice), Print. A pending notice opens the same
// drawer with the notice's facts and the "Record the receipt" door; a receipt
// with no order offers "Regularise" and "Booked as cash expense".

import { useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, ClipboardCheck, ExternalLink, FileText, Loader2, MapPin, PackageCheck, Paperclip, Printer, ShieldAlert, Truck, Upload, User } from "lucide-react"
import { arrayUnion, doc, updateDoc } from "firebase/firestore"
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage"
import { useFirestore, useStorage } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Link } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { withSarSign } from "@/lib/riyal"
import { displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { RECEIPT_CHECKS, acceptedOf, lineToArrive, round2 } from "@/lib/procurement/po"
import { procLinks } from "@/lib/procurement/events"
import { receiptState, shortVsNotice, type ReceiptState } from "@/lib/procurement/receipts"
import { isNoPo, receiptLinesOf, type DeskDelivery } from "@/lib/procurement/receipt-desk"
import { printGoodsReceipt, type ReceiptPrintCompany } from "@/lib/procurement/receipt-print"
import type { ProcActor, PurchaseOrder, ReceiptCheck } from "@/lib/procurement/types"

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

const fmt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n))

export interface ReceiptDrawerProps {
  delivery: DeskDelivery | null
  po: PurchaseOrder | null
  onOpenChange: (open: boolean) => void
  actor: ProcActor
  company: ReceiptPrintCompany
  warehouseName: (id: string | null | undefined) => string | null
  projectName: (id: string | null | undefined) => string | null
  now: Date
  onReceive?: (d: DeskDelivery) => void
  onRegularise?: (d: DeskDelivery) => void
  onMarkExpense?: (d: DeskDelivery) => void
}

export function ReceiptDrawer(props: ReceiptDrawerProps) {
  const { delivery: d, po, onOpenChange, actor, company, warehouseName, projectName, now, onReceive, onRegularise, onMarkExpense } = props
  const t = useTranslations("Portal.ProcReceipts")
  const tp = useTranslations("Portal.Procurement")
  const tPrint = useTranslations("Portal.ProcReceipts.print")
  const tc = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const lines = useMemo(() => (d ? receiptLinesOf(d) : []), [d])
  if (!d) return null
  const pending = d.status !== "confirmed"
  const state = receiptState(d, now)
  const noPo = isNoPo(d)
  const number = d.docNumber ? displayReceiptNumber(d.docNumber, locale) : `DEL-${d.id.slice(0, 8).toUpperCase()}`
  const when = d.confirmedAt || d.deliveryDate || null
  const place = warehouseName(d.landedWarehouseId || (d as { warehouseId?: string | null }).warehouseId) || null
  const project = projectName(d.projectId || po?.projectId) || null
  const priced = new Map(po ? po.lines.map((l) => [l.id, l]) : [])
  const seesPrices = actor.seesPrices && po != null && po.lines.every((l) => l.unitPrice != null)
  const acceptedValue = seesPrices ? round2(lines.reduce((s, l) => s + (l.accepted ?? acceptedOf(l)) * Number(priced.get(l.poLineId)?.unitPrice || 0), 0)) : null
  const rejects = lines.filter((l) => Number(l.rejected) > 0)
  const held = lines.filter((l) => Number(l.held) > 0)
  const shorts = lines.map((l) => ({ l, short: shortVsNotice(l) })).filter((x) => x.short > 0)
  const attachments = ((d as { attachmentUrls?: string[] }).attachmentUrls || []) as string[]
  const checks = (d.checklist || []) as ReceiptCheck[]
  const canAct = actor.isOwner || actor.canReceive
  const canRegularise = actor.isOwner || actor.canPrepare

  const dateText = (iso: string | null | undefined) => {
    if (!iso) return "—"
    const dt = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
    if (Number.isNaN(dt.getTime())) return iso
    return dt.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { year: "numeric", month: "short", day: "numeric", ...(iso.length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}) })
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

  const upload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]
    if (!file || !firestore || !storage) return
    setUploading(true)
    try {
      const r = storageRef(storage, `deliveries/${d.id}/attachments/${Date.now()}_${file.name}`)
      await uploadBytes(r, file)
      const url = await getDownloadURL(r)
      await updateDoc(doc(firestore, "deliveries", d.id), { attachmentUrls: arrayUnion(url) })
      toast({ title: tc("goods_attachment_uploaded") })
    } catch (err) {
      console.error(err)
      toast({ title: tc("goods_upload_error"), variant: "destructive" })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
  const Stat = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
    <div className="rounded-lg border bg-muted/20 p-2.5">
      <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold" dir="auto">{value || "—"}</p>
      {sub && <p className="text-[11px] text-muted-foreground" dir="auto">{sub}</p>}
    </div>
  )

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side={isRtl ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-2xl" dir={isRtl ? "rtl" : "ltr"}>
        <SheetHeader className="text-start">
          <SheetTitle className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
              <PackageCheck size={18} aria-hidden="true" />
            </span>
            <span>{pending ? t("drawer.noticeTitle") : t("drawer.title", { number })}</span>
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <ReceiptStatePill state={state} />
              {d.source === "manual" && <Badge variant="outline" className="text-[11px]">{t("drawer.recordedManually")}</Badge>}
              {d.noNotice && <Badge variant="outline" className="text-[11px] text-amber-800">{t("drawer.noNotice")}</Badge>}
              {d.selfReceived && <Badge variant="outline" className="text-[11px] text-destructive">{tp("exception.self_received")}</Badge>}
              <span className="text-muted-foreground" suppressHydrationWarning>{dateText(when)}</span>
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
            {noPo && !d.regularisation && canRegularise && onRegularise && (
              <Button onClick={() => onRegularise(d)} className="gap-1.5">
                {t("drawer.regularise")}
              </Button>
            )}
            {noPo && !d.regularisation && canAct && onMarkExpense && (
              <Button variant="outline" onClick={() => onMarkExpense(d)}>
                {t("drawer.markExpense")}
              </Button>
            )}
          </div>

          {/* Callouts */}
          {noPo && (
            <p className={cn("rounded-md border p-3 text-xs leading-relaxed", d.regularisation === "expense" ? "border-border bg-muted/40 text-muted-foreground" : "border-destructive/30 bg-destructive/5 text-destructive")}>
              {d.regularisation === "expense" ? t("drawer.expenseCallout") : t("drawer.noPoCallout")}
            </p>
          )}
          {d.selfReceived && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t("drawer.selfCallout")}</span>
            </p>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label={t("drawer.supplier")} value={po?.supplierName || d.supplierName} sub={noPo ? t("drawer.asWritten") : undefined} />
            <Stat label={tp("doc.PO")} value={po ? displayPoNumber(po.docNumber, locale) : d.poNumber ? displayPoNumber(d.poNumber, locale) : t("drawer.noPo")} sub={po?.rfqTitle || d.rfqTitle || undefined} />
            <Stat label={t("drawer.notice")} value={d.noNotice ? t("drawer.noNotice") : d.paperNoteNumber ? <span dir="ltr">{d.paperNoteNumber}</span> : d.source === "manual" ? t("drawer.noNotice") : t("drawer.platformNotice")} sub={d.deliveryDate ? t("drawer.noticedFor", { date: d.deliveryDate.slice(0, 10) }) : undefined} />
            <Stat label={pending ? t("drawer.expected") : t("drawer.arrived")} value={dateText(when)} />
            <Stat label={t("drawer.place")} value={place || (project ? t("drawer.projectCustody") : pending ? "—" : t("drawer.generalStock"))} sub={project || undefined} />
            <Stat label={t("drawer.receiver")} value={d.receivedByName || (pending ? "—" : "—")} sub={d.source === "manual" ? t("drawer.recordedManually") : undefined} />
          </div>

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
                      const acc = l.accepted ?? acceptedOf(l)
                      return (
                        <tr key={l.poLineId} className="border-t align-top">
                          <td className="px-2 py-2">
                            <p className="font-semibold" dir="auto">{l.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {l.unit}
                              {pl && <> · {t("drawer.onOrder", { qty: fmt(pl.quantity - pl.cancelled) })}</>}
                            </p>
                          </td>
                          <td className="px-2 py-2 text-end tabular-nums">{Number(l.noticeQuantity) > 0 ? fmt(l.noticeQuantity) : <span className="text-muted-foreground">{t("drawer.noNoticeShort")}</span>}</td>
                          {!pending && (
                            <>
                              <td className="px-2 py-2 text-end tabular-nums">
                                {fmt(counted)}
                                {short > 0 && <p className="text-[11px] text-amber-700">{t("drawer.short", { qty: fmt(short) })}</p>}
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
                  return (
                    <div key={`r-${l.poLineId}`} className={cn("rounded-md border p-2.5 text-xs", decided ? "border-border bg-muted/30" : "border-destructive/30 bg-destructive/5")}>
                      <p className={decided ? "" : "text-destructive"}>
                        {decided
                          ? t("drawer.rejectDecided", { qty: fmt(l.rejected), unit: l.unit, line: l.name, decision: tp(`rejectDecision.${decided}`) })
                          : t("drawer.rejectPending", { qty: fmt(l.rejected), unit: l.unit, line: l.name, reason: l.rejectReason ? tp(`rejectReason.${l.rejectReason}`) : "" })}
                      </p>
                      {!decided && po && (actor.isOwner || actor.canPrepare || actor.canApprove) && (
                        <Button asChild size="sm" variant="outline" className="mt-2 h-8 text-xs">
                          <Link href={procLinks.order(po.id)}>{t("drawer.decideOnOrder")}</Link>
                        </Button>
                      )}
                    </div>
                  )
                })}
                {held.map((l) => (
                  <div key={`h-${l.poLineId}`} className="rounded-md border border-module/30 bg-module/5 p-2.5 text-xs">
                    <p>{t("drawer.heldFollows", { qty: fmt(l.held), unit: l.unit, line: l.name, reason: l.holdReason ? tp(`holdReason.${l.holdReason}`) : "" })}</p>
                    <Badge variant="outline" className="mt-1.5 text-[10px]">{t("drawer.awaitingRelease")}</Badge>
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
            {!pending && !noPo && (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {RECEIPT_CHECKS.map((c) => (
                  <p key={c} className={cn("flex items-center gap-2 text-xs", checks.includes(c) ? "text-success" : "text-muted-foreground")}>
                    <span className="w-4 text-center font-bold">{checks.includes(c) ? "✓" : "—"}</span>
                    {tp(`checklist.${c}`)}
                  </p>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {attachments.map((url, i) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-primary/5 px-2 py-1 text-xs font-medium text-primary hover:underline">
                  <FileText size={11} aria-hidden="true" />
                  {tc("goods_received_document_label", { num: i + 1 })}
                  <ExternalLink size={10} aria-hidden="true" />
                </a>
              ))}
              {attachments.length === 0 && <span className="text-xs text-muted-foreground">{t("drawer.noAttachments")}</span>}
              {canAct && !pending && (
                <>
                  <input ref={fileRef} type="file" className="hidden" onChange={upload} aria-hidden="true" />
                  <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading} className="h-7 gap-1.5 px-2 text-xs">
                    {uploading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Upload size={12} aria-hidden="true" />}
                    {uploading ? tc("goods_uploading") : tc("goods_upload_receipt")}
                  </Button>
                </>
              )}
            </div>
            {(d.deliveryPersonName || d.vehiclePlate || d.paperNoteNumber) && (
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <Truck size={12} aria-hidden="true" />
                <span dir="auto">{d.deliveryPersonName || t("drawer.driverUnknown")}</span>
                {d.vehiclePlate && <span dir="ltr">· {d.vehiclePlate}</span>}
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

          {/* Where it went */}
          {!pending && (
            <Section title={t("drawer.whereTitle")}>
              <div className="space-y-1.5 text-xs">
                <p className="flex items-center gap-2">
                  <MapPin size={12} className="text-module" aria-hidden="true" />
                  {place ? t("drawer.wentToWarehouse", { name: place }) : project ? t("drawer.wentToProject", { name: project }) : t("drawer.wentNowhere")}
                  {held.length > 0 && <span className="text-muted-foreground"> · {t("drawer.heldIsolated")}</span>}
                </p>
                <p className="flex items-center gap-2">
                  <User size={12} className="text-module" aria-hidden="true" />
                  {t("drawer.trail", { name: d.receivedByName || "—", date: dateText(when) })}
                  {d.selfReceived && <span className="text-destructive"> · {tp("exception.self_received")}</span>}
                </p>
                {d.noNotice && (
                  <p className="flex items-center gap-2 text-amber-800">
                    <AlertTriangle size={12} aria-hidden="true" />
                    {t("drawer.arrivedNoNotice")}
                  </p>
                )}
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Paperclip size={12} aria-hidden="true" />
                  {noPo ? t("drawer.financeHold") : acceptedValue != null ? t("drawer.financeCeiling", { amount: withSarSign(fmt(acceptedValue), locale) }) : t("drawer.financeCeilingUnknown")}
                </p>
              </div>
            </Section>
          )}

          {!pending && <p className="text-[11px] leading-relaxed text-muted-foreground">{t("drawer.closing")}</p>}
        </div>
      </SheetContent>
    </Sheet>
  )
}
