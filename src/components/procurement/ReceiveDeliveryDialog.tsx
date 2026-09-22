"use client"

// The receiver's screen (PRD 3.0 §5.2-5, §10.2): one hand, 375 px, at the
// gate. Header with the supplier, the order and the buyer who owns the
// purchase; one card per line with a BLIND count — the input starts empty and
// the supplier's figure appears only after the count is typed — then a
// collapsible reject (quantity, coded reason, note) and a hold for inspection
// (quantity, coded reason); accepted = counted − rejected − held, live; the
// over-receipt refusal sentence shown as it is typed and run again by the
// write. The checklist never blocks. A legacy notice with no lines falls back
// to the plain confirm: receiver name, optional signature.
//
// Three doors, one form: a supplier's notice (`delivery` + maybe `po`), an
// arrival with no notice against an order (`po` alone), and a legacy notice
// (`delivery` with neither order nor lines).

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, ChevronDown, Loader2, PackageCheck, ShieldAlert, Truck } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SignaturePad } from "@/components/SignaturePad"
import { cn } from "@/lib/utils"
import { displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { HOLD_REASON_CODES, RECEIPT_CHECKS, REJECT_REASON_CODES, lineToArrive, round2 } from "@/lib/procurement/po"
import { acceptedOf, overReceiptRefusal, varianceVsNotice } from "@/lib/procurement/receipts"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import { ReceiptValidationError, countedLines, createArrivalWithoutNotice, legacyLinesOf, linesForReceipt, recordReceipt, validateReceiptLines, type PurchaseSource, type RecordReceiptResult } from "@/lib/procurement/receipt-writes"
import type { DeliveryLine, HoldReasonCode, ProcActor, ProcurementPolicies, PurchaseOrder, ReceiptCheck, RejectReasonCode } from "@/lib/procurement/types"
import { ProcWriteError } from "@/lib/procurement/writes"

const lineSchema = z.object({
  poLineId: z.string(),
  counted: z.string(),
  rejected: z.string(),
  rejectReason: z.string(),
  rejectNote: z.string(),
  held: z.string(),
  holdReason: z.string(),
})

const schema = z.object({
  receiverName: z.string().trim().min(1),
  deliveryDate: z.string(),
  driverName: z.string(),
  vehiclePlate: z.string(),
  paperNoteNumber: z.string(),
  note: z.string(),
  landedWarehouseId: z.string(),
  checklist: z.array(z.string()),
  lines: z.array(lineSchema),
})
type FormValues = z.infer<typeof schema>

const toNum = (s: string): number | undefined => {
  const t = (s || "").trim()
  if (!t) return undefined
  const n = Number(t.replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)))
  return Number.isFinite(n) ? n : undefined
}

/** The form's rows as the domain reads them. */
export function formLinesToDomain(rows: FormValues["lines"], base: DeliveryLine[]): DeliveryLine[] {
  const byId = new Map(base.map((l) => [l.poLineId, l]))
  return rows.map((r) => {
    const b = byId.get(r.poLineId)
    return {
      poLineId: r.poLineId,
      name: b?.name || "",
      unit: b?.unit || "",
      noticeQuantity: b?.noticeQuantity || 0,
      counted: toNum(r.counted),
      rejected: toNum(r.rejected) || 0,
      rejectReason: (r.rejectReason || null) as RejectReasonCode | null,
      rejectNote: r.rejectNote || null,
      held: toNum(r.held) || 0,
      holdReason: (r.holdReason || null) as HoldReasonCode | null,
    }
  })
}

export interface ReceiveDeliveryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The pending notice; null for an arrival with no notice. */
  delivery: DeskDelivery | null
  po: PurchaseOrder | null
  policies: ProcurementPolicies
  actor: ProcActor
  orgId: string
  projectName?: string | null
  /** Σ postedNet of this order's earlier receipts. */
  alreadyPostedNet?: number
  /** A legacy notice's value (the offer's price ex-VAT). */
  legacyNet?: number | null
  purchaseSource?: PurchaseSource
  warehouses: Array<{ id: string; name: string }>
  /** Where the goods go by default (the project's warehouse, else central). */
  defaultWarehouseId?: string | null
  onDone: (result: RecordReceiptResult) => void
}

