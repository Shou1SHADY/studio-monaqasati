// PM 1.0 — supply writes: material requests, the project-side receipt, the
// project store's moves and rates, direct purchases and equipment requests.
// One transaction per act; the guard runs first on the project just read, so an
// archived project or a removed duty refuses whatever the screen showed.
//
// Numbers come from the project's pm block: `mrCount` (requests), `grnCount`
// (project receipts), `pettyCount`, `plantCount`. Requests keep living in
// `purchaseRequests` so Procurement's needs desk keeps reading them; their
// `items` are rewritten from the lines on every decision.

import { emitProcEvent, procLinks } from "../procurement/events"
import { requestPmStopInTx } from "../procurement/po-extra-writes"
import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, PmAccessError, pmCan, type PmContext } from "./access"
import { cleanAttachments, type PmAttachment } from "./attachments"
import { readSelfApproval } from "./info-writes"
import { PM_EVENTS, pmEventDocId } from "./events"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"
import { lastPaid, PRICE_HISTORY, type PriceHistoryEntry } from "../procurement/prices"
import { PURCHASE_ORDERS } from "../procurement/types"
import { pmApprovalLimit } from "./subcontract"
import { PM_VARIATIONS, voNo } from "./variation"
import {
  decidedMove,
  decideRefusal,
  moveBlocks,
  returnWaiting,
  newMove,
  PM_STORE,
  r2,
  r3,
  rateBlocks,
  ratedOn,
  storeBalance,
  storeIdOf,
  storeLineOf,
  withRate,
  type ItemRate,
  type LossWhy,
  type LoggedMove,
  type MoveDecision,
  type PmStoreLine,
  type RxFrom,
  type StoreItem,
  type StoreMove,
} from "./store"
import {
  approveBlocks,
  buildLines,
  changeBlocks,
  lineLink,
  pettyBlocks,
  pettyNo,
  plantBlocks,
  plantHireable,
  plantNo,
  plantReplyBlocks,
  PM_PETTY,
  PM_PLANT,
  pendingKept,
  pendingSamples,
  procurementItems,
  PURCHASE_REQUESTS,
  receivablePortions,
  receiveBlocks,
  receivedLine,
  reqNo,
  requestBlocks,
  requestOf,
  requestSample,
  stopBlocks,
  stoppedLine,
  type CloseWhy,
  type LineDraft,
  type OrderFact,
  type PlantCategory,
  type PlantReplyKind,
  type PlantWhy,
  type PmPlantRequest,
  type PortionKind,
  type ReqLine,
} from "./supply"

export class PmSupplyError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmSupplyError"
  }
}

export interface SupplyActor {
  uid: string
  name: string | null
}

type PmCounters = { no?: string; mrCount?: number; grnCount?: number; pettyCount?: number; plantCount?: number; plantReqCount?: number; voCount?: number }
type ProjectData = { organizationId?: string; name?: string; status?: string; projectManagerId?: string | null; pm?: PmCounters & Record<string, unknown> }

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmSupplyError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmSupplyError("not_pm_project")
  return { ref, project, pm: project.pm }
}

async function readItem(tx: Transaction, firestore: Firestore, projectId: string, itemId: string): Promise<(StoreItem & { pmSample?: boolean | null; pmSub?: string | null }) | null> {
  const snap = await tx.get(doc(firestore, "projects", projectId, "boqItems", itemId))
  if (!snap.exists()) return null
  const d = snap.data() as Record<string, unknown>
  return {
    id: itemId,
    code: (d.itemNo as string) ?? "",
    description: ((d.descriptionAr as string) || (d.descriptionEn as string)) ?? "",
    unit: (d.unit as string) ?? "",
    quantity: num(d.quantity),
    executed: num(d.executedQuantity),
    pmSample: (d.pmSample as boolean | null) ?? null,
    pmSub: (d.pmSub as string | null) ?? null,
  }
}

