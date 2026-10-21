// Procurement 2.0 — idempotency keys of the 36 events (Pipeline 2.0 §3, NFR-02). A key is Latin, built from ids that never
// repeat (an order or RFQ number, a supplier id), `V<n>` for what changes and a counter for what repeats; the outbox
// document is `{orgId}__{key}`, so a second send of the same key is refused instead of acting twice. One builder per
// event, named for the registry row it serves; `matchesTemplate` proves a key belongs to its row. Pure: no I/O.

import { EVENTS, type PipelineUnit, type ProcEventId } from "./package-data"
import { packageOf, unitIn, type PackageFlags } from "./package"

export const PROC_EVENTS = "procEvents"

export interface ProcEvent {
  key: string
  id: ProcEventId
  unit: PipelineUnit
  dir: "in" | "out"
  organizationId: string
  refs: Record<string, string | number | null>
  /** Never a secret, and never a price to a role that must not see one. */
  payload: Record<string, unknown>
  /** The package at the moment of sending: what was open when the event left. */
  connectors: PackageFlags
  by: string
  at: string
}

/** The outbox document id: the organisation in front of the key, because numbers are drawn per organisation. */
export const procEventDocId = (organizationId: string, key: string): string => `${organizationId}__${key.replace(/\//g, "_")}`

const part = (value: string | number): string => {
  const s = String(value).trim()
  if (!s || /[:\s]/.test(s)) throw new Error(`event key part "${s}" is empty or holds a colon or a space`)
  return s
}
const seq = (n: number): number => {
  if (!Number.isInteger(n) || n < 1) throw new Error(`event sequence ${n} is not a positive whole number`)
  return n
}

export const rfqOfferKey = (rfqNo: string, supplierId: string, version: number) => `proc:RFQ:${part(rfqNo)}:${part(supplierId)}:V${seq(version)}`
export const rfqPublishKey = (rfqNo: string, version: number) => `proc:RFQ:${part(rfqNo)}:V${seq(version)}`
export const rfqAskKey = (rfqNo: string, n: number) => `proc:RFQ:${part(rfqNo)}:ASK${seq(n)}`
export const rfqAnswerKey = (rfqNo: string, n: number) => `proc:RFQ:${part(rfqNo)}:Q${seq(n)}`
export const rfqCutKey = (rfqNo: string, supplierId: string) => `proc:RFQ:${part(rfqNo)}:${part(supplierId)}:CUT`
export const rfqOutcomeKey = (rfqNo: string, supplierId: string, round: number) => `proc:RFQ:${part(rfqNo)}:${part(supplierId)}:OUT:R${seq(round)}`
export const poMessageKey = (poNo: string, n: number) => `proc:PO:${part(poNo)}:MSG${seq(n)}`
export const poMessageSupplierKey = (poNo: string, n: number) => `proc:PO:${part(poNo)}:MSG${seq(n)}:SUP`
export const poVersionKey = (poNo: string, version: number) => `proc:PO:${part(poNo)}:V${seq(version)}`
export const poAcceptKey = (poNo: string, version: number) => `proc:PO:${part(poNo)}:V${seq(version)}:ACC`
export const poReportKey = (poNo: string, n: number) => `proc:PO:${part(poNo)}:REP${seq(n)}`
export const poForwardKey = (poNo: string, report: number, forward: number) => `proc:PO:${part(poNo)}:REP${seq(report)}:FWD${seq(forward)}`
export const poDeclineKey = (poNo: string, version: number) => `proc:PO:${part(poNo)}:V${seq(version)}:DEC`
export const poRejectKey = (poNo: string, n: number) => `proc:PO:${part(poNo)}:REJ${seq(n)}`
export const poEscalateKey = (poNo: string, report: number) => `proc:PO:${part(poNo)}:REP${seq(report)}:ESC`
export const needLineKey = (needId: string) => `inv:NEED:${part(needId)}`
export const issueRequestKey = (requestId: string, lineNo: number) => `proc:ISS:${part(requestId)}:${seq(lineNo)}`
export const stockCheckKey = (requestId: string, lineNo: number, version: number) => `inv:CHK:${part(requestId)}:${seq(lineNo)}:V${seq(version)}`
export const poInboundKey = (poNo: string, version: number) => `proc:PO:${part(poNo)}:V${seq(version)}:INV`
export const warehouseReceiptKey = (grnNo: string) => `inv:GRN:${part(grnNo)}`
export const manualReceiptKey = (grnNo: string) => `proc:GRN:${part(grnNo)}:MAN`
export const projectRequestKey = (requestId: string) => `prj:MR:${part(requestId)}`
export const projectRequestCancelKey = (requestId: string, lineNo: number) => `prj:MR:${part(requestId)}:CAN:${seq(lineNo)}`
export const requestStatusKey = (requestId: string, lineNo: number, version: number) => `proc:ST:${part(requestId)}:${seq(lineNo)}:V${seq(version)}`
export const projectReceiptKey = (grnNo: string) => `prj:GRN:${part(grnNo)}`
export const commitmentKey = (poNo: string, version: number) => `proc:PO:${part(poNo)}:V${seq(version)}:FIN`
export const advanceRequestKey = (advanceNo: string) => `proc:ADV:${part(advanceNo)}`
export const varianceKey = (invoiceNo: string) => `proc:VAR:${part(invoiceNo)}`
export const advancePaidKey = (advanceNo: string) => `fin:ADV:${part(advanceNo)}`
export const paymentKey = (paymentNo: string) => `fin:PAY:${part(paymentNo)}`
export const paidKey = (poNo: string) => `fin:PAID:${part(poNo)}`
export const holdKey = (invoiceNo: string) => `proc:HOLD:${part(invoiceNo)}`
export const shortageKey = (purchaseRequestId: string) => `mfg:PRQ:${part(purchaseRequestId)}`
export const workshopAskKey = (requestId: string, lineNo: number) => `proc:MK:${part(requestId)}:${seq(lineNo)}`
export const workshopReplyKey = (requestId: string, lineNo: number, version: number) => `mfg:MK:${part(requestId)}:${seq(lineNo)}:V${seq(version)}`
export const workshopStatusKey = (purchaseRequestId: string, lineNo: number, version: number) => `proc:ST:${part(purchaseRequestId)}:${seq(lineNo)}:V${seq(version)}`

