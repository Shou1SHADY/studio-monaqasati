// Who receives goods, and where (Procurement PRD 3.0 §4 `RCVR`, §5.2-3/4).
//
// A delivery is forwarded to a PERSON AT A PLACE. Until now the forward dialog
// offered every member of the organisation, which is both too many names and the
// wrong question: the store keeper at the Narjes site is the right receiver for a
// truck going to Narjes and the wrong one for the central yard, and the man who
// signs at Al-Kharj may have no account at all.
//
// So the org keeps a short register: a name, what they are called, a mobile, the
// places they receive at, and — when they happen to have one — their account. A
// receiver with no account is normal, not an edge case: the link and its code
// exist exactly for them.
//
// THE PLACES ARE WAREHOUSES, because that is where our stock lands. A delivery's
// place is the warehouse the receipt would land it in: the one already chosen, or
// the project's own, or the central one (`resolveLandingWarehouse`). Nothing is
// stored on the receiver that the warehouse already says.

import { z } from "zod"
import { foldSearchText } from "../search-text"

export const PROCUREMENT_RECEIVERS = "procurementReceivers"

/** Which module the person belongs to — theirs is the desk the goods reach. */
export type ReceiverModule = "inventory" | "projects"
export const RECEIVER_MODULES: ReceiverModule[] = ["inventory", "projects"]

export const RECEIVER_ROLES = ["warehouse_keeper", "site_engineer", "site_supervisor", "project_manager", "procurement_officer", "logistics_coordinator", "foreman"] as const
export type ReceiverRole = (typeof RECEIVER_ROLES)[number]

// `title` is the sentence other screens print under a name, and the legacy readers
// (receipt drawer, notices, SMS) know no keys, so it is stored in Arabic, the
// platform's default, the moment a role is picked.
const ROLE_TITLE_AR: Record<ReceiverRole, string> = {
  warehouse_keeper: "أمين المستودع",
  site_engineer: "مهندس الموقع",
  site_supervisor: "مشرف الموقع",
  project_manager: "مدير المشروع",
  procurement_officer: "مسؤول المشتريات",
  logistics_coordinator: "منسق التوريد",
  foreman: "مراقب الموقع",
}
export const receiverRoleTitle = (role: ReceiverRole): string => ROLE_TITLE_AR[role]
export const isReceiverRole = (v: unknown): v is ReceiverRole => typeof v === "string" && (RECEIVER_ROLES as readonly string[]).includes(v)

export interface ProcReceiver {
  id: string
  organizationId: string
  name: string
  /** "Central store keeper", "Al-Narjes site engineer" — what to call them on a list. */
  title: string
  /** The role as picked from the list; absent on entries written before the list existed. */
  role?: ReceiverRole
  module: ReceiverModule
  /** Saudi mobile as typed; the code is texted here. */
  phone: string
  /** Their account, when they have one. A receiver need not be a member. */
  userId?: string | null
  /** The warehouses they receive at. Empty = any place (a relief keeper). */
  warehouseIds: string[]
  active: boolean
  createdAt: string
  createdById: string
}

export interface ReceiverInput {
  name: string
  title: string
  role?: ReceiverRole
  module: ReceiverModule
  phone: string
  userId?: string | null
  warehouseIds: string[]
}

/** A mobile has to be dialable: digits, and enough of them. Everything else —
 * spaces, dashes, a leading +966 or 0 — is how people write them. */
export const phoneDigits = (phone: string | null | undefined): string => String(phone ?? "").replace(/\D/g, "")
export const phoneUsable = (phone: string | null | undefined): boolean => phoneDigits(phone).length >= 9

/**
 * A Saudi mobile in the one shape the register stores: 05xxxxxxxx. Accepts
 * 05…, 5…, 9665…, +9665…, 009665…, with spaces, dashes or Arabic-Indic digits.
 * Null for anything that is not a Saudi mobile.
 */
