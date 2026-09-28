// PM 1.0 — document register writes (DOC-01). The register is kept by the
// project manager (`document.manage` = approve); one transaction each with the
// guard first. A new revision is appended to the document — never an edit of
// the one it supersedes.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { docNo, PM_DOCS, revisionBlocks, type DocRevision, type DocType, type PmDocument, type PmFile } from "./documents"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"

export class PmDocError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmDocError"
  }
}

export interface DocActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; docCount?: number } & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, ctx: PmContext, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmDocError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmDocError("not_pm_project")
  const fresh = withFreshState(ctx, project)
  assertPm(fresh, "document.manage")
  return { ref, project, pm: project.pm, archived: fresh.archived }
}

export async function registerDocument(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: DocActor,
  input: { name: string; type: DocType; code: string; day: string; file?: PmFile | null },
): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm, archived } = await readProject(tx, firestore, ctx, projectId)
    const blocks = revisionBlocks({ archived, isNew: true, doc: null, name: input.name, code: input.code, day: input.day, today: todayDay() })
    if (blocks.length) throw new PmDocError("blocked", blocks)
    seq = (pm.docCount ?? 0) + 1
    const code = input.code.trim().toUpperCase()
    const record: Omit<PmDocument, "id"> = {
      seq,
      name: input.name.trim(),
      type: input.type,
      revisions: code ? [{ code, day: input.day, by: actor.uid, byName: actor.name, file: input.file ?? null }] : [],
      file: code ? null : input.file ?? null,
      day: todayDay(),
      by: actor.uid,
      byName: actor.name,
    }
    tx.set(doc(firestore, "projects", projectId, PM_DOCS, docNo(seq)), { ...record, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, docCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

export async function issueRevision(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: DocActor,
  seq: number,
  input: { code: string; day: string; file?: PmFile | null },
): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { archived } = await readProject(tx, firestore, ctx, projectId)
    const ref = doc(firestore, "projects", projectId, PM_DOCS, docNo(seq))
    const snap = await tx.get(ref)
    const current = snap.exists() ? (snap.data() as PmDocument) : null
    const revisions = current?.revisions ?? []
    const blocks = revisionBlocks({ archived, isNew: false, doc: current ? { revisions } : null, code: input.code, day: input.day, today: todayDay() })
    if (blocks.length) throw new PmDocError("blocked", blocks)
    const next: DocRevision = { code: input.code.trim().toUpperCase(), day: input.day, by: actor.uid, byName: actor.name, file: input.file ?? null }
    tx.update(ref, { revisions: [...revisions, next], updatedAt: serverTimestamp() })
  })
}
