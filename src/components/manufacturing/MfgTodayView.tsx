"use client"

// Today (اليوم) — what needs a decision now, sorted by impact, one action per
// line and that action one click away; what is on its way to you; and, for the
// people who plan, each department's load and the bottleneck. Everything is the
// engine's output over live data — this screen stores nothing.

import { useMemo, useState, type ElementType } from "react"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  CheckCircle2,
  Clock,
  Coins,
  Eye,
  FileText,
  Hourglass,
  Inbox,
  PackageCheck,
  PencilRuler,
  Play,
  Ruler,
  Trash2,
  Truck,
  Undo2,
  Warehouse,
} from "lucide-react"
import { useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { pendingAt, stationLoadHours, stationQueueDays, estimateCost, type Decision } from "@/lib/manufacturing-engine"
import type { OrderView } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { departmentNameOf, sourceNameOf } from "./MfgOrderBits"
import { MfgChip, MfgEmpty, MfgLoadBar, MfgNote, MfgPanel, departmentIcon, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"

interface DecisionLine {
  key: string
  tone: "bad" | "warn" | "info"
  icon: ElementType
  title: string
  sub: string
  cta: string
  onClick: () => void
}

const PAGE = 8

export function MfgTodayView() {
  const t = useTranslations("Portal.Shared")
  const router = useRouter()
  const ui = useMfgUi()
  const { data, perms, viewById, base } = ui
  const d = useMfgDate()
  const [shown, setShown] = useState(PAGE)


  function describe(dec: Decision, i: number): DecisionLine | null {
    const tone: DecisionLine["tone"] = dec.weight >= 30 ? "bad" : dec.weight >= 24 ? "warn" : "info"
    const key = `${dec.kind}_${dec.orderId || dec.requestId || dec.estimateId || ""}_${i}`
    const v: OrderView | undefined = dec.orderId ? viewById.get(dec.orderId) : undefined
    const order = v ? `#${v.number}` : ""
    const product = v ? t("mfg3_today_product_qty", { product: v.product.name, qty: fmtQty(v.quantity), unit: v.unit }) : ""
    const source = v ? sourceNameOf(v, t) : ""
    const deptIndex = v && dec.departmentId ? v.product.route.findIndex((r) => r.departmentId === dec.departmentId) : -1
    const dept = v && deptIndex >= 0 ? departmentNameOf(data.departments, v, deptIndex) : ""
    const openOrder = () => v && ui.openOrder(v.id)

    switch (dec.kind) {
      case "answer_request": {
        const r = data.requests.find((x) => x.id === dec.requestId)
        if (!r) return null
        const hours = r.requestedAt ? (Date.now() - new Date(r.requestedAt).getTime()) / 3600000 : 0
        const overdue = hours >= data.settings.answerWindowHours
        const who = r.contactName || r.projectName || r.createdByUserName
        return {
          key,
          tone: overdue ? "bad" : "warn",
          icon: Inbox,
          title: t("mfg3_today_answer_request", { number: r.requestNumber }),
          sub: [who, t("mfg3_today_lines", { count: r.lines?.length || 1 }), overdue ? t("mfg3_today_answer_overdue", { rel: d.relative(r.requestedAt) }) : t("mfg3_today_arrived", { rel: d.relative(r.requestedAt) })].filter(Boolean).join(" · "),
          cta: t("mfg3_today_cta_answer"),
          onClick: () => router.push(`${base}/requests?open=${r.id}`),
        }
      }
      case "send_estimate":
      case "log_quote":
      case "chase_quote": {
        const e = data.estimates.find((x) => x.id === dec.estimateId)
        if (!e) return null
        const cost = perms.seesMoney ? t("mfg3_today_cost", { value: fmtMoney(estimateCost(e)) }) : null
        const title =
          dec.kind === "send_estimate"
            ? t("mfg3_today_send_estimate", { number: e.estimateNumber })
            : dec.kind === "log_quote"
              ? t("mfg3_today_log_quote", { number: e.estimateNumber })
              : t("mfg3_today_chase_quote", { number: e.quoteNumber || e.estimateNumber })
        const cta = dec.kind === "send_estimate" ? t("mfg3_today_cta_send") : dec.kind === "log_quote" ? t("mfg3_today_cta_log") : t("mfg3_today_cta_result")
        return {
          key,
          tone,
          icon: Coins,
          title,
          sub: [e.contactName, e.requestedBy, cost, e.quotedPrice && perms.seesMoney ? t("mfg3_today_quoted", { value: fmtMoney(e.quotedPrice) }) : null].filter(Boolean).join(" · "),
          cta,
          onClick: () => router.push(`${base}/requests?seg=estimates&open=${e.id}`),
        }
      }
      case "release_ready":
        if (!v) return null
        return { key, tone: "info", icon: Play, title: t("mfg3_today_release_ready", { order }), sub: [product, source, t("mfg3_today_due", { date: d.short(v.neededBy) })].join(" · "), cta: t("mfg3_today_cta_release"), onClick: () => ui.openAction(v.id, { kind: "release" }) }
      case "release_blocked": {
        if (!v) return null
        const measurement = v.releaseBlocks.some((b) => b.key === "measurement")
        return {
          key,
          tone: "bad",
          icon: measurement ? Ruler : AlertTriangle,
          title: t("mfg3_today_release_blocked", { order, block: t(`mfg3_block_${measurement ? "measurement" : "quote"}`) }),
          sub: [product, t(`mfg3_block_${measurement ? "measurement" : "quote"}_fix`)].join(" · "),
          cta: measurement ? t("mfg3_today_cta_measure") : t("mfg3_today_cta_review"),
          onClick: measurement ? () => ui.openAction(v.id, { kind: "measurement" }) : openOrder,
        }
      }
      case "record_slab":
        if (!v) return null
        return { key, tone: "bad", icon: Eye, title: t("mfg3_today_record_slab", { order }), sub: [product, source].join(" · "), cta: t("mfg3_today_cta_slab"), onClick: () => ui.openAction(v.id, { kind: "slab" }) }
      case "chase_drawing":
        if (!v) return null
        return {
          key,
          tone,
          icon: PencilRuler,
          title: t("mfg3_today_chase_drawing", { order, rel: d.relative(v.order.createdAtIso) }),
          sub: [t("mfg3_today_cutting_blocked"), product].join(" · "),
          cta: perms.canManage ? t("mfg3_today_cta_drawing") : t("mfg3_today_cta_review"),
          onClick: perms.canManage ? () => ui.openAction(v.id, { kind: "drawing" }) : openOrder,
        }
      case "materials_missing":
        if (!v || !dec.departmentId) return null
        return {
          key,
          tone: "warn",
          icon: Boxes,
          title: t("mfg3_today_materials_missing", { dept, order }),
          sub: t("mfg3_today_materials_missing_sub", { qty: fmtQty(deptIndex >= 0 ? pendingAt(v.slice, v.product.route, deptIndex, v.noteSlices) : 0), unit: v.unit }),
          cta: t("mfg3_today_cta_materials"),
          onClick: () => ui.openAction(v.id, { kind: "materials", departmentId: dec.departmentId! }),
        }
      case "confirm_materials":
        if (!v) return null
        return { key, tone: "warn", icon: PackageCheck, title: t("mfg3_today_confirm_materials", { dept, order }), sub: product, cta: t("mfg3_today_cta_confirm"), onClick: openOrder }
      case "qc_decision":
        if (!v) return null
        return {
          key,
          tone: "warn",
          icon: AlertTriangle,
          title: t("mfg3_today_qc", { qty: fmtQty(dec.quantity || 0), unit: v.unit, dept }),
          sub: [order, t("mfg3_today_qc_sub")].join(" · "),
          cta: t("mfg3_today_cta_decide"),
          onClick: () => ui.openAction(v.id, { kind: "qc", index: Math.max(0, deptIndex) }),
        }
      case "approve_scrap": {
        if (!v) return null
        const scrap = v.slice.scrap.find((s) => s.status === "pending")
        const allowed = scrap && (perms.canCost || (perms.canManage && scrap.value <= data.settings.scrapApprovalLimit))
        return {
          key,
          tone: "bad",
          icon: Trash2,
          title: perms.seesMoney ? t("mfg3_today_scrap_value", { qty: fmtQty(scrap?.quantity || 0), unit: v.unit, value: fmtMoney(dec.value || 0) }) : t("mfg3_today_scrap", { qty: fmtQty(scrap?.quantity || 0), unit: v.unit }),
          sub: [order, scrap?.reason, allowed ? null : t("mfg3_today_scrap_above_limit")].filter(Boolean).join(" · "),
          cta: allowed ? t("mfg3_today_cta_approve") : t("mfg3_today_cta_review"),
          onClick: allowed && scrap ? () => ui.openAction(v.id, { kind: "approveScrap", scrapId: scrap.id }) : openOrder,
        }
      }
      case "issue_note":
        if (!v) return null
        return { key, tone: "warn", icon: Truck, title: t("mfg3_today_issue_note", { qty: fmtQty(dec.quantity || 0), unit: v.unit, order }), sub: [source, t("mfg3_today_issue_note_sub")].join(" · "), cta: t("mfg3_today_cta_note"), onClick: () => ui.openAction(v.id, { kind: "note" }) }
      case "confirm_note": {
        if (!v) return null
        const n = v.notes.find((x) => x.id === dec.noteId)
        if (!n) return null
        const late = d.dayDiff(n.sentAt) <= -2
        return {
          key,
          tone: late ? "bad" : "warn",
          icon: PackageCheck,
          title: t("mfg3_today_confirm_note", { note: n.noteNumber, rel: d.relative(n.sentAt) }),
          sub: [t("mfg3_today_note_to", { qty: fmtQty(n.item.quantity), unit: n.item.unit, dest: n.toWarehouseName }), source, t("mfg3_today_confirm_note_sub")].join(" · "),
          cta: t("mfg3_today_cta_confirm"),
          onClick: () => ui.openAction(v.id, { kind: "confirmNote", noteId: n.id }),
        }
      }
      case "breakage_decision":
        if (!v) return null
        return { key, tone: "bad", icon: Undo2, title: t("mfg3_today_breakage", { qty: fmtQty(dec.quantity || 0), unit: v.unit, order }), sub: [source, t("mfg3_today_breakage_sub")].join(" · "), cta: t("mfg3_today_cta_decide"), onClick: () => ui.openAction(v.id, { kind: "breakage" }) }
      case "hour_variance":
        if (!v) return null
        return { key, tone, icon: Hourglass, title: t("mfg3_today_variance", { dept, order }), sub: [product, source].join(" · "), cta: t("mfg3_today_cta_review"), onClick: openOrder }
      case "will_miss_date": {
        if (!v) return null
        const wait = v.schedule?.waitDepartmentId ? data.departments.find((x) => x.id === v.schedule!.waitDepartmentId)?.name : null
        return {
          key,
          tone: "bad",
          icon: Clock,
          title: v.overdue ? t("mfg3_today_overdue", { order, days: v.lateDays }) : t("mfg3_today_will_miss", { order, days: v.lateDays }),
          sub: [source, wait ? t("mfg3_today_reason_queue", { dept: wait }) : t("mfg3_today_reason_volume")].join(" · "),
          cta: t("mfg3_today_cta_replan"),
          onClick: openOrder,
        }
      }
    }
  }

  const lines = ui.decisions.map((dec, i) => describe(dec, i)).filter(Boolean) as DecisionLine[]

  const incoming = useMemo(() => {
    const out: Array<{ key: string; icon: ElementType; title: string; sub: string; chip?: string; onClick?: () => void }> = []
    if (perms.canWork || perms.canManage || perms.canReceive) {
      for (const v of ui.views) {
        if (!v.live) continue
        const byRequest = new Map<string, typeof v.slice.materials>()
        for (const m of v.slice.materials) if (m.state === "requested") byRequest.set(m.requestNumber, [...(byRequest.get(m.requestNumber) || []), m])
        for (const [rn, rows] of byRequest) {
          const i = v.product.route.findIndex((r) => r.departmentId === rows[0].departmentId)
          out.push({
            key: `wd_${v.id}_${rn}`,
            icon: Warehouse,
            title: t("mfg3_today_in_withdrawal", { request: rn }),
            sub: t("mfg3_today_in_withdrawal_sub", { order: `#${v.number}`, dept: i >= 0 ? departmentNameOf(data.departments, v, i) : "", rel: d.relative(rows[0].requestedAt) }),
            chip: t("mfg3_module_inventory"),
            onClick: () => ui.openOrder(v.id),
          })
        }
      }
    }
    if (data.settings.features.time) {
      for (const v of ui.views) {
        if (!v.live || !v.released || v.ready > 0 || !v.schedule || v.schedule.finishDays > 3) continue
        out.push({ key: `fin_${v.id}`, icon: CheckCircle2, title: t("mfg3_today_in_finishing", { order: `#${v.number}`, rel: d.relative(v.possibleDate) }), sub: t("mfg3_today_product_qty", { product: v.product.name, qty: fmtQty(v.quantity), unit: v.unit }), onClick: () => ui.openOrder(v.id) })
      }
    }
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    for (const r of data.requests) {
      if (r.status === "new" || !r.decidedAt || r.decidedAt < weekAgo) continue
      out.push({
        key: `req_${r.id}`,
        icon: FileText,
        title: t(r.status === "rejected" ? "mfg3_today_in_request_returned" : "mfg3_today_in_request_answered", { number: r.requestNumber }),
        sub: [r.decidedByUserName, d.relative(r.decidedAt), r.answerNote || r.rejectionReason].filter(Boolean).join(" · "),
        onClick: () => router.push(`${base}/requests?open=${r.id}`),
      })
    }
    if (perms.canCost && data.settings.features.estimates) {
      for (const e of data.estimates) {
        if (e.state !== "quoted") continue
        out.push({
          key: `quo_${e.id}`,
          icon: ArrowLeftRight,
          title: t("mfg3_today_in_quote", { quote: e.quoteNumber || e.estimateNumber, client: e.contactName || "—" }),
          sub: e.quotedPrice ? t("mfg3_today_quoted", { value: fmtMoney(e.quotedPrice) }) : "",
          chip: t("mfg3_module_sales"),
          onClick: () => router.push(`${base}/requests?seg=estimates&open=${e.id}`),
        })
      }
    }
    return out
  }, [ui, data, perms, d, t, router, base])

  const showLoad = data.settings.features.time && (perms.canManage || perms.canCost) && data.departments.length > 0
  const loads = showLoad ? data.departments.map((dep) => ({ dep, days: stationQueueDays(data.scheduleInputs, dep), hours: stationLoadHours(data.scheduleInputs, dep.id) })) : []
  const maxDays = Math.max(1, ...loads.map((l) => l.days))
  const bn = ui.kpis.bottleneck

  const hasAnyRole = perms.canManage || perms.canWork || perms.canQc || perms.canCost || perms.canReceive || perms.canRequest

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        <MfgPanel title={t("mfg3_today_decisions")} subtitle={t("mfg3_today_decisions_sub")} count={lines.length}>
          {!data.ready ? (
            <div className="space-y-2 p-4" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />
              ))}
            </div>
          ) : lines.length === 0 ? (
            <MfgEmpty icon={CheckCircle2} title={t("mfg3_today_nothing")} hint={hasAnyRole ? t("mfg3_today_nothing_hint") : t("mfg3_today_no_role_hint")} />
          ) : (
            <ul>
              {lines.slice(0, shown).map((l) => {
                const Icon = l.icon
                return (
                  <li key={l.key} className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 sm:flex-nowrap">
                    <span className={cn("h-9 w-1 shrink-0 rounded-full", l.tone === "bad" ? "bg-destructive" : l.tone === "warn" ? "bg-warning" : "bg-cta")} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug text-foreground">{l.title}</p>
                      {l.sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{l.sub}</p>}
                    </div>
                    <Button size="sm" variant={l.tone === "bad" ? "default" : "outline"} className="h-9 shrink-0 gap-1.5 text-xs" onClick={l.onClick}>
                      <Icon size={13} aria-hidden="true" /> {l.cta}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          {lines.length > shown && (
            <button type="button" onClick={() => setShown((s) => s + PAGE)} className="w-full border-t bg-muted/30 py-2.5 text-xs font-semibold text-cta hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              {t("mfg3_show_more", { count: lines.length - shown })}
            </button>
          )}
        </MfgPanel>

        {showLoad && (
          <MfgPanel title={t("mfg3_today_load")} subtitle={t("mfg3_today_load_sub")}>
            <ul>
              {loads.map(({ dep, days, hours }) => {
                const Icon = departmentIcon(dep.name, dep.onSite)
                const isBn = bn?.departmentId === dep.id
                return (
                  <li key={dep.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 text-xs last:border-b-0">
                    <span className="flex w-40 shrink-0 items-center gap-1.5 truncate font-semibold">
                      <Icon size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" /> {dep.name}
                    </span>
                    <MfgLoadBar ratio={days / maxDays} tone={isBn ? "bad" : days > 2 ? "warn" : "ok"} />
                    <span className="w-28 shrink-0 text-end tabular-nums text-muted-foreground">{t("mfg3_today_load_value", { days: fmtQty(days), hours: fmtQty(hours) })}</span>
                    {isBn && <MfgChip tone="bad">{t("mfg3_bottleneck")}</MfgChip>}
                  </li>
                )
              })}
            </ul>
            {bn && (
              <MfgNote tone="info" className="m-3">
                {t("mfg3_today_bottleneck_note", { dept: data.departments.find((x) => x.id === bn.departmentId)?.name || "", days: bn.days })}
              </MfgNote>
            )}
          </MfgPanel>
        )}
      </div>

      <MfgPanel title={t("mfg3_today_incoming")} subtitle={t("mfg3_today_incoming_sub")} count={incoming.length}>
        {incoming.length === 0 ? (
          <MfgEmpty icon={Truck} title={t("mfg3_today_incoming_empty")} />
        ) : (
          <ul>
            {incoming.slice(0, 12).map((x) => {
              const Icon = x.icon
              return (
                <li key={x.key}>
                  <button
                    type="button"
                    onClick={x.onClick}
                    className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-start last:border-b-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cta/10 text-cta">
                      <Icon size={14} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-foreground">{x.title}</span>
                      {x.sub && <span className="block text-[11px] text-muted-foreground">{x.sub}</span>}
                    </span>
                    {x.chip && <MfgChip tone="accent">{x.chip}</MfgChip>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </MfgPanel>
    </div>
  )
}
