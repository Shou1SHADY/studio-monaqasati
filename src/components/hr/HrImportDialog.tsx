"use client"

// Moving in (PRD IM-01…03, WF-02): download the template, fill it, upload it;
// every row is shown before anything is saved — clean, with the notes of how
// it was interpreted, or rejected with why — and only the rows not rejected
// are created. Imported staff enter payroll from this month.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Download, FileUp, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { DataTable, Figure, type DataColumn } from "@/components/module-ui/DataTable"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useTableLabels } from "@/hooks/useTableLabels"
import type { HrEmployee } from "@/lib/hr/employee"
import { createEmployee } from "@/lib/hr/employee-writes"
import { todayDay } from "@/lib/hr/format"
import { IMPORT_COLUMNS, interpretRows, parseCsv, templateCsv, type ImportNote, type ImportRow } from "@/lib/hr/import"
import type { HrSite } from "@/lib/hr/sites"
import { NATIONALITIES, TRADES } from "@/lib/hr/trades"
import { HrWriteError } from "@/lib/hr/write-guard"

const TONE = { clean: "ok", notes: "warn", rejected: "bad" } as const

export function HrImportDialog({ access, actorName, employees, sites, onClose }: { access: HrAccess; actorName: string; employees: HrEmployee[]; sites: HrSite[]; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const tableLabels = useTableLabels()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [fileName, setFileName] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ created: number; failed: Array<{ line: number; key: string }> } | null>(null)

  // Interpretation reads the labels a person would type, in this language, beside the keys.
  const labels = useMemo(() => {
    const tradeLabels: Record<string, string> = {}
    for (const x of TRADES) tradeLabels[t(`trade.${x.key}` as "trade.mason").trim().toLowerCase()] = x.key
    const nationalityLabels: Record<string, string> = {}
    for (const n of NATIONALITIES) nationalityLabels[t(`nat.${n}` as "nat.sa").trim().toLowerCase()] = n
    return { tradeLabels, nationalityLabels }
  }, [t])

  const download = () => {
    const headers = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, t(`imp.col.${c}`)])) as Record<(typeof IMPORT_COLUMNS)[number], string>
    const url = URL.createObjectURL(new Blob([templateCsv(headers)], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "employees-template.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const read = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setDone(null)
    const text = await file.text()
    setRows(interpretRows(parseCsv(text), { today: todayDay(), sites, existing: employees, ...labels }))
  }

  const counts = { clean: 0, notes: 0, rejected: 0 }
  for (const r of rows ?? []) counts[r.status]++
  const toCreate = (rows ?? []).filter((r) => r.input)

  const save = async () => {
    if (!firestore || !access.orgId) return
    setBusy(true)
    let created = 0
    const failed: Array<{ line: number; key: string }> = []
    for (const r of toCreate) {
      try {
        await createEmployee(firestore, access.ctx, access.orgId, { uid: access.ctx.uid, name: actorName || null }, r.input!, { visas: null, policies: access.settings.policies })
        created++
      } catch (err) {
        console.error(err)
        failed.push({ line: r.line, key: err instanceof HrWriteError ? (err.blocks[0] ? `new.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save" })
      }
    }
    setDone({ created, failed })
    setBusy(false)
    toast({ title: t("imp.created", { n: created }) })
  }

  const note = (n: ImportNote, kind: "note" | "err") =>
    t(`imp.${kind}.${n.key}`, {
      ...(n.params ?? {}),
      trade: n.params?.trade ? t(`trade.${n.params.trade}` as "trade.mason") : "",
      column: n.params?.column ? t(`imp.col.${n.params.column}` as "imp.col.name_ar") : "",
    })

  const importColumns: DataColumn<ImportRow>[] = [
    { key: "line", header: t("imp.line"), cell: (r) => <Figure className="text-muted-foreground">{r.line}</Figure>, sortValue: (r) => r.line, cardHidden: true },
    { key: "name", header: t("people.col.name"), cell: (r) => <span className="font-semibold" dir="auto">{r.display.name}</span>, sortValue: (r) => r.display.name },
    { key: "trade", header: t("people.col.trade"), cell: (r) => (r.display.trade ? t(`trade.${r.display.trade}` as "trade.mason") : "—") },
    { key: "site", header: t("people.col.site"), cell: (r) => r.display.site ?? t("sites.unassigned") },
    {
      key: "review",
      header: t("imp.review"),
      cell: (r) => (
        <>
          <StatusPill tone={TONE[r.status]}>{t(`imp.state.${r.status}`)}</StatusPill>
          <ul className="mt-1 space-y-0.5 text-xs">
            {r.errors.map((n, i) => (
              <li key={`e${i}`} className="text-destructive">
                {note(n, "err")}
              </li>
            ))}
            {r.notes.map((n, i) => (
              <li key={`n${i}`} className="text-muted-foreground">
                {note(n, "note")}
              </li>
            ))}
          </ul>
        </>
      ),
      sortValue: (r) => (r.status === "rejected" ? 0 : r.status === "notes" ? 1 : 2),
    },
  ]

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("imp.title")}</DialogTitle>
          <DialogDescription>{t("imp.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={download}>
            <Download size={14} className="me-1.5" aria-hidden="true" />
            {t("imp.template")}
          </Button>
          <Label htmlFor="imp-file" className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
            <FileUp size={14} aria-hidden="true" />
            {fileName || t("imp.choose")}
            <input id="imp-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void read(e.target.files?.[0])} disabled={busy} />
          </Label>
        </div>

        {rows && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(["clean", "notes", "rejected"] as const).map((s) => (
                <StatusPill key={s} tone={TONE[s]}>
                  {t(`imp.status.${s}`, { n: counts[s] })}
                </StatusPill>
              ))}
            </div>
            <DataTable
              dense
              caption={t("imp.review")}
              labels={tableLabels}
              columns={importColumns}
              rows={rows}
              rowKey={(r) => String(r.line)}
              cardTitleKey="name"
              maxHeight="50vh"
              rowTone={(r) => (r.status === "rejected" ? "bad" : r.status === "notes" ? "warn" : undefined)}
              empty={null}
            />
            <p className="text-xs text-muted-foreground">{t("imp.since_note")}</p>
          </div>
        )}

        {done && (
          <div className="rounded-xl border p-3 text-sm">
            <p className="font-bold">{t("imp.created", { n: done.created })}</p>
            {done.failed.map((f) => (
              <p key={f.line} className="text-xs text-destructive">
                {t("imp.failed_line", { line: f.line, reason: t(f.key as "err.save") })}
              </p>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t(done ? "imp.close" : "cancel")}
          </Button>
          {!done && (
            <Button onClick={() => void save()} disabled={busy || toCreate.length === 0 || !firestore}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("imp.create", { n: toCreate.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
