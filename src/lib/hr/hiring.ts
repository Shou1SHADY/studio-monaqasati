// HR 1.0 — hiring and onboarding (PRD HI-01…09, WF-17, WF-18; optional: `hire`).
//
// An opening is born from a fact (HI-01): the remainder of a manpower request
// HR chose to cover by hiring (opened with the answer, no approval), an exit
// (a suggestion — nothing opens by itself; a replacement needs no approval),
// or a new position, which management approves first when the company's
// policy says so (ST-03, block or warning). Two tracks (HI-02): individuals —
// candidate → interview → offer → accepted → joined — and a recruitment batch
// from abroad — agency authorised → trade test → visas issued → arrival. Every
// opening carries an HONEST date (HI-03), derived from its furthest stage,
// never typed. Offers sit in the trade's band, 90–120% of its reference wage
// (HI-05); above it goes to management under the strict policy. Saudi-only
// trades take no non-Saudi candidate (HI-08).
//
// Visas (HI-07, the owner's default 11): issuing a batch's visas takes them out
// of the establishment's unused balance at once and they become an ISSUED LOT
// of that trade with its arrival date — the manpower coverage offers the lot at
// that date. An arrival from the batch spends one visa of the lot, never the
// balance again, so no visa is counted twice. A single visa arrival outside a
// batch still spends one of the balance (employee-writes.ts).
//
// One collection, `hrHiring`, with a `kind`: `opening` (with its batch),
// `candidate`, and `offer` — the candidate's money (expected pay and the
// offered basic), apart, readable only by pay roles (RL-03), so government
// relations works the pipeline and converts without seeing an amount. `pay`
// says which a document is, for the rules. Pure: no I/O.

import { lineManagerChain } from "./employee"
import type { HrEmployee } from "./employee"
import { iqamaDueBy } from "./documents"
import { payFromBasic, wageOf, gosiRates } from "./pay"
import { addDays, daysBetween, type HrPolicies } from "./statutory"
import { NITAQAT_MIN_BASIC, tradeOf } from "./trades"
/** The recruitment lead from the agency's authorisation — the same figure as the manpower coverage's visa lead. */
export const VISA_LEAD_DAYS = 90

/** `hrHiring/{id}` — openings, candidates and the candidates' money (`{candidateId}__pay`). */
export const HR_HIRING = "hrHiring"

/** The yearly sequence of openings (`JOB-2026/007` in `mfgCounters`), shown «ش» in Arabic. */
export const OPENING_NUMBER_TYPE = "JOB"
export const openingNo = (no: string | null | undefined, locale: string) => (!no ? "" : locale === "ar" ? no.replace(/^JOB-(?=\d{4}\/)/, "ش-") : no)

export const OPENING_STATES = ["wait", "open", "filled", "closed"] as const
export type OpeningState = (typeof OPENING_STATES)[number]
/** Where an opening came from: a manpower request's remainder · a replacement for an exit · a new position. */
export type OpeningSource = "mr" | "rep" | "new"
export type HireTrack = "ind" | "batch"

export const BATCH_STAGES = ["auth", "test", "visa", "arr"] as const
export type BatchStage = (typeof BATCH_STAGES)[number]

export interface Stamp {
  by: string
  byName: string | null
  at: string
}

/** The recruitment batch on its opening (WF-18). `visas` = the issued lot still to arrive; `reserved` = of those,
 * promised to manpower plans (an arrival takes a reservation back). */
export interface VisaBatch {
  stage: BatchStage
  agency: string | null
  nat: string | null
  /** Passed the trade test — before the visa, not after arrival. */
  sel: number | null
  /** Expected arrival, set when the visas are issued. */
  eta: string | null
  issued: number
  visas: number
  reserved: number
}

