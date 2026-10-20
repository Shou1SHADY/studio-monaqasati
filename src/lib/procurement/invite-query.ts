import { collection, query, where, type Firestore } from "firebase/firestore"

/**
 * The company's platform invitations to suppliers. The `invitations` list rule lets a company member read only the
 * documents that are `supplier_invite` AND belong to his company, and Firestore refuses a list query whose filters do
 * not already prove that for every possible result — so BOTH constraints are in the query, not one of them plus a
 * client-side filter.
 */
export const supplierInvitationsQuery = (firestore: Firestore, orgId: string) =>
  query(collection(firestore, "invitations"), where("contractorOrgId", "==", orgId), where("type", "==", "supplier_invite"))
