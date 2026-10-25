// The RFQ editor (Procurement 1.5, PUR-02/03). Pure: the screen holds an `EditorState`
// and every change is one of these functions; `buildRfqDoc` makes the ONE RFQ the buyer
// wrote — every category on it, never split.
//
// - Every project / delivery site is a GROUP: its header gives the city and district the
//   supplier reads, the need-by date and the incoming request's number.
// - A ROW is the same material row everywhere (PUR-04): the material (as it arrived or
//   was typed, with the tree's material under it), its spec cells, the quantity, the unit
//   from the material. What arrived from an incoming request is never written over: its
//   name stays, and its quantity and unit are what reaches the supplier.
// - A wholly blank row is ignored (and changes no pricing mode); a begun row must be
//   finished, and the message names the row and what it lacks.

import { productStarted } from "@/lib/rfq-products"
import { rfqMaterialFields } from "@/lib/materials/reach"
import { label, pathLabel, searchMaterials, unitIsTheMaterials, unitsOf, type MaterialIndex, pickOf } from "@/lib/materials/tree"
import type { MaterialPick } from "@/lib/materials/types"
import { toAmount } from "./offer-pricing"
import type { Need, NeedSource } from "./needs"
import { projectSiteId, type DeliverySite } from "./delivery-sites"
import { cleanDelivery, type DeliveryOptions } from "./delivery-options"

/** The warranty a row can ask for, in months: 6 · 1 year · 2 · 3 · 5 years (CAT-05). */
export const WARRANTY_MONTHS = [6, 12, 24, 36, 60] as const
export type WarrantyMonths = (typeof WARRANTY_MONTHS)[number]
export const DEFAULT_WARRANTY: WarrantyMonths = 12

const asWarranty = (v: unknown): WarrantyMonths | null => (WARRANTY_MONTHS as readonly number[]).includes(Number(v)) ? (Number(v) as WarrantyMonths) : null

export interface EditorLine {
  key: string
  /** The material as it arrived or was typed («بلوك أسمنتي مفرغ 20 سم») — never overwritten. */
  name: string
  material: MaterialPick | null
  quantity: string
  unit: string
  /** The unit came with the line (an incoming request, a paste): kept even when the tree's differs. */
  unitFromSource: boolean
  /** A pasted unit that is not one of the material's: the row takes the material's unit and says so. */
  pastedUnit?: string | null
  /** «موعد مختلف»: its own need-by date. */
  needBy?: string | null
  /** Asked for with a duration (CAT-05); null/absent = no warranty. */
  warrantyMonths?: WarrantyMonths | null
  /** Set by a source that only knows "yes" (a BOQ item, an RFQ written before durations): read as a year by `warrantyOf`. */
  requiresWarranty?: boolean
  /** The incoming request (and its line) the row came from. `requestLine` is the line's place in the
   * request's own `lines`; `total` how many lines the request has and `linkedBefore` how many already
   * went into another RFQ — what tells a whole request from a part of one when it is published. */
  source?: { need: NeedSource; line: number; key: string; requestLine?: number | null; total?: number; linkedBefore?: number } | null
  /** The project's BOQ item the incoming row is for. */
  boqItemId?: string | null
  /** A line of an RFQ written before the tree, being edited: its old words stand. */
  legacy?: { category: string; subCategory: string } | null
}

/** What the panel's first step says of a request: who asked, who approved and when, and its last day to order. */
export interface RequestFact {
  ref: string
  requestedBy: string
  approvedBy: string
  approvedOn: string
  lastOrderDay: string | null
}

export interface EditorGroup {
  key: string
  /** The delivery site it goes to (`deliverySites`), or none for a typed address. */
  siteId: string | null
  projectId: string | null
  label: string
  city: string
  district: string
  needBy: string | null
  /** «من ط.م 03» — the incoming request(s) the group came from. */
  requestRefs: string[]
  /** Read from the incoming request(s); never stored on the RFQ. */
  facts?: RequestFact[]
  /** «التسليم» (ED-04): who unloads, the time of day, a note to reach the site — all optional. */
  delivery?: DeliveryOptions
  lines: EditorLine[]
}

