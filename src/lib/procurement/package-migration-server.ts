// The server's side of a package change (Procurement 2.0, NFR-08, PKG-03/04): READS the records the planner counts, and APPLIES the
// steps it plans. A package change is a migration of stored state, not a recomputation at read time — so what a closed connector can
// no longer answer is stamped on the record itself (how an order ends, a workshop question handed back, a project's site turned into
// an ordinary one), and what is in flight keeps going. Admin SDK only; the admin account does not read a company's own documents.
//
// Rules the job keeps (the eight rules of the package, #7): it never deletes a document; it never reopens a closed order or a received
// line; it touches only what the plan lists, and the plan is computed from the live records, so running it again changes nothing.

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { COMPANY_MODULES } from "@/lib/company-modules"
import { MANUFACTURING_REQUESTS } from "@/lib/sales-orders"
import { buildProcEvent, commitmentKey, PROC_EVENTS, procEventDocId } from "./event-keys"
import { deliverySites, storedSites, warehouseSiteId, type DeliverySite } from "./delivery-sites"
import { lineBusy, PROC_INCOMING, type IncomingDoc } from "./incoming-state"
import { mutateIncoming } from "./incoming-server"
import { CONNECTORS, packageOf, type Connector } from "./package"
import { PROJECT_SCAN_CAP, planChange, type ConnectorPlan, type MigrationStep, type PackageSnapshot, type SnapshotOrder, type SnapshotProjectRequest, type SnapshotWorkshopAsk, type SnapshotWorkshopLine } from "./package-migration"
import { approvalAmount } from "./po"
import { closeWorkshopQuestions } from "./stock-check"
import type { TeamLinkedRfq, TeamRequestDoc } from "./team-requests"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS } from "./types"

const WORKSHOP_SOURCES = new Set(["project", "procurement"])

const withId = <T>(id: string, data: Record<string, unknown> | undefined): T => ({ ...(data || {}), id }) as T

export async function loadPackageSnapshot(db: Firestore, orgId: string): Promise<PackageSnapshot> {
  const inOrg = (collection: string) => db.collection(collection).where("organizationId", "==", orgId).get()
  const [teamSnap, rfqSnap, orderSnap, askSnap, settingsSnap, warehouseSnap, projectSnap, incomingSnap] = await Promise.all([
    inOrg("procTeamRequests"),
    inOrg("rfqs"),
    inOrg(PURCHASE_ORDERS),
    inOrg(MANUFACTURING_REQUESTS),
    db.collection(PROCUREMENT_SETTINGS).doc(orgId).get(),
    inOrg("warehouses"),
    db.collection("projects").where("organizationId", "==", orgId).limit(PROJECT_SCAN_CAP + 1).get(),
    db.collection(PROC_INCOMING).where("organizationId", "==", orgId).where("status", "==", "open").get(),
  ])

  const scanned = projectSnap.docs.slice(0, PROJECT_SCAN_CAP)
  const projectRequests: SnapshotProjectRequest[] = []
  for (const project of scanned) {
    const requests = await project.ref.collection("purchaseRequests").get()
    for (const r of requests.docs) projectRequests.push(withId<SnapshotProjectRequest>(r.id, r.data()))
  }

  const workshopLines: SnapshotWorkshopLine[] = []
  for (const d of incomingSnap.docs) {
    const doc = d.data() as IncomingDoc
    // A project request routed to the workshop has its own request document (counted above) — never the same ask twice.
    if (doc.mfgRequestId) continue
    for (const l of doc.lines || []) if (l.mk) workshopLines.push({ mrKey: doc.mrKey, no: l.no, st: l.mk.st, wo: l.mk.wo ?? null, busy: lineBusy(l) || Boolean(l.gone) })
  }

  return {
    teamRequests: teamSnap.docs.map((d) => withId<TeamRequestDoc>(d.id, d.data())),
    rfqs: rfqSnap.docs.map((d) => withId<TeamLinkedRfq>(d.id, d.data())),
    projectRequests,
    projects: scanned.map((p) => ({ id: p.id, name: (p.data()?.name as string | undefined) ?? null })),
    projectsCapped: projectSnap.docs.length > PROJECT_SCAN_CAP,
    orders: orderSnap.docs.map((d) => withId<SnapshotOrder>(d.id, d.data())),
    workshopAsks: askSnap.docs.map((d) => withId<SnapshotWorkshopAsk>(d.id, d.data())).filter((a) => WORKSHOP_SOURCES.has(a.sourceKind || "")),
    workshopLines,
    sites: storedSites(settingsSnap.data()?.deliverySites),
    workshopWarehouses: warehouseSnap.docs.filter((d) => d.data()?.kind === "workshop").map((d) => ({ id: d.id, name: (d.data()?.name as string | undefined) ?? null })),
  }
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export const BATCH_SIZE = 400

export interface ApplyCtx {
  actor: { uid: string; name: string }
  /** The company's `off` list as it is saved NOW — the events of an opened connector are built against it. */
  off: string[]
  now?: Date
}

export type AppliedCounts = Record<string, number>

type Op = (batch: ReturnType<Firestore["batch"]>) => void

async function inBatches(db: Firestore, ops: Op[]): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = db.batch()
    for (const op of ops.slice(i, i + BATCH_SIZE)) op(batch)
    await batch.commit()
  }
}

