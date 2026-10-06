import { collection, doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { todayDay } from "./pm/format"
import { emitProcEvent } from "./procurement/events"
import { ACTIVITIES, activityBlocks, mayManage, rescheduleBlock, targetKeyOf, type ActivityBlock, type ActivityTarget, type ActivityType } from "./activities"

export type ActivityErrorCode = "missing" | "closed" | "not_allowed" | "blocked"

export class ActivityError extends Error {
  constructor(readonly code: ActivityErrorCode, readonly blocks: ActivityBlock[] = []) {
    super(code)
    this.name = "ActivityError"
  }
}

export interface ActivityActor {
  uid: string
  name: string
  isOwner?: boolean
}

export type ActivityPortal = "contractor" | "supplier"

export interface NewActivity {
  type: ActivityType
  summary: string
  note?: string | null
  dueOn: string
  assignee: { id: string; name: string }
  target?: ActivityTarget | null
}

const activitiesLink = (portal: ActivityPortal) => `/${portal}/activities`

/** The notification names the document by its label, or by the "none" key. */
const aboutParam = (target: ActivityTarget | null | undefined) => target?.label || "@pn_activity_about_none"

/** Plans a follow-up for a person; the assignee is told after the write (best effort). */
export async function createActivity(firestore: Firestore, actor: ActivityActor, organizationId: string, portal: ActivityPortal, input: NewActivity): Promise<string> {
  const summary = input.summary.trim()
  const note = input.note?.trim() || null
  const blocks = activityBlocks({ type: input.type, summary, note, dueOn: input.dueOn, assigneeId: input.assignee.id, today: todayDay() })
  if (blocks.length) throw new ActivityError("blocked", blocks)
  const target = input.target ?? null
  const ref = doc(collection(firestore, ACTIVITIES))
  await runTransaction(firestore, async (tx) => {
    tx.set(ref, {
      organizationId,
      type: input.type,
      summary,
      note,
      dueOn: input.dueOn,
      assigneeId: input.assignee.id,
      assigneeName: input.assignee.name,
      createdById: actor.uid,
      createdByName: actor.name,
      status: "open",
      target,
      targetKey: targetKeyOf(target),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
  if (input.assignee.id !== actor.uid) {
    await emitProcEvent(firestore, { uid: actor.uid, name: actor.name }, {
      kind: "activity_assigned",
      organizationId,
      to: [{ users: [input.assignee.id] }],
      params: { summary, type: `@pn_activity_type_${input.type}`, due: input.dueOn, about: aboutParam(target) },
      link: activitiesLink(portal),
    })
  }
  return ref.id
}

async function openActivity(firestore: Firestore, actor: ActivityActor, id: string, change: (data: Record<string, unknown>) => Record<string, unknown>) {
  let told: { organizationId: string; createdById: string; summary: string; target: ActivityTarget | null } | null = null
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, ACTIVITIES, id)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ActivityError("missing")
    const data = snap.data() as Record<string, unknown> & { status: "open" | "done" | "cancelled"; assigneeId: string; createdById: string; organizationId: string; summary: string; target?: ActivityTarget | null }
    if (data.status !== "open") throw new ActivityError("closed")
    if (!mayManage(data, actor.uid, Boolean(actor.isOwner))) throw new ActivityError("not_allowed")
    tx.update(ref, { ...change(data), updatedAt: serverTimestamp() })
    told = { organizationId: data.organizationId, createdById: data.createdById, summary: data.summary, target: data.target ?? null }
  })
  return told as { organizationId: string; createdById: string; summary: string; target: ActivityTarget | null } | null
}

/** Marks an open activity done, with what came of it; the one who planned it is told. */
export async function completeActivity(firestore: Firestore, actor: ActivityActor, portal: ActivityPortal, id: string, feedback?: string | null): Promise<void> {
  const text = feedback?.trim() || null
  if ((text ?? "").length > 1000) throw new ActivityError("blocked", ["note_long"])
  const told = await openActivity(firestore, actor, id, () => ({ status: "done", doneOn: todayDay(), doneById: actor.uid, doneByName: actor.name, feedback: text }))
  if (told && told.createdById !== actor.uid) {
    await emitProcEvent(firestore, { uid: actor.uid, name: actor.name }, {
      kind: "activity_done",
      organizationId: told.organizationId,
      to: [{ users: [told.createdById] }],
      params: { summary: told.summary, about: aboutParam(told.target) },
      link: activitiesLink(portal),
    })
  }
}

/** Moves an open activity to a day that is today or later. */
export async function rescheduleActivity(firestore: Firestore, actor: ActivityActor, id: string, dueOn: string): Promise<void> {
  const block = rescheduleBlock(dueOn, todayDay())
  if (block) throw new ActivityError("blocked", [block])
  await openActivity(firestore, actor, id, () => ({ dueOn }))
}

/** Cancels an open activity — it stays on file, it is never deleted. */
export async function cancelActivity(firestore: Firestore, actor: ActivityActor, id: string): Promise<void> {
  await openActivity(firestore, actor, id, () => ({ status: "cancelled", doneOn: todayDay(), doneById: actor.uid, doneByName: actor.name }))
}
