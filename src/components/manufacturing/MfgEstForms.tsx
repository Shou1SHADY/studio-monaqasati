"use client"

// The estimate's decisions, one form each: review the cost and send it to
// sales; log the quote sales issued (with its margin, and a named Finance
// approval under the floor); record the award and create the work orders;
// or record the quote lost. Every form states what will happen before the
// confirm button is pressed.

import { useState, type ChangeEvent } from "react"
import { useTranslations } from "next-intl"
import { FileText, Send, Trophy, XCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { DEFAULT_QUOTATION_VAT_PERCENT } from "@/lib/quotation-document"
import { addDaysISO, estimateCost, marginPercent, minPriceFor, round2, type MfgCostEstimate } from "@/lib/manufacturing-engine"
import { logEstimateQuote, markEstimateLost, markEstimateWon, sendCostEstimate } from "@/lib/manufacturing-writes"
import { estimateEarliestDays, parseQty, quoteCheck, validateAward, validateQuote, validateValidityDays } from "@/lib/manufacturing-requests"
import { useMfgUi } from "./MfgUiContext"
import { MfgChip, MfgEffects, MfgField, MfgFormModal, MfgNote, MfgReview, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"
import { MfgReqTable, Td, Th } from "./MfgReqBits"

const WRITE_ERRORS: Record<string, string> = {
  below_floor: "mfg2_err_below_floor",
  by_required: "mfg2_err_name_required",
  quote_required: "mfg3_est_err_quote_no",
  price_required: "mfg3_est_err_price",
  product_missing: "mfg3_est_err_product_missing",
}

function useWriteError() {
  const t = useTranslations("Portal.Shared")
  const { toast } = useToast()
  return (err: unknown): string => {
    console.error(err)
    const msg = t(WRITE_ERRORS[(err as Error)?.message] || "mfg_save_error")
    toast({ title: msg, variant: "destructive" })
    return msg
  }
}

const clientOf = (e: MfgCostEstimate, t: (k: string) => string) => e.contactName || e.requestedBy || t("mfg3_est_no_client")

/** Materials (incl. waste) · labour & overhead · cost, per line. */
function EstimateCostTable({ estimate: e }: { estimate: MfgCostEstimate }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const timeOn = data.settings.features.time
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <MfgReqTable
        minWidth="min-w-[520px]"
        head={
          <>
            <Th>{t("mfg3_req_col_line")}</Th>
            <Th>{t("mfg3_est_col_materials")}</Th>
            <Th>{t("mfg2_cost_labour_oh")}</Th>
            <Th>{t("mfg3_est_col_cost")}</Th>
          </>
        }
      >
        {e.lines.map((l, i) => {
          const p = data.productById.get(l.productId)
          return (
            <tr key={i}>
              <Td>
                <span className="block font-semibold text-foreground" dir="auto">
                  {l.productName}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {fmtQty(l.quantity)} {l.unit}
                  {p && p.wastePercent > 0 && <> · {t("mfg3_est_incl_waste", { pct: fmtQty(p.wastePercent) })}</>}
                  {timeOn && l.hours > 0 && <> · {t("mfg3_req_line_hours", { hours: fmtQty(Math.round(l.hours)) })}</>}
                </span>
              </Td>
              <Td className="whitespace-nowrap tabular-nums">{fmtMoney(l.materialCost)}</Td>
              <Td className="whitespace-nowrap tabular-nums">{fmtMoney(l.labourCost + l.overheadCost)}</Td>
              <Td className="whitespace-nowrap font-bold tabular-nums">{fmtMoney(l.totalCost)}</Td>
            </tr>
          )
        })}
      </MfgReqTable>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Draft → sent
// ---------------------------------------------------------------------------

export function EstimateSendForm({ estimate: e, onClose }: { estimate: MfgCostEstimate; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { data, today, perms } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const writeError = useWriteError()
  const date = useMfgDate()
  const [validity, setValidity] = useState(String(e.validityDays || 15))
  const [note, setNote] = useState(e.note || "")
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cost = estimateCost(e)
  const validityOk = validateValidityDays(validity)
  const earliest = data.settings.features.time ? estimateEarliestDays(e, data.productById, data.scheduleInputs, data.departments) : null

  const submit = async () => {
    if (!firestore || busy) return
    setAttempted(true)
    if (!validityOk) {
      setError(t("mfg3_est_err_validity"))
      return
    }
    setError(null)
    setBusy(true)
    try {
      await sendCostEstimate(firestore, { estimateId: e.id, validityDays: Number(validity), note: note.trim() || null, actor: data.actor })
      toast({ title: t("mfg2_est_sent_toast") })
      onClose()
    } catch (err) {
      setError(writeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Send}
      title={t("mfg3_est_send_title")}
      subtitle={t("mfg3_est_send_sub")}
      error={error}
      busy={busy}
      onConfirm={submit}
      confirmLabel={t("mfg3_est_send_confirm")}
      size="lg"
    >
      <MfgReview
        rows={[
          [t("mfg2_field_client"), <span key="c" dir="auto">{clientOf(e, t)}</span>],
          e.requestedBy ? [t("mfg2_field_requested_by"), e.requestedBy] : null,
          earliest != null ? [t("mfg3_est_earliest_possible"), t("mfg3_est_earliest_from_today", { date: date.short(addDaysISO(today, earliest)) })] : null,
        ]}
      />
      {perms.seesMoney && (
        <>
          <EstimateCostTable estimate={e} />
          <MfgReview
            rows={[
              [t("mfg2_est_make_cost"), <b key="c" className="tabular-nums">{fmtMoney(cost)} ﷼</b>],
              [t("mfg2_est_floor", { percent: data.settings.minMarginPercent }), <span key="f" className="tabular-nums">{fmtMoney(minPriceFor(cost, data.settings))} ﷼</span>],
            ]}
          />
        </>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MfgField
          label={t("mfg2_est_validity_field")}
          required
          hint={t("mfg2_est_validity_hint")}
          error={attempted && !validityOk ? t("mfg3_est_err_validity") : undefined}
          htmlFor="mfg-est-validity"
        >
          <Input
            id="mfg-est-validity"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={validity}
            aria-invalid={attempted && !validityOk}
            onChange={(ev) => setValidity(ev.target.value)}
          />
        </MfgField>
        <MfgField label={t("mfg2_est_note_to_sales")} hint={t("mfg2_field_note_optional")} htmlFor="mfg-est-note">
          <Input id="mfg-est-note" value={note} onChange={(ev) => setNote(ev.target.value)} placeholder={t("mfg3_est_note_ph")} />
        </MfgField>
      </div>
      <MfgNote tone="info">{t("mfg2_est_no_price_note")}</MfgNote>
      <MfgEffects
        items={[
          { text: t("mfg3_est_eff_reaches_sales") },
          { text: t("mfg3_est_eff_sales_quote") },
          { text: t("mfg3_req_eff_nothing_reserved"), applies: false },
        ]}
      />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Sent → quoted
// ---------------------------------------------------------------------------

export function EstimateQuoteForm({ estimate: e, onClose }: { estimate: MfgCostEstimate; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const writeError = useWriteError()
  const [draft, setDraft] = useState({ quoteNumber: "", price: "", issuedBy: "", financeApprover: "" })
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cost = estimateCost(e)
  const priceNum = parseQty(draft.price)
  const price = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : 0
  const check = quoteCheck(price, cost, data.settings)
  const v = validateQuote(draft, cost, data.settings)
  const vat = DEFAULT_QUOTATION_VAT_PERCENT
  const set = (k: keyof typeof draft) => (ev: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: ev.target.value }))

  const submit = async () => {
    if (!firestore || busy) return
    setAttempted(true)
    if (!v.ok) {
      setError(
        v.quoteNumber
          ? t("mfg3_est_err_quote_no")
          : v.price
            ? t("mfg3_est_err_price")
            : v.issuedBy
              ? t("mfg3_est_err_issued_by")
              : t("mfg2_err_below_floor")
      )
      return
    }
    setError(null)
    setBusy(true)
    try {
      await logEstimateQuote(firestore, {
        estimate: e,
        quoteNumber: draft.quoteNumber.trim(),
        quotedPrice: price,
        quotedByName: draft.issuedBy.trim(),
        financeApprovalBy: check.below ? draft.financeApprover.trim() : null,
        settings: data.settings,
      })
      toast({ title: t("mfg2_est_quote_logged_toast") })
      onClose()
    } catch (err) {
      setError(writeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={FileText}
      title={t("mfg3_est_quote_title")}
      subtitle={t("mfg3_est_quote_sub")}
      error={error}
      busy={busy}
      onConfirm={submit}
      confirmLabel={t("mfg3_est_quote_confirm")}
      size="lg"
    >
      <MfgReview
        rows={[
          [t("mfg3_est_rv_estimate"), <span key="e" dir="auto">{e.estimateNumber} — {clientOf(e, t)}</span>],
          [t("mfg3_est_rv_our_cost"), <span key="c" className="tabular-nums">{fmtMoney(cost)} ﷼</span>],
          [
            t("mfg3_est_floor_label"),
            <span key="f" className="tabular-nums">
              {fmtMoney(check.floor)} ﷼ · {t("mfg3_est_min_margin", { percent: data.settings.minMarginPercent })}
            </span>,
          ],
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MfgField
          label={t("mfg2_est_quote_number")}
          required
          hint={t("mfg3_est_quote_no_hint")}
          error={attempted && v.quoteNumber ? t("mfg3_est_err_quote_no") : undefined}
          htmlFor="mfg-quote-no"
        >
          <Input id="mfg-quote-no" dir="ltr" value={draft.quoteNumber} onChange={set("quoteNumber")} placeholder="Q-XXXXXX" aria-invalid={attempted && v.quoteNumber} />
        </MfgField>
        <MfgField
          label={t("mfg2_est_quoted_price")}
          required
          hint={t("mfg3_est_before_vat")}
          error={attempted && v.price ? t("mfg3_est_err_price") : undefined}
          htmlFor="mfg-quote-price"
        >
          <Input
            id="mfg-quote-price"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={draft.price}
            onChange={set("price")}
            aria-invalid={attempted && v.price}
            className="tabular-nums"
          />
        </MfgField>
        <MfgField
          label={t("mfg2_est_quoted_by")}
          required
          hint={t("mfg3_est_issued_by_hint")}
          error={attempted && v.issuedBy ? t("mfg3_est_err_issued_by") : undefined}
          htmlFor="mfg-quote-by"
        >
          <Input id="mfg-quote-by" value={draft.issuedBy} onChange={set("issuedBy")} aria-invalid={attempted && v.issuedBy} />
        </MfgField>
      </div>
      {price > 0 && (
        <MfgNote tone={check.below ? "bad" : "ok"} title={t("mfg3_est_margin_banner", { margin: check.margin ?? 0 })}>
          {check.below
            ? t("mfg3_est_below_floor", { percent: data.settings.minMarginPercent, gap: fmtMoney(check.gap) })
            : t("mfg3_est_above_floor")}
        </MfgNote>
      )}
      {check.below && (
        <MfgField
          label={t("mfg2_est_finance_approval")}
          required
          hint={t("mfg3_est_finance_hint")}
          error={attempted && v.financeApprover ? t("mfg2_err_below_floor") : undefined}
          htmlFor="mfg-quote-fin"
        >
          <Input id="mfg-quote-fin" value={draft.financeApprover} onChange={set("financeApprover")} aria-invalid={attempted && v.financeApprover} />
        </MfgField>
      )}
      {price > 0 && (
        <MfgNote tone="info">{t("mfg3_est_vat_note", { percent: vat, total: fmtMoney(round2(price * (1 + vat / 100))) })}</MfgNote>
      )}
      <MfgEffects
        items={[
          { text: t("mfg3_est_eff_quote_logged") },
          check.below ? { text: t("mfg3_est_eff_quote_approval") } : null,
          { text: t("mfg3_est_eff_quote_award") },
        ]}
      />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Quoted → won (work orders) or lost
// ---------------------------------------------------------------------------

export function EstimateWonForm({ estimate: e, onClose }: { estimate: MfgCostEstimate; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { data, today, perms } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const writeError = useWriteError()
  const date = useMfgDate()
  const [awardDate, setAwardDate] = useState(today)
  const [confirmedBy, setConfirmedBy] = useState("")
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cost = estimateCost(e)
  const margin = e.quotedPrice ? marginPercent(e.quotedPrice, cost) : null
  const v = validateAward({ date: awardDate, confirmedBy }, today)
  const missing = e.lines.filter((l) => !data.productById.has(l.productId))
  const gated = e.lines.some((l) => {
    const p = data.productById.get(l.productId)
    return !!p && (p.requiresMeasurement || p.requiresDrawingApproval || p.requiresSlabApproval)
  })
  const who = e.requestedBy || e.contactName || data.actor.name

  const submit = async () => {
    if (!firestore || busy) return
    setAttempted(true)
    if (missing.length) {
      setError(t("mfg3_est_err_product_missing"))
      return
    }
    if (!v.ok) {
      setError(v.date === "future" ? t("mfg3_est_err_award_future") : v.date ? t("mfg3_est_err_award_date") : t("mfg2_err_name_required"))
      return
    }
    setError(null)
    setBusy(true)
    try {
      await markEstimateWon(firestore, { estimate: e, confirmedBy: confirmedBy.trim(), products: data.products, actor: data.actor, awardDate })
      toast({ title: t("mfg2_est_won_toast") })
      onClose()
    } catch (err) {
      setError(writeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Trophy}
      title={t("mfg2_est_won_title")}
      subtitle={t("mfg3_est_won_sub")}
      error={error}
      busy={busy}
      onConfirm={submit}
      confirmLabel={t("mfg3_est_won_confirm")}
      size="lg"
    >
      <MfgReview
        rows={[
          [t("mfg3_est_rv_quote"), <span key="q" dir="auto">{e.quoteNumber || "—"} — {clientOf(e, t)}</span>],
          perms.seesMoney && e.quotedPrice != null
            ? [t("mfg2_est_quoted_price"), <span key="p" className="tabular-nums">{fmtMoney(e.quotedPrice)} ﷼ · {t("mfg2_margin")} {margin ?? "—"}%</span>]
            : null,
          perms.seesMoney ? [t("mfg3_est_rv_estimated_cost"), <span key="c">{fmtMoney(cost)} ﷼ — {t("mfg3_est_measured_against")}</span>] : null,
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MfgField
          label={t("mfg3_est_award_date")}
          required
          error={attempted && v.date ? t(v.date === "future" ? "mfg3_est_err_award_future" : "mfg3_est_err_award_date") : undefined}
          htmlFor="mfg-award-date"
        >
          <Input id="mfg-award-date" type="date" max={today} value={awardDate} onChange={(ev) => setAwardDate(ev.target.value)} aria-invalid={attempted && !!v.date} />
        </MfgField>
        <MfgField
          label={t("mfg2_est_confirmed_by")}
          required
          hint={t("mfg3_est_confirmed_by_hint")}
          error={attempted && v.confirmedBy ? t("mfg2_err_name_required") : undefined}
          htmlFor="mfg-award-by"
        >
          <Input id="mfg-award-by" value={confirmedBy} onChange={(ev) => setConfirmedBy(ev.target.value)} aria-invalid={attempted && v.confirmedBy} />
        </MfgField>
      </div>
      <div className="overflow-hidden rounded-xl border bg-white">
        <MfgReqTable
          minWidth="min-w-[420px]"
          head={
            <>
              <Th>{t("mfg3_est_col_order_per_line")}</Th>
              <Th>{t("mfg3_est_col_due")}</Th>
            </>
          }
        >
          {e.lines.map((l, i) => {
            const p = data.productById.get(l.productId)
            return (
              <tr key={i}>
                <Td>
                  <span className="block font-semibold text-foreground" dir="auto">
                    {l.productName}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                    {fmtQty(l.quantity)} {l.unit}
                    {!p && <MfgChip tone="bad">{t("mfg3_est_product_missing")}</MfgChip>}
                    {p?.requiresMeasurement && <MfgChip tone="warn">{t("mfg3_est_flag_measure")}</MfgChip>}
                    {p?.requiresDrawingApproval && <MfgChip tone="warn">{t("mfg3_est_flag_drawing")}</MfgChip>}
                    {p?.requiresSlabApproval && <MfgChip tone="warn">{t("mfg3_est_flag_slab")}</MfgChip>}
                  </span>
                </Td>
                <Td className="whitespace-nowrap">{date.short(e.neededBy)}</Td>
              </tr>
            )
          })}
        </MfgReqTable>
      </div>
      <MfgEffects
        items={[
          { text: t("mfg3_est_eff_orders", { count: e.lines.length, name: who, quote: e.quoteNumber || "—" }) },
          { text: t("mfg3_est_eff_queue") },
          { text: t("mfg3_est_eff_gated"), applies: gated },
          e.requestId ? { text: t("mfg3_est_eff_request_closes") } : null,
        ]}
      />
    </MfgFormModal>
  )
}

export function EstimateLostForm({ estimate: e, onClose }: { estimate: MfgCostEstimate; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { perms } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const writeError = useWriteError()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!firestore || busy) return
    setBusy(true)
    try {
      await markEstimateLost(firestore, e.id)
      toast({ title: t("mfg2_est_lost_toast") })
      onClose()
    } catch (err) {
      setError(writeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={XCircle}
      title={t("mfg3_est_lost_title")}
      subtitle={t("mfg3_est_lost_sub")}
      error={error}
      busy={busy}
      onConfirm={submit}
      confirmLabel={t("mfg3_est_lost_confirm")}
      confirmTone="destructive"
    >
      <MfgReview
        rows={[
          [t("mfg3_est_rv_quote"), <span key="q" dir="auto">{e.quoteNumber || "—"} — {clientOf(e, t)}</span>],
          perms.seesMoney && e.quotedPrice != null ? [t("mfg2_est_quoted_price"), <span key="p" className="tabular-nums">{fmtMoney(e.quotedPrice)} ﷼</span>] : null,
        ]}
      />
      <MfgEffects
        items={[
          { text: t("mfg3_est_eff_lost_record") },
          { text: t("mfg3_est_eff_lost_nothing"), applies: false },
        ]}
      />
    </MfgFormModal>
  )
}
