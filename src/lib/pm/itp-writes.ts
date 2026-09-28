// PM 1.0 — inspection & test plan writes. Set by quality (`qa.record`), one
// transaction with the guard first; the project numbers the rows. A row is
// never deleted — the plan is what the consultant was promised.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { todayDay } from "./format"
import type { WirParty } from "./inspection"
import { itpBlocks, itpNo, PM_ITP, type PmItpRow } from "./itp"
import { withFreshState } from "./project-writes"

export class PmItpError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmItpError"
  }
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; itpCount?: number } & Record<string, unknown> }

export interface ItpInput {
  itemId: string
  stage: string
  test: string
  freq: string
  need: number
  party: WirParty
  partyText?: string | null
}

export async function addItpRow(firestore: Firestore, ctx: PmContext, projectId: string, actor: { uid: string; name: string | null }, input: ItpInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, "projects", projectId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmItpError("missing")
    const project = snap.data() as ProjectData
    if (!project.pm) throw new PmItpError("not_pm_project")
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const item = await tx.get(doc(firestore, "projects", projectId, "boqItems", input.itemId))
    const blocks = itpBlocks({ archived: fresh.archived, itemId: item.exists() ? input.itemId : null, stage: input.stage, test: input.test, freq: input.freq, need: input.need, party: input.party, partyText: input.partyText })
    if (blocks.length) throw new PmItpError("blocked", blocks)
    seq = (project.pm.itpCount ?? 0) + 1
    const row: Omit<PmItpRow, "id"> = {
      seq,
      itemId: input.itemId,
      code: (item.data() as { itemNo?: string }).itemNo ?? null,
      stage: input.stage.trim(),
      test: input.test.trim(),
      freq: input.freq.trim(),
      party: input.party,
      partyText: input.party === "other" ? input.partyText?.trim() ?? null : null,
      need: input.need,
      day: todayDay(),
      by: actor.uid,
      byName: actor.name,
    }
    tx.set(doc(firestore, "projects", projectId, PM_ITP, itpNo(seq)), { ...row, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...project.pm, itpCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}
