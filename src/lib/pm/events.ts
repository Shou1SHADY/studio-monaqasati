// PM 1.0 — what the project tells Finance (PRD §11, PM-Pipeline §3). Each event
// is written once to an outbox under its idempotency key, which is also the
// document id: resending never creates a second posting. Finance reads and
// posts; the module never writes the ledger itself (S-02). Pure: no I/O.

import type { ContractTerms } from "./terms"

export const PM_EVENTS = "pmEvents"

export type PmEventKind = "ADV" | "IPC" | "SC" | "BUD" | "HND" | "AMD"

export interface PmEvent {
  key: string
  kind: PmEventKind
  organizationId: string
  projectId: string
  projectNo: string
  /** SAR. For ADV: the advance itself (contract × rate). */
  amount: number
  params: Record<string, string | number>
  by: string
  at: string
}

/** Firestore ids cannot hold "/", and project numbers do ("PJ-2026/014"). */
export const eventDocId = (key: string) => key.replace(/\//g, "_")

/** The advance-payment term, sent when the project is born — only if there is
 * an advance and someone pays (WF-01 step 4). Never a second advance event: a
 * later change is an addendum (AMD-08). */
export function advanceEvent(input: {
  organizationId: string
  projectId: string
  projectNo: string
  contractValue: number
  terms: Pick<ContractTerms, "advance" | "payer" | "advanceRecovery">
  by: string
  at: string
}): PmEvent | null {
  if (!(input.terms.advance > 0) || input.terms.payer === "none") return null
  return {
    key: `prj:ADV:${input.projectNo}`,
    kind: "ADV",
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectNo: input.projectNo,
    amount: Math.round(input.contractValue * input.terms.advance * 100) / 100,
    params: { rate: input.terms.advance, recovery: input.terms.advanceRecovery, contractValue: input.contractValue },
    by: input.by,
    at: input.at,
  }
}