export function normalizeSaudiMobile(raw: string | null | undefined): string | null {
  const ascii = String(raw ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
  let digits = ascii.replace(/[\s\-().]/g, "")
  if (digits.startsWith("+")) digits = digits.slice(1)
  else if (digits.startsWith("00")) digits = digits.slice(2)
  if (!/^\d+$/.test(digits)) return null
  if (digits.startsWith("966")) digits = digits.slice(3)
  if (digits.startsWith("0")) digits = digits.slice(1)
  return /^5\d{8}$/.test(digits) ? `0${digits}` : null
}

export type ReceiverProblem = "name" | "phone" | "title" | "role"

/** What is wrong with this entry, in the order a form should say it. An entry
 * that predates the role list may keep its free-text title until it is edited. */
export function receiverProblems(input: Partial<ReceiverInput>): ReceiverProblem[] {
  const out: ReceiverProblem[] = []
  if ((input.name || "").trim().length < 2) out.push("name")
  if (!phoneUsable(input.phone)) out.push("phone")
  if (!isReceiverRole(input.role) && !(input.title || "").trim()) out.push("title")
  return out
}

const receiverWriteSchema = z.object({
  name: z.string().trim().min(2),
  role: z.enum(RECEIVER_ROLES),
  module: z.enum(RECEIVER_MODULES as [ReceiverModule, ...ReceiverModule[]]),
  phone: z.string().transform((v, ctx) => {
    const n = normalizeSaudiMobile(v)
    if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "phone" })
    return n as string
  }),
  userId: z.string().nullish(),
  warehouseIds: z.array(z.string()).default([]),
})

/** The write path's check: a role from the list and a Saudi mobile, or the fields that fail. */
export function parseReceiverInput(input: Partial<ReceiverInput>): { ok: true; data: ReceiverInput } | { ok: false; fields: ReceiverProblem[] } {
  const parsed = receiverWriteSchema.safeParse(input)
  if (!parsed.success) {
    const keys = new Set(parsed.error.issues.map((i) => String(i.path[0])))
    const fields: ReceiverProblem[] = []
    if (keys.has("name")) fields.push("name")
    if (keys.has("phone")) fields.push("phone")
    if (keys.has("role")) fields.push("role")
    return { ok: false, fields: fields.length ? fields : ["name"] }
  }
  const d = parsed.data
  return { ok: true, data: cleanReceiver({ name: d.name, title: receiverRoleTitle(d.role), role: d.role, module: d.module, phone: d.phone, userId: d.userId ?? null, warehouseIds: d.warehouseIds }) }
}

/** The same person already in the register: the same mobile (however it was
 * typed) or the same account. Retired entries count — bring them back instead. */
export function findDuplicateReceiver(receivers: ProcReceiver[], input: Pick<ReceiverInput, "phone" | "userId">, exceptId?: string): ProcReceiver | null {
  const phone = normalizeSaudiMobile(input.phone) || ""
  return (
    receivers.find((r) => {
      if (r.id === exceptId) return false
      if (input.userId && r.userId === input.userId) return true
      return Boolean(phone) && (normalizeSaudiMobile(r.phone) || r.phone) === phone
    }) || null
  )
}

/** The entry as it is stored: trimmed, de-duplicated places. */
export function cleanReceiver(input: ReceiverInput): ReceiverInput {
  return {
    name: input.name.trim(),
    title: input.title.trim(),
    ...(input.role ? { role: input.role } : {}),
    module: input.module,
    phone: input.phone.trim(),
    userId: input.userId || null,
    warehouseIds: Array.from(new Set((input.warehouseIds || []).filter((id) => typeof id === "string" && id.trim()))).sort(),
  }
}

/** Does this receiver cover that place? An empty list means every place — a
 * relief keeper stands in wherever they are needed. */