export interface Opening {
  id: string
  organizationId: string
  kind: "opening"
  pay: false
  no: string
  trade: string
  q: number
  siteId: string | null
  /** Needed by. */
  need: string
  src: OpeningSource
  /** The manpower request or the leaving employee it answers. */
  ref: string | null
  /** What `ref` names, for reading (the request's number, the leaver's name). */
  refLabel?: string | null
  track: HireTrack
  state: OpeningState
  filled: number
  why: string | null
  opened: Stamp
  okBy?: Stamp | null
  closedBy?: Stamp | null
  batch?: VisaBatch | null
}

export const CANDIDATE_STAGES = ["new", "int", "offer", "acc", "hired", "rej"] as const
export type CandidateStage = (typeof CANDIDATE_STAGES)[number]
/** The pipeline's active stages, nearest first (the prototype's SORD). */
export const ACTIVE_STAGES = ["new", "int", "offer", "acc"] as const
/** `link` arrives only through the apply link (HI-09, not built). */
export const CANDIDATE_SOURCES = ["ref", "agency", "walk", "file", "link"] as const
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number]
export const CONTRACT_TERMS = ["open", "y1", "y2"] as const
export type ContractTerm = (typeof CONTRACT_TERMS)[number]
export type RejectWhy = "rejected" | "not_recommended" | "declined"

export interface Scorecard extends Stamp {
  /** Technical ability (labour: the practical trade test) · experience in similar work · discipline — 1 to 5. */
  t: number
  x: number
  b: number
  rec: boolean
  note: string | null
}

/** The offer's terms — no amount here (the basic is on the pay document). `over`: above the band when made. */
export interface OfferTerms extends Stamp {
  start: string
  until: string
  ct: ContractTerm
  state: "mg" | "sent" | "acc" | "dec"
  over: boolean
  okBy?: Stamp | null
}

export interface Candidate {
  id: string
  organizationId: string
  kind: "candidate"
  pay: false
  openingId: string
  trade: string
  siteId: string | null
  names: { ar: string; en: string | null }
  nat: string
  gender: "m" | "f"
  src: CandidateSource
  phone: string | null
  stage: CandidateStage
  added: Stamp
  intAt: string | null
  sc: Scorecard | null
  offer: OfferTerms | null
  why: RejectWhy | null
  employeeId: string | null
}

/** `{candidateId}__pay` — a candidate's money, for pay roles only (RL-03). */
export interface CandidatePay {
  id: string
  organizationId: string
  kind: "offer"
  pay: true
  candidateId: string
  openingId: string
  ask: number | null
  basic: number | null
}

export const candidatePayId = (candidateId: string) => `${candidateId}__pay`

/** The employee record as hiring leaves it: where he came from and the onboarding ticks (HI-06). */
export type HiredEmployee = HrEmployee & {
  hiredFrom?: { openingId: string; no: string; candidateId: string | null } | null
  onb?: Partial<Record<OnboardingTick, Stamp>> | null
}

// ---------------------------------------------------------------------------
// Bands and costs (HI-05)
// ---------------------------------------------------------------------------

export const isLabour = (trade: string) => tradeOf(trade)?.category === "labour"
export const defaultTrack = (trade: string): HireTrack => (isLabour(trade) ? "batch" : "ind")

const to50 = (n: number) => Math.round(n / 50) * 50

/** The trade's band for the basic: 90–120% of its reference wage (the company's policy), to the nearest 50. */
export function bandOf(trade: string, policies: Pick<HrPolicies, "offerBandLow" | "offerBandHigh">): [number, number] | null {
  const ref = tradeOf(trade)?.ref
  if (!ref) return null
  return [to50(ref * policies.offerBandLow), to50(ref * policies.offerBandHigh)]
}

/** A new position's cost a month, roughly: the reference wage with allowances, loaded by 12% (the prototype's
 * ×1.35 × 1.12, with the company's own allowances), times the count. */
export function positionCost(trade: string, q: number, policies: Pick<HrPolicies, "housingShare" | "transportShare">): number {
  const ref = tradeOf(trade)?.ref ?? 0
  return Math.round(ref * (1 + policies.housingShare + policies.transportShare) * 1.12) * Math.max(1, q)
}

