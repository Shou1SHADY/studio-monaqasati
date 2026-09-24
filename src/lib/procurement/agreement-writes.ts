// Writing a price agreement (PRD 3.0 §4 `AGR`, §7.4 "renew an agreement").
//
// Three acts and nothing else: sign one, renew it, end it early. Each appends to
// the agreement's own log, and the fields an order or a history row points at —
// the number, the supplier, the organisation, the start date — are frozen after
// signing, because a price already committed against an agreement must still be
// explicable by reading it.
//
// The number is drawn inside the transaction that writes the document, from the
// same yearly counters as the purchase order, so an abandoned form consumes no
// number and two people can never hold `AG-2026/007`.

import { doc, collection, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { ProcWriteError } from "./writes"
import { drawProcDocNumber } from "./numbering"
import { PRICE_AGREEMENTS, agreementState, materialKey, type AgreementLine, type AgreementLogEntry, type PriceAgreement } from "./prices"
import { dayOf, todayOf } from "./po"
import type { ProcActor } from "./types"

const round2 = (n: number) => Math.round(n * 100) / 100

const logEntry = (actor: ProcActor, action: AgreementLogEntry["action"], at: string, params?: Record<string, string | number> | null): AgreementLogEntry => ({
  action,
  at,
  byId: actor.uid,
  byName: actor.name,
  ...(params ? { params } : {}),
})

/** Signing or renewing an agreement commits the company to a price, so it asks
 * for the same hand that awards or approves an order. */
const mayWrite = (actor: ProcActor): boolean => Boolean(actor.isOwner || actor.canPrepare || actor.canApprove)

export interface AgreementLineInput {
  name: string
  unit: string
  price: number | string
}

/** The lines as typed, cleaned. A line with no name, no unit or no price is not
 * an agreement line — it is an empty row somebody tabbed through. */
export function cleanAgreementLines(lines: AgreementLineInput[]): AgreementLine[] {
  const out: AgreementLine[] = []
  const seen = new Set<string>()
  for (const l of lines || []) {
    const name = (l.name || "").trim()
    const unit = (l.unit || "").trim()
    const price = round2(Number(String(l.price ?? "").replace(/,/g, "")))
    if (!name || !unit || !Number.isFinite(price) || price <= 0) continue
    const key = materialKey(name, unit)
    // One price per material: a second row for the same thing would make
    // `agreementFor` pick between two prices from one agreement.
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, unit, price })
  }
  return out
}

export interface CreateAgreementInput {
  organizationId: string
  supplierOrgId: string
  supplierName: string
  /** `YYYY-MM-DD`, both inclusive. */
  from: string
  until: string
  lines: AgreementLineInput[]
  note?: string | null
}

export async function createPriceAgreement(
  firestore: Firestore,
  actor: ProcActor,
  input: CreateAgreementInput,
  opts: { now?: Date } = {}
): Promise<{ id: string; docNumber: string }> {
  if (!mayWrite(actor)) throw new ProcWriteError("no_permission")
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const from = dayOf(input.from)
  const until = dayOf(input.until)
  if (!from || !until) throw new ProcWriteError("date_invalid")
  if (until < from) throw new ProcWriteError("date_invalid")
  if (until < todayOf(now)) throw new ProcWriteError("date_invalid")
  if (!input.supplierOrgId) throw new ProcWriteError("supplier_missing")
  const lines = cleanAgreementLines(input.lines)
  if (!lines.length) throw new ProcWriteError("no_lines")

  const ref = doc(collection(firestore, PRICE_AGREEMENTS))
  return runTransaction(firestore, async (tx) => {
    const docNumber = await drawProcDocNumber(firestore, tx, input.organizationId, "AG", now.getUTCFullYear())
    const agreement: Omit<PriceAgreement, "id"> & { updatedAt: unknown } = {
      organizationId: input.organizationId,
      docNumber,
      supplierOrgId: input.supplierOrgId,
      supplierName: input.supplierName || "",
      from,
      until,
      lines,
      note: (input.note || "").trim() || null,
      preparedById: actor.uid,
      preparedByName: actor.name,
      createdAt: at,
      endedAt: null,
      log: [logEntry(actor, "created", at, { number: docNumber, lines: lines.length })],
      updatedAt: serverTimestamp(),
    }
    tx.set(ref, agreement)
    return { id: ref.id, docNumber }
  })
}

export interface RenewAgreementInput {
  /** The new end date, `YYYY-MM-DD` — must be later than today. */
  until: string
  /** Prices as typed; a blank or non-positive entry keeps the current price. */
  prices?: Record<string, number | string> | null
  note?: string | null
}

/**
 * Renew: a later end date, and the prices as they were re-negotiated.
 *
 * The materials themselves do not change — adding one would be a different
 * agreement with a different number, and the orders already placed on this one
 * name it. A renewal writes nothing to the price history: nobody has bought
 * anything yet.
 */
export async function renewPriceAgreement(
  firestore: Firestore,
  actor: ProcActor,
  agreementId: string,
  input: RenewAgreementInput,
  opts: { now?: Date } = {}
): Promise<PriceAgreement> {
  if (!mayWrite(actor)) throw new ProcWriteError("no_permission")
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const until = dayOf(input.until)
  if (!until || until <= todayOf(now)) throw new ProcWriteError("date_invalid")
  const ref = doc(firestore, PRICE_AGREEMENTS, agreementId)
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ProcWriteError("order_missing")
    const current = { ...(snap.data() as Omit<PriceAgreement, "id">), id: snap.id } as PriceAgreement
    const lines = (current.lines || []).map((l) => {
      const typed = round2(Number(String(input.prices?.[materialKey(l.name, l.unit)] ?? "").replace(/,/g, "")))
      return Number.isFinite(typed) && typed > 0 ? { ...l, price: typed } : l
    })
    const changed = lines.filter((l, i) => l.price !== (current.lines || [])[i]?.price).length
    const next: Partial<PriceAgreement> = {
      until,
      lines,
      endedAt: null,
      ...(input.note !== undefined ? { note: (input.note || "").trim() || null } : {}),
    }
    const log = [...(current.log || []), logEntry(actor, "renewed", at, { until, repriced: changed })]
    tx.update(ref, { ...next, log, updatedAt: serverTimestamp() })
    return { ...current, ...next, log }
  })
}

/** End it now — the materials go back to the market from today, with the reason
 * on the record. An agreement that already ended cannot end again. */
export async function endPriceAgreement(
  firestore: Firestore,
  actor: ProcActor,
  agreementId: string,
  reason: string,
  opts: { now?: Date } = {}
): Promise<PriceAgreement> {
  if (!mayWrite(actor)) throw new ProcWriteError("no_permission")
  const text = (reason || "").trim()
  if (!text) throw new ProcWriteError("reason_required")
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const ref = doc(firestore, PRICE_AGREEMENTS, agreementId)
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ProcWriteError("order_missing")
    const current = { ...(snap.data() as Omit<PriceAgreement, "id">), id: snap.id } as PriceAgreement
    // Ending cancels an agreement not yet started, too: one signed for next
    // quarter that falls through must not switch itself on. Only one already
    // over (by date or by hand) has nothing left to end.
    if (agreementState(current, todayOf(now)) === "expired") throw new ProcWriteError("wrong_state")
    const log = [...(current.log || []), logEntry(actor, "ended", at, { reason: text })]
    tx.update(ref, { endedAt: at, log, updatedAt: serverTimestamp() })
    return { ...current, endedAt: at, log }
  })
}
