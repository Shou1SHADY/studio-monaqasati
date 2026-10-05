// HR — government platforms, the writes (GV-02…05, PY-08). A platform act is done on the platform and
// recorded here once — `done` under the task's key, with its reference and a line in the person's log; a task
// owned by another record closes there (a renewal on the documents, an exit's tasks, the injury report, the
// exit re-entry on the leave). A reconciliation is saved with who differs (never a value), its tasks, and the
// values taken from the platform when asked (Muqeem's iqama date by government relations or the HR manager;
// Qiwa's documented basic — a pay figure — by the HR manager only). The pre-Mudad justifications and the
// month's Mudad status ride the payroll, by payroll or the HR manager. The guard runs first, every time.

import { collection, doc, runTransaction, serverTimestamp, setDoc, writeBatch, type Firestore } from "firebase/firestore"
import { hrAllowed, type HrContext } from "./access"
import { HR_EMPLOYEES, HR_PAY, HR_PAYROLLS } from "./collections"
import { HR_LOG, type HrActor } from "./employee-writes"
import type { HrEmployee } from "./employee"
import { payrollId, type Payroll } from "./payroll"
import { govDocId, HR_GOV, reconTasks, taskKey, WAGE_RECON, type GovDoc, type MudadStatus, type PlatformTask, type ReconDiff, type ReconPlatform } from "./platforms"
import type { HrSettings } from "./settings"
import { saveHrSettings } from "./settings-writes"
import { assertHr, HrWriteError } from "./write-guard"

const stamp = (a: HrActor) => ({ by: a.uid, byName: a.name, at: new Date().toISOString() })

function logLine(firestore: Firestore, employeeId: string, orgId: string, actor: HrActor, kind: string, params: Record<string, string | number | null>) {
  return { ref: doc(collection(firestore, HR_EMPLOYEES, employeeId, HR_LOG)), data: { organizationId: orgId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind, params, source: "hr" } }
}

/** «سجّل أنه تمّ» — the act was done on the platform: recorded once, with its optional reference. */
export async function recordPlatformDone(firestore: Firestore, ctx: HrContext, orgId: string, actor: HrActor, task: Pick<PlatformTask, "key" | "pf" | "code" | "employeeId" | "action">, input: { ref?: string | null }): Promise<void> {
  assertHr(ctx, "platform.tasks")
  if (task.action.kind !== "done") throw new HrWriteError("blocked", ["stale"])
  const ref = (input.ref ?? "").trim() || null
  const docRef = doc(firestore, HR_GOV, govDocId(orgId, task.key))
  await runTransaction(firestore, async (tx) => {
    const cur = await tx.get(docRef)
    if (cur.exists()) throw new HrWriteError("blocked", ["stale"])
    tx.set(docRef, { organizationId: orgId, kind: "done", key: task.key, pf: task.pf, code: task.code, employeeId: task.employeeId, ref, ...stamp(actor), updatedAt: serverTimestamp() })
    if (task.employeeId) {
      const l = logLine(firestore, task.employeeId, orgId, actor, "platform_done", { pf: task.pf, task: task.code, ref: ref ?? "—" })
      tx.set(l.ref, l.data)
    }
  })
}

/** A pay change asks Qiwa for the contract's new basic (GV-02): a task, named by the change's effective day —
 * no amount. Written beside the change (best effort: the pay change stands whatever happens here). */
export async function recordQiwaPayTask(firestore: Firestore, orgId: string, actor: HrActor, employeeId: string, on: string): Promise<void> {
  const key = taskKey("qiwa", "pay", employeeId, on)
  await setDoc(doc(firestore, HR_GOV, govDocId(orgId, key)), { organizationId: orgId, kind: "task", key, pf: "qiwa", code: "pay", employeeId, on, ...stamp(actor), updatedAt: serverTimestamp() }).catch((err) => console.error("qiwa pay task", err))
}

export interface ReconSave {
  pf: ReconPlatform
  diffs: ReconDiff[]
  n: number
  matched: number
  /** Take the platform's value into the record (Muqeem, Qiwa), or make a wage task per difference (GOSI). */
  take: boolean
}