async function readRequest(tx: Transaction, firestore: Firestore, projectId: string, requestId: string) {
  const ref = doc(firestore, "projects", projectId, PURCHASE_REQUESTS, requestId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmSupplyError("missing")
  return { ref, request: requestOf({ id: requestId, ...(snap.data() as Record<string, unknown>) }) }
}

/** The status of the order behind a line, read in the act's own transaction. An
 * award older than purchase orders left no order document (the offer was the
 * order), and the rules answer a read of a missing one with a refusal: either
 * way there is nothing to judge by, and the line is taken as coming. */
async function readOrderFact(tx: Transaction, firestore: Firestore, poId: string): Promise<OrderFact> {
  try {
    const snap = await tx.get(doc(firestore, PURCHASE_ORDERS, poId))
    return snap.exists() ? { status: (snap.data() as { status?: string | null }).status ?? null } : null
  } catch (err) {
    if ((err as { code?: string })?.code !== "permission-denied") throw err
    return undefined
  }
}

async function readStore(tx: Transaction, firestore: Firestore, projectId: string, storeId: string) {
  const ref = doc(firestore, "projects", projectId, PM_STORE, storeId)
  const snap = await tx.get(ref)
  return { ref, line: snap.exists() ? storeLineOf(storeId, snap.data() as Partial<PmStoreLine>) : null }
}

const blocked = (blocks: string[]) => {
  if (blocks.length) throw new PmSupplyError("blocked", blocks)
}

const refuse = (code: "no_duty" | "self_approval" | "owner_only", action: string) => {
  throw new PmAccessError(code, action)
}

/** Items of the given ids, all read inside the transaction. */
async function readItems(tx: Transaction, firestore: Firestore, projectId: string, ids: Array<string | null>) {
  const out: Array<StoreItem & { pmSample?: boolean | null; pmSub?: string | null }> = []
  for (const id of [...new Set(ids.filter((x): x is string => Boolean(x)))]) {
    const it = await readItem(tx, firestore, projectId, id)
    if (!it) throw new PmSupplyError("blocked", ["bad_line"])
    out.push(it)
  }
  return out
}

/** A rate entry for each line that adds a material to its item (the first request
 * on an item, or a change decided on us / on the client). */
async function addItemMaterial(tx: Transaction, firestore: Firestore, projectId: string, line: ReqLine, entry: Omit<ItemRate, "ex0">, executed: number, cache: Map<string, { ref: ReturnType<typeof doc>; line: PmStoreLine | null }>) {
  if (!line.itemId) return
  const id = storeIdOf(line.key)
  const got = cache.get(id) ?? (await readStore(tx, firestore, projectId, id))
  cache.set(id, got)
  const base: PmStoreLine = got.line ?? { id, key: line.key, name: line.name, unit: line.unit, rates: {}, moves: [] }
  if (base.rates[line.itemId]) return
  const next = { ...base, rates: { ...base.rates, [line.itemId]: { ...entry, ex0: executed } } }
  cache.set(id, { ref: got.ref, line: next })
}

function flushStores(tx: Transaction, cache: Map<string, { ref: ReturnType<typeof doc>; line: PmStoreLine | null }>, organizationId: string | null) {
  for (const { ref, line } of cache.values()) {
    if (!line) continue
    tx.set(ref, { key: line.key, name: line.name, unit: line.unit, rates: line.rates, moves: line.moves, organizationId, updatedAt: serverTimestamp() }, { merge: true })
  }
}

async function readStores(firestore: Firestore, projectId: string): Promise<PmStoreLine[]> {
  const snap = await getDocs(collection(firestore, "projects", projectId, PM_STORE))
  return snap.docs.map((d) => storeLineOf(d.id, d.data() as Partial<PmStoreLine>))
}

// ── Requests ─────────────────────────────────────────────────────────────────

export interface RequestInput {
  title: string
  needBy: string | null
  notes: string | null
  lines: LineDraft[]
}

/** Send a material request: each line on its BOQ item (or general consumables).
 * A material outside its item's list is a change request; the first request on
 * an item with no list builds it. */
export async function createMaterialRequest(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, input: RequestInput): Promise<number> {
  const stores = await readStores(firestore, projectId)
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "supply.request")
    blocked(requestBlocks({ archived: fresh.archived, lines: input.lines, needBy: input.needBy, today: todayDay() }))
    const items = await readItems(tx, firestore, projectId, input.lines.map((l) => l.itemId))
    const lines = buildLines(stores, items, input.lines)
    const cache = new Map<string, { ref: ReturnType<typeof doc>; line: PmStoreLine | null }>()
    for (const l of lines) if (l.first) await addItemMaterial(tx, firestore, projectId, l, { r: null, w: 5, src: "first" }, items.find((i) => i.id === l.itemId)?.executed ?? 0, cache)
    seq = (pm.mrCount ?? 0) + 1
    const day = todayDay()
    tx.set(doc(firestore, "projects", projectId, PURCHASE_REQUESTS, reqNo(seq)), {
      pm: true,
      seq,
      title: input.title.trim(),
      needBy: input.needBy || null,
      notes: input.notes?.trim() || null,
      lines,
      items: procurementItems({ lines }, pendingSamples(items)),
      status: "pending",
      requestedByUserId: actor.uid,
      requestedByUserName: actor.name,
      day,
      organizationId: project.organizationId ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    flushStores(tx, cache, project.organizationId ?? null)
    tx.update(ref, { pm: { ...pm, mrCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

/** What approval hands Procurement, for its notice. */
type NeedHandoff = { organizationId: string; project: string; no: string; count: number }

/** Technical approval by the project manager: the full quantity goes to
 * Procurement (who asks the store first); a change line waits for its decision
 * and a rejected change is cancelled. A consultant-rejected or missing sample
 * blocks it — Procurement will not buy what the consultant has not approved. */
export async function approveMaterialRequest(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, requestId: string): Promise<"approved" | "rejected"> {
  let outcome: "approved" | "rejected" = "approved"
  let handoff: NeedHandoff | null = null
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "request.decide")
    const { ref, request } = await readRequest(tx, firestore, projectId, requestId)
    const items = await readItems(tx, firestore, projectId, request.lines.map((l) => l.itemId))
    blocked(approveBlocks({ archived: fresh.archived, request, sample: requestSample(request, items) }))
    const day = todayDay()
    const lines = request.lines.map((l): ReqLine => (l.chg?.st === "no" ? { ...l, cl: { t: "cancel", on: day, by: actor.uid, byName: actor.name, why: "chg" } } : l))
    outcome = lines.every((l) => l.cl) ? "rejected" : "approved"
    const toBuy = procurementItems({ lines }, pendingSamples(items))
    handoff = { organizationId: project.organizationId ?? "", project: project.name ?? "", no: reqNo(request.seq ?? 0), count: toBuy.length }
    tx.update(ref, {
      pm: true,
      lines,
      items: toBuy,
      status: outcome,
      approvedOn: outcome === "approved" ? day : null,
      approvedBy: outcome === "approved" ? actor.uid : null,
      approvedByName: outcome === "approved" ? actor.name : null,
      decidedByUserId: actor.uid,
      decidedByUserName: actor.name,
      decidedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
  // The request is Procurement's now — tell its buyers (best-effort, after the
  // commit: a lost notice never undoes the approval). Without it the request
  // only sat on the needs desk until someone happened to open it.
  const h = handoff as NeedHandoff | null
  if (outcome === "approved" && h?.organizationId && h.count > 0) {
    await emitProcEvent(firestore, { uid: actor.uid, name: actor.name ?? "" }, {
      kind: "need_approved",
      organizationId: h.organizationId,
      to: [{ permission: "rfq.manage" }, { permission: "rfq.create" }],
      params: { no: h.no, project: h.project, count: h.count },
      link: procLinks.needs(),
    })
  }
  return outcome
}

export async function rejectMaterialRequest(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, requestId: string, reason: string | null): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "request.decide")
    const { ref, request } = await readRequest(tx, firestore, projectId, requestId)
    blocked(request.status !== "pending" ? ["not_pending"] : fresh.archived ? ["archived"] : [])
    tx.update(ref, { status: "rejected", rejectReason: reason?.trim() || null, decidedByUserId: actor.uid, decidedByUserName: actor.name, decidedAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })
}

/** The requester withdraws it before approval — nothing was sent anywhere. */
export async function withdrawMaterialRequest(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, requestId: string): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "supply.request")
    const { ref, request } = await readRequest(tx, firestore, projectId, requestId)
    if (request.requestedByUserId !== actor.uid) refuse("no_duty", "supply.request")
    blocked(request.status !== "pending" ? ["not_pending"] : [])
    tx.update(ref, { status: "rejected", withdrawn: true, decidedByUserId: actor.uid, decidedByUserName: actor.name, decidedAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })
}

/** The change decision: on us (added to the item's materials — above the
 * manager's riyal limit only the owner may), on the client (linked to a draft
 * variation on the item, new or existing), or rejected (the line is cancelled). */
export async function decideChange(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SupplyActor,
  requestId: string,
  lineIndex: number,
  decision: { st: "us" } | { st: "no" } | { st: "own"; voSeq: number | null; ref: string | null }
): Promise<{ voSeq: number | null }> {
  let voSeq: number | null = null
  let estimate: number | null = null
  if (decision.st === "us") {
    const [ps, rs] = await Promise.all([getDoc(doc(firestore, "projects", projectId)), getDoc(doc(firestore, "projects", projectId, PURCHASE_REQUESTS, requestId))])
    const orgHint = ps.exists() ? ((ps.data() as ProjectData).organizationId ?? "") : ""
    const pre = rs.exists() ? requestOf({ id: requestId, ...(rs.data() as Record<string, unknown>) }).lines[lineIndex] : undefined
    if (pre && orgHint) {
    const snap = await getDocs(query(collection(firestore, PRICE_HISTORY), where("organizationId", "==", orgHint), where("materialKey", "==", pre.key)))
    const last = lastPaid(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PriceHistoryEntry, "id">) })), pre.name, pre.unit)
    estimate = last ? r2(last.price * pre.qty) : null
    }
  }
  await runTransaction(firestore, async (tx) => {
    const { ref: pref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "change.decide")
    const { ref, request } = await readRequest(tx, firestore, projectId, requestId)
    const line = request.lines[lineIndex]
    if (!line) throw new PmSupplyError("missing")
    let voRejected = false
    if (line.chg?.voSeq) {
      const vo = await tx.get(doc(firestore, "projects", projectId, PM_VARIATIONS, voNo(line.chg.voSeq)))
      voRejected = vo.exists() && (vo.data() as { status?: string }).status === "rej"
    }
    blocked(changeBlocks({ archived: fresh.archived, request, line, decision: decision.st, voRejected }))
    if (decision.st === "us" && estimate !== null && estimate > pmApprovalLimit(fresh.ceiling)) refuse("owner_only", "change.decide")
    const day = todayDay()
    const stamp = { by: actor.uid, byName: actor.name, on: day }
    // A change accepted once the request is with an RFQ, an order or the workshop is
    // a new line to buy (the prototype's planLate): what is out was raised without it.
    const late = line.chg?.st === "wait" && request.status === "approved" && Boolean(request.rfqId || request.poId || request.mfgRequestId) ? { late: { on: day } } : {}
    const cache = new Map<string, { ref: ReturnType<typeof doc>; line: PmStoreLine | null }>()
    const item = line.itemId ? await readItem(tx, firestore, projectId, line.itemId) : null
    if (line.itemId) cache.set(storeIdOf(line.key), await readStore(tx, firestore, projectId, storeIdOf(line.key)))
    let next: ReqLine = line
    if (decision.st === "no") {
      next = { ...line, chg: { ...line.chg, ...stamp, st: "no" }, cl: request.status === "approved" ? { t: "cancel", on: day, by: actor.uid, byName: actor.name, why: "chg" } : line.cl ?? null }
    } else if (decision.st === "us") {
      next = { ...line, chg: { ...line.chg, ...stamp, st: "us" }, ...late }
      await addItemMaterial(tx, firestore, projectId, line, { r: null, w: 5, src: "chg", ref: request.seq ? reqNo(request.seq) : null }, item?.executed ?? 0, cache)
    } else {
      assertPm(fresh, "variation.log")
      let seq = decision.voSeq
      if (seq) {
        const vo = await tx.get(doc(firestore, "projects", projectId, PM_VARIATIONS, voNo(seq)))
        const st = vo.exists() ? (vo.data() as { status?: string }).status : null
        if (st !== "draft" && st !== "wait") throw new PmSupplyError("blocked", ["vo_closed"])
      } else {
        seq = (pm.voCount ?? 0) + 1
        tx.set(doc(firestore, "projects", projectId, PM_VARIATIONS, voNo(seq)), {
          seq,
          title: `${line.name}${item ? ` — ${item.code} ${item.description}` : ""}`.slice(0, 200),
          source: decision.ref ? "cons" : "client",
          sourceText: null,
          instructionNo: decision.ref?.trim() || null,
          day,
          value: 0,
          cost: 0,
          executedPct: 0,
          status: "draft",
          by: actor.uid,
          byName: actor.name,
          decision: null,
          fromRequest: request.seq ? reqNo(request.seq) : requestId,
          itemIds: line.itemId ? [line.itemId] : [],
          organizationId: project.organizationId ?? null,
          createdAt: serverTimestamp(),
        })
        tx.update(pref, { pm: { ...pm, voCount: seq }, updatedAt: serverTimestamp() })
      }
      voSeq = seq
      next = { ...line, chg: { ...line.chg, ...stamp, st: "own", voSeq: seq, ref: decision.ref?.trim() || null }, ...late }
      await addItemMaterial(tx, firestore, projectId, line, { r: null, w: 5, src: "chg", ref: request.seq ? reqNo(request.seq) : null, voSeq: seq }, item?.executed ?? 0, cache)
    }
    const lines = request.lines.map((l, i) => (i === lineIndex ? next : l))
    // The accepted line joins what Procurement reads with its item's sample state as it stands.
    const pending = new Set([...pendingKept(request), ...pendingSamples(item ? [item] : [])])
    tx.update(ref, { lines, items: procurementItems({ lines }, pending), updatedAt: serverTimestamp() })
    flushStores(tx, cache, project.organizationId ?? null)
  })
  return { voSeq }
}

