"use client"

// The product panel: its flags, the standard unit cost against Procurement's
// reference buy price (money roles), the route — this product's only, with
// order-level steps marked and steps without standard time left out of
// scheduling — the bill of materials per unit with its waste and custody
// flags and what the stores hold, and the orders made on it.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { ClipboardList, Mountain, PackageOpen, PencilLine, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { effectiveRoute, itemKey, labourCostOn, standardCost, stationGate } from "@/lib/manufacturing-engine"
import { compareOrders } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgModuleChip, MfgStatePill, sourceNameOf } from "./MfgOrderBits"
import { MfgPrdFlags, liveOrdersOn, productTime, stepName } from "./MfgPrdBits"
import { MfgChip, MfgDrawer, MfgRow, MfgSection, MfgStat, departmentIcon, fmtSar, fmtQty } from "./ui/MfgUi"

const ORDERS_SHOWN = 8

export function MfgPrdDrawer({ productId, onClose }: { productId: string | null; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms, seesMoney } = ui
  const product = productId ? data.productById.get(productId) || null : null
  const std = useMemo(() => (product ? standardCost(product, data.departments, data.settings, 1) : null), [product, data.departments, data.settings])
  const orders = useMemo(() => (product ? ui.views.filter((v) => v.product.id === product.id).sort(compareOrders) : []), [ui.views, product])

  if (!product || !std) return null

  const timeOn = data.settings.features.time
  const costOn = labourCostOn(data.settings)
  const time = productTime(product)
  const route = effectiveRoute(product)
  const locked = liveOrdersOn(product.id, ui.views) > 0
  const stockKnown = !!data.stock

  const edit = () => {
    onClose()
    ui.openGlobal({ kind: "product", productId: product.id })
  }

  return (
    <MfgDrawer
      open
      onClose={onClose}
      icon={Mountain}
      title={<span dir="auto">{product.name}</span>}
      meta={
        <>
          <span>{t("mfr_prd_unit", { unit: product.unit })}</span>
          <span aria-hidden="true">·</span>
          <span>{t("mfr_prd_waste", { pct: fmtQty(product.wastePercent) })}</span>
          <MfgPrdFlags product={product} />
        </>
      }
      footer={
        perms.canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-10 gap-1.5" onClick={edit}>
              <PencilLine size={14} aria-hidden="true" /> {t("mfr_prd_edit")}
            </Button>
            {locked && <span className="text-[11px] text-muted-foreground">{t("mfr_prd_locked_hint")}</span>}
          </div>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {seesMoney ? (
          <>
            <MfgStat
              label={t(costOn ? "mfr_prd_std_unit_cost" : "mfr_prd_std_unit_cost_materials")}
              value={
                <span dir="ltr" className="tabular-nums">
                  {fmtSar(std.total)}
                </span>
              }
              sub={!std.allPriced ? t("mfr_cost_incomplete") : timeOn && time.unestimated ? t("mfr_prd_not_estimated_count", { count: time.unestimated }) : undefined}
            />
            <MfgStat
              label={t("mfr_prd_ref_buy")}
              value={
                <span dir="ltr" className="tabular-nums">
                  {product.referenceBuyPrice ? fmtSar(product.referenceBuyPrice) : "—"}
                </span>
              }
              sub={t("mfg4_from_module", { module: t("mfg4_module_procurement") })}
            />
          </>
        ) : (
          <>
            <MfgStat label={t("mfr_prd_time")} value={timeOn ? t("mfr_prd_hours", { hours: fmtQty(time.hours) }) : "—"} />
            <MfgStat label={t("mfr_prd_steps")} value={<span className="tabular-nums">{route.length}</span>} />
          </>
        )}
      </div>

      <MfgSection icon={Workflow} title={t("mfr_prd_route_title")} right={timeOn ? <span className="tabular-nums text-muted-foreground">{t("mfr_prd_hours_per_unit", { hours: fmtQty(time.hours) })}</span> : undefined}>
        {route.map((step, i) => {
          const dept = data.departments.find((d) => d.id === step.departmentId)
          const name = stepName(data.departments, step)
          const Icon = departmentIcon(name)
          return (
            <MfgRow
              key={`${step.departmentId}_${i}`}
              right={
                <>
                  {stationGate(dept || { name: step.departmentName }) && <MfgChip tone="muted">{t("mfr_prd_order_level")}</MfgChip>}
                  {timeOn &&
                    (step.hoursPerUnit == null ? (
                      <MfgChip tone="warn">{t("mfr_prd_not_estimated_long")}</MfgChip>
                    ) : (
                      <span className="tabular-nums text-muted-foreground">{t("mfr_prd_hours_per_unit", { hours: fmtQty(step.hoursPerUnit) })}</span>
                    ))}
                </>
              }
            >
              <span className="flex items-center gap-2 font-semibold text-foreground">
                <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="tabular-nums">{i + 1}.</span>
                <span dir="auto">{name}</span>
              </span>
            </MfgRow>
          )
        })}
      </MfgSection>

      <MfgSection icon={PackageOpen} title={t("mfr_prd_bom_title")} right={<span className="tabular-nums text-muted-foreground">{product.bom.length}</span>}>
        {product.bom.length === 0 && <p className="px-3.5 py-3 text-xs text-muted-foreground">{t("mfr_prd_bom_empty")}</p>}
        {product.bom.map((line, i) => {
          const at = product.route.find((r) => r.departmentId === line.departmentId)
          const available = data.stock?.onHand.get(itemKey(line.itemName))
          return (
            <div key={`${line.itemName}_${i}`} className="flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5 text-xs last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground" dir="auto">
                  {line.itemName}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  <span dir="auto">{t("mfr_prd_consumed_at", { station: at ? stepName(data.departments, at) : "—" })}</span>
                  {line.withWaste && !line.custody && <MfgChip tone="warn">{t("mfr_prd_waste_flag", { pct: fmtQty(product.wastePercent) })}</MfgChip>}
                  {line.custody && <MfgChip tone="info">{t("mfr_prd_custody_flag")}</MfgChip>}
                </p>
              </div>
              <div className="shrink-0 text-end">
                <p className="font-bold tabular-nums text-foreground">
                  <span dir="ltr">{fmtQty(line.qtyPerUnit)}</span> <span className="font-semibold text-muted-foreground">{line.unit}</span>
                </p>
                <p className="text-[10px] text-muted-foreground">{t("mfr_prd_per_unit")}</p>
              </div>
              <div className="w-20 shrink-0 text-end">
                <p className="font-semibold tabular-nums text-foreground">{stockKnown ? fmtQty(available ?? 0) : "—"}</p>
                <p className="text-[10px] text-muted-foreground">{t("mfr_prd_available")}</p>
              </div>
            </div>
          )
        })}
        <div className="flex items-center gap-1.5 px-3.5 py-2 text-[11px] text-muted-foreground">
          <MfgModuleChip module="inventory" prefix="from" /> {t("mfr_prd_stock_note")}
        </div>
      </MfgSection>

      <MfgSection icon={ClipboardList} title={t("mfr_prd_orders_title")} right={<span className="tabular-nums text-cta">{orders.length}</span>}>
        {orders.length === 0 && <p className="px-3.5 py-3 text-xs text-muted-foreground">{t("mfr_prd_orders_empty")}</p>}
        {orders.slice(0, ORDERS_SHOWN).map((v) => (
          <MfgRow
            key={v.id}
            onClick={() => {
              onClose()
              ui.openOrder(v.id)
            }}
            right={<MfgStatePill view={v} />}
          >
            <b dir="ltr" className="font-mono text-[11px]">
              {v.ref}
            </b>{" "}
            <span className="text-muted-foreground">
              <span dir="ltr" className="tabular-nums">
                {fmtQty(v.quantity)}
              </span>{" "}
              {v.unit} · <span dir="auto">{sourceNameOf(v, t)}</span>
            </span>
          </MfgRow>
        ))}
        {orders.length > ORDERS_SHOWN && <p className="px-3.5 py-2 text-[11px] text-muted-foreground">{t("mfr_prd_orders_more", { count: orders.length - ORDERS_SHOWN })}</p>}
      </MfgSection>
    </MfgDrawer>
  )
}
