// HR 1.0 — the two projections My file reads (see me.ts): the employee's own
// attendance on his record, and the line of the last payroll approved for him
// on his pay. Each is written AFTER the business write it mirrors, best-effort
// and in chunks: a lost projection never undoes the sheet or the approval, and
// the next write of the same month puts it right. The rules let only the
// writers of the source touch them (the site's supervisor, payroll and the HR
// manager on `att`; the HR manager on `slip`).

import { deleteField, doc, serverTimestamp, writeBatch, type Firestore } from "firebase/firestore"
import { HR_EMPLOYEES, HR_PAY } from "./collections"
import { attendancePatches, slipOf, type MyAttendance, type MyMonth } from "./me"
import type { Payroll } from "./payroll"
import type { DaySheet, Declaration } from "./attendance"

const CHUNK = 400

async function commitChunks(firestore: Firestore, writes: Array<[string, string, Record<string, unknown>]>, what: string) {
  for (let i = 0; i < writes.length; i += CHUNK) {
    const batch = writeBatch(firestore)
    for (const [coll, id, data] of writes.slice(i, i + CHUNK)) batch.update(doc(firestore, coll, id), { ...data, updatedAt: serverTimestamp() })
    try {
      await batch.commit()
    } catch (err) {
      console.error(`${what} not projected:`, err)
    }
  }
}

/** After a sheet, a declaration, a closing or an approved correction: each named person's month (and today). */
export async function projectAttendance(
  firestore: Firestore,
  wm: { month: string; days?: Record<string, DaySheet> | null; declarations?: Declaration[] | null; closed?: unknown },
  employeeIds: readonly string[],
  opts: { day?: string | null; today: string }
): Promise<void> {
  const writes: Array<[string, string, Record<string, unknown>]> = []
  for (const [id, patch] of attendancePatches(wm, employeeIds, opts)) {
    const data: Record<string, MyMonth | MyAttendance["today"] | ReturnType<typeof deleteField>> = {}
    for (const [k, v] of Object.entries(patch)) data[k] = v === null ? deleteField() : v
    writes.push([HR_EMPLOYEES, id, data])
  }
  await commitChunks(firestore, writes, "Attendance")
}

/** Everyone a workplace month names: listed on a day or covered by a declaration. */
export function peopleOf(wm: { days?: Record<string, Pick<DaySheet, "listed">> | null; declarations?: Array<Pick<Declaration, "employees">> | null }): string[] {
  const s = new Set<string>()
  for (const d of Object.values(wm.days ?? {})) for (const id of d.listed ?? []) s.add(id)
  for (const d of wm.declarations ?? []) for (const id of d.employees ?? []) s.add(id)
  return [...s]
}

/** After a MAIN payroll is approved: each line on its employee's pay, so My file says "with Finance" (or
 * held, and why) until the payslip opens at payment. */
export async function projectSlips(firestore: Firestore, p: Pick<Payroll, "key" | "month" | "kind" | "lines">, approvedOn: string): Promise<void> {
  if (p.kind !== "main") return
  await commitChunks(
    firestore,
    p.lines.map((l) => [HR_PAY, l.employeeId, { slip: slipOf(p, l, approvedOn) }]),
    "Payslip states"
  )
}
