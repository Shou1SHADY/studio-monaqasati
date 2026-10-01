// PM 1.0 — addendum writes (WF-08, AMD-01…09). Each is one transaction over
// the project and every addendum it has (read by number — the project counts
// them), so the contract in force is recomputed from the records at the moment
// of the write, never trusted from the screen. That is what makes the two
// late checks honest: a draft whose `from` was overtaken by another signature,
// and a cap that fell below the retention a certificate held in between.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, mayWithdrawAddendum, PmAccessError, type PmContext } from "./access"
import {
  addendumNo,
  amendmentEvent,
  draftBlocks,
  inForce,
  lastSignedOn,
  PM_ADDENDA,
  signBlocks,
  withdrawBlocks,
  type AddendumReason,
  type PmAddendum,
  type WithdrawReason,
} from "./addenda"
import { PM_EVENTS, pmEventDocId } from "./events"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { withFreshState } from "./project-writes"
import { termChanges, type ContractTerms } from "./terms"
import { readContractValue } from "./contract-value"

export class PmAddendumError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "not_started" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmAddendumError"
  }
}

export interface AddendumActor {
  uid: string
  name: string | null
}

export interface PmBlockData {
  no?: string
  lifecycle?: string
  terms?: ContractTerms
  original?: ContractTerms | null
  addendaCount?: number
  signedCount?: number
  /** Retention held on certificates so far — maintained by the certificate writes. */
  retentionHeld?: number
  /** The contract in force after the last signature (terms.ts `termsNow`): what
   * everyone on the project reads, since the addenda themselves are money's or approve's. */
  inForce?: ContractTerms
}

type ProjectData = { organizationId?: string; budget?: number; status?: string; projectManagerId?: string | null; pm?: PmBlockData }

/** Every addendum of a project, read inside the transaction by its number. */
export async function readAddenda(tx: Transaction, firestore: Firestore, projectId: string, count: number): Promise<PmAddendum[]> {
  const out: PmAddendum[] = []
  for (let seq = 1; seq <= count; seq++) {
    const snap = await tx.get(doc(firestore, "projects", projectId, PM_ADDENDA, addendumNo(seq)))
    if (snap.exists()) out.push({ id: snap.id, ...(snap.data() as Omit<PmAddendum, "id">) })
  }
  return out
}

/** The project, its addenda and the contract in force, read in one transaction. */
export async function readContract(tx: Transaction, firestore: Firestore, projectId: string) {
  const pRef = doc(firestore, "projects", projectId)
  const snap = await tx.get(pRef)
  if (!snap.exists()) throw new PmAddendumError("missing")
  const project = snap.data() as ProjectData
  const pm = project.pm
  if (!pm?.terms) throw new PmAddendumError("not_pm_project")
  const addenda = await readAddenda(tx, firestore, projectId, pm.addendaCount ?? 0)
  const original = pm.original ?? pm.terms
  return { pRef, project, pm, addenda, original, terms: inForce(original, addenda) }
}

const stage = (project: ProjectData) => ({ lifecycle: lifecycleOf(project), archived: Boolean(project.pm) && lifecycleOf(project) === "closed" })

export interface AddendumFile {
  url: string
  name: string
}

export interface DraftInput {
  /** The terms as they should read after this addendum. */
  next: ContractTerms
  reason: AddendumReason
  reasonText?: string | null
  note?: string | null
  files?: AddendumFile[]
  /** The approver records it as already signed — draft and signature in one step. */
  signNow?: { signedOn: string; signatory?: string | null } | null
}

