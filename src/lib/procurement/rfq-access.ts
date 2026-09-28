// Who runs an RFQ — ONE predicate for the list, the card, the RFQ page and
// every RFQ write (the prototype's `CAN('src') && !CAN('ro') && rfqMine(r)`).
//
// Prototype role → permission ids (seeded groups are not changed):
//   manager (mgr)  → po.approve (usually + offers.accept) — runs every RFQ, closes early
//   buyer          → offers.accept, or rfq.manage / rfq.create without po.approve — runs HIS OWN RFQs
//   expediter      → po.expedite only — never runs an RFQ
//   owner          → runs while the org has no procurement staff; with staff he reads (`ro`)
// Awarding prepares purchase orders, so it also needs offers.accept (or the
// owner): an rfq.manage-only member (seeded supply_chain) runs the round but
// leaves the award to whoever may prepare orders. Pure: no I/O.

import { can as resolveCan, type TeamGroup } from "../permissions"
import type { ProcActor } from "./types"

export interface RfqRunner extends Pick<ProcActor, "uid" | "isOwner" | "canPrepare" | "canApprove"> {
  /** `rfq.manage` or `rfq.create` — the seeded supply-chain group runs RFQs
   * without offers.accept (the same sourcing set as `tab-gates.ts`). */
  managesRfqs?: boolean
  /** The org has procurement staff: the owner reads RFQs, he does not run them. */
  ownerHasTeam?: boolean
}

/** What every RFQ write takes: the procurement actor plus the two RFQ facts. */
export type RfqWriteActor = ProcActor & Pick<RfqRunner, "managesRfqs" | "ownerHasTeam">

export const RFQ_RUN_PERMISSIONS = ["offers.accept", "po.approve", "rfq.manage", "rfq.create"] as const

export function runsRfqs(a: RfqRunner): boolean {
  if (a.isOwner) return !a.ownerHasTeam
  return a.canPrepare || a.canApprove || Boolean(a.managesRfqs)
}

export const ownerReadsRfqs = (a: Pick<RfqRunner, "isOwner" | "ownerHasTeam">): boolean => a.isOwner && Boolean(a.ownerHasTeam)

/** A buyer runs RFQs and never approves — he acts on the ones he raised. */
export const isRfqBuyer = (a: Pick<RfqRunner, "isOwner" | "canApprove">): boolean => !a.isOwner && !a.canApprove

export interface RfqAuthorLike {
  createdByUserId?: string | null
  contractorId?: string | null
}

export function rfqMine(rfq: RfqAuthorLike, a: RfqRunner): boolean {
  if (!isRfqBuyer(a)) return true
  return (rfq.createdByUserId || rfq.contractorId || "") === a.uid
}

/** Publish, extend, share, cancel, exclude, answer, record an offer, ask the round. */
export const actsOnRfq = (rfq: RfqAuthorLike, a: RfqRunner): boolean => runsRfqs(a) && rfqMine(rfq, a)

/** The award prepares purchase orders: offers.accept or the owner. */
export const awardsOnRfq = (rfq: RfqAuthorLike, a: RfqRunner): boolean => actsOnRfq(rfq, a) && (a.isOwner || a.canPrepare)

/** «أغلِق الآن وافتح الأسعار» — the manager's (po.approve) or the solo owner's. */
export const closesRfqEarly = (rfq: RfqAuthorLike, a: RfqRunner): boolean => actsOnRfq(rfq, a) && (a.isOwner || a.canApprove)

export interface MemberLike {
  id: string
  organizationRole?: string | null
  defaultGroupId?: string | null
}

/** Procurement staff other than the owner — the same test as `team.ts`
 * (`procTeam().ownerHasTeam`, what `useRfqRunner` reads): anyone who sources
 * (offers.accept, rfq.manage) or approves (po.approve). */
export function hasProcurementStaff(members: MemberLike[], groups: TeamGroup[], orgId: string): boolean {
  return members.some((m) => {
    if (m.id === orgId || m.organizationRole === "owner") return false
    const ctx = { organizationRole: m.organizationRole ?? null, defaultGroupId: m.defaultGroupId || null, groups }
    return resolveCan("offers.accept", ctx) || resolveCan("rfq.manage", ctx) || resolveCan("po.approve", ctx)
  })
}
