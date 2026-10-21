import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { adminCaller, adminError } from "@/lib/admin-caller-server"
import { COMPANY_MODULES } from "@/lib/company-modules"
import { assessPackageChange, assessmentIsQuiet, contractorOff, readStoredModules } from "@/lib/procurement/package-change-server"

// Admin-only: saves a contractor's package — which of its optional components are off, and the answers to the need
// questions that suggested it. The impact is recomputed here (what the admin read is not trusted); a change that touches
// records is refused until the admin has acknowledged it. Every connector that changed leaves a history entry, which the
// migration job of a later wave applies by its id. Nothing is deleted.

const HISTORY_KEEP = 20

const needValue = z.union([z.literal(0), z.literal(1), z.null()])

const bodySchema = z.object({
  orgId: z.string().trim().min(1).max(128).refine((v) => !v.includes("/")),
  off: z.array(z.string().trim().max(40)).max(12),
  needs: z.object({ pm: needValue, fin: needValue, mfg: needValue }).partial().optional(),
  ack: z.boolean().optional(),
})

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

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
    if (sameList(stored.off, nextOff) && !needsChanged) return NextResponse.json({ success: true, data: { unchanged: true, off: nextOff, changed: [] } })

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
      .set({ organizationId: orgId, off: nextOff, needs: nextNeeds, history, updatedById: caller.uid, updatedByName: caller.name, updatedAt: FieldValue.serverTimestamp() }, { merge: true })

    return NextResponse.json({ success: true, data: { unchanged: false, off: nextOff, changed: entries.map((e) => ({ id: e.id, connector: e.connector, to: e.to })) } })
  } catch (err) {
    console.error("company-modules save failed:", err)
    return adminError("Could not save the package", "SERVER_ERROR", 500)
  }
}
