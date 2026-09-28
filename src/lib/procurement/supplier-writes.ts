// Writing our record of a supplier (PRD 3.0 §7.2) — three acts: add him from
// the platform directory (a buyer may; he lands unverified), verify him (the
// manager, only with a VAT number on file), and correct the master record (the
// manager). Each appends to the record's own log inside the same transaction
// that re-checks the rule, so a refusal the screen missed is still a refusal.

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where, writeBatch, type Firestore } from "firebase/firestore"
import {
  SUPPLIER_RECORDS,
  canManageSuppliers,
  canVouchSuppliers,
  recordErrors,
  recordFields,
  supplierRecordId,
  verifyRefusal,
  type RecordError,
  type RecordInput,
  type SupplierLogEntry,
  type SupplierRecord,
  type VerifyRefusal,
} from "./supplier-file"
import type { ProcActor } from "./types"

export type SupplierWriteCode = VerifyRefusal | RecordError | "already_ours" | "no_permission"

export class SupplierWriteError extends Error {
  constructor(readonly code: SupplierWriteCode) {
    super(code)
    this.name = "SupplierWriteError"
  }
}

const entry = (actor: ProcActor, action: SupplierLogEntry["action"], at: string): SupplierLogEntry => ({ action, at, byId: actor.uid, byName: actor.name })

export interface DirectorySupplier {
  orgId: string
  name: string
  categories: string[]
  vat: string | null
}

/** Adds a platform supplier to ours: the connection our lists read, and an
 * unverified record waiting for the manager. A record we already keep (he was
 * ours before, and the connection was ended) is left as it is — its
 * verification and its log stay true. */
export async function addFromDirectory(firestore: Firestore, actor: ProcActor, orgId: string, s: DirectorySupplier, now = new Date(), ownerHasTeam = false): Promise<void> {
  if (!canManageSuppliers(actor, ownerHasTeam)) throw new SupplierWriteError("no_permission")
  const at = now.toISOString()
  const links = await getDocs(query(collection(firestore, "contractorSupplierLinks"), where("contractorOrgId", "==", orgId), where("supplierOrgId", "==", s.orgId)))
  if (links.docs.some((d) => d.data().status === "active")) throw new SupplierWriteError("already_ours")
  const recordRef = doc(firestore, SUPPLIER_RECORDS, supplierRecordId(orgId, s.orgId))
  const known = (await getDoc(recordRef)).exists()
  const batch = writeBatch(firestore)
  batch.set(doc(collection(firestore, "contractorSupplierLinks")), {
    contractorOrgId: orgId,
    supplierOrgId: s.orgId,
    supplierName: s.name,
    supplierCategories: s.categories,
    status: "active",
    requestedBy: "contractor_directory",
    requestedAt: serverTimestamp(),
    connectedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  const record: Omit<SupplierRecord, "id"> = {
    organizationId: orgId,
    supplierOrgId: s.orgId,
    supplierName: s.name,
    kind: "mat",
    source: "directory",
    vatNumber: s.vat || null,
    crExpiry: null,
    paymentTermsDays: 30,
    leadTimeDays: null,
    verified: false,
    addedById: actor.uid,
    addedByName: actor.name,
    addedAt: at,
    log: [entry(actor, "added", at)],
  }
  if (!known) batch.set(recordRef, record)
  await batch.commit()
}

export async function verifySupplier(firestore: Firestore, actor: ProcActor, orgId: string, supplierOrgId: string, profileVat: string | null, now = new Date(), ownerHasTeam = false): Promise<void> {
  const ref = doc(firestore, SUPPLIER_RECORDS, supplierRecordId(orgId, supplierOrgId))
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const record = snap.exists() ? (snap.data() as SupplierRecord) : null
    const refusal = verifyRefusal(actor, record, (record?.vatNumber || "").trim() || profileVat, ownerHasTeam)
    if (refusal) throw new SupplierWriteError(refusal)
    const at = now.toISOString()
    tx.update(ref, {
      verified: true,
      verifiedById: actor.uid,
      verifiedByName: actor.name,
      verifiedAt: at,
      log: [...(record?.log || []), entry(actor, "verified", at)],
    })
  })
}

export async function saveSupplierRecord(
  firestore: Firestore,
  actor: ProcActor,
  orgId: string,
  supplier: { orgId: string; name: string },
  input: RecordInput,
  now = new Date(),
  ownerHasTeam = false
): Promise<void> {
  if (!canVouchSuppliers(actor, ownerHasTeam)) throw new SupplierWriteError("no_permission")
  const errors = recordErrors(input)
  if (errors.length) throw new SupplierWriteError(errors[0])
  const ref = doc(firestore, SUPPLIER_RECORDS, supplierRecordId(orgId, supplier.orgId))
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const at = now.toISOString()
    const fields = recordFields(input)
    if (snap.exists()) {
      const record = snap.data() as SupplierRecord
      tx.update(ref, { ...fields, log: [...(record.log || []), entry(actor, "record_updated", at)] })
    } else {
      tx.set(ref, {
        organizationId: orgId,
        supplierOrgId: supplier.orgId,
        supplierName: supplier.name,
        source: "link",
        ...fields,
        addedById: actor.uid,
        addedByName: actor.name,
        addedAt: at,
        log: [entry(actor, "record_updated", at)],
      })
    }
  })
}

/** The invitation left through the sender's own WhatsApp or mail — recorded so
 * the panel can say so. */
export async function markInvitationSent(firestore: Firestore, invitationId: string, channel: "wa" | "email", now = new Date()): Promise<void> {
  await updateDoc(doc(firestore, "invitations", invitationId), { sentChannel: channel, sentAt: now.toISOString() })
}