const bump = (counts: AppliedCounts, key: string, n: number) => {
  if (n > 0) counts[key] = (counts[key] || 0) + n
}

/** The stored delivery sites changed in one transaction — the list is read and written whole, so two writers never clobber each other. */
async function changeSites(db: Firestore, orgId: string, change: (list: DeliverySite[]) => { list: DeliverySite[]; count: number }): Promise<number> {
  const ref = db.collection(PROCUREMENT_SETTINGS).doc(orgId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const { list, count } = change(storedSites(snap.data()?.deliverySites))
    if (count > 0) tx.set(ref, { organizationId: orgId, deliverySites: list, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return count
  })
}

async function stepApply(db: Firestore, orgId: string, step: MigrationStep, snapshot: PackageSnapshot, ctx: ApplyCtx, counts: AppliedCounts): Promise<void> {
  const at = (ctx.now ?? new Date()).toISOString()
  switch (step.kind) {
    case "stamp_close_on": {
      const ops: Op[] = step.orderIds.map((id) => (b) => b.update(db.collection(PURCHASE_ORDERS).doc(id), { closeOn: step.closeOn }))
      await inBatches(db, ops)
      bump(counts, "closeOnStamped", step.orderIds.length)
      return
    }
    case "send_commitments": {
      const orders = new Map(snapshot.orders.map((o) => [o.id, o]))
      const ops: Op[] = []
      for (const id of step.orderIds) {
        const po = orders.get(id)
        if (!po) continue
        const ev = buildProcEvent({
          id: "fin_commitment",
          key: commitmentKey(po.docNumber, po.ver ?? 1),
          organizationId: orgId,
          off: ctx.off,
          by: ctx.actor.uid,
          at,
          refs: { po: po.docNumber, rfq: po.rfqId, offer: po.offerId },
          payload: { total: approvalAmount(po), vatRate: po.vatRate },
        })
        if (!ev) continue
        const ref = db.collection(PROC_EVENTS).doc(procEventDocId(ev.organizationId, ev.key))
        if ((await ref.get()).exists) continue
        ops.push((b) => b.create(ref, ev as unknown as Record<string, unknown>))
      }
      await inBatches(db, ops)
      bump(counts, "commitmentsSent", ops.length)
      return
    }
    case "return_workshop_asks": {
      const ops: Op[] = step.requestIds.map((id) => (b) => b.update(db.collection(MANUFACTURING_REQUESTS).doc(id), { returned: true, returnedReason: step.reason, returnedAt: at }))
      await inBatches(db, ops)
      bump(counts, "workshopAsksReturned", step.requestIds.length)
      return
    }
    case "return_workshop_lines": {
      const byDoc = new Map<string, number[]>()
      for (const l of step.lines) byDoc.set(l.mrKey, [...(byDoc.get(l.mrKey) || []), l.no])
      for (const [mrKey, nos] of byDoc) {
        let closed = 0
        await mutateIncoming(
          db,
          orgId,
          mrKey,
          ctx.actor,
          (doc, { clock }) => {
            const out = closeWorkshopQuestions(doc.lines, clock)
            closed = out.closed.filter((no) => nos.includes(no)).length
            return { doc: { ...doc, lines: out.lines }, ...(out.closed.length ? { log: [{ act: "workshop_closed", note: out.closed.join(",") }] } : {}) }
          },
          { off: ctx.off, now: ctx.now }
        )
        bump(counts, "workshopAsksReturned", closed)
      }
      return
    }
    case "keep_workshop_answers": {
      bump(counts, "workshopAnswersKept", step.requestIds.length)
      return
    }
    case "sites_to_ordinary": {
      const projects = (await db.collection("projects").where("organizationId", "==", orgId).get()).docs.map((p) => ({ id: p.id, ...(p.data() as { name?: string; location?: string | null; status?: string | null }) }))
      const n = await changeSites(db, orgId, (stored) => {
        // The projects not stored yet would have appeared as sites while Project Management was on: they are stored now, as ordinary sites.
        const projectSites = deliverySites({ stored, warehouses: [], projects, pmOn: true }).filter((s) => s.kind === "project")
        if (!projectSites.length) return { list: stored, count: 0 }
        const ordinary = (s: DeliverySite): DeliverySite => ({ ...s, kind: "site" })
        const added = projectSites.filter((s) => !stored.some((x) => x.id === s.id)).map(ordinary)
        return { list: [...stored.map((s) => (s.kind === "project" ? ordinary(s) : s)), ...added], count: projectSites.length }
      })
      bump(counts, "sitesConverted", n)
      return
    }
    case "link_sites": {
      const n = await changeSites(db, orgId, (stored) => {
        const wanted = new Map(step.links.map((l) => [l.siteId, l.projectId]))
        const linkable = stored.filter((s) => wanted.has(s.id) && !s.projectId)
        return { list: stored.map((s) => (wanted.has(s.id) && !s.projectId ? { ...s, projectId: wanted.get(s.id) as string } : s)), count: linkable.length }
      })
      bump(counts, "sitesLinked", n)
      return
    }
    case "add_workshop_site": {
      const warehouse = (await db.collection("warehouses").doc(step.warehouseId).get()).data() as { name?: string; location?: string | null } | undefined
      if (!warehouse) return
      const n = await changeSites(db, orgId, (stored) => {
        if (stored.some((s) => s.kind === "workshop" && s.warehouseId === step.warehouseId)) return { list: stored, count: 0 }
        const site: DeliverySite = { id: warehouseSiteId(step.warehouseId), kind: "workshop", name: warehouse.name || step.warehouseId, city: "", district: "", address: (warehouse.location || "").trim(), receiverId: null, warehouseId: step.warehouseId }
        return { list: [...stored.filter((s) => s.id !== site.id), site], count: 1 }
      })
      bump(counts, "workshopSitesAdded", n)
      return
    }
  }
}

/** One connector's change applied to the live records. The plan is read fresh, so a second run lists no step and writes nothing. */
export async function applyConnectorChange(db: Firestore, orgId: string, conn: Connector, to: "on" | "off", ctx: ApplyCtx): Promise<AppliedCounts> {
  const snapshot = await loadPackageSnapshot(db, orgId)
  const plan: ConnectorPlan = planChange(snapshot, conn, to)
  const counts: AppliedCounts = {}
  for (const step of plan.steps) await stepApply(db, orgId, step, snapshot, ctx, counts)
  return counts
}

interface HistoryEntry {
  id: string
  connector: Connector
  to: "on" | "off"
  state?: string
  applied?: AppliedCounts
  appliedAt?: string
  [k: string]: unknown
}

/** A connector change of ours that has not been applied yet — an entry without a connector and a direction is none of the job's business. */
const isPending = (e: unknown): e is HistoryEntry => {
  const entry = e as HistoryEntry | null
  return Boolean(entry && typeof entry === "object" && entry.id && (CONNECTORS as readonly string[]).includes(entry.connector) && (entry.to === "on" || entry.to === "off") && entry.state !== "done")
}

export interface PendingRun {
  /** The history entries now done by this run (applied or found superseded), by id. */
  done: string[]
  /** The counts each entry applied. */
  applied: Record<string, AppliedCounts>
}

/**
 * Runs every history entry still `pending` for a company, oldest first, and marks it `done` with what it applied. Re-runnable: an entry
 * already done is skipped; a pending entry whose connector the saved package has since put back the other way is superseded — marked
 * done with nothing applied, never run against the opposite state.
 */
export async function applyPendingChanges(db: Firestore, orgId: string, ctx: Omit<ApplyCtx, "off"> & { off?: string[] }): Promise<PendingRun> {
  const ref = db.collection(COMPANY_MODULES).doc(orgId)
  const stored = (await ref.get()).data() ?? {}
  const off: string[] = ctx.off ?? (Array.isArray(stored.off) ? (stored.off as string[]) : [])
  const history: HistoryEntry[] = Array.isArray(stored.history) ? (stored.history as HistoryEntry[]) : []
  const now = ctx.now ?? new Date()
  const run: PendingRun = { done: [], applied: {} }
  const finished = new Map<string, { applied: AppliedCounts; appliedAt: string }>()
  const current = packageOf(off)

  for (const entry of history) {
    if (!isPending(entry)) continue
    const superseded = current[entry.connector] !== (entry.to === "on")
    const applied = superseded ? {} : await applyConnectorChange(db, orgId, entry.connector, entry.to, { ...ctx, off, now })
    finished.set(entry.id, { applied, appliedAt: now.toISOString() })
    run.done.push(entry.id)
    run.applied[entry.id] = applied
  }
  if (!finished.size) return run

  // The history is read again at the write: an entry another save appended meanwhile is kept as it is.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const latest: HistoryEntry[] = Array.isArray(snap.data()?.history) ? (snap.data()?.history as HistoryEntry[]) : []
    tx.update(ref, { history: latest.map((e) => (e && finished.has(e.id) ? { ...e, state: "done", applied: finished.get(e.id)?.applied ?? {}, appliedAt: finished.get(e.id)?.appliedAt } : e)) })
  })
  return run
}

export const pendingEntries = (history: unknown): number => (Array.isArray(history) ? history.filter(isPending).length : 0)

