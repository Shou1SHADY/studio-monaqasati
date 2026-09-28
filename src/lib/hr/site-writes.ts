// HR 1.0 — workplace writes (WF-01 step 3). The HR manager keeps the list of
// places; a place is deactivated, never deleted (people and months point at it).

import { addDoc, collection, doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore"
import type { HrContext } from "./access"
import { HR_SITES } from "./collections"
import { siteBlocks, type SiteType } from "./sites"
import { assertHr, HrWriteError } from "./write-guard"

export interface SiteInput {
  name: string
  type: SiteType
  projectId?: string | null
  endDate?: string | null
  supervisorEmployeeId?: string | null
  supervisorUserId?: string | null
}

export async function saveSite(firestore: Firestore, ctx: HrContext, orgId: string, input: SiteInput, id?: string | null): Promise<string> {
  assertHr(ctx, "settings.manage")
  const blocks = siteBlocks(input)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const data = {
    name: input.name.trim(),
    type: input.type,
    projectId: input.type === "project" ? input.projectId ?? null : null,
    endDate: input.endDate || null,
    supervisorEmployeeId: input.supervisorEmployeeId ?? null,
    supervisorUserId: input.supervisorUserId ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: ctx.uid,
  }
  if (id) {
    await updateDoc(doc(firestore, HR_SITES, id), data)
    return id
  }
  const ref = await addDoc(collection(firestore, HR_SITES), { ...data, organizationId: orgId, active: true, createdAt: serverTimestamp() })
  return ref.id
}

export async function setSiteActive(firestore: Firestore, ctx: HrContext, id: string, active: boolean): Promise<void> {
  assertHr(ctx, "settings.manage")
  await updateDoc(doc(firestore, HR_SITES, id), { active, updatedAt: serverTimestamp(), updatedBy: ctx.uid })
}
