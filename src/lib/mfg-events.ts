// Manufacturing's boundary events — one place for every "who hears about it".
//
// PRD 1.2 lists what crosses the boundary (inbound and outbound contracts) and
// who is told (NT-01). Each screen that performs one of those acts — in
// Manufacturing, Inventory, Projects, Sales, Procurement or Finance — calls
// `emitMfgEvent` with the event and its facts; this module resolves the
// recipients from the team's roles (and a project's own members), and writes
// one notification each.
//
// A notification carries translation KEYS and params, not rendered text: the
// sender may work in Arabic and the storekeeper in English, and each reads it
// in their own language (see `notificationCopy`). A rendered fallback is stored
// too, for readers that don't know the keys. Notifying is best-effort: a
// missing notification never undoes the decision it reports.

import { addDoc, collection, doc, getDoc, getDocs, query, where, type Firestore } from "firebase/firestore"
import { ALL_PERMISSION, type PermissionId, type TeamGroup } from "./permissions"
import { isQcStation, normalizeMfgSettings, type DeptCapacityFields, type MfgSettings } from "./manufacturing-engine"

export type MfgEventKind =
  // Requests & cost statements (T1–T3, REQ-08)
  | "request_new"
  | "cost_request_new"
  | "request_answered"
  | "request_declined"
  | "costing_answered"
  | "cost_statement_sent"
  | "quote_status"
  | "request_moved_to_purchase"
  // Gates (T4–T9)
  | "down_payment_reported"
  | "down_payment_confirmed"
  | "order_released"
  | "survey_mismatch"
  | "drawing_submitted"
  | "drawing_result"
  | "slab_signed"
  // Materials (T10–T12, T22–T23)
  | "withdrawal_requested"
  | "materials_issued"
  | "purchase_requested"
  | "purchase_arrived"
  // Stations & quality (T13–T16)
  | "handover"
  | "awaiting_close"
  | "rejected"
  | "qc_decision"
  | "scrap_raised"
  | "scrap_approved"
  | "scrap_returned"
  | "scrap_resubmitted"
  | "scrap_claim_supplier"
  | "scrap_claim_client"
  | "remake"
  | "shortfall"
  // Delivery (T18–T19, T26)
  | "note_issued"
  | "note_received"
  | "note_breakage"
  | "remnants_returned"
  | "remnants_received"
  // Changes, capacity, blocks (T20–T25)
  | "change_requested"
  | "change_applied"
  | "order_cancelled"
  | "stop_delays"
  | "block_notice"
  | "block_quarantined"
  | "block_claim_raised"
  | "variance_reviewed"

/** Who is told. Station = its lead, Quality for QC & packing, else the manager. */
export type RecipientSpec =
  | { users: Array<string | null | undefined> }
  | { permission: PermissionId }
  /** Holders of the permission on that project (its members' groups) plus org-level holders. */
  | { projectPermission: PermissionId; projectId: string }
  | { station: string | null | undefined }

export type EventParams = Record<string, string | number | null | undefined>

export interface MfgEvent {
  kind: MfgEventKind
  /** The sender's translator (Portal.Shared): renders the stored title and
   * message that push notifications and the mobile app read. The web reader
   * re-renders from the keys in its own language. */
  copy: Translator
  organizationId: string
  actor: { id: string; name: string }
  to: RecipientSpec[]
  /** Facts the message names. A string starting with "@" is itself a key
   * (e.g. "@mfg4_defect_crack") and is translated for the reader. */
  params?: EventParams
  workOrderId?: string | null
  /** Portal-relative path ("manufacturing/workshop?order=…") — the reader's
   * portal prefix is added when it is opened. */
  link?: string | null
  /** Pass when the caller already holds them — saves a read. */
  departments?: DeptCapacityFields[]
  /** Rendered in the sender's language, for older readers. */
  fallback?: { title: string; message: string }
}