/** Draft an addendum: "awaiting signature" — the contract in force does not move. */
export async function draftAddendum(firestore: Firestore, ctx: PmContext, projectId: string, actor: AddendumActor, input: DraftInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { pRef, project, pm, terms, addenda } = await readContract(tx, firestore, projectId)
    assertPm(withFreshState(ctx, project), "addendum.draft")
    const blocks = draftBlocks({
      ...stage(project),
      terms,
      next: input.next,
      reason: input.reason,
      reasonText: input.reasonText,
      contractValue: await readContractValue(firestore, projectId, project.budget),
      retentionHeld: pm.retentionHeld ?? 0,
    })
    if (blocks.length) throw new PmAddendumError("blocked", blocks)
    seq = (pm.addendaCount ?? 0) + 1
    const signNow = input.signNow ?? null
    if (signNow) {
      assertPm(withFreshState(ctx, project), "addendum.sign")
      const sBlocks = signBlocks({
        ...stage(project),
        addendum: { status: "draft", day: todayDay(), changes: termChanges(terms, input.next) },
        terms,
        signedOn: signNow.signedOn || null,
        lastSignedOn: lastSignedOn(addenda),
        today: todayDay(),
        contractValue: await readContractValue(firestore, projectId, project.budget),
        retentionHeld: pm.retentionHeld ?? 0,
      })
      if (sBlocks.length) throw new PmAddendumError("blocked", sBlocks)
    }
    const signedSeq = signNow ? (pm.signedCount ?? 0) + 1 : null
    const addendum: Omit<PmAddendum, "id"> = {
      seq,
      day: todayDay(),
      by: actor.uid,
      byName: actor.name,
      reason: input.reason,
      reasonText: input.reason === "other" ? input.reasonText?.trim() ?? null : null,
      changes: termChanges(terms, input.next),
      note: input.note?.trim() || null,
      files: input.files ?? [],
      status: signNow ? "signed" : "draft",
      signedOn: signNow?.signedOn ?? null,
      signedSeq,
      signedBy: signNow ? actor.uid : null,
      signedByName: signNow ? actor.name : null,
      signatory: signNow?.signatory?.trim() || null,
      voidOn: null,
      voidBy: null,
      voidByName: null,
      voidReason: null,
      voidText: null,
    }
    tx.set(doc(firestore, "projects", projectId, PM_ADDENDA, addendumNo(seq)), { ...addendum, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    // Signed in the same step: `next` IS the contract in force from now on.
    tx.update(pRef, { pm: { ...pm, addendaCount: seq, ...(signedSeq ? { signedCount: signedSeq, inForce: input.next } : {}) }, updatedAt: serverTimestamp() })
    if (signNow) {
      const event = amendmentEvent({ organizationId: project.organizationId ?? "", projectId, projectNo: pm.no ?? projectId, addendum: { seq, changes: addendum.changes }, signedOn: signNow.signedOn, by: actor.uid, at: new Date().toISOString() })
      if (event) tx.set(doc(firestore, PM_EVENTS, pmEventDocId(event.organizationId, event.key)), event)
    }
  })
  return seq
}

/** Record the client's signature: the addendum enters the contract in force, in
 * signing order, and a financial one sends prj:AMD once (AMD-04, AMD-08). */
export async function signAddendum(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: AddendumActor,
  seq: number,
  input: { signedOn: string; signatory?: string | null; files?: AddendumFile[] }
): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { pRef, project, pm, addenda, original, terms } = await readContract(tx, firestore, projectId)
    assertPm(withFreshState(ctx, project), "addendum.sign")
    const a = addenda.find((x) => x.seq === seq)
    if (!a) throw new PmAddendumError("missing")
    const blocks = signBlocks({
      ...stage(project),
      addendum: a,
      terms,
      signedOn: input.signedOn || null,
      lastSignedOn: lastSignedOn(addenda),
      today: todayDay(),
      contractValue: await readContractValue(firestore, projectId, project.budget),
      retentionHeld: pm.retentionHeld ?? 0,
    })
    if (blocks.length) throw new PmAddendumError("blocked", blocks)
    const signedSeq = (pm.signedCount ?? 0) + 1
    const event = amendmentEvent({
      organizationId: project.organizationId ?? "",
      projectId,
      projectNo: pm.no ?? projectId,
      addendum: a,
      signedOn: input.signedOn,
      by: actor.uid,
      at: new Date().toISOString(),
    })
    tx.update(doc(firestore, "projects", projectId, PM_ADDENDA, addendumNo(seq)), {
      status: "signed",
      signedOn: input.signedOn,
      signedSeq,
      signedBy: actor.uid,
      signedByName: actor.name,
      signatory: input.signatory?.trim() || null,
      ...(input.files?.length ? { files: [...(a.files ?? []), ...input.files] } : {}),
      updatedAt: serverTimestamp(),
    })
    // The contract in force with this addendum signed, left on the project for
    // those who cannot read the addenda (measurement, units, deadlines).
    const now = inForce(original, addenda.map((x) => (x.seq === seq ? { ...x, status: "signed" as const, signedSeq } : x)))
    tx.update(pRef, { pm: { ...pm, signedCount: signedSeq, inForce: now }, updatedAt: serverTimestamp() })
    if (event) tx.set(doc(firestore, PM_EVENTS, pmEventDocId(event.organizationId, event.key)), event)
  })
}

/** Withdraw a draft before signing, with a reason: it stays in the record as
 * "withdrawn before signing" — nothing is deleted (AMD-06). */
export async function withdrawAddendum(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: AddendumActor,
  seq: number,
  input: { reason: WithdrawReason; reasonText?: string | null }
): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project, addenda } = await readContract(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    const a = addenda.find((x) => x.seq === seq)
    if (!a) throw new PmAddendumError("missing")
    if (!mayWithdrawAddendum(fresh, actor.uid, a.by)) throw new PmAccessError(fresh.archived ? "archived" : "no_duty", "addendum.withdraw")
    const blocks = withdrawBlocks({ addendum: a, reason: input.reason, reasonText: input.reasonText })
    if (blocks.length) throw new PmAddendumError("blocked", blocks)
    tx.update(doc(firestore, "projects", projectId, PM_ADDENDA, addendumNo(seq)), {
      status: "void",
      voidOn: todayDay(),
      voidBy: actor.uid,
      voidByName: actor.name,
      voidReason: input.reason,
      voidText: input.reason === "other" ? input.reasonText?.trim() ?? null : null,
      updatedAt: serverTimestamp(),
    })
  })
}