/** «أوقِف ما لم يصل» — the manager, or whoever asked. */
export async function stopLine(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, requestId: string, lineIndex: number, why: CloseWhy | null, whyNote: string | null): Promise<"short" | "cancel"> {
  let kind: "short" | "cancel" = "cancel"
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "supply.stopUnarrived")
    const { ref, request } = await readRequest(tx, firestore, projectId, requestId)
    if (!pmCan(fresh, "approve") && request.requestedByUserId !== actor.uid) refuse("no_duty", "supply.stopUnarrived")
    const line = request.lines[lineIndex]
    if (!line) throw new PmSupplyError("missing")
    blocked(stopBlocks({ archived: fresh.archived, request, line, why, whyNote }))
    const next = stoppedLine(line, { on: todayDay(), by: actor.uid, byName: actor.name, why, whyNote: why === "oth" ? whyNote?.trim() || null : null })
    kind = next.cl?.t === "short" ? "short" : "cancel"
    const lines = request.lines.map((l, i) => (i === lineIndex ? next : l))
    // P-19: with an order out, Procurement is asked to cancel the rest with the supplier —
    // the order is read (and flagged) before this transaction writes anything.
    // A legacy award has no order document — then there is nothing to flag.
    const poId = lineLink(request, line).poId
    if (poId) {
      await requestPmStopInTx(tx, firestore, poId, { name: line.name, unit: line.unit, boqItemId: line.itemId }, {
        reason: whyNote?.trim() || why || "stop",
        byName: actor.name || "",
        at: new Date().toISOString(),
        projectId,
        requestId,
        line: lineIndex,
      }).catch((err: unknown) => {
        if ((err as { code?: string })?.code !== "order_missing") throw err
      })
    }
    tx.update(ref, { pm: true, lines, items: procurementItems({ lines }, pendingKept(request)), updatedAt: serverTimestamp() })
  })
  return kind
}

