// Server-only — the PM consultant portal's link (PM 1.0 → 1.1, the prototype's
// بوابة الاستشاري). Never import in client components.
//
// One link per project, sent to the consultant's representative's mobile from
// the project's details (PRJ-01, CP-02) and opened with a one-time code. The
// link's token is never stored: only its SHA-256 sits on the link and in the
// shared `linkTokens` index (src/lib/links/hash.ts) — a resend is a new token on
// the SAME link (the SMS already in his hand keeps working), counted in `sends`;
// a new representative or mobile revokes the link (CP-03). A verified code buys
// a session — a random secret the browser keeps, stored here only as its hash,
// for 12 hours — and every read and answer must carry it. He sees what waits on
// him and never a price, cost or margin — only the contract rates and amounts
// on a certificate (CP-11): the projection below copies named fields only, so a
// money field added to a record later cannot leak. He adds and never edits:
// each answer is the internal write re-done with the Admin SDK by the same pure
// planners (`planAnswer`, and for a certificate or a claim `planCertify` /
// `planRespond`, which the internal writes run too), refused if the record no
// longer waits on him, and recorded in his name as if it came by letter.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { FieldValue, type DocumentReference, type Firestore, type QuerySnapshot, type Transaction } from "firebase-admin/firestore"
import { findLinkByToken } from "@/lib/links/hash"
import { maskPhone } from "@/lib/otp"
import { inForce, PM_ADDENDA, addendumNo, type PmAddendum } from "./addenda"
import { cleanAttachments, MAX_ATTACHMENTS, type PmAttachment } from "./attachments"
import { certificateNo, CUT_REASONS, PM_CERTIFICATES, type CertificateLine, type CertificateVoLine } from "./certificate"
import type { PmCertificate } from "./certificate-writes"
import { CLAIM_RESPONSES, claimNo, PM_CLAIMS, type ClaimKind, type PmClaim } from "./claim"
import { planCertify, planRefuseFix, planRejectPlan, planRespond } from "./consultant-answers"
import { portalItems, portalKindOn, type PmPortalState, type PortalKind, type PortalRejection } from "./consultant-portal"
import { isLetterOpen, letterDocId, PM_LETTERS, replyBlocks as letterReplyBlocks, type PmLetter } from "./correspondence"
import { PM_EVENTS, pmEventDocId, type PmEvent } from "./events"
import { PM_INSPECTIONS, resultBlocks, WIR_RESULTS, wirNo, type PmInspection } from "./inspection"
import { lifecycleOf } from "./lifecycle"
import { ncrNo, ncrStepBlocks, PM_NCRS, type PmNcr } from "./ncr"
import { PM_PUNCH, punchNo, punchStepBlocks, type PunchItem } from "./punch"
import { PM_SUBMITTALS, replyBlocks as sampleReplyBlocks, SAMPLE_REPLIES, sampleNo, type PmSubmittal } from "./sample"
import { itemsAfterSampleApproval, PURCHASE_REQUESTS } from "./supply"
import { defaultTerms, type ContractTerms } from "./terms"

export type { PmPortalState, PortalRejection }

export const PM_PORTAL_LINKS = "pmPortalLinks"
export const PORTAL_LINK_TTL_MS = 180 * 86_400_000
export const PORTAL_SESSION_TTL_MS = 12 * 3_600_000
export const PORTAL_MAX_SESSIONS = 10
export const PORTAL_HISTORY_KEEP = 50
export const PORTAL_HISTORY_SHOWN = 20
export const PORTAL_LOG_KEEP = 100
export const PORTAL_UPLOADS_KEEP = 40
export const PORTAL_SESSION_HEADER = "x-portal-session"

export interface PortalSession {
  hash: string
  createdAt: string
  expiresAt: string
}

export type PortalAnswerWhat =
  | "appA"
  | "appB"
  | "rej"
  | "pass"
  | "cond"
  | "fail"
  | "confirmed"
  | "fix_rejected"
  | "replied"
  | "accepted"
  | "plan_rejected"
  | "certified"
  | "claim_appr"
  | "claim_part"
  | "claim_rej"

export interface PortalHistoryEntry {
  kind: PortalKind
  no: string
  title: string
  what: PortalAnswerWhat
  at: string
  byName: string
}

/** CP-05: what happened to the link — sends, entries, revocations and replies, with who and when. */
export interface PortalLogEntry {
  t: "send" | "open" | "revoke" | "reply"
  at: string
  byName?: string | null
  /** A revocation's cause: replaced by a new link, the representative or mobile changed, the consultant removed. */
  why?: "replaced" | "rep_changed" | "consultant_removed" | null
  /** A send's count after it. */
  sends?: number
  kind?: PortalKind
  no?: string
  what?: PortalAnswerWhat
}

