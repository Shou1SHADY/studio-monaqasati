// PM 1.0 — certificate writes (WF-05, IPC-01…03, RET-01, INV-02…04). One
// transaction each over the project (its contract in force, and the running
// totals the rules need: retention held, advance recovered, deductions
// returned to unbilled), the certificate and its BOQ lines. The project's
// `pm.retentionHeld` is what an addendum's cap is checked against — so it
// moves in the same write as the certificate that holds it (AMD-09).

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, mayApproveCertificate, PmAccessError, pmCan, type PmContext } from "./access"
import { readContract } from "./addendum-writes"
import {
  certificateAmounts,
  certificateEvent,
  certificateLines,
  certificateNo,
  certificateVoLines,
  certifyBlocks,
  dueDate,
  PM_CERTIFICATES,
  prepareBlocks,
  termsSnapshot,
  type Amounts,
  type BillableItem,
  type CertificateCheck,
  type CertificateLine,
  type CertificateStatus,
  type CertificateTerms,
  type CertificateVoLine,
  type ClaimableVariation,
} from "./certificate"
import { PM_EVENTS, pmEventDocId, type PmEvent } from "./events"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { readSelfApproval } from "./info-writes"
import { withFreshState } from "./project-writes"
import { PM_VARIATIONS } from "./variation"
import { readContractValue } from "./contract-value"
import { certificatePayer } from "./terms"

export class PmCertificateError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "wrong_state" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmCertificateError"
  }
}

export interface CertificateActor {
  uid: string
  name: string | null
}

export interface PmCertificate extends Amounts {
  id: string
  seq: number
  status: CertificateStatus
  lines: CertificateLine[]
  /** Approved variations billed here, each for its share executed since last billed. */
  voLines?: CertificateVoLine[]
  /** Consultant deductions from earlier certificates re-claimed here. */
  cutsIncluded: number
  /** The period the certificate covers: the last certificate (or the start) → the day prepared. */
  periodFrom?: string | null
  periodTo?: string | null
  /** The non-blocking checklist the preparer ticked. */
  checks?: CertificateCheck[]
  /** Finance's: the collected share of the net (0…1), and each receipt. */
  collected?: number | null
  collections?: Array<{ on: string; amount: number; byName?: string | null }>
  collectedOn?: string | null
  terms: CertificateTerms
  contractValue: number
  prep: string
  prepName?: string | null
  prepOn: string
  appr?: string | null
  apprName?: string | null
  apprOn?: string | null
  /** The approver was the preparer — only where the company allows it, and recorded. */
  selfApp?: boolean
  /** At certification: what the consultant certified, and the amounts recomputed on it. */
  certified?: number | null
  cut?: number | null
  cutReason?: string | null
  consultantRef?: string | null
  certOn?: string | null
  certBy?: string | null
  certByName?: string | null
  dueOn?: string | null
  submitted?: Amounts | null
}

type PmTotals = { ipcCount?: number; retentionHeld?: number; advanceRecovered?: number; cutPool?: number; lastIpcOn?: string | null; startOn?: string | null; startedAt?: string | null }

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}
const r2 = (n: number) => Math.round(n * 100) / 100

async function readBillable(tx: Transaction, firestore: Firestore, projectId: string, ids: string[]): Promise<BillableItem[]> {
  const out: BillableItem[] = []
  for (const id of [...new Set(ids)]) {
    const snap = await tx.get(doc(firestore, "projects", projectId, "boqItems", id))
    if (!snap.exists()) continue
    const d = snap.data() as Record<string, unknown>
    out.push({ id, code: (d.itemNo as string) ?? null, rate: num(d.unitPrice), executed: num(d.executedQuantity), billed: num(d.billedQuantity) })
  }
  return out
}

async function readVariations(tx: Transaction, firestore: Firestore, projectId: string, ids: string[]): Promise<ClaimableVariation[]> {
  const out: ClaimableVariation[] = []
  for (const id of [...new Set(ids)]) {
    const snap = await tx.get(doc(firestore, "projects", projectId, PM_VARIATIONS, id))
    if (!snap.exists()) continue
    const d = snap.data() as Record<string, unknown>
    out.push({ id, seq: num(d.seq), title: String(d.title ?? ""), status: String(d.status ?? ""), value: num(d.value), executedPct: num(d.executedPct), billedPct: num(d.billedPct) })
  }
  return out
}

async function readCertificate(tx: Transaction, firestore: Firestore, projectId: string, seq: number) {
  const ref = doc(firestore, "projects", projectId, PM_CERTIFICATES, certificateNo(seq))
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmCertificateError("missing")
  return { ref, cert: { id: snap.id, ...(snap.data() as Omit<PmCertificate, "id">) } }
}

export interface PrepareInput {
  itemIds: string[]
  /** Re-claim the consultant's earlier deductions (default: yes). */
  includeCuts?: boolean
  /** Approved variations to bill for their executed share not yet billed. */
  voIds?: string[]
  checks?: CertificateCheck[]
}