export interface ReceiveInput {
  acc: number
  rej: number
  dn: string | null
  note: string | null
  short: boolean
  files?: PmAttachment[] | null
  /** The project keeps a store (section `store`); without one a receipt is expensed to site overheads. */
  withStore?: boolean
  /** Which portion the delivery note is for — what a main store issued, or what
   * was bought. Needed only while both are on their way. */
  portion?: PortionKind | null
}

/** The project-side receipt: the site confirms what arrived from the delivery
 * note. The accepted quantity enters the project store (a line on an item); the
 * receipt is numbered by the project and stays on the request for Procurement.
 * It is recorded against ONE portion of the line and never above what that
 * portion still expects: what the store issued is not received as the supplier's,
 * and an order still awaiting approval (or cancelled) brings nothing. */
export async function receiveOnProject(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, requestId: string, lineIndex: number, input: ReceiveInput): Promise<string> {
  let grn = ""
  await runTransaction(firestore, async (tx) => {
    const { ref: pref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "supply.receive")
    const { ref, request } = await readRequest(tx, firestore, projectId, requestId)
    const line = request.lines[lineIndex]
    if (!line) throw new PmSupplyError("missing")
    const by = lineLink(request, line)
    const open = receivablePortions(request, line, by.poId ? await readOrderFact(tx, firestore, by.poId) : undefined)
    // With the store's issue and the supplier's delivery both on their way, the receiver says which this note is.
    if (!input.portion && open.length > 1 && !fresh.archived) blocked(["no_source"])
    const portion = (input.portion ? open.find((p) => p.k === input.portion) : open[0]) ?? null
    blocked(receiveBlocks({ archived: fresh.archived, receivable: Boolean(portion), remaining: portion?.left ?? 0, acc: input.acc, rej: input.rej }))
    if (!portion) throw new PmSupplyError("blocked", ["not_receivable"])
    const seq = (pm.grnCount ?? 0) + 1
    grn = reqNo(seq)
    const day = todayDay()
    const acc = r3(Math.max(0, input.acc))
    const rej = r3(Math.max(0, input.rej))
    const files = cleanAttachments(input.files)
    const next = receivedLine(line, { grn, q: acc, rej, on: day, by: actor.uid, byName: actor.name, dn: input.dn?.trim() || null, note: input.note?.trim() || null, short: input.short, src: portion.k, ...(files.length ? { files } : {}) }, day, actor.uid)
    let storeWrite: { ref: ReturnType<typeof doc>; line: PmStoreLine } | null = null
    if (acc > 0 && line.itemId && input.withStore !== false) {
      const id = storeIdOf(line.key)
      const got = await readStore(tx, firestore, projectId, id)
      const base: PmStoreLine = got.line ?? { id, key: line.key, name: line.name, unit: line.unit, rates: {}, moves: [] }
      const move: StoreMove = { t: "rc", q: acc, on: day, by: actor.uid, byName: actor.name, itemId: line.itemId, code: line.code, reqId: requestId, reqSeq: request.seq ?? null, grn, dn: input.dn?.trim() || null, rej: rej || null, source: (portion.k === "stk" ? line.inv?.warehouseName : by.poNumber) || null, ...(files.length ? { files } : {}) }
      storeWrite = { ref: got.ref, line: { ...base, moves: [...base.moves, move] } }
    }
    const lines = request.lines.map((l, i) => (i === lineIndex ? next : l))
    tx.update(ref, { pm: true, lines, items: procurementItems({ lines }, pendingKept(request)), updatedAt: serverTimestamp() })
    if (storeWrite) tx.set(storeWrite.ref, { key: storeWrite.line.key, name: storeWrite.line.name, unit: storeWrite.line.unit, rates: storeWrite.line.rates, moves: storeWrite.line.moves, organizationId: project.organizationId ?? null, updatedAt: serverTimestamp() }, { merge: true })
    tx.update(pref, { pm: { ...pm, grnCount: seq }, updatedAt: serverTimestamp() })
  })
  return grn
}