export function ReceiveDeliveryDialog(props: ReceiveDeliveryDialogProps) {
  const { open, onOpenChange, delivery, po, policies, actor, projectName, alreadyPostedNet = 0, legacyNet, purchaseSource, warehouses, defaultWarehouseId, onDone } = props
  const t = useTranslations("Portal.ProcReceipts")
  const tp = useTranslations("Portal.Procurement")
  const tc = useTranslations("Portal.Contractor")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const [openReject, setOpenReject] = useState<Record<string, boolean>>({})
  const [openHold, setOpenHold] = useState<Record<string, boolean>>({})

  const legacy = Boolean(delivery) && !po && !(delivery?.lines && delivery.lines.length)
  const noNotice = !delivery && Boolean(po)
  const base = useMemo<DeliveryLine[]>(() => {
    if (noNotice && po) return po.lines.filter((l) => lineToArrive(l) > 0).map((l) => ({ poLineId: l.id, name: l.name, unit: l.unit, noticeQuantity: 0 }))
    if (delivery) return legacy ? legacyLinesOf(delivery) : linesForReceipt(delivery, po)
    return []
  }, [delivery, po, legacy, noNotice])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      receiverName: actor.name,
      deliveryDate: new Date().toISOString().slice(0, 10),
      driverName: delivery?.deliveryPersonName || "",
      vehiclePlate: delivery?.vehiclePlate || "",
      paperNoteNumber: delivery?.paperNoteNumber || "",
      note: "",
      landedWarehouseId: defaultWarehouseId || "",
      checklist: [],
      lines: base.map((l) => ({ poLineId: l.poLineId, counted: "", rejected: "", rejectReason: "", rejectNote: "", held: "", holdReason: "" })),
    },
  })
  const { register, watch, setValue, reset, handleSubmit } = form

  useEffect(() => {
    if (!open) return
    // A receiver who signed on the forwarded link (22 Sep review) has already
    // counted: their count, rejects, note and signature open here, for
    // Procurement to review and book. Every field stays editable.
    const report = delivery?.receiverReport || null
    const signed = new Map((report?.lines || []).map((l) => [l.poLineId, l]))
    reset({
      receiverName: report?.receiverName || actor.name,
      deliveryDate: new Date().toISOString().slice(0, 10),
      driverName: delivery?.deliveryPersonName || "",
      vehiclePlate: delivery?.vehiclePlate || "",
      paperNoteNumber: delivery?.paperNoteNumber || "",
      note: report?.note || "",
      landedWarehouseId: defaultWarehouseId || "",
      checklist: [],
      lines: base.map((l) => {
        const s = signed.get(l.poLineId)
        return {
          poLineId: l.poLineId,
          counted: s ? String(s.counted) : "",
          rejected: s && s.rejected > 0 ? String(s.rejected) : "",
          rejectReason: s?.rejectReason || "",
          rejectNote: s?.note || "",
          held: "",
          holdReason: "",
        }
      }),
    })
    setSignature(report?.signatureData || null)
    setOpenReject(Object.fromEntries((report?.lines || []).filter((l) => l.rejected > 0).map((l) => [l.poLineId, true])))
    setOpenHold({})
  }, [open, base, actor.name, delivery, defaultWarehouseId, reset])

  const rows = watch("lines")
  const checklist = watch("checklist")
  const domainLines = useMemo(() => formLinesToDomain(rows || [], base), [rows, base])
  const errors = useMemo(() => (legacy ? [] : validateReceiptLines(po, domainLines, policies)), [legacy, po, domainLines, policies])
  const errorsByLine = useMemo(() => {
    const m = new Map<string, typeof errors>()
    for (const e of errors) {
      if (!e.poLineId) continue
      m.set(e.poLineId, [...(m.get(e.poLineId) || []), e])
    }
    return m
  }, [errors])
  const formErrors = errors.filter((e) => !e.poLineId)
  const totalAccepted = round2(countedLines(domainLines).reduce((s, l) => s + acceptedOf(l), 0))

  const toggleCheck = (c: ReceiptCheck, on: boolean) => {
    const cur = new Set(checklist || [])
    if (on) cur.add(c)
    else cur.delete(c)
    setValue("checklist", Array.from(cur))
  }

  const errorText = (code: string, params: Record<string, string | number>) => tp(`receiptError.${code}`, params)

  const submit = handleSubmit(async (values) => {
    if (!firestore) return
    setSaving(true)
    try {
      const common = {
        receiverName: values.receiverName,
        checklist: values.checklist as ReceiptCheck[],
        signatureData: signature,
        vehiclePlate: values.vehiclePlate,
        paperNoteNumber: values.paperNoteNumber,
        note: values.note,
        landedWarehouseId: values.landedWarehouseId || null,
        policies,
        purchaseSource,
        alreadyPostedNet,
        projectName,
      }
      const opts = { copy: tShared as unknown as import("@/lib/mfg-events").Translator, locale: locale as "ar" | "en", centralWarehouseCopy: { name: tc("wh_central_name"), location: tc("wh_central_location"), description: tc("wh_central_desc") } }
      let result: RecordReceiptResult
      if (noNotice && po) {
        result = await createArrivalWithoutNotice(firestore, actor, { ...common, po, lines: formLinesToDomain(values.lines, base), deliveryDate: values.deliveryDate, driverName: values.driverName }, opts)
      } else if (delivery) {
        result = await recordReceipt(firestore, actor, { ...common, delivery, po, lines: legacy ? legacyLinesOf(delivery) : formLinesToDomain(values.lines, base), legacyNet: legacyNet ?? null }, opts)
      } else {
        return
      }
      const src = purchaseSource ?? result.po?.purchaseSource
      const missing = [!result.stockLanded ? t("toast.noStock") : "", src?.kind === "mfg_purchase" && !result.mfgClosed ? t("toast.noMfg") : ""].filter(Boolean)
      toast({
        title: t("toast.recorded", { number: displayReceiptNumber(result.docNumber, locale) }),
        description: missing.length ? missing.join(" · ") : t("toast.recordedDesc"),
        variant: missing.length ? "destructive" : undefined,
      })
      onDone(result)
      onOpenChange(false)
    } catch (err) {
      if (err instanceof ReceiptValidationError) {
        toast({ title: t("toast.refused"), description: err.errors.map((e) => errorText(e.code, e.params)).join(" · "), variant: "destructive" })
      } else if (err instanceof ProcWriteError) {
        toast({ title: t("toast.refused"), description: t(`err.${err.code}` as "err.wrong_state"), variant: "destructive" })
      } else {
        console.error("receipt not recorded:", err)
        toast({ title: t("toast.failed"), variant: "destructive" })
      }
    } finally {
      setSaving(false)
    }
  })

  const supplierName = po?.supplierName || delivery?.supplierName || "—"
  const canSubmit = !saving && Boolean(watch("receiverName")?.trim()) && (legacy || errors.length === 0)
  const selfReceive = Boolean(po && po.preparedById === actor.uid)

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-lg">
        <DialogHeader className="space-y-1 border-b px-4 pb-3 pt-4 text-start">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
              <PackageCheck size={18} aria-hidden="true" />
            </span>
            {t("receive.title")}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{t("receive.supplier")}</p>
                <p className="truncate font-semibold text-foreground" dir="auto">{supplierName}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{t("receive.order")}</p>
                <p className="truncate font-semibold text-foreground">{po ? displayPoNumber(po.docNumber, locale) : t("receive.noOrder")}</p>
              </div>
              {po && (
                <div className="col-span-2">
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">{t("receive.buyer")}</p>
                  <p className="text-foreground" dir="auto">{t("receive.buyerNote", { name: po.preparedByName })}</p>
                </div>
              )}
              {delivery && (delivery.deliveryPersonName || delivery.deliveryDate) && (
                <div className="col-span-2 flex items-center gap-1.5 text-muted-foreground">
                  <Truck size={12} aria-hidden="true" />
                  <span dir="auto">{delivery.deliveryPersonName || t("receive.driverUnknown")}</span>
                  {delivery.deliveryDate && <span>· {delivery.deliveryDate.slice(0, 10)}</span>}
                </div>
              )}
              {noNotice && (
                <p className="col-span-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-800">
                  <AlertTriangle size={12} aria-hidden="true" />
                  {t("receive.noNotice")}
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {selfReceive && (
              <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
                <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{t("receive.selfReceive")}</span>
              </p>
            )}

            {legacy ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{tc("delivery_confirm_desc")}</p>
                {(delivery?.items || []).length > 0 && (
                  <ul className="space-y-1 rounded-md border bg-muted/30 p-2 text-sm">
                    {(delivery?.items || []).map((it, i) => (
                      <li key={i} className="flex justify-between gap-2" dir="auto">
                        <span className="truncate">{it.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {it.quantity} {it.unitOfMeasure || it.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">{t("receive.blindHint")}</p>
                {base.map((l, i) => {
                  const row = rows?.[i]
                  const d = domainLines[i]
                  const poLine = po?.lines.find((x) => x.id === l.poLineId)
                  const counted = d?.counted
                  const variance = d ? varianceVsNotice(d) : null
                  const accepted = d ? acceptedOf(d) : 0
                  const over = poLine && counted != null ? overReceiptRefusal(poLine, counted, policies) : null
                  const lineErrs = (errorsByLine.get(l.poLineId) || []).filter((e) => e.code !== "count_missing" && e.code !== "over_receipt")
                  const rejectedQ = d?.rejected || 0
                  const heldQ = d?.held || 0
                  return (
                    <div key={l.poLineId} className={cn("rounded-lg border p-3", over ? "border-destructive/50" : "border-border")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold" dir="auto">{l.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {l.unit}
                            {poLine && <> · {t("receive.openOnOrder", { qty: lineToArrive(poLine), unit: l.unit })}</>}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2">
                        <Label htmlFor={`counted-${i}`} className="text-xs font-semibold">{t("receive.counted")}</Label>
                        <Input id={`counted-${i}`} inputMode="decimal" placeholder="—" dir="ltr" autoComplete="off" className="mt-1 h-12 text-xl font-bold tabular-nums" {...register(`lines.${i}.counted`)} />
                      </div>
                      <p className={cn("mt-1.5 text-xs", counted == null ? "text-muted-foreground" : variance === 0 || (l.noticeQuantity <= 0 && !noNotice) ? "text-success" : variance != null && variance !== 0 ? "text-amber-700" : "text-muted-foreground")}>
                        {counted == null
                          ? t("receive.noticeHidden")
                          : l.noticeQuantity <= 0
                            ? t("receive.noNoticeToCompare")
                            : variance === 0
                              ? t("receive.matchesNotice", { qty: l.noticeQuantity })
                              : (variance as number) < 0
                                ? t("receive.belowNotice", { notice: l.noticeQuantity, diff: round2(-(variance as number)) })
                                : t("receive.aboveNotice", { notice: l.noticeQuantity, diff: round2(variance as number) })}
                        {counted != null && (
                          <>
                            {" · "}
                            <span className={cn("font-semibold", over ? "text-destructive" : "text-success")}>{t("receive.accepted", { qty: accepted, unit: l.unit })}</span>
                          </>
                        )}
                      </p>
                      {over && <p className="mt-1 text-xs font-semibold text-destructive">{errorText(over.code, over.params)}</p>}
                      {lineErrs.map((e) => (
                        <p key={e.code} className="mt-1 text-xs font-semibold text-destructive">{errorText(e.code, e.params)}</p>
                      ))}

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Collapsible open={openReject[l.poLineId] || rejectedQ > 0} onOpenChange={(o) => setOpenReject((s) => ({ ...s, [l.poLineId]: o }))}>
                          <CollapsibleTrigger asChild>
                            <Button type="button" variant="outline" size="sm" className="h-9 w-full justify-between text-xs">
                              {t("receive.reject")} <ChevronDown size={14} aria-hidden="true" />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="col-span-2 mt-2 space-y-2 rounded-md bg-destructive/5 p-2">
                            <Label htmlFor={`rej-${i}`} className="text-xs">{t("receive.rejectedQty")}</Label>
                            <Input id={`rej-${i}`} inputMode="decimal" placeholder="0" dir="ltr" className="h-10 tabular-nums" {...register(`lines.${i}.rejected`)} />
                            <Label className="text-xs">{t("receive.rejectReason")}</Label>
                            <div className="flex flex-wrap gap-1.5">
                              {REJECT_REASON_CODES.map((c) => (
                                <button
                                  type="button"
                                  key={c}
                                  onClick={() => setValue(`lines.${i}.rejectReason`, row?.rejectReason === c ? "" : c)}
                                  className={cn("rounded-full border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", row?.rejectReason === c ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-background hover:bg-muted")}
                                  aria-pressed={row?.rejectReason === c}
                                >
                                  {tp(`rejectReason.${c}`)}
                                </button>
                              ))}
                            </div>
                            <Input placeholder={t("receive.rejectNotePlaceholder")} className="h-9 text-sm" dir="auto" {...register(`lines.${i}.rejectNote`)} />
                          </CollapsibleContent>
                        </Collapsible>
                        <Collapsible open={openHold[l.poLineId] || heldQ > 0} onOpenChange={(o) => setOpenHold((s) => ({ ...s, [l.poLineId]: o }))}>
                          <CollapsibleTrigger asChild>
                            <Button type="button" variant="outline" size="sm" className="h-9 w-full justify-between text-xs">
                              {t("receive.hold")} <ChevronDown size={14} aria-hidden="true" />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="col-span-2 mt-2 space-y-2 rounded-md bg-module/5 p-2">
                            <Label htmlFor={`held-${i}`} className="text-xs">{t("receive.heldQty")}</Label>
                            <Input id={`held-${i}`} inputMode="decimal" placeholder="0" dir="ltr" className="h-10 tabular-nums" {...register(`lines.${i}.held`)} />
                            <Label className="text-xs">{t("receive.holdReason")}</Label>
                            <div className="flex flex-wrap gap-1.5">
                              {HOLD_REASON_CODES.map((c) => (
                                <button
                                  type="button"
                                  key={c}
                                  onClick={() => setValue(`lines.${i}.holdReason`, row?.holdReason === c ? "" : c)}
                                  className={cn("rounded-full border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", row?.holdReason === c ? "border-module bg-module text-white" : "border-border bg-background hover:bg-muted")}
                                  aria-pressed={row?.holdReason === c}
                                >
                                  {tp(`holdReason.${c}`)}
                                </button>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    </div>
                  )
                })}
                {formErrors.map((e) => (
                  <p key={e.code} className="text-xs font-semibold text-destructive">{errorText(e.code, e.params)}</p>
                ))}
              </div>
            )}

            {!legacy && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-muted-foreground">{t("receive.checklist")}</p>
                {RECEIPT_CHECKS.map((c) => (
                  <label key={c} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-md border px-3 text-sm hover:bg-muted/40">
                    <Checkbox checked={(checklist || []).includes(c)} onCheckedChange={(v) => toggleCheck(c, v === true)} aria-label={tp(`checklist.${c}`)} />
                    <span>{tp(`checklist.${c}`)}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {noNotice && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="rcv-date" className="text-xs">{t("receive.deliveryDate")}</Label>
                    <input id="rcv-date" type="date" dir="ltr" max={new Date().toISOString().slice(0, 10)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("deliveryDate")} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rcv-driver" className="text-xs">{t("receive.driver")}</Label>
                    <Input id="rcv-driver" className="h-10" dir="auto" {...register("driverName")} />
                  </div>
                </>
              )}
              {!legacy && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="rcv-plate" className="text-xs">{t("receive.vehiclePlate")}</Label>
                    <Input id="rcv-plate" className="h-10" dir="ltr" {...register("vehiclePlate")} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rcv-paper" className="text-xs">{t("receive.paperNote")}</Label>
                    <Input id="rcv-paper" className="h-10" dir="ltr" placeholder={t("receive.paperNotePlaceholder")} {...register("paperNoteNumber")} />
                  </div>
                </>
              )}
              {warehouses.length > 0 && (
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">{t("receive.landing")}</Label>
                  <Select value={watch("landedWarehouseId") || "__auto__"} onValueChange={(v) => setValue("landedWarehouseId", v === "__auto__" ? "" : v)}>
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">{t("receive.landingAuto")}</SelectItem>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="rcv-name" className="text-xs">{tc("delivery_receiver_label")} *</Label>
                <Input id="rcv-name" className="h-10" dir="auto" placeholder={tc("delivery_receiver_placeholder")} {...register("receiverName")} />
              </div>
              {!legacy && (
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="rcv-note" className="text-xs">{t("receive.note")}</Label>
                  <Textarea id="rcv-note" rows={2} dir="auto" placeholder={t("receive.notePlaceholder")} {...register("note")} />
                </div>
              )}
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block text-xs">{t("receive.signature")}</Label>
                <SignaturePad value={signature} onChange={setSignature} clearLabel={tc("goods_manual_sig_clear")} placeholderText={tc("goods_manual_sig_placeholder")} height={110} />
              </div>
            </div>

            {!legacy && (
              <ul className="space-y-1 rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                <li>{t("receive.effectStock")}</li>
                <li>{t("receive.effectRejects")}</li>
                <li>{t("receive.effectHeld")}</li>
                <li>{t("receive.effectFinance")}</li>
              </ul>
            )}
          </div>

          <div className="border-t bg-background px-4 py-3">
            <Button type="submit" disabled={!canSubmit} className="h-12 w-full gap-2 text-base">
              {saving ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <PackageCheck size={18} aria-hidden="true" />}
              {legacy ? tc("delivery_confirm_submit") : t("receive.submit", { qty: totalAccepted })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
