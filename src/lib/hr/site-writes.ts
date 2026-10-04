// HR 1.0 — workplace writes (WF-01 step 3). The HR manager keeps the list of
// places; a place is deactivated, never deleted (people and months point at it).

import { addDoc, collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, type Firestore } from "firebase/firestore"
import { hrPeopleScope, type HrContext } from "./access"
import { HR_EMPLOYEES, HR_SITES } from "./collections"
import { assignBlocks, type HrEmployee } from "./employee"
import { HR_LOG, type HrActor } from "./employee-writes"
import { todayDay } from "./format"
import { assignFixBlocks, HR_ASSIGN_FIXES, siteBlocks, UNASSIGNED_SITE, type AssignFix, type AssignFixBlock, type SiteType } from "./sites"
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

// ---------------------------------------------------------------------------
// Assignment correction (AS-03): the supervisor raises, the HR manager corrects
// ---------------------------------------------------------------------------

/** Who the correction is about: the record itself (a viewer who reads the company's people), or — for a
 * supervisor, who reads only his own workplaces' records (RL-01) — the worker's ID number and his name as he
 * gives it; the HR manager's decision resolves the number to the record. */
export type AssignFixWho = { employeeId: string } | { idNo: string; name: string }

/** "A worker here but not on my list" — by the site's supervisor (or the HR manager). */
export async function raiseAssignFix(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  actor: HrActor,
  input: AssignFixWho & { siteId: string; since: string; note?: string | null },
  opts: { today?: string } = {}
): Promise<string> {
  assertHr(ctx, "assignment.correct", { site: input.siteId })
  const today = opts.today ?? todayDay()
  const ref = doc(collection(firestore, HR_ASSIGN_FIXES))
  const base = { organizationId: orgId, siteId: input.siteId, since: input.since, note: input.note?.trim() || null, by: actor.uid, byName: actor.name, at: new Date().toISOString(), state: "pending" as const, decision: null }
  if (!("employeeId" in input)) {
    // By ID number: nothing of the record is read here. One open correction per number on this site — read
    // before, on this site only (all a supervisor may list); the HR manager sees both if two race.
    const idNo = input.idNo.replace(/\s+/g, "")
    const blocks: AssignFixBlock[] = [...(idNo ? [] : ["no_id" as const]), ...(input.name.trim() ? [] : ["no_name" as const]), ...assignFixBlocks({ siteId: null, status: "active" }, input.siteId, input.since || null, today, false)]
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const open = await getDocs(query(collection(firestore, HR_ASSIGN_FIXES), where("organizationId", "==", orgId), where("siteId", "==", input.siteId), where("idNo", "==", idNo), where("state", "==", "pending")))
    if (!open.empty) throw new HrWriteError("blocked", ["pending"])
    const fix: Omit<AssignFix, "id"> = { ...base, employeeId: null, idNo, employeeName: input.name.trim(), fromSiteId: null }
    await setDoc(ref, { ...fix, updatedAt: serverTimestamp() })
    return ref.id
  }
  // A supervisor reads no record outside his workplaces (RL-01): he names the worker by ID number.
  if (hrPeopleScope(ctx) !== null) throw new HrWriteError("blocked", ["by_id"])
  // One open correction per person — read before (a transaction cannot query; the HR manager sees both if two race).
  const open = await getDocs(query(collection(firestore, HR_ASSIGN_FIXES), where("organizationId", "==", orgId), where("employeeId", "==", input.employeeId), where("state", "==", "pending")))
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(doc(firestore, HR_EMPLOYEES, input.employeeId))
    if (!snap.exists()) throw new HrWriteError("missing")
    const emp = snap.data() as Omit<HrEmployee, "id">
    if (emp.organizationId !== orgId) throw new HrWriteError("missing")
    const blocks = assignFixBlocks(emp, input.siteId, input.since, today, !open.empty)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const fix: Omit<AssignFix, "id"> = { ...base, employeeId: input.employeeId, idNo: emp.idNo ?? null, employeeName: emp.names?.ar ?? "", fromSiteId: emp.siteId ?? null }
    tx.set(ref, { ...fix, updatedAt: serverTimestamp() })
  })
  return ref.id
}

