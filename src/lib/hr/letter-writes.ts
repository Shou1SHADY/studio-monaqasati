// HR 1.0 — letter writes (EM-08, WF-24). Each act is one transaction that reads
// the letter, the employee and (for a salary or embassy letter) his pay again
// and refuses what the rule refuses — the screen is never trusted. The figures
// go to `hrLetterPay`, copied from `employeePay` by someone who may read it:
// the employee himself or the HR manager when asking, the HR manager again
// when signing (government relations signs an embassy letter without them).
// The employee's log names what happened, never an amount (RL-03). Telling the
// employee (and the signer of a new request) is best-effort after the commit.

import { collection, doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { hrAllowed, type HrContext } from "./access"
import { HR_EMPLOYEES, HR_LETTER_PAY, HR_LETTERS, HR_PAY, HR_REQUESTS } from "./collections"
import type { EmployeePay, HrEmployee } from "./employee"
import { HR_LOG, type HrActor } from "./employee-writes"
import {
  declineBlocks,
  issueBlocks,
  isFreeLetter,
  isPayLetter,
  letterBlocks,
  letterCardOf,
  letterRequestSchema,
  letterSignerLevel,
  LETTER_NUMBER_TYPE,
  maySignLetter,
  signingRole,
  type HrLetter,
  type LetterHead,
  type LetterPay,
  type LetterRequestInput,
} from "./letters"
import type { HrRequest, Stamp } from "./requests"
import { drawYearlyDocNumber } from "../sales-numbering"
import type { Translator } from "../mfg-events"
import { todayDay } from "./format"
import { emitHrNotice, hrLinks, type HrRecipient } from "./notify"
import { assertHr, HrWriteError } from "./write-guard"
const stamp = (actor: HrActor, note?: string | null): Stamp => ({ by: actor.uid, byName: actor.name, at: new Date().toISOString(), note: note?.trim() || null })

function log(tx: Transaction, firestore: Firestore, emp: Pick<HrEmployee, "id" | "organizationId">, actor: HrActor, kind: string, params: Record<string, string | number | null>) {
  tx.set(doc(collection(firestore, HR_EMPLOYEES, emp.id, HR_LOG)), { organizationId: emp.organizationId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind, params, source: "hr" })
}

async function readEmp(tx: Transaction, firestore: Firestore, id: string): Promise<HrEmployee> {
  const snap = await tx.get(doc(firestore, HR_EMPLOYEES, id))
  if (!snap.exists()) throw new HrWriteError("missing")
  return { id: snap.id, ...(snap.data() as Omit<HrEmployee, "id">) }
}

async function readLetter(tx: Transaction, firestore: Firestore, id: string): Promise<HrLetter> {
  const snap = await tx.get(doc(firestore, HR_LETTERS, id))
  if (!snap.exists()) throw new HrWriteError("missing")
  return { id: snap.id, ...(snap.data() as Omit<HrLetter, "id">) }
}

const payCopy = (orgId: string, emp: Pick<HrEmployee, "id" | "userId">, p: EmployeePay): LetterPay => ({
  organizationId: orgId,
  employeeId: emp.id,
  employeeUserId: emp.userId ?? null,
  basic: p.basic ?? 0,
  housing: p.housing ?? 0,
  transport: p.transport ?? 0,
})

export interface FileLetterInput extends LetterRequestInput {
  employeeId: string
}

/** The employee asks from My file; the HR manager may ask for him (§4 matrix). */
export async function fileLetter(firestore: Firestore, ctx: HrContext, orgId: string, actor: HrActor, input: FileLetterInput): Promise<{ id: string }> {
  const own = Boolean(ctx.employeeId) && ctx.employeeId === input.employeeId
  if (!own) assertHr(ctx, "letter.file")
  const parsed = letterRequestSchema.safeParse(input)
  if (!parsed.success) throw new HrWriteError("blocked", ["bad_input"])
  const d = parsed.data
  const ref = doc(collection(firestore, HR_LETTERS))
  let filed: Omit<HrLetter, "id"> | null = null
  await runTransaction(firestore, async (tx) => {
    const emp = await readEmp(tx, firestore, input.employeeId)
    if (emp.organizationId !== orgId) throw new HrWriteError("missing")
    const paySnap = isPayLetter(d.kind) ? await tx.get(doc(firestore, HR_PAY, emp.id)) : null
    const pay = paySnap?.exists() ? (paySnap.data() as EmployeePay) : null
    const blocks = letterBlocks(d, { status: emp.status, hasWage: Boolean(pay && (pay.basic ?? 0) + (pay.housing ?? 0) + (pay.transport ?? 0) > 0) })
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    // RL-02 — the signer is never the requester: decided now, from who is asking for himself.
    const self = emp.userId === ctx.uid
    const signerLevel = letterSignerLevel(d.kind, { isHrManager: self && ctx.roles.has("manager"), isGov: self && ctx.roles.has("gov") })
    const letter: Omit<HrLetter, "id"> = {
      organizationId: orgId,
      kind: d.kind,
      title: d.kind === "oth" ? d.title : null,
      purpose: d.purpose || null,
      addressee: d.addressee,
      lang: d.lang,
      employeeId: emp.id,
      employeeUserId: emp.userId ?? null,
      employeeName: emp.names?.ar ?? "",
      signerLevel,
      filedBy: stamp(actor),
      onBehalf: !own,
      state: "pending",
      createdAt: new Date().toISOString(),
    }
    tx.set(ref, { ...letter, updatedAt: serverTimestamp() })
    if (pay) tx.set(doc(firestore, HR_LETTER_PAY, ref.id), { ...payCopy(orgId, emp, pay), updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, "letter_filed", { letter: d.kind, addressee: d.addressee })
    filed = letter
  })
  if (filed) await tellSigner(firestore, actor, { id: ref.id, ...(filed as Omit<HrLetter, "id">) })
  return { id: ref.id }
}

const SIGNER: Record<HrLetter["signerLevel"], HrRecipient> = { gov: { hr: "gov" }, manager: { hr: "manager" }, management: { hr: "management" } }

/** WF-24 step 2 — the signer hears of a new request; never the employee it is about. */
async function tellSigner(firestore: Firestore, actor: HrActor, letter: HrLetter) {
  await emitHrNotice(firestore, actor, {
    kind: "hr_letter_filed",
    organizationId: letter.organizationId,
    to: [SIGNER[letter.signerLevel]],
    except: [letter.employeeUserId],
    params: { name: letter.employeeName, letter: `@hr_letter_kind.${letter.kind}` },
    link: hrLinks.today(),
    once: letter.id,
    employeeId: letter.employeeId,
  })
}

/** The employee hears of the decision (WF-24 step 4), in keys each reader renders in his language. */
async function tellEmployee(firestore: Firestore, actor: HrActor, letter: HrLetter, kind: "hr_letter_issued" | "hr_letter_declined", params: Record<string, string>, copy?: Translator | null) {
  if (!letter.employeeUserId) return
  await emitHrNotice(firestore, actor, {
    kind,
    organizationId: letter.organizationId,
    to: [{ users: [letter.employeeUserId] }],
    params: { ...params, letter: `@hr_letter_kind.${letter.kind}` },
    link: hrLinks.me(),
    once: letter.id,
    employeeId: letter.employeeId,
    copy,
  })
}

export interface IssueLetterInput {
  /** The signer's text — required on a free letter, ignored on a standard one. */
  text?: string | null
  /** The letterhead as the company file stands. */
  head: LetterHead
  /** An embassy letter may name the approved leave he travels in. */
  travelRequestId?: string | null
}

/** Issue and sign (WF-24 steps 3–4): the card copied onto the letter, a yearly serial drawn. */
export async function issueLetter(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  input: IssueLetterInput,
  opts: { today?: string; copy?: Translator | null } = {}
): Promise<{ serial: string }> {
  assertHr(ctx, "letter.sign")
  const today = opts.today ?? todayDay()
  let serial = ""
  let issued: HrLetter | null = null
  await runTransaction(firestore, async (tx) => {
    const letter = await readLetter(tx, firestore, id)
    const refusal = maySignLetter(ctx, letter)
    if (refusal) throw new HrWriteError(refusal)
    const blocks = issueBlocks(letter, input)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const emp = await readEmp(tx, firestore, letter.employeeId)
    let travel: HrLetter["travel"] = null
    if (letter.kind === "emb" && input.travelRequestId) {
      const snap = await tx.get(doc(firestore, HR_REQUESTS, input.travelRequestId))
      const r = snap.exists() ? (snap.data() as HrRequest) : null
      if (!r || r.kind !== "leave" || r.state !== "approved" || r.employeeId !== letter.employeeId || !r.leave) throw new HrWriteError("blocked", ["bad_travel"])
      travel = { from: r.leave.from, to: r.leave.to, requestId: input.travelRequestId }
    }
    // The figures again, as they stand now — only by a hand that may read them.
    const paySnap = isPayLetter(letter.kind) && hrAllowed(ctx, "pay.view") ? await tx.get(doc(firestore, HR_PAY, letter.employeeId)) : null
    serial = await drawYearlyDocNumber(firestore, tx, letter.organizationId, LETTER_NUMBER_TYPE, Number(today.slice(0, 4)))
    const patch = {
      state: "issued" as const,
      serial,
      issuedOn: today,
      text: isFreeLetter(letter.kind) ? (input.text ?? "").trim() : null,
      card: letterCardOf(emp),
      head: { name: input.head.name?.trim() || null, cr: input.head.cr?.trim() || null, mol: input.head.mol?.trim() || null },
      travel,
      decision: { ...stamp(actor), role: signingRole(ctx, letter), ownFlagged: ctx.owner && ctx.employeeId === letter.employeeId },
    }
    tx.update(doc(firestore, HR_LETTERS, id), { ...patch, updatedAt: serverTimestamp() })
    if (paySnap?.exists()) tx.set(doc(firestore, HR_LETTER_PAY, id), { ...payCopy(letter.organizationId, emp, paySnap.data() as EmployeePay), updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, "letter_issued", { letter: letter.kind, addressee: letter.addressee, serial })
    issued = { ...letter, ...patch }
  })
  if (issued) await tellEmployee(firestore, actor, issued, "hr_letter_issued", { serial }, opts.copy)
  return { serial }
}

/** Decline with a reason the employee sees on the same line (WF-24 step 3). */
export async function declineLetter(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, reason: string, opts: { copy?: Translator | null } = {}): Promise<void> {
  assertHr(ctx, "letter.sign")
  let declined: HrLetter | null = null
  await runTransaction(firestore, async (tx) => {
    const letter = await readLetter(tx, firestore, id)
    const refusal = maySignLetter(ctx, letter)
    if (refusal) throw new HrWriteError(refusal)
    const blocks = declineBlocks(letter, reason)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const emp = await readEmp(tx, firestore, letter.employeeId)
    const decision = { ...stamp(actor, reason), role: signingRole(ctx, letter), ownFlagged: ctx.owner && ctx.employeeId === letter.employeeId }
    tx.update(doc(firestore, HR_LETTERS, id), { state: "declined", decision, updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, "letter_declined", { letter: letter.kind, reason: reason.trim() })
    declined = { ...letter, state: "declined", decision }
  })
  if (declined) await tellEmployee(firestore, actor, declined, "hr_letter_declined", { reason: reason.trim() }, opts.copy)
}
