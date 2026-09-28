// PM 1.0 — claim writes (WF-07). Drafted and noticed by prep | approve,
// submitted and answered by approve; one transaction each, guard first. A
// grant with days draws the next programme revision (`pm.programmeRev`).

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmAction, type PmContext } from "./access"
import { claimBlocks, claimNo, claimStepBlocks, PM_CLAIMS, respondBlocks, type ClaimCause, type ClaimKind, type ClaimResponse, type PmClaim } from "./claim"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { withFreshState } from "./project-writes"
import { PM_OBSTACLES } from "./site"

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
  /** The obstacle that evidences the claim, when drafted from one. */
  obstacleId?: string | null
  causedBy?: ClaimCause | null
  causedByText?: string | null
  /** "I sent the notice to the consultant today": logged straight as noticed. */
  noticeToday?: boolean
}

export async function draftClaim(firestore: Firestore, ctx: PmContext, projectId: string, actor: ClaimActor, input: ClaimInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "claim.draft")
    const obstacleId = input.obstacleId || null
    const obstacle = obstacleId ? await tx.get(doc(firestore, "projects", projectId, PM_OBSTACLES, obstacleId)) : null
    const blocks: string[] = claimBlocks({ archived: fresh.archived, lifecycle: lifecycleOf(project), ...input, today: todayDay() })
    if (obstacle && !obstacle.exists()) blocks.push("no_obstacle")
    if (blocks.length) throw new PmClaimError("blocked", blocks)
    seq = (pm.claimCount ?? 0) + 1
    const claim: Omit<PmClaim, "id"> = {
      seq,
      kind: input.kind,
      cause: input.cause.trim(),
      eventOn: input.eventOn,
      causedBy: input.causedBy ?? null,
      causedByText: input.causedBy === "oth" ? input.causedByText?.trim() || null : null,
      daysAsked: input.kind === "cost" ? 0 : input.daysAsked,
      amountAsked: input.kind === "time" ? 0 : input.amountAsked,
      status: input.noticeToday ? "notice" : "draft",
      by: actor.uid,
      byName: actor.name,
      noticeOn: input.noticeToday ? todayDay() : null,
      submittedOn: null,
      response: null,
      revision: null,
      obstacleId,
    }
    tx.set(doc(firestore, "projects", projectId, PM_CLAIMS, claimNo(seq)), { ...claim, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, claimCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

async function step(firestore: Firestore, ctx: PmContext, projectId: string, seq: number, which: "notice" | "submit", detail: { daysAsked?: number; amountAsked?: number } = {}) {
  const action: PmAction = which === "notice" ? "claim.draft" : "claim.submit"
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, action)
    const ref = doc(firestore, "projects", projectId, PM_CLAIMS, claimNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmClaimError("missing")
    const c = snap.data() as PmClaim
    const daysAsked = detail.daysAsked ?? c.daysAsked
    const amountAsked = detail.amountAsked ?? c.amountAsked
    const blocks = claimStepBlocks({ archived: fresh.archived, status: c.status, step: which, kind: c.kind, daysAsked, amountAsked })
    if (blocks.length) throw new PmClaimError("blocked", blocks)
    tx.update(
      ref,
      which === "notice"
        ? { status: "notice", noticeOn: todayDay(), updatedAt: serverTimestamp() }
        : { status: "sub", submittedOn: todayDay(), daysAsked: c.kind === "cost" ? 0 : daysAsked, amountAsked: c.kind === "time" ? 0 : amountAsked, updatedAt: serverTimestamp() }
    )
  })
}

/** The notice to the client — its deadline ran from the event. */
export const sendClaimNotice = (firestore: Firestore, ctx: PmContext, projectId: string, seq: number) => step(firestore, ctx, projectId, seq, "notice")
/** The detailed submission — the days and the amount are fixed here, estimated, never invented earlier. */
export const submitClaim = (firestore: Firestore, ctx: PmContext, projectId: string, seq: number, detail: { daysAsked?: number; amountAsked?: number } = {}) => step(firestore, ctx, projectId, seq, "submit", detail)

/** The client's response (CLM-02). Granted days issue the next programme revision (CLM-03). */
export async function respondToClaim(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: ClaimActor,
  seq: number,
  input: { response: unknown; days: number | null; amount: number | null; ref?: string | null }
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
    tx.update(ref, { status: response, response: { on: todayDay(), by: actor.uid, byName: actor.name, days, amount, ref: input.ref?.trim() || null }, revision, updatedAt: serverTimestamp() })
  })
  return { revision }
}
