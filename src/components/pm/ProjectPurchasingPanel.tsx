"use client"

// Supply › Purchasing & prices on a PM 1.0 project (prototype supPO · pricePanel):
// the project's purchase orders and the price history of its materials, both
// READ from Procurement — created and managed there, shown here because they
// commit the items' budget. Amounts only for money holders; paid is what Finance
// recorded against the order.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { AlertTriangle, Link2, ShoppingCart, TrendingUp } from "lucide-react"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useTableLabels } from "@/hooks/useTableLabels"
import { useSupplyWorld } from "@/hooks/useSupplyWorld"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { ESTIMATE_GAP_PERCENT, poReceivedShare, priceVsEstimate } from "@/lib/pm/supply"
import { displayPoNumber } from "@/lib/procurement/format"
import { acceptedValue, poValue } from "@/lib/procurement/po"
import { paidTotal, type PurchaseOrderX } from "@/lib/procurement/po-extras"
import { PRICE_RISE_ALARM_PERCENT } from "@/lib/procurement/prices"
import { cn } from "@/lib/utils"
import { Callout } from "@/components/module-ui/Callout"
import { useLocaleDir, type SupplyItem } from "./SupplyDialogs"

export function ProjectPurchasingPanel({ projectId, orgId, items, startOn, access, withPrices }: { projectId: string; orgId: string; items: SupplyItem[]; startOn: string | null; access: PmAccess; withPrices: boolean }) {
  const t = useTranslations("Portal.PM")
  const { locale } = useLocaleDir()
  const firestore = useFirestore()
  const world = useSupplyWorld(projectId, orgId)
  const money = access.has("money")
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "purchaseOrders"), where("organizationId", "==", orgId), where("projectId", "==", projectId)) : null), [firestore, orgId, projectId])
  const { data } = useCollection(q)
  const orders = useMemo(() => ((data ?? []) as unknown as PurchaseOrderX[]).filter((o) => o.status !== "cancelled").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")), [data])

  const poLines = useMemo(() => orders.flatMap((o) => o.lines), [orders])

  const used = useMemo(() => {
    const m = new Map<string, Set<string>>()
    const add = (key: string, code: string | null | undefined) => {
      if (!code) return
      m.set(key, (m.get(key) ?? new Set()).add(code))
    }
    for (const s of world.stores) for (const id of Object.keys(s.rates || {})) add(s.key, items.find((i) => i.id === id)?.code)
    for (const r of world.requests) for (const l of r.lines) add(l.key, l.code)
    return m
  }, [world, items])

  const prices = useMemo(() => {
    const byKey = new Map<string, typeof world.history>()
    for (const h of world.history) byKey.set(h.materialKey, [...(byKey.get(h.materialKey) ?? []), h])
    return [...byKey.entries()]
      .map(([key, hs]) => {
        const s = hs.slice().sort((a, b) => a.day.localeCompare(b.day))
        const since = startOn ? s.filter((h) => h.day >= startOn.slice(0, 10)) : s
        const base = (since.length ? since : s)[0]
        const last = s[s.length - 1]
        const change = base.price > 0 ? ((last.price - base.price) / base.price) * 100 : 0
        const dif = priceVsEstimate(last.price, key, poLines, (id) => items.find((i) => i.id === id)?.estCost ?? 0)
        return { key, name: last.name, unit: last.unit, last, change, dif, codes: [...(used.get(key) ?? [])] }
      })
      .sort((a, b) => b.codes.length - a.codes.length || b.change - a.change)
      .slice(0, 15)
  }, [world, used, startOn, poLines, items])
  const rising = prices.filter((p) => p.change > 5 && p.codes.length)
  const codeOf = (id: string | null | undefined) => items.find((i) => i.id === id)
  const labels = useTableLabels()

  type PriceRow = (typeof prices)[number]
  const poColumns: DataColumn<PurchaseOrderX>[] = [
    {
      key: "po",
      header: t("po.col.po"),
      cell: (o) => (
        <>
          <b dir="ltr">{displayPoNumber(o.docNumber, locale)}</b>
          <p className="text-xs text-muted-foreground">{pmDate(o.createdAt, locale)}</p>
        </>
      ),
    },
    { key: "supplier", header: t("po.col.supplier"), cell: (o) => <span className="text-xs" dir="auto">{o.supplierName}</span> },
    {
      key: "item",
      header: t("po.col.item"),
      hideBelow: "lg",
      cell: (o) => {
        const firstItem = o.lines.map((l) => codeOf(l.boqItemId)).find(Boolean)
        return (
          <span className="text-xs" dir="auto">
            {firstItem ? (
              <>
                <b dir="ltr">{firstItem.code}</b> — {firstItem.description.slice(0, 26)}
              </>
            ) : (
              o.lines.map((l) => l.name).slice(0, 2).join(" · ")
            )}
          </span>
        )
      },
    },
    ...(money
      ? ([
          { key: "value", header: t("po.col.value"), numeric: true, cell: (o) => pmMoney(poValue(o)) },
          {
            key: "received",
            label: t("po.col.received"),
            header: (
              <>
                {t("po.col.received")} <SourceBadge module="warehouses" label={t("own.inv")} />
              </>
            ),
            numeric: true,
            cell: (o) => {
              const acc = acceptedValue(o)
              return acc == null ? "—" : pmMoney(acc)
            },
          },
          {
            key: "paid",
            label: t("po.col.paid"),
            header: (
              <>
                {t("po.col.paid")} <SourceBadge module="payments" label={t("po.from_fin")} />
              </>
            ),
            numeric: true,
            cell: (o) => pmMoney(paidTotal(o)),
          },
        ] satisfies DataColumn<PurchaseOrderX>[])
      : []),
    {
      key: "status",
      header: t("po.col.status"),
      cell: (o) => {
        const share = poReceivedShare(o.lines)
        return <StatusPill tone={share >= 0.995 ? "ok" : "warn"}>{share >= 0.995 ? t("po.full") : t("po.pct", { pct: Math.round(share * 100) })}</StatusPill>
      },
    },
  ]
  const priceColumns: DataColumn<PriceRow>[] = [
    {
      key: "material",
      header: t("price.col.material"),
      cell: (p) => (
        <>
          <b dir="auto">{p.name}</b>
          <p className="text-xs text-muted-foreground">{t("price.per", { unit: p.unit })}</p>
        </>
      ),
    },
    {
      key: "last",
      header: t("price.col.last"),
      numeric: true,
      cell: (p) => (
        <>
          {money ? pmMoney(p.last.price) : "•••"}
          <span className="block text-xs font-normal text-muted-foreground">{pmDate(p.last.day, locale)}</span>
        </>
      ),
    },
    {
      key: "change",
      header: t("price.col.change"),
      numeric: true,
      cell: (p) => (
        <span className={cn(p.change > PRICE_RISE_ALARM_PERCENT ? "text-destructive" : p.change < -PRICE_RISE_ALARM_PERCENT ? "text-success" : "text-muted-foreground")}>
          {p.change > 0 ? "+" : ""}
          {Math.round(p.change * 10) / 10}%
          {money && p.dif !== null && Math.abs(p.dif) > ESTIMATE_GAP_PERCENT && (
            <span className={cn("block text-xs", p.dif > 0 ? "text-destructive" : "text-success")} dir="auto">
              {p.dif > 0 ? t("po.above_est", { pct: Math.round(p.dif) }) : t("po.below_est", { pct: Math.round(-p.dif) })}
            </span>
          )}
        </span>
      ),
    },
    { key: "supplier", header: t("price.col.supplier"), hideBelow: "lg", cell: (p) => <span className="text-xs" dir="auto">{p.last.supplierName}</span> },
    {
      key: "items",
      header: t("price.col.items"),
      cell: (p) => (
        <span className="text-xs" dir="ltr">
          {p.codes.length ? p.codes.slice(0, 3).join(" · ") + (p.codes.length > 3 ? ` +${p.codes.length - 3}` : "") : <span dir="auto">{t("price.not_here")}</span>}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <Callout tone="info">
        {t("po.note")} <SourceBadge module="procurement" label={t("po.from_proc")} />
      </Callout>
      <Panel title={t("po.title")} icon={ShoppingCart} count={orders.length} bodyClassName="p-0">
        <DataTable
          columns={poColumns}
          rows={orders}
          rowKey={(o) => o.id}
          caption={t("po.title")}
          labels={labels}
          bordered={false}
          dense
          maxHeight="70vh"
          empty={<EmptyState bare icon={ShoppingCart} title={t("po.empty")} />}
        />
      </Panel>

      {withPrices && (
        <Panel title={t("price.title")} icon={TrendingUp} actions={<SourceBadge module="procurement" label={t("price.from")} />} bodyClassName="p-0">
          <DataTable
            columns={priceColumns}
            rows={prices}
            rowKey={(p) => p.key}
            caption={t("price.title")}
            labels={labels}
            bordered={false}
            dense
            empty={<p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("price.empty")}</p>}
          />
          {rising.length > 0 && money && (
            <p className="flex items-start gap-1.5 border-t px-4 py-2 text-xs text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t("price.rising", { count: rising.length, names: rising.map((p) => p.name).join(" · ") })}
            </p>
          )}
        </Panel>
      )}
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link2 size={12} aria-hidden="true" />
        {t("po.link_note")}
      </p>
    </div>
  )
}

