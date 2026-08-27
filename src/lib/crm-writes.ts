import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore"
import {
  CRM_ACTIVITIES,
  CRM_CONTACTS,
  CRM_OPPORTUNITIES,
  CRM_QUOTATIONS,
  historyEntry,
  isoDateIn,
  opportunityBestValue,
  stageHistory,
  type ActivityType,
  type CrmContact,
  type CrmOpportunity,
  type HandoverStatus,
  type ProjectHandover,
} from "@/lib/crm"
import { defaultEnabledSections } from "@/lib/project-sections"

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 500

async function commitInBatches(
  firestore: Firestore,
  refs: DocumentReference[],
  apply: (batch: ReturnType<typeof writeBatch>, ref: DocumentReference) => void
) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(firestore)
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) apply(batch, ref)
    await batch.commit()
  }
}

async function childRefs(firestore: Firestore, orgId: string, contactId: string): Promise<DocumentReference[]> {
  const refs: DocumentReference[] = []
  for (const collectionName of [CRM_OPPORTUNITIES, CRM_QUOTATIONS, CRM_ACTIVITIES]) {
    const snapshot = await getDocs(
      query(
        collection(firestore, collectionName),
        where("organizationId", "==", orgId),
        where("contactId", "==", contactId)
      )
    )
    snapshot.forEach((docSnap) => refs.push(docSnap.ref))
  }
  return refs
}

/**
 * Delete a contact and everything hanging off it. Opportunities, quotations
 * and activities are top-level documents keyed by `contactId`, so without this
 * they survive their contact — invisible in the UI but still counted by every
 * pipeline query that sums the whole organization.
 *
 * Children go first: if the run dies halfway, what is left is a contact with
 * fewer children (recoverable, and the page still renders) rather than orphans
 * with no contact to reach them through.
 */
export async function deleteContactCascade(firestore: Firestore, contactId: string, orgId: string) {
  const children = await childRefs(firestore, orgId, contactId)
  await commitInBatches(firestore, children, (batch, ref) => batch.delete(ref))
  await deleteDoc(doc(firestore, CRM_CONTACTS, contactId))
}

/**
 * Delete an opportunity and the quotations and activities that reference it.
 * Activities keep their contact link — a logged call still happened even if
 * the deal it was logged against is gone — so only the deal reference is
 * cleared, while quotations (which are versions OF the deal) are removed.
 */
export async function deleteOpportunityCascade(firestore: Firestore, opportunityId: string, orgId: string) {
  const quotes = await getDocs(
    query(
      collection(firestore, CRM_QUOTATIONS),
      where("organizationId", "==", orgId),
      where("opportunityId", "==", opportunityId)
    )
  )
  await commitInBatches(
    firestore,
    quotes.docs.map((d) => d.ref),
    (batch, ref) => batch.delete(ref)
  )

  const activities = await getDocs(
    query(
      collection(firestore, CRM_ACTIVITIES),
      where("organizationId", "==", orgId),
      where("opportunityId", "==", opportunityId)
    )
  )
  await commitInBatches(
    firestore,
    activities.docs.map((d) => d.ref),
    (batch, ref) => batch.update(ref, { opportunityId: null, opportunityTitle: null })
  )

  await deleteDoc(doc(firestore, CRM_OPPORTUNITIES, opportunityId))
}

/**
 * Push a renamed contact into the denormalised `contactName` its opportunities,
 * quotations and activities carry — that copy is what the org-wide lists
 * render, so a rename that stops here would leave the pipeline showing the old
 * name.
 *
 * Best-effort by design: a stale label is a cosmetic problem, and it must not
 * turn a successful rename into a failed save.
 */
export async function renameContactReferences(
  firestore: Firestore,
  contactId: string,
  orgId: string,
  newName: string
) {
  try {
    const children = await childRefs(firestore, orgId, contactId)
    await commitInBatches(firestore, children, (batch, ref) => batch.update(ref, { contactName: newName }))
  } catch (err) {
    console.error("Failed to propagate CRM contact rename", err)
  }
}

