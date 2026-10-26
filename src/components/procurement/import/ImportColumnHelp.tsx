"use client"

// «ساعدنا مرة واحدة» (IMP-04): a sheet whose material or quantity column the reader could not tell. The user picks the
// column once from a list, with the first rows of the file in front of him.

import { useTranslations } from "next-intl"
import { Search } from "lucide-react"
import { Callout } from "@/components/module-ui/Callout"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { colName } from "@/lib/boq-import/xfile"
import type { ColumnRole, Grid, ReadSheetInfo } from "@/lib/boq-import/reader"

export type HelpRole = "desc" | "qty" | "unit"

const cell = (v: unknown): string => String(v ?? "").trim()

export function ImportColumnHelp({ help, grid, roles, onRole }: { help: ReadSheetInfo; grid: Grid; roles: ColumnRole[]; onRole: (role: HelpRole, column: number) => void }) {
  const t = useTranslations("Portal.Procurement.import")
  const used = Array.from({ length: help.width }, (_, k) => k).filter((k) => grid.some((r) => cell(r[k])))
  const head = (k: number) => (help.hdr >= 0 ? cell((grid[help.hdr] || [])[k]) : "")
  const example = (k: number) =>
    grid
      .slice(help.hdr + 1)
      .map((r) => cell(r[k]))
      .find(Boolean) || ""
  const option = (k: number) => `${colName(k)}${head(k) ? ` · «${head(k)}»` : ""}${example(k) ? ` — ${t("help_eg")} ${example(k).replace(/\n/g, " ").slice(0, 26)}` : ""}`
  const rows = grid
    .slice(help.hdr + 1)
    .filter((r) => r.some((x) => cell(x)))
    .slice(0, 5)
  const lacks = !roles.includes("desc") && !roles.includes("qty") ? t("help_what_both") : !roles.includes("desc") ? t("help_what_desc") : t("help_what_qty")
  const field = (role: HelpRole, required: boolean) => (
    <label className="block space-y-1 text-xs font-semibold" key={role}>
      <span>
        {t(`help_${role}`)}
        {!required && <small className="ms-1 font-normal text-muted-foreground">({t("optional")})</small>}
      </span>
      <NativeSelect className="h-9 w-full text-xs font-normal" value={String(roles.indexOf(role))} onChange={(e) => onRole(role, Number(e.target.value))} aria-label={t(`help_${role}`)}>
        <option value="-1">{t("pick_column")}</option>
        {used.map((k) => (
          <option key={k} value={k}>
            {option(k)}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
  return (
    <div className="space-y-3" data-testid="import-help">
      <Callout tone="warn">
        <span className="flex items-start gap-1.5">
          <Search size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t("help_lead", { sheet: help.sheet, what: lacks })}
        </span>
      </Callout>
      <div className="grid gap-3 md:grid-cols-3">
        {field("desc", true)}
        {field("qty", true)}
        {field("unit", false)}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/40 text-muted-foreground">
              {used.map((k) => (
                <th key={k} className="whitespace-nowrap px-2 py-1.5 text-start font-semibold">
                  {colName(k)}
                  {head(k) ? ` · ${head(k)}` : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {used.map((k) => (
                  <td key={k} className="max-w-[16rem] truncate px-2 py-1.5" dir="auto">
                    {cell(r[k]).replace(/\n/g, " ")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("help_none")}</p>
    </div>
  )
}