/** A file he uploaded through the link — an answer may attach only these. */
export interface PortalUpload {
  url: string
  name: string
  path: string
  at: string
}

export interface PmPortalLink {
  /** Links sent before tokens were hashed hold it in plaintext (scripts/migrate-link-tokens.js hashes them). */
  token?: string
  /** SHA-256 of every live token (src/lib/links/hash.ts). */
  tokenHashes?: string[]
  projectId: string
  organizationId: string
  consultant: { name: string; phone: string }
  status: "open" | "revoked"
  revokedAt?: string | null
  revokedWhy?: PortalLogEntry["why"]
  createdById: string
  createdByName: string
  createdAt: string
  expiresAt: string
  seenAt?: string | null
  sessions?: PortalSession[]
  history?: PortalHistoryEntry[]
  sends?: number
  log?: PortalLogEntry[]
  uploads?: PortalUpload[]
}

export const createBody = z.object({
  projectId: z.string().min(1).max(128),
})

/** PRJ-01: the consultant and his representative, edited by `project.edit`. Each optional. */
export const consultantBody = z.object({
  projectId: z.string().min(1).max(128),
  consultant: z.string().trim().max(200),
  repName: z.string().trim().max(120),
  repPhone: z.string().trim().max(30),
  repEmail: z.union([z.literal(""), z.string().trim().email().max(160)]),
})

export const verifyBody = z.object({
  challengeId: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
})

const seq = z.number().int().min(1).max(99_999)
const note = z.string().trim().max(1000).optional()
const files = z
  .array(z.object({ url: z.string().url().max(2000), name: z.string().trim().min(1).max(160) }))
  .max(MAX_ATTACHMENTS)
  .optional()
const amount = z.number().finite().min(0).max(1e12)

// A punch fix or a corrective plan is accepted or refused; a refusal carries his reason.
export const answerBody = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("subm"), seq, decision: z.enum(SAMPLE_REPLIES), note, files }),
    z.object({ kind: z.literal("wir"), seq, result: z.enum(WIR_RESULTS), note, on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), files }),
    z.object({ kind: z.literal("punch"), seq, accept: z.boolean(), note, files }),
    z.object({ kind: z.literal("corr"), seq, text: z.string().trim().min(1).max(2000), files }),
    z.object({ kind: z.literal("ncr"), seq, accept: z.boolean(), note, files }),
    z.object({
      kind: z.literal("ipc"),
      seq,
      certified: amount,
      reason: z.enum(CUT_REASONS).optional(),
      reasonNote: z.string().trim().max(500).optional(),
      consultantRef: z.string().trim().max(80).optional(),
      files,
    }),
    z.object({
      kind: z.literal("claim"),
      seq,
      response: z.enum(CLAIM_RESPONSES),
      days: z.number().int().min(0).max(36_500).nullable().optional(),
      amount: amount.nullable().optional(),
      ref: z.string().trim().max(80).optional(),
      files,
    }),
  ])
  .superRefine((a, ctx) => {
    if ((a.kind === "punch" || a.kind === "ncr") && !a.accept && !a.note) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "no_note" })
  })
export type PortalAnswer = z.infer<typeof answerBody>

const SECRET = /^[a-f0-9]{64}$/
export const isSecret = (s: string | null | undefined): s is string => typeof s === "string" && SECRET.test(s)
export const newSessionSecret = () => randomBytes(32).toString("hex")
export const hashSecret = (secret: string) => createHash("sha256").update(`pm_portal:${secret}`).digest("hex")

export function addSession(sessions: PortalSession[] | undefined, hash: string, now: number): { sessions: PortalSession[]; expiresAt: string } {
  const live = (sessions ?? []).filter((s) => Date.parse(s.expiresAt) > now)
  const expiresAt = new Date(now + PORTAL_SESSION_TTL_MS).toISOString()
  return { sessions: [...live, { hash, createdAt: new Date(now).toISOString(), expiresAt }].slice(-PORTAL_MAX_SESSIONS), expiresAt }
}

export function sessionValid(sessions: PortalSession[] | undefined, secret: string | null | undefined, now: number): boolean {
  if (!isSecret(secret)) return false
  const want = Buffer.from(hashSecret(secret), "hex")
  return (sessions ?? []).some((s) => {
    if (!(Date.parse(s.expiresAt) > now)) return false
    const have = Buffer.from(s.hash, "hex")
    return have.length === want.length && timingSafeEqual(have, want)
  })
}

export function linkRefusal(link: Pick<PmPortalLink, "status" | "expiresAt"> | null | undefined, now: number): "missing" | "revoked" | "expired" | null {
  if (!link) return "missing"
  if (link.status === "revoked") return "revoked"
  if (now > Date.parse(link.expiresAt)) return "expired"
  return null
}

export const riyadhDay = (now: number) => new Date(now + 3 * 3_600_000).toISOString().slice(0, 10)

