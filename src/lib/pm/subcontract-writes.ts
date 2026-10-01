// PM 1.0 — subcontract writes (WF-11, WF-12, SC-01…03). One transaction per
// act, the guard first on the project just read. Contracts, certificates and
// custody lines are numbered by the project (`pm.subcontractCount`,
// `pm.subCertCount`, `pm.subCustodyCount`) and never deleted.
//
// A line's `certified` moves only when a certificate is approved — by someone
// other than its preparer (or by its preparer under the company's recorded
// self-approval), within their riyal limit — and prj:SC goes to Finance in that
// same write. Recoveries are deducted when a certificate is PREPARED, so one
// recovery can never reach two certificates; a certificate takes only what it
// can bear, and one withdrawn before approval gives back what it took.
//
// Custody lives on the project store ledger: an issue, a return and a count are
// moves on `pmStore/{storeId}` carrying his party key, and a recovery is kept on
// the same line. The `pmSubCustody` writes below stay for projects that recorded
// custody before the ledger existed.

import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, PmAccessError, pmCan, type PmContext } from "./access"
import { PM_EVENTS, pmEventDocId } from "./events"
import { todayDay } from "./format"
import { readSelfApproval } from "./info-writes"
import { withFreshState } from "./project-writes"
import { cleanAttachments, type PmAttachment } from "./attachments"
import { PM_STORE, r3, storeLineOf, type PmStoreLine, type StoreItem, type StoreMove, type StoreRecovery } from "./store"
import {
  custodyBlocks,
  custodyFigures,
  custodyNo,
  engineerHold,
  fitRecoveries,
  freeQty,
  ledgerCustody,
  letQty,
  lineCap,
  lineKey,
  moveBlocks,
  partyKey,
  pmApprovalLimit,
  PM_SUB_CERTIFICATES,
  PM_SUB_CUSTODY,
  PM_SUBCONTRACTS,
  r2,
  recoveryAmount,
  recoveryBlocks,
  recoveryRoom,
  stampRecoveries,
  subApproveRefusal,
  subCertBlocks,
  subCertificateAmounts,
  subCertificateEvent,
  subCertificateLines,
  subCertificateNo,
  subcontractBlocks,
  subcontractNo,
  subStoreBlocks,
  subWithdrawRefusal,
  unstampRecoveries,
  type CustodyMove,
  type CustodyRecovery,
  type PmSubcontract,
  type PmSubCertificate,
  type PmSubCustody,
  type SubCertRecovery,
  type SubcontractLine,
  type SubParty,
} from "./subcontract"

export class PmSubError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "wrong_state" | "stale" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmSubError"
  }
}

export interface SubActor {
  uid: string
  name: string | null
}

type PmCounters = { no?: string; subcontractCount?: number; subCertCount?: number; subCustodyCount?: number }
type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: PmCounters & Record<string, unknown> }

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmSubError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmSubError("not_pm_project")
  return { ref, project, pm: project.pm }
}

type ItemFacts = { id: string; code: string | null; description: string | null; unit: string | null; quantity: number; executed: number }

async function readItem(tx: Transaction, firestore: Firestore, projectId: string, itemId: string): Promise<ItemFacts | null> {
  const snap = await tx.get(doc(firestore, "projects", projectId, "boqItems", itemId))
  if (!snap.exists()) return null
  const d = snap.data() as Record<string, unknown>
  return {
    id: itemId,
    code: (d.itemNo as string) ?? null,
    description: ((d.descriptionAr as string) || (d.descriptionEn as string)) ?? null,
    unit: (d.unit as string) ?? null,
    quantity: num(d.quantity),
    executed: num(d.executedQuantity),
  }
}

async function allContracts(firestore: Firestore, projectId: string): Promise<PmSubcontract[]> {
  const snap = await getDocs(collection(firestore, "projects", projectId, PM_SUBCONTRACTS))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PmSubcontract, "id">) }))
}

/** Every contract the project has numbered, read by its number INSIDE the
 * transaction — a transaction cannot run a query, but the project numbers its
 * contracts 01…`pm.subcontractCount`, so each one has a known id. */
