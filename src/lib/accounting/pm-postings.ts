// What Finance posts for Project Management's outbox (`pmEvents`, PM 1.0 S-02:
// PM tells, Finance posts). A certified certificate (`prj:IPC`) is the revenue
// event, posted exactly as a legacy مستخلص is (`postIpcClaim`); its collection
// settles the receivable (`postIpcCollection`); a handover that makes retention
// claimable (`prj:HND`) moves it from retention receivable to the client's
// receivable when Finance releases it. The advance (`prj:ADV`) and an addendum
// (`prj:AMD`) post nothing: the advance is booked when the cash arrives.
//
// The site's side: an approved subcontractor certificate (`prj:SC`) is a
// payable — his work to subcontract cost, VAT to input VAT, his retention held
// in 210102, the material waste recovered from him back off material cost —
// and paying it clears the payable. A petty purchase (`prj:CASH`) is a direct
// site cost paid from petty cash; an approved store loss (`prj:LOSS`) is
// material cost out of stock; a material moved between projects (`prj:XFER`)
// moves its cost from the sending project to the receiving one. The approved
// estimate at completion (`prj:BUD`) posts nothing — the desk shows the
// highest revision per project.
//
// Every entry is keyed on the event's idempotency key, so posting twice lands
// on the same journal document.

import { eventDocId, type PmEvent } from "../pm/events"
import { ACC } from "./accounts"
import { round2 } from "./journal"
import { COST_CENTERS, STANDARD_VAT_PERCENT, postIpcClaim, postIpcCollection, type PostingResult } from "./posting-rules"

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

/** A certificate's collected share (0–1) after a collection of `amount` on its net.
 * Never rounded to a few decimals: on a net of millions a fourth decimal is
 * hundreds of riyals — the remainder shown was not the remainder owed, and a
 * small collection left the share where it was. Within a halala of the net is
 * the whole net. */
export const collectedAfter = (net: number, collectedBefore: number, amount: number) => {
  if (!(net > 0)) return 1
  const paid = Math.max(0, collectedBefore) * net + amount
  return paid >= net - 0.005 ? 1 : paid / net
}

/** Still to collect on a certificate. */
export const outstandingOf = (net: number, collected: number) => round2(Math.max(0, net * (1 - Math.min(1, Math.max(0, collected)))))

// ---------------------------------------------------------------------------
// Subcontractor certificates (prj:SC)
// ---------------------------------------------------------------------------

const hasParam = (e: PmEvent, k: string) => e.params[k] !== undefined && e.params[k] !== ""
const partyOf = (e: PmEvent) => ({ party: String(e.params.supplierId || "") || null, partyName: String(e.params.subcontractor || "") || null })

/** The certificate's VAT: the event's own figure when PM sends one, else 15% of
 * his work less the material recovered from him — none when he is not
 * registered for VAT. */
export function pmSubVat(e: PmEvent, registered: boolean): number {
  if (hasParam(e, "vat")) return round2(num(e.params.vat))
  if (!registered) return 0
  return round2((Math.max(0, num(e.params.gross) - num(e.params.recovery)) * STANDARD_VAT_PERCENT) / 100)
}

/** The event fixes the VAT itself — Finance then has no choice to make. */
export const pmSubVatFixed = (e: PmEvent) => hasParam(e, "vat")

/** Due to him before VAT, recomputed so the entry balances whatever rounding the event carries. */
export const pmSubNet = (e: PmEvent) => round2(num(e.params.gross) - num(e.params.retention) - num(e.params.recovery))

/** What the company owes him on the certificate: net + VAT. */
export const pmSubPayable = (e: PmEvent, vat: number) => round2(pmSubNet(e) + vat)

export function pmSubCertificatePosting(e: PmEvent, input: { vat: number; projectName?: string | null }): PostingResult | null {
  if (e.kind !== "SC") return null
  const label = pmProjectLabel(e, input.projectName)
  const dim = { project: e.projectId, projectName: label, ...partyOf(e) }
  const gross = round2(num(e.params.gross))
  const retention = round2(num(e.params.retention))
  const recovery = round2(num(e.params.recovery))
  const vat = round2(input.vat)
  const payable = pmSubPayable(e, vat)
  return {
    sourceType: "pm_sub_certificate",
    sourceId: eventDocId(e.key),
    date: e.at.slice(0, 10),
    description: `مستخلص مقاول باطن ${String(e.params.certificate || "")}${dim.partyName ? ` — ${dim.partyName}` : ""} — ${label}`,
    costCenter: COST_CENTERS.execution,
    lines: [
      { ...dim, account: ACC.costSubcontractors, debit: gross, note: "أعمال منفذة" },
      { ...dim, account: ACC.vatInput, debit: vat, note: "ضريبة القيمة المضافة — مدخلات" },
      { ...dim, account: ACC.subcontractorRetentionPayable, credit: retention, note: "محتجز مقاول الباطن" },
      { ...dim, account: ACC.costMaterials, credit: recovery, note: "استرداد هدر مواد من مقاول الباطن" },
      payable >= 0
        ? { ...dim, account: ACC.suppliersPayable, credit: payable, note: "مستحق لمقاول الباطن" }
        : { ...dim, account: ACC.suppliersPayable, debit: -payable, note: "مستحق على مقاول الباطن" },
    ],
    empty: gross === 0,
  }
}