/** The offer as the person and the company see it: the monthly wage (basic + automatic allowances) and the
 * company's cost with the employer's GOSI (a joiner from now — the new scheme for a Saudi) and the end-of-service
 * accrual (half a month a year under five years). */
export function offerFigures(basic: number, nat: string, policies: Pick<HrPolicies, "housingShare" | "transportShare">, start: string) {
  const parts = payFromBasic(basic, policies)
  const wage = wageOf(parts)
  const gosi = gosiRates(nat, start).employer * (parts.basic + parts.housing)
  return { wage, cost: Math.round(wage + gosi + wage / 24) }
}

// ---------------------------------------------------------------------------
// The honest date (HI-03)
// ---------------------------------------------------------------------------

export const openingLeft = (o: Pick<Opening, "q" | "filled">) => Math.max(0, o.q - (o.filled ?? 0))
export const candidatesOf = (o: Pick<Opening, "id">, candidates: readonly Candidate[]) => candidates.filter((c) => c.openingId === o.id)
export const activeCandidate = (c: Pick<Candidate, "stage">) => c.stage !== "rej" && c.stage !== "hired"

/** The individuals track's estimate with nobody past the interview (the prototype's figure). */
export const IND_LEAD_DAYS = 45
export type EtaWhy = BatchStage | "accepted" | "offer" | "interviews" | "none"

/** When the opening will really be filled: a batch by its stage (arrived · the visas' arrival date · ~75 days
 * from the test · the recruitment lead from authorisation); individuals by the furthest candidate (the latest
 * accepted start · an offer out + three weeks · interviews + a month · otherwise 45 days). */
export function openingEta(o: Pick<Opening, "id" | "track" | "batch">, candidates: readonly Candidate[], today: string): { date: string; why: EtaWhy } {
  if (o.track === "batch") {
    const s = o.batch?.stage ?? "auth"
    const date = s === "arr" ? today : s === "visa" ? (o.batch?.eta ?? addDays(today, 30)) : s === "test" ? addDays(today, 75) : addDays(today, VISA_LEAD_DAYS)
    return { date, why: s }
  }
  const mine = candidatesOf(o, candidates)
  const acc = mine.filter((c) => c.stage === "acc" && c.offer?.start).map((c) => c.offer!.start).sort()
  if (acc.length) return { date: acc[acc.length - 1], why: "accepted" }
  if (mine.some((c) => c.stage === "offer")) return { date: addDays(today, 21), why: "offer" }
  if (mine.some((c) => c.stage === "int")) return { date: addDays(today, 30), why: "interviews" }
  return { date: addDays(today, IND_LEAD_DAYS), why: "none" }
}

/** Days an open opening will miss its date by (0 = on time). One waiting for management is not late yet. */
export function openingLate(o: Pick<Opening, "id" | "track" | "batch" | "state" | "need">, candidates: readonly Candidate[], today: string): number {
  if (o.state !== "open") return 0
  return Math.max(0, daysBetween(o.need, openingEta(o, candidates, today).date))
}

/** HI-03 — opening it now already misses the date by this many days (the track's lead from today). */
export function leadShortfall(need: string, track: HireTrack, today: string): number {
  const lead = track === "batch" ? VISA_LEAD_DAYS : IND_LEAD_DAYS
  const days = daysBetween(today, need)
  return days < lead ? lead - days : 0
}

/** A candidate waiting on the HR manager's hand: to screen, to interview or score, accepted and not converted. */
export const waitsOnUs = (c: Pick<Candidate, "stage">) => c.stage === "new" || c.stage === "int" || c.stage === "acc"

// ---------------------------------------------------------------------------
// Saudization (HI-05, ST-04) — before the offer, not after
// ---------------------------------------------------------------------------

const atWork = (e: Pick<HrEmployee, "status">) => e.status !== "left" && e.status !== "expected"
const pct1 = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0)

