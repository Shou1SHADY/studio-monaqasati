// A contractor's subscription status (Procurement 2.0 prototype, admin list and package page — AD-03): «نشط» Active or
// «تجريبي» Trial, shown beside the package. Stored as an optional `subscription` on `companyModules/{orgId}` and written
// only by the admin's company-modules route; no field (every company before it) is Active. It gates nothing — billing and
// trial periods are not in the PRD — and it is not the verification status, which stays beside it.

export const SUBSCRIPTION_STATUSES = ["active", "trial"] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export const subscriptionStatusOf = (raw: unknown): SubscriptionStatus => (raw === "trial" ? "trial" : "active")
