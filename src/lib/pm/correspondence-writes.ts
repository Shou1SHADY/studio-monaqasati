// PM 1.0 — correspondence writes (COR-01), by whoever holds `corr`. One
// transaction each with the guard first. The number is drawn inside the write:
// the document id from `pm.letterCount`, the letter's own number from its
// direction's sequence (`pm.lettersOut` / `pm.lettersIn`).

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import {
  letterBlocks,
  letterDocId,
  letterNumber,
  parseLinks,
  PM_LETTERS,
  replyBlocks,
  type LetterDir,
  type LetterParty,
  type LetterReply,
  type PmLetter,
} from "./correspondence"
import type { PmFile } from "./documents"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"

export class PmLetterError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmLetterError"
  }
}

export interface LetterActor {
  uid: string
  name: string | null
}

type LetterCounters = { no?: string; letterCount?: number; lettersOut?: number; lettersIn?: number }
type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string } & LetterCounters & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, ctx: PmContext, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmLetterError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmLetterError("not_pm_project")
  const fresh = withFreshState(ctx, project)
  assertPm(fresh, "correspondence.write")
  return { ref, project, pm: project.pm, archived: fresh.archived }
}

export async function logLetter(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: LetterActor,
  input: { dir: LetterDir; party: LetterParty; subject: string; day: string; due: number; links: string; file?: PmFile | null },
): Promise<{ seq: number; no: string }> {
  let seq = 0
  let no = ""
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm, archived } = await readProject(tx, firestore, ctx, projectId)
    const blocks = letterBlocks({ archived, subject: input.subject, day: input.day, due: input.due, today: todayDay() })
    if (blocks.length) throw new PmLetterError("blocked", blocks)
    seq = (pm.letterCount ?? 0) + 1
    const dirKey = input.dir === "out" ? "lettersOut" : "lettersIn"
    const dirSeq = (pm[dirKey] ?? 0) + 1
    no = letterNumber(pm.no, dirSeq)
    const letter: Omit<PmLetter, "id"> = {
      seq,
      no,
      dir: input.dir,
      party: input.party,
      subject: input.subject.trim(),
      day: input.day,
      due: input.due,
      status: input.dir === "in" ? "in" : "out",
      links: parseLinks(input.links),
      file: input.file ?? null,
      reply: null,
      by: actor.uid,
      byName: actor.name,
    }
    tx.set(doc(firestore, "projects", projectId, PM_LETTERS, letterDocId(seq)), { ...letter, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, letterCount: seq, [dirKey]: dirSeq }, updatedAt: serverTimestamp() })
  })
  return { seq, no }
}

export async function logReply(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: LetterActor,
  seq: number,
  input: { text: string; on: string; file?: PmFile | null },
): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { archived } = await readProject(tx, firestore, ctx, projectId)
    const ref = doc(firestore, "projects", projectId, PM_LETTERS, letterDocId(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmLetterError("missing")
    const letter = snap.data() as PmLetter
    const blocks = replyBlocks({ archived, status: letter.status, text: input.text, on: input.on, letterDay: letter.day, today: todayDay() })
    if (blocks.length) throw new PmLetterError("blocked", blocks)
    const reply: LetterReply = { text: input.text.trim(), on: input.on, by: actor.uid, byName: actor.name, file: input.file ?? null }
    tx.update(ref, { status: "rep", reply, updatedAt: serverTimestamp() })
  })
}
