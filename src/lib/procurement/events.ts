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
import { displayParam, loadTeam, notificationCopy, resolveRecipients, type EventParams, type RecipientSpec, type Translator } from "../mfg-events"

export type ProcEventKind =
  | "po_awaiting_approval" // → approvers (po.approve holders, or the owner when routed to him)
  | "po_approved" // → preparer + Finance: a commitment
  | "po_expected_arrival" // → receivers: expect a delivery (no amount)
  | "po_returned" // → preparer
  | "po_ready_to_send" // → preparer + expediters: approved, not sent by the portal — send it
  | "po_sent" // → the registered supplier's user and his company's owner
  | "po_supplier_accepted" // → preparer + expediters
  | "po_date_updated" // → preparer + receivers
  | "po_reminder" // → the supplier's user
  | "po_receipt_recorded" // → preparer + Finance: accepted X of Y, invoicing ceiling
  | "po_rejects_decided" // → the supplier's user
  | "po_remainder_cancelled" // → the supplier's user + Finance
  | "po_closed" // → preparer
  | "po_cancelled" // → preparer, the supplier if it had reached him, Finance if it was a commitment
  | "po_rated" // → the supplier's user (when published)
  | "po_hold_decided" // → Finance: Procurement answered a held invoice
  | "po_budget_referred" // → the project's managers + owner: an overrun waits for their decision
  | "po_budget_decided" // → preparer + approvers: Projects accepted the overrun or asked to renegotiate
  | "receipt_manual" // → Finance: goods recorded by hand (with or without an order)
  | "receipt_expensed" // → Finance: a no-PO receipt Procurement ruled a cash expense
  | "need_approved" // → buyers (rfq.manage / rfq.create) + owner: a project's material request was approved and is now Procurement's
  | "plant_requested" // → the equipment desk (warehouses.manage): a project's equipment request was approved and waits for an answer
  | "plant_answered" // → the requester: the equipment desk answered (allocated, busy until, an alternative, or none)
  | "activity_assigned" // → the assignee: someone planned a to-do for him
  | "activity_done" // → the one who planned it: the assignee marked it done
  | "doc_comment" // → the other company of a document: a shared comment was posted
  | "doc_file" // → the other company of a document: a shared attachment was added

export const PROC_EVENT_KINDS: ProcEventKind[] = [
  "po_awaiting_approval",
  "po_approved",
  "po_expected_arrival",
  "po_returned",
  "po_ready_to_send",
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
  "po_hold_decided",
  "po_budget_referred",
  "po_budget_decided",
  "receipt_manual",
  "receipt_expensed",
  "need_approved",
  "plant_requested",
  "plant_answered",
  "activity_assigned",
  "activity_done",
  "doc_comment",
  "doc_file",
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
  /** The order the event is about — absent for a need that has no order yet. */
  poId?: string | null
  rfqId?: string | null
  offerId?: string | null
  /** The supplier's user, when registered: he reads the supplier portal, so his
   * notification carries his org and the supplier-side link. His company's
   * owner (whose uid IS `orgId`) reads it the same way. */
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
  /** The needs desk (incoming requests). */
  needs: () => `/contractor/rfqs/requests`,
  /** Warehouses → the equipment desk (approved project equipment requests). */
  plantDesk: () => `/contractor/warehouses/equipment`,
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
    message: "اعتمد {actor} أمر الشراء {number} للمورد {supplier} بقيمة {amount} (بدون الضريبة). صار التزاماً على المالية.",
  },
  po_ready_to_send: {
    title: "أرسل أمر الشراء {number} للمورد",
    message: "اعتُمد أمر الشراء {number} للمورد {supplier}، ولم يصله عبر البوابة — أرسله له عبر واتساب أو البريد من شاشة الأوامر.",
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
  po_hold_decided: {
    title: "قرار المشتريات في فاتورة موقوفة — {number}",
    message: "قرّر {actor} في الفاتورة {invoice} على أمر الشراء {number}: {decision}. {note}",
  },
  po_budget_referred: {
    title: "أمر شراء يتجاوز موازنة البند — {number}",
    message: "أمر الشراء {number} من {supplier} لمشروع {project} يتجاوز موازنة البند بـ {over}. القرار لمدير المشروع: اقبل التجاوز أو اطلب إعادة التفاوض.",
  },
  po_budget_decided: {
    title: "قرار مدير المشروع في موازنة {number}",
    message: "{actor}: {decision} — أمر الشراء {number}. {note}",
  },
  receipt_manual: {
    title: "سند استلام يدوي — {receipt}",
    message: "سجّل {actor} استلاماً يدوياً {receipt} من {supplier}{order}. راجعه عند المطابقة والفوترة.",
  },
  receipt_expensed: {
    title: "استلام بلا أمر شراء صار مصروفاً نقدياً — {receipt}",
    message: "قرّر {actor} أن الاستلام {receipt} من {supplier} مصروف نقدي بلا أمر شراء. سجّل الفاتورة مصروفاً.",
  },
  need_approved: {
    title: "طلب مواد معتمد بانتظار المشتريات — ط.م {no}",
    message: "اعتمد {actor} طلب المواد ط.م {no} لمشروع {project} (عدد البنود: {count}). صار في الطلبات الواردة — راجع المخزون ثم ابدأ طلب تسعير أو أمر شراء.",
  },
  plant_requested: {
    title: "طلب معدات بانتظار مكتب المعدات — م.ع {no}",
    message: "اعتمد {actor} طلب المعدات «{what}» (الكمية {qty}) لمشروع {project} من {from} إلى {to}. صار على مكتب المعدات في المستودعات — أجب بتخصيص وحدة أو موعد توفر أو بديل أو بعدم التوفر.",
  },
  plant_answered: {
    title: "ردّ مكتب المعدات على طلبك — م.ع {no}",
    message: "ردّ {actor} على طلبك للمعدات «{what}» في مشروع {project}: {reply}",
  },
  activity_assigned: {
    title: "مهمة جديدة لك — {summary}",
    message: "كلّفك {actor} بمهمة «{summary}» ({type}) مستحقة في {due}. المستند المرتبط: {about}.",
  },
  activity_done: {
    title: "أُنجزت المهمة — {summary}",
    message: "أنجز {actor} المهمة «{summary}» التي خططت لها. المستند المرتبط: {about}.",
  },
  doc_comment: {
    title: "تعليق جديد على {about}",
    message: "كتب {actor} تعليقاً على {about}: «{text}»",
  },
  doc_file: {
    title: "مرفق جديد على {about}",
    message: "أرفق {actor} الملف «{text}» على {about}.",
  },
}

