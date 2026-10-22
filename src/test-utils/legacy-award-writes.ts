// TEST FIXTURE ONLY. The browser no longer awards or raises an order from an award (Procurement 2.0, WP-S3-07): that is the server's
// `POST /api/procurement/rfq/award`. These are the former client writers, kept so tests that need an order to exist (approval, receipt,
// supplier-journey render tests) can create one over the fake client Firestore the way they always did. Never import from the app.

import { collection, doc, runTransaction, serverTimestamp, type DocumentReference, type Firestore, type Transaction } from "firebase/firestore"
import { drawProcDocNumber, drawProcDocNumbers } from "@/lib/procurement/numbering"
import { emitProcEvent, sarText } from "@/lib/procurement/events"
import { awardLinkPatch, rfqProjectRequests, type AwardedOrder, type AwardedRfq, type ProjectRequestDoc, type ServedRequest } from "@/lib/procurement/needs"
import { rfqLogEntry, type RfqLogEntry } from "@/lib/procurement/rfq-detail"
import { poValue, round2 } from "@/lib/procurement/po"
import { emitRfqOutcomes } from "@/lib/procurement/rfq-outcome"
import { isWithdrawnOffer } from "@/lib/procurement/award"
import { PURCHASE_ORDERS, type PoLogEntry, type ProcActor } from "@/lib/procurement/types"
import { draftPurchaseOrder, draftSplitOrder, losingOfferIds, ProcWriteError, type AwardOfferLike, type AwardRfqInput, type CreateFromAwardInput, type WriteOpts } from "@/lib/procurement/writes"

const entry = (actor: Pick<ProcActor, "uid" | "name">, action: PoLogEntry["action"], at: string, extra?: { note?: string | null; params?: PoLogEntry["params"] }): PoLogEntry => ({
  at,
  byId: actor.uid,
  byName: actor.name,
  action,
  note: extra?.note ?? null,
  params: extra?.params ?? null,
})

type ServedDoc = { served: ServedRequest; ref: DocumentReference; request: ProjectRequestDoc }

/** The project requests the RFQ answers, read in the award's transaction — before
 * its first write. A request is not told when its project is archived (nothing
 * on a closed project changes, and nothing more is received there) or cannot be
 * read (the project is gone): the award itself must not fail for it. */
async function readServedRequests(tx: Transaction, firestore: Firestore, rfq: AwardedRfq): Promise<ServedDoc[]> {
  const out: ServedDoc[] = []
  const open = new Map<string, boolean>()
  for (const served of rfqProjectRequests(rfq)) {
    const ref = doc(firestore, "projects", served.projectId, "purchaseRequests", served.purchaseRequestId) as DocumentReference
    try {
      if (!open.has(served.projectId)) {
        const project = await tx.get(doc(firestore, "projects", served.projectId))
        open.set(served.projectId, project.exists() && (project.data() as { pm?: { lifecycle?: string | null } | null }).pm?.lifecycle !== "closed")
      }
      if (!open.get(served.projectId)) continue
      const snap = await tx.get(ref)
      if (snap.exists()) out.push({ served, ref, request: { ...(snap.data() as Omit<ProjectRequestDoc, "id">), id: snap.id } })
    } catch (err) {
      if ((err as { code?: string })?.code !== "permission-denied") throw err
    }
  }
  return out
}

/** Each request the RFQ answered is told which order it became, in the award's
 * own transaction: the project reads `poId` on its request to know an order is
 * out and the material can be received (`awardLinkPatch`). */
function linkServedRequests(tx: Transaction, rfqId: string, rfq: AwardedRfq, served: ServedDoc[], orders: AwardedOrder[]): void {
  for (const s of served) {
    const patch = awardLinkPatch(rfqId, rfq, s.served, s.request, orders)
    if (patch) tx.update(s.ref, { ...patch, updatedAt: serverTimestamp() })
  }
}

/**
 * The award's second half: a purchase order laid over the accepted offer. The
 * offer stays the award (its status, the RFQ's "Awarded" and the supplier's
 * bell are untouched); the order gets the number, the routing and the log, and
 * the project requests the RFQ was raised for get the order.
 * Idempotent: an offer that already names its order returns it.
 */
