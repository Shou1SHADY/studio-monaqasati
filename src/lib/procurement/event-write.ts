import { doc, type Firestore, type Transaction } from "firebase/firestore"
import { PROC_EVENTS, procEventDocId, type ProcEvent } from "./event-keys"

/** Puts the event in the outbox inside the act's own transaction. The outbox is create-only: a second send of the same key
 * is refused by the rules, which fails the transaction — resending never acts twice. A route using the Admin SDK writes the
 * same document with `.create()` at `procEventDocId`. */
export function queueProcEvent(firestore: Firestore, tx: Transaction, event: ProcEvent | null): void {
  if (event) tx.set(doc(firestore, PROC_EVENTS, procEventDocId(event.organizationId, event.key)), event)
}
