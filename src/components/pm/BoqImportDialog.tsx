"use client"

// «ارفع جدول الكميات» — ONE window for the three ways in (BOQ Import PM 1.0): a file as received
// (.xlsx · .csv · .txt, 5000 items · 10 MB), the optional Mdmak template, or items typed by hand.
// Upload → review → add: the reader proposes, the person decides on the line, and nothing is added
// until every yellow line is settled. The caller writes the result (`onApply`): the project's BOQ
// through the server, the new-project wizard's lines, the legacy project page's table.

import { useState, type DragEvent } from "react"
import { useTranslations } from "next-intl"
import { Download, Loader2, Pencil, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Callout } from "@/components/module-ui/Callout"
import { useToast } from "@/hooks/use-toast"
import { BOQ_TEMPLATE_FILE, BoqLoadError, MAX_MB, MAX_ROWS, buildBoqTemplate, loadBook, understandPm } from "@/lib/boq-import"
import type { Grid, UnderstandOptions, Workbook } from "@/lib/boq-import"
import {
  canAdd,
  emptyManual,
  fromCurrent,
  fromRead,
  helpReady,
  reconcile,
  setHelpRoles,
  summarize,
  toPayload,
  type BoqImportPayload,
  type CurrentBoqLine,
  type ReviewFile,
  type ReviewState,
} from "@/lib/pm/boq-import"
import { BoqImportHelp, type HelpState } from "./BoqImportHelp"
import { awardSentence, ReviewBody, type ReviewUpdate } from "./BoqImportReview"
import { cn } from "@/lib/utils"

export type BoqImportMode = "create" | "replace" | "edit"

export interface BoqImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** create: nothing there yet · replace: a BOQ is there and a new one replaces it · edit: the current BOQ reopened for hand edits. */
  mode: BoqImportMode
  /** Where a create/replace starts: the upload zone, or an empty list to type into. */
  start?: "upload" | "manual"
  /** The contract's award value, for the last line of the reconciliation (null: none to match). */
  awardValue: number | null
  /** The current BOQ, for `edit`. */
  current?: CurrentBoqLine[]
  /** How many lines a `replace` would replace. */
  currentCount?: number
  /** Writes the result. A thrown error carrying a `code` is told to the person; the window stays open. */
  onApply: (payload: BoqImportPayload) => Promise<unknown>
}

type Phase = "upload" | "reading" | "help" | "review"
type LoadCode = "size" | "type" | "xls" | "protected" | "broken" | "empty" | "rows" | "noboq" | "unfilled"

interface Local {
  phase: Phase
  error: { code: LoadCode; file: string } | null
  loaded: { book: Workbook; grids: Grid[]; name: string; size: number } | null
  help: HelpState | null
  review: ReviewState | null
}

const NS = "Portal.PmBoqImport"
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

const BLANK: ReviewFile = { name: "", size: 0, enc: null, eu: false, sheets: 0, used: 0 }

export function BoqImportDialog(props: BoqImportDialogProps) {
  return props.open ? <OpenDialog {...props} /> : null
}