async function contractsByNumber(tx: Transaction, firestore: Firestore, projectId: string, count: number): Promise<PmSubcontract[]> {
  const snaps = await Promise.all(Array.from({ length: count }, (_, i) => tx.get(doc(firestore, "projects", projectId, PM_SUBCONTRACTS, subcontractNo(i + 1)))))
  return snaps.flatMap((s) => (s.exists() ? [{ id: s.id, ...(s.data() as Omit<PmSubcontract, "id">) }] : []))
}

export interface RegisterInput {
  party: SubParty
  retentionPct: number
  startOn: string
  endOn: string | null
  note: string | null
  lines: Array<{ itemId: string; qty: number; rate: number }>
  files?: PmAttachment[] | null
}

/** Register a subcontract: his scope from the BOQ with his quantity and rate.
 * Its value is a commitment; above the registrar's riyal limit the owner registers it.
 * What is already let on each line is read in this same transaction — two
 * registrations at once both write the project's counter, so the second re-runs
 * and sees the first; a list fetched beforehand could let a line twice. */
export async function registerSubcontract(firestore: Firestore, ctx: PmContext, projectId: string, actor: SubActor, input: RegisterInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "subcontract.manage")
    const others = await contractsByNumber(tx, firestore, projectId, pm.subcontractCount ?? 0)
    const items: ItemFacts[] = []
    for (const id of [...new Set(input.lines.map((l) => l.itemId))]) {
      const it = await readItem(tx, firestore, projectId, id)
      if (!it) throw new PmSubError("blocked", ["bad_line"])
      items.push(it)
    }
    const itemOf = (id: string) => items.find((i) => i.id === id)!
    const blocks = subcontractBlocks({
      archived: fresh.archived,
      partyName: input.party.name,
      lines: input.lines.map((l) => {
        const it = itemOf(l.itemId)
        return { ...l, free: it.quantity > 0 ? freeQty(it.quantity, letQty(others, l.itemId)) : null }
      }),
      retentionPct: input.retentionPct,
      startOn: input.startOn,
      endOn: input.endOn,
      limit: pmApprovalLimit(fresh.ceiling),
    })
    if (blocks.length) throw new PmSubError("blocked", blocks)
    seq = (pm.subcontractCount ?? 0) + 1
    const party: SubParty = { name: input.party.name.trim(), supplierId: input.party.supplierId || null }
    const lines: SubcontractLine[] = input.lines
      .filter((l) => l.qty > 0 && l.rate > 0)
      .map((l) => {
        const it = itemOf(l.itemId)
        return { itemId: l.itemId, code: it.code, description: it.description, unit: it.unit, qty: r2(l.qty), rate: r2(l.rate), value: r2(l.qty * l.rate), certified: 0 }
      })
    const contract: Omit<PmSubcontract, "id"> = {
      seq,
      party,
      partyKey: partyKey(party),
      retention: r2(input.retentionPct) / 100,
      startOn: input.startOn,
      endOn: input.endOn || null,
      note: input.note?.trim() || null,
      lines,
      value: r2(lines.reduce((a, l) => a + l.value, 0)),
      paid: 0,
      files: cleanAttachments(input.files),
      by: actor.uid,
      byName: actor.name,
      on: todayDay(),
    }
    tx.set(doc(firestore, "projects", projectId, PM_SUBCONTRACTS, subcontractNo(seq)), { ...contract, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, subcontractCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

export interface PrepareSubInput {
  partyKey: string
  /** Cumulative % per line, keyed `lineKey(contractSeq, index)`; absent = unchanged. */
  percents: Record<string, number>
}

/** Prepare a subcontractor's certificate across his contracts: each line capped
 * at what we measured on its BOQ line, retention at his contract's rate, and
 * the recoveries awaiting deduction taken now — as far as the certificate can
 * bear them; what does not fit stays awaiting his next one. Waits for approval. */
export async function prepareSubCertificate(firestore: Firestore, ctx: PmContext, projectId: string, actor: SubActor, input: PrepareSubInput): Promise<{ seq: number; gross: number; recovery: number }> {
  const contracts = await allContracts(firestore, projectId)
  const certSnap = await getDocs(collection(firestore, "projects", projectId, PM_SUB_CERTIFICATES))
  const certs = certSnap.docs.map((d) => d.data() as Omit<PmSubCertificate, "id">)
  const custodySnap = await getDocs(query(collection(firestore, "projects", projectId, PM_SUB_CUSTODY), where("partyKey", "==", input.partyKey)))
  const custodyIds = custodySnap.docs.map((d) => d.id)
  const storeSnap = await getDocs(collection(firestore, "projects", projectId, PM_STORE))
  const storeIds = storeSnap.docs.filter((d) => ((d.data() as Partial<PmStoreLine>).recoveries ?? []).some((r) => r.sub === input.partyKey && r.certSeq === null)).map((d) => d.id)
  const mine = contracts.filter((c) => c.partyKey === input.partyKey)
  let out = { seq: 0, gross: 0, recovery: 0 }

  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "subcontract.manage")
    if ((pm.subCertCount ?? 0) !== certs.length || !mine.length) throw new PmSubError("stale")

    const freshMine: PmSubcontract[] = []
    for (const c of mine) {
      const snap = await tx.get(doc(firestore, "projects", projectId, PM_SUBCONTRACTS, c.id))
      if (!snap.exists()) throw new PmSubError("stale")
      freshMine.push({ id: snap.id, ...(snap.data() as Omit<PmSubcontract, "id">) })
    }
    const everyone = [...contracts.filter((c) => c.partyKey !== input.partyKey), ...freshMine]
    const caps: Record<string, number> = {}
    const items = new Map<string, ItemFacts | null>()
    for (const c of freshMine) {
      for (const [index, l] of c.lines.entries()) {
        if (!items.has(l.itemId)) items.set(l.itemId, await readItem(tx, firestore, projectId, l.itemId))
        const it = items.get(l.itemId)
        caps[lineKey(c.seq, index)] = it ? lineCap({ executed: it.executed, itemQty: it.quantity, letQty: letQty(everyone, l.itemId) }) : 0
      }
    }
    const custody: PmSubCustody[] = []
    for (const id of custodyIds) {
      const snap = await tx.get(doc(firestore, "projects", projectId, PM_SUB_CUSTODY, id))
      if (snap.exists()) custody.push({ id: snap.id, ...(snap.data() as Omit<PmSubCustody, "id">) })
    }

    const stores: Array<{ ref: ReturnType<typeof doc>; line: PmStoreLine }> = []
    for (const id of storeIds) {
      const sRef = doc(firestore, "projects", projectId, PM_STORE, id)
      const snap = await tx.get(sRef)
      if (snap.exists()) stores.push({ ref: sRef, line: storeLineOf(id, snap.data() as Partial<PmStoreLine>) })
    }

    const prepared = subCertificateLines(freshMine, input.percents, caps)
    const due: SubCertRecovery[] = [
      ...custody.flatMap((c) => c.recoveries.flatMap((r, index) => (r.certSeq === null ? [{ custodySeq: c.seq, index, amount: r.amount }] : []))),
      ...stores.flatMap(({ line }) => (line.recoveries ?? []).flatMap((r, index) => (r.sub === input.partyKey && r.certSeq === null ? [{ custodySeq: 0, storeId: line.id, index, amount: r.amount }] : []))),
    ]
    const { taken } = fitRecoveries(due, recoveryRoom(prepared.lines))
    const recoveries: SubCertRecovery[] = taken.map(({ custodySeq, storeId, index, amount }) => ({ custodySeq, ...(storeId ? { storeId } : {}), index, amount }))
    const amounts = subCertificateAmounts(prepared.lines, recoveries.reduce((a, r) => a + r.amount, 0))
    const blocks = subCertBlocks({
      archived: fresh.archived,
      gross: amounts.gross,
      over: prepared.over.length,
      below: prepared.below.length,
      pending: certs.some((c) => c.partyKey === input.partyKey && c.status === "int"),
    })
    if (blocks.length) throw new PmSubError("blocked", blocks)

    const seq = (pm.subCertCount ?? 0) + 1
    const cert: Omit<PmSubCertificate, "id"> = {
      seq,
      party: freshMine[0].party,
      partyKey: input.partyKey,
      lines: prepared.lines,
      recoveries,
      ...amounts,
      status: "int",
      prep: actor.uid,
      prepName: actor.name,
      prepOn: todayDay(),
      appr: null,
      apprName: null,
      apprOn: null,
      selfApp: false,
    }
    tx.set(doc(firestore, "projects", projectId, PM_SUB_CERTIFICATES, subCertificateNo(seq)), { ...cert, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    // Only what this certificate took carries its number; the rest stays unstamped.
    for (const c of custody) {
      const picks = taken.filter((r) => r.custodySeq === c.seq)
      if (picks.length) tx.update(doc(firestore, "projects", projectId, PM_SUB_CUSTODY, c.id), { recoveries: stampRecoveries(c.recoveries, picks, seq), updatedAt: serverTimestamp() })
    }
    for (const { ref: sRef, line } of stores) {
      const picks = taken.filter((r) => r.storeId === line.id)
      if (picks.length) tx.update(sRef, { recoveries: stampRecoveries(line.recoveries ?? [], picks, seq), updatedAt: serverTimestamp() })
    }
    tx.update(ref, { pm: { ...pm, subCertCount: seq }, updatedAt: serverTimestamp() })
    out = { seq, gross: amounts.gross, recovery: amounts.recovery }
  })
  return out
}

/** Approve: `ipcOk`, within the approver's riyal limit (the owner has none), and
 * never its preparer — unless the company records self-approval (SC-02 for a
 * firm of one), in which case it is marked `selfApp` beside the approver's name.
 * Each line's certified share moves to the certificate's, and prj:SC goes to
 * Finance — which pays and handles VAT. */
export async function approveSubCertificate(firestore: Firestore, ctx: PmContext, projectId: string, actor: SubActor, seq: number): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    const ref = doc(firestore, "projects", projectId, PM_SUB_CERTIFICATES, subCertificateNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmSubError("missing")
    const cert = { id: snap.id, ...(snap.data() as Omit<PmSubCertificate, "id">) }
    if (cert.status !== "int") throw new PmSubError("wrong_state")
    const limit = pmApprovalLimit(fresh.ceiling)
    const selfApproval = await readSelfApproval(tx, firestore, project.organizationId)
    const why = subApproveRefusal({ archived: fresh.archived, ipcOk: pmCan(fresh, "ipcOk"), actorUid: actor.uid, prep: cert.prep, amount: cert.gross, limit, selfApproval })
    if (why === "over_limit") throw new PmSubError("blocked", ["over_limit"])
    if (why) throw new PmAccessError(why, "subcontract.certificate.approve")

    const touched = [...new Set(cert.lines.map((l) => l.subcontractSeq))]
    const contracts: Array<{ ref: ReturnType<typeof doc>; data: PmSubcontract }> = []
    for (const s of touched) {
      const cRef = doc(firestore, "projects", projectId, PM_SUBCONTRACTS, subcontractNo(s))
      const c = await tx.get(cRef)
      if (!c.exists()) throw new PmSubError("missing")
      contracts.push({ ref: cRef, data: { id: c.id, ...(c.data() as Omit<PmSubcontract, "id">) } })
    }
    for (const { ref: cRef, data } of contracts) {
      const lines = data.lines.map((l, index) => {
        const moved = cert.lines.find((x) => x.subcontractSeq === data.seq && x.index === index)
        return moved ? { ...l, certified: Math.max(l.certified, moved.to) } : l
      })
      tx.update(cRef, { lines, updatedAt: serverTimestamp() })
    }
    // `selfApp` is written only when it IS one: a certificate prepared before the
    // field existed keeps the keys an ordinary approval changes as they were.
    tx.update(ref, { status: "ok", appr: actor.uid, apprName: actor.name, apprOn: todayDay(), ...(actor.uid === cert.prep ? { selfApp: true } : {}), updatedAt: serverTimestamp() })
    const event = subCertificateEvent({
      organizationId: project.organizationId ?? "",
      projectId,
      projectNo: pm.no ?? projectId,
      cert,
      by: actor.uid,
      at: new Date().toISOString(),
    })
    tx.set(doc(firestore, PM_EVENTS, pmEventDocId(event.organizationId, event.key)), event)
  })
}

