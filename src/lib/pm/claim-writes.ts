// PM 1.0 — claim writes (WF-07). Drafted and noticed by prep | approve,
// submitted and answered by approve; one transaction each, guard first. A
// grant with days draws the next programme revision (`pm.programmeRev`).

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmAction, type PmContext } from "./access"
import { claimBlocks, claimNo, claimStepBlocks, PM_CLAIMS, respondBlocks, type ClaimKind, type ClaimResponse, type PmClaim } from "./claim"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { withFreshState } from "./project-writes"

export class PmClaimError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmClaimError"
  }
}

export interface ClaimActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; claimCount?: number; programmeRev?: number } & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmClaimError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmClaimError("not_pm_project")
  return { ref, project, pm: project.pm }
}

export interface ClaimInput {
  kind: ClaimKind
  cause: string
  eventOn: string
  daysAsked: number
  amountAsked: number
}

export async function draftClaim(firestore: Firestore, ctx: PmContext, projectId: string, actor: ClaimActor, input: ClaimInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "claim.draft")
    const blocks = claimBlocks({ archived: fresh.archived, lifecycle: lifecycleOf(project), ...input, today: todayDay() })
    if (blocks.length) throw new PmClaimError("blocked", blocks)
    seq = (pm.claimCount ?? 0) + 1
    const claim: Omit<PmClaim, "id"> = {
      seq,
      kind: input.kind,
      cause: input.cause.trim(),
      eventOn: input.eventOn,
      daysAsked: input.kind === "cost" ? 0 : input.daysAsked,
      amountAsked: input.kind === "time" ? 0 : input.amountAsked,
      status: "draft",
      by: actor.uid,
      byName: actor.name,
      noticeOn: null,
      submittedOn: null,
      response: null,
      revision: null,
    }
    tx.set(doc(firestore, "projects", projectId, PM_CLAIMS, claimNo(seq)), { ...claim, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, claimCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

async function step(firestore: Firestore, ctx: PmContext, projectId: string, seq: number, which: "notice" | "submit") {
  const action: PmAction = which === "notice" ? "claim.draft" : "claim.submit"
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, action)
    const ref = doc(firestore, "projects", projectId, PM_CLAIMS, claimNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmClaimError("missing")
    const blocks = claimStepBlocks({ archived: fresh.archived, status: (snap.data() as PmClaim).status, step: which })
    if (blocks.length) throw new PmClaimError("blocked", blocks)
    tx.update(ref, which === "notice" ? { status: "notice", noticeOn: todayDay(), updatedAt: serverTimestamp() } : { status: "sub", submittedOn: todayDay(), updatedAt: serverTimestamp() })
  })
}

/** The notice to the client — its deadline ran from the event. */
export const sendClaimNotice = (firestore: Firestore, ctx: PmContext, projectId: string, seq: number) => step(firestore, ctx, projectId, seq, "notice")
/** The detailed submission. */
export const submitClaim = (firestore: Firestore, ctx: PmContext, projectId: string, seq: number) => step(firestore, ctx, projectId, seq, "submit")

/** The client's response (CLM-02). Granted days issue the next programme revision (CLM-03). */
export async function respondToClaim(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: ClaimActor,
  seq: number,
  input: { response: unknown; days: number | null; amount: number | null }
): Promise<{ revision: number | null }> {
  let revision: number | null = null
  await runTransaction(firestore, async (tx) => {
    const { ref: pRef, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "claim.respond")
    const ref = doc(firestore, "projects", projectId, PM_CLAIMS, claimNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmClaimError("missing")
    const claim = snap.data() as PmClaim
    const blocks = respondBlocks({ archived: fresh.archived, status: claim.status, kind: claim.kind, response: input.response, days: input.days, amount: input.amount })
    if (blocks.length) throw new PmClaimError("blocked", blocks)
    const response = input.response as ClaimResponse
    const days = response === "rej" || claim.kind === "cost" ? 0 : (input.days ?? 0)
    const amount = response === "rej" || claim.kind === "time" ? 0 : (input.amount ?? 0)
    if (days > 0) {
      revision = (pm.programmeRev ?? 0) + 1
      tx.update(pRef, { pm: { ...pm, programmeRev: revision }, updatedAt: serverTimestamp() })
    }
    tx.update(ref, { status: response, response: { on: todayDay(), by: actor.uid, byName: actor.name, days, amount }, revision, updatedAt: serverTimestamp() })
  })
  return { revision }
}
