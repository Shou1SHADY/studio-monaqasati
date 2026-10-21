import type { WorkQueueItem, WorkQueueItemType } from "@/hooks/useWorkQueue"
import { bucketOf, type Activity, type ActivityBucket, type ActivityCounts, type ActivityGroups } from "@/lib/activities"
import { riyadhDay } from "@/lib/hr/format"
import type { OptionalModule } from "@/lib/company-modules"
import type { PermissionId } from "@/lib/permissions"
import { CONTRACTOR_COMPONENTS, type PortalComponentDef, type PortalComponentId } from "@/lib/portal-components"

export const QUEUE_ITEM_TILE: Record<WorkQueueItemType, PortalComponentId> = {
  guarantee_expiring: "payments",
  rfq_decision: "procurement",
  rfq_closing_soon: "procurement",
  rfq_no_offers: "procurement",
  delivery_confirm: "procurement",
  delivery_to_count: "procurement",
  team_request_mine: "procurement",
  project_waiting_approval: "project-management",
  low_stock: "warehouses",
  team_invite_pending: "users",
  sales_deposits_to_confirm: "sales",
  mfg_materials_to_issue: "warehouses",
  mfg_requests_unanswered: "manufacturing",
  mfg_drawing_results_due: "project-management",
  mfg_client_drawings_due: "sales",
  mfg_notes_to_receive: "warehouses",
  mfg_custody_to_receive: "project-management",
  mfg_purchase_requests: "procurement",
  po_approve: "procurement",
  po_attention: "procurement",
}

const DEADLINE_TYPES: ReadonlySet<WorkQueueItemType> = new Set<WorkQueueItemType>(["rfq_closing_soon", "guarantee_expiring"])

export const queueItemPermissions = (can: (permission: PermissionId) => boolean): Record<WorkQueueItemType, boolean> => ({
  guarantee_expiring: can("offers.accept") || can("invoices.manage"),
  rfq_decision: can("offers.view") || can("rfq.manage"),
  rfq_closing_soon: can("rfq.manage") || can("rfq.create"),
  rfq_no_offers: can("rfq.manage") || can("rfq.create"),
  delivery_confirm: can("deliveries.confirm") || can("po.expedite") || can("offers.accept") || can("po.approve"),
  // Forwarded to this very person: his to count, whatever his permissions.
  delivery_to_count: true,
  // His own request: whatever his permissions.
  team_request_mine: true,
  project_waiting_approval: can("projects.edit") || can("projects.publish"),
  low_stock: can("warehouses.manage"),
  team_invite_pending: can("team.manage"),
  sales_deposits_to_confirm: can("invoices.manage") || can("sales.approve"),
  mfg_materials_to_issue: can("warehouses.manage"),
  mfg_requests_unanswered: can("manufacturing.manage"),
  mfg_drawing_results_due: can("projects.edit"),
  mfg_client_drawings_due: can("sales.manage"),
  mfg_notes_to_receive: can("warehouses.receive") || can("warehouses.manage"),
  mfg_custody_to_receive: can("projects.edit"),
  mfg_purchase_requests: can("rfq.manage") || can("rfq.create"),
  po_approve: can("po.approve"),
  po_attention: can("po.expedite") || can("offers.accept") || can("po.approve"),
})

export interface QueueModules {
  on: (id: OptionalModule) => boolean
  linkable: (href: string) => boolean
}

/** What the company switched off leaves the queue: its own decisions, anything that only opens one of its pages, and a tender link into Projects becomes the core RFQ page. */
export function liveQueueItems(items: WorkQueueItem[], modules: QueueModules): WorkQueueItem[] {
  const toTender = (url: string) => (modules.on("project-management") ? url : url.replace(/^\/contractor\/projects\/[^/]+\/tenders\/([^/?]+)\/offers/, "/contractor/rfqs/$1/offers"))
  return items.map((item) => ({ ...item, actionUrl: toTender(item.actionUrl) })).filter((item) => (modules.on("manufacturing") || !item.type.startsWith("mfg_")) && modules.linkable(item.actionUrl))
}

