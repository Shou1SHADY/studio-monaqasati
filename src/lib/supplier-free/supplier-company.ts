// The supplier's ACTIVE company as the server must read it before any act it writes in the company's name (an invoice,
// a quote, an order act). The caller's own `users/{uid}` is the person, not the company: a team member carries no tax
// number and no company name of his own, and the owner of a secondary company keeps the PRIMARY company's on his doc.
// So the company is read where its identity lives —
//  - the primary company: the owner's `users/{orgId}`;
//  - a secondary company (an `organizations/{orgId}` doc, for its owner and its members alike): that doc, never the
//    owner's primary fields (`stripIdentityFields`, as useResolvedProfile does);
// and the tax number from the company's own fields, else `companyIdentity/{orgId}` (DEV-60), else the public yes/no of
// `companyPublicFacts/{orgId}`. One rule follows for VAT (decision 9): a company with a VAT number charges 15%, any
// other 0 — on its quotes and on its invoices alike.

import type { Firestore } from "firebase-admin/firestore"
import { stripIdentityFields } from "@/lib/identity-fields"
import { COMPANY_IDENTITY } from "@/lib/company-identity"
import { COMPANY_PUBLIC_FACTS } from "@/lib/company-public-facts"

export const SUPPLIER_VAT = 0.15

type Rec = Record<string, unknown>

export interface SupplierCompany {
  /** The person acting. */
  uid: string
  name: string
  orgId: string
  /** The company's name, as the contractor reads it. */
  company: string
  hasVat: boolean
  /** The VAT rate the company charges: 15% with a VAT number, else 0. */
  vatRate: number
  /** The company's specialties and coverage cities — what makes a public request his (RFQ-01). */
  field: { specs: string[]; cities: string[] }
  /** Approved by the platform admin (the company's `isVerified`) — no quotation before it (supplier-approval.ts). */
  approved: boolean
}

const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "")
const list = (v: unknown): string[] => (Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [])

/** The VAT rate a company charges: 15% when it has a VAT number, 0 otherwise. */
export const vatRateOf = (hasVat: boolean): number => (hasVat ? SUPPLIER_VAT : 0)

/** Reads the caller's active company. `user` is the `users/{uid}` data the route already read. */
export async function supplierCompanyOf(db: Firestore, uid: string, user: Rec): Promise<SupplierCompany> {
  const orgId = text(user.organizationId) || uid
  let company: Rec = user
  if (orgId !== uid) {
    const [org, owner] = await Promise.all([db.collection("organizations").doc(orgId).get().catch(() => null), db.collection("users").doc(orgId).get().catch(() => null)])
    if (org && org.exists) company = { ...stripIdentityFields(user), ...(org.data() as Rec) }
    else if (owner && owner.exists) company = owner.data() as Rec
  }
  const [identity, facts] = await Promise.all([
    db.collection(COMPANY_IDENTITY).doc(orgId).get().catch(() => null),
    db.collection(COMPANY_PUBLIC_FACTS).doc(orgId).get().catch(() => null),
  ])
  const taxNumber = text(company.taxNumber) || text((identity?.data() as Rec | undefined)?.taxNumber)
  const hasVat = taxNumber !== "" || (facts?.data() as Rec | undefined)?.hasVat === true
  const companyName = text(company.companyName) || text(company.name) || text(user.companyName) || text(user.name)
  const specs = list(company.specializations).length ? list(company.specializations) : list(user.specializations)
  const cities = list(company.coverageCities).length ? list(company.coverageCities) : list(user.coverageCities)
  return {
    uid,
    name: text(user.name) || companyName,
    orgId,
    company: companyName,
    hasVat,
    vatRate: vatRateOf(hasVat),
    field: { specs, cities },
    approved: company.isVerified === true,
  }
}
