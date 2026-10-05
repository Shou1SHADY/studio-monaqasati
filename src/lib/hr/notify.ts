// HR 1.0 — who is told what (PRD "Notifications", TD-05). ONE helper for the
// module, a sibling of Procurement's `emitProcEvent` sharing Manufacturing's
// team loader and recipient resolution: recipients are named by HR ROLE (read
// from each member's DEFAULT group, as access.ts reads it — the owner is HR
// manager and management, and holds every role here), by Finance or
// Inventory, or by uid; the actor is never told of his own act, nor is the
// person a decision is about when he must not decide it (`except`).
//
// Every notification carries the translation keys (`Portal.Shared.pn_hr_*`,
// re-rendered in each reader's language by the bell) AND text rendered by the
// sender for push and the mobile app — from the sender's translator when
// given, else from the Arabic table below, which is the Arabic message copy (a
// test holds them equal). NO amount ever travels in an HR notification — not
// to the employee, not to anyone (RL-03): push has no font for the riyal
// glyph, and a notification is read on a lock screen.
//
// Notifying is best-effort and runs AFTER the business write: a lost
// notification never undoes the act it reports. An event that happens once
// for its subject is written at a fixed id (`once`), so a retry addresses the
// same document — the rules let anyone CREATE a notification for another user
// and only its owner update it, so the second write is refused, not delivered.

import { collection, doc, setDoc, type Firestore } from "firebase/firestore"
import { displayParam, loadTeam, notificationCopy, resolveRecipients, type EventParams, type RecipientSpec, type Translator } from "../mfg-events"
import { HR_ROLE_PERMISSION, type HrRole } from "./access"
import { docState } from "./documents"
import type { HrEmployee } from "./employee"
import { UNASSIGNED_SITE, type HrSite } from "./sites"

export const HR_NOTICE_KINDS = [
  // Requests (WF-07, WF-08)
  "hr_request_filed", // → whoever decides: the HR manager, management for the HR manager's own
  "hr_leave_to_endorse", // → the line manager / site supervisor
  "hr_request_decided", // → the employee, and the filer when someone else filed it
  "hr_advance_to_finance", // → Finance: an advance above HR's limit
  "hr_exit_reentry", // → government relations: an approved leave abroad needs the exit re-entry visa
  // Violations and penalties (WF-09)
  "hr_violation_recorded", // → the HR manager (decides after a hearing) and the employee
  "hr_penalty_applied", // → the employee, with the 15-day objection window and its last day
  "hr_penalty_dismissed", // → the employee
  "hr_objection_filed", // → the HR manager
  "hr_objection_decided", // → the employee
  // Letters (WF-24)
  "hr_letter_filed", // → its signer
  "hr_letter_issued", // → the employee
  "hr_letter_declined", // → the employee
  // Payroll (WF-06) and the returned transfer (PY-03)
  "hr_payroll_prepared", // → HR managers who may approve (never the preparer)
  "hr_payroll_approved", // → Finance: to post and pay
  "hr_payslip_ready", // → each paid employee
  "hr_transfer_returned", // → the employee
  "hr_iban_to_fix", // → payroll
  "hr_iban_to_approve", // → the HR manager (never the hand that fixed it)
  "hr_iban_approved", // → Finance: the held line may be paid
  // End of service (WF-16)
  "hr_custody_requested", // → Inventory
  "hr_exit_started", // → government relations (platform tasks follow)
  "hr_custody_cleared", // → the HR manager: the settlement can be prepared
  "hr_settlement_approved", // → Finance
  "hr_settlement_paid", // → government relations: the final exit
  // Workplaces (WF-12, WF-13)
  "hr_manpower_requested", // → the HR manager
  "hr_manpower_answered", // → whoever asked
  "hr_assign_fix_raised", // → the HR manager
  "hr_assign_fix_decided", // → the supervisor who raised it
  // Documents and injuries (WF-14, WF-15, DC-05)
  "hr_injury_recorded", // → government relations: GOSI report in 3 working days
  "hr_iqama_clock", // → government relations: a visa arrival's iqama within 90 days
  "hr_iqama_on_site", // → government relations: an expired iqama on a site
  // People (AS-01, EM-05)
  "hr_assigned_to_project", // → the project's manager: someone comes onto his site, and from when
  "hr_probation_view", // → the HR manager: the line manager's view before the probation decision
] as const
export type HrNoticeKind = (typeof HR_NOTICE_KINDS)[number]

