// The server's side of the 36-event outbox (Pipeline 2.0 §3): an act that crosses a unit's boundary leaves one event
// under a key that never repeats, `{orgId}__{key}`, created with `.create()` — a second send of the same key is refused
// by the store, so a retry never acts twice. Best-effort: a lost event never undoes the act it reports.

import type { Firestore } from "firebase-admin/firestore"
import { COMPANY_MODULES } from "@/lib/company-modules"
import { PROC_EVENTS, buildProcEvent, procEventDocId, type ProcEvent } from "./event-keys"
import type { ProcEventId } from "./package-data"

export type EventOutcome = "sent" | "duplicate" | "closed" | "failed"

const alreadyThere = (err: unknown): boolean => {
  const code = (err as { code?: unknown })?.code
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS" || /already.?exists/i.test(String((err as Error)?.message || ""))
}

export async function sendProcEvent(
  db: Firestore,
  input: { id: ProcEventId; key: string; organizationId: string; by: string; at: string; refs?: ProcEvent["refs"]; payload?: ProcEvent["payload"] }
): Promise<EventOutcome> {
  try {
    const off = (await db.collection(COMPANY_MODULES).doc(input.organizationId).get()).data()?.off
    const event = buildProcEvent({ ...input, off: Array.isArray(off) ? off.filter((x): x is string => typeof x === "string") : [] })
    if (!event) return "closed"
    await db.collection(PROC_EVENTS).doc(procEventDocId(input.organizationId, input.key)).create(event as unknown as Record<string, unknown>)
    return "sent"
  } catch (err) {
    if (alreadyThere(err)) return "duplicate"
    console.warn("proc event not sent:", input.key, (err as { code?: string })?.code || err)
    return "failed"
  }
}

/** The part of an event key that names the RFQ: its number when it has one, else its id (no colon, no space). */
export const rfqKeyPart = (rfq: Record<string, unknown>, rfqId: string): string => {
  const no = typeof rfq.rfqNumber === "string" ? rfq.rfqNumber.trim() : ""
  return no && !/[:\s]/.test(no) ? no : rfqId
}
