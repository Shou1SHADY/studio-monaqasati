"use client"

// The Manufacturing frame: one header with the module's search and its two
// entry actions, three headline figures that jump to the orders behind them,
// and the tab rail — each tab a real URL, each with the count that says
// whether it needs attention.

import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CalendarCheck2, ClipboardList, Factory, FilePlus2, Inbox, Layers, Plus, Search, SlidersHorizontal, Truck } from "lucide-react"
import { Link, useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { compareOrders, matchesSearch } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgKpiCard, fmtQty } from "./ui/MfgUi"

export type MfgTabId = "today" | "requests" | "orders" | "floor" | "products" | "settings"

export function mfgBasePath(portal: "contractor" | "supplier"): string {
  return `/${portal}/manufacturing`
}

interface TabDef {
  id: MfgTabId
  segment: string
  labelKey: string
  icon: ElementType
}

const TABS: TabDef[] = [
  { id: "today", segment: "", labelKey: "mfg3_tab_today", icon: CalendarCheck2 },
  { id: "requests", segment: "requests", labelKey: "mfg3_tab_requests", icon: Inbox },
  { id: "orders", segment: "orders", labelKey: "mfg3_tab_orders", icon: ClipboardList },
  { id: "floor", segment: "floor", labelKey: "mfg3_tab_floor", icon: Factory },
  { id: "products", segment: "products", labelKey: "mfg3_tab_products", icon: Layers },
  { id: "settings", segment: "settings", labelKey: "mfg3_tab_settings", icon: SlidersHorizontal },
]

