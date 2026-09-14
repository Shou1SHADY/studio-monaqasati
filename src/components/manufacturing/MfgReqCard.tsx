"use client"

// One manufacturing request in the list. A new one shows its screening line
// by line — make cost against the reference buy price, the possible date and
// the verdict — so the answer is already half-read before it is opened. An
// answered one shows the answer, who gave it, and the work it became.

import { useTranslations } from "next-intl"
import { Calculator, Check, Eye, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ManufacturingRequest } from "@/lib/sales-orders"
import { requestLines, type ScreenedLine } from "@/lib/manufacturing-requests"
import { useMfgUi } from "./MfgUiContext"
import { MfgStatePill } from "./MfgOrderBits"
import { MfgChip, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"
import {
  MfgReqTable,
  RequestSourceChip,
  RequestStatePill,
  Td,
  Th,
  VerdictCell,
  requestTitle,
  requestVia,
  sourceMetaOf,
  useArrivedLabel,
  workOrderIdsOf,
} from "./MfgReqBits"

export function MfgReqCard({
  request: r,
  screen,
  now,
  onOpen,
  onAnswer,
  onShowEstimate,
}: {
  request: ManufacturingRequest
  /** The screening — present for requests still awaiting an answer. */
  screen: ScreenedLine[] | null
  now: number
  onOpen: () => void
  onAnswer: () => void
  onShowEstimate: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const { perms } = useMfgUi()
  const date = useMfgDate()
  const arrived = useArrivedLabel()
  const meta = sourceMetaOf(r)
  const Icon = meta.icon
  const via = requestVia(r, t)
  const isNew = r.status === "new"

  return (
    <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
          <Icon size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-foreground" dir="auto">
            {requestTitle(r, t)}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            <RequestSourceChip request={r} />
            {r.note && (
              <span className="text-slate-700" dir="auto">
                {r.note} ·
              </span>
            )}
            <span>
              {t("mfg3_req_requested_by")} <b className="text-slate-700">{r.createdByUserName}</b>
            </span>
            {via && <span>· {via}</span>}
            {r.requestedAt && <span>· {t("mfg3_req_arrived", { when: arrived(r.requestedAt, now) })}</span>}
            <span>· {t("mfg3_req_needed", { date: date.short(r.neededBy) })}</span>
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onOpen}>
            <Eye size={13} aria-hidden="true" /> {t("mfg3_req_details")}
          </Button>
          <RequestStatePill request={r} now={now} />
        </div>
      </header>

      {isNew && screen ? (
        <>
          <ScreenLinesTable lines={screen} />
          <footer className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/20 px-4 py-2.5">
            {perms.canManage ? (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onAnswer}>
                <Check size={13} aria-hidden="true" /> {t("mfg2_req_answer")}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <Lock size={12} aria-hidden="true" /> {t("mfg3_req_only_manager")}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">{t("mfg3_req_stays_open")}</span>
          </footer>
        </>
      ) : (
        <AnsweredBody request={r} now={now} onShowEstimate={onShowEstimate} />
      )}
    </article>
  )
}

/** The screening table: requested · make / buy per unit · possible date · verdict. */
export function ScreenLinesTable({ lines }: { lines: ScreenedLine[] }) {
  const t = useTranslations("Portal.Shared")
  const { perms, data } = useMfgUi()
  const date = useMfgDate()
  const timeOn = data.settings.features.time
  return (
    <MfgReqTable
      minWidth={timeOn ? "min-w-[600px]" : "min-w-[480px]"}
      head={
        <>
          <Th>{t("mfg3_req_col_requested")}</Th>
          {perms.seesMoney && <Th>{t("mfg3_req_col_make_buy")}</Th>}
          {timeOn && <Th>{t("mfg2_possible_date")}</Th>}
          <Th className="w-[34%]">{t("mfg3_req_col_verdict")}</Th>
        </>
      }
    >
      {lines.map((l) => {
        const hoursPerUnit = l.std && l.line.quantity > 0 ? Math.round((l.std.hours / l.line.quantity) * 10) / 10 : null
        return (
          <tr key={l.index}>
            <Td>
              <span className="block font-semibold text-foreground" dir="auto">
                {l.line.itemName}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {fmtQty(l.line.quantity)} {l.line.unit}
                {timeOn && hoursPerUnit != null && <> · {t("mfg3_req_std_hours", { hours: fmtQty(hoursPerUnit) })}</>}
              </span>
            </Td>
            {perms.seesMoney && (
              <Td className="whitespace-nowrap tabular-nums">
                {l.verdict ? (
                  <>
                    <b className="text-foreground">{fmtMoney(l.verdict.unitCost)}</b>
                    <span className="text-muted-foreground"> / {l.verdict.buyPrice != null ? fmtMoney(l.verdict.buyPrice) : "—"}</span>
                    <span className="block text-[10px] text-muted-foreground">{t("mfg3_req_make_buy_unit")}</span>
                  </>
                ) : (
                  "—"
                )}
              </Td>
            )}
            {timeOn && <Td className="whitespace-nowrap">{l.possibleDate ? date.short(l.possibleDate) : "—"}</Td>}
            <Td>
              <VerdictCell line={l} />
            </Td>
          </tr>
        )
      })}
    </MfgReqTable>
  )
}

function AnsweredBody({ request: r, now, onShowEstimate }: { request: ManufacturingRequest; now: number; onShowEstimate: () => void }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const arrived = useArrivedLabel()
  const orderIds = workOrderIdsOf(r)
  const estimate = r.estimateId ? ui.data.estimates.find((e) => e.id === r.estimateId) : null
  const answer = r.answerNote || r.rejectionReason
  return (
    <div className="space-y-2 px-4 py-3 text-xs">
      <p className="text-muted-foreground" dir="auto">
        {requestLines(r)
          .map((l) => `${l.itemName} × ${fmtQty(l.quantity)} ${l.unit}`)
          .join(" · ")}
      </p>
      {(answer || r.decidedByUserName) && (
        <p className="text-slate-700">
          {answer && (
            <b className="font-semibold text-foreground" dir="auto">
              {answer}
            </b>
          )}
          {r.decidedByUserName && (
            <span className="text-muted-foreground">
              {answer ? " — " : ""}
              {t("mfg3_req_answered_by", { name: r.decidedByUserName })}
              {r.decidedAt && <> · {arrived(r.decidedAt, now)}</>}
            </span>
          )}
        </p>
      )}
      {(orderIds.length > 0 || estimate) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {orderIds.map((id) => {
            const v = ui.viewById.get(id)
            if (!v)
              return r.workOrderNumber && id === r.workOrderId ? (
                <MfgChip key={id} tone="muted">
                  #{r.workOrderNumber}
                </MfgChip>
              ) : null
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
                <MfgStatePill view={v} departments={ui.data.departments} />
              </button>
            )
          })}
          {estimate && (
            <button
              type="button"
              onClick={onShowEstimate}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-2 py-1 text-[11px] font-semibold hover:bg-warning/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Calculator size={12} className="text-warning" aria-hidden="true" />
              <span dir="ltr">{estimate.estimateNumber}</span>
              <span className="text-muted-foreground">{t(`mfg2_est_state_${estimate.state}`)}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
