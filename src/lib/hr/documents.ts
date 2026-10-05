// HR 1.0 — documents (PRD DC-01…07). A document's state is computed from its
// expiry — never typed — and a missing date stays missing. An expired iqama
// blocks assignment to a site; a passport expiring before the iqama is renewed
// first; an arrival's iqama is due in 90 days; a work injury is reported to
// GOSI within three working days. Pure: no I/O.

import { addDays, daysBetween, STATUTORY } from "./statutory"
import { tradeOf } from "./trades"

export const DOC_TYPES = ["iqama", "passport", "insurance", "contract", "licence", "forklift"] as const
export type DocType = (typeof DOC_TYPES)[number]

export type DocState = "missing" | "valid" | "d60" | "d30" | "expired"

/** DC-01 — expired · within 30 · within the renewal window (60) · valid · missing. */
export function docState(expiry: string | null | undefined, today: string, renewWindowDays = 60): DocState {
  if (!expiry) return "missing"
  const left = daysBetween(today, expiry)
  if (left < 0) return "expired"
  if (left <= 30) return "d30"
  if (left <= renewWindowDays) return "d60"
  return "valid"
}

/** The numbers on a person's documents (EM-01) — kept INSIDE `docs` so government relations, who may change
 * `docs` and nothing else, records them with the renewal. The iqama / national ID number is `idNo` on the card;
 * `gosi` is the GOSI subscriber number. */
export interface DocNumbers {
  passport?: string | null
  insurance?: string | null
  licence?: string | null
  gosi?: string | null
}
export const DOC_NUMBER_KEYS = ["passport", "insurance", "licence", "gosi"] as const
export type DocNumberKey = (typeof DOC_NUMBER_KEYS)[number]

export interface DocDates {
  iqama?: string | null
  passport?: string | null
  insurance?: string | null
  /** A fixed-term contract's end — a mirror of `contract.end`, written with it (create, renewal). */
  contract?: string | null
  licence?: string | null
  forklift?: string | null
  no?: DocNumbers | null
}

/** DC-05 — a visa arrival whose iqama was not issued within 90 days of arriving (the join day). */
export function iqamaOverdue(emp: { nationality: string; docs: DocDates; source?: string | null; join?: string | null }, today: string): boolean {
  return emp.nationality !== "sa" && !emp.docs.iqama && emp.source === "visa" && Boolean(emp.join) && today > iqamaDueBy(emp.join as string)
}

/** DC-02 — may this person be placed on a site today? A Saudi has no iqama. An
 * expired iqama is not legal on a site — nor is an arrival's that was never
 * issued once its 90 days have run (DC-05). A date simply not recorded for
 * anyone else stays a blank, not a block. */
export function legalOnSite(emp: { nationality: string; docs: DocDates; source?: string | null; join?: string | null }, today: string): boolean {
  if (emp.nationality === "sa") return true
  if (iqamaOverdue(emp, today)) return false
  return docState(emp.docs.iqama, today) !== "expired"
}

/** DC-06 — an expired licence (or forklift permit) blocks driving work only. */
export function mayDrive(emp: { docs: DocDates; drives?: "licence" | "forklift" | null }, today: string): boolean {
  if (!emp.drives) return true
  return docState(emp.docs[emp.drives], today) !== "expired"
}

/** DC-03 — the passport must be renewed first when it expires before the iqama
 * and the iqama is due within 180 days. */
export function passportFirst(docs: DocDates, today: string): boolean {
  if (!docs.passport || !docs.iqama) return false
  return docs.passport < docs.iqama && daysBetween(today, docs.iqama) <= 180
}

/** DC-04 — the renewal order for one person: passport → insurance → iqama. */
export const RENEWAL_ORDER: DocType[] = ["passport", "insurance", "iqama"]

/** DC-05 — an arrival's iqama must be issued within 90 days. */
export const iqamaDueBy = (arrival: string) => addDays(arrival, STATUTORY.iqamaIssueDays)

/** DC-07 — the GOSI injury report is due three WORKING days after the injury
 * (Friday and Saturday are the Saudi weekend). */
export function injuryReportDue(injuredOn: string): string {
  let d = injuredOn
  let left = STATUTORY.injuryReportWorkingDays
  while (left > 0) {
    d = addDays(d, 1)
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay()
    if (wd !== 5 && wd !== 6) left -= 1
  }
  return d
}

// ---------------------------------------------------------------------------
// The documents a person holds (DC-01, the prototype's `docs(e)`)
// ---------------------------------------------------------------------------

