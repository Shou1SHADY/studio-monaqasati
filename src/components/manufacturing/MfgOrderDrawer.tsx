"use client"

// The work-order panel, opened in place from any Manufacturing screen, read
// top to bottom (PRD "The order panel"): where it came from and its state;
// the stage strip; the ONE next step that is yours — or who it waits for,
// with no button when another module owns it (BD-01); what blocks it and how
// that clears; four numbers; then collapsed sections — route, drawing & cut
// list, materials, close & notes, cost, checklists, Finance, the document
// trail and the log — with the section holding your next step opened.

import { useMemo, useState, type ElementType, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  ArrowRightLeft,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Coins,
  Eye,
  FileText,
  Gem,
  Landmark,
  Layers,
  Loader2,
  Lock,
  MoreHorizontal,
  PackageCheck,
  PencilRuler,
  Play,
  Printer,
  Route,
  Ruler,
  ShoppingCart,
  Trash2,
  Truck,
  Undo2,
  Warehouse,
  Zap,
  ExternalLink,
  FileCheck2,
} from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { useFirestore } from "@/firebase"
import { cn } from "@/lib/utils"
import {
  DEFECT_KINDS,
  canDo,
  itemKey,
  materialNeed,
  materialOpen,
  materialReceived,
  materialState,
  requestedBom,
  standardCost,
  stationBlocks,
  type CandidateKey,
  type StationMaterialState,
} from "@/lib/manufacturing-engine"
import { toggleChecklistItem } from "@/lib/manufacturing-writes"
import { documentTrail, financeEvents, orderLog, type LogItem, type OrderView } from "@/lib/manufacturing-view"
import { candidateAction, useMfgUi } from "./MfgUiContext"
import {
  CANDIDATE_ICON,
  MfgModuleChip,
  MfgRouteStrip,
  MfgRushChip,
  MfgSourceChip,
  MfgStageStrip,
  MfgStatePill,
  blockTexts,
  candidateModule,
  departmentNameOf,
  deptName,
  dueText,
  holderLabel,
  lateReasonText,
  sourceNameOf,
  useCandidateWords,
} from "./MfgOrderBits"
import { MfgChip, MfgDrawer, MfgNote, MfgPill, MfgQtyLegend, MfgRow, MfgSection, MfgStat, fmtMoney, fmtQty, useMfgDate, type MfgTone } from "./ui/MfgUi"
import { Num, canTickChecklist, moduleLinkOf, stationOf } from "./MfgFormKit"
import { ProjectDrawingResultDialog } from "@/components/projects/ProjectDrawingResultDialog"
import { mfgLinks } from "@/lib/mfg-events"
import { availableTo } from "./MfgFormMaterials"
import { causeLabel } from "./MfgFormOutput"
import { printableFromNote, useDeliveryNotePrint } from "./MfgDeliveryNotePrint"

export function MfgOrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const ui = useMfgUi()
  const view = orderId ? ui.viewById.get(orderId) : undefined
  return (
    <MfgDrawer
      open={!!view}
      onClose={onClose}
      icon={Gem}
      title={
        view ? (
          <>
            <Num>{view.ref}</Num> — {view.product.name}
          </>
        ) : (
          ""
        )
      }
      meta={view ? <PanelMeta view={view} /> : null}
    >
      {view && <PanelBody key={view.id} view={view} />}
    </MfgDrawer>
  )
}

// ---------------------------------------------------------------------------
// Header: source, requester, block, state, rush, block notice
// ---------------------------------------------------------------------------