/** A value of a title: text, a number, or the key of a message that fills it. */
export type QueueTaskParam = string | number | { key: string }
export type QueueTranslate = (key: string, values?: Record<string, string | number>) => string

const text = (v: unknown) => (typeof v === "string" ? v : "")
const num = (v: unknown) => (typeof v === "number" ? v : 0)

/** The same sentence the home page prints for the item, as a message key and its values. */
export function queueTitle(item: WorkQueueItem): { key: string; params: Record<string, QueueTaskParam> } {
  const d = item.data
  const rfqTitle: QueueTaskParam = text(d.rfqTitle) || { key: "rfq_not_set" }
  switch (item.type) {
    case "guarantee_expiring":
      return d.isExpired
        ? { key: "queue_item_guarantee_expired", params: { itemName: text(d.itemName), days: Math.abs(num(d.daysLeft)) } }
        : { key: "queue_item_guarantee_expiring", params: { itemName: text(d.itemName), days: num(d.daysLeft) } }
    case "rfq_decision":
      return { key: "queue_item_rfq_decision", params: { rfqTitle, count: num(d.offerCount) } }
    case "rfq_closing_soon":
      return d.isOverdue ? { key: "queue_item_rfq_deadline_passed", params: { rfqTitle } } : { key: "queue_item_rfq_closing_soon", params: { rfqTitle, hours: num(d.hoursLeft) } }
    case "rfq_no_offers":
      return { key: "queue_item_rfq_no_offers", params: { rfqTitle, days: num(d.daysOpen) } }
    case "delivery_confirm":
      return text(d.forwardedTo)
        ? { key: "queue_item_delivery_with_receiver", params: { supplierName: text(d.supplierName) || { key: "queue_generic_supplier" }, receiver: text(d.forwardedTo) } }
        : { key: "queue_item_delivery_confirm", params: { supplierName: text(d.supplierName) || { key: "queue_generic_supplier" } } }
    case "delivery_to_count":
      return { key: "queue_item_delivery_to_count", params: { supplierName: text(d.supplierName) || { key: "queue_generic_supplier" }, by: text(d.byName) } }
    case "team_request_mine":
      return { key: "queue_item_team_request_mine", params: { number: text(d.number), state: { key: `queue_team_state_${text(d.state) || "sent"}` } } }
    case "project_waiting_approval":
      return { key: "queue_item_project_waiting_approval", params: { name: text(d.projectName), status: { key: text(d.statusLabelKey) } } }
    case "low_stock":
      return { key: "queue_item_low_stock", params: { itemName: text(d.itemName), warehouseName: text(d.warehouseName) } }
    case "team_invite_pending":
      return { key: "queue_item_team_invite_pending", params: { email: text(d.email) } }
    case "mfg_drawing_results_due":
    case "mfg_custody_to_receive":
      return { key: `queue_item_${item.type}`, params: { count: num(d.count), projectName: text(d.projectName) } }
    case "po_attention":
      return { key: "queue_item_po_attention", params: { count: num(d.count), late: num(d.late), notAccepted: num(d.notAccepted), notSent: num(d.notSent) } }
    case "sales_deposits_to_confirm":
    case "mfg_materials_to_issue":
    case "mfg_requests_unanswered":
    case "mfg_client_drawings_due":
    case "mfg_notes_to_receive":
    case "mfg_purchase_requests":
    case "po_approve":
      return { key: `queue_item_${item.type}`, params: { count: num(d.count) } }
  }
}

/** The card's button: forward a notice nobody was told of; open one already with its receiver. */
export function queueActionKey(item: Pick<WorkQueueItem, "type" | "data">, byType: Record<WorkQueueItemType, string>): string {
  if (item.type === "delivery_confirm" && text(item.data.forwardedTo)) return "action_delivery_open"
  return byType[item.type]
}

export function taskTitle(task: Pick<QueueTask, "titleKey" | "params">, t: QueueTranslate): string {
  const values: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(task.params)) values[name] = typeof value === "object" ? t(value.key) : value
  return t(task.titleKey, values)
}