/** A log with the newest entry appended, the oldest dropped past the cap. */
export const appendLog = (log: PortalLogEntry[] | undefined, entry: PortalLogEntry): PortalLogEntry[] => [...(log ?? []), entry].slice(-PORTAL_LOG_KEEP)

export interface PortalProjectDoc {
  name?: string
  organizationId?: string
  projectManagerId?: string | null
  status?: string
  consultant?: string | null
  consultantRep?: { name?: string | null; phone?: string | null; email?: string | null } | null
  enabledSections?: string[]
  pm?: ({ no?: string | null; lifecycle?: string; portal?: PmPortalState | null; addendaCount?: number; programmeRev?: number; terms?: ContractTerms; original?: ContractTerms | null } & Record<string, unknown>) | null
}

export type ProjectRefusal = "NOT_FOUND" | "NOT_PM_PROJECT" | "PROJECT_CLOSED"

export function projectRefusal(project: PortalProjectDoc | null | undefined, orgId: string): ProjectRefusal | null {
  if (!project || project.organizationId !== orgId) return "NOT_FOUND"
  if (!project.pm) return "NOT_PM_PROJECT"
  if (lifecycleOf(project) === "closed") return "PROJECT_CLOSED"
  return null
}

export const mayManagePortal = (caller: { uid: string; can: (p: "pm.manage") => boolean }, project: Pick<PortalProjectDoc, "projectManagerId">) =>
  caller.can("pm.manage") || (Boolean(project.projectManagerId) && caller.uid === project.projectManagerId)

/** The project's switched-on sections, as his page filters by them (absent = all). */
export const sectionsOf = (project: Pick<PortalProjectDoc, "enabledSections"> | null | undefined) => (project?.enabledSections?.length ? project.enabledSections : null)

type Resolved =
  | { ok: true; linkId: string; link: PmPortalLink }
  | { ok: false; code: "INVALID_TOKEN" | "NOT_FOUND" | "LINK_REVOKED" | "LINK_EXPIRED"; status: number }

/** The link a presented token opens — by its hash first, then (links sent before hashing) by the plaintext. */
export async function resolvePortalLink(db: Firestore, token: string, now = Date.now()): Promise<Resolved> {
  const found = await findLinkByToken(db, "pm", token)
  if (!found.ok) return { ok: false, code: found.code, status: found.status }
  const link = found.link as PmPortalLink
  const refusal = linkRefusal(link, now)
  if (refusal === "missing") return { ok: false, code: "NOT_FOUND", status: 404 }
  if (refusal === "revoked") return { ok: false, code: "LINK_REVOKED", status: 410 }
  if (refusal === "expired") return { ok: false, code: "LINK_EXPIRED", status: 410 }
  return { ok: true, linkId: found.linkId, link }
}

export async function resolvePortalSession(db: Firestore, token: string, secret: string | null, now = Date.now()): Promise<Resolved | { ok: false; code: "NO_SESSION"; status: 401 }> {
  const resolved = await resolvePortalLink(db, token, now)
  if (!resolved.ok) return resolved
  if (!sessionValid(resolved.link.sessions, secret, now)) return { ok: false, code: "NO_SESSION", status: 401 }
  return resolved
}

export interface PortalLine {
  code: string
  descriptionAr: string
  descriptionEn: string
  unit: string
}

/** A certificate line as he sees it: the contract rate, the quantity and the amount — nothing else (CP-11/12). */
export interface PortalCertLine extends PortalLine {
  qty: number
  rate: number
  amount: number
}

export interface PortalSourceDocs {
  submittals: PmSubmittal[]
  inspections: PmInspection[]
  punch: PunchItem[]
  letters: PmLetter[]
  ncrs: PmNcr[]
  certificates?: PmCertificate[]
  claims?: PmClaim[]
  lines: Record<string, Record<string, unknown>>
  sections?: readonly string[] | null
}

export type PortalDetail =
  | { kind: "subm"; seq: number; rev: number; what: string | null; item: PortalLine | null; submittedOn: string; files: PmAttachment[] }
  | { kind: "wir"; seq: number; item: PortalLine | null; location: string; unit: string | null; attempt: number; bookedOn: string; files: PmAttachment[] }
  | { kind: "punch"; seq: number; what: string; location: string; severity: string; raisedOn: string; fixedOn: string | null; fixNote: string | null; files: PmAttachment[] }
  | { kind: "corr"; seq: number; subject: string; sentOn: string; due: number; links: string[]; files: PmAttachment[] }
  | { kind: "ncr"; seq: number; item: PortalLine | null; what: string | null; severity: string; root: string; plan: string; planOn: string | null; files: PmAttachment[] }
  | {
      kind: "ipc"
      seq: number
      periodFrom: string | null
      periodTo: string | null
      submittedOn: string | null
      /** His contractual period to certify, in days. */
      consultantDays: number | null
      lines: PortalCertLine[]
      voLines: Array<{ no: string; title: string; amount: number }>
      /** His earlier deductions claimed again here — a line of its own, so the lines sum to the gross (CP-12). */
      cuts: number
      gross: number
      files: PmAttachment[]
    }
  | { kind: "claim"; seq: number; claimKind: ClaimKind; cause: string; eventOn: string; noticeOn: string | null; submittedOn: string | null; daysAsked: number; files: PmAttachment[] }

