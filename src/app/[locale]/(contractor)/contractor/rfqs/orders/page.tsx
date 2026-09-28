"use client"

// Purchase orders (PRD 3.0 §7, tab 4): five segments with counts, a search
// that spans them, five columns, and the drawer. `?filter=<segment>` picks
// the segment and `?po=<id>` opens one order — the links notifications and
// Today use. Every figure is derived on render from the world; the page
// stores nothing.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { ClipboardList, LayoutGrid, Loader2, Search, X } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { PoDrawer } from "@/components/procurement/PoDrawer"
import { HonestDateText, LineBar, Money, PoStatusPill } from "@/components/procurement/PoBits"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DEFAULT_SEGMENT, PO_SEGMENTS, isPoSegment, segmentCounts, visibleOrders, type PoSegment } from "@/components/procurement/PoModel"
import { Input } from "@/components/ui/input"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { displayPoNumber } from "@/lib/procurement/format"
import { poValue } from "@/lib/procurement/po"
import { advanceState, asX, openHolds, poRevision } from "@/lib/procurement/po-extras"
import { poInScope } from "@/lib/procurement/rfq-view"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"

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
  const { actor, loading } = world
  const tp = useTranslations("Portal.Procurement")
  // A buyer sees the orders he prepared, and those in his categories (R-18).
  const { profile } = useResolvedProfile(actor.uid || null)
  const buyerCategories = ((profile as { procurementCategories?: string[] } | null)?.procurementCategories) || null
  const orders = useMemo(() => world.orders.filter((o) => poInScope(o, actor, buyerCategories)), [world.orders, actor, buyerCategories])
  const searchParams = useSearchParams()
  const [now] = useState(() => new Date())

  const filterParam = searchParams?.get("filter")
  const [segment, setSegment] = useState<PoSegment>(() => (isPoSegment(filterParam) ? filterParam : DEFAULT_SEGMENT))
  // The header's search sends the expediter here with `?search=` (P-09).
  const [search, setSearch] = useState(() => searchParams?.get("search") ?? "")
  const searching = search.trim().length > 0
  const pick = (s: PoSegment) => {
    setSearch("")
    setSegment(s)
    replaceParams((p) => (s === DEFAULT_SEGMENT ? p.delete("filter") : p.set("filter", s)))
  }

  const counts = useMemo(() => segmentCounts(orders, now), [orders, now])
  const visible = useMemo(() => visibleOrders(orders, segment, search, now, (n) => displayPoNumber(n, locale)), [orders, segment, search, now, locale])
  // The project filter (the prototype's "all projects"), over the projects the orders name.
  const [project, setProject] = useState("all")
  const projects = useMemo(
    () => Array.from(new Map(orders.filter((o) => o.projectId).map((o) => [o.projectId as string, { id: o.projectId as string, name: o.projectName || (o.projectId as string) }])).values()).sort((a, b) => a.name.localeCompare(b.name)),
    [orders]
  )
  const shown = project === "all" ? visible : visible.filter((o) => o.projectId === project)

  // `?po=<id>` opens the drawer; opening and closing keep the address in step,
  // so a refresh lands on the same order and a copied link opens it.
  const poParam = searchParams?.get("po") || null
  const [openId, setOpenId] = useState<string | null>(poParam)
  useEffect(() => {
    if (poParam) setOpenId(poParam)
  }, [poParam])
  const openOrder = world.orders.find((o) => o.id === openId) || null
  const show = (id: string | null) => {
    setOpenId(id)
    replaceParams((p) => (id ? p.set("po", id) : p.delete("po")))
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <ProcurementHeader title={t("title")} description={t("desc")} />

        {/* The segments with their counts · a search that spans every segment · the project (the prototype's list head). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ProcChipGroup
            items={PO_SEGMENTS.map((s) => ({ id: s, label: t(`seg.${s}`), count: counts[s] }))}
            active={segment}
            onPick={pick}
            label={t("segments_label")}
            dimmed={searching}
          />
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground start-3" aria-hidden="true" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search_ph")} aria-label={t("search_ph")} className="h-10 w-full rounded-xl bg-card ps-9 pe-9 sm:w-56" dir="auto" />
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
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger className="h-10 w-48 rounded-xl bg-card text-sm" aria-label={t("project_filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("project_all")}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center p-16">
            <Loader2 className="animate-spin text-muted-foreground" size={28} aria-label={t("loading")} />
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
            <ClipboardList size={36} className="mx-auto mb-2 opacity-20" aria-hidden="true" />
            <p className="text-sm font-medium">{searching ? t("empty_search", { term: search.trim() }) : t(`empty.${segment}`)}</p>
            <p className="mt-1 text-xs">{searching ? t("empty_search_hint") : t(`empty_hint.${segment}`)}</p>
          </div>
        ) : (
          <>
            {/* Desktop: the table */}
            <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm md:block">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.order_supplier")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.lines")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.supplier_date")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.value")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("col.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((po) => (
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
                      className="cursor-pointer transition-colors hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none"
                    >
                      <td className="px-4 py-3 align-top">
                        <span dir="ltr" className="font-black tabular-nums">
                          {displayPoNumber(po.docNumber, locale)}
                        </span>
                        {poRevision(po) > 1 && <span className="ms-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{tp("rfqpo.po.revision", { n: poRevision(po) })}</span>}
                        <p className="text-xs text-muted-foreground" dir="auto">
                          {po.supplierName}
                          {po.preparedByName ? ` · ${po.preparedByName}` : ""}
                        </p>
                        {po.projectName && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-cta/20 bg-cta/5 px-2 py-0.5 text-[11px] font-semibold text-cta">
                            <LayoutGrid size={12} aria-hidden="true" />
                            {po.projectName}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <ul className="space-y-1.5">
                          {po.lines.slice(0, 3).map((l) => (
                            <li key={l.id} className="max-w-[34ch]">
                              <p className="truncate" dir="auto">
                                {l.name} <span className="tabular-nums" dir="ltr">{l.quantity.toLocaleString("en-US")}</span> {l.unit}
                              </p>
                              {l.accepted > 0 && <LineBar line={l} className="mt-1" />}
                            </li>
                          ))}
                          {po.lines.length > 3 && <li className="text-[11px] text-muted-foreground">{t("more_lines", { count: po.lines.length - 3 })}</li>}
                        </ul>
                      </td>
                      <td className="px-4 py-3 align-top text-xs">
                        <HonestDateText po={po} now={now} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Money value={poValue(po)} masked={!actor.seesPrices} className="font-bold" />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <PoStatusPill po={po} now={now} />
                        {openHolds(asX(po)).length > 0 && <p className="mt-1 text-[11px] text-destructive">{tp("rfqpo.po.row_held")}</p>}
                        {advanceState(asX(po)) === "requested" && <p className="mt-1 text-[11px] text-muted-foreground">{tp("rfqpo.po.row_advance")}</p>}
                        {asX(po).pmBudget?.state === "pending" && <p className="mt-1 text-[11px] text-warning">{tp("rfqpo.po.row_budget")}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards */}
            <ul className="space-y-2 md:hidden">
              {shown.map((po) => (
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