// ── The project store ────────────────────────────────────────────────────────

/** Set or correct the material's rate on an item (measure + money). A correction
 * recomputes since tracking began; a new rate counts from now. */
export async function setMaterialRate(firestore: Firestore, ctx: PmContext, projectId: string, storeId: string, itemId: string, r: number, w: number): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "item.rate.set")
    const item = await readItem(tx, firestore, projectId, itemId)
    blocked(rateBlocks({ archived: fresh.archived, itemId: item ? itemId : null, r, w }))
    const { ref, line } = await readStore(tx, firestore, projectId, storeId)
    if (!line) throw new PmSupplyError("missing")
    tx.update(ref, { rates: withRate(line, itemId, r, w, (item as StoreItem).executed), updatedAt: serverTimestamp() })
  })
}

export interface MoveInput {
  t: LoggedMove
  q: number
  itemId?: string | null
  warehouseId?: string | null
  warehouseName?: string | null
  toProjectId?: string | null
  toProjectName?: string | null
  why?: LossWhy | null
  from?: RxFrom | null
  fromProjectId?: string | null
  fromProjectName?: string | null
  note?: string | null
  files?: PmAttachment[] | null
}

/** A boundary event to another module (the prototype's emit): returns to
 * Inventory (prj:RET), supplier returns to Procurement (prj:SRET), a cash
 * inbound with no order to Procurement (prj:NOPO). Create-only outbox. */
function outbox(tx: Transaction, firestore: Firestore, e: { key: string; kind: string; project: ProjectData; projectId: string; projectNo: string; amount: number; params: Record<string, string | number>; by: string }) {
  tx.set(doc(firestore, PM_EVENTS, pmEventDocId(e.project.organizationId ?? "", e.key)), {
    key: e.key,
    kind: e.kind,
    organizationId: e.project.organizationId ?? "",
    projectId: e.projectId,
    projectNo: e.projectNo,
    amount: e.amount,
    params: e.params,
    by: e.by,
    at: new Date().toISOString(),
  })
}

/** Log a move on a material: declared use, return to a main store, move to
 * another project (its engineer confirms), loss or damage, or an inbound
 * without a document. Balance-checked against what is on the project now. */
export async function logStoreMove(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, storeId: string, input: MoveInput): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "store.move")
    const { ref, line } = await readStore(tx, firestore, projectId, storeId)
    if (!line) throw new PmSupplyError("missing")
    const itemIds = [...new Set([...Object.keys(line.rates || {}), ...line.moves.map((m) => m.itemId).filter((x): x is string => Boolean(x)), ...(input.itemId ? [input.itemId] : [])])]
    const items: StoreItem[] = []
    for (const id of itemIds) {
      const it = await readItem(tx, firestore, projectId, id)
      if (it) items.push(it)
    }
    const item = input.itemId ? items.find((i) => i.id === input.itemId) ?? null : null
    blocked(
      moveBlocks({
        archived: fresh.archived,
        t: input.t,
        q: input.q,
        balance: storeBalance(line, items),
        itemId: item?.id ?? null,
        itemRated: item ? Boolean(ratedOn(line, item.id)) : false,
        warehouseId: input.warehouseId,
        toProjectId: input.toProjectId && input.toProjectId !== projectId ? input.toProjectId : null,
        why: input.why,
        from: input.from,
        note: input.note,
      })
    )
    const day = todayDay()
    const files = cleanAttachments(input.files)
    const move: StoreMove = { ...newMove({ ...input, on: day, by: actor.uid, byName: actor.name, code: item?.code ?? null }), ...(files.length ? { files } : {}) }
    const moves = [...line.moves, move]
    const projectNo = pm.no ?? projectId
    if (move.t === "ret")
      outbox(tx, firestore, { key: `prj:RET:${projectNo}:${storeId}:${moves.length - 1}`, kind: "RET", project, projectId, projectNo, amount: 0, params: { material: line.name, unit: line.unit, qty: move.q, warehouseId: move.warehouseId ?? "", warehouse: move.warehouseName ?? "", project: project.name ?? "" }, by: actor.uid })
    if (move.t === "sret")
      outbox(tx, firestore, { key: `prj:SRET:${projectNo}:${storeId}:${moves.length - 1}`, kind: "SRET", project, projectId, projectNo, amount: 0, params: { material: line.name, unit: line.unit, qty: move.q, why: "nc", note: move.note ?? "", project: project.name ?? "" }, by: actor.uid })
    if (input.t === "xo" && input.toProjectId) {
      const other = await tx.get(doc(firestore, "projects", input.toProjectId))
      const od = other.exists() ? (other.data() as ProjectData) : null
      if (!od || od.organizationId !== project.organizationId) throw new PmSupplyError("blocked", ["no_project"])
      const tgt = await readStore(tx, firestore, input.toProjectId, storeId)
      const base: PmStoreLine = tgt.line ?? { id: storeId, key: line.key, name: line.name, unit: line.unit, rates: {}, moves: [] }
      const xi: StoreMove = { t: "xi", q: move.q, on: day, by: actor.uid, byName: actor.name, st: "wait", otherProjectId: projectId, otherProjectName: project.name ?? null, srcStoreId: storeId, srcMove: moves.length - 1 }
      tx.set(tgt.ref, { key: base.key, name: base.name, unit: base.unit, rates: base.rates, moves: [...base.moves, xi], organizationId: project.organizationId ?? null, updatedAt: serverTimestamp() }, { merge: true })
    }
    tx.set(ref, { moves, updatedAt: serverTimestamp() }, { merge: true })
  })
}