export const EVENT_KEY_BUILDERS: Record<ProcEventId, (...args: never[]) => string> = {
  rfq_offer: rfqOfferKey,
  rfq_publish: rfqPublishKey,
  rfq_ask: rfqAskKey,
  rfq_answer: rfqAnswerKey,
  rfq_cut: rfqCutKey,
  rfq_outcome: rfqOutcomeKey,
  po_message: poMessageKey,
  po_message_supplier: poMessageSupplierKey,
  po_version: poVersionKey,
  po_accept: poAcceptKey,
  po_report: poReportKey,
  po_forward: poForwardKey,
  po_decline: poDeclineKey,
  po_reject: poRejectKey,
  po_escalate: poEscalateKey,
  inv_need: needLineKey,
  inv_issue: issueRequestKey,
  inv_check: stockCheckKey,
  po_inbound: poInboundKey,
  inv_receipt: warehouseReceiptKey,
  receipt_manual: manualReceiptKey,
  pm_request: projectRequestKey,
  pm_cancel: projectRequestCancelKey,
  pm_status: requestStatusKey,
  pm_receipt: projectReceiptKey,
  fin_commitment: commitmentKey,
  fin_advance_request: advanceRequestKey,
  fin_variance: varianceKey,
  fin_advance_paid: advancePaidKey,
  fin_payment: paymentKey,
  fin_paid: paidKey,
  fin_hold: holdKey,
  mfg_shortage: shortageKey,
  mfg_ask: workshopAskKey,
  mfg_reply: workshopReplyKey,
  mfg_status: workshopStatusKey,
}

/** A registry key template (`proc:PO:<po_no>:V<n>`) as a pattern a built key must match. */
function templatePattern(template: string): RegExp {
  const body = template
    .split(/(<[a-z_]+>)/)
    .map((piece) => {
      if (!piece) return ""
      if (piece === "<n>" || piece === "<m>") return "[1-9][0-9]*"
      if (piece.startsWith("<")) return "[^:\\s]+"
      return piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    })
    .join("")
  return new RegExp(`^${body}$`)
}

export function matchesTemplate(id: ProcEventId, key: string): boolean {
  const row = EVENTS.find((e) => e.id === id)
  return Boolean(row) && templatePattern((row as (typeof EVENTS)[number]).key).test(key)
}

/** Whether the unit's events are sent for a company whose stored switches are `off`. */
export function shouldEmit(unit: PipelineUnit, off: readonly string[] | null | undefined): boolean {
  return unitIn(unit, packageOf(off))
}

/** The event ready for the outbox, or null when its unit's connector is closed for this company. */
export function buildProcEvent(input: {
  id: ProcEventId
  key: string
  organizationId: string
  off: readonly string[] | null | undefined
  by: string
  at: string
  refs?: ProcEvent["refs"]
  payload?: ProcEvent["payload"]
}): ProcEvent | null {
  const row = EVENTS.find((e) => e.id === input.id)
  if (!row) throw new Error(`unknown event ${input.id}`)
  if (!matchesTemplate(input.id, input.key)) throw new Error(`key ${input.key} is not an ${input.id} key`)
  if (!shouldEmit(row.unit, input.off)) return null
  return {
    key: input.key,
    id: input.id,
    unit: row.unit,
    dir: row.dir,
    organizationId: input.organizationId,
    refs: input.refs ?? {},
    payload: input.payload ?? {},
    connectors: packageOf(input.off),
    by: input.by,
    at: input.at,
  }
}
