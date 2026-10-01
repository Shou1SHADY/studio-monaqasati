// HR 1.0 — manpower requests and coverage (PRD AS-02, WF-12). Projects asks
// (a trade, a count, from a date); HR answers with a plan whose dates are
// honest: people unassigned now → people on a site that ends within a week of
// the start → the establishment's unused visas → hire or temporary labour.
// Whoever may not work there — an expired iqama, a driver without a licence —
// is excluded BY NAME, never silently. The request is Projects'; the answer HR's.

import { collection, doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import type { HrContext } from "./access"
import { legalOnSite, mayDrive } from "./documents"
import type { HrEmployee } from "./employee"
import type { HrActor } from "./employee-writes"
import type { HrSite } from "./sites"
import { addDays } from "./statutory"
import { tradeOf } from "./trades"
import { assertHr, HrWriteError } from "./write-guard"

export const MANPOWER_REQUESTS = "manpowerRequests"

/** Visa arrival and hiring lead times, and temporary labour (Ajeer) — honest dates, the prototype's figures. */
export const COVERAGE = { siteEndingWindowDays: 7, visaLeadDays: 90, hireLeadDays: 90, ajeerLeadDays: 45, ajeerCostFactor: 1.4 }

export type CoverageSource = "unassigned" | "site_ending" | "visa" | "hire" | "ajeer"

export interface CoverageLine {
  source: CoverageSource
  count: number
  /** The first day these people can start. */
  date: string
  names?: string[]
}

export interface ManpowerRequest {
  id: string
  organizationId: string
  projectId: string
  projectName: string
  siteId: string | null
  trade: string
  count: number
  from: string
  note?: string | null
  state: "open" | "answered" | "withdrawn"
  requested: { by: string; byName: string | null; at: string }
  answer?: { plan: CoverageLine[]; excluded: Array<{ name: string; reason: string }>; note?: string | null; by: string; byName: string | null; at: string } | null
}

export function coverage(input: { trade: string; count: number; from: string; today: string; siteId: string | null; employees: HrEmployee[]; sites: HrSite[]; visas: number | null }) {
  const lines: CoverageLine[] = []
  const excluded: Array<{ name: string; reason: string }> = []
  const start = input.from > input.today ? input.from : input.today
  const drives = tradeOf(input.trade)?.drives ?? null
  const fit = (e: HrEmployee) => {
    if (!legalOnSite({ nationality: e.nationality, docs: e.docs ?? {} }, start)) return "iqama_expired"
    if (drives && !mayDrive({ docs: e.docs ?? {}, drives }, start)) return "licence_expired"
    return null
  }
  // Available: at work — or recorded ahead of a start date that has come by then
  // (the record says "expected" until someone looks) — and not already on the
  // asking workplace. A request from a project with no HR workplace carries no
  // site, and the unassigned carry none either: they are exactly who it wants.
  const atWork = (e: HrEmployee) => e.status === "active" || (e.status === "expected" && Boolean(e.join) && e.join <= start)
  const same = input.employees.filter((e) => e.trade === input.trade && atWork(e) && !(e.siteId && e.siteId === input.siteId))
  let left = input.count

  const take = (source: CoverageSource, date: string, people: HrEmployee[]) => {
    const ok: HrEmployee[] = []
    for (const e of people) {
      const why = fit(e)
      if (why) excluded.push({ name: e.names?.ar ?? "", reason: why })
      else ok.push(e)
    }
    const n = Math.min(left, ok.length)
    if (n > 0) {
      lines.push({ source, count: n, date, names: ok.slice(0, n).map((e) => e.names?.ar ?? "") })
      left -= n
    }
  }

  take("unassigned", start, same.filter((e) => !e.siteId))
  const ending = input.sites
    .filter((s) => s.type === "project" && s.endDate && s.endDate <= addDays(input.from, COVERAGE.siteEndingWindowDays) && s.id !== input.siteId)
    .sort((a, b) => (a.endDate as string).localeCompare(b.endDate as string))
  for (const s of ending) if (left > 0) take("site_ending", addDays(s.endDate as string, 1) > start ? addDays(s.endDate as string, 1) : start, same.filter((e) => e.siteId === s.id))
  if (left > 0 && (input.visas ?? 0) > 0) {
    const n = Math.min(left, input.visas as number)
    lines.push({ source: "visa", count: n, date: addDays(input.today, COVERAGE.visaLeadDays) })
    left -= n
  }
  if (left > 0) {
    lines.push({ source: "hire", count: left, date: addDays(input.today, COVERAGE.hireLeadDays) })
    lines.push({ source: "ajeer", count: left, date: addDays(input.today, COVERAGE.ajeerLeadDays) })
  }
  return { lines, excluded, covered: input.count - left }
}

export type ManpowerBlock = "no_trade" | "bad_count" | "no_date"

export function manpowerBlocks(input: { trade: string; count: number; from: string }): ManpowerBlock[] {
  const out: ManpowerBlock[] = []
  if (!tradeOf(input.trade)) out.push("no_trade")
  if (!(Number.isInteger(input.count) && input.count > 0)) out.push("bad_count")
  if (!input.from) out.push("no_date")
  return out
}

/** Projects asks (WF-12 trigger). `allowed` = the project's editor, as Projects decides it. */
export async function raiseManpowerRequest(
  firestore: Firestore,
  actor: HrActor & { allowed: boolean },
  orgId: string,
  input: { projectId: string; projectName: string; siteId: string | null; trade: string; count: number; from: string; note?: string | null }
): Promise<string> {
  if (!actor.allowed) throw new HrWriteError("no_role")
  const blocks = manpowerBlocks(input)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const ref = doc(collection(firestore, MANPOWER_REQUESTS))
  await runTransaction(firestore, async (tx) => {
    tx.set(ref, {
      organizationId: orgId,
      projectId: input.projectId,
      projectName: input.projectName,
      siteId: input.siteId,
      trade: input.trade,
      count: input.count,
      from: input.from,
      note: input.note?.trim() || null,
      state: "open",
      requested: { by: actor.uid, byName: actor.name, at: new Date().toISOString() },
      answer: null,
      updatedAt: serverTimestamp(),
    })
  })
  return ref.id
}

/** The HR manager answers with the plan (WF-12 step 2) — it goes back to Projects as it is. */
export async function answerManpowerRequest(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, answer: { plan: CoverageLine[]; excluded: Array<{ name: string; reason: string }>; note?: string | null }): Promise<void> {
  assertHr(ctx, "manpower.answer")
  await runTransaction(firestore, async (tx) => {
    const s = await tx.get(doc(firestore, MANPOWER_REQUESTS, id))
    if (!s.exists()) throw new HrWriteError("missing")
    if ((s.data() as ManpowerRequest).state !== "open") throw new HrWriteError("blocked", ["stale"])
    tx.update(doc(firestore, MANPOWER_REQUESTS, id), {
      state: "answered",
      answer: { ...answer, note: answer.note?.trim() || null, by: actor.uid, byName: actor.name, at: new Date().toISOString() },
      updatedAt: serverTimestamp(),
    })
  })
}
