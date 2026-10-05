// The documents component (DEV-68, Odoo's chatter): on every document that links
// a contractor and a supplier, one thread of comments and attachments, a history
// that merges them with the document's own log, and the follow-ups of DEV-69.
//
// An entry is `shared` (both companies of the document read it) or `internal`
// (only the author's own company). It is written once and never edited or
// deleted. Pure: no I/O.

import type { Activity } from "./activities"

export const DOCUMENT_NOTES = "documentNotes"

export const THREAD_KINDS = ["comment", "file"] as const
export type ThreadKind = (typeof THREAD_KINDS)[number]

export const VISIBILITIES = ["shared", "internal"] as const
export type Visibility = (typeof VISIBILITIES)[number]

/** The documents that carry a thread. Each needs its own check in firestore.rules. */
export const THREAD_TARGET_KINDS = ["po"] as const
export type ThreadTargetKind = (typeof THREAD_TARGET_KINDS)[number]

export interface ThreadTarget {
  kind: ThreadTargetKind
  id: string
  /** What the person reads: "PO-2026/012". */
  label: string
  /** The buyer's portal-relative path that opens it. */
  href: string
  /** The supplier's, when the document opens differently for him. */
  supplierHref?: string
}

/** The two companies of a document. A guest supplier has no company: `supplierOrgId` is null. */
export interface DocParties {
  buyerOrgId: string
  supplierOrgId: string | null
}

export interface ThreadFile {
  name: string
  size: number
  contentType: string
  path: string
}

export interface ThreadEntry {
  id: string
  targetKey: string
  targetKind: ThreadTargetKind
  targetId: string
  kind: ThreadKind
  visibility: Visibility
  body: string
  file: ThreadFile | null
  authorId: string
  authorName: string
  authorOrgId: string
  buyerOrgId: string | null
  supplierOrgId: string | null
  /** ISO. */
  at: string
}

export const BODY_MAX = 2000
export const FILE_MAX_BYTES = 15 * 1024 * 1024

const FILE_TYPES: ReadonlyArray<string | RegExp> = [
  /^image\//,
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]

export const fileTypeAllowed = (contentType: string): boolean => FILE_TYPES.some((t) => (typeof t === "string" ? t === contentType : t.test(contentType)))

export const threadKey = (kind: ThreadTargetKind, id: string): string => `${kind}:${id}`

/** A shared thread needs a registered supplier; a guest's document keeps everything inside the buyer's company. */
export const canShare = (parties: DocParties): boolean => Boolean(parties.supplierOrgId) && parties.supplierOrgId !== "guest"

/** Which company is the author's, on this document; null when neither. */
export function sideOf(orgId: string, parties: DocParties): "buyer" | "supplier" | null {
  if (orgId && orgId === parties.buyerOrgId) return "buyer"
  if (orgId && canShare(parties) && orgId === parties.supplierOrgId) return "supplier"
  return null
}

/** The two company fields an entry is stored with: both for a shared one, only the author's for an internal one. */
export function storedParties(visibility: Visibility, side: "buyer" | "supplier", parties: DocParties): { buyerOrgId: string | null; supplierOrgId: string | null } {
  if (visibility === "shared" && canShare(parties)) return { buyerOrgId: parties.buyerOrgId, supplierOrgId: parties.supplierOrgId }
  return side === "buyer" ? { buyerOrgId: parties.buyerOrgId, supplierOrgId: null } : { buyerOrgId: null, supplierOrgId: parties.supplierOrgId }
}

export const readableBy = (e: Pick<ThreadEntry, "buyerOrgId" | "supplierOrgId">, orgId: string): boolean => Boolean(orgId) && (e.buyerOrgId === orgId || e.supplierOrgId === orgId)

export type ThreadBlock = "no_body" | "body_long" | "no_file" | "file_big" | "file_type" | "file_empty" | "not_a_party" | "not_shareable" | "bad_path"

