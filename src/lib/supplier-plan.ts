// A supplier company is either on the FREE journey (Supplier 1.0: eight screens that answer
// "what do contractors ask of me, and what am I owed?") or on the FULL portal (the module list
// like a contractor's). Suppliers a contractor adds are free until the platform says
// otherwise; the admin switches a company in Components. No document = free.

export const COMPANY_PLANS = "companyPlans"

export const SUPPLIER_PLANS = ["free", "full"] as const
export type SupplierPlan = (typeof SUPPLIER_PLANS)[number]

export const planOf = (doc: { supplierPlan?: unknown } | null | undefined): SupplierPlan => (doc && doc.supplierPlan === "full" ? "full" : "free")

/** The pages of the free journey. Every other /supplier page belongs to the full portal. */
const FREE_EXACT = new Set(["/supplier", "/supplier/rfqs", "/supplier/offers", "/supplier/orders", "/supplier/invoices", "/supplier/connections", "/supplier/chats", "/supplier/profile", "/supplier/notifications", "/supplier/search"])

export function freePathAllowed(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/"
  if (FREE_EXACT.has(p)) return true
  return /^\/supplier\/chat\/[^/]+$/.test(p)
}
