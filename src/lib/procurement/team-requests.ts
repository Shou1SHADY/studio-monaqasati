// «طلب مواد» from the team — a company WITHOUT Project Management (Procurement 1.5, PUR-10,
// question 4). Anyone on the team asks Procurement for materials: rows like the editor's, a
// need-by date, a delivery site from «مواقع التسليم» (or a typed address), a note. It is
// numbered «MR-2026/014» (shown «ط.م-2026/014») and reaches «طلبات الشراء الواردة» with no
// technical approval, with «انشره» and «جهّزه» like any request (PUR-01).
//
// The document is written ONLY by the server (/api/procurement/team-requests): created, withdrawn
// by its requester before it is in an RFQ, declined by Procurement with a reason. Its progress —
// in offers · in an order · on the way · received — is never written back: it is READ from the
// RFQs and orders that name it (`needSources` / the RFQ's award), so no rule lets a client touch
// it after creation. Pure.

import { poStatus } from "./po"
import type { MaterialPick } from "../materials/types"
import type { Need, NeedLine } from "./needs"
import type { PurchaseOrder } from "./types"

export const TEAM_REQUESTS = "procTeamRequests"
export const TEAM_SOURCE_KIND = "team_request"

export interface TeamRequestLine {
  name: string
  unit: string
  quantity: number
  material?: MaterialPick | null
  needBy?: string | null
}

export interface TeamRequestDoc {
  id: string
  organizationId: string
  /** `MR-2026/014` — drawn in the create transaction (`mfgCounters`, type MR). */
  number: string
  lines: TeamRequestLine[]
  needBy: string
  /** A site of «مواقع التسليم», or none for a typed address. */
  siteId?: string | null
  place: { label: string; city: string; district: string }
  note?: string | null
  requestedById: string
  requestedByName: string
  createdAt: string
  status: "open" | "withdrawn" | "declined"
  withdrawnAt?: string | null
  declinedAt?: string | null
  declinedByName?: string | null
  declinedReason?: string | null
}

export type TeamSource = { kind: typeof TEAM_SOURCE_KIND; purchaseRequestId: string }
export const teamSource = (id: string): TeamSource => ({ kind: TEAM_SOURCE_KIND, purchaseRequestId: id })

/** An RFQ or order as far as a team request reads it. */
export interface TeamLinkedRfq {
  id: string
  status?: string | null
  rfqNumber?: string | null
  needSources?: unknown
  purchaseSource?: unknown
  products?: Array<{ needSource?: unknown } | null> | null
}

const names = (s: unknown, id: string) => {
  const x = s as { kind?: string; purchaseRequestId?: string } | null
  return Boolean(x && x.kind === TEAM_SOURCE_KIND && x.purchaseRequestId === id)
}

/** Does the RFQ name this request (anywhere it can: the RFQ, its list of sources, a line)? */
export function rfqNamesRequest(rfq: TeamLinkedRfq, id: string): boolean {
  if (names(rfq.purchaseSource, id)) return true
  if (Array.isArray(rfq.needSources) && rfq.needSources.some((s) => names(s, id))) return true
  return (rfq.products || []).some((p) => names(p?.needSource, id))
}

export interface TeamProgress {
  /** A published RFQ (not a draft — a draft is «مُجهَّز», Procurement's own business). */
  rfq: { id: string; number: string | null } | null
  po: PurchaseOrder | null
}

/** What became of it: the newest published RFQ naming it, and the order awarded from that RFQ (or naming it). */
export function teamProgress(id: string, rfqs: TeamLinkedRfq[], orders: PurchaseOrder[]): TeamProgress {
  const published = rfqs.filter((r) => r.status !== "Draft" && rfqNamesRequest(r, id))
  const rfq = published[published.length - 1] || null
  const po =
    orders.find((o) => o.status !== "cancelled" && names(o.purchaseSource, id)) ||
    (rfq ? orders.find((o) => o.status !== "cancelled" && o.rfqId === rfq.id) : undefined) ||
    null
  return { rfq: rfq ? { id: rfq.id, number: rfq.rfqNumber ?? null } : null, po }
}

