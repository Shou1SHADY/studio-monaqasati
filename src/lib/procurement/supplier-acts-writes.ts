// The contractor's side of the free supplier journey (Supplier 1.0): Finance tells the supplier a transfer was made
// (he confirms it arrived), and the buyer accepts the warranty the supplier registered. Each is one small write the
// rules bound to the buyer's own documents, followed by a best-effort notice to the supplier.

import { addDoc, collection, doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore"
import { emitProcEvent, sarText } from "./events"
import { ProcWriteError, type WriteOpts } from "./writes"
import type { ProcActor, PurchaseOrder } from "./types"

export interface TransferInput {
  amount: number
  bank: string
  reference: string
  valueDate: string
}

const supplierSide = (po: PurchaseOrder) => [...new Set([po.supplierUserId, po.supplierOrgId].filter((u): u is string => Boolean(u) && u !== "guest"))]

export async function reportTransferToSupplier(firestore: Firestore, actor: ProcActor, isFinance: boolean, po: PurchaseOrder, input: TransferInput, opts: WriteOpts = {}): Promise<string> {
  if (!isFinance) throw new ProcWriteError("no_permission")
  if (!(input.amount > 0) || !po.supplierOrgId || po.supplierOrgId === "guest") throw new ProcWriteError("wrong_state")
  const at = (opts.now ?? new Date()).toISOString()
  const ref = await addDoc(collection(firestore, "supplierTransfers"), {
    poId: po.id,
    rfqId: po.rfqId,
    supplierOrgId: po.supplierOrgId,
    buyerOrgId: po.organizationId,
    amount: input.amount,
    bank: input.bank.trim(),
    ref: input.reference.trim(),
    valueDate: input.valueDate,
    state: "sent",
    reportedAt: at,
    reportedById: actor.uid,
    reportedByName: actor.name,
    createdAt: serverTimestamp(),
  })
  await emitProcEvent(firestore, actor, {
    kind: "po_payment_reported",
    organizationId: po.organizationId,
    to: [{ users: supplierSide(po) }],
    supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
    params: { contractor: opts.orgName || actor.name, number: po.docNumber, amount: sarText(input.amount), bank: input.bank.trim(), ref: input.reference.trim() },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
  return ref.id
}

export async function acceptSupplierWarranty(firestore: Firestore, actor: ProcActor, po: PurchaseOrder, warranty: { id: string; itemName: string }, opts: WriteOpts = {}): Promise<void> {
  if (!actor.isOwner && !actor.canPrepare && !actor.canApprove) throw new ProcWriteError("no_permission")
  const at = (opts.now ?? new Date()).toISOString()
  await updateDoc(doc(firestore, "supplierWarranties", warranty.id), { state: "ok", acceptedAt: at, acceptedById: actor.uid, updatedAt: serverTimestamp() })
  await emitProcEvent(firestore, actor, {
    kind: "po_warranty_accepted",
    organizationId: po.organizationId,
    to: [{ users: supplierSide(po) }],
    supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId },
    params: { contractor: opts.orgName || actor.name, number: po.docNumber, item: warranty.itemName },
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    copy: opts.copy,
  })
}

export interface ConnectionRequest {
  id: string
  supplierOrgId: string
  supplierName: string
}

export async function answerConnectionRequest(firestore: Firestore, actor: ProcActor, canManage: boolean, buyerOrgId: string, request: ConnectionRequest, accept: boolean, opts: WriteOpts = {}): Promise<void> {
  if (!canManage) throw new ProcWriteError("no_permission")
  await updateDoc(doc(firestore, "contractorSupplierLinks", request.id), accept ? { status: "active", connectedAt: serverTimestamp(), updatedAt: serverTimestamp() } : { status: "rejected", updatedAt: serverTimestamp() })
  await emitProcEvent(firestore, actor, {
    kind: accept ? "sup_request_accepted" : "sup_request_declined",
    organizationId: buyerOrgId,
    to: [{ users: [request.supplierOrgId] }],
    supplier: { userId: request.supplierOrgId, orgId: request.supplierOrgId },
    params: { contractor: opts.orgName || actor.name },
    link: "/supplier/connections",
    copy: opts.copy,
  })
}
