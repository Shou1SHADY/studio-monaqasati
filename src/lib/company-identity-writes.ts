import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore"
import { COMPANY_IDENTITY, identityPatch } from "@/lib/company-identity"
import { COMPANY_PUBLIC_FACTS, publicFactsPatch } from "@/lib/company-public-facts"

/**
 * Mirrors the sensitive fields of a profile write into companyIdentity/{orgId}.
 * Until the move is finished the old profile fields stay the source of truth,
 * so a failed mirror is logged and never blocks the save it follows.
 */
export async function mirrorCompanyIdentity(firestore: Firestore, orgId: string, payload: Record<string, unknown>): Promise<void> {
  if (!orgId) return
  const patch = identityPatch(payload)
  const facts = publicFactsPatch(payload)
  const writes: Promise<void>[] = []
  if (Object.keys(patch).length) writes.push(setDoc(doc(firestore, COMPANY_IDENTITY, orgId), { ...patch, updatedAt: serverTimestamp() }, { merge: true }))
  if (Object.keys(facts).length) writes.push(setDoc(doc(firestore, COMPANY_PUBLIC_FACTS, orgId), { ...facts, updatedAt: serverTimestamp() }, { merge: true }))
  for (const result of await Promise.allSettled(writes)) {
    if (result.status === "rejected") console.error("companyIdentity mirror failed", result.reason)
  }
}
