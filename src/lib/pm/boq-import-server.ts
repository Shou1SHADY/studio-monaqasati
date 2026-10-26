// PM — writing the BOQ of «رفع جدول الكميات», on the server. Replacing a BOQ or editing it by
// hand removes lines, and the rules let only a holder of `projects.edit` delete one (the
// ruleset is at Google's size ceiling), so the whole write runs here with the Admin SDK:
// the caller's context is rebuilt, the guard (`boq.import`) and the freeze rules run on the
// project and its lines as they stand INSIDE the transaction, and the lines are written
// together or not at all. Before the start and before any approved measurement only.

import { z } from "zod"
import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { pmRefusal } from "./access"
import { pmCallerOf, pmContextFrom } from "./admin-context"
import { BOQ_IMPORT_MAX_LINES, divisionExtra, lineExtra, payloadBlocks, sourceExtra, type BoqImportLine, type BoqImportPayload, type BoqImportStamp } from "./boq-import-payload"
import { lifecycleOf } from "./lifecycle"

const sectionSchema = z.object({ key: z.string().min(1).max(200), code: z.string().max(60), text: z.string().max(300) })

const lineSchema = z.object({
  key: z.string().min(1).max(200),
  existingId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[^/]+$/)
    .nullable(),
  code: z.string().max(60),
  descriptionAr: z.string().max(2000),
  descriptionEn: z.string().max(2000),
  unit: z.string().max(40),
  quantity: z.number().finite().min(-1e12).max(1e12),
  rate: z.number().finite().min(0).max(1e12).nullable(),
  section: z.string().max(200).nullable(),
  sheet: z.string().max(200),
  row: z.number().int().min(0).max(10_000_000).nullable(),
})

export const boqImportSchema = z.object({
  projectId: z.string().min(1).max(128).regex(/^[^/]+$/),
  payload: z.object({
    source: z.enum(["file", "manual"]),
    fileName: z.string().max(300).nullable(),
    edit: z.boolean(),
    sections: z.array(sectionSchema).max(2000),
    lines: z.array(lineSchema).max(BOQ_IMPORT_MAX_LINES),
  }),
})
export type BoqImportInput = z.infer<typeof boqImportSchema>

export class BoqImportError extends Error {
  constructor(readonly code: "NO_PROFILE" | "NOT_FOUND" | "NOT_PM_PROJECT" | "FORBIDDEN" | "BLOCKED" | "INVALID", readonly status: number, readonly blocks: string[] = []) {
    super(code)
    this.name = "BoqImportError"
  }
}

type ProjectDoc = { organizationId?: string; pm?: { lifecycle?: string | null } | null; status?: string | null; projectManagerId?: string | null }

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

const own = (line: BoqImportLine) => ({
  itemNo: line.code,
  descriptionAr: line.descriptionAr,
  descriptionEn: line.descriptionEn,
  unit: line.unit,
  quantity: line.quantity,
  unitPrice: line.rate !== null && line.rate > 0 ? line.rate : 0,
})

