// `proc:PO:<no>:REP<n>:FWD<m>` — the notice forwarded to a receiver (RCV-02, event 12 of the 36). One event per forward of a notice; a
// second forward of the same notice is FWD2, so a retry never repeats and a re-forward is never lost. Best-effort, after the act.

import type { Firestore } from "firebase-admin/firestore"
import { poForwardKey } from "./event-keys"
import { sendProcEvent, type EventOutcome } from "./proc-event-server"

export async function sendForwardEvent(
  db: Firestore,
  input: { orgId: string; delivery: { poNumber?: unknown; seq?: unknown }; forwardNo: number; by: string; at: string; receiver: string; via: "account" | "link"; auto: boolean }
): Promise<EventOutcome | "skipped"> {
  const poNo = typeof input.delivery.poNumber === "string" ? input.delivery.poNumber.trim() : ""
  if (!poNo || /[:\s]/.test(poNo)) return "skipped"
  const seq = Number(input.delivery.seq) > 0 ? Number(input.delivery.seq) : 1
  return sendProcEvent(db, {
    id: "po_forward",
    key: poForwardKey(poNo, seq, Math.max(1, input.forwardNo)),
    organizationId: input.orgId,
    by: input.by,
    at: input.at,
    refs: { po: poNo, notice: seq, forward: Math.max(1, input.forwardNo) },
    payload: { receiver: input.receiver, via: input.via, auto: input.auto },
  })
}
