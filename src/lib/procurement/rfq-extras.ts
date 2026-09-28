// The RFQ area's remaining prototype rules (proc-index FORMS.rfq 2084-2160,
// share 2280, dRfq 1823, award 2220). Pure — no I/O.
//
// - The title is suggested from the lines («يُقترح من المنتجات ويمكنك تعديله»):
//   the first two names, how many more, and the project when every line is for one.
// - Who may be sent a private RFQ or awarded one is `supplierSourcingBlock`;
//   while a supplier's profile has not been read, only our own record judges
//   him — an unknown VAT number is not held against anyone.
// - A public RFQ reaches the platform's material suppliers of its categories,
//   ours and the platform's, less those added and not yet vouched for.
// - Extending an RFQ may add suppliers of the same categories, the platform's included.

import { categoryRoot, effectiveCrExpiry, isUnverified, supplierSourcingBlock, type SourcingBlock, type SupplierRecord } from "./supplier-file"
import type { SupplierFacts } from "./types"

// ---------------------------------------------------------------------------
// The suggested title
// ---------------------------------------------------------------------------

export interface TitleLine {
  name: string
  project?: string | null
}

export function suggestRfqTitle(lines: TitleLine[], copy: { and: string; more: (count: number) => string }): string {
  const named = lines.map((l) => ({ name: (l.name || "").trim(), project: (l.project || "").trim() })).filter((l) => l.name)
  if (!named.length) return ""
  const head = named.slice(0, 2).map((l) => l.name).join(copy.and)
  const more = named.length > 2 ? copy.more(named.length - 2) : ""
  const projects = new Set(named.map((l) => l.project))
  const project = projects.size === 1 ? [...projects][0] : ""
  return `${head}${more}${project ? ` — ${project}` : ""}`
}

/** The date the RFQ must be decided by: the earliest need-by of any line. */
export function earliestNeedBy(lines: Array<{ needBy?: string | null }>): string | null {
  return lines.map((l) => (l.needBy || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0] || null
}

// ---------------------------------------------------------------------------
// Sourcing: who may be invited privately or awarded
// ---------------------------------------------------------------------------

export interface SourcingProfile {
  vat?: string | null
  crExpiry?: string | null
}

/** `profile` undefined = not read yet: judge by our record alone. */
export function sourcingBlockOf(record: Pick<SupplierRecord, "verified" | "vatNumber" | "crExpiry"> | null | undefined, profile: SourcingProfile | undefined, today: string): SourcingBlock | null {
  if (profile !== undefined) return supplierSourcingBlock(record, profile, today)
  if (isUnverified(record)) return "unverified"
  const cr = effectiveCrExpiry(record, null)
  return cr && cr < today ? "cr_expired" : null
}

/** A profile read into `SupplierFacts` → what the sourcing rule reads; unknown → undefined. */
export function profileOfFacts(facts: SupplierFacts | null | undefined): SourcingProfile | undefined {
  if (!facts || facts.hasVatNumber == null) return undefined
  return { vat: facts.hasVatNumber ? "on-file" : "", crExpiry: facts.crExpiry }
}

/** The private list's default: everyone who may be invited. An explicit pick is kept, less the blocked. */
export function invitableRecipients(all: string[], picked: string[] | null, blockOf: (id: string) => SourcingBlock | null): string[] {
  return (picked ?? all).filter((id) => !blockOf(id))
}

// ---------------------------------------------------------------------------
// Platform reach and the extension pool
// ---------------------------------------------------------------------------

export interface ReachSupplier {
  orgId: string
  memberIds?: string[]
  categories: string[]
  record?: Pick<SupplierRecord, "verified" | "kind"> | null
}

const servesAny = (s: ReachSupplier, roots: string[], tree: Record<string, readonly string[]>): boolean =>
  s.categories.some((c) => roots.includes(categoryRoot(c, tree)))

/** «يصل إلى n مورداً متخصصاً في …»: material suppliers of the RFQ's categories, less the unvouched. */
export function publicReach<T extends ReachSupplier>(suppliers: T[], rfqCategories: string[], tree: Record<string, readonly string[]>): T[] {
  const roots = [...new Set(rfqCategories.filter(Boolean).map((c) => categoryRoot(c, tree)))]
  if (!roots.length) return []
  return suppliers.filter((s) => (s.record?.kind || "mat") === "mat" && !isUnverified(s.record) && servesAny(s, roots, tree))
}

export interface PoolEntry {
  orgId: string
  name: string
  platform: boolean
  favourite: boolean
}

/** «أضف موردين» on an extension: ours first (favourites on top), then the platform's of the same categories; never someone already invited. */
export function extendPool(
  ours: Array<{ orgId: string; name: string; isFavorite: boolean }>,
  platform: Array<ReachSupplier & { name: string }>,
  rfqCategories: string[],
  invited: string[],
  tree: Record<string, readonly string[]>
): PoolEntry[] {
  const taken = new Set(invited)
  const out: PoolEntry[] = []
  for (const o of ours) {
    if (taken.has(o.orgId)) continue
    taken.add(o.orgId)
    out.push({ orgId: o.orgId, name: o.name, platform: false, favourite: o.isFavorite })
  }
  for (const s of publicReach(platform, rfqCategories, tree)) {
    if (taken.has(s.orgId) || (s.memberIds || []).some((m) => taken.has(m))) continue
    taken.add(s.orgId)
    out.push({ orgId: s.orgId, name: s.name, platform: true, favourite: false })
  }
  return out.sort((a, b) => Number(b.favourite) - Number(a.favourite) || Number(a.platform) - Number(b.platform) || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// The award's payment line
// ---------------------------------------------------------------------------

/** «نقداً مقدّماً — تدفعه المالية قبل التوريد»: the offer asks for money before the goods. */
export function paidBeforeDelivery(o: { advancePercent?: unknown; creditDays?: unknown }): boolean {
  const adv = Number(o.advancePercent)
  if (o.advancePercent != null && o.advancePercent !== "" && Number.isFinite(adv) && adv > 0) return true
  return o.creditDays != null && o.creditDays !== "" && Number(o.creditDays) === 0
}

// ---------------------------------------------------------------------------
// The invited list's footer
// ---------------------------------------------------------------------------

/** «وأُرسل الرابط إلى n · m منهم قدّموا». */
export const guestLinkLine = (invites: number | null | undefined, guestOffers: number): { sent: number; offered: number } | null =>
  (invites || 0) > 0 ? { sent: invites || 0, offered: guestOffers } : null
