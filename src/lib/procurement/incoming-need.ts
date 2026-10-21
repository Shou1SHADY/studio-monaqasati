// A stored request (`procIncoming`) as the desk reads a need: one `Need` per request whose lines KEEP the request's own
// numbering (line i of the need is line i of the document), so the editor's `needLine` and the RFQ's products name the same
// line the server stores. Only a line still to be bought is offered for publishing (its quantity is the net one); every other
// line carries a `link` — the editor, the route and the RFQ form skip a linked line — and its place in `lineKind`.

import { poStatus } from "./po"
import type { Need, NeedLine, NeedSource, NeedState } from "./needs"
import type { PurchaseOrder } from "./types"
import {
  buyLineIndexes,
  lineBuyQty,
  lineGive,
  lineHeld,
  lineKind,
  lineMake,
  mrKeyParts,
  type IncomingDoc,
  type IncomingLine,
  type LinkOrder,
  type LinkRfq,
  type ReplyClock,
  settle,
} from "./incoming-state"

/** The key the desk, the editor's `?requests=` and `?publish=` use for a request: the same as before the entity existed. */
export function needKeyOfMr(mrKey: string): string {
  const p = mrKeyParts(mrKey)
  if (!p) return mrKey
  if (p.src === "pm") return `project:${p.a}:${p.b}`
  if (p.src === "mfg") return `mfg:${p.a}:${p.b}`
  return `${p.src}:${p.a}`
}

export function sourceOfMr(mrKey: string): NeedSource {
  const p = mrKeyParts(mrKey)
  if (p?.src === "pm") return { kind: "project_request", projectId: p.a, purchaseRequestId: p.b }
  if (p?.src === "mfg") return { kind: "mfg_purchase", workOrderId: p.a, purchaseRequestId: p.b }
  if (p?.src === "inv") return { kind: "stock_gap", warehouseId: p.a, itemId: p.b }
  return { kind: "team_request", purchaseRequestId: p?.a ?? "" }
}

const NEED_KIND = { pm: "project", team: "team", mfg: "mfg", inv: "stock" } as const

function needLine(l: IncomingLine, index: number, clock: ReplyClock, withdrawn: boolean): NeedLine {
  const read = lineKind(l, clock)
  // A request its requester took back has nothing left to buy or wait for.
  const kind = withdrawn && (read === "buy" || read === "wait") ? "gone" : read
  const buy = kind === "buy"
  const out: NeedLine = {
    name: l.name,
    unit: l.unit,
    quantity: buy ? lineBuyQty(l, clock) : l.qty,
    asked: l.qty,
    lineKind: kind,
    heldBy: lineHeld(l, clock),
    give: lineGive(l),
    make: lineMake(l),
    requestLine: index,
  }
  if (l.category) out.category = l.category
  if (l.samplePending) out.samplePending = true
  if (l.boqItemId) out.itemId = l.boqItemId
  if (l.needBy) out.needBy = l.needBy.slice(0, 10)
  if (l.material) out.material = l.material
  if (!buy) out.link = { rfqId: l.rfqId ?? null, rfqNumber: l.rfqNumber ?? null, poId: l.poId ?? null, poNumber: l.poNumber ?? null }
  return out
}

const needState = (doc: IncomingDoc, buyLines: number): NeedState => {
  switch (doc.st) {
    case "new":
    case "prep":
      return "action"
    case "part":
      return buyLines > 0 ? "action" : "waiting"
    case "rfq":
      return "rfq"
    case "po":
      return "order"
    default:
      return "done"
  }
}

export function incomingNeed(doc: IncomingDoc, clock: ReplyClock): Need {
  const lines = doc.lines.map((l, i) => needLine(l, i, clock, Boolean(doc.withdrawn)))
  const buy = doc.withdrawn ? 0 : buyLineIndexes(doc.lines, clock).length
  const firstWith = (key: "rfqId" | "poId") => doc.lines.find((l) => l[key] && !l.gone)
  const rfq = firstWith("rfqId")
  const po = firstWith("poId")
  const failed = doc.lines.find((l) => l.fail)
  const waitingOn = buy > 0 ? null : doc.lines.some((l) => lineHeld(l, clock) === "stock") ? ("warehouse" as const) : doc.lines.some((l) => lineHeld(l, clock) === "workshop") ? ("workshop" as const) : null
  return {
    key: needKeyOfMr(doc.mrKey),
    kind: NEED_KIND[doc.src],
    state: needState(doc, buy),
    lines,
    needBy: doc.needBy ? doc.needBy.slice(0, 10) : null,
    requestedBy: doc.requestedFor.name || doc.requestedBy.name,
    at: doc.createdAt,
    refLabel: doc.no,
    context: doc.projectName || doc.productName || doc.place.label,
    note: doc.note,
    rfqId: rfq?.rfqId ?? null,
    rfqNumber: rfq?.rfqNumber ?? null,
    poId: po?.poId ?? null,
    poNumber: po?.poNumber ?? null,
    endNote: doc.st === "fail" ? failed?.fail?.why ?? null : doc.st === "wd" ? doc.withdrawal?.byName ?? doc.withdrawn?.name ?? null : null,
    endKind: doc.st === "done" ? "arrived" : doc.st === "fail" ? "refused" : doc.st === "wd" ? "withdrawn" : null,
    waitingOn,
    projectId: doc.projectId ?? null,
    projectName: doc.projectName ?? null,
    source: sourceOfMr(doc.mrKey),
    stock: null,
    ownerId: mrKeyParts(doc.mrKey)?.a ?? "",
    mfgRequestId: doc.mfgRequestId ?? null,
    decision: doc.lines.some((l) => l.mk?.st === "buy") ? { kind: "buy", at: doc.lines.find((l) => l.mk?.st === "buy")?.mk?.at ?? "", byName: "" } : null,
    siteId: doc.siteId ?? null,
    place: doc.place,
    approved: doc.approvedBy ?? null,
    withdrawal: doc.withdrawal ?? null,
    projectChanges: doc.changes ?? [],
    incoming: doc,
  }
}

/** The stored requests as the screen reads them right now: the RFQs and orders that name them overlaid (the SAME reading the server stores), so a publish or an award shows at once. */
export function incomingNeeds(docs: readonly IncomingDoc[], world: { rfqs: readonly LinkRfq[]; orders: readonly LinkOrder[] }, clock: ReplyClock): Need[] {
  return docs.map((d) => incomingNeed(settle(d, world, clock), clock))
}

/** The RFQs and orders a screen already holds, as the link reading takes them. */
export function toLinkWorld(rfqs: ReadonlyArray<object>, orders: ReadonlyArray<PurchaseOrder>): { rfqs: LinkRfq[]; orders: LinkOrder[] } {
  return {
    rfqs: rfqs.map((r) => {
      const x = r as Record<string, unknown>
      return { id: String(x.id), status: (x.status as string) ?? null, rfqNumber: (x.rfqNumber as string) ?? null, needSources: (x.needSources as LinkRfq["needSources"]) ?? null, purchaseSource: (x.purchaseSource as LinkRfq["purchaseSource"]) ?? null, products: (x.products as LinkRfq["products"]) ?? null, unawardedLines: (x.unawardedLines as number[]) ?? null }
    }),
    orders: orders.map((o) => ({ id: o.id, status: o.status, docNumber: o.docNumber, rfqId: o.rfqId ?? null, purchaseSource: (o.purchaseSource as Record<string, unknown> | null) ?? null, lines: o.lines, derived: poStatus(o), promisedDate: o.promisedDate ?? null })),
  }
}
