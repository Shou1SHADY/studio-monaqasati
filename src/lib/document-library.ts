// The Documents page (DEV-71, Odoo's Documents app): every file attached on a document
// the company can see — the purchase orders and offers it shares with a supplier or
// keeps to itself — in one searchable list that links back to where each belongs.
// A file here IS a thread entry of kind "file" (document-thread.ts); nothing is copied.
// Pure: no I/O.

import { matchesSearch } from "./search-text"
import type { ThreadEntry, ThreadFile, ThreadTargetKind } from "./document-thread"

export const FILE_KINDS = ["pdf", "image", "sheet", "doc", "other"] as const
export type FileKind = (typeof FILE_KINDS)[number]

export function fileKindOf(contentType: string, name = ""): FileKind {
  const t = contentType.toLowerCase()
  const ext = name.toLowerCase().split(".").pop() ?? ""
  if (t === "application/pdf" || ext === "pdf") return "pdf"
  if (t.startsWith("image/")) return "image"
  if (t.includes("spreadsheet") || t === "application/vnd.ms-excel" || t === "text/csv" || ["xls", "xlsx", "csv"].includes(ext)) return "sheet"
  if (t.includes("wordprocessing") || t === "application/msword" || ["doc", "docx"].includes(ext)) return "doc"
  return "other"
}

export type LibraryFile = ThreadEntry & { file: ThreadFile }

/** The file entries, newest first. */
export function filesOf(entries: ThreadEntry[]): LibraryFile[] {
  return entries
    .filter((e): e is LibraryFile => e.kind === "file" && e.file !== null)
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
}

/** Seen by both companies of the document, or by the author's only. */
export const isShared = (e: Pick<ThreadEntry, "buyerOrgId" | "supplierOrgId">): boolean => e.buyerOrgId !== null && e.supplierOrgId !== null

export type AudienceFilter = "all" | "shared" | "internal"
export type SourceFilter = "all" | ThreadTargetKind

export interface LibraryFilter {
  q: string
  type: FileKind | "all"
  audience: AudienceFilter
  source: SourceFilter
  /** Only what I added. */
  mine: boolean
}

export const NO_LIBRARY_FILTER: LibraryFilter = { q: "", type: "all", audience: "all", source: "all", mine: false }

export const countLibraryFilters = (f: LibraryFilter): number =>
  (f.q.trim() ? 1 : 0) + (f.type !== "all" ? 1 : 0) + (f.audience !== "all" ? 1 : 0) + (f.source !== "all" ? 1 : 0) + (f.mine ? 1 : 0)

export function applyLibraryFilter(files: LibraryFile[], f: LibraryFilter, uid: string): LibraryFile[] {
  return files.filter((e) => {
    if (f.type !== "all" && fileKindOf(e.file.contentType, e.file.name) !== f.type) return false
    if (f.audience === "shared" && !isShared(e)) return false
    if (f.audience === "internal" && isShared(e)) return false
    if (f.source !== "all" && e.targetKind !== f.source) return false
    if (f.mine && e.authorId !== uid) return false
    return f.q.trim() === "" || matchesSearch(f.q, [e.file.name, e.body, e.targetLabel, e.authorName])
  })
}

export interface LibraryCounts {
  all: number
  shared: number
  internal: number
  mine: number
  byType: Record<FileKind, number>
  bySource: Record<ThreadTargetKind, number>
}

export function libraryCounts(files: LibraryFile[], uid: string): LibraryCounts {
  const out: LibraryCounts = { all: files.length, shared: 0, internal: 0, mine: 0, byType: { pdf: 0, image: 0, sheet: 0, doc: 0, other: 0 }, bySource: { po: 0, offer: 0 } }
  for (const e of files) {
    if (isShared(e)) out.shared++
    else out.internal++
    if (e.authorId === uid) out.mine++
    out.byType[fileKindOf(e.file.contentType, e.file.name)]++
    out.bySource[e.targetKind]++
  }
  return out
}

/** The name of the document a file sits on; an entry written before labels were kept falls back to the document's id. */
export const sourceLabel = (e: Pick<ThreadEntry, "targetLabel" | "targetId">): string => e.targetLabel || e.targetId

/** Where the file's document opens for this viewer's side. */
export function sourceHref(e: Pick<ThreadEntry, "targetKind" | "targetId" | "targetHref" | "targetSupplierHref">, portal: "contractor" | "supplier"): string {
  if (portal === "supplier") return e.targetSupplierHref || (e.targetKind === "po" ? `/supplier/orders?po=${e.targetId}` : "/supplier/offers")
  return e.targetHref || (e.targetKind === "po" ? `/contractor/rfqs/orders?po=${e.targetId}` : "/contractor/rfqs")
}