export async function createPurchaseOrderFromAward(
  firestore: Firestore,
  actor: ProcActor,
  input: CreateFromAwardInput,
  opts: WriteOpts = {}
): Promise<{ id: string; docNumber: string; created: boolean }> {
  if (!actor.isOwner && !actor.canPrepare) throw new ProcWriteError("no_permission")
  if (input.offer.poId) return { id: input.offer.poId, docNumber: input.offer.poNumber || "", created: false }
  const now = opts.now ?? new Date()
  const draft = draftPurchaseOrder(actor, input, now)
  const at = now.toISOString()
  const offerRef = doc(firestore, "offers", input.offer.id)
  const rfqRef = doc(firestore, "rfqs", input.rfq.id)
  const poRef = doc(collection(firestore, PURCHASE_ORDERS))
  const result = await runTransaction(firestore, async (tx) => {
    const offerSnap = await tx.get(offerRef)
    if (!offerSnap.exists()) throw new ProcWriteError("offer_missing")
    const existing = offerSnap.data().poId as string | undefined
    if (existing) return { id: existing, docNumber: (offerSnap.data().poNumber as string) || "", created: false }
    if (isWithdrawnOffer(offerSnap.data() as { status?: string; withdrawnAt?: string })) throw new ProcWriteError("offer_taken")
    // The needs the RFQ answers are on the RFQ itself (the screen hands over only part of it).
    const rfqSnap = await tx.get(rfqRef)
    const linked: AwardedRfq = rfqSnap.exists() ? (rfqSnap.data() as AwardedRfq) : input.rfq
    const served = await readServedRequests(tx, firestore, linked)
    const docNumber = await drawProcDocNumber(firestore, tx, draft.organizationId, "PO", now.getUTCFullYear())
    const po = { ...draft, docNumber, log: [entry(actor, "created", at, { params: { basis: draft.basis, number: docNumber } })], updatedAt: serverTimestamp() }
    tx.set(poRef, po)
    tx.update(offerRef, { poId: poRef.id, poNumber: docNumber, updatedAt: serverTimestamp() })
    linkServedRequests(tx, input.rfq.id, linked, served, [{ id: poRef.id, docNumber, products: null }])
    return { id: poRef.id, docNumber, created: true }
  })
  if (result.created) {
    await emitProcEvent(firestore, actor, {
      kind: "po_awaiting_approval",
      organizationId: draft.organizationId,
      to: [draft.approverKind === "owner" ? { owner: true } : { permission: "po.approve" }],
      params: { number: result.docNumber, supplier: draft.supplierName, amount: sarText(poValue({ ...draft, id: result.id, docNumber: result.docNumber }), opts.locale), rfq: draft.rfqTitle },
      poId: result.id,
      rfqId: draft.rfqId,
      offerId: draft.offerId,
      copy: opts.copy,
    })
  }
  return result
}


/**
 * Award the RFQ from the comparison's picks, in ONE transaction: every picked
 * offer goes `مقبول` with the lines it won (`awardedLines`, `awardedTotal`) and
 * gets its own order awaiting approval; the RFQ goes `Awarded`, remembers the
 * lines nobody won (`unawardedLines` — back to the needs) and logs the award.
 * The supplier hears nothing yet (22 Sep review): he hears when his order is
 * approved and sent. Re-reads the RFQ and every offer, so an offer excluded or
 * awarded meanwhile refuses the whole award rather than half of it.
 */
