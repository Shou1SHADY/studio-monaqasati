// Procurement's two decisions on a project's request that do not wait for the
// other module (the prototype's «امضِ بالشراء» and «يُشترى — بلا سؤال»):
// buy after Inventory's check window (policy `replyWindowDays`) lapsed — the shortfall only or
// the whole quantity — or buy instead of asking our workshop. Written ONCE on
// the request (`procDecision`); the rules allow only that field, and a proceed
// only on a pending request older than the window, read from the org's
// policies inside the transaction (the rules read the same document). The need then shows on the
// desk as Purchasing's move and is answered with an RFQ or an order as usual.
// «Pending» means that only on a request Inventory approves: a PM 1.0 request
// (`pm: true`) is pending until the project manager approves it, and is refused.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import type { ProcDecision } from "./needs"
import { resolvePolicies, type ResolvedPolicies } from "./policies"
import { replyLapsed } from "./policy-enforce"
import { PROCUREMENT_SETTINGS, type ProcActor } from "./types"
import { ProcWriteError } from "./writes"

export interface NeedDecisionInput {
  projectId: string
  requestId: string
  kind: ProcDecision["kind"]
  /** Per line, what the stores were relied on for (proceed_short). */
  cover?: number[]
}

const createdMs = (v: unknown): number | null => {
  if (typeof v === "string") return Date.parse(v)
  const t = v as { toMillis?: () => number } | null
  return t && typeof t.toMillis === "function" ? t.toMillis() : null
}

export async function recordNeedDecision(firestore: Firestore, actor: ProcActor, input: NeedDecisionInput, opts: { now?: Date } = {}): Promise<void> {
  if (!actor.isOwner && !actor.canPrepare) throw new ProcWriteError("no_permission")
  const now = opts.now ?? new Date()
  const ref = doc(firestore, "projects", input.projectId, "purchaseRequests", input.requestId)
  await runTransaction(firestore, async (tx) => {
    const project = await tx.get(doc(firestore, "projects", input.projectId))
    const orgId = project.exists() ? String((project.data() as { organizationId?: string }).organizationId || "") : ""
    const settings = orgId ? await tx.get(doc(firestore, PROCUREMENT_SETTINGS, orgId)) : null
    const policies = resolvePolicies(settings?.exists() ? (settings.data() as Partial<ResolvedPolicies>) : null)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ProcWriteError("line_missing")
    const pr = snap.data() as { pm?: boolean; status?: string; procDecision?: unknown; rfqId?: string | null; poId?: string | null; mfgRequestId?: string | null; createdAt?: unknown }
    if (pr.procDecision || pr.rfqId || pr.poId) throw new ProcWriteError("need_decided")
    // A PM request still pending awaits the project manager's technical approval
    // (REQ-02) — not the warehouse: no window lapses on it, and nothing of it is bought.
    if (pr.pm && pr.status === "pending") throw new ProcWriteError("need_awaits_pm")
    if (input.kind === "buy") {
      if (pr.status !== "approved" || pr.mfgRequestId) throw new ProcWriteError("need_not_waiting")
    } else {
      const at = createdMs(pr.createdAt)
      if (pr.status !== "pending" || !replyLapsed(at, now, policies)) throw new ProcWriteError("need_not_waiting", { days: policies.replyWindowDays })
    }
    const decision: ProcDecision = { kind: input.kind, at: now.toISOString(), byName: actor.name }
    if (input.kind === "proceed_short") decision.cover = (input.cover || []).map((n) => Math.max(0, Number(n) || 0))
    tx.update(ref, { procDecision: decision, updatedAt: serverTimestamp() })
  })
}
