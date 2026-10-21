// «طلبات الشراء الواردة» shows the REQUEST, not the line (Procurement 1.5, PUR-01): what a
// project sent as one request appears as one card, under the number the project wrote
// («ط.م 03»), with its materials, its need-by date, its last day to order, who asked —
// and one state: جديد · مُجهَّز · جزء منه في عروض · في عروض · في أمر · اكتمل · تعذّر الشراء ·
// سحبه المشروع. «مُجهَّز» is a DRAFT RFQ that names the request (`needSources`) — the
// request's own document is not written for it. Pure: the desk's rows go in.

import type { NeedRow } from "./need-desk"
import type { Need } from "./needs"
import type { ProjectChange } from "./project-change"

export type RequestState = "new" | "prepared" | "elsewhere" | "partial" | "rfq" | "order" | "done" | "failed" | "withdrawn"
export type RequestSegment = "new" | "prepared" | "elsewhere" | "rfq" | "order" | "done" | "all"
export const REQUEST_SEGMENTS: RequestSegment[] = ["new", "prepared", "elsewhere", "rfq", "order", "done", "all"]

export interface RequestCard {
  key: string
  need: Need
  rows: NeedRow[]
  state: RequestState
  /** The earliest last day to order of its open lines, and how far off it is. */
  lastOrderDay: string | null
  lastOrderIn: number | null
  needBy: string | null
  /** The draft RFQ it was prepared into. */
  draftId: string | null
  /** May it be picked with others into one RFQ (new, prepared or partly in an RFQ, with a line still to publish). */
  selectable: boolean
  /** The RFQs its lines went into when only part of it was published (a whole one is on `need`). */
  rfqs: Array<{ id: string; number: string | null }>
  /** The project took it back after it reached us and before anything was bought: the day and who. */
  withdrawal: { on: string | null; byName: string | null } | null
  /** What the project withdrew or changed on it after it reached us. */
  changes: ProjectChange[]
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

export function requestState(rows: NeedRow[], draftId: string | null): RequestState {
  const st = rows.map((r) => r.state)
  const need = rows[0]?.need
  if (need?.endKind === "withdrawn") return "withdrawn"
  if (need?.endKind === "refused" || (st.length && st.every((s) => s === "cx"))) return "failed"
  if (st.length && st.every((s) => s === "done" || s === "stk")) return "done"
  const open = st.some((s) => s === "open" || s === "late" || s === "mfgl")
  const inRfq = st.some((s) => s === "rfq")
  const inPo = st.some((s) => s === "po")
  if (inPo && !open && !inRfq) return "order"
  if ((inRfq || inPo) && open) return "partial"
  if (inRfq) return "rfq"
  if (open) return draftId ? "prepared" : "new"
  if (st.some((s) => s === "chk" || s === "pmw" || s === "mfgw" || s === "mfg")) return "elsewhere"
  return "done"
}

/** One card per request, in the desk's order (most urgent first). */
export function requestCards(rows: NeedRow[], rfqs: DraftFact[]): RequestCard[] {
  const byNeed = new Map<string, NeedRow[]>()
  for (const r of rows) byNeed.set(r.needKey, [...(byNeed.get(r.needKey) || []), r])
  const out: RequestCard[] = []
  for (const [key, list] of byNeed) {
    const need = list[0].need
    const draftId = draftFor(need, rfqs)
    const state = requestState(list, draftId)
    const open = list.filter((r) => r.lastOrderIn != null && (r.state === "open" || r.state === "late" || r.state === "mfgl"))
    const soonest = open.sort((a, b) => (a.lastOrderIn as number) - (b.lastOrderIn as number))[0]
    const needBy = list.map((r) => r.needBy).filter((d): d is string => !!d).sort()[0] || need.needBy || null
    out.push({
      key,
      need,
      rows: list,
      state,
      lastOrderDay: soonest?.lastOrderDay ?? null,
      lastOrderIn: soonest?.lastOrderIn ?? null,
      needBy,
      draftId,
      selectable: (state === "new" || state === "prepared" || state === "partial") && list.some((r) => r.selectable),
      rfqs: Array.from(new Map(list.flatMap((r) => (r.link?.rfqId ? [[r.link.rfqId, { id: r.link.rfqId, number: r.link.rfqNumber }] as const] : []))).values()),
      withdrawal: need.withdrawal ?? null,
      changes: need.projectChanges ?? [],
    })
  }
  return out
}

export function inRequestSegment(c: Pick<RequestCard, "state">, seg: RequestSegment): boolean {
  switch (seg) {
    case "all":
      return true
    case "new":
      return c.state === "new"
    case "prepared":
      return c.state === "prepared"
    case "elsewhere":
      return c.state === "elsewhere"
    case "rfq":
      return c.state === "rfq" || c.state === "partial"
    case "order":
      return c.state === "order"
    case "done":
      return c.state === "done" || c.state === "failed" || c.state === "withdrawn"
  }
}

export function requestSegmentCounts(cards: RequestCard[]): Record<RequestSegment, number> {
  const out = Object.fromEntries(REQUEST_SEGMENTS.map((s) => [s, 0])) as Record<RequestSegment, number>
  for (const c of cards) for (const s of REQUEST_SEGMENTS) if (inRequestSegment(c, s)) out[s] += 1
  return out
}

/** Sorted by the last day to order — the most pressing first; finished ones by their date, newest first. */
export function sortCards(cards: RequestCard[]): RequestCard[] {
  return [...cards].sort((a, b) => {
    const live = (c: RequestCard) => (c.state === "new" || c.state === "prepared" || c.state === "partial" ? 0 : 1)
    return live(a) - live(b) || (a.lastOrderIn ?? 9999) - (b.lastOrderIn ?? 9999) || (a.needBy || "9999").localeCompare(b.needBy || "9999")
  })
}
