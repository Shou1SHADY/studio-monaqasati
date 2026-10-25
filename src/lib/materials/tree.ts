// Reading the material tree (PUR-04). Pure: no I/O — `useMaterialTree` loads it.
//
// A material is a node with no (visible) children. Suppliers are matched on the
// SUB-CATEGORY (level 2) by id, never by name; a first-level node with nothing under
// it («مزروعات») is its own sub-category. A third-level material inherits the specs,
// units and brands of the levels above it, its own winning on a name clash.

import { foldSearchText } from "@/lib/search-text"
import type { MaterialNode, MaterialPick, MaterialSaleUnit, MaterialSpec, MaterialText, MaterialUnit } from "./types"

export interface MaterialIndex {
  roots: MaterialNode[]
  byId: Map<string, MaterialNode>
  parentOf: Map<string, string | null>
  /** Every pickable material, in tree order. */
  materials: MaterialNode[]
  /** Every sub-category suppliers can be matched on, in tree order. */
  subs: MaterialNode[]
}

const visible = (n: MaterialNode) => !n.hidden

export const isMaterial = (n: MaterialNode): boolean => !n.children.some(visible)

export function indexTree(roots: MaterialNode[]): MaterialIndex {
  const byId = new Map<string, MaterialNode>()
  const parentOf = new Map<string, string | null>()
  const materials: MaterialNode[] = []
  const subs: MaterialNode[] = []
  const walk = (n: MaterialNode, parent: string | null) => {
    byId.set(n.id, n)
    parentOf.set(n.id, parent)
    if (!visible(n)) return
    if (n.level === 2 || (n.level === 1 && isMaterial(n))) subs.push(n)
    if (isMaterial(n)) materials.push(n)
    n.children.forEach((c) => walk(c, n.id))
  }
  const live = roots.filter(visible)
  live.forEach((r) => walk(r, null))
  return { roots: live, byId, parentOf, materials, subs }
}

/** Root first, the node last. */
export function pathOf(index: MaterialIndex, id: string): MaterialNode[] {
  const out: MaterialNode[] = []
  let cur: string | null | undefined = id
  while (cur) {
    const n = index.byId.get(cur)
    if (!n) break
    out.unshift(n)
    cur = index.parentOf.get(cur)
  }
  return out
}

/** The sub-category a line is matched on. */
export function subIdOf(index: MaterialIndex, id: string): string | null {
  const path = pathOf(index, id)
  if (!path.length) return null
  return (path.find((n) => n.level === 2) || path[0]).id
}

export const rootIdOf = (index: MaterialIndex, id: string): string | null => pathOf(index, id)[0]?.id ?? null

/** Own specs plus those of the levels above, own first; a name defined twice keeps the nearest. */
export function specsOf(index: MaterialIndex, id: string): MaterialSpec[] {
  const out: MaterialSpec[] = []
  const seen = new Set<string>()
  for (const n of pathOf(index, id).reverse()) {
    for (const s of n.specs) {
      const k = foldSearchText(s.ar)
      if (seen.has(k) || !s.options.length) continue
      seen.add(k)
      out.push(s)
    }
  }
  return out
}

/** The material's units, else the nearest level above that names some. */
export function unitsOf(index: MaterialIndex, id: string): MaterialUnit[] {
  for (const n of pathOf(index, id).reverse()) if (n.units.length) return n.units
  return []
}

const LENGTH_OPTION = /^\s*(\d+(?:\.\d+)?)\s*(?:م|m|meters?)\s*$/i

/**
 * The lengths a material is sold in: its own list (or the nearest above), else the options of a «الطول»
 * spec when every one of them is «N م» (timber: 3 / 4 / 6 m). Empty for everything else.
 */
export function saleUnitsOf(index: MaterialIndex, id: string): MaterialSaleUnit[] {
  for (const n of pathOf(index, id).reverse()) if (n.saleUnits?.length) return n.saleUnits
  const length = specsOf(index, id).find((s) => foldSearchText(s.ar) === foldSearchText("الطول") || foldSearchText(s.en) === "length")
  if (!length) return []
  const metres = length.options.map((o) => Number((LENGTH_OPTION.exec(o.ar) || LENGTH_OPTION.exec(o.en))?.[1]))
  if (!metres.length || metres.some((m) => !(m > 0))) return []
  return metres.map((lengthM) => ({ ar: `قطعة ${lengthM} م`, en: `${lengthM} meter piece`, lengthM, from: "spec" as const }))
}

export function brandsOf(index: MaterialIndex, id: string): MaterialText[] {
  const out: MaterialText[] = []
  const seen = new Set<string>()
  for (const n of pathOf(index, id).reverse()) {
    for (const b of n.brands) {
      if (seen.has(b.ar)) continue
      seen.add(b.ar)
      out.push(b)
    }
  }
  return out
}

/** The spec's name as a short column heading («المقاس», «الدرجة») — the tree keeps the full one. */
const SHORT: Array<[RegExp, MaterialText]> = [
  [/^المقاس/, { ar: "المقاس", en: "Size" }],
  [/الدرجة/, { ar: "الدرجة", en: "Grade" }],
  [/^نوع المادة$/, { ar: "النوع", en: "Type" }],
  [/^القياسات/, { ar: "القياس", en: "Dimensions" }],
  [/^الوزن/, { ar: "الوزن", en: "Weight" }],
  [/^السمك/, { ar: "السمك", en: "Thickness" }],
  [/^الحجم \(بوصة\)/, { ar: "المقاس", en: "Size" }],
  [/^الحجم \(لتر\)/, { ar: "السعة", en: "Volume" }],
  [/^الضغط/, { ar: "الضغط", en: "Pressure" }],
]
export function shortSpecName(spec: MaterialText): MaterialText {
  for (const [re, short] of SHORT) if (re.test(spec.ar)) return short
  return { ar: spec.ar, en: spec.en }
}

