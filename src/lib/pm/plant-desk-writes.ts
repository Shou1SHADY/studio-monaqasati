import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { emitProcEvent } from "../procurement/events"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { deskReplyBlocks } from "./plant-desk"
import { PM_PLANT, plantNo, type PlantReplyKind, type PmPlantRequest } from "./supply"

export class PlantDeskError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PlantDeskError"
  }
}

export interface DeskActor {
  uid: string
  name: string | null
}

export interface DeskAnswer {
  k: PlantReplyKind | null
  unit?: string | null
  free?: string | null
  text?: string | null
  on: string
}

interface ProjectDoc {
  name?: string | null
  organizationId?: string | null
  pm?: { no?: string; lifecycle?: string } | null
}

/**
 * The equipment desk answers an approved request: allocate a unit of the fleet,
 * busy until a date, an alternative, or not in the fleet. Once, in a project that
 * is still open. The requester is told after the commit (best effort — a lost
 * notice never undoes the answer).
 */
export async function answerPlantRequest(firestore: Firestore, actor: DeskActor, projectId: string, seq: number, input: DeskAnswer): Promise<void> {
  let told: { organizationId: string; project: string; request: PmPlantRequest } | null = null
  await runTransaction(firestore, async (tx) => {
    const projectRef = doc(firestore, "projects", projectId)
    const projectSnap = await tx.get(projectRef)
    if (!projectSnap.exists()) throw new PlantDeskError("missing")
    const project = projectSnap.data() as ProjectDoc
    if (!project.pm) throw new PlantDeskError("not_pm_project")
    const ref = doc(firestore, "projects", projectId, PM_PLANT, plantNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PlantDeskError("missing")
    const request = { id: snap.id, ...(snap.data() as Omit<PmPlantRequest, "id">) }
    const blocks = deskReplyBlocks({ projectClosed: lifecycleOf(project as { pm?: { lifecycle?: string } }) === "closed", r: request, ...input, today: todayDay() })
    if (blocks.length) throw new PlantDeskError("blocked", blocks)
    tx.update(ref, {
      rep: {
        k: input.k,
        unit: input.k === "alloc" ? input.unit?.trim() || null : null,
        free: input.k === "late" ? input.free || null : null,
        text: input.text?.trim() || null,
        on: input.on,
        by: actor.uid,
        byName: actor.name,
        via: "desk",
      },
      updatedAt: serverTimestamp(),
    })
    told = { organizationId: project.organizationId ?? "", project: project.name ?? project.pm.no ?? projectId, request }
  })
  const t = told as { organizationId: string; project: string; request: PmPlantRequest } | null
  if (t?.organizationId && t.request.by) {
    await emitProcEvent(firestore, { uid: actor.uid, name: actor.name ?? "" }, {
      kind: "plant_answered",
      organizationId: t.organizationId,
      to: [{ users: [t.request.by] }],
      params: { no: plantNo(seq), what: t.request.what, project: t.project, reply: `@pn_plant_reply_${input.k}` },
      link: `/contractor/projects/${projectId}`,
    })
  }
}
