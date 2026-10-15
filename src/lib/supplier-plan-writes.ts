import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore"
import { COMPANY_PLANS, SUPPLIER_PLANS, type SupplierPlan } from "./supplier-plan"

/** The platform admin puts a supplier company on the free journey or the full portal. */
export async function setSupplierPlan(firestore: Firestore, orgId: string, plan: SupplierPlan, actor: { uid: string; name: string }): Promise<void> {
  if (!(SUPPLIER_PLANS as readonly string[]).includes(plan)) throw new Error("bad plan")
  await setDoc(doc(firestore, COMPANY_PLANS, orgId), { organizationId: orgId, supplierPlan: plan, updatedById: actor.uid, updatedByName: actor.name, updatedAt: serverTimestamp() })
}
