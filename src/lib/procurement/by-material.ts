// «بالمادة — قارن واجمع» (Procurement 2.0, INC-05, WF-07): the same incoming requests read by MATERIAL — what is still to be bought of
// a material in every request that wants it, with the total, the nearest last day to order and the last price paid for THAT
// specification — so similar ones can be combined into one RFQ for a better price while each quantity stays with its request and
// its place. A material is its tree node and its chosen specifications; «حديد 16» and «حديد 12» are two. Pure: the desk's rows go in.

import { foldSearchText } from "@/lib/search-text"
import type { MaterialPick } from "../materials/types"
import type { NeedRow } from "./need-desk"
import { lastPaidFor, specKeyOf, type PriceHistoryEntry } from "./prices"

export interface MaterialItem {
  /** The request, as the desk and the editor key it. */
  needKey: string
  rowKey: string
  /** The line's position in the request. */
  index: number
  requestNo: string
  place: string
  qty: number
  needBy: string | null
  lastOrderDay: string | null
  lastOrderIn: number | null
}

export interface LastPurchase {
  price: number
  poNumber: string | null
  day: string
}

export interface MaterialGroup {
  key: string
  name: string
  unit: string
  /** «الارضيات والجدران › الرخام», in Arabic and English. */
  path: { ar: string; en: string }
  specs: Array<{ name: { ar: string; en: string }; value: { ar: string; en: string } }>
  items: MaterialItem[]
  total: number
  requests: number
  lastOrderDay: string | null
  lastOrderIn: number | null
  /** The last price paid for this specification, or null: «لا شراء سابق بهذه المواصفة». */
  last: LastPurchase | null
}

const BUYABLE = new Set<NeedRow["state"]>(["open", "late", "mfgl"])

/** The key two lines share when they are the same material AS SPECIFIED; a row typed outside the list is its folded name and unit. */
export function materialGroupKey(l: { name: string; unit: string; material?: MaterialPick | null }): string {
  const { specKey } = specKeyOf({ name: l.name, unit: l.unit, material: l.material ?? null })
  return specKey ?? `free:${foldSearchText(l.name)}|${foldSearchText(l.unit)}`
}

const pathWords = (m: MaterialPick | null | undefined) => ({ ar: (m?.path || []).map((p) => p.ar).join(" › "), en: (m?.path || []).map((p) => p.en || p.ar).join(" › ") })

/** Groups every line still to be bought by material. Nearest last day first within the same count; more requests first. */
export function byMaterial(rows: readonly NeedRow[], history: readonly PriceHistoryEntry[] = []): MaterialGroup[] {
  const groups = new Map<string, { head: NeedRow; material: MaterialPick | null; items: MaterialItem[] }>()
  for (const r of rows) {
    if (!BUYABLE.has(r.state) || !(r.open > 0)) continue
    const doc = r.need.incoming
    if (doc && !(doc.st === "new" || doc.st === "prep" || doc.st === "part")) continue
    const material = r.need.lines[r.index]?.material ?? doc?.lines[r.index]?.material ?? null
    const key = materialGroupKey({ name: r.name, unit: r.unit, material })
    const item: MaterialItem = {
      needKey: r.needKey,
      rowKey: r.key,
      index: r.index,
      requestNo: r.need.refLabel,
      place: doc?.place.label || r.need.projectName || r.need.context || "",
      qty: r.open,
      needBy: r.needBy,
      lastOrderDay: r.lastOrderDay,
      lastOrderIn: r.lastOrderIn,
    }
    const g = groups.get(key)
    if (g) g.items.push(item)
    else groups.set(key, { head: r, material, items: [item] })
  }
  const out: MaterialGroup[] = []
  for (const [key, g] of groups) {
    const days = g.items.map((i) => i.lastOrderIn).filter((d): d is number => d != null)
    const near = g.items.filter((i) => i.lastOrderDay).sort((a, b) => (a.lastOrderDay as string).localeCompare(b.lastOrderDay as string))[0]
    const { specKey } = specKeyOf({ name: g.head.name, unit: g.head.unit, material: g.material })
    const paid = lastPaidFor(history as PriceHistoryEntry[], { specKey, name: g.head.name, unit: g.head.unit })
    out.push({
      key,
      name: g.head.name,
      unit: g.head.unit,
      path: pathWords(g.material),
      specs: (g.material?.specs || []).map((s) => ({ name: { ar: s.name.ar, en: s.name.en || s.name.ar }, value: { ar: s.value.ar, en: s.value.en || s.value.ar } })),
      items: g.items,
      total: Math.round(g.items.reduce((s, i) => s + i.qty, 0) * 1000) / 1000,
      requests: new Set(g.items.map((i) => i.needKey)).size,
      lastOrderDay: near?.lastOrderDay ?? null,
      lastOrderIn: days.length ? Math.min(...days) : null,
      last: paid ? { price: paid.price, poNumber: paid.poNumber, day: paid.day } : null,
    })
  }
  return out.sort((a, b) => b.requests - a.requests || (a.lastOrderIn ?? 1e6) - (b.lastOrderIn ?? 1e6) || a.name.localeCompare(b.name))
}

/** More than one request wants it: worth combining. */
export const combinable = (groups: readonly MaterialGroup[]): MaterialGroup[] => groups.filter((g) => g.requests > 1)

/** «اجمعها في مسودة»: the editor on the requests the picked materials come from, restricted to the picked lines. */
export function combineHref(groups: readonly MaterialGroup[], picked: ReadonlySet<string>): string {
  const chosen = groups.filter((g) => picked.has(g.key))
  const keys = Array.from(new Set(chosen.flatMap((g) => g.items.map((i) => i.needKey))))
  const lines = keys.map((k) => `${k}@${chosen.flatMap((g) => g.items.filter((i) => i.needKey === k).map((i) => i.index)).sort((a, b) => a - b).join(".")}`)
  return `/contractor/rfqs/new?requests=${encodeURIComponent(keys.join("|"))}&lines=${encodeURIComponent(lines.join("|"))}`
}

/** Reads `?lines=` back: request key → the line positions to take. Absent = every line to buy. */
export function parseLinesParam(raw: string | null | undefined): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()
  for (const part of (raw || "").split("|")) {
    const at = part.lastIndexOf("@")
    if (at < 1) continue
    const nums = part.slice(at + 1).split(".").map(Number).filter((n) => Number.isInteger(n) && n >= 0)
    if (nums.length) out.set(part.slice(0, at), new Set(nums))
  }
  return out
}
