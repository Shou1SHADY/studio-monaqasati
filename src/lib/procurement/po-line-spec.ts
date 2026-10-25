// The line's specification on the order (Procurement 2.0 PO-01, prototype `DRAW.po` `linePath` + `specCells`, order link `lkSpecs`):
// the RFQ named «حديد تسليح — 16 مم · G60», and the order must say the same, or an off-platform supplier cannot tell 12 mm from
// 16 mm. Copied ONCE, when the order is born (award, direct, agreement); never re-read from the RFQ. Pure.

const SPEC_MAX = 300
const PATH_MAX = 200

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "")

type Words = { ar?: string | null } | null | undefined

/** A material as stored on an RFQ product (loose: an old pick may lack any part). */
export interface SpecMaterial {
  specs?: Array<{ name?: Words; value?: Words } | null> | null
  brand?: Words
  path?: Array<Words> | null
}

/** The spec words of a material picked from the tree: «القطر 16 مم · الدرجة G60 · سابك». */
export function specOfMaterial(m: SpecMaterial | null | undefined): string {
  if (!m) return ""
  return [...(m.specs || []).map((s) => [s?.name?.ar, s?.value?.ar].filter(Boolean).join(" ").trim()), m.brand?.ar || ""].filter(Boolean).join(" · ").slice(0, SPEC_MAX)
}

/** The material's place above it in the tree: «الحديد › حديد التسليح». */
export function pathOfMaterial(m: SpecMaterial | null | undefined): string {
  const above = (m?.path || []).slice(0, -1)
  return above
    .map((p) => (p?.ar || "").trim())
    .filter(Boolean)
    .join(" › ")
    .slice(0, PATH_MAX)
}

export interface SpecSourceProduct {
  description?: unknown
  material?: SpecMaterial | null
  materialPath?: unknown
  category?: unknown
  subCategory?: unknown
}

/** What an order line carries of its RFQ product: the spec (the product's description, which the editor writes from the picked
 * specs) and the path. Keys absent when there is nothing to say, so an old RFQ makes the same line it always did. */
export function lineSpecOf(p: SpecSourceProduct | null | undefined): { spec?: string; path?: string } {
  if (!p) return {}
  const spec = text(p.description, SPEC_MAX) || specOfMaterial(p.material)
  const fromTree = pathOfMaterial(p.material)
  const category = text(p.category, PATH_MAX)
  const sub = text(p.subCategory, PATH_MAX)
  const path = fromTree || text(p.materialPath, PATH_MAX) || [category, sub && sub !== category ? sub : ""].filter(Boolean).join(" › ")
  return { ...(spec ? { spec } : {}), ...(path ? { path } : {}) }
}

/** The spec as the small chips under a line's name («16 مم», «G60»). */
export function specCells(spec: string | null | undefined): string[] {
  return (spec || "")
    .split(/\s*[·•|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}
