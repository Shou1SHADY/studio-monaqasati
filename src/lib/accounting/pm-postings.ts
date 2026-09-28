// What Finance posts for Project Management's outbox (`pmEvents`, PM 1.0 S-02:
// PM tells, Finance posts). A certified certificate (`prj:IPC`) is the revenue
// event, posted exactly as a legacy مستخلص is (`postIpcClaim`); its collection
// settles the receivable (`postIpcCollection`); a handover that makes retention
// claimable (`prj:HND`) moves it from retention receivable to the client's
// receivable when Finance releases it. The advance (`prj:ADV`) and an addendum
// (`prj:AMD`) post nothing: the advance is booked when the cash arrives.
//
// Every entry is keyed on the event's idempotency key, so posting twice lands
// on the same journal document.

import { eventDocId, type PmEvent } from "../pm/events"
import { ACC } from "./accounts"
import { round2 } from "./journal"
import { COST_CENTERS, postIpcClaim, postIpcCollection, type PostingResult } from "./posting-rules"

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** "PJ-2026/014 — Villas": the project as the ledger names it. */
export const pmProjectLabel = (e: Pick<PmEvent, "projectNo">, projectName?: string | null) => (projectName ? `${e.projectNo} — ${projectName}` : e.projectNo)

export const pmCertificateSeq = (e: PmEvent) => num(e.params.certificate)

export function pmCertificatePosting(e: PmEvent, projectName?: string | null): PostingResult | null {
  if (e.kind !== "IPC") return null
  return postIpcClaim({
    claimId: eventDocId(e.key),
    claimNumber: pmCertificateSeq(e),
    projectId: e.projectId,
    projectName: pmProjectLabel(e, projectName),
    date: e.at.slice(0, 10),
    gross: num(e.params.gross),
    retention: num(e.params.retention),
    advanceRecovery: num(e.params.recovery),
    vat: num(e.params.vat),
    net: num(e.params.net),
  })
}

/** The n-th collection on a certificate (1-based) — each its own entry. */
export function pmCollectionPosting(e: PmEvent, input: { amount: number; date: string; n: number; projectName?: string | null }): PostingResult {
  return postIpcCollection({
    claimId: `${eventDocId(e.key)}__c${input.n}`,
    claimNumber: pmCertificateSeq(e),
    projectId: e.projectId,
    projectName: pmProjectLabel(e, input.projectName),
    date: input.date,
    amount: round2(input.amount),
  })
}

export function pmRetentionReleasePosting(e: PmEvent, input: { date: string; projectName?: string | null }): PostingResult | null {
  if (e.kind !== "HND") return null
  const amount = round2(e.amount)
  const label = pmProjectLabel(e, input.projectName)
  const dim = { project: e.projectId, projectName: label }
  return {
    sourceType: "retention_release",
    sourceId: eventDocId(e.key),
    date: input.date,
    description: `إفراج محتجز — ${label}`,
    costCenter: COST_CENTERS.projects,
    lines: [
      { ...dim, account: ACC.clientsReceivable, debit: amount, note: "محتجز مستحق" },
      { ...dim, account: ACC.retentionReceivable, credit: amount, note: "إفراج المحتجز" },
    ],
    empty: amount === 0,
  }
}

/** A certificate's collected share (0–1) after a collection of `amount` on its net. */
export const collectedAfter = (net: number, collectedBefore: number, amount: number) => (net > 0 ? Math.min(1, Math.round(((Math.max(0, collectedBefore) * net + amount) / net) * 10000) / 10000) : 1)

/** Still to collect on a certificate. */
export const outstandingOf = (net: number, collected: number) => round2(Math.max(0, net * (1 - Math.min(1, Math.max(0, collected)))))
