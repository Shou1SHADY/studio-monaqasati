"use client"

// Departments & capacity — the chain the workshop runs on. Capacity is the
// number a foreman understands (workers × hours a day); queues and achievable
// dates fall out of it. Adding, reordering and deleting departments lives here
// too, and deleting one that holds work — or that a product route runs
// through — is refused outright: where would its quantities go?

import { Fragment, useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { ArrowDown, ArrowUp, Factory, ListChecks, Loader2, Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { MFG_DEPARTMENTS, type MfgDepartment } from "@/lib/manufacturing"
import { deptCapacity, stationQueueDays, type MfgProduct } from "@/lib/manufacturing-engine"
import type { WorkOrderV2 } from "@/lib/manufacturing-writes"
import { cardsAtDepartment, type OrderView } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { queueTone } from "./MfgPrdBits"
import { updateDepartmentCapacity } from "./MfgProductsView"
import { MfgChip, MfgEffects, MfgField, MfgFormModal, MfgNote, MfgPanel, MfgPill, departmentIcon, fmtMoney, fmtQty } from "./ui/MfgUi"

/** Orders holding quantities at a department right now — v2 orders by their
 * computed in-hand quantity, legacy stage-flow orders by their current stage. */
export function ordersInHand(departmentId: string, views: OrderView[], orders: WorkOrderV2[]): number {
  const ids = new Set(cardsAtDepartment(views, departmentId).map((c) => c.view.id))
  for (const o of orders) {
    if (o.productId || o.status !== "open") continue
    if (o.stages?.[o.currentStageIndex]?.departmentId === departmentId) ids.add(o.id)
  }
  return ids.size
}

export interface DepartmentDeleteGuard {
  orders: number
  products: number
}

/** Why a department may not be deleted — null when nothing depends on it. */
export function departmentDeleteGuard(
  departmentId: string,
  src: { views: OrderView[]; orders: WorkOrderV2[]; products: MfgProduct[] }
): DepartmentDeleteGuard | null {
  const orders = ordersInHand(departmentId, src.views, src.orders)
  const products = src.products.filter((p) => (p.route || []).some((r) => r.departmentId === departmentId)).length
  return orders || products ? { orders, products } : null
}

interface CapacityDraft {
  workers: string
  hoursPerDay: string
  hourlyRate: string
}

export function MfgSetDepartments() {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms } = ui
  const firestore = useFirestore()
  const { toast } = useToast()
  const canEdit = perms.canManage
  const timeOn = data.settings.features.time
  const checklistsOn = data.settings.features.checklists
  const showRate = timeOn && perms.seesMoney

  const [drafts, setDrafts] = useState<Record<string, CapacityDraft>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [refusal, setRefusal] = useState<{ name: string; guard: DepartmentDeleteGuard } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<MfgDepartment | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [openChecklist, setOpenChecklist] = useState<string | null>(null)

  const departments = data.departments
  const inHand = useMemo(
    () => new Map(departments.map((d) => [d.id, ordersInHand(d.id, ui.views, data.orders)])),
    [departments, ui.views, data.orders]
  )

  const draftOf = (d: MfgDepartment): CapacityDraft =>
    drafts[d.id] || {
      workers: String(d.workers ?? 1),
      hoursPerDay: String(d.hoursPerDay ?? 8),
      hourlyRate: d.hourlyRate == null ? "" : String(d.hourlyRate),
    }

  const fail = (err: unknown) => {
    console.error(err)
    toast({ title: t("mfg_save_error"), variant: "destructive" })
  }

  const saveCapacity = async (d: MfgDepartment) => {
    const row = draftOf(d)
    const workers = Number(row.workers)
    const hours = Number(row.hoursPerDay)
    const rate = row.hourlyRate.trim() === "" ? null : Number(row.hourlyRate)
    if (!(workers >= 1) || !(hours >= 1 && hours <= 24) || (rate != null && !(rate >= 0))) {
      toast({ title: t("mfg3_set_err_capacity"), variant: "destructive" })
      return
    }
    setSavingId(d.id)
    try {
      await updateDepartmentCapacity(firestore, d.id, {
        workers: Math.round(workers),
        hoursPerDay: hours,
        ...(showRate ? { hourlyRate: rate } : {}),
      })
      setDrafts((m) => {
        const rest = { ...m }
        delete rest[d.id]
        return rest
      })
      toast({ title: t("mfg2_set_saved_toast") })
    } catch (err) {
      fail(err)
    } finally {
      setSavingId(null)
    }
  }

  const toggleOnSite = async (d: MfgDepartment, onSite: boolean) => {
    try {
      await updateDepartmentCapacity(firestore, d.id, { onSite })
      toast({ title: t("mfg2_set_saved_toast") })
    } catch (err) {
      fail(err)
    }
  }

  const move = async (index: number, dir: -1 | 1) => {
    const a = departments[index]
    const b = departments[index + dir]
    if (!firestore || !a || !b || moving) return
    setMoving(true)
    try {
      if (a.order !== b.order) {
        await updateDoc(doc(firestore, MFG_DEPARTMENTS, a.id), { order: b.order })
        await updateDoc(doc(firestore, MFG_DEPARTMENTS, b.id), { order: a.order })
      } else {
        // Two departments sharing a position can't be swapped by value —
        // renumber the whole chain with the move applied.
        const ids = departments.map((d) => d.id)
        ;[ids[index], ids[index + dir]] = [ids[index + dir], ids[index]]
        await Promise.all(ids.map((id, i) => updateDoc(doc(firestore, MFG_DEPARTMENTS, id), { order: i + 1 })))
      }
    } catch (err) {
      fail(err)
    } finally {
      setMoving(false)
    }
  }

  const askDelete = (d: MfgDepartment) => {
    const guard = departmentDeleteGuard(d.id, { views: ui.views, orders: data.orders, products: data.products })
    if (guard) {
      setRefusal({ name: d.name, guard })
      toast({ title: t("mfg3_set_delete_refused_title", { name: d.name }), variant: "destructive" })
      return
    }
    setRefusal(null)
    setConfirmDelete(d)
  }

  const doDelete = async () => {
    if (!firestore || !confirmDelete || deleting) return
    // Re-check at the moment of deleting: an order may have arrived meanwhile.
    const guard = departmentDeleteGuard(confirmDelete.id, { views: ui.views, orders: data.orders, products: data.products })
    if (guard) {
      setRefusal({ name: confirmDelete.name, guard })
      setConfirmDelete(null)
      return
    }
    setDeleting(true)
    try {
      await deleteDoc(doc(firestore, MFG_DEPARTMENTS, confirmDelete.id))
      toast({ title: t("mfg3_set_dept_deleted_toast", { name: confirmDelete.name }) })
      setConfirmDelete(null)
    } catch (err) {
      fail(err)
    } finally {
      setDeleting(false)
    }
  }

  const colCount = 3 + (showRate ? 1 : 0) + (timeOn ? 1 : 0) + (checklistsOn ? 1 : 0) + (canEdit ? 1 : 0)

  return (
    <MfgPanel
      icon={Factory}
      title={t("mfg2_set_capacity_title")}
      subtitle={timeOn ? t("mfg2_set_capacity_hint") : t("mfg3_set_capacity_hint_time_off")}
      count={departments.length}
      action={
        canEdit ? (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setShowNew(true)}>
            <Plus size={14} aria-hidden="true" /> {t("mfg3_set_new_department")}
          </Button>
        ) : undefined
      }
    >
      {departments.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t("mfg3_set_no_departments")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-bold text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 text-start">{t("mfg3_set_col_department")}</th>
                <th scope="col" className="px-3 py-2.5 text-start">{timeOn ? t("mfg3_set_col_capacity") : t("mfg2_set_workers")}</th>
                {showRate && <th scope="col" className="px-3 py-2.5 text-start">{t("mfg2_set_rate")}</th>}
                <th scope="col" className="px-3 py-2.5 text-start">{t("mfg2_on_site")}</th>
                {timeOn && <th scope="col" className="px-3 py-2.5 text-start">{t("mfg3_set_col_queue")}</th>}
                {checklistsOn && <th scope="col" className="px-3 py-2.5 text-start">{t("mfg3_set_col_checklist")}</th>}
                {canEdit && <th scope="col" className="px-4 py-2.5 text-end">{t("mfg3_set_col_actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {departments.map((d, i) => {
                const row = draftOf(d)
                const dirty = !!drafts[d.id]
                const held = inHand.get(d.id) || 0
                const Icon = departmentIcon(d.name, d.onSite)
                const cap = deptCapacity({ workers: Number(row.workers) || 1, hoursPerDay: Number(row.hoursPerDay) || 8 })
                const days = stationQueueDays(data.scheduleInputs, d)
                const items = d.checklist || []
                const setRow = (patch: Partial<CapacityDraft>) => setDrafts((m) => ({ ...m, [d.id]: { ...row, ...patch } }))
                return (
                  <Fragment key={d.id}>
                    <tr className="border-b border-border/60 align-middle last:border-b-0">
                      <th scope="row" className="px-4 py-2.5 text-start font-normal">
                        <span className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
                            <Icon size={15} aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-bold text-foreground" dir="auto">
                              <span className="tabular-nums">{i + 1}.</span> {d.name}
                            </span>
                            <span className={cn("block text-[11px]", held ? "font-semibold text-warning" : "text-muted-foreground")}>
                              {held ? t("mfg3_set_orders_in_hand", { count: held }) : t("mfg3_set_idle")}
                            </span>
                          </span>
                        </span>
                      </th>
                      <td className="px-3 py-2.5">
                        {canEdit ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Input
                              type="number"
                              inputMode="numeric"
                              min="1"
                              aria-label={t("mfg3_set_workers_for", { name: d.name })}
                              className="h-8 w-16 text-xs"
                              value={row.workers}
                              onChange={(e) => setRow({ workers: e.target.value })}
                            />
                            {timeOn && (
                              <>
                                <span className="text-muted-foreground" aria-hidden="true">×</span>
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min="1"
                                  max="24"
                                  aria-label={t("mfg3_set_hours_for", { name: d.name })}
                                  className="h-8 w-16 text-xs"
                                  value={row.hoursPerDay}
                                  onChange={(e) => setRow({ hoursPerDay: e.target.value })}
                                />
                                <span className="whitespace-nowrap font-semibold tabular-nums text-foreground">= {t("mfg2_set_capacity_value", { hours: fmtQty(cap) })}</span>
                              </>
                            )}
                          </span>
                        ) : timeOn ? (
                          <span>
                            <b className="tabular-nums text-foreground">{t("mfg2_set_capacity_value", { hours: fmtQty(cap) })}</b>
                            <span className="ms-1.5 text-[11px] text-muted-foreground" dir="ltr">
                              {fmtQty(d.workers ?? 1)}×{fmtQty(d.hoursPerDay ?? 8)}
                            </span>
                          </span>
                        ) : (
                          <b className="tabular-nums text-foreground">{fmtQty(d.workers ?? 1)}</b>
                        )}
                      </td>
                      {showRate && (
                        <td className="px-3 py-2.5">
                          {canEdit ? (
                            <Input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              aria-label={t("mfg3_set_rate_for", { name: d.name })}
                              placeholder={t("mfg2_empty_means_unknown")}
                              className="h-8 w-24 text-xs"
                              value={row.hourlyRate}
                              onChange={(e) => setRow({ hourlyRate: e.target.value })}
                            />
                          ) : d.hourlyRate == null ? (
                            <span className="text-warning">{t("mfg2_cost_unknown")}</span>
                          ) : (
                            <span className="tabular-nums text-foreground">{fmtMoney(d.hourlyRate)} ﷼</span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        {canEdit ? (
                          <Switch checked={!!d.onSite} onCheckedChange={(v) => toggleOnSite(d, v)} aria-label={t("mfg3_set_on_site_for", { name: d.name })} />
                        ) : d.onSite ? (
                          <MfgChip tone="info">{t("mfg2_on_site")}</MfgChip>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {timeOn && (
                        <td className="px-3 py-2.5">
                          <MfgPill tone={queueTone(days)}>{t("mfg2_queue_days", { days: fmtQty(days) })}</MfgPill>
                        </td>
                      )}
                      {checklistsOn && (
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => setOpenChecklist((cur) => (cur === d.id ? null : d.id))}
                            aria-expanded={openChecklist === d.id}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-cta hover:bg-cta/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ListChecks size={14} aria-hidden="true" />
                            {t("mfg3_set_checklist_items", { count: items.length })}
                          </button>
                        </td>
                      )}
                      {canEdit && (
                        <td className="px-4 py-2.5">
                          <span className="flex items-center justify-end gap-0.5">
                            {dirty && (
                              <Button size="sm" className="me-1 h-8 gap-1 text-[11px]" disabled={savingId === d.id} onClick={() => saveCapacity(d)}>
                                {savingId === d.id && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                                {t("mfg2_save")}
                              </Button>
                            )}
                            <IconButton label={t("mfg3_set_move_up", { name: d.name })} disabled={i === 0 || moving} onClick={() => move(i, -1)}>
                              <ArrowUp size={14} aria-hidden="true" />
                            </IconButton>
                            <IconButton label={t("mfg3_set_move_down", { name: d.name })} disabled={i === departments.length - 1 || moving} onClick={() => move(i, 1)}>
                              <ArrowDown size={14} aria-hidden="true" />
                            </IconButton>
                            <IconButton label={t("mfg3_set_delete_department", { name: d.name })} tone="bad" onClick={() => askDelete(d)}>
                              <Trash2 size={14} aria-hidden="true" />
                            </IconButton>
                          </span>
                        </td>
                      )}
                    </tr>
                    {checklistsOn && openChecklist === d.id && (
                      <tr className="border-b border-border/60 bg-muted/20">
                        <td colSpan={colCount} className="px-4 py-3">
                          <ChecklistEditor department={d} canEdit={canEdit} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2 border-t border-border/60 px-4 py-3">
        {refusal && (
          <MfgNote tone="bad" title={t("mfg3_set_delete_refused_title", { name: refusal.name })}>
            <span className="block">
              {refusal.guard.orders > 0 && t("mfg3_set_delete_refused_orders", { count: refusal.guard.orders })}
              {refusal.guard.orders > 0 && refusal.guard.products > 0 && " "}
              {refusal.guard.products > 0 && t("mfg3_set_delete_refused_products", { count: refusal.guard.products })}
            </span>
          </MfgNote>
        )}
        <MfgNote tone="warn">{t("mfg3_set_delete_rule")}</MfgNote>
      </div>

      {confirmDelete && (
        <MfgFormModal
          open
          onClose={() => setConfirmDelete(null)}
          icon={Trash2}
          title={t("mfg3_set_delete_title", { name: confirmDelete.name })}
          busy={deleting}
          confirmTone="destructive"
          confirmLabel={t("mfg3_set_delete_confirm")}
          onConfirm={doDelete}
        >
          <MfgEffects
            items={[
              { text: t("mfg3_set_delete_effect_free") },
              { text: t("mfg3_set_delete_effect_chain") },
              (confirmDelete.checklist?.length || 0) > 0 && { text: t("mfg3_set_delete_effect_checklist", { count: confirmDelete.checklist!.length }) },
            ]}
          />
        </MfgFormModal>
      )}

      {showNew && <NewDepartmentForm onClose={() => setShowNew(false)} />}
    </MfgPanel>
  )
}

function IconButton({ label, disabled, onClick, tone, children }: { label: string; disabled?: boolean; onClick: () => void; tone?: "bad"; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
        tone === "bad" ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

/** The department's checklist template — what a hand ticks, signed and timed,
 * before handing over. Keys stay stable so ticks already on orders keep meaning. */
function ChecklistEditor({ department, canEdit }: { department: MfgDepartment; canEdit: boolean }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const items = department.checklist || []

  const save = async (next: Array<{ key: string; label: string }>, done: string) => {
    setBusy(true)
    try {
      await updateDepartmentCapacity(firestore, department.id, { checklist: next })
      toast({ title: done })
      return true
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    const text = label.trim()
    if (!text || busy) return
    if (items.some((it) => it.label.trim() === text)) {
      toast({ title: t("mfg3_set_checklist_duplicate"), variant: "destructive" })
      return
    }
    const key = `c${Date.now().toString(36)}`
    if (await save([...items, { key, label: text }], t("mfg2_checklist_toast"))) setLabel("")
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">{t("mfg3_set_checklist_hint", { name: department.name })}</p>
      {items.length === 0 ? (
        <p className="text-[11px] font-semibold text-muted-foreground">{t("mfg3_set_checklist_empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <li key={it.key} className="inline-flex items-center gap-1 rounded-lg border bg-white py-1 pe-1 ps-2.5 text-[11px] font-semibold text-foreground">
              <span dir="auto">{it.label}</span>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save(items.filter((x) => x.key !== it.key), t("mfg2_checklist_toast"))}
                  aria-label={t("mfg3_set_checklist_remove", { label: it.label })}
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex max-w-md items-center gap-2">
          <Input
            dir="auto"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder={t("mfg3_set_checklist_placeholder")}
            aria-label={t("mfg3_set_checklist_placeholder")}
            className="h-8 text-xs"
          />
          <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 text-xs" disabled={busy || !label.trim()} onClick={add}>
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
            {t("mfg3_set_checklist_add")}
          </Button>
        </div>
      )}
    </div>
  )
}

function NewDepartmentForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { data, perms } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [workers, setWorkers] = useState("2")
  const [hours, setHours] = useState("8")
  const [rate, setRate] = useState("")
  const [onSite, setOnSite] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const w = Number(workers)
  const h = Number(hours)
  const r = rate.trim() === "" ? null : Number(rate)
  const cap = deptCapacity({ workers: w || 1, hoursPerDay: h || 8 })

  const submit = async () => {
    if (!firestore || busy) return
    if (!name.trim()) return setError(t("mfg3_set_err_dept_name"))
    if (data.departments.some((d) => d.name.trim() === name.trim())) return setError(t("mfg3_set_err_dept_duplicate"))
    if (!(w >= 1) || !(h >= 1 && h <= 24) || (r != null && !(r >= 0))) return setError(t("mfg3_set_err_capacity"))
    setError(null)
    setBusy(true)
    try {
      await addDoc(collection(firestore, MFG_DEPARTMENTS), {
        organizationId: data.orgId,
        name: name.trim(),
        order: data.departments.reduce((max, d) => Math.max(max, Number(d.order) || 0), 0) + 1,
        workers: Math.round(w),
        hoursPerDay: h,
        hourlyRate: r,
        onSite,
        checklist: [],
        createdAt: serverTimestamp(),
      })
      toast({ title: t("mfg3_set_dept_added_toast", { name: name.trim(), hours: fmtQty(cap) }) })
      onClose()
    } catch (err) {
      console.error(err)
      setError(t("mfg_save_error"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Plus}
      title={t("mfg3_set_new_department")}
      subtitle={t("mfg3_set_new_department_sub")}
      error={error}
      busy={busy}
      confirmLabel={t("mfg3_set_add_department")}
      onConfirm={submit}
    >
      <MfgField label={t("mfg3_set_field_dept_name")} required htmlFor="mfg-dept-name" hint={t("mfg3_set_field_dept_name_hint")}>
        <Input id="mfg-dept-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
      </MfgField>
      <div className={cn("grid grid-cols-1 gap-3", perms.seesMoney ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <MfgField label={t("mfg2_set_workers")} htmlFor="mfg-dept-workers">
          <Input id="mfg-dept-workers" type="number" inputMode="numeric" min="1" value={workers} onChange={(e) => setWorkers(e.target.value)} />
        </MfgField>
        <MfgField label={t("mfg2_set_hours")} htmlFor="mfg-dept-hours">
          <Input id="mfg-dept-hours" type="number" inputMode="decimal" min="1" max="24" value={hours} onChange={(e) => setHours(e.target.value)} />
        </MfgField>
        {perms.seesMoney && (
          <MfgField label={t("mfg2_set_rate")} htmlFor="mfg-dept-rate" hint={t("mfg3_set_rate_hint")}>
            <Input id="mfg-dept-rate" type="number" inputMode="decimal" min="0" value={rate} placeholder={t("mfg2_empty_means_unknown")} onChange={(e) => setRate(e.target.value)} />
          </MfgField>
        )}
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-xs">
        <Checkbox checked={onSite} onCheckedChange={(v) => setOnSite(!!v)} className="mt-0.5" />
        <span>
          <span className="block font-bold text-foreground">{t("mfg3_set_field_on_site")}</span>
          <span className="block text-[11px] text-muted-foreground">{t("mfg3_set_field_on_site_hint")}</span>
        </span>
      </label>
      <MfgNote tone="info" title={t("mfg3_set_new_capacity", { workers: fmtQty(w || 0), hours: fmtQty(h || 0), capacity: fmtQty(cap) })}>
        {t("mfg3_set_new_department_note")}
      </MfgNote>
    </MfgFormModal>
  )
}
