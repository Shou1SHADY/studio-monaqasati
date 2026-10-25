"use client"

// The Suppliers tab's price-history segment (PRD 2.0 SUP-05, WF-24, prototype vSup:ph). One material at a time:
// material chips → four tiles (last price · low and high · average · change) → a monthly chart with a line per supplier —
// a filled dot for an order, a HOLLOW dot for an offer that did not become one, a square for an agreement — → the table of
// every price by its source with the difference from the previous purchase. Everything is derived on read from the orders,
// offers and agreements themselves (`priceSeries`); prices are per unit and EXCLUDE VAT. A lump-sum order has no unit price
// and never appears. The table is the chart's accessible twin: whatever a dot says, a row says.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { LineChart, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/module-ui/Chip"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { matchesSearch } from "@/lib/search-text"
import type { CatalogItem } from "@/hooks/useInventoryCatalog"
import { displayAgreementNumber, displayPoNumber, displayReceiptNumber } from "@/lib/procurement/format"
import { CHART_COLORS, priceChart, type PriceChart } from "@/lib/procurement/price-chart"
import { diffVsPrevious, materialKey, priceSeries, priceStats, priceTrends, type PriceAgreement, type PriceHistoryEntry, type PriceOfferLike, type PricePoint, type PriceRfqLike, type PriceSource } from "@/lib/procurement/prices"
import { readByManufacturing } from "@/lib/procurement/supplier-file"
import type { PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"
import { MaterialDrawer } from "./MaterialDrawer"
import { SupplierLink } from "./SupplierLink"
import { sarLtr } from "@/lib/riyal"

const priceText = (n: number) => sarLtr(Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const plain = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })
const CHIPS_SHOWN = 12
const SOURCE_TONE: Record<PriceSource, PillTone> = { po: "module", offer: "mute", agreement: "violet", manual: "warn" }
const COLOR = ["text-module", "text-success", "text-cta", "text-warning", "text-destructive", "text-accent"].slice(0, CHART_COLORS)

interface Material {
  key: string
  name: string
  unit: string
}

