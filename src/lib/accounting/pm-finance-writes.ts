// Finance's acts on Project Management's events (the Projects desk): post a
// certified certificate that reached the outbox while Accounting was off,
// record what the client paid on it, and release the retention a handover made
// claimable. PM reads the results — `collected` on the certificate, and
// `pm.retentionReleased` — for its decisions and its close-out gate.

import { doc, runTransaction, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore"
import { PM_CERTIFICATES, certificateNo } from "../pm/certificate"
import { eventDocId, type PmEvent } from "../pm/events"
import { PM_SUBCONTRACTS, PM_SUB_CERTIFICATES, subCertificateNo, subcontractNo, type SubCertLine } from "../pm/subcontract"
import { ACC } from "./accounts"
import { ClosedPeriodError, JOURNAL_ENTRIES, buildEntry, entryDocId, isPeriodClosed, periodOf, round2, type JournalEntry } from "./journal"
import { loadPeriods, nextNumber, postToLedger } from "./post"
import type { PostingContext, PostingResult } from "./posting-rules"
import { collectedAfter, outstandingOf, pmCertificatePosting, pmCertificateSeq, pmCollectionPosting, pmRetentionReleasePosting, pmSubCertificatePosting, pmSubPayable, pmSubPaymentPosting, pmSubVat, subWorkByContract } from "./pm-postings"

export class PmFinanceError extends Error {
  constructor(readonly code: "certificate_missing" | "not_certified" | "amount_invalid" | "over_outstanding" | "not_approved" | "already_paid" | "not_posted") {
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

/** An approved subcontractor certificate becomes his payable (prj:SC). */
export async function postPmSubCertificate(firestore: Firestore, ctx: PostingContext, event: PmEvent, input: { vatRegistered: boolean; projectName?: string | null }): Promise<string | null> {
  return postToLedger(firestore, ctx, pmSubCertificatePosting(event, { vat: pmSubVat(event, input.vatRegistered), projectName: input.projectName }))
}

/** A petty purchase, an approved loss or a transfer between projects: one entry keyed on its event. */
export async function postPmSiteCost(firestore: Firestore, ctx: PostingContext, posting: PostingResult | null): Promise<string | null> {
  return postToLedger(firestore, ctx, posting)
}

export interface SubPayment {
  on: string
  amount: number
  by: string
  byName: string
}

/** Pay an approved subcontractor certificate in full («سدّد»). One transaction:
 * the certificate records the payment (never twice), each of its subcontracts'
 * `paid` moves by the work it certified there (the prototype: paid = certified),
 * and — with Accounting on — the payment entry lands with them, for the payable
 * the certificate's posted entry holds (it must be posted first). Books off:
 * the payment is recorded on the project only, at net + VAT. */
export async function paySubCertificate(
  firestore: Firestore,
  ctx: PostingContext,
  input: { event: PmEvent; projectName?: string | null; date: string; postToBooks: boolean; vatRegistered: boolean; bankAccount?: string }
): Promise<{ amount: number }> {
  const e = input.event
  const seq = Number(e.params.certificate) || 0
  const certRef = doc(firestore, "projects", e.projectId, PM_SUB_CERTIFICATES, subCertificateNo(seq))
  const sourceId = eventDocId(e.key)
  const payableRef = doc(firestore, JOURNAL_ENTRIES, entryDocId(ctx.organizationId, "pm_sub_certificate", sourceId))
  let entryNumber = 0
  if (input.postToBooks) {
    const periods = await loadPeriods(firestore, ctx.organizationId)
    if (isPeriodClosed(periods, input.date)) throw new ClosedPeriodError(periodOf(input.date))
    entryNumber = await nextNumber(firestore, ctx.organizationId)
  }
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(certRef)
    if (!snap.exists()) throw new PmFinanceError("certificate_missing")
    const cert = snap.data() as { status?: string; paidOn?: string | null; lines?: SubCertLine[] }
    if (cert.status !== "ok") throw new PmFinanceError("not_approved")
    if (cert.paidOn) throw new PmFinanceError("already_paid")

    let amount = pmSubPayable(e, pmSubVat(e, input.vatRegistered))
    if (input.postToBooks) {
      const posted = await tx.get(payableRef)
      if (!posted.exists()) throw new PmFinanceError("not_posted")
      const lines = (posted.data() as Pick<JournalEntry, "lines">).lines || []
      amount = round2(lines.filter((l) => l.account === ACC.suppliersPayable).reduce((a, l) => a + l.credit - l.debit, 0))
    }
    if (!(amount > 0)) throw new PmFinanceError("amount_invalid")

    const work = subWorkByContract(cert.lines || [])
    const contracts: Array<{ ref: ReturnType<typeof doc>; paid: number; add: number }> = []
    for (const [contractSeq, add] of work) {
      const ref = doc(firestore, "projects", e.projectId, PM_SUBCONTRACTS, subcontractNo(contractSeq))
      const c = await tx.get(ref)
      if (c.exists()) contracts.push({ ref, paid: Number((c.data() as { paid?: number }).paid) || 0, add })
    }

    for (const c of contracts) tx.update(c.ref, { paid: round2(c.paid + c.add), updatedAt: serverTimestamp() })
    const payment: SubPayment = { on: input.date, amount, by: ctx.userId, byName: ctx.userName }
    tx.update(certRef, { paidOn: input.date, paidAmount: amount, paidBy: payment.by, paidByName: payment.byName, updatedAt: serverTimestamp() })
    if (input.postToBooks) {
      const r = pmSubPaymentPosting(e, { amount, date: input.date, bankAccount: input.bankAccount, projectName: input.projectName })
      const entry = buildEntry({
        organizationId: ctx.organizationId,
        date: r.date,
        kind: "auto",
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        description: r.description,
        lines: r.lines,
        entryNumber,
        userId: ctx.userId,
        userName: ctx.userName,
        defaultBranch: ctx.branch ?? null,
        defaultCostCenter: r.costCenter,
      })
      tx.set(doc(firestore, JOURNAL_ENTRIES, entryDocId(ctx.organizationId, r.sourceType, r.sourceId)), { ...entry, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    }
    return { amount }
  })
}
