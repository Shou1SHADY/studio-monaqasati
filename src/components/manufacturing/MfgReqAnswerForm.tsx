"use client"

// Answering a request routes it — to manufacturing (work orders for what we
// make, the rest back to procurement), to a cost estimate (we cost it, sales
// price it), or back to procurement with a reason. The answer is logged in
// the answerer's name and returns to whoever asked: never silence.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Calculator, Check, Factory, ShoppingCart } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { ManufacturingRequest } from "@/lib/sales-orders"
import { acceptManufacturingRequest, rejectManufacturingRequest } from "@/lib/sales-order-writes"
import { answerMfgRequestV2 } from "@/lib/manufacturing-writes"
import { minPriceFor, round2, type MfgProduct } from "@/lib/manufacturing-engine"
import {
  defaultAnswerRoute,
  defaultMakeQty,
  isLegacyRequest,
  makeOrderCount,
  makeRemainder,
  parseQty,
  requestSourceName,
  screenRequest,
  validateMakeAnswer,
  type AnswerRoute,
  type MakeDraftLine,
} from "@/lib/manufacturing-requests"
import { useMfgUi } from "./MfgUiContext"
import {
  MfgChoiceCards,
  MfgEffects,
  MfgField,
  MfgFormModal,
  MfgNote,
  MfgReview,
  fmtMoney,
  fmtQty,
  useMfgDate,
  type MfgChoice,
} from "./ui/MfgUi"
import { MfgReqTable, RequestSourceChip, Td, Th, VerdictPill, requestTitle, requestVia, useScreenContext } from "./MfgReqBits"

const ERROR_KEYS: Record<string, string> = {
  reason_required: "mfg2_err_reason_required",
  lines_required: "mfg3_req_err_nothing_made",
  product_required: "mfg2_err_needs_product_card",
  no_departments: "mfg3_req_err_no_departments",
}

