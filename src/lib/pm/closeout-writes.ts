// PM 1.0 — close and archive (WF-26, ARC-01). The project-wide reads (BOQ,
// punch list, certificates) happen right before the transaction; the
// transaction re-reads the project and its contract, runs the guard and the
// one gate, and freezes the snapshot. Both doors call this — there is no other
// way to close a PM project.

import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import type { Acceptances } from "./acceptance"
import { readContract } from "./addendum-writes"
import { PM_CERTIFICATES } from "./certificate"
import type { PmCertificate } from "./certificate-writes"
import { archiveSnapshot, closeBlocks, closeoutRows, storeDocOf, storeHoldings, storeItemOf, subDues, type CloseInput, type ClosingCost } from "./closeout"
import { PM_LETTERS, type PmLetter } from "./correspondence"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { measuredItem } from "./measurement-writes"
import { withFreshState } from "./project-writes"
import { PM_NCRS, type PmNcr } from "./ncr"
import { PM_PUNCH, type PunchItem } from "./punch"
import { PM_STORE } from "./store"
import { PM_SUB_CERTIFICATES, PM_SUBCONTRACTS, type PmSubCertificate, type PmSubcontract } from "./subcontract"
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

/** Everything the gate needs from the project's collections, read now. The
 * store row joins when the store section is on; the subcontractor row when the
 * section is on or a subcontract exists (SC-04). */
export async function readCloseFacts(firestore: Firestore, projectId: string) {
  const pSnap = await getDoc(doc(firestore, "projects", projectId))
  const project = (pSnap.exists() ? pSnap.data() : {}) as { enabledSections?: string[] }
  const sections = project.enabledSections ?? []
  const col = (name: string) => getDocs(collection(firestore, "projects", projectId, name))
  const [items, punch, certs, ncrs, vos, subs, subCerts, letters, store] = await Promise.all([
    col("boqItems"),
    col(PM_PUNCH),
    col(PM_CERTIFICATES),
    col(PM_NCRS),
    col(PM_VARIATIONS),
    col(PM_SUBCONTRACTS),
    col(PM_SUB_CERTIFICATES),
    col(PM_LETTERS),
    sections.includes("store") ? col(PM_STORE) : Promise.resolve(null),
  ])
  const contracts = subs.docs.map((d) => ({ ...(d.data() as PmSubcontract), id: d.id }))
  const storeItems = items.docs.map((d) => storeItemOf(d.id, d.data() as Record<string, unknown>))
  return {
    items: items.docs.map((d) => {
      const data = d.data() as Record<string, unknown>
      return { ...measuredItem(d.id, data), billed: num(data.billedQuantity) }
    }),
    punch: punch.docs.map((d) => d.data() as PunchItem),
    certificates: certs.docs.map((d) => d.data() as PmCertificate),
    ncrs: ncrs.docs.map((d) => d.data() as PmNcr),
    variations: vos.docs.map((d) => d.data() as PmVariation),
    storeLines: store ? storeHoldings(store.docs.map((d) => storeDocOf(d.id, d.data() as Record<string, unknown>)), storeItems).lines : null,
    subs: sections.includes("subs") || contracts.length ? subDues(contracts, subCerts.docs.map((d) => d.data() as PmSubCertificate)) : null,
    letters: letters.docs.map((d) => d.data() as PmLetter),
  }
}

/** Close and archive: the gate must hold, the snapshot freezes, the project
 * becomes read-only for everyone (INV-10, INV-21). `cost` is the cost section's
 * roll-up as the closer's screen computed it (orders, receipts, issues and
 * subcontracts the transaction cannot re-read in full — as the CVR approval);
 * without it the snapshot freezes no cost rather than an invented one. */
export async function closeAndArchive(firestore: Firestore, ctx: PmContext, projectId: string, actor: CloseActor, cost?: ClosingCost | null): Promise<void> {
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
      storeLines: facts.storeLines,
      subs: facts.subs,
      letters: facts.letters,
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
      cost: cost ?? null,
    })
    tx.update(pRef, { pm: { ...pm, lifecycle: "closed", fin, closedOn: today, closedBy: actor.uid, closedByName: actor.name }, updatedAt: serverTimestamp() })
  })
}
