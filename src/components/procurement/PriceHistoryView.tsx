"use client"

// The Suppliers tab's price-history segment (PRD 3.0 §7.2, §4 `PH`, prototype
// vSup:ph).
//
// One row per material we have committed to a price for, sharpest rise first,
// because the question this screen answers is "what is getting more expensive".
// The last few points draw a bar chart rather than a number: a series is easier
// to read than a percentage, and the percentage is there beside it for the one
// number somebody will quote. A row opens the material's drawer.
//
// A material with a single point has no change to show — and a first price of
// zero has no percentage at all, which is why it reads "—" rather than a figure
// nobody could defend. The last column marks the materials Manufacturing also
// makes: those are the prices its make-or-buy decision reads.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { LineChart, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { cn } from "@/lib/utils"
import { displayCategory } from "@/lib/constants"
import { matchesSearch } from "@/lib/search-text"
import { PRICE_RISE_ALARM_PERCENT, priceTrends, sparkHeights, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { materialCategory, readByManufacturing } from "@/lib/procurement/supplier-file"
import type { PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"
import { MaterialDrawer } from "./MaterialDrawer"
import { sarLtr } from "@/lib/riyal"

/** A unit price, as the prototype's R2: two decimals, the riyal sign on its left. */
const priceText = (n: number) => sarLtr(Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function PriceHistoryView({
  history,
  orders,
  receipts,
  agreements,
  makeOrBuy,
  locale,
  fmtDate,
  focusKey,
  onFocusChange,
}: {
  history: PriceHistoryEntry[]
  orders: PurchaseOrder[]
  receipts: ReceiptFact[]
  agreements: PriceAgreement[]
  /** Folded names of the products Manufacturing makes. */
  makeOrBuy: Set<string>
  locale: string
  fmtDate: (value: unknown, locale: string) => string
  focusKey?: string | null
  onFocusChange?: (key: string | null) => void
}) {
  const t = useTranslations("Portal.ProcPrices")
  const [q, setQ] = useState("")
  const [openKey, setOpenKey] = useState<string | null>(focusKey || null)
  useEffect(() => setOpenKey(focusKey || null), [focusKey])
  const pick = (key: string | null) => {
    setOpenKey(key)
    onFocusChange?.(key)
  }
  const trends = useMemo(() => priceTrends(history), [history])
  const withCategory = useMemo(() => trends.map((tr) => ({ ...tr, category: materialCategory(orders, tr.materialKey) })), [trends, orders])
  const rows = useMemo(
    () => withCategory.filter((tr) => matchesSearch(q, [tr.name, tr.unit, tr.category, tr.category ? displayCategory(tr.category, locale) : null])),
    [withCategory, q, locale]
  )
  const open = trends.find((tr) => tr.materialKey === openKey) || null
  const today = new Date().toISOString().slice(0, 10)

  if (!trends.length) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 p-16 text-center text-muted-foreground">
        <LineChart size={44} className="mx-auto mb-4 opacity-20" aria-hidden="true" />
        <p className="text-lg font-bold">{t("history.emptyTitle")}</p>
        <p className="mt-1 text-sm">{t("history.emptyDesc")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("history.intro")}</p>
        <div className="relative w-full sm:w-64">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("history.search")} aria-label={t("history.search")} className="ps-9" />
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="p-3 text-start font-bold">{t("history.colMaterial")}</th>
              <th className="p-3 text-start font-bold">{t("history.colSix")}</th>
              <th className="p-3 text-end font-bold">{t("history.colLast")}</th>
              <th className="p-3 text-end font-bold">{t("history.colSixChange")}</th>
              <th className="p-3 text-start font-bold">{t("history.colReference")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                  {t("history.noMatch")}
                </td>
              </tr>
            )}
            {rows.map((tr) => {
              const heights = sparkHeights(tr)
              const change = tr.changePercent
              return (
                <tr key={tr.materialKey} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => pick(tr.materialKey)}>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        pick(tr.materialKey)
                      }}
                      className="rounded text-start font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      dir="auto"
                    >
                      {tr.name}
                    </button>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {[tr.unit, tr.category ? displayCategory(tr.category, locale) : null].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex h-8 items-end gap-1" dir="ltr" role="img" aria-label={t("history.seriesLabel", { from: tr.first, to: tr.last })}>
                      {heights.map((h, i) => (
                        <span
                          key={i}
                          style={{ height: `${h}%` }}
                          className={cn("w-2 rounded-sm", tr.points[i].price === tr.max && tr.max > tr.min * 1.02 ? "bg-warning" : "bg-module/50")}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-end">
                    <b className="tabular-nums" dir="ltr">
                      {priceText(tr.last)}
                    </b>
                    <span className="block text-[11px] text-muted-foreground">{`/ ${tr.unit}`}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {`${tr.points[tr.points.length - 1].supplierName || "—"} · ${fmtDate(tr.points[tr.points.length - 1].day, locale)}`}
                    </span>
                  </td>
                  <td className="p-3 text-end">
                    {change == null || tr.points.length < 2 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <StatusPill tone={change > PRICE_RISE_ALARM_PERCENT ? "bad" : change > 0 ? "warn" : "ok"}>
                        <span dir="ltr" className="tabular-nums">{`${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}%`}</span>
                      </StatusPill>
                    )}
                  </td>
                  <td className="p-3">
                    {readByManufacturing(makeOrBuy, tr.name) ? <StatusPill tone="violet">{t("history.readByMfg")}</StatusPill> : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <MaterialDrawer
        material={open ? { key: open.materialKey, name: open.name, unit: open.unit } : null}
        open={Boolean(open)}
        onOpenChange={(o) => !o && pick(null)}
        history={history}
        orders={orders}
        receipts={receipts}
        agreements={agreements}
        today={today}
      />
    </div>
  )
}
