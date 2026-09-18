"use client"

// Scrap after QC classified it (FN-08, T15, T16): the approver reviews it with
// a classification and who bears it — or returns it with a question QC
// answers — and, in parallel and without waiting for the money (D18), the
// workshop manager decides a re-make from the same block or a declared
// shortfall the owner is told of.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, Check, FileText, Hammer, Trash2, Undo2 } from "lucide-react"
import { useFirestore } from "@/firebase"
import {
  CAUSE_UNKNOWN,
  DEFECT_KINDS,
  itemKey,
  lotFree,
  mainMaterial,
  r1,
  slabOpen,
  wasteFactor,
  type DefectKind,
  type ScrapBearer,
} from "@/lib/manufacturing-engine"
import { clarifyScrap, decideRemake, reviewScrap } from "@/lib/manufacturing-writes"
import type { OrderView } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgRecordedAs, deptName } from "./MfgOrderBits"
import { MfgChoiceCards, MfgFormModal, MfgNote, MfgReview, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"
import { Num, OrderSummary, SelectField, TextField, ownerRecipients, salesLinkOf, useNotify, useSubmit } from "./MfgFormKit"
import { mfgLinks } from "@/lib/mfg-events"
import { causeLabel } from "./MfgFormOutput"

type Props = { view: OrderView; onClose: () => void }

// ---------------------------------------------------------------------------
// Review scrap
// ---------------------------------------------------------------------------

export function ReviewScrapForm({ view, scrapId, onClose }: Props & { scrapId: string }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const s = view.calc.slice.scrap.find((x) => x.id === scrapId)
  const [decision, setDecision] = useState<"approve" | "return">("approve")
  const [classification, setClassification] = useState<"normal" | "abnormal">("normal")
  const [bearer, setBearer] = useState<ScrapBearer>("workshop")
  const [question, setQuestion] = useState("")
  const limit = data.settings.scrapApprovalLimit
  const canApproveAny = data.canCost
  const above = !!s && s.value > limit && !canApproveAny

  const invalid = !s || s.status !== "pending" ? t("mfo_scrap_nothing") : decision === "return" ? (!question.trim() ? t("mfg4_err_question_required") : null) : above ? t("mfg4_err_above_limit") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid || !s) return
    void run(
      () =>
        reviewScrap(firestore, {
          orderId: view.id,
          scrapId,
          decision,
          classification,
          bearer,
          question: decision === "return" ? question.trim() : null,
          settings: data.settings,
          canApproveAny,
          actor: data.actor,
          organizationId: data.orgId,
          product: view.product,
          departments: data.departments,
          notes: view.noteSlices,
        }),
      () => {
        if (decision === "approve") {
          notify.emit("scrap_approved", [notify.managers], { ref: view.ref, classification: `@mfo_scrap_class_${classification}` }, view.id)
          // A scrap borne by someone else goes to the module that pursues it (mfg.scrap.claim).
          const defectParam = s.defect ? `@mfg4_defect_${s.defect}` : "—"
          if (bearer === "supplier") {
            notify.emit("scrap_claim_supplier", [{ permission: "rfq.manage" }], { ref: view.ref, value: fmtMoney(s.value), defect: defectParam, lot: view.calc.slice.slabApproval?.lot || "—" }, view.id, mfgLinks.procurement())
          } else if (bearer === "client" && view.source === "client") {
            notify.emit("scrap_claim_client", ownerRecipients(view), { ref: view.ref, value: fmtMoney(s.value), defect: defectParam }, view.id, salesLinkOf(view, data.salesOrders))
          }
          return t("mfo_scrap_toast_approved", { value: fmtMoney(s.value) })
        }
        notify.emit("scrap_returned", [notify.qc], { ref: view.ref, question: question.trim() }, view.id)
        return t("mfo_scrap_toast_returned")
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={Trash2} title={t("mfo_scrap_title")} subtitle={t("mfo_scrap_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_confirm")} confirmTone={decision === "approve" ? "destructive" : "default"}>
      <OrderSummary view={view} />
      {!s ? (
        <MfgNote tone="info">{t("mfo_scrap_nothing")}</MfgNote>
      ) : (
        <>
          <MfgReview
            rows={[
              [
                t("mfo_scrap_fact"),
                <span key="s">
                  <Num>{fmtQty(s.quantity)}</Num> {view.unit} — {deptName(data.departments, s.departmentId, s.departmentId)} — <Num>{fmtMoney(s.value)}</Num> {t("mfg4_sar")}
                </span>,
              ],
              [t("mfo_defect_and_cause"), `${s.defect ? t(`mfg4_defect_${s.defect}`) : "—"} · ${causeLabel(s.cause, ui, t)}`],
              [t("mfo_reason"), [s.reason, s.clarification ? t("mfo_scrap_clarified", { answer: s.clarification }) : null].filter(Boolean).join(" · ")],
              [t("mfo_scrap_classified_by"), `${s.raisedByName} · ${d.relative(s.raisedAt)}`],
              [t("mfo_scrap_value_basis"), t("mfo_scrap_value_basis_value")],
              s.remnantCredit ? [t("mfo_scrap_remnant_credit"), <span key="c"><Num>{fmtMoney(s.remnantCredit)}</Num> {t("mfg4_sar")}</span>] : null,
            ]}
          />
          <MfgChoiceCards
            value={decision}
            onChange={setDecision}
            options={[
              { id: "approve", icon: Check, title: t("mfo_scrap_approve"), description: t("mfo_scrap_approve_d") },
              { id: "return", icon: Undo2, title: t("mfo_scrap_return"), description: t("mfo_scrap_return_d") },
            ]}
          />
          {decision === "approve" ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectField
                  id="sc-class"
                  label={t("mfo_scrap_classification")}
                  value={classification}
                  onChange={(v) => setClassification(v as "normal" | "abnormal")}
                  options={[
                    { value: "normal", label: t("mfo_scrap_class_normal_long") },
                    { value: "abnormal", label: t("mfo_scrap_class_abnormal_long") },
                  ]}
                />
                <SelectField
                  id="sc-bearer"
                  label={t("mfo_scrap_bearer")}
                  value={bearer}
                  onChange={(v) => setBearer(v as ScrapBearer)}
                  options={(["workshop", "supplier", "carrier", "client"] as ScrapBearer[]).map((b) => ({ value: b, label: t(`mfo_bearer_${b}`) }))}
                />
              </div>
              {above && <MfgNote tone="bad" title={t("mfo_scrap_above", { limit: fmtMoney(limit) })}>{t("mfo_scrap_above_fix")}</MfgNote>}
            </>
          ) : (
            <TextField id="sc-q" label={t("mfo_scrap_question")} value={question} onChange={setQuestion} placeholder={t("mfo_scrap_question_ph")} required multiline />
          )}
        </>
      )}
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Clarify a returned scrap
// ---------------------------------------------------------------------------

export function ClarifyScrapForm({ view, scrapId, onClose }: Props & { scrapId: string }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const c = view.calc
  const s = c.slice.scrap.find((x) => x.id === scrapId)
  const [defect, setDefect] = useState<DefectKind>(s?.defect || "other")
  const [cause, setCause] = useState(s?.cause || CAUSE_UNKNOWN)
  const [answer, setAnswer] = useState("")
  const causes = [
    ...Array.from(new Set(c.route.filter((_, i) => !c.gates[i]).map((r) => r.departmentId))).map((id) => ({ value: id, label: deptName(data.departments, id, id) })),
    { value: "material", label: t("mfg4_cause_material") },
    { value: CAUSE_UNKNOWN, label: t("mfg4_cause_unknown") },
  ]
  const invalid = !s || s.status !== "returned" ? t("mfo_scrap_nothing") : !answer.trim() ? t("mfo_err_answer") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid || !s) return
    void run(
      () => clarifyScrap(firestore, { orderId: view.id, scrapId, defect, cause, answer: answer.trim(), actor: data.actor }),
      () => {
        const approvers = s.value > data.settings.scrapApprovalLimit ? notify.cost : notify.managers
        notify.emit("scrap_resubmitted", [approvers], { ref: view.ref, answer: answer.trim() }, view.id)
        return t("mfo_clar_toast")
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={FileText} title={t("mfo_clar_title")} subtitle={t("mfo_clar_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_clar_confirm")}>
      <OrderSummary view={view} />
      {s?.question && (
        <MfgNote tone="warn" icon={Undo2} title={`${s.questionBy || ""}: ${s.question}`}>
          {t("mfo_clar_scrap_line", { qty: fmtQty(s.quantity), unit: view.unit, reason: s.reason })}
        </MfgNote>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField id="cl-defect" label={t("mfo_defect")} value={defect} onChange={(v) => setDefect(v as DefectKind)} options={DEFECT_KINDS.map((k) => ({ value: k, label: t(`mfg4_defect_${k}`) }))} />
        <SelectField id="cl-cause" label={t("mfo_cause")} value={cause} onChange={setCause} options={causes} />
      </div>
      <TextField id="cl-answer" label={t("mfo_clar_answer")} value={answer} onChange={setAnswer} required multiline />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Re-make or declared shortfall (FL-08, FL-12)
// ---------------------------------------------------------------------------

export function RemakeForm({ view, source, onClose }: Props & { source: "scrap" | "breakage" }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const c = view.calc
  const q = source === "breakage" ? c.brokenOpen : c.scrapUndecided
  const main = mainMaterial(view.product)
  const slab = c.slice.slabApproval
  const stock = data.stock
  const per = main ? main.qtyPerUnit * (main.withWaste ? wasteFactor(view.product) : 1) : 0
  const extra = r1(per * q)
  const free = slab && main && stock ? Math.max(0, r1(lotFree(stock, main.itemName, slab.lot, ui.world.calcs, view.id) - slabOpen(c))) : null

  const [kind, setKind] = useState<"remake" | "shortfall">("remake")
  const [reason, setReason] = useState("")
  const [alt, setAlt] = useState("")
  const [consent, setConsent] = useState("")

  const lotShort = kind === "remake" && free != null && free < extra - 0.05
  const altLots =
    stock && main && slab
      ? stock.lots.filter((l) => itemKey(l.itemName) === itemKey(main.itemName) && l.lot !== slab.lot && !l.remnant).map((l) => ({ lot: l.lot, free: lotFree(stock, main.itemName, l.lot, ui.world.calcs, view.id) }))
      : []

  const invalid = !(q > 0) ? t("mfg4_err_quantity_required") : !reason.trim() ? t("mfg4_err_reason_required") : lotShort && (!alt || !consent.trim()) ? t("mfo_remake_err_block") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    void run(
      () =>
        decideRemake(firestore, {
          orderId: view.id,
          product: view.product,
          departments: data.departments,
          source,
          kind,
          quantity: q,
          reason: reason.trim(),
          alternativeLot: lotShort && alt ? { lot: alt, consent: consent.trim() } : null,
          notes: view.noteSlices,
          actor: data.actor,
        }),
      () => {
        if (kind === "shortfall") {
          if (view.source !== "stock") notify.emit("shortfall", ownerRecipients(view), { ref: view.ref, qty: fmtQty(q), unit: view.unit, reason: reason.trim() }, view.id)
          return t("mfo_remake_toast_short", { qty: fmtQty(q), unit: view.unit })
        }
        const first = c.route[c.firstQ]?.departmentId
        notify.emit("remake", [notify.station(first)], { ref: view.ref, qty: fmtQty(q), unit: view.unit }, view.id)
        return t("mfo_remake_toast_make", { qty: fmtQty(q), unit: view.unit, dept: deptName(data.departments, first, c.route[c.firstQ]?.departmentName || "") })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={Undo2} title={t("mfo_remake_title")} subtitle={t("mfo_remake_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_confirm")}>
      <OrderSummary view={view} />
      <MfgReview
        rows={[
          [source === "breakage" ? t("mfo_remake_broken") : t("mfo_remake_scrap"), <span key="q"><Num>{fmtQty(q)}</Num> {view.unit}</span>],
          slab && main && [
            t("mfo_remake_block"),
            <span key="b">
              {slab.lot} — {free != null ? t("mfo_free_qty", { qty: fmtQty(free), unit: main.unit }) : "—"} · {t("mfo_remake_needs", { qty: fmtQty(extra), unit: main.unit })}
            </span>,
          ],
        ]}
      />
      {source === "scrap" && c.scrapPending > 0 && <MfgNote tone="info">{t("mfg4_c_remake_running")}</MfgNote>}
      <MfgChoiceCards
        value={kind}
        onChange={setKind}
        options={[
          { id: "remake", icon: Hammer, title: t("mfo_remake_make"), description: t("mfo_remake_make_d") },
          { id: "shortfall", icon: AlertTriangle, title: t("mfo_remake_short"), description: view.source === "stock" ? t("mfo_remake_short_d_stock") : t("mfo_remake_short_d") },
        ]}
      />
      {lotShort && main && (
        <>
          <MfgNote tone="bad" title={t("mfo_remake_block_short")}>
            {t("mfo_remake_block_short_fix")}
          </MfgNote>
          <SelectField
            id="rm-alt"
            label={t("mfo_remake_alt")}
            value={alt}
            onChange={setAlt}
            placeholder={t("mfo_choose")}
            required
            options={altLots.map((l) => ({ value: l.lot, label: `${l.lot} — ${t("mfo_free_qty", { qty: fmtQty(l.free), unit: main.unit })}`, disabled: l.free < extra - 0.05 }))}
          />
          <TextField id="rm-consent" label={t("mfo_consent_note")} value={consent} onChange={setConsent} hint={t("mfo_consent_note_hint")} required multiline />
        </>
      )}
      <TextField id="rm-reason" label={t("mfo_remake_reason")} value={reason} onChange={setReason} placeholder={t("mfo_remake_reason_ph")} required />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}