export const hrNoticeTitleKey = (kind: HrNoticeKind) => `pn_${kind}_title`
export const hrNoticeMessageKey = (kind: HrNoticeKind) => `pn_${kind}`

/** Who is told: an HR role (from the default group), Finance (owner · invoices.manage · accounting.post),
 * Inventory (warehouses.manage), named users, or the org owner. A supervisor is named by uid — his
 * role is scoped to his sites, so "every supervisor" is never an audience. */
export type HrRecipient = RecipientSpec | { owner: true } | { hr: Exclude<HrRole, "supervisor"> } | { finance: true } | { inventory: true }

export interface HrNotice {
  kind: HrNoticeKind
  organizationId: string
  to: HrRecipient[]
  /** Facts the message names — never an amount. A string starting with "@" is a `Portal.Shared`
   * key translated for the reader ("@hr_req_kind.leave"). */
  params?: EventParams
  /** Portal-relative ("hr/me", "accounting/hr-desk") — the reader's portal is put in front when opened. */
  link: string
  /** A different link for named users: the employee opens My file where staff open his record. */
  links?: Record<string, string>
  /** Never told, beyond the actor (the employee a decision is about, on his own request). */
  except?: Array<string | null | undefined>
  /** The subject of an event that happens once for it — the notification is written at `${kind}__${once}`. */
  once?: string | null
  employeeId?: string | null
  /** The sender's translator (`Portal.Shared`); the Arabic table when absent. */
  copy?: Translator | null
}

// ---------------------------------------------------------------------------
// The Arabic copy — identical to messages/ar.json `Portal.Shared.pn_hr_*`
// ---------------------------------------------------------------------------

