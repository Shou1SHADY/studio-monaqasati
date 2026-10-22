"use client"

// «سجّل سند استلام يدوياً» (PRD 2.0 RCV-05, WF-20): something bought OUTSIDE the platform — the neighbourhood shop, a supplier that is not on
// it. The supplier is free text, the site is where it was delivered, the day is never later than today, the invoice number and value are
// optional, the material rows are the ones used everywhere, and the buyer says what comes next («ثم ماذا؟»): an order raised later over it, or
// a cash expense. It is tagged «يدوي» and listed under «بلا أمر شراء». At a project's store it lands at once; at a main warehouse it is a DRAFT
// the storekeeper confirms — nothing enters stock before. The server writes it (`/api/procurement/manual-receipt`); the form's rules are
// `manual-receipt-form.ts`. No signature pads: the buyer's name and the time are the record.

import { useMemo, useRef, useState } from "react"
import { useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage"
import { Loader2, Paperclip, Plus, PlusCircle, Trash2, X } from "lucide-react"
import { useStorage } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Chip } from "@/components/module-ui/Chip"
import { cn } from "@/lib/utils"
import { displayReceiptNumber } from "@/lib/procurement/format"
import { MANUAL_AFTER, manualFormToBody, manualReceiptSchema, type ManualReceiptValues } from "@/lib/procurement/manual-receipt-form"
import { registeredSuppliers } from "@/lib/procurement/receipt-regularise"
import type { ProcActor, PurchaseOrder } from "@/lib/procurement/types"

type FormValues = ManualReceiptValues

const emptyRow = (): FormValues["rows"][number] => ({ inventoryItemId: "", itemName: "", quantity: "", unit: "", unitPrice: "" })

export interface ManualReceiptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actor: ProcActor
  orgId: string
  orders: PurchaseOrder[]
  /** The stores a purchase can be delivered to; the central one first. */
  warehouses: Array<{ id: string; name: string; projectId?: string | null }>
  onDone: (deliveryId: string, tab: "nopo") => void
}