/** Withdraw a prepared certificate before approval — by its preparer or by
 * whoever approves certificates. Without it a wrong percentage, or a
 * certificate nobody else may approve, blocks every later one for him and
 * holds the close gate shut. It becomes `void` (kept, its number never
 * reused), nothing was certified, and the recoveries it took are free again. */
export async function withdrawSubCertificate(firestore: Firestore, ctx: PmContext, projectId: string, actor: SubActor, seq: number): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    const ref = doc(firestore, "projects", projectId, PM_SUB_CERTIFICATES, subCertificateNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmSubError("missing")
    const cert = { id: snap.id, ...(snap.data() as Omit<PmSubCertificate, "id">) }
    const why = subWithdrawRefusal({ archived: fresh.archived, status: cert.status, actorUid: actor.uid, prep: cert.prep, sub: pmCan(fresh, "sub"), ipcOk: pmCan(fresh, "ipcOk") })
    if (why === "wrong_state") throw new PmSubError("wrong_state")
    if (why) throw new PmAccessError(why, "subcontract.certificate.withdraw")

    const taken = cert.recoveries ?? []
    const custody: Array<{ ref: ReturnType<typeof doc>; recoveries: CustodyRecovery[] }> = []
    for (const s of [...new Set(taken.filter((r) => !r.storeId).map((r) => r.custodySeq))]) {
      const cRef = doc(firestore, "projects", projectId, PM_SUB_CUSTODY, custodyNo(s))
      const c = await tx.get(cRef)
      if (c.exists()) custody.push({ ref: cRef, recoveries: (c.data() as Omit<PmSubCustody, "id">).recoveries ?? [] })
    }
    const stores: Array<{ ref: ReturnType<typeof doc>; recoveries: StoreRecovery[] }> = []
    for (const id of [...new Set(taken.flatMap((r) => (r.storeId ? [r.storeId] : [])))]) {
      const sRef = doc(firestore, "projects", projectId, PM_STORE, id)
      const x = await tx.get(sRef)
      if (x.exists()) stores.push({ ref: sRef, recoveries: storeLineOf(id, x.data() as Partial<PmStoreLine>).recoveries ?? [] })
    }

    for (const c of custody) tx.update(c.ref, { recoveries: unstampRecoveries(c.recoveries, seq), updatedAt: serverTimestamp() })
    for (const x of stores) tx.update(x.ref, { recoveries: unstampRecoveries(x.recoveries, seq), updatedAt: serverTimestamp() })
    tx.update(ref, { status: "void", voidBy: actor.uid, voidByName: actor.name, voidOn: todayDay(), updatedAt: serverTimestamp() })
  })
}

