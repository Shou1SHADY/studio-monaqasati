// PM 1.0 — non-conformance writes (WF-18). Recorded by quality (`qa`), one
// transaction each with the guard first; the project numbers them.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { cleanAttachments, type PmAttachment } from "./attachments"
import { todayDay } from "./format"
import { ncrBlocks, ncrNo, ncrStepBlocks, PM_NCRS, type NcrSeverity, type PmNcr } from "./ncr"
import { withFreshState } from "./project-writes"

export class PmNcrError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmNcrError"
  }
}

export interface NcrActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; ncrCount?: number } & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmNcrError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmNcrError("not_pm_project")
  return { ref, project, pm: project.pm }
}

export interface RaiseNcrInput {
  itemId?: string | null
  severity: NcrSeverity
  root: string
  cost: number
  /** What went against the specification — required from the screen. */
  what?: string
  /** The day it was found (defaults to today). */
  day?: string
  files?: PmAttachment[] | null
}

export async function raiseNcr(firestore: Firestore, ctx: PmContext, projectId: string, actor: NcrActor, input: RaiseNcrInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const item = input.itemId ? await tx.get(doc(firestore, "projects", projectId, "boqItems", input.itemId)) : null
    const today = todayDay()
    const blocks: string[] = ncrBlocks({ archived: fresh.archived, root: input.root, cost: input.cost, what: input.what, day: input.day ?? today, today })
    if (item && !item.exists()) blocks.push("no_item")
    if (blocks.length) throw new PmNcrError("blocked", blocks)
    seq = (pm.ncrCount ?? 0) + 1
    const ncr: Omit<PmNcr, "id"> = {
      seq,
      itemId: input.itemId || "",
      code: (item?.data() as { itemNo?: string } | undefined)?.itemNo ?? null,
      what: input.what?.trim() || null,
      severity: input.severity,
      root: input.root.trim(),
      cost: input.cost,
      status: "open",
      day: input.day || today,
      by: actor.uid,
      byName: actor.name,
      files: cleanAttachments(input.files),
      plan: null,
      accepted: null,
    }
    tx.set(doc(firestore, "projects", projectId, PM_NCRS, ncrNo(seq)), { ...ncr, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, ncrCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

type StepCheck = { text?: string | null; cost?: number | null; day?: string; today?: string }

async function step(firestore: Firestore, ctx: PmContext, projectId: string, seq: number, which: "plan" | "accept", check: StepCheck, patch: () => Record<string, unknown>) {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const ref = doc(firestore, "projects", projectId, PM_NCRS, ncrNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmNcrError("missing")
    const ncr = snap.data() as PmNcr
    const blocks = ncrStepBlocks({ archived: fresh.archived, status: ncr.status, step: which, ...check, after: which === "accept" ? ncr.plan?.on ?? ncr.day : null })
    if (blocks.length) throw new PmNcrError("blocked", blocks)
    tx.update(ref, { ...patch(), updatedAt: serverTimestamp() })
  })
}

/** The corrective and preventive plan is submitted; money holders may revise the cost with it. */
export const submitNcrPlan = (firestore: Firestore, ctx: PmContext, projectId: string, actor: NcrActor, seq: number, text: string, opts: { cost?: number | null; files?: PmAttachment[] | null } = {}) =>
  step(firestore, ctx, projectId, seq, "plan", { text, cost: opts.cost }, () => ({
    status: "plan",
    plan: { on: todayDay(), by: actor.uid, byName: actor.name, text: text.trim(), cost: opts.cost ?? null, files: cleanAttachments(opts.files) },
  }))

/** The consultant accepted the correction — closed, on the consultant's day,
 * with the actual rework cost when a money holder records it. */
export const acceptNcr = (firestore: Firestore, ctx: PmContext, projectId: string, actor: NcrActor, seq: number, opts: { on?: string; cost?: number | null; files?: PmAttachment[] | null } = {}) => {
  const today = todayDay()
  return step(firestore, ctx, projectId, seq, "accept", { cost: opts.cost, day: opts.on ?? today, today }, () => ({
    status: "done",
    accepted: { on: opts.on || today, by: actor.uid, byName: actor.name, cost: opts.cost ?? null, recordedOn: today, files: cleanAttachments(opts.files) },
  }))
}
