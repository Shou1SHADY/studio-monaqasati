// What the free supplier tells the contractor, in the contractor's own notification system (PRD §14 "who is
// told what"). Every act of his goes through `emitProcEvent`, so each notification carries both translation keys
// and the sender's rendered text; best-effort and AFTER the business write, never undoing it.
//
// A supplier acting in his portal cannot read the buyer's team, so recipients are named: the people on the
// order (who prepared, approved and sent it) and the company's owner (whose uid IS the organisation id).

import type { Firestore } from "firebase/firestore"
import { emitProcEvent, type ProcEventKind, type ProcRecipientSpec } from "@/lib/procurement/events"
import type { Translator } from "@/lib/mfg-events"
import type { PurchaseOrder } from "@/lib/procurement/types"

export interface SupplierActor {
  uid: string
  name: string
}

export interface SupplierSide {
  /** The company he trades as — what the message names. */
  company: string
  actor: SupplierActor
  copy?: Translator | null
}

const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x))]

/** Events about a request or a quote: the person who raised the request, and the owner. */
export async function tellAboutRfq(
  firestore: Firestore,
  s: SupplierSide,
  rfq: { id: string; organizationId?: unknown; contractorId?: unknown; rfqNumber?: unknown },
  kind: ProcEventKind,
  params: Record<string, string | number>,
  offerId?: string | null
): Promise<number> {
  const org = String(rfq.organizationId || rfq.contractorId || "")
  if (!org) return 0
  const to: ProcRecipientSpec[] = [{ users: unique([String(rfq.contractorId || "")]) }, { owner: true }]
  return emitProcEvent(firestore, s.actor, {
    kind,
    organizationId: org,
    to,
    params: { supplier: s.company, rfq: String(rfq.rfqNumber || ""), ...params },
    rfqId: rfq.id,
    offerId: offerId ?? null,
    link: `/contractor/rfqs/${rfq.id}/offers`,
    copy: s.copy ?? null,
  })
}

/** Events about an order: whoever prepared, approved and sent it, and the owner. */
export async function tellAboutPo(
  firestore: Firestore,
  s: SupplierSide,
  po: Pick<PurchaseOrder, "id" | "organizationId" | "docNumber" | "preparedById" | "approvedById" | "sentById" | "rfqId" | "offerId">,
  kind: ProcEventKind,
  params: Record<string, string | number>
): Promise<number> {
  const to: ProcRecipientSpec[] = [{ users: unique([po.preparedById, po.approvedById, po.sentById]) }, { owner: true }]
  return emitProcEvent(firestore, s.actor, {
    kind,
    organizationId: po.organizationId,
    to,
    params: { supplier: s.company, number: po.docNumber, ...params },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: s.copy ?? null,
  })
}
