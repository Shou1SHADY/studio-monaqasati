// PM 1.0 — postponing a live project and resuming it (PRD §7: live ⇄ hold). The
// hold keeps its day and its reason on the pm block (`holdSince`, `holdWhy`):
// the portfolio card shows «مؤجَّل منذ N يوماً — السبب», and the `hold` decision
// ages from that day (indirect costs keep running while production stops).
// Resuming clears them and keeps the last one in `holdLog`. Approve only; one
// transaction each, the guard first on the project just read.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { todayDay } from "./format"
import { canMove, lifecycleOf, type PmLifecycle } from "./lifecycle"
import { withFreshState } from "./project-writes"

export class PmHoldError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: HoldBlock[] = []) {
    super(code)
    this.name = "PmHoldError"
  }
}

export type HoldBlock = "archived" | "not_live" | "not_held" | "no_reason" | "bad_day"

export interface HoldEntry {
  since: string
  why: string
  until: string
  by: string
  byName?: string | null
}

export function holdBlocks(input: { archived: boolean; lifecycle: PmLifecycle; to: "hold" | "live"; why?: string | null; since?: string | null; today: string }): HoldBlock[] {
  const out: HoldBlock[] = []
  if (input.archived) out.push("archived")
  if (input.to === "hold") {
    if (!canMove(input.lifecycle, "hold")) out.push("not_live")
    if (!input.why?.trim()) out.push("no_reason")
    if (!input.since || input.since > input.today) out.push("bad_day")
  } else if (input.lifecycle !== "hold") out.push("not_held")
  return out
}

type PmBlock = { lifecycle?: string; holdSince?: string | null; holdWhy?: string | null; holdLog?: HoldEntry[] } & Record<string, unknown>
type ProjectData = { pm?: PmBlock; status?: string; projectManagerId?: string | null }

async function move(firestore: Firestore, ctx: PmContext, projectId: string, build: (data: ProjectData & { pm: PmBlock }, fresh: PmContext) => Record<string, unknown>) {
  const ref = doc(firestore, "projects", projectId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmHoldError("missing")
    const data = snap.data() as ProjectData
    if (!data.pm) throw new PmHoldError("not_pm_project")
    const fresh = withFreshState(ctx, data)
    assertPm(fresh, "project.edit")
    tx.update(ref, { ...build(data as ProjectData & { pm: PmBlock }, fresh), updatedAt: serverTimestamp() })
  })
}

/** Postpone: live → hold, with the day it stopped and why. */
export async function holdProject(firestore: Firestore, ctx: PmContext, projectId: string, input: { why: string; since: string }): Promise<void> {
  await move(firestore, ctx, projectId, (data, fresh) => {
    const blocks = holdBlocks({ archived: fresh.archived, lifecycle: lifecycleOf(data), to: "hold", why: input.why, since: input.since, today: todayDay() })
    if (blocks.length) throw new PmHoldError("blocked", blocks)
    return { pm: { ...data.pm, lifecycle: "hold", holdSince: input.since, holdWhy: input.why.trim() }, status: "hold" }
  })
}

/** Resume: hold → live; the hold goes to the log with the day it ended. */
export async function resumeProject(firestore: Firestore, ctx: PmContext, projectId: string, actor: { uid: string; name: string | null }): Promise<void> {
  await move(firestore, ctx, projectId, (data, fresh) => {
    const blocks = holdBlocks({ archived: fresh.archived, lifecycle: lifecycleOf(data), to: "live", today: todayDay() })
    if (blocks.length) throw new PmHoldError("blocked", blocks)
    const entry: HoldEntry = { since: data.pm.holdSince ?? todayDay(), why: data.pm.holdWhy ?? "", until: todayDay(), by: actor.uid, byName: actor.name }
    return { pm: { ...data.pm, lifecycle: "live", holdSince: null, holdWhy: null, holdLog: [...(data.pm.holdLog ?? []), entry] }, status: "working" }
  })
}
