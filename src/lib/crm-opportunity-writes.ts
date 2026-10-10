// Every act on an opportunity in the journey v1.1 (7 Oct 2026). Each one is a FACT recorded in the name of whoever did
// it — there is no owner on a deal before its handover (OPP-01 #2) — and each stage move happens here, behind the same
// rule the screens show (`stageMoveBlock`, `canRecordAward`), never from a free stage field.

import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type FieldValue,
  type Firestore,
} from "firebase/firestore"
import { deleteObject, ref as storageRef, uploadBytes, type FirebaseStorage } from "firebase/storage"
import {
  CRM_OPPORTUNITIES,
  CRM_QUOTATIONS,
  canRecordAward,
  gatesRemaining,
  historyEntry,
  isOpportunityOpen,
  opportunityDeliverables,
  stageHistory,
  type CrmOpportunity,
  type CrmQuotation,
  type GateContext,
  type NoGoReason,
  type OpportunityFileKind,
  type WonReason,
} from "@/lib/crm"
import { revisionPending } from "@/lib/crm-journey"
import { drawYearlyDocNumber } from "@/lib/sales-numbering"
import { createQuoteRequest, loadPermissionRecipients, type QuoteRequestFile } from "@/lib/sales-transfers"

export type OppActor = { uid: string; name: string }

/** A Sales-side notice written in the sender's language, with the keys each reader renders in theirs. */
export type NoticeCopy = { title: string; message: string; i18n: { title: string; message: string; params: Record<string, string | number | null> } }

// ---------------------------------------------------------------------------
// Create — with its number (OPP-02)
// ---------------------------------------------------------------------------

/**
 * Records a new deal and gives it its number «OP-2026/014» (shown «ف-2026/014») in the same transaction, from the
 * organisation's yearly counter. The number is never changed afterwards.
 */
export async function createOpportunity(
  firestore: Firestore,
  orgId: string,
  actor: OppActor,
  data: Omit<Partial<CrmOpportunity>, "id" | "docNumber" | "organizationId"> & { title: string; contactId: string }
): Promise<{ id: string; docNumber: string }> {
  const ref = doc(collection(firestore, CRM_OPPORTUNITIES))
  const docNumber = await runTransaction(firestore, async (tx) => {
    const number = await drawYearlyDocNumber(firestore, tx, orgId, "OP")
    tx.set(ref, {
      ...data,
      docNumber: number,
      organizationId: orgId,
      stage: "new",
      state: "open",
      completedGates: [],
      approvalStatus: "none",
      addenda: [],
      fileCounts: {},
      createdById: actor.uid,
      createdByName: actor.name,
      stageHistory: [historyEntry("new", actor.name)],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return number
  })
  return { id: ref.id, docNumber }
}

// ---------------------------------------------------------------------------
// Go / no-go (OPP-03 #3)
// ---------------------------------------------------------------------------

/** «We bid»: the decision with its name and time. Undoing it («تراجع») clears it — the history keeps both. */
export async function recordGoDecision(firestore: Firestore, opp: CrmOpportunity, actor: OppActor, go: boolean | null) {
  await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), {
    goDecision: go === null ? null : { go, at: new Date().toISOString(), byId: actor.uid, byName: actor.name },
    stageHistory: [...stageHistory(opp), historyEntry("go_decided", actor.name, go === null ? "undo" : go ? "go" : null)],
    updatedAt: serverTimestamp(),
  })
}

/** «We do not bid»: a reason is required, and the deal closes as lost «withdrew» — the decision stays in its history. */
export async function recordNoGo(firestore: Firestore, opp: CrmOpportunity, actor: OppActor, reason: NoGoReason, note: string) {
  if (!isOpportunityOpen(opp)) throw new Error("not_open")
  const at = new Date().toISOString()
  await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), {
    goDecision: { go: false, at, byId: actor.uid, byName: actor.name, reason, note: note.trim() || null },
    stage: "lost",
    state: "lost",
    lostReason: "withdrew",
    lessonLearned: note.trim() || null,
    stageHistory: [...stageHistory(opp), historyEntry("go_decided", actor.name, "no_go"), historyEntry("lost", actor.name, reason)],
    updatedAt: serverTimestamp(),
  })
}

