"use client"

// The department board. A card is not a task: it is a quantity in one
// department's hands, and it moves only when that department reports output
// and hands over. Columns run in the workshop's department order, framed by
// what is waiting for release on one side and what is ready to leave (or held
// for a QC decision) on the other.

import { useMemo, useState, type ElementType, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  AppWindow,
  Anvil,
  Boxes,
  CalendarDays,
  ClipboardList,
  Coins,
  Factory,
  FileText,
  FolderKanban,
  Lock,
  Mountain,
  PlayCircle,
  Settings,
  TreePine,
  Truck,
  Users,
  Warehouse,
} from "lucide-react"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import type { MfgDepartment } from "@/lib/manufacturing"
import { deptCapacity, stationBlocks, stationQueueDays, type MfgFamily, type StationMaterialState } from "@/lib/manufacturing-engine"
import { cardsAtDepartment, compareOrders, orderMoney, productionLines, type DepartmentCard, type OrderView } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgRushChip } from "./MfgOrderBits"
import { MfgChip, MfgEmpty, MfgLoadBar, MfgNote, MfgPanel, departmentIcon, fmtMoney, fmtQty, useMfgDate, type MfgTone } from "./ui/MfgUi"

const FAMILY_ICON: Record<MfgFamily, ElementType> = {
  stone: Mountain,
  wood: TreePine,
  aluminium: AppWindow,
  steel: Anvil,
  other: Boxes,
}

/** Card chip for a station's materials — reuses the materials vocabulary
 * where its wording stands on its own outside the materials panel. */
const MATERIAL_LABEL: Record<StationMaterialState, string> = {
  none: "mfg3_floor_mat_none",
  missing: "mfg3_floor_mat_missing",
  requested: "mfg2_mat_requested",
  released: "mfg2_mat_released",
  partial: "mfg2_mat_partial",
  complete: "mfg3_floor_mat_complete",
}

type Translate = ReturnType<typeof useTranslations>

