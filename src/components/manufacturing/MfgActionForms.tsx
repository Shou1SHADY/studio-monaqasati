"use client"

// Every decision a work order takes, as one form each. The shape is always
// the same: the facts the decision rests on, the inputs, a banner that says —
// before the click — whether it will go through and what is left over, and a
// "what will happen" list. Validation is computed, not advisory: a quantity
// that exceeds what a department holds disables nothing silently, it names the
// limit.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import {
  AlertTriangle,
  Boxes,
  Check,
  ClipboardCheck,
  Eye,
  Factory,
  FolderKanban,
  PackageCheck,
  PencilRuler,
  Play,
  Ruler,
  Trash2,
  Truck,
  Undo2,
  Warehouse,
  Zap,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useOrgStock, stockKey } from "@/hooks/useOrgStock"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import {
  brokenUndecided,
  exitIndex,
  materialNeed,
  materialReceived,
  materialState,
  pendingAt,
  possibleForDays,
  round2,
  standardCost,
  unitSunkCost,
} from "@/lib/manufacturing-engine"
import {
  approveScrapV2,
  confirmWorkOrderNoteV2,
  decideBreakage,
  issueWorkOrderNoteV2,
  qcDecision,
  recordDrawingApprovalV2,
  recordMeasurementV2,
  recordSlabApprovalV2,
  releaseWorkOrderV2,
  reportStageOutput,
  requestStageMaterials,
  rushWorkOrderV2,
  toggleChecklistItem,
  toNoteSlice,
} from "@/lib/manufacturing-writes"
import { inSegment, type OrderView } from "@/lib/manufacturing-view"
import { useMfgUi, type OrderAction } from "./MfgUiContext"
import { departmentNameOf, sourceNameOf } from "./MfgOrderBits"
import {
  MfgChoiceCards,
  MfgEffects,
  MfgField,
  MfgFormModal,
  MfgNote,
  MfgReview,
  fmtMoney,
  fmtQty,
  useMfgDate,
} from "./ui/MfgUi"

const num = (v: string) => Number(v) || 0

/** Error codes thrown by the writes → their messages. */
function errKey(msg: string): string {
  switch (msg) {
    case "more_than_in_hand":
      return "mfg2_err_more_than_in_hand"
    case "more_than_rejected":
      return "mfg2_err_more_than_rejected"
    case "more_than_ready":
      return "mfg2_err_more_than_ready"
    case "more_than_shipped":
      return "mfg2_err_more_than_shipped"
    case "insufficient_stock":
      return "mfg2_err_insufficient_stock"
    case "reason_required":
      return "mfg2_err_reason_required"
    case "driver_required":
      return "mfg2_err_driver_required"
    case "quantity_required":
      return "mfg2_err_quantity_required"
    case "by_required":
    case "lot_required":
      return "mfg2_err_name_required"
    case "blocked":
      return "mfg2_err_blocked"
    default:
      return "mfg_save_error"
  }
}

export function MfgActionForms({ orderId, action, onClose }: { orderId: string; action: OrderAction; onClose: () => void }) {
  const ui = useMfgUi()
  const view = ui.viewById.get(orderId)
  if (!view) return null
  switch (action.kind) {
    case "output":
      return <OutputForm view={view} index={action.index} onClose={onClose} />
    case "qc":
      return <QcForm view={view} index={action.index} onClose={onClose} />
    case "materials":
      return <MaterialsForm view={view} departmentId={action.departmentId} onClose={onClose} />
    case "note":
      return <NoteForm view={view} onClose={onClose} />
    case "confirmNote":
      return <ConfirmNoteForm view={view} noteId={action.noteId} onClose={onClose} />
    case "breakage":
      return <BreakageForm view={view} onClose={onClose} />
    case "measurement":
      return <MeasurementForm view={view} onClose={onClose} />
    case "slab":
      return <SlabForm view={view} onClose={onClose} />
    case "drawing":
      return <DrawingForm view={view} onClose={onClose} />
    case "release":
      return <ReleaseForm view={view} onClose={onClose} />
    case "rush":
      return <RushForm view={view} onClose={onClose} />
    case "approveScrap":
      return <ApproveScrapForm view={view} scrapId={action.scrapId} onClose={onClose} />
  }
}

