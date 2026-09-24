// Procurement's boundary events (PRD 3.0 §5.3) — one place for "who hears
// about a purchase order". A sibling of Manufacturing's `emitMfgEvent`, sharing
// its team loader and recipient resolution: recipients are named by ROLE
// (holders of `po.approve`, of `invoices.manage`, of `deliveries.confirm`), by
// uid, or "the owner", and the actor is never told of their own act.
//
// Every notification carries BOTH translation keys (`Portal.Shared.pn_po_*`,
// re-rendered in the reader's language by `notificationCopy`) AND text
// rendered by the sender — push and the mobile app read the text. When the
// caller passes no translator the text is rendered from the Arabic table
// below, which is the same copy as the message file. Money in this text is
// "ر.س"/"SAR", never the riyal glyph: push has no font.
//
// Notifying is best-effort and runs AFTER the business write: a lost
// notification never undoes the decision it reports.

import { collection, doc, setDoc, type Firestore } from "firebase/firestore"
import { displayDocNumber } from "../sales-numbering"
import { loadTeam, notificationCopy, resolveRecipients, type EventParams, type RecipientSpec, type Translator } from "../mfg-events"

export type ProcEventKind =
  | "po_awaiting_approval" // → approvers (po.approve holders, or the owner when routed to him)
  | "po_approved" // → preparer + Finance: a commitment
  | "po_expected_arrival" // → receivers: expect a delivery (no amount)
  | "po_returned" // → preparer
  | "po_sent" // → the registered supplier's user
  | "po_supplier_accepted" // → preparer + expediters
  | "po_date_updated" // → preparer + receivers
  | "po_reminder" // → the supplier's user
  | "po_receipt_recorded" // → preparer + Finance: accepted X of Y, invoicing ceiling
  | "po_rejects_decided" // → the supplier's user
  | "po_remainder_cancelled" // → the supplier's user + Finance
  | "po_closed" // → preparer
  | "po_cancelled" // → preparer, the supplier if it had reached him, Finance if it was a commitment
  | "po_rated" // → the supplier's user (when published)

export const PROC_EVENT_KINDS: ProcEventKind[] = [
  "po_awaiting_approval",
  "po_approved",
  "po_expected_arrival",
  "po_returned",
  "po_sent",
  "po_supplier_accepted",
  "po_date_updated",
  "po_reminder",
  "po_receipt_recorded",
  "po_rejects_decided",
  "po_remainder_cancelled",
  "po_closed",
  "po_cancelled",
  "po_rated",
]

/** Who is told: a role, named users, or the org owner. */
export type ProcRecipientSpec = RecipientSpec | { owner: true }

export interface ProcEvent {
  kind: ProcEventKind
  /** The buying organisation — its team is what roles resolve against. */
  organizationId: string
  to: ProcRecipientSpec[]
  /** Facts the message names. A string starting with "@" is itself a
   * `Portal.Shared` key, translated for the reader (`@pn_po_decision_replace`). */
  params?: EventParams
  poId: string
  rfqId?: string | null
  offerId?: string | null
  /** The supplier's user, when registered: he reads the supplier portal, so his
   * notification carries his org and the supplier-side link. */
  supplier?: { userId: string | null | undefined; orgId: string | null | undefined } | null
  /** Overrides the default contractor-side link. */
  link?: string | null
  /** The sender's translator (`Portal.Shared`); Arabic table when absent. */
  copy?: Translator | null
}

export const procEventTitleKey = (kind: ProcEventKind) => `pn_${kind}_title`
export const procEventMessageKey = (kind: ProcEventKind) => `pn_${kind}`

// ---------------------------------------------------------------------------
// Links — one spelling per destination (absolute: the reader's portal is known)
// ---------------------------------------------------------------------------

export const procLinks = {
  /** The orders list with the drawer open on this order. */
  order: (poId: string) => `/contractor/rfqs/orders?po=${poId}`,
  supplierOrder: (poId: string) => `/supplier/orders?po=${poId}`,
  /** The goods-received desk with this receipt open. */
  receipt: (deliveryId: string) => `/contractor/goods-received?delivery=${deliveryId}`,
}

// ---------------------------------------------------------------------------
// The Arabic copy — identical to messages/ar.json `Portal.Shared.pn_po_*`
// ---------------------------------------------------------------------------

/** Plain `{param}` substitution over the Arabic table (no ICU here on purpose:
 * this text is what push shows when the sender had no translator). */
