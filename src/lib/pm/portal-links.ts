// Server-only — the PM consultant portal's link (PM 1.0, the prototype's
// بوابة الاستشاري). Never import in client components.
//
// One link per project, opened with a one-time code on the consultant's
// mobile. A verified code buys a session — a random secret the browser keeps,
// stored here only as its hash, for 12 hours — and every read and answer must
// carry it. He sees what waits on him and never a price, cost or margin: the
// projection below copies named fields only, so a money field added to a
// record later cannot leak. He adds and never edits: each answer is the
// internal write re-done with the Admin SDK, checked by the same pure rules
// (the client write functions cannot run here), refused if the record no
// longer waits on him, and recorded in his name as if it came by letter — an
// inspection result moves the BOQ line's `pmWir` (measurement), a sample
// approval its `pmSub` (purchasing).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { FieldValue, type Firestore, type QuerySnapshot } from "firebase-admin/firestore"
import { maskPhone } from "@/lib/otp"
import { cleanAttachments, type PmAttachment } from "./attachments"
import { portalItems, type PortalKind } from "./consultant-portal"
import { isLetterOpen, letterDocId, PM_LETTERS, replyBlocks as letterReplyBlocks, type PmLetter } from "./correspondence"
import { PM_INSPECTIONS, resultBlocks, WIR_RESULTS, wirNo, type PmInspection } from "./inspection"
import { lifecycleOf } from "./lifecycle"
import { ncrNo, ncrStepBlocks, PM_NCRS, type PmNcr } from "./ncr"
import { PM_PUNCH, punchNo, punchStepBlocks, type PunchItem } from "./punch"
import { PM_SUBMITTALS, replyBlocks as sampleReplyBlocks, SAMPLE_REPLIES, sampleNo, type PmSubmittal } from "./sample"

export const PM_PORTAL_LINKS = "pmPortalLinks"
export const PORTAL_LINK_TTL_MS = 180 * 86_400_000
export const PORTAL_SESSION_TTL_MS = 12 * 3_600_000
export const PORTAL_MAX_SESSIONS = 10
export const PORTAL_HISTORY_KEEP = 50
export const PORTAL_HISTORY_SHOWN = 20
export const PORTAL_SESSION_HEADER = "x-portal-session"

export interface PortalSession {
  hash: string
  createdAt: string
  expiresAt: string
}

export type PortalAnswerWhat = "appA" | "appB" | "rej" | "pass" | "cond" | "fail" | "confirmed" | "fix_rejected" | "replied" | "accepted" | "plan_rejected"

/** A fix or a corrective plan the consultant refused, with his reason — kept on
 * the record so the refused step stays visible after it goes back to open. */
export interface PortalRejection {
  on: string
  by: string
  byName: string
  note: string
  /** The fix or plan he refused, as it stood. */
  refused: Record<string, unknown> | null
  viaPortal: true
}

export interface PortalHistoryEntry {
  kind: PortalKind
  no: string
  title: string
  what: PortalAnswerWhat
  at: string
  byName: string
}

export interface PmPortalLink {
  token: string
  projectId: string
  organizationId: string
  consultant: { name: string; phone: string }
  status: "open" | "revoked"
  createdById: string
  createdByName: string
  createdAt: string
  expiresAt: string
  seenAt?: string | null
  sessions?: PortalSession[]
  history?: PortalHistoryEntry[]
}

export interface PmPortalState {
  sentOn: string
  seenOn: string | null
  name: string
  phoneMasked: string
  linkId: string
  sentBy: string
  sentByName: string
}

export const createBody = z.object({
  projectId: z.string().min(1).max(128),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(30),
})

export const verifyBody = z.object({
  challengeId: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
})

const seq = z.number().int().min(1).max(99_999)
const note = z.string().trim().max(1000).optional()

// A punch fix or a corrective plan is accepted or refused; a refusal carries his reason.
export const answerBody = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("subm"), seq, decision: z.enum(SAMPLE_REPLIES), note }),
    z.object({ kind: z.literal("wir"), seq, result: z.enum(WIR_RESULTS), note, on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    z.object({ kind: z.literal("punch"), seq, accept: z.boolean(), note }),
    z.object({ kind: z.literal("corr"), seq, text: z.string().trim().min(1).max(2000) }),
    z.object({ kind: z.literal("ncr"), seq, accept: z.boolean(), note }),
  ])
  .superRefine((a, ctx) => {
    if ((a.kind === "punch" || a.kind === "ncr") && !a.accept && !a.note) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "no_note" })
  })
