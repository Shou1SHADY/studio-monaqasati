// PM 1.0 — writes on a PM project's own block (`pm` on the project document):
// completing the original terms before start (TRM-01) and starting work, which
// freezes that original for good (TRM-02, WF-03). Each is one transaction that
// re-reads the project, so a stale screen cannot overwrite a started contract.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { lifecycleOf, startBlocks } from "./lifecycle"
import { termProblems, termsEditable, type ContractTerms } from "./terms"

export class PmProjectError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "started" | "invalid" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmProjectError"
  }
}

type PmBlock = { lifecycle?: string; terms?: ContractTerms; original?: ContractTerms | null; startedAt?: string | null } & Record<string, unknown>

export async function savePlanTerms(firestore: Firestore, projectId: string, terms: ContractTerms): Promise<void> {
  if (termProblems(terms).length) throw new PmProjectError("invalid")
  const ref = doc(firestore, "projects", projectId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmProjectError("missing")
    const data = snap.data() as { pm?: PmBlock; status?: string }
    if (!data.pm) throw new PmProjectError("not_pm_project")
    if (!termsEditable(lifecycleOf(data))) throw new PmProjectError("started")
    tx.update(ref, { pm: { ...data.pm, terms }, updatedAt: serverTimestamp() })
  })
}

/** Start work: plan → live, and the original contract freezes as it stands. */
export async function startProject(firestore: Firestore, projectId: string, boqItems: number): Promise<void> {
  const ref = doc(firestore, "projects", projectId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmProjectError("missing")
    const data = snap.data() as { pm?: PmBlock; status?: string; projectManagerId?: string | null }
    if (!data.pm?.terms) throw new PmProjectError("not_pm_project")
    const blocks = startBlocks({ lifecycle: lifecycleOf(data), hasManager: Boolean(data.projectManagerId), boqItems, termProblems: termProblems(data.pm.terms).length })
    if (blocks.length) throw new PmProjectError("blocked", blocks)
    tx.update(ref, {
      pm: { ...data.pm, lifecycle: "live", original: data.pm.terms, startedAt: new Date().toISOString() },
      status: "working",
      updatedAt: serverTimestamp(),
    })
  })
}
