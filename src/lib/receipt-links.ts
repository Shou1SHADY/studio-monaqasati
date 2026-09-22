// Server-only — the receipt link (22 Sep review). Never import in client components.
//
// Procurement buys from the office; the goods are received on a site or in a
// store by someone else — often someone with no account. So Procurement
// forwards the delivery: to a team member, or to a name and mobile number. The
// system makes a single-use link; the receiver opens it, counts what arrived
// (blind — the notified quantity is never shown), marks what was rejected,
// signs, and confirms with a code texted to that mobile. The signed count lands
// on the delivery, and Procurement books the receipt from it — stock, the books
// and the GR number stay on the one tested path, `recordReceipt`.
//
// What this answers is "who actually received it": a receipt signed by a
// verified phone, not a name someone typed in the office.

import { randomBytes } from "node:crypto"
import { z } from "zod"
import type { Firestore } from "firebase-admin/firestore"
import { can as resolveCan, type PermissionId, type TeamGroup } from "@/lib/permissions"
import { linesForReceipt } from "@/lib/procurement/receipts"
import { REJECT_REASON_CODES } from "@/lib/procurement/po"
import { PURCHASE_ORDERS, type DeliveryLine, type PurchaseOrder } from "@/lib/procurement/types"
import { maskPhone } from "@/lib/otp"
import { normalizePhoneE164 } from "@/lib/sms"

export const RECEIPT_LINKS = "receiptLinks"
/** Long enough for a delivery that arrives a day late; short enough that a
 * link found in a chat next month opens nothing. */
export const LINK_TTL_MS = 3 * 24 * 60 * 60 * 1000
/** A drawn signature as a PNG data URL — a few KB in practice. */
const MAX_SIGNATURE_CHARS = 200_000

export type LinkStatus = "open" | "signed" | "revoked"

export interface Receiver {
  kind: "user" | "person"
  userId: string | null
  name: string
  /** E.164 — where the code goes. Never returned to a browser whole. */
  phone: string
}

export interface ReceiptLink {
  token: string
  deliveryId: string
  organizationId: string
  receiver: Receiver
  status: LinkStatus
  createdById: string
  createdByName: string
  createdAt: string
  expiresAt: string
  signedAt?: string | null
}

export interface ReceiverReportLine {
  poLineId: string
  name: string
  unit: string
  counted: number
  rejected: number
  rejectReason: string | null
  note: string | null
}

/** What lands on the delivery when the receiver signs. */
export interface ReceiverReport {
  linkId: string
  receiverName: string
  receiverUserId: string | null
  phoneMasked: string
  lines: ReceiverReportLine[]
  note: string | null
  signatureData: string | null
  signedAt: string
  verifiedBy: "sms_code"
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const createBody = z.object({
  deliveryId: z.string().min(1).max(128),
  receiver: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("user"), userId: z.string().min(1).max(128), phone: z.string().max(30).optional() }),
    z.object({ kind: z.literal("person"), name: z.string().trim().min(2).max(120), phone: z.string().min(5).max(30) }),
  ]),
})

export const signBody = z.object({
  challengeId: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
  receiverName: z.string().trim().min(2).max(120),
  lines: z
    .array(
      z.object({
        poLineId: z.string().min(1).max(128),
        counted: z.number().finite().min(0).max(1e9),
        rejected: z.number().finite().min(0).max(1e9),
        rejectReason: z.enum(REJECT_REASON_CODES).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      })
    )
    .max(500),
  note: z.string().trim().max(1000).nullable().optional(),
  signatureData: z
    .string()
    .max(MAX_SIGNATURE_CHARS)
    .refine((s) => s.startsWith("data:image/png;base64,"), "signature must be a PNG")
    .nullable()
    .optional(),
})
export type SignInput = z.infer<typeof signBody>

export type ReportError = "unknown_line" | "missing_line" | "rejected_over_counted" | "reject_needs_reason" | "nothing_counted"

/**
 * Check a receiver's count against the delivery's own lines — pure, and the
 * part the tests read. Every line must be answered exactly once (a line left
 * out would read as "nothing arrived"), rejected can never exceed counted, and
 * a rejection names its reason, as the office's receiving form requires.
 */
export function buildReport(
  input: Pick<SignInput, "lines">,
  base: DeliveryLine[]
): { ok: true; lines: ReceiverReportLine[] } | { ok: false; error: ReportError; poLineId?: string } {
  const byId = new Map(base.map((l) => [l.poLineId, l]))
  const seen = new Set<string>()
  const lines: ReceiverReportLine[] = []
  for (const row of input.lines) {
    const line = byId.get(row.poLineId)
    if (!line || seen.has(row.poLineId)) return { ok: false, error: "unknown_line", poLineId: row.poLineId }
    seen.add(row.poLineId)
    if (row.rejected > row.counted) return { ok: false, error: "rejected_over_counted", poLineId: row.poLineId }
    if (row.rejected > 0 && !row.rejectReason) return { ok: false, error: "reject_needs_reason", poLineId: row.poLineId }
    lines.push({
      poLineId: row.poLineId,
      name: line.name,
      unit: line.unit,
      counted: row.counted,
      rejected: row.rejected,
      rejectReason: row.rejected > 0 ? row.rejectReason ?? null : null,
      note: row.note?.trim() || null,
    })
  }
  const missing = base.find((l) => !seen.has(l.poLineId))
  if (missing) return { ok: false, error: "missing_line", poLineId: missing.poLineId }
  if (!lines.some((l) => l.counted > 0)) return { ok: false, error: "nothing_counted" }
  return { ok: true, lines }
}

