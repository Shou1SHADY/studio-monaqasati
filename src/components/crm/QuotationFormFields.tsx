"use client"

import { useId } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Boxes, Plus, Trash2, Factory, Banknote, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { QUOTATION_PHASES, formatSar } from "@/lib/crm"
import type { QuotationForm } from "@/hooks/useQuotationForm"

// The quotation form's field groups, shared by the quick dialog and the Sales
// quotation builder page so both edit a quotation exactly the same way.

/** Before / after manufacturing, with the hint and the linked work order. */
export function QuotationPhaseControl({ form }: { form: QuotationForm }) {
  const t = useTranslations("Portal.Shared")
  const { phase, setPhase, isSaving, workOrderNumber } = form
  return (
    <div className="space-y-1.5">
      <Label>{t("crm_quote_phase")}</Label>
      <div role="group" aria-label={t("crm_quote_phase")} className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1">
        {QUOTATION_PHASES.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={phase === p}
            disabled={isSaving}
            onClick={() => setPhase(p)}
            className={cn(
              "h-9 rounded-md text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              phase === p ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-white"
            )}
          >
            {t(`crm_quote_phase_${p}`)}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t(phase === "post_manufacturing" ? "crm_quote_phase_hint_post" : "crm_quote_phase_hint_pre")}
      </p>
      {workOrderNumber != null && (
        <p className="text-[11px] font-semibold text-cta flex items-center gap-1">
          <Factory size={11} aria-hidden="true" />
          {t("crm_quote_work_order_ref", { number: workOrderNumber })}
        </p>
      )}
    </div>
  )
}