/** «Move to qualified» — only once its conditions are facts (OPP-03, OPP-05). */
export async function qualifyOpportunity(firestore: Firestore, opp: CrmOpportunity, actor: OppActor, ctx: GateContext) {
  if (!isOpportunityOpen(opp) || opp.stage !== "new" || gatesRemaining(opp, ctx).length > 0) throw new Error("blocked")
  await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), {
    stage: "qualified",
    stageHistory: [...stageHistory(opp), historyEntry("qualified", actor.name)],
    updatedAt: serverTimestamp(),
  })
}

// ---------------------------------------------------------------------------
// Files and photos (OPP-10)
// ---------------------------------------------------------------------------

export const OPP_FILES = "files"
export const OPP_FILE_MAX_BYTES = 15 * 1024 * 1024
const ALLOWED_TYPES = [
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.ms-excel",
  "text/csv",
]

/** Images, PDF, office documents, CSV and zipped drawings — 15 MB each. */
export function oppFileAllowed(file: { type: string; size: number }): "ok" | "too_big" | "bad_type" | "empty" {
  if (file.size <= 0) return "empty"
  if (file.size > OPP_FILE_MAX_BYTES) return "too_big"
  const type = file.type || ""
  if (type.startsWith("image/") || ALLOWED_TYPES.includes(type) || type.startsWith("application/vnd.openxmlformats-officedocument.")) return "ok"
  return "bad_type"
}

/** One file of a deal: `crmOpportunities/{id}/files/{fileId}`. Storage holds the bytes; this holds who and what. */
export interface OpportunityFile {
  id: string
  organizationId: string
  opportunityId: string
  kind: OpportunityFileKind
  name: string
  /** Storage object path — opened with a fresh download URL, never a stored public link. */
  path: string
  size: number
  contentType: string
  byId: string
  byName: string
  at: string
  /** Where it came from: the add dialog, the files section, an activity, the handover. */
  source: "add" | "page" | "activity" | "handover"
  activityId?: string | null
  activityTitle?: string | null
}

const safeName = (name: string) => name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-120)

/** The Storage folder of a deal's files. */
export const oppFilePath = (orgId: string, oppId: string, stamp: number, name: string) =>
  `organizations/${orgId}/crm/opportunities/${oppId}/${stamp}_${safeName(name)}`

/**
 * Uploads files to a deal and records each one in the name of who added it. `fileCounts` moves in the same batch, so a
 * board card knows «tender documents uploaded» without reading the files (OPP-03 #2).
 */
export async function addOpportunityFiles(
  firestore: Firestore,
  storage: FirebaseStorage,
  opp: Pick<CrmOpportunity, "id" | "organizationId">,
  actor: OppActor,
  files: Array<{ file: File; kind: OpportunityFileKind }>,
  source: OpportunityFile["source"],
  activity?: { id: string; title: string } | null
): Promise<OpportunityFile[]> {
  const out: OpportunityFile[] = []
  for (const { file } of files) {
    if (oppFileAllowed(file) !== "ok") throw new Error(oppFileAllowed(file))
  }
  const batch = writeBatch(firestore)
  const counts: Partial<Record<OpportunityFileKind, number>> = {}
  let stamp = Date.now()
  for (const { file, kind } of files) {
    const path = oppFilePath(opp.organizationId, opp.id, stamp++, file.name)
    await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "application/octet-stream" })
    const ref = doc(collection(firestore, CRM_OPPORTUNITIES, opp.id, OPP_FILES))
    const entry: OpportunityFile = {
      id: ref.id,
      organizationId: opp.organizationId,
      opportunityId: opp.id,
      kind,
      name: file.name,
      path,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      byId: actor.uid,
      byName: actor.name,
      at: new Date().toISOString(),
      source,
      activityId: activity?.id ?? null,
      activityTitle: activity?.title ?? null,
    }
    const { id: _id, ...stored } = entry
    batch.set(ref, stored)
    counts[kind] = (counts[kind] || 0) + 1
    out.push(entry)
  }
  const countPatch: { [key: string]: FieldValue } = { updatedAt: serverTimestamp() }
  for (const [kind, n] of Object.entries(counts)) countPatch[`fileCounts.${kind}`] = increment(n as number)
  batch.update(doc(firestore, CRM_OPPORTUNITIES, opp.id), countPatch)
  await batch.commit()
  return out
}

