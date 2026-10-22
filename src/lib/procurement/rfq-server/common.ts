// What the RFQ routes (`/api/procurement/rfq/*`) share: the caller as an RFQ runner, the refusal that carries its status, the
// RFQ's invitees and bidders, and the one notice writer. An RFQ's own acts are Admin-SDK transactions that re-read the RFQ —
// the ruleset has no room for another client-writable branch (BUILD-COMMON), and a stale screen is refused, never half-applied.

import type { Firestore } from "firebase-admin/firestore"
import type { PermissionId } from "@/lib/permissions"
import { actsOnRfq, type RfqAuthorLike, type RfqRunner } from "../rfq-access"

export interface RfqCaller {
  uid: string
  name: string
  orgId: string
  can: (permission: PermissionId) => boolean
}

export type RfqRefusalCode =
  | "no_permission"
  | "rfq_missing"
  | "rfq_not_open"
  | "date_invalid"
  | "reason_required"
  | "title_invalid"
  | "rows_missing"
  | "city_missing"
  | "recipients_missing"
  | "direct_supplier_missing"
  | "direct_blocked"
  | "terms_invalid"
  | "not_yours"
  | "nothing_to_remind"

const STATUS: Record<RfqRefusalCode, number> = {
  no_permission: 403,
  not_yours: 403,
  rfq_missing: 404,
  rfq_not_open: 409,
  date_invalid: 400,
  reason_required: 422,
  title_invalid: 422,
  rows_missing: 422,
  city_missing: 422,
  recipients_missing: 422,
  direct_supplier_missing: 422,
  direct_blocked: 409,
  terms_invalid: 422,
  nothing_to_remind: 409,
}

export class RfqError extends Error {
  readonly status: number
  constructor(
    readonly code: RfqRefusalCode,
    readonly params: Record<string, string | number> = {}
  ) {
    super(code)
    this.name = "RfqError"
    this.status = STATUS[code]
  }
}

export type Rec = Record<string, unknown>
export const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

export const runnerOf = (c: RfqCaller): RfqRunner => ({
  uid: c.uid,
  isOwner: c.uid === c.orgId,
  canPrepare: c.can("offers.accept"),
  canApprove: c.can("po.approve"),
  managesRfqs: c.can("rfq.manage") || c.can("rfq.create"),
})

/** Whoever runs RFQs, on an RFQ of his company that is his to run (a buyer: the ones he raised). */
export function mayRun(c: RfqCaller, rfq: RfqAuthorLike & { organizationId?: string | null }): boolean {
  const org = str(rfq.organizationId) || str(rfq.contractorId)
  return org === c.orgId && actsOnRfq(rfq, runnerOf(c))
}

/** Who may publish: whoever sources (offers.accept, rfq.manage, rfq.create) or approves — the owner always. */
export function mayPublish(c: RfqCaller): boolean {
  const r = runnerOf(c)
  return r.isOwner || r.canPrepare || r.canApprove || Boolean(r.managesRfqs)
}

export const invitedOrgIds = (rfq: Rec): string[] =>
  [...new Set([...(Array.isArray(rfq.allowedSupplierOrgIds) ? (rfq.allowedSupplierOrgIds as unknown[]) : []), ...(Array.isArray(rfq.invitedSupplierOrgIds) ? (rfq.invitedSupplierOrgIds as unknown[]) : [])].map(str).filter(Boolean))]

/** The registered bidders' users and companies (a guest has no inbox; a company's owner uid IS its org id). */
export function bidderUsers(offers: Rec[]): string[] {
  const out = new Set<string>()
  for (const o of offers) {
    if (o.isGuestOffer === true) continue
    for (const id of [str(o.supplierId), str(o.organizationId), str(o.supplierOrgId)]) if (id && id !== "guest" && id !== "mdmak-system") out.add(id)
  }
  return [...out]
}

export interface RfqNotice {
  /** `rfq_extended` · `rfq_reopened` · `rfq_cancelled` · `rfq_remind` — also the `Portal.Shared.pn_*` key. */
  kind: "rfq_extended" | "rfq_reopened" | "rfq_cancelled" | "rfq_remind"
  title: string
  message: string
  params: Record<string, string | number>
}

/** One notification per user, at an id derived from the act so a retry overwrites instead of repeating. Best-effort. */
export async function tellUsers(db: Firestore, caller: RfqCaller, rfq: { id: string; title?: string }, users: string[], notice: RfqNotice, version: number, at: string): Promise<number> {
  const targets = [...new Set(users.filter((u) => u && u !== caller.uid && u !== "guest"))]
  await Promise.all(
    targets.map((uid) =>
      db
        .collection("users")
        .doc(uid)
        .collection("notifications")
        .doc(`${notice.kind}__${rfq.id}__V${version}`)
        .set({
          userId: uid,
          organizationId: uid,
          type: notice.kind,
          title: notice.title,
          message: notice.message,
          i18n: { title: `pn_${notice.kind}_title`, message: `pn_${notice.kind}`, params: notice.params },
          link: `/supplier/rfqs?rfq=${rfq.id}`,
          rfqId: rfq.id,
          rfqTitle: rfq.title || "",
          actorId: caller.uid,
          actorName: caller.name,
          read: false,
          createdAt: at,
        })
        .catch((err: unknown) => console.warn("rfq notice failed:", (err as { code?: string })?.code || err))
    )
  )
  return targets.length
}

/** Arabic text of the notices (the sender's words when no translator is at hand); the keys are `Portal.Shared.pn_rfq_*`. */
export const RFQ_NOTICE_AR: Record<RfqNotice["kind"], { title: string; message: string }> = {
  rfq_extended: { title: "{contractor} — مُدّد موعد الطلب {rfq}", message: "مُدّد موعد تقديم العروض إلى {date}. من قدّم عرضاً يستطيع تعديله حتى الموعد الجديد." },
  rfq_reopened: { title: "{contractor} — أُعيد فتح الطلب {rfq}", message: "أُعيد فتح الطلب حتى {date}. يستطيع من قدّم عرضاً تعديله، ويستطيع المدعوّون التقديم." },
  rfq_cancelled: { title: "{contractor} — أُلغي الطلب {rfq}", message: "أُلغي الطلب دون ترسية{reason}." },
  rfq_remind: { title: "{contractor} — تذكير بالطلب {rfq}", message: "لم تقدّم عرضك بعد. تُغلق العروض {date}." },
}

export const fill = (template: string, params: Record<string, string | number>): string => template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""))