export interface CustodyInput {
  subcontractSeq: number
  itemId: string
  material: string
  unit: string
  unitCost: number
  perUnit: number
  waste: number
  issueQty: number
  day: string
  note: string | null
}

/** Material issued into a subcontractor's custody against a line of his contract
 * (the first issue opens the custody line; tracking starts at today's executed). */
export async function openCustody(firestore: Firestore, ctx: PmContext, projectId: string, actor: SubActor, input: CustodyInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "store.move")
    const cSnap = await tx.get(doc(firestore, "projects", projectId, PM_SUBCONTRACTS, subcontractNo(input.subcontractSeq)))
    const contract = cSnap.exists() ? (cSnap.data() as Omit<PmSubcontract, "id">) : null
    const item = await readItem(tx, firestore, projectId, input.itemId)
    const blocks: string[] = [
      ...custodyBlocks({
        archived: fresh.archived,
        contract: Boolean(contract),
        itemInContract: Boolean(contract?.lines.some((l) => l.itemId === input.itemId)) && Boolean(item),
        material: input.material,
        unit: input.unit,
        perUnit: input.perUnit,
        unitCost: input.unitCost,
        waste: input.waste,
      }),
      ...moveBlocks({ archived: false, kind: "iss", q: input.issueQty, issued: 0, day: input.day, today: todayDay() }),
    ]
    if (blocks.length || !contract || !item) throw new PmSubError("blocked", blocks)
    seq = (pm.subCustodyCount ?? 0) + 1
    const first: CustodyMove = { t: "iss", q: r2(input.issueQty), day: input.day, by: actor.uid, byName: actor.name, note: input.note?.trim() || null }
    const custody: Omit<PmSubCustody, "id"> = {
      seq,
      subcontractSeq: input.subcontractSeq,
      party: contract.party,
      partyKey: contract.partyKey,
      itemId: input.itemId,
      code: item.code,
      material: input.material.trim(),
      unit: input.unit.trim(),
      unitCost: r2(input.unitCost),
      perUnit: input.perUnit,
      waste: input.waste,
      executedAtStart: item.executed,
      moves: [first],
      recoveries: [],
      by: actor.uid,
      on: todayDay(),
    }
    tx.set(doc(firestore, "projects", projectId, PM_SUB_CUSTODY, custodyNo(seq)), { ...custody, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, subCustodyCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

async function readCustody(tx: Transaction, firestore: Firestore, projectId: string, seq: number) {
  const ref = doc(firestore, "projects", projectId, PM_SUB_CUSTODY, custodyNo(seq))
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmSubError("missing")
  return { ref, custody: { id: snap.id, ...(snap.data() as Omit<PmSubCustody, "id">) } }
}

/** A further issue, a return, or a physical count (with his representative signing). */
export async function recordCustodyMove(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SubActor,
  seq: number,
  input: { t: "iss" | "back" | "cnt"; q: number; day: string; note: string | null }
): Promise<{ gap: number | null }> {
  let gap: number | null = null
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, input.t === "cnt" ? "reconciliation.manage" : "store.move")
    const { ref, custody } = await readCustody(tx, firestore, projectId, seq)
    const item = await readItem(tx, firestore, projectId, custody.itemId)
    const before = custodyFigures(custody, item?.executed ?? custody.executedAtStart)
    const blocks = moveBlocks({ archived: fresh.archived, kind: input.t, q: input.q, issued: before.issued, day: input.day, today: todayDay(), lastCount: before.count?.day ?? null })
    if (blocks.length) throw new PmSubError("blocked", blocks)
    const move: CustodyMove = { t: input.t, q: r2(input.q), day: input.day, by: actor.uid, byName: actor.name, note: input.note?.trim() || null }
    const moves = [...custody.moves, move]
    gap = custodyFigures({ ...custody, moves }, item?.executed ?? custody.executedAtStart).gap
    tx.update(ref, { moves, updatedAt: serverTimestamp() })
  })
  return { gap }
}

