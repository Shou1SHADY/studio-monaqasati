"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Factory,
  Warehouse,
  ClipboardList,
  CheckCircle2,
  CircleDot,
  Circle,
  PackageCheck,
  Truck,
  ZoomIn,
  ZoomOut,
  Maximize,
  Move,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { WorkOrder } from "@/lib/manufacturing"
import {
  buildManufacturingMindMap,
  layoutMindMap,
  DEFAULT_MINDMAP_LAYOUT,
  type MindMapLabels,
  type MindMapWarehouse,
  type PositionedNode,
} from "@/lib/manufacturing-mindmap"

const MIN_SCALE = 0.35
const MAX_SCALE = 2
const PADDING = 24
const DRAG_THRESHOLD = 4

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The manufacturing workflow drawn as a mind map: every work order fans out
 * from the warehouse it drew stock from, then runs as a chain through its
 * department stages to the finished output and wherever that output landed.
 * Drag to pan, Ctrl + wheel (or the buttons) to zoom; clicking any node of a
 * chain opens that order.
 */
export function ManufacturingMindMap({
  orders,
  warehouses,
  onSelectOrder,
}: {
  orders: WorkOrder[]
  warehouses: MindMapWarehouse[]
  onSelectOrder: (orderId: string) => void
}) {
  const t = useTranslations("Portal.Shared")
  const isRtl = useLocale() === "ar"

  const labels = useMemo<MindMapLabels>(
    () => ({
      root: t("mfg_page_title"),
      rootSub: (count) => t("mfg_map_root_sub", { count }),
      noSource: t("mfg_map_no_source"),
      noSourceHint: t("mfg_map_no_source_hint"),
      centralTag: t("mfg_map_central_tag"),
      projectTag: t("mfg_wh_project_tag"),
      outboundTag: t("mfg_map_outbound_tag"),
      unassigned: t("mfg_unassigned"),
      statusOpen: t("mfg_status_open"),
      statusDone: t("mfg_status_done"),
      statusCancelled: t("mfg_status_cancelled"),
      destinationPending: t("mfg_map_dest_pending"),
      destinationOpen: t("mfg_map_dest_open"),
      delivered: t("mfg_map_delivered"),
    }),
    [t]
  )

  const layout = useMemo(
    () => layoutMindMap(buildManufacturingMindMap(orders, warehouses, labels)),
    [orders, warehouses, labels]
  )
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.node.id, n])), [layout])

  // The tree is laid out LTR; in Arabic the root belongs on the right, so
  // every x is mirrored inside the tree's own width.
  const left = useCallback(
    (n: PositionedNode) => (isRtl ? layout.width - n.x - n.width : n.x),
    [isRtl, layout.width]
  )

  // ── Pan & zoom ──
  // The canvas is not mounted while there are no orders, so the effects below
  // key on `isEmpty` to re-run once it appears.
  const isEmpty = orders.length === 0
  const containerRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: PADDING, y: PADDING, scale: 1 })

  const fit = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const cw = el.clientWidth
    const scale = clamp((cw - PADDING * 2) / layout.width, MIN_SCALE, 1)
    setView({ x: isRtl ? cw - PADDING - layout.width * scale : PADDING, y: PADDING, scale })
  }, [layout.width, isRtl])

  // Refit when the tree's footprint changes (an order created or removed),
  // not on every stage hand-off — those keep the user's pan and zoom.
  useLayoutEffect(() => {
    fit()
  }, [fit, layout.height, isEmpty])

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = containerRef.current
    if (!el) return
    const px = cx ?? el.clientWidth / 2
    const py = cy ?? el.clientHeight / 2
    setView((v) => {
      const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
      const k = scale / v.scale
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        zoomBy(e.deltaY < 0 ? 1.12 : 0.9, e.clientX - rect.left, e.clientY - rect.top)
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomBy, isEmpty])

  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: view.x, originY: view.y, moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      // Only capture once it is clearly a drag — capturing on pointerdown
      // would swallow the click that opens a node.
      d.moved = true
      suppressClick.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setView((v) => ({ ...v, x: d.originX + dx, y: d.originY + dy }))
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (d.moved && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    drag.current = null
    // Let the click that follows this pointerup see the flag, then clear it.
    setTimeout(() => { suppressClick.current = false }, 0)
  }

  const handleSelect = (orderId: string) => {
    if (suppressClick.current) return
    onSelectOrder(orderId)
  }

  if (isEmpty) {
    return (
      <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
        <PackageCheck size={36} className="mx-auto mb-2 opacity-20" />
        <p className="text-sm">{t("mfg_empty_orders")}</p>
      </div>
    )
  }

  const gap = DEFAULT_MINDMAP_LAYOUT.hGap / 2
  const dir = isRtl ? -1 : 1

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative h-[60vh] min-h-[400px] overflow-hidden rounded-2xl border bg-slate-50/70 select-none touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="absolute top-0 left-0 origin-top-left will-change-transform"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, width: layout.width, height: layout.height }}
        >
          <svg
            className="absolute inset-0 overflow-visible pointer-events-none"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {layout.edges.map((edge) => {
              const from = byId.get(edge.from)
              const to = byId.get(edge.to)
              if (!from || !to) return null
              const sx = isRtl ? left(from) : left(from) + from.width
              const sy = from.y + from.height / 2
              const ex = isRtl ? left(to) + to.width : left(to)
              const ey = to.y + to.height / 2
              const tone = to.node.tone
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={`M ${sx} ${sy} C ${sx + dir * gap} ${sy}, ${ex - dir * gap} ${ey}, ${ex} ${ey}`}
                  fill="none"
                  strokeWidth={tone === "active" ? 2 : 1.5}
                  strokeDasharray={tone === "pending" || tone === "muted" ? "4 4" : undefined}
                  className={cn(
                    tone === "active" ? "stroke-cta" : tone === "done" ? "stroke-success/50" : "stroke-slate-300"
                  )}
                />
              )
            })}
          </svg>
          {layout.nodes.map((n) => (
            <MindMapCard key={n.node.id} positioned={n} left={left(n)} onSelect={handleSelect} />
          ))}
        </div>

        <div className="absolute top-3 end-3 flex items-center gap-1 rounded-lg border bg-white p-1 shadow-sm">
          <MapControl label={t("mfg_map_zoom_in")} onClick={() => zoomBy(1.2)}><ZoomIn size={15} /></MapControl>
          <MapControl label={t("mfg_map_zoom_out")} onClick={() => zoomBy(1 / 1.2)}><ZoomOut size={15} /></MapControl>
          <MapControl label={t("mfg_map_fit")} onClick={fit}><Maximize size={15} /></MapControl>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap text-[11px] text-muted-foreground px-1">
        <div className="flex items-center gap-4">
          <LegendDot className="bg-success" label={t("mfg_map_legend_done")} />
          <LegendDot className="bg-cta" label={t("mfg_map_legend_active")} />
          <LegendDot className="bg-slate-300" label={t("mfg_map_legend_pending")} />
          <LegendDot className="bg-warning" label={t("mfg_map_dest_pending")} />
        </div>
        <p className="flex items-center gap-1.5">
          <Move size={12} aria-hidden="true" />
          {t("mfg_map_hint")}
        </p>
      </div>
    </div>
  )
}

