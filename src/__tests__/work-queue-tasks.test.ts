import type { WorkQueueItem, WorkQueueItemType } from "@/hooks/useWorkQueue"
import type { Activity, ActivityGroups } from "@/lib/activities"
import type { PermissionId } from "@/lib/permissions"
import { QUEUE_ITEM_TILE, groupTasks, mergeRows, queueActionKey, queueDueOn, queueItemPermissions, queueTasks, queueTitle, taskTitle, todoCounts, type QueueModules } from "@/lib/work-queue-tasks"

const TODAY = "2026-10-11"
const at = (iso: string) => Date.parse(iso)
const yesterday = at("2026-10-10T09:00:00Z")
const today = at("2026-10-11T09:00:00Z")

const item = (type: WorkQueueItemType, over: Partial<WorkQueueItem> = {}): WorkQueueItem => ({
  id: `${type}_1`,
  type,
  tier: 1,
  sortMs: 0,
  actionUrl: "/contractor/rfqs/today",
  data: {},
  ...over,
})

const everything = () => true
const allOn: QueueModules = { on: () => true, linkable: () => true }
const run = (items: WorkQueueItem[], over: Partial<Parameters<typeof queueTasks>[1]> = {}) => queueTasks(items, { can: everything, modules: allOn, today: TODAY, ...over })

