import { addDoc, arrayUnion, collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, type Firestore } from "firebase/firestore"
import type { z } from "zod"
import {
  activitySchema,
  contactsClient,
  leadCrmId,
  manualLeadSchema,
  planMerge,
  type HistoryType,
  type LeadDetails,
  type ClientRecord,
  type LeadRow,
} from "@/lib/admin-crm"

export type Actor = { uid: string; name: string }
export type ManualLeadValues = z.infer<typeof manualLeadSchema>
export type ActivityValues = z.infer<typeof activitySchema>

export const leadCollectionOf = (r: Pick<LeadRow, "source">) => (r.source === "onboarding" ? "onboardingRequests" : "demoRequests")

/** The CRM record of a lead or client (doc id = crmId / the client's uid), merged so nothing else on it is lost. */
export function saveRecord(db: Firestore, id: string, patch: Partial<ClientRecord> & Record<string, unknown>) {
  return setDoc(doc(db, "adminCrmClients", id), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
}

/** ADM-04: a person who reached us outside the landing page. The source is the one required field; the owner defaults to whoever adds it. */
export async function addManualLead(db: Firestore, actor: Actor, v: ManualLeadValues, owner: { uid: string; name: string }) {
  const ref = await addDoc(collection(db, "demoRequests"), {
    name: v.name,
    company: v.company,
    phone: v.phone,
    email: v.email,
    city: v.city,
    origin: "manual",
    manualSource: v.source,
    businessTypes: v.kind === "unspecified" ? [] : [v.kind],
    note: v.note,
    status: "new",
    createdByUid: actor.uid,
    createdAt: serverTimestamp(),
  })
  const crmId = leadCrmId("manual", ref.id)
  await saveRecord(db, crmId, { stage: "new", ownerUid: owner.uid, ownerName: owner.name })
  if (v.note) {
    await addDoc(collection(db, "adminCrmActivities"), {
      clientId: crmId,
      type: "note",
      note: v.note,
      title: v.note.slice(0, 80),
      status: "done",
      authorUid: actor.uid,
      authorName: actor.name,
      createdAt: serverTimestamp(),
    })
  }
  return crmId
}

/** Removing a lead hides it (junk, a duplicate) — the request is kept and can be restored. */
export function setLeadArchived(db: Firestore, row: Pick<LeadRow, "id" | "source">, archived: boolean, uid: string, reason?: string) {
  return updateDoc(doc(db, leadCollectionOf(row), row.id), {
    archived,
    archivedAt: archived ? serverTimestamp() : null,
    archivedByUid: archived ? uid : null,
    archivedReason: archived ? reason ?? "removed" : null,
  })
}

export function createActivity(db: Firestore, actor: Actor, v: ActivityValues, ownerName: string) {
  return addDoc(collection(db, "adminCrmActivities"), {
    clientId: v.clientId,
    type: v.type,
    status: v.status,
    dueDate: v.dueDate,
    dueTime: v.dueTime,
    withName: v.withName,
    title: v.title,
    note: v.note,
    ownerUid: v.ownerUid,
    ownerName,
    ...(v.status === "done" && v.result ? { result: v.result } : {}),
    authorUid: actor.uid,
    authorName: actor.name,
    createdAt: serverTimestamp(),
  })
}

export function updateActivity(db: Firestore, id: string, v: ActivityValues, ownerName: string) {
  return updateDoc(doc(db, "adminCrmActivities", id), {
    clientId: v.clientId,
    type: v.type,
    status: v.status,
    dueDate: v.dueDate,
    dueTime: v.dueTime,
    withName: v.withName,
    title: v.title,
    note: v.note,
    ownerUid: v.ownerUid,
    ownerName,
    result: v.status === "done" && v.result ? v.result : null,
    updatedAt: serverTimestamp(),
  })
}

/** Tick a scheduled activity done (or un-tick it). Doing a call / WhatsApp / meeting / e-mail is what counts as contact. */
export function setActivityDone(db: Firestore, id: string, done: boolean, today: string, type: HistoryType) {
  return updateDoc(doc(db, "adminCrmActivities", id), {
    status: done ? "done" : "scheduled",
    ...(done ? { doneAt: serverTimestamp(), ...(contactsClient(type) ? { dueDate: today } : {}) } : { doneAt: null }),
    updatedAt: serverTimestamp(),
  })
}

export function deleteActivity(db: Firestore, id: string) {
  return deleteDoc(doc(db, "adminCrmActivities", id))
}

/** ADM-09 «not a duplicate»: remember the pair so it is not offered again, and nothing changes on either record. */
export function dismissDuplicate(db: Firestore, a: string, b: string) {
  return Promise.all([
    setDoc(doc(db, "adminCrmClients", a), { notDuplicateOf: arrayUnion(b), updatedAt: serverTimestamp() }, { merge: true }),
    setDoc(doc(db, "adminCrmClients", b), { notDuplicateOf: arrayUnion(a), updatedAt: serverTimestamp() }, { merge: true }),
  ])
}

/** ADM-05: the lead's own details, on the request it arrived with. The type is written only when it changed, so the
 * finer types a landing-page request carried (contractor + factory…) are not flattened by an unrelated edit. */
export async function updateLeadDetails(db: Firestore, row: Pick<LeadRow, "id" | "source" | "kind">, v: LeadDetails) {
  return updateDoc(doc(db, leadCollectionOf(row), row.id), {
    name: v.name,
    company: v.company,
    phone: v.phone,
    email: v.email,
    city: v.city,
    ...(v.kind !== row.kind ? { businessTypes: v.kind === "unspecified" ? [] : [v.kind], companyTypes: [] } : {}),
    updatedAt: serverTimestamp(),
  })
}

/** ADM-09 merge: the older record keeps its place and takes the other's activities, contacts and quotes;
 * quotes and the other is hidden as «duplicate» (kept, restorable) and points at where it went. */
export async function mergeLeads(
  db: Firestore,
  keep: Pick<LeadRow, "id" | "crmId" | "source" | "name" | "phone" | "email">,
  drop: Pick<LeadRow, "id" | "crmId" | "source" | "name" | "phone" | "email">,
  records: Record<string, ClientRecord>,
  uid: string,
) {
  const acts = await getDocs(query(collection(db, "adminCrmActivities"), where("clientId", "==", drop.crmId)))
  const batch = writeBatch(db)
  batch.set(doc(db, "adminCrmClients", keep.crmId), { ...planMerge(keep, drop, records).record, updatedAt: serverTimestamp() }, { merge: true })
  batch.set(doc(db, "adminCrmClients", drop.crmId), { mergedInto: keep.crmId, updatedAt: serverTimestamp() }, { merge: true })
  acts.forEach((d) => batch.update(d.ref, { clientId: keep.crmId, movedFrom: drop.crmId }))
  const deals = await getDocs(query(collection(db, "adminCrmDeals"), where("clientId", "==", drop.crmId)))
  deals.forEach((d) => batch.update(d.ref, { clientId: keep.crmId, movedFrom: drop.crmId }))
  batch.update(doc(db, leadCollectionOf(drop), drop.id), {
    archived: true,
    archivedAt: serverTimestamp(),
    archivedByUid: uid,
    archivedReason: "duplicate",
  })
  await batch.commit()
  return acts.size + deals.size
}

/** A stage change states why (agreed 6 Oct 2026): the stage is saved and the reason goes into the record's history, who and when. */
export async function changeStage(db: Firestore, actor: Actor, id: string, from: string, to: string, reason: string) {
  await setDoc(doc(db, "adminCrmClients", id), { stage: to, updatedAt: serverTimestamp() }, { merge: true })
  await addDoc(collection(db, "adminCrmActivities"), {
    clientId: id,
    type: "stage",
    from,
    to,
    note: reason,
    status: "done",
    authorUid: actor.uid,
    authorName: actor.name,
    createdAt: serverTimestamp(),
  })
}
