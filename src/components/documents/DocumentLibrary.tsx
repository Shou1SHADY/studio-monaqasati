"use client"

// The Documents page (DEV-71, Odoo's Documents app): every file the company can see —
// those added on a purchase order or an offer through the document thread, and those that
// were already attached on RFQs, offers, goods receipts, project records and CRM deals.
// Laid out as Odoo lays it out: a control panel (title, one search bar carrying the active
// filters as facets, a kanban/list switch), a side panel of folders (the record kinds),
// file types and quick filters, each with its count, and a details panel for the file
// picked. A file opens from here, and the record it belongs to is one click away. Files
// are added where the work happens and appear here at once.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getDownloadURL, ref } from "firebase/storage"
import {
  ArrowUpRight,
  ExternalLink,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderOpen,
  Folder,
  Info,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  Search,
  Share2,
  UserRound,
  X,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useStorage, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useDocumentLibrary } from "@/hooks/useDocumentLibrary"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { Link } from "@/i18n/routing"
import type { ActivityPortal } from "@/lib/activity-writes"
import {
  FILE_KINDS,
  NO_LIBRARY_FILTER,
  applyLibraryFilter,
  countLibraryFilters,
  isRecordFile,
  itemAt,
  itemAuthorName,
  itemHref,
  itemIsShared,
  itemKindOf,
  itemLabel,
  itemName,
  itemSize,
  libraryCounts,
  type FileKind,
  type LibraryFilter,
  type LibraryItem,
  type LibrarySource,
} from "@/lib/document-library"
import { fileSizeLabel } from "@/lib/document-thread"
import { pmDate } from "@/lib/pm/format"
import { cn } from "@/lib/utils"

const KIND_ICON: Record<FileKind, typeof FileIcon> = { pdf: FileText, image: FileImage, sheet: FileSpreadsheet, doc: FileText, other: FileIcon }
/** The file's colour, as Odoo tints a document by its type. */
const KIND_TINT: Record<FileKind, string> = {
  pdf: "bg-destructive/10 text-destructive",
  image: "bg-violet/10 text-violet",
  sheet: "bg-success/10 text-success",
  doc: "bg-cta/10 text-cta",
  other: "bg-muted text-muted-foreground",
}

const THREAD_SOURCES: LibrarySource[] = ["po", "offer"]
const RECORD_SOURCES: LibrarySource[] = ["rfq", "receipt", "project", "crm"]

type View = "kanban" | "list"
const VIEW_KEY = "documents.view"

/** The extension as the file names it (PDF, XLSX…), when it names a short one. */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".")
  if (dot < 1) return null
  const ext = name.slice(dot + 1)
  return /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toUpperCase() : null
}

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()

