// PM 1.0 — handover writes (WF-25). Progress and open punch items are read
// right before the transaction (a project-wide read cannot run inside one);
// the transaction then re-reads the project and its contract in force, runs
// the guard and the blocks, records the handover and sends prj:HND once.

import { collection, doc, getDocs, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { defectsEnd, finalBlocks, handoverEvent, progressOf, provisionalBlocks, retentionIncrement, type Acceptances } from "./acceptance"
import { readContract } from "./addendum-writes"
import { eventDocId, PM_EVENTS } from "./events"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { measuredItem } from "./measurement-writes"
import { withFreshState } from "./project-writes"
import { isOpenPunch, PM_PUNCH, type PunchItem } from "./punch"

export class PmAcceptanceError extends Error {
  constructor(readonly code: "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmAcceptanceError"
  }
}

export interface AcceptanceActor {
  uid: string
  name: string | null
}

/** Progress by value, read from the project's BOQ now. */
/** Retention already sent claimable by earlier handover events (provisional, delivery units). */
export const freedOf = (pm: object) => Number((pm as { retentionFreed?: number }).retentionFreed) || 0

export async function readProgress(firestore: Firestore, projectId: string): Promise<number | null> {
  const snap = await getDocs(collection(firestore, "projects", projectId, "boqItems"))
  return progressOf(snap.docs.map((d) => measuredItem(d.id, d.data() as Record<string, unknown>)))
}

export async function countOpenPunch(firestore: Firestore, projectId: string): Promise<number> {
  const snap = await getDocs(collection(firestore, "projects", projectId, PM_PUNCH))
  return snap.docs.filter((d) => isOpenPunch(d.data() as PunchItem)).length
}

/** Provisional handover at ≥ 99%: the defects period starts; half the retention
 * becomes claimable at Finance on a "half" release term. */
export async function recordProvisional(firestore: Firestore, ctx: PmContext, projectId: string, actor: AcceptanceActor): Promise<void> {
  const progress = await readProgress(firestore, projectId)
  await runTransaction(firestore, async (tx) => {
    const { pRef, project, pm, terms } = await readContract(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "handover.provisional")
    const acceptances = ((pm as { acceptances?: Acceptances }).acceptances ?? {}) as Acceptances
    const blocks = provisionalBlocks({ archived: fresh.archived, lifecycle: lifecycleOf(project), acceptances, progress })
    if (blocks.length) throw new PmAcceptanceError("blocked", blocks)
    const on = todayDay()
    const next: Acceptances = { ...acceptances, prov: { on, by: actor.uid, byName: actor.name } }
    const event = handoverEvent({
      organizationId: project.organizationId ?? "",
      projectId,
      projectNo: pm.no ?? projectId,
      stage: "prov",
      on,
      claimable: retentionIncrement(pm.retentionHeld ?? 0, terms.retentionRelease, next, freedOf(pm)),
      by: actor.uid,
      at: new Date().toISOString(),
    })
    tx.update(pRef, { pm: { ...pm, acceptances: next, retentionFreed: freedOf(pm) + event.amount }, updatedAt: serverTimestamp() })
    tx.set(doc(firestore, PM_EVENTS, eventDocId(event.key)), event)
  })
}

/** Final acceptance: after the provisional, with no open punch item. The
 * project is handed over (done) and the rest of the retention is claimable. */
export async function recordFinal(firestore: Firestore, ctx: PmContext, projectId: string, actor: AcceptanceActor): Promise<void> {
  const openPunch = await countOpenPunch(firestore, projectId)
  await runTransaction(firestore, async (tx) => {
    const { pRef, project, pm, terms } = await readContract(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "handover.final")
    const acceptances = ((pm as { acceptances?: Acceptances }).acceptances ?? {}) as Acceptances
    const today = todayDay()
    const blocks = finalBlocks({ archived: fresh.archived, lifecycle: lifecycleOf(project), acceptances, openPunch, defectsEnd: acceptances.prov ? defectsEnd(acceptances.prov.on, terms.defectsDays) : null, today })
    if (blocks.length) throw new PmAcceptanceError("blocked", blocks)
    const on = todayDay()
    const next: Acceptances = { ...acceptances, final: { on, by: actor.uid, byName: actor.name } }
    const event = handoverEvent({
      organizationId: project.organizationId ?? "",
      projectId,
      projectNo: pm.no ?? projectId,
      stage: "final",
      on,
      claimable: retentionIncrement(pm.retentionHeld ?? 0, terms.retentionRelease, next, freedOf(pm)),
      by: actor.uid,
      at: new Date().toISOString(),
    })
    tx.update(pRef, { pm: { ...pm, acceptances: next, lifecycle: "done", retentionFreed: freedOf(pm) + event.amount }, status: "remaining_payment", updatedAt: serverTimestamp() })
    tx.set(doc(firestore, PM_EVENTS, eventDocId(event.key)), event)
  })
}
