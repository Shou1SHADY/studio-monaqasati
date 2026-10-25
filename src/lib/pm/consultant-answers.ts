// PM 1.1 — the consultant's answers that carry money and time (CP-08), and his
// refusals of a fix or a corrective plan (PN-04 / NCR-02), as PURE planners.
// Each answer arrives by one of two doors: recorded from his letter by our
// people (a client transaction under the rules), or through the portal (one
// Admin transaction on the server). Both run the same planner over the record
// they just re-read, so his reply has exactly the effect of his letter:
//   · a certified certificate recomputes on the certified value under the terms
//     it was prepared with (AMD-04), returns the deduction to unbilled, sets the
//     due date from the contract IN FORCE on certification day (IPC-06), and
//     sends prj:IPC at the certified amount — once (IPC-03);
//   · a claim response issues the next programme revision when it grants days
//     (damages recompute from the granted days; nothing is stored for them);
//   · a refused fix reopens the punch item, a rejected plan reopens the NCR,
//     the refused step kept on record.
// The first reply by either door closes the other: a record no longer waiting
// is NOT_WAITING (CP-09). Pure: no I/O.

import type { PmAttachment } from "./attachments"
import { cleanAttachments } from "./attachments"
import { certificateAmounts, certificateEvent, certifyBlocks, dueDate, type Amounts, type CertificateStatus, type CertificateTerms } from "./certificate"
import { respondBlocks, type ClaimKind, type ClaimResponse, type ClaimStatus } from "./claim"
import type { PortalRejection } from "./consultant-portal"
import type { PmEvent } from "./events"
import { ncrStepBlocks, type NcrStatus } from "./ncr"
import { punchStepBlocks, type PunchStatus } from "./punch"

const r2 = (n: number) => Math.round(n * 100) / 100

export interface AnswerActor {
  /** The recorder's uid, or `portal:<linkId>` for his own answer. */
  by: string
  byName: string | null
}

export type PlanRefusal = { ok: false; code: "NOT_WAITING" | "BLOCKED"; blocks?: string[] }

// ---------------------------------------------------------------------------
// The certificate (IPC-03 / IPC-06 / CP-08)
// ---------------------------------------------------------------------------

export interface CertifiableCertificate extends Amounts {
  seq: number
  status: CertificateStatus
  terms: CertificateTerms
  contractValue: number
}

export interface CertifyInput {
  certified: number
  reason?: string | null
  /** The stated reason when the reason is "other". */
  reasonNote?: string | null
  consultantRef?: string | null
  files?: ReadonlyArray<Partial<PmAttachment>> | null
}

export interface CertifyContext {
  today: string
  nowIso: string
  actor: AnswerActor
  viaPortal: boolean
  organizationId: string
  projectId: string
  projectNo: string
  /** The project's running totals — this certificate's own share still in them. */
  totals: { retentionHeld?: number; advanceRecovered?: number; cutPool?: number }
  /** The contract IN FORCE on certification day: the payment period runs from it (IPC-06). */
  termsNow: Pick<CertificateTerms, "paymentDays">
}

export interface CertifyPlan {
  certPatch: Record<string, unknown>
  /** The new running totals, to merge into the project's `pm` block. */
  pmTotals: { retentionHeld: number; advanceRecovered: number; cutPool: number }
  amounts: Amounts
  cut: number
  dueOn: string
  event: PmEvent
}

export function planCertify(cert: CertifiableCertificate, input: CertifyInput, ctx: CertifyContext): { ok: true; plan: CertifyPlan } | PlanRefusal {
  if (cert.status !== "sub") return { ok: false, code: "NOT_WAITING" }
  const blocks = certifyBlocks({ status: cert.status, gross: cert.gross, certified: input.certified, reason: input.reason, reasonNote: input.reasonNote })
  if (blocks.length) return { ok: false, code: "BLOCKED", blocks }
  const { totals } = ctx
  // Recomputed on the certified value, under the terms the certificate was
  // prepared with — the other certificates' retention and recovery excluded.
  const amounts = certificateAmounts({
    gross: input.certified,
    terms: cert.terms,
    contractValue: cert.contractValue,
    held: (totals.retentionHeld ?? 0) - cert.retention,
    recovered: (totals.advanceRecovered ?? 0) - cert.recovery,
  })
  const cut = r2(cert.gross - amounts.gross)
  const reason = cut > 0 && input.reason ? input.reason : null
  const certOn = ctx.today
  const dueOn = dueDate(certOn, ctx.termsNow.paymentDays)
  const certPatch: Record<string, unknown> = {
    status: "appr",
    submitted: { gross: cert.gross, recovery: cert.recovery, retention: cert.retention, vat: cert.vat, net: cert.net },
    ...amounts,
    certified: amounts.gross,
    cut,
    cutReason: reason,
    cutNote: reason === "oth" ? input.reasonNote?.trim() || null : null,
    consultantRef: input.consultantRef?.trim() || null,
    certOn,
    certBy: ctx.actor.by,
    certByName: ctx.actor.byName,
    certFiles: cleanAttachments(input.files),
    certRecordedOn: ctx.today,
    viaPortal: ctx.viaPortal,
    dueOn,
  }
  return {
    ok: true,
    plan: {
      certPatch,
      pmTotals: {
        retentionHeld: r2((totals.retentionHeld ?? 0) - cert.retention + amounts.retention),
        advanceRecovered: r2((totals.advanceRecovered ?? 0) - cert.recovery + amounts.recovery),
        cutPool: r2((totals.cutPool ?? 0) + cut),
      },
      amounts,
      cut,
      dueOn,
      event: certificateEvent({ organizationId: ctx.organizationId, projectId: ctx.projectId, projectNo: ctx.projectNo, seq: cert.seq, amounts, dueOn, by: ctx.actor.by, at: ctx.nowIso }),
    },
  }
}