/** The QS prepares a certificate: the chosen items' whole unbilled quantity
 * (+ returned deductions), amounts by §8.6 under the contract in force now. It
 * bills those quantities at once, and waits for internal approval. */
export async function prepareCertificate(firestore: Firestore, ctx: PmContext, projectId: string, actor: CertificateActor, input: PrepareInput): Promise<{ seq: number; amounts: Amounts }> {
  let out = { seq: 0, amounts: { gross: 0, recovery: 0, retention: 0, vat: 0, net: 0 } as Amounts }
  await runTransaction(firestore, async (tx) => {
    const { pRef, project, pm, terms, original } = await readContract(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "certificate.prepare")
    const items = await readBillable(tx, firestore, projectId, input.itemIds)
    const vos = await readVariations(tx, firestore, projectId, input.voIds ?? [])
    const totals = pm as PmTotals
    const lines = certificateLines(items, new Set(input.itemIds))
    const voLines = certificateVoLines(vos, new Set(input.voIds ?? []))
    const cuts = input.includeCuts === false ? 0 : r2(totals.cutPool ?? 0)
    const gross = r2(lines.reduce((a, l) => a + l.amount, 0) + voLines.reduce((a, l) => a + l.amount, 0) + cuts)
    // AMD-09: an addendum to "nobody pays" does not stop the billing of work already done.
    const blocks = prepareBlocks({ archived: fresh.archived, lifecycle: lifecycleOf(project), payer: certificatePayer(original, terms), gross })
    if (blocks.length) throw new PmCertificateError("blocked", blocks)

    // INV-01: priced items + approved variations (the handover's figure only while no BOQ is priced).
    const contractValue = await readContractValue(firestore, projectId, project.budget)
    const amounts = certificateAmounts({ gross, terms, contractValue, held: totals.retentionHeld ?? 0, recovered: totals.advanceRecovered ?? 0 })
    const seq = (totals.ipcCount ?? 0) + 1
    const prepOn = todayDay()
    const cert: Omit<PmCertificate, "id"> = {
      seq,
      status: "int",
      lines,
      voLines,
      cutsIncluded: cuts,
      periodFrom: totals.lastIpcOn ?? totals.startOn ?? totals.startedAt?.slice(0, 10) ?? null,
      periodTo: prepOn,
      checks: [...new Set(input.checks ?? [])],
      ...amounts,
      terms: termsSnapshot(terms),
      contractValue,
      prep: actor.uid,
      prepName: actor.name,
      prepOn,
      appr: null,
      apprName: null,
      apprOn: null,
      selfApp: false,
      certified: null,
      cut: null,
      cutReason: null,
      consultantRef: null,
      certOn: null,
      certBy: null,
      certByName: null,
      dueOn: null,
      submitted: null,
    }
    for (const l of lines) {
      const item = items.find((i) => i.id === l.itemId)!
      tx.update(doc(firestore, "projects", projectId, "boqItems", l.itemId), { billedQuantity: r2(item.billed + l.qty), updatedAt: serverTimestamp() })
    }
    for (const v of voLines) tx.update(doc(firestore, "projects", projectId, PM_VARIATIONS, v.voId), { billedPct: v.to, updatedAt: serverTimestamp() })
    tx.set(doc(firestore, "projects", projectId, PM_CERTIFICATES, certificateNo(seq)), { ...cert, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(pRef, {
      pm: {
        ...pm,
        ipcCount: seq,
        lastIpcOn: cert.prepOn,
        retentionHeld: r2((totals.retentionHeld ?? 0) + amounts.retention),
        advanceRecovered: r2((totals.advanceRecovered ?? 0) + amounts.recovery),
        cutPool: r2((totals.cutPool ?? 0) - cuts),
      },
      updatedAt: serverTimestamp(),
    })
    out = { seq, amounts }
  })
  return out
}

/** Internal approval → submitted to the consultant. Never by its preparer —
 * unless the company allows a recorded self-approval (IPC-02). */
export async function approveCertificate(firestore: Firestore, ctx: PmContext, projectId: string, actor: CertificateActor, seq: number, opts: { selfApprovalAllowed?: boolean } = {}): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readContract(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    const selfApprovalAllowed = opts.selfApprovalAllowed || (await readSelfApproval(tx, firestore, (project as { organizationId?: string }).organizationId))
    const { ref, cert } = await readCertificate(tx, firestore, projectId, seq)
    if (cert.status !== "int") throw new PmCertificateError("wrong_state")
    if (!mayApproveCertificate(fresh, actor.uid, cert.prep, selfApprovalAllowed)) {
      throw new PmAccessError(fresh.archived ? "archived" : actor.uid === cert.prep && !selfApprovalAllowed ? "self_approval" : "no_duty", "certificate.approve")
    }
    tx.update(ref, { status: "sub", appr: actor.uid, apprName: actor.name, apprOn: todayDay(), selfApp: actor.uid === cert.prep, updatedAt: serverTimestamp() })
  })
}

