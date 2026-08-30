"use client"

import { useTranslations } from "next-intl"
import { CheckCircle2, AlertCircle, Heart } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SupplierOption {
  orgId: string
  name: string
  isFavorite: boolean
}

/**
 * The suppliers a private RFQ can be addressed to, favourites first.
 *
 * Built from the contractor's own `contractorSupplierLinks`, not from the
 * favourites list alone: favouriting a supplier already creates the link (see
 * the suppliers page), so favourites are a subset of this — narrowing to them
 * would quietly drop suppliers connected any other way, through an invite or
 * by accepting a supplier's own request. Favourites are pinned to the top and
 * badged instead, which makes the common choice one click without closing off
 * the uncommon one.
 */
export function buildSupplierOptions(
  links: { supplierOrgId?: string; supplierName?: string; requestedBy?: string }[] | null | undefined,
  favoriteSupplierIds: string[],
  fallbackName: string
): SupplierOption[] {
  const seen = new Set<string>()
  const options: SupplierOption[] = []
  for (const link of links || []) {
    if (!link.supplierOrgId || seen.has(link.supplierOrgId)) continue
    seen.add(link.supplierOrgId)
    options.push({
      orgId: link.supplierOrgId,
      name: link.supplierName || fallbackName,
      // A link born of a favourite carries that origin, which also catches
      // older favourites recorded against a team member's id rather than the
      // company's own.
      isFavorite: favoriteSupplierIds.includes(link.supplierOrgId) || link.requestedBy === "contractor_favorite",
    })
  }
  return options.sort((a, b) =>
    a.isFavorite === b.isFavorite ? a.name.localeCompare(b.name) : a.isFavorite ? -1 : 1
  )
}

/**
 * Checkbox list choosing who a private RFQ reaches.
 *
 * `selected` is the effective list, so a caller that has not narrowed anything
 * passes every connected supplier and the list reads as fully ticked — the
 * behaviour private RFQs had before this picker existed.
 */
export function SupplierRecipientsPicker({
  options,
  selected,
  onChange,
  disabled,
  id = "rfq-recipients",
  className,
}: {
  options: SupplierOption[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  id?: string
  className?: string
}) {
  const t = useTranslations("Portal.Contractor")
  if (options.length === 0) return null

  const allSelected = selected.length === options.length
  const toggle = (orgId: string) =>
    onChange(selected.includes(orgId) ? selected.filter((s) => s !== orgId) : [...selected, orgId])

  return (
    <div id={id} className={className}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-foreground">{t("newrfq_visibility_recipients_label")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("newrfq_visibility_recipients_hint")}</p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(allSelected ? [] : options.map((o) => o.orgId))}
          className="text-xs font-bold text-primary hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded px-1 py-0.5"
        >
          {allSelected ? t("newrfq_visibility_clear_all") : t("newrfq_visibility_select_all")}
        </button>
      </div>

      <div className="mt-2.5 max-h-52 overflow-y-auto rounded-xl border border-border bg-white divide-y divide-border">
        {options.map((option) => {
          const isSelected = selected.includes(option.orgId)
          return (
            <label
              key={option.orgId}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 transition-colors",
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                isSelected ? "bg-primary/5" : "hover:bg-muted/50"
              )}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={disabled}
                onChange={() => toggle(option.orgId)}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <span className="text-sm font-semibold text-foreground truncate flex-1">{option.name}</span>
              {option.isFavorite && (
                <span className="shrink-0 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 flex items-center gap-1">
                  <Heart size={9} className="fill-amber-500 text-amber-500" />
                  {t("newrfq_visibility_favorite")}
                </span>
              )}
            </label>
          )
        })}
      </div>

      <p
        className={cn(
          "text-xs mt-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border w-fit font-semibold",
          selected.length > 0
            ? "text-success bg-success/10 border-success/20"
            : "text-amber-700 bg-amber-50 border-amber-200"
        )}
      >
        {selected.length > 0 ? (
          <CheckCircle2 size={11} className="shrink-0" />
        ) : (
          <AlertCircle size={11} className="shrink-0" />
        )}
        {selected.length > 0
          ? t("newrfq_visibility_selected_count", { selected: selected.length, total: options.length })
          : t("newrfq_val_recipients_required")}
      </p>
    </div>
  )
}