export function MfgShell({ tab, children }: { tab: MfgTabId; children: ReactNode }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const router = useRouter()
  const ui = useMfgUi()
  const { data, perms, kpis, base } = ui

  const visible = TABS.filter((tb) => {
    if (tb.id === "settings") return perms.canManage
    if (tb.id === "requests") return perms.canManage || perms.canCost || perms.canRequest
    if (tb.id === "products") return perms.canManage || perms.canCost || perms.canWork
    return true
  })

  const counts: Partial<Record<MfgTabId, number>> = {
    today: ui.decisions.length,
    requests:
      data.requests.filter((r) => r.status === "new").length +
      (data.settings.features.estimates ? data.estimates.filter((e) => e.state === "draft").length : 0),
    orders: ui.views.filter((v) => v.live).length,
    floor: data.notes.filter((n) => n.status === "in_transit" && ui.viewById.has(n.source?.workOrderId)).length,
    products: data.products.length,
  }

  const bnName = kpis.bottleneck ? data.departments.find((d) => d.id === kpis.bottleneck!.departmentId)?.name || "" : ""

  return (
    <div className="space-y-5" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-warning/10 text-warning">
            <Factory size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-primary">{t("mfg3_module_title")}</h1>
            <p className="text-sm text-muted-foreground">{t(`mfg3_tab_desc_${tab}`)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ms-auto">
          <MfgGlobalSearch />
          {perms.canRequest && (
            <Button variant="outline" className="gap-2" onClick={() => router.push(`${base}/requests?new=1`)}>
              <FilePlus2 size={16} aria-hidden="true" />
              {t("mfg3_action_request")}
            </Button>
          )}
          {perms.canCreate && (
            <Button className="gap-2" onClick={ui.openNewOrder} disabled={!data.products.length}>
              <Plus size={16} aria-hidden="true" />
              {t("mfg3_action_new_order")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MfgKpiCard
          icon={Factory}
          label={t("mfg3_kpi_in_production")}
          value={kpis.liveCount}
          unit={t("mfg3_kpi_orders_unit")}
          sub={t("mfg3_kpi_in_production_sub", { units: fmtQty(kpis.wipUnits) })}
          onClick={() => router.push(`${base}/orders?seg=live`)}
        />
        <MfgKpiCard
          icon={AlertTriangle}
          label={data.settings.features.time ? t("mfg3_kpi_will_miss") : t("mfg3_kpi_past_due")}
          value={kpis.lateCount}
          unit={t("mfg3_kpi_orders_unit")}
          subTone={kpis.lateCount ? "bad" : "ok"}
          sub={
            kpis.lateCount
              ? kpis.bottleneck
                ? t("mfg3_kpi_bottleneck", { dept: bnName, days: kpis.bottleneck.days })
                : t("mfg3_kpi_late_sub")
              : t("mfg3_kpi_on_time")
          }
          onClick={() => router.push(`${base}/orders?seg=late`)}
        />
        <MfgKpiCard
          icon={Truck}
          label={t("mfg3_kpi_ready")}
          value={fmtQty(kpis.readyUnits)}
          unit={t("mfg3_kpi_units_unit")}
          subTone={kpis.readyUnits ? "warn" : "muted"}
          sub={kpis.readyOrders ? t("mfg3_kpi_ready_sub", { orders: kpis.readyOrders }) : t("mfg3_kpi_ready_none")}
          onClick={() => router.push(`${base}/floor`)}
        />
      </div>

      <nav aria-label={t("mfg3_module_title")} className="border-b border-border">
        <ul className="-mb-px flex items-center gap-1 overflow-x-auto">
          {visible.map((tb) => {
            const href = tb.segment ? `${base}/${tb.segment}` : base
            const isActive = tb.id === tab
            const Icon = tb.icon
            const count = counts[tb.id]
            return (
              <li key={tb.id}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive ? "border-warning text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  )}
                >
                  <Icon size={15} className={cn("shrink-0", isActive && "text-warning")} aria-hidden="true" />
                  {t(tb.labelKey)}
                  {count != null && count > 0 && (
                    <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums", isActive ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
                      {count}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {children}
    </div>
  )
}

/** Search every order and product from any tab; Ctrl/⌘+K focuses it. */
function MfgGlobalSearch() {
  const t = useTranslations("Portal.Shared")
  const router = useRouter()
  const ui = useMfgUi()
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onClick)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onClick)
    }
  }, [])

  const orders = useMemo(
    () => (q.trim() ? ui.views.filter((v) => !v.cancelled && matchesSearch(v, q)).sort(compareOrders).slice(0, 6) : []),
    [q, ui.views]
  )
  const products = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? ui.data.products.filter((p) => p.name.toLowerCase().includes(s)).slice(0, 3) : []
  }, [q, ui.data.products])

  const go = () => {
    if (!q.trim()) return
    setOpen(false)
    router.push(`${ui.base}/orders?q=${encodeURIComponent(q.trim())}&seg=all`)
  }

  return (
    <div ref={boxRef} className="relative w-full sm:w-72">
      <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go()
          if (e.key === "Escape") setOpen(false)
        }}
        placeholder={t("mfg3_search_placeholder")}
        aria-label={t("mfg3_search_placeholder")}
        className="h-10 w-full rounded-xl border border-input bg-white ps-8 pe-12 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <kbd className="pointer-events-none absolute end-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground sm:block" dir="ltr">
        Ctrl K
      </kbd>
      {open && q.trim() && (
        <div className="absolute inset-x-0 top-11 z-40 overflow-hidden rounded-xl border bg-white shadow-lg">
          {orders.length === 0 && products.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t("mfg3_search_empty")}</p>}
          {orders.length > 0 && <p className="px-3 pb-1 pt-2 text-[10px] font-bold text-muted-foreground">{t("mfg3_tab_orders")}</p>}
          {orders.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => { setOpen(false); ui.openOrder(v.id) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs hover:bg-warning/5 focus-visible:bg-warning/5 focus-visible:outline-none"
            >
              <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">#{v.number}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{v.product.name}</span>
              <span className="truncate text-[11px] text-muted-foreground">{v.sourceName}</span>
            </button>
          ))}
          {products.length > 0 && <p className="px-3 pb-1 pt-2 text-[10px] font-bold text-muted-foreground">{t("mfg3_tab_products")}</p>}
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setOpen(false); router.push(`${ui.base}/products?open=${p.id}`) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs hover:bg-warning/5 focus-visible:bg-warning/5 focus-visible:outline-none"
            >
              <Layers size={13} className="text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              <span className="text-[11px] text-muted-foreground">{p.unit}</span>
            </button>
          ))}
          <button type="button" onClick={go} className="w-full border-t bg-muted/30 px-3 py-2 text-start text-[11px] font-semibold text-cta hover:bg-muted/60">
            {t("mfg3_search_all", { q: q.trim() })}
          </button>
        </div>
      )}
    </div>
  )
}
