// PM 1.0 — the document register (DOC-01): documents and drawings with their
// revisions, and the one question that matters — which revision is current.
// The real risk is a drawing revised after the last certificate: the work was
// measured and billed against an older drawing. That makes the document
// "stale" until the next certificate, and it is a decision (amber, "blocking
// execution"). No certificate yet means nothing was billed, so nothing is
// stale — the prototype flagged every revised drawing on a project without
// one. Revisions are appended, never edited. Pure: no I/O.

/** `projects/{id}/pmDocs/{NN}`, numbered by the project's `pm.docCount`. */
export const PM_DOCS = "pmDocs"

export const DOC_TYPES = ["dwg", "shop", "spec", "permit", "cert", "ctr"] as const
export type DocType = (typeof DOC_TYPES)[number]

export interface PmFile {
  url: string
  name: string
}

export interface DocRevision {
  code: string
  day: string
  by: string
  byName?: string | null
  file?: PmFile | null
}

export interface PmDocument {
  id: string
  seq: number
  name: string
  type: DocType
  /** Oldest first; the last one is the revision in force. Empty = "no revisions". */
  revisions: DocRevision[]
  /** A document registered without a revision (a permit, the signed contract) keeps its file here. */
  file?: PmFile | null
  day: string
  by: string
  byName?: string | null
}

export const docNo = (seq: number) => String(seq).padStart(2, "0")

export const currentRevision = (d: Pick<PmDocument, "revisions">): DocRevision | null => d.revisions?.[d.revisions.length - 1] ?? null

/** The revision the current one superseded («حلّ محل»). */
export const previousCode = (d: Pick<PmDocument, "revisions">): string | null => d.revisions?.[d.revisions.length - 2]?.code ?? null

/** R03 → R04; anything without a number starts at R01. */
export function nextRevisionCode(code: string | null | undefined): string {
  const n = Number(String(code ?? "").replace(/\D/g, "")) || 0
  return `R${String(n + 1).padStart(2, "0")}`
}

/** The day of the last certificate prepared on the project (void ones never billed). */
export function lastCertificateDay(certificates: Array<{ status: string; prepOn?: string | null }>): string | null {
  return certificates.reduce<string | null>((m, c) => (c.status === "void" || !c.prepOn ? m : !m || c.prepOn > m ? c.prepOn : m), null)
}

/** A drawing whose current revision superseded another after the last certificate. */
export function isStale(d: Pick<PmDocument, "type" | "revisions">, lastCertDay: string | null): boolean {
  const cur = currentRevision(d)
  return d.type === "dwg" && lastCertDay !== null && previousCode(d) !== null && cur !== null && cur.day > lastCertDay
}

export const staleDocuments = <T extends Pick<PmDocument, "type" | "revisions">>(docs: T[], lastCertDay: string | null): T[] => docs.filter((d) => isStale(d, lastCertDay))

/** The form's warning: a new revision of an existing drawing dated after the last certificate. */
export function issuedAfterCertificate(input: { type: DocType | null; hasCurrent: boolean; day: string; lastCertDay: string | null }): boolean {
  return input.type === "dwg" && input.hasCurrent && input.lastCertDay !== null && /^\d{4}-\d{2}-\d{2}$/.test(input.day) && input.day > input.lastCertDay
}

export type DocBlock = "archived" | "no_doc" | "no_name" | "no_code" | "same_code" | "bad_day" | "future_day" | "before_current"

/** A new document (`doc` null) needs a name; its first revision code may be left
 * empty (registered with no revisions). A new revision of an existing document
 * needs a code it has never used, dated no earlier than the one in force. */
export function revisionBlocks(input: {
  archived: boolean
  isNew: boolean
  doc: Pick<PmDocument, "revisions"> | null
  name?: string | null
  code: string
  day: string
  today: string
}): DocBlock[] {
  const out: DocBlock[] = []
  const code = input.code.trim().toUpperCase()
  if (input.archived) out.push("archived")
  if (input.isNew) {
    if (!input.name?.trim()) out.push("no_name")
  } else if (!input.doc) {
    out.push("no_doc")
  } else {
    if (!code) out.push("no_code")
    else if (input.doc.revisions.some((r) => r.code.toUpperCase() === code)) out.push("same_code")
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) out.push("bad_day")
  else {
    if (input.day > input.today) out.push("future_day")
    const cur = input.doc && !input.isNew ? currentRevision(input.doc) : null
    if (cur && input.day < cur.day) out.push("before_current")
  }
  return out
}