/** Approve, reject, or charge to the supplier a logged use, loss or inbound. An
 * approved loss reaches Finance as prj:LOSS. */
export async function decideStoreMove(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, storeId: string, index: number, decision: MoveDecision, costHint: number | null): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "store.approve")
    const { ref, line } = await readStore(tx, firestore, projectId, storeId)
    const move = line?.moves[index]
    if (!line || !move) throw new PmSupplyError("missing")
    const selfAllowed = await readSelfApproval(tx, firestore, project.organizationId)
    const refusal = decideRefusal(move, decision, actor.uid, selfAllowed)
    if (refusal === "self") refuse("self_approval", "store.approve")
    if (refusal) throw new PmSupplyError("blocked", [refusal])
    const day = todayDay()
    const next = decidedMove(move, decision, actor, day)
    tx.update(ref, { moves: line.moves.map((m, i) => (i === index ? next : m)), updatedAt: serverTimestamp() })
    const no = pm.no ?? projectId
    if (decision === "sup")
      outbox(tx, firestore, { key: `prj:SRET:${no}:${storeId}:${index}`, kind: "SRET", project, projectId, projectNo: no, amount: costHint != null ? r2(costHint * move.q) : 0, params: { material: line.name, unit: line.unit, qty: move.q, why: move.why ?? "", note: move.note ?? "", project: project.name ?? "" }, by: actor.uid })
    if (decision === "ok" && move.t === "rx" && move.from === "cash")
      outbox(tx, firestore, { key: `prj:NOPO:${no}:${storeId}:${index}`, kind: "NOPO", project, projectId, projectNo: no, amount: costHint != null ? r2(costHint * move.q) : 0, params: { material: line.name, unit: line.unit, qty: move.q, note: move.note ?? "", project: project.name ?? "" }, by: actor.uid })
    if (decision === "ok" && move.t === "loss") {
      const projectNo = pm.no ?? projectId
      const key = `prj:LOSS:${projectNo}:${storeId}:${index}`
      tx.set(doc(firestore, PM_EVENTS, pmEventDocId(project.organizationId ?? "", key)), {
        key,
        kind: "LOSS",
        organizationId: project.organizationId ?? "",
        projectId,
        projectNo,
        amount: costHint != null ? r2(costHint * move.q) : 0,
        params: { material: line.name, unit: line.unit, qty: move.q, why: move.why ?? "", unitCost: costHint ?? 0 },
        by: actor.uid,
        at: new Date().toISOString(),
      })
    }
  })
}

/** The receiving project's engineer confirms a material moved in; the sending
 * project's move closes with it, and the cost moves (prj:XFER). */
export async function confirmMoveIn(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, storeId: string, index: number, costHint: number | null): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "store.move")
    const { ref, line } = await readStore(tx, firestore, projectId, storeId)
    const move = line?.moves[index]
    if (!line || !move) throw new PmSupplyError("missing")
    if (move.t !== "xi" || move.st !== "wait") throw new PmSupplyError("blocked", ["not_waiting"])
    const day = todayDay()
    let src: { ref: ReturnType<typeof doc>; line: PmStoreLine | null } | null = null
    if (move.otherProjectId && move.srcStoreId) src = await readStore(tx, firestore, move.otherProjectId, move.srcStoreId)
    tx.update(ref, { moves: line.moves.map((m, i) => (i === index ? { ...m, st: "done", appr: actor.uid, apprName: actor.name, apprOn: day } : m)), updatedAt: serverTimestamp() })
    if (src?.line && move.srcMove != null && src.line.moves[move.srcMove]?.t === "xo") {
      tx.update(src.ref, { moves: src.line.moves.map((m, i) => (i === move.srcMove ? { ...m, st: "done" } : m)), updatedAt: serverTimestamp() })
    }
    const projectNo = pm.no ?? projectId
    const key = `prj:XFER:${projectNo}:${storeId}:${index}`
    tx.set(doc(firestore, PM_EVENTS, pmEventDocId(project.organizationId ?? "", key)), {
      key,
      kind: "XFER",
      organizationId: project.organizationId ?? "",
      projectId,
      projectNo,
      amount: costHint != null ? r2(costHint * move.q) : 0,
      params: { material: line.name, unit: line.unit, qty: move.q, fromProjectId: move.otherProjectId ?? "", fromProject: move.otherProjectName ?? "", unitCost: costHint ?? 0 },
      by: actor.uid,
      at: new Date().toISOString(),
    })
  })
}

