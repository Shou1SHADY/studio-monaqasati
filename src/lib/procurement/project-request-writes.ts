// A project's (legacy, non-PM) purchase request: filed from the project's «طلبات شراء داخلية» tab, approved
// or rejected by whoever manages its warehouse (warehouses.manage), then it is Procurement's (needs.ts).
// Each act tells the next hand — best-effort, after the write: a lost notice never undoes the request.
// Before 6 Oct 2026 neither act told anyone, and a request sat unseen (meeting of 6 Oct: "a request from the
// project isn't reaching Procurement").

import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore"
import { purchaseRequestRef } from "../mfg-outside"
import { emitProcEvent } from "./events"

export interface ProjectRequestItem {
  name: string
  quantity: string | number
  unit?: string
  [k: string]: unknown
}

type Actor = { uid: string; name: string }

async function projectFacts(firestore: Firestore, projectId: string): Promise<{ orgId: string; name: string }> {
  const p = await getDoc(doc(firestore, "projects", projectId))
  const d = (p.exists() ? p.data() : {}) as { organizationId?: string; name?: string }
  return { orgId: d.organizationId ?? "", name: d.name ?? "" }
}

/** Files the request (pending) and tells the warehouse managers it waits for them. Returns its id. */
export async function fileProjectRequest(
  firestore: Firestore,
  actor: Actor,
  input: { projectId: string; title: string; items: ProjectRequestItem[]; notes: string | null }
): Promise<string> {
  const ref = await addDoc(collection(firestore, "projects", input.projectId, "purchaseRequests"), {
    title: input.title,
    items: input.items,
    notes: input.notes,
    status: "pending",
    requestedByUserId: actor.uid,
    requestedByUserName: actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  const p = await projectFacts(firestore, input.projectId)
  if (p.orgId)
    await emitProcEvent(firestore, actor, {
      kind: "need_filed",
      organizationId: p.orgId,
      to: [{ permission: "warehouses.manage" }],
      params: { no: purchaseRequestRef(ref.id), project: p.name, count: input.items.length },
      link: `/contractor/projects/${input.projectId}?tab=purchaseRequests`,
    })
  return ref.id
}

/** Approves or rejects it; an approval tells the buyers it is theirs now. */
export async function decideProjectRequest(
  firestore: Firestore,
  actor: Actor,
  input: { projectId: string; requestId: string; approve: boolean; count: number }
): Promise<void> {
  await updateDoc(doc(firestore, "projects", input.projectId, "purchaseRequests", input.requestId), {
    status: input.approve ? "approved" : "rejected",
    decidedByUserId: actor.uid,
    decidedByUserName: actor.name,
    decidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  if (!input.approve || input.count === 0) return
  const p = await projectFacts(firestore, input.projectId)
  if (p.orgId)
    await emitProcEvent(firestore, actor, {
      kind: "need_approved",
      organizationId: p.orgId,
      to: [{ permission: "rfq.manage" }, { permission: "rfq.create" }],
      params: { no: purchaseRequestRef(input.requestId), project: p.name, count: input.count },
      link: "/contractor/rfqs/requests",
    })
}
