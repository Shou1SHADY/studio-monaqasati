// PM 1.0 — close and archive (WF-26, ARC-01). The project-wide reads (BOQ,
// punch list, certificates) happen right before the transaction; the
// transaction re-reads the project and its contract, runs the guard and the
// one gate, and freezes the snapshot. Both doors call this — there is no other
// way to close a PM project.

import { collection, getDocs, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import type { Acceptances } from "./acceptance"
import { readContract } from "./addendum-writes"
import { PM_CERTIFICATES } from "./certificate"
import type { PmCertificate } from "./certificate-writes"
import { archiveSnapshot, closeBlocks, closeoutRows, type CloseInput } from "./closeout"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { measuredItem } from "./measurement-writes"
import { withFreshState } from "./project-writes"
import { PM_NCRS, type PmNcr } from "./ncr"
import { PM_PUNCH, type PunchItem } from "./punch"
import { approvedValue, PM_VARIATIONS, type PmVariation } from "./variation"
import { hasClientSide } from "./terms"

export class PmCloseError extends Error {
  constructor(readonly code: "not_done" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmCloseError"
  }
}

export interface CloseActor {
  uid: string
  name: string | null
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

/** Everything the gate needs from the project's collections, read now. */
export async function readCloseFacts(firestore: Firestore, projectId: string) {
  const [items, punch, certs, ncrs, vos] = await Promise.all([
    getDocs(collection(firestore, "projects", projectId, "boqItems")),
    getDocs(collection(firestore, "projects", projectId, PM_PUNCH)),
    getDocs(collection(firestore, "projects", projectId, PM_CERTIFICATES)),
    getDocs(collection(firestore, "projects", projectId, PM_NCRS)),
    getDocs(collection(firestore, "projects", projectId, PM_VARIATIONS)),
  ])
  return {
    items: items.docs.map((d) => {
      const data = d.data() as Record<string, unknown>
      return { ...measuredItem(d.id, data), billed: num(data.billedQuantity) }
    }),
    punch: punch.docs.map((d) => d.data() as PunchItem),
    certificates: certs.docs.map((d) => d.data() as PmCertificate),
    ncrs: ncrs.docs.map((d) => d.data() as PmNcr),
    variations: vos.docs.map((d) => d.data() as PmVariation),
  }
}

/** Close and archive: the gate must hold, the snapshot freezes, the project
 * becomes read-only for everyone (INV-10, INV-21). */
export async function closeAndArchive(firestore: Firestore, ctx: PmContext, projectId: string, actor: CloseActor): Promise<void> {
  const facts = await readCloseFacts(firestore, projectId)
  await runTransaction(firestore, async (tx) => {
    const { pRef, project, pm, terms } = await readContract(tx, firestore, projectId)
    assertPm(withFreshState(ctx, project), "project.close")
    if (lifecycleOf(project) !== "done") throw new PmCloseError("not_done")
    const block = pm as { acceptances?: Acceptances; cutPool?: number; retentionHeld?: number; advanceRecovered?: number; retentionReleased?: boolean; durationDays?: number; startedAt?: string | null }
    const today = todayDay()
    const input: CloseInput = {
      hasClient: hasClientSide(terms),
      acceptances: block.acceptances ?? {},
      punch: facts.punch,
      ncrs: facts.ncrs,
      variations: facts.variations,
      items: facts.items,
      cutPool: block.cutPool ?? 0,
      certificates: facts.certificates,
      retentionHeld: block.retentionHeld ?? 0,
      retentionReleased: block.retentionReleased === true,
      today,
    }
    const blocked = closeBlocks(closeoutRows(input))
    if (blocked.length) throw new PmCloseError("blocked", blocked.map((r) => r.key))
    const fin = archiveSnapshot({
      // INV-01: the value in force is the handover value plus approved variations.
      contractValue: (project.budget ?? 0) + approvedValue(facts.variations),
      items: facts.items,
      certificates: facts.certificates,
      retentionHeld: block.retentionHeld ?? 0,
      advanceRecovered: block.advanceRecovered ?? 0,
      durationDays: block.durationDays ?? null,
      startedAt: block.startedAt ?? null,
      finalOn: block.acceptances?.final?.on ?? null,
      today,
    })
    tx.update(pRef, { pm: { ...pm, lifecycle: "closed", fin, closedOn: today, closedBy: actor.uid, closedByName: actor.name }, updatedAt: serverTimestamp() })
  })
}
