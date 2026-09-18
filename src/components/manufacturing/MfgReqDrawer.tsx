"use client"

// The request panel — nobody answers a request before reading it (REQ-03).
// Top to bottom: the requester's note, the overdue banner once the window has
// passed, when it is needed and what making all of it costs, every line with
// its computed verdict and reason, the slab it needs against what is free,
// then the answer and the work orders it became, where it came from and where
// the answer returns — and the manager's one button last.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Calculator, Check, ClipboardList, Clock, Layers, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { addDaysISO } from "@/lib/manufacturing-engine"
import { answerWindow, awaitsDownPayment, estimateStatus, screenRequest, summarizeScreen, workOrderIdsOf } from "@/lib/manufacturing-requests"
import { useMfgUi } from "./MfgUiContext"
import { MfgModuleChip, MfgStatePill } from "./MfgOrderBits"
import {
  DownPaymentChip,
  EstimateStatusPill,
  RequestRefs,
  RequestSourceChip,
  RequestStatePill,
  SlabNeedText,
  VerdictPill,
  ageText,
  answerText,
  productUnitOf,
  requestTitle,
  sourceIcon,
  useAgo,
  useScreenContext,
  useSourceInfo,
  useVerdictReason,
} from "./MfgReqBits"
import { MfgDrawer, MfgNote, MfgRow, MfgSection, MfgStat, fmtMoney, fmtSar, fmtQty, useMfgDate } from "./ui/MfgUi"