// ---------------------------------------------------------------------------
// Handover — the CRM's last step
// ---------------------------------------------------------------------------

export interface HandoverInput {
  opportunity: CrmOpportunity
  contact?: CrmContact | null
  orgId: string
  /** The signed-in member's uid — becomes the project's `contractorId`, the
   * same field the manual "new project" wizard writes. */
  userId: string
  contractNumber: string
  durationMonths: number | null
  advancePercent: number | null
  retentionPercent: number | null
  /** The project manager being asked to take the project. Required: a
   * handover nobody is asked to accept is a project nobody knows about. */
  projectManagerId: string
  projectManagerName?: string | null
  /** The PM's default permission group, copied onto the project assignment. */
  projectManagerGroupId?: string | null
  /** Who is handing over — where a rejection gets reported back to. */
  requestedByName?: string | null
  notes?: string | null
  /** Title for the auto-created kickoff meeting. Localised by the caller. */
  kickoffTitle?: string
  /** Notification copy for the PM. Localised by the caller. */
  notification?: { title: string; message: string }
}

/**
 * Turn a won opportunity into a real project.
 *
 * The project doc is written with exactly the shape `projects/new` produces —
 * same field names, same `enabledSections` defaults, same empty `rfqIds` —
 * so a generated project is indistinguishable from a hand-created one
 * everywhere downstream (the projects list, the BOQ tab, tenders, warehouses).
 *
 * The project is created BEFORE the opportunity is stamped: if the second
 * write fails, the org has a real project and a deal that can be handed over
 * again, which is recoverable. The reverse order would strand a deal marked
 * "handed over" with nothing on the other side.
 */
