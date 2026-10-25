// PM 1.1 STK-11 on the server — answering a material moved in from another of
// the company's projects. The receiving project's `req` confirms it (it enters
// here, the sender's move closes, prj:XFER) or refuses it with the reason (both
// halves are marked refused and the material is back in the sender's balance).
// Never the person who sent it, even when seated on both teams.
//
// Why the server: the sender's ledger line lives under ANOTHER project, which the
// receiving engineer's rules may not write — the old client write was refused at
// the rules (pm-prd-status §4 #4), and the ruleset has no room for a branch.
// One Admin transaction re-reads both lines and the project, rebuilds the
// caller's PM context from the company's word (default group) and this project's
// seat, and re-runs the guard and the pure rule before anything is written.

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { pmCeiling, pmRefusal, seatActive, seatFromMember, type PmContext, type PmRefusal } from "./access"
import { PM_EVENTS, pmEventDocId } from "./events"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { answeredTransfer, PM_STORE, r2, storeLineOf, transferBlocks, type PmStoreLine, type TransferAnswer, type TransferBlock } from "./store"

export class StoreTransferRefusal extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "REFUSED" | "BLOCKED",
    readonly blocks: Array<TransferBlock | PmRefusal | "other_org">
  ) {
    super(`${code}:${blocks.join(",")}`)
    this.name = "StoreTransferRefusal"
  }
}

export interface TransferInput {
  projectId: string
  storeId: string
  index: number
  answer: TransferAnswer
  why: string | null
  /** The material's last paid price, as the screen knows it — the XFER event's value. */
  costHint: number | null
}

type Raw = Record<string, unknown>

/** The caller's PM context on a project, as the client's `usePmAccess` builds it:
 * the ceiling from the DEFAULT group (or the owner's), the live seat from
 * `projects/{id}/members/{uid}`, archived and managerless from the project. */
export async function serverPmContext(db: Firestore, uid: string, project: Raw, projectId: string): Promise<{ ctx: PmContext; orgId: string; name: string }> {
  const profile = ((await db.collection("users").doc(uid).get()).data() ?? {}) as Raw
  const orgId = (profile.organizationId as string) || uid
  // An account with no organizationRole is a legacy solo account — an owner (CLAUDE.md).
  const owner = !("organizationRole" in profile) || profile.organizationRole === "owner"
  const groupId = (profile.defaultGroupId as string) || ""
  const group = groupId ? (((await db.collection("teamGroups").doc(groupId).get()).data() ?? {}) as Raw) : {}
  const permissions = group.organizationId === orgId && Array.isArray(group.permissions) ? (group.permissions as string[]) : []
  const member = (await db.collection("projects").doc(projectId).collection("members").doc(uid).get()).data() as Raw | undefined
  const seat = seatFromMember(member ?? null, uid)
  const ctx: PmContext = {
    ceiling: pmCeiling({ owner, permissions }),
    seat: seat && seatActive(seat, todayDay()) ? seat : null,
    archived: Boolean(project.pm) && lifecycleOf(project as { pm?: { lifecycle?: string } }) === "closed",
    managerless: Boolean(project.pm) && !project.projectManagerId,
  }
  return { ctx, orgId, name: (profile.name as string) || (profile.email as string) || "" }
}

const lineOf = (snap: { exists: boolean; id: string; data: () => Raw | undefined }): PmStoreLine | null => (snap.exists ? storeLineOf(snap.id, (snap.data() ?? {}) as Partial<PmStoreLine>) : null)

/** Confirm or refuse a transfer in. Returns the answer recorded. */
export async function answerStoreTransfer(db: Firestore, uid: string, input: TransferInput): Promise<TransferAnswer> {
  const projectRef = db.collection("projects").doc(input.projectId)
  const storeRef = projectRef.collection(PM_STORE).doc(input.storeId)
  await db.runTransaction(async (tx) => {
    const pSnap = await tx.get(projectRef)
    if (!pSnap.exists) throw new StoreTransferRefusal("NOT_FOUND", [])
    const project = (pSnap.data() ?? {}) as Raw
    if (!project.pm) throw new StoreTransferRefusal("NOT_FOUND", [])
    const { ctx, orgId, name } = await serverPmContext(db, uid, project, input.projectId)
    if (project.organizationId !== orgId) throw new StoreTransferRefusal("REFUSED", ["other_org"])
    // `xino` / confirm: the receiving project's `req` (store.move).
    const refusal = pmRefusal(ctx, "store.move")
    if (refusal) throw new StoreTransferRefusal("REFUSED", [refusal])
    const line = lineOf(await tx.get(storeRef))
    const move = line?.moves[input.index]
    if (!line || !move) throw new StoreTransferRefusal("NOT_FOUND", [])
    const blocks = transferBlocks({ archived: ctx.archived, move, actorUid: uid, answer: input.answer, why: input.why })
    if (blocks.length) throw new StoreTransferRefusal("BLOCKED", blocks)
    // The sending line: read before any write.
    const srcRef = move.otherProjectId && move.srcStoreId ? db.collection("projects").doc(move.otherProjectId).collection(PM_STORE).doc(move.srcStoreId) : null
    const src = srcRef ? lineOf(await tx.get(srcRef)) : null
    const day = todayDay()
    const done = answeredTransfer(move, input.answer, { uid, name }, day, input.why)
    tx.update(storeRef, { moves: line.moves.map((m, i) => (i === input.index ? done.xi : m)), updatedAt: FieldValue.serverTimestamp() })
    if (srcRef && src && move.srcMove != null && src.moves[move.srcMove]?.t === "xo") {
      tx.update(srcRef, { moves: src.moves.map((m, i) => (i === move.srcMove ? done.xo(m) : m)), updatedAt: FieldValue.serverTimestamp() })
    }
    if (input.answer === "confirm") {
      const projectNo = (project.pm as { no?: string }).no ?? input.projectId
      const key = `prj:XFER:${projectNo}:${input.storeId}:${input.index}`
      tx.set(db.collection(PM_EVENTS).doc(pmEventDocId(orgId, key)), {
        key,
        kind: "XFER",
        organizationId: orgId,
        projectId: input.projectId,
        projectNo,
        amount: input.costHint != null ? r2(input.costHint * move.q) : 0,
        params: { material: line.name, unit: line.unit, qty: move.q, fromProjectId: move.otherProjectId ?? "", fromProject: move.otherProjectName ?? "", unitCost: input.costHint ?? 0 },
        by: uid,
        at: new Date().toISOString(),
      })
    }
  })
  return input.answer
}