export function MfgReqDrawer({ requestId, onClose }: { requestId: string | null; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms, seesMoney, nowMs, today } = ui
  const date = useMfgDate()
  const ago = useAgo()
  const ctx = useScreenContext()
  const reason = useVerdictReason()
  const request = requestId ? data.requests.find((r) => r.id === requestId) || null : null
  const info = useSourceInfo(request)
  const lines = useMemo(() => (request ? screenRequest(request, ctx) : []), [request, ctx])
  const summary = useMemo(() => summarizeScreen(lines), [lines])

  if (!request || !info) return null

  const r = request
  const isNew = r.status === "new"
  const timeOn = data.settings.features.time
  const forPlanning = awaitsDownPayment(r, r.orderId ? data.salesOrders.get(r.orderId) : null)
  const win = answerWindow(r, data.settings.answerWindowHours, nowMs, forPlanning)
  const Icon = sourceIcon(info)
  const moduleName = t(`mfg4_module_${info.source}`)
  const orderIds = workOrderIdsOf(r)
  const estimate = r.estimateId ? data.estimates.find((e) => e.id === r.estimateId) || null : null
  const inDays = (days: number | null) => (days == null ? "—" : date.short(addDaysISO(today, days)))

  const answer = () => {
    onClose()
    ui.openGlobal({ kind: "answerRequest", requestId: r.id })
  }

  return (
    <MfgDrawer
      open
      onClose={onClose}
      icon={Icon}
      title={<span dir="auto">{requestTitle(r, info, t)}</span>}
      meta={
        <>
          <RequestSourceChip info={info} />
          <b className="text-slate-700">{t(`mfr_kind_${info.kind}`)}</b>
          <RequestRefs info={info} />
          <span>
            · {t("mfr_requested_by")} <b className="text-slate-700">{r.createdByUserName}</b>
          </span>
          <DownPaymentChip state={info.downPayment} />
          <RequestStatePill request={r} />
        </>
      }
      footer={
        isNew ? (
          perms.canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-10 gap-1.5" onClick={answer}>
                <Check size={14} aria-hidden="true" /> {info.kind === "cost" ? t("mfr_cost_or_decline") : t("mfr_accept_or_decline")}
              </Button>
              <span className="text-[11px] text-muted-foreground">{t("mfr_answer_returns", { module: moduleName })}</span>
            </div>
          ) : (
            <MfgNote tone="info" icon={Lock}>
              {t("mfr_only_manager_answers")}
            </MfgNote>
          )
        ) : undefined
      }
    >
      {r.note && (
        <MfgNote tone="info">
          <span dir="auto">{r.note}</span>
        </MfgNote>
      )}
      {/* The advance was reported, not confirmed: plan, do not execute — and the
          answer clock starts only once Finance confirms (Sales PRD PAY-07, D8). */}
      {isNew && forPlanning && (
        <MfgNote tone="warn" icon={Clock} title={t("mfr_planning_title")}>
          {t("mfr_planning_body")}
        </MfgNote>
      )}
      {isNew && win.overdue && (
        <MfgNote tone="bad" icon={Clock} title={t("mfr_overdue_title", { age: ageText(t, win.ageHours) })}>
          {t("mfr_overdue_body", { hours: data.settings.answerWindowHours })}
        </MfgNote>
      )}

      <div className="grid grid-cols-2 gap-2">
        <MfgStat label={t("mfr_needed_by")} value={date.short(r.neededBy)} sub={r.neededBy ? date.relative(r.neededBy) : undefined} />
        {seesMoney ? (
          <MfgStat
            label={t("mfr_full_make_cost")}
            value={
              <span dir="ltr" className="tabular-nums">
                {fmtSar(summary.fullCost)}
              </span>
            }
            sub={summary.unscreened ? t("mfr_unscreened", { count: summary.unscreened }) : !summary.allPriced ? t("mfr_cost_incomplete") : undefined}
          />
        ) : (
          <MfgStat label={t("mfr_earliest_ready")} value={timeOn ? inDays(summary.earliestDays) : "—"} />
        )}
      </div>

      <MfgSection icon={ClipboardList} title={t("mfr_sec_lines")}>
        {lines.map((l) => {
          const unit = productUnitOf(l)
          return (
            <div key={l.index} className="flex flex-col gap-2 border-b border-border/60 px-3.5 py-3 text-xs last:border-b-0 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1 space-y-0.5 text-muted-foreground">
                <p className="font-bold text-foreground" dir="auto">
                  {l.product?.name || l.line.itemName} — <span dir="ltr" className="tabular-nums">{fmtQty(l.line.quantity)}</span> {unit}
                </p>
                {seesMoney && l.std && l.verdict && (
                  <p>
                    {t("mfr_line_cost")}{" "}
                    <b dir="ltr" className="tabular-nums text-foreground">
                      {fmtSar(l.std.total)}
                    </b>
                    {" · "}
                    {t("mfr_line_per_unit", { amount: fmtMoney(l.verdict.unitCost) })}
                    {l.verdict.buyPrice != null && l.verdict.buyPrice > 0 && <> · {t("mfr_line_buy", { amount: fmtMoney(l.verdict.buyPrice) })}</>}
                  </p>
                )}
                {timeOn && l.verdict && (
                  <p>
                    {t("mfr_earliest_ready")} <b className="text-foreground">{inDays(l.possibleDays)}</b>
                  </p>
                )}
                <SlabNeedText line={l} />
              </div>
              <div className="sm:max-w-[45%] sm:text-end">
                <VerdictPill verdict={l.verdict} />
                <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{reason(l, r)}</span>
              </div>
            </div>
          )
        })}
      </MfgSection>

      {!isNew && (
        <MfgSection icon={Check} title={t("mfr_sec_answer")}>
          <MfgRow>
            <p className="font-bold text-foreground" dir="auto">
              {answerText(r, t)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {r.decidedByUserName}
              {r.decidedAt && (
                <>
                  {r.decidedByUserName ? " · " : ""}
                  {date.short(r.decidedAt)} · {ago(r.decidedAt)}
                </>
              )}
            </p>
          </MfgRow>
          {orderIds.map((id, i) => {
            const v = ui.viewById.get(id)
            if (!v) {
              const ref = r.workOrderDocNumbers?.[i]
              return ref ? (
                <MfgRow key={id}>
                  <b dir="ltr">{ref}</b>
                </MfgRow>
              ) : null
            }
            return (
              <MfgRow
                key={id}
                onClick={() => {
                  onClose()
                  ui.openOrder(id)
                }}
                right={<MfgStatePill view={v} />}
              >
                <b dir="ltr" className="font-mono">
                  {v.ref}
                </b>{" "}
                <span className="text-muted-foreground" dir="auto">
                  {v.product.name} × <span dir="ltr">{fmtQty(v.quantity)}</span> {v.unit}
                </span>
              </MfgRow>
            )
          })}
          {estimate && (
            <MfgRow right={<EstimateStatusPill status={estimateStatus(estimate, today, data.settings)} />}>
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Calculator size={13} className="text-warning" aria-hidden="true" />
                <span dir="ltr">{estimate.estimateNumber}</span>
              </span>
            </MfgRow>
          )}
        </MfgSection>
      )}

      <MfgSection icon={Layers} title={t("mfr_sec_source")}>
        {info.source === "procurement" ? (
          <>
            {r.pmRequestRef && (
              <MfgRow right={<MfgModuleChip module="projects" />}>
                <b dir="ltr">{r.pmRequestRef}</b>
                <p className="text-[11px] text-muted-foreground" dir="auto">
                  {r.costItemName ? t("mfr_src_pm_request_item", { item: r.costItemName }) : t("mfr_src_pm_request")}
                </p>
              </MfgRow>
            )}
            <MfgRow right={<MfgModuleChip module="procurement" />}>
              <b dir="ltr">{r.purchaseRequestRef || "—"}</b>
              <p className="text-[11px] text-muted-foreground">{t("mfr_src_procurement")}</p>
            </MfgRow>
          </>
        ) : (
          <MfgRow right={<MfgModuleChip module="sales" />}>
            <b dir="ltr">{info.kind === "cost" ? r.rfqRef || "—" : r.orderNumber != null ? `SO-${r.orderNumber}` : "—"}</b>
            <p className="text-[11px] text-muted-foreground">
              {info.kind === "cost"
                ? t("mfr_src_rfq")
                : info.downPayment === "confirmed"
                  ? t("mfr_src_so_confirmed")
                  : info.downPayment === "pending"
                    ? t("mfr_src_so_pending")
                    : t("mfr_src_so")}
            </p>
          </MfgRow>
        )}
        <MfgRow>
          <p className="font-bold text-foreground">{r.createdByUserName}</p>
          <p className="text-[11px] text-muted-foreground">{t("mfr_src_answer_returns", { module: moduleName })}</p>
        </MfgRow>
      </MfgSection>
    </MfgDrawer>
  )
}