export type PortalAnswer = z.infer<typeof answerBody>

export const newToken = () => randomBytes(32).toString("hex")
export const isToken = (s: string | null | undefined): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s)
export const newSessionSecret = () => randomBytes(32).toString("hex")
export const hashSecret = (secret: string) => createHash("sha256").update(`pm_portal:${secret}`).digest("hex")

export function addSession(sessions: PortalSession[] | undefined, hash: string, now: number): { sessions: PortalSession[]; expiresAt: string } {
  const live = (sessions ?? []).filter((s) => Date.parse(s.expiresAt) > now)
  const expiresAt = new Date(now + PORTAL_SESSION_TTL_MS).toISOString()
  return { sessions: [...live, { hash, createdAt: new Date(now).toISOString(), expiresAt }].slice(-PORTAL_MAX_SESSIONS), expiresAt }
}

export function sessionValid(sessions: PortalSession[] | undefined, secret: string | null | undefined, now: number): boolean {
  if (!isToken(secret)) return false
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

export interface PortalProjectDoc {
  name?: string
  organizationId?: string
  projectManagerId?: string | null
  status?: string
  pm?: { no?: string | null; lifecycle?: string; portal?: PmPortalState | null } | null
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

type Resolved =
  | { ok: true; linkId: string; link: PmPortalLink }
  | { ok: false; code: "INVALID_TOKEN" | "NOT_FOUND" | "LINK_REVOKED" | "LINK_EXPIRED"; status: number }

export async function resolvePortalLink(db: Firestore, token: string, now = Date.now()): Promise<Resolved> {
  if (!isToken(token)) return { ok: false, code: "INVALID_TOKEN", status: 400 }
  const snap = await db.collection(PM_PORTAL_LINKS).where("token", "==", token).limit(1).get()
  const doc = snap.docs[0]
  const link = doc ? (doc.data() as PmPortalLink) : null
  const refusal = linkRefusal(link, now)
  if (refusal === "missing") return { ok: false, code: "NOT_FOUND", status: 404 }
  if (refusal === "revoked") return { ok: false, code: "LINK_REVOKED", status: 410 }
  if (refusal === "expired") return { ok: false, code: "LINK_EXPIRED", status: 410 }
  return { ok: true, linkId: doc.id, link: link as PmPortalLink }
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

export interface PortalSourceDocs {
  submittals: PmSubmittal[]
  inspections: PmInspection[]
  punch: PunchItem[]
  letters: PmLetter[]
  ncrs: PmNcr[]
  lines: Record<string, Record<string, unknown>>
}

export type PortalDetail =
  | { kind: "subm"; seq: number; rev: number; what: string | null; item: PortalLine | null; submittedOn: string; files: PmAttachment[] }
  | { kind: "wir"; seq: number; item: PortalLine | null; location: string; unit: string | null; attempt: number; bookedOn: string; files: PmAttachment[] }
  | { kind: "punch"; seq: number; what: string; location: string; severity: string; raisedOn: string; fixedOn: string | null; fixNote: string | null; files: PmAttachment[] }
  | { kind: "corr"; seq: number; subject: string; sentOn: string; due: number; links: string[]; files: PmAttachment[] }
  | { kind: "ncr"; seq: number; item: PortalLine | null; what: string | null; severity: string; root: string; plan: string; planOn: string | null; files: PmAttachment[] }

export interface PortalViewItem {
  kind: PortalKind
  no: string
  day: string
  title: string
  detail: PortalDetail
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")

function lineOf(lines: PortalSourceDocs["lines"], id: string | null | undefined, code?: string | null): PortalLine | null {
  const d = id ? lines[id] : undefined
  if (!d) return code ? { code, descriptionAr: "", descriptionEn: "", unit: "" } : null
  return { code: str(d.itemNo) || code || "", descriptionAr: str(d.descriptionAr), descriptionEn: str(d.descriptionEn), unit: str(d.unit) }
}

const lineTitle = (l: PortalLine | null) => (l ? [l.code, l.descriptionAr || l.descriptionEn].filter(Boolean).join(" · ") : "")
const files = (...lists: Array<ReadonlyArray<Partial<PmAttachment>> | null | undefined>) => cleanAttachments(lists.flatMap((l) => l ?? []))

export function portalView(src: PortalSourceDocs, today: string): PortalViewItem[] {
  const details = new Map<string, PortalDetail>()
  const key = (kind: PortalKind, no: string) => `${kind}:${no}`

  for (const s of src.submittals) {
    const item = lineOf(src.lines, s.itemId, s.code)
    details.set(key("subm", sampleNo(s.seq)), { kind: "subm", seq: s.seq, rev: s.rev ?? 1, what: s.what ?? null, item, submittedOn: s.day, files: files(s.files) })
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
      files: files(last?.files),
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
      files: files(p.files, p.fix?.files),
    })
  }
  for (const l of src.letters) {
    details.set(key("corr", l.no), { kind: "corr", seq: l.seq, subject: l.subject, sentOn: l.day, due: l.due, links: [...(l.links ?? [])], files: files(l.file ? [l.file] : null) })
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
      files: files(n.files, n.plan?.files),
    })
  }

  const pending = portalItems({
    submittals: src.submittals.map((s) => ({ seq: s.seq, status: s.status, day: s.day, title: s.what || lineTitle(lineOf(src.lines, s.itemId, s.code)) })),
    inspections: src.inspections.map((w) => ({ seq: w.seq, status: w.status, party: w.party, day: w.attempts?.[w.attempts.length - 1]?.on ?? today, location: w.location })),
    punch: src.punch.map((p) => ({ seq: p.seq, status: p.status, source: p.source, day: p.day, fixOn: p.fix?.on ?? null, what: p.what })),
    letters: src.letters.map((l) => ({ no: l.no, dir: l.dir, party: l.party, status: l.status, day: l.day, subject: l.subject })),
    ncrs: src.ncrs.map((n) => ({ seq: n.seq, status: n.status, day: n.day, planOn: n.plan?.on ?? null, title: n.what || n.root })),
  })
  return pending.flatMap((x) => {
    const detail = details.get(key(x.kind, x.no))
    return detail ? [{ kind: x.kind, no: x.no, day: x.day, title: x.title, detail }] : []
  })
}

