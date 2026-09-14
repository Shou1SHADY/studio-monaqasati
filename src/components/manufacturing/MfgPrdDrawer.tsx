"use client"

// One product card opened without leaving the list: what it takes (route and
// time), what it consumes (BOM), what one unit costs against buying it, and the
// orders already made from it.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ClipboardList, Coins, Loader2, PackageOpen, Trash2, Workflow } from "lucide-react"
import { deleteDoc, doc } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  MFG_PRODUCTS,
  possibleForDays,
  standardCost,
  stationQueueDays,
  wasteFactor,
  type MfgProduct,
} from "@/lib/manufacturing-engine"
import { compareOrders } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgStatePill, sourceNameOf } from "./MfgOrderBits"
import { MfgPrdFlags, familyIcon, queueTone, stepName } from "./MfgPrdBits"
import {
  MfgChip,
  MfgDrawer,
  MfgNote,
  MfgPill,
  MfgSection,
  MfgStat,
  departmentIcon,
  fmtMoney,
  fmtQty,
} from "./ui/MfgUi"

const ORDERS_SHOWN = 8

export function MfgPrdDrawer({ product, onClose }: { product: MfgProduct; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms } = ui
  const firestore = useFirestore()
  const { toast } = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const timeOn = data.settings.features.time
  const std = useMemo(() => standardCost(product, data.departments, data.settings, 1), [product, data.departments, data.settings])
  const leadDays = useMemo(
    () => (timeOn ? possibleForDays(product, 1, data.scheduleInputs, data.departments) : 0),
    [timeOn, product, data.scheduleInputs, data.departments]
  )
  const orders = useMemo(() => ui.views.filter((v) => v.product.id === product.id).sort(compareOrders), [ui.views, product.id])
  const buy = product.referenceBuyPrice
  const buyDiff = buy != null && std.allPriced ? buy - std.total : null

  // Standard time and lead time need the time switch; cost needs money
  // visibility. Whatever is hidden gives its place to a plain fact of the card.
  const stats: Array<{ key: string; label: string; value: string; sub?: string; tone?: string }> = []
  if (timeOn) {
    stats.push({ key: "time", label: t("mfg3_prd_stat_std_time"), value: `${fmtQty(std.hours)} ${t("mfg2_hours_per_unit")}` })
    stats.push({ key: "lead", label: t("mfg3_prd_stat_lead"), value: t("mfg3_prd_days", { days: leadDays }), sub: t("mfg3_prd_stat_lead_sub") })
  }
  if (perms.seesMoney) {
    stats.push({
      key: "make",
      label: t("mfg2_est_make_cost"),
      value: `${fmtMoney(std.total)} ﷼`,
      sub: std.allPriced ? t("mfg3_prd_per_unit") : t("mfg2_cost_incomplete"),
      tone: std.allPriced ? undefined : "text-warning",
    })
    stats.push({
      key: "buy",
      label: t("mfg2_field_buy_ref"),
      value: buy == null ? "—" : `${fmtMoney(buy)} ﷼`,
      sub: t("mfg3_prd_from_procurement"),
    })
  }
  stats.push({ key: "route", label: t("mfg3_prd_stat_departments"), value: fmtQty(product.route.length) })
  stats.push({ key: "waste", label: t("mfg2_field_waste"), value: `${fmtQty(product.wastePercent)}%` })
  stats.push({ key: "bom", label: t("mfg3_prd_stat_bom_lines"), value: fmtQty(product.bom.length) })

  const removeProduct = async () => {
    if (!firestore || deleting) return
    // Every order made from the card needs it to be read — done orders
    // included — so a card with history stays.
    const used = data.orders.filter((o) => o.productId === product.id).length
    if (used > 0) {
      toast({ title: t("mfg3_prd_in_use", { count: used }), variant: "destructive" })
      setConfirmDelete(false)
      return
    }
    setDeleting(true)
    try {
      await deleteDoc(doc(firestore, MFG_PRODUCTS, product.id))
      toast({ title: t("mfg2_product_deleted") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  const FamilyIcon = familyIcon(product.family)

  return (
    <MfgDrawer
      open
      onClose={onClose}
      icon={FamilyIcon}
      title={<span dir="auto">{product.name}</span>}
      meta={
        <>
          <span>{t(`mfg2_family_${product.family}`)}</span>
          <span aria-hidden="true">·</span>
          <span>{t("mfg3_prd_unit_label", { unit: product.unit })}</span>
          {product.wastePercent > 0 && <MfgChip tone="muted">{t("mfg2_waste_label", { percent: fmtQty(product.wastePercent) })}</MfgChip>}
          <MfgPrdFlags product={product} />
        </>
      }
      footer={
        perms.canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-[11px] font-semibold text-destructive">{t("mfg3_prd_delete_confirm")}</span>
                <div className="ms-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                    {t("mfg3_cancel")}
                  </Button>
                  <Button size="sm" variant="destructive" className="gap-1.5" onClick={removeProduct} disabled={deleting}>
                    {deleting ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Trash2 size={13} aria-hidden="true" />}
                    {t("mfg2_delete_product")}
                  </Button>
                </div>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} aria-hidden="true" /> {t("mfg2_delete_product")}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        {stats.slice(0, 4).map((s) => (
          <MfgStat key={s.key} label={s.label} value={<span className="tabular-nums">{s.value}</span>} sub={s.sub ? <span className={s.tone}>{s.sub}</span> : undefined} />
        ))}
      </div>

      <MfgSection
        icon={Workflow}
        title={timeOn ? t("mfg2_route_time_title") : t("mfg3_prd_route_title")}
        right={timeOn ? <span className="tabular-nums text-muted-foreground">{t("mfg3_prd_total_hours", { hours: fmtQty(std.hours) })}</span> : undefined}
      >
        {product.route.map((step, i) => {
          const dept = data.departments.find((d) => d.id === step.departmentId)
          const name = stepName(data.departments, step)
          const Icon = departmentIcon(name, step.onSite || dept?.onSite)
          const days = stationQueueDays(data.scheduleInputs, dept || { id: step.departmentId })
          return (
            <div key={`${step.departmentId}_${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 px-3.5 py-2.5 text-xs last:border-b-0">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Icon size={14} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 font-semibold text-foreground">
                <span className="tabular-nums">{i + 1}.</span> {name}
                {(step.onSite || dept?.onSite) && (
                  <MfgChip tone="info" className="ms-1.5">
                    {t("mfg2_on_site")}
                  </MfgChip>
                )}
              </span>
              {timeOn && (
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-muted-foreground">
                    {fmtQty(step.hoursPerUnit)} {t("mfg2_hours_per_unit")}
                  </span>
                  <MfgPill tone={queueTone(days)}>{t("mfg2_queue_days", { days: fmtQty(days) })}</MfgPill>
                </span>
              )}
            </div>
          )
        })}
      </MfgSection>

      <MfgSection icon={PackageOpen} title={t("mfg2_bom_title")} right={<span className="tabular-nums text-muted-foreground">{fmtQty(product.bom.length)}</span>}>
        {product.bom.length === 0 && <p className="px-3.5 py-3 text-xs text-muted-foreground">{t("mfg2_bom_empty")}</p>}
        {product.bom.map((line, i) => {
          const consumer = product.route.find((r) => r.departmentId === line.departmentId)
          const lineCost = line.unitCost == null ? null : line.qtyPerUnit * line.unitCost * (line.withWaste ? wasteFactor(product) : 1)
          return (
            <div key={`${line.itemName}_${i}`} className="flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5 text-xs last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground" dir="auto">
                  {line.itemName}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  <span>
                    {t("mfg3_prd_consumed_at", {
                      dept: consumer ? stepName(data.departments, consumer) : data.departments.find((d) => d.id === line.departmentId)?.name || "—",
                    })}
                  </span>
                  {line.withWaste && <MfgChip tone="warn">{t("mfg2_waste_label", { percent: fmtQty(product.wastePercent) })}</MfgChip>}
                  {line.lotted && <MfgChip tone="muted">{t("mfg2_bom_lot")}</MfgChip>}
                </p>
              </div>
              <div className="shrink-0 text-end">
                <p className="font-bold tabular-nums text-foreground">
                  {fmtQty(line.qtyPerUnit)} <span className="font-semibold text-muted-foreground">{line.unit}</span>
                </p>
                <p className="text-[10px] text-muted-foreground">{t("mfg3_prd_per_unit")}</p>
              </div>
              {perms.seesMoney && (
                <div className="w-20 shrink-0 text-end">
                  <p className={cn("font-bold tabular-nums", lineCost == null ? "text-warning" : "text-foreground")}>
                    {lineCost == null ? t("mfg2_cost_unknown") : `${fmtMoney(lineCost)} ﷼`}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{t("mfg2_bom_cost")}</p>
                </div>
              )}
            </div>
          )
        })}
      </MfgSection>

      {perms.seesMoney && (
        <MfgSection icon={Coins} title={t("mfg3_prd_cost_title")}>
          <div className="space-y-1.5 px-3.5 py-3 text-xs">
            <CostRow label={t("mfg2_cost_materials")} value={`${fmtMoney(std.materials)} ﷼`} />
            {timeOn && <CostRow label={t("mfg2_cost_labour")} value={`${fmtMoney(std.labour)} ﷼`} />}
            {timeOn && <CostRow label={t("mfg2_cost_overhead")} value={`${fmtMoney(std.overhead)} ﷼`} />}
            <div className="flex items-center justify-between border-t border-border/60 pt-2 text-sm font-bold">
              <span>{t("mfg2_unit_cost")}</span>
              <span className="tabular-nums">{fmtMoney(std.total)} ﷼</span>
            </div>
            {buyDiff != null && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("mfg2_vs_buying")}</span>
                <span className={cn("font-bold tabular-nums", buyDiff >= 0 ? "text-success" : "text-destructive")}>
                  {fmtMoney(Math.abs(buyDiff))} ﷼ · {buyDiff >= 0 ? t("mfg2_make_wins") : t("mfg2_buy_wins")}
                </span>
              </div>
            )}
          </div>
          {(!timeOn || !std.allPriced) && (
            <div className="space-y-2 px-3.5 pb-3">
              {!timeOn && <MfgNote tone="info">{t("mfg2_time_off_note")}</MfgNote>}
              {!std.allPriced && <MfgNote tone="warn">{t("mfg2_cost_unknown_note")}</MfgNote>}
            </div>
          )}
        </MfgSection>
      )}

      <MfgSection icon={ClipboardList} title={t("mfg3_prd_orders_title")} right={<span className="tabular-nums text-cta">{fmtQty(orders.length)}</span>}>
        {orders.length === 0 && <p className="px-3.5 py-3 text-xs text-muted-foreground">{t("mfg3_prd_orders_empty")}</p>}
        {orders.slice(0, ORDERS_SHOWN).map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => {
              onClose()
              ui.openOrder(v.id)
            }}
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3.5 py-2.5 text-start text-xs last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="font-mono text-[11px] font-bold text-foreground" dir="ltr">
              #{v.number}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              <span className="tabular-nums">{fmtQty(v.quantity)}</span> {v.unit} · {sourceNameOf(v, t)}
            </span>
            <MfgStatePill view={v} departments={data.departments} />
          </button>
        ))}
        {orders.length > ORDERS_SHOWN && (
          <p className="px-3.5 py-2 text-[11px] text-muted-foreground">{t("mfg3_prd_orders_more", { count: orders.length - ORDERS_SHOWN })}</p>
        )}
      </MfgSection>
    </MfgDrawer>
  )
}

function CostRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}
