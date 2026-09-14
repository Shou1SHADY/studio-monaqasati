"use client"

// The request drawer — nobody answers a request before reading it. The whole
// screening is here (cost, per unit, buy price, hours, earliest date, the
// material it needs against what the stores hold), then the answer if there
// is one, where it came from, and the answer button last.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Calculator, Check, ClipboardList, Clock, Layers, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ManufacturingRequest } from "@/lib/sales-orders"
import { useOrgStock, stockKey } from "@/hooks/useOrgStock"
import { cn } from "@/lib/utils"
import { answerWindow, requestSourceName, screenRequest, summarizeScreen } from "@/lib/manufacturing-requests"
import { useMfgUi } from "./MfgUiContext"
import { MfgStatePill } from "./MfgOrderBits"
import { MfgChip, MfgDrawer, MfgNote, MfgRow, MfgSection, MfgStat, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"
import {
  RequestSourceChip,
  RequestStatePill,
  VerdictCell,
  ageText,
  requestTitle,
  requestVia,
  sourceMetaOf,
  useArrivedLabel,
  useNow,
  useScreenContext,
  verdictLabel,
  workOrderIdsOf,
} from "./MfgReqBits"

export function MfgReqDrawer({
  request,
  onClose,
  onAnswer,
  onShowEstimate,
}: {
  request: ManufacturingRequest | null
  onClose: () => void
  onAnswer: (r: ManufacturingRequest) => void
  onShowEstimate: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms } = ui
  const date = useMfgDate()
  const arrived = useArrivedLabel()
  const now = useNow()
  const ctx = useScreenContext()
  const lines = useMemo(() => (request ? screenRequest(request, ctx) : []), [request, ctx])
  const summary = useMemo(() => summarizeScreen(lines), [lines])
  const needsStock = lines.some((l) => l.material)
  const stock = useOrgStock(data.warehouses, !!request && needsStock)
  const stockKnown = !stock.loading && stock.byWarehouse.size > 0

  if (!request) return null

  const r = request
  const meta = sourceMetaOf(r)
  const via = requestVia(r, t)
  const isNew = r.status === "new"
  const w = answerWindow(r, data.settings.answerWindowHours, now)
  const timeOn = data.settings.features.time
  const orderIds = workOrderIdsOf(r)
  const estimate = r.estimateId ? data.estimates.find((e) => e.id === r.estimateId) : null
  const answer = r.answerNote || r.rejectionReason

  return (
    <MfgDrawer
      open
      onClose={onClose}
      icon={meta.icon}
      title={<span dir="auto">{requestTitle(r, t)}</span>}
      meta={
        <>
          <RequestSourceChip request={r} />
          <span>
            {t("mfg3_req_requested_by")} <b className="text-slate-700">{r.createdByUserName}</b>
          </span>
          {via && <span>· {via}</span>}
          <RequestStatePill request={r} now={now} />
        </>
      }
      footer={
        isNew ? (
          perms.canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => onAnswer(r)}>
                <Check size={14} aria-hidden="true" /> {t("mfg3_req_answer_cta")}
              </Button>
              <span className="text-[11px] text-muted-foreground">{t("mfg3_req_answer_cta_hint")}</span>
            </div>
          ) : (
            <MfgNote tone="info" icon={Lock}>
              {t("mfg3_req_only_manager")}
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
      {isNew && w.overdue && (
        <MfgNote tone="bad" icon={Clock} title={t("mfg3_req_overdue_title", { age: ageText(t, w.ageHours) })}>
          {t("mfg3_req_overdue_body", { hours: data.settings.answerWindowHours })}
        </MfgNote>
      )}

      <div className="grid grid-cols-2 gap-2">
        <MfgStat label={t("mfg2_field_needed_by")} value={date.short(r.neededBy)} sub={r.neededBy ? date.relative(r.neededBy) : undefined} />
        <MfgStat
          label={t("mfg3_req_stat_lines")}
          value={<span className="tabular-nums">{lines.length}</span>}
          sub={r.requestedAt ? t("mfg3_req_arrived", { when: arrived(r.requestedAt, now) }) : undefined}
        />
        {perms.seesMoney && (
          <MfgStat
            label={t("mfg3_req_stat_full_cost")}
            value={<span className="tabular-nums">{fmtMoney(summary.fullCost)} ﷼</span>}
            sub={summary.unscreened ? t("mfg3_req_stat_unscreened", { count: summary.unscreened }) : undefined}
          />
        )}
        {timeOn ? (
          <MfgStat
            label={t("mfg3_req_stat_earliest_all")}
            value={summary.earliestAll ? date.short(summary.earliestAll) : "—"}
            sub={summary.earliestAll ? date.relative(summary.earliestAll) : undefined}
          />
        ) : (
          <MfgStat
            label={t("mfg3_req_stat_suggested")}
            value={
              lines.find((l) => l.verdict)?.verdict
                ? summary.common
                  ? verdictLabel(lines.find((l) => l.verdict)!.verdict!, t)
                  : t("mfg3_req_verdict_mixed")
                : "—"
            }
          />
        )}
      </div>

      <MfgSection icon={ClipboardList} title={t("mfg3_req_sec_lines")} right={<span className="text-[11px] text-muted-foreground">{t("mfg3_req_sec_lines_hint")}</span>}>
        {lines.map((l) => {
          const available = l.material ? stock.byName.get(stockKey(l.material.itemName)) || 0 : 0
          const short = l.material ? Math.max(0, Math.round((l.material.qty - available) * 10) / 10) : 0
          return (
            <div key={l.index} className="flex flex-col gap-2 border-b border-border/60 px-3.5 py-3 text-xs last:border-b-0 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-bold text-foreground" dir="auto">
                  {l.line.itemName} — {fmtQty(l.line.quantity)} {l.line.unit}
                </p>
                {l.std && perms.seesMoney && l.verdict && (
                  <p className="text-muted-foreground">
                    {t("mfg3_req_line_cost")} <b className="text-foreground tabular-nums">{fmtMoney(l.std.total)} ﷼</b> ·{" "}
                    {t("mfg3_req_line_per_unit", { amount: fmtMoney(l.verdict.unitCost) })}
                    {l.verdict.buyPrice != null && <> · {t("mfg3_req_line_buy", { amount: fmtMoney(l.verdict.buyPrice) })}</>}
                  </p>
                )}
                {l.std && timeOn && (
                  <p className="text-muted-foreground">
                    {t("mfg3_req_line_hours", { hours: fmtQty(Math.round(l.std.hours)) })}
                    {l.possibleDate && (
                      <>
                        {" "}
                        · {t("mfg3_req_line_earliest")} <b className="text-foreground">{date.short(l.possibleDate)}</b>
                      </>
                    )}
                  </p>
                )}
                {l.material && (
                  <p className="text-muted-foreground">
                    <span dir="auto">
                      {t("mfg3_req_line_material", { item: l.material.itemName, qty: fmtQty(l.material.qty), unit: l.material.unit })}
                    </span>
                    {l.material.wastePercent > 0 && <> ({t("mfg3_req_line_incl_waste", { pct: fmtQty(l.material.wastePercent) })})</>}
                    {stockKnown && (
                      <>
                        {" "}
                        ·{" "}
                        <b className={cn(short > 0 ? "text-destructive" : "text-success")}>
                          {t("mfg3_req_line_available", { qty: fmtQty(available) })}
                        </b>
                        {short > 0 && <> — {t("mfg3_req_line_short", { qty: fmtQty(short) })}</>}
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="sm:max-w-[45%]">
                <VerdictCell line={l} align="end" />
              </div>
            </div>
          )
        })}
      </MfgSection>

      {!isNew && (
        <MfgSection icon={Check} title={t("mfg2_req_answer_label")}>
          <MfgRow>
            {answer && (
              <p className="font-bold text-foreground" dir="auto">
                {answer}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              {r.decidedByUserName ? t("mfg3_req_answered_by", { name: r.decidedByUserName }) : ""}
              {r.decidedAt && (
                <>
                  {" "}
                  · {date.short(r.decidedAt)} · {arrived(r.decidedAt, now)}
                </>
              )}
            </p>
          </MfgRow>
          {orderIds.map((id) => {
            const v = ui.viewById.get(id)
            if (!v)
              return r.workOrderNumber && id === r.workOrderId ? (
                <MfgRow key={id}>
                  <b dir="ltr">#{r.workOrderNumber}</b>
                </MfgRow>
              ) : null
            return (
              <MfgRow
                key={id}
                onClick={() => ui.openOrder(id)}
                right={<MfgStatePill view={v} departments={data.departments} />}
              >
                <b dir="ltr" className="font-mono">
                  #{v.number}
                </b>{" "}
                <span className="text-muted-foreground" dir="auto">
                  {v.product.name} × {fmtQty(v.quantity)} {v.unit}
                </span>
              </MfgRow>
            )
          })}
          {estimate && (
            <MfgRow onClick={onShowEstimate} right={<MfgChip tone="info">{t(`mfg2_est_state_${estimate.state}`)}</MfgChip>}>
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Calculator size={13} className="text-warning" aria-hidden="true" />
                <span dir="ltr">{estimate.estimateNumber}</span>
              </span>
            </MfgRow>
          )}
        </MfgSection>
      )}

      <MfgSection icon={Layers} title={t("mfg3_req_sec_source")}>
        <MfgRow right={<RequestSourceChip request={r} />}>
          <p className="font-bold text-foreground" dir="auto">
            {requestSourceName(r) || t(meta.labelKey)}
          </p>
          {via && <p className="text-[11px] text-muted-foreground">{via}</p>}
        </MfgRow>
        <MfgRow>
          <p className="font-bold text-foreground">{r.createdByUserName}</p>
          <p className="text-[11px] text-muted-foreground">{t("mfg3_req_source_waiting")}</p>
        </MfgRow>
      </MfgSection>
    </MfgDrawer>
  )
}