export async function readPortalSources(db: Firestore, projectId: string): Promise<PortalSourceDocs> {
  const p = db.collection("projects").doc(projectId)
  const all = <T>(snap: QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
  const [subs, wirs, punch, letters, ncrs] = await Promise.all([
    p.collection(PM_SUBMITTALS).where("status", "==", "sub").get(),
    p.collection(PM_INSPECTIONS).where("status", "==", "open").get(),
    p.collection(PM_PUNCH).where("status", "==", "fix").get(),
    p.collection(PM_LETTERS).where("status", "==", "out").get(),
    p.collection(PM_NCRS).where("status", "==", "plan").get(),
  ])
  const src: PortalSourceDocs = {
    submittals: all<PmSubmittal>(subs),
    inspections: all<PmInspection>(wirs).filter((w) => w.party === "consultant"),
    punch: all<PunchItem>(punch).filter((x) => x.source === "cons"),
    letters: all<PmLetter>(letters).filter((l) => l.dir === "out" && l.party === "cons"),
    ncrs: all<PmNcr>(ncrs),
    lines: {},
  }
  const ids = [...new Set([...src.submittals.map((s) => s.itemId), ...src.inspections.map((w) => w.itemId), ...src.ncrs.map((n) => n.itemId)].filter(Boolean))]
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
  entry: Pick<PortalHistoryEntry, "kind" | "no" | "title" | "what">
}

export interface AnswerContext {
  today: string
  nowIso: string
  actor: { by: string; byName: string }
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

  switch (input.kind) {
    case "subm": {
      const s = record as unknown as PmSubmittal
      if (s.status !== "sub") return notWaiting
      const blocks = sampleReplyBlocks({ archived: false, status: s.status, reply: input.decision, note: note ?? "", on: today, today, submittedOn: s.day })
      if (blocks.length) return blocked(blocks)
      return {
        ok: true,
        plan: {
          patch: { status: input.decision, reply: { on: today, by, byName, note, files: [], recordedOn: today, viaPortal: true } },
          line: s.itemId ? { itemId: s.itemId, patch: { pmSub: input.decision } } : null,
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
      const attempts = w.attempts.map((a, i) => (i === last ? { ...a, result: input.result, note, rBy: by, rByName: byName, rAt: nowIso, rOn: input.on, rFiles: [], viaPortal: true } : a))
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
      const p = record as unknown as PunchItem & { rejects?: PortalRejection[] }
      if (p.status !== "fix" || p.source !== "cons") return notWaiting
      const blocks = punchStepBlocks({ archived: false, status: p.status, step: "confirm", day: today, today, after: p.fix?.on ?? p.day, party: "cons" })
      if (blocks.length) return blocked(blocks)
      if (!input.accept) {
        if (!note) return blocked(["no_note"])
        const reject: PortalRejection = { on: today, by, byName, note, refused: (p.fix as Record<string, unknown> | null | undefined) ?? null, viaPortal: true }
        return {
          ok: true,
          plan: {
            patch: { status: "open", fix: null, rejects: [...(p.rejects ?? []), reject] },
            line: null,
            entry: { kind: "punch", no: punchNo(p.seq), title: p.what, what: "fix_rejected" },
          },
        }
      }
      return {
        ok: true,
        plan: {
          patch: { status: "done", conf: { on: today, by, byName, party: "cons", partyText: null, files: [], viaPortal: true } },
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
          patch: { status: "rep", reply: { text: input.text.trim(), on: today, by, byName, file: null, viaPortal: true } },
          line: null,
          entry: { kind: "corr", no: l.no, title: l.subject, what: "replied" },
        },
      }
    }
    case "ncr": {
      const n = record as unknown as PmNcr & { rejects?: PortalRejection[] }
      if (n.status !== "plan") return notWaiting
      const blocks = ncrStepBlocks({ archived: false, status: n.status, step: "accept", day: today, today, after: n.plan?.on ?? n.day })
      if (blocks.length) return blocked(blocks)
      if (!input.accept) {
        if (!note) return blocked(["no_note"])
        const reject: PortalRejection = { on: today, by, byName, note, refused: (n.plan as Record<string, unknown> | null | undefined) ?? null, viaPortal: true }
        return {
          ok: true,
          plan: {
            patch: { status: "open", plan: null, rejects: [...(n.rejects ?? []), reject] },
            line: null,
            entry: { kind: "ncr", no: ncrNo(n.seq), title: n.what || n.root, what: "plan_rejected" },
          },
        }
      }
      return {
        ok: true,
        plan: {
          patch: { status: "done", accepted: { on: today, by, byName, cost: null, recordedOn: today, files: [], viaPortal: true } },
          line: null,
          entry: { kind: "ncr", no: ncrNo(n.seq), title: n.what || n.root, what: "accepted" },
        },
      }
    }
  }
}

export class PortalAnswerError extends Error {
  constructor(
    readonly code: AnswerRefusal | ProjectRefusal | "LINK_REVOKED" | "LINK_EXPIRED",
    readonly blocks: string[] = []
  ) {
    super(code)
    this.name = "PortalAnswerError"
  }
}

export async function applyPortalAnswer(
  db: Firestore,
  linkId: string,
  input: PortalAnswer,
  now = Date.now()
): Promise<{ entry: PortalHistoryEntry; link: PmPortalLink; project: PortalProjectDoc }> {
  const linkRef = db.collection(PM_PORTAL_LINKS).doc(linkId)
  return db.runTransaction(async (tx) => {
    const link = (await tx.get(linkRef)).data() as PmPortalLink | undefined
    const refusal = linkRefusal(link, now)
    if (!link || refusal) throw new PortalAnswerError(refusal === "expired" ? "LINK_EXPIRED" : "LINK_REVOKED")
    const projectRef = db.collection("projects").doc(link.projectId)
    const project = (await tx.get(projectRef)).data() as PortalProjectDoc | undefined
    const closed = projectRefusal(project, link.organizationId)
    if (closed) throw new PortalAnswerError(closed)

    const path = recordPath(input)
    const recordRef = projectRef.collection(path.collection).doc(path.docId)
    const record = await tx.get(recordRef)
    const nowIso = new Date(now).toISOString()
    const byName = link.consultant.name
    const result = planAnswer(input, record.exists ? (record.data() as Record<string, unknown>) : null, { today: riyadhDay(now), nowIso, actor: { by: `portal:${linkId}`, byName } })
    if (!result.ok) throw new PortalAnswerError(result.code, result.blocks)

    const { plan } = result
    const lineRef = plan.line ? projectRef.collection("boqItems").doc(plan.line.itemId) : null
    const lineExists = lineRef ? (await tx.get(lineRef)).exists : false

    tx.update(recordRef, { ...plan.patch, updatedAt: FieldValue.serverTimestamp() })
    if (lineRef && lineExists && plan.line) tx.update(lineRef, { ...plan.line.patch, updatedAt: FieldValue.serverTimestamp() })
    const entry: PortalHistoryEntry = { ...plan.entry, at: nowIso, byName }
    tx.update(linkRef, { history: [entry, ...(link.history ?? [])].slice(0, PORTAL_HISTORY_KEEP) })
    return { entry, link, project: project as PortalProjectDoc }
  })
}

export { maskPhone }