export function saudiPct(employees: ReadonlyArray<Pick<HrEmployee, "nationality" | "status">>): number {
  const live = employees.filter(atWork)
  return pct1(live.filter((e) => e.nationality === "sa").length, live.length)
}

/** The ratio if one more person of this nationality joins. */
export function saudiPctAfter(employees: ReadonlyArray<Pick<HrEmployee, "nationality" | "status">>, nat: string): number {
  const live = employees.filter(atWork)
  return pct1(live.filter((e) => e.nationality === "sa").length + (nat === "sa" ? 1 : 0), live.length + 1)
}

/** If every accepted candidate joins and every open batch arrives (batches are non-Saudi). */
export function saudiPctProjected(employees: ReadonlyArray<Pick<HrEmployee, "nationality" | "status">>, candidates: readonly Candidate[], openings: readonly Opening[]): number {
  const live = employees.filter(atWork)
  const acc = candidates.filter((c) => c.stage === "acc")
  const batch = openings.filter((o) => o.track === "batch" && o.state === "open").reduce((s, o) => s + openingLeft(o), 0)
  return pct1(live.filter((e) => e.nationality === "sa").length + acc.filter((c) => c.nat === "sa").length, live.length + acc.length + batch)
}

// ---------------------------------------------------------------------------
// Blocks — the forms show them live, the writes run them again
// ---------------------------------------------------------------------------

export type OpeningBlock = "no_trade" | "bad_count" | "no_site" | "no_need"

export function openingBlocks(input: { trade: string; q: number; siteId: string | null; need: string }): OpeningBlock[] {
  const out: OpeningBlock[] = []
  if (!tradeOf(input.trade)) out.push("no_trade")
  if (!(Number.isInteger(input.q) && input.q > 0)) out.push("bad_count")
  if (!input.siteId) out.push("no_site")
  if (!input.need) out.push("no_need")
  return out
}

export type CandidateBlock = "no_name" | "saudi_only" | "bad_ask"

export function candidateBlocks(input: { nameAr: string; nameEn: string | null; nat: string; trade: string; ask: number | null }): CandidateBlock[] {
  const out: CandidateBlock[] = []
  if (!input.nameAr.trim() && !input.nameEn?.trim()) out.push("no_name")
  if (tradeOf(input.trade)?.saudiOnly && input.nat !== "sa") out.push("saudi_only")
  if (input.ask != null && !(input.ask > 0)) out.push("bad_ask")
  return out
}

export type ScoreBlock = "no_scores" | "no_rec"
const rating = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5

export function scoreBlocks(input: { t: number | null; x: number | null; b: number | null; rec: boolean | null }): ScoreBlock[] {
  const out: ScoreBlock[] = []
  if (!rating(input.t) || !rating(input.x) || !rating(input.b)) out.push("no_scores")
  if (input.rec == null) out.push("no_rec")
  return out
}

export const scoreAvg = (sc: Pick<Scorecard, "t" | "x" | "b">) => Math.round(((sc.t + sc.x + sc.b) / 3) * 10) / 10

export type OfferBlock = "bad_basic" | "no_start" | "no_until" | "until_past"
export type OfferWarning = "above_band" | "saudi_below_nitaqat" | "start_after_need"

export function offerCheck(input: { basic: number | null; start: string; until: string; nat: string; trade: string; need: string }, policies: HrPolicies, today: string): { blocks: OfferBlock[]; warnings: OfferWarning[]; over: boolean; held: boolean } {
  const blocks: OfferBlock[] = []
  const warnings: OfferWarning[] = []
  const b = input.basic ?? 0
  if (!(b > 0)) blocks.push("bad_basic")
  if (!input.start) blocks.push("no_start")
  if (!input.until) blocks.push("no_until")
  else if (input.until < today) blocks.push("until_past")
  const band = bandOf(input.trade, policies)
  const over = Boolean(band && b > band[1])
  if (over) warnings.push("above_band")
  if (input.nat === "sa" && b > 0 && b < NITAQAT_MIN_BASIC) warnings.push("saudi_below_nitaqat")
  if (input.start && input.need && input.start > input.need) warnings.push("start_after_need")
  return { blocks, warnings, over, held: over && policies.offerBand === "block" }
}

