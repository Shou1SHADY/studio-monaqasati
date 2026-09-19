"use client"

// The Workshop (الورشة) — the orders screen (D2, WS-01…WS-09). Search first,
// counted filters with "late" as a cross-cutting flag, one row per order with
// where its quantity is, its honest date and the viewer's next step (or who it
// waits on), and the department board as a second view: a column per station
// with its capacity, queue, lead and today's lost hours. No KPIs here.
//
// The search, the filter, the late flag and the view live in the URL (?q= &f=
// &late=1 &view=board) so a Today figure can land on exactly what it counted.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { CalendarDays, ClipboardList, Clock, Download, History, LayoutGrid, Lock, Search, User, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { isV2Order } from "@/lib/manufacturing-writes"
import { deptCapacity, hardBlocked, materialState, stationGate, type Candidate } from "@/lib/manufacturing-engine"
import {
  WORKSHOP_FILTERS,
  compareWorkshop,
  departmentLoads,
  filterCounts,
  inFilter,
  matchesSearch,
  myStations,
  stationAction,
  type OrderView,
  type WorkshopFilter,
} from "@/lib/manufacturing-view"
import { ManufacturingView } from "./ManufacturingView"
import { ManufacturingMindMap } from "./ManufacturingMindMap"
import { buildMindMapFromViews } from "@/lib/manufacturing-mindmap"
import { useMfgUi } from "./MfgUiContext"
import { WORKSHOP_SEARCH_ID } from "./MfgShell"
import {
  CANDIDATE_ICON,
  MfgDueCell,
  MfgModuleChip,
  MfgNextCell,
  MfgQtyCell,
  MfgRushChip,
  MfgSourceChip,
  MfgStatePill,
  sourceNameOf,
  stateBits,
  stateOf,
  useCandidateWords,
} from "./MfgOrderBits"
import { MfgChip, MfgEmpty, MfgLoadBar, MfgPanel, MfgQtyLegend, MfgSegments, departmentIcon, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"

type WsView = "list" | "board" | "map" | "legacy"

interface WsState {
  q: string
  f: WorkshopFilter
  late: boolean
  /** null = not chosen: the tab's default (board for /floor and for leads). */
  view: WsView | null
  sta: "mine" | "all"
}

const OWN_KEYS = ["q", "f", "late", "view", "sta"]
const PAGE = 30

function parseState(p: URLSearchParams): WsState {
  const f = p.get("f") as WorkshopFilter | null
  const view = p.get("view")
  return {
    q: p.get("q") || "",
    f: f && WORKSHOP_FILTERS.includes(f) ? f : "all",
    late: p.get("late") === "1",
    view: view === "list" || view === "board" || view === "map" || view === "legacy" ? view : null,
    sta: p.get("sta") === "all" ? "all" : "mine",
  }
}

function ownQuery(s: WsState): string {
  const qs = new URLSearchParams()
  if (s.q) qs.set("q", s.q)
  if (s.f !== "all") qs.set("f", s.f)
  if (s.late) qs.set("late", "1")
  if (s.view) qs.set("view", s.view)
  if (s.sta === "all") qs.set("sta", "all")
  return qs.toString()
}

/** State that mirrors the URL: read on arrival and whenever the URL changes
 * from outside (a link to the Workshop while it is open), written back with
 * replaceState so typing never triggers a navigation. The router reports our
 * own replaceState calls back asynchronously; a value we wrote moments ago is
 * an echo, not a new instruction, so fast typing is never rolled back. */
function useWorkshopState(): [WsState, (patch: Partial<WsState>) => void] {
  const params = useSearchParams()
  const paramsKey = params?.toString() || ""
  const [state, setState] = useState<WsState>(() => parseState(new URLSearchParams(paramsKey)))
  const written = useRef(ownQuery(state))
  const echoes = useRef(new Map<string, number>())

  useEffect(() => {
    const incoming = parseState(new URLSearchParams(paramsKey))
    const own = ownQuery(incoming)
    if (own === written.current) return
    const at = echoes.current.get(own)
    if (at != null && Date.now() - at < 2000) return
    written.current = own
    setState(incoming)
  }, [paramsKey])

  useEffect(() => {
    const own = ownQuery(state)
    if (own === written.current) return
    written.current = own
    const now = Date.now()
    echoes.current.forEach((t, k) => {
      if (now - t > 5000) echoes.current.delete(k)
    })
    echoes.current.set(own, now)
    try {
      const url = new URL(window.location.href)
      for (const k of OWN_KEYS) url.searchParams.delete(k)
      new URLSearchParams(own).forEach((v, k) => url.searchParams.set(k, v))
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
    } catch {
      /* not in a browser */
    }
  }, [state])

  return [state, (patch) => setState((s) => ({ ...s, ...patch }))]
}

export function MfgWorkshopView({ initialView = "list" }: { initialView?: "list" | "board" }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, views, nextStepOf } = ui
  const [state, update] = useWorkshopState()
  const [per, setPer] = useState(PAGE)

  const legacyCount = useMemo(() => data.orders.filter((o) => !isV2Order(o) && o.status !== "cancelled").length, [data.orders])
  const defaultView: WsView = initialView === "board" || ui.persona === "lead" ? "board" : "list"
  const view: WsView = state.view === "legacy" && !legacyCount ? "list" : state.view || defaultView

  const matched = useMemo(() => views.filter((v) => matchesSearch(v, state.q)), [views, state.q])
  const counts = useMemo(() => filterCounts(matched), [matched])
  const lateCount = useMemo(() => matched.filter((v) => v.late).length, [matched])
  const list = useMemo(() => {
    const rows = matched.filter((v) => inFilter(v, state.f) && (!state.late || v.late))
    const withStep = new Set(rows.filter((v) => nextStepOf(v)).map((v) => v.id))
    return rows.sort(compareWorkshop((v) => withStep.has(v.id)))
  }, [matched, state.f, state.late, nextStepOf])

  const choose = (patch: Partial<WsState>) => {
    update(patch)
    setPer(PAGE)
  }

  const costView = ui.persona === "cost" || ui.persona === "management"

  const mindMapRoot = useMemo(
    () =>
      buildMindMapFromViews(list, {
        root: t("mfw_module_title"),
        rootSub: (count) => t("mfg_map_root_sub", { count }),
        noSource: t("mfg_map_no_source"),
        noSourceHint: t("mfg_map_no_source_hint"),
        centralTag: t("mfg_map_central_tag"),
        projectTag: t("mfg4_source_project"),
        outboundTag: t("mfg_map_outbound_tag"),
        unassigned: "",
        statusOpen: t("mfg_status_open"),
        statusDone: t("mfg_status_done"),
        statusCancelled: t("mfg_status_cancelled"),
        destinationPending: t("mfg_map_dest_pending"),
        destinationOpen: t("mfg_map_dest_open"),
        delivered: t("mfg_map_delivered"),
        sourceClient: t("mfg4_source_client"),
        sourceProject: t("mfg4_source_project"),
        sourceStock: t("mfg4_source_stock"),
        inTransit: t("mfg_map_in_transit"),
        progress: (done, qty) => t("mfg_map_progress", { done: fmtQty(done), qty: fmtQty(qty) }),
        late: t("mfw_f_late"),
      }),
    [list, t]
  )

  return (
    <div className="min-w-0 space-y-3">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id={WORKSHOP_SEARCH_ID}
          type="search"
          value={state.q}
          autoComplete="off"
          onChange={(e) => choose({ q: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && list.length === 1) ui.openOrder(list[0].id)
          }}
          placeholder={t("mfw_ws_search")}
          aria-label={t("mfw_ws_search")}
          className="h-11 rounded-xl bg-white pe-3 ps-9 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label={t("mfw_ws_filters")}>
          {WORKSHOP_FILTERS.filter((f) => f === "all" || counts[f] > 0 || state.f === f).map((f) => (
            <FilterChip key={f} active={state.f === f} count={counts[f]} onClick={() => choose({ f })}>
              {t(`mfw_f_${f}`)}
            </FilterChip>
          ))}
          <FilterChip active={state.late} count={lateCount} tone="bad" onClick={() => choose({ late: !state.late })}>
            <Clock size={12} aria-hidden="true" /> {t("mfw_f_late")}
          </FilterChip>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => exportCsv(list)} disabled={!list.length}>
            <Download size={14} aria-hidden="true" /> {t("mfw_ws_export")}
          </Button>
          <MfgSegments<WsView>
            label={t("mfw_ws_view")}
            value={view}
            onChange={(v) => choose({ view: v })}
            items={[
              { id: "list", label: t("mfw_ws_view_list") },
              { id: "board", label: t("mfw_ws_view_board") },
              { id: "map", label: t("mfw_ws_view_map") },
              ...(legacyCount ? [{ id: "legacy" as WsView, label: t("mfw_ws_view_legacy"), count: legacyCount }] : []),
            ]}
          />
        </div>
      </div>

      {!data.ready ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      ) : view === "legacy" ? (
        <MfgPanel icon={History} title={t("mfw_ws_legacy_title")} subtitle={t("mfw_ws_legacy_sub")} bodyClassName="p-4">
          <ManufacturingView hideTitle legacyOnly />
        </MfgPanel>
      ) : view === "board" ? (
        <WorkshopBoard list={list} sta={state.sta} onSta={(sta) => update({ sta })} />
      ) : view === "map" ? (
        // The mind map — optional, for whoever wants the journey drawn; the
        // BRD dropped it and the customer asked for it back as a view.
        <MfgPanel bodyClassName="p-0">
          <ManufacturingMindMap root={mindMapRoot} onSelectOrder={ui.openOrder} />
        </MfgPanel>
      ) : (
        <MfgPanel>
          {list.length === 0 ? (
            <MfgEmpty icon={ClipboardList} title={t("mfw_ws_empty")} hint={state.q ? t("mfw_ws_empty_search") : undefined} />
          ) : (
            <>
              <div
                className="hidden gap-3 border-b bg-muted/40 px-4 py-2.5 text-[11px] font-bold text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(150px,1fr)_minmax(160px,1fr)_minmax(130px,0.9fr)_minmax(150px,auto)]"
                aria-hidden="true"
              >
                <span>{t("mfw_ws_col_order")}</span>
                <span>{t("mfw_ws_col_quantity")}</span>
                <span>{t("mfw_ws_col_state")}</span>
                <span>{t("mfw_ws_col_date")}</span>
                <span className="text-end">{costView ? t("mfw_ws_col_cost") : t("mfw_ws_col_next")}</span>
              </div>
              <ul>
                {list.slice(0, per).map((v) => (
                  <WorkshopRow key={v.id} view={v} costView={costView} />
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5">
                <MfgQtyLegend />
                <span className="text-[11px] text-muted-foreground">{t("mfw_ws_count", { shown: Math.min(per, list.length), total: list.length })}</span>
              </div>
              {list.length > per && (
                <button
                  type="button"
                  onClick={() => setPer((p) => p + PAGE)}
                  className="min-h-[44px] w-full border-t bg-muted/30 py-2.5 text-xs font-semibold text-cta hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {t("mfw_show_more", { count: Math.min(PAGE, list.length - per) })}
                </button>
              )}
            </>
          )}
        </MfgPanel>
      )}
    </div>
  )

  function exportCsv(rows: OrderView[]) {
    const money = ui.seesMoney
    const head = [
      t("mfw_csv_ref"),
      t("mfw_csv_product"),
      t("mfw_csv_source"),
      t("mfw_csv_quantity"),
      t("mfw_csv_unit"),
      t("mfw_csv_delivered"),
      t("mfw_csv_state"),
      t("mfw_csv_required"),
      t("mfw_csv_possible"),
      ...(money ? [t("mfw_csv_cost"), t("mfw_csv_earned"), t("mfw_csv_wip")] : []),
    ]
    const body = rows.map((v) => [
      v.ref,
      v.product.name,
      sourceNameOf(v, t),
      v.quantity,
      v.unit,
      v.calc.delivered,
      stateOf(v, data.departments, t).label,
      v.neededBy || "",
      v.possibleDate || "",
      ...(money ? [v.cost.total, v.cost.earnedStandard, v.cost.wip] : []),
    ])
    const cell = (x: string | number) => {
      if (typeof x === "number") return String(x)
      const s = /^[=+\-@]/.test(x) ? `'${x}` : x
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = "﻿" + [head, ...body].map((r) => r.map(cell).join(",")).join("\r\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `work-orders-${ui.today}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

function FilterChip({ active, count, tone, onClick, children }: { active: boolean; count: number; tone?: "bad"; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        active
          ? tone === "bad"
            ? "border-destructive bg-destructive text-white"
            : "border-primary bg-primary text-white"
          : tone === "bad"
            ? "border-destructive/30 bg-white text-destructive hover:bg-destructive/5"
            : "border-border bg-white text-slate-700 hover:border-slate-300 hover:bg-muted/40"
      )}
    >
      {children}
      <span className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums", active ? "bg-white/20" : "bg-muted text-muted-foreground")}>{count}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// The order row (WS-04, WS-09)
// ---------------------------------------------------------------------------

function WorkshopRow({ view: v, costView }: { view: OrderView; costView: boolean }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const bits = stateBits(v, t)
  return (
    <li
      onClick={() => ui.openOrder(v.id)}
      className="grid cursor-pointer grid-cols-1 gap-2.5 border-b border-border/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-warning/5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(150px,1fr)_minmax(160px,1fr)_minmax(130px,0.9fr)_minmax(150px,auto)] lg:items-center lg:gap-3"
    >
      <div className="min-w-0 sm:col-span-2 lg:col-span-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            ui.openOrder(v.id)
          }}
          aria-label={t("mfw_ws_open", { order: v.ref, product: v.product.name })}
          className="block max-w-full truncate rounded text-start text-[13px] font-bold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {v.product.name}
        </button>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <bdi dir="ltr" className="font-mono">
            {v.ref}
          </bdi>
          <span aria-hidden="true">·</span>
          <span className="truncate">{sourceNameOf(v, t)}</span>
          <MfgSourceChip view={v} />
          {v.rush && <MfgRushChip />}
        </span>
      </div>
      <MfgQtyCell view={v} />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <MfgStatePill view={v} />
        {bits.length > 0 && <span className="text-[10px] leading-relaxed text-muted-foreground">{bits.join(" · ")}</span>}
      </div>
      <MfgDueCell view={v} />
      <div className="flex sm:col-span-2 lg:col-span-1 lg:justify-end">{costView ? <CostCell view={v} /> : <MfgNextCell view={v} />}</div>
    </li>
  )
}

/** Actual cost, the standard of the work done, and the gap (WS-09, FN-07). */
function CostCell({ view: v }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  if (!v.released) return <span className="text-[11px] font-semibold text-muted-foreground">{t("mfw_ws_not_released")}</span>
  const pct = v.cost.variancePercent
  return (
    <span className="flex flex-col items-start lg:items-end">
      <b className="text-xs">
        <bdi dir="ltr" className="tabular-nums">
          {fmtMoney(v.cost.total)}
        </bdi>{" "}
        <span className="text-[10px] font-semibold text-muted-foreground">{t("mfg4_sar")}</span>
      </b>
      <span className="text-[10px] text-muted-foreground">
        {t("mfw_ws_earned", { value: fmtMoney(v.cost.earnedStandard) })}
        {pct != null && (
          <>
            {" · "}
            <b className={cn("tabular-nums", pct > 5 ? "text-destructive" : pct < -5 ? "text-success" : "text-muted-foreground")} dir="ltr">
              {pct > 0 ? "+" : ""}
              {pct}%
            </b>
          </>
        )}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// The department board (WS-06, WS-07)
// ---------------------------------------------------------------------------

function WorkshopBoard({ list, sta, onSta }: { list: OrderView[]; sta: "mine" | "all"; onSta: (s: "mine" | "all") => void }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, world, views, personas } = ui

  const mine = useMemo(() => {
    const ids = new Set<string>()
    if (personas.includes("lead")) myStations(data.engineActor, data.departments, "lead").forEach((id) => ids.add(id))
    if (personas.includes("qc")) myStations(data.engineActor, data.departments, "qc").forEach((id) => ids.add(id))
    return ids
  }, [personas, data.engineActor, data.departments])

  // A column per station on any product's route (or on a live order's route
  // whose product card has since changed).
  const used = useMemo(() => {
    const ids = new Set([
      ...data.products.filter((p) => !p.archived).flatMap((p) => p.route.filter((r) => !r.onSite).map((r) => r.departmentId)),
      ...views.filter((v) => v.live).flatMap((v) => v.calc.route.map((r) => r.departmentId)),
    ])
    return data.departments.filter((d) => ids.has(d.id))
  }, [views, data.products, data.departments])

  const loads = useMemo(() => new Map(departmentLoads(world, data.departments).map((l) => [l.department.id, l])), [world, data.departments])
  const bnDays = Math.max(1, ...Array.from(loads.values()).map((l) => l.days))
  const cols = mine.size && sta === "mine" ? used.filter((d) => mine.has(d.id)) : used

  return (
    <div className="min-w-0 space-y-3">
      {mine.size > 0 && (
        <MfgSegments<"mine" | "all">
          label={t("mfw_b_scope")}
          value={sta}
          onChange={onSta}
          items={[
            { id: "mine", label: t("mfw_b_mine") },
            { id: "all", label: t("mfw_b_all") },
          ]}
        />
      )}
      {cols.length === 0 ? (
        <MfgPanel>
          <MfgEmpty icon={LayoutGrid} title={t("mfw_b_empty")} />
        </MfgPanel>
      ) : (
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {cols.map((d) => (
            <BoardColumn key={d.id} departmentId={d.id} list={list} wide={mine.has(d.id)} bnDays={bnDays} load={loads.get(d.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function BoardColumn({
  departmentId,
  list,
  wide,
  bnDays,
  load,
}: {
  departmentId: string
  list: OrderView[]
  wide: boolean
  bnDays: number
  load: ReturnType<typeof departmentLoads>[number] | undefined
}) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, world } = ui
  const dept = data.departments.find((x) => x.id === departmentId)
  const gate = stationGate(dept)
  const Icon = departmentIcon(dept?.name)
  const timeOn = data.settings.features.time
  const lost = world.lost.get(departmentId) || 0

  const cards = useMemo(() => {
    const out: Array<{ view: OrderView; index: number }> = []
    for (const v of list) v.calc.route.forEach((r, i) => r.departmentId === departmentId && v.calc.pend[i] > 0 && out.push({ view: v, index: i }))
    return out.sort((a, b) => Number(b.view.rush) - Number(a.view.rush) || (a.view.neededBy || "9999").localeCompare(b.view.neededBy || "9999"))
  }, [list, departmentId])

  const workers = Math.max(1, Number(dept?.workers) || 1)
  const hours = Math.max(1, Number(dept?.hoursPerDay) || 8)

  return (
    <section
      className={cn("flex shrink-0 flex-col overflow-hidden rounded-2xl border bg-muted/30", wide ? "w-72" : "w-64", load?.bottleneck && timeOn && "border-destructive/40")}
      aria-label={dept?.name}
    >
      <header className="space-y-1 border-b bg-white px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
            <Icon size={14} aria-hidden="true" />
          </span>
          <b className="min-w-0 flex-1 truncate text-xs text-foreground">{dept?.name}</b>
          <span className="rounded-full bg-muted px-2 py-px text-[10px] font-bold tabular-nums text-muted-foreground">{cards.length}</span>
        </div>
        {gate ? (
          <p className="text-[10px] text-muted-foreground">{t("mfw_b_order_step")}</p>
        ) : timeOn && load ? (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="shrink-0">
              <bdi dir="ltr" className="tabular-nums">
                {workers}×{hours}={fmtQty(deptCapacity({ workers, hoursPerDay: hours }))}
              </bdi>{" "}
              {t("mfw_b_h_day")}
            </span>
            <MfgLoadBar ratio={load.days / bnDays} tone={load.bottleneck ? "bad" : load.days > 2 ? "warn" : "ok"} />
            <b className="shrink-0 text-foreground">{t("mfg4_days_short", { days: fmtQty(load.days) })}</b>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">{t("mfw_workers", { count: workers })}</p>
        )}
        {load?.department.leadUserName && (
          <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <User size={11} aria-hidden="true" /> {load.department.leadUserName}
          </p>
        )}
        {lost > 0 && (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-destructive">
            <Lock size={11} aria-hidden="true" /> {t("mfw_lost_today", { hours: fmtQty(lost) })}
          </p>
        )}
      </header>
      <ul className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
        {cards.length === 0 ? (
          <li className="px-2 py-4 text-center text-[11px] text-muted-foreground">{t("mfw_b_nothing")}</li>
        ) : (
          cards.map(({ view, index }) => <BoardCard key={`${view.id}_${index}`} view={view} index={index} />)
        )}
      </ul>
    </section>
  )
}

function BoardCard({ view: v, index }: { view: OrderView; index: number }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const words = useCandidateWords()
  const { data } = ui
  const deptId = v.calc.route[index]?.departmentId
  const hard = hardBlocked(v.calc, index)
  const ms = materialState(v.calc, index)
  const action = stationAction(v, index, data.engineActor, data.departments, data.settings)
  const waiting: Candidate | undefined = action
    ? undefined
    : v.candidates.find(
        (c) => c.owner.kind === "external" && ((c.key === "issue_wait" && c.departmentId === deptId) || (c.key === "drawing_wait" && (v.calc.gates[index] === "drawing" || index === v.calc.firstQ)))
      )
  const ActionIcon = action ? CANDIDATE_ICON[action.key] : null

  return (
    <li className={cn("rounded-xl border bg-white p-2.5 shadow-sm", v.late ? "border-destructive/40" : v.rush ? "border-warning/50" : "border-border")}>
      <button
        type="button"
        onClick={() => ui.openOrder(v.id)}
        className="block w-full rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <bdi dir="ltr" className="font-mono">
            {v.ref}
          </bdi>
          {v.rush && (
            <MfgChip tone="warn" icon={Zap}>
              {t("mfg4_rush")}
            </MfgChip>
          )}
        </span>
        <b className="mt-0.5 block text-xs leading-snug text-foreground hover:underline">{v.product.name}</b>
      </button>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="me-1 text-xs font-black text-foreground">
          <bdi dir="ltr" className="tabular-nums">
            {fmtQty(v.calc.pend[index])}
          </bdi>{" "}
          <span className="text-[10px] font-semibold text-muted-foreground">{v.unit}</span>
        </span>
        {hard ? (
          <MfgChip tone="bad" icon={Lock}>
            {t("mfw_b_blocked")}
          </MfgChip>
        ) : (
          ms !== "none" && <MfgChip tone={ms === "complete" ? "ok" : "warn"}>{t(`mfg4_mat_${ms}`)}</MfgChip>
        )}
        <MfgChip tone={v.late ? "bad" : "muted"} icon={CalendarDays}>
          {d.short(v.neededBy)}
        </MfgChip>
      </div>
      {action && ActionIcon ? (
        <Button
          size="sm"
          variant={["output", "qc_release", "gate"].includes(action.key) ? "default" : "outline"}
          className="mt-2 h-9 w-full gap-1.5 text-xs"
          title={words.text(action, v)}
          onClick={() => ui.openCandidate(v.id, action)}
        >
          <ActionIcon size={13} aria-hidden="true" /> {words.button(action, v)}
        </Button>
      ) : waiting && waiting.owner.kind === "external" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <MfgModuleChip module={waiting.owner.module} />
          <span>{t("mfw_b_awaiting_it")}</span>
        </div>
      ) : null}
    </li>
  )
}