export const HR_NOTICE_COPY_AR: Record<HrNoticeKind, { title: string; message: string }> = {
  hr_request_filed: { title: "طلب بانتظار قرارك — {no}", message: "{req} من {name} ({no}). راجعه وقرّر فيه من «اليوم» في الموارد البشرية." },
  hr_leave_to_endorse: { title: "طلب إجازة بانتظار توصيتك — {no}", message: "طلب {name} إجازة من {from} إلى {to}. أوصِ بها قبل أن يقرّر مدير الموارد البشرية." },
  hr_request_decided: { title: "قرار في الطلب {no}", message: "{req} {no}: {verdict}. {note}" },
  hr_advance_to_finance: { title: "سلفة فوق الحد بانتظار المالية — {no}", message: "أحال {actor} طلب سلفة {name} ({no}) لأنه فوق حد الموارد البشرية. قرّر فيه من مكتب الموارد البشرية في المحاسبة." },
  hr_exit_reentry: { title: "خروج وعودة — {name}", message: "اعتُمدت إجازة {name} ويبدأ سفره في {from}. أصدر تأشيرة الخروج والعودة قبل السفر." },
  hr_violation_recorded: { title: "مخالفة مسجّلة — {name}", message: "سجّل {actor} مخالفة على {name} بتاريخ {on}. يقرّر فيها مدير الموارد البشرية بعد جلسة استماع." },
  hr_penalty_applied: { title: "جزاء عليك — مخالفة {on}", message: "قرّر {actor} جزاءً على مخالفة {on}. لك الاعتراض خلال 15 يوماً، حتى {until}، من «ملفي»." },
  hr_penalty_dismissed: { title: "حُفظت المخالفة — {on}", message: "قرّر {actor} حفظ مخالفة {on} دون جزاء." },
  hr_objection_filed: { title: "اعتراض على جزاء — {name}", message: "اعترض {name} على جزاء مخالفة {on}. الجزاء موقوف حتى تقرّر: تأييد أو إلغاء." },
  hr_objection_decided: { title: "قرار في اعتراضك — مخالفة {on}", message: "{verdict}. {note}" },
  hr_letter_filed: { title: "طلب خطاب بانتظار توقيعك — {name}", message: "{letter} لـ{name}. راجعه ووقّعه، أو ارفضه بسبب." },
  hr_letter_issued: { title: "صدر خطابك", message: "{letter} — {serial}" },
  hr_letter_declined: { title: "رُفض طلب خطابك", message: "{letter} — {reason}" },
  hr_payroll_prepared: { title: "مسير {month} بانتظار اعتمادك", message: "أعدّ {actor} مسير {month}. راجع السطور واعتمده — لا يعتمده من أعدّه." },
  hr_payroll_approved: { title: "مسير {month} معتمد — للقيد والصرف", message: "اعتمد {actor} مسير {month}. قيّده واصرفه من مكتب الموارد البشرية في المحاسبة." },
  hr_payslip_ready: { title: "قسيمة راتبك جاهزة — {month}", message: "صُرف راتب {month}. افتح القسيمة وسبب كل خصم من «ملفي»." },
  hr_transfer_returned: { title: "أعاد البنك حوالة راتبك — {month}", message: "أعاد البنك حوالة {month}. يصحّح محاسب الرواتب الآيبان ثم تُصرف من جديد — وإن تغيّر حسابك فحدّثه من «ملفي»." },
  hr_iban_to_fix: { title: "حوالة مرتجعة — {name}", message: "أعاد البنك حوالة {name} من مسير {month}: {reason}. صحّح الآيبان ليعتمده مدير الموارد البشرية." },
  hr_iban_to_approve: { title: "آيبان مصحّح بانتظار اعتمادك — {name}", message: "صحّح {actor} آيبان {name}. اعتمده لتصرف المالية السطر الموقوف — لا يعتمده من صحّحه." },
  hr_iban_approved: { title: "آيبان معتمد — {name}", message: "اعتمد {actor} آيبان {name}. اصرف سطره الموقوف من مكتب الموارد البشرية في المحاسبة." },
  hr_custody_requested: { title: "إخلاء عهدة مطلوب — {name}", message: "بدأ {actor} إنهاء خدمة {name}، وآخر يوم {lastDay}. أخلِ عهدته وسجّل قيمة أي نقص — لا مخالصة قبل الإخلاء." },
  hr_exit_started: { title: "إنهاء خدمة — {name}", message: "بدأ {actor} إنهاء خدمة {name}، وآخر يوم {lastDay}. بعد المخالصة: استبعاد التأمينات، التأمين الطبي، الخروج النهائي." },
  hr_custody_cleared: { title: "أُخليت عهدة {name} — أعدّ المخالصة", message: "أخلى {actor} عهدة {name}. المخالصة صارت ممكنة." },
  hr_settlement_approved: { title: "مخالصة معتمدة — {name}", message: "اعتمد {actor} المخالصة النهائية لـ{name} (آخر يوم {lastDay}). اصرفها من مكتب الموارد البشرية في المحاسبة." },
  hr_settlement_paid: { title: "صُرفت مخالصة {name} — الخروج النهائي", message: "صرفت المالية مخالصة {name}. سجّل الخروج النهائي واستبعاده من التأمينات." },
  hr_manpower_requested: { title: "طلب عمالة — {project}", message: "طلب {actor} {count} عاملاً لمشروع {project} من {from}. أجب بخطة التغطية من أماكن العمل." },
  hr_manpower_answered: { title: "أُجيب طلب العمالة — {project}", message: "أجاب {actor} على طلب العمالة لمشروع {project} بخطة التغطية. راجعها في فريق المشروع." },
  hr_assign_fix_raised: { title: "تصحيح إسناد — {name}", message: "{actor}: {name} يعمل في {site} منذ {since} وليس على قائمته. صحّح الإسناد أو ارفضه بسبب." },
  hr_assign_fix_decided: { title: "قرار في تصحيح الإسناد — {name}", message: "{name} — {site}: {verdict}. {note}" },
  hr_injury_recorded: { title: "إصابة عمل — {name}", message: "سجّل {actor} إصابة عمل لـ{name} بتاريخ {on}. بلاغ التأمينات خلال 3 أيام عمل — المهلة تنتهي {due}." },
  hr_iqama_clock: { title: "إصدار الإقامة خلال 90 يوماً — {name}", message: "وصل {name} بتأشيرة وباشر في {join}. أصدر إقامته قبل {date}." },
  hr_iqama_on_site: { title: "إقامة منتهية على الموقع — {name}", message: "إقامة {name} منتهية منذ {expiry} وهو على {site}. جدّدها — لا عمل على موقع بإقامة منتهية." },
  hr_assigned_to_project: { title: "إسناد إلى موقعك — {name}", message: "أسند {actor} {name} إلى {site} من {on}. مركز التكلفة يتبع الإسناد من تاريخه." },
  hr_probation_view: { title: "رأي المدير المباشر في التجربة — {name}", message: "أوصى {actor}: {recommend}. تنتهي تجربة {name} في {end} — القرار لك." },
}

