// PM 1.0 — punch-list writes (WF-17). Recorded by quality (`qa`), one
// transaction each with the guard first; the project numbers the items.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { cleanAttachments, type PmAttachment } from "./attachments"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"
import { PM_PUNCH, punchBlocks, punchNo, punchStepBlocks, type PunchItem, type PunchSeverity, type PunchSource } from "./punch"

export class PmPunchError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmPunchError"
  }
}

export interface PunchActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; punchCount?: number } & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmPunchError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmPunchError("not_pm_project")
  return { ref, project, pm: project.pm }
}

export interface RaiseInput {
  what: string
  location: string
  severity: PunchSeverity
  source: PunchSource
  sourceText?: string | null
  itemId?: string | null
  /** The day it was raised (defaults to today). */
  day?: string | null
  files?: PmAttachment[] | null
}

export async function raisePunch(firestore: Firestore, ctx: PmContext, projectId: string, actor: PunchActor, input: RaiseInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const today = todayDay()
    const blocks = punchBlocks({ archived: fresh.archived, what: input.what, location: input.location, source: input.source, sourceText: input.sourceText, day: input.day ?? today, today })
    if (blocks.length) throw new PmPunchError("blocked", blocks)
    seq = (pm.punchCount ?? 0) + 1
    const item: Omit<PunchItem, "id"> = {
      seq,
      what: input.what.trim(),
      location: input.location.trim(),
      severity: input.severity,
      source: input.source,
      sourceText: input.source === "oth" ? input.sourceText?.trim() ?? null : null,
      status: "open",
      day: input.day || today,
      by: actor.uid,
      byName: actor.name,
      itemId: input.itemId ?? null,
      files: cleanAttachments(input.files),
      fix: null,
      conf: null,
    }
    tx.set(doc(firestore, "projects", projectId, PM_PUNCH, punchNo(seq)), { ...item, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, punchCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

type StepCheck = Omit<Parameters<typeof punchStepBlocks>[0], "archived" | "status" | "step" | "after">

async function step(firestore: Firestore, ctx: PmContext, projectId: string, seq: number, which: "fix" | "confirm", check: StepCheck, patch: (item: PunchItem) => Record<string, unknown>) {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const ref = doc(firestore, "projects", projectId, PM_PUNCH, punchNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmPunchError("missing")
    const item = { id: snap.id, ...(snap.data() as Omit<PunchItem, "id">) }
    const blocks = punchStepBlocks({ archived: fresh.archived, status: item.status, step: which, ...check, after: which === "fix" ? item.day : item.fix?.on ?? item.day })
    if (blocks.length) throw new PmPunchError("blocked", blocks)
    tx.update(ref, { ...patch(item), updatedAt: serverTimestamp() })
  })
}

/** The fix is recorded: "fixed — awaiting confirmation", not closed (PN-02).
 * From the screen the note (what was done) is required; `on` is the fix day. */
export const recordFix = (firestore: Firestore, ctx: PmContext, projectId: string, actor: PunchActor, seq: number, note?: string | null, opts: { on?: string; files?: PmAttachment[] | null } = {}) => {
  const today = todayDay()
  return step(firestore, ctx, projectId, seq, "fix", { note: note === undefined ? undefined : note, day: opts.on ?? today, today }, () => ({
    status: "fix",
    fix: { on: opts.on || today, by: actor.uid, byName: actor.name, note: note?.trim() || null, files: cleanAttachments(opts.files) },
  }))
}

/** The confirmation is recorded: closed. Whoever confirmed is chosen at the
 * time (the raising party by default); "other" is stated. */
export const recordConfirmation = (
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: PunchActor,
  seq: number,
  opts: { on?: string; party?: PunchSource; partyText?: string | null; files?: PmAttachment[] | null } = {}
) => {
  const today = todayDay()
  return step(firestore, ctx, projectId, seq, "confirm", { day: opts.on ?? today, today, party: opts.party, partyText: opts.partyText }, (item) => {
    const party = opts.party ?? item.source
    return {
      status: "done",
      conf: {
        on: opts.on || today,
        by: actor.uid,
        byName: actor.name,
        party,
        partyText: party === "oth" ? (opts.party ? opts.partyText?.trim() : item.sourceText) ?? null : null,
        files: cleanAttachments(opts.files),
      },
    }
  })
}