let seq = 0
export const newKey = (p = "l") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

export const blankLine = (): EditorLine => ({ key: newKey(), name: "", material: null, quantity: "", unit: "", unitFromSource: false })

export function newGroup(over: Partial<EditorGroup> = {}): EditorGroup {
  return { key: newKey("g"), siteId: null, projectId: null, label: "", city: "", district: "", needBy: null, requestRefs: [], lines: [], ...over }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** The warranty a row asks for, in months, or null. */
export const warrantyOf = (l: Pick<EditorLine, "warrantyMonths" | "requiresWarranty">): WarrantyMonths | null => l.warrantyMonths ?? (l.requiresWarranty ? DEFAULT_WARRANTY : null)

/** The switch and the duration as one patch: both fields say the same thing after any change. */
export const warrantyPatch = (months: WarrantyMonths | null): Pick<EditorLine, "warrantyMonths" | "requiresWarranty"> => ({ warrantyMonths: months, requiresWarranty: months != null })

export const lineStarted = (l: EditorLine): boolean => productStarted({ category: l.material ? "x" : l.legacy?.category || "", quantity: l.quantity, unit: l.unit, description: l.name })

export type LineGap = "material" | "quantity" | "unit"

/** What a begun row still lacks: the material (or its sub-category), a quantity, a unit. */
export function lineGaps(l: EditorLine): LineGap[] {
  if (!lineStarted(l)) return []
  const out: LineGap[] = []
  if (!l.material && !l.legacy) out.push("material")
  if (!(toAmount(l.quantity) > 0)) out.push("quantity")
  if (!l.unit.trim()) out.push("unit")
  return out
}

export const lineComplete = (l: EditorLine): boolean => lineStarted(l) && lineGaps(l).length === 0

/** Rows numbered across groups as the screen shows them (1, 2, 3 … ), blank rows skipped. */
export function numberedLines(groups: EditorGroup[]): Array<{ group: EditorGroup; line: EditorLine; no: number }> {
  const out: Array<{ group: EditorGroup; line: EditorLine; no: number }> = []
  for (const g of groups) for (const l of g.lines) if (lineStarted(l)) out.push({ group: g, line: l, no: out.length + 1 })
  return out
}

export interface EditorProblem {
  groupKey: string
  lineKey: string | null
  no: number | null
  /** `Portal.ProcEditor.err_*` */
  code: "material" | "quantity" | "unit" | "no_lines" | "no_place"
}

/** Step 1's refusals, each on its row («اختر المادة أو فئتها الفرعية في الصف 2»). */
export function materialsProblems(groups: EditorGroup[]): EditorProblem[] {
  const rows = numberedLines(groups)
  const out: EditorProblem[] = []
  for (const r of rows) for (const gap of lineGaps(r.line)) out.push({ groupKey: r.group.key, lineKey: r.line.key, no: r.no, code: gap })
  for (const g of groups) if (g.lines.some(lineStarted) && !g.city.trim()) out.push({ groupKey: g.key, lineKey: null, no: null, code: "no_place" })
  if (!rows.length) out.push({ groupKey: groups[0]?.key || "", lineKey: null, no: null, code: "no_lines" })
  return out
}

/** The incoming unit is not the material's: kept, and said (PUR-02). */
export function unitNote(l: EditorLine, index: MaterialIndex | null): { kind: "differs"; units: string[] } | null {
  if (!index || !l.material || l.material.outside || !l.unit.trim()) return null
  const units = unitsOf(index, l.material.nodeId)
  if (!units.length || unitIsTheMaterials(l.unit, units)) return null
  return { kind: "differs", units: units.map((u) => u.ar) }
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

const mapGroup = (groups: EditorGroup[], key: string, f: (g: EditorGroup) => EditorGroup) => groups.map((g) => (g.key === key ? f(g) : g))

export function updateLine(groups: EditorGroup[], groupKey: string, lineKey: string, patch: Partial<EditorLine>): EditorGroup[] {
  return mapGroup(groups, groupKey, (g) => ({ ...g, lines: g.lines.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)) }))
}