export function MfgReqAnswerForm({
  request: r,
  onClose,
  onAnswered,
}: {
  request: ManufacturingRequest
  onClose: () => void
  onAnswered?: (route: AnswerRoute) => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const ui = useMfgUi()
  const { data, perms } = ui
  const firestore = useFirestore()
  const { toast } = useToast()
  const date = useMfgDate()
  const ctx = useScreenContext()
  // The screening is frozen when the form opens — the answer is given on
  // the facts that were read, not on a queue that moves while typing.
  const [lines] = useState(() => screenRequest(r, ctx))
  const legacy = isLegacyRequest(r)
  const estimatesOn = data.settings.features.estimates
  const timeOn = data.settings.features.time

  const [step, setStep] = useState(0)
  const [route, setRoute] = useState<AnswerRoute>(() => defaultAnswerRoute(lines))
  const [makeInputs, setMakeInputs] = useState<string[]>(() => lines.map((l) => String(defaultMakeQty(l, legacy))))
  const [note, setNote] = useState("")
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const productLines = lines.filter((l): l is typeof l & { product: MfgProduct } => !!l.product)
  const legacyWhole = legacy && !lines[0]?.product
  const requester = r.createdByUserName
  const via = requestVia(r, t)

  const draft: MakeDraftLine[] = useMemo(
    () => lines.map((l, i) => ({ asked: l.line.quantity, input: makeInputs[i] ?? "", makeable: !!l.product || legacyWhole })),
    [lines, makeInputs, legacyWhole]
  )
  const makeCheck = validateMakeAnswer(draft)
  const orders = legacyWhole ? 1 : makeOrderCount(draft)
  const remainder = legacyWhole ? 0 : makeRemainder(draft)
  const estimateCostTotal = round2(productLines.reduce((a, l) => a + (l.std?.total || 0), 0))

  const routes: Array<MfgChoice<AnswerRoute>> = [
    { id: "make", icon: Factory, title: t("mfg2_route_make"), description: t("mfg2_route_make_hint") },
    ...(estimatesOn
      ? [
          {
            id: "estimate" as const,
            icon: Calculator,
            title: t("mfg3_req_route_estimate"),
            description: productLines.length ? t("mfg2_route_estimate_hint") : t("mfg2_err_needs_product_card"),
            disabled: !productLines.length,
          },
        ]
      : []),
    { id: "buy", icon: ShoppingCart, title: t("mfg2_route_buy"), description: t("mfg2_route_buy_hint") },
  ]

  const next = () => {
    setError(null)
    setStep(1)
  }

  const submit = async () => {
    if (!firestore || busy) return
    setAttempted(true)
    setError(null)
    if (route === "buy" && !note.trim()) {
      setError(t("mfg2_err_reason_required"))
      return
    }
    if (route === "estimate" && !productLines.length) {
      setError(t("mfg2_err_needs_product_card"))
      return
    }
    if (route === "make" && !legacyWhole && makeCheck.formError) {
      setError(makeCheck.formError === "nothing_made" ? t("mfg3_req_err_nothing_made") : t("mfg3_req_err_fix_lines"))
      return
    }
    setBusy(true)
    try {
      if (route === "buy") {
        if (legacy) await rejectManufacturingRequest(firestore, { request: r, reason: note.trim(), actor: data.actor })
        else
          await answerMfgRequestV2(firestore, {
            request: r,
            route: "buy",
            departments: data.departments,
            settings: data.settings,
            note: note.trim(),
            actor: data.actor,
          })
        toast({ title: t("mfg2_req_returned_toast") })
      } else if (route === "estimate") {
        await answerMfgRequestV2(firestore, {
          request: r,
          route: "estimate",
          estimateLines: productLines.map((l) => ({ product: l.product, quantity: l.line.quantity })),
          departments: data.departments,
          settings: data.settings,
          note: note.trim() || null,
          actor: data.actor,
        })
        toast({ title: t("mfg2_req_estimated_toast"), description: t("mfg3_req_estimated_toast_hint") })
      } else if (legacyWhole) {
        await acceptManufacturingRequest(firestore, { request: r, actor: data.actor })
        toast({ title: t("mfg_req_accepted_toast") })
      } else {
        await answerMfgRequestV2(firestore, {
          request: r,
          route: "make",
          makeLines: lines.map((l, i) => ({ line: l.line, makeQuantity: Math.max(0, parseQty(makeInputs[i] ?? "") || 0), product: l.product })),
          departments: data.departments,
          settings: data.settings,
          note: note.trim() || null,
          actor: data.actor,
        })
        toast({ title: t("mfg2_req_accepted_toast") })
      }
      onAnswered?.(route)
      onClose()
    } catch (err) {
      console.error(err)
      const key = ERROR_KEYS[(err as Error)?.message] || "mfg_save_error"
      setError(t(key))
      toast({ title: t(key), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const lineName = (i: number) => (
    <span className="block font-semibold text-foreground" dir="auto">
      {lines[i].line.itemName}
    </span>
  )

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Check}
      title={t("mfg3_req_answer_title", { number: r.requestNumber })}
      subtitle={t("mfg3_req_answer_sub")}
      steps={[t("mfg3_req_step_route"), t("mfg3_req_step_details")]}
      step={step}
      error={error}
      busy={busy}
      onBack={() => {
        setError(null)
        setStep(0)
      }}
      onNext={next}
      onConfirm={submit}
      confirmLabel={route === "buy" ? t("mfg3_req_confirm_buy") : route === "estimate" ? t("mfg3_req_confirm_estimate") : t("mfg3_req_confirm_make")}
      size="lg"
    >
      {step === 0 ? (
        <>
          <MfgReview
            rows={[
              [t("mfg3_req_rv_request"), <span key="n" dir="auto">{requestTitle(r, t)}</span>],
              [t("mfg2_field_source"), <RequestSourceChip key="s" request={r} />],
              [t("mfg2_field_requested_by"), `${requester}${via ? ` · ${via}` : ""}`],
              [t("mfg2_field_needed_by"), date.short(r.neededBy)],
              [
                t("mfg3_req_col_requested"),
                <span key="l" className="block space-y-0.5">
                  {lines.map((l) => (
                    <span key={l.index} className="block" dir="auto">
                      {l.line.itemName} × {fmtQty(l.line.quantity)} {l.line.unit}
                    </span>
                  ))}
                </span>,
              ],
              [
                t("mfg3_req_rv_verdict"),
                <span key="v" className="flex flex-wrap gap-1">
                  {lines.map((l) => (l.verdict ? <VerdictPill key={l.index} verdict={l.verdict} /> : null))}
                  {lines.every((l) => !l.verdict) && <span className="text-muted-foreground">{t("mfg2_no_product_card")}</span>}
                </span>,
              ],
            ]}
          />
          <MfgChoiceCards value={route} onChange={setRoute} options={routes} columns={routes.length === 3 ? 3 : 2} />
          <MfgNote tone="info">{t("mfg3_req_answer_logged", { me: data.actor.name || "—", name: requester })}</MfgNote>
        </>
      ) : route === "make" ? (
        <>
          {legacyWhole && <MfgNote tone="info">{t("mfg3_req_legacy_make")}</MfgNote>}
          <div className="overflow-hidden rounded-xl border bg-white">
            <MfgReqTable
              minWidth="min-w-[520px]"
              head={
                <>
                  <Th>{t("mfg3_req_col_line")}</Th>
                  <Th>{t("mfg3_req_col_we_make")}</Th>
                  <Th>{t("mfg3_req_rv_verdict")}</Th>
                </>
              }
            >
              {lines.map((l, i) => {
                const lineError = attempted && !legacyWhole ? makeCheck.lineErrors[i] : null
                return (
                  <tr key={l.index}>
                    <Td>
                      {lineName(i)}
                      <span className="block text-[11px] text-muted-foreground">
                        {t("mfg2_req_asked", { count: fmtQty(l.line.quantity), unit: l.line.unit })}
                        {timeOn && l.possibleDate && <> · {t("mfg3_req_possible", { date: date.short(l.possibleDate) })}</>}
                        {perms.seesMoney && l.verdict && (
                          <>
                            {" "}
                            ·{" "}
                            {l.verdict.buyPrice != null
                              ? t("mfg3_req_unit_vs_buy", { make: fmtMoney(l.verdict.unitCost), buy: fmtMoney(l.verdict.buyPrice) })
                              : t("mfg3_req_unit_make", { make: fmtMoney(l.verdict.unitCost) })}
                          </>
                        )}
                      </span>
                    </Td>
                    <Td className="w-32">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={l.line.quantity}
                        step="any"
                        aria-label={t("mfg3_req_make_qty_label", { item: l.line.itemName })}
                        aria-invalid={!!lineError}
                        className={cn("h-9 w-28 text-xs tabular-nums", lineError && "border-destructive")}
                        value={legacyWhole ? String(l.line.quantity) : makeInputs[i] ?? ""}
                        disabled={legacyWhole || (!l.product && !legacy)}
                        onChange={(e) => setMakeInputs((m) => m.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                      {lineError && (
                        <span className="mt-1 block text-[11px] font-semibold text-destructive">
                          {lineError === "over"
                            ? t("mfg3_req_err_qty_over", { max: fmtQty(l.line.quantity) })
                            : lineError === "invalid"
                              ? t("mfg3_req_err_qty_invalid")
                              : t("mfg3_req_err_no_card")}
                        </span>
                      )}
                    </Td>
                    <Td>{l.verdict ? <VerdictPill verdict={l.verdict} /> : <span className="text-[11px] text-muted-foreground">{t("mfg2_no_product_card")}</span>}</Td>
                  </tr>
                )
              })}
            </MfgReqTable>
          </div>
          <MfgField label={t("mfg3_req_note_to_requester")} hint={t("mfg3_req_note_to_requester_hint")} htmlFor="mfg-answer-note">
            <Input id="mfg-answer-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("mfg3_req_note_make_ph")} />
          </MfgField>
          <MfgEffects
            items={[
              legacyWhole
                ? { text: t("mfg3_req_eff_legacy_order", { qty: fmtQty(lines[0]?.line.quantity), unit: lines[0]?.line.unit || "" }) }
                : { text: t("mfg3_req_eff_orders", { count: orders, name: requester }), applies: orders > 0 },
              remainder > 0
                ? { text: t("mfg3_req_eff_remainder", { qty: fmtQty(remainder) }) }
                : { text: t("mfg3_req_eff_no_remainder"), applies: false },
              { text: t("mfg3_req_eff_closes", { name: requester }) },
            ]}
          />
        </>
      ) : route === "estimate" ? (
        <>
          <div className="overflow-hidden rounded-xl border bg-white">
            <MfgReqTable
              minWidth="min-w-[480px]"
              head={
                <>
                  <Th>{t("mfg3_req_col_line")}</Th>
                  {perms.seesMoney && <Th>{t("mfg3_est_col_cost")}</Th>}
                  {perms.seesMoney && <Th>{t("mfg3_est_col_floor")}</Th>}
                  {timeOn && <Th>{t("mfg3_est_col_earliest")}</Th>}
                </>
              }
            >
              {productLines.map((l) => (
                <tr key={l.index}>
                  <Td>
                    <span className="block font-semibold text-foreground" dir="auto">
                      {l.line.itemName}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {fmtQty(l.line.quantity)} {l.line.unit}
                      {l.product.wastePercent > 0 && <> · {t("mfg3_req_waste_pct", { pct: fmtQty(l.product.wastePercent) })}</>}
                    </span>
                  </Td>
                  {perms.seesMoney && <Td className="whitespace-nowrap font-bold tabular-nums">{fmtMoney(l.std?.total)} ﷼</Td>}
                  {perms.seesMoney && <Td className="whitespace-nowrap tabular-nums">{fmtMoney(minPriceFor(l.std?.total || 0, data.settings))} ﷼</Td>}
                  {timeOn && <Td className="whitespace-nowrap">{date.short(l.possibleDate)}</Td>}
                </tr>
              ))}
            </MfgReqTable>
          </div>
          {productLines.length < lines.length && (
            <MfgNote tone="warn">
              {t("mfg3_req_est_skipped", {
                names: lines
                  .filter((l) => !l.product)
                  .map((l) => l.line.itemName)
                  .join(locale === "ar" ? "، " : ", "),
              })}
            </MfgNote>
          )}
          {perms.seesMoney && (
            <MfgNote tone="info">
              {t("mfg3_req_est_money", {
                cost: fmtMoney(estimateCostTotal),
                floor: fmtMoney(minPriceFor(estimateCostTotal, data.settings)),
                percent: data.settings.minMarginPercent,
              })}
            </MfgNote>
          )}
          <MfgField label={t("mfg2_est_note_to_sales")} hint={t("mfg2_field_note_optional")} htmlFor="mfg-answer-note">
            <Input id="mfg-answer-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("mfg3_est_note_ph")} />
          </MfgField>
          <MfgEffects
            items={[
              { text: t("mfg3_req_eff_est_card", { name: requestSourceName(r) || requester }) },
              { text: t("mfg3_req_eff_est_sales") },
              { text: t("mfg3_req_eff_est_request", { name: requester }) },
              { text: t("mfg3_req_eff_nothing_reserved"), applies: false },
            ]}
          />
        </>
      ) : (
        <>
          <MfgNote tone="warn" icon={ShoppingCart}>
            {t("mfg3_req_buy_note", { name: requester })}
          </MfgNote>
          <MfgField
            label={t("mfg3_req_reason")}
            required
            hint={t("mfg3_req_reason_hint")}
            error={attempted && !note.trim() ? t("mfg2_err_reason_required") : undefined}
            htmlFor="mfg-answer-note"
          >
            <Input
              id="mfg-answer-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("mfg2_buy_reason_ph")}
              aria-invalid={attempted && !note.trim()}
            />
          </MfgField>
          <div className="overflow-hidden rounded-xl border bg-white">
            <MfgReqTable
              minWidth="min-w-[360px]"
              head={
                <>
                  <Th>{t("mfg3_req_col_line")}</Th>
                  <Th>{t("mfg3_req_rv_verdict")}</Th>
                </>
              }
            >
              {lines.map((l, i) => (
                <tr key={l.index}>
                  <Td>
                    {lineName(i)}
                    <span className="block text-[11px] text-muted-foreground">
                      {fmtQty(l.line.quantity)} {l.line.unit}
                    </span>
                  </Td>
                  <Td>{l.verdict ? <VerdictPill verdict={l.verdict} /> : <span className="text-[11px] text-muted-foreground">{t("mfg2_no_product_card")}</span>}</Td>
                </tr>
              ))}
            </MfgReqTable>
          </div>
          <MfgEffects
            items={[
              { text: t("mfg3_req_eff_buy_returns", { name: requester }) },
              { text: t("mfg3_req_eff_no_orders"), applies: false },
            ]}
          />
        </>
      )}
    </MfgFormModal>
  )
}
