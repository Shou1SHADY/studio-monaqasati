// HR 1.0 — work injuries (PRD DC-07, WF-15). The supervisor or the HR manager
// records the injury; GOSI must be told within three working days (Friday and
// Saturday do not count) — a decision on Today until government relations
// records the report number. Wages during treatment are GOSI's, not payroll's.

import { collection, doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import type { HrContext } from "./access"
import { HR_EMPLOYEES, HR_INJURIES } from "./collections"
import { injuryReportDue } from "./documents"
import type { HrEmployee } from "./employee"
import { HR_LOG, type HrActor } from "./employee-writes"
import { assertHr, HrWriteError } from "./write-guard"

export interface HrInjury {
  id: string
  organizationId: string
  employeeId: string
  employeeUserId: string | null
  employeeName: string
  siteId: string | null
  on: string
  description: string
  /** The GOSI report deadline — three working days. */
  due: string
  recorded: { by: string; byName: string | null; at: string }
  report?: { no: string; on: string; by: string; byName: string | null } | null
}

export type InjuryState = "due" | "overdue" | "reported"

export const injuryState = (i: Pick<HrInjury, "due" | "report">, today: string): InjuryState => (i.report ? "reported" : today > i.due ? "overdue" : "due")

const stamp = (a: HrActor) => ({ by: a.uid, byName: a.name, at: new Date().toISOString() })

export async function recordInjury(firestore: Firestore, ctx: HrContext, orgId: string, actor: HrActor, input: { employeeId: string; on: string; description: string }, opts: { today?: string } = {}): Promise<string> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  if (!input.on || input.on > today) throw new HrWriteError("blocked", ["future"])
  if (!input.description.trim()) throw new HrWriteError("blocked", ["no_description"])
  const ref = doc(collection(firestore, HR_INJURIES))
  await runTransaction(firestore, async (tx) => {
    const es = await tx.get(doc(firestore, HR_EMPLOYEES, input.employeeId))
    if (!es.exists()) throw new HrWriteError("missing")
    const emp = { id: es.id, ...(es.data() as Omit<HrEmployee, "id">) }
    assertHr(ctx, "injury.record", { site: emp.siteId })
    tx.set(ref, {
      organizationId: orgId,
      employeeId: emp.id,
      employeeUserId: emp.userId ?? null,
      employeeName: emp.names?.ar ?? "",
      siteId: emp.siteId ?? null,
      on: input.on,
      description: input.description.trim(),
      due: injuryReportDue(input.on),
      recorded: stamp(actor),
      report: null,
      updatedAt: serverTimestamp(),
    })
    tx.set(doc(collection(firestore, HR_EMPLOYEES, emp.id, HR_LOG)), { organizationId: orgId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind: "injury_recorded", params: { on: input.on }, source: "hr" })
  })
  return ref.id
}

/** Government relations records GOSI's report number (WF-15 step 3). */
export async function recordInjuryReport(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, input: { no: string; on: string }): Promise<void> {
  assertHr(ctx, "injury.report")
  if (!input.no.trim() || !input.on) throw new HrWriteError("blocked", ["no_report"])
  await runTransaction(firestore, async (tx) => {
    const s = await tx.get(doc(firestore, HR_INJURIES, id))
    if (!s.exists()) throw new HrWriteError("missing")
    if ((s.data() as HrInjury).report) throw new HrWriteError("blocked", ["stale"])
    tx.update(doc(firestore, HR_INJURIES, id), { report: { no: input.no.trim(), on: input.on, by: actor.uid, byName: actor.name }, updatedAt: serverTimestamp() })
  })
}