/** `@key` params the messages name, with their Arabic text (nested keys of Portal.Shared). */
export const HR_NOTICE_PARAM_COPY_AR: Record<string, string> = {
  "hr_req_kind.leave": "طلب إجازة",
  "hr_req_kind.advance": "طلب سلفة",
  "hr_req_kind.data": "طلب تحديث بيانات",
  "hr_req_kind.raise": "طلب تعديل أجر",
  "hr_probation_rec.confirm": "التثبيت",
  "hr_probation_rec.extend": "التمديد",
  "hr_probation_rec.end": "الإنهاء",
  "hr_verdict.approved": "اعتُمد",
  "hr_verdict.declined": "رُفض",
  "hr_verdict.upheld": "أُيّد الجزاء ويُخصم في مسيره",
  "hr_verdict.cancelled": "أُلغي الجزاء ولا يُحتسب",
  "hr_verdict.done": "صُحّح الإسناد",
  "hr_verdict.refused": "رُفض التصحيح",
  "hr_letter_kind.sal": "تعريف بالراتب",
  "hr_letter_kind.emb": "تعريف للسفارة",
  "hr_letter_kind.noc": "عدم ممانعة",
  "hr_letter_kind.oth": "خطاب آخر",
  "hr_letter_kind.exp": "شهادة خبرة",
}

/** HR's own document numbers in Arabic (ط.إ / ط.سل / ط.ص / خ) — the shared prefix table is Sales'. */
const hrNumberAr = (v: string) => v.replace(/^LV-(?=\d{4}\/)/, "ط.إ-").replace(/^AV-(?=\d{4}\/)/, "ط.سل-").replace(/^HQ-(?=\d{4}\/)/, "ط.ص-").replace(/^RS-(?=\d{4}\/)/, "ط.ز-").replace(/^LT-(?=\d{4}\/)/, "خ-")

const substitute = (template: string, params: EventParams) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k]
    if (v == null) return ""
    if (typeof v === "string" && v.startsWith("@")) return HR_NOTICE_PARAM_COPY_AR[v.slice(1)] ?? ""
    return String(v)
  })

/** The stored text: the sender's translator when given, else the Arabic table. */
export function renderHrNotice(kind: HrNoticeKind, params: EventParams, copy?: Translator | null): { title: string; message: string } {
  const i18n = { title: hrNoticeTitleKey(kind), message: hrNoticeMessageKey(kind), params }
  if (copy && copy.has(i18n.title)) {
    try {
      return notificationCopy({ i18n }, copy)
    } catch (err) {
      console.warn(`hr notice ${kind}: copy not rendered`, err)
    }
  }
  const ar = HR_NOTICE_COPY_AR[kind]
  const shown = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === "string" && !v.startsWith("@") ? hrNumberAr(displayParam(v, "ar")) : v])) as EventParams
  const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/\s*\.\s*$/, ".").replace(/\.\.$/, ".").trim()
  return { title: substitute(ar.title, shown).trim(), message: tidy(substitute(ar.message, shown)) }
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export interface HrNotificationDoc {
  userId: string
  organizationId: string
  type: HrNoticeKind
  title: string
  message: string
  i18n: { title: string; message: string; params: EventParams }
  link: string
  employeeId: string | null
  actorId: string
  actorName: string
  read: false
  createdAt: string
}

export function buildHrNotification(e: HrNotice, actor: { uid: string; name: string | null }, userId: string, nowIso: string): HrNotificationDoc {
  const params: EventParams = { actor: actor.name ?? "", ...(e.params || {}) }
  const text = renderHrNotice(e.kind, params, e.copy)
  return {
    userId,
    organizationId: e.organizationId,
    type: e.kind,
    title: text.title,
    message: text.message,
    i18n: { title: hrNoticeTitleKey(e.kind), message: hrNoticeMessageKey(e.kind), params },
    link: e.links?.[userId] ?? e.link,
    employeeId: e.employeeId ?? null,
    actorId: actor.uid,
    actorName: actor.name ?? "",
    read: false,
    createdAt: nowIso,
  }
}

// ---------------------------------------------------------------------------
// Recipients and emit
// ---------------------------------------------------------------------------

