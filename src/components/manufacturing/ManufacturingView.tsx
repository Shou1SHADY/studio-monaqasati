"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, addDoc, updateDoc, deleteDoc, query, where, writeBatch, increment, serverTimestamp } from "firebase/firestore"
import { Factory, Plus, Trash2, ArrowUp, ArrowDown, Loader2, CheckCircle2, CircleDot, Circle, ArrowLeftRight, XCircle, PackageCheck, Truck, Boxes, List, Waypoints } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import {
  MFG_DEPARTMENTS,
  WORK_ORDERS,
  buildStagesFromDepartments,
  nextWorkOrderNumber,
  advanceStages,
  computeMaterialCost,
  overdrawnInputs,
  effectiveOutput,
  ensureOutboundWarehouse,
  deliverWorkOrder,
  type MfgDepartment,
  type WorkOrder,
  type WorkOrderInputItem,
} from "@/lib/manufacturing"
import { ManufacturingMindMap } from "./ManufacturingMindMap"

type Member = { id: string; name?: string; email?: string }

export function ManufacturingView({
  projectId,
  projectName,
}: {
  /** When set, the view is embedded in that project's page: orders are scoped
   * to the project, new orders are pre-linked to it, and the org-level chrome
   * (page header, department manager) is hidden. */
  projectId?: string
  projectName?: string
} = {}) {
  const embedded = !!projectId
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManage = can("manufacturing.manage")

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const actorName = (profile as { name?: string } | null)?.name || user?.email || ""

  const departmentsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, MFG_DEPARTMENTS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: departmentsData } = useCollection(departmentsQuery)
  const departments = useMemo(
    () => (((departmentsData || []) as MfgDepartment[]).sort((a, b) => a.order - b.order)),
    [departmentsData]
  )

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: ordersData, isLoading: ordersLoading } = useCollection(ordersQuery)
  const allOrders = useMemo(
    () => (((ordersData || []) as WorkOrder[]).sort((a, b) => (b.orderNumber || 0) - (a.orderNumber || 0))),
    [ordersData]
  )
  const orders = useMemo(
    () => (projectId ? allOrders.filter((o) => o.projectId === projectId) : allOrders),
    [allOrders, projectId]
  )

  const membersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "users"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: membersData } = useCollection(membersQuery)
  const members = (membersData || []) as Member[]

  const warehousesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "warehouses"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: warehousesData } = useCollection(warehousesQuery)
  const orgWarehouses = (warehousesData || []) as Array<{ id: string; name: string; projectId?: string | null; isCentral?: boolean; isOutbound?: boolean }>

  const projectsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "projects"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: projectsData } = useCollection(projectsQuery)
  const orgProjects = (projectsData || []) as Array<{ id: string; name: string }>

  // Raw-material picker: the inventory of whichever source warehouse is chosen.
  const [sourceWarehouseId, setSourceWarehouseId] = useState("")
  const sourceItemsQuery = useMemoFirebase(() => {
    if (!firestore || !sourceWarehouseId) return null
    return collection(firestore, "warehouses", sourceWarehouseId, "inventoryItems")
  }, [firestore, sourceWarehouseId])
  const { data: sourceItemsData } = useCollection(sourceItemsQuery)
  const sourceItems = (sourceItemsData || []) as Array<{ id: string; name: string; quantity: number; unit: string; unitCost?: number | null }>

  const [statusFilter, setStatusFilter] = useState<"open" | "done" | "all">("open")
  // "list" is the compact queue; "map" draws the same orders as a mind map
  // (warehouse → order → stages → output → destination).
  const [viewMode, setViewMode] = useState<"list" | "map">("list")
  const visibleOrders = orders.filter((o) => statusFilter === "all" || o.status === statusFilter)
  const openCount = orders.filter((o) => o.status === "open").length
  const doneCount = orders.filter((o) => o.status === "done").length
  const myStagesCount = orders.filter(
    (o) => o.status === "open" && o.stages[o.currentStageIndex]?.assigneeUserId === user?.uid
  ).length

  // ── Departments manager ──
  const [newDeptName, setNewDeptName] = useState("")
  const [isSavingDept, setIsSavingDept] = useState(false)

  const addDepartment = async () => {
    if (!firestore || !newDeptName.trim() || isSavingDept) return
    setIsSavingDept(true)
    try {
      await addDoc(collection(firestore, MFG_DEPARTMENTS), {
        organizationId: orgId,
        name: newDeptName.trim(),
        order: departments.length + 1,
        createdAt: serverTimestamp(),
      })
      setNewDeptName("")
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setIsSavingDept(false)
    }
  }

  const moveDepartment = async (index: number, dir: -1 | 1) => {
    if (!firestore) return
    const a = departments[index]
    const b = departments[index + dir]
    if (!a || !b) return
    try {
      await updateDoc(doc(firestore, MFG_DEPARTMENTS, a.id), { order: b.order })
      await updateDoc(doc(firestore, MFG_DEPARTMENTS, b.id), { order: a.order })
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    }
  }

  const removeDepartment = async (id: string) => {
    if (!firestore) return
    try {
      await deleteDoc(doc(firestore, MFG_DEPARTMENTS, id))
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    }
  }

  // ── Create order ──
  const [showCreate, setShowCreate] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [orderTitle, setOrderTitle] = useState("")
  const [orderDue, setOrderDue] = useState("")
  const [orderProjectId, setOrderProjectId] = useState("")
  const [inputRows, setInputRows] = useState<Array<{ inventoryItemId: string; quantity: string }>>([
    { inventoryItemId: "", quantity: "" },
  ])
  const [outName, setOutName] = useState("")
  const [outQty, setOutQty] = useState("")
  const [outUnit, setOutUnit] = useState("")

  const resetCreate = () => {
    setOrderTitle(""); setOrderDue(""); setOrderProjectId("")
    setSourceWarehouseId(""); setInputRows([{ inventoryItemId: "", quantity: "" }])
    setOutName(""); setOutQty(""); setOutUnit("")
  }

  const createOrder = async () => {
    if (!firestore || !user || isCreating) return
    if (!orderTitle.trim()) {
      toast({ title: t("mfg_title_required"), variant: "destructive" })
      return
    }
    if (departments.length === 0) {
      toast({ title: t("mfg_no_departments_error"), variant: "destructive" })
      return
    }
    // Manufacturing consumes only from inventory — every order draws real stock.
    const inputs: WorkOrderInputItem[] = inputRows
      .filter((r) => r.inventoryItemId && Number(r.quantity) > 0)
      .map((r) => {
        const src = sourceItems.find((i) => i.id === r.inventoryItemId)!
        return {
          inventoryItemId: r.inventoryItemId,
          name: src?.name || "",
          quantity: Number(r.quantity),
          unit: src?.unit || "",
          unitCost: src?.unitCost ?? null,
        }
      })
    if (!sourceWarehouseId || inputs.length === 0) {
      toast({ title: t("mfg_inputs_required"), variant: "destructive" })
      return
    }
    const overdrawn = overdrawnInputs(inputs, sourceItems)
    if (overdrawn.length > 0) {
      toast({ title: t("mfg_inputs_over_stock", { item: overdrawn[0].name }), variant: "destructive" })
      return
    }
    if (!outName.trim() || !(Number(outQty) > 0)) {
      toast({ title: t("mfg_output_required"), variant: "destructive" })
      return
    }
    setIsCreating(true)
    try {
      const { cost } = computeMaterialCost(inputs)
      const effectiveProjectId = projectId || orderProjectId
      const effectiveProjectName = projectName || orgProjects.find((p) => p.id === orderProjectId)?.name
      const batch = writeBatch(firestore)
      const orderRef = doc(collection(firestore, WORK_ORDERS))
      batch.set(orderRef, {
        organizationId: orgId,
        orderNumber: nextWorkOrderNumber(allOrders),
        title: orderTitle.trim(),
        items: [],
        inputs,
        sourceWarehouseId,
        sourceWarehouseName: orgWarehouses.find((w) => w.id === sourceWarehouseId)?.name || "",
        materialCost: cost,
        output: { name: outName.trim(), quantity: Number(outQty), unit: outUnit.trim() },
        projectId: effectiveProjectId || null,
        projectName: effectiveProjectName || null,
        deliveredTo: null,
        deliveredAt: null,
        source: { kind: "manual" },
        status: "open",
        currentStageIndex: 0,
        stages: buildStagesFromDepartments(departments),
        dueDate: orderDue || null,
        createdByUserId: user.uid,
        createdByUserName: actorName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        completedAt: null,
      })
      for (const input of inputs) {
        batch.update(doc(firestore, "warehouses", sourceWarehouseId, "inventoryItems", input.inventoryItemId), {
          quantity: increment(-input.quantity),
          updatedAt: serverTimestamp(),
        })
      }
      await batch.commit()
      toast({ title: t("mfg_order_created_stock", { count: inputs.length }) })
      setShowCreate(false)
      resetCreate()
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setIsCreating(false)
    }
  }

  // ── Deliver finished output ──
  const [deliverDest, setDeliverDest] = useState("")
  const [isDelivering, setIsDelivering] = useState(false)

  const handleDeliver = async (order: WorkOrder) => {
    if (!firestore || !deliverDest || isDelivering) return
    setIsDelivering(true)
    try {
      let destination
      if (deliverDest === "__outbound__") {
        const outbound = await ensureOutboundWarehouse(firestore, orgId)
        destination = { warehouseId: outbound.id, warehouseName: outbound.name, kind: "outbound" as const }
      } else {
        const wh = orgWarehouses.find((w) => w.id === deliverDest)!
        destination = {
          warehouseId: wh.id,
          warehouseName: wh.name,
          kind: wh.isOutbound ? ("outbound" as const) : wh.projectId ? ("project" as const) : ("central" as const),
        }
      }
      await deliverWorkOrder(firestore, order, destination)
      toast({ title: t("mfg_delivered_toast", { warehouse: destination.warehouseName }) })
      setDeliverDest("")
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setIsDelivering(false)
    }
  }

  // ── Order detail: assignment + hand-off ──
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = orders.find((o) => o.id === detailId) || null
  const [isAdvancing, setIsAdvancing] = useState(false)

  const assignStage = async (order: WorkOrder, stageIndex: number, memberId: string) => {
    if (!firestore) return
    const member = members.find((m) => m.id === memberId)
    const stages = order.stages.map((s, i) =>
      i === stageIndex ? { ...s, assigneeUserId: memberId, assigneeName: member?.name || member?.email || "" } : s
    )
    try {
      await updateDoc(doc(firestore, WORK_ORDERS, order.id), { stages, updatedAt: serverTimestamp() })
      if (memberId !== user?.uid) {
        await addDoc(collection(firestore, "users", memberId, "notifications"), {
          userId: memberId,
          organizationId: orgId,
          type: "mfg_stage_assigned",
          title: t("mfg_notif_assigned_title"),
          message: t("mfg_notif_assigned_msg", { order: `#${order.orderNumber} ${order.title}`, stage: stages[stageIndex].departmentName }),
          createdAt: new Date().toISOString(),
          read: false,
        })
      }
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    }
  }

  const handOff = async (order: WorkOrder) => {
    if (!firestore || isAdvancing) return
    setIsAdvancing(true)
    try {
      const { stages, currentStageIndex, completed } = advanceStages(order.stages, order.currentStageIndex)
      await updateDoc(doc(firestore, WORK_ORDERS, order.id), {
        stages,
        currentStageIndex,
        status: completed ? "done" : "open",
        completedAt: completed ? new Date().toISOString() : null,
        updatedAt: serverTimestamp(),
      })
      const nextStage = completed ? null : stages[currentStageIndex]
      if (nextStage?.assigneeUserId && nextStage.assigneeUserId !== user?.uid) {
        await addDoc(collection(firestore, "users", nextStage.assigneeUserId, "notifications"), {
          userId: nextStage.assigneeUserId,
          organizationId: orgId,
          type: "mfg_stage_handoff",
          title: t("mfg_notif_handoff_title"),
          message: t("mfg_notif_handoff_msg", { order: `#${order.orderNumber} ${order.title}`, stage: nextStage.departmentName }),
          createdAt: new Date().toISOString(),
          read: false,
        })
      }
      toast({ title: completed ? t("mfg_order_completed") : t("mfg_handed_off") })
      if (completed) setDetailId(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setIsAdvancing(false)
    }
  }

  const cancelOrder = async (order: WorkOrder) => {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, WORK_ORDERS, order.id), { status: "cancelled", updatedAt: serverTimestamp() })
      setDetailId(null)
      toast({ title: t("mfg_order_cancelled") })
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    }
  }

  const statusBadge = (status: WorkOrder["status"]) =>
    status === "done" ? (
      <Badge className="bg-success/10 text-success border-none">{t("mfg_status_done")}</Badge>
    ) : status === "cancelled" ? (
      <Badge className="bg-muted text-muted-foreground border-none">{t("mfg_status_cancelled")}</Badge>
    ) : (
      <Badge className="bg-cta/10 text-cta border-none">{t("mfg_status_open")}</Badge>
    )

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          {embedded ? (
            <p className="text-sm font-bold text-foreground flex items-center gap-2">
              <Factory size={17} className="shrink-0 text-cta" aria-hidden="true" />
              {t("mfg_project_tab_title")}
            </p>
          ) : (
            <>
              <h1 className="text-2xl font-black text-primary flex items-center gap-2">
                <Factory size={22} className="shrink-0" aria-hidden="true" />
                {t("mfg_page_title")}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">{t("mfg_page_desc")}</p>
            </>
          )}
        </div>
        <Button className="gap-2 shrink-0" onClick={() => setShowCreate(true)} disabled={departments.length === 0}>
          <Plus size={16} />
          {t("mfg_new_order_btn")}
        </Button>
      </header>

      {embedded && departments.length === 0 && (
        <p className="text-xs text-muted-foreground border border-dashed rounded-xl p-4 text-center">
          {t("mfg_no_departments")}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t("mfg_stat_open"), value: openCount },
          { label: t("mfg_stat_done"), value: doneCount },
          { label: t("mfg_stat_mine"), value: myStagesCount },
        ].map((s) => (
          <div key={s.label} className="p-4 rounded-xl border bg-white">
            <p className="text-xs text-muted-foreground font-semibold">{s.label}</p>
            <p className="text-xl font-black mt-1 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Department chain */}
      {!embedded && (
      <div className="rounded-2xl border bg-white p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-foreground flex items-center gap-2">
            <ArrowLeftRight size={15} className="text-cta" />
            {t("mfg_departments_title")}
          </h2>
          <p className="text-[11px] text-muted-foreground">{t("mfg_departments_hint")}</p>
        </div>
        {departments.length === 0 && (
          <p className="text-xs text-muted-foreground border border-dashed rounded-xl p-4 text-center">
            {t("mfg_no_departments")}
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {departments.map((d, i) => (
            <div key={d.id} className="flex items-center gap-1.5 ps-3 pe-1.5 py-1.5 rounded-xl border bg-muted/30 text-sm font-semibold">
              <span className="text-muted-foreground text-xs">{i + 1}.</span>
              {d.name}
              {canManage && (
                <span className="flex items-center">
                  <button type="button" onClick={() => moveDepartment(i, -1)} disabled={i === 0} aria-label={t("mfg_move_earlier")} className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {isRtl ? <ArrowUp size={12} className="rotate-90" /> : <ArrowUp size={12} className="-rotate-90" />}
                  </button>
                  <button type="button" onClick={() => moveDepartment(i, 1)} disabled={i === departments.length - 1} aria-label={t("mfg_move_later")} className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {isRtl ? <ArrowDown size={12} className="rotate-90" /> : <ArrowDown size={12} className="-rotate-90" />}
                  </button>
                  <button type="button" onClick={() => removeDepartment(d.id)} aria-label={t("mfg_remove_department")} className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Trash2 size={12} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Input
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void addDepartment() }}
              placeholder={t("mfg_add_department_placeholder")}
              className="h-9 max-w-xs"
            />
            <Button size="sm" variant="outline" onClick={addDepartment} disabled={isSavingDept || !newDeptName.trim()} className="gap-1.5">
              {isSavingDept ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {t("mfg_add_department")}
            </Button>
          </div>
        )}
      </div>
      )}

      {/* Orders */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {(["open", "done", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                statusFilter === s ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              )}
            >
              {t(`mfg_filter_${s}`)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t("mfg_view_toggle")} className="flex items-center gap-0.5 rounded-lg border bg-white p-0.5">
          {(
            [
              { id: "list", icon: <List size={14} aria-hidden="true" />, label: t("mfg_view_list") },
              { id: "map", icon: <Waypoints size={14} aria-hidden="true" />, label: t("mfg_view_map") },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={viewMode === m.id}
              onClick={() => setViewMode(m.id)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                viewMode === m.id ? "bg-primary text-white" : "text-slate-600 hover:bg-muted"
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {ordersLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : viewMode === "map" ? (
        <ManufacturingMindMap orders={visibleOrders} warehouses={orgWarehouses} onSelectOrder={setDetailId} />
      ) : visibleOrders.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <PackageCheck size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{t("mfg_empty_orders")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleOrders.map((o) => {
            const current = o.stages[o.currentStageIndex]
            const doneStages = o.stages.filter((s) => s.status === "done").length
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setDetailId(o.id)}
                className="w-full text-start flex items-center justify-between gap-3 p-4 rounded-xl border border-slate-200/70 bg-white hover:border-primary/40 hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black text-muted-foreground">#{o.orderNumber}</span>
                    <span className="font-bold text-sm text-slate-800 truncate">{o.title}</span>
                    {statusBadge(o.status)}
                    {o.source?.kind === "quotation" && (
                      <Badge variant="outline" className="text-[10px]">{t("mfg_source_quotation")}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {o.status === "open" && current
                      ? t("mfg_current_stage_line", { stage: current.departmentName, assignee: current.assigneeName || t("mfg_unassigned") })
                      : t("mfg_stages_progress", { done: doneStages, total: o.stages.length })}
                    {o.dueDate && <span className="mx-2">· {t("mfg_due")} {o.dueDate}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {o.stages.map((s, i) => (
                    <span
                      key={i}
                      title={s.departmentName}
                      className={cn(
                        "h-2 w-2 rounded-full",
                        s.status === "done" ? "bg-success" : s.status === "in_progress" ? "bg-cta" : "bg-slate-200"
                      )}
                    />
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Create order */}
      <Dialog open={showCreate} onOpenChange={(open) => { if (!isCreating) { setShowCreate(open); if (!open) resetCreate() } }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("mfg_new_order_title")}</DialogTitle>
            <DialogDescription>{t("mfg_new_order_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mfg-title">{t("mfg_order_title_label")} *</Label>
                <Input id="mfg-title" value={orderTitle} onChange={(e) => setOrderTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mfg-due">{t("mfg_due_label")}</Label>
                <Input id="mfg-due" type="date" dir="ltr" value={orderDue} onChange={(e) => setOrderDue(e.target.value)} />
              </div>
            </div>
            {!embedded && orgProjects.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t("mfg_project_label")}</Label>
                <Select value={orderProjectId || "__none__"} onValueChange={(v) => setOrderProjectId(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("mfg_no_project")}</SelectItem>
                    {orgProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="rounded-xl border bg-muted/20 p-3.5 space-y-3">
              <Label className="flex items-center gap-1.5"><Boxes size={14} className="text-cta" />{t("mfg_inputs_title")} *</Label>
              <Select value={sourceWarehouseId} onValueChange={(v) => { setSourceWarehouseId(v); setInputRows([{ inventoryItemId: "", quantity: "" }]) }}>
                <SelectTrigger><SelectValue placeholder={t("mfg_source_warehouse")} /></SelectTrigger>
                <SelectContent>
                  {orgWarehouses.filter((w) => !w.isOutbound).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}{w.projectId ? ` — ${t("mfg_wh_project_tag")}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sourceWarehouseId && inputRows.map((row, i) => {
                const src = sourceItems.find((s) => s.id === row.inventoryItemId)
                const over = src && Number(row.quantity) > src.quantity
                return (
                  <div key={i} className="flex items-center gap-2">
                    <Select value={row.inventoryItemId || undefined} onValueChange={(v) => setInputRows((p) => p.map((x, j) => (j === i ? { ...x, inventoryItemId: v } : x)))}>
                      <SelectTrigger className="flex-1 h-9 text-xs"><SelectValue placeholder={t("mfg_pick_material")} /></SelectTrigger>
                      <SelectContent>
                        {sourceItems.map((s) => (
                          <SelectItem key={s.id} value={s.id} className="text-xs">
                            {s.name} — {t("mfg_available", { qty: s.quantity, unit: s.unit })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder={t("mfg_item_qty")} dir="ltr" inputMode="decimal"
                      value={row.quantity}
                      onChange={(e) => setInputRows((p) => p.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                      className={cn("w-24 h-9", over && "border-destructive ring-1 ring-destructive")}
                    />
                    <button type="button" onClick={() => setInputRows((p) => p.filter((_, j) => j !== i))} disabled={inputRows.length === 1} aria-label={t("mfg_remove_item")} className="h-8 w-8 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
              {sourceWarehouseId && (
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setInputRows((p) => [...p, { inventoryItemId: "", quantity: "" }])}>
                  <Plus size={13} />
                  {t("mfg_add_item")}
                </Button>
              )}
            </div>

            <div className="rounded-xl border bg-muted/20 p-3.5 space-y-2">
              <Label className="flex items-center gap-1.5"><PackageCheck size={14} className="text-success" />{t("mfg_output_title")} *</Label>
              <div className="flex items-center gap-2">
                <Input placeholder={t("mfg_output_name")} value={outName} onChange={(e) => setOutName(e.target.value)} className="flex-1 h-9" />
                <Input placeholder={t("mfg_item_qty")} dir="ltr" inputMode="decimal" value={outQty} onChange={(e) => setOutQty(e.target.value)} className="w-24 h-9" />
                <Input placeholder={t("mfg_item_unit")} value={outUnit} onChange={(e) => setOutUnit(e.target.value)} className="w-24 h-9" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={isCreating}>{t("crm_cancel")}</Button>
            <Button onClick={createOrder} disabled={isCreating} className="gap-2">
              {isCreating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {t("mfg_create_order")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order detail — the stage chain */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetailId(null) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">#{detail.orderNumber}</span>
                  {detail.title}
                  {statusBadge(detail.status)}
                </DialogTitle>
                <DialogDescription>
                  {detail.source?.kind === "quotation" && detail.source.contactName
                    ? t("mfg_detail_from_quotation", { contact: detail.source.contactName, number: detail.source.quotationNumber || "" })
                    : t("mfg_detail_manual")}
                  {detail.dueDate && ` · ${t("mfg_due")} ${detail.dueDate}`}
                </DialogDescription>
              </DialogHeader>

              {(detail.inputs?.length || detail.items.length > 0 || detail.output) && (
                <div className="rounded-xl border bg-muted/20 p-3.5 space-y-2.5">
                  {detail.inputs && detail.inputs.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                        <Boxes size={12} />
                        {t("mfg_inputs_from", { warehouse: detail.sourceWarehouseName || "" })}
                      </p>
                      <div className="mt-1.5 space-y-1">
                        {detail.inputs.map((input, i) => (
                          <p key={i} className="text-sm flex items-center justify-between gap-2">
                            <span className="font-semibold">{input.name}</span>
                            <span className="text-muted-foreground text-xs tabular-nums" dir="ltr">
                              {input.quantity} {input.unit}{input.unitCost != null ? ` × ${input.unitCost.toLocaleString()}` : ""}
                            </span>
                          </p>
                        ))}
                      </div>
                      {detail.materialCost != null && detail.materialCost > 0 && (
                        <p className="mt-2 text-xs font-bold text-cta flex items-center justify-between border-t border-border/50 pt-2">
                          {t("mfg_material_cost")}
                          <span dir="ltr" className="tabular-nums">{detail.materialCost.toLocaleString()} {t("mfg_sar")}</span>
                        </p>
                      )}
                    </div>
                  )}
                  {detail.items.map((item, i) => (
                    <p key={i} className="text-sm flex items-center gap-2">
                      <span className="font-semibold">{item.name}</span>
                      <span className="text-muted-foreground text-xs" dir="ltr">{item.quantity} {item.unit}</span>
                    </p>
                  ))}
                  {detail.output && (
                    <p className="text-sm flex items-center justify-between gap-2 border-t border-border/50 pt-2">
                      <span className="flex items-center gap-1.5 font-bold text-success"><PackageCheck size={14} />{detail.output.name}</span>
                      <span className="text-muted-foreground text-xs tabular-nums" dir="ltr">{detail.output.quantity} {detail.output.unit}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Delivery — the user decides where the finished item lands:
                  a project warehouse, back to a central one, or the virtual
                  distribution warehouse for goods awaiting delivery. */}
              {detail.status === "done" && !detail.deliveredTo && (
                <div className="rounded-xl border border-success/30 bg-success/5 p-3.5 space-y-2.5">
                  <p className="text-sm font-bold text-success flex items-center gap-1.5">
                    <Truck size={15} />
                    {t("mfg_deliver_title", { name: effectiveOutput(detail).name })}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={deliverDest || undefined} onValueChange={setDeliverDest}>
                      <SelectTrigger className="h-9 w-64 text-xs"><SelectValue placeholder={t("mfg_deliver_placeholder")} /></SelectTrigger>
                      <SelectContent>
                        {orgWarehouses.filter((w) => !w.isOutbound).map((w) => (
                          <SelectItem key={w.id} value={w.id} className="text-xs">
                            {w.name}{w.projectId ? ` — ${t("mfg_wh_project_tag")}` : ""}
                          </SelectItem>
                        ))}
                        <SelectItem value="__outbound__" className="text-xs">{t("mfg_outbound_option")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="gap-1.5 h-9" onClick={() => handleDeliver(detail)} disabled={!deliverDest || isDelivering}>
                      {isDelivering ? <Loader2 size={13} className="animate-spin" /> : <Truck size={13} />}
                      {t("mfg_deliver_btn")}
                    </Button>
                  </div>
                </div>
              )}
              {detail.deliveredTo && (
                <p className="text-xs font-semibold text-success flex items-center gap-1.5">
                  <CheckCircle2 size={13} />
                  {t("mfg_delivered_line", { warehouse: detail.deliveredTo.warehouseName })}
                </p>
              )}

              <div className="space-y-0">
                {detail.stages.map((stage, i) => {
                  const isCurrent = detail.status === "open" && i === detail.currentStageIndex
                  return (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        {stage.status === "done" ? (
                          <CheckCircle2 size={20} className="text-success shrink-0" />
                        ) : isCurrent ? (
                          <CircleDot size={20} className="text-cta shrink-0" />
                        ) : (
                          <Circle size={20} className="text-slate-300 shrink-0" />
                        )}
                        {i < detail.stages.length - 1 && <span className={cn("w-px flex-1 min-h-8", stage.status === "done" ? "bg-success/40" : "bg-slate-200")} />}
                      </div>
                      <div className={cn("pb-5 flex-1 min-w-0", i === detail.stages.length - 1 && "pb-1")}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className={cn("text-sm font-bold", isCurrent ? "text-cta" : "text-foreground")}>{stage.departmentName}</p>
                          {stage.completedAt && (
                            <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                              {new Date(stage.completedAt).toLocaleDateString(isRtl ? "ar-SA" : "en-US")}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {canManage && detail.status === "open" && stage.status !== "done" ? (
                            <Select value={stage.assigneeUserId || "__none__"} onValueChange={(v) => { if (v !== "__none__") void assignStage(detail, i, v) }}>
                              <SelectTrigger className="h-8 w-56 text-xs">
                                <SelectValue placeholder={t("mfg_assign_placeholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                {members.map((m) => (
                                  <SelectItem key={m.id} value={m.id} className="text-xs">{m.name || m.email}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {stage.assigneeName || t("mfg_unassigned")}
                            </span>
                          )}
                          {isCurrent && (
                            <Button size="sm" className="gap-1.5 h-8" onClick={() => handOff(detail)} disabled={isAdvancing}>
                              {isAdvancing ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                              {i === detail.stages.length - 1 ? t("mfg_finish_order") : t("mfg_handoff_btn")}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {canManage && detail.status === "open" && (
                <DialogFooter>
                  <Button variant="outline" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive hover:text-white" onClick={() => cancelOrder(detail)}>
                    <XCircle size={14} />
                    {t("mfg_cancel_order")}
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
