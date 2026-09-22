"use client"

// Purchase orders (PRD 3.0 §7, tab 4): five segments with counts, a search
// that spans them, five columns, and the drawer. `?filter=<segment>` picks
// the segment and `?po=<id>` opens one order — the links notifications and
// Today use. Every figure is derived on render from the world; the page
// stores nothing.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { ClipboardList, Loader2, Search, X } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { PoDrawer } from "@/components/procurement/PoDrawer"
import { HonestDateText, Money, PoStatusPill } from "@/components/procurement/PoBits"
import { DEFAULT_SEGMENT, PO_SEGMENTS, isPoSegment, segmentCounts, visibleOrders, type PoSegment } from "@/components/procurement/PoModel"
import { Input } from "@/components/ui/input"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { displayPoNumber } from "@/lib/procurement/format"
import { poValue } from "@/lib/procurement/po"
import { cn } from "@/lib/utils"

/** Keeps `?filter=` and `?po=` in the address bar without a navigation. */
function replaceParams(update: (params: URLSearchParams) => void) {
  try {
    const url = new URL(window.location.href)
    update(url.searchParams)
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  } catch {
    /* not in a browser */
  }
}

export default function PurchaseOrdersPage() {
  const t = useTranslations("Portal.ProcOrders")
  const locale = useLocale()
  const world = useProcurementWorld()
  const { orders, actor, loading } = world
  const searchParams = useSearchParams()
  const [now] = useState(() => new Date())

  const filterParam = searchParams?.get("filter")
  const [segment, setSegment] = useState<PoSegment>(() => (isPoSegment(filterParam) ? filterParam : DEFAULT_SEGMENT))
  const [search, setSearch] = useState("")
  const searching = search.trim().length > 0
  const pick = (s: PoSegment) => {
    setSearch("")
    setSegment(s)
    replaceParams((p) => (s === DEFAULT_SEGMENT ? p.delete("filter") : p.set("filter", s)))
  }

  const counts = useMemo(() => segmentCounts(orders, now), [orders, now])
  const visible = useMemo(() => visibleOrders(orders, segment, search, now, (n) => displayPoNumber(n, locale)), [orders, segment, search, now, locale])

  // `?po=<id>` opens the drawer; opening and closing keep the address in step,
  // so a refresh lands on the same order and a copied link opens it.
  const poParam = searchParams?.get("po") || null
  const [openId, setOpenId] = useState<string | null>(poParam)
  useEffect(() => {
    if (poParam) setOpenId(poParam)
  }, [poParam])
  const openOrder = orders.find((o) => o.id === openId) || null
  const show = (id: string | null) => {
    setOpenId(id)
    replaceParams((p) => (id ? p.set("po", id) : p.delete("po")))
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <ProcurementHeader icon={ClipboardList} title={t("title")} description={t("desc")} />

        <div className="relative">
          <Search size={16} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground start-3" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search_ph")} aria-label={t("search_ph")} className="ps-9 pe-9" dir="auto" />
          {searching && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label={t("search_clear")}
              className="absolute top-1/2 -translate-y-1/2 end-2 grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className={cn("flex flex-wrap items-center gap-2", searching && "opacity-60")} role="tablist" aria-label={t("segments_label")}>
          {PO_SEGMENTS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={segment === s && !searching}
              onClick={() => pick(s)}
              className={cn(
                "min-h-9 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                segment === s && !searching ? "border-primary bg-primary text-white" : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              )}
            >
              {t(`seg.${s}`)}
              <span className="ms-1.5 tabular-nums opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>

        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="animate-spin text-muted-foreground" size={28} aria-label={t("loading")} />
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
            <ClipboardList size={36} className="mx-auto mb-2 opacity-20" aria-hidden="true" />
            <p className="text-sm font-medium">{searching ? t("empty_search", { term: search.trim() }) : t(`empty.${segment}`)}</p>
            <p className="mt-1 text-xs">{searching ? t("empty_search_hint") : t(`empty_hint.${segment}`)}</p>
          </div>
        ) : (
          <>
            {/* Desktop: the table */}
            <div className="hidden overflow-hidden rounded-xl border md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start font-bold">{t("col.number")}</th>
                    <th className="px-3 py-2 text-start font-bold">{t("col.supplier")}</th>
                    <th className="px-3 py-2 text-start font-bold">{t("col.status")}</th>
                    <th className="px-3 py-2 text-end font-bold">{t("col.value")}</th>
                    <th className="px-3 py-2 text-start font-bold">{t("col.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((po) => (
                    <tr
                      key={po.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => show(po.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          show(po.id)
                        }
                      }}
                      className="cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                    >
                      <td className="px-3 py-2.5 align-top">
                        <span dir="ltr" className="font-bold tabular-nums">
                          {displayPoNumber(po.docNumber, locale)}
                        </span>
                        <p className="text-[11px] text-muted-foreground">{po.preparedByName}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <p className="font-bold" dir="auto">
                          {po.supplierName}
                        </p>
                        <p className="max-w-[28ch] truncate text-xs text-muted-foreground" dir="auto" title={po.rfqTitle}>
                          {po.rfqTitle}
                          {po.projectName ? ` · ${po.projectName}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <PoStatusPill po={po} now={now} />
                      </td>
                      <td className="px-3 py-2.5 text-end align-top">
                        <Money value={poValue(po)} masked={!actor.seesPrices} className="font-bold" />
                      </td>
                      <td className="px-3 py-2.5 align-top text-xs">
                        <HonestDateText po={po} now={now} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards */}
            <ul className="space-y-2 md:hidden">
              {visible.map((po) => (
                <li key={po.id}>
                  <button
                    type="button"
                    onClick={() => show(po.id)}
                    className="w-full rounded-xl border bg-card p-3 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span dir="ltr" className="font-bold tabular-nums">
                        {displayPoNumber(po.docNumber, locale)}
                      </span>
                      <Money value={poValue(po)} masked={!actor.seesPrices} className="font-bold" />
                    </div>
                    <p className="mt-1 font-bold" dir="auto">
                      {po.supplierName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" dir="auto">
                      {po.rfqTitle}
                      {po.projectName ? ` · ${po.projectName}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <PoStatusPill po={po} now={now} />
                      <HonestDateText po={po} now={now} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <PoDrawer po={openOrder} world={world} open={Boolean(openOrder)} onOpenChange={(o) => !o && show(null)} now={now} />
      </div>
    </PortalLayout>
  )
}
