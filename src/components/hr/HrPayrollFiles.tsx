"use client"

// The files for the authorities (PY-07, PRD form 24 — the prototype's forms
// `wps` / `gosi`): a preview before the download — the first rows and the
// totals — of the Mudad wage file (a supplementary's, and the "-R" release file
// of lines paid after the month) and of the GOSI statement. Produced from the
// payroll; Finance uploads them. We connect to neither Mudad nor GOSI.

import { useTranslations } from "next-intl"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useTableLabels } from "@/hooks/useTableLabels"
import { hrMoney } from "@/lib/hr/format"
import type { GosiRow, GosiStatement, MudadFile, MudadRow } from "@/lib/hr/payroll"

/** How many rows the preview shows; the rest are in the file. */
const PREVIEW_ROWS = 8

export function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export type FilePreview =
  | { kind: "mudad"; title: string; file: MudadFile; establishment: string | null }
  | { kind: "gosi"; title: string; statement: GosiStatement; name: string; csv: string; subscription: string | null }

export function HrPayrollFileDialog({ preview, onClose }: { preview: FilePreview | null; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const labels = useTableLabels()
  if (!preview) return null

  const mudadColumns: DataColumn<MudadRow>[] = [
    {
      key: "emp",
      header: t("payroll.file.col.employee"),
      cell: (r) => (
        <div className="min-w-0">
          <span dir="auto" className="font-semibold">
            {r.name}
          </span>
          {r.returned && (
            <StatusPill tone="bad" className="ms-1.5">
              {t("payroll.file.returned")}
            </StatusPill>
          )}
          <div className="text-xs text-muted-foreground" dir="ltr">
            {r.idNo ?? "—"}
          </div>
        </div>
      ),
    },
    {
      key: "bank",
      header: t("payroll.file.col.bank"),
      cell: (r) => (
        <div className="text-xs">
          <div className="font-semibold">{r.bank ?? "—"}</div>
          <bdi dir="ltr" className="text-muted-foreground">
            {r.iban ?? "—"}
          </bdi>
        </div>
      ),
    },
    { key: "basic", header: t("payroll.file.col.basic"), numeric: true, cell: (r) => hrMoney(r.basic) },
    { key: "housing", header: t("payroll.file.col.housing"), numeric: true, cell: (r) => hrMoney(r.housing) },
    { key: "other", header: t("payroll.file.col.other"), numeric: true, cell: (r) => hrMoney(r.other) },
    { key: "ded", header: t("payroll.file.col.deductions"), numeric: true, cell: (r) => hrMoney(r.deductions) },
    { key: "net", header: t("payroll.file.col.net"), numeric: true, cell: (r) => <strong>{hrMoney(r.net)}</strong> },
  ]
  const gosiColumns: DataColumn<GosiRow>[] = [
    { key: "emp", header: t("payroll.file.col.employee"), cell: (r) => <span dir="auto">{r.name}</span> },
    { key: "nat", header: t("payroll.file.col.nat"), cell: (r) => t(`payroll.file.scheme.${r.scheme}`) },
    { key: "base", header: t("payroll.file.col.base"), numeric: true, cell: (r) => hrMoney(r.base) },
    { key: "ee", header: t("payroll.file.col.employee_share"), numeric: true, cell: (r) => hrMoney(r.employee) },
    { key: "er", header: t("payroll.file.col.employer_share"), numeric: true, cell: (r) => hrMoney(r.employer) },
  ]

  const download = () => (preview.kind === "mudad" ? downloadCsv(preview.file.name, preview.file.csv) : downloadCsv(preview.name, preview.csv))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{preview.title}</DialogTitle>
          <DialogDescription>{preview.kind === "mudad" ? t("payroll.file.mudad_sub", { n: preview.file.rows.length }) : t("payroll.file.gosi_sub")}</DialogDescription>
        </DialogHeader>
        {preview.kind === "mudad" ? (
          <div className="space-y-3">
            <Callout tone="info">
              {t("payroll.file.mudad_note", { no: preview.establishment || "—", period: preview.file.period })}
              {preview.file.kind === "supplementary" && ` · ${t("payroll.file.sup_note")}`}
              {preview.file.kind === "release" && ` · ${t("payroll.file.release_note")}`}
            </Callout>
            {!preview.establishment && <Callout tone="warn">{t("payroll.file.no_mudad")}</Callout>}
            <DataTable
              caption={preview.title}
              labels={labels}
              dense
              columns={mudadColumns}
              rows={preview.file.rows.slice(0, PREVIEW_ROWS)}
              rowKey={(r) => r.employeeId}
              rowTone={(r) => (r.returned ? "bad" : undefined)}
              empty={<p className="py-6 text-center text-sm text-muted-foreground">{t("payroll.no_lines")}</p>}
            />
            <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {preview.file.rows.length > PREVIEW_ROWS ? t("payroll.file.shown", { n: preview.file.rows.length, shown: PREVIEW_ROWS }) : t("payroll.file.rows", { n: preview.file.rows.length })}
                {preview.file.heldCount > 0 && ` · ${t("payroll.file.held_out", { n: preview.file.heldCount, amount: hrMoney(preview.file.heldNet) })}`}
              </span>
              <span className="font-bold text-foreground">
                {t("payroll.file.total")} <bdi dir="ltr">{hrMoney(preview.file.total)}</bdi>
              </span>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <DataTable
              caption={preview.title}
              labels={labels}
              dense
              columns={gosiColumns}
              rows={preview.statement.saudi.slice(0, PREVIEW_ROWS)}
              rowKey={(r) => r.employeeId}
              empty={<p className="py-3 text-center text-sm text-muted-foreground">{t("payroll.file.no_saudi")}</p>}
            />
            {preview.statement.nonSaudi.count > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm">
                <span className="font-semibold">{t("payroll.file.non_saudi", { n: preview.statement.nonSaudi.count })}</span>
                <span className="text-muted-foreground">
                  {t("payroll.file.col.base")} <bdi dir="ltr">{hrMoney(preview.statement.nonSaudi.base)}</bdi> · {t("payroll.file.col.employer_share")}{" "}
                  <bdi dir="ltr">{hrMoney(preview.statement.nonSaudi.employer)}</bdi>
                </span>
              </div>
            )}
            <p className="text-sm font-bold">
              {t("payroll.file.gosi_total")} <bdi dir="ltr">{hrMoney(preview.statement.total)}</bdi>
              <span className="ms-2 text-xs font-normal text-muted-foreground">
                ({t("payroll.file.col.employee_share")} <bdi dir="ltr">{hrMoney(preview.statement.employee)}</bdi> · {t("payroll.file.col.employer_share")} <bdi dir="ltr">{hrMoney(preview.statement.employer)}</bdi>)
              </span>
            </p>
            <Callout tone="info">{t("payroll.file.gosi_note", { no: preview.subscription || "—" })}</Callout>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={download}>
            <Download size={15} className="me-1.5" aria-hidden="true" />
            {t("payroll.file.download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