/** The line template: inventory / price list / free lines, with stock hints. */
export function QuotationItemsEditor({ form }: { form: QuotationForm }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const nameListId = useId()
  const {
    itemRows, stockOptions, priceItems, stockPick, pricePick, isSaving, hasItems, itemsTotal,
    setRowName, updateRow, removeRow, addEmptyRow, addFromStock, addFromPriceList,
  } = form
  return (
    <div className="rounded-xl border bg-muted/20 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="flex items-center gap-1.5">
          <Boxes size={14} className="text-cta" />
          {t("crm_quote_items_title")}
        </Label>
        <p className="text-[11px] text-muted-foreground">{t("crm_quote_items_hint")}</p>
      </div>
      {itemRows.map((row, i) => {
        const match = stockOptions.find((o) => o.name.toLowerCase() === row.name.trim().toLowerCase())
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                placeholder={t("crm_quote_item_name")}
                aria-label={t("crm_quote_item_name")}
                value={row.name}
                list={nameListId}
                onChange={(e) => setRowName(i, e.target.value)}
                className="flex-1 h-9 min-w-0"
                disabled={isSaving}
              />
              <Input
                placeholder={t("mfg_item_qty")} aria-label={t("mfg_item_qty")} dir="ltr" inputMode="decimal"
                value={row.quantity}
                onChange={(e) => updateRow(i, { quantity: e.target.value })}
                className="w-20 h-9"
                disabled={isSaving}
              />
              <Input
                placeholder={t("mfg_item_unit")} aria-label={t("mfg_item_unit")}
                value={row.unit}
                onChange={(e) => updateRow(i, { unit: e.target.value })}
                className="w-20 h-9"
                disabled={isSaving}
              />
              <Input
                placeholder={t("crm_quote_item_price")} aria-label={t("crm_quote_item_price")} dir="ltr" inputMode="decimal"
                value={row.unitPrice}
                onChange={(e) => updateRow(i, { unitPrice: e.target.value })}
                className="w-24 h-9"
                disabled={isSaving}
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={t("mfg_remove_item")}
                className="h-8 w-8 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={isSaving}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {row.name.trim() && (
              <p className={cn("text-[11px] ps-1", match ? "text-success" : "text-muted-foreground")}>
                {match
                  ? t("crm_quote_item_in_stock", { qty: match.available, unit: match.unit })
                  : t("crm_quote_item_to_manufacture")}
              </p>
            )}
          </div>
        )
      })}
      {/* Name suggestions: everything in stock plus the price list, so a
          free-typed item can still be picked instead of retyped. */}
      <datalist id={nameListId}>
        {[...new Set([...stockOptions.map((o) => o.name), ...priceItems.map((p) => p.name)])].map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div className="flex items-center gap-2 flex-wrap">
        {stockOptions.length > 0 && (
          <Select value={stockPick} onValueChange={(v) => addFromStock(Number(v))} disabled={isSaving}>
            <SelectTrigger className="h-9 w-56 text-xs">
              <SelectValue placeholder={t("crm_quote_add_from_inventory")} />
            </SelectTrigger>
            <SelectContent>
              {stockOptions.map((o, i) => (
                <SelectItem key={i} value={String(i)} className="text-xs">
                  {o.name} — {t("mfg_available", { qty: o.available, unit: o.unit })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {priceItems.length > 0 && (
          <Select value={pricePick} onValueChange={addFromPriceList} disabled={isSaving}>
            <SelectTrigger className="h-9 w-56 text-xs">
              <SelectValue placeholder={t("crm_quote_add_from_price_list")} />
            </SelectTrigger>
            <SelectContent>
              {priceItems.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name} — <span dir="ltr">{formatSar(p.unitPrice, locale)}</span> / {p.unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={addEmptyRow} disabled={isSaving}>
          <Plus size={13} />
          {t("crm_quote_add_free_item")}
        </Button>
      </div>
      {hasItems && (
        <p className="text-xs font-bold text-cta flex items-center justify-between border-t border-border/50 pt-2">
          {t("crm_quote_items_total")}
          <span dir="ltr" className="tabular-nums">{itemsTotal.toLocaleString()} {t("mfg_sar")}</span>
        </p>
      )}
    </div>
  )
}

/** Payment schedule — defined in the quotation so Finance reads it straight
 * off it (deposit → work order, no manual hand-off). */
export function QuotationScheduleEditor({ form }: { form: QuotationForm }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { installments, installmentsPercent, effectiveAmount, isSaving, updateInstallment, removeInstallment, addInstallment } = form
  return (
    <div className="rounded-xl border bg-muted/20 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="flex items-center gap-1.5">
          <Banknote size={14} className="text-success" />
          {t("crm_quote_installments_title")}
        </Label>
        <p className="text-[11px] text-muted-foreground">{t("crm_quote_installments_hint")}</p>
      </div>
      {installments.length === 0 && (
        <p className="text-[11px] text-muted-foreground">{t("crm_quote_installments_none_hint")}</p>
      )}
      {installments.map((row, i) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2">
          {/* The advance: due before production, confirmed by Finance before
              anything made to order is executed (D8, QC-12). */}
          <label className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border bg-white px-2 text-[11px] font-semibold text-slate-600 has-[:checked]:border-warning/50 has-[:checked]:bg-warning/10 has-[:checked]:text-warning has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-current"
              checked={row.beforeProduction}
              onChange={(e) => updateInstallment(i, { beforeProduction: e.target.checked })}
              disabled={isSaving}
            />
            {t("crm_quote_installment_before_production")}
          </label>
          <Input
            placeholder={t("crm_quote_installment_label")}
            aria-label={t("crm_quote_installment_label")}
            value={row.label}
            onChange={(e) => updateInstallment(i, { label: e.target.value })}
            className="flex-1 h-9 min-w-0"
            disabled={isSaving}
          />
          <Input
            placeholder="%" dir="ltr" inputMode="decimal" aria-label="%"
            value={row.percent}
            onChange={(e) => updateInstallment(i, { percent: e.target.value })}
            className="w-20 h-9"
            disabled={isSaving}
          />
          <span className="w-28 text-end text-xs text-muted-foreground tabular-nums shrink-0" dir="ltr">
            {formatSar(Math.round(((effectiveAmount * (Number(row.percent) || 0)) / 100) * 100) / 100, locale)}
          </span>
          <button
            type="button"
            onClick={() => removeInstallment(i)}
            aria-label={t("mfg_remove_item")}
            className="h-8 w-8 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={isSaving}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={addInstallment} disabled={isSaving}>
          <Plus size={13} />
          {t("crm_quote_add_installment")}
        </Button>
        {installments.length > 0 && (
          <span className={cn("text-xs font-bold tabular-nums", Math.abs(installmentsPercent - 100) < 0.01 ? "text-success" : "text-destructive")} dir="ltr">
            {t("crm_quote_installments_total", { percent: Math.round(installmentsPercent * 100) / 100 })}
          </span>
        )}
      </div>
    </div>
  )
}

/** The status, shown — never picked. A quotation moves one step at a time from
 * its own page in Sales (Issue → Log as sent → Convert / Close as lost), where
 * each step runs its checks; a form that could set any status was the way
 * around all of them (D6, D7). */
export function QuotationStatusField({ form, id = "quote-status" }: { form: QuotationForm; id?: string }) {
  const t = useTranslations("Portal.Shared")
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("crm_quote_status")}</Label>
      <p id={id} className="flex h-10 items-center rounded-lg border bg-muted/30 px-3 text-sm font-semibold">{t(`crm_quote_status_${form.status}`)}</p>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Lock size={11} aria-hidden="true" />
        {t("crm_quote_status_hint")}
      </p>
    </div>
  )
}