/** The requester's view: جديد · في عروض · في أمر · في الطريق · استُلم · تعذّر الشراء · سحبته. */
export type TeamRequestState = "sent" | "rfq" | "order" | "on_way" | "received" | "declined" | "withdrawn"

export function teamRequestState(doc: Pick<TeamRequestDoc, "status">, progress: TeamProgress): TeamRequestState {
  if (doc.status === "withdrawn") return "withdrawn"
  if (doc.status === "declined") return "declined"
  if (progress.po) {
    const st = poStatus(progress.po)
    if (st === "received" || st === "closed") return "received"
    // Accepted and nothing in yet is still «في أمر»; «في الطريق» once part of it arrived and the rest is coming.
    if (st === "part_received") return "on_way"
    return "order"
  }
  return progress.rfq ? "rfq" : "sent"
}

/** Its requester withdraws it while nobody has put it in an RFQ (a draft counts: Procurement prepared it). */
export function withdrawRefusal(doc: Pick<TeamRequestDoc, "status" | "requestedById">, uid: string, inAnyRfq: boolean): "not_yours" | "closed" | "in_rfq" | null {
  if (doc.requestedById !== uid) return "not_yours"
  if (doc.status !== "open") return "closed"
  return inAnyRfq ? "in_rfq" : null
}

export interface TeamRequestInput {
  lines: TeamRequestLine[]
  needBy: string
  place: { label: string; city: string; district: string }
}

/** What stops it being sent: no material with a quantity and unit, no need-by date (not in the past), no place. */
export function teamRequestRefusal(input: TeamRequestInput, today: string): "lines" | "need_by" | "place" | null {
  const ok = input.lines.filter((l) => l.name.trim() && l.unit.trim() && Number(l.quantity) > 0)
  if (!ok.length || ok.length !== input.lines.length) return "lines"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.needBy) || input.needBy < today) return "need_by"
  if (!input.place.label.trim() || !input.place.city.trim()) return "place"
  return null
}

/** The request on Procurement's desk, as a `Need` like the project's — but nothing of Projects on it. */
export function teamNeed(doc: TeamRequestDoc, rfqs: TeamLinkedRfq[], orders: PurchaseOrder[]): Need {
  const progress = teamProgress(doc.id, rfqs, orders)
  const state = teamRequestState(doc, progress)
  const lines: NeedLine[] = doc.lines
    .filter((l) => l.name && Number(l.quantity) > 0)
    .map((l) => {
      const out: NeedLine & { material?: MaterialPick | null } = { name: l.name.trim(), unit: (l.unit || "").trim(), quantity: Number(l.quantity) }
      if (l.needBy) out.needBy = l.needBy.slice(0, 10)
      if (l.material) out.material = l.material
      return out
    })
  const done = state === "received" || state === "declined" || state === "withdrawn"
  return {
    key: `team:${doc.id}`,
    kind: "team",
    state: done ? "done" : progress.po ? "order" : progress.rfq ? "rfq" : "action",
    lines,
    needBy: doc.needBy || null,
    requestedBy: doc.requestedByName || "",
    at: doc.createdAt || "",
    refLabel: doc.number,
    context: doc.place.label,
    note: doc.note || null,
    rfqId: progress.rfq?.id ?? null,
    rfqNumber: progress.rfq?.number ?? null,
    poId: progress.po?.id ?? null,
    poNumber: progress.po?.docNumber ?? null,
    endNote: state === "declined" ? doc.declinedReason || null : state === "withdrawn" ? doc.requestedByName : null,
    endKind: state === "received" ? "arrived" : state === "declined" ? "refused" : state === "withdrawn" ? "sent_back" : null,
    waitingOn: null,
    projectId: null,
    projectName: null,
    source: teamSource(doc.id),
    stock: null,
    ownerId: doc.id,
    mfgRequestId: null,
    decision: null,
    siteId: doc.siteId ?? null,
    place: doc.place,
  }
}