export const PROC_EVENT_COPY_AR: Record<ProcEventKind, { title: string; message: string }> = {
  po_awaiting_approval: {
    title: "أمر شراء بانتظار اعتمادك",
    message: "أعدّ {actor} أمر الشراء {number} للمورد {supplier} بقيمة {amount} (بدون الضريبة) — {rfq}. راجعه واعتمده أو أعده.",
  },
  po_approved: {
    title: "اعتُمد أمر الشراء {number}",
    message: "اعتمد {actor} أمر الشراء {number} للمورد {supplier} بقيمة {amount} (بدون الضريبة). صار التزاماً على المالية، ويعود إلى المشتري لإرساله.",
  },
  po_expected_arrival: {
    title: "توريد متوقع — {number}",
    message: "اعتُمد أمر الشراء {number} من المورد {supplier} (عدد البنود: {lines}). توقّع وصول شحنة له، وسجّل الاستلام من بوابة الاستلام.",
  },
  po_returned: {
    title: "أُعيد أمر الشراء {number}",
    message: "أعاد {actor} أمر الشراء {number} دون اعتماد: {reason}. عدّله وأعد رفعه.",
  },
  po_sent: {
    title: "أمر شراء جديد {number}",
    message: "أرسلت {company} أمر الشراء {number}. افتحه في بوابتك، واقبله مع تاريخ التسليم الذي تلتزم به.",
  },
  po_supplier_accepted: {
    title: "قبل المورد أمر الشراء {number}",
    message: "قبل {supplier} أمر الشراء {number} والتزم بالتسليم في {date}.",
  },
  po_date_updated: {
    title: "تغيّر موعد التسليم — {number}",
    message: "موعد تسليم أمر الشراء {number} من المورد {supplier} صار {date}. {note}",
  },
  po_reminder: {
    title: "تذكير بأمر الشراء {number}",
    message: "تذكّرك {company} بأمر الشراء {number}: {ask}",
  },
  po_receipt_recorded: {
    title: "استلام مسجّل على {number}",
    message: "سجّل {actor} الاستلام {receipt} على أمر الشراء {number}: قُبل {accepted} من {ordered}. سقف الفوترة الآن: {ceiling}.",
  },
  po_rejects_decided: {
    title: "قرار في المرفوض — {number}",
    message: "قررت {company} في الكمية المرفوضة من «{line}» ({qty}) في أمر الشراء {number}: {decision}. {note}",
  },
  po_remainder_cancelled: {
    title: "أُلغي المتبقي — {number}",
    message: "ألغت {company} المتبقي من «{line}» ({qty} {unit}) في أمر الشراء {number}: {reason}. لن يصل، ويُخفَّض الالتزام بقدره.",
  },
  po_closed: {
    title: "أُغلق أمر الشراء {number}",
    message: "أغلق {actor} أمر الشراء {number} — {outcome}. {reason}",
  },
  po_cancelled: {
    title: "أُلغي أمر الشراء {number}",
    message: "ألغى {actor} أمر الشراء {number} للمورد {supplier}: {reason}.",
  },
  po_rated: {
    title: "تقييم على أمر الشراء {number}",
    message: "قيّمت {company} تنفيذك لأمر الشراء {number}: {stars} من 5 — ونُشر التقييم دون اسم على المنصة.",
  },
}

/** `@key` params the messages name, with their Arabic text. */
export const PROC_EVENT_PARAM_COPY_AR: Record<string, string> = {
  pn_po_decision_replace: "الاستبدال — أرسل بديلاً عن المرفوض",
  pn_po_decision_discount: "الخصم — نحتفظ بالكمية بسعر مخفّض",
  pn_po_decision_reduce: "تخفيض الأمر — لن تُستبدل الكمية",
  pn_po_closed_complete: "مكتمل",
  pn_po_closed_short_flag: "مغلق قبل اكتماله",
  pn_po_ceiling_unknown: "غير محدّد (أمر بمبلغ إجمالي)",
  pn_po_reminder_ask_accept: "لم يُقبل بعد — اقبله وحدّد موعد التسليم.",
  pn_po_reminder_ask_deliver: "التسليم مستحق — أخبرنا بموعد الوصول.",
}

const substitute = (template: string, params: EventParams) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k]
    if (v == null) return ""
    if (typeof v === "string" && v.startsWith("@")) return PROC_EVENT_PARAM_COPY_AR[v.slice(1)] ?? ""
    return String(v)
  })

/** The stored text: the sender's translator when given, else the Arabic table. */
export function renderProcCopy(kind: ProcEventKind, params: EventParams, copy?: Translator | null): { title: string; message: string } {
  const i18n = { title: procEventTitleKey(kind), message: procEventMessageKey(kind), params }
  if (copy && copy.has(i18n.title)) {
    try {
      return notificationCopy({ i18n }, copy)
    } catch (err) {
      console.warn(`proc event ${kind}: copy not rendered`, err)
    }
  }
  const ar = PROC_EVENT_COPY_AR[kind]
  // Arabic text shows Arabic document prefixes, as every screen does.
  const shown = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === "string" ? displayDocNumber(v, "ar") : v])) as EventParams
  return { title: substitute(ar.title, shown).trim(), message: substitute(ar.message, shown).replace(/\s+/g, " ").trim() }
}

