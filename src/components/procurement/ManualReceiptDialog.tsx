"use client"

// The manual goods receipt (PRD 3.0 §7.4 `manrc`): a purchase made outside the
// platform, or goods that arrived with no order — typed by hand, flagged
// "recorded manually by Procurement", listed in the exceptions. Optionally
// against a live order: then it is an arrival with no notice on that order
// (its lines, counted here; the order's counters move) and never a "no PO"
// receipt. Without an order it enters the No-PO segment and waits to be
// regularised; Finance holds its invoice until then. Posts nothing itself.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { FileText, Loader2, PenLine, Plus, PlusCircle, Trash2, Warehouse } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SignaturePad } from "@/components/SignaturePad"
import { displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { lineToArrive, poStatus } from "@/lib/procurement/po"
import { ReceiptValidationError, createArrivalWithoutNotice, createManualReceipt } from "@/lib/procurement/receipt-writes"
import type { DeliveryLine, ProcActor, ProcurementPolicies, PurchaseOrder } from "@/lib/procurement/types"
import { ProcWriteError } from "@/lib/procurement/writes"

type ItemRow = { rowId: string; inventoryItemId: string; itemName: string; quantity: string; unit: string; unitPrice: string }
const emptyRow = (): ItemRow => ({ rowId: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`, inventoryItemId: "", itemName: "", quantity: "", unit: "", unitPrice: "" })

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
  const { toast } = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [saving, setSaving] = useState(false)

  const [supplierName, setSupplierName] = useState("")
  const [poId, setPoId] = useState("")
  const [deliveryDate, setDeliveryDate] = useState(today)
  const [driverName, setDriverName] = useState("")
  const [receiverName, setReceiverName] = useState(actor.name)
  const [notes, setNotes] = useState("")
  const [reason, setReason] = useState("")
  const [paperNoteNumber, setPaperNoteNumber] = useState("")
  const [warehouseId, setWarehouseId] = useState("")
  const [projectId, setProjectId] = useState("")
  const [rows, setRows] = useState<ItemRow[]>([emptyRow()])
  const [poCounts, setPoCounts] = useState<Record<string, string>>({})
  const [supplierCr, setSupplierCr] = useState("")
  const [supplierVat, setSupplierVat] = useState("")
  const [contractorCr, setContractorCr] = useState("")
  const [contractorVat, setContractorVat] = useState("")
  const [supplierSig, setSupplierSig] = useState<string | null>(null)
  const [contractorSig, setContractorSig] = useState<string | null>(null)

  const live = useMemo(() => receivableOrders(orders), [orders])
  const po = useMemo(() => live.find((o) => o.id === poId) || null, [live, poId])
  const warehouseProjects = useMemo(() => projects.filter((p) => p.warehouseId === warehouseId), [projects, warehouseId])

  useEffect(() => {
    setProjectId(warehouseProjects.length === 1 ? warehouseProjects[0].id : "")
    // Only when the candidate set changes.
  }, [warehouseProjects.map((p) => p.id).join(",")])

  useEffect(() => {
    if (po) setSupplierName(po.supplierName)
  }, [po])

  const reset = () => {
    setSupplierName("")
    setPoId("")
    setDeliveryDate(today)
    setDriverName("")
    setReceiverName(actor.name)
    setNotes("")
    setReason("")
    setPaperNoteNumber("")
    setWarehouseId("")
    setProjectId("")
    setRows([emptyRow()])
    setPoCounts({})
    setSupplierCr("")
    setSupplierVat("")
    setContractorCr("")
    setContractorVat("")
    setSupplierSig(null)
    setContractorSig(null)
  }

  const update = (rowId: string, patch: Partial<ItemRow>) => setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)))

  const save = async () => {
    if (!firestore || !orgId) return
    setSaving(true)
    try {
      const opts = { copy: tShared as unknown as import("@/lib/mfg-events").Translator, locale: locale as "ar" | "en", centralWarehouseCopy: { name: tc("wh_central_name"), location: tc("wh_central_location"), description: tc("wh_central_desc") } }
      if (po) {
        const lines: DeliveryLine[] = po.lines
          .filter((l) => lineToArrive(l) > 0)
          .map((l) => ({ poLineId: l.id, name: l.name, unit: l.unit, noticeQuantity: 0, counted: poCounts[l.id]?.trim() ? Number(poCounts[l.id]) : undefined }))
        if (!receiverName.trim() || !lines.some((l) => l.counted != null)) {
          toast({ title: tc("goods_manual_validation_error"), variant: "destructive" })
          return
        }
        const r = await createArrivalWithoutNotice(
          firestore,
          actor,
          { po, lines, receiverName, deliveryDate, driverName, paperNoteNumber, note: [reason.trim(), notes.trim()].filter(Boolean).join(" — ") || null, landedWarehouseId: warehouseId || null, policies, alreadyPostedNet: alreadyPostedNet(po), projectName: projectName(po.projectId), manual: true, checklist: [] },
          opts
        )
        toast({ title: t("manual.doneOnOrder", { number: displayReceiptNumber(r.docNumber, locale), po: displayPoNumber(po.docNumber, locale) }), description: r.stockLanded ? undefined : t("toast.noStock"), variant: r.stockLanded ? undefined : "destructive" })
        reset()
        onDone(r.deliveryId, "log")
        return
      }
      const items = rows.filter((r) => r.itemName.trim() && Number(r.quantity) > 0).map((r) => ({ name: r.itemName, quantity: Number(r.quantity), unit: r.unit || t("manual.unitDefault"), unitPrice: r.unitPrice.trim() ? Number(r.unitPrice) : null, inventoryItemId: r.inventoryItemId || null }))
      if (!supplierName.trim() || !deliveryDate || deliveryDate > today || !receiverName.trim() || !items.length) {
        toast({ title: tc("goods_manual_validation_error"), variant: "destructive" })
        return
      }
      const r = await createManualReceipt(firestore, actor, {
        organizationId: orgId,
        supplierName,
        deliveryDate,
        receiverName,
        driverName,
        notes,
        reason,
        warehouseId: warehouseId || null,
        projectId: projectId || null,
        items,
        paperNoteNumber,
        supplierCrNumber: supplierCr,
        supplierVatNumber: supplierVat,
        contractorCrNumber: contractorCr,
        contractorVatNumber: contractorVat,
        supplierSignatureData: supplierSig,
        contractorSignatureData: contractorSig,
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
    } finally {
      setSaving(false)
    }
  }

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
        <div className="space-y-4 py-2">
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{t("manual.warning")}</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="manual-po">{t("manual.againstPo")}</Label>
              <Select value={poId || "__none__"} onValueChange={(v) => setPoId(v === "__none__" ? "" : v)}>
                <SelectTrigger id="manual-po">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("manual.noPoOption")}</SelectItem>
                  {live.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {displayPoNumber(o.docNumber, locale)} · {o.supplierName} · {o.lines.filter((l) => lineToArrive(l) > 0).map((l) => l.name).join("، ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {po && <p className="text-xs text-muted-foreground">{t("manual.poHint", { po: displayPoNumber(po.docNumber, locale) })}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-supplier">{t("manual.supplierAsInvoiced")} *</Label>
              <Input id="manual-supplier" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder={tc("goods_manual_supplier_placeholder")} disabled={Boolean(po)} dir="auto" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-date">{tc("goods_manual_delivery_date")} *</Label>
              <input id="manual-date" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} max={today} dir="ltr" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-driver">{tc("goods_manual_delivery_person")}</Label>
              <Input id="manual-driver" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder={tc("goods_manual_delivery_person_placeholder")} dir="auto" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-receiver">{t("manual.whoReceived")} *</Label>
              <Input id="manual-receiver" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder={tc("goods_manual_receiver_placeholder")} dir="auto" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-paper">{t("manual.paperNote")}</Label>
              <Input id="manual-paper" value={paperNoteNumber} onChange={(e) => setPaperNoteNumber(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Warehouse size={13} className="text-muted-foreground" aria-hidden="true" />
                {t("manual.place")}
              </Label>
              <Select value={warehouseId || "__auto__"} onValueChange={(v) => setWarehouseId(v === "__auto__" ? "" : v)}>
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
                <Select value={projectId || "__none__"} onValueChange={(v) => setProjectId(v === "__none__" ? "" : v)}>
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
                      <Input inputMode="decimal" placeholder="—" dir="ltr" aria-label={`${t("receive.counted")} ${l.name}`} className="h-10 w-28 tabular-nums" value={poCounts[l.id] || ""} onChange={(e) => setPoCounts((s) => ({ ...s, [l.id]: e.target.value }))} />
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("manual.linesTitle")} *</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setRows((p) => [...p, emptyRow()])} className="h-7 gap-1 px-2 text-xs">
                  <Plus size={12} aria-hidden="true" />
                  {tc("goods_manual_add_item")}
                </Button>
              </div>
              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div key={row.rowId} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-[2.2fr_1fr_1fr_1fr_auto]">
                    <div className="col-span-2 sm:col-span-1">
                      <Label htmlFor={`mi-name-${i}`} className="text-[11px]">{t("manual.lineDesc")}</Label>
                      <Input id={`mi-name-${i}`} value={row.itemName} onChange={(e) => update(row.rowId, { itemName: e.target.value })} placeholder={t("manual.lineDescPlaceholder")} className="h-9 text-sm" dir="auto" />
                    </div>
                    <div>
                      <Label htmlFor={`mi-qty-${i}`} className="text-[11px]">{tc("goods_manual_item_qty")}</Label>
                      <Input id={`mi-qty-${i}`} inputMode="decimal" value={row.quantity} onChange={(e) => update(row.rowId, { quantity: e.target.value })} placeholder="0" dir="ltr" className="h-9 text-sm tabular-nums" />
                    </div>
                    <div>
                      <Label htmlFor={`mi-unit-${i}`} className="text-[11px]">{tc("goods_manual_item_unit")}</Label>
                      <Input id={`mi-unit-${i}`} value={row.unit} onChange={(e) => update(row.rowId, { unit: e.target.value })} placeholder={t("manual.unitPlaceholder")} className="h-9 text-sm" dir="auto" />
                    </div>
                    <div>
                      <Label htmlFor={`mi-price-${i}`} className="text-[11px]">{t("manual.unitPrice")}</Label>
                      <Input id={`mi-price-${i}`} inputMode="decimal" value={row.unitPrice} onChange={(e) => update(row.rowId, { unitPrice: e.target.value })} placeholder="—" dir="ltr" className="h-9 text-sm tabular-nums" />
                    </div>
                    <div className="flex items-end justify-end">
                      {rows.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive/60 hover:text-destructive" aria-label={t("manual.removeLine")} onClick={() => setRows((p) => p.filter((r) => r.rowId !== row.rowId))}>
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="manual-reason">{t("manual.reason")}</Label>
            <Textarea id="manual-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("manual.reasonPlaceholder")} dir="auto" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-notes">{tc("goods_manual_notes_label")}</Label>
            <Textarea id="manual-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tc("goods_manual_notes_placeholder")} dir="auto" />
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
                    <Input id="m-scr" value={supplierCr} onChange={(e) => setSupplierCr(e.target.value)} placeholder={tc("goods_manual_cr_placeholder")} className="h-8 text-sm" dir="ltr" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="m-svat" className="text-xs">{tc("goods_manual_supplier_vat")}</Label>
                    <Input id="m-svat" value={supplierVat} onChange={(e) => setSupplierVat(e.target.value)} placeholder={tc("goods_manual_vat_placeholder")} className="h-8 text-sm" dir="ltr" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="m-ccr" className="text-xs">{tc("goods_manual_contractor_cr")}</Label>
                    <Input id="m-ccr" value={contractorCr} onChange={(e) => setContractorCr(e.target.value)} placeholder={tc("goods_manual_cr_placeholder")} className="h-8 text-sm" dir="ltr" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="m-cvat" className="text-xs">{tc("goods_manual_contractor_vat")}</Label>
                    <Input id="m-cvat" value={contractorVat} onChange={(e) => setContractorVat(e.target.value)} placeholder={tc("goods_manual_vat_placeholder")} className="h-8 text-sm" dir="ltr" />
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {tc("goods_manual_cancel")}
          </Button>
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <PlusCircle size={16} aria-hidden="true" />}
            {t("manual.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
