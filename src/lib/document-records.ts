// Where the files that existed before the document thread are kept, and how each source's own
// shape becomes a library item (document-library.ts). Nothing here writes or copies: a hook reads
// the records the company already has and these functions only translate what they hold.
// Pure: no I/O.

import { displayDocNumber } from "./sales-numbering"
import { fileKey, storagePathOfUrl, type RecordFile, type RecordKind, type RecordSource } from "./document-library"

type Raw = Record<string, unknown>

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const rec = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {})
const pad = (n: unknown): string => String(typeof n === "number" || typeof n === "string" ? n : "").padStart(2, "0")

/** A stored time as an ISO string: text as it is, a Firestore Timestamp or a Date converted, anything else empty. */
export function isoOf(v: unknown): string {
  if (typeof v === "string") return v
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString()
  if (v && typeof v === "object") {
    const t = v as { toDate?: () => Date; seconds?: unknown }
    if (typeof t.toDate === "function") {
      const d = t.toDate()
      return Number.isNaN(d.getTime()) ? "" : d.toISOString()
    }
    if (typeof t.seconds === "number") return new Date(t.seconds * 1000).toISOString()
  }
  return ""
}

const isHttp = (s: string): boolean => /^https?:\/\//i.test(s)

/** A file's name when the record kept none: the last part of its Storage path, minus the upload stamp. */
export function nameFromRef(f: { url?: string | null; path?: string | null }): string {
  let path = f.path || (f.url ? storagePathOfUrl(f.url) : null) || ""
  if (!path && f.url) {
    try {
      path = decodeURIComponent(new URL(f.url).pathname)
    } catch {
      path = ""
    }
  }
  const last = path.split("/").pop() ?? ""
  return last.replace(/^\d{8,}[-_]/, "")
}

interface FileRef {
  url: string | null
  path: string | null
  name: string
  contentType: string
  size: number | null
}

/** One stored file reference, whatever its shape: a link, a `{url, name}`, or a `{path, name, size, contentType}`. */
export function refOf(v: unknown): FileRef | null {
  if (typeof v === "string") {
    const s = v.trim()
    if (!s) return null
    if (isHttp(s)) return { url: s, path: null, name: nameFromRef({ url: s }), contentType: "", size: null }
    return s.includes("/") ? { url: null, path: s, name: nameFromRef({ path: s }), contentType: "", size: null } : null
  }
  if (!v || typeof v !== "object") return null
  const o = v as Raw
  const rawUrl = text(o.url)
  const url = isHttp(rawUrl) ? rawUrl : null
  const path = text(o.path) || null
  if (!url && !path) return null
  return {
    url,
    path,
    name: text(o.name) || nameFromRef({ url, path }),
    contentType: text(o.contentType),
    size: typeof o.size === "number" && o.size > 0 ? o.size : null,
  }
}

interface Pulled {
  file: unknown
  detail?: string
  at?: string
}

interface Base {
  /** The record's own key — the file's id is built from it. */
  key: string
  source: RecordSource
  kind: RecordKind
  at: string
  authorId: string
  authorName: string
  shared: boolean
  targetId: string
  targetLabel: string
  detail: string
  href: string
  supplierHref: string
}

