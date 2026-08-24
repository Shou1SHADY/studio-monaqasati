import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore"
import { CRM_CONTACTS, CRM_OPPORTUNITIES, CRM_QUOTATIONS } from "@/lib/crm"

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 500

async function commitInBatches(
  firestore: Firestore,
  refs: DocumentReference[],
  apply: (batch: ReturnType<typeof writeBatch>, ref: DocumentReference) => void
) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(firestore)
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) apply(batch, ref)
    await batch.commit()
  }
}

async function childRefs(firestore: Firestore, orgId: string, contactId: string): Promise<DocumentReference[]> {
  const refs: DocumentReference[] = []
  for (const collectionName of [CRM_OPPORTUNITIES, CRM_QUOTATIONS]) {
    const snapshot = await getDocs(
      query(
        collection(firestore, collectionName),
        where("organizationId", "==", orgId),
        where("contactId", "==", contactId)
      )
    )
    snapshot.forEach((docSnap) => refs.push(docSnap.ref))
  }
  return refs
}

/**
 * Delete a contact and everything hanging off it. Opportunities and quotations
 * are top-level documents keyed by `contactId`, so without this they survive
 * their contact — invisible in the UI but still counted by every pipeline
 * query that sums the whole organization.
 *
 * Children go first: if the run dies halfway, what is left is a contact with
 * fewer children (recoverable, and the page still renders) rather than orphans
 * with no contact to reach them through.
 */
export async function deleteContactCascade(firestore: Firestore, contactId: string, orgId: string) {
  const children = await childRefs(firestore, orgId, contactId)
  await commitInBatches(firestore, children, (batch, ref) => batch.delete(ref))
  await deleteDoc(doc(firestore, CRM_CONTACTS, contactId))
}

/**
 * Push a renamed contact into the denormalised `contactName` its opportunities
 * and quotations carry — that copy is what the org-wide lists render, so a
 * rename that stops here would leave the pipeline showing the old name.
 *
 * Best-effort by design: a stale label is a cosmetic problem, and it must not
 * turn a successful rename into a failed save.
 */
export async function renameContactReferences(
  firestore: Firestore,
  contactId: string,
  orgId: string,
  newName: string
) {
  try {
    const children = await childRefs(firestore, orgId, contactId)
    await commitInBatches(firestore, children, (batch, ref) => batch.update(ref, { contactName: newName }))
  } catch (err) {
    console.error("Failed to propagate CRM contact rename", err)
  }
}