export type Translator = ((key: string, params?: Record<string, string | number>) => string) & { has: (key: string) => boolean }

export const eventTitleKey = (kind: MfgEventKind) => `mfn_${kind}_title`
export const eventMessageKey = (kind: MfgEventKind) => `mfn_${kind}`

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

export interface TeamSnapshot {
  ownerId: string
  members: Array<{ id: string; defaultGroupId?: string | null; organizationRole?: string | null }>
  groups: Array<Pick<TeamGroup, "id" | "permissions">>
  /** projectId → member uid → project group */
  projectMembers?: Map<string, Map<string, string | null>>
  departments: DeptCapacityFields[]
}

const grants = (groups: TeamSnapshot["groups"], groupId: string | null | undefined, permission: PermissionId) => {
  const g = groupId ? groups.find((x) => x.id === groupId) : undefined
  return !!g && (g.permissions.includes(ALL_PERMISSION) || g.permissions.includes(permission))
}

/** Org owner + members whose default group grants the permission. */
export function holdersOf(team: TeamSnapshot, permission: PermissionId): string[] {
  const out = new Set<string>()
  if (team.ownerId) out.add(team.ownerId)
  for (const m of team.members) {
    if (m.organizationRole === "owner" || grants(team.groups, m.defaultGroupId, permission)) out.add(m.id)
  }
  return Array.from(out)
}

/** Pure: the uids an event reaches (the actor is never told of their own act). */
export function resolveRecipients(team: TeamSnapshot, to: RecipientSpec[], actorId: string): string[] {
  const out = new Set<string>()
  for (const spec of to) {
    if ("users" in spec) spec.users.forEach((u) => u && out.add(u))
    else if ("permission" in spec) holdersOf(team, spec.permission).forEach((u) => out.add(u))
    else if ("projectPermission" in spec) {
      holdersOf(team, spec.projectPermission).forEach((u) => out.add(u))
      const members = team.projectMembers?.get(spec.projectId)
      members?.forEach((groupId, uid) => {
        if (grants(team.groups, groupId, spec.projectPermission)) out.add(uid)
      })
    } else if ("station" in spec) {
      const d = team.departments.find((x) => x.id === spec.station)
      if (!d) continue
      if (isQcStation(d)) holdersOf(team, "manufacturing.qc").forEach((u) => out.add(u))
      else if (d.leadUserId) out.add(d.leadUserId)
      else holdersOf(team, "manufacturing.manage").forEach((u) => out.add(u))
    }
  }
  out.delete(actorId)
  return Array.from(out)
}

