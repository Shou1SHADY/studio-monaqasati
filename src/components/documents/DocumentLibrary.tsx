"use client"

// The Documents page (DEV-71, Odoo's Documents): every file attached on a purchase order
// or an offer the company can see, in one searchable list. A file opens from here, and the
// document it belongs to is one click away. Files are added where the work happens — on the
// document itself (DocumentThread) — and appear here at once.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getDownloadURL, ref } from "firebase/storage"
import { File as FileIcon, FileImage, FileSpreadsheet, FileText, FolderOpen, Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Chip } from "@/components/module-ui/Chip"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
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
  fileKindOf,
  isShared,
  libraryCounts,
  sourceHref,
  sourceLabel,
  type FileKind,
  type LibraryFile,
  type LibraryFilter,
} from "@/lib/document-library"
import { fileSizeLabel } from "@/lib/document-thread"
import { pmDate } from "@/lib/pm/format"
import { cn } from "@/lib/utils"

const KIND_ICON: Record<FileKind, typeof FileIcon> = { pdf: FileText, image: FileImage, sheet: FileSpreadsheet, doc: FileText, other: FileIcon }

export function DocumentLibrary({ portal }: { portal: ActivityPortal }) {
  const t = useTranslations("Portal.Library")
  const locale = useLocale()
  const storage = useStorage()
  const { toast } = useToast()
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const { loading, files } = useDocumentLibrary(organizationId || null)
  const [filter, setFilter] = useState<LibraryFilter>(NO_LIBRARY_FILTER)
  const uid = user?.uid ?? ""

  const counts = useMemo(() => libraryCounts(files, uid), [files, uid])
  const shown = useMemo(() => applyLibraryFilter(files, filter, uid), [files, filter, uid])
  const active = countLibraryFilters(filter)
  const set = <K extends keyof LibraryFilter>(k: K, v: LibraryFilter[K]) => setFilter((f) => ({ ...f, [k]: v }))

  const open = async (f: LibraryFile) => {
    if (!storage) return
    try {
      window.open(await getDownloadURL(ref(storage, f.file.path)), "_blank", "noopener,noreferrer")
    } catch (err) {
      console.error(err)
      toast({ title: t("open_failed"), variant: "destructive" })
    }
  }

  const columns: DataColumn<LibraryFile>[] = [
    {
      key: "file",
      header: t("col_file"),
      label: t("col_file"),
      sortValue: (f) => f.file.name,
      cell: (f) => {
        const Icon = KIND_ICON[fileKindOf(f.file.contentType, f.file.name)]
        return (
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-module/10 text-module">
              <Icon size={15} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => void open(f)}
                className="max-w-full truncate rounded text-start text-sm font-semibold text-cta underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                dir="auto"
              >
                {f.file.name}
              </button>
              {f.body && (
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
      sortValue: (f) => sourceLabel(f),
      cell: (f) => (
        <div className="min-w-0">
          <Link href={sourceHref(f, portal)} className="rounded text-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
            {sourceLabel(f)}
          </Link>
          <p className="text-xs text-muted-foreground">{t(`kind_${f.targetKind}`)}</p>
        </div>
      ),
    },
    {
      key: "audience",
      header: t("col_audience"),
      label: t("col_audience"),
      hideBelow: "lg",
      sortValue: (f) => (isShared(f) ? 0 : 1),
      cell: (f) => <StatusPill tone={isShared(f) ? "info" : "mute"}>{t(isShared(f) ? "aud_shared" : "aud_internal")}</StatusPill>,
    },
    { key: "by", header: t("col_by"), label: t("col_by"), hideBelow: "xl", sortValue: (f) => f.authorName, cell: (f) => <span dir="auto">{f.authorName || "—"}</span> },
    { key: "date", header: t("col_date"), label: t("col_date"), sortValue: (f) => f.at, cell: (f) => pmDate(f.at.slice(0, 10), locale) },
    { key: "size", header: t("col_size"), label: t("col_size"), numeric: true, hideBelow: "lg", sortValue: (f) => f.file.size, cell: (f) => fileSizeLabel(f.file.size) },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <header className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
          <FolderOpen size={20} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-black text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("desc")}</p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label={t("kpi_files")} value={counts.all} />
        <Kpi label={t("kpi_shared")} value={counts.shared} />
        <Kpi label={t("kpi_mine")} value={counts.mine} />
      </div>

      <section className="space-y-3" aria-label={t("filters")}>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" dir="auto" className="ps-9" aria-label={t("search_label")} placeholder={t("search_ph")} value={filter.q} onChange={(e) => set("q", e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("filter_type")}>
          <Chip selected={filter.type === "all"} onClick={() => set("type", "all")} count={counts.all}>
            {t("type_all")}
          </Chip>
          {FILE_KINDS.filter((k) => counts.byType[k] > 0 || filter.type === k).map((k) => (
            <Chip key={k} selected={filter.type === k} onClick={() => set("type", k)} count={counts.byType[k]}>
              {t(`type_${k}`)}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("filter_more")}>
          <Chip selected={filter.audience === "shared"} onClick={() => set("audience", filter.audience === "shared" ? "all" : "shared")} count={counts.shared}>
            {t("aud_shared")}
          </Chip>
          <Chip selected={filter.audience === "internal"} onClick={() => set("audience", filter.audience === "internal" ? "all" : "internal")} count={counts.internal}>
            {t("aud_internal")}
          </Chip>
          <Chip selected={filter.source === "po"} onClick={() => set("source", filter.source === "po" ? "all" : "po")} count={counts.bySource.po}>
            {t("kind_po_plural")}
          </Chip>
          <Chip selected={filter.source === "offer"} onClick={() => set("source", filter.source === "offer" ? "all" : "offer")} count={counts.bySource.offer}>
            {t("kind_offer_plural")}
          </Chip>
          <Chip selected={filter.mine} onClick={() => set("mine", !filter.mine)} count={counts.mine}>
            {t("kpi_mine")}
          </Chip>
          {active > 0 && (
            <button
              type="button"
              onClick={() => setFilter(NO_LIBRARY_FILTER)}
              className={cn("rounded px-2 py-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            >
              {t("clear_filters")}
            </button>
          )}
        </div>
        {files.length > 0 && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {t("showing_of", { shown: shown.length, total: files.length })}
          </p>
        )}
      </section>

      {loading ? (
        <div className="flex justify-center p-10">
          <Loader2 className="animate-spin text-primary" size={24} aria-hidden="true" />
        </div>
      ) : (
        <DataTable
          caption={t("title")}
          labels={{ sortBy: (c) => t("sort_by", { column: c }), showMore: (n) => t("show_more", { count: n }) }}
          columns={columns}
          rows={shown}
          rowKey={(f) => f.id}
          initialSort={{ key: "date", dir: "desc" }}
          pageSize={25}
          empty={
            files.length === 0 ? (
              <EmptyState icon={FolderOpen} title={t("empty_title")} description={t("empty_desc")} />
            ) : (
              <EmptyState icon={Search} title={t("empty_filtered")} action={<button type="button" className="text-sm font-semibold text-cta underline-offset-2 hover:underline" onClick={() => setFilter(NO_LIBRARY_FILTER)}>{t("clear_filters")}</button>} />
            )
          }
        />
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums" dir="ltr">
        {value}
      </p>
    </div>
  )
}
