"use client"

// «ارفع ملف إكسل» (Procurement IMP 1.3): upload a materials list or a BOQ as it is → review → «أضِف» to the RFQ. The
// file is read in the browser and never kept; nothing in the RFQ changes before «أضِف». The user is asked only about
// what the system could not tell: a column, a material, a quantity in the material's unit.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { label, type MaterialIndex } from "@/lib/materials/tree"
import { matcherOf } from "@/lib/boq-import/materials-match"
import type { MaterialMemory } from "@/lib/boq-import/materials-match"
import {
  MATERIALS_MAX_MB,
  MATERIALS_MAX_ROWS,
  MaterialsFileError,
  isReady,
  isRow,
  readMaterials,
  understandMaterialsFile,
  type ImportError,
  type ImportRow,
  type MaterialsRead,
} from "@/lib/boq-import/materials-read"
import { bringBack, chooseMaterial, chooseUnit, confirmUnit, counts, groupsOf, memoryOf, removeRow, typeQuantity, type MaterialChoice } from "@/lib/boq-import/materials-review"
import { linesFromImport } from "@/lib/boq-import/materials-lines"
import { synKey } from "@/lib/boq-import/materials-text"
import type { Book, ColumnRole, Grid } from "@/lib/boq-import/reader"
import type { EditorLine } from "@/lib/procurement/rfq-editor"
import { downloadMaterialsTemplate } from "./downloadTemplate"
import { loadMaterialMemory, saveMaterialMemory } from "./materialMemoryClient"
import { ImportColumnHelp, type HelpRole } from "./ImportColumnHelp"
import { ImportReview, ReviewSummary, type ReviewActions } from "./ImportReview"
import { PickCategory, PickMaterial } from "./ImportPick"

export interface ImportPlace {
  key: string
  label: string
}

type View = { kind: "main" } | { kind: "pick"; at: number; q: string } | { kind: "category"; at: number }

const kb = (n: number, t: (k: string, v?: Record<string, number>) => string) => (n > 1048576 ? t("size_mb", { size: Number((n / 1048576).toFixed(1)) }) : t("size_kb", { size: Math.max(1, Math.round(n / 1024)) }))