export function MfgFloorBoard() {
  const t = useTranslations("Portal.Shared")
  const { data, perms, views, base, openOrder } = useMfgUi()
  const timeOn = data.settings.features.time
  const [family, setFamily] = useState<MfgFamily | "">("")

  const lines = useMemo(() => productionLines(data.products), [data.products])
  // A family whose last product was removed falls back to every line.
  const line = family ? lines.find((l) => l.family === family) ?? null : null
  const showLines = lines.length >= 2

  const departments = useMemo(
    () => (line ? data.departments.filter((d) => line.departmentIds.includes(d.id)) : data.departments),
    [data.departments, line]
  )
  const lineViews = useMemo(() => (line ? views.filter((v) => v.product.family === line.family) : views), [views, line])

  // Queue days per visible department; the bottleneck is the longest queue on
  // the line being looked at (the whole workshop when no line is picked).
  const queue = useMemo(() => {
    const days = new Map<string, number>()
    let bottleneckId: string | null = null
    let max = 0
    if (timeOn) {
      for (const d of departments) {
        const q = stationQueueDays(data.scheduleInputs, d)
        days.set(d.id, q)
        if (q > max) {
          max = q
          bottleneckId = d.id
        }
      }
    }
    return { days, bottleneckId, max }
  }, [timeOn, departments, data.scheduleInputs])

  const columns = useMemo(() => {
    const awaitingRelease = lineViews.filter((v) => v.live && !v.released).sort(compareOrders)
    const ready = lineViews.filter((v) => !v.cancelled && v.ready > 0).sort(compareOrders)
    const held = lineViews.filter((v) => v.live && v.rejected > 0).sort(compareOrders)
    const byDepartment = new Map(departments.map((d) => [d.id, cardsAtDepartment(lineViews, d.id)]))
    return { awaitingRelease, ready, held, byDepartment }
  }, [lineViews, departments])

  const idleValue = useMemo(() => {
    if (!perms.seesMoney) return 0
    return columns.ready.reduce((sum, v) => sum + (orderMoney(v, data.departments, data.settings).total / Math.max(1, v.quantity)) * v.ready, 0)
  }, [perms.seesMoney, columns.ready, data.departments, data.settings])

  if (!data.ready) {
    return (
      <div className="flex gap-3 overflow-hidden" role="status" aria-busy="true">
        <span className="sr-only">{t("mfg3_floor_loading")}</span>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-72 w-64 shrink-0 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />
        ))}
      </div>
    )
  }

  if (!data.departments.length) {
    return (
      <MfgPanel>
        <MfgEmpty
          icon={Factory}
          title={t("mfg3_floor_no_departments")}
          hint={perms.canManage ? t("mfg3_floor_no_departments_hint_manage") : t("mfg3_floor_no_departments_hint")}
        />
        {perms.canManage && (
          <div className="-mt-6 flex justify-center pb-8">
            <Link
              href={`${base}/settings`}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-10"
            >
              <Settings size={15} aria-hidden="true" />
              {t("mfg3_floor_open_settings")}
            </Link>
          </div>
        )}
      </MfgPanel>
    )
  }

  const liveCount = (fam: MfgFamily | null) => views.filter((v) => v.live && (!fam || v.product.family === fam)).length
  const knownDepartments = new Set(data.departments.map((d) => d.id))

  return (
    <div className="min-w-0 space-y-3">
      {showLines && (
        <div role="group" aria-label={t("mfg3_floor_lines_label")} className="flex flex-wrap gap-2">
          {[
            { key: "" as const, label: t("mfg3_floor_all_lines"), icon: Factory, depts: data.departments.length, orders: liveCount(null) },
            ...lines.map((l) => ({
              key: l.family,
              label: t(`mfg2_family_${l.family}`),
              icon: FAMILY_ICON[l.family] || Boxes,
              depts: l.departmentIds.filter((id) => knownDepartments.has(id)).length,
              orders: liveCount(l.family),
            })),
          ].map((chip) => {
            const on = (line?.family ?? "") === chip.key
            const Icon = chip.icon
            return (
              <button
                key={chip.key || "all"}
                type="button"
                aria-pressed={on}
                onClick={() => setFamily(chip.key)}
                className={cn(
                  "flex min-h-11 flex-col items-start justify-center rounded-xl border bg-card px-3 py-1.5 text-start transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  on ? "border-warning bg-warning/5" : "hover:border-warning/40"
                )}
              >
                <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                  <Icon size={14} className={on ? "text-warning" : "text-muted-foreground"} aria-hidden="true" />
                  {chip.label}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground">
                  {t("mfg3_floor_line_depts", { count: chip.depts })} · {t("mfg3_floor_line_orders", { count: chip.orders })}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <MfgNote tone="info">{t("mfg3_floor_board_note")}</MfgNote>

      <div
        role="region"
        aria-label={t("mfg3_floor_seg_board")}
        tabIndex={0}
        className="flex items-start gap-3 overflow-x-auto rounded-2xl pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FloorColumn
          icon={PlayCircle}
          title={t("mfg3_state_awaiting_release")}
          count={columns.awaitingRelease.length}
          note={
            <>
              <ClipboardList size={12} className="shrink-0" aria-hidden="true" />
              {t("mfg3_floor_no_capacity")}
            </>
          }
        >
          {columns.awaitingRelease.map((v) => (
            <FloorCard key={v.id} view={v} onOpen={openOrder}>
              <ReleaseChip view={v} t={t} />
              <Qty value={v.quantity} unit={v.unit} />
            </FloorCard>
          ))}
        </FloorColumn>

        {departments.map((dept) => {
          const cards = columns.byDepartment.get(dept.id) || []
          const isBottleneck = timeOn && queue.bottleneckId === dept.id
          return (
            <FloorColumn
              key={dept.id}
              icon={departmentIcon(dept.name, dept.onSite)}
              title={dept.name}
              count={cards.length}
              hot={isBottleneck}
              badge={isBottleneck ? <MfgChip tone="bad">{t("mfg2_bottleneck_badge")}</MfgChip> : null}
              note={<CapacityLine dept={dept} timeOn={timeOn} days={queue.days.get(dept.id) ?? 0} max={queue.max} isBottleneck={isBottleneck} t={t} />}
            >
              {cards.map((card) => (
                <FloorCard key={`${card.view.id}_${card.index}`} view={card.view} onOpen={openOrder}>
                  <Qty value={card.inHand} unit={card.view.unit} />
                  <StationChip card={card} t={t} />
                </FloorCard>
              ))}
            </FloorColumn>
          )
        })}

        <FloorColumn
          icon={Truck}
          title={t("mfg3_kpi_ready")}
          count={columns.ready.length}
          note={
            perms.seesMoney ? (
              <span className="flex items-center gap-1.5" title={t("mfg3_floor_idle_hint")}>
                <Coins size={12} className="shrink-0" aria-hidden="true" />
                {t("mfg3_floor_idle_value", { value: fmtMoney(idleValue) })}
              </span>
            ) : (
              <>
                <Truck size={12} className="shrink-0" aria-hidden="true" />
                {t("mfg3_floor_awaiting_shipment")}
              </>
            )
          }
        >
          {columns.ready.map((v) => (
            <FloorCard key={v.id} view={v} onOpen={openOrder}>
              <Qty value={v.ready} unit={v.unit} />
              <MfgChip tone="ok">{t("mfg3_floor_chip_inspected")}</MfgChip>
            </FloorCard>
          ))}
        </FloorColumn>

        {columns.held.length > 0 && (
          <FloorColumn
            icon={AlertTriangle}
            title={t("mfg3_state_awaiting_qc")}
            count={columns.held.length}
            note={
              <>
                <ClipboardList size={12} className="shrink-0" aria-hidden="true" />
                {t("mfg3_floor_qc_note")}
              </>
            }
          >
            {columns.held.map((v) => (
              <FloorCard key={v.id} view={v} onOpen={openOrder}>
                <Qty value={v.rejected} unit={v.unit} />
                <MfgChip tone="warn">{t("mfg3_floor_chip_rejected")}</MfgChip>
              </FloorCard>
            ))}
          </FloorColumn>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function FloorColumn({
  icon: Icon,
  title,
  count,
  note,
  hot,
  badge,
  children,
}: {
  icon: ElementType
  title: string
  count: number
  note?: ReactNode
  hot?: boolean
  badge?: ReactNode
  children: ReactNode
}) {
  const t = useTranslations("Portal.Shared")
  return (
    <section className={cn("flex w-64 shrink-0 flex-col overflow-hidden rounded-2xl border bg-muted/40", hot && "border-warning/40 bg-warning/5")}>
      <header className="border-b bg-card px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
            <Icon size={14} aria-hidden="true" />
          </span>
          <h3 className="line-clamp-2 min-w-0 flex-1 text-xs font-bold leading-snug text-foreground" dir="auto">
            {title}
          </h3>
          {badge}
          <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[10px] font-bold tabular-nums text-secondary">{count}</span>
        </div>
        {note && <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">{note}</div>}
      </header>
      {count > 0 ? (
        <ul role="list" className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-2">
          {children}
        </ul>
      ) : (
        <p className="px-3 py-5 text-center text-[11px] text-muted-foreground">{t("mfg3_floor_col_empty")}</p>
      )}
    </section>
  )
}

function FloorCard({ view, onOpen, children }: { view: OrderView; onOpen: (orderId: string) => void; children: ReactNode }) {
  const t = useTranslations("Portal.Shared")
  const d = useMfgDate()
  const SourceIcon = view.sourceKind === "project" ? FolderKanban : view.sourceKind === "quotation" ? FileText : Warehouse
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(view.id)}
        className={cn(
          "block min-h-11 w-full rounded-xl border bg-card px-3 py-2.5 text-start shadow-sm transition",
          "hover:border-warning/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          view.late ? "border-s-4 border-s-destructive hover:border-s-destructive" : view.rush && "border-s-4 border-s-warning hover:border-s-warning"
        )}
      >
        <span className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
          <SourceIcon size={11} className="shrink-0" aria-hidden="true" />
          <span className="sr-only">{t(`mfg3_source_${view.sourceKind}`)}</span>
          <span dir="ltr" className="tabular-nums text-secondary">
            #{view.number}
          </span>
          {view.rush && <MfgRushChip />}
        </span>
        <span className="mt-1 line-clamp-2 text-xs font-semibold leading-snug text-foreground" dir="auto">
          {view.product.name}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {children}
          <MfgChip tone={view.late ? "bad" : "muted"} icon={CalendarDays}>
            <span className="sr-only">{t("mfg3_floor_due")}</span>
            {d.short(view.neededBy)}
            {view.late && <span className="sr-only">{t("mfg3_floor_late")}</span>}
          </MfgChip>
        </span>
      </button>
    </li>
  )
}

function Qty({ value, unit }: { value: number; unit: string }) {
  return (
    <span className="text-[11px] font-bold tabular-nums text-foreground">
      {fmtQty(value)}{" "}
      <span className="font-semibold text-muted-foreground" dir="auto">
        {unit}
      </span>
    </span>
  )
}

function ReleaseChip({ view, t }: { view: OrderView; t: Translate }) {
  const blocked = view.releaseBlocks.length > 0
  return (
    <span title={blocked ? view.releaseBlocks.map((b) => t(`mfg2_block_${b.key}`)).join(" · ") : undefined}>
      <MfgChip tone={blocked ? "bad" : "info"} icon={blocked ? Lock : undefined}>
        {blocked ? t("mfg3_floor_chip_blocked") : t("mfg3_floor_chip_release_ready")}
      </MfgChip>
    </span>
  )
}

function StationChip({ card, t }: { card: DepartmentCard; t: Translate }) {
  if (card.hardBlocked) {
    const reasons = stationBlocks(card.view.slice, card.view.product, card.view.product.route, card.index)
      .filter((b) => b.severity === "hard")
      .map((b) => t(`mfg2_block_${b.key}`))
      .join(" · ")
    return (
      <span title={reasons || undefined}>
        <MfgChip tone="bad" icon={Lock}>
          {t("mfg3_blocked")}
        </MfgChip>
      </span>
    )
  }
  const tone: MfgTone = card.materialState === "complete" || card.materialState === "none" ? "ok" : "warn"
  return <MfgChip tone={tone}>{t(MATERIAL_LABEL[card.materialState])}</MfgChip>
}

function CapacityLine({
  dept,
  timeOn,
  days,
  max,
  isBottleneck,
  t,
}: {
  dept: MfgDepartment
  timeOn: boolean
  days: number
  max: number
  isBottleneck: boolean
  t: Translate
}) {
  const workers = Math.max(1, Number(dept.workers) || 1)
  if (!timeOn) {
    return (
      <>
        <Users size={12} className="shrink-0" aria-hidden="true" />
        {t("mfg3_floor_workers", { count: workers })}
      </>
    )
  }
  const hours = Math.max(1, Number(dept.hoursPerDay) || 8)
  const tone = isBottleneck ? "bad" : days > 2 ? "warn" : "ok"
  return (
    <span className="flex w-full items-center gap-2" title={t("mfg2_set_capacity_hint")}>
      <span className="shrink-0">
        <bdi dir="ltr" className="tabular-nums">
          {workers}×{hours}={deptCapacity(dept)}
        </bdi>{" "}
        {t("mfg3_floor_hours_day")}
      </span>
      <MfgLoadBar ratio={days / Math.max(1, max)} tone={tone} />
      <span className={cn("shrink-0 font-bold", isBottleneck ? "text-destructive" : "text-secondary")}>
        <span className="sr-only">{t("mfg3_floor_queue")} </span>
        {t("mfg3_floor_days", { days })}
      </span>
    </span>
  )
}
