"use client"

// Product cards — route + BOM + standard time + planned waste + blocking
// facts. The card is data, not code: define one and it travels the system the
// way stone does.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Layers, Plus, Ruler, PencilRuler, Eye, Loader2, Search, Trash2 } from "lucide-react"
import { deleteDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { MfgData } from "@/hooks/useMfgData"
import {
  MFG_PRODUCTS,
  standardCost,
  stationQueueDays,
  type MfgBomLine,
  type MfgFamily,
  type MfgRouteStep,
} from "@/lib/manufacturing-engine"
import { createMfgProduct } from "@/lib/manufacturing-writes"

const fmtMoney = (n: number) => Number(Math.round(n) || 0).toLocaleString("en-US")
const FAMILIES: MfgFamily[] = ["stone", "wood", "aluminium", "steel", "other"]

export function MfgProductsView({ data }: { data: MfgData }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const products = useMemo(
    () => data.products.filter((p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())),
    [data.products, search]
  )
  const detail = detailId ? data.productById.get(detailId) : null

  return (
    <div className="space-y-4" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("mfg2_products_search")} className="h-9 ps-9 w-56" />
        </div>
        <p className="text-xs text-muted-foreground">{t("mfg2_products_hint")}</p>
        {data.canManage && (
          <Button size="sm" className="ms-auto gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> {t("mfg2_new_product")}
          </Button>
        )}
      </div>

      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed rounded-xl p-8 text-center">{t("mfg2_products_empty")}</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {products.map((p) => {
            const std = standardCost(p, data.departments, data.settings, 1)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setDetailId(p.id)}
                className="rounded-xl border bg-white p-4 text-start hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="font-bold text-sm flex items-center gap-2">
                  <Layers size={15} className="text-cta shrink-0" />
                  <span className="truncate">{p.name}</span>
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t(`mfg2_family_${p.family}`)} · {p.unit}
                  {p.wastePercent > 0 && <> · {t("mfg2_waste_label", { percent: p.wastePercent })}</>}
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {p.route.map((r, i) => (
                    <Badge key={`${r.departmentId}_${i}`} variant="outline" className="text-[9px] px-1.5 py-0">{r.departmentName}</Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {p.requiresMeasurement && (
                    <Badge className="bg-amber-100 text-amber-700 border-none text-[9px] gap-0.5"><Ruler size={9} /> {t("mfg2_flag_measurement")}</Badge>
                  )}
                  {p.requiresDrawingApproval && (
                    <Badge className="bg-violet-100 text-violet-700 border-none text-[9px] gap-0.5"><PencilRuler size={9} /> {t("mfg2_flag_drawing")}</Badge>
                  )}
                  {p.requiresSlabApproval && (
                    <Badge className="bg-cta/10 text-cta border-none text-[9px] gap-0.5"><Eye size={9} /> {t("mfg2_flag_slab")}</Badge>
                  )}
                </div>
                {data.seesMoney && (
                  <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t tabular-nums">
                    {t("mfg2_make_cost")}: <b className="text-foreground">{fmtMoney(std.total)} ﷼</b>
                    {!std.allPriced && <span className="text-amber-600"> ({t("mfg2_cost_incomplete")})</span>}
                    {p.referenceBuyPrice != null && (
                      <> · {t("mfg2_buy_ref")}: <b className="text-foreground">{fmtMoney(p.referenceBuyPrice)} ﷼</b></>
                    )}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {showCreate && <ProductFormDialog data={data} onClose={() => setShowCreate(false)} />}

      {detail && (
        <Dialog open onOpenChange={(v) => !v && setDetailId(null)}>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <Layers size={16} className="text-cta" /> {detail.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <section className="rounded-xl border overflow-hidden">
                <header className="px-4 py-2 border-b bg-muted/30 text-xs font-black">{t("mfg2_route_title")}</header>
                {detail.route.map((r, i) => (
                  <div key={`${r.departmentId}_${i}`} className="flex items-center justify-between px-4 py-2 border-b last:border-b-0 text-xs">
                    <span className="font-semibold">{i + 1}. {r.departmentName}{r.onSite ? ` (${t("mfg2_on_site")})` : ""}</span>
                    {data.settings.features.time && (
                      <span className="text-muted-foreground tabular-nums">
                        {r.hoursPerUnit} {t("mfg2_hours_per_unit")} · {t("mfg2_queue_days", { days: stationQueueDays(data.scheduleInputs, data.departments.find((d) => d.id === r.departmentId) || { id: r.departmentId }) })}
                      </span>
                    )}
                  </div>
                ))}
              </section>
              <section className="rounded-xl border overflow-hidden">
                <header className="px-4 py-2 border-b bg-muted/30 text-xs font-black">{t("mfg2_bom_title")}</header>
                {detail.bom.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">{t("mfg2_bom_empty")}</p>}
                {detail.bom.map((b, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2 border-b last:border-b-0 text-xs">
                    <span className="font-semibold">
                      {b.itemName}
                      <span className="text-muted-foreground font-normal"> · {detail.route.find((r) => r.departmentId === b.departmentId)?.departmentName || b.departmentId}</span>
                      {b.withWaste && <span className="text-amber-600"> · {t("mfg2_waste_label", { percent: detail.wastePercent })}</span>}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {b.qtyPerUnit} {b.unit}
                      {data.seesMoney && <> · {b.unitCost == null ? t("mfg2_cost_unknown") : `${fmtMoney(b.unitCost)} ﷼`}</>}
                    </span>
                  </div>
                ))}
              </section>
              {data.seesMoney && (
                <section className="rounded-xl border px-4 py-3 text-xs space-y-1">
                  {(() => {
                    const std = standardCost(detail, data.departments, data.settings, 1)
                    return (
                      <>
                        <Row label={t("mfg2_cost_materials")} value={`${fmtMoney(std.materials)} ﷼`} />
                        <Row label={t("mfg2_cost_labour")} value={`${fmtMoney(std.labour)} ﷼`} />
                        <Row label={t("mfg2_cost_overhead")} value={`${fmtMoney(std.overhead)} ﷼`} />
                        <div className="flex items-center justify-between border-t pt-1 font-black">
                          <span>{t("mfg2_unit_cost")}</span>
                          <span className="tabular-nums">{fmtMoney(std.total)} ﷼</span>
                        </div>
                        {detail.referenceBuyPrice != null && (
                          <Row
                            label={t("mfg2_vs_buying")}
                            value={`${fmtMoney(detail.referenceBuyPrice - std.total)} ﷼ ${detail.referenceBuyPrice - std.total >= 0 ? t("mfg2_make_wins") : t("mfg2_buy_wins")}`}
                          />
                        )}
                      </>
                    )
                  })()}
                </section>
              )}
              {data.canManage && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-destructive"
                    onClick={async () => {
                      if (!firestore) return
                      const used = data.v2Orders.some((o) => o.productId === detail.id && o.status === "open")
                      if (used) {
                        toast({ title: t("mfg2_product_in_use"), variant: "destructive" })
                        return
                      }
                      await deleteDoc(doc(firestore, MFG_PRODUCTS, detail.id))
                      setDetailId(null)
                      toast({ title: t("mfg2_product_deleted") })
                    }}
                  >
                    <Trash2 size={13} /> {t("mfg2_delete_product")}
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-semibold">{value}</span>
    </div>
  )
}

function ProductFormDialog({ data, onClose }: { data: MfgData; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("")
  const [unit, setUnit] = useState("م²")
  const [family, setFamily] = useState<MfgFamily>("stone")
  const [waste, setWaste] = useState("0")
  const [salePrice, setSalePrice] = useState("")
  const [buyRef, setBuyRef] = useState("")
  const [fit, setFit] = useState(false)
  const [appr, setAppr] = useState(false)
  const [slab, setSlab] = useState(false)
  const [route, setRoute] = useState<Array<{ on: boolean; hours: string; dept: (typeof data.departments)[number] }>>(
    data.departments.map((d) => ({ on: true, hours: "0.2", dept: d }))
  )
  const [bom, setBom] = useState<Array<{ itemName: string; unit: string; qty: string; departmentId: string; withWaste: boolean; cost: string; lotted: boolean }>>([])

  const submit = async () => {
    if (!firestore || busy) return
    if (!name.trim()) {
      toast({ title: t("mfg2_err_name_required"), variant: "destructive" })
      return
    }
    const steps: MfgRouteStep[] = route
      .filter((r) => r.on)
      .map((r) => ({
        departmentId: r.dept.id,
        departmentName: r.dept.name,
        hoursPerUnit: Number(r.hours) || 0,
        ...(r.dept.onSite ? { onSite: true } : {}),
      }))
    if (!steps.length) {
      toast({ title: t("mfg2_err_route_required"), variant: "destructive" })
      return
    }
    const bomLines: MfgBomLine[] = bom
      .filter((b) => b.itemName.trim() && Number(b.qty) > 0)
      .map((b) => ({
        itemName: b.itemName.trim(),
        unit: b.unit.trim(),
        qtyPerUnit: Number(b.qty),
        departmentId: b.departmentId || steps[0].departmentId,
        withWaste: b.withWaste,
        unitCost: b.cost === "" ? null : Number(b.cost),
        lotted: b.lotted,
      }))
    setBusy(true)
    try {
      await createMfgProduct(firestore, {
        organizationId: data.orgId,
        product: {
          name: name.trim(),
          unit: unit.trim() || "قطعة",
          family,
          requiresMeasurement: fit,
          requiresDrawingApproval: appr,
          requiresSlabApproval: slab,
          wastePercent: Number(waste) || 0,
          salePrice: salePrice === "" ? null : Number(salePrice),
          estimateValue: null,
          referenceBuyPrice: buyRef === "" ? null : Number(buyRef),
          route: steps,
          bom: bomLines,
        },
        actor: data.actor,
      })
      toast({ title: t("mfg2_product_created") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="text-base">{t("mfg2_new_product")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs font-bold">{t("mfg2_field_product_name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold">{t("mfg2_field_unit")}</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold">{t("mfg2_field_family")}</Label>
              <Select value={family} onValueChange={(v) => setFamily(v as MfgFamily)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FAMILIES.map((f) => (
                    <SelectItem key={f} value={f}>{t(`mfg2_family_${f}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold">{t("mfg2_field_waste")}</Label>
              <Input type="number" min="0" max="90" value={waste} onChange={(e) => setWaste(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold">{t("mfg2_field_sale_price")}</Label>
              <Input type="number" min="0" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder={t("mfg2_empty_means_unknown")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold">{t("mfg2_field_buy_ref")}</Label>
              <Input type="number" min="0" value={buyRef} onChange={(e) => setBuyRef(e.target.value)} placeholder={t("mfg2_empty_means_unknown")} />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-xs">
            {[
              { key: "fit", label: t("mfg2_flag_measurement_full"), value: fit, set: setFit },
              { key: "appr", label: t("mfg2_flag_drawing_full"), value: appr, set: setAppr },
              { key: "slab", label: t("mfg2_flag_slab_full"), value: slab, set: setSlab },
            ].map((f) => (
              <label key={f.key} className="flex items-center gap-2 font-semibold cursor-pointer">
                <Checkbox checked={f.value} onCheckedChange={(v) => f.set(!!v)} /> {f.label}
              </label>
            ))}
          </div>

          <section className="rounded-xl border overflow-hidden">
            <header className="px-4 py-2 border-b bg-muted/30 text-xs font-black">
              {data.settings.features.time ? t("mfg2_route_time_title") : t("mfg2_route_title")}
            </header>
            {route.map((r, i) => (
              <div key={r.dept.id} className="flex items-center gap-3 px-4 py-2 border-b last:border-b-0 text-xs">
                <label className="flex items-center gap-2 font-semibold cursor-pointer flex-1">
                  <Checkbox checked={r.on} onCheckedChange={(v) => setRoute((rs) => rs.map((x, j) => (j === i ? { ...x, on: !!v } : x)))} />
                  {r.dept.name}
                  {r.dept.onSite && <Badge variant="outline" className="text-[9px]">{t("mfg2_on_site")}</Badge>}
                </label>
                {r.on && data.settings.features.time && (
                  <span className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      className="h-7 w-20 text-xs"
                      value={r.hours}
                      onChange={(e) => setRoute((rs) => rs.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))}
                    />
                    <span className="text-muted-foreground">{t("mfg2_hours_per_unit")}</span>
                  </span>
                )}
              </div>
            ))}
            {data.departments.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">{t("mfg_no_departments")}</p>}
          </section>

          <section className="rounded-xl border overflow-hidden">
            <header className="px-4 py-2 border-b bg-muted/30 text-xs font-black flex items-center justify-between">
              {t("mfg2_bom_title")}
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] gap-1"
                onClick={() =>
                  setBom((b) => [...b, { itemName: "", unit: "م²", qty: "1", departmentId: route.find((r) => r.on)?.dept.id || "", withWaste: false, cost: "", lotted: false }])
                }
              >
                <Plus size={10} /> {t("mfg2_bom_add")}
              </Button>
            </header>
            {bom.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">{t("mfg2_bom_hint")}</p>}
            {bom.map((b, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5 items-center px-3 py-2 border-b last:border-b-0 text-xs">
                <Input className="h-7 col-span-3 text-xs" placeholder={t("mfg2_bom_item")} value={b.itemName} onChange={(e) => setBom((rs) => rs.map((x, j) => (j === i ? { ...x, itemName: e.target.value } : x)))} />
                <Input className="h-7 col-span-1 text-xs" placeholder={t("mfg2_field_unit")} value={b.unit} onChange={(e) => setBom((rs) => rs.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
                <Input className="h-7 col-span-1 text-xs" type="number" min="0" step="any" placeholder={t("mfg2_bom_qty")} value={b.qty} onChange={(e) => setBom((rs) => rs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                <div className="col-span-3">
                  <Select value={b.departmentId} onValueChange={(v) => setBom((rs) => rs.map((x, j) => (j === i ? { ...x, departmentId: v } : x)))}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={t("mfg2_bom_dept")} /></SelectTrigger>
                    <SelectContent>
                      {route.filter((r) => r.on).map((r) => (
                        <SelectItem key={r.dept.id} value={r.dept.id}>{r.dept.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input className="h-7 col-span-1 text-xs" type="number" min="0" placeholder={t("mfg2_bom_cost")} value={b.cost} onChange={(e) => setBom((rs) => rs.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} />
                <label className={cn("col-span-1 flex items-center gap-1 cursor-pointer text-[10px] font-semibold")}>
                  <Checkbox checked={b.withWaste} onCheckedChange={(v) => setBom((rs) => rs.map((x, j) => (j === i ? { ...x, withWaste: !!v } : x)))} />
                  {t("mfg2_bom_waste")}
                </label>
                <label className="col-span-1 flex items-center gap-1 cursor-pointer text-[10px] font-semibold">
                  <Checkbox checked={b.lotted} onCheckedChange={(v) => setBom((rs) => rs.map((x, j) => (j === i ? { ...x, lotted: !!v } : x)))} />
                  {t("mfg2_bom_lot")}
                </label>
                <button type="button" className="col-span-1 text-muted-foreground hover:text-destructive grid place-items-center" onClick={() => setBom((rs) => rs.filter((_, j) => j !== i))} aria-label={t("crm_cancel")}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </section>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{t("crm_cancel")}</Button>
            <Button size="sm" disabled={busy} onClick={submit} className="gap-1.5">
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t("mfg2_create_product_btn")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Departments can be flagged for site installation and given capacity from
 * the settings tab; this small helper is shared there. */
export async function updateDepartmentCapacity(
  firestore: ReturnType<typeof useFirestore>,
  departmentId: string,
  patch: { workers?: number | null; hoursPerDay?: number | null; hourlyRate?: number | null; onSite?: boolean }
): Promise<void> {
  if (!firestore) return
  await updateDoc(doc(firestore, "manufacturingDepartments", departmentId), { ...patch, updatedAt: serverTimestamp() })
}
