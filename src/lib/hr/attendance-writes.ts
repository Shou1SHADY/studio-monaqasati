// HR 1.0 — attendance writes (WF-04, WF-05; AT-01, AT-03, AT-04). Each is one
// transaction: the guard first, then the blocks again against the stored
// month — a month closed a second ago refuses the sheet that was open on
// screen. The rules repeat the role and the "never reopens".

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { hrAllowed, type HrContext } from "./access"
import {
  assumesPresence,
  attendanceId,
  closeBlocks,
  compactExceptions,
  declareBlocks,
  missingDays,
  monthOf,
  sheetBlocks,
  type AttendanceException,
  type DaySheet,
  type Declaration,
  type WorkplaceMonth,
} from "./attendance"
import { HR_ATTENDANCE } from "./collections"
import type { HrActor } from "./employee-writes"
import type { Holiday } from "./leave"
import type { SiteType } from "./sites"
import { assertHr, HrWriteError } from "./write-guard"

const localToday = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export interface SiteRef {
  id: string
  type: SiteType | null
}

type Opts = { today?: string; holidays?: Holiday[] }

function base(orgId: string, site: SiteRef, month: string) {
  return { organizationId: orgId, siteId: site.id, month, days: {}, declarations: [], closed: null }
}

/** The supervisor sheet for one day (AT-01): everyone listed is present unless an exception says otherwise. */
export async function recordDay(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  site: SiteRef,
  day: string,
  actor: HrActor,
  input: { listed: string[]; ex: Record<string, AttendanceException>; unlisted?: Array<{ name: string; note?: string | null }> },
  opts: Opts = {}
): Promise<void> {
  assertHr(ctx, "attendance.record", { site: site.id })
  const today = opts.today ?? localToday()
  const month = monthOf(day)
  const ex = compactExceptions(input.ex)
  const ref = doc(firestore, HR_ATTENDANCE, attendanceId(orgId, site.id, month))
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const wm = snap.exists() ? (snap.data() as WorkplaceMonth) : null
    const blocks = sheetBlocks({ day, today, closed: Boolean(wm?.closed), listed: input.listed, ex, mayRecordViolation: hrAllowed(ctx, "violation.record", { site: site.id }) })
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const sheet: DaySheet = {
      by: actor.uid,
      byName: actor.name,
      at: new Date().toISOString(),
      listed: [...new Set(input.listed)],
      ex,
      unlisted: (input.unlisted ?? []).filter((u) => u.name.trim()).map((u) => ({ name: u.name.trim(), note: u.note?.trim() || null })),
    }
    if (!wm) tx.set(ref, { ...base(orgId, site, month), days: { [day]: sheet }, updatedAt: serverTimestamp() })
    else tx.update(ref, { [`days.${day}`]: sheet, updatedAt: serverTimestamp() })
  })
}

/** Days nobody recorded, filled by a named declaration kept on record (AT-04) — supervisor or HR manager only. */
export async function declareMissing(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  site: SiteRef,
  month: string,
  actor: HrActor,
  input: { days: string[]; note: string; employees: string[] },
  opts: Opts = {}
): Promise<void> {
  assertHr(ctx, "attendance.declare", { site: site.id })
  const today = opts.today ?? localToday()
  const ref = doc(firestore, HR_ATTENDANCE, attendanceId(orgId, site.id, month))
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const wm = snap.exists() ? (snap.data() as WorkplaceMonth) : null
    const missing = missingDays(wm, month, today, { assumed: assumesPresence(site.id, site.type), holidays: opts.holidays })
    const blocks = declareBlocks({ days: input.days, note: input.note, missing, closed: Boolean(wm?.closed) })
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const entry: Declaration = { days: [...input.days].sort(), employees: [...new Set(input.employees)], by: actor.uid, byName: actor.name, at: new Date().toISOString(), note: input.note.trim() }
    const declarations = [...(wm?.declarations ?? []), entry]
    if (!wm) tx.set(ref, { ...base(orgId, site, month), declarations, updatedAt: serverTimestamp() })
    else tx.update(ref, { declarations, updatedAt: serverTimestamp() })
  })
}

/** Close a workplace's month (AT-03) — after it ends, never reopened. Under the warn
 * policy it may close "as is"; the unrecorded days are kept on the closing. */
export async function closeMonth(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  site: SiteRef,
  month: string,
  actor: HrActor,
  policy: "block" | "warn",
  opts: Opts = {}
): Promise<{ asIs: boolean }> {
  assertHr(ctx, "attendance.close", { site: site.id })
  const today = opts.today ?? localToday()
  const ref = doc(firestore, HR_ATTENDANCE, attendanceId(orgId, site.id, month))
  let asIs = false
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const wm = snap.exists() ? (snap.data() as WorkplaceMonth) : null
    const missing = missingDays(wm, month, today, { assumed: assumesPresence(site.id, site.type), holidays: opts.holidays })
    const { blocks } = closeBlocks({ month, today, closed: Boolean(wm?.closed), missing, policy })
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    asIs = missing.length > 0
    const closed = { by: actor.uid, byName: actor.name, at: new Date().toISOString(), asIs, missing }
    if (!wm) tx.set(ref, { ...base(orgId, site, month), closed, updatedAt: serverTimestamp() })
    else tx.update(ref, { closed, updatedAt: serverTimestamp() })
  })
  return { asIs }
}
