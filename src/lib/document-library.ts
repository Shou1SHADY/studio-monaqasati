// The Documents page (DEV-71, Odoo's Documents app): every file the company can see in one
// searchable list that links back to where each belongs. Two kinds of item sit side by
// side. A THREAD file is an entry of kind "file" on the document thread (document-thread.ts).
// A RECORD file is a file that was attached on a record long before the thread existed
// (an RFQ, an offer, a goods receipt, a project record, a CRM deal) and is read where it
// lives (document-records.ts). Nothing is copied: the library derives both on every read.
// Pure: no I/O.

import { matchesSearch } from "./search-text"
import type { ThreadEntry, ThreadFile, ThreadTargetKind } from "./document-thread"

export const FILE_KINDS = ["pdf", "image", "sheet", "doc", "other"] as const
export type FileKind = (typeof FILE_KINDS)[number]

export function fileKindOf(contentType: string, name = ""): FileKind {
  const t = contentType.toLowerCase()
  const ext = name.toLowerCase().split(".").pop() ?? ""
  if (t === "application/pdf" || ext === "pdf") return "pdf"
  if (t.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "image"
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

// ---------------------------------------------------------------------------
// Files that were attached on a record, before or beside the thread
// ---------------------------------------------------------------------------

export const RECORD_SOURCES = ["rfq", "offer", "receipt", "project", "crm"] as const
export type RecordSource = (typeof RECORD_SOURCES)[number]

/** Which record, and which of its files — names the line under the document in the list. */
export const RECORD_KINDS = [
  "rfq_file",
  "offer_quote",
  "offer_proof",
  "offer_paper",
  "receipt_file",
  "pm_doc",
  "pm_letter",
  "pm_sheet",
  "pm_inspection",
  "pm_ncr",
  "pm_punch",
  "pm_sample",
  "pm_variation",
  "pm_addendum",
  "pm_handover",
  "crm_file",
] as const
export type RecordKind = (typeof RECORD_KINDS)[number]

export interface RecordFile {
  /** Stable across reads: the record's own key and the file's place on it. */
  id: string
  kind: "record"
  source: RecordSource
  recordKind: RecordKind
  name: string
  /** A download link kept on the record, or the Storage object path to open with a fresh one. At least one is set. */
  url: string | null
  path: string | null
  contentType: string
  size: number | null
  /** ISO timestamp, or the record's day (`YYYY-MM-DD`); empty when the record never kept one. */
  at: string
  authorId: string
  authorName: string
  /** The other company of the record sees the file too (a supplier's quote, an RFQ that was published). */
  shared: boolean
  targetId: string
  /** What the person reads: the RFQ's title, the project's name, the deal's title. */
  targetLabel: string
  /** The line inside the record: «#03», a revision, a document number. */
  detail: string
  /** The buyer's portal-relative path that opens the record; the supplier's when it opens differently. */
  href: string
  supplierHref: string
}

export type LibraryItem = LibraryFile | RecordFile

export const isRecordFile = (i: LibraryItem): i is RecordFile => i.kind === "record"

/** The Storage object path inside a Firebase download link, so a link and a path to the same object are one file. */
export function storagePathOfUrl(url: string): string | null {
  const m = /\/v0\/b\/[^/]+\/o\/([^?#]+)/.exec(url)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return null
  }
}

/** One file, however it was referenced: by Storage path when that is known, else by link. */
export function fileKey(f: { url?: string | null; path?: string | null }): string {
  const path = f.path || (f.url ? storagePathOfUrl(f.url) : null)
  if (path) return `p:${path}`
  return f.url ? `u:${f.url}` : ""
}

export const itemKey = (i: LibraryItem): string => (isRecordFile(i) ? fileKey(i) : fileKey({ path: i.file.path }))

export const itemName = (i: LibraryItem): string => (isRecordFile(i) ? i.name : i.file.name)
export const itemContentType = (i: LibraryItem): string => (isRecordFile(i) ? i.contentType : i.file.contentType)
export const itemSize = (i: LibraryItem): number | null => (isRecordFile(i) ? i.size : i.file.size)
export const itemAuthorId = (i: LibraryItem): string => i.authorId
export const itemAuthorName = (i: LibraryItem): string => i.authorName
export const itemAt = (i: LibraryItem): string => i.at
export const itemSource = (i: LibraryItem): LibrarySource => (isRecordFile(i) ? i.source : i.targetKind)
export const itemIsShared = (i: LibraryItem): boolean => (isRecordFile(i) ? i.shared : isShared(i))
export const itemKindOf = (i: LibraryItem): FileKind => fileKindOf(itemContentType(i), itemName(i))
export const itemLabel = (i: LibraryItem): string => (isRecordFile(i) ? i.targetLabel || i.targetId : sourceLabel(i))
export const itemHref = (i: LibraryItem, portal: "contractor" | "supplier"): string =>
  isRecordFile(i) ? (portal === "supplier" ? i.supplierHref || i.href : i.href) : sourceHref(i, portal)

/**
 * The thread's files and the records' files as one list, newest first. A file that is both (the
 * same Storage object, however it was linked) is kept once, as the thread entry: it knows who
 * added it and with what words. Two records pointing at one file keep the first.
 */
export function mergeLibrary(threadFiles: LibraryFile[], records: RecordFile[]): LibraryItem[] {
  const seen = new Set<string>()
  const out: LibraryItem[] = []
  for (const f of threadFiles) {
    const key = itemKey(f)
    if (key) seen.add(key)
    out.push(f)
  }
  for (const r of records) {
    const key = fileKey(r)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    out.push(r)
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
}

// ---------------------------------------------------------------------------
// Filters and counters
// ---------------------------------------------------------------------------

export type LibrarySource = ThreadTargetKind | RecordSource

export type AudienceFilter = "all" | "shared" | "internal"
export type SourceFilter = "all" | LibrarySource

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

export function applyLibraryFilter<T extends LibraryItem>(files: T[], f: LibraryFilter, uid: string): T[] {
  return files.filter((e) => {
    if (f.type !== "all" && itemKindOf(e) !== f.type) return false
    const shared = itemIsShared(e)
    if (f.audience === "shared" && !shared) return false
    if (f.audience === "internal" && shared) return false
    if (f.source !== "all" && itemSource(e) !== f.source) return false
    if (f.mine && (!uid || e.authorId !== uid)) return false
    return f.q.trim() === "" || matchesSearch(f.q, [itemName(e), isRecordFile(e) ? e.detail : e.body, itemLabel(e), e.authorName])
  })
}

export interface LibraryCounts {
  all: number
  shared: number
  internal: number
  mine: number
  byType: Record<FileKind, number>
  /** The two thread sources are always there; a record source appears once it has a file. */
  bySource: Record<ThreadTargetKind, number> & Partial<Record<RecordSource, number>>
}

export function libraryCounts(files: LibraryItem[], uid: string): LibraryCounts {
  const out: LibraryCounts = { all: files.length, shared: 0, internal: 0, mine: 0, byType: { pdf: 0, image: 0, sheet: 0, doc: 0, other: 0 }, bySource: { po: 0, offer: 0 } }
  for (const e of files) {
    if (itemIsShared(e)) out.shared++
    else out.internal++
    if (uid && e.authorId === uid) out.mine++
    out.byType[itemKindOf(e)]++
    const source = itemSource(e)
    out.bySource[source] = (out.bySource[source] ?? 0) + 1
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
