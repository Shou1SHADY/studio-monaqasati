"use client"

// The Requests decisions, one form each, signed by whoever opens them:
//
// · Answer a request (workshop manager) — make it (full or partial: the
//   remainder returns to its owner to decide buying) or decline with a reason;
//   a costing request is costed into a draft statement for the cost controller.
// · Review & send a cost statement (cost controller) — cost, lead time and
//   validity only; an incomplete standard blocks sending and names the station
//   (REQ-09). No price, no margin (D10).
// · Recalculate an expired statement at today's prices — back to draft.

import { useMemo, useState, type ElementType, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Calculator, Check, Factory, Lock, RotateCcw, Send, XCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { addDaysISO, estimateCost, estimateIncomplete, standardCost, type MfgProduct } from "@/lib/manufacturing-engine"
import { answerCostingRequest, answerMakeRequest, declineRequest, recalculateCostStatement, sendCostStatement } from "@/lib/manufacturing-writes"
import { emitMfgEvent, mfgLinks, type EventParams, type MfgEventKind, type RecipientSpec } from "@/lib/mfg-events"
import {
  defaultMakeQty,
  earliestDaysFor,
  estimateCostToday,
  estimateSentDays,
  estimateStatus,
  makeRemainders,
  neededInDays,
  parseQty,
  screenLine,
  screenRequest,
  validateMakeLines,
  type ScreenedLine,
} from "@/lib/manufacturing-requests"
import { cn } from "@/lib/utils"
import { useMfgUi } from "./MfgUiContext"
import { MfgRecordedAs } from "./MfgOrderBits"
import {
  ReqTable,
  RequestRefs,
  RequestSourceChip,
  Td,
  Th,
  VerdictPill,
  closeProducts,
  productUnitOf,
  qtyByUnitText,
  reqErrorText,
  useScreenContext,
  useSourceInfo,
} from "./MfgReqBits"
import { MfgChip, MfgChoiceCards, MfgEffects, MfgField, MfgFormModal, MfgNote, MfgReview, fmtMoney, fmtQty, useMfgDate, type MfgChoice } from "./ui/MfgUi"

type T = ReturnType<typeof useTranslations>

function Money({ value }: { value: number }) {
  return (
    <span dir="ltr" className="tabular-nums">
      {fmtMoney(value)} ﷼
    </span>
  )
}

/** A form that cannot be taken here (gone, already done, not this role). */
function BlockedForm({ icon, title, message, onClose }: { icon: ElementType; title: string; message: string; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  return (
    <MfgFormModal open onClose={onClose} icon={icon} title={title} onConfirm={onClose} confirmLabel={t("mfg3_close")}>
      <MfgNote tone="warn" icon={Lock}>
        {message}
      </MfgNote>
    </MfgFormModal>
  )
}

function ProductPicker({ value, onChange, products, itemName, label }: { value: string; onChange: (id: string) => void; products: MfgProduct[]; itemName: string; label: string }) {
  const t = useTranslations("Portal.Shared")
  const options = useMemo(() => closeProducts(products, itemName), [products, itemName])
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="mt-1 h-9 w-full max-w-[260px] text-xs" aria-label={label}>
        <SelectValue placeholder={t("mfr_pick_card")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem key={p.id} value={p.id} className="text-xs">
            {p.name} · {p.unit}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}


// ---------------------------------------------------------------------------
// Answer a request
// ---------------------------------------------------------------------------

type AnswerRoute = "make" | "cost" | "decline"

export function AnswerRequestForm({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const ui = useMfgUi()
  const { data, perms, seesMoney, today, world } = ui
  const firestore = useFirestore()
  const { toast } = useToast()
  const date = useMfgDate()
  const ctx = useScreenContext()
  const request = data.requests.find((r) => r.id === requestId) || null
  const info = useSourceInfo(request)

  // The screening is frozen when the form opens: the answer is given on the
  // facts that were read, not on a queue that moves while typing.
  const [frozen] = useState(() => ({ ctx, lines: request ? screenRequest(request, ctx) : [] }))
  const estimatesOn = data.settings.features.estimates
  const kind = info?.kind ?? "make"
  const [route, setRoute] = useState<AnswerRoute>(kind === "cost" ? (estimatesOn ? "cost" : "decline") : "make")
  const [picked, setPicked] = useState<Record<number, string>>({})
  const [qtyInputs, setQtyInputs] = useState<string[]>(() => frozen.lines.map((l) => String(defaultMakeQty(l))))
  const [note, setNote] = useState("")
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const needDays = request ? neededInDays(request, frozen.ctx.today) : 0
  const lines: ScreenedLine[] = useMemo(
    () =>
      frozen.lines.map((l) => {
        if (l.product) return l
        const p = picked[l.index] ? data.productById.get(picked[l.index]) : null
        return p ? screenLine(l.line, l.index, p, needDays, frozen.ctx) : l
      }),
    [frozen, picked, data.productById, needDays]
  )
  const liveProducts = useMemo(() => data.products.filter((p) => !p.archived), [data.products])

  if (!request || !info) return <BlockedForm icon={Check} title={t("mfr_answer_title")} message={t("mfr_request_missing")} onClose={onClose} />
  if (request.status !== "new") return <BlockedForm icon={Check} title={t("mfr_answer_title")} message={t("mfr_err_already_answered")} onClose={onClose} />
  if (!perms.canManage) return <BlockedForm icon={Check} title={t("mfr_answer_title")} message={t("mfr_only_manager_answers")} onClose={onClose} />

  const r = request
  const timeOn = data.settings.features.time
  const moduleName = t(`mfg4_module_${info.source}`)
  const unmatched = frozen.lines.some((l) => !l.product)
  const draft = lines.map((l, i) => ({ asked: l.line.quantity, qty: parseQty(qtyInputs[i] ?? ""), hasProduct: !!l.product }))
  const check = validateMakeLines(draft)
  const remainders = makeRemainders(draft)
  const remainderText = qtyByUnitText(lines.map((l, i) => [productUnitOf(l), remainders[i]]))
  const orderCount = draft.filter((d) => d.qty > 0 && d.hasProduct).length
  const costLines = lines.filter((l) => l.product)
  const costTotal = costLines.reduce((a, l) => a + (l.std?.total || 0), 0)
  const earliest = timeOn ? earliestDaysFor(lines.map((l) => ({ product: l.product, quantity: l.line.quantity })), frozen.ctx.calcs, data.departments, world.lost) : null
  const sep = locale === "ar" ? "، " : ", "

  const options: Array<MfgChoice<AnswerRoute>> =
    kind === "cost"
      ? [
          { id: "cost", icon: Calculator, title: t("mfr_route_cost"), description: estimatesOn ? t("mfr_route_cost_hint") : t("mfr_route_cost_off"), disabled: !estimatesOn },
          { id: "decline", icon: XCircle, title: t("mfr_route_decline_cost"), description: t("mfr_route_decline_hint", { module: moduleName }) },
        ]
      : [
          { id: "make", icon: Factory, title: t("mfr_route_make"), description: t("mfr_route_make_hint") },
          { id: "decline", icon: XCircle, title: t("mfr_route_decline_make"), description: t("mfr_route_decline_hint", { module: moduleName }) },
        ]

  const pick = (index: number, productId: string) => {
    setPicked((m) => ({ ...m, [index]: productId }))
    const p = data.productById.get(productId)
    const base = frozen.lines[index]
    if (p && base) {
      const screened = screenLine(base.line, base.index, p, needDays, frozen.ctx)
      setQtyInputs((q) => q.map((x, j) => (j === index ? String(defaultMakeQty(screened)) : x)))
    }
  }

  // The answer returns to its requester, in their module (mfg.request.answered).
  const requesterLink = r.orderId ? mfgLinks.salesOrder(r.orderId) : r.projectId ? mfgLinks.project(r.projectId) : r.kind === "cost" ? mfgLinks.salesQuotations() : null
  const emit = (kind: MfgEventKind, to: RecipientSpec[], params: EventParams, link: string | null) =>
    firestore ? emitMfgEvent(firestore, { copy: t, kind, organizationId: data.orgId, actor: data.actor, to, params, link }) : Promise.resolve(0)

  const submit = async () => {
    if (!firestore || busy) return
    setAttempted(true)
    setError(null)
    const text = note.trim()
    if (route === "decline" && !text) return setError(t("mfr_err_reason_required"))
    if (route === "make" && check.formError) return setError(check.formError === "nothing" ? t("mfr_err_nothing_made") : t("mfr_err_fix_lines"))
    if (route === "cost" && lines.some((l) => !l.product)) return setError(t("mfr_err_cost_needs_cards"))
    setBusy(true)
    try {
      if (route === "decline") {
        await declineRequest(firestore, { request: r, reason: text, actor: data.actor })
        await emit("request_declined", [{ users: [r.createdByUserId] }], { number: r.requestNumber, reason: text }, requesterLink)
        toast({ title: t("mfr_toast_declined", { number: r.requestNumber, module: moduleName }) })
      } else if (route === "make") {
        const res = await answerMakeRequest(firestore, {
          request: r,
          lines: lines.map((l, i) => ({ line: l.line, product: l.product, makeQuantity: Math.max(0, draft[i].qty || 0) })),
          note: text || null,
          actor: data.actor,
        })
        await emit(
          "request_answered",
          [{ users: [r.createdByUserId] }],
          { number: r.requestNumber, orders: res.docNumbers.join(" · "), returned: [remainderText ? ` ${t("mfr_ntf_remainder", { qty: remainderText })}` : "", text ? ` — ${text}` : ""].join("") },
          requesterLink
        )
        toast({ title: t("mfr_toast_accepted", { number: r.requestNumber, count: res.workOrderIds.length }) })
      } else {
        await answerCostingRequest(firestore, {
          request: r,
          lines: lines.map((l) => ({ product: l.product as MfgProduct, quantity: l.line.quantity })),
          departments: data.departments,
          settings: data.settings,
          note: text || null,
          actor: data.actor,
        })
        // REQ-06: the manager routes it; only the cost controller reviews and sends.
        await emit("costing_answered", [{ permission: "manufacturing.cost" }], { number: r.requestNumber, request: `${r.requestNumber} — ${info.name || r.createdByUserName}` }, mfgLinks.estimates())
        toast({ title: t("mfr_toast_costed", { number: r.requestNumber }) })
      }
      onClose()
    } catch (err) {
      console.error(err)
      const msg = reqErrorText(t, err)
      setError(msg)
      toast({ title: msg, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const lineName = (l: ScreenedLine) => (
    <span className="block font-semibold text-foreground" dir="auto">
      {l.product?.name || l.line.itemName}
    </span>
  )
  const picker = (l: ScreenedLine) =>
    !frozen.lines[l.index]?.product ? (
      <ProductPicker
        value={picked[l.index] || ""}
        onChange={(id) => pick(l.index, id)}
        products={liveProducts}
        itemName={l.line.itemName}
        label={t("mfr_pick_card_for", { item: l.line.itemName })}
      />
    ) : null

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Check}
      title={t("mfr_answer_title")}
      subtitle={t("mfr_answer_sub")}
      error={error}
      busy={busy}
      onConfirm={submit}
      confirmTone={route === "decline" ? "destructive" : "default"}
      confirmLabel={route === "decline" ? t("mfr_confirm_decline") : route === "cost" ? t("mfr_confirm_cost") : t("mfr_confirm_make")}
      size="lg"
    >
      <MfgReview
        rows={[
          [
            t("mfr_rv_request"),
            <span key="rq" className="inline-flex flex-wrap items-center gap-1.5">
              <span dir="ltr">{r.requestNumber}</span> — {t(`mfr_kind_${info.kind}`)} <RequestSourceChip info={info} />
            </span>,
          ],
          [
            info.source === "sales" ? t("mfr_rv_client") : t("mfr_rv_project"),
            <span key="src" className="inline-flex flex-wrap items-center gap-1.5">
              <span dir="auto">{info.name || "—"}</span>
              <RequestRefs info={info} />
            </span>,
          ],
          [t("mfr_rv_requested_by"), r.createdByUserName],
          [
            t("mfr_rv_requested"),
            <span key="ln" className="block space-y-0.5">
              {lines.map((l) => (
                <span key={l.index} className="block" dir="auto">
                  {l.product?.name || l.line.itemName} × <span dir="ltr">{fmtQty(l.line.quantity)}</span> {productUnitOf(l)}
                </span>
              ))}
            </span>,
          ],
          [t("mfr_needed_by"), `${date.short(r.neededBy)}${r.neededBy ? ` · ${date.relative(r.neededBy)}` : ""}`],
          kind === "make" && [
            t("mfr_rv_verdict"),
            <span key="vd" className="flex flex-wrap gap-1">
              {lines.map((l) => (
                <VerdictPill key={l.index} verdict={l.verdict} />
              ))}
            </span>,
          ],
        ]}
      />

      <MfgChoiceCards value={route} onChange={setRoute} options={options} />

      {route === "make" && (
        <>
          <div className="overflow-hidden rounded-xl border bg-white">
            <ReqTable
              minWidth="min-w-[520px]"
              head={
                <>
                  <Th>{t("mfr_col_line")}</Th>
                  <Th>{t("mfr_col_we_make")}</Th>
                  <Th>{t("mfr_col_verdict")}</Th>
                </>
              }
            >
              {lines.map((l, i) => {
                const lineError = attempted ? check.lineErrors[i] : null
                return (
                  <tr key={l.index}>
                    <Td>
                      {lineName(l)}
                      <span className="block text-[11px] text-muted-foreground">
                        {t("mfr_asked", { qty: fmtQty(l.line.quantity), unit: productUnitOf(l) })}
                        {timeOn && l.possibleDays != null && <> · {t("mfr_possible", { date: date.short(addDaysISO(today, l.possibleDays)) })}</>}
                        {seesMoney && l.verdict && (
                          <>
                            {" · "}
                            {l.verdict.buyPrice
                              ? t("mfr_unit_vs_buy", { make: fmtMoney(l.verdict.unitCost), buy: fmtMoney(l.verdict.buyPrice) })
                              : t("mfr_unit_make", { make: fmtMoney(l.verdict.unitCost) })}
                          </>
                        )}
                      </span>
                      {picker(l)}
                    </Td>
                    <Td className="w-32">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={l.line.quantity}
                        step="any"
                        dir="ltr"
                        aria-label={t("mfr_make_qty_for", { item: l.product?.name || l.line.itemName })}
                        aria-invalid={!!lineError}
                        className={cn("h-10 w-28 text-xs tabular-nums", lineError && "border-destructive")}
                        value={qtyInputs[i] ?? ""}
                        disabled={!l.product}
                        onChange={(e) => setQtyInputs((q) => q.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                      {lineError && (
                        <span className="mt-1 block text-[11px] font-semibold text-destructive">
                          {lineError === "over" ? t("mfr_err_qty_over", { max: fmtQty(l.line.quantity) }) : lineError === "invalid" ? t("mfr_err_qty_invalid") : t("mfr_err_no_card")}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <VerdictPill verdict={l.verdict} />
                    </Td>
                  </tr>
                )
              })}
            </ReqTable>
          </div>
          {unmatched && <MfgNote tone="warn">{t("mfr_unmatched_note")}</MfgNote>}
          {remainderText && orderCount > 0 && <MfgNote tone="warn">{t("mfr_partial_banner", { qty: remainderText, module: moduleName })}</MfgNote>}
          {info.downPayment === "pending" && <MfgNote tone="warn">{t("mfr_dp_banner")}</MfgNote>}
        </>
      )}

      {route === "cost" && (
        <>
          <div className="overflow-hidden rounded-xl border bg-white">
            <ReqTable
              minWidth="min-w-[440px]"
              head={
                <>
                  <Th>{t("mfr_col_line")}</Th>
                  {seesMoney && <Th>{t("mfr_col_cost")}</Th>}
                  {timeOn && <Th>{t("mfr_earliest_ready")}</Th>}
                </>
              }
            >
              {lines.map((l) => (
                <tr key={l.index}>
                  <Td>
                    {lineName(l)}
                    <span className="block text-[11px] text-muted-foreground">
                      <span dir="ltr">{fmtQty(l.line.quantity)}</span> {productUnitOf(l)}
                    </span>
                    {picker(l)}
                  </Td>
                  {seesMoney && <Td className="whitespace-nowrap font-bold">{l.std ? <Money value={l.std.total} /> : "—"}</Td>}
                  {timeOn && <Td className="whitespace-nowrap">{l.possibleDays != null ? date.short(addDaysISO(today, l.possibleDays)) : "—"}</Td>}
                </tr>
              ))}
            </ReqTable>
          </div>
          <MfgNote tone="info" icon={Calculator}>
            {seesMoney && costLines.length === lines.length
              ? timeOn && earliest != null
                ? t("mfr_cost_banner_time", { cost: fmtMoney(costTotal), date: date.short(addDaysISO(today, earliest)) })
                : t("mfr_cost_banner", { cost: fmtMoney(costTotal) })
              : t("mfr_cost_banner_plain")}
          </MfgNote>
        </>
      )}

      <MfgField
        label={route === "decline" ? t("mfr_reason") : t("mfr_note_to", { module: moduleName })}
        required={route === "decline"}
        hint={route === "decline" ? undefined : t("mfr_optional")}
        error={attempted && route === "decline" && !note.trim() ? t("mfr_err_reason_required") : undefined}
        htmlFor="mfr-answer-note"
      >
        <Textarea
          id="mfr-answer-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={route === "decline" ? t("mfr_reason_ph") : undefined}
          aria-invalid={attempted && route === "decline" && !note.trim()}
          className="text-xs"
        />
      </MfgField>

      <MfgEffects
        items={
          route === "decline"
            ? [{ text: t("mfr_eff_decline", { module: moduleName }) }, { text: t("mfr_eff_no_orders"), applies: false }]
            : route === "cost"
              ? [{ text: t("mfr_eff_cost_draft") }, { text: t("mfr_eff_cost_sales") }, { text: t("mfr_eff_nothing_reserved"), applies: false }]
              : [
                  { text: t("mfr_eff_orders", { count: orderCount }), applies: orderCount > 0 },
                  info.source === "sales"
                    ? { text: info.downPayment === "pending" ? t("mfr_eff_client_wait") : t("mfr_eff_client_release") }
                    : { text: t("mfr_eff_project_release") },
                  remainderText ? { text: t("mfr_eff_remainder", { qty: remainderText, module: moduleName }) } : { text: t("mfr_eff_no_remainder"), applies: false },
                ]
        }
      />
      {unmatched && route !== "decline" && (
        <p className="text-[11px] text-muted-foreground">
          {t("mfr_unmatched_names", {
            names: frozen.lines
              .filter((l) => !l.product)
              .map((l) => l.line.itemName)
              .join(sep),
          })}
        </p>
      )}
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Review & send a cost statement
// ---------------------------------------------------------------------------

function useEstimate(estimateId: string) {
  const { data } = useMfgUi()
  return data.estimates.find((e) => e.id === estimateId) || null
}

function clientOf(e: { contactName: string | null }, t: T): string {
  return e.contactName || t("mfr_est_no_client")
}

export function SendEstimateForm({ estimateId, onClose }: { estimateId: string; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const ui = useMfgUi()
  const { data, perms, seesMoney, today, world } = ui
  const firestore = useFirestore()
  const { toast } = useToast()
  const date = useMfgDate()
  const estimate = useEstimate(estimateId)
  const [note, setNote] = useState(() => estimate?.note || "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timeOn = data.settings.features.time
  const lines = useMemo(() => (estimate ? estimate.lines.map((l) => ({ line: l, product: data.productById.get(l.productId) || null })) : []), [estimate, data.productById])
  const earliestDays = useMemo(
    () => (timeOn ? earliestDaysFor(lines.map((l) => ({ product: l.product, quantity: l.line.quantity })), world.calcs, data.departments, world.lost) : null),
    [timeOn, lines, world.calcs, world.lost, data.departments]
  )

  if (!estimate) return <BlockedForm icon={Send} title={t("mfr_send_title")} message={t("mfr_estimate_missing")} onClose={onClose} />
  if (!perms.canCost) return <BlockedForm icon={Send} title={t("mfr_send_title")} message={t("mfr_only_cost_sends")} onClose={onClose} />
  if (estimateStatus(estimate, today, data.settings) !== "draft") return <BlockedForm icon={Send} title={t("mfr_send_title")} message={t("mfr_already_sent")} onClose={onClose} />

  const e = estimate
  const money = seesMoney || perms.canCost
  const sep = locale === "ar" ? "، " : ", "
  const deptName = (productId: string, id: string) =>
    data.departments.find((d) => d.id === id)?.name || data.productById.get(productId)?.route.find((r) => r.departmentId === id)?.departmentName || "—"
  const incomplete = estimateIncomplete(e, data.productById, data.settings)
  const missing = lines.filter((l) => !l.product)
  const costNow = estimateCostToday(e, data.productById, data.departments, data.settings)
  const validity = data.settings.estimateValidityDays

  const submit = async () => {
    if (!firestore || busy) return
    setError(null)
    if (incomplete.length) return setError(t("mfr_err_standard_incomplete"))
    if (missing.length) return setError(t("mfr_err_product_missing"))
    setBusy(true)
    try {
      await sendCostStatement(firestore, { estimate: e, products: data.productById, departments: data.departments, settings: data.settings, earliestDays, note: note.trim() || null, actor: data.actor })
      const request = e.requestId ? data.requests.find((r) => r.id === e.requestId) : null
      if (request?.createdByUserId) {
        await emitMfgEvent(firestore, {
          kind: "cost_statement_sent",
          copy: t,
          organizationId: data.orgId,
          actor: data.actor,
          to: [{ users: [request.createdByUserId] }],
          params: { number: e.estimateNumber, client: e.contactName || "—", days: validity },
          link: mfgLinks.salesQuotations(),
        })
      }
      toast({ title: t("mfr_toast_sent", { number: e.estimateNumber }) })
      onClose()
    } catch (err) {
      console.error(err)
      const msg = reqErrorText(t, err)
      setError(msg)
      toast({ title: msg, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Send}
      title={t("mfr_send_title")}
      subtitle={t("mfr_send_sub")}
      error={error}
      busy={busy}
      onConfirm={submit}
      confirmLabel={t("mfr_send_confirm")}
      size="lg"
    >
      <MfgReview
        rows={[
          [
            t("mfr_rv_statement"),
            <span key="n" dir="auto">
              <span dir="ltr">{e.estimateNumber}</span> — {clientOf(e, t)}
            </span>,
          ],
          [
            t("mfr_rv_client"),
            <span key="c" className="inline-flex flex-wrap items-center gap-1.5">
              <span dir="auto">{clientOf(e, t)}</span>
              <MfgChip tone="muted">{t("mfg4_from_module", { module: t("mfg4_module_crm") })}</MfgChip>
            </span>,
          ],
          ...lines.map((l, i): [ReactNode, ReactNode] => {
            const std = l.product ? standardCost(l.product, data.departments, data.settings, l.line.quantity) : null
            return [
              <span key={`k${i}`} dir="auto">
                {l.line.productName} × <span dir="ltr">{fmtQty(l.line.quantity)}</span> {l.line.unit}
              </span>,
              money ? (
                <span key={`v${i}`}>
                  <Money value={std ? std.total : l.line.totalCost} />{" "}
                  <span className="font-normal text-muted-foreground">({t("mfr_materials_incl_waste", { amount: fmtMoney(std ? std.materials : l.line.materialCost) })})</span>
                </span>
              ) : (
                "—"
              ),
            ]
          }),
          money && [t("mfr_make_cost"), <Money key="tot" value={costNow.total} />],
          timeOn && [t("mfr_earliest_ready"), earliestDays != null ? date.short(addDaysISO(today, earliestDays)) : "—"],
          [
            t("mfr_validity"),
            <span key="val" className="inline-flex flex-wrap items-center gap-1.5">
              {t("mfr_validity_slab_moves", { days: validity })}
              <MfgChip tone="ok">{t("mfr_finance_policy")}</MfgChip>
            </span>,
          ],
        ]}
      />

      <MfgField label={t("mfr_note_to_sales")} hint={t("mfr_optional")} htmlFor="mfr-send-note">
        <Textarea id="mfr-send-note" rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} className="text-xs" />
      </MfgField>

      {incomplete.length > 0 && (
        <MfgNote tone="bad" icon={Lock} title={t("mfr_incomplete_title")}>
          <span className="block">
            {incomplete
              .map((x) => t("mfr_incomplete_line", { product: data.productById.get(x.productId)?.name || x.productId, stations: x.departmentIds.map((id) => deptName(x.productId, id)).join(sep) }))
              .join(" · ")}
          </span>
          <span className="mt-0.5 block">{t("mfr_incomplete_fix")}</span>
        </MfgNote>
      )}
      {missing.length > 0 && <MfgNote tone="bad">{t("mfr_err_product_missing")}</MfgNote>}
      <MfgNote tone="info">{t("mfr_no_price_note")}</MfgNote>
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Recalculate an expired statement
// ---------------------------------------------------------------------------

export function RecalcEstimateForm({ estimateId, onClose }: { estimateId: string; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms, seesMoney, today } = ui
  const firestore = useFirestore()
  const { toast } = useToast()
  const estimate = useEstimate(estimateId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!estimate) return <BlockedForm icon={RotateCcw} title={t("mfr_recalc_title")} message={t("mfr_estimate_missing")} onClose={onClose} />
  if (!perms.canCost) return <BlockedForm icon={RotateCcw} title={t("mfr_recalc_title")} message={t("mfr_only_cost_sends")} onClose={onClose} />
  if (estimateStatus(estimate, today, data.settings) !== "expired") return <BlockedForm icon={RotateCcw} title={t("mfr_recalc_title")} message={t("mfr_not_expired")} onClose={onClose} />

  const e = estimate
  const money = seesMoney || perms.canCost
  const sentDays = estimateSentDays(e, today)
  const now = estimateCostToday(e, data.productById, data.departments, data.settings)
  const before = estimateCost(e)

  const submit = async () => {
    if (!firestore || busy) return
    setError(null)
    setBusy(true)
    try {
      await recalculateCostStatement(firestore, { estimate: e, products: data.productById, departments: data.departments, settings: data.settings, actor: data.actor })
      toast({ title: t("mfr_toast_recalc", { number: e.estimateNumber }) })
      onClose()
    } catch (err) {
      console.error(err)
      const msg = reqErrorText(t, err)
      setError(msg)
      toast({ title: msg, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={RotateCcw}
      title={t("mfr_recalc_title")}
      subtitle={t("mfr_recalc_sub")}
      error={error}
      busy={busy}
      onConfirm={submit}
      confirmLabel={t("mfr_recalc_confirm")}
    >
      <MfgReview
        rows={[
          [
            t("mfr_rv_statement"),
            <span key="n" dir="auto">
              <span dir="ltr">{e.estimateNumber}</span> — {clientOf(e, t)}
            </span>,
          ],
          [t("mfr_rv_sent"), `${sentDays != null ? t("mfr_sent_ago", { days: sentDays }) : "—"} · ${t("mfr_validity_days", { days: e.validityDays || data.settings.estimateValidityDays })}`],
          money && [t("mfr_rv_cost_sent"), <Money key="b" value={before} />],
          money && [t("mfr_rv_cost_today"), <Money key="a" value={now.total} />],
        ]}
      />
      {now.missing.length > 0 && <MfgNote tone="bad">{t("mfr_err_product_missing")}</MfgNote>}
      <MfgNote tone="info">{t("mfr_recalc_note")}</MfgNote>
      <MfgRecordedAs />
    </MfgFormModal>
  )
}