export function threadBlocks(input: { kind: ThreadKind; body: string; file?: Omit<ThreadFile, "path"> & { path?: string }; visibility: Visibility; side: "buyer" | "supplier" | null; parties: DocParties; pathPrefix?: string }): ThreadBlock[] {
  const out: ThreadBlock[] = []
  if (!input.side) out.push("not_a_party")
  if (input.visibility === "shared" && !canShare(input.parties)) out.push("not_shareable")
  const body = input.body.trim()
  if (input.kind === "comment") {
    if (!body) out.push("no_body")
    else if (body.length > BODY_MAX) out.push("body_long")
  } else {
    if (body.length > BODY_MAX) out.push("body_long")
    const f = input.file
    if (!f) out.push("no_file")
    else {
      if (f.size <= 0) out.push("file_empty")
      else if (f.size > FILE_MAX_BYTES) out.push("file_big")
      if (!fileTypeAllowed(f.contentType)) out.push("file_type")
      if (input.pathPrefix && f.path && !f.path.startsWith(input.pathPrefix)) out.push("bad_path")
    }
  }
  return out
}

/** `documents/{buyerOrgId}/{po:abc}/{timestamp}-{name}` — the name is cleaned, never trusted. */
export function threadFilePath(buyerOrgId: string, targetKey: string, fileName: string, now: number): string {
  const clean = fileName.normalize("NFKC").replace(/[\\/]+/g, "_").replace(/[^\p{L}\p{N}._ -]+/gu, "_").trim().replace(/^\.+/, "").slice(-80) || "file"
  return `documents/${buyerOrgId}/${targetKey.replace(/[^\w:-]/g, "_")}/${now}-${clean}`
}

export const threadPrefix = (buyerOrgId: string, targetKey: string): string => `documents/${buyerOrgId}/${targetKey.replace(/[^\w:-]/g, "_")}/`

export function entryFromDoc(id: string, data: Record<string, unknown>): ThreadEntry {
  const text = (v: unknown) => (typeof v === "string" ? v : "")
  const org = (v: unknown) => (typeof v === "string" && v ? v : null)
  const f = data.file as Partial<ThreadFile> | null | undefined
  return {
    id,
    targetKey: text(data.targetKey),
    targetKind: "po",
    targetId: text(data.targetId),
    kind: data.kind === "file" ? "file" : "comment",
    visibility: data.visibility === "internal" ? "internal" : "shared",
    body: text(data.body),
    file: f && typeof f === "object" && f.path ? { name: text(f.name), size: typeof f.size === "number" ? f.size : 0, contentType: text(f.contentType), path: text(f.path) } : null,
    authorId: text(data.authorId),
    authorName: text(data.authorName),
    authorOrgId: text(data.authorOrgId),
    buyerOrgId: org(data.buyerOrgId),
    supplierOrgId: org(data.supplierOrgId),
    at: text(data.at),
  }
}

/** Both company queries return the shared entries; keep each once, oldest first. */
export function mergeEntries(...lists: ThreadEntry[][]): ThreadEntry[] {
  const seen = new Map<string, ThreadEntry>()
  for (const list of lists) for (const e of list) seen.set(e.id, e)
  return [...seen.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
}

/** What the host document already keeps as its own log, rendered in the host's words. */
export interface HostLogItem {
  at: string
  byName: string
  text: string
}

export type HistoryItem =
  | { id: string; at: string; type: "comment" | "file"; entry: ThreadEntry }
  | { id: string; at: string; type: "activity_planned" | "activity_done" | "activity_cancelled"; activity: Activity }
  | { id: string; at: string; type: "host"; item: HostLogItem }

/** Everything that happened to a document, newest first: thread entries, follow-ups closed, and the document's own log. */
export function historyOf(entries: ThreadEntry[], activities: Activity[], host: HostLogItem[] = []): HistoryItem[] {
  const out: HistoryItem[] = [
    ...entries.map((entry): HistoryItem => ({ id: `n:${entry.id}`, at: entry.at, type: entry.kind, entry })),
    ...host.map((item, i): HistoryItem => ({ id: `h:${i}:${item.at}`, at: item.at, type: "host", item })),
  ]
  for (const activity of activities) {
    if (activity.status === "open" || !activity.doneOn) continue
    out.push({ id: `a:${activity.id}`, at: `${activity.doneOn}T23:59:59.999Z`, type: activity.status === "done" ? "activity_done" : "activity_cancelled", activity })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
}

export const fileSizeLabel = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