/** Shared submit plumbing: busy flag, toast on success, mapped error on failure. */
function useSubmit(onClose: () => void) {
  const t = useTranslations("Portal.Shared")
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, success: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      toast({ title: success })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(errKey((err as Error).message)), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function orderLabel(v: OrderView): string {
  return `#${v.number} — ${v.product.name}`
}

// ---------------------------------------------------------------------------
// Report output & hand over
// ---------------------------------------------------------------------------

function OutputForm({ view, index, onClose }: { view: OrderView; index: number; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const { data } = ui
  const { busy, run } = useSubmit(onClose)
  const [done, setDone] = useState("")
  const [rejected, setRejected] = useState("")
  const [hours, setHours] = useState("")
  const [showErrors, setShowErrors] = useState(false)

  const route = view.product.route
  const step = route[index]
  const inHand = pendingAt(view.slice, route, index, view.noteSlices)
  const deptName = departmentNameOf(data.departments, view, index)
  const next = step?.onSite
    ? t("mfg3_out_next_installed")
    : index === exitIndex(route)
      ? t("mfg3_out_next_ready")
      : departmentNameOf(data.departments, view, index + 1)
  const d = num(done)
  const r = num(rejected)
  const over = d + r > inHand + 1e-9
  const left = round2(inHand - d - r)
  const ms = materialState(view.slice, view.product, route, index)
  const materialsShort = ms !== "none" && ms !== "complete"
  const dept = data.departments.find((x) => x.id === step?.departmentId)
  const checklist = data.settings.features.checklists ? dept?.checklist || [] : []
  const marks = view.slice.checklists?.[step?.departmentId || ""] || {}
  const marked = checklist.filter((c) => marks[c.key]).length
  const stdHours = round2((step?.hoursPerUnit || 0) * (d || inHand))

  const error = !showErrors ? null : d + r <= 0 ? t("mfg3_out_err_empty") : over ? t("mfg3_out_err_over", { qty: fmtQty(inHand) }) : null

  const submit = () => {
    setShowErrors(true)
    if (!firestore || d + r <= 0 || over) return
    void run(
      () =>
        reportStageOutput(firestore, {
          order: view.order,
          product: view.product,
          notes: view.noteSlices,
          index,
          done: d,
          rejected: r,
          hours: num(hours),
          actor: data.actor,
        }),
      t("mfg3_out_toast", { dept: deptName, qty: fmtQty(d), next })
    )
  }

  const [toggling, setToggling] = useState<string | null>(null)
  const toggle = async (key: string) => {
    if (!firestore || toggling) return
    setToggling(key)
    try {
      await toggleChecklistItem(firestore, { order: view.order, departmentId: step.departmentId, itemKey: key, actor: data.actor })
    } catch (err) {
      console.error(err)
    } finally {
      setToggling(null)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Factory}
      title={t("mfg3_out_title")}
      subtitle={t("mfg3_out_subtitle")}
      busy={busy}
      error={error}
      onConfirm={submit}
      confirmLabel={t("mfg3_out_confirm")}
    >
      <MfgReview
        rows={[
          [t("mfg3_f_department"), `${deptName} — ${orderLabel(view)}`],
          [t("mfg3_out_in_hand"), `${fmtQty(inHand)} ${view.unit}`],
          [t("mfg3_out_goes_to"), next],
          data.settings.features.time && [t("mfg3_out_std_time"), t("mfg3_out_std_time_value", { perUnit: fmtQty(step?.hoursPerUnit || 0), hours: fmtQty(stdHours) })],
        ]}
      />
      <div className={cn("grid grid-cols-1 gap-3", data.settings.features.time ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <MfgField label={t("mfg3_out_good")} required htmlFor="out-done">
          <Input
            id="out-done"
            inputMode="decimal"
            dir="ltr"
            value={done}
            placeholder={fmtQty(inHand)}
            onChange={(e) => setDone(sanitizeDecimalInput(e.target.value))}
            className={cn(over && "border-destructive ring-1 ring-destructive")}
          />
        </MfgField>
        <MfgField label={t("mfg3_out_rejected")} hint={t("mfg3_out_rejected_hint")} htmlFor="out-rej">
          <Input id="out-rej" inputMode="decimal" dir="ltr" value={rejected} onChange={(e) => setRejected(sanitizeDecimalInput(e.target.value))} />
        </MfgField>
        {data.settings.features.time && (
          <MfgField label={t("mfg3_out_hours")} hint={t("mfg3_out_hours_hint")} htmlFor="out-hours">
            <Input id="out-hours" inputMode="decimal" dir="ltr" value={hours} onChange={(e) => setHours(sanitizeDecimalInput(e.target.value))} />
          </MfgField>
        )}
      </div>
      {d + r > 0 &&
        (over ? (
          <MfgNote tone="bad">{t("mfg3_out_err_over", { qty: fmtQty(inHand) })}</MfgNote>
        ) : left > 0 ? (
          <MfgNote tone="warn">{t("mfg3_out_partial", { qty: fmtQty(left), unit: view.unit })}</MfgNote>
        ) : (
          <MfgNote tone="ok">{t("mfg3_out_full")}</MfgNote>
        ))}
      {materialsShort && <MfgNote tone="warn" title={t(`mfg3_mat_state_${ms}`)}>{t("mfg3_out_materials_short")}</MfgNote>}
      {checklist.length > 0 && (
        <MfgField
          label={
            <span className="flex items-center gap-2">
              <ClipboardCheck size={13} aria-hidden="true" />
              {t("mfg3_out_checklist", { dept: deptName })}
              <span className={cn("text-[11px]", marked === checklist.length ? "text-success" : "text-warning")}>
                {t("mfg3_count_of", { done: marked, total: checklist.length })}
              </span>
            </span>
          }
          hint={marked < checklist.length ? t("mfg3_out_checklist_hint", { count: checklist.length - marked }) : undefined}
        >
          <div className="space-y-1.5">
            {checklist.map((c) => {
              const m = marks[c.key]
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={!ui.perms.canWork || !!toggling}
                  onClick={() => void toggle(c.key)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg border bg-white px-3 py-2 text-start text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    m ? "border-success/40" : "hover:border-slate-300"
                  )}
                >
                  <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", m ? "border-success bg-success text-white" : "border-slate-300")}>
                    {m && <Check size={11} />}
                  </span>
                  <span className="flex-1 font-semibold">{c.label}</span>
                  <span className="text-[10px] text-muted-foreground">{m ? m.by : t("mfg3_not_logged")}</span>
                </button>
              )
            })}
          </div>
        </MfgField>
      )}
      <MfgEffects
        items={[
          { text: t("mfg3_out_eff_moves", { next }) },
          r > 0 && { text: t("mfg3_out_eff_rejected", { qty: fmtQty(r) }) },
          data.settings.features.time && { text: t("mfg3_out_eff_hours") },
        ]}
      />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// QC decision: rework or scrap
// ---------------------------------------------------------------------------

function QcForm({ view, index, onClose }: { view: OrderView; index: number; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const { data, perms } = ui
  const { busy, run } = useSubmit(onClose)
  const route = view.product.route
  const held = view.slice.progress[index]?.rejected || 0
  const [kind, setKind] = useState<"rework" | "scrap">("rework")
  const [qty, setQty] = useState(String(held))
  const [toIndex, setToIndex] = useState(String(Math.max(0, index - 1)))
  const [reason, setReason] = useState("")
  const [showErrors, setShowErrors] = useState(false)

  const q = num(qty)
  const unitValue = unitSunkCost(view.product, data.departments, data.settings, index)
  const value = round2(unitValue * q)
  const aboveLimit = kind === "scrap" && value > data.settings.scrapApprovalLimit && !perms.canCost
  const deptName = departmentNameOf(data.departments, view, index)
  const back = route[Number(toIndex)]

  const errorText = q <= 0 ? t("mfg3_err_qty") : q > held ? t("mfg3_qc_err_over", { qty: fmtQty(held) }) : !reason.trim() ? t("mfg3_qc_err_reason") : null
  const submit = () => {
    setShowErrors(true)
    if (!firestore || errorText) return
    void run(
      () =>
        qcDecision(firestore, {
          order: view.order,
          product: view.product,
          departments: data.departments,
          settings: data.settings,
          index,
          kind,
          quantity: q,
          toIndex: Number(toIndex),
          reason: reason.trim(),
          canApproveAny: perms.canCost,
          actor: data.actor,
          organizationId: data.orgId,
        }),
      kind === "rework"
        ? t("mfg3_qc_toast_rework", { qty: fmtQty(q), dept: back ? departmentNameOf(data.departments, view, Number(toIndex)) : "" })
        : aboveLimit
          ? t("mfg3_qc_toast_scrap_pending", { qty: fmtQty(q) })
          : t("mfg3_qc_toast_scrap", { qty: fmtQty(q) })
    )
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={AlertTriangle}
      title={t("mfg3_qc_title")}
      subtitle={t("mfg3_qc_subtitle")}
      busy={busy}
      error={showErrors ? errorText : null}
      onConfirm={submit}
    >
      <MfgReview
        rows={[
          [t("mfg3_qc_held"), t("mfg3_qc_held_value", { qty: fmtQty(held), unit: view.unit, dept: deptName, order: orderLabel(view) })],
          perms.seesMoney && [t("mfg3_qc_sunk"), `${fmtMoney(unitValue)} ﷼`],
        ]}
      />
      <MfgChoiceCards
        value={kind}
        onChange={setKind}
        options={[
          { id: "rework", icon: Undo2, title: t("mfg3_qc_rework"), description: t("mfg3_qc_rework_desc") },
          { id: "scrap", icon: Trash2, title: t("mfg3_qc_scrap"), description: t("mfg3_qc_scrap_desc") },
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MfgField label={t("mfg3_f_quantity")} required hint={t("mfg3_qc_held_hint", { qty: fmtQty(held) })} htmlFor="qc-qty">
          <Input id="qc-qty" inputMode="decimal" dir="ltr" value={qty} onChange={(e) => setQty(sanitizeDecimalInput(e.target.value))} />
        </MfgField>
        {kind === "rework" ? (
          <MfgField label={t("mfg3_qc_back_to")}>
            <Select value={toIndex} onValueChange={setToIndex}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {route.slice(0, index + 1).map((r, i) => (
                  <SelectItem key={`${r.departmentId}_${i}`} value={String(i)}>
                    {departmentNameOf(data.departments, view, i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </MfgField>
        ) : (
          perms.seesMoney && (
            <MfgField label={t("mfg3_qc_value")} hint={t("mfg3_qc_value_hint")}>
              <div className="flex h-10 items-center rounded-md border bg-white px-3 text-sm font-bold tabular-nums" dir="ltr">
                {fmtMoney(value)} ﷼
              </div>
            </MfgField>
          )
        )}
      </div>
      <MfgField label={t("mfg3_f_reason")} required hint={t("mfg3_qc_reason_hint")} htmlFor="qc-reason">
        <Input id="qc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("mfg3_qc_reason_placeholder")} />
      </MfgField>
      {aboveLimit && (
        <MfgNote tone="bad" title={t("mfg3_qc_above_limit", { value: fmtMoney(value), limit: fmtMoney(data.settings.scrapApprovalLimit) })}>
          {t("mfg3_qc_above_limit_desc")}
        </MfgNote>
      )}
      {kind === "rework" ? (
        <MfgNote tone="warn">
          {t("mfg3_qc_rework_note", {
            hours: fmtQty(round2(q * (back?.hoursPerUnit || 0))),
            dept: back ? departmentNameOf(data.departments, view, Number(toIndex)) : "",
          })}
        </MfgNote>
      ) : (
        <MfgNote tone="warn">
          {t("mfg3_qc_scrap_note", { qty: fmtQty(Math.max(0, round2(view.quantity - view.scrapApproved - view.shortfall - q))), unit: view.unit })}
        </MfgNote>
      )}
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Request materials from the store
// ---------------------------------------------------------------------------

function MaterialsForm({ view, departmentId, onClose }: { view: OrderView; departmentId: string; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { data } = useMfgUi()
  const { busy, run } = useSubmit(onClose)
  const stores = data.warehouses.filter((w) => !w.isOutbound)
  const [warehouseId, setWarehouseId] = useState(stores.find((w) => w.isCentral)?.id || stores[0]?.id || "")
  const need = useMemo(() => materialNeed(view.slice, view.product, departmentId), [view.slice, view.product, departmentId])
  const [lines, setLines] = useState<Record<string, string>>(() =>
    Object.fromEntries(need.map((n) => [n.itemName, String(Math.max(0, round2(n.qty - materialReceived(view.slice, departmentId, n.itemName))))]))
  )
  const itemsQuery = useMemoFirebase(() => (firestore && warehouseId ? collection(firestore, "warehouses", warehouseId, "inventoryItems") : null), [firestore, warehouseId])
  const { data: itemsData } = useCollection(itemsQuery)
  const available = useMemo(() => {
    const m = new Map<string, number>()
    for (const row of (itemsData || []) as Array<{ name?: string; quantity?: number }>) {
      if (!row.name) continue
      m.set(stockKey(row.name), (m.get(stockKey(row.name)) || 0) + (Number(row.quantity) || 0))
    }
    return m
  }, [itemsData])
  const step = view.product.route.findIndex((r) => r.departmentId === departmentId)
  const deptName = step >= 0 ? departmentNameOf(data.departments, view, step) : departmentId
  const lot = view.slice.slabApproval?.lot || null
  const parsed = need.map((n) => ({ n, qty: num(lines[n.itemName] ?? "0"), avail: available.get(stockKey(n.itemName)) ?? 0 }))
  const short = itemsData ? parsed.filter((p) => p.qty > p.avail + 1e-9) : []
  const [showErrors, setShowErrors] = useState(false)
  const errorText = !warehouseId ? t("mfg3_mat_err_store") : parsed.every((p) => p.qty <= 0) ? t("mfg3_mat_err_empty") : null

  const submit = () => {
    setShowErrors(true)
    if (!firestore || errorText) return
    void run(
      () =>
        requestStageMaterials(firestore, {
          order: view.order,
          departmentId,
          warehouseId: warehouseId || null,
          lines: parsed.filter((p) => p.qty > 0).map((p) => ({ itemName: p.n.itemName, unit: p.n.unit, quantity: p.qty, lot: p.n.lotted ? lot : null })),
          actor: data.actor,
        }),
      t("mfg3_mat_toast", { dept: deptName })
    )
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Boxes}
      title={t("mfg3_mat_title")}
      subtitle={t("mfg3_mat_subtitle")}
      busy={busy}
      error={showErrors ? errorText : null}
      onConfirm={submit}
      confirmLabel={t("mfg3_mat_confirm")}
      size="lg"
    >
      <MfgReview
        rows={[
          [t("mfg3_mat_order_dept"), `${orderLabel(view)} — ${deptName}`],
          [t("mfg3_mat_from"), t("mfg3_mat_from_value")],
        ]}
      />
      <MfgField label={t("mfg3_mat_store")} required>
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger><SelectValue placeholder={t("mfg3_mat_store")} /></SelectTrigger>
          <SelectContent>
            {stores.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </MfgField>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="bg-muted/40 text-[11px] font-bold text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start">{t("mfg3_mat_item")}</th>
              <th className="w-32 px-3 py-2 text-start">{t("mfg3_f_quantity")}</th>
              <th className="w-28 px-3 py-2 text-end">{t("mfg3_mat_available")}</th>
            </tr>
          </thead>
          <tbody>
            {parsed.map(({ n, qty, avail }) => {
              const bad = !!itemsData && qty > avail + 1e-9
              return (
                <tr key={n.itemName} className="border-t">
                  <td className="px-3 py-2">
                    <span className="block font-semibold">{n.itemName}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {n.unit}
                      {n.withWaste && ` · ${t("mfg3_mat_waste", { net: fmtQty(n.net), waste: view.product.wastePercent })}`}
                      {n.lotted && lot && ` · ${t("mfg3_mat_lot", { lot })}`}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      inputMode="decimal"
                      dir="ltr"
                      value={lines[n.itemName] ?? ""}
                      onChange={(e) => setLines((m) => ({ ...m, [n.itemName]: sanitizeDecimalInput(e.target.value) }))}
                      className={cn("h-9 text-center", bad && "border-destructive ring-1 ring-destructive")}
                      aria-label={n.itemName}
                    />
                  </td>
                  <td className={cn("px-3 py-2 text-end font-bold tabular-nums", bad ? "text-destructive" : "text-success")} dir="ltr">
                    {itemsData ? fmtQty(avail) : "…"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {short.length > 0 && (
        <MfgNote tone="bad" title={t("mfg3_mat_short_title")}>
          {short.map((p) => t("mfg3_mat_short_line", { item: p.n.itemName, qty: fmtQty(round2(p.qty - p.avail)), unit: p.n.unit })).join(" · ")}
          <br />
          {t("mfg3_mat_short_action")}
        </MfgNote>
      )}
      <MfgEffects
        items={[
          { text: t("mfg3_mat_eff_raised") },
          { text: t("mfg3_mat_eff_release") },
          { text: t("mfg3_mat_eff_cost") },
          { text: t("mfg3_mat_eff_owner"), applies: false },
        ]}
      />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Delivery note: goods leave the workshop
// ---------------------------------------------------------------------------

function NoteForm({ view, onClose }: { view: OrderView; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { data } = useMfgUi()
  const { busy, run } = useSubmit(onClose)
  const projectStore = data.warehouses.find((w) => w.projectId && w.projectId === view.order.projectId)
  const central = data.warehouses.find((w) => w.isCentral)
  const [destId, setDestId] = useState(projectStore?.id || central?.id || data.warehouses[0]?.id || "")
  const [qty, setQty] = useState(String(view.ready))
  const [pieces, setPieces] = useState("")
  const [crates, setCrates] = useState("")
  const [driver, setDriver] = useState("")
  const [plate, setPlate] = useState("")
  const [noteText, setNoteText] = useState("")
  const [showErrors, setShowErrors] = useState(false)
  const dest = data.warehouses.find((w) => w.id === destId)
  const kind: "project" | "central" | "outbound" = dest?.isOutbound ? "outbound" : dest?.projectId ? "project" : "central"
  const q = num(qty)
  const errorText = !dest ? t("mfg3_note_err_dest") : q <= 0 ? t("mfg3_err_qty") : q > view.ready + 1e-9 ? t("mfg3_note_err_over", { qty: fmtQty(view.ready) }) : !driver.trim() ? t("mfg3_note_err_driver") : null
  const groups: Array<{ key: string; items: typeof data.warehouses }> = [
    { key: "mfg3_note_group_project", items: data.warehouses.filter((w) => w.projectId && !w.isOutbound) },
    { key: "mfg3_note_group_store", items: data.warehouses.filter((w) => !w.projectId && !w.isOutbound) },
    { key: "mfg3_note_group_outbound", items: data.warehouses.filter((w) => w.isOutbound) },
  ]

  const submit = () => {
    setShowErrors(true)
    if (!firestore || errorText || !dest) return
    void run(
      () =>
        issueWorkOrderNoteV2(firestore, {
          order: view.order,
          product: view.product,
          departments: data.departments,
          settings: data.settings,
          allNotes: view.noteSlices,
          quantity: q,
          destination: { warehouseId: dest.id, warehouseName: dest.name, kind, projectId: dest.projectId ?? null },
          pieces: num(pieces) || null,
          crates: num(crates) || null,
          driverName: driver.trim(),
          vehiclePlate: plate.trim() || null,
          note: noteText.trim() || null,
          actor: data.actor,
        }),
      t("mfg3_note_toast", { qty: fmtQty(q), unit: view.unit, dest: dest.name })
    )
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Truck}
      title={t("mfg3_note_title")}
      subtitle={t("mfg3_note_subtitle")}
      busy={busy}
      error={showErrors ? errorText : null}
      onConfirm={submit}
      confirmLabel={t("mfg3_note_confirm")}
    >
      <MfgReview
        rows={[
          [t("mfg3_note_ready"), `${fmtQty(view.ready)} ${view.unit} — ${view.product.name}`],
          [t("mfg3_f_order"), `#${view.number} · ${sourceNameOf(view, t)}`],
          view.slice.slabApproval?.lot && [t("mfg3_f_lot"), view.slice.slabApproval.lot],
        ]}
      />
      <MfgField label={t("mfg3_note_dest")} required>
        <Select value={destId} onValueChange={setDestId}>
          <SelectTrigger><SelectValue placeholder={t("mfg3_note_dest")} /></SelectTrigger>
          <SelectContent>
            {groups
              .filter((g) => g.items.length)
              .map((g) => (
                <SelectGroup key={g.key}>
                  <SelectLabel className="text-[10px] text-muted-foreground">{t(g.key)}</SelectLabel>
                  {g.items.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
          </SelectContent>
        </Select>
      </MfgField>
      {dest && (
        <MfgNote tone="info" icon={kind === "project" ? FolderKanban : Warehouse}>
          {t(`mfg3_note_dest_${kind}`)}
        </MfgNote>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MfgField label={t("mfg3_f_quantity")} required hint={t("mfg3_note_ready_hint", { qty: fmtQty(view.ready) })} htmlFor="note-qty">
          <Input id="note-qty" inputMode="decimal" dir="ltr" value={qty} onChange={(e) => setQty(sanitizeDecimalInput(e.target.value))} />
        </MfgField>
        <MfgField label={t("mfg3_note_pieces")} hint={t("mfg3_note_pieces_hint")} htmlFor="note-pieces">
          <Input id="note-pieces" inputMode="numeric" dir="ltr" value={pieces} onChange={(e) => setPieces(sanitizeDecimalInput(e.target.value))} />
        </MfgField>
        <MfgField label={t("mfg3_note_crates")} htmlFor="note-crates">
          <Input id="note-crates" inputMode="numeric" dir="ltr" value={crates} onChange={(e) => setCrates(sanitizeDecimalInput(e.target.value))} />
        </MfgField>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MfgField label={t("mfg3_note_driver")} required hint={t("mfg3_note_driver_hint")} htmlFor="note-driver">
          <Input id="note-driver" value={driver} onChange={(e) => setDriver(e.target.value)} />
        </MfgField>
        <MfgField label={t("mfg3_note_plate")} htmlFor="note-plate">
          <Input id="note-plate" value={plate} onChange={(e) => setPlate(e.target.value)} />
        </MfgField>
      </div>
      <MfgField label={t("mfg3_note_text")} hint={t("mfg3_note_text_hint")} htmlFor="note-text">
        <Input id="note-text" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
      </MfgField>
      {q > 0 && q < view.ready && <MfgNote tone="warn">{t("mfg3_note_partial", { qty: fmtQty(round2(view.ready - q)), unit: view.unit })}</MfgNote>}
      <MfgEffects
        items={[
          { text: t("mfg3_note_eff_numbered") },
          { text: t("mfg3_note_eff_transit") },
          { text: t("mfg3_note_eff_no_entry"), applies: false },
          { text: t(`mfg3_note_eff_receipt_${kind}`) },
        ]}
      />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Confirm a delivery note's receipt
// ---------------------------------------------------------------------------

function ConfirmNoteForm({ view, noteId, onClose }: { view: OrderView; noteId: string; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { data } = useMfgUi()
  const d = useMfgDate()
  const { busy, run } = useSubmit(onClose)
  const note = view.notes.find((n) => n.id === noteId)
  const [broken, setBroken] = useState("")
  const [text, setText] = useState("")
  const [showErrors, setShowErrors] = useState(false)
  if (!note) return null
  const b = num(broken)
  const net = round2(note.item.quantity - b)
  const errorText = b > note.item.quantity ? t("mfg3_recv_err_broken") : null
  const hasSite = view.product.route.some((r) => r.onSite)

  const submit = () => {
    setShowErrors(true)
    if (!firestore || errorText) return
    void run(
      () =>
        confirmWorkOrderNoteV2(firestore, {
          note,
          order: view.order,
          product: view.product,
          allNotes: view.notes.map((n) => ({ ...toNoteSlice(n), id: n.id })),
          brokenQuantity: b,
          receivedNote: text.trim() || null,
          actor: data.actor,
        }),
      b > 0 ? t("mfg3_recv_toast_broken", { note: note.noteNumber, qty: fmtQty(net), broken: fmtQty(b) }) : t("mfg3_recv_toast", { note: note.noteNumber, qty: fmtQty(net) })
    )
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={PackageCheck}
      title={t("mfg3_recv_title")}
      subtitle={t("mfg3_recv_subtitle")}
      busy={busy}
      error={showErrors ? errorText : null}
      onConfirm={submit}
      confirmLabel={t("mfg3_recv_confirm")}
    >
      <MfgReview
        rows={[
          [t("mfg3_recv_note"), `${note.noteNumber} — ${orderLabel(view)}`],
          [t("mfg3_note_dest"), note.toWarehouseName],
          [
            t("mfg3_recv_shipped"),
            [
              `${fmtQty(note.item.quantity)} ${note.item.unit}`,
              note.pieces ? t("mfg3_recv_pieces", { count: note.pieces }) : null,
              note.crates ? t("mfg3_recv_crates", { count: note.crates }) : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ],
          [t("mfg3_recv_left"), [d.short(note.sentAt), note.driverName, note.vehiclePlate].filter(Boolean).join(" · ")],
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MfgField label={t("mfg3_recv_broken")} hint={t("mfg3_recv_broken_hint")} htmlFor="recv-broken">
          <Input id="recv-broken" inputMode="decimal" dir="ltr" value={broken} placeholder="0" onChange={(e) => setBroken(sanitizeDecimalInput(e.target.value))} />
        </MfgField>
        <MfgField label={t("mfg3_recv_text")} htmlFor="recv-text">
          <Input id="recv-text" value={text} onChange={(e) => setText(e.target.value)} />
        </MfgField>
      </div>
      {b > 0 && b <= note.item.quantity && (
        <MfgNote tone="bad" title={t("mfg3_recv_broken_title", { qty: fmtQty(b), unit: note.item.unit })}>
          {t("mfg3_recv_broken_desc")}
        </MfgNote>
      )}
      <MfgEffects
        items={[
          { text: t("mfg3_recv_eff_counted", { qty: fmtQty(net), unit: note.item.unit }) },
          { text: t(note.toKind === "project" ? "mfg3_recv_eff_project" : "mfg3_recv_eff_stock") },
          { text: hasSite && note.toKind === "project" ? t("mfg3_recv_eff_install") : t("mfg3_recv_eff_ends") },
        ]}
      />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Transit breakage: re-make or declared shortfall
// ---------------------------------------------------------------------------

function BreakageForm({ view, onClose }: { view: OrderView; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { data, perms } = useMfgUi()
  const { busy, run } = useSubmit(onClose)
  const open = brokenUndecided(view.slice, view.noteSlices)
  const [kind, setKind] = useState<"remake" | "shortfall">("remake")
  const [qty, setQty] = useState(String(open))
  const [reason, setReason] = useState("")
  const [showErrors, setShowErrors] = useState(false)
  const q = num(qty)
  const std = standardCost(view.product, data.departments, data.settings, q)
  const errorText = q <= 0 ? t("mfg3_err_qty") : q > open + 1e-9 ? t("mfg3_brk_err_over", { qty: fmtQty(open) }) : !reason.trim() ? t("mfg3_brk_err_reason") : null

  const submit = () => {
    setShowErrors(true)
    if (!firestore || errorText) return
    void run(
      () => decideBreakage(firestore, { order: view.order, product: view.product, allNotes: view.noteSlices, kind, quantity: q, reason: reason.trim(), actor: data.actor }),
      kind === "remake" ? t("mfg3_brk_toast_remake", { qty: fmtQty(q) }) : t("mfg3_brk_toast_short", { qty: fmtQty(q) })
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={Undo2} title={t("mfg3_brk_title")} subtitle={t("mfg3_brk_subtitle")} busy={busy} error={showErrors ? errorText : null} onConfirm={submit}>
      <MfgReview
        rows={[
          [t("mfg3_brk_open"), `${fmtQty(open)} ${view.unit} — ${orderLabel(view)}`],
          perms.seesMoney && [t("mfg3_brk_std_cost"), t("mfg3_brk_std_cost_value", { value: fmtMoney(std.total), hours: fmtQty(std.hours) })],
        ]}
      />
      <MfgChoiceCards
        value={kind}
        onChange={setKind}
        options={[
          { id: "remake", icon: Factory, title: t("mfg3_brk_remake"), description: t("mfg3_brk_remake_desc") },
          { id: "shortfall", icon: AlertTriangle, title: t("mfg3_brk_short"), description: t("mfg3_brk_short_desc") },
        ]}
      />
      <MfgField label={t("mfg3_f_quantity")} required htmlFor="brk-qty">
        <Input id="brk-qty" inputMode="decimal" dir="ltr" value={qty} onChange={(e) => setQty(sanitizeDecimalInput(e.target.value))} />
      </MfgField>
      <MfgField label={t("mfg3_brk_reason")} required hint={t("mfg3_brk_reason_hint")} htmlFor="brk-reason">
        <Input id="brk-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </MfgField>
      {kind === "remake" && q > 0 && <MfgNote tone="warn">{t("mfg3_brk_remake_note", { qty: fmtQty(q), unit: view.unit })}</MfgNote>}
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Recorded facts: site measurement, slab sign-off, drawing approval
// ---------------------------------------------------------------------------

function MeasurementForm({ view, onClose }: { view: OrderView; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { data } = useMfgUi()
  const { busy, run } = useSubmit(onClose)
  const [by, setBy] = useState(data.actor.name)
  const [note, setNote] = useState("")
  const [showErrors, setShowErrors] = useState(false)
  const errorText = !by.trim() ? t("mfg3_meas_err_by") : null
  const onlyBlock = view.releaseBlocks.length === 1 && view.releaseBlocks[0].key === "measurement"
  const submit = () => {
    setShowErrors(true)
    if (!firestore || errorText) return
    void run(() => recordMeasurementV2(firestore, { orderId: view.id, by: by.trim(), note: note.trim() || null }), t("mfg3_meas_toast", { order: `#${view.number}` }))
  }
  return (
    <MfgFormModal open onClose={onClose} icon={Ruler} title={t("mfg3_meas_title")} subtitle={t("mfg3_meas_subtitle")} busy={busy} error={showErrors ? errorText : null} onConfirm={submit}>
      <MfgReview rows={[[t("mfg3_f_order"), `${orderLabel(view)} × ${fmtQty(view.quantity)} ${view.unit}`], [t("mfg3_meas_site"), sourceNameOf(view, t)]]} />
      <MfgField label={t("mfg3_meas_by")} required hint={t("mfg3_named_fact_hint")} htmlFor="meas-by">
        <Input id="meas-by" value={by} onChange={(e) => setBy(e.target.value)} />
      </MfgField>
      <MfgField label={t("mfg3_f_note_optional")} hint={t("mfg3_meas_note_hint")} htmlFor="meas-note">
        <Textarea id="meas-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </MfgField>
      <MfgNote tone="warn">{t("mfg3_meas_why")}</MfgNote>
      <MfgEffects items={[{ text: onlyBlock ? t("mfg3_meas_eff_release") : t("mfg3_meas_eff_recorded") }, { text: t("mfg3_eff_logged") }]} />
    </MfgFormModal>
  )
}

function SlabForm({ view, onClose }: { view: OrderView; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { busy, run } = useSubmit(onClose)
  const [lot, setLot] = useState("")
  const [by, setBy] = useState("")
  const [note, setNote] = useState("")
  const [showErrors, setShowErrors] = useState(false)
  const slabLine = (view.product.bom || []).find((b) => b.lotted || b.withWaste)
  const need = slabLine ? materialNeed(view.slice, view.product, slabLine.departmentId).find((n) => n.itemName === slabLine.itemName) : null
  const errorText = !lot.trim() ? t("mfg3_slab_err_lot") : !by.trim() ? t("mfg3_slab_err_by") : null
  const submit = () => {
    setShowErrors(true)
    if (!firestore || errorText) return
    void run(() => recordSlabApprovalV2(firestore, { orderId: view.id, by: by.trim(), lot: lot.trim(), note: note.trim() || null }), t("mfg3_slab_toast", { lot: lot.trim(), by: by.trim() }))
  }
  return (
    <MfgFormModal open onClose={onClose} icon={Eye} title={t("mfg3_slab_title")} subtitle={t("mfg3_slab_subtitle")} busy={busy} error={showErrors ? errorText : null} onConfirm={submit}>
      <MfgReview
        rows={[
          [t("mfg3_f_order"), `${orderLabel(view)} × ${fmtQty(view.quantity)} ${view.unit}`],
          [t("mfg3_f_client"), sourceNameOf(view, t)],
          need && [t("mfg3_slab_need"), t("mfg3_slab_need_value", { net: fmtQty(need.net), waste: view.product.wastePercent, qty: fmtQty(need.qty), unit: need.unit, item: need.itemName })],
        ]}
      />
      <MfgField label={t("mfg3_f_lot")} required hint={t("mfg3_slab_lot_hint")} htmlFor="slab-lot">
        <Input id="slab-lot" dir="ltr" value={lot} onChange={(e) => setLot(e.target.value)} placeholder="BLK-0000" />
      </MfgField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MfgField label={t("mfg3_slab_by")} required hint={t("mfg3_named_fact_hint")} htmlFor="slab-by">
          <Input id="slab-by" value={by} onChange={(e) => setBy(e.target.value)} />
        </MfgField>
        <MfgField label={t("mfg3_f_note_optional")} hint={t("mfg3_slab_note_hint")} htmlFor="slab-note">
          <Input id="slab-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </MfgField>
      </div>
      <MfgEffects items={[{ text: t("mfg3_slab_eff_unblock") }, { text: t("mfg3_slab_eff_lot") }, { text: t("mfg3_eff_logged") }]} />
    </MfgFormModal>
  )
}

function DrawingForm({ view, onClose }: { view: OrderView; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { data } = useMfgUi()
  const d = useMfgDate()
  const { busy, run } = useSubmit(onClose)
  const [result, setResult] = useState<"approved" | "comments">("approved")
  const [by, setBy] = useState(data.actor.name)
  const [showErrors, setShowErrors] = useState(false)
  const errorText = !by.trim() ? t("mfg3_meas_err_by") : null
  const submit = () => {
    setShowErrors(true)
    if (!firestore || errorText) return
    void run(
      () => recordDrawingApprovalV2(firestore, { orderId: view.id, approved: result === "approved", by: by.trim() }),
      result === "approved" ? t("mfg3_draw_toast_ok", { order: `#${view.number}` }) : t("mfg3_draw_toast_comments")
    )
  }
  return (
    <MfgFormModal open onClose={onClose} icon={PencilRuler} title={t("mfg3_draw_title")} subtitle={t("mfg3_draw_subtitle")} busy={busy} error={showErrors ? errorText : null} onConfirm={submit}>
      <MfgReview rows={[[t("mfg3_f_order"), orderLabel(view)], [t("mfg3_draw_created"), d.short(view.order.createdAtIso)]]} />
      <MfgChoiceCards
        value={result}
        onChange={setResult}
        options={[
          { id: "approved", icon: Check, title: t("mfg3_draw_approved"), description: t("mfg3_draw_approved_desc") },
          { id: "comments", icon: AlertTriangle, title: t("mfg3_draw_comments"), description: t("mfg3_draw_comments_desc") },
        ]}
      />
      <MfgField label={t("mfg3_draw_by")} required htmlFor="draw-by">
        <Input id="draw-by" value={by} onChange={(e) => setBy(e.target.value)} />
      </MfgField>
      <MfgEffects items={[result === "approved" ? { text: t("mfg3_draw_eff_unblock") } : { text: t("mfg3_draw_eff_blocked"), applies: false }, { text: t("mfg3_eff_logged") }]} />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

function ReleaseForm({ view, onClose }: { view: OrderView; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { data, perms } = useMfgUi()
  const d = useMfgDate()
  const { busy, run } = useSubmit(onClose)
  const [risk, setRisk] = useState("")
  const [showErrors, setShowErrors] = useState(false)
  const stock = useOrgStock(data.warehouses, true)
  const blocks = view.releaseBlocks
  const possible = data.settings.features.time ? possibleForDays(view.product, view.quantity, data.scheduleInputs, data.departments) : null
  const possibleDate = possible != null ? new Date(Date.now() + possible * 86400000).toISOString().slice(0, 10) : null
  const late = !!possibleDate && !!view.neededBy && possibleDate > view.neededBy
  const std = standardCost(view.product, data.departments, data.settings, view.quantity)
  const shortages = useMemo(() => {
    if (stock.loading) return []
    const deptIds = Array.from(new Set((view.product.bom || []).map((b) => b.departmentId)))
    return deptIds.flatMap((id) =>
      materialNeed(view.slice, view.product, id)
        .map((n) => ({ ...n, available: stock.byName.get(stockKey(n.itemName)) || 0 }))
        .filter((n) => n.qty > n.available + 1e-9)
    )
  }, [stock, view.product, view.slice])

  const errorText = blocks.length && !perms.canCost ? t("mfg3_rel_err_blocked") : blocks.length && !risk.trim() ? t("mfg3_rel_err_risk") : null
  const submit = () => {
    setShowErrors(true)
    if (!firestore || errorText) return
    void run(
      () => releaseWorkOrderV2(firestore, { order: view.order, product: view.product, riskReason: blocks.length ? risk.trim() : null, actor: data.actor }),
      t("mfg3_rel_toast", { order: `#${view.number}`, dept: departmentNameOf(data.departments, view, 0) })
    )
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Play}
      title={blocks.length ? t("mfg3_rel_title_risk") : t("mfg3_rel_title")}
      subtitle={t("mfg3_rel_subtitle")}
      busy={busy}
      error={showErrors ? errorText : null}
      onConfirm={submit}
      confirmLabel={blocks.length ? t("mfg3_rel_confirm_risk") : t("mfg3_rel_confirm")}
      confirmTone={blocks.length ? "destructive" : "default"}
    >
      <MfgReview
        rows={[
          [t("mfg3_f_order"), `${orderLabel(view)} × ${fmtQty(view.quantity)} ${view.unit}`],
          [t("mfg3_rel_for"), sourceNameOf(view, t)],
          [t("mfg3_rel_needed"), d.short(view.neededBy)],
          possibleDate && [
            t("mfg3_rel_possible"),
            <span key="p" className={late ? "text-destructive" : "text-success"}>
              {d.short(possibleDate)} {late && view.neededBy ? `— ${t("mfg3_rel_late_by", { days: d.dayDiff(possibleDate) - d.dayDiff(view.neededBy) })}` : ""}
            </span>,
          ],
          perms.seesMoney && [t("mfg3_rel_std_cost"), t("mfg3_brk_std_cost_value", { value: fmtMoney(std.total), hours: fmtQty(std.hours) })],
        ]}
      />
      {blocks.map((b) => (
        <MfgNote key={b.key} tone="bad" title={t(`mfg3_block_${b.key}`)}>
          {t(`mfg3_block_${b.key}_fix`)}
        </MfgNote>
      ))}
      {shortages.length > 0 && (
        <MfgNote tone="warn" title={t("mfg3_rel_short_title")}>
          {shortages
            .slice(0, 3)
            .map((s) => t("mfg3_rel_short_line", { item: s.itemName, available: fmtQty(s.available), qty: fmtQty(s.qty), unit: s.unit }))
            .join(" · ")}
          <br />
          {t("mfg3_rel_short_desc")}
        </MfgNote>
      )}
      {blocks.length > 0 && perms.canCost && (
        <MfgField label={t("mfg3_rel_risk_reason")} required hint={t("mfg3_rel_risk_hint")} htmlFor="rel-risk">
          <Textarea id="rel-risk" rows={2} value={risk} onChange={(e) => setRisk(e.target.value)} placeholder={t("mfg3_rel_risk_placeholder")} />
        </MfgField>
      )}
      <MfgEffects
        items={[
          { text: t("mfg3_rel_eff_queue") },
          { text: t("mfg3_rel_eff_board", { dept: departmentNameOf(data.departments, view, 0) }) },
          { text: t("mfg3_rel_eff_materials"), applies: false },
        ]}
      />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Rush
// ---------------------------------------------------------------------------

function RushForm({ view, onClose }: { view: OrderView; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const { busy, run } = useSubmit(onClose)
  const [reason, setReason] = useState("")
  const [showErrors, setShowErrors] = useState(false)
  const depts = new Set(view.product.route.map((r) => r.departmentId))
  const affected = ui.views
    .filter((v) => v.id !== view.id && inSegment(v, "live") && !v.rush)
    .filter((v) => v.product.route.some((r) => depts.has(r.departmentId)))
    .filter((v) => !view.neededBy || !v.neededBy || v.neededBy >= view.neededBy)
    .slice(0, 5)
  const errorText = !reason.trim() ? t("mfg3_rush_err_reason") : null
  const submit = () => {
    setShowErrors(true)
    if (!firestore || errorText) return
    void run(() => rushWorkOrderV2(firestore, { orderId: view.id, reason: reason.trim(), actor: ui.data.actor }), t("mfg3_rush_toast", { order: `#${view.number}` }))
  }
  return (
    <MfgFormModal open onClose={onClose} icon={Zap} title={t("mfg3_rush_title")} subtitle={t("mfg3_rush_subtitle")} busy={busy} error={showErrors ? errorText : null} onConfirm={submit}>
      <MfgReview
        rows={[
          [t("mfg3_f_order"), orderLabel(view)],
          view.possibleDate && [t("mfg3_rush_possible_now"), d.short(view.possibleDate)],
        ]}
      />
      <MfgField label={t("mfg3_f_reason")} required hint={t("mfg3_rush_reason_hint")} htmlFor="rush-reason">
        <Input id="rush-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("mfg3_rush_reason_placeholder")} />
      </MfgField>
      <MfgNote tone="warn" title={t("mfg3_rush_affects", { count: affected.length })}>
        {affected.length ? affected.map((v) => `#${v.number} — ${v.product.name} (${sourceNameOf(v, t)})`).join(" · ") : t("mfg3_rush_affects_none")}
      </MfgNote>
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Approve scrap
// ---------------------------------------------------------------------------

function ApproveScrapForm({ view, scrapId, onClose }: { view: OrderView; scrapId: string; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { data, perms } = useMfgUi()
  const d = useMfgDate()
  const { busy, run } = useSubmit(onClose)
  const scrap = view.slice.scrap.find((s) => s.id === scrapId)
  if (!scrap) return null
  const allowed = perms.canCost || (perms.canManage && scrap.value <= data.settings.scrapApprovalLimit)
  const deptIndex = view.product.route.findIndex((r) => r.departmentId === scrap.departmentId)
  const submit = () => {
    if (!firestore || !allowed) return
    void run(() => approveScrapV2(firestore, { order: view.order, scrapId, actor: data.actor, organizationId: data.orgId }), t("mfg3_scrap_toast", { qty: fmtQty(scrap.quantity), value: fmtMoney(scrap.value) }))
  }
  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Trash2}
      title={t("mfg3_scrap_title")}
      subtitle={t("mfg3_scrap_subtitle")}
      busy={busy}
      error={allowed ? null : t("mfg3_scrap_err_limit", { limit: fmtMoney(data.settings.scrapApprovalLimit) })}
      onConfirm={submit}
      confirmLabel={t("mfg3_scrap_confirm")}
      confirmTone="destructive"
    >
      <MfgReview
        rows={[
          [t("mfg3_f_order"), orderLabel(view)],
          [t("mfg3_f_quantity"), `${fmtQty(scrap.quantity)} ${view.unit}`],
          perms.seesMoney && [t("mfg3_qc_value"), <span key="v" dir="ltr">{fmtMoney(scrap.value)} ﷼</span>],
          [t("mfg3_f_reason"), scrap.reason],
          [t("mfg3_f_department"), deptIndex >= 0 ? departmentNameOf(data.departments, view, deptIndex) : "—"],
          [t("mfg3_scrap_raised_by"), `${scrap.raisedByName} · ${d.short(scrap.raisedAt)}`],
        ]}
      />
      <MfgEffects items={[{ text: t("mfg3_scrap_eff_removed") }, { text: t("mfg3_scrap_eff_loss") }, { text: t("mfg3_scrap_eff_reason") }]} />
    </MfgFormModal>
  )
}