/** Inventory confirms a return is back in its main store (the keeper's act, from
 * Inventory's desk): the move closes, and the stock is Inventory's again. With
 * `landing`, the same transaction credits the warehouse the move names — on the
 * row `landing.itemId` (found by the caller: transactions cannot query), or a
 * new row when null or when that row no longer matches. */
export async function confirmStoreReturn(firestore: Firestore, projectId: string, actor: SupplyActor, storeId: string, index: number, landing?: { itemId: string | null }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const { ref, line } = await readStore(tx, firestore, projectId, storeId)
    const move = line?.moves[index]
    if (!line || !move) throw new PmSupplyError("missing")
    if (!returnWaiting(move)) throw new PmSupplyError("blocked", ["not_waiting"])
    let credit: (() => void) | null = null
    if (landing) {
      if (!move.warehouseId) throw new PmSupplyError("blocked", ["no_warehouse"])
      const wh = await tx.get(doc(firestore, "warehouses", move.warehouseId))
      if (!wh.exists()) throw new PmSupplyError("blocked", ["no_warehouse"])
      const orgId = (wh.data() as { organizationId?: string }).organizationId ?? null
      if (orgId !== (project.organizationId ?? null)) throw new PmSupplyError("blocked", ["other_org"])
      const rowRef = landing.itemId ? doc(firestore, "warehouses", move.warehouseId, "inventoryItems", landing.itemId) : null
      const row = rowRef ? await tx.get(rowRef) : null
      const cur = row?.exists() ? (row.data() as { quantity?: number; unit?: string; trackingMode?: string | null }) : null
      const whId = move.warehouseId
      credit =
        rowRef && cur && cur.trackingMode !== "unit"
          ? () => tx.update(rowRef, { quantity: r3(Math.max(0, Number(cur.quantity) || 0) + move.q), updatedAt: serverTimestamp() })
          : () =>
              tx.set(doc(collection(firestore, "warehouses", whId, "inventoryItems")), {
                name: line.name,
                sku: null,
                quantity: move.q,
                unit: line.unit,
                unitCost: null,
                minStockLevel: null,
                trackingMode: null,
                organizationId: orgId,
                warehouseId: whId,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              })
    }
    const day = todayDay()
    tx.update(ref, { moves: line.moves.map((m, i) => (i === index ? { ...m, st: "done", invBy: actor.uid, invByName: actor.name, invOn: day } : m)), updatedAt: serverTimestamp() })
    credit?.()
  })
}

// ── Direct purchases ─────────────────────────────────────────────────────────

/** A site purchase under the cap, with its receipt number. It reaches Finance as
 * a project cost (prj:CASH). Above the per-purchase cap it is a normal request. */
export async function logDirectPurchase(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, input: { what: string; supplier: string; amount: number; receipt: string | null; day: string; files?: PmAttachment[] | null }): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "supply.request")
    const today = todayDay()
    blocked(pettyBlocks({ archived: fresh.archived, what: input.what, supplier: input.supplier, amount: input.amount, day: input.day, today }))
    seq = (pm.pettyCount ?? 0) + 1
    tx.set(doc(firestore, "projects", projectId, PM_PETTY, pettyNo(seq)), {
      seq,
      what: input.what.trim(),
      supplier: input.supplier.trim(),
      amount: r2(input.amount),
      receipt: input.receipt?.trim() || null,
      files: cleanAttachments(input.files),
      day: input.day,
      by: actor.uid,
      byName: actor.name,
      organizationId: project.organizationId ?? null,
      createdAt: serverTimestamp(),
    })
    const projectNo = pm.no ?? projectId
    const key = `prj:CASH:${projectNo}:${pettyNo(seq)}`
    tx.set(doc(firestore, PM_EVENTS, pmEventDocId(project.organizationId ?? "", key)), {
      key,
      kind: "CASH",
      organizationId: project.organizationId ?? "",
      projectId,
      projectNo,
      amount: r2(input.amount),
      params: { what: input.what.trim(), supplier: input.supplier.trim(), receipt: input.receipt?.trim() || "", day: input.day },
      by: actor.uid,
      at: new Date().toISOString(),
    })
    tx.update(ref, { pm: { ...pm, pettyCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

// ── Equipment requests ───────────────────────────────────────────────────────

export interface PlantInput {
  category: PlantCategory
  what: string
  activityId: string | null
  activityName: string | null
  hasActivities: boolean
  from: string
  to: string
  qty: number
  operator: boolean
  whyK: PlantWhy
  why: string | null
}

/** Say what is needed and when — never where it comes from. The manager's own
 * request goes straight to the plant desk. */
export async function requestPlant(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, input: PlantInput): Promise<{ seq: number; status: "wait" | "go" }> {
  let out: { seq: number; status: "wait" | "go" } = { seq: 0, status: "wait" }
  let desk: PlantDeskNotice | null = null
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "plant.request")
    blocked(plantBlocks({ archived: fresh.archived, ...input }))
    // Requests draw their own counter; before it existed they shared `plantCount`
    // with the units on site, so it starts from there and never reuses a number.
    const seq = (pm.plantReqCount ?? pm.plantCount ?? 0) + 1
    const self = pmCan(fresh, "approve")
    const day = todayDay()
    tx.set(doc(firestore, "projects", projectId, PM_PLANT, plantNo(seq)), {
      seq,
      category: input.category,
      what: input.what.trim(),
      activityId: input.activityId,
      activityName: input.activityName,
      from: input.from,
      to: input.to,
      qty: input.qty,
      operator: input.category === "heavy" || input.category === "lift" ? input.operator : false,
      whyK: input.whyK,
      why: input.why?.trim() || null,
      status: self ? "go" : "wait",
      day,
      by: actor.uid,
      byName: actor.name,
      decidedBy: self ? actor.uid : null,
      decidedByName: self ? actor.name : null,
      decidedOn: self ? day : null,
      organizationId: project.organizationId ?? null,
      createdAt: serverTimestamp(),
    })
    tx.update(ref, { pm: { ...pm, plantReqCount: seq }, updatedAt: serverTimestamp() })
    out = { seq, status: self ? "go" : "wait" }
    desk = { organizationId: project.organizationId ?? "", project: project.name ?? pm.no ?? projectId, seq, what: input.what.trim(), qty: input.qty, from: input.from, to: input.to }
  })
  // The manager's own request is approved by the writing of it: the equipment desk is told now.
  if (out.status === "go" && desk) await tellPlantDesk(firestore, actor, desk)
  return out
}

