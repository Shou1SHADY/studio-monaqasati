// PM 1.0 — the consultant portal (the prototype's بوابة الاستشاري; PRD lists it
// as "built as a preview only; needs real authentication"). One link per
// project, a one-time code on his phone, he adds and never edits, and he never
// sees a price. Three states, not two: sent · opened · answered — "opened" is
// what ends "I never got it". What he is waiting on comes from five sources:
// samples with him, open inspections booked with him, punch items he raised that are fixed and
// await his confirmation, our letters to him with no reply, and corrective
// plans awaiting his acceptance. Oldest first; over 10 days is red. Pure: no I/O.

import { isLetterOpen, type LetterDir, type LetterParty, type LetterStatus } from "./correspondence"

export type PortalKind = "subm" | "wir" | "punch" | "corr" | "ncr"

export interface PortalItem {
  kind: PortalKind
  /** The record's number as its own screen shows it (NN, or the letter's "014/023"). */
  no: string
  day: string
  title: string
}

export const PORTAL_LATE_DAYS = 10

export interface PortalSources {
  submittals: Array<{ seq: number; status: string; day: string; title: string }>
  inspections: Array<{ seq: number; status: string; party: string; day: string; location: string }>
  punch: Array<{ seq: number; status: string; source: string; day: string; fixOn?: string | null; what: string }>
  letters: Array<{ no: string; dir: LetterDir; party: LetterParty; status: LetterStatus; day: string; subject: string }>
  ncrs: Array<{ seq: number; status: string; day: string; planOn?: string | null; title: string }>
}

const nn = (seq: number) => String(seq).padStart(2, "0")

export function portalItems(s: PortalSources): PortalItem[] {
  const out: PortalItem[] = [
    ...s.submittals.filter((x) => x.status === "sub").map((x) => ({ kind: "subm" as const, no: nn(x.seq), day: x.day, title: x.title })),
    ...s.inspections.filter((x) => x.status === "open" && x.party === "consultant").map((x) => ({ kind: "wir" as const, no: nn(x.seq), day: x.day, title: x.location })),
    ...s.punch.filter((x) => x.status === "fix" && x.source === "cons").map((x) => ({ kind: "punch" as const, no: nn(x.seq), day: x.fixOn ?? x.day, title: x.what })),
    ...s.letters.filter((x) => x.dir === "out" && x.party === "cons" && isLetterOpen(x)).map((x) => ({ kind: "corr" as const, no: x.no, day: x.day, title: x.subject })),
    ...s.ncrs.filter((x) => x.status === "plan").map((x) => ({ kind: "ncr" as const, no: nn(x.seq), day: x.planOn ?? x.day, title: x.title })),
  ]
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

export const portalAge = (day: string, today: string) => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day.slice(0, 10)}T00:00:00Z`)) / 86_400_000))
