// PM 1.0 → 1.1 — the consultant portal (the prototype's بوابة الاستشاري). One
// link per project, a one-time code on his representative's mobile (the
// project's details hold it, PRJ-01), he adds and never edits, and he never
// sees a price — only the contract rates and amounts on a certificate (CP-11).
// Three states, not two: sent · opened · answered — "opened" is what ends "I
// never got it". What he is waiting on comes from seven sources (CP-06): samples
// with him, open inspections booked with him, punch items he raised that are
// fixed and await his confirmation, our letters to him with no reply,
// corrective plans awaiting his acceptance, certificates submitted to him and
// claims submitted to him — each only while its section is on. Oldest first;
// over 10 days is red. Pure: no I/O.

import type { PmAttachment } from "./attachments"
import { isLetterOpen, type LetterDir, type LetterParty, type LetterStatus } from "./correspondence"
import { pmTabVisible } from "./sections"
import type { SectionId } from "../project-sections"

export type PortalKind = "subm" | "wir" | "punch" | "corr" | "ncr" | "ipc" | "claim"

/** Every kind, in the order his page groups them. */
export const PORTAL_KINDS: readonly PortalKind[] = ["subm", "wir", "punch", "corr", "ncr", "ipc", "claim"]

/** The section each source lives in: a switched-off section takes its records off his page (CP-06). */
export const PORTAL_SECTION: Record<PortalKind, SectionId> = { subm: "subm", wir: "qa", punch: "qa", ncr: "qa", corr: "corr", ipc: "ipc", claim: "claim" }

export interface PortalItem {
  kind: PortalKind
  /** The record's number as its own screen shows it (NN, or the letter's "014/023"). */
  no: string
  day: string
  title: string
}

export const PORTAL_LATE_DAYS = 10
/** A link sent and not opened this many days while something waits on him is a decision (CP-13). */
export const PORTAL_UNOPENED_DAYS = 3

export interface PortalSources {
  submittals: Array<{ seq: number; status: string; day: string; title: string }>
  inspections: Array<{ seq: number; status: string; party: string; day: string; location: string }>
  punch: Array<{ seq: number; status: string; source: string; day: string; fixOn?: string | null; what: string }>
  letters: Array<{ no: string; dir: LetterDir; party: LetterParty; status: LetterStatus; day: string; subject: string }>
  ncrs: Array<{ seq: number; status: string; day: string; planOn?: string | null; title: string }>
  /** Certificates: `sub` = submitted to him (the day it went is `apprOn`). */
  certificates?: Array<{ seq: number; status: string; apprOn?: string | null; prepOn?: string | null; title?: string }>
  /** Claims: `sub` = the detailed submission is with him. */
  claims?: Array<{ seq: number; status: string; submittedOn?: string | null; eventOn?: string | null; cause: string }>
  /** The project's switched-on sections; absent = every source applies. */
  sections?: readonly string[] | null
}

const nn = (seq: number) => String(seq).padStart(2, "0")

/** Whether a source shows on his page: its section is on (the same test the project's tabs use). */
export const portalKindOn = (kind: PortalKind, sections: readonly string[] | null | undefined) => !sections || pmTabVisible(sections as readonly SectionId[], PORTAL_SECTION[kind], 0)

export function portalItems(s: PortalSources): PortalItem[] {
  const out: PortalItem[] = [
    ...s.submittals.filter((x) => x.status === "sub").map((x) => ({ kind: "subm" as const, no: nn(x.seq), day: x.day, title: x.title })),
    ...s.inspections.filter((x) => x.status === "open" && x.party === "consultant").map((x) => ({ kind: "wir" as const, no: nn(x.seq), day: x.day, title: x.location })),
    ...s.punch.filter((x) => x.status === "fix" && x.source === "cons").map((x) => ({ kind: "punch" as const, no: nn(x.seq), day: x.fixOn ?? x.day, title: x.what })),
    ...s.letters.filter((x) => x.dir === "out" && x.party === "cons" && isLetterOpen(x)).map((x) => ({ kind: "corr" as const, no: x.no, day: x.day, title: x.subject })),
    ...s.ncrs.filter((x) => x.status === "plan").map((x) => ({ kind: "ncr" as const, no: nn(x.seq), day: x.planOn ?? x.day, title: x.title })),
    ...(s.certificates ?? []).filter((x) => x.status === "sub").map((x) => ({ kind: "ipc" as const, no: nn(x.seq), day: x.apprOn ?? x.prepOn ?? "", title: x.title ?? "" })),
    ...(s.claims ?? []).filter((x) => x.status === "sub").map((x) => ({ kind: "claim" as const, no: nn(x.seq), day: x.submittedOn ?? x.eventOn ?? "", title: x.cause })),
  ]
  return out.filter((x) => portalKindOn(x.kind, s.sections)).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

export const portalAge = (day: string, today: string) => {
  const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`)) / 86_400_000)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

/** A fix or a corrective plan the consultant refused, with his reason — kept on
 * the record so the refused step stays visible after it goes back to open. By
 * the portal (`viaPortal: true`, in his name) or recorded from his letter by
 * quality (`viaPortal: false`, in the recorder's name — PN-04 / NCR-02). */
export interface PortalRejection {
  on: string
  by: string
  byName: string
  note: string
  /** The fix or plan he refused, as it stood. */
  refused: Record<string, unknown> | null
  viaPortal: boolean
  /** The day it was recorded, when recorded from his letter. */
  recordedOn?: string | null
  files?: PmAttachment[]
}

/** The project's record of the link (`pm.portal`) — what the panel's three gates and the decisions read. */
export interface PmPortalState {
  sentOn: string
  seenOn: string | null
  name: string
  phoneMasked: string
  linkId: string
  sentBy: string
  sentByName: string
  /** How many times the link was sent (a resend is a new code on the same link, CP-03). */
  sends?: number
}

/** The consultant's representative on the project (PRJ-01): the portal link goes to his mobile. */
export interface ConsultantRep {
  name: string | null
  /** E.164 (+9665XXXXXXXX). */
  phone: string | null
  email: string | null
}

/** Where his certification stands for the "certificate with the consultant" decision (CP-13). */
export type PortalLinkState = "letter" | "unsent" | "sent" | "seen"

export function portalLinkState(input: { consultant?: string | null; portal?: Pick<PmPortalState, "sentOn" | "seenOn"> | null }): PortalLinkState {
  if (!input.consultant?.trim()) return "letter"
  if (!input.portal?.sentOn) return "unsent"
  return input.portal.seenOn ? "seen" : "sent"
}
