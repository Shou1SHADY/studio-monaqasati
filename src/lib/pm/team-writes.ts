// PM 1.0 — team writes (WF-24, TM-01, RL-05, RL-07). Each is one transaction
// over the project and the seat: the guard runs first with what it just read
// (archived, and whether the project has a manager), the block rules run again,
// and the log entry is written with the change. A seat is never deleted — an
// exit closes it, and the person's records stay in their name.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { mayManageTeam, PmAccessError, seatActive, seatFromMember, type PmContext, type PmDuty, type PmProjectRole } from "./access"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"
import { assignBlocks, cleanDuties, PM_HANDED_OVER, removeBlocks, replacedManager, type SeatLogEntry } from "./team"

export class PmTeamError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmTeamError"
  }
}

export interface TeamActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; pm?: unknown; status?: string; projectManagerId?: string | null }

const refusal = (ctx: PmContext, touchesPm: boolean) => new PmAccessError(ctx.archived ? "archived" : touchesPm ? "owner_only" : "no_duty", touchesPm ? "team.pm" : "team.manage")

async function readBoth(tx: Parameters<Parameters<typeof runTransaction>[1]>[0], firestore: Firestore, projectId: string, uid: string) {
  const pRef = doc(firestore, "projects", projectId)
  const mRef = doc(firestore, "projects", projectId, "members", uid)
  const p = await tx.get(pRef)
  if (!p.exists()) throw new PmTeamError("missing")
  const project = p.data() as ProjectData
  if (!project.pm) throw new PmTeamError("not_pm_project")
  const m = await tx.get(mRef)
  const member = m.exists() ? (m.data() as Record<string, unknown>) : null
  return { pRef, mRef, project, member }
}

export interface AssignInput {
  uid: string
  name: string | null
  role: PmProjectRole
  roleName?: string | null
  off: PmDuty[]
  /** The member's default group, copied onto the seat so the older per-project
   * permission checks read the same group as before. */
  groupId: string | null
  /** The seat's first day (a new seat) — today or earlier; defaults to today. */
  from?: string | null
}

/** Seat someone, or change the role/duties of a live seat. Appointing the
 * project manager — or moving them off that role — is the owner's alone, and
 * the project names its manager in the same write (INV-11: at most one). A new
 * manager where there is one closes the outgoing manager's seat in the same
 * transaction, dated the new seat's first day, «handed over to another manager». */
export async function assignSeat(firestore: Firestore, ctx: PmContext, projectId: string, actor: TeamActor, input: AssignInput): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { pRef, mRef, project, member } = await readBoth(tx, firestore, projectId, input.uid)
    const today = todayDay()
    const outgoing = replacedManager({ uid: input.uid, role: input.role, projectManagerId: project.projectManagerId })
    const oRef = outgoing ? doc(firestore, "projects", projectId, "members", outgoing) : null
    const oSnap = oRef ? await tx.get(oRef) : null
    const seat = seatFromMember(member, input.uid)
    const current = seat && seatActive(seat, today) ? seat : null
    const touchesPm = input.role === "pm" || current?.role === "pm"
    const fresh = withFreshState(ctx, project)
    if (!mayManageTeam(fresh, touchesPm)) throw refusal(fresh, touchesPm)
    const from = (input.from ?? "").slice(0, 10) || today
    const blocks = assignBlocks({ uid: input.uid, role: input.role, roleName: input.roleName, current, projectManagerId: project.projectManagerId, admin: fresh.ceiling.has("admin"), from: current ? null : from, today })
    if (blocks.length) throw new PmTeamError("blocked", blocks)
    if (oRef && oSnap?.exists()) {
      const o = oSnap.data() as Record<string, unknown>
      const oSeat = seatFromMember(o, outgoing as string)
      if (oSeat && seatActive(oSeat, today)) {
        const out: SeatLogEntry = { at: new Date().toISOString(), by: actor.uid, byName: actor.name, act: "remove", to: from, why: PM_HANDED_OVER }
        tx.update(oRef, { to: from, why: PM_HANDED_OVER, byOut: actor.uid, log: [...((o.log as SeatLogEntry[] | undefined) ?? []), out], updatedAt: serverTimestamp() })
      }
    }

    const off = cleanDuties(input.off)
    const entry: SeatLogEntry = { at: new Date().toISOString(), by: actor.uid, byName: actor.name, act: current ? "duties" : "assign", role: input.role, off }
    const log = [...((member?.log as SeatLogEntry[] | undefined) ?? []), entry]
    const roleName = input.role === "other" ? input.roleName?.trim() ?? null : null
    if (current) {
      tx.update(mRef, { pmRole: input.role, roleName, off, log, updatedAt: serverTimestamp() })
    } else {
      tx.set(mRef, {
        userId: input.uid,
        groupId: input.groupId,
        organizationId: project.organizationId ?? null,
        addedBy: actor.uid,
        pmRole: input.role,
        roleName,
        off,
        from,
        to: null,
        why: null,
        byOut: null,
        log,
        createdAt: member?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
    if (input.role === "pm") tx.update(pRef, { projectManagerId: input.uid, projectManagerName: input.name, updatedAt: serverTimestamp() })
    else if (current?.role === "pm") tx.update(pRef, { projectManagerId: null, projectManagerName: null, updatedAt: serverTimestamp() })
  })
}

/** Close a seat: a stated reason and an exit date of today or earlier. Access
 * ends at once; removing the project manager is the owner's, and leaves the
 * project managerless — only the owner approves until another is appointed. */
export async function removeSeat(firestore: Firestore, ctx: PmContext, projectId: string, actor: TeamActor, uid: string, input: { exitDate: string; reason: string }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { pRef, mRef, project, member } = await readBoth(tx, firestore, projectId, uid)
    const today = todayDay()
    const seat = seatFromMember(member, uid)
    const touchesPm = seat?.role === "pm"
    const fresh = withFreshState(ctx, project)
    if (!mayManageTeam(fresh, touchesPm)) throw refusal(fresh, touchesPm)
    const blocks = removeBlocks({ seat, exitDate: input.exitDate, reason: input.reason, today, admin: fresh.ceiling.has("admin") })
    if (blocks.length) throw new PmTeamError("blocked", blocks)

    const why = input.reason.trim()
    const entry: SeatLogEntry = { at: new Date().toISOString(), by: actor.uid, byName: actor.name, act: "remove", to: input.exitDate, why }
    tx.update(mRef, { to: input.exitDate, why, byOut: actor.uid, log: [...((member?.log as SeatLogEntry[] | undefined) ?? []), entry], updatedAt: serverTimestamp() })
    if (touchesPm && project.projectManagerId === uid) tx.update(pRef, { projectManagerId: null, projectManagerName: null, updatedAt: serverTimestamp() })
  })
}
