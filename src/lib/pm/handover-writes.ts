// PM 1.0 — the handover's writes (WF-01, HO-01…04). CRM sends a FILE; the
// manager it is addressed to accepts it (creating the project), returns it for
// completion, or passes it on. Each answer is one transaction that re-reads the
// file, so two managers — or two tabs — cannot both act on it.

import { addDoc, collection, doc, runTransaction, serverTimestamp, setDoc, updateDoc, type DocumentData, type Firestore, type Transaction, type UpdateData } from "firebase/firestore"
import { CRM_OPPORTUNITIES, type CrmOpportunity } from "../crm"
import {
  mayActOnHandover,
  PM_HANDOVERS,
  reassignBlocks,
  returnBlocks,
  type HandoverMissing,
  type PmHandover,
  type ProjectKind,
  type ReassignReason,
  type BoqSource,
} from "./handover"
import type { ContractTerms } from "./terms"
import { pmCeiling } from "./access"
import { getAuth } from "firebase/auth"
import { acceptHandoverCore, AcceptCoreError, type AcceptBoqGroup, type AcceptBoqLine, type AcceptCoreInput, type AcceptCoreResult } from "./handover-accept"

export class PmHandoverError extends Error {
  constructor(readonly code: "missing" | "not_yours" | "not_waiting" | "blocked" | "invalid" | "not_candidate" | "boq_from_crm" | "boq_empty") {
    super(code)
    this.name = "PmHandoverError"
  }
}

export interface PmActor {
  uid: string
  name: string | null
  /** The org owner may act on any waiting file, not only one addressed to them. */
  owner?: boolean
}

type Notice = { title: string; message: string }

async function notify(firestore: Firestore, userId: string, data: Notice & Record<string, unknown>) {
  try {
    await addDoc(collection(firestore, "users", userId, "notifications"), { ...data, createdAt: new Date().toISOString(), read: false })
  } catch (err) {
    console.error("Failed to write notification", err)
  }
}

const today = () => new Date().toISOString().slice(0, 10)

// ---------------------------------------------------------------------------
// CRM sends the file — it creates no project (HO-01, conflict 3)
// ---------------------------------------------------------------------------

/** What a file carries beyond PmHandover's contract fields: the region and the
 * supervising consultant CRM knew (the prototype's HO.reg / HO.cons). */
export interface HandoverExtras {
  region?: string | null
  consultantName?: string | null
  /** The CRM deal's own number, when the deal carries one. */
  dealNo?: string | null
  /** The files CRM sent with it (Opportunity journey v1.1, OPP-07 #4): the signed contract, the priced BOQ and whatever
   * else was picked from the deal's files — Storage paths, opened with a fresh link. */
  files?: Array<{ name: string; path: string; kind?: string | null }> | null
  /** The offer the client accepted — attached by itself; its PDF is Sales' document for that version. */
  acceptedOffer?: { id: string; number: string; amount: number } | null
}
export const fileExtras = (h: PmHandover): HandoverExtras => {
  const x = h as PmHandover & HandoverExtras
  return {
    region: x.region?.trim() || null,
    consultantName: x.consultantName?.trim() || null,
    dealNo: x.dealNo?.trim() || null,
    files: Array.isArray(x.files) ? x.files : [],
    acceptedOffer: x.acceptedOffer ?? null,
  }
}

export interface SendHandoverInput {
  organizationId: string
  actor: PmActor
  opportunity: CrmOpportunity
  clientType: string | null
  location: string | null
  region?: string | null
  contractNumber: string | null
  value: number
  durationDays: number
  signedOn: string | null
  startOn: string | null
  advance: number | null
  retention: number | null
  kind: ProjectKind | null
  note: string | null
  to: string
  toName: string | null
  notification?: Notice
  files?: HandoverExtras["files"]
  acceptedOffer?: HandoverExtras["acceptedOffer"]
}

