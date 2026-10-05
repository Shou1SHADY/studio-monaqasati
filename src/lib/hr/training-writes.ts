// HR 1.0 — training writes (PRD WF-20, TR-03/04; optional feature `train`). The HR manager schedules a session
// (each participant workplace's supervisor is told), then records who attended: those who passed get the
// certificate on their record dated from the session, each with a log entry; an external course's cost goes to
// Finance as a payment request on the HR outbox (`hr:TRN:<session>`, never twice) — Finance pays it from its HR
// desk. Certificates are written in small batches (the rules look each record up), the session's state last, so
// a retry after a partial failure writes the same dates again.

import { addDoc, collection, doc, getDoc, serverTimestamp, writeBatch, type Firestore } from "firebase/firestore"
import { ACC } from "../accounting/accounts"
import { postToLedger } from "../accounting/post"
import { COST_CENTERS, type PostingResult } from "../accounting/posting-rules"
import type { HrContext } from "./access"
import { HR_EMPLOYEES, HR_EVENTS } from "./collections"
import { HR_LOG, type HrActor, type LogEntry } from "./employee-writes"
import type { FinanceActor } from "./finance-writes"
import { todayDay } from "./format"
import { emitHrNotice, emitHrNotices, hrLinks, type HrNotice } from "./notify"
import { eventId } from "./payroll-writes"
import type { HrSite } from "./sites"
import { r2 } from "./statutory"
import { attendees, certExpiry, courseOf, HR_TRAINING, resultBlocks, scheduleBlocks, trainingCost, trainingEventKey, type TrainingCostLine, type TrainingSession } from "./training"
import { assertHr, HrWriteError } from "./write-guard"

/** People per batch when certificates are written: each record is looked up by the rules (twice with its log). */
export const CERT_BATCH = 8

export interface SessionPerson {
  id: string
  name: string
  siteId: string | null
}

/** Form 28 — schedule a session. Internal: at the chosen workplace (or the first participant's); external: at the
 * provider's. Returns the session id. */
export async function scheduleSession(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  actor: HrActor,
  input: { course: string; at: string; seats: number; siteId?: string | null; people: readonly SessionPerson[] },
  opts: { sites: readonly Pick<HrSite, "id" | "name" | "supervisorUserId">[]; today?: string }
): Promise<string> {
  assertHr(ctx, "train.manage")
  const today = opts.today ?? todayDay()
  const ppl = input.people.map((p) => p.id)
  const blocks = scheduleBlocks({ course: input.course, at: input.at, seats: input.seats, ppl }, today)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const course = courseOf(input.course)!
  const siteIds = [...new Set(input.people.map((p) => p.siteId).filter((s): s is string => Boolean(s)))]
  const session: Omit<TrainingSession, "id"> = {
    organizationId: orgId,
    kind: "session",
    course: course.id,
    at: input.at,
    siteId: course.kind === "internal" ? (input.siteId || input.people[0]?.siteId || null) : null,
    seats: input.seats,
    ppl,
    names: Object.fromEntries(input.people.map((p) => [p.id, p.name])),
    siteIds,
    state: "plan",
    by: actor.uid,
    byName: actor.name,
    createdAt: new Date().toISOString(),
  }
  const ref = await addDoc(collection(firestore, HR_TRAINING), { ...session, updatedAt: serverTimestamp() })
  // WF-20 step 3 — each workplace's supervisor learns who of his goes, and when.
  await emitHrNotices(
    firestore,
    actor,
    siteIds.map((sid): HrNotice | null => {
      const site = opts.sites.find((s) => s.id === sid)
      if (!site?.supervisorUserId) return null
      return {
        kind: "hr_training_scheduled",
        organizationId: orgId,
        to: [{ users: [site.supervisorUserId] }],
        params: { course: `@hr_course.${course.id}`, date: input.at, count: input.people.filter((p) => p.siteId === sid).length, site: site.name },
        link: hrLinks.training(),
        once: `${ref.id}_${sid}`,
      }
    })
  )
  return ref.id
}

/** Form 28 — record the result: everyone attended and passed but those named absent. Certificates from the
 * session's day; an external course with attendees sends its cost to Finance (hr:TRN). */