function PanelMeta({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const o = view.order
  const chipRef = view.source === "project" ? o.pmRequestRef || o.purchaseRequestRef : null
  const refs = view.source === "project" ? [o.pmRequestRef, o.purchaseRequestRef].filter((r): r is string => !!r && r !== chipRef) : []
  const lot = view.calc.slice.slabApproval?.lot
  return (
    <>
      <MfgSourceChip view={view} />
      <span className="font-semibold text-slate-600">{sourceNameOf(view, t)}</span>
      {o.costItemName && <span>· {o.costItemName}</span>}
      {refs.map((r) => (
        <MfgChip key={r} tone="muted">
          <Num>{r}</Num>
        </MfgChip>
      ))}
      {o.requestedByName && <span>· {t("mfo_requested_by", { name: o.requestedByName })}</span>}
      {lot && (
        <MfgChip tone="info" icon={Layers}>
          <Num>{lot}</Num>
        </MfgChip>
      )}
      <MfgStatePill view={view} />
      {view.rush && <MfgRushChip reason={view.calc.slice.rush?.reason} />}
      {view.notices.length > 0 && (
        <MfgPill tone="bad" icon={AlertTriangle}>
          {t("mfo_block_notice")}
        </MfgPill>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

const MAT_KEYS: CandidateKey[] = ["request_materials", "confirm_receipt", "shortage", "purchase_wait", "issue_wait", "remnant_wait"]
const CLOSE_KEYS: CandidateKey[] = ["close", "deliver", "receipt_wait", "remake_breakage"]
const DRAWING_KEYS: CandidateKey[] = ["submit_drawing", "drawing_wait", "slab", "survey"]

function PanelBody({ view }: { view: OrderView }) {
  const ui = useMfgUi()
  const ns = ui.nextStepOf(view)
  const w = ns ? null : ui.waitingOf(view)
  const focus = (ns || w)?.key
  const opens = (keys: CandidateKey[]) => !!focus && keys.includes(focus)
  // The saw reads the drawing and the cut list: open it for whoever cuts next.
  const cutting = ns?.key === "output" && ns.index === view.calc.firstQ && !!view.calc.slice.drawing?.cutList?.length
  return (
    <>
      <MfgStageStrip view={view} />
      <NextStepBox view={view} />
      <Blocks view={view} />
      <Stats view={view} />
      <RouteSection view={view} />
      <DrawingSection view={view} open={opens(DRAWING_KEYS) || cutting} />
      <MaterialsSection view={view} open={opens(MAT_KEYS)} />
      <CloseSection view={view} open={opens(CLOSE_KEYS)} />
      {ui.seesMoney && <CostSection view={view} />}
      <ChecklistsSection view={view} />
      {ui.seesMoney && <FinanceSection view={view} />}
      <TrailSection view={view} />
      <LogSection view={view} />
      <MoreSection view={view} />
    </>
  )
}

// ---------------------------------------------------------------------------
// The next step — yours, or who it waits for (ORD-04, BD-01)
// ---------------------------------------------------------------------------

function NextStepBox({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const words = useCandidateWords()
  const [drawingHere, setDrawingHere] = useState(false)
  const ns = ui.nextStepOf(view)
  const w = ns ? null : ui.waitingOf(view)
  const canRush = ui.perms.canManage && view.live && view.released && !view.rush
  const rush = canRush ? (
    <Button type="button" variant="outline" className="h-10 gap-1.5 text-xs" title={t("mfo_rush_button_hint")} onClick={() => ui.openAction(view.id, { kind: "rush" })}>
      <Zap size={14} aria-hidden="true" /> {t("mfg4_rush")}
    </Button>
  ) : null
  const others = view.candidates.filter((c) => c !== ns && ui.owns(c) && candidateAction(c))

  if (ns) {
    const Icon = CANDIDATE_ICON[ns.key]
    return (
      <section className="rounded-xl border-2 border-warning/40 bg-warning/5 px-3.5 py-3" aria-label={t("mfo_next_yours")}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold text-warning">{t("mfo_next_yours")}</span>
            <p className="mt-0.5 text-sm font-bold leading-relaxed text-foreground">{words.text(ns, view)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rush}
            <Button type="button" className="h-10 gap-1.5 text-xs" onClick={() => ui.openCandidate(view.id, ns)}>
              <Icon size={14} aria-hidden="true" /> {words.button(ns, view)}
            </Button>
          </div>
        </div>
        {others.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-warning/20 pt-2.5">
            <span className="text-[11px] font-semibold text-muted-foreground">{t("mfo_also_yours")}</span>
            {others.slice(0, 4).map((c, i) => {
              const OIcon = CANDIDATE_ICON[c.key]
              return (
                <Button key={`${c.key}_${c.index ?? i}_${c.requestNumber || c.scrapId || ""}`} type="button" variant="outline" size="sm" className="h-9 gap-1 text-[11px]" title={words.text(c, view)} onClick={() => ui.openCandidate(view.id, c)}>
                  <OIcon size={12} aria-hidden="true" /> {words.button(c, view)}
                  {c.departmentId && <span className="text-muted-foreground">· {deptName(ui.data.departments, c.departmentId)}</span>}
                </Button>
              )
            })}
          </div>
        )}
      </section>
    )
  }

  if (w) {
    const mod = candidateModule(w)
    const who = mod ? t(`mfg4_module_${mod}`) : holderLabel(w, ui, t)
    const there = mod ? moduleLinkOf(mod, view, ui.data.salesOrders) : null
    // The client's (or the consultant's) answer on the drawing is normally
    // recorded by Sales or Projects. The customer's flow is that an order, once
    // its advance is confirmed, does not have to travel back to Sales before it
    // is finished — so the workshop manager may record the answer he was given,
    // under his own name and in the order's log. The rules already let him.
    const canRecordDrawing = w.key === "drawing_wait" && ui.perms.canManage
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-white px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
            <Clock size={12} aria-hidden="true" /> {t("mfo_waiting_for", { who })}
          </span>
          <p className="mt-0.5 text-sm font-bold leading-relaxed text-foreground">{words.text(w, view)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {mod ? (
              <>
                <MfgModuleChip module={mod} /> {t("mfg4_done_there")}
                {there && (
                  <Link
                    href={`/${ui.portal}/${there}`}
                    className="inline-flex items-center gap-1 font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {t("mfg4_open_there", { module: who })}
                    <ExternalLink size={11} className="rtl-flip" aria-hidden="true" />
                  </Link>
                )}
              </>
            ) : (
              t("mfg4_no_action_role")
            )}
          </p>
        </div>
        {canRecordDrawing && (
          <Button type="button" variant="outline" className="h-10 gap-1.5 text-xs" onClick={() => setDrawingHere(true)}>
            <FileCheck2 size={14} aria-hidden="true" /> {t("mfg4_drawing_record_here")}
          </Button>
        )}
        {rush}
        {canRecordDrawing && (
          <ProjectDrawingResultDialog
            target={drawingHere ? { order: view.order, orderRef: view.ref, productName: view.product.name } : null}
            orgId={ui.data.orgId}
            actor={ui.data.actor}
            link={mfgLinks.order(view.id)}
            description={t("mfg4_drawing_record_here_desc", { order: view.ref, who })}
            onClose={() => setDrawingHere(false)}
          />
        )}
      </section>
    )
  }

  if (view.done) {
    return (
      <MfgNote tone="ok" icon={CheckCircle2} title={t("mfg4_closed")}>
        {t("mfo_done_fully")}
      </MfgNote>
    )
  }
  if (view.cancelled) {
    const x = view.calc.slice.cancellation
    return (
      <MfgNote tone="info" icon={Lock} title={t("mfg4_cancelled")}>
        {x ? `${x.reason} · ${x.by} · ${d.short(x.at)}` : null}
      </MfgNote>
    )
  }
  return rush ? <div className="flex justify-end">{rush}</div> : null
}

// ---------------------------------------------------------------------------
// Blocks with their fix, B notes, block notices, late and why
// ---------------------------------------------------------------------------

function Blocks({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const { data } = ui
  const c = view.calc
  const drawing = c.slice.drawing
  const sched = view.schedule
  const queueWait = sched?.waitDepartmentId && sched.waitDays >= 0.5 && view.lateReason?.key !== "queue" ? t("mfo_late_queue_wait", { days: sched.waitDays, dept: deptName(data.departments, sched.waitDepartmentId) }) : null
  return (
    <>
      {!view.released &&
        !view.cancelled &&
        view.releaseBlocks.map((b) => {
          const x = blockTexts(b, view, c.firstQ, data.departments, t)
          return (
            <MfgNote key={b.key} tone="bad" title={x.title}>
              {x.fix}
            </MfgNote>
          )
        })}
      {c.current >= 0 &&
        view.currentBlocks.map((b) => {
          const x = blockTexts(b, view, c.current, data.departments, t)
          const title = b.key === "materials" ? x.title : `${departmentNameOf(data.departments, view, c.current)}: ${x.title}`
          return (
            <MfgNote key={b.key} tone={b.severity === "hard" ? "bad" : "warn"} title={title}>
              {x.fix}
            </MfgNote>
          )
        })}
      {view.live && drawing?.code === "B" && (
        <MfgNote tone="warn" icon={PencilRuler} title={t("mfo_b_notes_title")}>
          {drawing.resultNotes || "—"}
        </MfgNote>
      )}
      {view.live &&
        view.notices.map((n) => (
          <MfgNote key={n.id} tone="bad" icon={AlertTriangle} title={t("mfo_notice_on_block", { lot: n.lot, defect: t(`mfg4_defect_${n.defect}`) })}>
            {n.note} — {n.by} · {d.relative(n.at)}. {t("mfo_notice_inspect")}
          </MfgNote>
        ))}
      {view.live && view.late && (view.released || view.overdue) && (
        <MfgNote
          tone="bad"
          icon={Clock}
          title={view.overdue ? t("mfg4_date_past_due", { days: view.lateDays }) : t("mfo_late_will_miss", { possible: d.short(view.possibleDate), required: d.short(view.neededBy), days: view.lateDays })}
        >
          {[view.lateReason ? `${t("mfg4_late_because")} ${lateReasonText(view.lateReason, view, data.departments, t)}` : null, queueWait].filter(Boolean).join(" · ") || null}
        </MfgNote>
      )}
      {ui.seesMoney && c.prodDone && c.delivered === 0 && !view.notes.length && view.cost.materials === 0 && <MfgNote tone="bad">{t("mfo_cost_incomplete")}</MfgNote>}
    </>
  )
}

// ---------------------------------------------------------------------------
// Four numbers
// ---------------------------------------------------------------------------

function Stats({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const c = view.calc
  const cost = view.cost
  const bits = [
    c.toClose > 0 ? t("mfo_bit_to_close", { qty: fmtQty(c.toClose) }) : null,
    c.ready > 0 ? t("mfo_bit_ready", { qty: fmtQty(c.ready) }) : null,
    c.shipped > 0 ? t("mfo_bit_transit", { qty: fmtQty(c.shipped) }) : null,
  ].filter(Boolean)
  const pct = cost.variancePercent
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <MfgStat
        label={t("mfo_stat_delivered")}
        value={
          <>
            <Num>{fmtQty(c.delivered)}</Num> <span className="text-[11px] font-semibold text-muted-foreground">{t("mfg4_of_target", { target: fmtQty(c.target), unit: view.unit })}</span>
          </>
        }
        sub={c.slice.shortfall > 0 ? <span className="text-destructive">{t("mfg4_short_declared", { qty: fmtQty(c.slice.shortfall) })}</span> : undefined}
      />
      <MfgStat
        label={t("mfo_stat_in_production")}
        value={
          <>
            <Num>{fmtQty(c.wip)}</Num> <span className="text-[11px] font-semibold text-muted-foreground">{view.unit}</span>
          </>
        }
        sub={bits.length ? bits.join(" · ") : "—"}
      />
      <MfgStat label={t("mfg4_date_required")} value={d.short(view.neededBy)} sub={dueText(view, d, t)} />
      {ui.seesMoney ? (
        <MfgStat
          label={cost.frozen ? t("mfo_actual_cost") : t("mfo_cost_so_far")}
          value={
            <>
              <Num>{fmtMoney(cost.total)}</Num> <span className="text-[11px] font-semibold text-muted-foreground">{t("mfg4_sar")}</span>
            </>
          }
          sub={
            cost.frozen ? (
              t("mfo_frozen_at_close")
            ) : (
              <>
                {t("mfo_earned_standard")} <Num>{fmtMoney(cost.earnedStandard)}</Num>
                {pct != null && (
                  <b className={cn(pct > 5 ? "text-destructive" : pct < -5 ? "text-success" : "text-muted-foreground")}>
                    {" · "}
                    <Num>{`${pct > 0 ? "+" : ""}${pct}%`}</Num>
                  </b>
                )}
              </>
            )
          }
        />
      ) : (
        <MfgStat
          label={t("mfo_labour_hours")}
          value={
            <>
              <Num>{fmtQty(cost.hours)}</Num> <span className="text-[11px] font-semibold text-muted-foreground">{t("mfo_h")}</span>
            </>
          }
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Route — open by default (ORD-06)
// ---------------------------------------------------------------------------

function RouteSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  if (!view.released) {
    return view.cancelled ? null : <MfgNote tone="info">{t("mfo_not_released")}</MfgNote>
  }
  return (
    <MfgSection collapsible defaultOpen icon={Route} title={t("mfo_sec_route")}>
      <div className="px-3.5 py-3">
        <MfgRouteStrip view={view} />
      </div>
      <div className="border-t border-border/60 px-3.5 py-2.5">
        <MfgQtyLegend />
      </div>
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Drawing & cut list (ORD-15) — read-only at stations
// ---------------------------------------------------------------------------

function DrawingSection({ view, open }: { view: OrderView; open: boolean }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const c = view.calc
  const p = view.product
  const drawing = c.slice.drawing
  const survey = c.slice.survey
  const slab = c.slice.slabApproval
  const cut = drawing?.cutList || []
  if (!p.requiresDrawingApproval && !p.requiresMeasurement && !p.requiresSlabApproval && !cut.length && !survey && !slab && !drawing) return null
  const state = c.drawingState
  const stateTone: MfgTone = state === "ok" ? "ok" : state === "wait" ? "warn" : "muted"
  const approverOrg = drawing?.approverOrg || (view.source === "client" ? "client" : "technical_office")
  const shown = cut.slice(0, 12)
  const link = (url: string | null | undefined, text: string) =>
    url ? (
      <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-cta underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {text}
      </a>
    ) : null

  return (
    <MfgSection collapsible defaultOpen={open} icon={PencilRuler} title={t("mfo_sec_drawing")} right={cut.length ? <span className="text-[11px] text-muted-foreground">{t("mfo_pieces_count", { count: cut.length })}</span> : undefined}>
      {(p.requiresDrawingApproval || drawing) && (
        <MfgRow right={state !== "na" ? <MfgPill tone={stateTone}>{t(`mfo_drawing_state_${state}`)}</MfgPill> : undefined}>
          <span className="block font-semibold">
            {t("mfo_shop_drawing")} — <Num>{view.ref}</Num>
            {drawing ? (
              <>
                {" · "}
                <Num>{`rev.${drawing.revision}`}</Num>
              </>
            ) : null}
            {drawing?.fileUrl && <> · {link(drawing.fileUrl, drawing.fileName || t("mfo_open_file"))}</>}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {state === "ok"
              ? t("mfo_drawing_ok_by", { code: drawing?.code || "", name: drawing?.approverName || drawing?.recordedBy || "—", approver: t(`mfg4_approver_${approverOrg}`) })
              : state === "wait"
                ? t("mfo_drawing_wait_at", { approver: t(`mfg4_approver_${approverOrg}`), date: d.short(drawing?.submittedAt) })
                : t("mfo_drawing_draft")}
          </span>
          {drawing?.resultNotes && <span className="block text-[11px] text-slate-600">{drawing.code === "B" ? t("mfo_b_notes", { notes: drawing.resultNotes }) : drawing.resultNotes}</span>}
          {state === "draft" && drawing?.previousC && <span className="block text-[11px] text-destructive">{t("mfo_returned_c", { notes: drawing.previousC })}</span>}
          {drawing?.note && <span className="block text-[11px] text-muted-foreground">{t("mfo_note_to_approver", { note: drawing.note })}</span>}
        </MfgRow>
      )}
      {survey && (
        <MfgRow>
          <span className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
            <Ruler size={12} aria-hidden="true" />
            {[
              t("mfo_survey_on", { date: d.short(survey.at) }),
              survey.measuredQuantity != null ? t("mfo_survey_measured_value", { qty: fmtQty(survey.measuredQuantity), unit: view.unit }) : null,
              survey.by,
              survey.note,
            ]
              .filter(Boolean)
              .join(" · ")}
            {survey.sketchUrl && <> · {link(survey.sketchUrl, t("mfo_sketch"))}</>}
          </span>
        </MfgRow>
      )}
      {p.requiresMeasurement && !survey && (
        <MfgRow>
          <span className="text-[11px] text-muted-foreground">{t("mfo_survey_missing")}</span>
        </MfgRow>
      )}
      {slab && (
        <MfgRow>
          <span className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
            <Eye size={12} aria-hidden="true" />
            <span>
              {t("mfo_approved_slab")}: <b><Num>{slab.lot}</Num></b>
            </span>
            {[
              slab.slabNumbers ? t("mfo_slab_numbers_value", { nos: slab.slabNumbers }) : null,
              slab.photosAttached ? t("mfo_slab_photos_attached") : null,
              `${slab.by} · ${d.short(slab.at)}`,
              slab.note,
            ]
              .filter(Boolean)
              .map((x) => ` · ${x}`)
              .join("")}
            {slab.formUrl && <> · {link(slab.formUrl, t("mfo_signed_form"))}</>}
          </span>
          {slab.alternativeLot && (
            <span className="mt-0.5 block text-[11px] text-warning">
              {t("mfo_alt_lot", { lot: slab.alternativeLot.lot, consent: slab.alternativeLot.consent, by: slab.alternativeLot.by })}
            </span>
          )}
        </MfgRow>
      )}
      {p.requiresSlabApproval && !slab && (
        <MfgRow>
          <span className="text-[11px] text-muted-foreground">{t("mfo_slab_missing")}</span>
        </MfgRow>
      )}
      {cut.length > 0 && (
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full min-w-[460px] text-xs">
            <thead className="bg-muted/40 text-[10px] font-bold text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-start">{t("mfo_cut_no")}</th>
                <th className="px-3 py-1.5 text-start">{t("mfo_print_size")}</th>
                <th className="px-3 py-1.5 text-start">{t("mfo_cut_thickness")}</th>
                <th className="px-3 py-1.5 text-start">{t("mfo_cut_edge")}</th>
                <th className="px-3 py-1.5 text-start">{t("mfo_cut_cutouts")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x, i) => (
                <tr key={`${x.no}_${i}`} className="border-t border-border/60">
                  <td className="px-3 py-1.5 font-bold"><Num>{x.no}</Num></td>
                  <td className="px-3 py-1.5"><Num>{`${fmtQty(x.length)} × ${fmtQty(x.width)}`}</Num></td>
                  <td className="px-3 py-1.5">{x.thickness != null ? <Num>{fmtQty(x.thickness)}</Num> : "—"}</td>
                  <td className="px-3 py-1.5 text-[11px]">{x.edge || "—"}</td>
                  <td className="px-3 py-1.5 text-[11px]">{x.cutouts || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {cut.length > 12 && <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">{t("mfo_more_pieces", { count: cut.length - 12 })}</p>}
        </div>
      )}
      <p className="border-t border-border/60 px-3.5 py-2 text-[10px] text-muted-foreground">{ui.perms.canManage ? t("mfo_cut_note") : t("mfo_cut_note_station")}</p>
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Materials — per consuming station; custody; remnants; shortage
// ---------------------------------------------------------------------------

const MAT_TONE: Record<StationMaterialState, MfgTone> = { none: "muted", missing: "warn", requested: "info", released: "accent", partial: "warn", complete: "ok" }

function MaterialsSection({ view, open }: { view: OrderView; open: boolean }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const d = useMfgDate()
  const { data } = ui
  const c = view.calc
  const alloc = ui.world.alloc
  const seen = new Set<string>()
  const stations = c.route
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => {
      if (c.gates[i] || seen.has(r.departmentId) || !requestedBom(view.product, r.departmentId).length) return false
      seen.add(r.departmentId)
      return true
    })
  const custody = view.product.bom.filter((b) => b.custody)
  const reserved = alloc?.reserved.get(view.id)
  const reservedRows = reserved ? Array.from(reserved.entries()).filter(([, q]) => q > 0) : []
  const itemUnit = (k: string) => view.product.bom.find((b) => itemKey(b.itemName) === k)
  const slabLot = c.slice.slabApproval?.lot

  return (
    <MfgSection collapsible defaultOpen={open} icon={Boxes} title={t("mfo_sec_materials")} right={<MfgModuleChip module="inventory" prefix="from" />}>
      {!stations.length && <p className="px-3.5 py-3 text-xs text-muted-foreground">{t("mfo_mat_nothing")}</p>}
      {stations.map(({ r, i }) => {
        const need = materialNeed(c, i)
        const ms = materialState(c, i)
        const cd = canDo(c, i)
        const inHand = c.pend[i] || 0
        const rows = c.slice.materials.filter((m) => m.departmentId === r.departmentId)
        const atStore = Array.from(new Set(rows.filter((m) => m.state === "requested").map((m) => m.requestNumber)))
        const issued = Array.from(new Set(rows.filter((m) => m.state === "released").map((m) => m.requestNumber)))
        return (
          <div key={r.departmentId} className="border-b border-border/60 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-3.5 py-2 text-xs">
              <b>{departmentNameOf(data.departments, view, i)}</b>
              {inHand > 0 && cd !== Infinity && (
                <span className="text-[11px] text-muted-foreground">{t("mfo_mat_covers", { qty: fmtQty(Math.min(cd, inHand)), inHand: fmtQty(inHand) })}</span>
              )}
              <span className="ms-auto flex flex-wrap items-center gap-1.5">
                {atStore.map((rn) => (
                  <MfgChip key={rn} tone="info" icon={Warehouse}>
                    <Num>{rn}</Num> · {t("mfo_mat_at_store")}
                  </MfgChip>
                ))}
                {issued.map((rn) => (
                  <MfgChip key={rn} tone="accent" icon={PackageCheck}>
                    <Num>{rn}</Num> · {t("mfo_mat_issued")}
                  </MfgChip>
                ))}
                <MfgPill tone={MAT_TONE[ms]}>{t(`mfg4_mat_${ms}`)}</MfgPill>
              </span>
            </div>
            {need.map((n) => {
              const got = materialReceived(c.slice, r.departmentId, n.itemName)
              const openQ = materialOpen(c.slice, r.departmentId, n.itemName)
              const av = availableTo(alloc, view.id, n.itemName)
              const lotRow = rows.find((m) => itemKey(m.itemName) === itemKey(n.itemName) && m.lot)
              const lot = lotRow?.lot || (n.withWaste ? slabLot : null)
              const missing = Math.max(0, n.qty - got - openQ)
              return (
                <div key={n.itemName} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-t border-dashed border-border/60 px-3.5 py-2 text-xs sm:grid-cols-[1fr_auto_auto]">
                  <span className="min-w-0">
                    <b className="block truncate font-semibold">{n.itemName}</b>
                    <span className="block text-[10px] text-muted-foreground">
                      {n.withWaste ? t("mfo_mat_net_waste", { net: fmtQty(n.net), pct: view.product.wastePercent }) : t("mfo_mat_per_bom")}
                      {lot ? ` · ${lot}` : ""}
                    </span>
                  </span>
                  <span className="text-end font-bold">
                    <Num>{`${fmtQty(got)} / ${fmtQty(n.qty)}`}</Num> <span className="text-[10px] font-semibold text-muted-foreground">{n.unit}</span>
                    {openQ > 0 && <span className="block text-[10px] font-semibold text-cta">{t("mfo_mat_open", { qty: fmtQty(openQ) })}</span>}
                  </span>
                  <span className="col-span-2 text-end sm:col-span-1 sm:min-w-[92px]">
                    {got > n.qty + 0.05 ? (
                      <MfgChip tone="warn">{t("mfo_mat_over", { qty: fmtQty(got - n.qty) })}</MfgChip>
                    ) : got >= n.qty - 0.05 ? (
                      <MfgChip tone="ok">{t("mfo_mat_complete")}</MfgChip>
                    ) : !alloc ? (
                      <Loader2 size={12} className="ms-auto inline animate-spin text-muted-foreground" aria-label={t("mfo_stock_loading")} />
                    ) : av >= missing - 0.05 ? (
                      <MfgChip tone="info">{t("mfo_mat_available", { qty: fmtQty(av) })}</MfgChip>
                    ) : (
                      <MfgChip tone="bad">{t("mfo_mat_short", { qty: fmtQty(missing - av) })}</MfgChip>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
      {custody.length > 0 && (
        <MfgRow>
          <span className="block text-[11px] text-slate-600">
            {t("mfo_mat_custody", { items: Array.from(new Set(custody.map((b) => b.itemName))).join(t("mfo_list_sep")) })}
            {ui.seesMoney && (
              <>
                {" · "}
                <Num>{fmtMoney(view.cost.custody)}</Num> {t("mfg4_sar")} {t("mfo_so_far")}
              </>
            )}
          </span>
        </MfgRow>
      )}
      {c.slice.remnants.map((x) => (
        <MfgRow key={x.id} right={<MfgPill tone={x.state === "received" ? "ok" : "info"}>{x.state === "received" ? t("mfo_remnant_received") : t("mfo_remnant_awaiting")}</MfgPill>}>
          <span className="block font-semibold">
            {t("mfo_remnant_line", { qty: fmtQty(x.area), unit: x.unit })}
            {x.lot ? ` — ${x.lot}` : ""}
          </span>
          <span className="block text-[10px] text-muted-foreground">
            {x.by} · {d.short(x.at)}
            {ui.seesMoney && (
              <>
                {" · "}
                {t("mfo_remnant_credit")} <Num>{fmtMoney(x.value)}</Num> {t("mfg4_sar")}
              </>
            )}
          </span>
        </MfgRow>
      ))}
      {reservedRows.length > 0 && (
        <MfgRow>
          <span className="block text-[11px] text-slate-600">
            {t("mfo_mat_reserved")}:{" "}
            {reservedRows.map(([k, q], idx) => {
              const b = itemUnit(k)
              return (
                <span key={k}>
                  {idx > 0 ? " · " : ""}
                  {b?.itemName || k} <Num>{fmtQty(q)}</Num> {b?.unit || ""}
                </span>
              )
            })}
          </span>
        </MfgRow>
      )}
      {view.shortages.length > 0 && (
        <div className="px-3.5 py-2.5">
          <MfgNote tone="bad" title={t("mfo_mat_shortage")}>
            <ul className="space-y-1.5">
              {view.shortages.map((s) => (
                <li key={s.itemName} className="flex flex-wrap items-center gap-2">
                  <span>
                    {s.itemName}: <Num>{fmtQty(s.short)}</Num> {s.unit}
                  </span>
                  {s.requested ? (
                    <MfgChip tone="muted" icon={ShoppingCart}>
                      {t("mfo_mat_purchase_requested")}
                    </MfgChip>
                  ) : ui.perms.canManage && view.live ? (
                    <Button type="button" size="sm" variant="outline" className="h-9 gap-1 bg-white text-[11px]" onClick={() => ui.openAction(view.id, { kind: "purchase", itemName: s.itemName })}>
                      <ShoppingCart size={12} aria-hidden="true" /> {t("mfg4_b_shortage")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-1.5">{t("mfo_mat_shortage_fix")}</p>
          </MfgNote>
        </div>
      )}
      {ui.seesMoney && (
        <div className="flex items-center justify-between border-t border-border/60 px-3.5 py-2 text-xs">
          <span className="text-muted-foreground">{t("mfo_mat_value")}</span>
          <b>
            <Num>{fmtMoney(view.cost.materials)}</Num> {t("mfg4_sar")}
          </b>
        </div>
      )}
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Close & delivery notes
// ---------------------------------------------------------------------------

function CloseSection({ view, open }: { view: OrderView; open: boolean }) {
  const t = useTranslations("Portal.Shared")
  const d = useMfgDate()
  const print = useDeliveryNotePrint()
  const c = view.calc
  const closures = c.slice.closures || []
  if (!view.notes.length && !c.toClose && !c.ready && !closures.length) return null
  const notes = [...view.notes].sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1))
  return (
    <MfgSection collapsible defaultOpen={open} icon={Truck} title={t("mfo_sec_close")} right={<span className="text-[11px] text-muted-foreground">{t("mfo_notes_count", { count: view.notes.length })}</span>}>
      {closures.map((x, i) => (
        <MfgRow key={`cl_${i}`} right={<MfgChip tone="ok" icon={CheckCircle2}>{t("mfo_closed_chip")}</MfgChip>}>
          <span className="block font-semibold">{t("mfo_closure_line", { qty: fmtQty(x.quantity), unit: view.unit })}</span>
          <span className="block text-[10px] text-muted-foreground">
            {x.by} · {d.short(x.at)}
          </span>
        </MfgRow>
      ))}
      {c.toClose > 0 && (
        <MfgRow className="bg-muted/30">
          <span className="block font-semibold">{t("mfo_to_close_line", { qty: fmtQty(c.toClose), unit: view.unit })}</span>
          <span className="block text-[10px] text-muted-foreground">{t("mfo_to_close_sub")}</span>
        </MfgRow>
      )}
      {c.ready > 0 && (
        <MfgRow className="bg-muted/30">
          <span className="block font-semibold">{t("mfo_ready_line", { qty: fmtQty(c.ready), unit: view.unit })}</span>
        </MfgRow>
      )}
      {notes.map((n) => {
        const broken = n.brokenQuantity || 0
        const tone: MfgTone = n.status === "received" ? (broken ? "bad" : "ok") : n.status === "rejected" ? "muted" : "info"
        const stateKey = n.status === "received" ? (broken ? "mfo_note_state_issue" : "mfo_note_state_received") : n.status === "rejected" ? "mfo_note_state_rejected" : "mfo_note_state_transit"
        const vehicle = [(n as typeof n & { vehicleLabel?: string | null }).vehicleLabel, n.driverName].filter(Boolean).join(" · ")
        return (
          <MfgRow
            key={n.id}
            right={
              <>
                <MfgPill tone={tone}>{t(stateKey)}</MfgPill>
                <button
                  type="button"
                  onClick={() => print(printableFromNote(n, view))}
                  aria-label={t("mfo_dn_print_named", { no: n.noteNumber })}
                  title={t("mfo_dn_print")}
                  className="grid h-9 w-9 place-items-center rounded-lg border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Printer size={14} aria-hidden="true" />
                </button>
              </>
            }
          >
            <span className="block font-semibold">
              <Num>{n.noteNumber}</Num> — {t(n.toKind === "project" ? "mfo_note_to_project" : "mfo_note_to_warehouse", { qty: fmtQty(n.item.quantity), unit: n.item.unit, dest: n.toWarehouseName })}
            </span>
            <span className="block text-[10px] text-muted-foreground">
              {[
                n.pieces ? t("mfo_pieces_count", { count: n.pieces }) : null,
                n.crates ? t("mfo_crates_count", { count: n.crates }) : null,
                vehicle || null,
                t("mfo_note_out", { date: d.short(n.sentAt) }),
                n.receivedByUserName ? t("mfo_note_received_by", { name: n.receivedByUserName, date: d.short(n.receivedAt) }) : null,
                broken ? t("mfo_note_broken", { qty: fmtQty(broken) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </MfgRow>
        )
      })}
      {c.brokenOpen > 0 && (
        <div className="px-3.5 py-2.5">
          <MfgNote tone="bad">{t("mfo_breakage_undecided", { qty: fmtQty(c.brokenOpen), unit: view.unit })}</MfgNote>
        </div>
      )}
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Cost — money roles only; price and margin live elsewhere (D10)
// ---------------------------------------------------------------------------

function CostSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const cost = view.cost
  const time = data.settings.features.time
  const earned = cost.earnedStandard
  const variance = earned > 0 ? Math.round(cost.total - earned) : null
  const full = standardCost(view.product, data.departments, data.settings, view.quantity).total
  const line = (label: ReactNode, value: ReactNode, cls?: string) => (
    <div className={cn("flex items-center justify-between gap-3 px-3.5 py-1.5 text-xs", cls)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="shrink-0 font-semibold">{value}</span>
    </div>
  )
  const money = (v: number) => (
    <>
      <Num>{fmtMoney(v)}</Num> {t("mfg4_sar")}
    </>
  )
  return (
    <MfgSection collapsible defaultOpen={false} icon={Coins} title={t("mfo_sec_cost")} right={<span className="text-[11px] font-bold">{money(cost.total)}</span>}>
      <div className="py-1.5">
        {line(t("mfo_cost_materials"), money(cost.materials))}
        {line(t("mfo_cost_custody"), money(cost.custody))}
        {time ? (
          <>
            {line(t("mfo_cost_labour", { hours: fmtQty(cost.hours) }), money(cost.labour))}
            {line(t("mfo_cost_overhead"), money(cost.overhead))}
          </>
        ) : (
          line(t("mfo_cost_labour_overhead"), <span className="text-muted-foreground">{t("mfo_cost_time_off")}</span>)
        )}
        {cost.remnantCredit > 0 && line(t("mfo_cost_remnants"), <span className="text-success">−{money(cost.remnantCredit)}</span>)}
        {line(<b className="text-foreground">{cost.frozen ? t("mfo_actual_cost_frozen") : t("mfo_cost_so_far")}</b>, <b>{money(cost.total)}</b>, "border-y border-border/60 bg-muted/20 py-2")}
        {line(t("mfo_cost_earned"), money(earned))}
        {variance != null &&
          line(
            <>
              {t("mfo_cost_variance")} <span className="text-[10px]">{t("mfo_cost_variance_note")}</span>
            </>,
            <span className={variance > 0 ? "text-destructive" : "text-success"}>
              <Num>{`${variance > 0 ? "+" : ""}${fmtMoney(variance)}`}</Num>
            </span>
          )}
        {line(t("mfo_cost_full_standard"), money(full))}
        {line(t("mfo_cost_price_margin"), <span className="text-muted-foreground">{view.source === "client" ? t("mfo_cost_price_sales") : view.source === "project" ? t("mfo_cost_price_projects") : "—"}</span>)}
      </div>
      {!cost.materialsAllPriced && (
        <div className="px-3.5 pb-3">
          <MfgNote tone="warn">{t("mfo_cost_unpriced")}</MfgNote>
        </div>
      )}
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Checklists — non-blocking, signed and timed
// ---------------------------------------------------------------------------

function ChecklistsSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const [busy, setBusy] = useState<string | null>(null)
  const c = view.calc
  if (!ui.data.settings.features.checklists) return null
  const seen = new Set<string>()
  const steps = c.route
    .map((r, i) => ({ r, i, dept: stationOf(ui, r.departmentId) }))
    .filter(({ r, i, dept }) => {
      if (seen.has(r.departmentId) || !((c.done[i] || 0) > 0 || (c.pend[i] || 0) > 0) || !dept?.checklist?.length) return false
      seen.add(r.departmentId)
      return true
    })
  if (!steps.length) return null
  const marks = c.slice.checklists || {}
  const total = steps.reduce((a, s) => a + (s.dept?.checklist || []).length, 0)
  const marked = steps.reduce((a, s) => a + (s.dept?.checklist || []).filter((x) => marks[s.r.departmentId]?.[x.key]).length, 0)

  const toggle = async (departmentId: string, key: string) => {
    if (!firestore || busy) return
    setBusy(`${departmentId}_${key}`)
    try {
      await toggleChecklistItem(firestore, { orderId: view.id, departmentId, itemKey: key, actor: ui.data.actor })
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <MfgSection collapsible defaultOpen={false} icon={ClipboardCheck} title={t("mfo_sec_checklists")} right={<span className={cn("text-[11px] tabular-nums", marked === total ? "text-success" : "text-warning")}>{t("mfo_count_of", { done: marked, total })}</span>}>
      {steps.map(({ r, i, dept }) => {
        const list = dept?.checklist || []
        const m = marks[r.departmentId] || {}
        const count = list.filter((x) => m[x.key]).length
        const allowed = view.live && canTickChecklist(ui, r.departmentId)
        return (
          <div key={r.departmentId}>
            <div className="flex items-center justify-between bg-muted/30 px-3.5 py-1.5 text-[11px] font-bold">
              {departmentNameOf(ui.data.departments, view, i)}
              <MfgChip tone={count === list.length ? "ok" : "warn"}>{t("mfo_count_of", { done: count, total: list.length })}</MfgChip>
            </div>
            {list.map((x) => {
              const mark = m[x.key]
              const key = `${r.departmentId}_${x.key}`
              const box = (
                <span className="flex items-center gap-2">
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border-2", mark ? "border-success bg-success text-white" : "border-slate-300")}>
                    {busy === key ? <Loader2 size={11} className="animate-spin text-muted-foreground" /> : mark ? <Check size={12} aria-hidden="true" /> : null}
                  </span>
                  <span className="font-semibold">{x.label}</span>
                </span>
              )
              const right = <span className="text-[10px] text-muted-foreground">{mark ? `${mark.by} · ${d.relative(mark.at)}` : t("mfo_not_logged")}</span>
              return allowed ? (
                <MfgRow key={x.key} onClick={() => void toggle(r.departmentId, x.key)} right={right} className="min-h-[44px]">
                  {box}
                </MfgRow>
              ) : (
                <MfgRow key={x.key} right={right}>
                  {box}
                </MfgRow>
              )
            })}
          </div>
        )
      })}
      <p className="border-t border-border/60 px-3.5 py-2 text-[10px] text-muted-foreground">{t("mfo_checklists_note")}</p>
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// What goes to Finance (FN-03)
// ---------------------------------------------------------------------------

function FinanceSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const events = financeEvents(view, data.settings)
  return (
    <MfgSection collapsible defaultOpen={false} icon={Landmark} title={t("mfo_sec_finance")} right={<span className="text-[11px] text-muted-foreground">{t("mfo_events_count", { count: events.length })}</span>}>
      {!events.length && <p className="px-3.5 py-3 text-xs text-muted-foreground">{t("mfo_fin_none")}</p>}
      {events.map((e, i) => (
        <MfgRow
          key={`${e.kind}_${i}`}
          right={
            <>
              {e.value !== 0 && (
                <b>
                  <Num>{fmtMoney(e.value)}</Num> {t("mfg4_sar")}
                </b>
              )}
              <MfgChip tone={e.state === "posted" ? "ok" : e.state === "pending" ? "warn" : "muted"}>{t(`mfo_fin_state_${e.state}`)}</MfgChip>
            </>
          }
        >
          <span className="block font-semibold">{t(`mfo_fin_${e.kind}`, { qty: fmtQty(e.quantity ?? 0), unit: view.unit, ref: e.ref || "" })}</span>
          <span className="block text-[10px] text-muted-foreground">{t(`mfo_fin_${e.kind}_d`)}</span>
        </MfgRow>
      ))}
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Document trail
// ---------------------------------------------------------------------------

function TrailSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const items = documentTrail(view, data.estimates)
  return (
    <MfgSection collapsible defaultOpen={false} icon={Layers} title={t("mfo_sec_trail")}>
      {items.map((it, i) => (
        <MfgRow
          key={`${it.kind}_${i}`}
          right={
            <>
              <MfgModuleChip module={it.module} />
              {it.done && <CheckCircle2 size={14} className="text-success" aria-label={t("mfo_done")} />}
            </>
          }
        >
          <span className="block font-semibold">
            {t(`mfo_trail_${it.kind}`)}
            {it.ref && (
              <>
                {" · "}
                <Num>{it.ref}</Num>
              </>
            )}
          </span>
          {it.detail && <span className="block text-[10px] text-muted-foreground">{it.detail}</span>}
        </MfgRow>
      ))}
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// Log — every decision in its owner's name
// ---------------------------------------------------------------------------

const LOG_ICON: Array<[RegExp, ElementType]> = [
  [/^created/, FileText],
  [/^survey/, Ruler],
  [/^released/, Play],
  [/^rushed/, Zap],
  [/^drawing/, PencilRuler],
  [/^slab/, Eye],
  [/^materials_override/, AlertTriangle],
  [/^materials/, Boxes],
  [/^rejected|^qc_rework/, AlertTriangle],
  [/^qc_/, ClipboardCheck],
  [/^scrap/, Trash2],
  [/^remnant/, Warehouse],
  [/^purchase/, ShoppingCart],
  [/^closed/, CheckCircle2],
  [/^note/, Truck],
  [/^cancelled/, Lock],
  [/^remake|^shortfall/, Undo2],
  [/^quantity_changed/, ArrowRightLeft],
  [/^variance/, Coins],
]

function useLogText(view: OrderView) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const defectWord = (code: string) => ((DEFECT_KINDS as readonly string[]).includes(code) ? t(`mfg4_defect_${code}`) : code)
  /** "crack · s12 — reason" → readable words. */
  const tag = (detail: string | null | undefined) => {
    if (!detail) return ""
    const [head, ...rest] = detail.split(" — ")
    const parts = head.split(" · ")
    const words = [parts[0] ? defectWord(parts[0]) : "", parts[1] ? causeLabel(parts[1], ui, t) : "", ...parts.slice(2)].filter(Boolean).join(" · ")
    return [words, rest.join(" — ")].filter(Boolean).join(" — ")
  }
  return (it: LogItem): string => {
    const base = { qty: fmtQty(it.quantity ?? 0), unit: view.unit, ref: it.ref || "", detail: it.detail || "" }
    switch (it.kind) {
      case "rejected": {
        const [defect, cause] = (it.detail || "").split("|")
        return t("mfo_log_rejected", { ...base, dept: deptName(ui.data.departments, it.ref, it.ref || ""), defect: defectWord(defect || "other"), cause: causeLabel(cause, ui, t) })
      }
      case "materials_requested":
        return t("mfo_log_materials_requested", { ref: it.ref || "", count: it.quantity ?? 0 })
      case "scrap_approved": {
        const words = (it.detail || "")
          .split(" · ")
          .filter(Boolean)
          .map((x) => (t.has(`mfo_scrap_class_${x}`) ? t(`mfo_scrap_class_${x}`) : t.has(`mfo_bearer_${x}`) ? t(`mfo_bearer_${x}`) : x))
          .join(" · ")
        return t("mfo_log_scrap_approved", { ...base, detail: words })
      }
      case "qc_rework":
      case "qc_concession":
        return t(`mfo_log_${it.kind}`, { ...base, detail: tag(it.detail) })
      case "variance_reviewed": {
        const [cause, ...note] = (it.detail || "").split(" — ")
        const causeWord = t.has(`mfo_var_${cause}`) ? t(`mfo_var_${cause}`) : cause
        return t("mfo_log_variance_reviewed", { ...base, detail: [causeWord, note.join(" — ")].filter(Boolean).join(" — ") })
      }
      default: {
        const key = `mfo_log_${it.kind}`
        if (t.has(key)) return t(key, base)
        return it.detail ? t("mfo_log_generic_detail", { detail: it.detail }) : t("mfo_log_generic")
      }
    }
  }
}

function LogSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const d = useMfgDate()
  const text = useLogText(view)
  const items = useMemo(() => {
    const seen = new Set<string>()
    return orderLog(view).filter((it) => {
      const k = `${it.kind}|${it.by || ""}|${it.at.slice(0, 16)}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [view])
  if (!items.length) return null
  return (
    <MfgSection collapsible defaultOpen={false} icon={BookOpen} title={t("mfo_sec_log")}>
      <ol className="space-y-3 px-3.5 py-3">
        {items.map((it, i) => {
          const Icon = LOG_ICON.find(([re]) => re.test(it.kind))?.[1] || Clock
          return (
            <li key={`${it.kind}_${i}`} className="relative flex gap-2.5">
              {i < items.length - 1 && <span className="absolute start-[11px] top-6 h-full w-px bg-border" aria-hidden="true" />}
              <span
                className={cn(
                  "z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                  it.tone === "ok" ? "bg-success/10 text-success" : it.tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                )}
              >
                <Icon size={12} aria-hidden="true" />
              </span>
              <div className="min-w-0 text-xs">
                <p className="font-semibold leading-relaxed">{text(it)}</p>
                <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  {[it.by, d.short(it.at)].filter(Boolean).join(" · ")}
                  {it.module && it.module !== "manufacturing" && <MfgModuleChip module={it.module} />}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </MfgSection>
  )
}

// ---------------------------------------------------------------------------
// More — the manager's changes, overrides, a block notice, a variance review
// ---------------------------------------------------------------------------

function MoreSection({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms } = ui
  const c = view.calc
  const items: ReactNode[] = []
  if (perms.canManage && view.live) {
    if (view.source === "stock" && !c.slice.changeRequest) {
      items.push(
        <Button key="change" type="button" variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => ui.openAction(view.id, { kind: "change" })}>
          <ArrowRightLeft size={13} aria-hidden="true" /> {t("mfo_more_amend")}
        </Button>
      )
    }
    if (view.source !== "stock") {
      items.push(
        <span key="locked" className="flex w-full items-start gap-1.5 text-[11px] text-muted-foreground">
          <Lock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t("mfo_more_locked", { module: t(view.source === "client" ? "mfg4_module_sales" : "mfg4_module_procurement") })}
        </span>
      )
    }
    c.active.forEach((i) => {
      const step = c.route[i]
      if (!step || c.gates[i] || c.slice.overrides[step.departmentId]) return
      if (!stationBlocks(c, i).some((b) => b.key === "materials")) return
      items.push(
        <Button key={`ovr_${i}`} type="button" variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => ui.openAction(view.id, { kind: "override", index: i })}>
          <AlertTriangle size={13} aria-hidden="true" /> {t("mfo_more_override", { dept: departmentNameOf(data.departments, view, i) })}
        </Button>
      )
    })
  }
  const lot = c.slice.slabApproval?.lot
  if (view.live && lot && (perms.canQc || perms.canManage)) {
    items.push(
      <Button key="notice" type="button" variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => ui.openGlobal({ kind: "blockNotice", lot })}>
        <AlertTriangle size={13} aria-hidden="true" /> {t("mfo_more_notice", { lot })}
      </Button>
    )
  }
  if (perms.canCost && view.variance) {
    const v = view.variance
    items.push(
      <Button key="var" type="button" variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => ui.openAction(view.id, { kind: "variance", departmentId: v.departmentId })}>
        <Coins size={13} aria-hidden="true" /> {t("mfo_more_variance", { dept: deptName(data.departments, v.departmentId), pct: v.percent })}
      </Button>
    )
  }
  if (!items.length) return null
  return (
    <MfgSection collapsible defaultOpen={false} icon={MoreHorizontal} title={t("mfo_sec_more")}>
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">{items}</div>
    </MfgSection>
  )
}

