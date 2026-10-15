// Server-side twin of `emitProcEvent` for the routes that must enforce a rule before they write (the supplier's
// invoice, the visitor's account). The notification document is the same pure `buildProcNotification` — only the
// writer differs (Admin SDK). Best-effort: a lost notification never undoes the act it reports.

import type { Firestore } from "firebase-admin/firestore"
import { buildProcNotification, procEventKey, type ProcEvent } from "@/lib/procurement/events"

export async function notifyNamed(db: Firestore, actor: { uid: string; name: string }, e: Omit<ProcEvent, "to">, users: (string | null | undefined)[]): Promise<number> {
  const recipients = [...new Set([...users, e.organizationId].filter((x): x is string => !!x && x !== actor.uid))]
  const at = new Date().toISOString()
  const key = procEventKey({ kind: e.kind, poId: e.poId })
  await Promise.all(
    recipients.map((uid) => {
      const box = db.collection("users").doc(uid).collection("notifications")
      const ref = key ? box.doc(key) : box.doc()
      return ref.set(buildProcNotification({ ...e, to: [] }, actor, uid, at)).catch((err) => console.warn("notification failed:", (err as { code?: string })?.code || err))
    })
  )
  return recipients.length
}
