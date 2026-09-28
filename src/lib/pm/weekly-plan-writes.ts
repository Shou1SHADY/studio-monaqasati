// PM 1.0 — weekly plan writes (WF-21). Committed and closed by whoever
// measures or approves (`weeklyPlan.manage`); one plan a week under its first
// day, one transaction each with the guard first. The constraints open at
// commitment are recorded with the task — a commitment with open constraints
// is allowed, and PPC shows what it cost.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"
import { closeWeekBlocks, commitBlocks, PM_WEEKS, weekStart, type MissReason, type PmWeek, type WeekTask } from "./weekly-plan"

export class PmWeekError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmWeekError"
  }
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: Record<string, unknown> }
type Actor = { uid: string; name: string | null }

async function guard(tx: Transaction, firestore: Firestore, ctx: PmContext, projectId: string) {
  const snap = await tx.get(doc(firestore, "projects", projectId))
  if (!snap.exists()) throw new PmWeekError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmWeekError("not_pm_project")
  const fresh = withFreshState(ctx, project)
  assertPm(fresh, "weeklyPlan.manage")
  return { project, fresh }
}

/** Commit this week's tasks. Returns the week's first day (the plan's id). */
export async function commitWeek(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, tasks: WeekTask[]): Promise<string> {
  const week = weekStart(todayDay())
  await runTransaction(firestore, async (tx) => {
    const { project, fresh } = await guard(tx, firestore, ctx, projectId)
    const ref = doc(firestore, "projects", projectId, PM_WEEKS, week)
    const existing = await tx.get(ref)
    const blocks = commitBlocks({ archived: fresh.archived, tasks, exists: existing.exists() })
    if (blocks.length) throw new PmWeekError("blocked", blocks)
    const plan: Omit<PmWeek, "id"> = {
      week,
      status: "open",
      tasks: tasks.map((t) => ({ activityId: t.activityId, name: t.name, qty: t.qty, unit: t.unit ?? null, ready: t.ready, open: t.open ?? [], done: null, why: null, whyText: null })),
      by: actor.uid,
      byName: actor.name,
      closedOn: null,
      closedBy: null,
      closedByName: null,
    }
    tx.set(ref, { ...plan, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
  })
  return week
}

/** Close the week: done or not, and why not. */
export async function closeWeek(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, week: string, results: Array<{ done: boolean; why?: MissReason | null; whyText?: string | null }>): Promise<number> {
  let pc = 0
  await runTransaction(firestore, async (tx) => {
    const { fresh } = await guard(tx, firestore, ctx, projectId)
    const ref = doc(firestore, "projects", projectId, PM_WEEKS, week)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmWeekError("missing")
    const plan = snap.data() as Omit<PmWeek, "id">
    const blocks = closeWeekBlocks({ archived: fresh.archived, status: plan.status, results })
    if (blocks.length || results.length !== plan.tasks.length) throw new PmWeekError("blocked", blocks.length ? blocks : ["no_reason"])
    const tasks = plan.tasks.map((t, i) => {
      const r = results[i]
      return { ...t, done: r.done, why: r.done ? null : r.why ?? null, whyText: r.done || r.why !== "other" ? null : r.whyText?.trim() ?? null }
    })
    pc = tasks.length ? Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100) : 0
    tx.update(ref, { status: "done", tasks, closedOn: todayDay(), closedBy: actor.uid, closedByName: actor.name, updatedAt: serverTimestamp() })
  })
  return pc
}