export interface PortalViewItem {
  kind: PortalKind
  no: string
  day: string
  title: string
  detail: PortalDetail
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

function lineOf(lines: PortalSourceDocs["lines"], id: string | null | undefined, code?: string | null): PortalLine | null {
  const d = id ? lines[id] : undefined
  if (!d) return code ? { code, descriptionAr: "", descriptionEn: "", unit: "" } : null
  return { code: str(d.itemNo) || code || "", descriptionAr: str(d.descriptionAr), descriptionEn: str(d.descriptionEn), unit: str(d.unit) }
}

const lineTitle = (l: PortalLine | null) => (l ? [l.code, l.descriptionAr || l.descriptionEn].filter(Boolean).join(" · ") : "")
const filesOf = (...lists: Array<ReadonlyArray<Partial<PmAttachment>> | null | undefined>) => cleanAttachments(lists.flatMap((l) => l ?? []))

export function portalView(src: PortalSourceDocs, today: string): PortalViewItem[] {
  const details = new Map<string, PortalDetail>()
  const key = (kind: PortalKind, no: string) => `${kind}:${no}`

  for (const s of src.submittals) {
    const item = lineOf(src.lines, s.itemId, s.code)
    details.set(key("subm", sampleNo(s.seq)), { kind: "subm", seq: s.seq, rev: s.rev ?? 1, what: s.what ?? null, item, submittedOn: s.day, files: filesOf(s.files) })
  }
  for (const w of src.inspections) {
    const last = w.attempts?.[w.attempts.length - 1]
    details.set(key("wir", wirNo(w.seq)), {
      kind: "wir",
      seq: w.seq,
      item: lineOf(src.lines, w.itemId, w.code),
      location: w.location,
      unit: w.unit ?? null,
      attempt: last?.n ?? 1,
      bookedOn: last?.on ?? today,
      files: filesOf(last?.files),
    })
  }
  for (const p of src.punch) {
    details.set(key("punch", punchNo(p.seq)), {
      kind: "punch",
      seq: p.seq,
      what: p.what,
      location: p.location,
      severity: p.severity,
      raisedOn: p.day,
      fixedOn: p.fix?.on ?? null,
      fixNote: p.fix?.note ?? null,
      files: filesOf(p.files, p.fix?.files),
    })
  }
  for (const l of src.letters) {
    details.set(key("corr", l.no), { kind: "corr", seq: l.seq, subject: l.subject, sentOn: l.day, due: l.due, links: [...(l.links ?? [])], files: filesOf(l.file ? [l.file] : null) })
  }
  for (const n of src.ncrs) {
    details.set(key("ncr", ncrNo(n.seq)), {
      kind: "ncr",
      seq: n.seq,
      item: lineOf(src.lines, n.itemId, n.code),
      what: n.what ?? null,
      severity: n.severity,
      root: n.root,
      plan: n.plan?.text ?? "",
      planOn: n.plan?.on ?? null,
      files: filesOf(n.files, n.plan?.files),
    })
  }
  for (const c of src.certificates ?? []) {
    const lines = (c.lines ?? []).map((l: CertificateLine) => ({
      ...(lineOf(src.lines, l.itemId, l.code) ?? { code: l.code ?? "", descriptionAr: "", descriptionEn: "", unit: "" }),
      qty: num(l.qty),
      rate: num(l.rate),
      amount: num(l.amount),
    }))
    details.set(key("ipc", certificateNo(c.seq)), {
      kind: "ipc",
      seq: c.seq,
      periodFrom: c.periodFrom ?? null,
      periodTo: c.periodTo ?? c.prepOn ?? null,
      submittedOn: c.apprOn ?? null,
      consultantDays: typeof c.terms?.consultantDays === "number" ? c.terms.consultantDays : null,
      lines,
      voLines: (c.voLines ?? []).map((v: CertificateVoLine) => ({ no: String(v.seq).padStart(2, "0"), title: str(v.title), amount: num(v.amount) })),
      cuts: num(c.cutsIncluded),
      gross: num(c.gross),
      files: [],
    })
  }
  for (const c of src.claims ?? []) {
    details.set(key("claim", claimNo(c.seq)), {
      kind: "claim",
      seq: c.seq,
      claimKind: c.kind,
      cause: c.cause,
      eventOn: c.eventOn,
      noticeOn: c.noticeOn ?? null,
      submittedOn: c.submittedOn ?? null,
      daysAsked: c.kind === "cost" ? 0 : num(c.daysAsked),
      files: [],
    })
  }

  const pending = portalItems({
    submittals: src.submittals.map((s) => ({ seq: s.seq, status: s.status, day: s.day, title: s.what || lineTitle(lineOf(src.lines, s.itemId, s.code)) })),
    inspections: src.inspections.map((w) => ({ seq: w.seq, status: w.status, party: w.party, day: w.attempts?.[w.attempts.length - 1]?.on ?? today, location: w.location })),
    punch: src.punch.map((p) => ({ seq: p.seq, status: p.status, source: p.source, day: p.day, fixOn: p.fix?.on ?? null, what: p.what })),
    letters: src.letters.map((l) => ({ no: l.no, dir: l.dir, party: l.party, status: l.status, day: l.day, subject: l.subject })),
    ncrs: src.ncrs.map((n) => ({ seq: n.seq, status: n.status, day: n.day, planOn: n.plan?.on ?? null, title: n.what || n.root })),
    certificates: (src.certificates ?? []).map((c) => ({ seq: c.seq, status: c.status, apprOn: c.apprOn ?? null, prepOn: c.prepOn, title: "" })),
    claims: (src.claims ?? []).map((c) => ({ seq: c.seq, status: c.status, submittedOn: c.submittedOn ?? null, eventOn: c.eventOn, cause: c.cause })),
    sections: src.sections ?? null,
  })
  return pending.flatMap((x) => {
    const detail = details.get(key(x.kind, x.no))
    return detail ? [{ kind: x.kind, no: x.no, day: x.day, title: x.title, detail }] : []
  })
}

export async function readPortalSources(db: Firestore, projectId: string, sections: readonly string[] | null = null): Promise<PortalSourceDocs> {
  const p = db.collection("projects").doc(projectId)
  const all = <T>(snap: QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
  const on = (k: PortalKind) => portalKindOn(k, sections)
  const none = Promise.resolve(null)
  const [subs, wirs, punch, letters, ncrs, certs, claims] = await Promise.all([
    on("subm") ? p.collection(PM_SUBMITTALS).where("status", "==", "sub").get() : none,
    on("wir") ? p.collection(PM_INSPECTIONS).where("status", "==", "open").get() : none,
    on("punch") ? p.collection(PM_PUNCH).where("status", "==", "fix").get() : none,
    on("corr") ? p.collection(PM_LETTERS).where("status", "==", "out").get() : none,
    on("ncr") ? p.collection(PM_NCRS).where("status", "==", "plan").get() : none,
    on("ipc") ? p.collection(PM_CERTIFICATES).where("status", "==", "sub").get() : none,
    on("claim") ? p.collection(PM_CLAIMS).where("status", "==", "sub").get() : none,
  ])
  const list = <T>(snap: QuerySnapshot | null) => (snap ? all<T>(snap) : [])
  const src: PortalSourceDocs = {
    submittals: list<PmSubmittal>(subs),
    inspections: list<PmInspection>(wirs).filter((w) => w.party === "consultant"),
    punch: list<PunchItem>(punch).filter((x) => x.source === "cons"),
    letters: list<PmLetter>(letters).filter((l) => l.dir === "out" && l.party === "cons"),
    ncrs: list<PmNcr>(ncrs),
    certificates: list<PmCertificate>(certs),
    claims: list<PmClaim>(claims),
    lines: {},
    sections,
  }
  const ids = [
    ...new Set(
      [...src.submittals.map((s) => s.itemId), ...src.inspections.map((w) => w.itemId), ...src.ncrs.map((n) => n.itemId), ...(src.certificates ?? []).flatMap((c) => (c.lines ?? []).map((l) => l.itemId))].filter(Boolean)
    ),
  ]
  if (ids.length) {
    const snaps = await db.getAll(...ids.map((id) => p.collection("boqItems").doc(id)))
    for (const s of snaps) if (s.exists) src.lines[s.id] = s.data() as Record<string, unknown>
  }
  return src
}

export type AnswerRefusal = "NOT_FOUND" | "NOT_WAITING" | "BLOCKED"

export interface AnswerPlan {
  patch: Record<string, unknown>
  line: { itemId: string; patch: Record<string, unknown> } | null
  /** A sample approved on this BOQ item: the material requests' lines on it lose
   * «عيّنة قيد الاعتماد» — Procurement may order them. */
  sampleApproved?: string | null
  /** Keys merged into the project's `pm` block (a certificate's running totals, a claim's programme revision). */
  pm?: Record<string, unknown> | null
  /** prj:IPC for Finance, at the certified amount. */
  event?: PmEvent | null
  entry: Pick<PortalHistoryEntry, "kind" | "no" | "title" | "what">
}

export interface AnswerContext {
  today: string
  nowIso: string
  actor: { by: string; byName: string }
  /** What a certificate or a claim answer needs of the project, read in the same transaction. */
  project?: {
    organizationId: string
    projectId: string
    projectNo: string
    totals: { retentionHeld?: number; advanceRecovered?: number; cutPool?: number }
    /** The contract in force today (original + signed addenda). */
    termsNow: Pick<ContractTerms, "paymentDays">
    programmeRev: number
  }
}

export function recordPath(input: Pick<PortalAnswer, "kind" | "seq">): { collection: string; docId: string } {
  switch (input.kind) {
    case "subm":
      return { collection: PM_SUBMITTALS, docId: sampleNo(input.seq) }
    case "wir":
      return { collection: PM_INSPECTIONS, docId: wirNo(input.seq) }
    case "punch":
      return { collection: PM_PUNCH, docId: punchNo(input.seq) }
    case "corr":
      return { collection: PM_LETTERS, docId: letterDocId(input.seq) }
    case "ncr":
      return { collection: PM_NCRS, docId: ncrNo(input.seq) }
    case "ipc":
      return { collection: PM_CERTIFICATES, docId: certificateNo(input.seq) }
    case "claim":
      return { collection: PM_CLAIMS, docId: claimNo(input.seq) }
  }
}

type PlanResult = { ok: true; plan: AnswerPlan } | { ok: false; code: AnswerRefusal; blocks?: string[] }

const blocked = (blocks: string[]): PlanResult => ({ ok: false, code: "BLOCKED", blocks })
const notWaiting: PlanResult = { ok: false, code: "NOT_WAITING" }

export function planAnswer(input: PortalAnswer, record: Record<string, unknown> | null | undefined, ctx: AnswerContext): PlanResult {
  if (!record) return { ok: false, code: "NOT_FOUND" }
  const { today, nowIso } = ctx
  const { by, byName } = ctx.actor
  const note = "note" in input ? input.note?.trim() || null : null
  const attached = cleanAttachments(input.files)

  switch (input.kind) {
    case "subm": {
      const s = record as unknown as PmSubmittal
      if (s.status !== "sub") return notWaiting
      const blocks = sampleReplyBlocks({ archived: false, status: s.status, reply: input.decision, note: note ?? "", on: today, today, submittedOn: s.day })
      if (blocks.length) return blocked(blocks)
      return {
        ok: true,
        plan: {
          patch: { status: input.decision, reply: { on: today, by, byName, note, files: attached, recordedOn: today, viaPortal: true } },
          line: s.itemId ? { itemId: s.itemId, patch: { pmSub: input.decision } } : null,
          sampleApproved: s.itemId && (input.decision === "appA" || input.decision === "appB") ? s.itemId : null,
          entry: { kind: "subm", no: sampleNo(s.seq), title: s.what || s.code || "", what: input.decision },
        },
      }
    }
    case "wir": {
      const w = record as unknown as PmInspection
      if (w.status !== "open" || w.party !== "consultant" || !w.attempts?.length) return notWaiting
      const blocks = resultBlocks({ archived: false, status: w.status, result: input.result, note: note ?? "", on: input.on, today })
      if (blocks.length) return blocked(blocks)
      const last = w.attempts.length - 1
      const attempts = w.attempts.map((a, i) => (i === last ? { ...a, result: input.result, note, rBy: by, rByName: byName, rAt: nowIso, rOn: input.on, rFiles: attached, viaPortal: true } : a))
      return {
        ok: true,
        plan: {
          patch: { status: input.result, attempts },
          line: w.itemId ? { itemId: w.itemId, patch: { pmWir: input.result } } : null,
          entry: { kind: "wir", no: wirNo(w.seq), title: w.location, what: input.result },
        },
      }
    }
    case "punch": {
      const p = record as unknown as PunchItem
      if (p.status !== "fix" || p.source !== "cons") return notWaiting
      if (!input.accept) {
        const refused = planRefuseFix(p, note, { today, actor: { by, byName }, viaPortal: true, archived: false, files: attached })
        if (!refused.ok) return refused
        return { ok: true, plan: { patch: refused.patch, line: null, entry: { kind: "punch", no: punchNo(p.seq), title: p.what, what: "fix_rejected" } } }
      }
      const blocks = punchStepBlocks({ archived: false, status: p.status, step: "confirm", day: today, today, after: p.fix?.on ?? p.day })
      if (blocks.length) return blocked(blocks)
      return {
        ok: true,
        plan: {
          patch: { status: "done", conf: { on: today, by, byName, party: "cons", partyText: null, files: attached, viaPortal: true } },
          line: null,
          entry: { kind: "punch", no: punchNo(p.seq), title: p.what, what: "confirmed" },
        },
      }
    }
    case "corr": {
      const l = record as unknown as PmLetter
      if (l.dir !== "out" || l.party !== "cons" || !isLetterOpen(l)) return notWaiting
      const blocks = letterReplyBlocks({ archived: false, status: l.status, text: input.text, on: today, letterDay: l.day, today })
      if (blocks.length) return blocked(blocks)
      return {
        ok: true,
        plan: {
          patch: { status: "rep", reply: { text: input.text.trim(), on: today, by, byName, file: attached[0] ?? null, viaPortal: true } },
          line: null,
          entry: { kind: "corr", no: l.no, title: l.subject, what: "replied" },
        },
      }
    }
    case "ncr": {
      const n = record as unknown as PmNcr
      if (n.status !== "plan") return notWaiting
      if (!input.accept) {
        const refused = planRejectPlan(n, note, { today, actor: { by, byName }, viaPortal: true, archived: false, files: attached })
        if (!refused.ok) return refused
        return { ok: true, plan: { patch: refused.patch, line: null, entry: { kind: "ncr", no: ncrNo(n.seq), title: n.what || n.root, what: "plan_rejected" } } }
      }
      const blocks = ncrStepBlocks({ archived: false, status: n.status, step: "accept", day: today, today, after: n.plan?.on ?? n.day })
      if (blocks.length) return blocked(blocks)
      return {
        ok: true,
        plan: {
          patch: { status: "done", accepted: { on: today, by, byName, cost: null, recordedOn: today, files: attached, viaPortal: true } },
          line: null,
          entry: { kind: "ncr", no: ncrNo(n.seq), title: n.what || n.root, what: "accepted" },
        },
      }
    }
    case "ipc": {
      const c = record as unknown as PmCertificate
      if (c.status !== "sub") return notWaiting
      if (!ctx.project) return { ok: false, code: "NOT_FOUND" }
      const planned = planCertify(
        c,
        { certified: input.certified, reason: input.reason ?? null, reasonNote: input.reasonNote ?? null, consultantRef: input.consultantRef ?? null, files: attached },
        {
          today,
          nowIso,
          actor: { by, byName },
          viaPortal: true,
          organizationId: ctx.project.organizationId,
          projectId: ctx.project.projectId,
          projectNo: ctx.project.projectNo,
          totals: ctx.project.totals,
          termsNow: ctx.project.termsNow,
        }
      )
      if (!planned.ok) return planned
      return {
        ok: true,
        plan: {
          patch: planned.plan.certPatch,
          line: null,
          pm: planned.plan.pmTotals,
          event: planned.plan.event,
          entry: { kind: "ipc", no: certificateNo(c.seq), title: [c.periodFrom, c.periodTo].filter(Boolean).join(" → "), what: "certified" },
        },
      }
    }
    case "claim": {
      const c = record as unknown as PmClaim
      if (c.status !== "sub") return notWaiting
      if (!ctx.project) return { ok: false, code: "NOT_FOUND" }
      const planned = planRespond(
        c,
        { response: input.response, days: input.days ?? null, amount: input.amount ?? null, ref: input.ref ?? null, files: attached },
        { today, actor: { by, byName }, viaPortal: true, archived: false, programmeRev: ctx.project.programmeRev }
      )
      if (!planned.ok) return planned
      return {
        ok: true,
        plan: {
          patch: planned.plan.claimPatch,
          line: null,
          pm: planned.plan.revision !== null ? { programmeRev: planned.plan.revision } : null,
          entry: { kind: "claim", no: claimNo(c.seq), title: c.cause, what: `claim_${input.response}` as PortalAnswerWhat },
        },
      }
    }
  }
}

/** Every file an answer attaches must be one he uploaded through this link. */
export const filesAllowed = (attached: ReadonlyArray<Pick<PmAttachment, "url">> | undefined, uploads: PortalUpload[] | undefined) =>
  (attached ?? []).every((f) => (uploads ?? []).some((u) => u.url === f.url))

export class PortalAnswerError extends Error {
  constructor(
    readonly code: AnswerRefusal | ProjectRefusal | "LINK_REVOKED" | "LINK_EXPIRED",
    readonly blocks: string[] = []
  ) {
    super(code)
    this.name = "PortalAnswerError"
  }
}

const termsNowOf = (pm: NonNullable<PortalProjectDoc["pm"]>): ContractTerms => (pm.inForce as ContractTerms | undefined) ?? pm.original ?? pm.terms ?? defaultTerms()

/** The contract in force now — original + signed addenda, read by number in the transaction (as `readContract` does). */
async function readTermsNow(tx: Transaction, projectRef: DocumentReference, pm: NonNullable<PortalProjectDoc["pm"]>): Promise<ContractTerms> {
  const original = pm.original ?? pm.terms ?? defaultTerms()
  const addenda: PmAddendum[] = []
  for (let n = 1; n <= (pm.addendaCount ?? 0); n++) {
    const snap = await tx.get(projectRef.collection(PM_ADDENDA).doc(addendumNo(n)))
    if (snap.exists) addenda.push({ id: snap.id, ...(snap.data() as Omit<PmAddendum, "id">) })
  }
  return inForce(original, addenda)
}

export async function applyPortalAnswer(
  db: Firestore,
  linkId: string,
  input: PortalAnswer,
  now = Date.now()
): Promise<{ entry: PortalHistoryEntry; link: PmPortalLink; project: PortalProjectDoc; event: PmEvent | null }> {
  const linkRef = db.collection(PM_PORTAL_LINKS).doc(linkId)
  return db.runTransaction(async (tx) => {
    const link = (await tx.get(linkRef)).data() as PmPortalLink | undefined
    const refusal = linkRefusal(link, now)
    if (!link || refusal) throw new PortalAnswerError(refusal === "expired" ? "LINK_EXPIRED" : "LINK_REVOKED")
    const projectRef = db.collection("projects").doc(link.projectId)
    const project = (await tx.get(projectRef)).data() as PortalProjectDoc | undefined
    const closed = projectRefusal(project, link.organizationId)
    if (closed) throw new PortalAnswerError(closed)
    // A switched-off section takes its records off his page — and out of his reach.
    if (!portalKindOn(input.kind, sectionsOf(project))) throw new PortalAnswerError("NOT_WAITING")
    if (!filesAllowed(input.files, link.uploads)) throw new PortalAnswerError("BLOCKED", ["bad_file"])

    const path = recordPath(input)
    const recordRef = projectRef.collection(path.collection).doc(path.docId)
    const record = await tx.get(recordRef)
    const pm = (project as PortalProjectDoc).pm as NonNullable<PortalProjectDoc["pm"]>
    const money = input.kind === "ipc" || input.kind === "claim"
    const termsNow = input.kind === "ipc" ? await readTermsNow(tx, projectRef, pm) : null
    const nowIso = new Date(now).toISOString()
    const byName = link.consultant.name
    const result = planAnswer(input, record.exists ? (record.data() as Record<string, unknown>) : null, {
      today: riyadhDay(now),
      nowIso,
      actor: { by: `portal:${linkId}`, byName },
      project: money
        ? {
            organizationId: link.organizationId,
            projectId: link.projectId,
            projectNo: pm.no || link.projectId,
            totals: pm as { retentionHeld?: number; advanceRecovered?: number; cutPool?: number },
            termsNow: termsNow ?? termsNowOf(pm),
            programmeRev: typeof pm.programmeRev === "number" ? pm.programmeRev : 0,
          }
        : undefined,
    })
    if (!result.ok) throw new PortalAnswerError(result.code, result.blocks)

    const { plan } = result
    const lineRef = plan.line ? projectRef.collection("boqItems").doc(plan.line.itemId) : null
    const lineExists = lineRef ? (await tx.get(lineRef)).exists : false
    // The internal record of an approval lifts the mark off the live requests in
    // its own transaction (sample-writes.ts); his answer here does the same.
    const lifted: Array<{ ref: DocumentReference; items: unknown[] }> = []
    if (plan.sampleApproved) {
      const requests = await tx.get(projectRef.collection(PURCHASE_REQUESTS))
      for (const d of requests.docs ?? []) {
        const r = d.data() as { status?: string } & Parameters<typeof itemsAfterSampleApproval>[0]
        const items = r.status === "pending" || r.status === "approved" ? itemsAfterSampleApproval(r, plan.sampleApproved) : null
        if (items) lifted.push({ ref: d.ref, items })
      }
    }

    tx.update(recordRef, { ...plan.patch, updatedAt: FieldValue.serverTimestamp() })
    if (lineRef && lineExists && plan.line) tx.update(lineRef, { ...plan.line.patch, updatedAt: FieldValue.serverTimestamp() })
    for (const l of lifted) tx.update(l.ref, { items: l.items, updatedAt: FieldValue.serverTimestamp() })
    if (plan.pm) tx.update(projectRef, { pm: { ...pm, ...plan.pm }, updatedAt: FieldValue.serverTimestamp() })
    if (plan.event) tx.set(db.collection(PM_EVENTS).doc(pmEventDocId(plan.event.organizationId, plan.event.key)), plan.event)
    const entry: PortalHistoryEntry = { ...plan.entry, at: nowIso, byName }
    tx.update(linkRef, {
      history: [entry, ...(link.history ?? [])].slice(0, PORTAL_HISTORY_KEEP),
      log: appendLog(link.log, { t: "reply", at: nowIso, byName, kind: entry.kind, no: entry.no, what: entry.what }),
    })
    return { entry, link, project: project as PortalProjectDoc, event: plan.event ?? null }
  })
}

export { maskPhone }