function MapControl({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full shrink-0", className)} aria-hidden="true" />
      {label}
    </span>
  )
}

function MindMapCard({
  positioned,
  left,
  onSelect,
}: {
  positioned: PositionedNode
  left: number
  onSelect: (orderId: string) => void
}) {
  const { node, y, width, height } = positioned
  const clickable = !!node.orderId

  const surface = (() => {
    switch (node.kind) {
      case "root":
        return "bg-primary text-white border-primary shadow-md"
      case "source":
        return node.tone === "warning" ? "bg-warning/5 border-warning/40" : "bg-white border-slate-200"
      case "order":
        return cn(
          "bg-white",
          node.tone === "active" ? "border-cta/50" : node.tone === "done" ? "border-success/40" : "border-slate-200 opacity-70"
        )
      case "stage":
        return node.tone === "done"
          ? "bg-success/5 border-success/40"
          : node.tone === "active"
            ? "bg-cta/5 border-cta ring-2 ring-cta/20"
            : "bg-white border-dashed border-slate-300"
      case "output":
        return node.tone === "done" ? "bg-success/5 border-success/40" : "bg-white border-dashed border-slate-300"
      case "destination":
        return node.tone === "done"
          ? "bg-success/10 border-success/40"
          : node.tone === "warning"
            ? "bg-warning/10 border-warning/40"
            : "bg-white border-dashed border-slate-300"
    }
  })()

  const sublabelClass =
    node.kind === "root"
      ? "text-white/75"
      : node.kind === "order"
        ? node.tone === "active" ? "text-cta" : node.tone === "done" ? "text-success" : "text-muted-foreground"
        : node.kind === "destination" && node.tone === "warning"
          ? "text-warning"
          : "text-muted-foreground"

  const icon = (() => {
    const cls = "shrink-0"
    switch (node.kind) {
      case "root":
        return <Factory size={18} className={cls} aria-hidden="true" />
      case "source":
        return <Warehouse size={16} className={cn(cls, node.tone === "warning" ? "text-warning" : "text-cta")} aria-hidden="true" />
      case "order":
        return <ClipboardList size={16} className={cn(cls, "text-primary")} aria-hidden="true" />
      case "stage":
        return node.tone === "done" ? (
          <CheckCircle2 size={16} className={cn(cls, "text-success")} aria-hidden="true" />
        ) : node.tone === "active" ? (
          <CircleDot size={16} className={cn(cls, "text-cta")} aria-hidden="true" />
        ) : (
          <Circle size={16} className={cn(cls, "text-slate-300")} aria-hidden="true" />
        )
      case "output":
        return <PackageCheck size={16} className={cn(cls, node.tone === "done" ? "text-success" : "text-slate-400")} aria-hidden="true" />
      case "destination":
        return (
          <Truck
            size={16}
            className={cn(cls, node.tone === "done" ? "text-success" : node.tone === "warning" ? "text-warning" : "text-slate-400")}
            aria-hidden="true"
          />
        )
    }
  })()

  const className = cn(
    "absolute flex items-center gap-2.5 rounded-xl border px-3 text-start shadow-sm transition-colors",
    surface,
    clickable && "cursor-pointer hover:shadow-md hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  )
  const style = { left, top: y, width, height }
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold leading-snug" dir="auto">{node.label}</span>
        {node.sublabel && (
          <span className={cn("block truncate text-[11px] leading-snug", sublabelClass)} dir="auto">{node.sublabel}</span>
        )}
      </span>
    </>
  )

  if (clickable) {
    return (
      <button type="button" className={className} style={style} title={node.label} onClick={() => onSelect(node.orderId as string)}>
        {body}
      </button>
    )
  }
  return (
    <div className={className} style={style} title={node.label}>
      {body}
    </div>
  )
}