export const receiverCovers = (r: Pick<ProcReceiver, "warehouseIds">, warehouseId: string | null | undefined): boolean =>
  !warehouseId || !(r.warehouseIds || []).length || (r.warehouseIds || []).includes(warehouseId)

export interface ReceiverChoice extends ProcReceiver {
  /** Named for this very place, rather than covering it by standing in everywhere. */
  atThisPlace: boolean
}

/**
 * The register as the forward dialog should offer it: the people named for this
 * place first, then everyone else who could stand in, each group by name.
 *
 * Nobody inactive, because a list that still offers last year's store keeper is
 * how a delivery ends up forwarded to a phone nobody answers.
 */
export function receiversForPlace(receivers: ProcReceiver[], warehouseId: string | null | undefined): ReceiverChoice[] {
  return receivers
    .filter((r) => r.active !== false && receiverCovers(r, warehouseId))
    .map((r) => ({ ...r, atThisPlace: Boolean(warehouseId) && (r.warehouseIds || []).includes(warehouseId as string) }))
    .sort((a, b) => Number(b.atThisPlace) - Number(a.atThisPlace) || a.name.localeCompare(b.name))
}

/** The one live receiver named for this place — null when nobody, or more than one, is.
 * Standing in everywhere does not count: a relief keeper is not the place's receiver. */
export function soleReceiverFor(receivers: ProcReceiver[], warehouseId: string | null | undefined): ProcReceiver | null {
  if (!warehouseId) return null
  const named = receivers.filter((r) => r.active !== false && (r.warehouseIds || []).includes(warehouseId))
  return named.length === 1 ? named[0] : null
}

/** The whole register for the settings screen: live entries first, then by name. */
export function receiverRows(receivers: ProcReceiver[]): ProcReceiver[] {
  return [...receivers].sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name))
}

/** Search across name, title and mobile — Arabic-folded, like every other box. */
export function receiverMatches(r: ProcReceiver, term: string): boolean {
  const q = foldSearchText(term)
  if (!q) return true
  const national = normalizeSaudiMobile(r.phone) || r.phone
  return foldSearchText(`${r.name} ${r.title}`).includes(q) || phoneDigits(national).includes(phoneDigits(term) || q)
}

// ---------------------------------------------------------------------------
// The forwarding window (§5.2-3b, policy `forwardWindowDays`)
// ---------------------------------------------------------------------------

export type ForwardUrgency = "none" | "due" | "overdue"

/**
 * Whether a notice still waiting to be forwarded needs chasing.
 *
 * The PRD auto-forwards once the window lapses: the daily job
 * (/api/cron/forward-notices, `./auto-forward`) forwards a notice still untold
 * to the register's suggested receiver and tags it `auto`. Until that runs,
 * and wherever no receiver can be resolved, the notice is a task with
 * somebody's name on it: inside the window it is due, past the delivery date
 * it is overdue.
 *
 * `daysToDelivery` is negative once the date has passed.
 */
export function forwardUrgency(daysToDelivery: number | null, windowDays: number): ForwardUrgency {
  if (daysToDelivery == null) return "none"
  if (daysToDelivery < 0) return "overdue"
  return daysToDelivery <= Math.max(0, windowDays) ? "due" : "none"
}

/** Who a still-open notice of this order was forwarded to — the latest forward — else null. */
export function forwardedReceiverOf(
  notices: Array<{ poId?: string | null; status?: string; closedByReceipt?: unknown; forwardedTo?: { name: string; at: string; userId?: string | null } | null }>,
  poId: string | null | undefined
): { name: string; userId: string | null } | null {
  if (!poId) return null
  const open = notices
    .filter((n) => n.poId === poId && n.status === "pending_confirmation" && !n.closedByReceipt && n.forwardedTo)
    .sort((a, b) => (b.forwardedTo?.at || "").localeCompare(a.forwardedTo?.at || ""))[0]
  return open?.forwardedTo ? { name: open.forwardedTo.name, userId: open.forwardedTo.userId ?? null } : null
}
