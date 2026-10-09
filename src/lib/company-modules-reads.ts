import { doc, type Firestore, type Transaction } from "firebase/firestore"
import { COMPANY_MODULES, offSet, type OptionalModule } from "./company-modules"

/** What the company has switched off, read inside a write so the rule it re-runs is the one in force NOW. A buyer-side
 * write: a member reads his own company's document, the admin writes it. */
export async function readModulesOff(tx: Transaction, firestore: Firestore, orgId: string | null | undefined): Promise<ReadonlySet<OptionalModule>> {
  if (!orgId) return new Set()
  try {
    const snap = await tx.get(doc(firestore, COMPANY_MODULES, orgId))
    return offSet(snap.exists() ? (snap.data() as { off?: unknown }) : null, "contractor")
  } catch {
    // unreadable: judged as everything on, the way a company nobody switched anything for is
    return new Set()
  }
}