export function DocumentLibrary({ portal }: { portal: ActivityPortal }) {
  const t = useTranslations("Portal.Library")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const storage = useStorage()
  const { toast } = useToast()
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const { loading, files } = useDocumentLibrary(organizationId || null)
  const [filter, setFilter] = useState<LibraryFilter>(NO_LIBRARY_FILTER)
  const [view, setView] = useState<View>("kanban")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const uid = user?.uid ?? ""

  // The kanban/list choice is a per-viewer convenience: remembered in this browser only.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY)
      if (saved === "list" || saved === "kanban") setView(saved)
    } catch {
      /* storage blocked — the default view stands */
    }
  }, [])
  const chooseView = (v: View) => {
    setView(v)
    try {
      window.localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* storage blocked — the choice lasts this visit */
    }
  }

  const counts = useMemo(() => libraryCounts(files, uid), [files, uid])
  const shown = useMemo(() => applyLibraryFilter(files, filter, uid), [files, filter, uid])
  const kanbanRows = useMemo(() => [...shown].sort((a, b) => itemAt(b).localeCompare(itemAt(a))), [shown])
  const [kanbanLimit, setKanbanLimit] = useState(24)
  const selected = selectedId ? files.find((f) => f.id === selectedId) ?? null : null
  const active = countLibraryFilters(filter)
  const set = <K extends keyof LibraryFilter>(k: K, v: LibraryFilter[K]) => setFilter((f) => ({ ...f, [k]: v }))
  const sources = [...THREAD_SOURCES, ...RECORD_SOURCES].filter((s) => THREAD_SOURCES.includes(s) || (counts.bySource[s] ?? 0) > 0 || filter.source === s)

  const open = async (f: LibraryItem) => {
    try {
      if (isRecordFile(f) && f.url) {
        window.open(f.url, "_blank", "noopener,noreferrer")
        return
      }
      const path = isRecordFile(f) ? f.path : f.file.path
      if (!storage || !path) return
      window.open(await getDownloadURL(ref(storage, path)), "_blank", "noopener,noreferrer")
    } catch (err) {
      console.error(err)
      toast({ title: t("open_failed"), variant: "destructive" })
    }
  }

  const recordLine = (f: LibraryItem) => (isRecordFile(f) ? [t(`rec_${f.recordKind}`), f.detail].filter(Boolean).join(" · ") : t(`kind_${f.targetKind}`))

  // The active filters, as the facets Odoo's search bar carries — each removable on its own.
  const facets: Array<{ key: string; group: string; label: string; clear: () => void }> = [
    ...(filter.source !== "all" ? [{ key: "source", group: t("side_folders"), label: t(`kind_${filter.source}_plural`), clear: () => set("source", "all") }] : []),
    ...(filter.type !== "all" ? [{ key: "type", group: t("filter_type"), label: t(`type_${filter.type}`), clear: () => set("type", "all") }] : []),
    ...(filter.audience !== "all"
      ? [{ key: "audience", group: t("side_show"), label: t(filter.audience === "shared" ? "kpi_shared" : "aud_internal"), clear: () => set("audience", "all") }]
      : []),
    ...(filter.mine ? [{ key: "mine", group: t("side_show"), label: t("kpi_mine"), clear: () => set("mine", false) }] : []),
  ]

  const columns: DataColumn<LibraryItem>[] = [
    {
      key: "file",
      header: t("col_file"),
      label: t("col_file"),
      sortValue: (f) => itemName(f),
      cell: (f) => {
        const kind = itemKindOf(f)
        const Icon = KIND_ICON[kind]
        return (
          <div className="flex min-w-0 items-start gap-2.5">
            <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", KIND_TINT[kind])}>
              <Icon size={15} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => void open(f)}
                className="max-w-full truncate rounded text-start text-sm font-semibold text-cta underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                dir="auto"
              >
                {itemName(f) || t("unnamed_file")}
              </button>
              {!isRecordFile(f) && f.body && (
                <p className="text-xs text-muted-foreground" dir="auto">
                  {f.body}
                </p>
              )}
            </div>
          </div>
        )
      },
    },
    {
      key: "source",
      header: t("col_source"),
      label: t("col_source"),
      sortValue: (f) => itemLabel(f),
      cell: (f) => (
        <div className="min-w-0">
          <Link href={itemHref(f, portal)} className="rounded text-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
            {itemLabel(f)}
          </Link>
          <p className="text-xs text-muted-foreground" dir="auto">
            {recordLine(f)}
          </p>
        </div>
      ),
    },
    {
      key: "audience",
      header: t("col_audience"),
      label: t("col_audience"),
      hideBelow: "lg",
      sortValue: (f) => (itemIsShared(f) ? 0 : 1),
      cell: (f) => <StatusPill tone={itemIsShared(f) ? "info" : "mute"}>{t(itemIsShared(f) ? "aud_shared" : "aud_internal")}</StatusPill>,
    },
    { key: "by", header: t("col_by"), label: t("col_by"), hideBelow: "xl", sortValue: (f) => itemAuthorName(f), cell: (f) => <span dir="auto">{itemAuthorName(f) || "—"}</span> },
    { key: "date", header: t("col_date"), label: t("col_date"), sortValue: (f) => itemAt(f), cell: (f) => (itemAt(f) ? pmDate(itemAt(f).slice(0, 10), locale) : "—") },
    { key: "size", header: t("col_size"), label: t("col_size"), numeric: true, hideBelow: "lg", sortValue: (f) => itemSize(f) ?? -1, cell: (f) => (itemSize(f) === null ? "—" : fileSizeLabel(itemSize(f) ?? 0)) },
    {
      key: "info",
      header: <span className="sr-only">{t("details")}</span>,
      label: t("details"),
      cell: (f) => (
        <button
          type="button"
          onClick={() => setSelectedId(f.id)}
          aria-label={t("details_of", { name: itemName(f) || t("unnamed_file") })}
          title={t("details")}
          className="grid h-11 w-11 md:h-9 md:w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info size={15} aria-hidden="true" />
        </button>
      ),
    },
  ]

  const empty =
    files.length === 0 ? (
      <EmptyState icon={FolderOpen} title={t("empty_title")} description={t("empty_desc")} />
    ) : (
      <EmptyState
        icon={Search}
        title={t("empty_filtered")}
        action={
          <button type="button" className="text-sm font-semibold text-cta underline-offset-2 hover:underline" onClick={() => setFilter(NO_LIBRARY_FILTER)}>
            {t("clear_filters")}
          </button>
        }
      />
    )

  return (
    <div className="mx-auto max-w-7xl space-y-4 py-4">
      {/* Control panel — title, the search bar with its facets, the view switch. */}
      <header className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
              <FolderOpen size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-black text-foreground">{t("title")}</h1>
              <p className="text-xs text-muted-foreground line-clamp-1" title={t("desc")}>
                {t("desc")}
              </p>
            </div>
          </div>
          <div className="ms-auto flex items-center gap-1 rounded-lg border bg-background p-0.5" role="group" aria-label={t("view_label")}>
            <ViewButton active={view === "kanban"} onClick={() => chooseView("kanban")} icon={LayoutGrid} label={t("view_kanban")} />
            <ViewButton active={view === "list"} onClick={() => chooseView("list")} icon={List} label={t("view_list")} />
          </div>
        </div>

        <section className="mt-3 flex flex-wrap items-center gap-2" aria-label={t("filters")}>
          <div className="relative flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-lg border bg-background ps-9 pe-2 py-1 focus-within:ring-2 focus-within:ring-ring">
            <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            {facets.map((f) => (
              <span key={f.key} className="inline-flex items-center gap-1 rounded-md bg-module/10 py-0.5 ps-2 pe-0.5 text-xs font-semibold text-module">
                <span className="opacity-70">{f.group}:</span>
                <span>{f.label}</span>
                <button
                  type="button"
                  onClick={f.clear}
                  aria-label={t("remove_filter_named", { name: f.label })}
                  className="grid h-8 w-8 place-items-center rounded hover:bg-module/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <Input
              type="search"
              dir="auto"
              className="h-8 min-w-[10rem] flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-label={t("search_label")}
              placeholder={t("search_ph")}
              value={filter.q}
              onChange={(e) => set("q", e.target.value)}
            />
          </div>
          <Button type="button" variant="outline" className="lg:hidden" aria-expanded={panelOpen} aria-controls="documents-side-panel" onClick={() => setPanelOpen((o) => !o)}>
            <Filter size={15} className="me-1.5" aria-hidden="true" />
            {t("filters_toggle")}
            {active > 0 && (
              <span className="ms-1.5 rounded-full bg-module px-1.5 text-[11px] leading-5 text-module-foreground tabular-nums" dir="ltr">
                {active}
              </span>
            )}
          </Button>
          {active > 0 && (
            <button
              type="button"
              onClick={() => setFilter(NO_LIBRARY_FILTER)}
              className="rounded px-2 py-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("clear_filters")}
            </button>
          )}
        </section>
      </header>

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Side panel — folders (the record kinds), file types, quick filters, each with its count. */}
        <aside id="documents-side-panel" className={cn("space-y-4 rounded-xl border bg-card p-3 lg:sticky lg:top-4 lg:block lg:self-start", panelOpen ? "block" : "hidden")} aria-label={t("side_label")}>
          <SideGroup title={t("side_folders")}>
            <SideItem icon={FolderOpen} label={t("kpi_files")} count={counts.all} selected={filter.source === "all"} onClick={() => set("source", "all")} />
            {sources.map((s) => (
              <SideItem key={s} icon={Folder} label={t(`kind_${s}_plural`)} count={counts.bySource[s] ?? 0} selected={filter.source === s} onClick={() => set("source", filter.source === s ? "all" : s)} indent />
            ))}
          </SideGroup>
          <SideGroup title={t("filter_type")}>
            {FILE_KINDS.filter((k) => counts.byType[k] > 0 || filter.type === k).map((k) => (
              <SideItem key={k} icon={KIND_ICON[k]} tint={KIND_TINT[k]} label={t(`type_${k}`)} count={counts.byType[k]} selected={filter.type === k} onClick={() => set("type", filter.type === k ? "all" : k)} />
            ))}
          </SideGroup>
          <SideGroup title={t("side_show")}>
            <SideItem icon={Share2} label={t("kpi_shared")} count={counts.shared} selected={filter.audience === "shared"} onClick={() => set("audience", filter.audience === "shared" ? "all" : "shared")} />
            <SideItem icon={Lock} label={t("aud_internal")} count={counts.internal} selected={filter.audience === "internal"} onClick={() => set("audience", filter.audience === "internal" ? "all" : "internal")} />
            <SideItem icon={UserRound} label={t("kpi_mine")} count={counts.mine} selected={filter.mine} onClick={() => set("mine", !filter.mine)} />
          </SideGroup>
        </aside>

        <section className="min-w-0 space-y-3" aria-label={t("files_label")}>
          {files.length > 0 && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {t("showing_of", { shown: shown.length, total: files.length })}
            </p>
          )}
          {loading ? (
            <div className="flex justify-center p-10">
              <Loader2 className="animate-spin text-primary" size={24} aria-hidden="true" />
            </div>
          ) : view === "list" ? (
            <DataTable
              caption={t("title")}
              labels={{ sortBy: (c) => t("sort_by", { column: c }), showMore: (n) => t("show_more", { count: n }) }}
              columns={columns}
              rows={shown}
              rowKey={(f) => f.id}
              initialSort={{ key: "date", dir: "desc" }}
              pageSize={25}
              empty={empty}
            />
          ) : kanbanRows.length === 0 ? (
            <div className="rounded-xl border bg-card">{empty}</div>
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {kanbanRows.slice(0, kanbanLimit).map((f) => (
                  <li key={f.id}>
                    <DocumentCard
                      file={f}
                      portal={portal}
                      selected={f.id === selectedId}
                      recordLine={recordLine(f)}
                      onOpen={() => void open(f)}
                      onDetails={() => setSelectedId(f.id)}
                    />
                  </li>
                ))}
              </ul>
              {kanbanRows.length > kanbanLimit && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={() => setKanbanLimit((n) => n + 24)}>
                    {t("show_more", { count: Math.min(24, kanbanRows.length - kanbanLimit) })}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Details panel — the file picked, its facts, and its two ways out. */}
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side={isRtl ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-md" dir={isRtl ? "rtl" : "ltr"}>
          {selected && (
            <>
              <SheetHeader className="text-start">
                <div className={cn("mb-2 grid h-32 place-items-center rounded-xl", KIND_TINT[itemKindOf(selected)])}>
                  {(() => {
                    const Icon = KIND_ICON[itemKindOf(selected)]
                    return <Icon size={44} strokeWidth={1.4} aria-hidden="true" />
                  })()}
                </div>
                <SheetTitle className="break-words text-start" dir="auto">
                  {itemName(selected) || t("unnamed_file")}
                </SheetTitle>
                <SheetDescription className="text-start">{t("details_title")}</SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <KeyValueRow label={t("col_source")} value={<span dir="auto">{itemLabel(selected)}</span>} />
                <KeyValueRow label={t("d_record_line")} value={<span dir="auto">{recordLine(selected)}</span>} />
                <KeyValueRow label={t("filter_type")} value={t(`type_${itemKindOf(selected)}`)} />
                <KeyValueRow label={t("col_audience")} value={t(itemIsShared(selected) ? "aud_shared" : "aud_internal")} />
                <KeyValueRow label={t("col_by")} value={<span dir="auto">{itemAuthorName(selected) || "—"}</span>} />
                <KeyValueRow label={t("col_date")} value={itemAt(selected) ? pmDate(itemAt(selected).slice(0, 10), locale) : "—"} />
                <KeyValueRow label={t("col_size")} value={itemSize(selected) === null ? "—" : fileSizeLabel(itemSize(selected) ?? 0)} ltr />
              </div>
              {!isRecordFile(selected) && selected.body && (
                <p className="mt-3 rounded-lg bg-muted/50 p-3 text-sm" dir="auto">
                  {selected.body}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={() => void open(selected)}>
                  <ExternalLink size={15} className="me-1.5" aria-hidden="true" />
                  {t("open_file")}
                </Button>
                <Link href={itemHref(selected, portal)} className={buttonVariants({ variant: "outline" })}>
                  {t("go_to_record")}
                  <ArrowUpRight size={15} className="ms-1.5 rtl-flip" aria-hidden="true" />
                </Link>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function ViewButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof FileIcon; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex h-11 sm:h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-module/10 text-module" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon size={15} aria-hidden="true" />
      <span className="max-sm:sr-only">{label}</span>
    </button>
  )
}

function SideGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 px-2 text-[11px] font-bold uppercase text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

function SideItem({
  icon: Icon,
  label,
  count,
  selected,
  onClick,
  indent,
  tint,
}: {
  icon: typeof FileIcon
  label: string
  count: number
  selected: boolean
  onClick: () => void
  indent?: boolean
  tint?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-11 lg:min-h-9 w-full items-center gap-2 rounded-lg px-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        indent && "ps-5",
        selected ? "bg-module/10 font-bold text-module" : "text-foreground/80 hover:bg-muted"
      )}
    >
      <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md", tint ?? (selected ? "text-module" : "text-muted-foreground"))}>
        <Icon size={14} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
        {count}
      </span>
    </button>
  )
}

function DocumentCard({
  file: f,
  portal,
  selected,
  recordLine,
  onOpen,
  onDetails,
}: {
  file: LibraryItem
  portal: ActivityPortal
  selected: boolean
  recordLine: string
  onOpen: () => void
  onDetails: () => void
}) {
  const t = useTranslations("Portal.Library")
  const locale = useLocale()
  const kind = itemKindOf(f)
  const Icon = KIND_ICON[kind]
  const name = itemName(f) || t("unnamed_file")
  const ext = extensionOf(itemName(f))
  const author = itemAuthorName(f)
  const shared = itemIsShared(f)

  return (
    <article className={cn("group flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md", selected && "ring-2 ring-module")}>
      <div className={cn("relative grid h-28 place-items-center", KIND_TINT[kind])}>
        <Icon size={38} strokeWidth={1.4} aria-hidden="true" />
        {ext && (
          <span className="absolute bottom-2 start-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-black text-foreground" dir="ltr">
            {ext}
          </span>
        )}
        <span className="absolute top-2 end-2" title={t(shared ? "aud_shared" : "aud_internal")}>
          <StatusPill tone={shared ? "info" : "mute"} className="bg-background/90">
            {shared ? <Share2 size={11} aria-hidden="true" /> : <Lock size={11} aria-hidden="true" />}
            {t(shared ? "aud_shared" : "aud_internal")}
          </StatusPill>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 truncate rounded text-start text-sm font-bold text-foreground underline-offset-2 hover:text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            dir="auto"
            title={name}
          >
            {name}
          </button>
          <button
            type="button"
            onClick={onDetails}
            aria-label={t("details_of", { name })}
            title={t("details")}
            className="-me-1 -mt-1 grid h-11 w-11 sm:h-8 sm:w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="min-w-0">
          <Link href={itemHref(f, portal)} className="block truncate rounded text-xs font-semibold text-cta underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
            {itemLabel(f)}
          </Link>
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {recordLine}
          </p>
        </div>
        <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-foreground" aria-hidden="true">
            {author ? initialsOf(author) : "—"}
          </span>
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {author || "—"}
          </span>
          <span className="shrink-0 tabular-nums" suppressHydrationWarning>
            {itemAt(f) ? pmDate(itemAt(f).slice(0, 10), locale) : "—"}
          </span>
        </div>
      </div>
    </article>
  )
}