export type BatchBlock = "no_agency" | "bad_sel" | "not_enough_visas" | "no_eta" | "no_names" | "too_many" | "done"

/** One step of a batch (WF-18): authorised (agency, nationality, how many passed the trade test) → visas issued
 * (the establishment's free visas must cover what is left — we never invent a visa that was not issued) →
 * arrivals by name (no more than the batch has left). */
export function batchBlocks(o: Pick<Opening, "q" | "filled" | "batch">, input: { agency?: string; sel?: number | null; eta?: string | null; names?: string[] }, freeVisas: number): BatchBlock[] {
  const stage = o.batch?.stage ?? "auth"
  const out: BatchBlock[] = []
  if (stage === "auth") {
    if (!input.agency?.trim()) out.push("no_agency")
    if (input.sel != null && !(Number.isInteger(input.sel) && input.sel >= 0)) out.push("bad_sel")
  } else if (stage === "test") {
    if (freeVisas < openingLeft(o)) out.push("not_enough_visas")
    if (!input.eta) out.push("no_eta")
  } else {
    const n = input.names?.length ?? 0
    if (!openingLeft(o) || !(o.batch?.visas ?? 0)) out.push("done")
    else if (!n) out.push("no_names")
    else if (n > Math.min(openingLeft(o), o.batch?.visas ?? 0)) out.push("too_many")
  }
  return out
}

export const arrivalNames = (text: string) =>
  text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)

// ---------------------------------------------------------------------------
// Visa lots — what coverage offers (AS-02 × HI-07)
// ---------------------------------------------------------------------------

export interface VisaLot {
  openingId: string
  no: string
  trade: string
  nat: string | null
  eta: string
  /** Issued, not yet arrived, not promised to a plan. */
  free: number
}

export function visaLots(openings: readonly Opening[]): VisaLot[] {
  return openings
    .filter((o) => o.state === "open" && o.track === "batch" && o.batch && (o.batch.stage === "visa" || o.batch.stage === "arr") && o.batch.eta && o.batch.visas - (o.batch.reserved ?? 0) > 0)
    .map((o) => ({ openingId: o.id, no: o.no, trade: o.trade, nat: o.batch!.nat, eta: o.batch!.eta!, free: o.batch!.visas - (o.batch!.reserved ?? 0) }))
    .sort((a, b) => a.eta.localeCompare(b.eta))
}

// ---------------------------------------------------------------------------
// Exits without a replacement (HI-01 — a suggestion, nothing opens by itself)
// ---------------------------------------------------------------------------

export function replacementSuggestions(employees: readonly HrEmployee[], openings: readonly Opening[]): HrEmployee[] {
  const covered = new Set(openings.filter((o) => o.src === "rep").map((o) => o.ref))
  return employees.filter((e) => e.status === "leaving" && !covered.has(e.id))
}

/** A replacement is needed by the leaver's last day, never sooner than a week. */
export const replacementNeed = (e: Pick<HrEmployee, "lastDay">, today: string) => {
  const week = addDays(today, 7)
  return e.lastDay && e.lastDay > week ? e.lastDay : week
}

// ---------------------------------------------------------------------------
// Onboarding (HI-06) — read from the record; what is done outside is ticked; nothing blocks
// ---------------------------------------------------------------------------

export const ONBOARDING_TICKS = ["qiwa", "gosi"] as const
export type OnboardingTick = (typeof ONBOARDING_TICKS)[number]
export const ONBOARDING_DAYS = 30

export interface OnboardingItem {
  key: OnboardingTick | "iqama" | "insurance" | "iban" | "manager"
  ok: boolean
  /** Ticked by hand (Qiwa, GOSI) — the rest is read. */
  manual: boolean
  /** Not readable by this viewer (the IBAN sits with pay). */
  unknown?: boolean
  due?: string | null
  managerId?: string | null
}

