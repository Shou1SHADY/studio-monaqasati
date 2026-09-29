// PM 1.0 — the handover's writes (WF-01, HO-01…04). CRM sends a FILE; the
// manager it is addressed to accepts it (creating the project), returns it for
// completion, or passes it on. Each answer is one transaction that re-reads the
// file, so two managers — or two tabs — cannot both act on it.

import { addDoc, collection, doc, runTransaction, serverTimestamp, setDoc, updateDoc, type Firestore } from "firebase/firestore"
import { CRM_OPPORTUNITIES, type CrmOpportunity } from "../crm"
import { defaultEnabledSections } from "../project-sections"
import { drawYearlyDocNumber } from "../sales-numbering"
import { advanceEvent, eventDocId, PM_EVENTS } from "./events"
import {
  acceptBlocks,
  isSelfDevelopment,
  mayActOnHandover,
  PM_HANDOVERS,
  reassignBlocks,
  returnBlocks,
  type HandoverMissing,
  type PmHandover,
  type ProjectKind,
  type ReassignReason,
} from "./handover"
import { defaultTerms, termProblems, type ContractTerms } from "./terms"

export class PmHandoverError extends Error {
  constructor(readonly code: "missing" | "not_yours" | "not_waiting" | "blocked" | "invalid") {
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
}
export const fileExtras = (h: PmHandover): HandoverExtras => {
  const x = h as PmHandover & HandoverExtras
  return { region: x.region?.trim() || null, consultantName: x.consultantName?.trim() || null, dealNo: x.dealNo?.trim() || null }
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
}

export async function sendHandoverFile(firestore: Firestore, input: SendHandoverInput): Promise<string> {
  const file: Omit<PmHandover, "id"> & HandoverExtras = {
    region: input.region?.trim() || null,
    consultantName: input.opportunity.consultantName?.trim() || null,
    dealNo: (input.opportunity as CrmOpportunity & { docNumber?: string | null }).docNumber?.trim() || null,
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
}

/**
 * Accept: the project is born "plan" with its number, its original terms (still
 * editable until Start), the manager seated as project manager, and the
 * advance-payment term sent to Finance once under its key (WF-01 step 4).
 * The BOQ is written by the wizard right after, as the new-project wizard does.
 */
export async function acceptHandover(firestore: Firestore, actor: PmActor, handoverId: string, input: AcceptInput): Promise<{ projectId: string; projectNo: string }> {
  if (!input.manager?.uid) throw new PmHandoverError("invalid")
  const hRef = doc(firestore, PM_HANDOVERS, handoverId)
  const projectRef = doc(collection(firestore, "projects"))
  const storeRef = input.store ? doc(collection(firestore, "warehouses")) : null
  const note = input.note?.trim() || null
  let projectNo = ""
  let file: PmHandover | null = null

  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(hRef)
    const h = mustAnswer(snap.exists() ? ({ id: snap.id, ...snap.data() } as PmHandover) : undefined, actor)
    if (acceptBlocks(h).length) throw new PmHandoverError("blocked")
    const terms = input.terms ?? defaultTerms({ advance: h.advance, retention: h.retention, selfDevelopment: isSelfDevelopment(input.kind) })
    if (termProblems(terms).length) throw new PmHandoverError("invalid")
    projectNo = await drawYearlyDocNumber(firestore, tx, h.organizationId, "PJ")
    const event = advanceEvent({ organizationId: h.organizationId, projectId: projectRef.id, projectNo, contractValue: h.value, terms, by: actor.uid, at: new Date().toISOString() })
    file = h

    tx.set(projectRef, {
      organizationId: h.organizationId,
      contractorId: actor.uid,
      name: h.title,
      description: h.note,
      location: input.location ?? h.location,
      region: input.region?.trim() || fileExtras(h).region || null,
      consultant: fileExtras(h).consultantName || null,
      budget: h.value,
      status: "approved_waiting_start",
      projectType: input.kind,
      clientName: h.clientName,
      clientType: h.clientType,
      blueprintUrl: null,
      enabledSections: input.enabledSections.length ? input.enabledSections : Array.from(defaultEnabledSections()),
      rfqIds: [],
      sourceOpportunityId: h.opportunityId,
      pmHandoverId: h.id,
      contractNumber: h.contractNumber,
      projectManagerId: input.manager.uid,
      projectManagerName: input.manager.name,
      ...(storeRef ? { warehouseId: storeRef.id } : {}),
      pm: {
        no: projectNo,
        lifecycle: "plan",
        kind: input.kind,
        startOn: h.startOn,
        durationDays: h.durationDays,
        signedOn: h.signedOn,
        terms,
        original: null,
        startedAt: null,
        acceptNote: note,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    tx.update(hRef, { status: "acc", projectId: projectRef.id, acceptedAt: new Date().toISOString(), acceptedBy: actor.uid, acceptNote: note })
    tx.update(doc(firestore, CRM_OPPORTUNITIES, h.opportunityId), {
      projectId: projectRef.id,
      handoverStatus: "accepted",
      projectManagerId: input.manager.uid,
      projectManagerName: input.manager.name,
      updatedAt: serverTimestamp(),
    })
    if (event) tx.set(doc(firestore, PM_EVENTS, eventDocId(event.key)), event)
  })

  // The seats follow the project, as the CRM handover did: separate writes so
  // the rules can read the project that now exists.
  const orgId = (file as PmHandover | null)?.organizationId ?? null
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
        location: input.location ?? (file as PmHandover | null)?.location ?? null,
        description: null,
        organizationId: orgId,
        centralWarehouseId: input.store.centralWarehouseId,
        projectId: projectRef.id,
        projectName: (file as PmHandover | null)?.title ?? null,
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
  const requester = (file as PmHandover | null)?.requestedBy
  if (requester && requester !== actor.uid && input.notification) {
    await notify(firestore, requester, { ...input.notification, type: "project_handover_accepted", projectId: projectRef.id, pmHandoverId: handoverId })
  }
  return { projectId: projectRef.id, projectNo }
}
