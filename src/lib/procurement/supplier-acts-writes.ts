// The contractor's side of the free supplier journey (Supplier 1.0): Finance tells the supplier a transfer was made
// (he confirms it arrived), the buyer accepts the warranty the supplier registered — both run on the server — and a
// buyer answers a supplier's request to connect.

import { doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore"
import { emitProcEvent } from "./events"
import { ActRefused, callAct } from "@/lib/supplier-free/act-client"
import { ProcWriteError, type WriteOpts } from "./writes"
import type { ProcActor, PurchaseOrder } from "./types"

export interface TransferInput {
  amount: number
  bank: string
  reference: string
  valueDate: string
  /** Finance's payment number on the order (`PAY-…-n`) — the supplier quotes it when he answers. */
  paymentNo?: string | null
}

/** The server checks who is asking and tells the supplier; a refusal comes back as the write errors the drawer already says. */
async function act(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    return await callAct(body)
  } catch (err) {
    if (err instanceof ActRefused) throw new ProcWriteError(err.code === "no_permission" || err.code === "UNAUTHENTICATED" ? "no_permission" : "wrong_state")
    throw err
  }
}

export async function reportTransferToSupplier(_firestore: Firestore, _actor: ProcActor, isFinance: boolean, po: PurchaseOrder, input: TransferInput): Promise<string> {
  if (!isFinance) throw new ProcWriteError("no_permission")
  if (!(input.amount > 0) || !po.supplierOrgId || po.supplierOrgId === "guest") throw new ProcWriteError("wrong_state")
  const r = await act({ action: "transfer.report", poId: po.id, amount: input.amount, bank: input.bank.trim(), reference: input.reference.trim(), valueDate: input.valueDate, ...(input.paymentNo ? { paymentNo: input.paymentNo } : {}) })
  return String(r.id || "")
}

export async function acceptSupplierWarranty(_firestore: Firestore, actor: ProcActor, _po: PurchaseOrder, warranty: { id: string; itemName: string }): Promise<void> {
  if (!actor.isOwner && !actor.canPrepare && !actor.canApprove) throw new ProcWriteError("no_permission")
  await act({ action: "warranty.accept", warrantyId: warranty.id })
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
