"use client"

// Work orders (أوامر التشغيل) — every order as a quantity on a route: how much
// is delivered and where the rest is, which department holds it, the date it
// needs against the date capacity allows, and (for those who see money) what it
// has cost against what it is worth. One click opens the order.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ClipboardList, History, Lock } from "lucide-react"
import { useRouter } from "@/i18n/routing"
import { pendingAt } from "@/lib/manufacturing-engine"
import { isV2Order } from "@/lib/manufacturing-writes"
import { ORDER_SEGMENTS, compareOrders, inSegment, matchesSearch, orderMoney, segmentCounts, type OrderSegment, type OrderView } from "@/lib/manufacturing-view"
import { ManufacturingView } from "./ManufacturingView"
import { useMfgUi } from "./MfgUiContext"
import { MfgDueCell, MfgQtyCell, MfgRushChip, MfgSourceChip, MfgStatePill, departmentNameOf, sourceNameOf } from "./MfgOrderBits"
import { MfgChip, MfgEmpty, MfgPanel, MfgQtyLegend, MfgSearchField, MfgSegments, departmentIcon, fmtMoney, fmtQty } from "./ui/MfgUi"

type Segment = OrderSegment | "legacy"
const PAGE = 25

export function MfgOrdersView() {
  const t = useTranslations("Portal.Shared")
  const router = useRouter()
  const ui = useMfgUi()
  const { data, perms, base } = ui
  const [segment, setSegment] = useState<Segment>("live")
  const [query, setQuery] = useState("")
  const [shown, setShown] = useState(PAGE)
  const [quickCreate, setQuickCreate] = useState(false)

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const seg = params.get("seg")
      if (seg && ([...ORDER_SEGMENTS, "legacy"] as string[]).includes(seg)) setSegment(seg as Segment)
      const q = params.get("q")
      if (q) setQuery(q)
      if (params.get("quick") === "1") setQuickCreate(true)
    } catch {
      /* not in a browser */
    }
  }, [])

  const choose = (s: Segment) => {
    setSegment(s)
    setShown(PAGE)
    router.replace(`${base}/orders?seg=${s}`, { scroll: false })
  }

  const counts = useMemo(() => segmentCounts(ui.views), [ui.views])
  const legacyCount = useMemo(() => data.orders.filter((o) => !isV2Order(o) && o.status !== "cancelled").length, [data.orders])
  const rows = useMemo(() => {
    if (segment === "legacy") return []
    return ui.views.filter((v) => inSegment(v, segment) && matchesSearch(v, query)).sort(compareOrders)
  }, [ui.views, segment, query])

  const items = [
    ...ORDER_SEGMENTS.map((s) => ({ id: s as Segment, label: t(`mfg3_ord_seg_${s}`), count: counts[s] })),
    ...(legacyCount > 0 ? [{ id: "legacy" as Segment, label: t("mfg3_ord_seg_legacy"), count: legacyCount }] : []),
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <MfgSegments value={segment} onChange={choose} items={items} label={t("mfg3_tab_orders")} />
        {segment !== "legacy" && (
          <MfgSearchField value={query} onChange={(v) => { setQuery(v); setShown(PAGE) }} placeholder={t("mfg3_ord_search")} className="w-full sm:ms-auto sm:w-64" />
        )}
      </div>

      {segment === "legacy" ? (
        <MfgPanel icon={History} title={t("mfg3_ord_legacy_title")} subtitle={t("mfg3_ord_legacy_sub")} bodyClassName="p-4">
          <ManufacturingView hideTitle legacyOnly openCreate={quickCreate} />
        </MfgPanel>
      ) : (
        <MfgPanel bodyClassName="">
          {!data.ready ? (
            <div className="space-y-2 p-4" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <MfgEmpty
              icon={ClipboardList}
              title={query ? t("mfg3_ord_empty_search") : t("mfg3_ord_empty")}
              hint={!data.products.length && perms.canManage ? t("mfg3_ord_empty_no_products") : undefined}
            />
          ) : (
            <>
              {/* Desktop: the table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[820px] text-xs">
                  <thead className="bg-muted/40 text-[11px] font-bold text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-start">{t("mfg3_ord_col_order")}</th>
                      <th className="px-4 py-2.5 text-start">{t("mfg3_ord_col_quantity")}</th>
                      <th className="px-4 py-2.5 text-start">{t("mfg3_ord_col_where")}</th>
                      <th className="px-4 py-2.5 text-start">{t("mfg3_ord_col_date")}</th>
                      {perms.seesMoney && <th className="px-4 py-2.5 text-end">{t("mfg3_ord_col_cost")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, shown).map((v) => (
                      <tr
                        key={v.id}
                        tabIndex={0}
                        onClick={() => ui.openOrder(v.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            ui.openOrder(v.id)
                          }
                        }}
                        className="cursor-pointer border-t border-border/60 align-middle transition-colors hover:bg-warning/5 focus-visible:bg-warning/5 focus-visible:outline-none"
                        aria-label={t("mfg3_ord_open", { order: v.number })}
                      >
                        <td className="px-4 py-3">
                          <OrderIdentity view={v} />
                        </td>
                        <td className="px-4 py-3">
                          <MfgQtyCell view={v} />
                        </td>
                        <td className="px-4 py-3">
                          <WhereCell view={v} />
                        </td>
                        <td className="px-4 py-3">
                          <MfgDueCell view={v} departments={data.departments} />
                        </td>
                        {perms.seesMoney && (
                          <td className="px-4 py-3 text-end">
                            <CostCell view={v} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: cards */}
              <ul className="divide-y md:hidden">
                {rows.slice(0, shown).map((v) => (
                  <li key={v.id}>
                    <button type="button" onClick={() => ui.openOrder(v.id)} className="flex w-full flex-col gap-2.5 px-4 py-3.5 text-start hover:bg-warning/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <OrderIdentity view={v} />
                      <MfgQtyCell view={v} />
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <WhereCell view={v} />
                        <MfgDueCell view={v} departments={data.departments} />
                      </div>
                      {perms.seesMoney && <CostCell view={v} />}
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5">
                <MfgQtyLegend />
                <span className="text-[11px] text-muted-foreground">{t("mfg3_ord_count", { shown: Math.min(shown, rows.length), total: rows.length })}</span>
              </div>
              {rows.length > shown && (
                <button type="button" onClick={() => setShown((s) => s + PAGE)} className="w-full border-t bg-muted/30 py-2.5 text-xs font-semibold text-cta hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  {t("mfg3_show_more", { count: rows.length - shown })}
                </button>
              )}
            </>
          )}
        </MfgPanel>
      )}
    </div>
  )
}

function OrderIdentity({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const Icon = departmentIcon(view.current >= 0 ? departmentNameOf(data.departments, view, view.current) : view.product.name)
  return (
    <div className="flex min-w-[220px] items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-slate-600">
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-bold text-foreground">
          <span className="text-muted-foreground" dir="ltr">#{view.number}</span> · {view.product.name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {sourceNameOf(view, t)}
          <MfgSourceChip view={view} />
          {view.rush && <MfgRushChip />}
        </span>
      </span>
    </div>
  )
}

function WhereCell({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  return (
    <div className="flex min-w-[140px] flex-col items-start gap-1">
      <MfgStatePill view={view} departments={data.departments} />
      {view.active.slice(1).map((i) => (
        <MfgChip key={i}>
          {t("mfg3_ord_also_at", { qty: fmtQty(pendingAt(view.slice, view.product.route, i, view.noteSlices)), dept: departmentNameOf(data.departments, view, i) })}
        </MfgChip>
      ))}
      {view.hardBlocked && <MfgChip tone="bad" icon={Lock}>{t("mfg3_blocked")}</MfgChip>}
    </div>
  )
}

function CostCell({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const m = orderMoney(view, data.departments, data.settings)
  return (
    <div className="flex flex-col items-end">
      <b className="text-xs tabular-nums" dir="ltr">{fmtMoney(m.total)} ﷼</b>
      {m.value != null && (
        <span className="text-[10px] text-muted-foreground">
          {t(m.valueKind === "sale" ? "mfg3_ord_of_sale" : "mfg3_ord_of_estimate", { value: fmtMoney(m.value) })}
        </span>
      )}
    </div>
  )
}