/** "12,500 ر.س" / "SAR 12,500" — for notification text only (no glyph). */
export function sarText(amount: number | null | undefined, locale: "ar" | "en" = "ar"): string {
  if (amount == null || !Number.isFinite(amount)) return ""
  const figure = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount)
  return locale === "ar" ? `${figure} ر.س` : `SAR ${figure}`
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export interface ProcNotificationDoc {
  userId: string
  organizationId: string
  type: ProcEventKind
  title: string
  message: string
  i18n: { title: string; message: string; params: EventParams }
  link: string
  poId: string
  rfqId: string | null
  offerId: string | null
  actorId: string
  actorName: string
  read: false
  createdAt: string
}

export function buildProcNotification(e: ProcEvent, actor: { uid: string; name: string }, userId: string, nowIso: string): ProcNotificationDoc {
  const params: EventParams = { actor: actor.name, ...(e.params || {}) }
  const forSupplier = Boolean(e.supplier?.userId) && userId === e.supplier?.userId
  const text = renderProcCopy(e.kind, params, e.copy)
  return {
    userId,
    organizationId: forSupplier ? e.supplier?.orgId || e.organizationId : e.organizationId,
    type: e.kind,
    title: text.title,
    message: text.message,
    i18n: { title: procEventTitleKey(e.kind), message: procEventMessageKey(e.kind), params },
    link: forSupplier ? procLinks.supplierOrder(e.poId) : e.link || procLinks.order(e.poId),
    poId: e.poId,
    rfqId: e.rfqId ?? null,
    offerId: e.offerId ?? null,
    actorId: actor.uid,
    actorName: actor.name,
    read: false,
    createdAt: nowIso,
  }
}

// ---------------------------------------------------------------------------
// Recipients and emit
// ---------------------------------------------------------------------------

/**
 * The idempotency key (PRD 3.0 SS5.3): these things happen exactly ONCE for an
 * order, so the notification is written at a document id derived from the event
 * instead of a fresh one. A retry then addresses the same document, and because
 * the rules let any signed-in user CREATE a notification for someone else but
 * only its owner UPDATE one, the second write is refused rather than delivered
 * twice. The refusal is already swallowed and logged below.
 *
 * Everything else is deliberately absent: a second reminder, a new promised
 * date, the next receipt and a re-return after a resubmission are all real
 * events that must arrive, and keying them would silently drop the second one.
 */
const ONCE_PER_ORDER: ReadonlySet<ProcEventKind> = new Set<ProcEventKind>([
  "po_approved",
  "po_expected_arrival",
  "po_sent",
  "po_supplier_accepted",
  "po_remainder_cancelled",
  "po_closed",
  "po_cancelled",
  "po_rated",
])

/** `po_sent__<poId>`, or null when the event may legitimately repeat. A poId
 * that is not a plain document id (a slash would address a subcollection) falls
 * back to an id of its own rather than writing somewhere unintended. */
export function procEventKey(e: Pick<ProcEvent, "kind" | "poId">): string | null {
  if (!ONCE_PER_ORDER.has(e.kind)) return null
  const id = (e.poId || "").trim()
  if (!id || id.includes("/") || id.startsWith(".")) return null
  return `${e.kind}__${id}`
}

/** `{owner:true}` becomes the owner's uid; the rest is Manufacturing's resolver. */
export function toMfgSpecs(to: ProcRecipientSpec[], ownerId: string): RecipientSpec[] {
  return to.map((s) => ("owner" in s ? { users: [ownerId] } : s))
}

const onlyUsers = (to: ProcRecipientSpec[]) => to.every((s) => "users" in s)

/** Best-effort: resolves the recipients and writes their notifications;
 * returns how many were told. A supplier acting in his own portal cannot read
 * the buyer's team, so an event addressed to named users alone loads nothing. */
export async function emitProcEvent(firestore: Firestore, actor: { uid: string; name: string }, e: ProcEvent): Promise<number> {
  try {
    let recipients: string[]
    if (onlyUsers(e.to)) {
      recipients = resolveRecipients({ ownerId: e.organizationId, members: [], groups: [], departments: [] }, toMfgSpecs(e.to, e.organizationId), actor.uid)
    } else {
      const specs = toMfgSpecs(e.to, e.organizationId)
      const team = await loadTeam(firestore, e.organizationId, specs)
      recipients = resolveRecipients(team, specs, actor.uid)
    }
    const at = new Date().toISOString()
    const key = procEventKey(e)
    await Promise.all(
      recipients.map((uid) => {
        const box = collection(firestore, "users", uid, "notifications")
        return setDoc(key ? doc(box, key) : doc(box), buildProcNotification(e, actor, uid, at)).catch((err) =>
          console.warn("notification failed:", (err as { code?: string })?.code || err)
        )
      })
    )
    return recipients.length
  } catch (err) {
    console.warn(`proc event ${e.kind} not delivered:`, (err as { code?: string })?.code || err)
    return 0
  }
}