function OpenDialog({ onOpenChange, mode, start = "upload", awardValue, current, currentCount = 0, onApply }: BoqImportDialogProps) {
  const t = useTranslations(NS)
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [local, setLocal] = useState<Local>(() => ({
    phase: mode === "edit" || start === "manual" ? "review" : "upload",
    error: null,
    loaded: null,
    help: null,
    review: mode === "edit" ? fromCurrent(current ?? [], { ...BLANK, name: t("bar.current_name") }) : start === "manual" ? emptyManual({ ...BLANK, name: t("bar.manual_name") }) : null,
  }))

  const fail = (code: LoadCode, file: string) => setLocal((l) => ({ ...l, phase: "upload", error: { code, file }, review: null, help: null }))

  const analyse = (loaded: NonNullable<Local["loaded"]>, opt?: UnderstandOptions) => {
    const res = understandPm(loaded.book, loaded.grids, opt)
    if (res.items.length > MAX_ROWS) return fail("rows", loaded.name)
    if (!res.items.length) {
      if (res.help) return setLocal((l) => ({ ...l, phase: "help", loaded, error: null, help: { k: res.help?.k ?? 0, hdr: res.help?.hdr ?? -1, roles: [...(res.help?.roles ?? [])] } }))
      return fail(res.unfilled ? "unfilled" : "noboq", loaded.name)
    }
    const info: ReviewFile = {
      name: loaded.name,
      size: loaded.size,
      enc: loaded.book.enc ?? null,
      eu: res.eu,
      sheets: loaded.book.sheets.filter((s) => !s.hidden).length,
      used: new Set(res.items.map((R) => R.sheet)).size,
    }
    setLocal((l) => ({ ...l, phase: "review", loaded, error: null, help: null, review: fromRead(res, info) }))
  }

  const readFile = async (file: File) => {
    setLocal((l) => ({ ...l, phase: "reading", error: null }))
    try {
      const { book, grids } = await loadBook(file.name, await file.arrayBuffer())
      analyse({ book, grids, name: file.name, size: file.size })
    } catch (e) {
      fail(e instanceof BoqLoadError ? e.code : "broken", file.name)
    }
  }

  const onPickColumn = (role: "desc" | "qty" | "rate" | "unit", column: number) => {
    const { help, loaded } = local
    if (!help || !loaded) return
    const roles = setHelpRoles(help.roles, role, column)
    setLocal((l) => ({ ...l, help: { ...help, roles } }))
    if (helpReady(roles)) analyse(loaded, { sheet: help.k, hdr: help.hdr, roles })
  }

  const update: ReviewUpdate = (fn) => setLocal((l) => (l.review ? { ...l, review: fn(l.review) } : l))
  const backToUpload = () => setLocal((l) => ({ ...l, phase: "upload", review: null, help: null, error: null, loaded: null }))
  const toManual = () => setLocal((l) => ({ ...l, phase: "review", error: null, review: emptyManual({ ...BLANK, name: t("bar.manual_name") }) }))

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([buildBoqTemplate() as BlobPart], { type: XLSX_TYPE }))
    const a = document.createElement("a")
    a.href = url
    a.download = BOQ_TEMPLATE_FILE
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast({ title: t("upload.template_done") })
  }

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (f) void readFile(f)
  }

  const { review } = local
  const summary = review ? summarize(review) : null
  const apply = async () => {
    if (!review || !canAdd(review)) return
    setBusy(true)
    try {
      await onApply(toPayload(review))
      const r = reconcile(review, awardValue)
      const items = t("items_count", { count: summary?.n ?? 0 })
      const matchNote = r.unpriced ? (mode === "edit" ? null : t("toast.unpriced")) : r.award ? (r.award.ok ? t("toast.match_ok") : awardSentence(t, r.award)) : null
      const note = matchNote ? ` — ${matchNote}` : ""
      toast({ title: t(mode === "edit" ? "toast.saved" : mode === "replace" ? "toast.replaced" : "toast.added", { items, note }) })
      onOpenChange(false)
    } catch (e) {
      const code = (e as { code?: unknown }).code
      const blocks = (e as { blocks?: unknown }).blocks
      const block = Array.isArray(blocks) && typeof blocks[0] === "string" ? blocks[0] : null
      const key = code === "BLOCKED" && (block === "started" || block === "measured" || block === "locked") ? block : code === "FORBIDDEN" || code === "NOT_FOUND" || code === "INVALID" ? code.toLowerCase() : "other"
      toast({ title: t(`save_err.${key}`), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const footLabel = (n: number) => t(mode === "edit" ? "foot.save" : mode === "replace" ? "foot.replace" : "foot.add", { items: t("items_count", { count: n }) })

  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 text-start">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("sub")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {local.phase === "reading" && <p className="py-10 text-center text-sm text-muted-foreground">{t("upload.reading")}</p>}

          {local.phase === "upload" && (
            <>
              {local.error && (
                <Callout tone="block">
                  <b dir="auto">«{local.error.file}»</b> — {t(`err.${local.error.code}`, { mb: MAX_MB, max: MAX_ROWS })}
                </Callout>
              )}
              <label
                className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-ring", over ? "border-module bg-module/5" : "hover:border-module/50")}
                onDragEnter={(e) => (e.preventDefault(), setOver(true))}
                onDragOver={(e) => (e.preventDefault(), setOver(true))}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                <Upload size={30} className="text-module" aria-hidden="true" />
                <b>{t("upload.drop_title")}</b>
                <span className="inline-flex min-h-11 items-center rounded-lg border-2 border-cta px-4 text-sm font-semibold text-cta">{t("upload.choose")}</span>
                <small className="text-muted-foreground">{t("upload.hint", { mb: MAX_MB })}</small>
                <input
                  type="file"
                  accept=".xlsx,.csv,.txt"
                  className="sr-only"
                  aria-label={t("upload.file_label")}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void readFile(f)
                    e.target.value = ""
                  }}
                />
              </label>
              <p className="text-sm text-muted-foreground">{t("upload.any")}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <Button type="button" variant="link" className="h-11 gap-1.5 px-0" onClick={downloadTemplate}>
                  <Download size={14} aria-hidden="true" />
                  {t("upload.template")}
                </Button>
                <Button type="button" variant="link" className="h-11 gap-1.5 px-0" onClick={toManual}>
                  <Pencil size={14} aria-hidden="true" />
                  {t("upload.manual")}
                </Button>
              </div>
            </>
          )}

          {local.phase === "help" && local.help && local.loaded && (
            <BoqImportHelp sheet={local.loaded.book.sheets[local.help.k]?.name ?? ""} grid={local.loaded.grids[local.help.k] ?? []} help={local.help} onPick={onPickColumn} />
          )}

          {local.phase === "review" && review && <ReviewBody state={review} update={update} awardValue={awardValue} onAnother={backToUpload} onUpload={backToUpload} />}
        </div>

        <DialogFooter className="items-center border-t px-5 py-3 sm:justify-between">
          {local.phase === "review" && summary ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => void apply()} disabled={busy || !review || !canAdd(review)} className="max-md:h-11">
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                {busy ? t("foot.busy") : footLabel(summary.n)}
              </Button>
              {summary.need > 0 ? (
                <span className="text-xs font-semibold text-warning">{t("foot.need", { count: summary.need })}</span>
              ) : mode === "edit" ? (
                <span className="text-xs text-muted-foreground">{t("foot.cap_edit")}</span>
              ) : mode === "replace" ? (
                <span className="text-xs text-muted-foreground">{t("foot.cap_replace", { items: t("items_count", { count: currentCount }) })}</span>
              ) : null}
            </div>
          ) : (
            <span />
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="max-md:h-11">
            {t("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

