// HR 1.0 — workplace writes (WF-01 step 3). The HR manager keeps the list of
// places; a place is deactivated, never deleted (people and months point at it).

import { addDoc, collection, doc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where, type Firestore, type Transaction } from "firebase/firestore"
import type { HrContext } from "./access"
import { HR_EMPLOYEES, HR_SITES } from "./collections"
import { assignBlocks, type HrEmployee } from "./employee"
import { HR_LOG, type HrActor } from "./employee-writes"
import { todayDay } from "./format"
import { assignFixBlocks, HR_ASSIGN_FIXES, siteBlocks, UNASSIGNED_SITE, type AssignFix, type HrSite, type SiteType } from "./sites"
import { emitHrNotice, hrLinks } from "./notify"
import { assertHr, HrWriteError } from "./write-guard"

/** A workplace's name as the record holds it — read for a notice; the unassigned has none. */
async function siteNameIn(tx: Transaction, firestore: Firestore, siteId: string): Promise<string> {
  if (siteId === UNASSIGNED_SITE) return ""
  const s = await tx.get(doc(firestore, HR_SITES, siteId))
  return s.exists() ? ((s.data() as Partial<HrSite>).name ?? "") : ""
}

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

/** "A worker here but not on my list" — by the site's supervisor (or the HR manager). */
export async function raiseAssignFix(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  actor: HrActor,
  input: { employeeId: string; siteId: string; since: string; note?: string | null },
  opts: { today?: string } = {}
): Promise<string> {
  assertHr(ctx, "assignment.correct", { site: input.siteId })
  const today = opts.today ?? todayDay()
  // One open correction per person — read before (a transaction cannot query; the HR manager sees both if two race).
  const open = await getDocs(query(collection(firestore, HR_ASSIGN_FIXES), where("organizationId", "==", orgId), where("employeeId", "==", input.employeeId), where("state", "==", "pending")))
  const ref = doc(collection(firestore, HR_ASSIGN_FIXES))
  let raised: (Omit<AssignFix, "id"> & { siteName: string }) | null = null
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(doc(firestore, HR_EMPLOYEES, input.employeeId))
    if (!snap.exists()) throw new HrWriteError("missing")
    const emp = snap.data() as Omit<HrEmployee, "id">
    if (emp.organizationId !== orgId) throw new HrWriteError("missing")
    const blocks = assignFixBlocks(emp, input.siteId, input.since, today, !open.empty)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const siteName = await siteNameIn(tx, firestore, input.siteId)
    const fix: Omit<AssignFix, "id"> = {
      organizationId: orgId,
      employeeId: input.employeeId,
      employeeName: emp.names?.ar ?? "",
      fromSiteId: emp.siteId ?? null,
      siteId: input.siteId,
      since: input.since,
      note: input.note?.trim() || null,
      by: actor.uid,
      byName: actor.name,
      at: new Date().toISOString(),
      state: "pending",
      decision: null,
    }
    tx.set(ref, { ...fix, updatedAt: serverTimestamp() })
    raised = { ...fix, siteName }
  })
  // AS-03 — the HR manager decides it.
  const f = raised as (Omit<AssignFix, "id"> & { siteName: string }) | null
  if (f)
    await emitHrNotice(firestore, actor, {
      kind: "hr_assign_fix_raised",
      organizationId: orgId,
      to: [{ hr: "manager" }],
      params: { name: f.employeeName, site: f.siteName, since: f.since },
      link: hrLinks.site(f.siteId),
      once: ref.id,
      employeeId: f.employeeId,
    })
  return ref.id
}

/** The HR manager corrects the assignment from the day named — the move's usual blocks apply (an
 * expired iqama never goes to a site) — or declines with a reason. */
export async function decideAssignFix(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, verdict: "approve" | "decline", note: string, opts: { today?: string } = {}): Promise<void> {
  assertHr(ctx, "employee.assign")
  const today = opts.today ?? todayDay()
  let decided: (AssignFix & { siteName: string; done: boolean }) | null = null
  await runTransaction(firestore, async (tx) => {
    const fRef = doc(firestore, HR_ASSIGN_FIXES, id)
    const fs = await tx.get(fRef)
    if (!fs.exists()) throw new HrWriteError("missing")
    const fix = fs.data() as AssignFix
    if (fix.state !== "pending") throw new HrWriteError("blocked", ["stale"])
    const siteName = await siteNameIn(tx, firestore, fix.siteId)
    const decision = { by: actor.uid, byName: actor.name, at: new Date().toISOString(), note: note.trim() || null }
    if (verdict === "decline") {
      if (!note.trim()) throw new HrWriteError("blocked", ["no_reason"])
      tx.update(fRef, { state: "declined", decision, updatedAt: serverTimestamp() })
      decided = { ...fix, id, siteName, done: false }
      return
    }
    const eRef = doc(firestore, HR_EMPLOYEES, fix.employeeId)
    const es = await tx.get(eRef)
    if (!es.exists()) throw new HrWriteError("missing")
    const emp = { id: es.id, ...(es.data() as Omit<HrEmployee, "id">) }
    const to = fix.siteId === UNASSIGNED_SITE ? null : fix.siteId
    const blocks = assignBlocks(emp, to, fix.since, today)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    tx.update(eRef, { siteId: to, updatedAt: serverTimestamp() })
    tx.update(fRef, { state: "done", decision, updatedAt: serverTimestamp() })
    tx.set(doc(collection(firestore, HR_EMPLOYEES, emp.id, HR_LOG)), {
      organizationId: emp.organizationId,
      at: new Date().toISOString(),
      by: actor.uid,
      byName: actor.name,
      kind: "moved",
      params: { from: emp.siteId ?? UNASSIGNED_SITE, to: to ?? UNASSIGNED_SITE, on: fix.since },
      source: "hr",
    })
    decided = { ...fix, id, siteName, done: true }
  })
  // The supervisor who raised it hears the answer on his workplace.
  const f = decided as (AssignFix & { siteName: string; done: boolean }) | null
  if (f)
    await emitHrNotice(firestore, actor, {
      kind: "hr_assign_fix_decided",
      organizationId: f.organizationId,
      to: [{ users: [f.by] }],
      params: { name: f.employeeName, site: f.siteName, verdict: f.done ? "@hr_verdict.done" : "@hr_verdict.refused", note: note.trim() },
      link: hrLinks.site(f.siteId),
      once: id,
      employeeId: f.employeeId,
    })
}

export async function setSiteActive(firestore: Firestore, ctx: HrContext, id: string, active: boolean): Promise<void> {
  assertHr(ctx, "settings.manage")
  await updateDoc(doc(firestore, HR_SITES, id), { active, updatedAt: serverTimestamp(), updatedBy: ctx.uid })
}
