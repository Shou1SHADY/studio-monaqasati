// PM 1.0 — writes on a PM project's own block (`pm` on the project document):
// completing the original terms before start (TRM-01) and starting work, which
// freezes that original for good (TRM-02, WF-03). Each is one transaction that
// re-reads the project, so a stale screen cannot overwrite a started contract,
// and each runs the guard first with the archived state it just read (RL-02).
// Completing the original records who did it last (`termsBy`), and an advance
// changed after Finance received prj:ADV is logged on the project (`advLog`,
// newest first) and told to Finance under its own key — never a second prj:ADV.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { advanceChangeEvent, eventDocId, PM_EVENTS } from "./events"
import { todayDay } from "./format"
import { lifecycleOf, startBlocks } from "./lifecycle"
import { termProblems, termsEditable, type ContractTerms } from "./terms"

export class PmProjectError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "started" | "invalid" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmProjectError"
  }
}

type PmBlock = { lifecycle?: string; no?: string; terms?: ContractTerms; original?: ContractTerms | null; startedAt?: string | null; advLog?: AdvanceChange[] } & Record<string, unknown>

/** An advance changed before start after Finance already held the original. */
export interface AdvanceChange {
  from: number
  to: number
  on: string
  by: string
  byName?: string | null
}

/** Whether saving these terms changes an advance Finance already received. */
export const advanceChangedAfterFinance = (was: Pick<ContractTerms, "advance"> | null | undefined, next: Pick<ContractTerms, "advance">, financeHasAdvance: boolean) =>
  financeHasAdvance && Boolean(was) && Math.abs((was as ContractTerms).advance - next.advance) > 1e-9

/** The caller's context re-read against the project's own state. */
export const withFreshState = (ctx: PmContext, data: { pm?: unknown; status?: string | null; projectManagerId?: string | null }): PmContext => ({
  ...ctx,
  archived: Boolean(data.pm) && lifecycleOf(data as { pm?: { lifecycle?: string } }) === "closed",
  managerless: Boolean(data.pm) && !data.projectManagerId,
})

export async function savePlanTerms(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  terms: ContractTerms,
  actor?: { uid: string; name: string | null }
): Promise<{ advanceChanged: boolean }> {
  if (termProblems(terms).length) throw new PmProjectError("invalid")
  const ref = doc(firestore, "projects", projectId)
  let advanceChanged = false
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmProjectError("missing")
    const data = snap.data() as { pm?: PmBlock; status?: string; organizationId?: string; budget?: number | null }
    if (!data.pm) throw new PmProjectError("not_pm_project")
    const no = data.pm.no
    const advRef = no ? doc(firestore, PM_EVENTS, eventDocId(`prj:ADV:${no}`)) : null
    const advSnap = advRef ? await tx.get(advRef) : null
    assertPm(withFreshState(ctx, data), "terms.complete")
    if (!termsEditable(lifecycleOf(data))) throw new PmProjectError("started")
    const was = data.pm.terms
    const today = todayDay()
    let pm: PmBlock = { ...data.pm, terms }
    if (actor) pm = { ...pm, termsBy: actor.uid, termsByName: actor.name, termsOn: today }
    if (actor && was && advanceChangedAfterFinance(was, terms, Boolean(advSnap?.exists()))) {
      advanceChanged = true
      const log: AdvanceChange[] = [{ from: was.advance, to: terms.advance, on: today, by: actor.uid, byName: actor.name }, ...(data.pm.advLog ?? [])]
      pm = { ...pm, advLog: log }
      const event = advanceChangeEvent({
        organizationId: data.organizationId ?? "",
        projectId,
        projectNo: no as string,
        n: log.length,
        contractValue: data.budget ?? 0,
        from: was.advance,
        to: terms.advance,
        by: actor.uid,
        at: new Date().toISOString(),
      })
      tx.set(doc(firestore, PM_EVENTS, eventDocId(event.key)), event)
    }
    tx.update(ref, { pm, updatedAt: serverTimestamp() })
  })
  return { advanceChanged }
}

/** plan → live: the original freezes as it stands (TRM-02). `by` says why — the
 * manager's Start, or the first approved measurement (MS-04). */
export function goLive<T extends PmBlock>(pm: T, by: "start" | "measurement"): T & { lifecycle: "live" } {
  return { ...pm, lifecycle: "live", original: pm.original ?? pm.terms ?? null, startedAt: new Date().toISOString(), startedBy: by }
}

/** Start work: plan → live, and the original contract freezes as it stands. */
export async function startProject(firestore: Firestore, ctx: PmContext, projectId: string, boqItems: number): Promise<void> {
  const ref = doc(firestore, "projects", projectId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmProjectError("missing")
    const data = snap.data() as { pm?: PmBlock; status?: string; projectManagerId?: string | null }
    if (!data.pm?.terms) throw new PmProjectError("not_pm_project")
    assertPm(withFreshState(ctx, data), "project.start")
    const blocks = startBlocks({ lifecycle: lifecycleOf(data), hasManager: Boolean(data.projectManagerId), boqItems, termProblems: termProblems(data.pm.terms).length })
    if (blocks.length) throw new PmProjectError("blocked", blocks)
    tx.update(ref, {
      pm: goLive(data.pm, "start"),
      status: "working",
      updatedAt: serverTimestamp(),
    })
  })
}