export async function sendHandoverFile(firestore: Firestore, input: SendHandoverInput): Promise<string> {
  const file: Omit<PmHandover, "id"> & HandoverExtras = {
    region: input.region?.trim() || null,
    consultantName: input.opportunity.consultantName?.trim() || null,
    dealNo: input.opportunity.docNumber?.trim() || null,
    files: input.files ?? [],
    acceptedOffer: input.acceptedOffer ?? null,
    organizationId: input.organizationId,
    status: "wait",
    to: input.to,
    toName: input.toName,
    opportunityId: input.opportunity.id,
    contactId: input.opportunity.contactId ?? null,
    title: input.opportunity.title,
    clientName: input.opportunity.contactName ?? null,
    clientType: input.clientType,
    kind: input.kind,
    location: input.location,
    contractNumber: input.contractNumber?.trim() || null,
    value: input.value,
    durationDays: input.durationDays,
    signedOn: input.signedOn,
    startOn: input.startOn,
    advance: input.advance,
    retention: input.retention,
    note: input.note?.trim() || null,
    requestedBy: input.actor.uid,
    requestedByName: input.actor.name,
    createdAt: new Date().toISOString(),
    reassigns: [],
    returned: null,
    projectId: null,
    acceptedAt: null,
  }
  const ref = await addDoc(collection(firestore, PM_HANDOVERS), file)
  await updateDoc(doc(firestore, CRM_OPPORTUNITIES, input.opportunity.id), {
    state: "handed_over",
    stage: "won",
    pmHandoverId: ref.id,
    projectId: null,
    contractNumber: file.contractNumber,
    durationDays: input.durationDays,
    advancePercent: input.advance,
    retentionPercent: input.retention,
    projectManagerId: input.to,
    projectManagerName: input.toName,
    handoverStatus: "pending",
    handoverRejectReason: null,
    handedOverAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  if (input.notification) await notify(firestore, input.to, { ...input.notification, type: "project_handover", organizationId: input.organizationId, pmHandoverId: ref.id, link: "/contractor/projects/inbox" })
  return ref.id
}

// ---------------------------------------------------------------------------
// The addressed manager answers
// ---------------------------------------------------------------------------

function mustAnswer(h: PmHandover | undefined, actor: PmActor): PmHandover {
  if (!h) throw new PmHandoverError("missing")
  if (!mayActOnHandover({ uid: actor.uid, owner: Boolean(actor.owner) }, h)) throw new PmHandoverError("not_yours")
  if (h.status !== "wait") throw new PmHandoverError("not_waiting")
  return h
}

/**
 * HO-04 — whether `uid` may be handed a file: the organisation's owner, or a
 * member whose DEFAULT group gives the PM ceiling `approve` (a project manager).
 * Read inside the caller's transaction: a group changed meanwhile is seen.
 */
export async function mayReceiveHandover(tx: Transaction, firestore: Firestore, organizationId: string, uid: string): Promise<boolean> {
  if (!uid) return false
  if (uid === organizationId) return true
  const snap = await tx.get(doc(firestore, "users", uid))
  if (!snap.exists()) return false
  const u = snap.data() as { organizationId?: string; organizationRole?: string | null; defaultGroupId?: string | null }
  if ((u.organizationId ?? uid) !== organizationId) return false
  if (!("organizationRole" in u) || u.organizationRole === "owner") return true
  if (!u.defaultGroupId) return false
  const g = await tx.get(doc(firestore, "teamGroups", u.defaultGroupId))
  const permissions = g.exists() ? (((g.data() as { permissions?: unknown }).permissions as string[] | undefined) ?? []) : []
  return pmCeiling({ owner: false, permissions }).has("approve")
}

export async function reassignHandover(
  firestore: Firestore,
  actor: PmActor,
  handoverId: string,
  input: { to: string; toName: string | null; reason: ReassignReason; reasonText?: string | null; notification?: Notice }
): Promise<void> {
  const ref = doc(firestore, PM_HANDOVERS, handoverId)
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const h = mustAnswer(snap.exists() ? ({ id: snap.id, ...snap.data() } as PmHandover) : undefined, actor)
    if (reassignBlocks(h, input.to, input.reason, input.reasonText).length) throw new PmHandoverError("invalid")
    // HO-04 (FX-07): only to a project manager or the owner — checked here, not by the list the screen showed.
    if (!(await mayReceiveHandover(tx, firestore, h.organizationId, input.to))) throw new PmHandoverError("not_candidate")
    tx.update(ref, {
      to: input.to,
      toName: input.toName,
      reassigns: [...(h.reassigns ?? []), { from: h.to, to: input.to, reason: input.reason, reasonText: input.reasonText?.trim() || null, by: actor.uid, at: new Date().toISOString() }],
    })
    tx.update(doc(firestore, CRM_OPPORTUNITIES, h.opportunityId), { projectManagerId: input.to, projectManagerName: input.toName, updatedAt: serverTimestamp() })
  })
  if (input.notification) await notify(firestore, input.to, { ...input.notification, type: "project_handover", pmHandoverId: handoverId, link: "/contractor/projects/inbox" })
}

