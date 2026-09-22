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

import { foldSearchText } from "../search-text"

export const PROCUREMENT_RECEIVERS = "procurementReceivers"

/** Which module the person belongs to — theirs is the desk the goods reach. */
export type ReceiverModule = "inventory" | "projects"
export const RECEIVER_MODULES: ReceiverModule[] = ["inventory", "projects"]

export interface ProcReceiver {
  id: string
  organizationId: string
  name: string
  /** "Central store keeper", "Al-Narjes site engineer" — what to call them on a list. */
  title: string
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
  module: ReceiverModule
  phone: string
  userId?: string | null
  warehouseIds: string[]
}

/** A mobile has to be dialable: digits, and enough of them. Everything else —
 * spaces, dashes, a leading +966 or 0 — is how people write them. */
export const phoneDigits = (phone: string | null | undefined): string => String(phone ?? "").replace(/\D/g, "")
export const phoneUsable = (phone: string | null | undefined): boolean => phoneDigits(phone).length >= 9

export type ReceiverProblem = "name" | "phone" | "title"

/** What is wrong with this entry, in the order a form should say it. */
export function receiverProblems(input: Partial<ReceiverInput>): ReceiverProblem[] {
  const out: ReceiverProblem[] = []
  if ((input.name || "").trim().length < 2) out.push("name")
  if (!phoneUsable(input.phone)) out.push("phone")
  if (!(input.title || "").trim()) out.push("title")
  return out
}

/** The entry as it is stored: trimmed, de-duplicated places. */
export function cleanReceiver(input: ReceiverInput): ReceiverInput {
  return {
    name: input.name.trim(),
    title: input.title.trim(),
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

/** The whole register for the settings screen: live entries first, then by name. */
export function receiverRows(receivers: ProcReceiver[]): ProcReceiver[] {
  return [...receivers].sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name))
}

/** Search across name, title and mobile — Arabic-folded, like every other box. */
export function receiverMatches(r: ProcReceiver, term: string): boolean {
  const q = foldSearchText(term)
  if (!q) return true
  return foldSearchText(`${r.name} ${r.title}`).includes(q) || phoneDigits(r.phone).includes(phoneDigits(term) || q)
}

// ---------------------------------------------------------------------------
// The forwarding window (§5.2-3b, policy `forwardWindowDays`)
// ---------------------------------------------------------------------------

export type ForwardUrgency = "none" | "due" | "overdue"

/**
 * Whether a notice still waiting to be forwarded needs chasing.
 *
 * The PRD auto-forwards once the window lapses. Nothing in this product runs on
 * a schedule — there is no job, no cron and no queue — so an "automatic" forward
 * would be a function nobody calls. What we can do honestly is stop the notice
 * being forgotten: inside the window it is due, past the delivery date it is
 * overdue, and either way it is a task with somebody's name on it.
 *
 * `daysToDelivery` is negative once the date has passed.
 */
export function forwardUrgency(daysToDelivery: number | null, windowDays: number): ForwardUrgency {
  if (daysToDelivery == null) return "none"
  if (daysToDelivery < 0) return "overdue"
  return daysToDelivery <= Math.max(0, windowDays) ? "due" : "none"
}
