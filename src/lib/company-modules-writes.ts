import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore"
import { COMPANY_MODULES, isOptionalModule, type OptionalModule } from "./company-modules"

/** The platform admin sets what a company has switched off. The list replaces the stored one; an empty list switches everything back on. */
export async function setCompanyModules(firestore: Firestore, orgId: string, off: readonly OptionalModule[], actor: { uid: string; name: string }): Promise<void> {
  const clean = [...new Set(off.filter(isOptionalModule))]
  await setDoc(doc(firestore, COMPANY_MODULES, orgId), { organizationId: orgId, off: clean, updatedById: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp() })
}