/** Only the person who added a file removes it; the deal's history keeps the trace in their name (OPP-10 #7). */
export async function deleteOpportunityFile(
  firestore: Firestore,
  storage: FirebaseStorage,
  opp: CrmOpportunity,
  file: OpportunityFile,
  actor: OppActor
) {
  if (file.byId !== actor.uid) throw new Error("not_yours")
  const batch = writeBatch(firestore)
  batch.delete(doc(firestore, CRM_OPPORTUNITIES, opp.id, OPP_FILES, file.id))
  batch.update(doc(firestore, CRM_OPPORTUNITIES, opp.id), {
    [`fileCounts.${file.kind}`]: increment(-1),
    stageHistory: [...stageHistory(opp), historyEntry("file_deleted", actor.name, file.name)],
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  // The bytes go after the record: a failed object delete leaves an orphan, never a broken link.
  await deleteObject(storageRef(storage, file.path)).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Pricing at Sales (OPP-04)
// ---------------------------------------------------------------------------

const toRequestFile = (f: OpportunityFile): QuoteRequestFile => ({ name: f.name, path: f.path, kind: f.kind, contentType: f.contentType })

/**
 * «Ask Sales for a quotation» — from «qualified» only. The request lands in Sales' requests with the deal's number,
 * client, title and details, the files picked, what we deliver, the deadline and a note to the pricer; the deal moves to
 * «proposal» and says «with Sales».
 */
export async function requestPricing(
  firestore: Firestore,
  opp: CrmOpportunity,
  actor: OppActor,
  input: { files: OpportunityFile[]; note: string; notification: NoticeCopy }
): Promise<string> {
  // From «qualified»; or again from «proposal» after Sales could not price it («fix the details and request again»).
  if (!isOpportunityOpen(opp) || (opp.stage !== "qualified" && opp.stage !== "proposal")) throw new Error("not_qualified")
  const again = opp.stage === "proposal"
  const recipients = await loadPermissionRecipients(firestore, opp.organizationId, actor.uid, ["sales.manage"])
  const { id, requestNumber } = await createQuoteRequest(firestore, {
    organizationId: opp.organizationId,
    contact: { id: opp.contactId, name: opp.contactName ?? null },
    opportunityId: opp.id,
    opportunityTitle: opp.title,
    lines: [],
    note: input.note,
    dueDate: opp.expectedCloseDate || null,
    actor: { id: actor.uid, name: actor.name },
    recipients,
    notification: input.notification,
    opportunity: {
      kind: "price",
      number: opp.docNumber ?? null,
      details: opp.details || opp.notes || null,
      deliverables: opportunityDeliverables(opp),
      files: input.files.map(toRequestFile),
    },
  })
  await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), {
    stage: "proposal",
    pricingRequestId: id,
    pricingRequestNumber: requestNumber,
    pricingRequestedAt: new Date().toISOString(),
    stageHistory: [
      ...stageHistory(opp),
      ...(again ? [] : [historyEntry("proposal", actor.name)]),
      historyEntry("pricing_requested", actor.name, requestNumber),
    ],
    updatedAt: serverTimestamp(),
  })
  return requestNumber
}

/**
 * «Ask for a revised version» — what the client asks, on the SAME offer (it reaches Sales as a revision of that quote,
 * not a new request to price); the deal moves to «negotiation» (OPP-04 #7).
 */
export async function requestRevision(
  firestore: Firestore,
  opp: CrmOpportunity,
  actor: OppActor,
  offer: CrmQuotation,
  input: { ask: string; dueDate: string | null; notification: NoticeCopy }
): Promise<string> {
  if (!isOpportunityOpen(opp) || (opp.stage !== "proposal" && opp.stage !== "negotiation")) throw new Error("no_offer")
  if (!input.ask.trim()) throw new Error("ask_required")
  const recipients = await loadPermissionRecipients(firestore, opp.organizationId, actor.uid, ["sales.manage"])
  const { requestNumber } = await createQuoteRequest(firestore, {
    organizationId: opp.organizationId,
    contact: { id: opp.contactId, name: opp.contactName ?? null },
    opportunityId: opp.id,
    opportunityTitle: opp.title,
    lines: [],
    note: input.ask,
    dueDate: input.dueDate,
    actor: { id: actor.uid, name: actor.name },
    recipients,
    notification: input.notification,
    opportunity: {
      kind: "revision",
      number: opp.docNumber ?? null,
      details: opp.details || opp.notes || null,
      deliverables: opportunityDeliverables(opp),
      revisionOfQuotationId: offer.id,
      revisionOfQuotationNumber: offer.quotationNumber,
    },
  })
  await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), {
    ...(opp.stage === "proposal" ? { stage: "negotiation" } : {}),
    stageHistory: [
      ...stageHistory(opp),
      ...(opp.stage === "proposal" ? [historyEntry("negotiation", actor.name)] : []),
      historyEntry("revision_requested", actor.name, offer.quotationNumber),
    ],
    updatedAt: serverTimestamp(),
  })
  return requestNumber
}