/** IPC-06: when a certificate goes to the consultant, its expected due date is
 * his period + the payment period, both from the contract in force that day. */
export function expectedDue(submittedOn: string, terms: Pick<CertificateTerms, "consultantDays" | "paymentDays">): string {
  return dueDate(submittedOn, (terms.consultantDays ?? 0) + (terms.paymentDays ?? 0))
}

// ---------------------------------------------------------------------------
// The claim (CLM-02 / CLM-03 / CP-08)
// ---------------------------------------------------------------------------

export interface RespondableClaim {
  status: ClaimStatus
  kind: ClaimKind
}

export interface RespondInput {
  response: unknown
  days: number | null
  amount: number | null
  ref?: string | null
  files?: ReadonlyArray<Partial<PmAttachment>> | null
}

export interface RespondContext {
  today: string
  actor: AnswerActor
  viaPortal: boolean
  archived: boolean
  /** The project's current programme revision (`pm.programmeRev`). */
  programmeRev: number
}

export interface RespondPlan {
  claimPatch: Record<string, unknown>
  /** The programme revision these granted days issue — null when no day is granted. */
  revision: number | null
}

export function planRespond(claim: RespondableClaim, input: RespondInput, ctx: RespondContext): { ok: true; plan: RespondPlan } | PlanRefusal {
  if (claim.status !== "sub") return { ok: false, code: "NOT_WAITING" }
  const blocks = respondBlocks({ archived: ctx.archived, status: claim.status, kind: claim.kind, response: input.response, days: input.days, amount: input.amount })
  if (blocks.length) return { ok: false, code: "BLOCKED", blocks }
  const response = input.response as ClaimResponse
  const days = response === "rej" || claim.kind === "cost" ? 0 : (input.days ?? 0)
  const amount = response === "rej" || claim.kind === "time" ? 0 : (input.amount ?? 0)
  const revision = days > 0 ? ctx.programmeRev + 1 : null
  return {
    ok: true,
    plan: {
      revision,
      claimPatch: {
        status: response,
        response: { on: ctx.today, by: ctx.actor.by, byName: ctx.actor.byName, days, amount, ref: input.ref?.trim() || null, files: cleanAttachments(input.files), viaPortal: ctx.viaPortal },
        revision,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// His refusals (PN-04 / NCR-02): by the portal, or recorded from his letter
// ---------------------------------------------------------------------------

export interface RefusalContext {
  today: string
  actor: AnswerActor
  viaPortal: boolean
  archived: boolean
  /** The day on his letter, when recorded from it (default today). */
  on?: string | null
  files?: ReadonlyArray<Partial<PmAttachment>> | null
}

function rejection(note: string, refused: unknown, ctx: RefusalContext): PortalRejection {
  const files = cleanAttachments(ctx.files)
  return {
    on: ctx.on || ctx.today,
    by: ctx.actor.by,
    byName: ctx.actor.byName ?? "",
    note,
    refused: (refused as Record<string, unknown> | null | undefined) ?? null,
    viaPortal: ctx.viaPortal,
    ...(ctx.viaPortal ? {} : { recordedOn: ctx.today }),
    ...(files.length ? { files } : {}),
  }
}

/** The consultant refuses a fix on a punch item he raised: back to open, the refused fix kept. */
export function planRefuseFix(
  p: { status: PunchStatus; source: string; day: string; fix?: { on?: string | null } | null; rejects?: PortalRejection[] | null },
  noteRaw: string | null | undefined,
  ctx: RefusalContext
): { ok: true; patch: Record<string, unknown> } | PlanRefusal {
  if (p.status !== "fix" || p.source !== "cons") return { ok: false, code: "NOT_WAITING" }
  const blocks: string[] = punchStepBlocks({ archived: ctx.archived, status: p.status, step: "confirm", day: ctx.on || ctx.today, today: ctx.today, after: p.fix?.on ?? p.day })
  const note = noteRaw?.trim() ?? ""
  if (!note) blocks.push("no_note")
  if (blocks.length) return { ok: false, code: "BLOCKED", blocks }
  return { ok: true, patch: { status: "open", fix: null, rejects: [...(p.rejects ?? []), rejection(note, p.fix, ctx)] } }
}

/** The consultant rejects a corrective plan: the NCR is open again for a new plan, the refused plan kept. */
export function planRejectPlan(
  n: { status: NcrStatus; day: string; plan?: { on?: string | null } | null; rejects?: PortalRejection[] | null },
  noteRaw: string | null | undefined,
  ctx: RefusalContext
): { ok: true; patch: Record<string, unknown> } | PlanRefusal {
  if (n.status !== "plan") return { ok: false, code: "NOT_WAITING" }
  const blocks: string[] = ncrStepBlocks({ archived: ctx.archived, status: n.status, step: "accept", day: ctx.on || ctx.today, today: ctx.today, after: n.plan?.on ?? n.day })
  const note = noteRaw?.trim() ?? ""
  if (!note) blocks.push("no_note")
  if (blocks.length) return { ok: false, code: "BLOCKED", blocks }
  return { ok: true, patch: { status: "open", plan: null, rejects: [...(n.rejects ?? []), rejection(note, n.plan, ctx)] } }
}
