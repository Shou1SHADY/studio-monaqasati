// A supplier asking a contractor to connect (PRD CON-03): the request waits as a link in "pending" until the contractor
// accepts it; the contractor's owner is told in his own notification system.

import { getAuth } from "firebase/auth"
import type { Firestore } from "firebase/firestore"
import { emitProcEvent } from "@/lib/procurement/events"

/** A contractor's invitation answered (CON-02): the server checks it is addressed to him (e-mail or mobile), opens the
 * connection with the Admin SDK and tells the inviter — the rules never let a supplier make an active link himself. */
export async function answerInvitation(id: string, answer: "accepted" | "declined"): Promise<void> {
  const token = await getAuth().currentUser?.getIdToken()
  if (!token) throw new Error("UNAUTHENTICATED")
  const res = await fetch("/api/supplier-free/invitations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, answer }) })
  if (!res.ok) throw new Error(String(res.status))
}

export async function tellOwnerAboutRequest(
  firestore: Firestore,
  me: { orgId: string; uid: string; name: string; company: string },
  contractorOrgId: string,
  note: string
): Promise<void> {
  await emitProcEvent(firestore, { uid: me.uid, name: me.name || me.company }, {
    kind: "sup_connection_requested",
    organizationId: contractorOrgId,
    to: [{ owner: true }],
    params: { supplier: me.company, note: note.trim() },
    link: "/contractor/suppliers",
  })
}