export async function returnHandover(
  firestore: Firestore,
  actor: PmActor,
  handoverId: string,
  input: { missing: HandoverMissing[]; note?: string | null; missingText: string; notification?: Notice }
): Promise<void> {
  if (returnBlocks(input.missing).length) throw new PmHandoverError("invalid")
  const ref = doc(firestore, PM_HANDOVERS, handoverId)
  let requester = ""
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const h = mustAnswer(snap.exists() ? ({ id: snap.id, ...snap.data() } as PmHandover) : undefined, actor)
    requester = h.requestedBy
    tx.update(ref, { status: "ret", returned: { missing: input.missing, note: input.note?.trim() || null, by: actor.uid, at: new Date().toISOString() } })
    // The deal is won again until CRM completes the file and sends it anew.
    tx.update(doc(firestore, CRM_OPPORTUNITIES, h.opportunityId), {
      state: "won",
      handoverStatus: "rejected",
      handoverRejectReason: [input.missingText, input.note?.trim()].filter(Boolean).join(" — "),
      pmHandoverId: null,
      updatedAt: serverTimestamp(),
    })
  })
  if (requester && requester !== actor.uid && input.notification) await notify(firestore, requester, { ...input.notification, type: "project_handover_rejected", pmHandoverId: handoverId })
}

/** A person seated by the acceptance, with their default group copied onto the seat. */
export interface AcceptSeat {
  uid: string
  name: string | null
  groupId: string | null
}

export interface AcceptInput {
  kind: ProjectKind
  location: string | null
  /** The region — the file's, unless the acceptor states it; null = not stated. */
  region?: string | null
  enabledSections: string[]
  terms?: ContractTerms
  /** The project's manager — the acceptor by default; no project is born without one. */
  manager: AcceptSeat
  /** Optional: the site engineer, seated with the site role (it narrows, never widens). */
  siteEngineer?: AcceptSeat | null
  /** Reservations, assumptions, anything agreed verbally. */
  note?: string | null
  /** A site store for the project in Inventory, when the store section is on. */
  store?: { name: string; centralWarehouseId: string | null } | null
  notification?: Notice
  /** Told to the named manager when it is not the acceptor. */
  managerNotification?: Notice
  /** Where the BOQ comes from (default «later»). A file with a priced BOQ takes only «crm» — its own lines. */
  source?: BoqSource
  /** An Excel / typed BOQ's lines, written in the acceptance itself. */
  lines?: AcceptBoqLine[]
  groups?: AcceptBoqGroup[]
}

/** Calls the server's acceptance (`/api/pm/handover-accept`) — or, in tests, the same core over another store. */
export type AcceptTransport = (handoverId: string, input: AcceptCoreInput) => Promise<AcceptCoreResult>

const ACCEPT_URL = "/api/pm/handover-accept"

/** The browser's transport: the signed-in user's ID token to the server route. */
export const routeAcceptTransport: AcceptTransport = async (handoverId, input) => {
  const token = (await getAuth().currentUser?.getIdToken().catch(() => "")) || ""
  const res = await fetch(ACCEPT_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ handoverId, ...input }) })
  const json = (await res.json().catch(() => null)) as { data?: AcceptCoreResult; code?: string } | null
  if (!res.ok || !json?.data) throw new PmHandoverError(((json?.code as PmHandoverError["code"]) || "invalid") as PmHandoverError["code"])
  return json.data
}

/** The same core over the client SDK — for the in-memory Firestore of the tests only: in production the
 * rules refuse a client creating a project and its BOQ lines together, which is why the route exists. */
