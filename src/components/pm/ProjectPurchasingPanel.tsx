"use client"

// Supply › Purchasing & prices on a PM 1.0 project (prototype supPO · pricePanel):
// the project's purchase orders and the price history of its materials, both
// READ from Procurement — created and managed there, shown here because they
// commit the items' budget. Amounts only for money holders; paid is Finance's
// and not yet on the order, so it is not shown.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { AlertTriangle, Link2, ShoppingCart, TrendingUp } from "lucide-react"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useSupplyWorld } from "@/hooks/useSupplyWorld"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { poReceivedShare } from "@/lib/pm/supply"
import { displayPoNumber } from "@/lib/procurement/format"
import { acceptedValue, poValue } from "@/lib/procurement/po"
import { PRICE_RISE_ALARM_PERCENT } from "@/lib/procurement/prices"
import type { PurchaseOrder } from "@/lib/procurement/types"
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
  const orders = useMemo(() => ((data ?? []) as unknown as PurchaseOrder[]).filter((o) => o.status !== "cancelled").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")), [data])

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
        return { key, name: last.name, unit: last.unit, last, change, codes: [...(used.get(key) ?? [])] }
      })
      .sort((a, b) => b.codes.length - a.codes.length || b.change - a.change)
      .slice(0, 15)
  }, [world, used, startOn])
  const rising = prices.filter((p) => p.change > 5 && p.codes.length)
  const codeOf = (id: string | null | undefined) => items.find((i) => i.id === id)

  return (
    <div className="space-y-4">
      <Callout tone="info">
        {t("po.note")} <SourceBadge module="procurement" label={t("po.from_proc")} />
      </Callout>
      <Panel title={t("po.title")} icon={ShoppingCart} count={orders.length} bodyClassName="p-0">
        {orders.length === 0 ? (
          <EmptyState icon={ShoppingCart} title={t("po.empty")} className="py-8" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-start text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-start font-medium">{t("po.col.po")}</th>
                  <th className="px-2 py-2 text-start font-medium">{t("po.col.supplier")}</th>
                  <th className="px-2 py-2 text-start font-medium">{t("po.col.item")}</th>
                  {money && <th className="px-2 py-2 text-end font-medium">{t("po.col.value")}</th>}
                  {money && (
                    <th className="px-2 py-2 text-end font-medium">
                      {t("po.col.received")} <SourceBadge module="warehouses" label={t("own.inv")} />
                    </th>
                  )}
                  <th className="px-4 py-2 text-center font-medium">{t("po.col.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orders.map((o) => {
                  const share = poReceivedShare(o.lines)
                  const firstItem = o.lines.map((l) => codeOf(l.boqItemId)).find(Boolean)
                  const acc = acceptedValue(o)
                  return (
                    <tr key={o.id}>
                      <td className="px-4 py-2">
                        <b dir="ltr">{displayPoNumber(o.docNumber, locale)}</b>
                        <p className="text-xs text-muted-foreground">{pmDate(o.createdAt, locale)}</p>
                      </td>
                      <td className="px-2 py-2 text-xs" dir="auto">
                        {o.supplierName}
                      </td>
                      <td className="px-2 py-2 text-xs" dir="auto">
                        {firstItem ? (
                          <>
                            <b dir="ltr">{firstItem.code}</b> — {firstItem.description.slice(0, 26)}
                          </>
                        ) : (
                          o.lines.map((l) => l.name).slice(0, 2).join(" · ")
                        )}
                      </td>
                      {money && (
                        <td className="px-2 py-2 text-end tabular-nums" dir="ltr">
                          {pmMoney(poValue(o))}
                        </td>
                      )}
                      {money && (
                        <td className="px-2 py-2 text-end tabular-nums" dir="ltr">
                          {acc == null ? "—" : pmMoney(acc)}
                        </td>
                      )}
                      <td className="px-4 py-2 text-center">
                        <StatusPill tone={share >= 0.995 ? "ok" : "warn"}>{share >= 0.995 ? t("po.full") : t("po.pct", { pct: Math.round(share * 100) })}</StatusPill>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {withPrices && (
        <Panel title={t("price.title")} icon={TrendingUp} actions={<SourceBadge module="procurement" label={t("price.from")} />} bodyClassName="p-0">
          {prices.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("price.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-start font-medium">{t("price.col.material")}</th>
                    <th className="px-2 py-2 text-end font-medium">{t("price.col.last")}</th>
                    <th className="px-2 py-2 text-end font-medium">{t("price.col.change")}</th>
                    <th className="px-2 py-2 text-start font-medium">{t("price.col.supplier")}</th>
                    <th className="px-4 py-2 text-start font-medium">{t("price.col.items")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {prices.map((p) => (
                    <tr key={p.key}>
                      <td className="px-4 py-2">
                        <b dir="auto">{p.name}</b>
                        <p className="text-xs text-muted-foreground">{t("price.per", { unit: p.unit })}</p>
                      </td>
                      <td className="px-2 py-2 text-end tabular-nums" dir="ltr">
                        {money ? pmMoney(p.last.price) : "•••"}
                        <p className="text-xs text-muted-foreground">{pmDate(p.last.day, locale)}</p>
                      </td>
                      <td className={cn("px-2 py-2 text-end tabular-nums", p.change > PRICE_RISE_ALARM_PERCENT ? "text-destructive" : p.change < -PRICE_RISE_ALARM_PERCENT ? "text-success" : "text-muted-foreground")} dir="ltr">
                        {p.change > 0 ? "+" : ""}
                        {Math.round(p.change * 10) / 10}%
                      </td>
                      <td className="px-2 py-2 text-xs" dir="auto">
                        {p.last.supplierName}
                      </td>
                      <td className="px-4 py-2 text-xs" dir="ltr">
                        {p.codes.length ? p.codes.slice(0, 3).join(" · ") + (p.codes.length > 3 ? ` +${p.codes.length - 3}` : "") : <span dir="auto">{t("price.not_here")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

