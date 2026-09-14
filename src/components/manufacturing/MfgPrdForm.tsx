"use client"

// New product card, in two steps: what it is and the route it travels, then
// what each department consumes — with the standard cost worked out live and
// the consequences stated before the card is created.

import { useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, Layers, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { deptCapacity, standardCost, type MfgBomLine, type MfgFamily, type MfgRouteStep } from "@/lib/manufacturing-engine"
import { createMfgProduct } from "@/lib/manufacturing-writes"
import { useMfgUi } from "./MfgUiContext"
import { MFG_FAMILIES } from "./MfgPrdBits"
import { MfgEffects, MfgField, MfgFormModal, MfgNote, MfgReview, departmentIcon, fmtMoney, fmtQty } from "./ui/MfgUi"

interface RouteDraft {
  on: boolean
  hours: string
}

interface BomDraft {
  uid: number
  itemName: string
  unit: string
  qty: string
  departmentId: string
  withWaste: boolean
  lotted: boolean
  cost: string
}

const num = (s: string): number | null => {
  if (s.trim() === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function MfgPrdForm({ onClose, onCreated }: { onClose: () => void; onCreated: (productId: string) => void }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const timeOn = data.settings.features.time

  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [unit, setUnit] = useState(() => t("mfg3_prd_unit_default"))
  const [family, setFamily] = useState<MfgFamily>("stone")
  const [fit, setFit] = useState(false)
  const [appr, setAppr] = useState(false)
  const [slab, setSlab] = useState(false)
  const [waste, setWaste] = useState("0")
  const [salePrice, setSalePrice] = useState("")
  const [buyRef, setBuyRef] = useState("")
  const [estimate, setEstimate] = useState("")

  // The route keeps its own order (a product may visit departments in a
  // different order from the chain); departments added meanwhile join the end.
  const [order, setOrder] = useState<string[]>(() => data.departments.map((d) => d.id))
  const [routeDraft, setRouteDraft] = useState<Record<string, RouteDraft>>({})
  const [bom, setBom] = useState<BomDraft[]>([])
  const [nextUid, setNextUid] = useState(1)

  const rows = useMemo(() => {
    const byId = new Map(data.departments.map((d) => [d.id, d]))
    const ids = [...order.filter((id) => byId.has(id)), ...data.departments.filter((d) => !order.includes(d.id)).map((d) => d.id)]
    return ids.map((id) => ({ dept: byId.get(id)!, draft: routeDraft[id] || { on: false, hours: "0.5" } }))
  }, [data.departments, order, routeDraft])

  const routeSteps: MfgRouteStep[] = useMemo(
    () =>
      rows
        .filter((r) => r.draft.on)
        .map((r) => ({
          departmentId: r.dept.id,
          departmentName: r.dept.name,
          hoursPerUnit: timeOn ? Math.max(0, num(r.draft.hours) ?? 0) : 0,
          ...(r.dept.onSite ? { onSite: true } : {}),
        })),
    [rows, timeOn]
  )

  const bomLines: MfgBomLine[] = useMemo(
    () =>
      bom
        .filter((b) => b.itemName.trim())
        .map((b) => ({
          itemName: b.itemName.trim(),
          unit: b.unit.trim(),
          qtyPerUnit: Math.max(0, num(b.qty) ?? 0),
          departmentId: b.departmentId,
          withWaste: b.withWaste,
          unitCost: num(b.cost),
          lotted: b.lotted,
        })),
    [bom]
  )

  const wastePercent = Math.min(90, Math.max(0, num(waste) ?? 0))
  const std = standardCost({ route: routeSteps, bom: bomLines, wastePercent }, data.departments, data.settings, 1)
  const buy = num(buyRef)

  // Item names already used on other cards — the same stone spelled the same
  // way keeps material requests matching the store's items.
  const knownItems = useMemo(() => {
    const names = new Set<string>()
    for (const p of data.products) for (const b of p.bom || []) if (b.itemName) names.add(b.itemName)
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ar"))
  }, [data.products])

  const setDraft = (id: string, patch: Partial<RouteDraft>) =>
    setRouteDraft((m) => ({ ...m, [id]: { ...(m[id] || { on: false, hours: "0.5" }), ...patch } }))

  const move = (index: number, dir: -1 | 1) => {
    const ids = rows.map((r) => r.dept.id)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    setOrder(ids)
  }

  const patchBom = (uid: number, patch: Partial<BomDraft>) => setBom((list) => list.map((b) => (b.uid === uid ? { ...b, ...patch } : b)))

  const addBomLine = () => {
    setBom((list) => [
      ...list,
      { uid: nextUid, itemName: "", unit: unit.trim(), qty: "1", departmentId: routeSteps[0]?.departmentId || "", withWaste: false, lotted: false, cost: "" },
    ])
    setNextUid((n) => n + 1)
  }

  const validateStep1 = (): string | null => {
    if (!name.trim()) return t("mfg3_prd_err_name")
    if (!unit.trim()) return t("mfg3_prd_err_unit")
    if (!routeSteps.length) return t("mfg2_err_route_required")
    for (const v of [salePrice, buyRef, estimate, waste]) {
      const n = num(v)
      if (v.trim() !== "" && (n == null || n < 0)) return t("mfg3_prd_err_number")
    }
    return null
  }

  const validateStep2 = (): string | null => {
    const inRoute = new Set(routeSteps.map((r) => r.departmentId))
    for (const b of bom) {
      if (!b.itemName.trim()) continue
      const q = num(b.qty)
      if (q == null || q <= 0) return t("mfg3_prd_err_bom_qty", { item: b.itemName.trim() })
      if (!inRoute.has(b.departmentId)) return t("mfg3_prd_err_bom_dept", { item: b.itemName.trim() })
      const c = num(b.cost)
      if (b.cost.trim() !== "" && (c == null || c < 0)) return t("mfg3_prd_err_number")
    }
    return null
  }

  const next = () => {
    const problem = validateStep1()
    setError(problem)
    if (!problem) setStep(1)
  }

  const submit = async () => {
    if (!firestore || busy) return
    const problem = validateStep1() || validateStep2()
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      const id = await createMfgProduct(firestore, {
        organizationId: data.orgId,
        product: {
          name: name.trim(),
          unit: unit.trim(),
          family,
          requiresMeasurement: fit,
          requiresDrawingApproval: appr,
          requiresSlabApproval: slab,
          wastePercent,
          salePrice: num(salePrice),
          estimateValue: num(estimate),
          referenceBuyPrice: buy,
          route: routeSteps,
          bom: bomLines,
        },
        actor: data.actor,
      })
      toast({ title: t("mfg2_product_created") })
      onCreated(id)
    } catch (err) {
      console.error(err)
      setError(t("mfg_save_error"))
    } finally {
      setBusy(false)
    }
  }

  const flagOptions = [
    { key: "fit", label: t("mfg2_flag_measurement_full"), short: t("mfg2_flag_measurement"), value: fit, set: setFit },
    { key: "appr", label: t("mfg2_flag_drawing_full"), short: t("mfg2_flag_drawing"), value: appr, set: setAppr },
    { key: "slab", label: t("mfg2_flag_slab_full"), short: t("mfg2_flag_slab"), value: slab, set: setSlab },
  ]
  const flagsOn = flagOptions.filter((f) => f.value)

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Layers}
      title={t("mfg2_new_product")}
      subtitle={t("mfg3_prd_form_subtitle")}
      steps={[t("mfg3_prd_step_definition"), t("mfg3_prd_step_bom")]}
      step={step}
      error={error}
      busy={busy}
      size="lg"
      onBack={() => {
        setError(null)
        setStep(0)
      }}
      onNext={next}
      onConfirm={submit}
      confirmLabel={t("mfg2_create_product_btn")}
    >
      {step === 0 ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <MfgField label={t("mfg2_field_product_name")} required htmlFor="mfg-prd-name">
                <Input id="mfg-prd-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
              </MfgField>
            </div>
            <MfgField label={t("mfg2_field_unit")} required htmlFor="mfg-prd-unit">
              <Input id="mfg-prd-unit" dir="auto" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </MfgField>
            <MfgField label={t("mfg2_field_family")} htmlFor="mfg-prd-family">
              <Select value={family} onValueChange={(v) => setFamily(v as MfgFamily)}>
                <SelectTrigger id="mfg-prd-family">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MFG_FAMILIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`mfg2_family_${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MfgField>
            <MfgField label={t("mfg2_field_waste")} hint={t("mfg3_prd_waste_hint")} htmlFor="mfg-prd-waste">
              <Input id="mfg-prd-waste" type="number" inputMode="decimal" min="0" max="90" value={waste} onChange={(e) => setWaste(e.target.value)} />
            </MfgField>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-xs font-bold text-slate-700">{t("mfg3_prd_flags_title")}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {flagOptions.map((f) => (
                <label
                  key={f.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-xl border-2 bg-white px-3 py-2.5 text-[11px] font-semibold leading-relaxed transition-colors",
                    f.value ? "border-warning bg-warning/5 text-foreground" : "border-border text-muted-foreground hover:border-slate-300"
                  )}
                >
                  <Checkbox checked={f.value} onCheckedChange={(v) => f.set(!!v)} className="mt-0.5" />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MfgField label={t("mfg2_field_sale_price")} hint={t("mfg3_prd_sale_price_hint")} htmlFor="mfg-prd-price">
              <Input id="mfg-prd-price" type="number" inputMode="decimal" min="0" value={salePrice} placeholder={t("mfg2_empty_means_unknown")} onChange={(e) => setSalePrice(e.target.value)} />
            </MfgField>
            <MfgField label={t("mfg2_field_buy_ref")} hint={t("mfg3_prd_buy_ref_hint")} htmlFor="mfg-prd-buy">
              <Input id="mfg-prd-buy" type="number" inputMode="decimal" min="0" value={buyRef} placeholder={t("mfg2_empty_means_unknown")} onChange={(e) => setBuyRef(e.target.value)} />
            </MfgField>
            <MfgField label={t("mfg3_prd_estimate_value")} hint={t("mfg3_prd_estimate_value_hint")} htmlFor="mfg-prd-estimate">
              <Input id="mfg-prd-estimate" type="number" inputMode="decimal" min="0" value={estimate} placeholder={t("mfg2_empty_means_unknown")} onChange={(e) => setEstimate(e.target.value)} />
            </MfgField>
          </div>

          <section className="overflow-hidden rounded-xl border bg-white">
            <header className="border-b border-border/60 px-3.5 py-2.5">
              <p className="text-xs font-bold text-slate-700">{timeOn ? t("mfg2_route_time_title") : t("mfg3_prd_route_title")}</p>
              <p className="text-[11px] text-muted-foreground">{t("mfg3_prd_route_hint")}</p>
            </header>
            {rows.length === 0 && (
              <div className="p-3">
                <MfgNote tone="warn">{t("mfg3_prd_no_departments")}</MfgNote>
              </div>
            )}
            {rows.map((r, i) => {
              const Icon = departmentIcon(r.dept.name, r.dept.onSite)
              const position = r.draft.on ? routeSteps.findIndex((s) => s.departmentId === r.dept.id) + 1 : 0
              return (
                <div key={r.dept.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-3.5 py-2 text-xs last:border-b-0", r.draft.on && "bg-warning/5")}>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                    <Checkbox checked={r.draft.on} onCheckedChange={(v) => setDraft(r.dept.id, { on: !!v })} aria-label={r.dept.name} />
                    <span
                      className={cn(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-bold tabular-nums",
                        r.draft.on ? "bg-warning text-white" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {r.draft.on ? position : <Icon size={12} aria-hidden="true" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-foreground">{r.dept.name}</span>
                      {timeOn && <span className="block text-[10px] text-muted-foreground">{t("mfg2_set_capacity_value", { hours: fmtQty(deptCapacity(r.dept)) })}</span>}
                    </span>
                  </label>
                  {r.draft.on && timeOn && (
                    <span className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        aria-label={t("mfg3_prd_hours_for", { dept: r.dept.name })}
                        className="h-8 w-20 text-xs"
                        value={r.draft.hours}
                        onChange={(e) => setDraft(r.dept.id, { hours: e.target.value })}
                      />
                      <span className="text-[11px] text-muted-foreground">{t("mfg2_hours_per_unit")}</span>
                    </span>
                  )}
                  <span className="flex items-center">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={t("mfg3_set_move_up", { name: r.dept.name })}
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                    >
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1}
                      aria-label={t("mfg3_set_move_down", { name: r.dept.name })}
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                    >
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              )
            })}
          </section>
        </>
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border bg-white">
            <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-700">{t("mfg2_bom_title")}</p>
                <p className="text-[11px] text-muted-foreground">{t("mfg2_bom_hint")}</p>
              </div>
              <Button size="sm" variant="outline" className="ms-auto h-8 gap-1 text-xs" onClick={addBomLine}>
                <Plus size={13} aria-hidden="true" /> {t("mfg2_bom_add")}
              </Button>
            </header>
            {bom.length === 0 && <p className="px-3.5 py-3 text-xs text-muted-foreground">{t("mfg2_bom_empty")}</p>}
            <datalist id="mfg-prd-items">
              {knownItems.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {bom.map((b, i) => (
              <div key={b.uid} className="grid grid-cols-2 gap-2 border-b border-border/60 px-3.5 py-3 last:border-b-0 sm:grid-cols-12">
                <MiniField label={t("mfg2_bom_item")} className="col-span-2 sm:col-span-4" htmlFor={`bom-item-${b.uid}`}>
                  <Input id={`bom-item-${b.uid}`} list="mfg-prd-items" dir="auto" className="h-8 text-xs" value={b.itemName} onChange={(e) => patchBom(b.uid, { itemName: e.target.value })} />
                </MiniField>
                <MiniField label={t("mfg2_field_unit")} className="sm:col-span-2" htmlFor={`bom-unit-${b.uid}`}>
                  <Input id={`bom-unit-${b.uid}`} dir="auto" className="h-8 text-xs" value={b.unit} onChange={(e) => patchBom(b.uid, { unit: e.target.value })} />
                </MiniField>
                <MiniField label={t("mfg3_prd_qty_per_unit")} className="sm:col-span-2" htmlFor={`bom-qty-${b.uid}`}>
                  <Input id={`bom-qty-${b.uid}`} type="number" inputMode="decimal" min="0" step="any" className="h-8 text-xs" value={b.qty} onChange={(e) => patchBom(b.uid, { qty: e.target.value })} />
                </MiniField>
                <MiniField label={t("mfg2_bom_dept")} className="col-span-2 sm:col-span-4" htmlFor={`bom-dept-${b.uid}`}>
                  <Select value={b.departmentId} onValueChange={(v) => patchBom(b.uid, { departmentId: v })}>
                    <SelectTrigger id={`bom-dept-${b.uid}`} className={cn("h-8 text-xs", b.departmentId && !routeSteps.some((s) => s.departmentId === b.departmentId) && "border-destructive")}>
                      <SelectValue placeholder={t("mfg2_bom_dept")} />
                    </SelectTrigger>
                    <SelectContent>
                      {routeSteps.map((s) => (
                        <SelectItem key={s.departmentId} value={s.departmentId}>
                          {s.departmentName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </MiniField>
                <MiniField label={t("mfg3_prd_unit_cost")} className="sm:col-span-3" htmlFor={`bom-cost-${b.uid}`}>
                  <Input id={`bom-cost-${b.uid}`} type="number" inputMode="decimal" min="0" className="h-8 text-xs" value={b.cost} placeholder={t("mfg2_empty_means_unknown")} onChange={(e) => patchBom(b.uid, { cost: e.target.value })} />
                </MiniField>
                <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-2 sm:col-span-9">
                  <label className="flex min-h-8 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                    <Checkbox checked={b.withWaste} onCheckedChange={(v) => patchBom(b.uid, { withWaste: !!v })} />
                    {t("mfg3_prd_with_waste")}
                  </label>
                  <label className="flex min-h-8 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                    <Checkbox checked={b.lotted} onCheckedChange={(v) => patchBom(b.uid, { lotted: !!v })} />
                    {t("mfg3_prd_lotted")}
                  </label>
                  <button
                    type="button"
                    onClick={() => setBom((list) => list.filter((x) => x.uid !== b.uid))}
                    aria-label={t("mfg3_prd_remove_line", { index: i + 1 })}
                    className="ms-auto grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </section>

          <MfgReview
            rows={[
              [t("mfg3_prd_stat_departments"), routeSteps.map((s) => s.departmentName).join(" · ")],
              timeOn && [t("mfg3_prd_stat_std_time"), <span key="h" className="tabular-nums">{fmtQty(std.hours)} {t("mfg2_hours_per_unit")}</span>],
              [t("mfg2_cost_materials"), <span key="m" className="tabular-nums">{fmtMoney(std.materials)} ﷼</span>],
              timeOn && [t("mfg2_cost_labour"), <span key="l" className="tabular-nums">{fmtMoney(std.labour)} ﷼</span>],
              timeOn && [t("mfg2_cost_overhead"), <span key="o" className="tabular-nums">{fmtMoney(std.overhead)} ﷼</span>],
              [
                t("mfg2_unit_cost"),
                <span key="u" className="tabular-nums">
                  {fmtMoney(std.total)} ﷼{!std.allPriced && <span className="ms-1.5 text-warning">({t("mfg2_cost_incomplete")})</span>}
                </span>,
              ],
              buy != null &&
                std.allPriced && [
                  t("mfg2_vs_buying"),
                  <span key="b" className={cn("tabular-nums", buy - std.total >= 0 ? "text-success" : "text-destructive")}>
                    {fmtMoney(Math.abs(buy - std.total))} ﷼ · {buy - std.total >= 0 ? t("mfg2_make_wins") : t("mfg2_buy_wins")}
                  </span>,
                ],
            ]}
          />

          <MfgEffects
            items={[
              { text: t("mfg3_prd_effect_card") },
              timeOn && { text: t("mfg3_prd_effect_time", { hours: fmtQty(std.hours), count: routeSteps.length }) },
              bomLines.length > 0
                ? { text: t("mfg3_prd_effect_bom", { count: bomLines.length }) }
                : { text: t("mfg2_bom_empty"), applies: false },
              flagsOn.length > 0 && { text: t("mfg3_prd_effect_flags", { flags: flagsOn.map((f) => f.short).join(" · ") }) },
              num(salePrice) == null && { text: t("mfg3_prd_effect_no_price"), applies: false },
            ]}
          />
        </>
      )}
    </MfgFormModal>
  )
}

function MiniField({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={htmlFor} className="block text-[10px] font-bold text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