export function addLine(groups: EditorGroup[], groupKey: string, line: EditorLine, afterKey?: string): EditorGroup[] {
  return mapGroup(groups, groupKey, (g) => {
    const i = afterKey ? g.lines.findIndex((l) => l.key === afterKey) : -1
    const lines = [...g.lines]
    lines.splice(i >= 0 ? i + 1 : lines.length, 0, line)
    return { ...g, lines }
  })
}

export const removeLine = (groups: EditorGroup[], groupKey: string, lineKey: string): EditorGroup[] => mapGroup(groups, groupKey, (g) => ({ ...g, lines: g.lines.filter((l) => l.key !== lineKey) }))

/** «كرّر»: the same material for another size or grade, on the next row — the spec values cleared. */
export function repeatLine(groups: EditorGroup[], groupKey: string, lineKey: string): EditorGroup[] {
  const g = groups.find((x) => x.key === groupKey)
  const l = g?.lines.find((x) => x.key === lineKey)
  if (!g || !l) return groups
  const copy: EditorLine = { ...l, key: newKey(), quantity: "", source: null, material: l.material ? { ...l.material, specs: [] } : null, unitFromSource: false }
  return addLine(groups, groupKey, copy, lineKey)
}

/** The row filled from a tree pick (search or browser): the material under the words, its unit when the row has none. */
export function lineFromPick(line: EditorLine, pick: MaterialPick, unit: string | null, locale: string): EditorLine {
  const leaf = pick.path[pick.path.length - 1]
  return {
    ...line,
    material: pick,
    name: line.name || (pick.outside ? line.name : label(leaf, locale)),
    unit: line.unit.trim() && line.unitFromSource ? line.unit : unit || line.unit,
    legacy: null,
  }
}

export const removeGroup = (groups: EditorGroup[], key: string): EditorGroup[] => groups.filter((g) => g.key !== key)

// ---------------------------------------------------------------------------
// From the incoming requests (PUR-01 «جهّزه», PUR-02 «أضف من طلبات الشراء الواردة»)
// ---------------------------------------------------------------------------

export interface IncomingRequest {
  key: string
  ref: string
  source: NeedSource
  projectId: string | null
  label: string
  siteId: string | null
  city: string
  district: string
  needBy: string | null
  /** The request's whole count of lines, and how many already went into an RFQ of their own. */
  total?: number
  linkedBefore?: number
  fact?: RequestFact
  lines: Array<{ name: string; quantity: number; unit: string; needBy?: string | null; material?: MaterialPick | null; index?: number; requestLine?: number | null; itemId?: string | null }>
}

/** Each picked request lands as its own group — its project or site, its date and its number;
 * a second request for the same place joins that place's group. */
export function addRequests(groups: EditorGroup[], requests: IncomingRequest[]): EditorGroup[] {
  let out = groups.filter((g) => g.lines.some(lineStarted) || g.requestRefs.length || g.city)
  for (const r of requests) {
    const lines: EditorLine[] = r.lines.map((l, i) => ({
      key: newKey(),
      name: l.name,
      material: l.material || null,
      quantity: String(l.quantity),
      unit: l.unit,
      unitFromSource: true,
      needBy: l.needBy && l.needBy !== r.needBy ? l.needBy : null,
      source: { need: r.source, line: l.index ?? i, key: r.key, requestLine: l.requestLine ?? null, total: r.total, linkedBefore: r.linkedBefore },
      boqItemId: l.itemId ?? null,
    }))
    const same = out.find((g) => (r.siteId && g.siteId === r.siteId) || (r.projectId && g.projectId === r.projectId))
    if (same) {
      out = mapGroup(out, same.key, (g) => ({
        ...g,
        requestRefs: g.requestRefs.includes(r.ref) ? g.requestRefs : [...g.requestRefs, r.ref],
        facts: r.fact ? [...(g.facts || []).filter((f) => f.ref !== r.ref), r.fact] : g.facts,
        needBy: [g.needBy, r.needBy].filter((d): d is string => !!d).sort()[0] || null,
        lines: [...g.lines.filter(lineStarted), ...lines],
      }))
    } else {
      out = [...out, newGroup({ siteId: r.siteId, projectId: r.projectId, label: r.label, city: r.city, district: r.district, needBy: r.needBy, requestRefs: [r.ref], ...(r.fact ? { facts: [r.fact] } : {}), lines })]
    }
  }
  return out.length ? out : [newGroup()]
}

