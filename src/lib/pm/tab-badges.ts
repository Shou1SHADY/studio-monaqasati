// PM 1.0 — the counts on a project's sub-tabs (prototype SEGS). A badge says how
// many things on that screen wait for someone, and its tone says how bad: red
// where the prototype paints it red (a failed inspection, a stale drawing, a
// late letter, a claim whose notice window has passed, no project manager),
// amber otherwise. "!" is a state, not a number. Pure: no I/O.

import { isOpenPunch, type PunchStatus } from "./punch"
import { isLetterLate, type LetterStatus } from "./correspondence"

export interface TabBadge {
  n: number | "!"
  tone: "warn" | "bad"
}

export interface TabBadgeFacts {
  today: string
  hasManager: boolean
  liveSeats: number
  addendaDrafts?: number
  variations?: Array<{ status: string }>
  /** Open claims (not decided) and whether a draft's notice window has passed. */
  claimsOpen?: number
  claimNoticeLate?: boolean
  inspections?: Array<{ status: string }>
  punch?: Array<{ status: PunchStatus }>
  subCertificates?: Array<{ status: string }>
  staleDocuments?: number
  letters?: Array<{ status: LetterStatus; day: string; due: number }>
  closeoutOpen?: number
}

const badge = (n: number, tone: TabBadge["tone"] = "warn"): TabBadge | null => (n > 0 ? { n, tone } : null)

/** Badges by the page's tab keys; a key without a badge is absent. */
export function tabBadges(f: TabBadgeFacts): Record<string, TabBadge> {
  const out: Record<string, TabBadge | null> = {
    team: f.hasManager ? badge(f.liveSeats) : { n: "!", tone: "bad" },
    pmTerms: badge(f.addendaDrafts ?? 0),
    pmVo: badge((f.variations ?? []).filter((v) => v.status === "wait" || v.status === "draft").length),
    pmClaims: f.claimNoticeLate ? { n: "!", tone: "bad" } : badge(f.claimsOpen ?? 0),
    pmWir: badge((f.inspections ?? []).filter((w) => w.status === "open").length, (f.inspections ?? []).some((w) => w.status === "fail") ? "bad" : "warn"),
    pmPunch: badge((f.punch ?? []).filter(isOpenPunch).length),
    pmSubs: badge((f.subCertificates ?? []).filter((c) => c.status === "int").length),
    pmDocs: badge(f.staleDocuments ?? 0, "bad"),
    pmCorr: badge((f.letters ?? []).filter((l) => isLetterLate(l, f.today)).length, "bad"),
    pmClose: badge(f.closeoutOpen ?? 0),
  }
  return Object.fromEntries(Object.entries(out).filter((e): e is [string, TabBadge] => e[1] !== null))
}
