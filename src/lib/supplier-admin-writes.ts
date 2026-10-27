import { addDoc, collection, deleteField, doc, updateDoc, type DocumentReference, type Firestore } from "firebase/firestore"
import { identityDocRef, isSecondaryOrg } from "@/lib/org-identity"

// The platform admin's writes on a supplier company, shared by Admin → Subscribed suppliers and Admin → Free suppliers.
// The standing document is the company's identity: users/{owner} for the primary company, organizations/{id} for a
// secondary one — the rules refuse `isVerified` from anyone but the admin.

/** The document holding a company's standing, for an account row of the subscribed list. */
export function standingRefOfAccount(firestore: Firestore, row: { id: string; organizationId?: string | null; organizationRole?: string | null }): DocumentReference {
  return isSecondaryOrg(row.organizationId, row.id, row.organizationRole) ? identityDocRef(firestore, row.organizationId as string) : doc(firestore, "users", row.id)
}

/** The document holding a company's standing, for a company row of the free list. */
export function standingRefOfCompany(firestore: Firestore, company: { id: string; source: "user" | "org" }): DocumentReference {
  return company.source === "org" ? identityDocRef(firestore, company.id) : doc(firestore, "users", company.id)
}

/** Approve or withdraw a company's approval. An approval is what lets it quote, so the owner is told — best effort: the approval stands. */
export async function setSupplierApproval(firestore: Firestore, args: { standing: DocumentReference; notifyUserId: string | null; verify: boolean }): Promise<void> {
  await updateDoc(args.standing, { isVerified: args.verify, verificationRequested: false })
  if (!args.verify || !args.notifyUserId) return
  await addDoc(collection(firestore, "users", args.notifyUserId, "notifications"), {
    userId: args.notifyUserId,
    type: "supplier_approved",
    i18n: { title: "pn_supplier_approved_title", message: "pn_supplier_approved", params: {} },
    title: "اعتُمدت منشأتك",
    message: "اعتمدت مدماك تِك منشأتك، ويمكنك الآن إرسال عروض الأسعار.",
    link: "/supplier/rfqs",
    createdAt: new Date().toISOString(),
    read: false,
  }).catch((err) => console.warn("approval notice failed:", err))
}

/** Approve or refuse a company's request to change its specializations and coverage cities, and tell its owner. */
export async function decideSupplierSpecs(
  firestore: Firestore,
  args: {
    standing: DocumentReference
    notifyUserId: string
    approve: boolean
    pendingSpecializations?: string[] | null
    pendingCoverageCities?: string[] | null
    notice: { title: string; message: string }
  },
): Promise<void> {
  await updateDoc(args.standing, {
    ...(args.approve && args.pendingSpecializations ? { specializations: args.pendingSpecializations } : {}),
    ...(args.approve && args.pendingCoverageCities ? { coverageCities: args.pendingCoverageCities } : {}),
    pendingSpecializations: deleteField(),
    pendingCoverageCities: deleteField(),
  })
  await addDoc(collection(firestore, "users", args.notifyUserId, "notifications"), {
    title: args.notice.title,
    message: args.notice.message,
    type: "specs_decision",
    createdAt: new Date().toISOString(),
    read: false,
  })
}
