import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore"
import { COMPANY_PLANS, SUPPLIER_PLANS, type SupplierPlan } from "./supplier-plan"
import { trialWindow } from "./subscription-status"

/**
 * The platform admin puts a supplier company on the free journey or the full portal. `trialDays` makes the full portal a
 * trial that starts now: when the days run out the company reads as free again. The document is replaced whole, so a
 * subscription written after a trial carries no end date.
 */
export async function setSupplierPlan(firestore: Firestore, orgId: string, plan: SupplierPlan, actor: { uid: string; name: string }, trialDays?: number): Promise<void> {
  if (!(SUPPLIER_PLANS as readonly string[]).includes(plan)) throw new Error("bad plan")
  const trial = plan === "full" && trialDays !== undefined ? trialWindow(trialDays, new Date()) : null
  await setDoc(doc(firestore, COMPANY_PLANS, orgId), {
    organizationId: orgId,
    supplierPlan: plan,
    ...(trial ? { planTrialDays: trial.trialDays, planTrialStartedAt: trial.trialStartedAt, planTrialEndsAt: trial.trialEndsAt } : {}),
    updatedById: actor.uid,
    updatedByName: actor.name,
    updatedAt: serverTimestamp(),
  })
}