/** Recover the value of his waste: deducted from his next certificate, before
 * retention. Booked as an accounting return so the book and the count agree.
 * Never more than the gap still open on his last count — checked here, on the
 * line just read, so the same gap cannot be charged twice. */
export async function recordRecovery(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SubActor,
  seq: number,
  input: { q: number; rate: number; double: boolean; note: string | null }
): Promise<number> {
  let amount = 0
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "reconciliation.manage")
    const { ref, custody } = await readCustody(tx, firestore, projectId, seq)
    const item = await readItem(tx, firestore, projectId, custody.itemId)
    const { gap } = custodyFigures(custody, item?.executed ?? custody.executedAtStart)
    const blocks = recoveryBlocks({ archived: fresh.archived, q: input.q, rate: input.rate, gap })
    if (blocks.length) throw new PmSubError("blocked", blocks)
    amount = recoveryAmount(input.q, input.rate, input.double)
    const day = todayDay()
    const note = input.note?.trim() || null
    tx.update(ref, {
      recoveries: [...custody.recoveries, { q: r2(input.q), rate: r2(input.rate), double: input.double, amount, day, by: actor.uid, byName: actor.name, note, certSeq: null }],
      moves: [...custody.moves, { t: "back", q: r2(input.q), day, by: actor.uid, byName: actor.name, note, recovery: true }],
      updatedAt: serverTimestamp(),
    })
  })
  return amount
}