export const label = (t: MaterialText | null | undefined, locale: string): string => (t ? (locale === "ar" ? t.ar : t.en || t.ar) : "")

/** «الحديد › حديد التسليح › أسياخ حديد التسليح» — the path above the material by default. */
export function pathLabel(path: MaterialText[], locale: string, withLast = false): string {
  const parts = withLast ? path : path.slice(0, -1)
  return parts.map((p) => label(p, locale)).join(" › ")
}

// ---------------------------------------------------------------------------
// Search: typing in the row's empty cell («حديد 16», «بلوك 20»)
// ---------------------------------------------------------------------------

export interface MaterialHit {
  node: MaterialNode
  path: MaterialNode[]
  /** Spec values the query named («16» → المقاس: 16 mm), preset on the row. */
  preset: Array<{ spec: MaterialSpec; value: MaterialText }>
  score: number
}

const tokens = (s: string) => foldSearchText(s).split(/[\s×x*,/()-]+/).filter(Boolean)

export function searchMaterials(index: MaterialIndex, query: string, limit = 8): MaterialHit[] {
  const words = foldSearchText(query).split(" ").filter(Boolean)
  if (!words.length) return []
  const hits: MaterialHit[] = []
  for (const node of index.materials) {
    const path = pathOf(index, node.id)
    const name = foldSearchText(`${node.ar} ${node.en}`)
    const above = foldSearchText(path.slice(0, -1).map((p) => `${p.ar} ${p.en}`).join(" "))
    const keys = foldSearchText(node.keywords.join(" "))
    const specs = specsOf(index, node.id)
    let score = 0
    const preset: MaterialHit["preset"] = []
    let ok = true
    for (const w of words) {
      if (name.includes(w)) score += 3
      else if (above.includes(w)) score += 2
      else if (keys.includes(w)) score += 1
      else {
        // A number or a size picks a spec option («16» → 16 mm, «G60»).
        const found = specs.flatMap((s) => s.options.map((o) => ({ s, o }))).find(({ o }) => tokens(`${o.ar} ${o.en}`).includes(w))
        if (!found) {
          ok = false
          break
        }
        score += 1
        if (!preset.some((p) => p.spec === found.s)) preset.push({ spec: found.s, value: found.o })
      }
    }
    if (ok) hits.push({ node, path, preset, score })
  }
  return hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length).slice(0, limit)
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** Is the line's unit one of the material's? Compared as words, Arabic or English. */
export function unitIsTheMaterials(unit: string, units: MaterialUnit[]): boolean {
  const u = foldSearchText(unit)
  return units.some((x) => [x.ar, x.en, x.key].some((v) => foldSearchText(v) === u))
}

/** The name a free-text spec carries («أخرى: لون رمادي»). */
export const OTHER_SPEC: MaterialText = { ar: "أخرى", en: "Other" }

const KG_PER: Record<string, number> = { kg: 1, ton: 1000 }

/**
 * A conversion shown for information only (PUR-02): «200 كيس × 50 كجم = 10 طن». Known
 * where a weight spec names the kilograms in a bag/piece and the material is sold by
 * the tonne or the kilo. The line keeps the unit it arrived with.
 */
export function unitConversion(quantity: number, unit: string, target: MaterialUnit, specValues: MaterialText[]): { quantity: number; unit: MaterialUnit; per: number } | null {
  const per = KG_PER[target.key]
  if (!per || !(quantity > 0)) return null
  const u = foldSearchText(unit)
  if (!["كيس", "bag", "حبه", "piece", "pc"].includes(u)) return null
  const weight = specValues.map((v) => /(\d+(?:\.\d+)?)\s*(كجم|kg)/i.exec(`${v.ar} ${v.en}`)).find(Boolean)
  if (!weight) return null
  const kg = Number(weight[1])
  return { quantity: Math.round(((quantity * kg) / per) * 1000) / 1000, unit: target, per: kg }
}

// ---------------------------------------------------------------------------
// A line's material
// ---------------------------------------------------------------------------

export function pickOf(index: MaterialIndex, nodeId: string, specs: MaterialPick["specs"] = [], brand: MaterialText | null = null, outside = false): MaterialPick | null {
  const path = pathOf(index, nodeId)
  const subId = subIdOf(index, nodeId)
  if (!path.length || !subId) return null
  const saleUnits = outside ? [] : saleUnitsOf(index, nodeId)
  return { nodeId, subId, rootId: path[0].id, path: path.map((p) => ({ ar: p.ar, en: p.en })), specs, brand, outside, ...(saleUnits.length ? { saleUnits } : {}) }
}

/** «أسياخ حديد تسليح 16 مم» — the material and its chosen values, as a supplier reads the line. */
export function materialName(pick: MaterialPick, locale: string, typed?: string): string {
  const base = typed?.trim() || label(pick.path[pick.path.length - 1], locale)
  return base
}
