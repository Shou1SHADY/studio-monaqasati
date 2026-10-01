// PM 1.0 — bringing a project made before PM 1.0 into the module, as it
// stands. Its measured quantities are the approved executed (they were measured
// and accepted); its claims are what has been billed, per line and in money
// (retention held, advance recovered); its kanban status gives its lifecycle;
// its claim terms seed the contract terms. A live project's original freezes
// now — there is no earlier signed version to recover. Nothing is rewritten
// but the new fields. The owner's act: it appoints the project manager.

import { collection, doc, getDocs, runTransaction, serverTimestamp, setDoc, writeBatch, type Firestore } from "firebase/firestore"
import { drawYearlyDocNumber } from "../sales-numbering"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { defaultTerms, type ContractTerms } from "./terms"

export class PmAdoptError extends Error {
  constructor(readonly code: "missing" | "already" | "owner_only" | "invalid") {
    super(code)
    this.name = "PmAdoptError"
  }
}

export interface AdoptInput {
  isOwner: boolean
  managerId: string
  managerName: string | null
  startOn: string | null
  durationDays: number
  kind?: string | null
}

type LegacyClaim = { lines?: Array<{ boqItemId?: string; currentQty?: number }>; totals?: { retention?: number; advanceRecovery?: number } }

const KINDS = ["bld", "infra", "road", "ind", "mep", "mnt", "own"]
const r2 = (n: number) => Math.round(n * 100) / 100

/** What the legacy claims billed: per BOQ line, and the retention and advance they took. */
export function legacyBilling(claims: LegacyClaim[]): { billedByItem: Map<string, number>; retentionHeld: number; advanceRecovered: number } {
  const billedByItem = new Map<string, number>()
  let retentionHeld = 0
  let advanceRecovered = 0
  for (const c of claims) {
    for (const l of c.lines ?? []) if (l.boqItemId) billedByItem.set(l.boqItemId, r2((billedByItem.get(l.boqItemId) ?? 0) + (Number(l.currentQty) || 0)))
    retentionHeld += Number(c.totals?.retention) || 0
    advanceRecovered += Number(c.totals?.advanceRecovery) || 0
  }
  return { billedByItem, retentionHeld: r2(retentionHeld), advanceRecovered: r2(advanceRecovered) }
}

export async function adoptProject(firestore: Firestore, projectId: string, actor: { uid: string; name: string | null }, input: AdoptInput): Promise<{ projectNo: string }> {
  if (!input.isOwner) throw new PmAdoptError("owner_only")
  if (!input.managerId || !(Number.isInteger(input.durationDays) && input.durationDays >= 0)) throw new PmAdoptError("invalid")
  const claims = (await getDocs(collection(firestore, "projects", projectId, "ipcClaims"))).docs.map((d) => d.data() as LegacyClaim)
  const billing = legacyBilling(claims)
  const pRef = doc(firestore, "projects", projectId)
  let projectNo = ""
  let orgId = ""

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(pRef)
    if (!snap.exists()) throw new PmAdoptError("missing")
    const data = snap.data() as { pm?: unknown; status?: string; organizationId?: string; projectType?: string; ipcTerms?: { retentionPercent?: number; advanceRecoveryPercent?: number } }
    if (data.pm) throw new PmAdoptError("already")
    orgId = data.organizationId ?? actor.uid
    const lifecycle = lifecycleOf(data as { status?: string })
    // A cancelled project would be born archived: its seat and its billed
    // quantities are then refused, and it accepts no change ever after.
    if (lifecycle === "closed") throw new PmAdoptError("invalid")
    const legacy = data.ipcTerms ?? {}
    const base: ContractTerms = defaultTerms({
      retention: legacy.retentionPercent != null ? legacy.retentionPercent / 100 : 0.1,
      advance: legacy.advanceRecoveryPercent != null ? legacy.advanceRecoveryPercent / 100 : 0,
    })
    // The old terms had a retention rate and no cap. The default cap (5% of the
    // contract) would be invented and then frozen as "original as signed" — and
    // on a contract already past it, nothing more would be retained. No cap is
    // a cap at the rate itself.
    const terms: ContractTerms = { ...base, retentionCap: Math.max(base.retentionCap, base.retention) }
    projectNo = await drawYearlyDocNumber(firestore, tx, orgId, "PJ")
    const started = lifecycle !== "plan"
    tx.update(pRef, {
      pm: {
        no: projectNo,
        lifecycle,
        kind: input.kind && KINDS.includes(input.kind) ? input.kind : data.projectType && KINDS.includes(data.projectType) ? data.projectType : "bld",
        startOn: input.startOn,
        durationDays: input.durationDays,
        signedOn: null,
        terms,
        original: started ? terms : null,
        // The day the work really started when the owner gives it: duration, planned
        // progress and delay are counted from `startedAt`, and the adoption day would
        // have set every running project back to day zero.
        startedAt: started ? (input.startOn ? `${input.startOn}T00:00:00.000Z` : new Date().toISOString()) : null,
        startedBy: started ? "adoption" : null,
        retentionHeld: billing.retentionHeld,
        advanceRecovered: billing.advanceRecovered,
        adopted: { on: todayDay(), by: actor.uid, byName: actor.name },
      },
      projectManagerId: input.managerId,
      projectManagerName: input.managerName,
      updatedAt: serverTimestamp(),
    })
  })

  await setDoc(
    doc(firestore, "projects", projectId, "members", input.managerId),
    { userId: input.managerId, organizationId: orgId, addedBy: actor.uid, pmRole: "pm", off: [], from: todayDay(), to: null, updatedAt: serverTimestamp() },
    { merge: true }
  )
  // A claim line whose BOQ line was deleted since has nothing left to bill against.
  const lines = new Set((await getDocs(collection(firestore, "projects", projectId, "boqItems"))).docs.map((d) => d.id))
  const billed = [...billing.billedByItem].filter(([itemId]) => lines.has(itemId))
  if (billed.length) {
    const batch = writeBatch(firestore)
    for (const [itemId, qty] of billed) batch.update(doc(firestore, "projects", projectId, "boqItems", itemId), { billedQuantity: qty, updatedAt: serverTimestamp() })
    await batch.commit()
  }
  return { projectNo }
}
