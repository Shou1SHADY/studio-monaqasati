"use client"

// A project's workshop orders, as Projects sees them (mfg.work_order.status is
// read here; nothing is decided for Manufacturing). What IS the project's to
// do sits on top:
//   · shop drawings awaiting the submittals register's A/B/C (T8, FL-07)
//   · delivery notes to receive into project custody, with breakage (T19)
//   · a quantity change or cancellation request for a live order (T20, D12)
// and, read-only, the purchases Manufacturing asked Procurement for.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  ExternalLink,
  Factory,
  FilePen,
  FileText,
  FolderKanban,
  Loader2,
  PencilRuler,
  ShoppingCart,
  Zap,
} from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { usePermissions } from "@/hooks/usePermissions"
import { useMfgFacts, type MfgFactsDepartment } from "@/hooks/useMfgFacts"
import { cn } from "@/lib/utils"
import { hardBlocked } from "@/lib/manufacturing-engine"
import { buildWorld, type OrderView } from "@/lib/manufacturing-view"
import { noteEscalated, noteHoursOut, noteOrderRef, type MfgDeliveryNote } from "@/lib/mfg-outside"
import { MfgPill, MfgQtyBar, useMfgDate, type MfgTone } from "@/components/manufacturing/ui/MfgUi"
import { MfgNoteReceiptDialog } from "@/components/inventory/MfgNoteReceiptDialog"
import { NoteShipmentFacts, ageText, useNowMs } from "@/components/inventory/MfgOutsideBits"
import { ProjectDrawingResultDialog, type DrawingTarget } from "./ProjectDrawingResultDialog"
import { ProjectOrderChangeDialog } from "./ProjectOrderChangeDialog"

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })
const WORKSHOP = "/contractor/manufacturing/workshop"

type T = ReturnType<typeof useTranslations>

const STAGE_TONE: Record<OrderView["stage"], MfgTone> = { pay: "bad", wait: "muted", prod: "mfg", close: "warn", ready: "accent", transit: "info", done: "ok", cancel: "muted" }

/** The order's primary state in the workshop's own words (the mfg4_ vocabulary
 * Manufacturing's order bits use), without pulling the Manufacturing screens
 * into the project page. */
function orderState(v: OrderView, departments: MfgFactsDepartment[], t: T): { label: string; tone: MfgTone } {
  const c = v.calc
  const deptOf = (i: number) => departments.find((d) => d.id === c.route[i]?.departmentId)?.name || c.route[i]?.departmentName || ""
  switch (v.stage) {
    case "wait":
      return v.releaseBlocks.some((b) => b.key === "survey") ? { label: t("mfg4_sub_blocked_survey"), tone: "bad" } : { label: t("mfg4_stage_wait"), tone: "muted" }
    case "prod": {
      const i = c.current
      if (i >= 0) {
        const g = c.gates[i]
        if (g === "drawing") return c.drawingState === "wait" ? { label: t("mfg4_sub_drawing_at_approval"), tone: "warn" } : { label: t("mfg4_sub_in_design"), tone: "mfg" }
        if (g === "slab") return { label: t("mfg4_sub_awaiting_slab"), tone: "warn" }
        if (g === "manual") return { label: t("mfg4_sub_at_step", { dept: deptOf(i) }), tone: "mfg" }
        return { label: t("mfg4_sub_at_station", { dept: deptOf(i), qty: fmt(c.pend[i]), unit: v.unit }), tone: hardBlocked(c, i) ? "bad" : "mfg" }
      }
      if (c.rejected > 0) return { label: t("mfg4_sub_awaiting_qc"), tone: "warn" }
      if (c.scrapPending > 0 || c.scrapReturned > 0) return { label: t("mfg4_sub_scrap_pending"), tone: "bad" }
      return { label: t("mfg4_sub_scrap_decision"), tone: "bad" }
    }
    case "transit": {
      const n = v.notes.find((x) => x.status === "in_transit")
      return n ? { label: t("mfg4_sub_on_note", { note: n.noteNumber }), tone: "info" } : { label: t("mfg4_sub_breakage"), tone: "bad" }
    }
    default:
      return { label: t(`mfg4_stage_${v.stage}`), tone: STAGE_TONE[v.stage] }
  }
}

