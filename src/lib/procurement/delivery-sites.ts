// «مواقع التسليم» (PUR-10): where goods are delivered — warehouses and work sites, each
// with the city and district the supplier reads, an address, and the receiver proposed for
// every delivery there. In every package: with Project Management a project's site joins
// the list by itself (its city filled once here); without it, a site is just a place, not
// a project with certificates and budgets. Kept in `procurementSettings/{orgId}.deliverySites`,
// written by `/api/procurement/delivery-sites` (the owner or whoever approves orders). Pure.

import { CITIES_EN, SAUDI_CITIES } from "../constants"
import { foldSearchText } from "../search-text"
import { readDeliveryOptions } from "./delivery-options"
import { normaliseMapUrl } from "./delivery-site-input"
import type { PermissionId } from "../permissions"

/** `workshop`: the workshop's own warehouse, a place only a company with Manufacturing in its package has. */
export type DeliverySiteKind = "site" | "warehouse" | "project" | "workshop"

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
  /** An https map link the supplier opens (SET-02); absent when none was given. */
  mapUrl?: string | null
  /** Taken off the pickers; documents that name it keep reading it. */
  retired?: boolean
}

export const projectSiteId = (projectId: string) => `prj_${projectId}`
export const warehouseSiteId = (warehouseId: string) => `wh_${warehouseId}`

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * A project's free-text `location` read as a city and a district («الرياض - حي الياسمين»): the city
 * is the longest of the kingdom's cities (Arabic or English) the text names, the district what is left.
 * Text that names no city stays whole as the district, for the buyer to choose the city.
 */
export function placeFromText(raw: unknown): { city: string; district: string } {
  const value = text(raw)
  if (!value) return { city: "", district: "" }
  const folded = foldSearchText(value)
  const hits = SAUDI_CITIES.flatMap((city) => [city, CITIES_EN[city]].filter(Boolean).map((name) => ({ city, name }))).filter(({ name }) => folded.includes(foldSearchText(name)))
  const hit = hits.sort((a, b) => b.name.length - a.name.length)[0]
  if (!hit) return { city: "", district: value }
  const want = foldSearchText(hit.name)
  const district = value
    .split(/[،,\-—–|/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      if (!foldSearchText(part).includes(want)) return [part]
      const rest = part.replace(new RegExp(escapeRe(hit.name), "i"), "").trim()
      return rest && rest !== part ? [rest] : []
    })
    .join(" ")
  return { city: hit.city, district }
}

export function storedSites(raw: unknown): DeliverySite[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: text(x.id),
      kind: (["site", "warehouse", "project", "workshop"].includes(text(x.kind)) ? text(x.kind) : "site") as DeliverySiteKind,
      name: text(x.name),
      city: text(x.city),
      district: text(x.district),
      address: text(x.address),
      receiverId: text(x.receiverId) || null,
      projectId: text(x.projectId) || null,
      warehouseId: text(x.warehouseId) || null,
      // Never `retired: undefined`: the list is written back whole, and Firestore refuses undefined.
      ...(normaliseMapUrl(x.mapUrl) ? { mapUrl: normaliseMapUrl(x.mapUrl) } : {}),
      ...(x.retired === true ? { retired: true } : {}),
    }))
    .filter((s) => s.id && s.name)
}

/** Every place a delivery can go: the stored ones — a project's site stays whatever the package says, the package change
 * turns it into an ordinary site (`package-migration-server.ts`) and never hides it — then the company's warehouses and (with
 * Project Management) its projects not stored yet — those carry the city and district read from the
 * project's own location (`placeFromText`), for the buyer to confirm. The workshop's warehouse is a
 * place only with Manufacturing in the package: `mfgOn: false` leaves it out (absent = not asked). */
export function deliverySites(input: {
  stored: DeliverySite[]
  warehouses: Array<{ id: string; name?: string; location?: string | null; projectId?: string | null }>
  projects: Array<{ id: string; name?: string; location?: string | null; status?: string | null }>
  pmOn: boolean
  mfgOn?: boolean
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
      out.push({ id: projectSiteId(p.id), kind: "project", name: p.name || p.id, ...placeFromText(p.location), address: text(p.location), receiverId: null, projectId: p.id })
    }
  }
  return out
    .filter((s) => input.mfgOn !== false || s.kind !== "workshop")
    .sort((a, b) => Number(!!a.retired) - Number(!!b.retired) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "ar"))
}

