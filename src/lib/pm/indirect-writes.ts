// PM 1.0 — the indirect-cost budgets: the manager (approve, with money) sets a
// budget per kind for the whole project, on the pm block. One transaction that
// re-reads the project and runs the guard first.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, PmAccessError, pmCan, type PmContext } from "./access"
import { INDIRECT_KINDS, indirectBudgetProblems, type IndirectBudgets } from "./indirect"
import { withFreshState } from "./project-writes"

export class PmIndirectError extends Error {
  constructor(readonly code: "missing" | "bad_budget") {
    super(code)
    this.name = "PmIndirectError"
  }
}

export async function setIndirectBudgets(firestore: Firestore, ctx: PmContext, projectId: string, budgets: IndirectBudgets): Promise<void> {
  if (indirectBudgetProblems(budgets).length) throw new PmIndirectError("bad_budget")
  const clean: IndirectBudgets = {}
  for (const k of INDIRECT_KINDS) if (budgets[k] !== undefined) clean[k] = Math.round((budgets[k] as number) * 100) / 100
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, "projects", projectId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmIndirectError("missing")
    const project = snap.data() as { pm?: Record<string, unknown>; status?: string; projectManagerId?: string | null }
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "reconciliation.manage")
    if (!pmCan(fresh, "money")) throw new PmAccessError("no_duty", "reconciliation.manage")
    tx.update(ref, { pm: { ...(project.pm ?? {}), indirect: clean }, updatedAt: serverTimestamp() })
  })
}