/** The one live record an ID number names in the company — or why not. */
async function recordByIdNo(firestore: Firestore, orgId: string, idNo: string): Promise<string> {
  const snap = await getDocs(query(collection(firestore, HR_EMPLOYEES), where("organizationId", "==", orgId), where("idNo", "==", idNo)))
  const hits = snap.docs.filter((d) => (d.data() as HrEmployee).status !== "left")
  if (hits.length !== 1) throw new HrWriteError("blocked", [hits.length ? "many_match" : "no_match"])
  return hits[0].id
}

/** The HR manager corrects the assignment from the day named — the move's usual blocks apply (an
 * expired iqama never goes to a site) — or declines with a reason. A correction raised by ID number is
 * resolved to its record here, and the record's name and place are written onto it. */
export async function decideAssignFix(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, verdict: "approve" | "decline", note: string, opts: { today?: string } = {}): Promise<void> {
  assertHr(ctx, "employee.assign")
  const today = opts.today ?? todayDay()
  const fRef = doc(firestore, HR_ASSIGN_FIXES, id)
  // A query cannot run inside a transaction: the number is resolved first, the record read again inside.
  let resolved: string | null = null
  if (verdict === "approve") {
    const pre = await getDoc(fRef)
    const f = pre.exists() ? (pre.data() as AssignFix) : null
    if (f && f.state === "pending" && !f.employeeId && f.idNo) resolved = await recordByIdNo(firestore, f.organizationId, f.idNo)
  }
  await runTransaction(firestore, async (tx) => {
    const fs = await tx.get(fRef)
    if (!fs.exists()) throw new HrWriteError("missing")
    const fix = fs.data() as AssignFix
    if (fix.state !== "pending") throw new HrWriteError("blocked", ["stale"])
    const decision = { by: actor.uid, byName: actor.name, at: new Date().toISOString(), note: note.trim() || null }
    if (verdict === "decline") {
      if (!note.trim()) throw new HrWriteError("blocked", ["no_reason"])
      tx.update(fRef, { state: "declined", decision, updatedAt: serverTimestamp() })
      return
    }
    const employeeId = fix.employeeId ?? resolved
    if (!employeeId) throw new HrWriteError("blocked", ["no_match"])
    const eRef = doc(firestore, HR_EMPLOYEES, employeeId)
    const es = await tx.get(eRef)
    if (!es.exists()) throw new HrWriteError("missing")
    const emp = { id: es.id, ...(es.data() as Omit<HrEmployee, "id">) }
    if (emp.organizationId !== fix.organizationId) throw new HrWriteError("missing")
    const to = fix.siteId === UNASSIGNED_SITE ? null : fix.siteId
    // Raised by number, where the record places him is first known here.
    const placed = fix.employeeId ? [] : assignFixBlocks(emp, fix.siteId, fix.since, today, false).filter((b) => b === "same_place" || b === "left")
    const blocks = [...placed, ...assignBlocks(emp, to, fix.since, today)]
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    tx.update(eRef, { siteId: to, updatedAt: serverTimestamp() })
    tx.update(fRef, {
      state: "done",
      decision,
      ...(fix.employeeId ? {} : { employeeId: emp.id, employeeName: emp.names?.ar || fix.employeeName, fromSiteId: emp.siteId ?? null }),
      updatedAt: serverTimestamp(),
    })
    tx.set(doc(collection(firestore, HR_EMPLOYEES, emp.id, HR_LOG)), {
      organizationId: emp.organizationId,
      at: new Date().toISOString(),
      by: actor.uid,
      byName: actor.name,
      kind: "moved",
      params: { from: emp.siteId ?? UNASSIGNED_SITE, to: to ?? UNASSIGNED_SITE, on: fix.since },
      source: "hr",
    })
  })
}

export async function setSiteActive(firestore: Firestore, ctx: HrContext, id: string, active: boolean): Promise<void> {
  assertHr(ctx, "settings.manage")
  await updateDoc(doc(firestore, HR_SITES, id), { active, updatedAt: serverTimestamp(), updatedBy: ctx.uid })
}