/** The files a record points at, each once, in the order the record holds them. */
function build(base: Base, pulled: Pulled[]): RecordFile[] {
  const seen = new Set<string>()
  const out: RecordFile[] = []
  for (const p of pulled) {
    const ref = refOf(p.file)
    if (!ref) continue
    const key = fileKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: `${base.key}#${out.length}`,
      kind: "record",
      source: base.source,
      recordKind: base.kind,
      name: ref.name,
      url: ref.url,
      path: ref.path,
      contentType: ref.contentType,
      size: ref.size,
      at: p.at || base.at,
      authorId: base.authorId,
      authorName: base.authorName,
      shared: base.shared,
      targetId: base.targetId,
      targetLabel: base.targetLabel,
      detail: p.detail ?? base.detail,
      href: base.href,
      supplierHref: base.supplierHref,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// (a) RFQs, offers, goods receipts
// ---------------------------------------------------------------------------

/**
 * `rfqs`: `attachments` is `[{name, url, path}]` (older ones were bare links) and `pdfUrl` /
 * `pdfStoragePath` stay the first of them for older readers. A published RFQ is read by the
 * suppliers it goes to, so its files are shared; a draft is the buyer's alone.
 */
export function rfqRecordFiles(rfq: Raw & { id: string }): RecordFile[] {
  const pdfUrl = text(rfq.pdfUrl)
  return build(
    {
      key: `rfq:${rfq.id}`,
      source: "rfq",
      kind: "rfq_file",
      at: isoOf(rfq.createdAt),
      authorId: text(rfq.createdByUserId) || text(rfq.contractorId),
      authorName: text(rfq.createdByUserName),
      shared: text(rfq.status) !== "Draft",
      targetId: rfq.id,
      targetLabel: text(rfq.title) || text(rfq.rfqNumber) || rfq.id,
      detail: text(rfq.rfqNumber),
      href: `/contractor/rfqs/${rfq.id}`,
      supplierHref: "/supplier/rfqs",
    },
    [...list(rfq.attachments).map((file) => ({ file })), ...(pdfUrl ? [{ file: { url: pdfUrl, path: text(rfq.pdfStoragePath) } }] : [])]
  )
}

/**
 * `offers`: `offerPdfUrl` is the supplier's quote (a bare download link), `manualProofUrl` is the
 * proof the buyer's own team kept when it keyed an offer in (never seen by the supplier), and
 * `guestPapers` are the CR and VAT certificate a guest uploaded through the offer link.
 */
export function offerRecordFiles(offer: Raw & { id: string }): RecordFile[] {
  const guest = rec(offer.guestContact)
  const supplier = text(offer.companyName) || text(offer.supplierName) || text(guest.name)
  const rfqId = text(offer.rfqId)
  const base = {
    source: "offer" as const,
    at: isoOf(offer.createdAt),
    targetId: offer.id,
    targetLabel: text(offer.rfqTitle) || supplier || offer.id,
    detail: supplier,
    href: rfqId ? `/contractor/rfqs/${rfqId}/offers` : "/contractor/rfqs",
    supplierHref: "/supplier/offers",
  }
  return [
    ...build(
      { ...base, key: `offer:${offer.id}:quote`, kind: "offer_quote", authorId: text(offer.submittedByUserId) || text(offer.supplierId), authorName: text(offer.submittedByUserName) || supplier, shared: true },
      [{ file: text(offer.offerPdfUrl) }]
    ),
    ...build(
      { ...base, key: `offer:${offer.id}:proof`, kind: "offer_proof", authorId: text(offer.recordedById), authorName: text(offer.recordedByName), shared: false },
      [{ file: text(offer.manualProofUrl) }]
    ),
    ...build(
      { ...base, key: `offer:${offer.id}:papers`, kind: "offer_paper", authorId: "", authorName: text(guest.name) || supplier, shared: true },
      list(offer.guestPapers).map((p) => ({ file: p, at: isoOf(rec(p).at) || undefined }))
    ),
  ]
}

/**
 * `deliveries`: `attachmentUrls` is a list of bare download links — the supplier's delivery
 * note on a notice, the invoice photo on a receipt the buyer keyed in. A notice came from the
 * supplier, so its files are shared; a receipt recorded by the buyer's team is internal.
 */
export function receiptRecordFiles(delivery: Raw & { id: string }, locale: string): RecordFile[] {
  const docNumber = text(delivery.docNumber)
  const poNumber = text(delivery.poNumber)
  const fromSupplier = Boolean(text(delivery.supplierOrgId) || text(delivery.supplierId)) && delivery.source !== "manual" && delivery.selfReceived !== true
  const poId = text(delivery.poId)
  return build(
    {
      key: `receipt:${delivery.id}`,
      source: "receipt",
      kind: "receipt_file",
      at: isoOf(delivery.createdAt) || isoOf(delivery.confirmedAt) || isoOf(delivery.deliveryDate),
      authorId: fromSupplier ? text(delivery.supplierId) : text(delivery.confirmedByUserId) || text(delivery.contractorId),
      authorName: fromSupplier ? text(delivery.supplierName) : text(delivery.receivedByName).split(" — ")[0],
      shared: fromSupplier,
      targetId: delivery.id,
      targetLabel: docNumber ? displayDocNumber(docNumber, locale) : poNumber ? displayDocNumber(poNumber, locale) : text(delivery.rfqTitle) || delivery.id,
      detail: docNumber && poNumber ? displayDocNumber(poNumber, locale) : "",
      href: `/contractor/goods-received?delivery=${delivery.id}`,
      supplierHref: poId ? `/supplier/orders?po=${poId}` : "/supplier/orders",
    },
    list(delivery.attachmentUrls).map((file) => ({ file }))
  )
}

// ---------------------------------------------------------------------------
// (b) Projects
// ---------------------------------------------------------------------------

export interface ProjectLike {
  id: string
  name?: string | null
  pm?: Raw | null
}

export const PM_SUBS = ["pmDocs", "pmLetters", "pmSheets", "pmInspections", "pmNcrs", "pmPunch", "pmSubmittals", "pmVariations", "pmAddenda"] as const
export type PmSub = (typeof PM_SUBS)[number]

interface PmSourceDef {
  /** The counter on the project's `pm` block: a record exists only when it is above zero, so an empty subcollection is never opened. */
  counter: string
  kind: RecordKind
  /** The project page's tab that shows the record. */
  tab: string
  pull(r: Raw): Pulled[]
}

const files = (v: unknown): Pulled[] => list(v).map((file) => ({ file }))
const dayOf = (v: unknown): string | undefined => text(v) || undefined

/**
 * `projects/{id}/{sub}/{NN}` — each PM record keeps its attachments as `{url, name}` under the
 * field its screen writes: the register's file and revisions, a letter and its reply, a sheet's
 * take-off, an inspection attempt's request and result forms, an NCR's plan and acceptance, a
 * punch item's fix and confirmation, a submittal and its reply, a variation and its decision, an
 * addendum's signed copy.
 */
export const PM_SOURCES: Record<PmSub, PmSourceDef> = {
  pmDocs: {
    counter: "docCount",
    kind: "pm_doc",
    tab: "pmDocs",
    pull: (r) => [{ file: r.file, detail: text(r.name) }, ...list(r.revisions).map((v) => ({ file: rec(v).file, detail: [text(r.name), text(rec(v).code)].filter(Boolean).join(" · "), at: dayOf(rec(v).day) }))],
  },
  pmLetters: {
    counter: "letterCount",
    kind: "pm_letter",
    tab: "pmCorr",
    pull: (r) => [{ file: r.file }, { file: rec(r.reply).file, at: dayOf(rec(r.reply).on) }].map((p) => ({ ...p, detail: text(r.no) || `#${pad(r.seq)}` })),
  },
  pmSheets: { counter: "sheetCount", kind: "pm_sheet", tab: "pmMeasure", pull: (r) => files(r.files) },
  pmInspections: {
    counter: "wirCount",
    kind: "pm_inspection",
    tab: "pmWir",
    pull: (r) => list(r.attempts).flatMap((a) => [...files(rec(a).files), ...files(rec(a).rFiles)]),
  },
  pmNcrs: { counter: "ncrCount", kind: "pm_ncr", tab: "pmQa", pull: (r) => [...files(r.files), ...files(rec(r.plan).files), ...files(rec(r.accepted).files)] },
  pmPunch: { counter: "punchCount", kind: "pm_punch", tab: "pmPunch", pull: (r) => [...files(r.files), ...files(rec(r.fix).files), ...files(rec(r.conf).files)] },
  pmSubmittals: { counter: "sampleCount", kind: "pm_sample", tab: "pmSubm", pull: (r) => [...files(r.files), ...files(rec(r.reply).files)] },
  pmVariations: { counter: "voCount", kind: "pm_variation", tab: "pmVo", pull: (r) => [...files(r.files), ...files(rec(r.decision).files)] },
  pmAddenda: { counter: "addendaCount", kind: "pm_addendum", tab: "info", pull: (r) => files(r.files) },
}

/** The subcollections of a project that hold at least one record, per its own counters. */
export function pmSubsWithRecords(project: ProjectLike): PmSub[] {
  const pm = project.pm
  if (!pm) return []
  return PM_SUBS.filter((sub) => Number(pm[PM_SOURCES[sub].counter]) > 0)
}

export function projectRecordFiles(sub: PmSub, record: Raw & { id: string }, project: ProjectLike): RecordFile[] {
  const def = PM_SOURCES[sub]
  const href = `/contractor/projects/${project.id}?tab=${def.tab}`
  const own = record.seq !== undefined ? `#${pad(record.seq)}` : ""
  return build(
    {
      key: `pm:${project.id}:${sub}:${record.id}`,
      source: "project",
      kind: def.kind,
      at: text(record.day) || isoOf(record.createdAt),
      authorId: text(record.by),
      authorName: text(record.byName),
      shared: false,
      targetId: project.id,
      targetLabel: text(project.name) || text(project.pm?.no) || project.id,
      detail: own,
      href,
      supplierHref: href,
    },
    def.pull(record).map((p) => ({ ...p, detail: p.detail || own }))
  )
}

/**
 * `pmHandovers`: the files CRM sent with the project (`files: [{name, path, kind}]`, Storage
 * paths picked from the deal's own files — so a file that is still on the deal is one file here).
 */
export function handoverRecordFiles(h: Raw & { id: string }, locale: string): RecordFile[] {
  const dealNo = text(h.dealNo)
  return build(
    {
      key: `handover:${h.id}`,
      source: "project",
      kind: "pm_handover",
      at: isoOf(h.createdAt),
      authorId: text(h.requestedBy),
      authorName: text(h.requestedByName),
      shared: false,
      targetId: h.id,
      targetLabel: text(h.title) || h.id,
      detail: dealNo ? displayDocNumber(dealNo, locale) : "",
      href: "/contractor/projects/inbox",
      supplierHref: "/contractor/projects/inbox",
    },
    files(h.files)
  )
}

// ---------------------------------------------------------------------------
// (c) CRM deals
// ---------------------------------------------------------------------------

/** A deal holds files when any of its per-kind counters is above zero — only those are opened. */
export function opportunityHasFiles(opp: Raw): boolean {
  return Object.values(rec(opp.fileCounts)).some((n) => Number(n) > 0)
}

export interface OpportunityLike {
  id: string
  title?: string | null
  docNumber?: string | null
}

/** `crmOpportunities/{id}/files/{fileId}`: `{name, path, size, contentType, byId, byName, at, kind, source}`. */
export function crmRecordFiles(file: Raw & { id: string }, opp: OpportunityLike, locale: string): RecordFile[] {
  return build(
    {
      key: `crm:${opp.id}:${file.id}`,
      source: "crm",
      kind: "crm_file",
      at: text(file.at),
      authorId: text(file.byId),
      authorName: text(file.byName),
      shared: false,
      targetId: opp.id,
      targetLabel: text(opp.title) || opp.id,
      detail: opp.docNumber ? displayDocNumber(opp.docNumber, locale) : "",
      href: `/contractor/crm/opportunities/${opp.id}`,
      supplierHref: `/supplier/crm/opportunities/${opp.id}`,
    },
    [{ file }]
  )
}
