// PM 1.0 — variation writes (WF-06). One transaction each with the guard
// first: logged by `vo`, decided by `approve`; the project numbers them.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmAction, type PmContext } from "./access"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"
import { decisionDateBlocks, logBlocks, PM_VARIATIONS, stepBlocks, voNo, type PmVariation, type VoFile, type VoSource } from "./variation"

export class PmVariationError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmVariationError"
  }
}

export interface VoActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; voCount?: number } & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmVariationError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmVariationError("not_pm_project")
  return { ref, project, pm: project.pm }
}

export interface LogInput {
  title: string
  source: VoSource
  sourceText?: string | null
  instructionNo?: string | null
  value: number
  cost: number
  executedPct: number
  /** The day it was asked; defaults to today. */
  requestedOn?: string | null
  itemIds?: string[]
  days?: number
  files?: VoFile[]
}

/** Logged the day it is asked (VO-01); it changes no value until approved (VO-02). */
export async function logVariation(firestore: Firestore, ctx: PmContext, projectId: string, actor: VoActor, input: LogInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "variation.log")
    const today = todayDay()
    const requestedOn = input.requestedOn || today
    const blocks = logBlocks({ archived: fresh.archived, ...input, requestedOn, days: input.days ?? 0, today })
    if (blocks.length) throw new PmVariationError("blocked", blocks)
    seq = (pm.voCount ?? 0) + 1
    const vo: Omit<PmVariation, "id"> = {
      seq,
      title: input.title.trim(),
      source: input.source,
      sourceText: input.source === "oth" ? input.sourceText?.trim() ?? null : null,
      instructionNo: input.instructionNo?.trim() || null,
      day: requestedOn,
      loggedOn: today,
      itemIds: input.itemIds ?? [],
      days: input.days ?? 0,
      files: input.files ?? [],
      value: input.value,
      cost: input.cost,
      executedPct: input.executedPct,
      status: "draft",
      by: actor.uid,
      byName: actor.name,
      decision: null,
    }
    tx.set(doc(firestore, "projects", projectId, PM_VARIATIONS, voNo(seq)), { ...vo, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, voCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

async function step(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  seq: number,
  action: PmAction,
  check: (vo: PmVariation, archived: boolean) => string[],
  patch: (vo: PmVariation) => Record<string, unknown>
) {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, action)
    const ref = doc(firestore, "projects", projectId, PM_VARIATIONS, voNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmVariationError("missing")
    const vo = { id: snap.id, ...(snap.data() as Omit<PmVariation, "id">) }
    const blocks = check(vo, fresh.archived)
    if (blocks.length) throw new PmVariationError("blocked", blocks)
    tx.update(ref, { ...patch(vo), updatedAt: serverTimestamp() })
  })
}

/** Priced while a draft; the price is fixed once it goes to the client. */
export const priceVariation = (firestore: Firestore, ctx: PmContext, projectId: string, seq: number, input: { value: number; cost: number; instructionNo?: string | null; days?: number; files?: VoFile[] }) =>
  step(
    firestore,
    ctx,
    projectId,
    seq,
    "variation.log",
    (vo, archived) => [
      ...stepBlocks({ archived, status: vo.status, step: "reprice" }),
      ...(Number.isFinite(input.value) && input.value >= 0 && Number.isFinite(input.cost) && input.cost >= 0 ? [] : ["bad_value"]),
      ...(input.days === undefined || (Number.isInteger(input.days) && input.days >= 0) ? [] : ["bad_days"]),
    ],
    (vo) => ({
      value: input.value,
      cost: input.cost,
      instructionNo: input.instructionNo?.trim() || null,
      ...(input.days !== undefined ? { days: input.days } : {}),
      ...(input.files?.length ? { files: [...(vo.files ?? []), ...input.files] } : {}),
    })
  )

/** How much of its work is executed — moves until it is decided, and after approval. */
export const recordVariationProgress = (firestore: Firestore, ctx: PmContext, projectId: string, seq: number, executedPct: number, instructionNo?: string | null) =>
  step(firestore, ctx, projectId, seq, "variation.log", (vo, archived) => stepBlocks({ archived, status: vo.status, step: "progress", executedPct, billedPct: vo.billedPct }), (vo) => ({
    executedPct,
    ...(instructionNo !== undefined ? { instructionNo: instructionNo?.trim() || vo.instructionNo || null } : {}),
  }))

export const submitVariation = (firestore: Firestore, ctx: PmContext, projectId: string, seq: number) =>
  step(firestore, ctx, projectId, seq, "variation.log", (vo, archived) => stepBlocks({ archived, status: vo.status, step: "submit", value: vo.value }), () => ({ status: "wait" }))

export interface DecisionInput {
  /** The day the written answer is dated; defaults to today. */
  on?: string | null
  files?: VoFile[]
}

const decided = (vo: PmVariation, on: string | null | undefined) => decisionDateBlocks({ on: on || todayDay(), requestedOn: vo.day, today: todayDay() })

/** The written approval as it arrived (date, reference, the signed paper) — the value enters the contract now. */
export const approveVariation = (firestore: Firestore, ctx: PmContext, projectId: string, actor: VoActor, seq: number, ref?: string | null, input: DecisionInput = {}) =>
  step(firestore, ctx, projectId, seq, "variation.decide", (vo, archived) => [...stepBlocks({ archived, status: vo.status, step: "approve" }), ...decided(vo, input.on)], () => ({
    status: "appr",
    decision: { on: input.on || todayDay(), by: actor.uid, byName: actor.name, ref: ref?.trim() || null, reason: null, files: input.files ?? [] },
  }))

/** The rejection with its reason as it came, dated. */
export const rejectVariation = (firestore: Firestore, ctx: PmContext, projectId: string, actor: VoActor, seq: number, reason: string, input: DecisionInput = {}) =>
  step(firestore, ctx, projectId, seq, "variation.decide", (vo, archived) => [...stepBlocks({ archived, status: vo.status, step: "reject", reason }), ...decided(vo, input.on)], () => ({
    status: "rej",
    decision: { on: input.on || todayDay(), by: actor.uid, byName: actor.name, ref: null, reason: reason.trim(), files: input.files ?? [] },
  }))
