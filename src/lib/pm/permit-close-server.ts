// PM 1.1 — closing a work permit early (HSE-01 `pmtclose`), on the server. A
// permit is never edited from the browser (`pmPermits` allows no update — the
// ruleset is at Google's size ceiling), so the close runs here with the Admin
// SDK: the caller's context is rebuilt, the guard (`permit.close` = hse) and the
// pure rule run again inside the transaction on the project and the permit as
// they stand, and only `closedOn` / `closedBy` / `closedByName` are written.
// From its closing day no activity relies on it (the look-ahead's permit test).

import { z } from "zod"
import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { pmRefusal } from "./access"
import { pmCallerOf, pmContextFrom } from "./admin-context"
import { closePermitBlocks, PM_PERMITS, type PmPermit } from "./site"

export const permitCloseSchema = z.object({
  projectId: z.string().min(1).max(128).regex(/^[^/]+$/),
  permitId: z.string().regex(/^\d{2,4}$/),
})
export type PermitCloseInput = z.infer<typeof permitCloseSchema>

export class PermitCloseError extends Error {
  constructor(readonly code: "NO_PROFILE" | "NOT_FOUND" | "NOT_PM_PROJECT" | "FORBIDDEN" | "BLOCKED", readonly status: number, readonly blocks: string[] = []) {
    super(code)
    this.name = "PermitCloseError"
  }
}

type ProjectDoc = { organizationId?: string; pm?: { lifecycle?: string | null } | null; status?: string | null; projectManagerId?: string | null }

/** Close the permit today. Returns the closing day. */
export async function closePermitServer(db: Firestore, uid: string, input: PermitCloseInput, today: string): Promise<{ closedOn: string }> {
  const caller = await pmCallerOf(db, uid)
  if (!caller) throw new PermitCloseError("NO_PROFILE", 403)
  const projectRef = db.collection("projects").doc(input.projectId)
  const permitRef = projectRef.collection(PM_PERMITS).doc(input.permitId)
  const memberRef = projectRef.collection("members").doc(uid)
  await db.runTransaction(async (tx) => {
    const pSnap = await tx.get(projectRef)
    const wSnap = await tx.get(permitRef)
    const mSnap = await tx.get(memberRef)
    const project = pSnap.data() as ProjectDoc | undefined
    // Another company's project reads as missing — nothing about it is told.
    if (!pSnap.exists || !project || project.organizationId !== caller.orgId) throw new PermitCloseError("NOT_FOUND", 404)
    if (!project.pm) throw new PermitCloseError("NOT_PM_PROJECT", 409)
    if (!wSnap.exists) throw new PermitCloseError("NOT_FOUND", 404)
    const ctx = pmContextFrom(caller, project, mSnap.exists ? (mSnap.data() as Record<string, unknown>) : null, today)
    const refusal = pmRefusal(ctx, "permit.close")
    if (refusal) throw new PermitCloseError(refusal === "archived" ? "BLOCKED" : "FORBIDDEN", refusal === "archived" ? 409 : 403, [refusal])
    const permit = wSnap.data() as PmPermit
    const blocks = closePermitBlocks({ archived: ctx.archived, to: permit.to, closedOn: permit.closedOn, today })
    if (blocks.length) throw new PermitCloseError("BLOCKED", 409, blocks)
    tx.update(permitRef, { closedOn: today, closedBy: caller.uid, closedByName: caller.name, updatedAt: FieldValue.serverTimestamp() })
  })
  return { closedOn: today }
}