export interface QueueTask {
  id: string
  kind: "queue"
  itemType: WorkQueueItemType
  /** `YYYY-MM-DD` in Riyadh: the deadline, or the day it started waiting (today when the records carry no date). */
  dueOn: string
  /** The item is a deadline (the day is when it falls due), not a wait (the day is when it began). */
  deadline: boolean
  /** The records say when it began or falls due; false = "today" is only an assumption. */
  dated: boolean
  titleKey: string
  params: Record<string, QueueTaskParam>
  href: string
  bucket: ActivityBucket
  tile: PortalComponentId
  /** Message key of the module's name in `Portal.Sidebar`. */
  moduleLabelKey: string
}

/** The day a queue item is due: its deadline, or the day it began to wait (never later than today); today when undated. */
export function queueDueOn(item: Pick<WorkQueueItem, "type" | "since">, today: string): string {
  if (!item.since) return today
  const day = riyadhDay(new Date(item.since))
  return DEADLINE_TYPES.has(item.type) || day <= today ? day : today
}

export interface QueueTaskContext {
  can: (permission: PermissionId) => boolean
  modules: QueueModules
  /** The registry as this company sees it (switched-off modules left out). Defaults to the whole contractor registry. */
  components?: ReadonlyArray<Pick<PortalComponentDef, "id" | "labelKey" | "launcher">>
  today?: string
}

/** The work queue as to-dos: gated like the home page, dated, bucketed, oldest first. */
export function queueTasks(items: WorkQueueItem[], ctx: QueueTaskContext): QueueTask[] {
  const today = ctx.today ?? riyadhDay()
  const allowed = queueItemPermissions(ctx.can)
  const components = ctx.components ?? CONTRACTOR_COMPONENTS
  return liveQueueItems(items, ctx.modules)
    .filter((item) => allowed[item.type])
    .flatMap((item) => {
      const tile = QUEUE_ITEM_TILE[item.type]
      const component = components.find((c) => c.id === tile && c.launcher !== false)
      if (!component) return []
      const dueOn = queueDueOn(item, today)
      const { key, params } = queueTitle(item)
      const task: QueueTask = {
        id: `queue:${item.id}`,
        kind: "queue",
        itemType: item.type,
        dueOn,
        deadline: DEADLINE_TYPES.has(item.type),
        dated: Boolean(item.since),
        titleKey: key,
        params,
        href: item.actionUrl,
        bucket: bucketOf({ dueOn }, today),
        tile,
        moduleLabelKey: component.labelKey,
      }
      return [task]
    })
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
}

export interface QueueTaskGroups {
  overdue: QueueTask[]
  today: QueueTask[]
  planned: QueueTask[]
}

export const groupTasks = (tasks: QueueTask[]): QueueTaskGroups => ({
  overdue: tasks.filter((t) => t.bucket === "overdue"),
  today: tasks.filter((t) => t.bucket === "today"),
  planned: tasks.filter((t) => t.bucket === "planned"),
})

/** My open activities and the derived queue tasks, counted together. */
export function todoCounts(groups: ActivityGroups, tasks: QueueTask[]): ActivityCounts {
  const queue = groupTasks(tasks)
  const overdue = groups.overdue.length + queue.overdue.length
  const today = groups.today.length + queue.today.length
  return { overdue, today, planned: groups.planned.length + queue.planned.length, due: overdue + today }
}

export type TodoRow = { kind: "activity"; activity: Activity } | { kind: "queue"; task: QueueTask }

/** One bucket's rows: planned activities and queue tasks, by day; on the same day the activity first. */
export function mergeRows(activities: Activity[], tasks: QueueTask[]): TodoRow[] {
  const rows: TodoRow[] = [...activities.map((activity): TodoRow => ({ kind: "activity", activity })), ...tasks.map((task): TodoRow => ({ kind: "queue", task }))]
  const day = (r: TodoRow) => (r.kind === "activity" ? r.activity.dueOn : r.task.dueOn)
  return rows.sort((a, b) => day(a).localeCompare(day(b)) || (a.kind === b.kind ? 0 : a.kind === "activity" ? -1 : 1))
}