// ---------------------------------------------------------------------------
// Award and loss (OPP-05, OPP-06)
// ---------------------------------------------------------------------------

/**
 * Records the award on an offer Sales sent. The awarded value starts from that offer (and may be less: a partial
 * award); «bidders (with us)» of 1 means we were the sole bidder. Sales hears it: a project's offer is marked accepted
 * (no sales order — the deal goes to Project Management); supply and service stay «sent» for Sales to convert into the
 * sales order, and Sales is told to.
 */
export async function recordAward(
  firestore: Firestore,
  opp: CrmOpportunity,
  actor: OppActor,
  offer: CrmQuotation | null,
  input: { value: number; bidderCount: number | null; ourRank: number | null; reason: WonReason; note: string; notice: NoticeCopy }
) {
  if (!canRecordAward(opp, offer !== null || (opp.submittedPrice || 0) > 0)) throw new Error("no_offer")
  if (revisionPending(offer)) throw new Error("revision_pending")
  if (!(input.value > 0)) throw new Error("value_required")
  const projectDeal = opportunityDeliverables(opp).includes("project")
  const batch = writeBatch(firestore)
  batch.update(doc(firestore, CRM_OPPORTUNITIES, opp.id), {
    awardedValue: input.value,
    awardedQuotationId: offer?.id ?? null,
    awardedQuotationNumber: offer?.quotationNumber ?? null,
    stage: "won",
    state: "won",
    wonReason: input.reason,
    wonNote: input.note.trim() || null,
    bidderCount: input.bidderCount,
    ourRank: input.ourRank,
    stageHistory: [...stageHistory(opp), historyEntry("won", actor.name)],
    updatedAt: serverTimestamp(),
  })
  if (offer && projectDeal && offer.status === "sent") {
    batch.update(doc(firestore, CRM_QUOTATIONS, offer.id), {
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      acceptedByUserName: actor.name,
      updatedAt: serverTimestamp(),
    })
  }
  await batch.commit()
  await notifySales(firestore, opp, actor, input.notice, "crm_award")
}

/** «Close as lost» with Sales told — the open offer is closed lost with the same reason (OPP-06 #4). */
export async function closeOfferLost(firestore: Firestore, offer: CrmQuotation | null, reason: string, actor: OppActor) {
  if (!offer || offer.status !== "sent") return
  await updateDoc(doc(firestore, CRM_QUOTATIONS, offer.id), {
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    lostReason: reason,
    lostByUserName: actor.name,
    updatedAt: serverTimestamp(),
  })
}

/** The Sales team hears the outcome — best effort; the record is already written. */
export async function notifySales(firestore: Firestore, opp: CrmOpportunity, actor: OppActor, copy: NoticeCopy, type: string) {
  try {
    const recipients = await loadPermissionRecipients(firestore, opp.organizationId, actor.uid, ["sales.manage"])
    const batch = writeBatch(firestore)
    const createdAt = new Date().toISOString()
    for (const uid of recipients) {
      if (uid === actor.uid) continue
      batch.set(doc(collection(firestore, "users", uid, "notifications")), {
        type,
        organizationId: opp.organizationId,
        title: copy.title,
        message: copy.message,
        i18n: copy.i18n,
        opportunityId: opp.id,
        userId: uid,
        read: false,
        createdAt,
      })
    }
    await batch.commit()
  } catch (err) {
    console.error("sales notification failed", err)
  }
}
