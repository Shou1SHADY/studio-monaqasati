"use client"

/**
 * Record consumption and waste against a warehouse — with or without a project.
 *
 * Pulled out of the project page so the supplier side (no projects at all) and
 * the contractor's standalone waste page share one dialog with the project's
 * Materials tab. What varies is what the caller passes: BOQ lines to link to
 * (only a project has them), the target percentage, and what happens on save.
 */

import { useEffect, useState } from "react"
import type { useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { AlertTriangle, Barcode, Loader2, Scissors, Search, Sparkles, Warehouse } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { WASTE_REASON_CODES, wasteReasonMessageKey } from "@/lib/waste-reasons"
import { suggestWastePercent } from "@/ai/flows/suggest-waste-percent-flow"
import type { ConsumeRow } from "@/lib/waste-writes"

export type { ConsumeRow } from "@/lib/waste-writes"

type T = ReturnType<typeof useTranslations<"Portal.Contractor">>

export type WasteInventoryItem = {
  id: string
  name: string
  unit: string
  unitCode?: string | null
  unitCost?: number | null
  quantity: number
  trackingMode?: "unit" | null
}

type UnitSelection = { unitId: string; barcode: string; wasted: boolean }

function UnitPickerDialog({
  open,
  onOpenChange,
  item,
  warehouseId,
  selected,
  onToggleUnit,
  onToggleWasted,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  item: { id: string; name: string } | null
  warehouseId: string
  selected: UnitSelection[]
  onToggleUnit: (unitId: string, barcode: string) => void
  onToggleWasted: (unitId: string) => void
  t: T
  locale: string
}) {
  const firestore = useFirestore()
  const isRtl = locale === "ar"
  const unitsRef = useMemoFirebase(() => {
    if (!firestore || !item?.id || !open) return null
    return query(collection(firestore, "warehouses", warehouseId, "inventoryItems", item.id, "units"), where("status", "==", "in_stock"))
  }, [firestore, warehouseId, item?.id, open])
  const { data, isLoading } = useCollection(unitsRef)
  const units = (data || []) as { id: string; barcode: string }[]

  const [scan, setScan] = useState("")
  useEffect(() => { if (!open) setScan("") }, [open])

  const query_ = scan.trim().toLowerCase()
  const visible = units.filter((u) => !query_ || u.barcode.toLowerCase().includes(query_))
  const wastedCount = selected.filter((s) => s.wasted).length

  /** A barcode scanner types the code then presses Enter — treat an exact match as a
   *  toggle so the storekeeper never has to touch the mouse. */
  const handleScanSubmit = () => {
    const hit = units.find((u) => u.barcode.toLowerCase() === query_)
    if (!hit) return
    onToggleUnit(hit.id, hit.barcode)
    setScan("")
  }

  const selectAllVisible = () => {
    visible.forEach((u) => {
      if (!selected.some((s) => s.unitId === u.id)) onToggleUnit(u.id, u.barcode)
    })
  }
  const clearAll = () => {
    selected.forEach((s) => onToggleUnit(s.unitId, s.barcode))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("proj_waste_select_units_title", { name: item?.name || "" })}</DialogTitle>
          <DialogDescription>{t("proj_waste_select_units_desc")}</DialogDescription>
        </DialogHeader>

        {units.length > 0 && (
          <div className="space-y-2">
            <div className="relative">
              <Barcode size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
              <Input
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScanSubmit() } }}
                placeholder={t("proj_waste_scan_placeholder")}
                aria-label={t("proj_waste_scan_placeholder")}
                dir="ltr"
                autoFocus
                className="ps-9 font-mono text-sm"
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {t("proj_waste_units_summary", { selected: selected.length, total: units.length })}
                {wastedCount > 0 && (
                  <span className="text-warning font-semibold"> · {t("proj_waste_units_wasted_count", { count: wastedCount })}</span>
                )}
              </span>
              <span className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={selectAllVisible}
                  disabled={visible.every((u) => selected.some((s) => s.unitId === u.id))}>
                  {t("proj_waste_select_all")}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearAll} disabled={selected.length === 0}>
                  {t("proj_waste_clear_all")}
                </Button>
              </span>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" size={22} /></div>
        ) : units.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{t("inv_unit_empty")}</p>
        ) : visible.length === 0 ? (
          <div className="py-6 text-center space-y-2">
            <p className="text-sm text-muted-foreground">{t("inv_no_results")}</p>
            <Button variant="ghost" size="sm" onClick={() => setScan("")}>{t("inv_clear_filters")}</Button>
          </div>
        ) : (
          <div className="border rounded-lg divide-y overflow-hidden max-h-[45vh] overflow-y-auto">
            {visible.map((u) => {
              const sel = selected.find((s) => s.unitId === u.id)
              return (
                <div key={u.id} className={cn("flex items-center justify-between gap-2 px-3 py-2 text-sm", sel && "bg-primary/5")}>
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <Checkbox checked={!!sel} onCheckedChange={() => onToggleUnit(u.id, u.barcode)} />
                    <span className="font-mono truncate">{u.barcode}</span>
                  </label>
                  {/* Rendered for every row, disabled until picked — showing it only on
                      selection made each click shuffle the row's layout. */}
                  <label
                    className={cn(
                      "flex items-center gap-1.5 text-xs shrink-0",
                      sel ? "text-warning cursor-pointer" : "text-muted-foreground/40 cursor-not-allowed"
                    )}
                  >
                    <Checkbox checked={!!sel?.wasted} disabled={!sel} onCheckedChange={() => onToggleWasted(u.id)} />
                    {t("proj_waste_mark_wasted")}
                  </label>
                </div>
              )
            })}
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t("proj_waste_done_btn")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WasteRecordDialog({
  open,
  onOpenChange,
  warehouseId,
  inventoryItems,
  boqItems = [],
  wasteTargetPercent,
  initialTakenQtys,
  initialBoqLinks,
  title,
  description,
  locale,
  t,
  onConsume,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  warehouseId: string
  inventoryItems: WasteInventoryItem[]
  /** BOQ lines the pull can be attributed to. Empty (the default) hides the
   * link column entirely — a supplier, or a contractor outside a project,
   * has nothing to link to. */
  boqItems?: { id: string; descriptionAr: string; descriptionEn: string }[]
  wasteTargetPercent: number
  /** Pre-fills "taken" quantities when the dialog opens — e.g. from AI material suggestions. */
  initialTakenQtys?: Record<string, string>
  /** Pre-fills the BOQ-item link per warehouse item — from AI material suggestions. */
  initialBoqLinks?: Record<string, string>
  /** Override the header copy — the standalone page is not "issuing to a project". */
  title?: string
  description?: string
  locale: string
  t: T
  onConsume: (rows: ConsumeRow[], exceptionReason?: string) => Promise<void>
}) {
  // "Taken" = how much leaves the warehouse for this task (existing behavior).
  // "Used" defaults to match "taken" (0% waste) until the user adjusts it down —
  // so a user who ignores the waste column gets identical behavior to before.
  const [takenQtys, setTakenQtys] = useState<Record<string, string>>({})
  const [usedQtys, setUsedQtys] = useState<Record<string, string>>({})
  const [usedTouched, setUsedTouched] = useState<Set<string>>(new Set())
  const [unitSelections, setUnitSelections] = useState<Record<string, UnitSelection[]>>({})
  const [boqLinks, setBoqLinks] = useState<Record<string, string>>({})
  const [pickerItemId, setPickerItemId] = useState<string | null>(null)
  const [aiSuggestingId, setAiSuggestingId] = useState<string | null>(null)
  // Per-row waste categorisation — a batch-level "why" can't tell you that the
  // marble broke in transit while the rebar was ordinary offcut.
  const [reasonCodes, setReasonCodes] = useState<Record<string, string>>({})
  const [reasonNotes, setReasonNotes] = useState<Record<string, string>>({})
  const [exceptionReason, setExceptionReason] = useState("")
  const [itemSearch, setItemSearch] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const { toast } = useToast()
  const isRtl = locale === "ar"
  const hasBoq = boqItems.length > 0

  const reset = () => {
    setTakenQtys({})
    setUsedQtys({})
    setUsedTouched(new Set())
    setUnitSelections({})
    setBoqLinks({})
    setPickerItemId(null)
    setReasonCodes({})
    setReasonNotes({})
    setExceptionReason("")
    setItemSearch("")
  }

  // Seed from AI suggestions (or any other caller-provided defaults) each time
  // the dialog opens — the user still reviews and can "add or reduce" every
  // value here, this only saves them re-typing the AI's starting point.
  useEffect(() => {
    if (open && initialTakenQtys && Object.keys(initialTakenQtys).length > 0) {
      setTakenQtys(initialTakenQtys)
      setUsedQtys(initialTakenQtys)
    }
    if (open && initialBoqLinks && Object.keys(initialBoqLinks).length > 0) {
      setBoqLinks(initialBoqLinks)
    }
  }, [open, initialTakenQtys, initialBoqLinks])

  const setBoqLink = (itemId: string, boqItemId: string) => {
    setBoqLinks((prev) => {
      if (!boqItemId) {
        const next = { ...prev }
        delete next[itemId]
        return next
      }
      return { ...prev, [itemId]: boqItemId }
    })
  }

  const handleTakenChange = (itemId: string, value: string) => {
    setTakenQtys((prev) => ({ ...prev, [itemId]: value }))
    if (!usedTouched.has(itemId)) {
      setUsedQtys((prev) => ({ ...prev, [itemId]: value }))
    }
  }
  const handleUsedChange = (itemId: string, value: string) => {
    setUsedQtys((prev) => ({ ...prev, [itemId]: value }))
    setUsedTouched((prev) => new Set(prev).add(itemId))
  }
  const toggleUnit = (itemId: string, unitId: string, barcode: string) => {
    setUnitSelections((prev) => {
      const cur = prev[itemId] || []
      const exists = cur.some((u) => u.unitId === unitId)
      const next = exists ? cur.filter((u) => u.unitId !== unitId) : [...cur, { unitId, barcode, wasted: false }]
      return { ...prev, [itemId]: next }
    })
  }
  const toggleWasted = (itemId: string, unitId: string) => {
    setUnitSelections((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] || []).map((u) => (u.unitId === unitId ? { ...u, wasted: !u.wasted } : u)),
    }))
  }

  const handleAiSuggest = async (item: { id: string; name: string; unit: string }) => {
    const taken = Number(takenQtys[item.id]) || 0
    if (taken <= 0) return
    setAiSuggestingId(item.id)
    try {
      const result = await suggestWastePercent({ itemName: item.name, unit: item.unit })
      const used = Math.max(0, taken * (1 - result.suggestedWastePercent / 100))
      setUsedQtys((prev) => ({ ...prev, [item.id]: used.toFixed(2) }))
      setUsedTouched((prev) => new Set(prev).add(item.id))
      toast({ title: t("proj_waste_ai_suggested", { percent: result.suggestedWastePercent }), description: result.reasoning })
    } catch {
      toast({ title: t("proj_waste_ai_error"), variant: "destructive" })
    } finally {
      setAiSuggestingId(null)
    }
  }

  const rows: ConsumeRow[] = inventoryItems
    .filter((item) => item.trackingMode === "unit" ? (unitSelections[item.id]?.length || 0) > 0 : Number(takenQtys[item.id]) > 0)
    .map((item) => {
      const common = {
        inventoryItemId: item.id,
        itemName: item.name,
        unit: item.unit,
        unitCode: item.unitCode ?? null,
        unitCost: item.unitCost ?? null,
        reasonCode: reasonCodes[item.id] || null,
        reasonNote: reasonNotes[item.id]?.trim() || null,
        boqItemId: boqLinks[item.id] || null,
      }
      if (item.trackingMode === "unit") {
        const sel = unitSelections[item.id] || []
        const wasted = sel.filter((u) => u.wasted)
        return {
          ...common,
          quantityTaken: sel.length,
          quantityUsed: sel.length - wasted.length,
          unitIds: sel.map((u) => u.unitId),
          unitBarcodes: sel.map((u) => u.barcode),
          wastedUnitBarcodes: wasted.map((u) => u.barcode),
        }
      }
      const taken = Number(takenQtys[item.id]) || 0
      const usedRaw = usedQtys[item.id]
      const used = usedRaw !== undefined && usedRaw !== "" ? Math.min(taken, Math.max(0, Number(usedRaw))) : taken
      return { ...common, quantityTaken: taken, quantityUsed: used }
    })
  const totalTaken = rows.reduce((s, r) => s + r.quantityTaken, 0)
  const totalUsed = rows.reduce((s, r) => s + r.quantityUsed, 0)
  const overallWastePercent = totalTaken > 0 ? parseFloat((((totalTaken - totalUsed) / totalTaken) * 100).toFixed(1)) : 0
  const overTarget = rows.length > 0 && overallWastePercent > wasteTargetPercent
  const wastingRows = rows.filter((r) => r.quantityTaken - r.quantityUsed > 0)
  const missingReasons = overTarget && wastingRows.some((r) => !reasonCodes[r.inventoryItemId])
  // "Other" is not a reason. Once picked, the row needs the detail that makes
  // the ledger answer "why" — otherwise the category is a shrug in a dropdown.
  const missingOtherNotes = wastingRows.some(
    (r) => reasonCodes[r.inventoryItemId] === "other" && !(reasonNotes[r.inventoryItemId] || "").trim()
  )
  // A row asking for more than the warehouse holds must block the submit, not get
  // silently clamped on the way to Firestore.
  const overStockRows = rows.filter((r) => {
    const src = inventoryItems.find((i) => i.id === r.inventoryItemId)
    return !!src && r.quantityTaken > src.quantity
  })
  const itemQuery = itemSearch.trim().toLowerCase()
  const visibleItems = inventoryItems.filter(
    (i) => !itemQuery || i.name.toLowerCase().includes(itemQuery)
  )
  // Value the waste only from rows that actually carry a cost — a total that silently
  // treats "no price on file" as zero is worse than no total at all.
  const pricedWasting = wastingRows.filter((r) => r.unitCost != null)
  const wasteValue = pricedWasting.reduce((s, r) => s + (r.quantityTaken - r.quantityUsed) * (r.unitCost || 0), 0)
  const canSubmit = !isSaving && !missingReasons && !missingOtherNotes && overStockRows.length === 0
    && !(overTarget && exceptionReason.trim().length < 8)

  const handleSubmit = async () => {
    if (rows.length === 0) {
      toast({ title: t("proj_boq_consume_empty"), variant: "destructive" })
      return
    }
    if (!canSubmit) return
    setIsSaving(true)
    try {
      await onConsume(rows, overTarget ? exceptionReason.trim() : undefined)
      reset()
      onOpenChange(false)
    } catch (err) {
      // The batch cap is a real, actionable condition — don't bury it under the
      // generic failure message, the user needs to know to split the issue in two.
      const isTooLarge = err instanceof Error && err.message === "too_many_writes"
      toast({
        title: isTooLarge ? t("proj_boq_consume_too_large") : t("proj_boq_consume_error"),
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const pickerItem = pickerItemId ? inventoryItems.find((i) => i.id === pickerItemId) || null : null
  const columnCount = hasBoq ? 6 : 5
  const th = cn("px-3 py-2 font-medium text-muted-foreground text-xs whitespace-nowrap", isRtl ? "text-right" : "text-left")

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!isSaving) { onOpenChange(v); if (!v) reset() } }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Warehouse size={18} />
            {title ?? t("proj_boq_consume_title")}
          </DialogTitle>
          <DialogDescription>{description ?? t("proj_boq_consume_desc")}</DialogDescription>
          <div className="flex">
            <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              <Scissors size={10} />
              {t("proj_waste_target_label")} <span dir="ltr">{wasteTargetPercent}%</span>
            </span>
          </div>
        </DialogHeader>
        {/* Search only earns its space once the list is long enough to scroll. */}
        {inventoryItems.length > 6 && (
          <div className="relative">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
            <Input
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder={t("proj_waste_item_search_placeholder")}
              aria-label={t("proj_waste_item_search_placeholder")}
              className="ps-9 h-9 text-sm"
            />
          </div>
        )}

        <div className="border rounded-lg overflow-x-auto">
          <table className={cn("w-full text-sm", hasBoq ? "min-w-[660px]" : "min-w-[520px]")}>
            <thead>
              <tr className="bg-muted border-b">
                <th className={th}>{t("goods_manual_item_name")}</th>
                <th className={th}>{t("proj_boq_consume_available")}</th>
                <th className={th}>{t("proj_waste_taken_qty")}</th>
                <th className={th}>{t("proj_waste_used_qty")}</th>
                <th className={th}>{t("proj_waste_percent_col")}</th>
                {hasBoq && <th className={th}>{t("proj_waste_boq_item_col")}</th>}
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="px-3 py-8 text-center">
                    <p className="text-sm text-muted-foreground">{t("inv_no_results")}</p>
                    {itemSearch && (
                      <Button variant="ghost" size="sm" className="mt-1" onClick={() => setItemSearch("")}>
                        {t("inv_clear_filters")}
                      </Button>
                    )}
                  </td>
                </tr>
              )}
              {visibleItems.map((item) => {
                const isUnitTracked = item.trackingMode === "unit"
                const unitSel = unitSelections[item.id] || []
                const taken = isUnitTracked ? unitSel.length : (Number(takenQtys[item.id]) || 0)
                const usedRaw = usedQtys[item.id]
                const used = isUnitTracked
                  ? unitSel.length - unitSel.filter((u) => u.wasted).length
                  : (usedRaw !== undefined && usedRaw !== "" ? Math.min(taken, Math.max(0, Number(usedRaw))) : taken)
                const rowWaste = taken > 0 ? Math.max(0, ((taken - used) / taken) * 100) : 0
                return (
                  <tr key={item.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2 font-medium">
                      {item.name}
                      {isUnitTracked && (
                        <Badge variant="outline" className="ms-2 text-primary border-primary/20 text-[10px] py-0 gap-1">
                          <Barcode size={9} />
                          {t("inv_item_unit_tracking_badge")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {item.quantity} {item.unit}
                    </td>
                    {isUnitTracked ? (
                      <td className="px-2 py-1" colSpan={2}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1.5"
                          onClick={() => setPickerItemId(item.id)}
                          disabled={item.quantity === 0}
                        >
                          <Barcode size={12} />
                          {t("proj_waste_select_units_btn", { count: taken })}
                        </Button>
                      </td>
                    ) : (
                      <>
                        <td className="px-2 py-1.5 align-top">
                          <Input
                            type="number"
                            min={0}
                            max={item.quantity}
                            value={takenQtys[item.id] || ""}
                            onChange={(e) => handleTakenChange(item.id, e.target.value)}
                            placeholder="0"
                            dir="ltr"
                            aria-invalid={taken > item.quantity}
                            className={cn("h-8 text-sm tabular-nums", taken > item.quantity && "border-destructive focus-visible:ring-destructive")}
                          />
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={0}
                              max={taken}
                              value={usedQtys[item.id] || ""}
                              onChange={(e) => handleUsedChange(item.id, e.target.value)}
                              disabled={taken <= 0}
                              placeholder="0"
                              dir="ltr"
                              className="h-8 text-sm tabular-nums"
                            />
                            <button
                              type="button"
                              onClick={() => handleAiSuggest(item)}
                              disabled={taken <= 0 || aiSuggestingId === item.id}
                              title={t("proj_waste_ai_suggest_btn")}
                              aria-label={t("proj_waste_ai_suggest_btn")}
                              className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-primary hover:bg-primary/5 disabled:opacity-30 transition-colors"
                            >
                              {aiSuggestingId === item.id ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                    <td className={cn("px-3 py-2 tabular-nums font-semibold text-xs", rowWaste > wasteTargetPercent ? "text-warning" : "text-muted-foreground")} dir="ltr">
                      {taken > 0 ? `${rowWaste.toFixed(1)}%` : "—"}
                    </td>
                    {hasBoq && (
                      <td className="px-2 py-1">
                        <SearchableSelect
                          value={boqLinks[item.id] || "__none__"}
                          onChange={(v) => setBoqLink(item.id, v === "__none__" ? "" : v)}
                          options={[
                            { value: "__none__", label: t("proj_waste_boq_item_none") },
                            ...boqItems
                              .filter((b) => b.descriptionAr || b.descriptionEn)
                              .map((b) => ({ value: b.id, label: b.descriptionAr || b.descriptionEn })),
                          ]}
                          placeholder={t("proj_waste_boq_item_placeholder")}
                          searchPlaceholder={t("proj_waste_boq_item_placeholder")}
                          noResultsText={t("proj_boq_empty")}
                          disabled={taken <= 0}
                          size="sm"
                        />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* The `max` attribute doesn't stop typing, so an over-stock figure would reach
            Firestore and fail there. Named here rather than as a 10px string wedged
            under the input, which the row height couldn't hold. */}
        {overStockRows.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5">
            <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
            <div className="text-xs text-destructive space-y-0.5">
              <p className="font-bold">{t("proj_waste_over_stock_title")}</p>
              {overStockRows.map((r) => {
                const src = inventoryItems.find((i) => i.id === r.inventoryItemId)
                return (
                  <p key={r.inventoryItemId}>
                    {r.itemName} — {t("proj_waste_over_stock", { available: src?.quantity ?? 0 })}
                  </p>
                )
              })}
            </div>
          </div>
        )}

        {/* Tells the user why the confirm button is inert, instead of leaving them to
            press it and get a toast. */}
        {rows.length === 0 && visibleItems.length > 0 && (
          <p className="px-3 py-2.5 rounded-xl border border-dashed text-xs text-muted-foreground text-center">
            {t("proj_waste_nothing_selected")}
          </p>
        )}

        {rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-muted rounded-xl text-sm">
            <span className="text-muted-foreground">
              {t("proj_waste_total_label")}
              <span className="ms-1.5 text-xs">({t("proj_waste_rows_count", { count: rows.length })})</span>
            </span>
            {/* dir="ltr" belongs on the numbers only — wrapping the Arabic label in it
                detaches the "%" from its digits under the bidi algorithm. */}
            <span className="flex items-center gap-2 flex-wrap">
              {wasteValue > 0 && (
                <span className="text-xs text-muted-foreground">
                  <span dir="ltr">{wasteValue.toFixed(2)}</span> {t("offers_currency_sar")}
                  {pricedWasting.length < wastingRows.length && ` (${t("proj_waste_value_partial")})`}
                </span>
              )}
              <span className={cn("font-bold", overTarget ? "text-warning" : "text-success")}>
                <span dir="ltr">{overallWastePercent}%</span>{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  ({t("proj_waste_target_label")} <span dir="ltr">{wasteTargetPercent}%</span>)
                </span>
              </span>
            </span>
          </div>
        )}

        {/* Categorise each wasting row. Optional under target (don't tax the common
            case), required once the batch goes over it — that's the point at which
            "where is this waste coming from" stops being a nice-to-have. */}
        {wastingRows.length > 0 && (
          <div className="space-y-2.5 rounded-xl border p-3.5">
            <div className="flex items-center gap-1.5">
              <Scissors size={13} className="text-muted-foreground shrink-0" />
              <p className="text-sm font-bold text-foreground">{t("proj_waste_reasons_title")}</p>
              <span className="text-xs text-muted-foreground">
                {overTarget ? t("proj_waste_reasons_required") : t("proj_waste_reasons_optional")}
              </span>
            </div>
            {wastingRows.map((r) => {
              const code = reasonCodes[r.inventoryItemId] || ""
              const isOther = code === "other"
              const note = reasonNotes[r.inventoryItemId] || ""
              return (
                <div key={r.inventoryItemId} className="space-y-1.5">
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.itemName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("proj_waste_reason_row_hint", {
                          qty: parseFloat((r.quantityTaken - r.quantityUsed).toFixed(2)),
                          unit: r.unit,
                        })}
                      </p>
                    </div>
                    <Select
                      value={code}
                      onValueChange={(v) => setReasonCodes((prev) => ({ ...prev, [r.inventoryItemId]: v }))}
                    >
                      <SelectTrigger
                        className={cn(
                          "h-9 sm:w-56",
                          overTarget && !code && "border-destructive"
                        )}
                        aria-label={t("proj_waste_reasons_title")}
                      >
                        <SelectValue placeholder={t("proj_waste_reason_select_placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {WASTE_REASON_CODES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {t(wasteReasonMessageKey(c) as Parameters<typeof t>[0])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* "Other" opens a line for what it actually was. Saved as the row's
                      note, so the ledger and the export carry it. */}
                  {isOther && (
                    <Input
                      value={note}
                      onChange={(e) => setReasonNotes((prev) => ({ ...prev, [r.inventoryItemId]: e.target.value }))}
                      placeholder={t("proj_waste_reason_note_placeholder")}
                      aria-label={t("proj_waste_reason_note_placeholder")}
                      aria-invalid={!note.trim()}
                      className={cn("h-9 text-sm", !note.trim() && "border-destructive")}
                      autoFocus
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {overTarget && (
          <div className="space-y-2 rounded-xl border border-warning/20 bg-warning/10 p-3.5">
            <p className="text-sm font-bold text-warning flex items-center gap-1.5">
              <AlertTriangle size={14} className="shrink-0" />
              {t("proj_waste_warning_title")}
            </p>
            <p className="text-xs text-warning/90">
              {t("proj_waste_warning_gap", {
                percent: overallWastePercent,
                target: wasteTargetPercent,
                gap: parseFloat((overallWastePercent - wasteTargetPercent).toFixed(1)),
              })}
            </p>
            <p className="text-xs text-muted-foreground">{t("proj_waste_warning_desc")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="waste-reason" className="text-xs font-bold">{t("proj_waste_reason_label")}</Label>
              <Textarea
                id="waste-reason"
                rows={2}
                value={exceptionReason}
                onChange={(e) => setExceptionReason(e.target.value)}
                placeholder={t("proj_waste_reason_placeholder")}
                className="text-sm resize-none bg-background"
                aria-describedby="waste-reason-hint"
              />
              {/* Shown while the reason is too short INCLUDING when empty — otherwise the
                  confirm button sits disabled with nothing explaining why. */}
              {exceptionReason.trim().length < 8 && (
                <p id="waste-reason-hint" className="text-[11px] text-destructive">{t("proj_waste_reason_required")}</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || rows.length === 0}
            className={cn("gap-2", overTarget && "bg-warning text-warning-foreground hover:bg-warning/90")}
          >
            {isSaving && <Loader2 size={14} className="animate-spin" />}
            {overTarget ? t("proj_waste_confirm_anyway") : t("proj_boq_consume_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {pickerItem && (
      <UnitPickerDialog
        open={!!pickerItemId}
        onOpenChange={(v) => { if (!v) setPickerItemId(null) }}
        item={pickerItem}
        warehouseId={warehouseId}
        selected={unitSelections[pickerItem.id] || []}
        onToggleUnit={(unitId, barcode) => toggleUnit(pickerItem.id, unitId, barcode)}
        onToggleWasted={(unitId) => toggleWasted(pickerItem.id, unitId)}
        t={t}
        locale={locale}
      />
    )}
    </>
  )
}
