// «صعّد» on the server (TDY-05, WP-S5-04): one Admin transaction re-reads the delivery, re-runs the window rule against the company's
// policy, and writes `escalation` ONCE — to the project manager of the order's site, or the owner without Projects. Idempotent by
// construction (a second press, or the daily job meeting a delivery already escalated, changes nothing) and by key
// (`proc:PO:<no>:REP<n>:ESC`). The notice to the target and the outbox event follow the commit, best-effort.

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { poEscalateKey } from "./event-keys"
import { escalationTarget, needsEscalation, daysUncounted } from "./escalation"
import { projectsOn } from "./financeless-server"
import { sendProcEvent } from "./proc-event-server"
import { readPoliciesAdmin } from "./policies-server"
import type { DeliveryEscalation, DeskDelivery } from "./receipt-desk"
import { PURCHASE_ORDERS, type PurchaseOrder } from "./types"

export type EscalationRefusalCode = "delivery_missing" | "not_yours" | "not_due" | "already_escalated"

const STATUS: Record<EscalationRefusalCode, number> = { delivery_missing: 404, not_yours: 403, not_due: 409, already_escalated: 409 }

export class EscalationRefusal extends Error {
  readonly status: number
  constructor(readonly code: EscalationRefusalCode) {
    super(code)
    this.name = "EscalationRefusal"
    this.status = STATUS[code]
  }
}

export interface EscalateRequest {
  deliveryId: string
  /** The company whose delivery it must be (the caller's), or null for the daily job, which reads the delivery's own. */
  orgId: string | null
  by: { uid: string; name: string }
}

export interface EscalateResult {
  escalation: DeliveryEscalation
  days: number
  /** The delivery was already escalated: nothing changed, nobody was told again. */
  already: boolean
}

type Doc = Record<string, unknown>

export async function escalateDelivery(db: Firestore, req: EscalateRequest, now: Date = new Date()): Promise<EscalateResult> {
  const ref = db.collection("deliveries").doc(req.deliveryId)
  const first = (await ref.get()).data() as Doc | undefined
  if (!first) throw new EscalationRefusal("delivery_missing")
  const orgId = first.contractorOrgId as string | undefined
  if (!orgId || (req.orgId && req.orgId !== orgId)) throw new EscalationRefusal("not_yours")
  const policies = await readPoliciesAdmin(db, orgId)
  const poId = (first.poId as string | undefined) || null
  const po = poId ? ((await db.collection(PURCHASE_ORDERS).doc(poId).get()).data() as Partial<PurchaseOrder> | undefined) : undefined
  const projectId = po?.projectId || (first.projectId as string | undefined) || null
  const project = projectId ? ((await db.collection("projects").doc(projectId).get()).data() as { projectManagerId?: string | null; projectManagerName?: string | null } | undefined) : undefined
  const target = escalationTarget({ projectsOn: await projectsOn(db, orgId), projectManagerId: project?.projectManagerId, ownerId: orgId })
  const targetName = target.kind === "project_manager" ? project?.projectManagerName || null : ((await db.collection("users").doc(orgId).get()).data() as { name?: string; companyName?: string } | undefined)?.name || null
  const at = now.toISOString()

  const out = await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() as Doc | undefined
    if (!d) throw new EscalationRefusal("delivery_missing")
    if (d.escalation) return { escalation: d.escalation as DeliveryEscalation, already: true }
    const fact = d as unknown as DeskDelivery
    if (!needsEscalation(fact, now, policies.escalateAfterDays)) throw new EscalationRefusal("not_due")
    const escalation: DeliveryEscalation = { at, byId: req.by.uid, byName: req.by.name, toKind: target.kind, toUid: target.uid, toName: targetName }
    tx.update(ref, { escalation, updatedAt: FieldValue.serverTimestamp() })
    return { escalation, already: false }
  })
  const days = daysUncounted({ deliveryDate: first.deliveryDate as string | null | undefined }, now)
  if (out.already) return { ...out, days }

  const poNumber = po?.docNumber || (first.poNumber as string | undefined) || ""
  const seq = Number(first.seq) > 0 ? Number(first.seq) : 1
  if (poNumber) {
    await sendProcEvent(db, {
      id: "po_escalate",
      key: poEscalateKey(poNumber, seq),
      organizationId: orgId,
      by: req.by.uid,
      at,
      refs: { po: poNumber, notice: seq, grn: null },
      payload: { receiver: (first.forwardedTo as { name?: string } | undefined)?.name ?? null, days, to: target.kind },
    })
  }
  await notifyNamed(
    db,
    req.by,
    {
      kind: "po_receipt_window_escalated",
      organizationId: orgId,
      params: { supplier: po?.supplierName || (first.supplierName as string | undefined) || "", number: poNumber, date: String(first.deliveryDate || "").slice(0, 10), days },
      poId,
      rfqId: po?.rfqId ?? null,
      offerId: po?.offerId ?? null,
      link: `/contractor/goods-received?tab=count&delivery=${req.deliveryId}`,
    },
    [target.uid],
    { owner: false }
  ).catch((err: unknown) => console.warn("escalation not announced:", (err as { code?: string })?.code || err))
  return { escalation: out.escalation, days, already: false }
}

export interface EscalationSweep {
  open: number
  escalated: number
  skipped: number
  failed: number
}

const SYSTEM = { uid: "system", name: "Mdmak" }

/** The daily job's part: every forwarded, uncounted notice past its company's window is escalated — the same act the button makes. */
export async function runNoticeEscalation(db: Firestore, now: Date = new Date()): Promise<EscalationSweep> {
  const snap = await db.collection("deliveries").where("status", "==", "pending_confirmation").get()
  const totals: EscalationSweep = { open: snap.size, escalated: 0, skipped: 0, failed: 0 }
  const windows = new Map<string, number>()
  for (const doc of snap.docs) {
    const d = doc.data() as Doc
    const orgId = d.contractorOrgId as string | undefined
    if (!orgId || !d.forwardedTo || d.escalation || d.closedByReceipt) {
      totals.skipped += 1
      continue
    }
    if (!windows.has(orgId)) windows.set(orgId, (await readPoliciesAdmin(db, orgId)).escalateAfterDays)
    if (!needsEscalation(d as unknown as DeskDelivery, now, windows.get(orgId) as number)) {
      totals.skipped += 1
      continue
    }
    try {
      const r = await escalateDelivery(db, { deliveryId: doc.id, orgId: null, by: SYSTEM }, now)
      if (r.already) totals.skipped += 1
      else totals.escalated += 1
    } catch (error) {
      if (error instanceof EscalationRefusal) totals.skipped += 1
      else {
        totals.failed += 1
        console.error("Notice escalation failed for", doc.id, error)
      }
    }
  }
  return totals
}