/** The requests already on the editor (their keys), so «أضف من الواردة» counts only new ones. */
export const requestKeysIn = (groups: EditorGroup[]): Set<string> => new Set(groups.flatMap((g) => g.lines.map((l) => l.source?.key).filter((k): k is string => !!k)))

// ---------------------------------------------------------------------------
// «الصق من إكسل»: material · quantity · unit
// ---------------------------------------------------------------------------

export interface PastedRow {
  name: string
  quantity: string
  unit: string
}

export function parsePaste(text: string): PastedRow[] {
  return text
    .split(/\r?\n/)
    .map((row) => row.split(row.includes("\t") ? "\t" : /[;,]/).map((c) => c.trim()))
    .filter((cells) => cells.some(Boolean))
    .map(([name = "", quantity = "", unit = ""]) => ({ name, quantity: quantity.replace(/[٬,]/g, ""), unit }))
    .filter((r) => r.name)
    .slice(0, 200)
}

/** A pasted row is the same material row: matched to the tree when its words name ONE material
 * well enough, else it waits with «اختر المادة» on it. The pasted unit stays, flagged if it differs. */
export function linesFromPaste(rows: PastedRow[], index: MaterialIndex | null, opts: { unitFromMaterial?: boolean } = {}): EditorLine[] {
  return rows.map((r) => {
    const hits = index ? searchMaterials(index, r.name, 2) : []
    const sure = hits.length > 0 && (hits.length === 1 || hits[0].score > hits[1].score)
    const material = sure && index ? pickOf(index, hits[0].node.id, hits[0].preset.map((p) => ({ name: { ar: p.spec.ar, en: p.spec.en }, value: p.value }))) : null
    const materialUnits = material && index ? unitsOf(index, material.nodeId) : []
    if (opts.unitFromMaterial && material && materialUnits.length) {
      const own = r.unit && unitIsTheMaterials(r.unit, materialUnits)
      return { key: newKey(), name: r.name, material, quantity: r.quantity, unit: own ? r.unit : materialUnits[0].ar, unitFromSource: false, pastedUnit: r.unit && !own ? r.unit : null }
    }
    const unit = r.unit || materialUnits[0]?.ar || ""
    return { key: newKey(), name: r.name, material, quantity: r.quantity, unit, unitFromSource: Boolean(r.unit) }
  })
}

// ---------------------------------------------------------------------------
// The title, the review, the document
// ---------------------------------------------------------------------------

/** «البلك الاسمنتي والاسمنت العادي — مجمع الياسمين وبرج العليا»: the sub-categories, then the places.
 * `and` is the language's joiner with its spaces (« و », « & »); `more` names what did not fit. */
export function suggestTitle(groups: EditorGroup[], words: { and: string; more: (count: number) => string }): string {
  const subs: string[] = []
  for (const { line } of numberedLines(groups)) {
    const sub = line.material ? (line.material.path[1] || line.material.path[0])?.ar : line.legacy?.subCategory || line.name.trim()
    if (sub && !subs.includes(sub)) subs.push(sub)
  }
  if (!subs.length) return ""
  const places = [...new Set(groups.filter((g) => g.lines.some(lineStarted) && g.label).map((g) => g.label))]
  const what = subs.slice(0, 2).join(words.and) + (subs.length > 2 ? words.more(subs.length - 2) : "")
  const where = places.slice(0, 2).join(words.and)
  return [what, where].filter(Boolean).join(" — ").slice(0, 140)
}

