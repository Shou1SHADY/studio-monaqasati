"use client"

import { useLocale, useTranslations } from "next-intl"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { blankDraftRow, draftRowProblems, draftTotal, isBlankDraftRow, withDescription, type BoqDraftRow } from "@/lib/pm/boq"
import { pmMoney } from "@/lib/pm/format"
import { cn } from "@/lib/utils"

const toNumber = (v: string) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function WizardBoqEditor({ rows, onChange, disabled }: { rows: BoqDraftRow[]; onChange: (rows: BoqDraftRow[]) => void; disabled?: boolean }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const problems = draftRowProblems(rows)
  const filled = rows.filter((r) => !isBlankDraftRow(r))
  const unpriced = filled.filter((r) => !(r.rate > 0)).length
  const patch = (id: string, next: Partial<BoqDraftRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...next } : r)))
  const add = () => onChange([...rows, blankDraftRow(`new-${Date.now()}-${rows.length}`)])

  return (
    <section className="rounded-xl border" aria-labelledby="boq-edit-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div>
          <p id="boq-edit-title" className="text-sm font-bold">
            {t("wizard.boq_edit_title")}
          </p>
          <p className={cn("text-xs", unpriced ? "font-semibold text-warning" : "text-muted-foreground")}>
            {unpriced ? t("wizard.xl_review_unpriced", { count: filled.length, unpriced }) : t("wizard.xl_review_all_priced", { count: filled.length })}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
          <Plus size={14} className="me-1.5" aria-hidden="true" />
          {t("wizard.boq_add_row")}
        </Button>
      </div>
      <div className="hidden grid-cols-[5.5rem_minmax(0,1fr)_4.5rem_5.5rem_6.5rem_2.25rem] gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground sm:grid">
        <span>{t("wizard.boq_col_code")}</span>
        <span>{t("wizard.boq_col_desc")}</span>
        <span>{t("wizard.boq_col_unit")}</span>
        <span>{t("boq.qty")}</span>
        <span>{t("boq.rate")}</span>
        <span />
      </div>
      <ul className="max-h-80 divide-y overflow-y-auto">
        {rows.map((r, i) => {
          const bad = problems[i]
          const text = (locale === "ar" ? r.descriptionAr || r.descriptionEn : r.descriptionEn || r.descriptionAr) || ""
          return (
            <li key={r.id} className={cn("space-y-1 px-3 py-2", bad.length > 0 && "bg-destructive/5")}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_4.5rem_5.5rem_6.5rem_2.25rem]">
                <Input aria-label={t("wizard.boq_col_code")} dir="ltr" className="h-9 text-xs" value={r.itemNo} onChange={(e) => patch(r.id, { itemNo: e.target.value })} placeholder="02-01" disabled={disabled} />
                <Input aria-label={t("wizard.boq_col_desc")} dir="auto" className="col-span-2 h-9 text-xs sm:col-span-1" value={text} onChange={(e) => onChange(rows.map((x) => (x.id === r.id ? withDescription(x, locale, e.target.value) : x)))} disabled={disabled} />
                <Input aria-label={t("wizard.boq_col_unit")} dir="auto" className="h-9 text-xs" value={r.unit} onChange={(e) => patch(r.id, { unit: e.target.value })} disabled={disabled} />
                <Input aria-label={t("boq.qty")} type="number" min={0} step="any" inputMode="decimal" dir="ltr" className="h-9 text-xs" value={r.quantity > 0 ? r.quantity : ""} onChange={(e) => patch(r.id, { quantity: toNumber(e.target.value) })} disabled={disabled} />
                <Input aria-label={t("boq.rate")} type="number" min={0} step="any" inputMode="decimal" dir="ltr" className="h-9 text-xs" value={r.rate > 0 ? r.rate : ""} onChange={(e) => patch(r.id, { rate: toNumber(e.target.value) })} placeholder="—" disabled={disabled} />
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={t("wizard.boq_remove_row")} onClick={() => onChange(rows.filter((x) => x.id !== r.id))} disabled={disabled}>
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </div>
              {bad.length > 0 && <p className="text-xs font-semibold text-destructive">{bad.map((p) => t(`boq.problem.${p}`)).join(" · ")}</p>}
              {bad.length === 0 && !isBlankDraftRow(r) && !(r.rate > 0) && <StatusPill tone="warn">{t("wizard.xl_unpriced")}</StatusPill>}
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">{t("wizard.boq_empty_rows")}</li>}
      </ul>
      <div className="flex items-center justify-between border-t px-3 py-2 text-sm">
        <span className="font-semibold">{t("boq.total")}</span>
        <span className="font-bold tabular-nums">{pmMoney(draftTotal(rows))}</span>
      </div>
    </section>
  )
}
