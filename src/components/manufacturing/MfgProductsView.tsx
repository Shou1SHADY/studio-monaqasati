"use client"

// Products (PC). Each product carries its own route, bill of materials,
// standard time, planned waste and blocking flags — everything the workshop
// computes starts from the card. We own route, BOM, time and standard cost;
// the sale price lives in Sales and the item code in Inventory (D10), so no
// card shows a price, a margin or an estimate value.
//
// URL: `?open=<productId>` opens a product's panel.

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Mountain, SearchX } from "lucide-react"
import { usePathname, useRouter } from "@/i18n/routing"
import { standardCost, type MfgProduct } from "@/lib/manufacturing-engine"
import { useMfgUi } from "./MfgUiContext"
import { MfgPrdDrawer } from "./MfgPrdDrawer"
import { MfgPrdFlags, MfgPrdRouteChips, productTime, stepName } from "./MfgPrdBits"
import { MfgEmpty, MfgNote, MfgSearchField, fmtMoney, fmtQty } from "./ui/MfgUi"

export function MfgProductsView() {
  const t = useTranslations("Portal.Shared")
  const { data, perms } = useMfgUi()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = searchParams?.toString() ?? ""
  const [search, setSearch] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)

  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (handled.current === params) return
    handled.current = params
    const sp = new URLSearchParams(params)
    const open = sp.get("open")
    if (!open) return
    setOpenId(open)
    sp.delete("open")
    const rest = sp.toString()
    router.replace(rest ? `${pathname}?${rest}` : pathname)
  }, [params, pathname, router])

  const live = useMemo(() => data.products.filter((p) => !p.archived), [data.products])
  const products = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return live
    return live.filter((p) => [p.name, p.unit, ...(p.route || []).map((r) => stepName(data.departments, r))].join(" ").toLowerCase().includes(q))
  }, [live, data.departments, search])

  return (
    <div className="space-y-4">
      {/* "New product" lives in the shell's header for this tab (UI-04: no duplicate actions). */}
      <MfgSearchField value={search} onChange={setSearch} placeholder={t("mfr_prd_search")} />

      <MfgNote tone="info">{t("mfr_prd_ownership_note")}</MfgNote>

      {live.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white">
          <MfgEmpty icon={Mountain} title={t("mfr_prd_empty")} hint={perms.canManage ? t("mfr_prd_empty_hint") : undefined} />
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white">
          <MfgEmpty icon={SearchX} title={t("mfr_prd_search_empty")} />
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} onOpen={() => setOpenId(p.id)} />
          ))}
        </div>
      )}

      <MfgPrdDrawer productId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function ProductCard({ product, onOpen }: { product: MfgProduct; onOpen: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { data, seesMoney } = useMfgUi()
  const timeOn = data.settings.features.time
  const std = standardCost(product, data.departments, data.settings, 1)
  const time = productTime(product)
  const buy = product.referenceBuyPrice

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-2xl border bg-white p-4 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
          <Mountain size={17} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold leading-snug text-foreground" dir="auto">
            {product.name}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {t("mfr_prd_unit", { unit: product.unit })} · {t("mfr_prd_waste", { pct: fmtQty(product.wastePercent) })}
          </span>
        </span>
      </span>

      <span className="mt-3 block">
        <MfgPrdRouteChips product={product} departments={data.departments} timeOn={timeOn} />
      </span>
      <span className="mt-2 block">
        <MfgPrdFlags product={product} />
      </span>

      {(timeOn || seesMoney) && (
        <>
          <span className="block min-h-3 flex-1" aria-hidden="true" />
          <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-[11px] font-semibold text-muted-foreground">
            {timeOn && (
              <span>
                {t("mfr_prd_time")}{" "}
                <b className="tabular-nums text-foreground">
                  {t("mfr_prd_hours", { hours: fmtQty(time.hours) })}
                </b>
                {time.unestimated > 0 && <span className="ms-1 text-warning">({t("mfr_prd_not_estimated_count", { count: time.unestimated })})</span>}
              </span>
            )}
            {seesMoney && (
              <span>
                {t("mfr_prd_std_cost")}{" "}
                <b dir="ltr" className="tabular-nums text-foreground">
                  {fmtMoney(std.total)} ﷼
                </b>
                {!std.allPriced && <span className="ms-1 text-warning">({t("mfr_cost_incomplete")})</span>}
              </span>
            )}
            {seesMoney && buy != null && buy > 0 && (
              <span>
                {t("mfr_prd_buy")}{" "}
                <b dir="ltr" className="tabular-nums text-foreground">
                  {fmtMoney(buy)} ﷼
                </b>
              </span>
            )}
          </span>
        </>
      )}
    </button>
  )
}
