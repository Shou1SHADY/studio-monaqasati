// Decision 2 of Supplier 1.0 — the receipt window. When a supplier reports "I delivered" and the contractor records no
// receipt, the daily job (Vercel cron /api/cron/receipt-window, production only) reminds the contractor's receivers
// after 2 days and escalates to the procurement manager (po.approve holders and the owner) when the company's window
// (`escalateAfterDays`, Procurement 2.0 §14 — 2 by default; 5 only when a caller passes none) is over — each ONCE per
// report, stamped on the report (`nudgedAt` / `escalatedAt`) inside a transaction so a second run, or two overlapping
// ones, tell nobody twice. The supplier is never late while the report waits (deal-logic `isLate`).

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import type { PoDeliveryReport, PurchaseOrder } from "@/lib/procurement/types"
import { readPoliciesAdmin } from "@/lib/procurement/policies-server"
import { notifyNamed } from "./server-notify"

export const REMIND_AFTER_DAYS = 2
export const ESCALATE_AFTER_DAYS = 5

/** A report as the job stamps it. */
export type WindowReport = PoDeliveryReport & { nudgedAt?: string | null; escalatedAt?: string | null }

export interface WindowItem {
  poId: string
  reportId: string
  stage: "remind" | "escalate"
  /** Whole days since the report's window opened (`windowStart`). */
  days: number
}

const dayNum = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number)
  return Date.UTC(y, m - 1, dd)
}
export const daysSince = (from: string, today: string) => Math.round((dayNum(today) - dayNum(from)) / 864e5)

/** Riyadh's today, `YYYY-MM-DD`. */
export const riyadhToday = (now: Date = new Date()) => new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)

/** The day a report's window opens: the delivery date he gave, but never before the day he REPORTED it (Riyadh) — a
 * report back-dated to last week starts its two days today, not already late. */
export const windowStart = (r: Pick<PoDeliveryReport, "date" | "at">): string => {
  const reported = typeof r.at === "string" && r.at ? riyadhToday(new Date(r.at)) : ""
  const given = r.date.slice(0, 10)
  return reported > given ? reported : given
}

/** Pure: what each open report is owed today. Escalation also reminds the receivers when they were never reminded
 * (a report the job first sees on day 5). Only an accepted order still waiting for goods has a window. */
export function receiptWindowDue(pos: readonly PurchaseOrder[], today: string, escalateAfter: (po: PurchaseOrder) => number = () => ESCALATE_AFTER_DAYS): WindowItem[] {
  const out: WindowItem[] = []
  for (const po of pos) {
    if (po.status !== "accepted") continue
    for (const r of (po.deliveryReports || []) as WindowReport[]) {
      if (r.closedAt || !r.date) continue
      const days = daysSince(windowStart(r), today)
      if (days >= escalateAfter(po) && !r.escalatedAt) out.push({ poId: po.id, reportId: r.id, stage: "escalate", days })
      if (days >= REMIND_AFTER_DAYS && !r.nudgedAt) out.push({ poId: po.id, reportId: r.id, stage: "remind", days })
    }
  }
  return out
}

const SYSTEM = { uid: "system", name: "Mdmak" }

export async function runReceiptWindow(db: Firestore, now: Date = new Date()): Promise<{ open: number; reminded: number; escalated: number; skipped: number; failed: number }> {
  const today = riyadhToday(now)
  const snap = await db.collection("purchaseOrders").where("status", "==", "accepted").get()
  const pos = snap.docs.map((d) => ({ ...(d.data() as Omit<PurchaseOrder, "id">), id: d.id }) as PurchaseOrder).filter((p) => (p.deliveryReports || []).some((r) => !r.closedAt))
  const totals = { open: pos.length, reminded: 0, escalated: 0, skipped: 0, failed: 0 }
  const at = now.toISOString()
  const windows = new Map<string, number>()
  for (const org of new Set(pos.map((p) => p.organizationId))) windows.set(org, (await readPoliciesAdmin(db, org)).escalateAfterDays)
  for (const item of receiptWindowDue(pos, today, (po) => windows.get(po.organizationId) ?? ESCALATE_AFTER_DAYS)) {
    try {
      const ref = db.collection("purchaseOrders").doc(item.poId)
      const stamp = item.stage === "remind" ? "nudgedAt" : "escalatedAt"
      const fresh = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref)
        if (!s.exists) return null
        const po = { ...(s.data() as Omit<PurchaseOrder, "id">), id: s.id } as PurchaseOrder
        const reports = (po.deliveryReports || []) as WindowReport[]
        const r = reports.find((x) => x.id === item.reportId)
        if (!r || r.closedAt || r[stamp] || po.status !== "accepted") return null
        tx.update(ref, { deliveryReports: reports.map((x) => (x.id === item.reportId ? { ...x, [stamp]: at } : x)), updatedAt: FieldValue.serverTimestamp() })
        return { po, report: r }
      })
      if (!fresh) {
        totals.skipped += 1
        continue
      }
      const { po, report } = fresh
      await notifyNamed(
        db,
        SYSTEM,
        {
          kind: item.stage === "remind" ? "po_receipt_window_remind" : "po_receipt_window_escalated",
          organizationId: po.organizationId,
          params: { supplier: po.supplierName, number: po.docNumber, date: report.date, days: item.days },
          poId: po.id,
          rfqId: po.rfqId,
          offerId: po.offerId,
        },
        item.stage === "remind" ? [] : [po.preparedById],
        // The receivers record it; the procurement manager (and the owner, always among the holders) chases them.
        { permissions: item.stage === "remind" ? ["deliveries.confirm"] : ["po.approve"] }
      )
      if (item.stage === "remind") totals.reminded += 1
      else totals.escalated += 1
    } catch (error) {
      totals.failed += 1
      console.error("Receipt-window notice failed for", item.poId, error)
    }
  }
  return totals
}