export async function loadTeam(firestore: Firestore, organizationId: string, to: RecipientSpec[], departments?: DeptCapacityFields[]): Promise<TeamSnapshot> {
  const needsDepartments = !departments && to.some((s) => "station" in s)
  const projectIds = Array.from(new Set(to.flatMap((s) => ("projectPermission" in s ? [s.projectId] : []))))
  const [users, groups, depts, projectMembers] = await Promise.all([
    getDocs(query(collection(firestore, "users"), where("organizationId", "==", organizationId))),
    getDocs(query(collection(firestore, "teamGroups"), where("organizationId", "==", organizationId))),
    needsDepartments
      ? getDocs(query(collection(firestore, "manufacturingDepartments"), where("organizationId", "==", organizationId))).then((q) =>
          q.docs.map((d) => ({ ...(d.data() as DeptCapacityFields), id: d.id }))
        )
      : Promise.resolve(departments || []),
    Promise.all(
      projectIds.map(async (pid) => {
        const snap = await getDocs(collection(firestore, "projects", pid, "members")).catch(() => null)
        const map = new Map<string, string | null>()
        snap?.docs.forEach((d) => map.set(d.id, (d.data().groupId as string | null) ?? null))
        return [pid, map] as const
      })
    ),
  ])
  return {
    ownerId: organizationId,
    members: users.docs.map((d) => ({ id: d.id, defaultGroupId: (d.data().defaultGroupId as string | null) ?? null, organizationRole: (d.data().organizationRole as string | null) ?? null })),
    groups: groups.docs.map((d) => ({ id: d.id, permissions: (d.data().permissions as TeamGroup["permissions"]) || [] })),
    departments: depts,
    projectMembers: new Map(projectMembers),
  }
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

export interface MfgNotificationDoc {
  userId: string
  organizationId: string
  type: string
  title: string
  message: string
  i18n: { title: string; message: string; params: EventParams }
  workOrderId: string | null
  link: string | null
  actorId: string
  actorName: string
  read: false
  createdAt: string
}

export function buildNotification(e: Omit<MfgEvent, "copy"> & { copy?: Translator }, userId: string, nowIso: string): MfgNotificationDoc {
  const i18n = { title: eventTitleKey(e.kind), message: eventMessageKey(e.kind), params: { actor: e.actor.name, ...(e.params || {}) } }
  let text = e.fallback ?? { title: "", message: "" }
  if (!e.fallback && e.copy) {
    try {
      text = notificationCopy({ i18n }, e.copy)
    } catch (err) {
      console.warn(`mfg event ${e.kind}: copy not rendered`, err)
    }
  }
  return {
    userId,
    organizationId: e.organizationId,
    type: `mfg_${e.kind}`,
    title: text.title,
    message: text.message,
    i18n,
    workOrderId: e.workOrderId ?? null,
    link: e.link ?? null,
    actorId: e.actor.id,
    actorName: e.actor.name,
    read: false,
    createdAt: nowIso,
  }
}

/** A new request names its number and the answer window; the module that
 * raised it only holds the request id, so both are read here. */
async function withRequestFacts(firestore: Firestore, e: MfgEvent): Promise<MfgEvent> {
  const p = e.params || {}
  if ((e.kind !== "request_new" && e.kind !== "cost_request_new") || typeof p.requestId !== "string") return e
  const { requestId, ...rest } = p
  const [request, settings] = await Promise.all([
    rest.number == null ? getDoc(doc(firestore, "manufacturingRequests", requestId)).catch(() => null) : Promise.resolve(null),
    rest.hours == null ? getDoc(doc(firestore, "manufacturingSettings", e.organizationId)).catch(() => null) : Promise.resolve(null),
  ])
  return {
    ...e,
    params: {
      ...rest,
      number: rest.number ?? ((request?.data()?.requestNumber as string | undefined) || ""),
      hours: rest.hours ?? normalizeMfgSettings(settings?.data() as Partial<MfgSettings> | undefined).answerWindowHours,
    },
  }
}

/** Best-effort: resolves the recipients and writes their notifications. */
export async function emitMfgEvent(firestore: Firestore, e: MfgEvent): Promise<number> {
  try {
    const [team, filled] = await Promise.all([loadTeam(firestore, e.organizationId, e.to, e.departments), withRequestFacts(firestore, e)])
    const recipients = resolveRecipients(team, e.to, e.actor.id)
    const at = new Date().toISOString()
    await Promise.all(
      recipients.map((uid) =>
        addDoc(collection(firestore, "users", uid, "notifications"), buildNotification(filled, uid, at)).catch((err) => console.warn("notification failed:", err?.code || err))
      )
    )
    return recipients.length
  } catch (err) {
    console.warn(`mfg event ${e.kind} not delivered:`, (err as { code?: string })?.code || err)
    return 0
  }
}

/** finance.down_payment.confirmed — the workshop hears that the client's
 * orders on this sales order may be released (the gate itself reads the
 * sales order, so this only tells). Silent when nothing is being made. */
export async function emitDownPaymentConfirmed(
  firestore: Firestore,
  input: {
    organizationId: string
    salesOrderId: string
    salesOrderNumber: number | string
    /** The quotation the sales order was born of — its work orders that name
     * no sales order are this order's too (see `belongsToSalesOrder`). */
    quotationId?: string | null
    actor: { id: string; name: string }
    copy: Translator
  }
): Promise<number> {
  try {
    const orders = collection(firestore, "workOrders")
    const org = where("organizationId", "==", input.organizationId)
    const [named, quoted] = await Promise.all([
      getDocs(query(orders, org, where("salesOrderId", "==", input.salesOrderId))),
      input.quotationId ? getDocs(query(orders, org, where("source.quotationId", "==", input.quotationId))) : null,
    ])
    type Row = { id: string; docNumber?: string | null; orderNumber?: number | null; status?: string | null; salesOrderId?: string | null }
    const byId = new Map<string, Row>()
    for (const d of named.docs) byId.set(d.id, { id: d.id, ...(d.data() as Omit<Row, "id">) })
    // A quote-born order that names another sales order is that one's, not ours.
    for (const d of quoted?.docs || []) if (!(d.data() as Row).salesOrderId) byId.set(d.id, { id: d.id, ...(d.data() as Omit<Row, "id">) })
    const live = Array.from(byId.values()).filter((o) => o.status !== "done" && o.status !== "cancelled")
    if (!live.length) return 0
    const only = live.length === 1 ? live[0] : null
    return emitMfgEvent(firestore, {
      kind: "down_payment_confirmed",
      copy: input.copy,
      organizationId: input.organizationId,
      actor: input.actor,
      to: [{ permission: "manufacturing.manage" }],
      params: { order: input.salesOrderNumber, orders: live.map((o) => o.docNumber || `#${o.orderNumber ?? ""}`).join(" · ") },
      workOrderId: only?.id ?? null,
      link: only ? mfgLinks.order(only.id) : mfgLinks.workshop(),
    })
  } catch (err) {
    console.warn("down payment event not delivered:", (err as { code?: string })?.code || err)
    return 0
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The notification in the reader's language when it carries keys; else its stored text. */
export function notificationCopy(n: { title?: string; message?: string; i18n?: { title?: string; message?: string; params?: EventParams } | null }, t: Translator): { title: string; message: string } {
  const i = n.i18n
  if (i?.title && t.has(i.title)) {
    const params: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(i.params || {})) {
      if (v == null) params[k] = ""
      else if (typeof v === "string" && v.startsWith("@") && t.has(v.slice(1))) params[k] = t(v.slice(1))
      else params[k] = v
    }
    const title = t(i.title, params)
    const message = i.message && t.has(i.message) ? t(i.message, params) : n.message || ""
    return { title, message }
  }
  return { title: n.title || "", message: n.message || "" }
}

/** Where opening a notification goes: absolute paths as they are, portal-relative ones under the reader's portal. */
export function notificationHref(link: string | null | undefined, basePath: string): string | null {
  if (!link) return null
  if (link.startsWith("/")) return link
  return `/${basePath}/${link}`
}

// ---------------------------------------------------------------------------
// Links — one spelling per destination
// ---------------------------------------------------------------------------

export const mfgLinks = {
  order: (orderId: string) => `manufacturing/workshop?order=${orderId}`,
  workshop: () => "manufacturing/workshop",
  request: (requestId: string) => `manufacturing/requests?open=${requestId}`,
  estimates: () => "manufacturing/requests?seg=estimates",
  today: () => "manufacturing",
  inventoryDesk: () => "warehouses/manufacturing",
  deliveryNotes: () => "warehouses/delivery-notes",
  project: (projectId: string) => `projects/${projectId}?tab=mfg`,
  salesOrder: (orderId: string) => `sales/orders?open=${orderId}`,
  /** The Sales orders page — its workshop inbox lists what waits on Sales,
   * including a client order that names no sales order. */
  salesOrders: () => "sales/orders",
  salesQuotations: () => "sales/quotations",
  salesPayments: () => "sales/payments",
  procurement: () => "rfqs",
}