/** Delivered of target, and where the rest is, as one bar. */
function QtyCell({ view, t }: { view: OrderView; t: T }) {
  const c = view.calc
  return (
    <div className="flex min-w-[140px] flex-col gap-1">
      <span className="text-xs font-bold text-foreground">
        <span dir="ltr" className="tabular-nums">{fmt(c.delivered)}</span>{" "}
        <span className="text-[11px] font-semibold text-muted-foreground">{t("mfg4_of_target", { target: fmt(c.target), unit: view.unit })}</span>
      </span>
      <MfgQtyBar
        total={view.quantity}
        label={t("mfg3_qty_bar_label")}
        segments={[
          { key: "delivered", value: c.delivered },
          { key: "transit", value: c.shipped },
          { key: "ready", value: c.ready + c.toClose },
          { key: "wip", value: c.wip },
          { key: "held", value: c.rejected },
          { key: "scrap", value: c.scrapAll },
        ]}
      />
      {c.slice.shortfall > 0 && <span className="text-[10px] font-semibold text-destructive">{t("mfg4_short_declared", { qty: fmt(c.slice.shortfall) })}</span>}
    </div>
  )
}

export function ProjectWorkshopPanel({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const d = useMfgDate()
  const nowMs = useNowMs()
  const { can } = usePermissions(projectId)
  const canEdit = can("projects.edit")
  const seesWorkshop = can("manufacturing.manage") || can("manufacturing.work") || can("manufacturing.qc") || can("manufacturing.cost") || can("manufacturing.view")
  const facts = useMfgFacts({ projectId, orders: true, notes: true, notices: true })
  const link = (orderId: string) => `${WORKSHOP}?order=${orderId}`

  // The engine's view of this project's orders. Dates here are the required
  // date only: a possible date needs the whole workshop's queue, which is
  // Manufacturing's to compute — so time is left out of this read.
  const views = useMemo(() => {
    const world = buildWorld({
      today: d.today,
      nowMs,
      settings: { ...facts.settings, features: { ...facts.settings.features, time: false } },
      departments: facts.departments,
      products: facts.productById,
      orders: facts.orders,
      notesByOrder: facts.notesByOrder,
      salesOrders: new Map(),
      stops: [],
      notices: facts.notices,
      stock: null,
    })
    return world.views.slice().sort((a, b) => Number(b.live) - Number(a.live) || (a.neededBy || "9999").localeCompare(b.neededBy || "9999") || b.number - a.number)
  }, [facts.settings, facts.departments, facts.productById, facts.orders, facts.notesByOrder, facts.notices, d.today, nowMs])

  const drawings = views.filter((v) => {
    const dr = v.order.drawing
    return v.live && !!dr?.submittedAt && !dr.code && (dr.approverOrg === "technical_office" || dr.approverOrg === "consultant")
  })
  const orderIds = useMemo(() => new Set(facts.orders.map((o) => o.id)), [facts.orders])
  const toReceive = facts.notes.filter((n) => n.status === "in_transit" && n.toKind === "project" && (n.toProjectId === projectId || orderIds.has(n.source.workOrderId)))

  const [drawingTarget, setDrawingTarget] = useState<DrawingTarget | null>(null)
  const [changeTarget, setChangeTarget] = useState<OrderView | null>(null)
  const [receiveTarget, setReceiveTarget] = useState<MfgDeliveryNote | null>(null)

  if (!facts.ready) {
    return (
      <div className="flex items-center justify-center rounded-2xl border bg-white p-10">
        <Loader2 size={24} className="animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  const escalationHours = facts.settings.noteEscalationHours

  return (
    <section className="space-y-5" dir={isRtl ? "rtl" : "ltr"} aria-labelledby="mfx-prj-title">
      <header className="flex flex-col gap-1">
        <h2 id="mfx-prj-title" className="flex items-center gap-2 text-sm font-black text-foreground">
          <Factory size={17} className="shrink-0 text-cta" aria-hidden="true" />
          {t("mfx_prj_title")}
          <span className="text-xs font-bold tabular-nums text-muted-foreground">{views.length}</span>
        </h2>
        <p className="text-xs text-muted-foreground">{t("mfx_prj_desc", { project: projectName })}</p>
      </header>

      {/* Shop drawings awaiting the submittals register */}
      {drawings.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-cta/25 bg-cta/5 p-4">
          <h3 className="flex items-center gap-2 text-xs font-black text-cta">
            <PencilRuler size={14} aria-hidden="true" />
            {t("mfx_prj_drawings_title", { count: drawings.length })}
          </h3>
          <ul className="space-y-2">
            {drawings.map((v) => {
              const dr = v.order.drawing!
              const hours = noteHoursOut({ sentAt: dr.submittedAt || "" }, nowMs)
              return (
                <li key={v.id} className="flex flex-col gap-3 rounded-xl border bg-white p-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-foreground" dir="ltr">{v.ref}</span>
                      <span className="text-sm font-bold text-foreground" dir="auto">{v.product.name}</span>
                      <span className="rounded-md bg-muted px-1.5 py-px text-[10px] font-bold text-slate-600">{t(`mfx_prj_approver_${dr.approverOrg}`)}</span>
                      <span className="rounded-md bg-muted px-1.5 py-px text-[10px] font-bold text-slate-600" dir="ltr">
                        {t("mfx_prj_rev", { rev: dr.revision })}
                      </span>
                    </div>
                    <p className={cn("text-xs", hours > 72 ? "font-semibold text-warning" : "text-muted-foreground")}>
                      {t("mfx_prj_submitted_line", { name: dr.submittedBy || "—", age: ageText(t, hours) })}
                    </p>
                    {dr.note && <p className="text-xs text-slate-700" dir="auto">{dr.note}</p>}
                    <div className="flex flex-wrap items-center gap-3 text-[11px]">
                      {dr.fileUrl && (
                        <a
                          href={dr.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-sm font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <FileText size={12} aria-hidden="true" />
                          {dr.fileName || t("mfx_prj_open_drawing")}
                        </a>
                      )}
                      {(dr.cutList?.length || 0) > 0 && <span className="text-muted-foreground">{t("mfx_prj_cut_pieces", { count: dr.cutList?.length || 0 })}</span>}
                      {dr.previousC && <span className="text-destructive" dir="auto">{t("mfx_prj_previous_c", { notes: dr.previousC })}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <Button size="sm" className="h-10 shrink-0 gap-1.5" onClick={() => setDrawingTarget({ order: v.order, orderRef: v.ref, productName: v.product.name })}>
                      <PencilRuler size={14} aria-hidden="true" />
                      {t("mfx_prj_drawing_record_btn")}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Delivery notes to receive into project custody */}
      {toReceive.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-success/25 bg-success/5 p-4">
          <h3 className="flex items-center gap-2 text-xs font-black text-success">
            <ClipboardCheck size={14} aria-hidden="true" />
            {t("mfx_prj_receive_title", { count: toReceive.length })}
          </h3>
          <ul className="space-y-2">
            {toReceive.map((n) => {
              const escalated = noteEscalated(n, nowMs, escalationHours)
              return (
                <li key={n.id} className={cn("flex flex-col gap-3 rounded-xl border bg-white p-3 sm:flex-row sm:items-center", escalated && "border-destructive/40")}>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-foreground" dir="ltr">{n.noteNumber}</span>
                      <span className="text-sm font-bold text-foreground" dir="auto">{n.item.name}</span>
                      <span className="text-xs font-bold tabular-nums text-cta" dir="ltr">{fmt(n.item.quantity)} {n.item.unit}</span>
                      <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">{noteOrderRef(n)}</span>
                      {escalated && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-destructive">
                          <AlertTriangle size={11} aria-hidden="true" />
                          {t("mfx_dn_escalated", { hours: escalationHours })}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{t("mfx_prj_note_sent", { name: n.sentByUserName, age: ageText(t, noteHoursOut(n, nowMs)), warehouse: n.toWarehouseName })}</p>
                    <NoteShipmentFacts note={n} />
                  </div>
                  {canEdit && (
                    <Button size="sm" className="h-10 shrink-0 gap-1.5 bg-success text-white hover:bg-success/90" onClick={() => setReceiveTarget(n)}>
                      <ClipboardCheck size={14} aria-hidden="true" />
                      {t("mfx_dn_receive_custody_btn")}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* The project's orders, read from Manufacturing */}
      {views.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-center text-xs text-muted-foreground">{t("mfx_prj_empty")}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {views.map((v) => {
            const s = orderState(v, facts.departments, t)
            const change = v.order.changeRequest
            const purchases = v.calc.slice.purchaseRequests.filter((p) => p.state === "sent")
            return (
              <li key={v.id} className={cn("flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center", !v.live && "bg-muted/20")}>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-foreground" dir="ltr">{v.ref}</span>
                    <span className="text-sm font-bold text-foreground" dir="auto">{v.product.name}</span>
                    <MfgPill tone={s.tone} dot>
                      {s.label}
                    </MfgPill>
                    {v.rush && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-px text-[10px] font-bold text-warning">
                        <Zap size={10} aria-hidden="true" />
                        {t("mfg4_rush")}
                      </span>
                    )}
                  </div>
                  {(v.order.costItemName || v.order.pmRequestRef || v.order.purchaseRequestRef) && (
                    <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <FolderKanban size={11} aria-hidden="true" />
                      {[v.order.costItemName, v.order.pmRequestRef, v.order.purchaseRequestRef].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {change && (
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-cta">
                      <FilePen size={12} aria-hidden="true" />
                      {change.kind === "cancel"
                        ? t("mfx_prj_change_pending_cancel", { name: change.by })
                        : t("mfx_prj_change_pending_qty", { qty: fmt(change.newQuantity || 0), unit: v.unit, name: change.by })}
                      <span className="font-normal text-muted-foreground" dir="auto">— {change.reason}</span>
                    </p>
                  )}
                  {purchases.map((p) => (
                    <p key={p.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <ShoppingCart size={11} aria-hidden="true" />
                      {t("mfg4_c_purchase_wait", { qty: fmt(p.quantity), unit: p.unit, item: p.itemName })}
                    </p>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <QtyCell view={v} t={t} />
                  <div className="flex min-w-[110px] flex-col gap-0.5">
                    <span className="text-[10px] font-semibold text-muted-foreground">{t("mfg4_date_required")}</span>
                    <span className={cn("flex items-center gap-1 text-xs font-bold", v.overdue ? "text-destructive" : "text-foreground")}>
                      {v.overdue ? <AlertTriangle size={12} aria-hidden="true" /> : <CalendarDays size={12} aria-hidden="true" />}
                      {v.neededBy ? d.short(v.neededBy) : t("mfg4_not_set")}
                    </span>
                    {v.overdue && <span className="text-[10px] text-destructive">{t("mfg4_date_past_due", { days: v.lateDays })}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canEdit && v.live && !change && (
                      <Button size="sm" variant="outline" className="h-10 gap-1.5" onClick={() => setChangeTarget(v)}>
                        <FilePen size={14} aria-hidden="true" />
                        {t("mfx_prj_change_open_btn")}
                      </Button>
                    )}
                    {seesWorkshop && (
                      <Link
                        href={link(v.id)}
                        className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-xs font-semibold text-cta hover:bg-cta/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ExternalLink size={13} className="rtl-flip" aria-hidden="true" />
                        {t("mfx_prj_open_in_mfg")}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ProjectDrawingResultDialog
        target={drawingTarget}
        orgId={facts.orgId}
        actor={facts.actor}
        link={drawingTarget ? link(drawingTarget.order.id) : null}
        onClose={() => setDrawingTarget(null)}
      />
      <ProjectOrderChangeDialog view={changeTarget} orgId={facts.orgId} actor={facts.actor} link={changeTarget ? link(changeTarget.id) : null} onClose={() => setChangeTarget(null)} />
      <MfgNoteReceiptDialog
        note={receiveTarget}
        orgId={facts.orgId}
        actor={facts.actor}
        link={receiveTarget ? link(receiveTarget.source.workOrderId) : null}
        onClose={() => setReceiveTarget(null)}
      />
    </section>
  )
}