export const localAcceptTransport =
  (firestore: Firestore, actor: { uid: string; owner: boolean }): AcceptTransport =>
  (handoverId, input) =>
    acceptHandoverCore(
      {
        run: (fn) =>
          runTransaction(firestore, (t) =>
            fn({
              get: async (path) => {
                const snap = await t.get(doc(firestore, path))
                return snap.exists() ? (snap.data() as Record<string, unknown>) : null
              },
              set: (path, data) => {
                t.set(doc(firestore, path), data)
              },
              update: (path, data) => {
                t.update(doc(firestore, path), data as UpdateData<DocumentData>)
              },
            })
          ),
        newId: (col) => doc(collection(firestore, col)).id,
        stamp: () => serverTimestamp(),
      },
      actor,
      handoverId,
      input
    ).catch((err) => {
      throw err instanceof AcceptCoreError ? new PmHandoverError(err.code) : err
    })

/**
 * Accept: the project is born "plan" with its number, its original terms (still
 * editable until Start), the manager seated as project manager, the
 * advance-payment term sent to Finance once under its key (WF-01 step 4) and
 * frozen beside it (IPC-07) — and its BOQ, in the SAME server transaction
 * (CON-01: a file's priced BOQ is transferred as sent, nothing else). The seats,
 * the site store and the notices follow, as before.
 */
export async function acceptHandover(firestore: Firestore, actor: PmActor, handoverId: string, input: AcceptInput, transport: AcceptTransport = routeAcceptTransport): Promise<{ projectId: string; projectNo: string; lines: number }> {
  if (!input.manager?.uid) throw new PmHandoverError("invalid")
  const note = input.note?.trim() || null
  const result = await transport(handoverId, {
    kind: input.kind,
    location: input.location,
    region: input.region ?? null,
    enabledSections: input.enabledSections,
    ...(input.terms ? { terms: input.terms } : {}),
    manager: { uid: input.manager.uid, name: input.manager.name },
    note,
    wantsStore: Boolean(input.store),
    source: input.source ?? "later",
    lines: input.lines ?? [],
    groups: input.groups ?? [],
  })
  const projectRef = doc(firestore, "projects", result.projectId)
  const projectNo = result.projectNo
  const storeRef = result.storeId ? doc(firestore, "warehouses", result.storeId) : null
  const file = { organizationId: result.organizationId, location: result.location, title: result.title, requestedBy: result.requestedBy } as Pick<PmHandover, "organizationId" | "location" | "title" | "requestedBy">

  // The seats follow the project, as the CRM handover did: separate writes so
  // the rules can read the project that now exists.
  const orgId = file.organizationId ?? null
  const seat = (who: AcceptSeat, pmRole: "pm" | "site") =>
    setDoc(doc(firestore, "projects", projectRef.id, "members", who.uid), {
      userId: who.uid,
      groupId: who.groupId,
      organizationId: orgId,
      addedBy: actor.uid,
      viaHandover: true,
      pmRole,
      off: [],
      from: today(),
      to: null,
      createdAt: serverTimestamp(),
    })
  await seat(input.manager, "pm")
  if (input.siteEngineer && input.siteEngineer.uid !== input.manager.uid) {
    try {
      await seat(input.siteEngineer, "site")
    } catch (err) {
      console.error("Failed to seat the site engineer", err)
    }
  }
  if (storeRef && input.store) {
    try {
      await setDoc(storeRef, {
        name: input.store.name,
        location: input.location ?? file.location ?? null,
        description: null,
        organizationId: orgId,
        centralWarehouseId: input.store.centralWarehouseId,
        projectId: projectRef.id,
        projectName: file.title ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      console.error("Failed to create the site store", err)
    }
  }
  if (input.manager.uid !== actor.uid && input.managerNotification) {
    await notify(firestore, input.manager.uid, { ...input.managerNotification, type: "project_manager_named", projectId: projectRef.id, link: `/contractor/projects/${projectRef.id}?tab=pmToday` })
  }
  const requester = file.requestedBy
  if (requester && requester !== actor.uid && input.notification) {
    await notify(firestore, requester, { ...input.notification, type: "project_handover_accepted", projectId: projectRef.id, pmHandoverId: handoverId })
  }
  return { projectId: projectRef.id, projectNo, lines: result.lines }
}