/** HR's audiences in Manufacturing's resolver terms. */
export function toRecipientSpecs(to: HrRecipient[], ownerId: string): RecipientSpec[] {
  return to.flatMap((s): RecipientSpec[] => {
    if ("owner" in s) return [{ users: [ownerId] }]
    if ("hr" in s) return [{ permission: HR_ROLE_PERMISSION[s.hr] as Extract<RecipientSpec, { permission: unknown }>["permission"] }]
    if ("finance" in s) return [{ permission: "invoices.manage" }, { permission: "accounting.post" }]
    if ("inventory" in s) return [{ permission: "warehouses.manage" }]
    return [s]
  })
}

/** `hr_payslip_ready__<payrollId>` — or null when the event may repeat, or the subject is not a plain id. */
export function hrNoticeKey(e: Pick<HrNotice, "kind" | "once">): string | null {
  const id = (e.once || "").trim()
  if (!id || id.includes("/") || id.startsWith(".")) return null
  return `${e.kind}__${id}`
}

/** Best-effort: resolves the recipients and writes their notifications; returns how many were told. */
export async function emitHrNotice(firestore: Firestore, actor: { uid: string; name: string | null }, e: HrNotice): Promise<number> {
  try {
    const specs = toRecipientSpecs(e.to, e.organizationId)
    const team = specs.every((s) => "users" in s) ? { ownerId: e.organizationId, members: [], groups: [], departments: [] } : await loadTeam(firestore, e.organizationId, specs)
    const except = new Set((e.except ?? []).filter(Boolean) as string[])
    const recipients = resolveRecipients(team, specs, actor.uid).filter((u) => !except.has(u))
    const at = new Date().toISOString()
    const key = hrNoticeKey(e)
    await Promise.all(
      recipients.map((uid) => {
        const box = collection(firestore, "users", uid, "notifications")
        return setDoc(key ? doc(box, key) : doc(box), buildHrNotification(e, actor, uid, at)).catch((err) => console.warn("notification failed:", (err as { code?: string })?.code || err))
      })
    )
    return recipients.length
  } catch (err) {
    console.warn(`hr notice ${e.kind} not delivered:`, (err as { code?: string })?.code || err)
    return 0
  }
}

/** Several notices for one act, each best-effort. */
export async function emitHrNotices(firestore: Firestore, actor: { uid: string; name: string | null }, notices: Array<HrNotice | null | false | undefined>): Promise<void> {
  for (const n of notices) if (n) await emitHrNotice(firestore, actor, n)
}

// ---------------------------------------------------------------------------
// Links — one spelling per destination (portal-relative)
// ---------------------------------------------------------------------------

export const hrLinks = {
  today: () => "hr",
  me: () => "hr/me",
  person: (employeeId: string) => `hr/people/${employeeId}`,
  site: (siteId: string) => `hr/sites/${siteId}`,
  sites: () => "hr/sites",
  payroll: () => "hr/payroll",
  financeDesk: () => "accounting/hr-desk",
  custody: () => "warehouses/custody",
  /** Projects live in the contractor portal only. */
  projectTeam: (projectId: string) => `/contractor/projects/${projectId}?tab=team`,
}

// ---------------------------------------------------------------------------
// An expired iqama on a site (PRD "Notifications": → government relations)
// ---------------------------------------------------------------------------

/** One notice per person on a site whose iqama has expired — once per iqama (its expiry is in the key), so a
 * renewal that lapses again is told again and the same lapse never twice. Today already lists them; this is the
 * bell for the officer who is not looking. Pure. */
export function iqamaOnSiteNotices(
  orgId: string,
  employees: ReadonlyArray<Pick<HrEmployee, "id" | "names" | "nationality" | "docs" | "siteId" | "status">>,
  sites: ReadonlyArray<Pick<HrSite, "id" | "name">>,
  today: string
): HrNotice[] {
  const out: HrNotice[] = []
  for (const e of employees) {
    const expiry = e.docs?.iqama
    if (e.status === "left" || e.nationality === "sa" || !e.siteId || e.siteId === UNASSIGNED_SITE || !expiry || docState(expiry, today) !== "expired") continue
    out.push({
      kind: "hr_iqama_on_site",
      organizationId: orgId,
      to: [{ hr: "gov" }],
      params: { name: e.names?.ar ?? "", expiry, site: sites.find((s) => s.id === e.siteId)?.name ?? "" },
      link: hrLinks.person(e.id),
      once: `${e.id}_${expiry}`,
      employeeId: e.id,
    })
  }
  return out
}