export interface ReviewFacts {
  lines: number
  subs: number
  groups: number
  /** «رمل أبيض للياسة» بلا مواصفة — published as it is, a warning, never a refusal. */
  noSpec: string[]
  outside: string[]
  unitDiffers: string[]
  earliestNeed: string | null
}

export function reviewFacts(groups: EditorGroup[], index: MaterialIndex | null): ReviewFacts {
  const rows = numberedLines(groups).filter((r) => lineComplete(r.line))
  const subs = new Set(rows.map((r) => r.line.material?.subId || r.line.legacy?.subCategory || r.line.name))
  const dates = rows.map((r) => r.line.needBy || r.group.needBy).filter((d): d is string => !!d).sort()
  return {
    lines: rows.length,
    subs: subs.size,
    groups: new Set(rows.map((r) => r.group.key)).size,
    noSpec: rows.filter((r) => r.line.material && !r.line.material.outside && !r.line.material.specs.length && !r.line.material.brand).map((r) => r.line.name),
    outside: rows.filter((r) => r.line.material?.outside).map((r) => r.line.name),
    unitDiffers: rows.filter((r) => unitNote(r.line, index)).map((r) => r.line.name),
    earliestNeed: dates[0] || null,
  }
}

/**
 * The requests this RFQ takes only a part of (a row dropped after «جهّزه», or some lines already in
 * another RFQ): each of those is linked line by line, so the rest stays on the incoming page as new
 * (PUR-01: «جزء منه في عروض»). A request taken whole is linked as one. Only a PM request's line knows
 * its place in the request (`requestLine`), and a line sourced apart is already per line.
 */
export function partialRequestKeys(groups: EditorGroup[]): Set<string> {
  const taken = new Map<string, { count: number; total: number; linkedBefore: number }>()
  for (const { line } of numberedLines(groups)) {
    const s = line.source
    if (!lineComplete(line) || !s || s.requestLine == null || s.need.kind !== "project_request" || (s.need as NeedSource).line != null) continue
    const cur = taken.get(s.key) || { count: 0, total: s.total ?? 0, linkedBefore: s.linkedBefore ?? 0 }
    taken.set(s.key, { ...cur, count: cur.count + 1 })
  }
  return new Set([...taken].filter(([, v]) => v.linkedBefore > 0 || v.count < v.total).map(([k]) => k))
}

/** The products and the material fields of the ONE RFQ (PUR-03): every line, in order, with its place. */
export function rfqLinesDoc(groups: EditorGroup[], locale: string, projectName: (id: string) => string | null, opts: { draft?: boolean; perLine?: Set<string> } = {}) {
  // A draft keeps what was begun, finished or not («المسودة تُحفظ وحدها»); a published RFQ only finished rows.
  const rows = numberedLines(groups).filter((r) => opts.draft || lineComplete(r.line))
  const products = rows.map(({ group: g, line: l }) => {
    const m = l.material
    const category = m ? m.path[0]?.ar || "" : l.legacy?.category || ""
    const subCategory = m ? (m.path[1] || m.path[0])?.ar || "" : l.legacy?.subCategory || ""
    const specText = m ? [...m.specs.map((s) => `${s.name.ar} ${s.value.ar}`), ...(m.brand ? [m.brand.ar] : [])].join(" · ") : ""
    const needBy = l.needBy || g.needBy || null
    const projectId = g.projectId || null
    const warranty = warrantyOf(l)
    return {
      name: l.name.trim() || (m ? label(m.path[m.path.length - 1], locale) : subCategory),
      quantity: toAmount(l.quantity),
      unitOfMeasure: l.unit.trim(),
      description: specText,
      category,
      subCategory,
      ...(m ? { material: m, materialPath: pathLabel(m.path, "ar", true) } : {}),
      requiresWarranty: warranty != null,
      ...(warranty != null ? { warrantyMonths: warranty } : {}),
      ...(m?.saleUnits?.length ? { saleUnits: m.saleUnits } : {}),
      ...(needBy ? { needBy } : {}),
      ...(projectId ? { projectId, projectName: projectName(projectId) || g.label || null } : {}),
      deliverySiteId: g.siteId,
      deliveryCity: g.city,
      deliveryDistrict: g.district,
      ...(l.source ? { needSource: opts.perLine?.has(l.source.key) && l.source.requestLine != null ? { ...l.source.need, line: l.source.requestLine } : l.source.need, needLine: l.source.line } : {}),
    }
  })
  return { products, ...rfqMaterialFields(rows.map((r) => ({ material: r.line.material, category: r.line.legacy?.category, subCategory: r.line.legacy?.subCategory }))) }
}