export function ManualReceiptDialog({ open, onOpenChange, actor, orgId, orders, warehouses, onDone }: ManualReceiptDialogProps) {
  const t = useTranslations("Portal.ProcReceipts")
  const tc = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const storage = useStorage()
  const { toast } = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const fileRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])

  const blank = (): FormValues => ({ supplierName: "", supplierOrgId: "", deliveryDate: today, warehouseId: "", invoiceNumber: "", invoiceValue: "", after: "later", notes: "", rows: [emptyRow()] })
  const schema = useMemo(() => manualReceiptSchema(today), [today])
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank() })
  const { register, control, setValue, handleSubmit, formState } = form
  const { errors, isSubmitting } = formState
  const { fields, append, remove } = useFieldArray({ control, name: "rows" })
  const warehouseId = useWatch({ control, name: "warehouseId" })
  const after = useWatch({ control, name: "after" })
  const supplierName = useWatch({ control, name: "supplierName" })
  const registered = useMemo(() => registeredSuppliers(orders), [orders])
  const picked = warehouses.find((w) => w.id === warehouseId) || null

  const reset = () => {
    form.reset(blank())
    setFiles([])
    if (fileRef.current) fileRef.current.value = ""
  }

  const errText = (code: string | undefined, n?: number) => (code ? t(`manual.${code}` as "manual.errSupplier", { n: n ?? 0 }) : null)
  const FieldError = ({ code, n }: { code?: string; n?: number }) => (code ? <p className="text-[11px] font-semibold text-destructive" role="alert">{errText(code, n)}</p> : null)

  // The attachments go up first so the receipt is born with them — a receipt is never edited after recording.
  const upload = async (): Promise<Array<{ name: string; url: string }>> => {
    if (!files.length || !storage) return []
    const out: Array<{ name: string; url: string }> = []
    for (const f of files) {
      const r = storageRef(storage, `deliveries/manual/${orgId}/${Date.now()}_${f.name.replace(/[^\w.؀-ۿ-]+/g, "_").slice(-80)}`)
      await uploadBytes(r, f)
      out.push({ name: f.name.slice(0, 120), url: await getDownloadURL(r) })
    }
    return out
  }

  const save = handleSubmit(async (v) => {
    const user = getAuth().currentUser
    if (!user || !orgId) return
    try {
      const guess = registered.find((s) => s.name.trim() === v.supplierName.trim())
      const body = manualFormToBody({ ...v, supplierOrgId: guess?.orgId || "" }, await upload(), { seesPrices: actor.seesPrices, unitDefault: t("manual.unitDefault") })
      const res = await fetch("/api/procurement/manual-receipt", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify(body) })
      const json = (await res.json().catch(() => null)) as { data?: { deliveryId: string; docNumber: string; draft: boolean; stockLanded: boolean }; code?: string } | null
      if (!res.ok || !json?.data) {
        toast({ title: t("toast.refused"), description: json?.code === "DATE_FUTURE" ? t("manual.errDate") : json?.code === "SITE_MISSING" ? t("manual.errSite") : t("manual.failed"), variant: "destructive" })
        return
      }
      const r = json.data
      toast({ title: t(r.draft ? "manual.doneDraft" : "manual.doneNoPo", { number: displayReceiptNumber(r.docNumber, locale) }), description: t(r.draft ? "manual.doneDraftDesc" : "manual.doneNoPoDesc") })
      reset()
      onDone(r.deliveryId, "nopo")
    } catch (err) {
      console.error("manual receipt not recorded:", err)
      toast({ title: t("manual.failed"), variant: "destructive" })
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="manual-supplier">{t("manual.supplierAsInvoiced")} *</Label>
              <Input id="manual-supplier" list="manual-suppliers" {...register("supplierName")} placeholder={t("manual.supplierPlaceholder")} dir="auto" aria-invalid={Boolean(errors.supplierName)} autoComplete="off" />
              <datalist id="manual-suppliers">
                {registered.map((s) => (
                  <option key={s.orgId} value={s.name} />
                ))}
              </datalist>
              <FieldError code={errors.supplierName?.message} />
              <p className="text-[11px] text-muted-foreground">{t("manual.supplierHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-site">{t("manual.site")} *</Label>
              <Select value={warehouseId || "__none__"} onValueChange={(v) => setValue("warehouseId", v === "__none__" ? "" : v, { shouldValidate: formState.isSubmitted })}>
                <SelectTrigger id="manual-site" aria-invalid={Boolean(errors.warehouseId)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("manual.sitePlaceholder")}</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError code={errors.warehouseId?.message} />
              {picked && <p className="text-[11px] text-muted-foreground">{picked.projectId ? t("manual.siteEffectSite") : t("manual.siteEffectMain")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-date">{t("manual.date")} *</Label>
              <input id="manual-date" type="date" {...register("deliveryDate")} max={today} dir="ltr" aria-invalid={Boolean(errors.deliveryDate)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <FieldError code={errors.deliveryDate?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-inv-no">{t("manual.invoiceNo")}</Label>
              <Input id="manual-inv-no" {...register("invoiceNumber")} dir="ltr" placeholder="INV-…" />
            </div>
            {actor.seesPrices && (
              <div className="space-y-1.5">
                <Label htmlFor="manual-inv-value">{t("manual.invoiceValue")}</Label>
                <Input id="manual-inv-value" inputMode="decimal" {...register("invoiceValue")} dir="ltr" placeholder="0.00" aria-invalid={Boolean(errors.invoiceValue)} />
                <FieldError code={errors.invoiceValue?.message} />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("manual.linesTitle")} *</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => append(emptyRow())} className="h-8 gap-1 px-2 text-xs">
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

          <div className="space-y-2">
            <Label>{t("manual.then")}</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("manual.then")}>
              {MANUAL_AFTER.map((a) => (
                <Chip key={a} selected={after === a} onClick={() => setValue("after", a)}>
                  {t(`manual.after_${a}`)}
                </Chip>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{t(`manual.after_${after}_hint`)}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-file">{t("manual.photo")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                id="manual-file"
                type="file"
                multiple
                accept="image/*,.pdf"
                className="sr-only"
                onChange={(e) => {
                  const picked = Array.from(e.target.files || [])
                  if (picked.length) setFiles((cur) => [...cur, ...picked].slice(0, 10))
                  e.target.value = ""
                }}
              />
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => fileRef.current?.click()}>
                <Paperclip size={14} aria-hidden="true" />
                {t("manual.chooseFile")}
              </Button>
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                  <bdi className="max-w-[10rem] truncate">{f.name}</bdi>
                  <button type="button" aria-label={t("manual.removeFile")} className="rounded p-0.5 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-notes">{tc("goods_manual_notes_label")}</Label>
            <Textarea id="manual-notes" rows={2} {...register("notes")} placeholder={tc("goods_manual_notes_placeholder")} dir="auto" />
          </div>
          {supplierName.trim().length >= 2 && <p className="rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">{t("manual.effectFlagged")}</p>}
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
