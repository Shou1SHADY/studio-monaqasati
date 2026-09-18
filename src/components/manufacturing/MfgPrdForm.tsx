"use client"

// The product card (PC-01…PC-09), in two steps. First what it is — name, unit
// (stone in m² or linear metres), planned waste, the blocking flags — and its
// own route: stations from the registry, or a new station created right here
// and added in place (PC-02), each with a standard time that starts empty
// (PC-03). With live orders on the card the route order is locked and only
// the times change. Then the bill of materials: what each station consumes,
// flagged "waste" (the slab, bought net + waste) or "custody" (consumables
// backflushed from station custody, never requested per order — PC-09), with
// the standard cost worked out live for the money roles. No price here (D10).

import { useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { addDoc, collection, serverTimestamp } from "firebase/firestore"
import { ArrowDown, ArrowUp, Layers, Lock, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { MFG_DEPARTMENTS } from "@/lib/manufacturing"
import { deptCapacity, effectiveRoute, itemKey, labourCostOn, perUnit, rateOf, standardCost, stationGate, type MfgBomLine, type MfgProduct, type MfgRouteStep } from "@/lib/manufacturing-engine"
import { createMfgProduct, updateMfgProduct } from "@/lib/manufacturing-writes"
import { cn } from "@/lib/utils"
import { useMfgUi } from "./MfgUiContext"
import { MfgRecordedAs } from "./MfgOrderBits"
import { reqErrorText } from "./MfgReqBits"
import { PRODUCT_UNITS, STONE_UNITS, unitLabel, liveOrdersOn, stepName } from "./MfgPrdBits"
import { MfgField, MfgFormModal, MfgNote, MfgReview, fmtSar, fmtQty, fmtMoney } from "./ui/MfgUi"

interface RouteRow {
  key: string
  departmentId: string
  departmentName: string
  /** "" = not estimated. */
  hours: string
}

interface BomRow {
  key: string
  itemName: string
  unit: string
  qty: string
  departmentId: string
  waste: boolean
  custody: boolean
  unitCost: string
  lotted: boolean
}

let seq = 0
const rowKey = () => `row_${Date.now().toString(36)}_${(seq += 1)}`
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s))
const badNumber = (s: string) => s.trim() !== "" && !(Number(s) >= 0)

