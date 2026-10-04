import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore"
import { COMPANY_IDENTITY, identityPatch } from "@/lib/company-identity"

/**
 * Mirrors the sensitive fields of a profile write into companyIdentity/{orgId}.
 * Until the move is finished the old profile fields stay the source of truth,
 * so a failed mirror is logged and never blocks the save it follows.
 */
export async function mirrorCompanyIdentity(firestore: Firestore, orgId: string, payload: Record<string, unknown>): Promise<void> {
  const patch = identityPatch(payload)
  if (!orgId || Object.keys(patch).length === 0) return
  try {
    await setDoc(doc(firestore, COMPANY_IDENTITY, orgId), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
  } catch (err) {
    console.error("companyIdentity mirror failed", err)
  }
}
