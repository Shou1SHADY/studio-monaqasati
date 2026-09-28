// HR 1.0 — documents (PRD DC-01…07). A document's state is computed from its
// expiry — never typed — and a missing date stays missing. An expired iqama
// blocks assignment to a site; a passport expiring before the iqama is renewed
// first; an arrival's iqama is due in 90 days; a work injury is reported to
// GOSI within three working days. Pure: no I/O.

import { addDays, daysBetween, STATUTORY } from "./statutory"

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

export interface DocDates {
  iqama?: string | null
  passport?: string | null
  insurance?: string | null
  contract?: string | null
  licence?: string | null
  forklift?: string | null
}

/** DC-02 — may this person be placed on a site today? A Saudi has no iqama. */
export function legalOnSite(emp: { nationality: string; docs: DocDates }, today: string): boolean {
  if (emp.nationality === "sa") return true
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