export async function decidePlant(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, seq: number, approve: boolean): Promise<void> {
  let desk: PlantDeskNotice | null = null
  await runTransaction(firestore, async (tx) => {
    const { project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "request.decide")
    const ref = doc(firestore, "projects", projectId, PM_PLANT, plantNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmSupplyError("missing")
    const data = snap.data() as { status?: string; what?: string; qty?: number; from?: string; to?: string }
    if (data.status !== "wait") throw new PmSupplyError("blocked", ["not_pending"])
    tx.update(ref, { status: approve ? "go" : "rej", decidedBy: actor.uid, decidedByName: actor.name, decidedOn: todayDay(), updatedAt: serverTimestamp() })
    desk = { organizationId: project.organizationId ?? "", project: project.name ?? pm.no ?? projectId, seq, what: data.what ?? "", qty: data.qty ?? 1, from: data.from ?? "", to: data.to ?? "" }
  })
  // Approved: the request is the equipment desk's now (best effort, after the commit).
  if (approve && desk) await tellPlantDesk(firestore, actor, desk)
}

interface PlantDeskNotice {
  organizationId: string
  project: string
  seq: number
  what: string
  qty: number
  from: string
  to: string
}

/** Tell the store keepers (warehouses.manage) that an approved equipment request waits on their desk. */
async function tellPlantDesk(firestore: Firestore, actor: SupplyActor, n: PlantDeskNotice): Promise<void> {
  if (!n.organizationId) return
  await emitProcEvent(firestore, { uid: actor.uid, name: actor.name ?? "" }, {
    kind: "plant_requested",
    organizationId: n.organizationId,
    to: [{ permission: "warehouses.manage" }],
    params: { no: plantNo(n.seq), what: n.what, qty: n.qty, project: n.project, from: n.from, to: n.to },
    link: procLinks.plantDesk(),
  })
}


async function readPlantRequest(tx: Transaction, firestore: Firestore, projectId: string, seq: number) {
  const ref = doc(firestore, "projects", projectId, PM_PLANT, plantNo(seq))
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmSupplyError("missing")
  return { ref, r: { id: snap.id, ...(snap.data() as Omit<PmPlantRequest, "id">) } }
}

/** Record what the plant desk answered (allocated · busy until · alternative ·
 * none) — the site's record of the reply until the desk has its own screen. */
export async function recordPlantReply(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SupplyActor,
  seq: number,
  input: { k: PlantReplyKind | null; unit?: string | null; free?: string | null; text?: string | null; on: string }
): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "plant.request")
    const { ref, r } = await readPlantRequest(tx, firestore, projectId, seq)
    blocked(plantReplyBlocks({ archived: fresh.archived, r, ...input, today: todayDay() }))
    tx.update(ref, {
      rep: { k: input.k, unit: input.k === "alloc" ? input.unit?.trim() || null : null, free: input.k === "late" ? input.free || null : null, text: input.text?.trim() || null, on: input.on, by: actor.uid, byName: actor.name },
      updatedAt: serverTimestamp(),
    })
  })
}

/** «استأجر بدلها»: the fleet cannot serve it — the approver sends it to
 * Procurement as a timed hire (prj:EQH), dated from and to as asked. */
export async function hirePlantInstead(firestore: Firestore, ctx: PmContext, projectId: string, actor: SupplyActor, seq: number): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "request.decide")
    const { ref, r } = await readPlantRequest(tx, firestore, projectId, seq)
    if (fresh.archived) blocked(["archived"])
    if (!plantHireable(r)) blocked(["not_hireable"])
    const day = todayDay()
    tx.update(ref, { rep: { k: "hire", unit: null, free: null, text: r.rep?.k ?? null, on: day, by: actor.uid, byName: actor.name }, updatedAt: serverTimestamp() })
    const projectNo = pm.no ?? projectId
    const key = `prj:EQH:${projectNo}:${plantNo(seq)}`
    tx.set(doc(firestore, PM_EVENTS, pmEventDocId(project.organizationId ?? "", key)), {
      key,
      kind: "EQH",
      organizationId: project.organizationId ?? "",
      projectId,
      projectNo,
      amount: 0,
      params: { request: plantNo(seq), what: r.what, category: r.category, qty: r.qty, from: r.from, to: r.to, operator: r.operator, reply: r.rep?.k ?? "" },
      by: actor.uid,
      at: new Date().toISOString(),
    })
  })
}