// ── Custody on the project store ledger ─────────────────────────────────────

async function readStoreFacts(tx: Transaction, firestore: Firestore, projectId: string, storeId: string) {
  const ref = doc(firestore, "projects", projectId, PM_STORE, storeId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmSubError("missing")
  const line = storeLineOf(storeId, snap.data() as Partial<PmStoreLine>)
  const items: StoreItem[] = []
  for (const id of Object.keys(line.rates || {})) {
    const it = await readItem(tx, firestore, projectId, id)
    if (it) items.push({ ...it, code: it.code ?? "", description: it.description ?? "", unit: it.unit ?? "" })
  }
  return { ref, line, items }
}

export interface SubStoreMoveInput {
  t: "iss" | "back" | "cnt"
  partyKey: string
  q: number
  day: string
  note: string | null
  /** A count: the signed count sheet. */
  files?: PmAttachment[] | null
}

/** Issue a material into a subcontractor's custody, take it back, or record a
 * count at his place (his representative signing). Custody moves only: the
 * material stays ours and the store balance does not move. An issue beyond his
 * entitlement is allowed with a reason — the excess is on him. */
export async function recordSubStoreMove(firestore: Firestore, ctx: PmContext, projectId: string, actor: SubActor, storeId: string, input: SubStoreMoveInput): Promise<{ gap: number | null; over: number }> {
  const contracts = await allContracts(firestore, projectId)
  let out: { gap: number | null; over: number } = { gap: null, over: 0 }
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, input.t === "cnt" ? "reconciliation.manage" : "store.move")
    const { ref, line, items } = await readStoreFacts(tx, firestore, projectId, storeId)
    const party = contracts.find((c) => c.partyKey === input.partyKey)?.party ?? null
    const before = ledgerCustody(line, items, contracts, input.partyKey)
    const blocks = subStoreBlocks({
      archived: fresh.archived,
      t: input.t,
      hasSub: Boolean(party),
      q: input.q,
      hold: engineerHold(line, items, contracts),
      custody: before,
      note: input.note,
      day: input.day,
      today: todayDay(),
      lastCount: before.count?.on ?? null,
    })
    if (blocks.length || !party) throw new PmSubError("blocked", blocks)
    const files = cleanAttachments(input.files)
    const move: StoreMove = { t: input.t, q: r3(input.q), on: input.day, by: actor.uid, byName: actor.name, sub: input.partyKey, subName: party.name, note: input.note?.trim() || null, ...(files.length ? { files } : {}) }
    const moves = [...line.moves, move]
    const after = ledgerCustody({ ...line, moves }, items, contracts, input.partyKey)
    out = { gap: after.gap, over: input.t === "iss" ? r2(Math.max(0, after.issued - after.cap)) : 0 }
    tx.update(ref, { moves, updatedAt: serverTimestamp() })
  })
  return out
}