describe("the work queue as to-dos", () => {
  it("puts a decision that has waited since yesterday under overdue, today's under today", () => {
    const tasks = run([item("po_approve", { id: "a", since: yesterday, data: { count: 2 } }), item("mfg_requests_unanswered", { id: "b", since: today, data: { count: 1 } })])
    expect(tasks.map((t) => [t.id, t.bucket, t.dueOn])).toEqual([
      ["queue:a", "overdue", "2026-10-10"],
      ["queue:b", "today", "2026-10-11"],
    ])
  })

  it("reads the day in Riyadh, not in UTC", () => {
    expect(queueDueOn({ type: "po_approve", since: at("2026-10-10T22:00:00Z") }, TODAY)).toBe("2026-10-11")
    expect(queueDueOn({ type: "po_approve", since: at("2026-10-10T20:59:00Z") }, TODAY)).toBe("2026-10-10")
  })

  it("treats an item with no date as today", () => {
    const [task] = run([item("low_stock", { data: { itemName: "Cement", warehouseName: "Main" } })])
    expect(task).toMatchObject({ dueOn: TODAY, bucket: "today", dated: false })
  })

  it("never lets a wait start in the future", () => {
    const [task] = run([item("delivery_confirm", { since: at("2026-10-15T09:00:00Z") })])
    expect(task).toMatchObject({ dueOn: TODAY, bucket: "today" })
  })

  it("uses the deadline as the due date for a closing tender and an expiring guarantee", () => {
    const tasks = run([
      item("rfq_closing_soon", { id: "r", since: at("2026-10-12T09:00:00Z"), data: { rfqTitle: "Rebar", hoursLeft: 24 } }),
      item("guarantee_expiring", { id: "g", since: at("2026-10-08T09:00:00Z"), data: { itemName: "Bond", daysLeft: -3, isExpired: true } }),
    ])
    expect(tasks.map((t) => [t.id, t.bucket, t.dueOn, t.deadline])).toEqual([
      ["queue:g", "overdue", "2026-10-08", true],
      ["queue:r", "planned", "2026-10-12", true],
    ])
  })

  it("hides Manufacturing's decisions when the company switched Manufacturing off", () => {
    const items = [item("mfg_requests_unanswered", { data: { count: 1 } }), item("po_approve", { data: { count: 1 } })]
    const off: QueueModules = { on: (id) => id !== "manufacturing", linkable: () => true }
    expect(run(items, { modules: off }).map((t) => t.itemType)).toEqual(["po_approve"])
    expect(run(items).map((t) => t.itemType).sort()).toEqual(["mfg_requests_unanswered", "po_approve"])
  })

  it("keeps only what the member can act on", () => {
    const onlyDeliveries = (p: PermissionId) => p === "deliveries.confirm"
    const tasks = run([item("delivery_confirm"), item("po_approve", { data: { count: 1 } }), item("team_invite_pending")], { can: onlyDeliveries })
    expect(tasks.map((t) => t.itemType)).toEqual(["delivery_confirm"])
    expect(queueItemPermissions(onlyDeliveries).delivery_confirm).toBe(true)
    expect(queueItemPermissions(onlyDeliveries).po_attention).toBe(false)
  })

  it("sends a tender link to the core RFQ page when Project Management is off", () => {
    const url = "/contractor/projects/p1/tenders/r9/offers"
    const items = [item("rfq_decision", { actionUrl: url, data: { rfqTitle: "Steel", offerCount: 2 } })]
    const pmOff: QueueModules = { on: (id) => id !== "project-management", linkable: () => true }
    expect(run(items, { modules: pmOff })[0].href).toBe("/contractor/rfqs/r9/offers")
    expect(run(items)[0].href).toBe(url)
  })

  it("drops an item whose page the company switched off", () => {
    const closed: QueueModules = { on: () => true, linkable: (href) => !href.startsWith("/contractor/sales") }
    expect(run([item("sales_deposits_to_confirm", { actionUrl: "/contractor/sales/payments", data: { count: 1 } })], { modules: closed })).toEqual([])
  })

  it("drops an item whose module tile is not in the company's registry", () => {
    const onlyFinance = [{ id: "payments" as const, labelKey: "component_finance", launcher: true }]
    expect(run([item("po_approve", { data: { count: 1 } })], { components: onlyFinance })).toEqual([])
    expect(run([item("guarantee_expiring", { since: yesterday, data: { itemName: "B", daysLeft: 2 } })], { components: onlyFinance })[0].moduleLabelKey).toBe("component_finance")
  })

  it("names the module the way the sidebar does and keeps the title's values", () => {
    const [task] = run([item("po_approve", { data: { count: 3 } })])
    expect(task).toMatchObject({ kind: "queue", itemType: "po_approve", tile: QUEUE_ITEM_TILE.po_approve, moduleLabelKey: "component_procurement", titleKey: "queue_item_po_approve", params: { count: 3 } })
  })

  it("fills a title's fallbacks and nested messages through the translator", () => {
    const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(",")})` : key)
    const [rfq] = run([item("rfq_decision", { data: { rfqTitle: "", offerCount: 2 } })])
    expect(taskTitle(rfq, t)).toBe("queue_item_rfq_decision(rfqTitle=rfq_not_set,count=2)")
    const [project] = run([item("project_waiting_approval", { data: { projectName: "Tower", statusLabelKey: "proj_status_pricing" } })])
    expect(taskTitle(project, t)).toBe("queue_item_project_waiting_approval(name=Tower,status=proj_status_pricing)")
    const [expired] = run([item("guarantee_expiring", { since: yesterday, data: { itemName: "Bond", daysLeft: -4, isExpired: true } })])
    expect(expired.titleKey).toBe("queue_item_guarantee_expired")
    expect(expired.params).toMatchObject({ days: 4 })
  })

  it("orders the oldest first and counts together with real activities", () => {
    const tasks = run([
      item("po_approve", { id: "late", since: at("2026-10-05T09:00:00Z"), data: { count: 1 } }),
      item("po_attention", { id: "now", data: { count: 1 } }),
      item("rfq_closing_soon", { id: "soon", since: at("2026-10-13T09:00:00Z"), data: { rfqTitle: "X", hoursLeft: 40 } }),
    ])
    expect(tasks.map((t) => t.id)).toEqual(["queue:late", "queue:now", "queue:soon"])
    expect(groupTasks(tasks)).toMatchObject({ overdue: [{ id: "queue:late" }], today: [{ id: "queue:now" }], planned: [{ id: "queue:soon" }] })

    const act = (id: string, dueOn: string): Activity => ({
      id,
      organizationId: "o",
      type: "todo",
      summary: id,
      note: null,
      dueOn,
      assigneeId: "u",
      assigneeName: "",
      createdById: "u",
      createdByName: "",
      status: "open",
      target: null,
      targetKey: null,
    })
    const groups: ActivityGroups = { overdue: [act("a1", "2026-10-09")], today: [], planned: [act("a2", "2026-10-20")] }
    expect(todoCounts(groups, tasks)).toEqual({ overdue: 2, today: 1, planned: 2, due: 3 })
    const rows = mergeRows(groups.overdue, groupTasks(tasks).overdue)
    expect(rows.map((r) => (r.kind === "activity" ? r.activity.id : r.task.id))).toEqual(["queue:late", "a1"])
  })
})

// PUR-06: the dashboard told the owner «أكّد الاستلام» and opened a panel with nothing to
// confirm. A notice is forwarded by Procurement and counted by its receiver.
describe("a supplier's delivery notice on the queue", () => {
  const byType = { delivery_confirm: "action_delivery_confirm" } as Record<WorkQueueItemType, string>
  it("asks to forward a notice nobody was told of", () => {
    const it0 = item("delivery_confirm", { data: { supplierName: "Al Jouda" } })
    expect(queueTitle(it0).key).toBe("queue_item_delivery_confirm")
    expect(queueActionKey(it0, byType)).toBe("action_delivery_confirm")
  })
  it("names the receiver once forwarded, and only opens it", () => {
    const it1 = item("delivery_confirm", { data: { supplierName: "Al Jouda", forwardedTo: "Salem" } })
    expect(queueTitle(it1)).toEqual({ key: "queue_item_delivery_with_receiver", params: { supplierName: "Al Jouda", receiver: "Salem" } })
    expect(queueActionKey(it1, byType)).toBe("action_delivery_open")
  })
  it("reaches whoever may forward, not only receivers", () => {
    expect(queueItemPermissions((p) => p === "po.expedite").delivery_confirm).toBe(true)
  })
})