/** A place typed in by hand (a work site, a warehouse or the workshop's), not one read from a project or a warehouse record:
 * its name is the buyer's to write and the place can be retired. */
export const manualSite = (s: Pick<DeliverySite, "kind" | "warehouseId" | "projectId">): boolean =>
  s.kind === "site" || s.kind === "workshop" || (s.kind === "warehouse" && !s.warehouseId)

/**
 * The editor's location chips (ED-03): a chip per place a delivery can go, the chosen one first, a place already used by
 * ANOTHER group of the same request disabled (a request names a place once). A retired place is shown only while it is the
 * chosen one.
 */
export function siteChips(
  sites: DeliverySite[],
  opts: { usedByOtherGroups?: Iterable<string>; selectedId?: string | null } = {},
): Array<{ site: DeliverySite; selected: boolean; disabled: boolean }> {
  const used = new Set(opts.usedByOtherGroups || [])
  const chips = sites
    .filter((s) => !s.retired || s.id === opts.selectedId)
    .map((site) => ({ site, selected: site.id === opts.selectedId, disabled: used.has(site.id) && site.id !== opts.selectedId }))
  return chips.sort((a, b) => Number(b.selected) - Number(a.selected))
}

/** «الرياض — حي الياسمين» — as the supplier reads the place. */
export const siteLine = (s: Pick<DeliverySite, "city" | "district">, cityText: (c: string) => string = (c) => c, districtText: (d: string) => string = (d) => d): string =>
  [s.city ? cityText(s.city) : "", s.district ? districtText(s.district) : ""].filter(Boolean).join(" — ")

/**
 * The city AND district an order keeps (PUR-10): the supplier reads «الرياض — حي الياسمين», not
 * only the city. The offer's own place wins; the RFQ's district is taken only while the city it
 * names is the same one, so a supplier who quotes another city never inherits a district of
 * the first.
 */
export function orderDeliveryFields(
  offer: { deliveryLocation?: string | null; deliveryDistrict?: string | null },
  rfq: { city?: string | null; district?: string | null; deliveryOptions?: unknown }
): { deliveryLocation: string | null; deliveryDistrict: string | null; deliveryOptions?: ReturnType<typeof readDeliveryOptions> } {
  const city = text(offer.deliveryLocation) || text(rfq.city)
  const district = text(offer.deliveryDistrict) || (city && city === text(rfq.city) ? text(rfq.district) : "")
  // The buyer's delivery options (ED-04) travel with the order; absent when the RFQ set none.
  const options = readDeliveryOptions(rfq.deliveryOptions)
  return { deliveryLocation: city || null, deliveryDistrict: district || null, ...(Object.keys(options).length ? { deliveryOptions: options } : {}) }
}

/** A work site linked to a project (with Project Management in the package); null for any other. */
export const linkedProjectId = (site: Pick<DeliverySite, "kind" | "projectId">): string | null => (site.kind === "site" && site.projectId ? site.projectId : null)

/** A stored site replaced or added (the settings page and the editor's «احفظ المدينة»). */
/** Firestore refuses an undefined field (no `ignoreUndefinedProperties`): every site written goes through this. */
const writable = (s: DeliverySite): DeliverySite => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as DeliverySite

export function upsertSite(list: DeliverySite[], site: DeliverySite): DeliverySite[] {
  const i = list.findIndex((s) => s.id === site.id)
  return (i >= 0 ? list.map((s, j) => (j === i ? site : s)) : [...list, site]).map(writable)
}

/** ED-22 — who may write this site: changing a stored one (or retiring) is the approvers'; adding a new one is also the buyers'. */
export const ADD_SITE_PERMISSIONS: readonly PermissionId[] = ["po.approve", "rfq.create", "rfq.manage", "offers.accept"]
export function siteWriteRefusal(can: (p: PermissionId) => boolean, replacesStored: boolean, retires: boolean): "FORBIDDEN" | null {
  if (can("po.approve")) return null
  if (replacesStored || retires) return "FORBIDDEN"
  return ADD_SITE_PERMISSIONS.some((p) => can(p)) ? null : "FORBIDDEN"
}
