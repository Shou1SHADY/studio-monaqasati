// Inventory's writes on the PM boundary (rules in ./project-supply). The keeper
// holds no PM duty: the gate is warehouses.manage / warehouses.receive, checked
// here and again by the rules (a pmStore branch that only flips moves, and a
// purchaseRequests branch that only rewrites `lines`).

import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { todayDay } from "../pm/format"
import { PM_STORE, type PmStoreLine } from "../pm/store"
import { lineOut, PURCHASE_REQUESTS, requestOf } from "../pm/supply"
import { confirmStoreReturn } from "../pm/supply-writes"
import { buildReply, landingRow, projectArchived, replyBlocks, returnBlocks, type InvWhy, type ReplyKind, type StockRow } from "./project-supply"

export interface InvActor {
  uid: string
  name: string
  /** warehouses.manage or warehouses.receive (or the owner). */
  allowed: boolean
}

export class InvDeskError extends Error {
  constructor(readonly code: "missing" | "blocked", readonly blocks: string[] = []) {
    super(blocks.length ? `${code}: ${blocks.join(", ")}` : code)
    this.name = "InvDeskError"
  }
}

type ProjectDoc = { organizationId?: string; pm?: { lifecycle?: string | null } | null }

/** «أكّد الاستلام في المخزن الرئيسي»: the return closes on the project and its
 * quantity lands on the named main warehouse's matching row (or a new one). */
export async function receiveProjectReturn(firestore: Firestore, actor: InvActor, input: { projectId: string; storeId: string; index: number }): Promise<void> {
  const [storeSnap, projectSnap] = await Promise.all([getDoc(doc(firestore, "projects", input.projectId, PM_STORE, input.storeId)), getDoc(doc(firestore, "projects", input.projectId))])
  if (!storeSnap.exists() || !projectSnap.exists()) throw new InvDeskError("missing")
  const line = storeSnap.data() as Partial<PmStoreLine>
  const project = projectSnap.data() as ProjectDoc
  const move = line.moves?.[input.index] ?? null
  const warehouseId = move?.warehouseId ?? null
  const whSnap = warehouseId ? await getDoc(doc(firestore, "warehouses", warehouseId)) : null
  const blocks = returnBlocks({
    allowed: actor.allowed,
    archived: projectArchived(project),
    move,
    warehouseOrg: whSnap?.exists() ? ((whSnap.data() as { organizationId?: string }).organizationId ?? "") : null,
    projectOrg: project.organizationId ?? null,
  })
  if (blocks.length || !warehouseId) throw new InvDeskError("blocked", blocks)
  const rows = await getDocs(collection(firestore, "warehouses", warehouseId, "inventoryItems"))
  const land = landingRow(
    rows.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockRow, "id">) })),
    line.name ?? "",
    line.unit ?? ""
  )
  await confirmStoreReturn(firestore, input.projectId, { uid: actor.uid, name: actor.name }, input.storeId, input.index, { itemId: land?.id ?? null })
}

export interface ReplyWriteInput {
  projectId: string
  requestId: string
  index: number
  kind: ReplyKind
  q: number
  why: InvWhy | null
  /** The reason in the keeper's words (his language) — what the project reads. */
  whyText: string | null
  warehouseId: string | null
  warehouseName: string | null
  onHand: number | null
  note: string | null
}

/** Inventory's reply on one line of an approved PM material request. Writes
 * `lines[index].inv` and nothing else; a line answered once is not answered again. */
export async function replyOnRequestLine(firestore: Firestore, actor: InvActor, input: ReplyWriteInput): Promise<void> {
  const projectRef = doc(firestore, "projects", input.projectId)
  const ref = doc(firestore, "projects", input.projectId, PURCHASE_REQUESTS, input.requestId)
  await runTransaction(firestore, async (tx) => {
    const [ps, snap] = [await tx.get(projectRef), await tx.get(ref)]
    if (!ps.exists() || !snap.exists()) throw new InvDeskError("missing")
    const raw = snap.data() as Record<string, unknown>
    if (!Array.isArray(raw.lines)) throw new InvDeskError("blocked", ["not_waiting"])
    const r = requestOf({ id: snap.id, ...raw })
    const line = r.lines[input.index] ?? null
    const blocks = replyBlocks({ allowed: actor.allowed, archived: projectArchived(ps.data() as ProjectDoc), request: r, line, kind: input.kind, q: input.q, why: input.why, warehouseId: input.warehouseId, onHand: input.onHand })
    if (blocks.length || !line) throw new InvDeskError("blocked", blocks)
    const inv = buildReply({
      kind: input.kind,
      q: input.q,
      owed: lineOut(line),
      why: input.why,
      whyText: input.whyText?.trim() || null,
      warehouseId: input.warehouseId,
      warehouseName: input.warehouseName,
      note: input.note,
      on: todayDay(),
      by: actor.uid,
      byName: actor.name,
    })
    const lines = (raw.lines as Array<Record<string, unknown>>).map((l, i) => (i === input.index ? { ...l, inv } : l))
    tx.update(ref, { lines, updatedAt: serverTimestamp() })
  })
}
