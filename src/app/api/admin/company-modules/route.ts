import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { adminCaller, adminError } from "@/lib/admin-caller-server"
import { COMPANY_MODULES } from "@/lib/company-modules"
import { SUBSCRIPTION_STATUSES, subscriptionStatusOf } from "@/lib/subscription-status"
import { assessPackageChange, assessmentIsQuiet, contractorOff, readStoredModules } from "@/lib/procurement/package-change-server"
import { applyPendingChanges, pendingEntries } from "@/lib/procurement/package-migration-server"

// Admin-only: saves a contractor's package — which of its optional components are off, and the answers to the need
// questions that suggested it. The impact is recomputed here (what the admin read is not trusted); a change that touches
// records is refused until the admin has acknowledged it. Every connector that changed leaves a history entry, and the migration
// job applies it by its id right after the save (NFR-08): it stamps how in-flight orders end, hands back the workshop questions no
// one will answer, turns a closed connector's sites into ordinary ones — and never deletes, never reopens a closed order. An entry
// the job could not finish stays `pending`; saving the same package again runs it again, and a finished entry is never run twice.

export const maxDuration = 60

const HISTORY_KEEP = 20

const needValue = z.union([z.literal(0), z.literal(1), z.null()])

const bodySchema = z.object({
  orgId: z.string().trim().min(1).max(128).refine((v) => !v.includes("/")),
  off: z.array(z.string().trim().max(40)).max(12),
  needs: z.object({ pm: needValue, fin: needValue, mfg: needValue }).partial().optional(),
  ack: z.boolean().optional(),
  /** «نشط» / «تجريبي» beside the package (AD-03) — absent leaves it as stored. */
  subscription: z.enum(SUBSCRIPTION_STATUSES).optional(),
})

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** The job, after the save. A failure leaves the entries pending (the package IS saved) and says so: the admin saves again to run it. */
async function runMigration(db: Parameters<typeof applyPendingChanges>[0], orgId: string, caller: { uid: string; name: string }, off: string[]): Promise<{ applied: Record<string, Record<string, number>>; pending: boolean }> {
  try {
    const run = await applyPendingChanges(db, orgId, { actor: { uid: caller.uid, name: caller.name }, off })
    return { applied: run.applied, pending: false }
  } catch (err) {
    console.error("company-modules migration failed:", err)
    return { applied: {}, pending: true }
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await adminCaller(req)
    if (caller instanceof NextResponse) return caller
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return adminError(parsed.error.issues[0]?.message || "Invalid input", "INVALID_INPUT", 400)
    const { orgId, ack } = parsed.data
    const { db } = caller

    const owner = (await db.collection("users").doc(orgId).get()).data()
    if (!owner || owner.role !== "Contractor") return adminError("Not a contractor company", "NOT_FOUND", 404)

    const stored = await readStoredModules(db, orgId)
    const nextOff = contractorOff(parsed.data.off)
    const nextNeeds = { ...stored.needs, ...(parsed.data.needs || {}) }
    const needsChanged = JSON.stringify(nextNeeds) !== JSON.stringify(stored.needs)
    const subscriptionChanged = parsed.data.subscription !== undefined && parsed.data.subscription !== subscriptionStatusOf(stored.subscription)
    if (sameList(stored.off, nextOff) && !needsChanged && !subscriptionChanged) {
      if (!pendingEntries(stored.history)) return NextResponse.json({ success: true, data: { unchanged: true, off: nextOff, changed: [] } })
      const resumed = await runMigration(db, orgId, caller, nextOff)
      return NextResponse.json({ success: true, data: { unchanged: true, off: nextOff, changed: [], ...resumed } })
    }

    const assessment = await assessPackageChange(db, orgId, stored.off, nextOff)
    if (!assessmentIsQuiet(assessment) && ack !== true) {
      return NextResponse.json(
        { error: true, message: "This change touches records the admin has not acknowledged", code: "ACK_REQUIRED", data: { changes: assessment.plan.changes.map((c) => ({ conn: c.conn, to: c.to, impact: c.impact })), hrDependent: assessment.plan.hrDependent, warnings: assessment.warnings } },
        { status: 409 },
      )
    }

    const at = new Date().toISOString()
    const entries = assessment.plan.changes.map((c) => ({ id: randomUUID(), at, byId: caller.uid, byName: caller.name, connector: c.conn, to: c.to, impact: c.impact, applied: {}, state: "pending" }))
    const history = [...stored.history, ...entries].slice(-HISTORY_KEEP)
    await db
      .collection(COMPANY_MODULES)
      .doc(orgId)
      .set({ organizationId: orgId, off: nextOff, needs: nextNeeds, ...(subscriptionChanged ? { subscription: parsed.data.subscription } : {}), history, updatedById: caller.uid, updatedByName: caller.name, updatedAt: FieldValue.serverTimestamp() }, { merge: true })

    const migrated = await runMigration(db, orgId, caller, nextOff)
    return NextResponse.json({ success: true, data: { unchanged: false, off: nextOff, changed: entries.map((e) => ({ id: e.id, connector: e.connector, to: e.to })), ...migrated } })
  } catch (err) {
    console.error("company-modules save failed:", err)
    return adminError("Could not save the package", "SERVER_ERROR", 500)
  }
}