/** The RFQ-level place: one city when every group shares it, else the first group's (the lines carry their own). */
export function rfqPlace(groups: EditorGroup[]): { city: string; district: string; multi: boolean; cities: string[] } {
  const used = groups.filter((g) => g.lines.some(lineComplete))
  const cities = [...new Set(used.map((g) => g.city).filter(Boolean))]
  const first = used[0]
  // `cities`: every city the RFQ delivers to — a supplier in ANY of them is reached, not only the first group's.
  return { city: first?.city || "", district: used.length === 1 ? first.district : "", multi: cities.length > 1 || used.length > 1, cities }
}

/** The groups' own facts, kept on the RFQ so a draft or an edit reopens with its places and numbers. */
export const groupsMeta = (groups: EditorGroup[]) =>
  groups
    .filter((g) => g.lines.some(lineStarted))
    .map((g) => ({
      key: g.key,
      siteId: g.siteId,
      projectId: g.projectId,
      label: g.label,
      city: g.city,
      district: g.district,
      needBy: g.needBy,
      requestRefs: g.requestRefs,
      ...(cleanDelivery(g.delivery) ? { delivery: cleanDelivery(g.delivery) } : {}),
    }))

/**
 * The delivery options of the groups that carry rows, by place (ED-04): `rfq.deliveryOptions[siteId]`, a group with no
 * stored place keyed by its own key. Always an object — an edit that clears the options overwrites the old ones.
 */
export function deliveryOptionsOf(groups: EditorGroup[]): Record<string, NonNullable<ReturnType<typeof cleanDelivery>>> {
  const out: Record<string, NonNullable<ReturnType<typeof cleanDelivery>>> = {}
  for (const g of groups) {
    if (!g.lines.some(lineStarted)) continue
    const clean = cleanDelivery(g.delivery)
    if (clean) out[g.siteId || g.key] = clean
  }
  return out
}

/** An RFQ back on the editor: its groups from `editorGroups`, its rows from the products (older ones by their words). */
export function groupsFromRfq(rfq: Record<string, unknown>): EditorGroup[] {
  const products = Array.isArray(rfq.products) ? (rfq.products as Array<Record<string, unknown>>) : []
  const metas = Array.isArray(rfq.editorGroups) ? (rfq.editorGroups as Array<Partial<EditorGroup>>) : []
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const groups: EditorGroup[] = metas.map((m) => newGroup({ ...m, key: str(m.key) || newKey("g"), requestRefs: Array.isArray(m.requestRefs) ? m.requestRefs : [], delivery: cleanDelivery(m.delivery) ?? undefined, lines: [] }))
  const groupFor = (p: Record<string, unknown>): EditorGroup => {
    const site = str(p.deliverySiteId)
    const project = str(p.projectId)
    let g = groups.find((x) => (site && x.siteId === site) || (!site && project && x.projectId === project))
    if (!g) {
      g = newGroup({ siteId: site || null, projectId: project || null, label: str(p.projectName), city: str(p.deliveryCity) || str(rfq.city), district: str(p.deliveryDistrict) || str(rfq.district), needBy: str(p.needBy) || null })
      groups.push(g)
    }
    return g
  }
  for (const p of products) {
    const g = groupFor(p)
    const material = p.material && typeof p.material === "object" ? (p.material as MaterialPick) : null
    const ns = p.needSource as NeedSource | undefined
    g.lines.push({
      key: newKey(),
      name: str(p.name),
      material,
      quantity: p.quantity != null ? String(p.quantity) : "",
      unit: str(p.unitOfMeasure) || str(p.unit),
      unitFromSource: true,
      needBy: str(p.needBy) && str(p.needBy) !== g.needBy ? str(p.needBy) : null,
      ...warrantyPatch(asWarranty(p.warrantyMonths) ?? (p.requiresWarranty === true ? DEFAULT_WARRANTY : null)),
      source: ns ? { need: ns, line: Number(p.needLine) || 0, key: "" } : null,
      legacy: material || !str(p.category) ? null : { category: str(p.category), subCategory: str(p.subCategory) },
    })
  }
  return groups.length ? groups : [newGroup()]
}