export function ImportMaterialsDialog({ open, onOpenChange, index, places, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; index: MaterialIndex; places: ImportPlace[]; onAdd: (lines: EditorLine[], groupKey: string) => void }) {
  const t = useTranslations("Portal.Procurement.import")
  const locale = useLocale()
  const { toast } = useToast()
  const matcher = useMemo(() => matcherOf(index), [index])
  const [file, setFile] = useState<{ name: string; size: number } | null>(null)
  const [error, setError] = useState<ImportError | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState<{ book: Book; grids: Grid[] } | null>(null)
  const [read, setRead] = useState<MaterialsRead | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [helpRoles, setHelpRoles] = useState<ColumnRole[] | null>(null)
  const [view, setView] = useState<View>({ kind: "main" })
  const [target, setTarget] = useState("")
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const [over, setOver] = useState(false)
  // The rows stay in the group they were read into while a quantity is being typed (a row that moved would take the focus with it);
  // they settle into their groups when the box is left or another act is made.
  const [settled, setSettled] = useState(0)
  const memory = useRef<Promise<MaterialMemory>>(Promise.resolve(new Map()))
  const known = useRef<MaterialMemory>(new Map())

  useEffect(() => {
    if (!open) return
    setFile(null)
    setError(null)
    setBusy(false)
    setLoaded(null)
    setRead(null)
    setRows([])
    setHelpRoles(null)
    setView({ kind: "main" })
    setFolded({})
    setTarget(places[0]?.key ?? "")
    known.current = new Map()
    memory.current = loadMaterialMemory().then((m) => (known.current = new Map([...m, ...known.current])))
    // `places` only seeds the target when the dialog opens.
  }, [open])

  const reset = () => {
    setFile(null)
    setError(null)
    setLoaded(null)
    setRead(null)
    setRows([])
    setHelpRoles(null)
    setFolded({})
  }

  async function loadFile(f: File) {
    setFile({ name: f.name, size: f.size })
    setError(null)
    setBusy(true)
    setLoaded(null)
    setRead(null)
    setRows([])
    setHelpRoles(null)
    setFolded({})
    try {
      if (f.size > MATERIALS_MAX_MB * 1048576) throw new MaterialsFileError("size")
      await memory.current
      const buf = new Uint8Array(await f.arrayBuffer())
      const done = await understandMaterialsFile(f.name, buf, matcher, known.current)
      setLoaded({ book: done.book, grids: done.grids })
      setRead(done.read)
      setRows(done.read.rows)
      setSettled((x) => x + 1)
    } catch (e) {
      setError(e instanceof MaterialsFileError ? e.code : "broken")
    }
    setBusy(false)
  }

  const help = read && !read.ok ? read.help : null
  const chooseColumn = (role: HelpRole, column: number) => {
    if (!help || !loaded || !read) return
    const base = helpRoles ?? help.roles.slice()
    const roles: ColumnRole[] = base.concat(Array(Math.max(0, help.width - base.length)).fill("skip"))
    for (let j = 0; j < roles.length; j++) if (roles[j] === role) roles[j] = "skip"
    if (column >= 0) roles[column] = role
    setHelpRoles(roles)
    if (!roles.includes("desc") || !roles.includes("qty")) return
    const next = readMaterials(loaded.book, loaded.grids, matcher, known.current, { sheet: help.k, hdr: help.hdr, roles })
    if (next.ok) {
      setRead(next)
      setRows(next.rows)
      setSettled((x) => x + 1)
    } else setRead({ ...next, help })
  }

  const remember = (at: number, choice: MaterialChoice) => {
    if (choice.outside) return
    const text = rows[at].name
    const entry = memoryOf(matcher, text, choice)
    known.current = new Map(known.current).set(synKey(text), entry)
    void saveMaterialMemory(entry)
    toast({ title: t("remembered_toast", { text, material: label(index.byId.get(choice.nodeId) ?? null, locale) }) })
  }
  const apply = (f: (rs: ImportRow[]) => ImportRow[]) => {
    setRows(f)
    setSettled((x) => x + 1)
  }
  const choose = (at: number, choice: MaterialChoice) => {
    remember(at, choice)
    apply((rs) => chooseMaterial(rs, at, choice, matcher))
    setView({ kind: "main" })
  }

  const actions: ReviewActions = {
    quantity: (at, value) => setRows((rs) => typeQuantity(rs, at, value)),
    settle: () => setSettled((x) => x + 1),
    unit: (at, u) => apply((rs) => chooseUnit(rs, at, u)),
    confirmUnit: (at) => apply((rs) => confirmUnit(rs, at)),
    remove: (at) => apply((rs) => removeRow(rs, at)),
    bring: (at) => apply((rs) => bringBack(rs, at, matcher, known.current)),
    suggestion: (at, nodeId) => choose(at, { outside: false, nodeId, specs: [], brand: null }),
    search: (at) => setView({ kind: "pick", at, q: rows[at].name }),
    outside: (at) => setView({ kind: "category", at }),
  }

  const add = () => {
    if (!file || !read) return
    const lines = linesFromImport(rows, { index, locale, file: file.name, multiSheet: read.sheetsRead.length > 1 })
    const need = rows.filter((r) => isRow(r) && !isReady(r)).length
    const place = places.find((p) => p.key === target)?.label || ""
    onAdd(lines, target || places[0]?.key || "")
    onOpenChange(false)
    toast({ title: need ? t("added_with_need", { count: lines.length, need, place }) : t("added", { count: lines.length, place }) })
  }

  const c = counts(rows)
  const groups = useMemo(() => groupsOf(rows), [settled])
  const reviewing = !!read && read.ok && !error
  const title = view.kind === "pick" ? t("pick_title") : view.kind === "category" ? t("sub_title") : t("title")
  const subtitle = view.kind === "pick" ? t("pick_desc") : view.kind === "category" ? t("sub_desc") : t("subtitle")

  const dropZone = (
    <>
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-module/50 hover:bg-module/5",
          over && "border-module bg-module/5",
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer?.files?.[0]
          if (f) void loadFile(f)
        }}
      >
        <Upload size={30} className="text-module" aria-hidden="true" />
        <b className="text-sm">{t("drop_title")}</b>
        <span className="rounded-lg border bg-background px-3 py-1.5 text-xs font-semibold">{t("drop_choose")}</span>
        <small className="text-xs text-muted-foreground">{t("drop_limits", { mb: MATERIALS_MAX_MB, rows: MATERIALS_MAX_ROWS })}</small>
        <input
          type="file"
          accept=".xlsx,.csv,.txt"
          className="sr-only"
          aria-label={t("drop_title")}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void loadFile(f)
            e.target.value = ""
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {t("drop_hint")}{" "}
        <button
          type="button"
          onClick={() => {
            if (downloadMaterialsTemplate()) toast({ title: t("template_downloaded") })
          }}
          className="font-semibold text-module underline underline-offset-2"
        >
          {t("template_get")}
        </button>
      </p>
    </>
  )

  const fileBar = file && (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <FileSpreadsheet size={16} className="text-module" aria-hidden="true" />
      <b dir="auto">{file.name}</b>
      <span className="text-xs text-muted-foreground">{kb(file.size, t)}</span>
      <Button type="button" variant="link" className="ms-auto h-auto p-0 text-xs" onClick={reset}>
        {t("another_file")}
      </Button>
    </div>
  )

  let body: ReactNode
  let foot: ReactNode = (
    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
      {t("cancel")}
    </Button>
  )
  if (view.kind === "pick") {
    body = <PickMaterial matcher={matcher} query={view.q} onQuery={(q) => setView({ kind: "pick", at: view.at, q })} onChoose={(ch) => choose(view.at, ch)} onOutside={() => setView({ kind: "category", at: view.at })} onBack={() => setView({ kind: "main" })} />
    foot = null
  } else if (view.kind === "category") {
    body = <PickCategory index={index} onChoose={(sub) => choose(view.at, { outside: true, sub })} onBack={() => setView({ kind: "main" })} />
    foot = null
  } else if (busy) {
    body = (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
        <Loader2 className="animate-spin text-module" size={18} aria-hidden="true" /> {t("reading")}
      </div>
    )
    foot = null
  } else if (!file || error) {
    body = (
      <>
        {error && file && (
          <Callout tone="block">
            <b dir="auto">«{file.name}»</b> — {t(`err_${error}`, { mb: MATERIALS_MAX_MB, rows: MATERIALS_MAX_ROWS })}
          </Callout>
        )}
        {dropZone}
      </>
    )
  } else if (help && read && loaded) {
    body = (
      <>
        {fileBar}
        <ImportColumnHelp help={help} grid={loaded.grids[help.k] || []} roles={helpRoles ?? help.roles} onRole={chooseColumn} />
      </>
    )
  } else if (reviewing && read) {
    body = (
      <>
        {fileBar}
        <ReviewSummary rows={rows} read={read} />
        <ImportReview read={read} rows={rows} groups={groups} matcher={matcher} open={folded} onToggle={(k) => setFolded((o) => ({ ...o, [k]: !o[k] }))} actions={actions} />
      </>
    )
    foot = (
      <>
        <Button type="button" className="gap-2" disabled={!c.toAdd} onClick={add}>
          {t("add", { count: c.toAdd })}
        </Button>
        {places.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t("to_place")}
            <NativeSelect value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("to_place")} className="h-9 max-w-[14rem] text-xs">
              {places.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        <span className="text-xs text-muted-foreground">{t("finish_in_rfq")}</span>
        <Button type="button" variant="outline" className="ms-auto" onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">{body}</div>
        {foot && <DialogFooter className="items-center gap-3 sm:justify-start">{foot}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