export function MfgProductForm({ productId, onClose }: { productId?: string; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms, seesMoney } = ui
  const firestore = useFirestore()
  const { toast } = useToast()
  const existing: MfgProduct | null = productId ? data.productById.get(productId) || null : null
  const timeOn = data.settings.features.time
  const costOn = labourCostOn(data.settings)
  const locked = !!existing && liveOrdersOn(existing.id, ui.views) > 0

  const [step, setStep] = useState(0)
  const [name, setName] = useState(existing?.name || "")
  const [unit, setUnit] = useState(existing?.unit || STONE_UNITS[0])
  const [waste, setWaste] = useState(String(existing?.wastePercent ?? 15))
  const [measure, setMeasure] = useState(existing ? existing.requiresMeasurement : true)
  const [drawing, setDrawing] = useState(existing ? existing.requiresDrawingApproval : true)
  const [slab, setSlab] = useState(existing ? existing.requiresSlabApproval : true)
  const [route, setRoute] = useState<RouteRow[]>(() =>
    existing ? effectiveRoute(existing).map((r) => ({ key: rowKey(), departmentId: r.departmentId, departmentName: r.departmentName, hours: r.hoursPerUnit == null ? "" : String(r.hoursPerUnit) })) : []
  )
  const [bom, setBom] = useState<BomRow[]>(() =>
    (existing?.bom || []).map((b) => ({
      key: rowKey(),
      itemName: b.itemName,
      unit: b.unit,
      qty: String(b.qtyPerUnit),
      departmentId: b.departmentId,
      waste: !!b.withWaste && !b.custody,
      custody: !!b.custody,
      unitCost: b.unitCost == null ? "" : String(b.unitCost),
      lotted: !!b.lotted,
    }))
  )
  const [newStation, setNewStation] = useState<{ name: string; workers: string; hours: string } | null>(null)
  const [creatingStation, setCreatingStation] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The fixed list, plus a stored value from before it (shown as it is) — never twice.
  const units = useMemo(() => Array.from(new Set<string>([...PRODUCT_UNITS, ...(existing?.unit ? [existing.unit] : [])])), [existing])
  const suggestions = useMemo(() => {
    const byKey = new Map<string, { name: string; unit: string; unitCost: number | null }>()
    for (const rows of data.stockRows.values()) for (const r of rows) if (r.name && !r.isManufactured && !byKey.has(itemKey(r.name))) byKey.set(itemKey(r.name), { name: r.name, unit: r.unit, unitCost: r.unitCost })
    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [data.stockRows])

  if (!perms.canManage) {
    return (
      <MfgFormModal open onClose={onClose} icon={Layers} title={t("mfr_prd_form_title")} onConfirm={onClose} confirmLabel={t("mfg3_close")}>
        <MfgNote tone="warn" icon={Lock}>
          {t("mfr_prd_only_manager")}
        </MfgNote>
      </MfgFormModal>
    )
  }

  const deptOf = (id: string) => data.departments.find((d) => d.id === id)
  const nameOf = (r: Pick<RouteRow, "departmentId" | "departmentName">) => stepName(data.departments, r)
  const available = data.departments.filter((d) => !route.some((r) => r.departmentId === d.id))

  // --- the draft card, as the engine will read it ---
  const routeSteps: MfgRouteStep[] = route.map((r) => ({ departmentId: r.departmentId, departmentName: nameOf(r), hoursPerUnit: numOrNull(r.hours) }))
  const bomLines: MfgBomLine[] = bom.map((b) => ({
    itemName: b.itemName.trim(),
    unit: b.unit.trim(),
    qtyPerUnit: Number(b.qty) || 0,
    departmentId: b.departmentId,
    withWaste: b.waste && !b.custody,
    unitCost: numOrNull(b.unitCost),
    lotted: b.lotted || (b.waste && !b.custody),
    custody: b.custody,
  }))
  const wastePct = Number(waste) || 0
  const std = standardCost({ wastePercent: wastePct, route: routeSteps, bom: bomLines }, data.departments, data.settings, 1)

  const step0Error = (): string | null => {
    if (!name.trim()) return t("mfr_prd_err_name")
    if (!(Number(waste) >= 0 && Number(waste) <= 100)) return t("mfr_prd_err_waste")
    if (!route.length) return t("mfr_prd_err_route")
    if (route.some((r) => badNumber(r.hours))) return t("mfr_prd_err_hours")
    return null
  }
  const step1Error = (): string | null => {
    if (bom.some((b) => !b.itemName.trim() || !b.unit.trim())) return t("mfr_prd_err_bom_item")
    if (bom.some((b) => !(Number(b.qty) > 0))) return t("mfr_prd_err_bom_qty")
    if (bom.some((b) => !route.some((r) => r.departmentId === b.departmentId))) return t("mfr_prd_err_bom_station")
    if (bom.some((b) => badNumber(b.unitCost))) return t("mfr_prd_err_bom_cost")
    return null
  }

  const next = () => {
    setAttempted(true)
    const e = step0Error()
    setError(e)
    if (e) return
    setAttempted(false)
    setStep(1)
  }

  const move = (i: number, dir: -1 | 1) =>
    setRoute((rows) => {
      const out = [...rows]
      const j = i + dir
      if (j < 0 || j >= out.length) return rows
      ;[out[i], out[j]] = [out[j], out[i]]
      return out
    })

  const addFromRegistry = (id: string) => {
    const d = deptOf(id)
    if (!d) return
    setRoute((rows) => [...rows, { key: rowKey(), departmentId: d.id, departmentName: d.name, hours: "" }])
  }

  const createStation = async () => {
    if (!firestore || !newStation || creatingStation) return
    const workers = Number(newStation.workers)
    const hours = Number(newStation.hours)
    if (!newStation.name.trim()) return setError(t("mfr_set_err_name"))
    if (!(workers >= 1) || !(hours >= 1 && hours <= 24)) return setError(t("mfr_set_err_capacity"))
    setError(null)
    setCreatingStation(true)
    try {
      const order = data.departments.reduce((m, d) => Math.max(m, Number(d.order) || 0), 0) + 1
      const ref = await addDoc(collection(firestore, MFG_DEPARTMENTS), {
        organizationId: data.orgId,
        name: newStation.name.trim(),
        order,
        workers: Math.round(workers),
        hoursPerDay: hours,
        hourlyRate: null,
        // gate and qcStation are left unset: the station name is read until the manager sets them.
        leadUserId: null,
        leadUserName: null,
        checklist: [],
        createdByUserId: data.actor.id,
        createdByUserName: data.actor.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setRoute((rows) => [...rows, { key: rowKey(), departmentId: ref.id, departmentName: newStation.name.trim(), hours: "" }])
      toast({ title: t("mfr_set_toast_station_added", { name: newStation.name.trim() }) })
      setNewStation(null)
    } catch (err) {
      console.error(err)
      setError(reqErrorText(t, err))
    } finally {
      setCreatingStation(false)
    }
  }

  const setBomRow = (key: string, patch: Partial<BomRow>) => setBom((rows) => rows.map((b) => (b.key === key ? { ...b, ...patch } : b)))
  const onItemName = (row: BomRow, value: string) => {
    const hit = suggestions.find((s) => itemKey(s.name) === itemKey(value))
    setBomRow(row.key, {
      itemName: value,
      ...(hit && !row.unit.trim() ? { unit: hit.unit } : {}),
      ...(hit && seesMoney && !row.unitCost.trim() && hit.unitCost != null ? { unitCost: String(hit.unitCost) } : {}),
    })
  }

  const submit = async () => {
    if (!firestore || busy) return
    setAttempted(true)
    const e = step0Error() || step1Error()
    setError(e)
    if (e) return
    setBusy(true)
    try {
      const input = {
        name: name.trim(),
        unit,
        family: existing?.family ?? "stone",
        requiresMeasurement: measure,
        requiresDrawingApproval: drawing,
        requiresSlabApproval: slab,
        wastePercent: wastePct,
        referenceBuyPrice: existing?.referenceBuyPrice ?? null,
        route: locked && existing ? existing.route.map((s) => (s.onSite ? s : { ...s, departmentName: nameOf(s), hoursPerUnit: numOrNull(route.find((r) => r.departmentId === s.departmentId)?.hours ?? "") })) : routeSteps,
        bom: bomLines,
        archived: !!existing?.archived,
      }
      if (existing) {
        await updateMfgProduct(firestore, { product: existing, next: input, routeLocked: locked, actor: data.actor })
        toast({ title: t("mfr_prd_toast_saved", { name: input.name }) })
      } else {
        await createMfgProduct(firestore, { organizationId: data.orgId, product: input, actor: data.actor })
        toast({ title: t("mfr_prd_toast_added", { name: input.name, count: input.route.length }) })
      }
      onClose()
    } catch (err) {
      console.error(err)
      const msg = reqErrorText(t, err)
      setError(msg)
      toast({ title: msg, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const flags: Array<{ id: string; on: boolean; set: (v: boolean) => void; label: string }> = [
    { id: "measure", on: measure, set: setMeasure, label: t("mfr_prd_flag_measure_blocks") },
    { id: "drawing", on: drawing, set: setDrawing, label: t("mfr_prd_flag_drawing_blocks") },
    { id: "slab", on: slab, set: setSlab, label: t("mfr_prd_flag_slab_blocks") },
  ]

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Layers}
      title={existing ? t("mfr_prd_form_title_edit", { name: existing.name }) : t("mfr_prd_form_title")}
      subtitle={t("mfr_prd_form_sub")}
      steps={[t("mfr_prd_step_product"), t("mfr_prd_step_bom")]}
      step={step}
      error={error}
      busy={busy}
      onBack={() => {
        setError(null)
        setStep(0)
      }}
      onNext={next}
      onConfirm={submit}
      confirmLabel={existing ? t("mfr_prd_save") : t("mfr_prd_create")}
      size="lg"
    >
      {step === 0 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <MfgField label={t("mfr_prd_name")} required htmlFor="mfr-prd-name" error={attempted && !name.trim() ? t("mfr_prd_err_name") : undefined}>
              <Input id="mfr-prd-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={attempted && !name.trim()} />
            </MfgField>
            <MfgField label={t("mfr_prd_unit_label")} hint={t("mfr_prd_unit_hint")}>
              <Select value={unit} onValueChange={setUnit} disabled={locked}>
                <SelectTrigger className="h-10 text-xs" aria-label={t("mfr_prd_unit_label")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {units.map((u) => (
                    <SelectItem key={u} value={u} className="text-xs">
                      {unitLabel(u, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MfgField>
          </div>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <MfgField label={t("mfr_prd_waste_label")} hint={t("mfr_prd_waste_hint")} htmlFor="mfr-prd-waste">
              <Input id="mfr-prd-waste" type="number" inputMode="decimal" min={0} max={100} step="any" dir="ltr" className="h-10 tabular-nums" value={waste} onChange={(e) => setWaste(e.target.value)} />
            </MfgField>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">{t("mfr_prd_flags_label")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {flags.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={f.on}
                    disabled={locked}
                    onClick={() => f.set(!f.on)}
                    className={cn(
                      "min-h-10 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                      f.on ? "border-warning bg-warning/10 text-warning" : "border-border bg-white text-muted-foreground hover:border-slate-300"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <section className="space-y-2">
            <p className="text-xs font-bold text-slate-700">
              {t("mfr_prd_route_title")}
              {timeOn && <span className="ms-1 font-semibold text-muted-foreground">· {t("mfr_prd_time_starts_empty")}</span>}
            </p>
            {locked && (
              <MfgNote tone="warn" icon={Lock}>
                {t("mfr_prd_route_locked")}
              </MfgNote>
            )}
            <div className="overflow-hidden rounded-xl border bg-white">
              {route.length === 0 && <p className="px-3.5 py-4 text-center text-xs text-muted-foreground">{t("mfr_prd_route_empty")}</p>}
              {route.map((r, i) => {
                const d = deptOf(r.departmentId)
                const label = nameOf(r)
                return (
                  <div key={r.key} className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2.5 last:border-b-0">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-bold tabular-nums text-slate-700">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold text-foreground" dir="auto">
                        {label}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {stationGate(d || { name: r.departmentName }) ? `${t("mfr_prd_order_level_step")} · ` : ""}
                        {timeOn
                          ? `${t("mfr_set_capacity_value", { hours: fmtQty(deptCapacity(d || { workers: 1, hoursPerDay: 8 })) })} · ${Number(d?.workers) || 1}×${Number(d?.hoursPerDay) || 8}`
                          : t("mfr_set_workers_value", { count: Number(d?.workers) || 1 })}
                      </span>
                    </span>
                    {timeOn && (
                      <span className="flex items-center gap-1">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          dir="ltr"
                          value={r.hours}
                          placeholder={t("mfr_prd_not_estimated")}
                          aria-label={t("mfr_prd_hours_for", { station: label })}
                          aria-invalid={attempted && badNumber(r.hours)}
                          onChange={(e) => setRoute((rows) => rows.map((x) => (x.key === r.key ? { ...x, hours: e.target.value } : x)))}
                          className="h-9 w-28 text-xs tabular-nums"
                        />
                        <span className="text-[10px] text-muted-foreground">{t("mfr_prd_h_per_unit")}</span>
                      </span>
                    )}
                    <span className="flex items-center">
                      <IconButton label={t("mfr_prd_move_up", { station: label })} disabled={locked || i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp size={14} aria-hidden="true" />
                      </IconButton>
                      <IconButton label={t("mfr_prd_move_down", { station: label })} disabled={locked || i === route.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown size={14} aria-hidden="true" />
                      </IconButton>
                      <IconButton label={t("mfr_prd_remove_station", { station: label })} disabled={locked} tone="bad" onClick={() => setRoute((rows) => rows.filter((x) => x.key !== r.key))}>
                        <Trash2 size={14} aria-hidden="true" />
                      </IconButton>
                    </span>
                  </div>
                )
              })}
            </div>

            {!locked && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select key={route.length} onValueChange={addFromRegistry} disabled={!available.length}>
                  <SelectTrigger className="h-10 flex-1 text-xs" aria-label={t("mfr_prd_add_from_registry")}>
                    <SelectValue placeholder={t("mfr_prd_add_from_registry")} />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((d) => (
                      <SelectItem key={d.id} value={d.id} className="text-xs">
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" className="h-10 gap-1.5 text-xs" onClick={() => setNewStation(newStation ? null : { name: "", workers: "2", hours: "8" })} aria-expanded={!!newStation}>
                  <Plus size={14} aria-hidden="true" /> {t("mfr_prd_new_station_here")}
                </Button>
              </div>
            )}

            {!locked && newStation && (
              <div className="space-y-2 rounded-xl border border-dashed border-warning/40 bg-warning/5 p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_100px_100px]">
                  <MfgField label={t("mfr_set_station_name")} htmlFor="mfr-new-station-name">
                    <Input id="mfr-new-station-name" dir="auto" value={newStation.name} placeholder={t("mfr_set_station_name_ph")} onChange={(e) => setNewStation({ ...newStation, name: e.target.value })} className="h-10" />
                  </MfgField>
                  <MfgField label={t("mfr_set_workers")} htmlFor="mfr-new-station-workers">
                    <Input id="mfr-new-station-workers" type="number" inputMode="numeric" min={1} dir="ltr" value={newStation.workers} onChange={(e) => setNewStation({ ...newStation, workers: e.target.value })} className="h-10 tabular-nums" />
                  </MfgField>
                  <MfgField label={t("mfr_set_hours_day")} htmlFor="mfr-new-station-hours">
                    <Input id="mfr-new-station-hours" type="number" inputMode="decimal" min={1} max={24} dir="ltr" value={newStation.hours} onChange={(e) => setNewStation({ ...newStation, hours: e.target.value })} className="h-10 tabular-nums" />
                  </MfgField>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" className="h-10 gap-1.5 text-xs" onClick={createStation} disabled={creatingStation}>
                    <Plus size={14} aria-hidden="true" /> {t("mfr_prd_create_station_add")}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    {t("mfr_set_capacity_note", { workers: Number(newStation.workers) || 0, hoursEach: Number(newStation.hours) || 0, hours: fmtQty((Number(newStation.workers) || 0) * (Number(newStation.hours) || 0)) })}
                  </span>
                </div>
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <datalist id="mfr-bom-units">
            {PRODUCT_UNITS.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u, t)}
              </option>
            ))}
          </datalist>
          <datalist id="mfr-bom-items">
            {suggestions.map((s) => (
              <option key={s.name} value={s.name} />
            ))}
          </datalist>
          {seesMoney && bom.length > 0 && <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">{t("mfr_prd_bom_cost_hint")}</p>}
          <div className="space-y-2">
            {bom.length === 0 && <p className="rounded-xl border border-dashed bg-white px-3.5 py-4 text-center text-xs text-muted-foreground">{t("mfr_prd_bom_empty_form")}</p>}
            {bom.map((b, i) => (
              <div key={b.key} className="space-y-2 rounded-xl border bg-white p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_90px_110px]">
                  <MfgField label={t("mfr_prd_bom_item")} htmlFor={`${b.key}-item`} error={attempted && !b.itemName.trim() ? t("mfr_prd_err_bom_item") : undefined}>
                    <Input id={`${b.key}-item`} list="mfr-bom-items" dir="auto" value={b.itemName} onChange={(e) => onItemName(b, e.target.value)} className="h-10 text-xs" />
                  </MfgField>
                  <MfgField label={t("mfr_prd_bom_unit")} htmlFor={`${b.key}-unit`}>
                    <Input id={`${b.key}-unit`} list="mfr-bom-units" dir="auto" value={b.unit} onChange={(e) => setBomRow(b.key, { unit: e.target.value })} className="h-10 text-xs" />
                  </MfgField>
                  <MfgField label={t("mfr_prd_bom_qty")} htmlFor={`${b.key}-qty`} error={attempted && !(Number(b.qty) > 0) ? t("mfr_prd_err_bom_qty") : undefined}>
                    <Input id={`${b.key}-qty`} type="number" inputMode="decimal" min={0} step="any" dir="ltr" value={b.qty} onChange={(e) => setBomRow(b.key, { qty: e.target.value })} className="h-10 text-xs tabular-nums" />
                  </MfgField>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[180px] flex-1 space-y-1.5">
                    <Label className="text-xs font-bold text-slate-700">{t("mfr_prd_bom_station")}</Label>
                    <Select value={route.some((r) => r.departmentId === b.departmentId) ? b.departmentId : undefined} onValueChange={(v) => setBomRow(b.key, { departmentId: v })}>
                      <SelectTrigger className={cn("h-10 text-xs", attempted && !route.some((r) => r.departmentId === b.departmentId) && "border-destructive")} aria-label={t("mfr_prd_bom_station_for", { item: b.itemName || String(i + 1) })}>
                        <SelectValue placeholder={t("mfr_prd_bom_pick_station")} />
                      </SelectTrigger>
                      <SelectContent>
                        {route.map((r) => (
                          <SelectItem key={r.key} value={r.departmentId} className="text-xs">
                            {nameOf(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Toggle on={b.waste} onClick={() => setBomRow(b.key, { waste: !b.waste, custody: b.waste ? b.custody : false })} title={t("mfr_prd_bom_waste_hint")}>
                    {t("mfr_prd_bom_waste")}
                  </Toggle>
                  <Toggle on={b.custody} onClick={() => setBomRow(b.key, { custody: !b.custody, waste: b.custody ? b.waste : false })} title={t("mfr_prd_bom_custody_hint")}>
                    {t("mfr_prd_bom_custody")}
                  </Toggle>
                  {seesMoney && (
                    <div className="w-32 space-y-1.5">
                      <Label htmlFor={`${b.key}-cost`} className="text-xs font-bold text-slate-700">
                        {t("mfr_prd_bom_cost")}
                      </Label>
                      <Input id={`${b.key}-cost`} type="number" inputMode="decimal" min={0} step="any" dir="ltr" value={b.unitCost} placeholder={t("mfr_prd_bom_cost_unknown")} onChange={(e) => setBomRow(b.key, { unitCost: e.target.value })} className="h-10 text-xs tabular-nums" />
                    </div>
                  )}
                  <IconButton label={t("mfr_prd_bom_remove", { item: b.itemName || String(i + 1) })} tone="bad" onClick={() => setBom((rows) => rows.filter((x) => x.key !== b.key))}>
                    <Trash2 size={14} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full gap-1.5 text-xs"
              onClick={() => setBom((rows) => [...rows, { key: rowKey(), itemName: "", unit: "", qty: "", departmentId: route[0]?.departmentId || "", waste: false, custody: false, unitCost: "", lotted: false }])}
            >
              <Plus size={14} aria-hidden="true" /> {t("mfr_prd_bom_add")}
            </Button>
          </div>
          <MfgNote tone="info">{t("mfr_prd_bom_catalogue_note")}</MfgNote>

          {seesMoney && (
            <MfgReview
              rows={[
                // Each figure with its arithmetic under it: "where does this number come from?"
                [t("mfr_prd_cost_materials"), <Money key="m" value={std.materials} />],
                ...bomLines.map((b, i): [ReactNode, ReactNode] => [
                  <span key={`bl${i}`} className="ps-3 text-[11px]">· {b.itemName || "—"}</span>,
                  <span key={`bv${i}`} className="text-[11px] font-normal text-muted-foreground" dir="ltr">
                    {b.unitCost == null
                      ? t("mfr_prd_cost_line_unpriced")
                      : `${fmtQty(perUnit({ wastePercent: wastePct }, b))} ${b.unit} × ${fmtMoney(b.unitCost)} = ${fmtMoney(perUnit({ wastePercent: wastePct }, b) * b.unitCost)}`}
                  </span>,
                ]),
                costOn && [t("mfr_prd_cost_labour"), <Money key="l" value={std.labour} />],
                ...(costOn
                  ? routeSteps.map((r, i): [ReactNode, ReactNode] => [
                      <span key={`rl${i}`} className="ps-3 text-[11px]">· {nameOf(route[i] ?? { departmentId: r.departmentId, departmentName: r.departmentName })}</span>,
                      <span key={`rv${i}`} className="text-[11px] font-normal text-muted-foreground" dir="ltr">
                        {r.hoursPerUnit == null ? t("mfr_prd_not_estimated_long") : `${fmtQty(r.hoursPerUnit)} h × ${fmtMoney(rateOf(data.departments, r.departmentId))} = ${fmtMoney(r.hoursPerUnit * rateOf(data.departments, r.departmentId))}`}
                      </span>,
                    ])
                  : []),
                costOn && [t("mfr_prd_cost_overhead"), <Money key="o" value={std.overhead} />],
                costOn && [
                  <span key="ol" className="ps-3 text-[11px]">· {t("mfr_prd_cost_overhead_how")}</span>,
                  <span key="ov" className="text-[11px] font-normal text-muted-foreground" dir="ltr">{`${fmtQty(std.hours)} h × ${fmtMoney(data.settings.overheadRatePerHour)}`}</span>,
                ],
                [<b key="tk">{t(costOn ? "mfr_prd_std_unit_cost" : "mfr_prd_std_unit_cost_materials")}</b>, <b key="tv"><Money value={std.total} /></b>],
                existing?.referenceBuyPrice ? [t("mfr_prd_ref_buy"), <span key="rb"><Money value={existing.referenceBuyPrice} /> · {t("mfg4_from_module", { module: t("mfg4_module_procurement") })}</span>] : null,
              ]}
            />
          )}
          {seesMoney && !std.allPriced && <MfgNote tone="warn">{t("mfr_prd_cost_unknown_note")}</MfgNote>}
          {timeOn && std.unestimated.length > 0 && <MfgNote tone="warn">{t("mfr_prd_unestimated_note", { count: std.unestimated.length })}</MfgNote>}
        </>
      )}
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

function Money({ value }: { value: number }) {
  return (
    <span dir="ltr" className="tabular-nums">
      {fmtSar(value)}
    </span>
  )
}

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={cn(
        "h-10 rounded-lg border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-warning bg-warning/10 text-warning" : "border-border bg-white text-muted-foreground hover:border-slate-300"
      )}
    >
      {children}
    </button>
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
        "grid h-10 w-10 place-items-center rounded-lg text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
        tone === "bad" ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}
