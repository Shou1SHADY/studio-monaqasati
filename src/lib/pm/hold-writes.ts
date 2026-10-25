// PM 1.0 — suspending a live project and resuming it (PRD §7: live ⇄ hold; 1.1
// PRJ-02, WF-28). A suspension is a written decision: a reason from a list
// (client decision · redesign · permit or authority · our payments late · site
// not available · other, stated), the day it took effect (never in the future,
// never before the project started) and an optional note. A line opens in the
// suspension log under the suspender's name and closes on resume — or on final
// acceptance, which completes a suspended project too (HND-01) — with whoever
// ended it. The pm block keeps the current one (`holdSince`, `holdK`, `holdWhy`
// = the stated text for "other", `holdNote`, `holdBy`): the portfolio card shows
// «مؤجَّل منذ N يوماً — السبب», and the `hold` decision ages from that day
// (indirect costs keep running; only an approved extension moves the clock).
// Approve only (`project.suspend`); one transaction each, the guard first on the
// project just read.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { todayDay } from "./format"
import { canMove, lifecycleOf, type PmLifecycle } from "./lifecycle"
import { withFreshState } from "./project-writes"

export class PmHoldError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: HoldBlock[] = []) {
    super(code)
    this.name = "PmHoldError"
  }
}

/** Why a project is suspended — a closed list; "oth" is stated (RSN-01). */
export const HOLD_REASONS = ["client", "design", "permit", "pay", "site", "oth"] as const
export type HoldReason = (typeof HOLD_REASONS)[number]
export const isHoldReason = (v: unknown): v is HoldReason => (HOLD_REASONS as readonly unknown[]).includes(v)

export type HoldBlock = "archived" | "not_live" | "not_held" | "no_reason" | "reason_text" | "bad_day" | "before_start"

/** One suspension: from `since` to `until` (null while it lasts). `by` suspended it;
 * `resBy` ended it (a resume, or final acceptance). A line written before 1.1 has no
 * `k`: its `why` is free text and its `by` is who resumed it. */
export interface HoldEntry {
  since: string
  until: string | null
  k?: HoldReason | null
  why: string
  note?: string | null
  by: string
  byName?: string | null
  resBy?: string | null
  resByName?: string | null
  /** How it ended: resumed, or completed by final acceptance. */
  end?: "resume" | "final" | null
}

export function holdBlocks(input: {
  archived: boolean
  lifecycle: PmLifecycle
  to: "hold" | "live"
  k?: unknown
  text?: string | null
  since?: string | null
  /** The day the project started — a suspension never precedes it. */
  startOn?: string | null
  today: string
}): HoldBlock[] {
  const out: HoldBlock[] = []
  if (input.archived) out.push("archived")
  if (input.to === "hold") {
    if (!canMove(input.lifecycle, "hold")) out.push("not_live")
    if (!isHoldReason(input.k)) out.push("no_reason")
    else if (input.k === "oth" && !input.text?.trim()) out.push("reason_text")
    if (!input.since || !/^\d{4}-\d{2}-\d{2}$/.test(input.since) || input.since > input.today) out.push("bad_day")
    else if (input.startOn && input.since < input.startOn.slice(0, 10)) out.push("before_start")
  } else if (input.lifecycle !== "hold") out.push("not_held")
  return out
}

export type HoldPmBlock = {
  lifecycle?: string
  startedAt?: string | null
  startOn?: string | null
  holdSince?: string | null
  holdK?: HoldReason | null
  holdWhy?: string | null
  holdNote?: string | null
  holdBy?: string | null
  holdByName?: string | null
  holdLog?: HoldEntry[]
} & Record<string, unknown>
type ProjectData = { pm?: HoldPmBlock; status?: string; projectManagerId?: string | null }

export interface HoldActor {
  uid: string
  name: string | null
}

/** The pm block once the current suspension ends today (resume or final): its log
 * line closes with who ended it — a suspension opened before 1.1 is written whole. */
export function closeHold<T extends HoldPmBlock>(pm: T, actor: HoldActor, today: string, end: "resume" | "final"): T {
  const log = [...(pm.holdLog ?? [])]
  const open = log.map((e, i) => ({ e, i })).reverse().find(({ e }) => e.until == null)
  if (open) log[open.i] = { ...open.e, until: today, resBy: actor.uid, resByName: actor.name, end }
  else
    log.push({
      since: pm.holdSince ?? today,
      until: today,
      k: pm.holdK ?? null,
      why: pm.holdWhy ?? "",
      note: pm.holdNote ?? null,
      by: pm.holdBy ?? actor.uid,
      byName: pm.holdBy ? pm.holdByName ?? null : actor.name,
      resBy: actor.uid,
      resByName: actor.name,
      end,
    })
  return { ...pm, holdSince: null, holdK: null, holdWhy: null, holdNote: null, holdBy: null, holdByName: null, holdLog: log }
}

async function move(firestore: Firestore, ctx: PmContext, projectId: string, build: (data: ProjectData & { pm: HoldPmBlock }, fresh: PmContext) => Record<string, unknown>) {
  const ref = doc(firestore, "projects", projectId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmHoldError("missing")
    const data = snap.data() as ProjectData
    if (!data.pm) throw new PmHoldError("not_pm_project")
    const fresh = withFreshState(ctx, data)
    assertPm(fresh, "project.suspend")
    tx.update(ref, { ...build(data as ProjectData & { pm: HoldPmBlock }, fresh), updatedAt: serverTimestamp() })
  })
}

/** Suspend: live → hold, from the day it took effect, with the reason from the list. */
export async function holdProject(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: HoldActor,
  input: { k: HoldReason | null; text?: string | null; note?: string | null; since: string }
): Promise<void> {
  await move(firestore, ctx, projectId, (data, fresh) => {
    const startOn = data.pm.startedAt ?? data.pm.startOn ?? null
    const blocks = holdBlocks({ archived: fresh.archived, lifecycle: lifecycleOf(data), to: "hold", k: input.k, text: input.text, since: input.since, startOn, today: todayDay() })
    if (blocks.length) throw new PmHoldError("blocked", blocks)
    const k = input.k as HoldReason
    const why = k === "oth" ? (input.text ?? "").trim() : ""
    const note = input.note?.trim() || null
    const entry: HoldEntry = { since: input.since, until: null, k, why, note, by: actor.uid, byName: actor.name, resBy: null, resByName: null, end: null }
    return {
      pm: { ...data.pm, lifecycle: "hold", holdSince: input.since, holdK: k, holdWhy: why || null, holdNote: note, holdBy: actor.uid, holdByName: actor.name, holdLog: [...(data.pm.holdLog ?? []), entry] },
      status: "hold",
    }
  })
}

/** Resume: hold → live; the suspension's log line closes today under the resumer's name. */
export async function resumeProject(firestore: Firestore, ctx: PmContext, projectId: string, actor: HoldActor): Promise<void> {
  await move(firestore, ctx, projectId, (data, fresh) => {
    const blocks = holdBlocks({ archived: fresh.archived, lifecycle: lifecycleOf(data), to: "live", today: todayDay() })
    if (blocks.length) throw new PmHoldError("blocked", blocks)
    return { pm: { ...closeHold(data.pm, actor, todayDay(), "resume"), lifecycle: "live" }, status: "working" }
  })
}
