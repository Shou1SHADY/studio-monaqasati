// «طلبات الشراء الواردة» shows the REQUEST, not the line (Procurement 2.0, INC-01/02): what a project, the team, the
// workshop or the stores sent as one request appears as one card, under the number it was written with («ط.م 03»,
// «ط.م-2026/021»), with its materials, its place, who asked, who approved, its need-by date and its last day to order.
// Its state is the STORED request's (`procIncoming`, derived from its lines — `./incoming-state`): جديد · مُجهَّز · جزء منه
// في عروض أو أمر · في عروض · في أمر · اكتمل · تعذّر الشراء · سحبه المشروع. The segments are قادمة · جديدة · مُجهَّزة · في عروض ·
// في أوامر · اكتملت · انتهت; a request with something left to buy stays in «جديدة» under the tag «الباقي منه» (G-01, INC-10).
// A stock gap is still computed, not stored (decision 07): it is read as a request of its own lines. Pure: the desk's rows go in.

import type { NeedRow } from "./need-desk"
import type { Need } from "./needs"
import type { ProjectChange } from "./project-change"
import {
  INCOMING_SEGMENTS,
  incomingCounts,
  incomingSegmentCounts,
  isRemainder,
  segmentOfRequest,
  type IncomingSegment,
  type RequestSt,
} from "./incoming-state"

/** The card's state, in the words the screens already translate: prep → prepared, part → partial, po → order, fail → failed, wd → withdrawn. */
export type RequestState = "new" | "prepared" | "partial" | "rfq" | "order" | "done" | "failed" | "withdrawn"
export type RequestSegment = IncomingSegment
export const REQUEST_SEGMENTS: RequestSegment[] = [...INCOMING_SEGMENTS]

const STATE_OF: Record<RequestSt, RequestState> = { new: "new", prep: "prepared", part: "partial", rfq: "rfq", po: "order", done: "done", fail: "failed", wd: "withdrawn" }
const ST_OF: Record<RequestState, RequestSt> = { new: "new", prepared: "prep", partial: "part", rfq: "rfq", order: "po", done: "done", failed: "fail", withdrawn: "wd" }

export interface RequestCard {
  key: string
  need: Need
  rows: NeedRow[]
  state: RequestState
  /** Lines still to be bought (published or waiting for a reply do not count). */
  buyLines: number
  /** «الباقي منه»: the other lines are already in an RFQ or an order. */
  remainder: boolean
  /** The earliest last day to order of its open lines, and how far off it is. */
  lastOrderDay: string | null
  lastOrderIn: number | null
  needBy: string | null
  /** The draft RFQ it was prepared into. */
  draftId: string | null
  /** May it be picked with others into one RFQ (a line still to publish). */
  selectable: boolean
  /** The RFQs its lines went into (more than one when it was published in parts). */
  rfqs: Array<{ id: string; number: string | null }>
  /** The orders its lines went into. */
  orders: Array<{ id: string; number: string | null }>
  /** The project took it back after it reached us and before anything was bought: the day and who. */
  withdrawal: { on: string | null; byName: string | null } | null
  /** What the project withdrew or changed on it after it reached us. */
  changes: ProjectChange[]
  /** The reason a request could not be bought, and the alternative proposed. */
  failed: { why: string; alt: string } | null
}

export interface DraftFact {
  id: string
  status?: string | null
  needSources?: unknown
  purchaseSource?: unknown
}

const sameSource = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The draft RFQ (if any) a request was prepared into — the newest one naming it. */
export function draftFor(need: Pick<Need, "source">, rfqs: DraftFact[]): string | null {
  for (const r of rfqs) {
    if (r.status !== "Draft") continue
    const list = Array.isArray(r.needSources) ? r.needSources : r.purchaseSource ? [r.purchaseSource] : []
    if (list.some((s) => sameSource(s, need.source))) return r.id
  }
  return null
}

/** A computed need (a stock gap) read as a request: it has no stored lines, so its rows decide. */
function computedState(rows: NeedRow[], draftId: string | null): RequestSt {
  const st = rows.map((r) => r.state)
  const ended = rows[0]?.need.endKind
  if (ended === "withdrawn") return "wd"
  if (ended === "refused") return "fail"
  const open = st.some((s) => s === "open" || s === "late" || s === "mfgl")
  const inRfq = st.some((s) => s === "rfq")
  const inPo = st.some((s) => s === "po")
  if (open) return inRfq || inPo ? "part" : draftId ? "prep" : "new"
  if (inRfq) return "rfq"
  if (inPo) return "po"
  if (st.length && st.every((s) => s === "cx")) return "fail"
  return st.some((s) => s === "chk" || s === "mfgw" || s === "mfg") ? "new" : "done"
}

