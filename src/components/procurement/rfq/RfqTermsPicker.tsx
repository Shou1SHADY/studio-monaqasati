"use client"

// The buyer's payment terms on an RFQ (Supplier 1.0 RFQ-11, OFR-01, G-08): rows of a share and a number of days after
// the invoice, adding up to 100%. The supplier reads them before he quotes, and the award freezes them on the order.

import { Plus, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { IconButton } from "@/components/module-ui/IconButton"
import { termsRefusal } from "@/lib/procurement/terms-freeze"
import { cn } from "@/lib/utils"

export interface TermRow {
  pct: string
  days: string
}

export const DEFAULT_TERM_ROWS: TermRow[] = [{ pct: "100", days: "30" }]

/** Rows from a stored list (an RFQ being edited); the default when it has none. */
export function termRowsOf(list: unknown): TermRow[] {
  if (!Array.isArray(list) || !list.length) return DEFAULT_TERM_ROWS.map((r) => ({ ...r }))
  return list.map((x: { pct?: unknown; days?: unknown }) => ({ pct: String(x?.pct ?? ""), days: String(x?.days ?? "") }))
}

export function RfqTermsPicker({ rows, onChange, invalid }: { rows: TermRow[]; onChange: (rows: TermRow[]) => void; invalid?: boolean }) {
  const t = useTranslations("Portal.Procurement.rfqpo.form")
  const refusal = termsRefusal(rows)
  const sum = Math.round(rows.reduce((s, r) => s + (Number(r.pct) || 0), 0) * 100) / 100
  const set = (i: number, patch: Partial<TermRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  return (
    <fieldset id="rfq-terms" className={cn("space-y-3 rounded-2xl border bg-muted/40 p-5", invalid && refusal && "border-destructive")}>
      <legend className="sr-only">{t("terms_label")}</legend>
      <div>
        <p className="text-sm font-bold text-foreground">{t("terms_label")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("terms_hint")}</p>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`rfq-term-pct-${i}`} className="text-[11px] text-muted-foreground">
                {t("terms_pct")}
              </Label>
              <Input id={`rfq-term-pct-${i}`} type="number" min="1" max="100" step="any" inputMode="decimal" dir="ltr" className="h-10 w-24" value={r.pct} onChange={(e) => set(i, { pct: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`rfq-term-days-${i}`} className="text-[11px] text-muted-foreground">
                {t("terms_days")}
              </Label>
              <Input id={`rfq-term-days-${i}`} type="number" min="0" max="365" step="1" inputMode="numeric" dir="ltr" className="h-10 w-28" value={r.days} onChange={(e) => set(i, { days: e.target.value })} />
            </div>
            {rows.length > 1 && <IconButton label={t("terms_remove")} onClick={() => onChange(rows.filter((_, k) => k !== i))} icon={Trash2} iconSize={15} />}
          </div>
        ))}
      </div>
      {rows.length < 6 && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => onChange([...rows, { pct: String(Math.max(0, Math.round((100 - sum) * 100) / 100) || ""), days: "30" }])}>
          <Plus size={14} aria-hidden="true" />
          {t("terms_add")}
        </Button>
      )}
      {refusal && <p className="text-xs font-semibold text-destructive">{refusal === "sum" ? t("terms_sum", { sum }) : t("terms_row")}</p>}
    </fieldset>
  )
}
