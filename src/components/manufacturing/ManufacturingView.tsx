"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from "firebase/firestore"
import { Factory, Plus, Trash2, ArrowUp, ArrowDown, Loader2, CheckCircle2, CircleDot, Circle, ArrowLeftRight, XCircle, PackageCheck } from "lucide-react"
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
  type MfgDepartment,
  type WorkOrder,
  type WorkOrderItem,
} from "@/lib/manufacturing"

type Member = { id: string; name?: string; email?: string }

export function ManufacturingView() {
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
  const orders = useMemo(
    () => (((ordersData || []) as WorkOrder[]).sort((a, b) => (b.orderNumber || 0) - (a.orderNumber || 0))),
    [ordersData]
  )

  const membersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "users"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: membersData } = useCollection(membersQuery)
  const members = (membersData || []) as Member[]

  const [statusFilter, setStatusFilter] = useState<"open" | "done" | "all">("open")
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
  const [orderItems, setOrderItems] = useState<Array<{ name: string; quantity: string; unit: string }>>([
    { name: "", quantity: "", unit: "" },
  ])

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
    setIsCreating(true)
    try {
      const items: WorkOrderItem[] = orderItems
        .filter((i) => i.name.trim())
        .map((i) => ({ name: i.name.trim(), quantity: Number(i.quantity) || 0, unit: i.unit.trim() }))
      await addDoc(collection(firestore, WORK_ORDERS), {
        organizationId: orgId,
        orderNumber: nextWorkOrderNumber(orders),
        title: orderTitle.trim(),
        items,
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
      toast({ title: t("mfg_order_created") })
      setShowCreate(false)
      setOrderTitle("")
      setOrderDue("")
      setOrderItems([{ name: "", quantity: "", unit: "" }])
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setIsCreating(false)
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
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <Factory size={22} className="shrink-0" aria-hidden="true" />
            {t("mfg_page_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("mfg_page_desc")}</p>
        </div>
        <Button className="gap-2 shrink-0" onClick={() => setShowCreate(true)} disabled={departments.length === 0}>
          <Plus size={16} />
          {t("mfg_new_order_btn")}
        </Button>
      </header>

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

      {/* Orders */}
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

      {ordersLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
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
      <Dialog open={showCreate} onOpenChange={(open) => { if (!isCreating) setShowCreate(open) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("mfg_new_order_title")}</DialogTitle>
            <DialogDescription>{t("mfg_new_order_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="mfg-title">{t("mfg_order_title_label")} *</Label>
              <Input id="mfg-title" value={orderTitle} onChange={(e) => setOrderTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mfg-due">{t("mfg_due_label")}</Label>
              <Input id="mfg-due" type="date" dir="ltr" value={orderDue} onChange={(e) => setOrderDue(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("mfg_items_label")}</Label>
              {orderItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input placeholder={t("mfg_item_name")} value={item.name} onChange={(e) => setOrderItems((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="flex-1" />
                  <Input placeholder={t("mfg_item_qty")} dir="ltr" inputMode="numeric" value={item.quantity} onChange={(e) => setOrderItems((p) => p.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className="w-20" />
                  <Input placeholder={t("mfg_item_unit")} value={item.unit} onChange={(e) => setOrderItems((p) => p.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} className="w-24" />
                  <button type="button" onClick={() => setOrderItems((p) => p.filter((_, j) => j !== i))} disabled={orderItems.length === 1} aria-label={t("mfg_remove_item")} className="h-8 w-8 shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setOrderItems((p) => [...p, { name: "", quantity: "", unit: "" }])}>
                <Plus size={13} />
                {t("mfg_add_item")}
              </Button>
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

              {detail.items.length > 0 && (
                <div className="rounded-xl border bg-muted/20 p-3 space-y-1">
                  {detail.items.map((item, i) => (
                    <p key={i} className="text-sm flex items-center gap-2">
                      <span className="font-semibold">{item.name}</span>
                      <span className="text-muted-foreground text-xs" dir="ltr">{item.quantity} {item.unit}</span>
                    </p>
                  ))}
                </div>
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