/** Paying the certificate clears the payable it created — one payment per certificate. */
export function pmSubPaymentPosting(e: PmEvent, input: { amount: number; date: string; bankAccount?: string; projectName?: string | null }): PostingResult {
  const label = pmProjectLabel(e, input.projectName)
  const dim = { project: e.projectId, projectName: label, ...partyOf(e) }
  const amount = round2(input.amount)
  return {
    sourceType: "pm_sub_payment",
    sourceId: eventDocId(e.key),
    date: input.date,
    description: `سداد مستخلص مقاول باطن ${String(e.params.certificate || "")}${dim.partyName ? ` — ${dim.partyName}` : ""} — ${label}`,
    costCenter: COST_CENTERS.admin,
    lines: [
      { ...dim, account: ACC.suppliersPayable, debit: amount, note: "سداد مقاول الباطن" },
      { ...dim, account: input.bankAccount || ACC.bankMain, credit: amount, note: "صرف" },
    ],
    empty: amount === 0,
  }
}

/** A certificate's work value per subcontract (by contract number) — what PM's
 * `paid` on each contract moves by once Finance pays it (the prototype: paid = certified). */
export function subWorkByContract(lines: Array<{ subcontractSeq: number; amount: number }>): Map<number, number> {
  const by = new Map<number, number>()
  for (const l of lines) by.set(l.subcontractSeq, round2((by.get(l.subcontractSeq) ?? 0) + (Number(l.amount) || 0)))
  return by
}

// ---------------------------------------------------------------------------
// Site costs: petty purchases, store losses, transfers between projects
// ---------------------------------------------------------------------------

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** The day a site event belongs to: the purchase day when it carries one, else when it was sent. */
export function pmEventDay(e: PmEvent): string {
  const day = String(e.params.day || "")
  return ISO_DAY.test(day) ? day : e.at.slice(0, 10)
}

export function pmCashPosting(e: PmEvent, projectName?: string | null): PostingResult | null {
  if (e.kind !== "CASH") return null
  const label = pmProjectLabel(e, projectName)
  const dim = { project: e.projectId, projectName: label, partyName: String(e.params.supplier || "") || null }
  const amount = round2(e.amount)
  const receipt = String(e.params.receipt || "")
  return {
    sourceType: "pm_cash",
    sourceId: eventDocId(e.key),
    date: pmEventDay(e),
    description: `مشتريات نثرية — ${String(e.params.what || "")} — ${label}`,
    costCenter: COST_CENTERS.execution,
    lines: [
      { ...dim, account: ACC.costDirectSite, debit: amount, note: receipt ? `إيصال ${receipt}` : "شراء مباشر من الموقع" },
      { ...dim, account: ACC.pettyCash, credit: amount, note: "من العهدة النثرية" },
    ],
    empty: amount === 0,
  }
}

export function pmLossPosting(e: PmEvent, projectName?: string | null): PostingResult | null {
  if (e.kind !== "LOSS") return null
  const label = pmProjectLabel(e, projectName)
  const dim = { project: e.projectId, projectName: label }
  const amount = round2(e.amount)
  const material = String(e.params.material || "")
  return {
    sourceType: "pm_loss",
    sourceId: eventDocId(e.key),
    date: e.at.slice(0, 10),
    description: `فاقد مخزن الموقع — ${material} — ${label}`,
    costCenter: COST_CENTERS.execution,
    lines: [
      { ...dim, account: ACC.costMaterials, debit: amount, note: "فاقد معتمد" },
      { ...dim, account: ACC.inventoryMaterials, credit: amount, note: `${num(e.params.qty)} ${String(e.params.unit || "")} ${material}`.trim() },
    ],
    empty: amount === 0,
  }
}

/** The event is sent by the RECEIVING project; the sending one is in its params. */
export function pmTransferPosting(e: PmEvent, input: { projectName?: string | null; fromProjectName?: string | null } = {}): PostingResult | null {
  if (e.kind !== "XFER") return null
  const to = pmProjectLabel(e, input.projectName)
  const fromId = String(e.params.fromProjectId || "") || null
  const from = input.fromProjectName || String(e.params.fromProject || "") || fromId || ""
  const amount = round2(e.amount)
  const material = String(e.params.material || "")
  return {
    sourceType: "pm_xfer",
    sourceId: eventDocId(e.key),
    date: e.at.slice(0, 10),
    description: `نقل مواد بين المشاريع — ${material} — من ${from} إلى ${to}`,
    costCenter: COST_CENTERS.execution,
    lines: [
      { project: e.projectId, projectName: to, account: ACC.costMaterials, debit: amount, note: `وارد من ${from}` },
      { project: fromId, projectName: from || null, account: ACC.costMaterials, credit: amount, note: `صادر إلى ${to}` },
    ],
    empty: amount === 0 || !fromId,
  }
}

// ---------------------------------------------------------------------------
// The approved estimate at completion (prj:BUD) — shown, never posted
// ---------------------------------------------------------------------------

export const pmEstimateRev = (e: PmEvent) => (hasParam(e, "rev") ? num(e.params.rev) : num(e.key.split(":").pop()))

/** Each project's estimate in force: its highest revision (each approval replaces the previous). */
export function pmLatestEstimates(events: PmEvent[]): PmEvent[] {
  const by = new Map<string, PmEvent>()
  for (const e of events) {
    if (e.kind !== "BUD") continue
    const cur = by.get(e.projectId)
    if (!cur || pmEstimateRev(e) > pmEstimateRev(cur)) by.set(e.projectId, e)
  }
  return [...by.values()]
}

/** Every source type the Projects desk posts — the desk reads these back to know what is in the books. */
export const PM_DESK_SOURCES = ["ipc_claim", "retention_release", "pm_sub_certificate", "pm_sub_payment", "pm_cash", "pm_loss", "pm_xfer"] as const
