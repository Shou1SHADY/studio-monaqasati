"use client"

/**
 * Waste ledger — the audit view behind the project's «نسبة الهدر» headline.
 *
 * The percentage on its own is a number nobody can check. This lists the entries
 * it is computed from: what left the warehouse, how much of it was actually used,
 * who recorded it, why, and what the difference cost.
 *
 * Corrections are appends, not edits. `wasteRecords` is append-only in
 * firestore.rules, and that is the right shape for an accounting trail — reversing
 * an entry writes a counter-entry that points back at it and restores the stock in
 * the same batch, leaving both halves visible.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { collection, doc, increment, serverTimestamp, writeBatch } from "firebase/firestore"
import { useFirestore, useUser } from "@/firebase"
import { useProjectWasteStats, type WasteRecord } from "@/hooks/useProjectWasteStats"
import { isKnownWasteReason, wasteReasonMessageKey } from "@/lib/waste-reasons"
import { logFinanceAudit } from "@/lib/finance-audit"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { Scissors, Loader2, Download, Undo2, ChevronDown, Barcode, AlertTriangle } from "lucide-react"

type T = ReturnType<typeof useTranslations<"Portal.Contractor">>

function recordDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate()
  }
  return null
}

export function WasteLedger({
  projectId,
  projectName,
  wasteTargetPercent,
  canManage,
  t,
  locale,
}: {
  projectId: string
  projectName: string
  wasteTargetPercent: number
  canManage: boolean
  t: T
  locale: string
}) {
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const stats = useProjectWasteStats(projectId)
  const [expanded, setExpanded] = useState(false)
  const [reverseTarget, setReverseTarget] = useState<WasteRecord | null>(null)
  const [reverseReason, setReverseReason] = useState("")
  const [isReversing, setIsReversing] = useState(false)

  const isRtl = locale === "ar"
  const intl = locale === "ar" ? "ar-SA" : "en-US"
  const nf = (n: number) => n.toLocaleString(intl, { maximumFractionDigits: 2 })

  const reasonLabel = (code: string) =>
    isKnownWasteReason(code)
      ? t(wasteReasonMessageKey(code) as Parameters<typeof t>[0])
      : t("waste_reason_unspecified")

  const handleExport = () => {
    const headers = [
      t("ledger_col_date"), t("ledger_col_item"), t("proj_waste_taken_qty"),
      t("proj_waste_used_qty"), t("ledger_col_wasted"), t("inv_item_unit"),
      t("proj_waste_percent_col"), t("ledger_col_value"), t("ledger_col_reason"),
      t("ledger_col_note"), t("ledger_col_by"), t("ledger_col_status"),
    ]
    const rows = stats.records.map((r) => {
      const d = recordDate(r.createdAt)
      const wasted = Math.max(0, (r.quantityTaken || 0) - (r.quantityUsed || 0))
      const status = r.type === "reversal"
        ? t("ledger_status_reversal")
        : stats.reversedIds.has(r.id) ? t("ledger_status_reversed") : t("ledger_status_active")
      return [
        d ? d.toISOString().slice(0, 10) : "",
        r.itemName, r.quantityTaken, r.quantityUsed, wasted, r.unit,
        r.wastePercent, r.wasteValue ?? "",
        r.reasonCode ? reasonLabel(r.reasonCode) : "",
        r.reasonNote || r.exceptionReason || "",
        r.recordedByUserName, status,
      ]
    })
    const esc = (v: unknown) => {
      const s = String(v ?? "")
      return /[",\n]/.test(s) ? `"${s.split('"').join('""')}"` : s
    }
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n")
    // The BOM is what makes Excel read the Arabic columns as UTF-8 rather than mojibake.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `waste-${projectName || projectId}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleReverse = async () => {
    if (!firestore || !user || !reverseTarget) return
    const rec = reverseTarget
    if (!rec.inventoryItemId || !rec.warehouseId) {
      toast({ title: t("ledger_reverse_legacy_error"), variant: "destructive" })
      return
    }
    setIsReversing(true)
    try {
      const actorName = user.displayName || user.email || t("proj_team_member_fallback")
      const batch = writeBatch(firestore)

      // Put the stock back exactly as it was taken.
      batch.update(
        doc(firestore, "warehouses", rec.warehouseId, "inventoryItems", rec.inventoryItemId),
        { quantity: increment(rec.quantityTaken), updatedAt: serverTimestamp() }
      )
      for (const unitId of rec.unitIds || []) {
        batch.update(
          doc(firestore, "warehouses", rec.warehouseId, "inventoryItems", rec.inventoryItemId, "units", unitId),
          {
            status: "in_stock",
            consumedAt: null,
            consumedProjectId: null,
            consumedProjectName: null,
            updatedAt: serverTimestamp(),
          }
        )
      }
      // The counter-entry. Quantities are negated so any future consumer that sums
      // the raw collection still arrives at the right net figure.
      batch.set(doc(collection(firestore, "projects", projectId, "wasteRecords")), {
        type: "reversal",
        reversesRecordId: rec.id,
        batchId: rec.batchId ?? null,
        inventoryItemId: rec.inventoryItemId,
        warehouseId: rec.warehouseId,
        unitIds: rec.unitIds ?? null,
        boqItemId: rec.boqItemId ?? null,
        itemName: rec.itemName,
        unit: rec.unit,
        unitCode: rec.unitCode ?? null,
        quantityTaken: -rec.quantityTaken,
        quantityUsed: -rec.quantityUsed,
        wastePercent: 0,
        unitCost: rec.unitCost ?? null,
        wasteValue: rec.wasteValue != null ? -rec.wasteValue : null,
        reasonCode: null,
        reasonNote: reverseReason.trim(),
        exceptionReason: null,
        unitBarcodes: rec.unitBarcodes ?? null,
        wastedUnitBarcodes: null,
        recordedByUserId: user.uid,
        recordedByUserName: actorName,
        createdAt: serverTimestamp(),
      })
      await batch.commit()

      logFinanceAudit(firestore, projectId, {
        action: "waste_record_reversed",
        actorId: user.uid,
        actorName,
        targetType: "wasteConsumption",
        targetId: rec.id,
        amount: Math.max(0, rec.quantityTaken - rec.quantityUsed),
        reason: reverseReason.trim(),
        meta: { itemName: rec.itemName, unit: rec.unit, quantityRestored: rec.quantityTaken },
      })

      toast({ title: t("ledger_reverse_success") })
      setReverseTarget(null)
      setReverseReason("")
    } catch (err) {
      console.error(err)
      toast({ title: t("ledger_reverse_error"), variant: "destructive" })
    } finally {
      setIsReversing(false)
    }
  }

  if (stats.isLoading || stats.records.length === 0) return null

  const over = stats.wastePercent > wasteTargetPercent
  const visible = expanded ? stats.records : stats.records.slice(0, 5)

  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Headline: the number, and what it costs */}
      <div className={cn(
        "flex items-center justify-between gap-4 flex-wrap px-4 py-3 border-b",
        over ? "bg-warning/10" : "bg-muted"
      )}>
        <div className="flex items-center gap-2">
          <Scissors size={16} className={over ? "text-warning" : "text-success"} />
          <span className="text-sm font-bold text-foreground">{t("ledger_title")}</span>
          <Badge variant="outline" className="text-[10px] font-semibold">
            {t("ledger_entry_count", { count: stats.activeRecords.length })}
          </Badge>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
          <span>{t("proj_waste_taken_label")} <b className="text-foreground" dir="ltr">{nf(stats.totalTaken)}</b></span>
          <span>{t("proj_waste_used_label")} <b className="text-foreground" dir="ltr">{nf(stats.totalUsed)}</b></span>
          {stats.totalWasteValue > 0 && (
            <span className="flex items-center gap-1">
              <b className="text-foreground" dir="ltr">{nf(stats.totalWasteValue)}</b>
              {t("offers_currency_sar")}
              {stats.valuedRecordCount < stats.activeRecords.length && (
                <span className="text-[10px]">({t("proj_waste_value_partial")})</span>
              )}
            </span>
          )}
          <span className={cn("font-bold", over ? "text-warning" : "text-success")}>
            <span dir="ltr">{stats.wastePercent}%</span>{" "}
            <span className="font-normal">({t("proj_waste_target_label")} <span dir="ltr">{wasteTargetPercent}%</span>)</span>
          </span>
          <Button variant="ghost" size="sm" onClick={handleExport} className="h-7 gap-1.5 text-xs">
            <Download size={12} />
            {t("ledger_export_csv")}
          </Button>
        </div>
      </div>

      {/* Where the waste comes from */}
      {stats.byReason.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b bg-background">
          <span className="text-xs text-muted-foreground">{t("ledger_by_reason_label")}</span>
          {stats.byReason.map((r) => (
            <Badge key={r.code} variant="outline" className="gap-1.5 font-normal">
              <span className="font-semibold">{reasonLabel(r.code)}</span>
              <span dir="ltr" className="text-muted-foreground">{nf(r.quantity)}</span>
            </Badge>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b">
            <tr>
              <th className={cn("py-2.5 px-3 font-bold text-muted-foreground text-xs", isRtl ? "text-right" : "text-left")}>{t("ledger_col_date")}</th>
              <th className={cn("py-2.5 px-3 font-bold text-muted-foreground text-xs", isRtl ? "text-right" : "text-left")}>{t("ledger_col_item")}</th>
              <th className="py-2.5 px-3 font-bold text-muted-foreground text-xs text-center">{t("proj_waste_taken_qty")}</th>
              <th className="py-2.5 px-3 font-bold text-muted-foreground text-xs text-center">{t("proj_waste_used_qty")}</th>
              <th className="py-2.5 px-3 font-bold text-muted-foreground text-xs text-center">{t("proj_waste_percent_col")}</th>
              <th className="py-2.5 px-3 font-bold text-muted-foreground text-xs text-center">{t("ledger_col_value")}</th>
              <th className={cn("py-2.5 px-3 font-bold text-muted-foreground text-xs", isRtl ? "text-right" : "text-left")}>{t("ledger_col_reason")}</th>
              <th className={cn("py-2.5 px-3 font-bold text-muted-foreground text-xs", isRtl ? "text-right" : "text-left")}>{t("ledger_col_by")}</th>
              {canManage && <th className="py-2.5 px-3 w-10" />}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const d = recordDate(r.createdAt)
              const isReversal = r.type === "reversal"
              const isReversed = stats.reversedIds.has(r.id)
              const inactive = isReversal || isReversed
              return (
                <tr key={r.id} className={cn("border-b last:border-0", inactive && "opacity-60")}>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap" dir="ltr">
                    {d ? d.toLocaleDateString(intl, { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={cn("font-medium", isReversed && "line-through")}>{r.itemName}</span>
                    {isReversal && (
                      <Badge variant="outline" className="ms-2 text-[10px] py-0 gap-1 text-muted-foreground">
                        <Undo2 size={9} />
                        {t("ledger_status_reversal")}
                      </Badge>
                    )}
                    {isReversed && (
                      <Badge variant="outline" className="ms-2 text-[10px] py-0 text-muted-foreground">
                        {t("ledger_status_reversed")}
                      </Badge>
                    )}
                    {!!r.unitBarcodes?.length && (
                      <span className="ms-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Barcode size={9} />
                        <span dir="ltr">{r.unitBarcodes.length}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center tabular-nums" dir="ltr">{nf(r.quantityTaken)}</td>
                  <td className="py-2.5 px-3 text-center tabular-nums" dir="ltr">{nf(r.quantityUsed)}</td>
                  <td className={cn(
                    "py-2.5 px-3 text-center tabular-nums font-semibold text-xs",
                    !inactive && r.wastePercent > wasteTargetPercent ? "text-warning" : "text-muted-foreground"
                  )} dir="ltr">
                    {isReversal ? "—" : `${r.wastePercent}%`}
                  </td>
                  <td className="py-2.5 px-3 text-center tabular-nums text-xs text-muted-foreground" dir="ltr">
                    {r.wasteValue != null ? nf(r.wasteValue) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-xs">
                    {r.reasonCode ? (
                      <span className="text-foreground">{reasonLabel(r.reasonCode)}</span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                    {(r.reasonNote || r.exceptionReason) && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2" dir="auto">
                        {r.reasonNote || r.exceptionReason}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground" dir="auto">{r.recordedByUserName}</td>
                  {canManage && (
                    <td className="py-2.5 px-3">
                      {!inactive && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setReverseTarget(r)}
                          aria-label={t("ledger_reverse_btn")}
                          title={t("ledger_reverse_btn")}
                        >
                          <Undo2 size={13} />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {stats.records.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50 flex items-center justify-center gap-1.5 border-t focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
        >
          {expanded ? t("ledger_show_less") : t("ledger_show_all", { count: stats.records.length })}
          <ChevronDown size={13} className={cn("transition-transform", expanded && "rotate-180")} />
        </button>
      )}

      <Dialog open={!!reverseTarget} onOpenChange={(v) => { if (!v && !isReversing) { setReverseTarget(null); setReverseReason("") } }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 size={17} />
              {t("ledger_reverse_title")}
            </DialogTitle>
            <DialogDescription>{t("ledger_reverse_desc")}</DialogDescription>
          </DialogHeader>
          {reverseTarget && (
            <div className="space-y-3">
              <div className="rounded-xl border bg-muted px-3.5 py-3 text-sm space-y-1">
                <p className="font-semibold">{reverseTarget.itemName}</p>
                <p className="text-xs text-muted-foreground">
                  {t("ledger_reverse_restores", {
                    qty: nf(reverseTarget.quantityTaken),
                    unit: reverseTarget.unit,
                  })}
                </p>
              </div>
              {!reverseTarget.inventoryItemId && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  {t("ledger_reverse_legacy_error")}
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="reverse-reason" className="text-xs font-bold">{t("ledger_reverse_reason_label")}</Label>
                <Textarea
                  id="reverse-reason"
                  rows={2}
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder={t("ledger_reverse_reason_placeholder")}
                  className="text-sm resize-none"
                  aria-describedby="reverse-reason-hint"
                />
                {reverseReason.trim().length < 8 && (
                  <p id="reverse-reason-hint" className="text-[11px] text-destructive">{t("proj_waste_reason_required")}</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseTarget(null)} disabled={isReversing}>
              {t("cancel")}
            </Button>
            <Button
              onClick={handleReverse}
              disabled={isReversing || reverseReason.trim().length < 8 || !reverseTarget?.inventoryItemId}
              className="gap-2"
            >
              {isReversing && <Loader2 size={14} className="animate-spin" />}
              {t("ledger_reverse_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
