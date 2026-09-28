// Finance's acts on Project Management's events (the Projects desk): post a
// certified certificate that reached the outbox while Accounting was off,
// record what the client paid on it, and release the retention a handover made
// claimable. PM reads the results — `collected` on the certificate, and
// `pm.retentionReleased` — for its decisions and its close-out gate.

import { doc, runTransaction, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore"
import { PM_CERTIFICATES, certificateNo } from "../pm/certificate"
import type { PmEvent } from "../pm/events"
import { postToLedger } from "./post"
import type { PostingContext } from "./posting-rules"
import { collectedAfter, outstandingOf, pmCertificatePosting, pmCertificateSeq, pmCollectionPosting, pmRetentionReleasePosting } from "./pm-postings"

export class PmFinanceError extends Error {
  constructor(readonly code: "certificate_missing" | "not_certified" | "amount_invalid" | "over_outstanding") {
    super(code)
    this.name = "PmFinanceError"
  }
}

export interface Collection {
  on: string
  amount: number
  by: string
  byName: string
}

export async function postPmCertificate(firestore: Firestore, ctx: PostingContext, event: PmEvent, projectName?: string | null): Promise<string | null> {
  return postToLedger(firestore, ctx, pmCertificatePosting(event, projectName))
}

/** The client paid `amount` on a certified certificate. The share collected
 * only grows; the whole net makes it `paid`. The ledger entry follows when
 * Accounting is on (`posted`). */
export async function recordPmCollection(
  firestore: Firestore,
  ctx: PostingContext,
  input: { event: PmEvent; projectName?: string | null; amount: number; date: string; postToBooks: boolean }
): Promise<{ collected: number; posted: boolean }> {
  const amount = Math.round(input.amount * 100) / 100
  if (!(amount > 0)) throw new PmFinanceError("amount_invalid")
  const ref = doc(firestore, "projects", input.event.projectId, PM_CERTIFICATES, certificateNo(pmCertificateSeq(input.event)))
  const { collected, n } = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmFinanceError("certificate_missing")
    const cert = snap.data() as { status?: string; net?: number; collected?: number; collections?: Collection[] }
    if (cert.status !== "appr" && cert.status !== "part") throw new PmFinanceError("not_certified")
    const net = Number(cert.net) || 0
    const before = Number(cert.collected) || 0
    if (amount > outstandingOf(net, before) + 0.01) throw new PmFinanceError("over_outstanding")
    const after = collectedAfter(net, before, amount)
    const collections = [...(cert.collections || []), { on: input.date, amount, by: ctx.userId, byName: ctx.userName }]
    tx.update(ref, {
      status: after >= 1 ? "paid" : "part",
      collected: after >= 1 ? 1 : after,
      collections,
      collectedOn: input.date,
      updatedAt: serverTimestamp(),
    })
    return { collected: after, n: collections.length }
  })
  let posted = false
  if (input.postToBooks) {
    await postToLedger(firestore, ctx, pmCollectionPosting(input.event, { amount, date: input.date, n, projectName: input.projectName }))
    posted = true
  }
  return { collected, posted }
}

/** Release the retention a handover made claimable: the ledger moves it to the
 * client's receivable; the final release also clears the close-out gate. */
export async function releasePmRetention(
  firestore: Firestore,
  ctx: PostingContext,
  input: { event: PmEvent; projectName?: string | null; date: string; postToBooks: boolean }
): Promise<void> {
  if (input.postToBooks) await postToLedger(firestore, ctx, pmRetentionReleasePosting(input.event, { date: input.date, projectName: input.projectName }))
  if (input.event.params.stage === "final") {
    await updateDoc(doc(firestore, "projects", input.event.projectId), { "pm.retentionReleased": true, updatedAt: serverTimestamp() })
  }
}
