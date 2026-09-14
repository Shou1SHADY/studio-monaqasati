"use client"

// Cost estimates — the Requests screen's estimates segment. The workshop
// issues COST and LEAD TIME and Finance's floor price under it; sales set the
// price and issue the quote, which is logged back here with its margin; the
// award comes back here too and becomes work orders with one confirmation.

import { useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Calculator, FileText, Send, Trophy, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { addDaysISO, estimateCost, marginPercent, minPriceFor, type EstimateState, type MfgCostEstimate } from "@/lib/manufacturing-engine"
import { estimateEarliestDays } from "@/lib/manufacturing-requests"
import { useMfgUi } from "./MfgUiContext"
import { MfgStatePill } from "./MfgOrderBits"
import { MfgChip, MfgEmpty, MfgPill, fmtMoney, fmtQty, useMfgDate, type MfgTone } from "./ui/MfgUi"
import { MfgReqTable, Td, Th } from "./MfgReqBits"
import { EstimateLostForm, EstimateQuoteForm, EstimateSendForm, EstimateWonForm } from "./MfgEstForms"

export const ESTIMATE_TONE: Record<EstimateState, MfgTone> = {
  draft: "warn",
  sent: "info",
  quoted: "accent",
  won: "ok",
  lost: "muted",
}

type EstAction = { kind: "send" | "quote" | "won" | "lost"; id: string }

export function MfgEstimatesView({ estimates }: { estimates: MfgCostEstimate[] }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const [action, setAction] = useState<EstAction | null>(null)
  const current = action ? data.estimates.find((e) => e.id === action.id) || null : null

  if (!estimates.length) {
    return (
      <section className="rounded-2xl border bg-white shadow-sm">
        <MfgEmpty icon={Calculator} title={t("mfg2_estimates_empty")} hint={t("mfg3_est_empty_hint")} />
      </section>
    )
  }

  return (
    <div className="space-y-3">
      {estimates.map((e) => (
        <EstimateCard key={e.id} estimate={e} onAction={(kind) => setAction({ kind, id: e.id })} />
      ))}
      {current && action?.kind === "send" && <EstimateSendForm estimate={current} onClose={() => setAction(null)} />}
      {current && action?.kind === "quote" && <EstimateQuoteForm estimate={current} onClose={() => setAction(null)} />}
      {current && action?.kind === "won" && <EstimateWonForm estimate={current} onClose={() => setAction(null)} />}
      {current && action?.kind === "lost" && <EstimateLostForm estimate={current} onClose={() => setAction(null)} />}
    </div>
  )
}

function EstimateCard({ estimate: e, onAction }: { estimate: MfgCostEstimate; onAction: (kind: EstAction["kind"]) => void }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms, today } = ui
  const date = useMfgDate()
  const timeOn = data.settings.features.time
  const money = perms.seesMoney
  const canAct = perms.canCost || perms.canManage
  const cost = estimateCost(e)
  const floor = minPriceFor(cost, data.settings)
  const margin = e.quotedPrice ? marginPercent(e.quotedPrice, cost) : null
  const earliestDays = useMemo(
    () => (timeOn ? estimateEarliestDays(e, data.productById, data.scheduleInputs, data.departments) : null),
    [timeOn, e, data.productById, data.scheduleInputs, data.departments]
  )

  return (
    <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
          <Calculator size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-foreground" dir="auto">
            {e.estimateNumber} — {e.contactName || e.requestedBy || t("mfg3_est_no_client")}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            {e.note && (
              <span className="text-slate-700" dir="auto">
                {e.note} ·
              </span>
            )}
            {e.requestedBy && (
              <span>
                {t("mfg3_req_requested_by")} <b className="text-slate-700">{e.requestedBy}</b> ·
              </span>
            )}
            <span>{t("mfg3_req_needed", { date: date.short(e.neededBy) })}</span>
            {e.quoteNumber && <span>· {t("mfg3_est_quote_ref", { number: e.quoteNumber })}</span>}
          </p>
        </div>
        <MfgPill tone={ESTIMATE_TONE[e.state]} dot className="ms-auto">
          {t(`mfg2_est_state_${e.state}`)}
        </MfgPill>
      </header>

      <MfgReqTable
        minWidth={money ? "min-w-[620px]" : "min-w-[360px]"}
        head={
          <>
            <Th>{t("mfg3_req_col_line")}</Th>
            {money && <Th>{t("mfg3_est_col_materials")}</Th>}
            {money && <Th>{t("mfg2_cost_labour_oh")}</Th>}
            {money && <Th>{t("mfg3_est_col_cost")}</Th>}
            {timeOn && <Th>{t("mfg3_est_col_earliest")}</Th>}
          </>
        }
      >
        {e.lines.map((l, i) => {
          const product = data.productById.get(l.productId)
          const days = timeOn ? estimateEarliestDays({ lines: [l] }, data.productById, data.scheduleInputs, data.departments) : null
          return (
            <tr key={i}>
              <Td>
                <span className="block font-semibold text-foreground" dir="auto">
                  {l.productName}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {fmtQty(l.quantity)} {l.unit}
                  {product && product.wastePercent > 0 && <> · {t("mfg3_est_planned_waste", { pct: fmtQty(product.wastePercent) })}</>}
                  {timeOn && l.hours > 0 && <> · {t("mfg3_req_line_hours", { hours: fmtQty(Math.round(l.hours)) })}</>}
                </span>
              </Td>
              {money && <Td className="whitespace-nowrap tabular-nums">{fmtMoney(l.materialCost)}</Td>}
              {money && <Td className="whitespace-nowrap tabular-nums">{fmtMoney(l.labourCost + l.overheadCost)}</Td>}
              {money && <Td className="whitespace-nowrap font-bold tabular-nums">{fmtMoney(l.totalCost)}</Td>}
              {timeOn && <Td className="whitespace-nowrap">{days != null ? date.short(addDaysISO(today, days)) : "—"}</Td>}
            </tr>
          )
        })}
      </MfgReqTable>

      <dl className="divide-y divide-border/60 border-t border-border/60 bg-muted/10 text-xs">
        {money && (
          <TotalRow label={<b className="text-foreground">{t("mfg3_est_make_cost_title")}</b>} strong>
            {fmtMoney(cost)} ﷼
          </TotalRow>
        )}
        {timeOn && earliestDays != null && <TotalRow label={t("mfg3_est_earliest_possible")}>{date.short(addDaysISO(today, earliestDays))}</TotalRow>}
        <TotalRow label={<>{t("mfg2_est_validity_field")} <span className="text-[10px] text-muted-foreground">{t("mfg3_est_validity_why")}</span></>}>
          {t("mfg3_est_validity_days", { days: e.validityDays || 15 })}
        </TotalRow>
        {money && (
          <TotalRow
            label={
              <>
                {t("mfg3_est_floor_label")}{" "}
                <MfgChip tone="info">{t("mfg3_est_min_margin", { percent: data.settings.minMarginPercent })}</MfgChip>
              </>
            }
          >
            {fmtMoney(floor)} ﷼
          </TotalRow>
        )}
        {e.quotedPrice != null && money ? (
          <>
            <TotalRow
              label={
                <>
                  {t("mfg3_est_quoted_by_sales")} {e.quoteNumber && <MfgChip tone="accent">{e.quoteNumber}</MfgChip>}
                </>
              }
            >
              <span className={cn(e.quotedPrice >= floor ? "text-success" : "text-destructive")}>{fmtMoney(e.quotedPrice)} ﷼</span>
            </TotalRow>
            <TotalRow label={t("mfg3_est_quoted_margin")}>
              {margin != null ? `${margin}%` : "—"}
              {e.financeApprovalBy && (
                <span className="ms-1 font-semibold text-warning">{t("mfg2_est_finance_approved", { name: e.financeApprovalBy })}</span>
              )}
            </TotalRow>
          </>
        ) : e.quotedPrice == null ? (
          <TotalRow label={t("mfg3_est_price")}>
            <span className="font-semibold text-muted-foreground">{t("mfg3_est_price_in_sales")}</span>
          </TotalRow>
        ) : null}
      </dl>
      {e.state === "won" && (e.workOrderIds || []).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-4 py-2.5 text-xs">
          <span className="text-muted-foreground">{t("mfg3_est_orders_created")}</span>
          {(e.workOrderIds || []).map((id) => {
            const v = ui.viewById.get(id)
            if (!v) return null
            return (
              <button
                key={id}
                type="button"
                onClick={() => ui.openOrder(id)}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-2 py-1 text-[11px] font-semibold hover:bg-warning/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span dir="ltr" className="font-mono text-muted-foreground">
                  #{v.number}
                </span>
                <span dir="auto">{v.product.name}</span>
                <MfgStatePill view={v} departments={data.departments} />
              </button>
            )
          })}
        </div>
      )}

      {canAct && ["draft", "sent", "quoted"].includes(e.state) && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2.5">
          {e.state === "draft" && (
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onAction("send")}>
              <Send size={13} className="rtl-flip" aria-hidden="true" /> {t("mfg3_est_action_send")}
            </Button>
          )}
          {e.state === "sent" && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => onAction("quote")}>
              <FileText size={13} aria-hidden="true" /> {t("mfg3_est_action_quote")}
            </Button>
          )}
          {e.state === "quoted" && (
            <>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onAction("won")}>
                <Trophy size={13} aria-hidden="true" /> {t("mfg3_est_action_won")}
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-muted-foreground" onClick={() => onAction("lost")}>
                <XCircle size={13} aria-hidden="true" /> {t("mfg2_est_lost")}
              </Button>
            </>
          )}
          <span className="text-[11px] text-muted-foreground">{t("mfg3_est_who_owns")}</span>
        </footer>
      )}
    </article>
  )
}

function TotalRow({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2", strong && "bg-warning/5")}>
      <dt className="flex flex-wrap items-center gap-1 text-slate-700">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-sm font-black text-foreground" : "font-bold text-foreground")}>{children}</dd>
    </div>
  )
}