export async function awardRfq(
  firestore: Firestore,
  actor: ProcActor,
  input: AwardRfqInput,
  opts: WriteOpts = {}
): Promise<Array<{ id: string; docNumber: string; offerId: string }>> {
  if (!actor.isOwner && !actor.canPrepare) throw new ProcWriteError("no_permission")
  if (!input.groups.length) throw new ProcWriteError("nothing_picked")
  if (input.groups.some((g) => g.offer.isGuestOffer) && !input.acceptedGuest) throw new ProcWriteError("guest_unregistered")
  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const drafts = input.groups.map((g) => draftSplitOrder(actor, input, g, now))
  const rfqRef = doc(firestore, "rfqs", input.rfq.id)
  const offerRefs = input.groups.map((g) => doc(firestore, "offers", g.offer.id))
  const poRefs = input.groups.map(() => doc(collection(firestore, PURCHASE_ORDERS)))
  // Who lost, and the request's number — read in the transaction, told after it (OFR-07).
  const told: { losers: AwardOfferLike[]; rfqNumber: string | null } = { losers: [], rfqNumber: null }
  const result = await runTransaction(firestore, async (tx) => {
    const rfqSnap = await tx.get(rfqRef)
    if (!rfqSnap.exists()) throw new ProcWriteError("rfq_missing")
    const rfqData = rfqSnap.data() as { status?: string; log?: RfqLogEntry[]; createdByUserId?: string | null; contractorId?: string | null; rfqNumber?: string | null }
    if (rfqData.status !== "New") throw new ProcWriteError("rfq_not_open")
    // A buyer awards only the RFQs he raised; the manager and the owner award any.
    if (!actor.isOwner && !actor.canApprove && (rfqData.createdByUserId || rfqData.contractorId || "") !== actor.uid) throw new ProcWriteError("not_your_rfq")
    for (const [k, ref] of offerRefs.entries()) {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new ProcWriteError("offer_missing")
      const o = snap.data() as { status?: string; poId?: string; withdrawnAt?: string; skippedItems?: unknown }
      if (o.poId || o.status === "مرفوض" || o.status === "مقبول" || isWithdrawnOffer(o)) throw new ProcWriteError("offer_taken")
      // A partial offer is awarded only the lines it covers (PUR-03): the others he marked «not supplied».
      const out = Array.isArray(o.skippedItems) ? o.skippedItems.map(Number) : []
      if (input.groups[k].lines.some((l) => out.includes(l.rfqProductIndex))) throw new ProcWriteError("line_not_covered")
    }
    // The quotes left out are re-read too: one withdrawn or decided meanwhile is not told it lost.
    const losers: string[] = []
    told.losers = [] // a retried transaction starts over
    for (const lid of losingOfferIds(input.offers, input.groups.map((g) => g.offer.id))) {
      const snap = await tx.get(doc(firestore, "offers", lid))
      if (snap.exists() && losingOfferIds([{ ...(snap.data() as Pick<AwardOfferLike, "status" | "poId">), id: lid }], []).length) {
        losers.push(lid)
        told.losers.push({ ...(snap.data() as Omit<AwardOfferLike, "id">), id: lid })
      }
    }
    const linked = rfqSnap.data() as AwardedRfq
    const served = await readServedRequests(tx, firestore, linked)
    const numbers = await drawProcDocNumbers(firestore, tx, drafts[0].organizationId, "PO", drafts.length, now.getUTCFullYear())
    drafts.forEach((draft, k) => {
      const g = input.groups[k]
      tx.set(poRefs[k], { ...draft, docNumber: numbers[k], log: [entry(actor, "created", at, { params: { basis: draft.basis, number: numbers[k] } })], updatedAt: serverTimestamp() })
      tx.update(offerRefs[k], {
        status: "مقبول",
        decidedByUserId: actor.uid,
        decidedByUserName: actor.name,
        decidedAt: at,
        readAt: null,
        awaitingOrderApproval: true,
        ...(g.offLowest && input.awardReason ? { awardReason: { code: input.awardReason.code, text: input.awardReason.text?.trim() || null, byId: actor.uid, at } } : {}),
        awardedLines: g.lines.map((l) => l.rfqProductIndex),
        awardedTotal: round2(g.total),
        ...(input.breakdown ? { breakdown: g.lines.map((l) => ({ rfqProductIndex: l.rfqProductIndex, unitPrice: l.unitPrice })) } : {}),
        requestedDeliveryDate: g.requestedDeliveryDate || null,
        poId: poRefs[k].id,
        poNumber: numbers[k],
        updatedAt: serverTimestamp(),
      })
    })
    // Every quote ends with a result (G-06): the others are "awarded to another", with the buyer's reason when given.
    for (const lid of losers) {
      tx.update(doc(firestore, "offers", lid), { outcome: { k: "lost", at, why: input.lossReason || null }, updatedAt: serverTimestamp() })
    }
    told.rfqNumber = rfqData.rfqNumber || null
    const logEntry = rfqLogEntry(actor, "awarded", at, { params: { orders: numbers.join(" · "), suppliers: drafts.map((d) => d.supplierName).join(" · "), unawarded: input.unpicked.length } })
    tx.update(rfqRef, {
      status: "Awarded",
      awardedAt: at,
      unawardedLines: input.unpicked,
      awardSplit: drafts.length > 1,
      log: [...(rfqData.log || []), logEntry],
      updatedAt: serverTimestamp(),
    })
    linkServedRequests(
      tx,
      input.rfq.id,
      linked,
      served,
      numbers.map((docNumber, k) => ({ id: poRefs[k].id, docNumber, products: input.groups[k].lines.map((l) => l.rfqProductIndex) }))
    )
    return numbers.map((docNumber, k) => ({ id: poRefs[k].id, docNumber, offerId: input.groups[k].offer.id }))
  })
  await Promise.all(
    result.map((r, k) =>
      emitProcEvent(firestore, actor, {
        kind: "po_awaiting_approval",
        organizationId: drafts[k].organizationId,
        to: [drafts[k].approverKind === "owner" ? { owner: true } : { permission: "po.approve" }],
        params: { number: r.docNumber, supplier: drafts[k].supplierName, amount: sarText(poValue({ ...drafts[k], id: r.id, docNumber: r.docNumber }), opts.locale), rfq: drafts[k].rfqTitle },
        poId: r.id,
        rfqId: drafts[k].rfqId,
        offerId: drafts[k].offerId,
        copy: opts.copy,
      })
    )
  )
  // Each quote left out is told it was awarded to another, with the buyer's reason when he gave one. The winners hear
  // with their order, once it is approved and sent (`po_sent`) — never before (OFR-07).
  await emitRfqOutcomes(
    firestore,
    actor,
    told.losers,
    { organizationId: drafts[0].organizationId, rfqId: input.rfq.id, rfqNumber: told.rfqNumber, rfqTitle: input.rfq.title, contractor: opts.orgName || actor.name, result: "lost", why: input.lossReason || null, copy: opts.copy }
  )
  return result
}

