// HR 1.0 — hiring writes (WF-17, WF-18; optional: hire). Each is one
// transaction: the guard first, the document read again, the rule run again —
// a stale screen writes nothing. Money (expected pay, the offered basic) is
// written to the candidate's pay document only (RL-03). Management's two
// decisions — a new position, an offer above the band — are its own (ST-03).
// Converting a candidate and registering a batch's arrivals go through
// `createEmployee`, which links the record to its opening in the same
// transaction (and spends the batch's issued visa, not the balance).

import { collection, doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import type { HrContext } from "./access"
import { HR_EMPLOYEES, HR_SITES } from "./collections"
import { createEmployee, HR_LOG, type HrActor } from "./employee-writes"
import { todayDay } from "./format"
import {
  arrivalNames,
  batchBlocks,
  candidateBlocks,
  candidatePayId,
  HR_HIRING,
  openingBlocks,
  openingDoc,
  openingLeft,
  OPENING_NUMBER_TYPE,
  offerCheck,
  scoreBlocks,
  type Candidate,
  type CandidatePay,
  type CandidateSource,
  type ContractTerm,
  type HiredEmployee,
  type HireTrack,
  type OnboardingTick,
  type Opening,
  type Stamp,
} from "./hiring"
import { freeVisas } from "./manpower"
import { emitHrNotice, hrLinks } from "./notify"
import { HR_SETTINGS } from "./settings"
import { addDays, DEFAULT_HR_POLICIES, type HrPolicies } from "./statutory"
import { tradeOf } from "./trades"
import { drawYearlyDocNumber } from "../sales-numbering"
import { assertHr, HrWriteError } from "./write-guard"

/** A workplace's name for a notice (read in the transaction, before any write). */
async function siteNameIn(tx: Transaction, firestore: Firestore, siteId: string | null): Promise<string> {
  if (!siteId) return ""
  const s = await tx.get(doc(firestore, HR_SITES, siteId))
  return s.exists() ? ((s.data() as { name?: string }).name ?? "") : ""
}

const stamp = (actor: HrActor): Stamp => ({ by: actor.uid, byName: actor.name, at: new Date().toISOString() })

async function readHiring<T>(tx: Transaction, firestore: Firestore, id: string, kind: "opening" | "candidate"): Promise<T> {
  const snap = await tx.get(doc(firestore, HR_HIRING, id))
  if (!snap.exists()) throw new HrWriteError("missing")
  const data = snap.data() as { kind?: string }
  if (data.kind !== kind) throw new HrWriteError("missing")
  return { ...(data as object), id } as T
}

// ---------------------------------------------------------------------------
// Openings (HI-01, HI-03)
// ---------------------------------------------------------------------------

export interface OpeningInput {
  trade: string
  q: number
  siteId: string | null
  need: string
  track: HireTrack
  why?: string | null
  /** A replacement for a leaving employee (no approval needed). */
  replaces?: { employeeId: string; name: string } | null
}

/** The HR manager opens an opening. A new position waits for management when the policy blocks (ST-03); a
 * replacement opens at once. */
export async function openOpening(firestore: Firestore, ctx: HrContext, orgId: string, actor: HrActor, input: OpeningInput, opts: { policies?: HrPolicies; today?: string } = {}): Promise<{ id: string; no: string; state: Opening["state"] }> {
  assertHr(ctx, "hire.manage")
  const policies = opts.policies ?? DEFAULT_HR_POLICIES
  const today = opts.today ?? todayDay()
  const blocks = openingBlocks(input)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const rep = input.replaces ?? null
  const state: Opening["state"] = rep || policies.jobApprove === "warn" ? "open" : "wait"
  const ref = doc(collection(firestore, HR_HIRING))
  let no = ""
  let site = ""
  await runTransaction(firestore, async (tx) => {
    site = await siteNameIn(tx, firestore, input.siteId)
    no = await drawYearlyDocNumber(firestore, tx, orgId, OPENING_NUMBER_TYPE, Number(today.slice(0, 4)))
    const data = openingDoc({
      organizationId: orgId,
      no,
      trade: input.trade,
      q: input.q,
      siteId: input.siteId,
      need: input.need,
      src: rep ? "rep" : "new",
      ref: rep?.employeeId ?? null,
      refLabel: rep?.name ?? null,
      track: input.track,
      state,
      why: rep ? null : input.why,
      opened: stamp(actor),
    })
    tx.set(ref, { ...data, updatedAt: serverTimestamp() })
  })
  if (state === "wait")
    await emitHrNotice(firestore, actor, {
      kind: "hr_position_to_approve",
      organizationId: orgId,
      to: [{ hr: "management" }],
      params: { no, site, need: input.need },
      link: hrLinks.hiring(ref.id),
      once: ref.id,
    })
  return { id: ref.id, no, state }
}

/** Management approves a new position (sourcing starts) or declines it (closed). */
export async function decidePosition(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, verdict: "approve" | "decline"): Promise<void> {
  assertHr(ctx, "hire.approve")
  let o: Opening | null = null
  let site = ""
  await runTransaction(firestore, async (tx) => {
    const x = await readHiring<Opening>(tx, firestore, id, "opening")
    if (x.state !== "wait") throw new HrWriteError("blocked", ["stale"])
    site = await siteNameIn(tx, firestore, x.siteId)
    tx.update(doc(firestore, HR_HIRING, id), verdict === "approve" ? { state: "open", okBy: stamp(actor), updatedAt: serverTimestamp() } : { state: "closed", closedBy: stamp(actor), updatedAt: serverTimestamp() })
    o = x
  })
  const x = o as Opening | null
  if (x && verdict === "approve")
    await emitHrNotice(firestore, actor, {
      kind: "hr_position_approved",
      organizationId: x.organizationId,
      to: [{ users: [x.opened.by] }],
      params: { no: x.no, site },
      link: hrLinks.hiring(id),
      once: id,
    })
}

/** The HR manager closes an opening. A batch whose visas are issued and not all arrived stays open — closing it
 * would strand the lot (and coverage reads it). */
export async function closeOpening(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor): Promise<void> {
  assertHr(ctx, "hire.manage")
  await runTransaction(firestore, async (tx) => {
    const x = await readHiring<Opening>(tx, firestore, id, "opening")
    if (x.state !== "open" && x.state !== "wait") throw new HrWriteError("blocked", ["stale"])
    if ((x.batch?.visas ?? 0) > 0) throw new HrWriteError("blocked", ["visas_issued"])
    tx.update(doc(firestore, HR_HIRING, id), { state: "closed", closedBy: stamp(actor), updatedAt: serverTimestamp() })
  })
}

// ---------------------------------------------------------------------------
// The individuals track (HI-02, HI-04, HI-05, HI-08)
// ---------------------------------------------------------------------------

export interface CandidateInput {
  nameAr: string
  nameEn: string | null
  nat: string
  gender: "m" | "f"
  src: Exclude<CandidateSource, "link">
  phone: string | null
  /** Expected pay — optional; no number beats an invented one. */
  ask: number | null
}

export async function addCandidate(firestore: Firestore, ctx: HrContext, actor: HrActor, openingId: string, input: CandidateInput): Promise<string> {
  assertHr(ctx, "hire.manage")
  const ref = doc(collection(firestore, HR_HIRING))
  await runTransaction(firestore, async (tx) => {
    const o = await readHiring<Opening>(tx, firestore, openingId, "opening")
    if (o.state !== "open" || o.track !== "ind") throw new HrWriteError("blocked", ["not_open"])
    const blocks = candidateBlocks({ ...input, trade: o.trade })
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const nameAr = input.nameAr.trim() || input.nameEn!.trim()
    const c: Omit<Candidate, "id"> = {
      organizationId: o.organizationId,
      kind: "candidate",
      pay: false,
      openingId,
      trade: o.trade,
      siteId: o.siteId,
      names: { ar: nameAr, en: input.nameEn?.trim() || null },
      nat: input.nat,
      gender: input.gender,
      src: input.src,
      phone: input.phone?.trim() || null,
      stage: "new",
      added: stamp(actor),
      intAt: null,
      sc: null,
      offer: null,
      why: null,
      employeeId: null,
    }
    tx.set(ref, { ...c, updatedAt: serverTimestamp() })
    if (input.ask != null) {
      const p: Omit<CandidatePay, "id"> = { organizationId: o.organizationId, kind: "offer", pay: true, candidateId: ref.id, openingId, ask: input.ask, basic: null }
      tx.set(doc(firestore, HR_HIRING, candidatePayId(ref.id)), { ...p, updatedAt: serverTimestamp() })
    }
  })
  return ref.id
}

/** «قابِل» (new → interview, two days from now) or «استبعد» (new, or interviewed). */
export async function screenCandidate(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, action: "interview" | "reject", opts: { today?: string } = {}): Promise<void> {
  assertHr(ctx, "hire.manage")
  const today = opts.today ?? todayDay()
  await runTransaction(firestore, async (tx) => {
    const c = await readHiring<Candidate>(tx, firestore, id, "candidate")
    const ok = action === "interview" ? c.stage === "new" : c.stage === "new" || c.stage === "int"
    if (!ok) throw new HrWriteError("blocked", ["stale"])
    tx.update(doc(firestore, HR_HIRING, id), action === "interview" ? { stage: "int", intAt: addDays(today, 2), updatedAt: serverTimestamp() } : { stage: "rej", why: "rejected", updatedAt: serverTimestamp() })
  })
}

/** HI-04 — three criteria 1–5 and a recommendation; not recommended = rejected. */
export async function recordScorecard(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, input: { t: number; x: number; b: number; rec: boolean; note?: string | null }): Promise<void> {
  assertHr(ctx, "hire.manage")
  const blocks = scoreBlocks(input)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  await runTransaction(firestore, async (tx) => {
    const c = await readHiring<Candidate>(tx, firestore, id, "candidate")
    if (c.stage !== "int" || c.sc) throw new HrWriteError("blocked", ["stale"])
    const sc = { ...stamp(actor), t: input.t, x: input.x, b: input.b, rec: input.rec, note: input.note?.trim() || null }
    tx.update(doc(firestore, HR_HIRING, id), { sc, ...(input.rec ? {} : { stage: "rej", why: "not_recommended" }), updatedAt: serverTimestamp() })
  })
}

/** HI-05 — the offer: the basic in the trade's band (above it waits for management when the policy blocks),
 * the start, how long it stands, the contract. The basic goes on the pay document; the terms on the candidate. */
export async function makeOffer(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  input: { basic: number; start: string; until: string; ct: ContractTerm },
  opts: { policies?: HrPolicies; today?: string } = {}
): Promise<{ held: boolean }> {
  assertHr(ctx, "hire.manage")
  const policies = opts.policies ?? DEFAULT_HR_POLICIES
  const today = opts.today ?? todayDay()
  let held = false
  let c: Candidate | null = null
  let o: Opening | null = null
  await runTransaction(firestore, async (tx) => {
    const cand = await readHiring<Candidate>(tx, firestore, id, "candidate")
    const open = await readHiring<Opening>(tx, firestore, cand.openingId, "opening")
    const pRef = doc(firestore, HR_HIRING, candidatePayId(id))
    const pSnap = await tx.get(pRef)
    if (cand.stage !== "int" || !cand.sc?.rec || open.state !== "open") throw new HrWriteError("blocked", ["stale"])
    const check = offerCheck({ basic: input.basic, start: input.start, until: input.until, nat: cand.nat, trade: cand.trade, need: open.need }, policies, today)
    if (check.blocks.length) throw new HrWriteError("blocked", check.blocks)
    held = check.held
    const offer = { ...stamp(actor), start: input.start, until: input.until, ct: input.ct, state: held ? "mg" : "sent", over: check.over, okBy: null }
    tx.update(doc(firestore, HR_HIRING, id), { stage: "offer", offer, updatedAt: serverTimestamp() })
    const prev = pSnap.exists() ? (pSnap.data() as CandidatePay) : null
    const p: Omit<CandidatePay, "id"> = { organizationId: cand.organizationId, kind: "offer", pay: true, candidateId: id, openingId: cand.openingId, ask: prev?.ask ?? null, basic: input.basic }
    tx.set(pRef, { ...p, updatedAt: serverTimestamp() })
    c = cand
    o = open
  })
  const cand = c as Candidate | null
  const open = o as Opening | null
  if (held && cand && open)
    await emitHrNotice(firestore, actor, {
      kind: "hr_offer_above_band",
      organizationId: cand.organizationId,
      to: [{ hr: "management" }],
      params: { name: cand.names.ar, no: open.no },
      link: hrLinks.hiring(open.id),
      once: `${id}__${new Date().toISOString().slice(0, 10)}`,
    })
  return { held }
}

/** Management approves an offer above the band (it may be sent) or returns it (back to the interview). */
export async function decideOffer(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, verdict: "approve" | "return"): Promise<void> {
  assertHr(ctx, "hire.approve")
  let c: Candidate | null = null
  let no = ""
  await runTransaction(firestore, async (tx) => {
    const cand = await readHiring<Candidate>(tx, firestore, id, "candidate")
    const open = await readHiring<Opening>(tx, firestore, cand.openingId, "opening")
    if (cand.stage !== "offer" || cand.offer?.state !== "mg") throw new HrWriteError("blocked", ["stale"])
    tx.update(
      doc(firestore, HR_HIRING, id),
      verdict === "approve" ? { offer: { ...cand.offer, state: "sent", okBy: stamp(actor) }, updatedAt: serverTimestamp() } : { stage: "int", offer: null, updatedAt: serverTimestamp() }
    )
    c = cand
    no = open.no
  })
  const cand = c as Candidate | null
  if (cand && verdict === "approve")
    await emitHrNotice(firestore, actor, {
      kind: "hr_offer_approved",
      organizationId: cand.organizationId,
      to: [{ users: [cand.offer?.by] }],
      params: { name: cand.names.ar, no },
      link: hrLinks.hiring(cand.openingId),
      once: id,
    })
}

/** The candidate's answer to a sent offer: accepted (convert him when the contract is signed) or declined. */
export async function answerOffer(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, answer: "acc" | "dec"): Promise<void> {
  assertHr(ctx, "hire.manage")
  await runTransaction(firestore, async (tx) => {
    const c = await readHiring<Candidate>(tx, firestore, id, "candidate")
    if (c.stage !== "offer" || c.offer?.state !== "sent") throw new HrWriteError("blocked", ["stale"])
    tx.update(
      doc(firestore, HR_HIRING, id),
      answer === "acc" ? { stage: "acc", offer: { ...c.offer, state: "acc" }, updatedAt: serverTimestamp() } : { stage: "rej", why: "declined", offer: { ...c.offer, state: "dec" }, updatedAt: serverTimestamp() }
    )
  })
}

// ---------------------------------------------------------------------------
// The recruitment batch (WF-18, HI-07)
// ---------------------------------------------------------------------------

/** One step of a batch. Authorised → trade test (agency, nationality, passed). Test → visas issued: the free
 * visas of the establishment file must cover what is left; they are taken out of it now and become this
 * batch's issued lot, with its arrival date (coverage offers it at that date). Arrivals: `registerArrivals`. */
export async function batchStep(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  input: { agency?: string; nat?: string; sel?: number | null; eta?: string | null }
): Promise<{ stage: string; issued?: number }> {
  assertHr(ctx, "hire.batch")
  let out: { stage: string; issued?: number } = { stage: "" }
  await runTransaction(firestore, async (tx) => {
    const o = await readHiring<Opening>(tx, firestore, id, "opening")
    if (o.state !== "open" || o.track !== "batch" || !o.batch) throw new HrWriteError("blocked", ["stale"])
    const ref = doc(firestore, HR_HIRING, id)
    if (o.batch.stage === "auth") {
      const blocks = batchBlocks(o, input, 0)
      if (blocks.length) throw new HrWriteError("blocked", blocks)
      tx.update(ref, { batch: { ...o.batch, stage: "test", agency: input.agency!.trim(), nat: input.nat || null, sel: input.sel ?? null }, updatedAt: serverTimestamp() })
      out = { stage: "test" }
      return
    }
    if (o.batch.stage !== "test") throw new HrWriteError("blocked", ["stale"])
    const sRef = doc(firestore, HR_SETTINGS, o.organizationId)
    const s = await tx.get(sRef)
    const est = (s.exists() ? (s.data() as { establishment?: { visas?: number | null; visasReserved?: number | null } }).establishment : null) ?? {}
    const blocks = batchBlocks(o, input, freeVisas(est))
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const n = openingLeft(o)
    // Government relations may record it: the rules let it lower the balance and touch nothing else.
    tx.update(sRef, { "establishment.visas": (est.visas ?? 0) - n })
    tx.update(ref, { batch: { ...o.batch, stage: "visa", eta: input.eta, issued: n, visas: n, reserved: 0 }, updatedAt: serverTimestamp() })
    out = { stage: "visa", issued: n }
  })
  return out
}

/** Arrivals by name, as in the passport: one employee each on the opening's workplace, joining today, the
 * iqama clock and probation started, documents left missing. Each spends one of the batch's issued visas. The
 * wage is the trade's reference wage when the hand sees pay; government relations records them without pay.
 * One record at a time — a failure is listed, the others stand. */
export async function registerArrivals(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  actor: HrActor,
  opening: Opening,
  text: string,
  opts: { policies?: HrPolicies; today?: string; seesPay?: boolean } = {}
): Promise<{ created: number; failed: string[] }> {
  assertHr(ctx, "hire.batch")
  const names = arrivalNames(text)
  const blocks = batchBlocks(opening, { names }, 0)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const today = opts.today ?? todayDay()
  const ref = tradeOf(opening.trade)?.ref ?? null
  let created = 0
  const failed: string[] = []
  for (const name of names) {
    try {
      await createEmployee(
        firestore,
        ctx,
        orgId,
        actor,
        {
          source: "visa",
          nameAr: name,
          nameEn: name,
          nationality: opening.batch?.nat || "bd",
          gender: "m",
          idNo: null,
          trade: opening.trade,
          siteId: opening.siteId,
          join: today,
          contractType: "open",
          contractEnd: null,
          basic: opts.seesPay ? ref : null,
          docs: {},
          hiring: { openingId: opening.id, candidateId: null },
        },
        { visas: opening.batch?.visas ?? 0, policies: opts.policies }
      )
      created++
    } catch (err) {
      console.error(err)
      failed.push(name)
    }
  }
  return { created, failed }
}

// ---------------------------------------------------------------------------
// Onboarding (HI-06)
// ---------------------------------------------------------------------------

/** Tick what is done outside the system — the contract documented on Qiwa, the GOSI registration. */
export async function tickOnboarding(firestore: Firestore, ctx: HrContext, employeeId: string, actor: HrActor, key: OnboardingTick): Promise<void> {
  assertHr(ctx, "hire.onboard")
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, HR_EMPLOYEES, employeeId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new HrWriteError("missing")
    const e = snap.data() as Omit<HiredEmployee, "id">
    if (e.onb?.[key]) throw new HrWriteError("blocked", ["stale"])
    tx.update(ref, { onb: { ...(e.onb ?? {}), [key]: stamp(actor) }, updatedAt: serverTimestamp() })
    tx.set(doc(collection(firestore, HR_EMPLOYEES, employeeId, HR_LOG)), { organizationId: e.organizationId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind: `onb_${key}`, params: {}, source: "hr" })
  })
}
