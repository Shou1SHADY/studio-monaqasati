// IPC-07 — freezing the advance on projects that started before `pm.advAmt`
// existed (scripts/backfill-pm-advance.ts). What Finance received is the truth
// when it was sent (prj:ADV's amount); without one, nobody pays or there is no
// advance → 0; otherwise the earliest certificate's contract value (what the
// advance was measured on when it began to be recovered), else the handover's
// figure × the ORIGINAL rate. A project still planning freezes at go-live. Pure.

export type AdvanceSource = "event" | "none" | "first_certificate" | "budget"

export interface AdvanceBackfillInput {
  lifecycle: string
  budget: number | null | undefined
  pm: { advAmt?: unknown; original?: { advance?: number; payer?: string } | null; terms?: { advance?: number; payer?: string } | null }
  /** prj:ADV's amount, when Finance holds one. */
  eventAmount: number | null
  /** Non-void certificates, any order. */
  certificates: Array<{ seq: number; status: string; contractValue?: number | null }>
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function planAdvanceBackfill(input: AdvanceBackfillInput): { advAmt: number; source: AdvanceSource } | null {
  if (typeof input.pm.advAmt === "number" && Number.isFinite(input.pm.advAmt)) return null
  if (input.lifecycle === "plan") return null
  if (input.eventAmount !== null && Number.isFinite(input.eventAmount)) return { advAmt: r2(input.eventAmount), source: "event" }
  const t = input.pm.original ?? input.pm.terms
  const rate = Number(t?.advance) || 0
  if (!t || t.payer === "none" || !(rate > 0)) return { advAmt: 0, source: "none" }
  const first = input.certificates
    .filter((c) => c.status !== "void" && typeof c.contractValue === "number" && c.contractValue > 0)
    .sort((a, b) => a.seq - b.seq)[0]
  if (first) return { advAmt: r2((first.contractValue as number) * rate), source: "first_certificate" }
  return { advAmt: r2(Math.max(0, Number(input.budget) || 0) * rate), source: "budget" }
}