/** One card per request, in the desk's order (most urgent first). */
export function requestCards(rows: NeedRow[], rfqs: DraftFact[]): RequestCard[] {
  const byNeed = new Map<string, NeedRow[]>()
  for (const r of rows) byNeed.set(r.needKey, [...(byNeed.get(r.needKey) || []), r])
  const out: RequestCard[] = []
  for (const [key, list] of byNeed) {
    const need = list[0].need
    const draftId = draftFor(need, rfqs)
    const st: RequestSt = need.incoming ? need.incoming.st : computedState(list, draftId)
    const open = list.filter((r) => r.lastOrderIn != null && (r.state === "open" || r.state === "late" || r.state === "mfgl"))
    const soonest = open.sort((a, b) => (a.lastOrderIn as number) - (b.lastOrderIn as number))[0]
    const needBy = list.map((r) => r.needBy).filter((d): d is string => !!d).sort()[0] || need.needBy || null
    const buyLines = list.filter((r) => r.state === "open" || r.state === "mfgl" || r.state === "late").length
    const failed = need.incoming?.lines.find((l) => l.fail)?.fail ?? null
    out.push({
      key,
      need,
      rows: list,
      state: STATE_OF[st],
      buyLines,
      remainder: isRemainder(st, buyLines),
      lastOrderDay: soonest?.lastOrderDay ?? null,
      lastOrderIn: soonest?.lastOrderIn ?? null,
      needBy,
      draftId,
      selectable: (st === "new" || st === "prep" || st === "part") && buyLines > 0 && list.some((r) => r.selectable),
      rfqs: Array.from(new Map(list.flatMap((r) => (r.link?.rfqId ? [[r.link.rfqId, { id: r.link.rfqId, number: r.link.rfqNumber }] as const] : []))).values()),
      orders: Array.from(new Map(list.flatMap((r) => (r.link?.poId ? [[r.link.poId, { id: r.link.poId, number: r.link.poNumber }] as const] : []))).values()),
      withdrawal: need.withdrawal ?? null,
      changes: need.projectChanges ?? [],
      failed: failed ? { why: failed.why, alt: failed.alt } : null,
    })
  }
  return out
}

export const cardSegment = (c: Pick<RequestCard, "state" | "buyLines">): Exclude<RequestSegment, "all" | "upcoming"> => segmentOfRequest(ST_OF[c.state], c.buyLines)

export function inRequestSegment(c: Pick<RequestCard, "state" | "buyLines">, seg: RequestSegment): boolean {
  if (seg === "all") return true
  if (seg === "upcoming") return false
  return cardSegment(c) === seg
}

/** Every card is in exactly one segment (G-01): `upcoming` is the shell of «قادمة» until its data exists, the rest sum to `all`. */
export function requestSegmentCounts(cards: Array<Pick<RequestCard, "state" | "buyLines">>, upcoming = 0): Record<RequestSegment, number> {
  return incomingSegmentCounts(cards.map((c) => ({ st: ST_OF[c.state], buyLines: c.buyLines })), upcoming)
}

/** What the frame's rail shows («2 جديدة»): the new requests — a remainder of a partly handled one is new again — and the open ones. */
export const incomingCardCounts = (cards: Array<Pick<RequestCard, "state" | "buyLines">>): { new: number; open: number } => incomingCounts(cards.map((c) => ({ st: ST_OF[c.state], buyLines: c.buyLines })))

/** Sorted by the last day to order — the most pressing first; finished ones after. */
export function sortCards(cards: RequestCard[]): RequestCard[] {
  const live = (c: RequestCard) => (c.buyLines > 0 && (c.state === "new" || c.state === "prepared" || c.state === "partial") ? 0 : 1)
  return [...cards].sort((a, b) => live(a) - live(b) || (a.lastOrderIn ?? 9999) - (b.lastOrderIn ?? 9999) || (a.needBy || "9999").localeCompare(b.needBy || "9999"))
}
