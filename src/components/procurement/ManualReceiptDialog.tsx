"use client"

// The manual goods receipt (PRD 3.0 §7.4 `manrc`): a purchase made outside the
// platform, or goods that arrived with no order — typed by hand, flagged
// "recorded manually by Procurement", listed in the exceptions. Optionally
// against a live order of a supplier registered with us (pick the supplier,
// then one of his orders): then it is an arrival with no notice on that order
// (its lines, counted here; the order's counters move) and never a "no PO"
// receipt. Without an order it enters the No-PO segment and waits to be
// regularised; Finance holds its invoice until then. Posts nothing itself.
// Procurement's form (S-13): whoever prepares orders, or the owner. A photo of
// the shop invoice rides with it; unit prices are asked only of a price role.
// Validation is the prototype's, field by field (`manual-receipt-form.ts`).

import { useEffect, useMemo, useRef, useState } from "react"
import { useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocale, useTranslations } from "next-intl"
import { FileText, Loader2, Paperclip, PenLine, Plus, PlusCircle, Trash2, Warehouse } from "lucide-react"
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage"
import { useFirestore, useStorage } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SignaturePad } from "@/components/SignaturePad"
import { cn } from "@/lib/utils"
import { displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { manualNum, manualReceiptSchema, type ManualReceiptValues } from "@/lib/procurement/manual-receipt-form"
import { lineToArrive, poStatus } from "@/lib/procurement/po"
import { ReceiptValidationError, createArrivalWithoutNotice, createManualReceipt } from "@/lib/procurement/receipt-writes"
import { registeredSuppliers } from "@/lib/procurement/receipt-regularise"
import type { DeliveryLine, ProcActor, ProcurementPolicies, PurchaseOrder } from "@/lib/procurement/types"
import { ProcWriteError } from "@/lib/procurement/writes"

type FormValues = ManualReceiptValues

const emptyRow = (): FormValues["rows"][number] => ({ inventoryItemId: "", itemName: "", quantity: "", unit: "", unitPrice: "" })

/** Orders a manual receipt may be counted against: sent or accepted, with something still to arrive. */
export function receivableOrders(orders: PurchaseOrder[]): PurchaseOrder[] {
  return orders.filter((o) => (o.status === "sent" || o.status === "accepted") && poStatus(o) !== "received" && o.lines.some((l) => lineToArrive(l) > 0))
}

export interface ManualReceiptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actor: ProcActor
  orgId: string
  orders: PurchaseOrder[]
  policies: ProcurementPolicies
  warehouses: Array<{ id: string; name: string }>
  projects: Array<{ id: string; name: string; warehouseId?: string | null }>
  alreadyPostedNet: (po: PurchaseOrder) => number
  projectName: (id: string | null | undefined) => string | null
  onDone: (deliveryId: string, tab: "log" | "nopo") => void
}