/** GV-04 — a reconciliation is saved: the summary (who differs, never a value), its tasks, and the values taken. */
export async function saveReconciliation(firestore: Firestore, ctx: HrContext, orgId: string, actor: HrActor, save: ReconSave, w: { employees: HrEmployee[]; docs: GovDoc[]; today: string }): Promise<{ tasks: number; taken: number }> {
  assertHr(ctx, "platform.tasks")
  const wage = WAGE_RECON.has(save.pf)
  // A wage is compared (and so taken) only by a pay role; Qiwa's documented basic is the HR manager's to write.
  if (wage && save.diffs.some((d) => d.k === "diff") && !hrAllowed(ctx, "pay.view")) throw new HrWriteError("no_role")
  if (save.take && save.pf === "qiwa" && !hrAllowed(ctx, "pay.change")) throw new HrWriteError("no_role")
  const done = new Set(w.docs.filter((d) => d.kind === "done").map((d) => d.key))
  const open = new Set(w.docs.filter((d) => d.kind === "task" && !done.has(d.key)).map((d) => d.key))
  const tasks = reconTasks(save.pf, save.diffs, w.employees, w.today, { wageTasks: save.take && save.pf === "gosi", open })
  const batch = writeBatch(firestore)
  const now = stamp(actor)
  const reconKey = `recon:${save.pf}`
  batch.set(doc(firestore, HR_GOV, govDocId(orgId, reconKey)), {
    organizationId: orgId,
    kind: "recon",
    key: reconKey,
    pf: save.pf,
    n: save.n,
    matched: save.matched,
    diff: save.diffs.length,
    rows: save.diffs.map((d) => ({ k: d.k, employeeId: d.employeeId, no: d.no })),
    ...now,
    updatedAt: serverTimestamp(),
  })
  for (const x of tasks) batch.set(doc(firestore, HR_GOV, govDocId(orgId, x.key)), { organizationId: orgId, kind: "task", key: x.key, pf: save.pf, code: x.code, employeeId: x.employeeId, due: x.due, ...now, updatedAt: serverTimestamp() })
  let taken = 0
  if (save.take)
    for (const d of save.diffs) {
      if (d.k !== "diff" || !d.employeeId || d.theirs == null) continue
      if (save.pf === "muqeem" && typeof d.theirs === "string") {
        const e = w.employees.find((x) => x.id === d.employeeId)
        if (!e) continue
        batch.update(doc(firestore, HR_EMPLOYEES, d.employeeId), { docs: { ...(e.docs ?? {}), iqama: d.theirs }, updatedAt: serverTimestamp() })
        const l = logLine(firestore, d.employeeId, orgId, actor, "iqama_from_muqeem", { to: d.theirs })
        batch.set(l.ref, l.data)
        taken++
      } else if (save.pf === "qiwa" && typeof d.theirs === "number") {
        batch.update(doc(firestore, HR_PAY, d.employeeId), { qiwaBasic: d.theirs, qiwaAt: now.at, updatedAt: serverTimestamp() })
        taken++
      }
    }
  await batch.commit()
  return { tasks: tasks.length, taken }
}

/** GV-03 — a platform switched on or off (the HR manager, as every setting; logged with the settings). */
export async function setPlatformSwitch(firestore: Firestore, ctx: HrContext, orgId: string, settings: HrSettings, pf: string, on: boolean, actor: HrActor): Promise<void> {
  assertHr(ctx, "settings.manage")
  await saveHrSettings(firestore, ctx, orgId, { ...settings, platforms: { ...(settings.platforms ?? {}), [pf]: on } }, { name: actor.name })
}

/** PY-08 — a finding justified once, on the main payroll (payroll or the HR manager). */
export async function justifyMudadFinding(firestore: Firestore, ctx: HrContext, orgId: string, actor: HrActor, payrollKey: string, findingKey: string, why: string): Promise<void> {
  assertHr(ctx, "payroll.prepare")
  const text = why.trim()
  if (!text) throw new HrWriteError("blocked", ["no_reason"])
  if (!/^[A-Za-z0-9_-]+$/.test(findingKey)) throw new HrWriteError("blocked", ["stale"])
  const ref = doc(firestore, HR_PAYROLLS, payrollId(orgId, payrollKey))
  await runTransaction(firestore, async (tx) => {
    const s = await tx.get(ref)
    if (!s.exists() || (s.data() as Payroll).kind !== "main") throw new HrWriteError("missing")
    const p = s.data() as Payroll & { just?: Record<string, unknown> | null }
    if (p.just?.[findingKey]) throw new HrWriteError("blocked", ["stale"])
    tx.update(ref, { [`just.${findingKey}`]: { why: text, ...stamp(actor) }, updatedAt: serverTimestamp() })
  })
}

export const mudadStatusBlocks = (input: { pct: number | null }) => (input.pct != null && (!Number.isFinite(input.pct) || input.pct < 0 || input.pct > 100) ? ["bad_pct"] : [])

/** GV-05 — the month's status on Mudad, recorded after the upload (we read nothing from Mudad): once, on a paid
 * main payroll, by payroll or the HR manager. */
export async function recordMudadStatus(firestore: Firestore, ctx: HrContext, orgId: string, actor: HrActor, payrollKey: string, input: { pct: number | null; note: string | null }): Promise<void> {
  assertHr(ctx, "payroll.prepare")
  const blocks = mudadStatusBlocks(input)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const ref = doc(firestore, HR_PAYROLLS, payrollId(orgId, payrollKey))
  await runTransaction(firestore, async (tx) => {
    const s = await tx.get(ref)
    if (!s.exists()) throw new HrWriteError("missing")
    const p = s.data() as Payroll & { mudad?: MudadStatus | null }
    if (p.kind !== "main" || p.state !== "paid" || p.mudad) throw new HrWriteError("blocked", ["stale"])
    const mudad: MudadStatus = { pct: input.pct, note: input.note?.trim() || null, ...stamp(actor) }
    tx.update(ref, { mudad, updatedAt: serverTimestamp() })
  })
}
