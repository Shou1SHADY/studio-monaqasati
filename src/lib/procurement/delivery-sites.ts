// «مواقع التسليم» (PUR-10): where goods are delivered — warehouses and work sites, each
// with the city and district the supplier reads, an address, and the receiver proposed for
// every delivery there. In every package: with Project Management a project's site joins
// the list by itself (its city filled once here); without it, a site is just a place, not
// a project with certificates and budgets. Kept in `procurementSettings/{orgId}.deliverySites`
// (owner or approver — the settings document's own rule). Pure.

export type DeliverySiteKind = "site" | "warehouse" | "project"

export interface DeliverySite {
  id: string
  kind: DeliverySiteKind
  name: string
  city: string
  district: string
  address: string
  /** `procurementReceivers` id proposed for its deliveries. */
  receiverId: string | null
  projectId?: string | null
  warehouseId?: string | null
  /** Taken off the pickers; documents that name it keep reading it. */
  retired?: boolean
}

export const projectSiteId = (projectId: string) => `prj_${projectId}`
export const warehouseSiteId = (warehouseId: string) => `wh_${warehouseId}`

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")

export function storedSites(raw: unknown): DeliverySite[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: text(x.id),
      kind: (["site", "warehouse", "project"].includes(text(x.kind)) ? text(x.kind) : "site") as DeliverySiteKind,
      name: text(x.name),
      city: text(x.city),
      district: text(x.district),
      address: text(x.address),
      receiverId: text(x.receiverId) || null,
      projectId: text(x.projectId) || null,
      warehouseId: text(x.warehouseId) || null,
      // Never `retired: undefined`: the list is written back whole, and Firestore refuses undefined.
      ...(x.retired === true ? { retired: true } : {}),
    }))
    .filter((s) => s.id && s.name)
}

/** Every place a delivery can go: the stored ones, then the company's warehouses and (with
 * Project Management) its projects not stored yet — those carry no city until it is filled. */
export function deliverySites(input: {
  stored: DeliverySite[]
  warehouses: Array<{ id: string; name?: string; location?: string | null; projectId?: string | null }>
  projects: Array<{ id: string; name?: string; location?: string | null; status?: string | null }>
  pmOn: boolean
}): DeliverySite[] {
  const out = [...input.stored]
  const has = (id: string) => out.some((s) => s.id === id)
  for (const w of input.warehouses) {
    // A project's own store is the project's site, not a place of its own.
    if (w.projectId || has(warehouseSiteId(w.id)) || out.some((s) => s.warehouseId === w.id)) continue
    out.push({ id: warehouseSiteId(w.id), kind: "warehouse", name: w.name || w.id, city: "", district: "", address: text(w.location), receiverId: null, warehouseId: w.id })
  }
  if (input.pmOn) {
    for (const p of input.projects) {
      if (has(projectSiteId(p.id)) || out.some((s) => s.projectId === p.id)) continue
      out.push({ id: projectSiteId(p.id), kind: "project", name: p.name || p.id, city: "", district: "", address: text(p.location), receiverId: null, projectId: p.id })
    }
  }
  return out
    .filter((s) => input.pmOn || s.kind !== "project")
    .sort((a, b) => Number(!!a.retired) - Number(!!b.retired) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "ar"))
}

/** «الرياض — حي الياسمين» — as the supplier reads the place. */
export const siteLine = (s: Pick<DeliverySite, "city" | "district">, cityText: (c: string) => string = (c) => c, districtText: (d: string) => string = (d) => d): string =>
  [s.city ? cityText(s.city) : "", s.district ? districtText(s.district) : ""].filter(Boolean).join(" — ")

/** A stored site replaced or added (the settings page and the editor's «احفظ المدينة»). */
/** Firestore refuses an undefined field (no `ignoreUndefinedProperties`): every site written goes through this. */
const writable = (s: DeliverySite): DeliverySite => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as DeliverySite

export function upsertSite(list: DeliverySite[], site: DeliverySite): DeliverySite[] {
  const i = list.findIndex((s) => s.id === site.id)
  return (i >= 0 ? list.map((s, j) => (j === i ? site : s)) : [...list, site]).map(writable)
}