export async function createProjectFromOpportunity(
  firestore: Firestore,
  input: HandoverInput
): Promise<string> {
  const { opportunity, contact, orgId, userId } = input

  const budget = opportunityBestValue(opportunity)

  const handover: ProjectHandover = {
    status: "pending",
    pmId: input.projectManagerId,
    pmName: input.projectManagerName?.trim() || null,
    requestedByUserId: userId,
    requestedByName: input.requestedByName?.trim() || null,
    requestedAt: new Date().toISOString(),
    respondedAt: null,
    rejectReason: null,
    opportunityId: opportunity.id,
  }

  const projectRef = await addDoc(collection(firestore, "projects"), {
    organizationId: orgId || userId,
    contractorId: userId,
    name: opportunity.title,
    description: input.notes?.trim() || opportunity.notes || null,
    location: contact?.city || null,
    region: null,
    budget: budget > 0 ? budget : null,
    // A handed-over deal is signed but not started — "approved, waiting start"
    // is the status a project manager expects to find it in.
    status: "approved_waiting_start",
    projectType: null,
    clientName: opportunity.contactName || contact?.name || null,
    clientType: contact?.entityType || null,
    blueprintUrl: null,
    enabledSections: Array.from(defaultEnabledSections()),
    rfqIds: [],
    // Provenance, so a project can always be traced back to the deal that won it.
    sourceOpportunityId: opportunity.id,
    contractNumber: input.contractNumber.trim() || null,
    durationMonths: input.durationMonths ?? null,
    advancePercent: input.advancePercent ?? null,
    retentionPercent: input.retentionPercent ?? null,
    projectManagerId: input.projectManagerId,
    projectManagerName: input.projectManagerName?.trim() || null,
    handover,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  // The PM becomes a member of the project with the same group they hold
  // org-wide, so the project shows up in their list and the permission rules
  // treat them exactly as a manually assigned member would be.
  await setDoc(
    doc(firestore, "projects", projectRef.id, "members", input.projectManagerId),
    {
      userId: input.projectManagerId,
      groupId: input.projectManagerGroupId ?? null,
      organizationId: orgId || userId,
      addedBy: userId,
      viaHandover: true,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  )

  await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opportunity.id), {
    state: "handed_over",
    stage: "won",
    stageHistory: [...(opportunity.stageHistory ?? []), historyEntry("handed_over", input.requestedByName ?? null)],
    projectId: projectRef.id,
    contractNumber: input.contractNumber.trim() || null,
    durationMonths: input.durationMonths ?? null,
    advancePercent: input.advancePercent ?? null,
    retentionPercent: input.retentionPercent ?? null,
    projectManagerId: input.projectManagerId,
    projectManagerName: input.projectManagerName?.trim() || null,
    handoverStatus: "pending",
    handoverRejectReason: null,
    handedOverAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  // Tell the PM. Without this the project exists and nobody who has to run
  // it knows — which is the gap the whole accept/reject step exists to close.
  if (input.notification) {
    await notifyUser(firestore, input.projectManagerId, {
      ...input.notification,
      type: "project_handover",
      organizationId: orgId || userId,
      projectId: projectRef.id,
      opportunityId: opportunity.id,
    })
  }

  // A handed-over project that nobody kicks off is how a signed contract sits
  // untouched for three weeks. Best-effort — the handover already succeeded.
  await createFollowUp(firestore, {
    orgId,
    contactId: opportunity.contactId,
    contactName: opportunity.contactName,
    opportunityId: opportunity.id,
    opportunityTitle: opportunity.title,
    type: "meeting",
    title: input.kickoffTitle ?? `${opportunity.title} — ${input.contractNumber}`,
    dueInDays: 7,
    ownerName: input.projectManagerName ?? null,
  })

  return projectRef.id
}

/**
 * In-app notification for one user. Same shape the invitation and offer
 * routes write, so the notifications page renders it without a new branch.
 * Best-effort: a notification that fails must not fail the action it reports.
 */
async function notifyUser(
  firestore: Firestore,
  userId: string,
  data: { title: string; message: string; type: string } & Record<string, unknown>
): Promise<void> {
  try {
    await addDoc(collection(firestore, "users", userId, "notifications"), {
      ...data,
      createdAt: new Date().toISOString(),
      read: false,
    })
  } catch (err) {
    console.error("Failed to write notification", err)
  }
}

export interface HandoverResponseInput {
  projectId: string
  handover: ProjectHandover
  decision: Exclude<HandoverStatus, "pending">
  /** Required when rejecting. */
  reason?: string | null
  /** The responding PM. */
  userId: string
  userName?: string | null
  /** Notification copy for whoever handed the project over. Localised by the caller. */
  notification?: { title: string; message: string }
}

/**
 * The PM's answer to a handover.
 *
 * Accepting stamps the project and the deal. Rejecting sends the deal back to
 * "won" so the CRM can hand it to someone else; the project stays, marked
 * rejected, because deleting another module's record from the CRM is not
 * this function's call. Either way the person who handed it over is told.
 */
export async function respondToHandover(firestore: Firestore, input: HandoverResponseInput): Promise<void> {
  const respondedAt = new Date().toISOString()
  const reason = input.decision === "rejected" ? input.reason?.trim() || null : null
  const nextHandover: ProjectHandover = {
    ...input.handover,
    status: input.decision,
    respondedAt,
    rejectReason: reason,
  }

  await updateDoc(doc(firestore, "projects", input.projectId), {
    handover: nextHandover,
    updatedAt: serverTimestamp(),
  })

  const opportunityId = input.handover.opportunityId
  if (opportunityId) {
    const oppRef = doc(firestore, CRM_OPPORTUNITIES, opportunityId)
    const snap = await getDoc(oppRef)
    if (snap.exists()) {
      const opp = snap.data() as CrmOpportunity
      const event = input.decision === "accepted" ? "handover_accepted" : "handover_rejected"
      await updateDoc(oppRef, {
        handoverStatus: input.decision,
        handoverRejectReason: reason,
        // A rejected handover is a won deal again — the project it produced
        // is not the one that will be run, so the link is dropped too.
        ...(input.decision === "rejected"
          ? { state: "won", projectId: null, projectManagerId: null, projectManagerName: null }
          : {}),
        stageHistory: [...stageHistory(opp), historyEntry(event, input.userName ?? null)],
        updatedAt: serverTimestamp(),
      })
    }
  }

  const requester = input.handover.requestedByUserId
  if (requester && requester !== input.userId && input.notification) {
    await notifyUser(firestore, requester, {
      ...input.notification,
      type: input.decision === "accepted" ? "project_handover_accepted" : "project_handover_rejected",
      projectId: input.projectId,
      opportunityId: opportunityId ?? null,
    })
  }
}

/** Suggested contract number for a handover: `C-<year>/<sequence>`. */
export function suggestContractNumber(handedOverCount: number): string {
  return `C-${new Date().getFullYear()}/${String(handedOverCount + 1).padStart(3, "0")}`
}

// ---------------------------------------------------------------------------
// Follow-ups
//
// Moments where the workflow itself knows what happens next. Each one is
// best-effort: a missing follow-up task is an inconvenience, and it must never
// turn a successful handover or a recorded loss into a failed save.
// ---------------------------------------------------------------------------

export interface FollowUpInput {
  orgId: string
  contactId: string
  contactName?: string | null
  opportunityId?: string | null
  opportunityTitle?: string | null
  type: ActivityType
  title: string
  /** Days from today. */
  dueInDays: number
  ownerId?: string | null
  ownerName?: string | null
}

export async function createFollowUp(firestore: Firestore, input: FollowUpInput): Promise<void> {
  try {
    await addDoc(collection(firestore, CRM_ACTIVITIES), {
      type: input.type,
      title: input.title,
      contactId: input.contactId,
      contactName: input.contactName ?? null,
      opportunityId: input.opportunityId ?? null,
      opportunityTitle: input.opportunityTitle ?? null,
      dueDate: isoDateIn(input.dueInDays),
      done: false,
      notes: null,
      ownerId: input.ownerId ?? null,
      ownerName: input.ownerName ?? null,
      organizationId: input.orgId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  } catch (err) {
    console.error("Failed to create CRM follow-up", err)
  }
}

// ---------------------------------------------------------------------------
// Renewals
// ---------------------------------------------------------------------------

/**
 * Open a renewal against a contract that is running out.
 *
 * The new deal starts on the renewal track at the first stage, priced at the
 * expiring contract's value plus a modest uplift, and points back at the deal
 * it renews — which is what takes that contract off the "at risk" list.
 */
export async function createRenewalOpportunity(
  firestore: Firestore,
  params: {
    source: CrmOpportunity
    orgId: string
    /** Proposed value. Defaults to the expiring contract plus 6%. */
    value?: number
    /** ISO date the current contract ends. */
    endDate: string
    ownerId?: string | null
    ownerName?: string | null
  }
): Promise<string> {
  const { source, orgId, endDate } = params
  const previousValue = opportunityBestValue(source)
  const value = params.value && params.value > 0 ? params.value : Math.round(previousValue * 1.06)

  const created = await addDoc(collection(firestore, CRM_OPPORTUNITIES), {
    contactId: source.contactId,
    contactName: source.contactName ?? null,
    title: source.title,
    track: "renewal",
    stage: "new",
    state: "open",
    value,
    probability: 60,
    expectedCloseDate: endDate,
    ownerId: params.ownerId ?? source.ownerId ?? null,
    ownerName: params.ownerName ?? source.ownerName ?? null,
    scopeTypes: source.scopeTypes ?? [],
    customScopeType: source.customScopeType ?? null,
    customScopeActivity: source.customScopeActivity ?? null,
    route: source.route ?? null,
    contractKind: source.contractKind ?? null,
    source: "existing_client",
    renewalOfOpportunityId: source.id,
    previousContractValue: previousValue,
    completedGates: [],
    approvalStatus: "none",
    stageHistory: [historyEntry("new", params.ownerName ?? source.ownerName ?? null)],
    addenda: [],
    notes: null,
    organizationId: orgId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return created.id
}