/** An incoming request as the editor takes it: its place from the delivery sites (a project's
 * own site), its number as the project wrote it, each line as it arrived. A line that already went
 * into an RFQ of its own is not taken again. */
export function incomingFromNeed(need: Need, sites: DeliverySite[], lastOrderDay: string | null = null, only?: ReadonlySet<number> | null): IncomingRequest {
  // A team request names its site (or a typed place); a project's request, its project's site.
  const site = need.siteId ? sites.find((s) => s.id === need.siteId) || null : need.projectId ? sites.find((s) => s.id === projectSiteId(need.projectId as string) || s.projectId === need.projectId) || null : null
  return {
    key: need.key,
    ref: need.refLabel,
    source: need.source,
    projectId: need.projectId,
    label: site?.name || need.place?.label || need.projectName || need.context,
    siteId: site?.id || need.siteId || (need.projectId ? projectSiteId(need.projectId) : null),
    city: site?.city || need.place?.city || "",
    district: site?.district || need.place?.district || "",
    needBy: need.needBy ? need.needBy.slice(0, 10) : null,
    total: need.lines.length,
    linkedBefore: need.lines.filter((l) => l.link).length,
    fact: { ref: need.refLabel, requestedBy: need.requestedBy, approvedBy: need.approved?.name || "", approvedOn: need.approved?.on || "", lastOrderDay },
    lines: need.lines.flatMap((l, index) =>
      l.link || (l.lineKind && l.lineKind !== "buy") || (only && !only.has(index)) ? [] : [{ name: l.name, quantity: l.quantity, unit: l.unit, needBy: l.needBy ? l.needBy.slice(0, 10) : null, material: l.material || null, index, requestLine: l.requestLine ?? null, itemId: l.itemId ?? null }]
    ),
  }
}

/**
 * Who may reopen an RFQ in the editor (review of 20 Oct 2026): a draft, or a published RFQ no
 * supplier has priced yet. Once an offer exists its lines are indexed by the RFQ's rows
 * (`rfqProductIndex`), so rewriting them would point offers at the wrong materials; a closed,
 * cancelled or awarded RFQ is never reopened by «احفظ التعديلات» (publishing writes status New).
 */
export function rfqEditRefusal(rfq: { status?: string | null; offersCount?: number | null }, offers: number): "closed" | "has_offers" | null {
  if (rfq.status === "Draft") return null
  if (rfq.status !== "New") return "closed"
  return offers > 0 || Number(rfq.offersCount) > 0 ? "has_offers" : null
}

/** What an edit keeps from the RFQ as it was: its project and its author are not the editor's to change. */
export function rfqIdentityOf(rfq: Record<string, unknown>): { projectId: string | null; contractorId: string | null; createdByUserId: string | null; createdByUserName: string | null } {
  const s = (v: unknown) => (typeof v === "string" && v ? v : null)
  return { projectId: s(rfq.projectId), contractorId: s(rfq.contractorId), createdByUserId: s(rfq.createdByUserId), createdByUserName: s(rfq.createdByUserName) }
}