/** Why a link opens nothing — or null when it is usable. */
export function linkRefusal(link: Pick<ReceiptLink, "status" | "expiresAt"> | null, now: number): "missing" | "revoked" | "signed" | "expired" | null {
  if (!link) return "missing"
  if (link.status === "revoked") return "revoked"
  if (link.status === "signed") return "signed"
  if (now > new Date(link.expiresAt).getTime()) return "expired"
  return null
}

export const newToken = () => randomBytes(32).toString("hex")
export const isToken = (s: string) => /^[a-f0-9]{64}$/.test(s)

// ---------------------------------------------------------------------------
// The caller, on the server
// ---------------------------------------------------------------------------

export interface Caller {
  uid: string
  name: string
  orgId: string
  can: (permission: PermissionId) => boolean
}

/** The signed-in caller's organisation and permissions, resolved the way the
 * security rules resolve them — a profile with no `organizationRole` field is
 * a legacy owner. */
export async function callerOf(db: Firestore, uid: string): Promise<Caller | null> {
  const profile = (await db.collection("users").doc(uid).get()).data() as Record<string, unknown> | undefined
  if (!profile) return null
  const orgId = (profile.organizationId as string) || uid
  const role = !("organizationRole" in profile) ? "owner" : ((profile.organizationRole as string | null) || null)
  const groupsSnap = await db.collection("teamGroups").where("organizationId", "==", orgId).get()
  const groups = groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamGroup)
  const ctx = { organizationRole: role, defaultGroupId: (profile.defaultGroupId as string | null) || null, groups }
  return {
    uid,
    name: (profile.name as string) || (profile.email as string) || "",
    orgId,
    can: (permission) => resolveCan(permission, ctx),
  }
}

/** The delivery's lines, with the ids the office's receiving form uses. */
export async function deliveryLines(db: Firestore, delivery: Record<string, unknown>): Promise<DeliveryLine[]> {
  let po: PurchaseOrder | null = null
  if (typeof delivery.poId === "string" && delivery.poId) {
    const snap = await db.collection(PURCHASE_ORDERS).doc(delivery.poId).get()
    if (snap.exists) po = { id: snap.id, ...(snap.data() as Omit<PurchaseOrder, "id">) }
  }
  return linesForReceipt(delivery as Parameters<typeof linesForReceipt>[0], po)
}

/** The receiver as the link stores them — the phone normalised, or null when
 * it cannot be (a code has to reach it). */
export function receiverFrom(
  input: z.infer<typeof createBody>["receiver"],
  user: { name?: string; email?: string; phone?: string } | null
): Receiver | null {
  if (input.kind === "person") {
    const phone = normalizePhoneE164(input.phone)
    return phone ? { kind: "person", userId: null, name: input.name.trim(), phone } : null
  }
  if (!user) return null
  const phone = normalizePhoneE164(input.phone || user.phone)
  if (!phone) return null
  return { kind: "user", userId: input.userId, name: user.name || user.email || "", phone }
}

/** A link by its token — the same shape of answer the guest-offer links give. */
export async function resolveReceiptLink(
  db: Firestore,
  token: string,
  now = Date.now()
): Promise<
  | { ok: true; linkId: string; link: ReceiptLink; delivery: Record<string, unknown> }
  | { ok: false; code: "INVALID_TOKEN" | "NOT_FOUND" | "LINK_REVOKED" | "LINK_SIGNED" | "LINK_EXPIRED"; status: number }
> {
  if (!isToken(token)) return { ok: false, code: "INVALID_TOKEN", status: 400 }
  const snap = await db.collection(RECEIPT_LINKS).where("token", "==", token).limit(1).get()
  const doc = snap.docs[0]
  const link = doc ? (doc.data() as ReceiptLink) : null
  const refusal = linkRefusal(link, now)
  if (refusal === "missing") return { ok: false, code: "NOT_FOUND", status: 404 }
  if (refusal === "revoked") return { ok: false, code: "LINK_REVOKED", status: 410 }
  if (refusal === "signed") return { ok: false, code: "LINK_SIGNED", status: 410 }
  if (refusal === "expired") return { ok: false, code: "LINK_EXPIRED", status: 410 }
  const delivery = (await db.collection("deliveries").doc(link!.deliveryId).get()).data()
  if (!delivery || delivery.status === "confirmed") return { ok: false, code: "LINK_SIGNED", status: 410 }
  return { ok: true, linkId: doc.id, link: link!, delivery }
}

export { maskPhone }