/** Joined in the last 30 days, at work, not leaving. */
export function onboardingList(employees: readonly HiredEmployee[], today: string): HiredEmployee[] {
  const from = addDays(today, -ONBOARDING_DAYS)
  return employees.filter((e) => e.status === "active" && e.join >= from && e.join <= today).sort((a, b) => b.join.localeCompare(a.join))
}

export function onboardingItems(
  e: HiredEmployee,
  w: { employees: readonly HrEmployee[]; supervisorOf: (siteId: string) => string | null; hasIban?: boolean | null }
): OnboardingItem[] {
  const out: OnboardingItem[] = ONBOARDING_TICKS.map((k) => ({ key: k, ok: Boolean(e.onb?.[k]), manual: true }))
  if (e.nationality !== "sa") {
    out.push({ key: "iqama", ok: Boolean(e.docs?.iqama), manual: false, due: e.docs?.iqama ? null : iqamaDueBy(e.join) })
    out.push({ key: "insurance", ok: Boolean(e.docs?.insurance), manual: false })
  }
  out.push(w.hasIban == null ? { key: "iban", ok: false, manual: false, unknown: true } : { key: "iban", ok: w.hasIban, manual: false })
  const lm = lineManagerChain(e, { employees: w.employees, supervisorOf: w.supervisorOf })
  out.push({ key: "manager", ok: true, manual: false, managerId: lm.id })
  return out
}

/** The ticks still open (Qiwa / GOSI) — Today's row for government relations. */
export const onboardingOpen = (e: HiredEmployee) => ONBOARDING_TICKS.some((k) => !e.onb?.[k])

// ---------------------------------------------------------------------------
// Convert to employee (HI-06) — the new-employee form prefilled from the offer
// ---------------------------------------------------------------------------

/** The prototype's x5PrefillCand: a Saudi is a local hire, anyone else a transfer of services; the trade and
 * workplace of the opening; the offered basic (pay roles only); the start (never before today); the contract's
 * term from the offer. */
export function prefillFromCandidate(c: Candidate, o: Pick<Opening, "trade" | "siteId">, basic: number | null, today: string) {
  const start = c.offer?.start && c.offer.start > today ? c.offer.start : today
  const ct = c.offer?.ct ?? "open"
  return {
    source: c.nat === "sa" ? ("local" as const) : ("transfer" as const),
    nameAr: c.names.ar,
    nameEn: c.names.en ?? "",
    nationality: c.nat,
    gender: c.gender,
    trade: o.trade,
    ...(o.siteId ? { siteId: o.siteId } : {}),
    join: start,
    contractType: ct === "open" ? ("open" as const) : ("fixed" as const),
    contractEnd: ct === "open" ? "" : addDays(start, ct === "y2" ? 730 : 365),
    basic: basic != null ? String(basic) : "",
  }
}

// ---------------------------------------------------------------------------
// The opening born from a manpower answer (HI-01) — the document, for the answer's transaction
// ---------------------------------------------------------------------------

export function openingDoc(input: {
  organizationId: string
  no: string
  trade: string
  q: number
  siteId: string | null
  need: string
  src: OpeningSource
  ref: string | null
  refLabel?: string | null
  track: HireTrack
  state: OpeningState
  why?: string | null
  opened: Stamp
}): Omit<Opening, "id"> {
  return {
    organizationId: input.organizationId,
    kind: "opening",
    pay: false,
    no: input.no,
    trade: input.trade,
    q: input.q,
    siteId: input.siteId,
    need: input.need,
    src: input.src,
    ref: input.ref,
    refLabel: input.refLabel ?? null,
    track: input.track,
    state: input.state,
    filled: 0,
    why: input.why?.trim() || null,
    opened: input.opened,
    okBy: null,
    closedBy: null,
    batch: input.track === "batch" ? { stage: "auth", agency: null, nat: null, sel: null, eta: null, issued: 0, visas: 0, reserved: 0 } : null,
  }
}