/** `@key` params the messages name, with their Arabic text. */
export const PROC_EVENT_PARAM_COPY_AR: Record<string, string> = {
  pn_activity_type_todo: "مهمة",
  pn_activity_type_call: "اتصال",
  pn_activity_type_meeting: "اجتماع",
  pn_activity_type_email: "بريد إلكتروني",
  pn_activity_type_document: "رفع مستند",
  pn_activity_about_none: "لا يوجد",
  pn_plant_reply_alloc: "خُصصت لك وحدة من أسطولنا",
  pn_plant_reply_late: "مشغولة حتى موعد التوفر",
  pn_plant_reply_alt: "عُرض عليك بديل",
  pn_plant_reply_none: "غير متوفرة في أسطولنا",
  pn_po_decision_replace: "الاستبدال — أرسل بديلاً عن المرفوض",
  pn_po_decision_discount: "الخصم — نحتفظ بالكمية بسعر مخفّض",
  pn_po_decision_reduce: "تخفيض الأمر — لن تُستبدل الكمية",
  pn_po_closed_complete: "مكتمل",
  pn_po_closed_short_flag: "مغلق قبل اكتماله",
  pn_po_ceiling_unknown: "غير محدّد (أمر بمبلغ إجمالي)",
  pn_po_reminder_ask_accept: "لم يُقبل بعد — اقبله وحدّد موعد التسليم.",
  pn_po_reminder_ask_deliver: "التسليم مستحق — أخبرنا بموعد الوصول.",
  pn_po_budget_accepted: "قبل تجاوز الموازنة — يمضي الأمر إلى اعتماده",
  pn_po_budget_renegotiate: "طلب إعادة التفاوض على السعر",
  pn_po_hold_po_price: "يلتزم بسعر الأمر — طلبنا فاتورة مصححة",
  pn_po_hold_credit: "طلبنا من المورد إشعاراً دائناً بالفرق",
  pn_po_hold_new_price: "اتُّفق على السعر الجديد — يُعدَّل الأمر",
  pn_po_hold_supply: "يُستكمل التوريد ثم تُفوتر",
  pn_po_hold_grn: "السند لم يُسجَّل بعد — نتابع المستلم",
  pn_po_hold_ack: "أبلغنا المالية أننا نتابع",
  pn_po_hold_newinv: "طلبنا فاتورة مصححة تحمل رقم الأمر والرقم الضريبي",
  pn_po_hold_cancel: "تُلغى الفاتورة ويُعيد المورد إصدارها على الأمر الصحيح",
  pn_po_hold_letter: "أرسلنا خطاباً بنكياً باسم المورد نفسه إلى المالية",
  pn_po_hold_fix: "صحّحنا سجل المورد عندنا وأبلغنا المالية",
  pn_po_hold_stop: "نوقف الدفع حتى يصحّح المورد حسابه",
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
  const shown = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === "string" ? displayParam(v, "ar") : v])) as EventParams
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
  poId: string | null
  rfqId: string | null
  offerId: string | null
  actorId: string
  actorName: string
  read: false
  createdAt: string
}

export function buildProcNotification(e: ProcEvent, actor: { uid: string; name: string }, userId: string, nowIso: string): ProcNotificationDoc {
  const params: EventParams = { actor: actor.name, ...(e.params || {}) }
  const forSupplier = Boolean(e.supplier?.userId) && (userId === e.supplier?.userId || userId === e.supplier?.orgId)
  const text = renderProcCopy(e.kind, params, e.copy)
  return {
    userId,
    organizationId: forSupplier ? e.supplier?.orgId || e.organizationId : e.organizationId,
    type: e.kind,
    title: text.title,
    message: text.message,
    i18n: { title: procEventTitleKey(e.kind), message: procEventMessageKey(e.kind), params },
    link: forSupplier && e.poId ? procLinks.supplierOrder(e.poId) : e.link || (e.poId ? procLinks.order(e.poId) : procLinks.needs()),
    poId: e.poId ?? null,
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
  "po_ready_to_send",
  "po_sent",
  "po_supplier_accepted",
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
