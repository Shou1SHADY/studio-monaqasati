// The daily job that tells a supplier its paid-plan trial is over. The plan reads «free» by itself once `planTrialEndsAt` has
// passed (supplier-plan.ts); this only says so, ONCE — the plan document is stamped (`planTrialNotifiedAt`) in a transaction, so a
// second run, or two overlapping ones, tell nobody twice. A new trial replaces the document, which clears the stamp.

import type { Firestore } from "firebase-admin/firestore"
import { COMPANY_PLANS, planTrialOf } from "@/lib/supplier-plan"
import { notifyNamed } from "@/lib/supplier-free/server-notify"

const SYSTEM = { uid: "system", name: "Mdmak" }

export async function runSupplierTrialNotices(db: Firestore, now: Date = new Date()): Promise<{ ended: number; told: number }> {
  const plans = await db.collection(COMPANY_PLANS).where("supplierPlan", "==", "full").get()
  let ended = 0
  let told = 0
  for (const plan of plans.docs) {
    const data = plan.data() as { planTrialEndsAt?: unknown; planTrialNotifiedAt?: unknown }
    if (planTrialOf({ supplierPlan: "full", planTrialEndsAt: data.planTrialEndsAt }, now).phase !== "ended" || data.planTrialNotifiedAt) continue
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(plan.ref)).data() as { planTrialNotifiedAt?: unknown } | undefined
      if (!fresh || fresh.planTrialNotifiedAt) return false
      tx.update(plan.ref, { planTrialNotifiedAt: now.toISOString() })
      return true
    })
    if (!claimed) continue
    ended++
    const owner = await db.collection("users").doc(plan.id).get()
    if (!owner.exists) continue
    told += await notifyNamed(db, SYSTEM, { kind: "plan_trial_ended", organizationId: plan.id, link: "/supplier" }, [])
  }
  return { ended, told }
}
