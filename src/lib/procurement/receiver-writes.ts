// Keeping the receiver register (PRD 3.0 §4 `RCVR`).
//
// Add, correct, retire, bring back. A receiver is never deleted: a delivery
// forwarded to them names them, and a register that forgets who signed for a
// truck is worse than one with a retired row in it. Retiring takes them out of
// every list the forward dialog offers, which is the whole point.

import { addDoc, collection, doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore"
import { ProcWriteError } from "./writes"
import { PROCUREMENT_RECEIVERS, findDuplicateReceiver, parseReceiverInput, type ProcReceiver, type ReceiverInput } from "./receivers"
import type { ProcActor } from "./types"

/** The register is Procurement's: whoever prepares or approves an order keeps
 * it, and so does the org owner. Receiving alone is not enough — a store keeper
 * should not be able to add himself to another site. */
const mayWrite = (actor: ProcActor): boolean => Boolean(actor.isOwner || actor.canPrepare || actor.canApprove)

function guard(actor: ProcActor, input: ReceiverInput, register: ProcReceiver[], exceptId?: string): ReceiverInput {
  if (!mayWrite(actor)) throw new ProcWriteError("no_permission")
  const parsed = parseReceiverInput(input)
  if (!parsed.ok) throw new ProcWriteError("bad_receiver", { fields: parsed.fields.join(",") })
  const twin = findDuplicateReceiver(register, parsed.data, exceptId)
  if (twin) throw new ProcWriteError("bad_receiver", { fields: "duplicate", name: twin.name, retired: twin.active === false ? 1 : 0 })
  return parsed.data
}

export async function addReceiver(
  firestore: Firestore,
  actor: ProcActor,
  organizationId: string,
  input: ReceiverInput,
  opts: { now?: Date; register?: ProcReceiver[] } = {}
): Promise<string> {
  const clean = guard(actor, input, opts.register ?? [])
  const ref = await addDoc(collection(firestore, PROCUREMENT_RECEIVERS), {
    ...clean,
    organizationId,
    active: true,
    createdAt: (opts.now ?? new Date()).toISOString(),
    createdById: actor.uid,
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateReceiver(
  firestore: Firestore,
  actor: ProcActor,
  receiverId: string,
  input: ReceiverInput,
  register: ProcReceiver[] = []
): Promise<void> {
  const clean = guard(actor, input, register, receiverId)
  await updateDoc(doc(firestore, PROCUREMENT_RECEIVERS, receiverId), { ...clean, updatedAt: serverTimestamp() })
}

/** Out of every list, still on every delivery they ever received. */
export async function setReceiverActive(firestore: Firestore, actor: ProcActor, receiverId: string, active: boolean): Promise<void> {
  if (!mayWrite(actor)) throw new ProcWriteError("no_permission")
  await updateDoc(doc(firestore, PROCUREMENT_RECEIVERS, receiverId), { active, updatedAt: serverTimestamp() })
}