function Tile({ label, tone, children, sub }: { label: string; tone?: "warn" | "ok"; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-base font-black tabular-nums", tone === "warn" && "text-warning", tone === "ok" && "text-success")}>{children}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Chart({ chart, locale, label, unit }: { chart: PriceChart; locale: string; label: string; unit: string }) {
  const th = useTranslations("Portal.ProcPrices.hist2")
  const month = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { month: "short", timeZone: "UTC" })
  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-auto w-full" role="img" aria-label={label}>
        {chart.yTicks.map((tick) => (
          <g key={tick.value} className="text-muted-foreground">
            <line x1={chart.left} x2={chart.width - chart.right} y1={tick.y} y2={tick.y} stroke="currentColor" strokeOpacity={0.18} />
            <text x={chart.left - 6} y={tick.y + 4} textAnchor="end" fontSize={10} fill="currentColor">
              {plain(tick.value)}
            </text>
          </g>
        ))}
        {chart.xTicks.map((tick) => (
          <text key={tick.month} x={tick.x} y={chart.height - 9} textAnchor="start" fontSize={10} className="fill-muted-foreground">
            {month(tick.month)}
          </text>
        ))}
        {chart.lines.map((l) => (
          <path key={l.supplier} d={l.path} fill="none" stroke="currentColor" strokeWidth={2} className={COLOR[l.supplier % COLOR.length]} />
        ))}
        {chart.dots.map((d) => {
          const tone = COLOR[Math.max(0, d.supplier) % COLOR.length]
          const tip = `${d.point.supplier} · ${plain(d.point.price)} · ${d.point.day}`
          return d.shape === "square" ? (
            <rect key={d.id} x={d.x - 5} y={d.y - 5} width={10} height={10} className={cn("fill-current", tone)} data-shape="square">
              <title>{tip}</title>
            </rect>
          ) : (
            <circle key={d.id} cx={d.x} cy={d.y} r={d.shape === "hollow" ? 4.5 : 5.5} strokeWidth={2} stroke="currentColor" className={cn(d.shape === "hollow" ? "fill-background" : "fill-current", tone)} data-shape={d.shape}>
              <title>{tip}</title>
            </circle>
          )
        })}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" dir="auto">
        {chart.suppliers.map((s, i) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <i className={cn("inline-block h-2.5 w-2.5 rounded-full bg-current", COLOR[i % COLOR.length])} aria-hidden="true" />
            {s.name}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-full border-2 border-foreground bg-background" aria-hidden="true" />
          {th("legend_offer")}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 bg-foreground" aria-hidden="true" />
          {th("legend_agreement")}
        </li>
      </ul>
      <p className="sr-only">{unit}</p>
    </div>
  )
}

export function PriceHistoryView({
  history,
  orders,
  receipts,
  agreements,
  offers = [],
  rfqs = [],
  makeOrBuy,
  locale,
  fmtDate,
  focusKey,
  onFocusChange,
  query,
  itemOf,
}: {
  history: PriceHistoryEntry[]
  orders: PurchaseOrder[]
  receipts: ReceiptFact[]
  agreements: PriceAgreement[]
  /** The offers we were quoted and the RFQs they answer — an offer that did not win is a hollow dot. */
  offers?: PriceOfferLike[]
  rfqs?: PriceRfqLike[]
  /** Folded names of the products Manufacturing makes. */
  makeOrBuy: Set<string>
  locale: string
  fmtDate: (value: unknown, locale: string) => string
  focusKey?: string | null
  onFocusChange?: (key: string | null) => void
  /** The page's own search, carried across the supplier segments; its box replaces this one. */
  query?: string
  /** The stores' item card for a material, when Inventory keeps it. */
  itemOf?: (name: string) => CatalogItem | null
}) {
  const t = useTranslations("Portal.ProcPrices")
  const th = useTranslations("Portal.ProcPrices.hist2")
  const loc = useLocale()
  const [ownQ, setQ] = useState("")
  const q = query ?? ownQ
  const [picked, setPicked] = useState<string | null>(focusKey || null)
  const [chipLimit, setChipLimit] = useState(CHIPS_SHOWN)
  const [drawer, setDrawer] = useState(false)
  useEffect(() => setPicked(focusKey || null), [focusKey])
  const today = new Date().toISOString().slice(0, 10)

  const materials = useMemo<Material[]>(() => {
    const seen = new Map<string, Material>()
    for (const tr of priceTrends(history)) seen.set(tr.materialKey, { key: tr.materialKey, name: tr.name, unit: tr.unit })
    for (const a of agreements) for (const l of a.lines || []) if (!seen.has(materialKey(l.name, l.unit))) seen.set(materialKey(l.name, l.unit), { key: materialKey(l.name, l.unit), name: l.name, unit: l.unit })
    return [...seen.values()]
  }, [history, agreements])
  const visible = useMemo(() => materials.filter((m) => matchesSearch(q, [m.name, m.unit])), [materials, q])
  const current = materials.find((m) => m.key === picked) || visible[0] || materials[0] || null

  const points = useMemo(() => (current ? priceSeries(current.key, { history, offers, rfqs, agreements, orders }) : []), [current, history, offers, rfqs, agreements, orders])
  const stats = useMemo(() => priceStats(points), [points])
  const diffs = useMemo(() => diffVsPrevious(points), [points])
  const chart = useMemo(() => priceChart(points, { today }), [points, today])
  const tableRows = useMemo(() => [...points].reverse(), [points])

  const pick = (key: string) => {
    setPicked(key)
    onFocusChange?.(key)
  }

  if (!materials.length) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 p-16 text-center text-muted-foreground">
        <LineChart size={44} className="mx-auto mb-4 opacity-20" aria-hidden="true" />
        <p className="text-lg font-bold">{t("history.emptyTitle")}</p>
        <p className="mt-1 text-sm">{t("history.emptyDesc")}</p>
      </div>
    )
  }

  const signedPct = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}%`)
  const columns: DataColumn<PricePoint>[] = [
    { key: "day", header: th("col_date"), cell: (p) => fmtDate(p.day, locale) },
    { key: "supplier", header: th("col_supplier"), cell: (p) => <SupplierLink orgId={p.supplierKey} name={p.supplier} /> },
    { key: "source", header: th("col_source"), cell: (p) => <StatusPill tone={SOURCE_TONE[p.source]}>{th(`source_${p.source}`)}</StatusPill> },
    { key: "qty", header: th("col_qty"), numeric: true, cell: (p) => (p.quantity ? `${plain(p.quantity)} ${current?.unit ?? ""}` : "—") },
    { key: "price", header: th("col_price"), numeric: true, cell: (p) => <b>{plain(p.price)}</b> },
    {
      key: "diff",
      header: th("col_diff"),
      numeric: true,
      cell: (p) => {
        const d = diffs.get(p.id) ?? null
        return <span className={cn(d != null && d > 0 && "text-warning", d != null && d < 0 && "text-success")}>{signedPct(d)}</span>
      },
    },
    {
      key: "ref",
      header: th("col_ref"),
      cell: (p) =>
        p.poId && p.poNo ? (
          <Link href={`/contractor/rfqs/orders?po=${p.poId}`} className="rounded text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">
            {displayPoNumber(p.poNo, loc)}
          </Link>
        ) : p.agreementId && p.agreementNo ? (
          <Link href={`/contractor/suppliers?segment=agreements&agreement=${p.agreementId}`} className="rounded text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">
            {displayAgreementNumber(p.agreementNo, loc)}
          </Link>
        ) : p.source === "manual" && p.poNo ? (
          p.receiptId ? (
            <Link href={`/contractor/goods-received?tab=nopo&delivery=${p.receiptId}`} className="rounded text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">
              {displayReceiptNumber(p.poNo, loc)}
            </Link>
          ) : (
            <span dir="ltr">{displayReceiptNumber(p.poNo, loc)}</span>
          )
        ) : p.rfqId ? (
          <Link href={`/contractor/rfqs/${p.rfqId}/offers`} className="rounded text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">
            {p.rfqNo || "—"}
          </Link>
        ) : (
          "—"
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{th("intro")}</p>
        {query === undefined && (
          <div className="relative w-full sm:w-64">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("history.search")} aria-label={t("history.search")} className="ps-9" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={th("materials")}>
        {visible.slice(0, chipLimit).map((m) => (
          <Chip key={m.key} selected={current?.key === m.key} onClick={() => pick(m.key)}>
            <span dir="auto">{m.name}</span>
          </Chip>
        ))}
        {visible.length > chipLimit && (
          <Button size="sm" variant="ghost" onClick={() => setChipLimit((n) => n + CHIPS_SHOWN)}>
            {th("more", { count: Math.min(CHIPS_SHOWN, visible.length - chipLimit) })}
          </Button>
        )}
        {!visible.length && <p className="py-2 text-sm text-muted-foreground">{t("history.noMatch")}</p>}
      </div>

      {current && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Tile
              label={th("tile_last")}
              sub={
                stats.last ? (
                  <>
                    <SupplierLink orgId={stats.last.supplierKey} name={stats.last.supplier} /> · {fmtDate(stats.last.day, locale)}
                  </>
                ) : undefined
              }
            >
              {stats.last ? <span dir="ltr">{priceText(stats.last.price)}</span> : "—"}
              {stats.last && <small className="ms-1 text-xs font-normal text-muted-foreground">{th("per", { unit: current.unit })}</small>}
            </Tile>
            <Tile label={th("tile_range")} sub={th("per", { unit: current.unit })}>
              {stats.min != null && stats.max != null ? <span dir="ltr">{`${plain(stats.min)} · ${plain(stats.max)}`}</span> : "—"}
            </Tile>
            <Tile label={th("tile_avg")} sub={th("purchases", { count: stats.purchases })}>
              {stats.average != null ? <span dir="ltr">{plain(stats.average)}</span> : "—"}
            </Tile>
            <Tile
              label={th("tile_change")}
              tone={stats.changePercent == null ? undefined : stats.changePercent > 0 ? "warn" : "ok"}
              sub={stats.baseline && stats.last && stats.changePercent != null ? th("change_sub", { from: plain(stats.baseline.price), to: plain(stats.last.price) }) : undefined}
            >
              <span dir="ltr">{signedPct(stats.changePercent)}</span>
            </Tile>
          </div>

          <section className="overflow-hidden rounded-2xl border bg-card">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3">
              <h3 className="text-base font-black" dir="auto">
                {current.name}
              </h3>
              <span className="text-xs text-muted-foreground">{th("chart_title", { unit: current.unit })}</span>
              {readByManufacturing(makeOrBuy, current.name) && <StatusPill tone="violet">{t("history.readByMfg")}</StatusPill>}
              <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setDrawer(true)}>
                {th("material_file")}
              </Button>
            </header>
            <div className="px-3 py-3">
              {chart.dots.length ? <Chart chart={chart} locale={locale} unit={current.unit} label={th("chart_label", { name: current.name })} /> : <p className="py-10 text-center text-sm text-muted-foreground">{th("chart_empty")}</p>}
              {chart.hidden > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{th("older_note", { count: chart.hidden })}</p>}
            </div>
          </section>

          <DataTable
            columns={columns}
            rows={tableRows}
            rowKey={(p) => p.id}
            caption={th("table", { name: current.name })}
            labels={{ sortBy: (c) => c, showMore: (n) => th("more", { count: n }) }}
            pageSize={24}
            empty={<EmptyState icon={LineChart} title={t("history.emptyTitle")} description={t("history.emptyDesc")} />}
            cardTitleKey="supplier"
          />
          <p className="text-xs text-muted-foreground">{th("caption")}</p>
          <p className="text-xs text-muted-foreground">{th("basis")}</p>
        </>
      )}
      <MaterialDrawer
        material={drawer && current ? current : null}
        open={drawer && Boolean(current)}
        onOpenChange={setDrawer}
        history={history}
        orders={orders}
        receipts={receipts}
        agreements={agreements}
        today={today}
        item={drawer && current && itemOf ? itemOf(current.name) : null}
      />
    </div>
  )
}