/** Writes the lines. A new BOQ replaces whatever is there; an `edit` updates the lines it names, adds the rest and removes the lines it left out. */
export async function applyBoqImport(db: Firestore, uid: string, input: BoqImportInput, today: string): Promise<{ written: number; removed: number }> {
  const payload: BoqImportPayload = input.payload
  const caller = await pmCallerOf(db, uid)
  if (!caller) throw new BoqImportError("NO_PROFILE", 403)
  const shape = payloadBlocks(payload)
  if (shape.length) throw new BoqImportError("INVALID", 400, Array.from(new Set(shape.map((b) => b.code))))
  const projectRef = db.collection("projects").doc(input.projectId)
  const itemsRef = projectRef.collection("boqItems")
  const sectionOf = new Map(payload.sections.map((s) => [s.key, s]))
  let removed = 0

  await db.runTransaction(async (tx) => {
    const pSnap = await tx.get(projectRef)
    const mSnap = await tx.get(projectRef.collection("members").doc(uid))
    const existing = await tx.get(itemsRef)
    const groups = payload.edit ? null : await tx.get(projectRef.collection("boqGroups"))
    const project = pSnap.data() as ProjectDoc | undefined
    if (!pSnap.exists || !project || project.organizationId !== caller.orgId) throw new BoqImportError("NOT_FOUND", 404)
    if (!project.pm) throw new BoqImportError("NOT_PM_PROJECT", 409)
    const ctx = pmContextFrom(caller, project, mSnap.exists ? (mSnap.data() as Record<string, unknown>) : null, today)
    const refusal = pmRefusal(ctx, "boq.import")
    if (refusal) throw new BoqImportError(refusal === "archived" ? "BLOCKED" : "FORBIDDEN", refusal === "archived" ? 409 : 403, [refusal === "archived" ? "started" : refusal])
    if (lifecycleOf(project) !== "plan") throw new BoqImportError("BLOCKED", 409, ["started"])
    const docs = existing.docs
    if (docs.some((d) => num((d.data() as Record<string, unknown>).executedQuantity) > 0)) throw new BoqImportError("BLOCKED", 409, ["measured"])
    if (docs.some((d) => (d.data() as Record<string, unknown>).isEditable === false)) throw new BoqImportError("BLOCKED", 409, ["locked"])

    const stamp: BoqImportStamp = { kind: payload.source, file: payload.fileName, by: caller.uid, byName: caller.name, day: today }
    const stamps = { srcEditedBy: caller.uid, srcEditedByName: caller.name, srcEditedDay: today }
    const stamped = (line: BoqImportLine) => lineExtra(line, line.section ? sectionOf.get(line.section) : undefined, stamp)

    if (!payload.edit) {
      docs.forEach((d) => tx.delete(d.ref))
      groups?.docs.forEach((d) => tx.delete(d.ref))
      removed = docs.length
      payload.lines.forEach((line) =>
        tx.set(itemsRef.doc(), {
          ...own(line),
          ...stamped(line),
          estCost: null,
          tenderId: null,
          isEditable: true,
          groupId: null,
          executedQuantity: 0,
          billedQuantity: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }),
      )
      return
    }

    const byId = new Map(docs.map((d) => [d.id, d]))
    const named = payload.lines.flatMap((l) => (l.existingId ? [l.existingId] : []))
    if (named.some((id) => !byId.has(id)) || new Set(named).size !== named.length) throw new BoqImportError("INVALID", 400, ["unknown_line"])
    const kept = new Set(named)
    docs.filter((d) => !kept.has(d.id)).forEach((d) => tx.delete(d.ref))
    removed = docs.length - kept.size
    const first = docs.map((d) => d.data() as Record<string, unknown>).find((d) => d.srcKind === "file" || d.srcKind === "manual")
    const origin: BoqImportStamp = first
      ? { kind: first.srcKind === "file" ? "file" : "manual", file: typeof first.srcFile === "string" ? first.srcFile : null, by: String(first.srcBy ?? caller.uid), byName: typeof first.srcByName === "string" ? first.srcByName : null, day: String(first.srcDay ?? today) }
      : { kind: "manual", file: null, by: caller.uid, byName: caller.name, day: today }
    payload.lines.forEach((line) => {
      const section = line.section ? sectionOf.get(line.section) : undefined
      if (line.existingId) {
        const ref = byId.get(line.existingId)?.ref
        if (ref) tx.update(ref, { ...own(line), ...divisionExtra(line, section), ...stamps, updatedAt: FieldValue.serverTimestamp() })
        return
      }
      tx.set(itemsRef.doc(), {
        ...own(line),
        ...divisionExtra(line, section),
        ...sourceExtra(line, origin),
        ...stamps,
        estCost: null,
        tenderId: null,
        isEditable: true,
        groupId: null,
        executedQuantity: 0,
        billedQuantity: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
  })
  return { written: payload.lines.length, removed }
}
