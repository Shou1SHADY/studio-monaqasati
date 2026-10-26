"use client"

// «ساعدنا مرة واحدة» — asked only when the reader could not tell which column holds the description
// or the quantity: four pickers and the first rows of the sheet to choose from.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useTableLabels } from "@/hooks/useTableLabels"
import { colName } from "@/lib/boq-import"
import type { ColumnRole, Grid } from "@/lib/boq-import"

export interface HelpState {
  k: number
  hdr: number
  roles: ColumnRole[]
}

type HelpRole = "desc" | "qty" | "rate" | "unit"
const ROLES: Array<{ role: HelpRole; required: boolean }> = [
  { role: "desc", required: true },
  { role: "qty", required: true },
  { role: "rate", required: false },
  { role: "unit", required: false },
]

const cell = (g: Grid, r: number, k: number) => String((g[r] || [])[k] || "").trim()

export function BoqImportHelp({ sheet, grid, help, onPick }: { sheet: string; grid: Grid; help: HelpState; onPick: (role: HelpRole, column: number) => void }) {
  const t = useTranslations("Portal.PmBoqImport")
  const labels = useTableLabels()
  const columns = useMemo(() => Array.from({ length: Math.max(0, ...grid.map((r) => r.length)) }, (_, k) => k).filter((k) => grid.some((r) => String(r[k] || "").trim())), [grid])
  const preview = useMemo(() => grid.filter((r) => r.some((x) => String(x || "").trim())).slice(0, 6), [grid])
  const holder = (role: HelpRole) => help.roles.indexOf(role)
  const describe = (k: number) => {
    const head = help.hdr >= 0 ? cell(grid, help.hdr, k) : ""
    const example = grid.slice(help.hdr + 1).map((r) => String(r[k] || "").trim()).find(Boolean) ?? ""
    return `${colName(k)}${head ? ` · «${head}»` : ""}${example ? ` — ${t("help.eg")} ${example.slice(0, 26)}` : ""}`
  }
  const missingDesc = holder("desc") < 0
  const missingQty = holder("qty") < 0
  const what = missingDesc && missingQty ? t("help.what_both") : missingDesc ? t("help.what_desc") : t("help.what_qty")
  const previewColumns: DataColumn<string[]>[] = columns.map((k) => ({ key: String(k), header: colName(k), label: colName(k), cell: (r) => <span dir="auto">{String(r[k] || "").slice(0, 40)}</span> }))
  return (
    <div className="space-y-3">
      <Callout tone="warn">{t("help.note", { sheet, what })}</Callout>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ROLES.map(({ role, required }) => (
          <label key={role} className="space-y-1 text-sm">
            <span className="font-semibold">
              {t(`help.${role}`)}
              {!required && <small className="ms-1 font-normal text-muted-foreground">({t("help.optional")})</small>}
            </span>
            <NativeSelect className="w-full max-md:h-11" value={holder(role)} onChange={(e) => onPick(role, Number(e.target.value))}>
              <option value={-1}>{t("help.pick")}</option>
              {columns.map((k) => (
                <option key={k} value={k}>
                  {describe(k)}
                </option>
              ))}
            </NativeSelect>
          </label>
        ))}
      </div>
      <DataTable<string[]> caption={t("help.preview")} columns={previewColumns} rows={preview} rowKey={(r) => r.join("|") + preview.indexOf(r)} labels={labels} dense empty={null} />
    </div>
  )
}