export async function recordSessionResult(
  firestore: Firestore,
  ctx: HrContext,
  actor: HrActor,
  sessionId: string,
  input: { absent: readonly string[] },
  opts: { sites: readonly Pick<HrSite, "id" | "type" | "projectId">[]; employeeSites: ReadonlyMap<string, string | null>; today?: string }
): Promise<{ passed: number; cost: number }> {
  assertHr(ctx, "train.manage")
  const today = opts.today ?? todayDay()
  const snap = await getDoc(doc(firestore, HR_TRAINING, sessionId))
  if (!snap.exists()) throw new HrWriteError("missing")
  const s = { id: snap.id, ...(snap.data() as Omit<TrainingSession, "id">) } as TrainingSession
  const absent = input.absent.filter((id) => s.ppl.includes(id))
  const blocks = resultBlocks(s, absent, today)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const course = courseOf(s.course)
  if (!course) throw new HrWriteError("blocked", ["no_course"])
  const passed = attendees({ ppl: s.ppl, abs: absent })
  const at = new Date().toISOString()
  const until = course.cert ? certExpiry(s.at, course.cert) : null
  for (let i = 0; i < passed.length; i += CERT_BATCH) {
    const batch = writeBatch(firestore)
    for (const id of passed.slice(i, i + CERT_BATCH)) {
      if (course.cert) batch.update(doc(firestore, HR_EMPLOYEES, id), { [`certs.${course.cert}`]: until, updatedAt: serverTimestamp() })
      const entry: LogEntry & { organizationId: string } = { organizationId: s.organizationId, at, by: actor.uid, byName: actor.name, kind: "cert_passed", params: { course: course.id, to: until }, source: "hr" }
      batch.set(doc(collection(firestore, HR_EMPLOYEES, id, HR_LOG)), entry)
    }
    await batch.commit()
  }
  const { amount, lines } = trainingCost(
    course,
    passed.map((id) => opts.employeeSites.get(id) ?? null),
    opts.sites
  )
  const key = amount > 0 ? trainingEventKey(s.id) : null
  const batch = writeBatch(firestore)
  if (key) {
    const ev: Omit<TrainingCostEvent, "id"> = {
      organizationId: s.organizationId,
      key,
      kind: "TRN",
      month: s.at.slice(0, 7),
      session: s.id,
      course: course.id,
      at: s.at,
      count: passed.length,
      amount,
      lines,
      state: "sent",
    }
    batch.set(doc(firestore, HR_EVENTS, eventId(s.organizationId, key)), { ...ev, createdAt: at })
  }
  batch.update(doc(firestore, HR_TRAINING, s.id), { state: "done", abs: absent, done: { by: actor.uid, byName: actor.name, at }, event: key, updatedAt: serverTimestamp() })
  await batch.commit()
  if (key)
    await emitHrNotice(firestore, actor, {
      kind: "hr_training_cost",
      organizationId: s.organizationId,
      to: [{ finance: true }],
      params: { course: `@hr_course.${course.id}`, date: s.at, count: passed.length },
      link: hrLinks.financeDesk(),
      once: s.id,
    })
  return { passed: passed.length, cost: amount }
}

// ---------------------------------------------------------------------------
// Finance's side: the payment request hr:TRN → paid
// ---------------------------------------------------------------------------

/** `hrEvents/{orgId}__hr:TRN:<session>` — an external course's cost, split over the attendees' workplaces. */
export interface TrainingCostEvent {
  id: string
  organizationId: string
  key: string
  kind: "TRN"
  month: string
  session: string
  course: string
  at: string
  count: number
  amount: number
  lines: TrainingCostLine[]
  state: "sent" | "paid"
}

/** The entry: Dr training (professional fees, 520104) per workplace — a project's share carries the project —
 * Cr bank. No person is named (the journal is org-readable). */
export function postHrTraining(ev: Pick<TrainingCostEvent, "key" | "lines" | "course" | "count">, books: { date: string; bankAccount?: string }): PostingResult {
  const amount = r2(ev.lines.reduce((a, l) => a + l.amount, 0))
  return {
    sourceType: "hr_fee",
    sourceId: ev.key,
    date: books.date,
    description: `تكلفة تدريب — ${ev.course} — ${ev.count} متدرباً`,
    costCenter: COST_CENTERS.admin,
    lines: [
      ...ev.lines.filter((l) => l.amount > 0).map((l) => ({ account: ACC.professionalFees, debit: l.amount, project: l.projectId ?? undefined, note: "تدريب" })),
      { account: books.bankAccount || ACC.bankMain, credit: amount },
    ],
    empty: amount === 0,
  }
}

/** Finance pays the training cost (hr:TRN → paid): the entry and the state in one batch, once. */
export async function payTrainingCost(firestore: Firestore, a: FinanceActor, orgId: string, ev: TrainingCostEvent, books: { accountingOn: boolean; date: string; bankAccount?: string }): Promise<void> {
  if (!a.allowed) throw new HrWriteError("no_role")
  const cur = await getDoc(doc(firestore, HR_EVENTS, ev.id))
  if (!cur.exists() || (cur.data() as TrainingCostEvent).state !== "sent" || (cur.data() as TrainingCostEvent).kind !== "TRN") throw new HrWriteError("blocked", ["stale"])
  const batch = writeBatch(firestore)
  const entryId = books.accountingOn ? await postToLedger(firestore, { organizationId: orgId, userId: a.uid, userName: a.name ?? "" }, postHrTraining(ev, books), { batch }) : null
  batch.update(doc(firestore, HR_EVENTS, ev.id), { state: "paid", paid: { by: a.uid, byName: a.name, at: new Date().toISOString(), date: books.date }, entryId: entryId ?? null, updatedAt: serverTimestamp() })
  await batch.commit()
}