/** Recover the value of his waste on a material: kept on the ledger line,
 * deducted from his next certificate before retention, and booked as an
 * accounting return so the book and the count agree. Never more than the gap
 * still open on his last count — re-read here, so it cannot be charged twice. */
export async function recordStoreRecovery(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SubActor,
  storeId: string,
  input: { partyKey: string; q: number; rate: number; double: boolean; note: string | null }
): Promise<number> {
  const contracts = await allContracts(firestore, projectId)
  let amount = 0
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "reconciliation.manage")
    const { ref, line, items } = await readStoreFacts(tx, firestore, projectId, storeId)
    const party = contracts.find((c) => c.partyKey === input.partyKey)?.party ?? null
    const { gap } = ledgerCustody(line, items, contracts, input.partyKey)
    const blocks: string[] = [...recoveryBlocks({ archived: fresh.archived, q: input.q, rate: input.rate, gap }), ...(party ? [] : ["no_sub"])]
    if (blocks.length || !party) throw new PmSubError("blocked", blocks)
    amount = recoveryAmount(input.q, input.rate, input.double)
    const day = todayDay()
    const note = input.note?.trim() || null
    const rec: StoreRecovery = { sub: input.partyKey, subName: party.name, q: r2(input.q), rate: r2(input.rate), double: input.double, amount, on: day, by: actor.uid, byName: actor.name, note, certSeq: null }
    const back: StoreMove = { t: "back", q: r2(input.q), on: day, by: actor.uid, byName: actor.name, sub: input.partyKey, subName: party.name, note, recovery: true }
    tx.update(ref, { recoveries: [...(line.recoveries ?? []), rec], moves: [...line.moves, back], updatedAt: serverTimestamp() })
  })
  return amount
}
