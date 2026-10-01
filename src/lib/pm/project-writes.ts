// PM 1.0 — writes on a PM project's own block (`pm` on the project document):
// completing the original terms before start (TRM-01) and starting work, which
// freezes that original for good (TRM-02, WF-03). Each is one transaction that
// re-reads the project, so a stale screen cannot overwrite a started contract,
// and each runs the guard first with the archived state it just read (RL-02).
// Completing the original records who did it last (`termsBy`), and an advance
// changed after Finance received prj:ADV is logged on the project (`advLog`,
// newest first) — never a second prj:ADV, and no event: Finance takes one advance
// term per project, so the manager tells them by letter (the prototype's toast).

import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { readContractValue } from "./contract-value"
import { advanceEvent, PM_EVENTS, pmEventDocId, type PmEvent } from "./events"
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

/**
 * Whether Finance already holds the project's advance term (prj:ADV). Looked up
 * by its KEY inside the caller's own organisation — not by document id: events
 * sent before the id carried the organisation sit under the key alone, and that
 * id may today belong to another company's project of the same number.
 */
export async function advanceEventSent(firestore: Firestore, organizationId: string, projectNo: string): Promise<boolean> {
  const sent = await getDocs(query(collection(firestore, PM_EVENTS), where("organizationId", "==", organizationId), where("key", "==", `prj:ADV:${projectNo}`)))
  return !sent.empty
}

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
    // Append-only and written once: reading it outside the transaction's own reads loses nothing.
    const advSent = no && data.organizationId ? await advanceEventSent(firestore, data.organizationId, no) : false
    assertPm(withFreshState(ctx, data), "terms.complete")
    if (!termsEditable(lifecycleOf(data))) throw new PmProjectError("started")
    const was = data.pm.terms
    const today = todayDay()
    let pm: PmBlock = { ...data.pm, terms }
    if (actor) pm = { ...pm, termsBy: actor.uid, termsByName: actor.name, termsOn: today }
    if (actor && was && advanceChangedAfterFinance(was, terms, advSent)) {
      advanceChanged = true
      const log: AdvanceChange[] = [{ from: was.advance, to: terms.advance, on: today, by: actor.uid, byName: actor.name }, ...(data.pm.advLog ?? [])]
      pm = { ...pm, advLog: log }
    }
    tx.update(ref, { pm, updatedAt: serverTimestamp() })
  })
  return { advanceChanged }
}

/**
 * The advance term going live owes Finance (WF-01 step 4): prj:ADV is sent when
 * the project is born, but a project born without an advance and completed with
 * one before Start had told nobody — the receivable was never opened while every
 * certificate recovered it. Sent once, on the contract value in force; none when
 * Finance already holds one, there is no advance, or nobody pays. Read beside
 * the transaction (an outbox is append-only): a retry sees what the first try saw.
 */
export async function advanceDueAtStart(
  firestore: Firestore,
  projectId: string,
  data: { organizationId?: string; budget?: number | null; pm?: { no?: string; terms?: ContractTerms } },
  by: string
): Promise<PmEvent | null> {
  const no = data.pm?.no
  const terms = data.pm?.terms
  if (!no || !data.organizationId || !terms || !(terms.advance > 0) || terms.payer === "none") return null
  if (await advanceEventSent(firestore, data.organizationId, no)) return null
  let contractValue = data.budget ?? 0
  try {
    contractValue = await readContractValue(firestore, projectId, data.budget)
  } catch (err) {
    // A measurer who may not read the variations: the handover's figure stands.
    if ((err as { code?: string })?.code !== "permission-denied") throw err
  }
  if (!(contractValue > 0)) return null
  return advanceEvent({ organizationId: data.organizationId, projectId, projectNo: no, contractValue, terms, by, at: new Date().toISOString() })
}

/** Writes it in the go-live's own transaction. */
export const sendAdvance = (tx: Transaction, firestore: Firestore, event: PmEvent | null) => {
  if (event) tx.set(doc(firestore, PM_EVENTS, pmEventDocId(event.organizationId, event.key)), event)
}

/** plan → live: the original freezes as it stands (TRM-02). `by` says why — the
 * manager's Start, or the first approved measurement (MS-04). */
export function goLive<T extends PmBlock>(pm: T, by: "start" | "measurement"): T & { lifecycle: "live" } {
  return { ...pm, lifecycle: "live", original: pm.original ?? pm.terms ?? null, startedAt: new Date().toISOString(), startedBy: by }
}

/** Start work: plan → live, and the original contract freezes as it stands. */
export async function startProject(firestore: Firestore, ctx: PmContext, projectId: string, boqItems: number, actor?: { uid: string }): Promise<void> {
  const ref = doc(firestore, "projects", projectId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmProjectError("missing")
    const data = snap.data() as { pm?: PmBlock; status?: string; projectManagerId?: string | null; organizationId?: string; budget?: number | null }
    if (!data.pm?.terms) throw new PmProjectError("not_pm_project")
    assertPm(withFreshState(ctx, data), "project.start")
    const blocks = startBlocks({ lifecycle: lifecycleOf(data), hasManager: Boolean(data.projectManagerId), boqItems, termProblems: termProblems(data.pm.terms).length })
    if (blocks.length) throw new PmProjectError("blocked", blocks)
    sendAdvance(tx, firestore, actor ? await advanceDueAtStart(firestore, projectId, data, actor.uid) : null)
    tx.update(ref, {
      pm: goLive(data.pm, "start"),
      status: "working",
      updatedAt: serverTimestamp(),
    })
  })
}