type DocHolder = { nationality: string; trade?: string | null; docs?: DocDates | null; contract?: { type: "open" | "fixed"; end?: string | null } | null; source?: string | null; join?: string | null }

/** The document that gates a trade's driving work (DC-06): a driver's licence, a forklift permit — or none. */
export const driveDocOf = (trade: string | null | undefined): "licence" | "forklift" | null => tradeOf(trade)?.drives ?? null

/** The dates as every reader should see them: the contract's end from the contract itself when it is fixed-term
 * (a record from before the mirror was written has `contract.end` only), none when open-ended. */
export function docsOf(emp: Pick<DocHolder, "docs" | "contract">): DocDates {
  const d: DocDates = { ...(emp.docs ?? {}) }
  d.contract = emp.contract?.type === "fixed" ? (emp.contract.end ?? d.contract ?? null) : null
  return d
}

export interface DocRow {
  type: DocType
  expiry: string | null
  state: DocState
  /** An open-ended contract — nothing expires. */
  open?: boolean
  /** A visa arrival's iqama not issued yet: due by this day (DC-05). */
  pendingDue?: string | null
}

/** One row per document the person holds: no iqama for a Saudi; a licence or forklift permit only for a trade
 * that drives; the contract from the contract (open-ended = nothing expires). A visa arrival's iqama not issued
 * yet reads "not issued" — within the renewal window until its 90 days run, expired after. */
export function docRows(emp: DocHolder, today: string, renewWindowDays = 60): DocRow[] {
  const docs = docsOf(emp)
  const drives = driveDocOf(emp.trade)
  const out: DocRow[] = []
  for (const type of DOC_TYPES) {
    if (type === "iqama" && emp.nationality === "sa") continue
    if ((type === "licence" || type === "forklift") && drives !== type) continue
    if (type === "contract") {
      if (emp.contract?.type !== "fixed") out.push({ type, expiry: null, state: "valid", open: true })
      else out.push({ type, expiry: docs.contract ?? null, state: docState(docs.contract, today, renewWindowDays) })
      continue
    }
    const expiry = docs[type] ?? null
    if (type === "iqama" && !expiry && emp.source === "visa" && emp.join) {
      const due = iqamaDueBy(emp.join)
      out.push({ type, expiry: null, state: today > due ? "expired" : "d60", pendingDue: due })
      continue
    }
    out.push({ type, expiry, state: docState(expiry, today, renewWindowDays) })
  }
  return out
}

/** Worst first (the prototype's `dRank`): expired · within 30 · within the window · valid / missing. */
export const DOC_RANK: Record<DocState, number> = { expired: 3, d30: 2, d60: 1, valid: 0, missing: 0 }

/** The person's worst document — null when every one is in order (the list's «سليمة»). */
export function worstDoc(rows: readonly DocRow[]): DocRow | null {
  let w: DocRow | null = null
  for (const r of rows) if (DOC_RANK[r.state] > 0 && (!w || DOC_RANK[r.state] > DOC_RANK[w.state])) w = r
  return w
}

/** A non-Saudi's medical-insurance class — labour C, staff B (the prototype's rule); a Saudi has none here. */
export const medicalClass = (emp: { nationality: string; category: "labour" | "staff" }): "B" | "C" | null => (emp.nationality === "sa" ? null : emp.category === "labour" ? "C" : "B")

// ---------------------------------------------------------------------------
// Banks (PY-03, PY-07): the bank of a Saudi IBAN is its two-digit code after the check digits
// ---------------------------------------------------------------------------

/** SAMA bank codes (SA·kk·BB…) — the names live in the message files (`Portal.HR.bank.<code>`). */
export const SA_BANKS = ["80", "10", "20", "45", "05", "15", "30", "55", "60", "65"] as const
export type SaBank = (typeof SA_BANKS)[number]

/** A Saudi IBAN: SA and 22 digits (the check `fixIban` and the import use). */
export const IBAN_RE = /^SA\d{22}$/
export const cleanIban = (iban: string) => iban.replace(/\s+/g, "").toUpperCase()

/** The bank an IBAN belongs to — null when the code is not one we name. */
export function bankOfIban(iban: string | null | undefined): SaBank | null {
  const c = iban ? cleanIban(iban) : ""
  if (!IBAN_RE.test(c)) return null
  const code = c.slice(4, 6)
  return (SA_BANKS as readonly string[]).includes(code) ? (code as SaBank) : null
}
