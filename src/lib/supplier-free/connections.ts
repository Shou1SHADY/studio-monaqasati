// A supplier asking a contractor to connect (PRD CON-03): the request waits as a link in "pending" until the contractor
// accepts it; the contractor's owner is told in his own notification system.

import type { Firestore } from "firebase/firestore"
import { emitProcEvent } from "@/lib/procurement/events"

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
