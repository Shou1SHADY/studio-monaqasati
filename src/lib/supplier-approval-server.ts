// The server's reading of the onboarding rules (supplier-approval.ts): the free plan's monthly allowance and the
// company it applies to. `platformSettings` is the admin's alone (rules: admin read/write); the counts
// (`supplierQuoteCounts`) have no rule, so only the server writes them, inside the quote's transaction; a supplier
// reads his own through /api/supplier/quota.

import type { Firestore } from "firebase-admin/firestore"
import { COMPANY_PLANS, planOf } from "@/lib/supplier-plan"
import { QUOTA_SETTINGS_DOC, QUOTE_COUNTS, monthlyLimitOf, quoteCountId, riyadhMonth } from "@/lib/supplier-approval"

/** The limit the admin set for free companies, or null (no limit — the default). */
export async function freeMonthlyLimit(db: Firestore): Promise<number | null> {
  const snap = await db.collection(QUOTA_SETTINGS_DOC.collection).doc(QUOTA_SETTINGS_DOC.id).get().catch(() => null)
  return monthlyLimitOf(snap?.data()?.freeMonthlyQuotes)
}

/** The limit that applies to ONE company: the free plan's, when there is one; a subscribed company has none. */
export async function monthlyLimitFor(db: Firestore, orgId: string): Promise<number | null> {
  const [limit, plan] = await Promise.all([freeMonthlyLimit(db), db.collection(COMPANY_PLANS).doc(orgId).get().catch(() => null)])
  if (limit == null) return null
  return planOf(plan?.data()) === "free" ? limit : null
}

/** What a company has sent this Riyadh month, and its limit (null = none) — what the quote form shows. */
export async function quoteUsage(db: Firestore, orgId: string, now: Date = new Date()): Promise<{ month: string; used: number; limit: number | null }> {
  const month = riyadhMonth(now)
  const [limit, snap] = await Promise.all([monthlyLimitFor(db, orgId), db.collection(QUOTE_COUNTS).doc(quoteCountId(orgId, month)).get().catch(() => null)])
  return { month, used: Number(snap?.data()?.count) || 0, limit }
}
