// PM 1.0 — site writes (WF-19, WF-20). One transaction per act, the guard
// first with the project as it stands. The daily report is `daily`'s; safety is
// `hse`'s; obstacles are raised, chased and closed by whoever writes the site
// record (`daily`) or runs the project (`approve`) — the guard table has no
// entry for that pair yet, so both are asked here.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"
import {
  chaseBlocks,
  closeObstacleBlocks,
  COUNTER_OF,
  dailyBlocks,
  incidentBlocks,
  incidentNo,
  obstacleBlocks,
  obstacleId,
  permitBlocks,
  permitNo,
  PM_DAILY,
  PM_INCIDENTS,
  PM_OBSTACLES,
  PM_PERMITS,
  type IncidentType,
  type ObstacleParty,
  type ObstacleType,
  type PmDaily,
  type PmIncident,
  type PmObstacle,
  type PmPermit,
  type SiteFile,
} from "./site"

export class PmSiteError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmSiteError"
  }
}

export interface SiteActor {
  uid: string
  name: string | null
}

type Counters = { rfiCount?: number; obstacleCount?: number; incidentCount?: number; permitCount?: number }
type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string } & Counters & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmSiteError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmSiteError("not_pm_project")
  return { ref, project, pm: project.pm }
}

const cleanFiles = (files: SiteFile[] | undefined) => (files ?? []).filter((f) => f.url && f.name).map((f) => ({ url: f.url, name: f.name }))

export async function fileDailyReport(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SiteActor,
  input: { labour: number; plant: number; done: string; obstacle: string; files?: SiteFile[] }
): Promise<string> {
  const day = todayDay()
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "daily.write")
    const ref = doc(firestore, "projects", projectId, PM_DAILY, day)
    const existing = await tx.get(ref)
    const blocks = dailyBlocks({ archived: fresh.archived, done: input.done, labour: input.labour, plant: input.plant, filed: existing.exists() })
    if (blocks.length) throw new PmSiteError("blocked", blocks)
    const report: Omit<PmDaily, "id"> = {
      day,
      labour: input.labour,
      plant: input.plant,
      done: input.done.trim(),
      obstacle: input.obstacle.trim() || null,
      files: cleanFiles(input.files),
      by: actor.uid,
      byName: actor.name,
    }
    tx.set(ref, { ...report, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
  })
  return day
}

export interface ObstacleInput {
  type: ObstacleType
  title: string
  party: ObstacleParty
  partyName: string
  itemIds: string[]
  impact: string
  openOn: string
}

export async function openObstacle(firestore: Firestore, ctx: PmContext, projectId: string, actor: SiteActor, input: ObstacleInput): Promise<string> {
  let id = ""
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "obstacle.record")
    const itemIds = Array.from(new Set(input.itemIds))
    const snaps = await Promise.all(itemIds.map((i) => tx.get(doc(firestore, "projects", projectId, "boqItems", i))))
    const known = new Set(snaps.filter((s) => s.exists()).map((s) => s.id))
    const blocks = obstacleBlocks({ archived: fresh.archived, ...input, itemIds, knownItems: known, today: todayDay() })
    if (blocks.length) throw new PmSiteError("blocked", blocks)
    const counter = COUNTER_OF[input.type]
    const seq = (pm[counter] ?? 0) + 1
    id = obstacleId(input.type, seq)
    const obstacle: Omit<PmObstacle, "id"> = {
      type: input.type,
      seq,
      title: input.title.trim(),
      party: input.party,
      partyName: input.partyName.trim() || null,
      itemIds,
      codes: snaps.map((s) => ((s.data() as { itemNo?: string } | undefined)?.itemNo ?? "")),
      impact: input.impact.trim(),
      openOn: input.openOn,
      closeOn: null,
      answer: null,
      chases: [],
      by: actor.uid,
      byName: actor.name,
    }
    tx.set(doc(firestore, "projects", projectId, PM_OBSTACLES, id), { ...obstacle, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, [counter]: seq }, updatedAt: serverTimestamp() })
  })
  return id
}

async function readObstacle(tx: Transaction, firestore: Firestore, projectId: string, id: string) {
  const ref = doc(firestore, "projects", projectId, PM_OBSTACLES, id)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmSiteError("missing")
  return { ref, obstacle: snap.data() as PmObstacle }
}

/** A dated, signed chase — the evidence a claim cites. Returns how many there are now. */
export async function chaseObstacle(firestore: Firestore, ctx: PmContext, projectId: string, actor: SiteActor, id: string): Promise<number> {
  let n = 0
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "obstacle.record")
    const { ref, obstacle } = await readObstacle(tx, firestore, projectId, id)
    const blocks = chaseBlocks({ archived: fresh.archived, closeOn: obstacle.closeOn })
    if (blocks.length) throw new PmSiteError("blocked", blocks)
    const chases = [...(obstacle.chases ?? []), { on: todayDay(), by: actor.uid, byName: actor.name }]
    n = chases.length
    tx.update(ref, { chases, updatedAt: serverTimestamp() })
  })
  return n
}

/** The answer came (or the cause ended): closed on that day, with what was said. */
export async function closeObstacle(firestore: Firestore, ctx: PmContext, projectId: string, actor: SiteActor, id: string, input: { on: string; answer: string }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "obstacle.record")
    const { ref, obstacle } = await readObstacle(tx, firestore, projectId, id)
    const blocks = closeObstacleBlocks({ archived: fresh.archived, openOn: obstacle.openOn, closeOn: obstacle.closeOn, on: input.on, today: todayDay() })
    if (blocks.length) throw new PmSiteError("blocked", blocks)
    tx.update(ref, { closeOn: input.on, answer: input.answer.trim() || null, closedBy: actor.uid, closedByName: actor.name, updatedAt: serverTimestamp() })
  })
}

export async function logIncident(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SiteActor,
  input: { type: IncidentType; what: string; action: string; day: string; lostDays: number; files?: SiteFile[] }
): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "hse.record")
    const lost = input.type === "lti" ? input.lostDays : 0
    const blocks = incidentBlocks({ archived: fresh.archived, ...input, lostDays: lost, today: todayDay() })
    if (blocks.length) throw new PmSiteError("blocked", blocks)
    seq = (pm.incidentCount ?? 0) + 1
    const incident: Omit<PmIncident, "id"> = {
      seq,
      type: input.type,
      what: input.what.trim(),
      action: input.action.trim(),
      day: input.day,
      lostDays: lost,
      files: cleanFiles(input.files),
      by: actor.uid,
      byName: actor.name,
    }
    tx.set(doc(firestore, "projects", projectId, PM_INCIDENTS, incidentNo(seq)), { ...incident, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, incidentCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

export async function issuePermit(firestore: Firestore, ctx: PmContext, projectId: string, actor: SiteActor, input: { title: string; who: string; from: string; to: string }): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "hse.record")
    const blocks = permitBlocks({ archived: fresh.archived, ...input })
    if (blocks.length) throw new PmSiteError("blocked", blocks)
    seq = (pm.permitCount ?? 0) + 1
    const permit: Omit<PmPermit, "id"> = { seq, title: input.title.trim(), who: input.who.trim(), from: input.from, to: input.to, by: actor.uid, byName: actor.name }
    tx.set(doc(firestore, "projects", projectId, PM_PERMITS, permitNo(seq)), { ...permit, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, permitCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}