/** Record the consultant's certification (full or with a deduction): the
 * amounts recompute on the certified value, the deduction returns to unbilled,
 * and prj:IPC goes to Finance at the certified amount (IPC-03). */
export async function certifyCertificate(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: CertificateActor,
  seq: number,
  input: { certified: number; reason?: string | null; consultantRef?: string | null }
): Promise<Amounts & { event: PmEvent | null }> {
  let result: Amounts & { event: PmEvent | null } = { gross: 0, recovery: 0, retention: 0, vat: 0, net: 0, event: null }
  await runTransaction(firestore, async (tx) => {
    const { pRef, project, pm } = await readContract(tx, firestore, projectId)
    assertPm(withFreshState(ctx, project), "certificate.certify")
    const { ref, cert } = await readCertificate(tx, firestore, projectId, seq)
    const blocks = certifyBlocks({ status: cert.status, gross: cert.gross, certified: input.certified, reason: input.reason })
    if (blocks.length) throw new PmCertificateError("blocked", blocks)
    const totals = pm as PmTotals
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
    const certOn = todayDay()
    const dueOn = dueDate(certOn, cert.terms.paymentDays)
    tx.update(ref, {
      status: "appr",
      submitted: { gross: cert.gross, recovery: cert.recovery, retention: cert.retention, vat: cert.vat, net: cert.net },
      ...amounts,
      certified: amounts.gross,
      cut,
      cutReason: cut > 0 ? (input.reason ?? null) : null,
      consultantRef: input.consultantRef?.trim() || null,
      certOn,
      certBy: actor.uid,
      certByName: actor.name,
      dueOn,
      updatedAt: serverTimestamp(),
    })
    tx.update(pRef, {
      pm: {
        ...pm,
        retentionHeld: r2((totals.retentionHeld ?? 0) - cert.retention + amounts.retention),
        advanceRecovered: r2((totals.advanceRecovered ?? 0) - cert.recovery + amounts.recovery),
        cutPool: r2((totals.cutPool ?? 0) + cut),
      },
      updatedAt: serverTimestamp(),
    })
    const event = certificateEvent({
      organizationId: project.organizationId ?? "",
      projectId,
      projectNo: pm.no ?? projectId,
      seq,
      amounts,
      dueOn,
      by: actor.uid,
      at: new Date().toISOString(),
    })
    tx.set(doc(firestore, PM_EVENTS, pmEventDocId(event.organizationId, event.key)), event)
    result = { ...amounts, event }
  })
  return result
}

/** Withdraw a certificate before it is submitted — by its preparer or approve.
 * Its billing is undone: the quantities, the re-claimed deductions, the
 * retention and the recovery all return. */
export async function withdrawCertificate(firestore: Firestore, ctx: PmContext, projectId: string, actor: CertificateActor, seq: number): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { pRef, project, pm } = await readContract(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    const { ref, cert } = await readCertificate(tx, firestore, projectId, seq)
    const may = cert.prep === actor.uid ? pmCan(fresh, "prep") || pmCan(fresh, "approve") : pmCan(fresh, "approve")
    if (!may) throw new PmAccessError(fresh.archived ? "archived" : "no_duty", "certificate.withdraw")
    if (cert.status !== "int") throw new PmCertificateError("wrong_state")
    const items = await readBillable(tx, firestore, projectId, cert.lines.map((l) => l.itemId))
    const vos = await readVariations(tx, firestore, projectId, (cert.voLines ?? []).map((l) => l.voId))
    for (const l of cert.lines) {
      const item = items.find((i) => i.id === l.itemId)
      if (item) tx.update(doc(firestore, "projects", projectId, "boqItems", l.itemId), { billedQuantity: r2(Math.max(0, item.billed - l.qty)), updatedAt: serverTimestamp() })
    }
    for (const l of cert.voLines ?? []) {
      const vo = vos.find((v) => v.id === l.voId)
      if (vo) tx.update(doc(firestore, "projects", projectId, PM_VARIATIONS, l.voId), { billedPct: Math.max(0, Math.round(((vo.billedPct ?? 0) - (l.to - l.from)) * 1e6) / 1e6), updatedAt: serverTimestamp() })
    }
    const totals = pm as PmTotals
    tx.update(ref, { status: "void", voidBy: actor.uid, voidByName: actor.name, voidOn: todayDay(), updatedAt: serverTimestamp() })
    tx.update(pRef, {
      pm: {
        ...pm,
        retentionHeld: r2((totals.retentionHeld ?? 0) - cert.retention),
        advanceRecovered: r2((totals.advanceRecovered ?? 0) - cert.recovery),
        cutPool: r2((totals.cutPool ?? 0) + cert.cutsIncluded),
      },
      updatedAt: serverTimestamp(),
    })
  })
}