export function ManualReceiptDialog({ open, onOpenChange, actor, orgId, orders, policies, warehouses, projects, alreadyPostedNet, projectName, onDone }: ManualReceiptDialogProps) {
  const t = useTranslations("Portal.ProcReceipts")
  const tc = useTranslations("Portal.Contractor")
  const tp = useTranslations("Portal.Procurement")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [supplierSig, setSupplierSig] = useState<string | null>(null)
  const [contractorSig, setContractorSig] = useState<string | null>(null)

  const blank = (): FormValues => ({
    supplierName: "",
    supplierOrgId: "",
    poId: "",
    deliveryDate: today,
    driverName: "",
    receiverName: actor.name,
    notes: "",
    reason: "",
    paperNoteNumber: "",
    warehouseId: "",
    projectId: "",
    rows: [emptyRow()],
    poCounts: {},
    supplierCr: "",
    supplierVat: "",
    contractorCr: "",
    contractorVat: "",
  })
  const schema = useMemo(() => manualReceiptSchema(today), [today])
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank() })
  const { register, control, setValue, handleSubmit, formState } = form
  const { errors, isSubmitting } = formState
  const { fields, append, remove } = useFieldArray({ control, name: "rows" })
  const supplierOrgId = useWatch({ control, name: "supplierOrgId" })
  const poId = useWatch({ control, name: "poId" })
  const warehouseId = useWatch({ control, name: "warehouseId" })
  const projectId = useWatch({ control, name: "projectId" })
  const poCounts = useWatch({ control, name: "poCounts" })

  const registered = useMemo(() => registeredSuppliers(orders), [orders])
  const live = useMemo(() => (supplierOrgId ? receivableOrders(orders).filter((o) => o.supplierOrgId === supplierOrgId) : []), [orders, supplierOrgId])
  const po = useMemo(() => live.find((o) => o.id === poId) || null, [live, poId])
  const warehouseProjects = useMemo(() => projects.filter((p) => p.warehouseId === warehouseId), [projects, warehouseId])

  useEffect(() => {
    setValue("projectId", warehouseProjects.length === 1 ? warehouseProjects[0].id : "")
    // Only when the candidate set changes.
  }, [warehouseProjects.map((p) => p.id).join(",")])

  useEffect(() => {
    if (poId && !live.some((o) => o.id === poId)) setValue("poId", "")
  }, [live, poId, setValue])

  const reset = () => {
    form.reset(blank())
    setFile(null)
    if (fileRef.current) fileRef.current.value = ""
    setSupplierSig(null)
    setContractorSig(null)
  }

  // The message a field failed with, in the reader's language; line messages name the line.
  const errText = (code: string | undefined, n?: number) => (code ? t(`manual.${code}` as "manual.errSupplier", { n: n ?? 0 }) : null)
  const FieldError = ({ code, n }: { code?: string; n?: number }) => (code ? <p className="text-[11px] font-semibold text-destructive" role="alert">{errText(code, n)}</p> : null)

  // The invoice photo goes up first so the receipt is born with it — a
  // receipt is never edited after recording.
  const uploadInvoice = async (): Promise<string[]> => {
    if (!file || !storage) return []
    const r = storageRef(storage, `deliveries/manual/${orgId}/${Date.now()}_${file.name}`)
    await uploadBytes(r, file)
    return [await getDownloadURL(r)]
  }

  const save = handleSubmit(async (v) => {
    if (!firestore || !orgId) return
    try {
      const opts = { copy: tShared as unknown as import("@/lib/mfg-events").Translator, locale: locale as "ar" | "en", centralWarehouseCopy: { name: tc("wh_central_name"), location: tc("wh_central_location"), description: tc("wh_central_desc") } }
      if (po) {
        const lines: DeliveryLine[] = po.lines
          .filter((l) => lineToArrive(l) > 0)
          .map((l) => ({ poLineId: l.id, name: l.name, unit: l.unit, noticeQuantity: 0, counted: v.poCounts[l.id]?.trim() ? manualNum(v.poCounts[l.id]) : undefined }))
        const attachmentUrls = await uploadInvoice()
        const r = await createArrivalWithoutNotice(
          firestore,
          actor,
          { po, lines, receiverName: v.receiverName, deliveryDate: v.deliveryDate, driverName: v.driverName, paperNoteNumber: v.paperNoteNumber, note: [v.reason.trim(), v.notes.trim()].filter(Boolean).join(" — ") || null, landedWarehouseId: v.warehouseId || null, policies, alreadyPostedNet: alreadyPostedNet(po), projectName: projectName(po.projectId), manual: true, checklist: attachmentUrls.length ? ["delivery_note"] : [], attachmentUrls },
          opts
        )
        toast({ title: t("manual.doneOnOrder", { number: displayReceiptNumber(r.docNumber, locale), po: displayPoNumber(po.docNumber, locale) }), description: r.stockLanded ? undefined : t("toast.noStock"), variant: r.stockLanded ? undefined : "destructive" })
        reset()
        onDone(r.deliveryId, "log")
        return
      }
      const items = v.rows.map((r) => ({ name: r.itemName.trim(), quantity: manualNum(r.quantity), unit: r.unit.trim() || t("manual.unitDefault"), unitPrice: actor.seesPrices && r.unitPrice.trim() && Number.isFinite(manualNum(r.unitPrice)) ? manualNum(r.unitPrice) : null, inventoryItemId: r.inventoryItemId || null }))
      const attachmentUrls = await uploadInvoice()
      const r = await createManualReceipt(firestore, actor, {
        organizationId: orgId,
        supplierName: v.supplierName,
        deliveryDate: v.deliveryDate,
        receiverName: v.receiverName,
        driverName: v.driverName,
        notes: v.notes,
        reason: v.reason,
        warehouseId: v.warehouseId || null,
        projectId: v.projectId || null,
        items,
        paperNoteNumber: v.paperNoteNumber,
        supplierCrNumber: v.supplierCr,
        supplierVatNumber: v.supplierVat,
        contractorCrNumber: v.contractorCr,
        contractorVatNumber: v.contractorVat,
        supplierSignatureData: supplierSig,
        contractorSignatureData: contractorSig,
        supplierGuessOrgId: v.supplierOrgId || null,
        attachmentUrls,
      })
      toast({ title: t("manual.doneNoPo", { number: displayReceiptNumber(r.docNumber, locale) }), description: t("manual.doneNoPoDesc") })
      reset()
      onDone(r.deliveryId, "nopo")
    } catch (err) {
      if (err instanceof ReceiptValidationError) toast({ title: t("toast.refused"), description: err.errors.map((e) => tp(`receiptError.${e.code}`, e.params)).join(" · "), variant: "destructive" })
      else if (err instanceof ProcWriteError) toast({ title: t("toast.refused"), description: t(`err.${err.code}` as "err.wrong_state"), variant: "destructive" })
      else {
        console.error("manual receipt not recorded:", err)
        toast({ title: tc("goods_manual_error"), variant: "destructive" })
      }
    }
  })

  const saving = isSubmitting

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle>{t("manual.title")}</DialogTitle>
          <DialogDescription>{t("manual.subtitle")}</DialogDescription>
        </DialogHeader>
        <form id="manual-receipt-form" onSubmit={save} noValidate className="space-y-4 py-2">
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{t("manual.warning")}</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="manual-supplier">{t("manual.supplierAsInvoiced")} *</Label>
              <Input id="manual-supplier" {...register("supplierName")} placeholder={t("manual.supplierPlaceholder")} dir="auto" aria-invalid={Boolean(errors.supplierName)} />
              <FieldError code={errors.supplierName?.message} />
              <p className="text-[11px] text-muted-foreground">{t("manual.supplierHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-registered">{t("manual.registered")}</Label>
              <Select value={supplierOrgId || "__none__"} onValueChange={(v) => setValue("supplierOrgId", v === "__none__" ? "" : v)}>
                <SelectTrigger id="manual-registered">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("manual.offPlatform")}</SelectItem>
                  {registered.map((s) => (
                    <SelectItem key={s.orgId} value={s.orgId}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {supplierOrgId && live.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="manual-po">{t("manual.againstPo")}</Label>
                <Select value={poId || "__none__"} onValueChange={(v) => setValue("poId", v === "__none__" ? "" : v)}>
                  <SelectTrigger id="manual-po">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("manual.noPoOption")}</SelectItem>
                    {live.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {displayPoNumber(o.docNumber, locale)} · {o.lines.filter((l) => lineToArrive(l) > 0).map((l) => l.name).join("، ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {po && <p className="text-xs text-muted-foreground sm:col-span-2">{t("manual.poHint", { po: displayPoNumber(po.docNumber, locale) })}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="manual-date">{tc("goods_manual_delivery_date")} *</Label>
              <input id="manual-date" type="date" {...register("deliveryDate")} max={today} dir="ltr" aria-invalid={Boolean(errors.deliveryDate)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <FieldError code={errors.deliveryDate?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-driver">{tc("goods_manual_delivery_person")}</Label>
              <Input id="manual-driver" {...register("driverName")} placeholder={tc("goods_manual_delivery_person_placeholder")} dir="auto" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-receiver">{t("manual.whoReceived")} *</Label>
              <Input id="manual-receiver" {...register("receiverName")} placeholder={tc("goods_manual_receiver_placeholder")} dir="auto" aria-invalid={Boolean(errors.receiverName)} />
              <FieldError code={errors.receiverName?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-paper">{t("manual.paperNote")}</Label>
              <Input id="manual-paper" {...register("paperNoteNumber")} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Warehouse size={13} className="text-muted-foreground" aria-hidden="true" />
                {t("manual.place")}
              </Label>
              <Select value={warehouseId || "__auto__"} onValueChange={(v) => setValue("warehouseId", v === "__auto__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">{po ? t("receive.landingAuto") : t("manual.placeNone")}</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!po && warehouseId && warehouseProjects.length > 0 && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{tc("goods_manual_project")}</Label>
                <Select value={projectId || "__none__"} onValueChange={(v) => setValue("projectId", v === "__none__" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={tc("goods_manual_project_placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{tc("goods_manual_project_none")}</SelectItem>
                    {warehouseProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Lines */}
          {po ? (
            <div className="space-y-2">
              <Label>{t("manual.countOrderLines")}</Label>
              <div className="space-y-2">
                {po.lines
                  .filter((l) => lineToArrive(l) > 0)
                  .map((l) => (
                    <div key={l.id} className="flex items-center gap-3 rounded-md border p-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold" dir="auto">{l.name}</p>
                        <p className="text-[11px] text-muted-foreground">{t("receive.openOnOrder", { qty: lineToArrive(l), unit: l.unit })}</p>
                      </div>
                      <Input
                        inputMode="decimal"
                        placeholder="—"
                        dir="ltr"
                        aria-label={`${t("receive.counted")} ${l.name}`}
                        className="h-10 w-28 tabular-nums"
                        value={poCounts?.[l.id] || ""}
                        onChange={(e) => setValue("poCounts", { ...(poCounts || {}), [l.id]: e.target.value }, { shouldValidate: formState.isSubmitted })}
                      />
                    </div>
                  ))}
              </div>
              <FieldError code={(errors.poCounts as { message?: string } | undefined)?.message} />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("manual.linesTitle")} *</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => append(emptyRow())} className="h-7 gap-1 px-2 text-xs">
                  <Plus size={12} aria-hidden="true" />
                  {tc("goods_manual_add_item")}
                </Button>
              </div>
              <div className="space-y-2">
                {fields.map((row, i) => {
                  const rowErr = errors.rows?.[i]
                  return (
                    <div key={row.id} className={cn("grid grid-cols-2 gap-2 rounded-md border p-2", rowErr ? "border-destructive/50" : "", actor.seesPrices ? "sm:grid-cols-[2.2fr_1fr_1fr_1fr_auto]" : "sm:grid-cols-[2.2fr_1fr_1fr_auto]")}>
                      <div className="col-span-2 sm:col-span-1">
                        <Label htmlFor={`mi-name-${i}`} className="text-[11px]">{t("manual.lineDesc")}</Label>
                        <Input id={`mi-name-${i}`} {...register(`rows.${i}.itemName`)} placeholder={t("manual.lineDescPlaceholder")} className="h-9 text-sm" dir="auto" aria-invalid={Boolean(rowErr?.itemName)} />
                      </div>
                      <div>
                        <Label htmlFor={`mi-qty-${i}`} className="text-[11px]">{tc("goods_manual_item_qty")}</Label>
                        <Input id={`mi-qty-${i}`} inputMode="decimal" {...register(`rows.${i}.quantity`)} placeholder="0" dir="ltr" className="h-9 text-sm tabular-nums" aria-invalid={Boolean(rowErr?.quantity)} />
                      </div>
                      <div>
                        <Label htmlFor={`mi-unit-${i}`} className="text-[11px]">{tc("goods_manual_item_unit")}</Label>
                        <Input id={`mi-unit-${i}`} {...register(`rows.${i}.unit`)} placeholder={t("manual.unitPlaceholder")} className="h-9 text-sm" dir="auto" />
                      </div>
                      {actor.seesPrices && (
                        <div>
                          <Label htmlFor={`mi-price-${i}`} className="text-[11px]">{t("manual.unitPrice")}</Label>
                          <Input id={`mi-price-${i}`} inputMode="decimal" {...register(`rows.${i}.unitPrice`)} placeholder="—" dir="ltr" className="h-9 text-sm tabular-nums" />
                        </div>
                      )}
                      <div className="flex items-end justify-end">
                        {fields.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive/60 hover:text-destructive" aria-label={t("manual.removeLine")} onClick={() => remove(i)}>
                            <Trash2 size={14} aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                      {(rowErr?.itemName || rowErr?.quantity) && (
                        <div className="col-span-full space-y-0.5">
                          <FieldError code={rowErr?.itemName?.message} n={i + 1} />
                          <FieldError code={rowErr?.quantity?.message} n={i + 1} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="manual-file">{t("manual.photo")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} id="manual-file" type="file" accept="image/*,.pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => fileRef.current?.click()}>
                <Paperclip size={14} aria-hidden="true" />
                {file ? <bdi className="max-w-[14rem] truncate">{file.name}</bdi> : t("manual.chooseFile")}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-reason">{t("manual.reason")}</Label>
            <Textarea id="manual-reason" rows={2} {...register("reason")} placeholder={t("manual.reasonPlaceholder")} dir="auto" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-notes">{tc("goods_manual_notes_label")}</Label>
            <Textarea id="manual-notes" rows={2} {...register("notes")} placeholder={tc("goods_manual_notes_placeholder")} dir="auto" />
          </div>

          {!po && (
            <>
              <div className="space-y-3 border-t pt-2">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
                  <FileText size={12} aria-hidden="true" />
                  {tc("goods_manual_biz_section")}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="m-scr" className="text-xs">{tc("goods_manual_supplier_cr")}</Label>
                    <Input id="m-scr" {...register("supplierCr")} placeholder={tc("goods_manual_cr_placeholder")} className="h-8 text-sm" dir="ltr" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="m-svat" className="text-xs">{tc("goods_manual_supplier_vat")}</Label>
                    <Input id="m-svat" {...register("supplierVat")} placeholder={tc("goods_manual_vat_placeholder")} className="h-8 text-sm" dir="ltr" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="m-ccr" className="text-xs">{tc("goods_manual_contractor_cr")}</Label>
                    <Input id="m-ccr" {...register("contractorCr")} placeholder={tc("goods_manual_cr_placeholder")} className="h-8 text-sm" dir="ltr" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="m-cvat" className="text-xs">{tc("goods_manual_contractor_vat")}</Label>
                    <Input id="m-cvat" {...register("contractorVat")} placeholder={tc("goods_manual_vat_placeholder")} className="h-8 text-sm" dir="ltr" />
                  </div>
                </div>
              </div>
              <div className="space-y-4 border-t pt-2">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
                  <PenLine size={12} aria-hidden="true" />
                  {tc("goods_manual_signatures_section")}
                </p>
                <div>
                  <Label className="mb-1.5 block text-xs">{tc("goods_manual_supplier_signature")}</Label>
                  <SignaturePad value={supplierSig} onChange={setSupplierSig} clearLabel={tc("goods_manual_sig_clear")} placeholderText={tc("goods_manual_sig_placeholder")} height={100} />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">{tc("goods_manual_contractor_signature")}</Label>
                  <SignaturePad value={contractorSig} onChange={setContractorSig} clearLabel={tc("goods_manual_sig_clear")} placeholderText={tc("goods_manual_sig_placeholder")} height={100} />
                </div>
              </div>
            </>
          )}

          <ul className="space-y-1 rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <li>{po ? t("manual.effectWithPo") : t("manual.effectNoPo")}</li>
            <li>{t("manual.effectFlagged")}</li>
            <li>{t("manual.effectPrint")}</li>
          </ul>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {tc("goods_manual_cancel")}
          </Button>
          <Button type="submit" form="manual-receipt-form" disabled={saving} className="gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <PlusCircle size={16} aria-hidden="true" />}
            {t("manual.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
