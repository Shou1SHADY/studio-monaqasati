"use client"

// The atomic event (T13): a station records its good output and its typed
// rejects and hands over — at QC & packing it is the quality release (T13a).
// Then QC decides every reject four ways (FL-03): rework, concession,
// downgrade to a remnant, or scrap at its computed value.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, ClipboardCheck, PencilRuler, Trash2, Undo2, Warehouse } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFirestore } from "@/firebase"
import { cn } from "@/lib/utils"
import {
  CAUSE_MATERIAL,
  CAUSE_UNKNOWN,
  DEFECT_KINDS,
  canDo,
  isQcStation,
  lotFree,
  mainMaterial,
  requestedBom,
  round2,
  slabOpen,
  stationBlocks,
  unitSunkCost,
  type DefectKind,
} from "@/lib/manufacturing-engine"
import { qcDecide, recordOutput } from "@/lib/manufacturing-writes"
import { mfgLinks } from "@/lib/mfg-events"
import type { OrderView } from "@/lib/manufacturing-view"
import { useMfgUi, type MfgUi } from "./MfgUiContext"
import { MfgRecordedAs, blockTexts, departmentNameOf, deptName } from "./MfgOrderBits"
import { MfgChoiceCards, MfgFormModal, MfgNote, MfgReview, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"
import { CheckRow, Num, NumField, OrderSummary, SelectField, StationChecklist, TextField, num, optNum, stationOf, useNotify, useSubmit, type Tr } from "./MfgFormKit"

type Props = { view: OrderView; onClose: () => void }

/** The cause as an event param: a key for material/unknown, the station's name otherwise. */
function causeParam(cause: string | null | undefined, ui: Pick<MfgUi, "data">): string {
  if (!cause || cause === CAUSE_UNKNOWN) return "@mfg4_cause_unknown"
  if (cause === CAUSE_MATERIAL) return "@mfg4_cause_material"
  return deptName(ui.data.departments, cause, cause)
}

export function causeLabel(cause: string | null | undefined, ui: Pick<MfgUi, "data">, t: Tr): string {
  if (!cause || cause === CAUSE_UNKNOWN) return t("mfg4_cause_unknown")
  if (cause === CAUSE_MATERIAL) return t("mfg4_cause_material")
  return deptName(ui.data.departments, cause, cause)
}

/** Earlier-or-same unit stations as defect origins, plus material and unknown (D17). */
function causeOptions(view: OrderView, index: number, ui: MfgUi, t: Tr, wordedFromHere: boolean) {
  const c = view.calc
  const here = c.route[index]?.departmentId
  const seen = new Set<string>()
  const out: Array<{ value: string; label: string }> = []
  c.route.forEach((s, i) => {
    if (i > index || c.gates[i] || seen.has(s.departmentId)) return
    seen.add(s.departmentId)
    const name = departmentNameOf(ui.data.departments, view, i)
    out.push({ value: s.departmentId, label: wordedFromHere ? (s.departmentId === here ? t("mfg4_cause_here") : t("mfg4_cause_from", { dept: name })) : name })
  })
  out.push({ value: CAUSE_MATERIAL, label: t("mfg4_cause_material") }, { value: CAUSE_UNKNOWN, label: t("mfg4_cause_unknown") })
  return out
}

const defectOptions = (t: Tr) => DEFECT_KINDS.map((k) => ({ value: k, label: t(`mfg4_defect_${k}`) }))

// ---------------------------------------------------------------------------
// Record output & hand over / quality release
// ---------------------------------------------------------------------------

export function OutputForm({ view, index, onClose }: Props & { index: number }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const c = view.calc
  const step = c.route[index]
  const station = stationOf(ui, step?.departmentId)
  const qc = isQcStation(station || { name: step?.departmentName || "" })
  const inHand = c.pend[index] || 0
  const overridden = !!(step && c.slice.overrides[step.departmentId])
  const cov = overridden ? Infinity : canDo(c, index)
  const lim = round2(Math.min(inHand, cov))
  const hard = step ? stationBlocks(c, index).filter((b) => b.severity === "hard") : []
  const dept = departmentNameOf(data.departments, view, index)
  const last = index === c.lastI
  const next = last ? t("mfo_out_next_close") : departmentNameOf(data.departments, view, index + 1)
  const time = data.settings.features.time
  const std = step?.hoursPerUnit
  const mine = (!!station?.leadUserId && station.leadUserId === data.actor.id) || (qc && data.canQc)
  const main = mainMaterial(view.product)
  const slabStation = !!step && requestedBom(view.product, step.departmentId).some((b) => b.withWaste)
  const drawing = c.slice.drawing

  const [good, setGood] = useState("")
  const [rej, setRej] = useState("")
  const [hours, setHours] = useState("")
  const [defect, setDefect] = useState<DefectKind | "">("")
  const [cause, setCause] = useState(step?.departmentId || CAUSE_UNKNOWN)
  const [photo, setPhoto] = useState(false)
  const [rem, setRem] = useState("")
  const [fin, setFin] = useState(false)
  const [photosPacking, setPhotosPacking] = useState(false)

  const g = num(good)
  const r = num(rej)
  const over = g + r > inHand + 1e-9
  const beyond = !over && g + r > cov + 1e-9
  const left = round2(inHand - g - r)

  const invalid =
    hard.length > 0
      ? t("mfg4_err_blocked")
      : qc && !data.canQc
        ? t("mfg4_err_qc_only")
        : g + r <= 0
          ? t("mfo_out_err_empty")
          : over
            ? t("mfo_out_err_over", { qty: fmtQty(inHand) })
            : beyond
              ? t("mfg4_err_beyond_materials")
              : r > 0 && !defect
                ? t("mfg4_err_defect_required")
                : qc && g > 0 && !fin
                  ? t("mfg4_err_final_inspection_required")
                  : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid || !step) return
    const remArea = slabStation ? optNum(rem) : null
    void run(
      () =>
        recordOutput(firestore, {
          orderId: view.id,
          product: view.product,
          departments: data.departments,
          settings: data.settings,
          index,
          good: g,
          rejected: r,
          defect: r > 0 && defect ? defect : null,
          cause: r > 0 ? cause : null,
          photoAttached: r > 0 && photo,
          hours: time ? optNum(hours) : null,
          remnantArea: remArea && remArea > 0 ? remArea : null,
          finalInspection: qc && fin,
          photosBeforePacking: qc && photosPacking,
          actorIsQc: data.canQc,
          actor: data.actor,
        }),
      () => {
        if (r > 0 && defect) {
          notify.emit("rejected", [notify.qc], { qty: fmtQty(r), unit: view.unit, dept, defect: `@mfg4_defect_${defect}`, cause: causeParam(cause, ui), ref: view.ref }, view.id)
        }
        if (g > 0 && !last) {
          notify.emit("handover", [notify.station(c.route[index + 1]?.departmentId)], { ref: view.ref, qty: fmtQty(g), unit: view.unit, from: dept }, view.id)
        }
        if (g > 0 && last) {
          notify.emit("awaiting_close", [notify.managers], { ref: view.ref, qty: fmtQty(g), unit: view.unit }, view.id)
        }
        if (remArea && remArea > 0 && main) {
          notify.emit("remnants_returned", [{ permission: "warehouses.manage" }], { ref: view.ref, qty: fmtQty(remArea), unit: main.unit, item: main.itemName, lot: c.slice.slabApproval?.lot ? ` — ${c.slice.slabApproval.lot}` : "" }, view.id, mfgLinks.inventoryDesk())
        }
        const parts = [
          qc ? t("mfo_out_toast_qc", { qty: fmtQty(g), unit: view.unit }) : t("mfo_out_toast", { dept, qty: fmtQty(g), unit: view.unit }),
          r > 0 ? t("mfo_out_toast_rej", { qty: fmtQty(r) }) : null,
          remArea && remArea > 0 ? t("mfo_out_toast_rem", { qty: fmtQty(remArea), unit: main?.unit || "" }) : null,
        ]
        return parts.filter(Boolean).join(" · ")
      }
    )
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={qc ? ClipboardCheck : CheckCircle2}
      title={qc ? t("mfo_out_title_qc") : t("mfo_out_title")}
      subtitle={qc ? t("mfo_out_sub_qc") : t("mfo_out_sub")}
      busy={busy}
      error={tried ? invalid : null}
      onConfirm={submit}
      confirmLabel={qc ? t("mfo_out_confirm_qc") : t("mfo_out_confirm")}
    >
      <OrderSummary view={view} />
      {qc && <MfgNote tone="info" icon={ClipboardCheck} title={t("mfo_out_qc_banner_title")}>{t("mfo_out_qc_banner")}</MfgNote>}
      <MfgReview
        rows={[
          [t("mfo_station"), dept],
          [
            mine ? t("mfo_in_your_hands") : t("mfo_in_hand"),
            <span key="h">
              <Num>{fmtQty(inHand)}</Num> {view.unit}
              {cov !== Infinity && cov < inHand && <span className="text-warning"> — {t("mfo_out_covers_only", { qty: fmtQty(cov) })}</span>}
            </span>,
          ],
          [t("mfo_goes_to"), next],
          time && std != null && [t("mfo_std_time"), t("mfo_std_time_value", { per: fmtQty(std), unit: view.unit, hours: fmtQty(round2(std * inHand)) })],
        ]}
      />
      {hard.map((b) => {
        const x = blockTexts(b, view, index, data.departments, t)
        return (
          <MfgNote key={b.key} tone="bad" title={x.title}>
            {x.fix}
          </MfgNote>
        )
      })}
      {index === c.firstQ && drawing?.code === "B" && (
        <MfgNote tone="warn" icon={PencilRuler} title={t("mfo_b_notes_apply_here")}>
          {drawing.resultNotes || "—"}
        </MfgNote>
      )}
      {index === c.firstQ &&
        view.notices.map((n) => (
          <MfgNote key={n.id} tone="bad" icon={AlertTriangle} title={t("mfo_notice_on_block", { lot: n.lot, defect: t(`mfg4_defect_${n.defect}`) })}>
            {n.note}
          </MfgNote>
        ))}
      <div className={cn("grid grid-cols-1 gap-3", time ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <NumField
          id="out-good"
          label={qc ? t("mfo_out_released") : t("mfo_out_good")}
          value={good}
          onChange={setGood}
          invalid={over || beyond}
          placeholder="0"
          action={
            <Button type="button" variant="outline" className="h-11 shrink-0 gap-1 px-3 text-xs sm:h-10" disabled={lim <= 0} onClick={() => setGood(String(lim))}>
              {t("mfo_all", { qty: fmtQty(lim) })}
            </Button>
          }
        />
        <NumField id="out-rej" label={t("mfo_out_rejected")} value={rej} onChange={setRej} hint={t("mfo_out_rejected_hint")} invalid={over} />
        {time && <NumField id="out-hours" label={t("mfo_hours_optional")} value={hours} onChange={setHours} unit={t("mfo_h")} hint={t("mfo_hours_hint")} />}
      </div>
      {r > 0 && (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-warning/25 bg-warning/5 p-3 sm:grid-cols-2">
          <SelectField id="out-defect" label={t("mfo_defect")} value={defect} onChange={(v) => setDefect(v as DefectKind)} options={defectOptions(t)} placeholder={t("mfo_choose")} required />
          <SelectField id="out-cause" label={t("mfo_cause_origin")} value={cause} onChange={setCause} options={causeOptions(view, index, ui, t, true)} hint={t("mfo_cause_origin_hint")} />
          <div className="sm:col-span-2">
            <CheckRow checked={photo} onChange={setPhoto} title={t("mfo_defect_photo")} />
          </div>
        </div>
      )}
      {slabStation && main && <NumField id="out-rem" label={t("mfo_out_remnants", { unit: main.unit })} value={rem} onChange={setRem} unit={main.unit} hint={t("mfo_out_remnants_hint")} />}
      {qc && g > 0 && (
        <div className="space-y-2">
          <CheckRow checked={fin} onChange={setFin} title={t("mfo_out_final")} hint={t("mfo_out_final_hint")} />
          <CheckRow checked={photosPacking} onChange={setPhotosPacking} title={t("mfo_out_photos_packing")} hint={t("mfo_out_photos_packing_hint")} />
        </div>
      )}
      {g + r > 0 &&
        (over ? (
          <MfgNote tone="bad">{t("mfo_out_err_over", { qty: fmtQty(inHand) })}</MfgNote>
        ) : beyond ? (
          <MfgNote tone="bad">{t("mfo_out_beyond", { qty: fmtQty(cov) })}</MfgNote>
        ) : left > 0 ? (
          <MfgNote tone="warn">{t("mfo_out_partial", { qty: fmtQty(left), unit: view.unit })}</MfgNote>
        ) : (
          <MfgNote tone="ok">{t("mfo_out_full")}</MfgNote>
        ))}
      <StationChecklist view={view} index={index} />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// QC decision — rework · concession · remnant · scrap
// ---------------------------------------------------------------------------

type QcKind = "rework" | "concession" | "remnant" | "scrap"

export function QcForm({ view, index, onClose }: Props & { index: number }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const c = view.calc
  const step = c.route[index]
  const dept = departmentNameOf(data.departments, view, index)
  const held = c.slice.progress[index]?.rejected || 0
  const records = c.slice.rejects.filter((x) => x.index === index || (x.index == null && x.departmentId === step?.departmentId))
  const lastRec = records[records.length - 1]
  const main = mainMaterial(view.product)
  const lot = c.slice.slabApproval?.lot
  const freeInBlock = lot && main && data.stock ? Math.max(0, round2(lotFree(data.stock, main.itemName, lot, ui.world.calcs, view.id) - slabOpen(c))) : null

  const [kind, setKind] = useState<QcKind>("rework")
  const [qty, setQty] = useState(String(held))
  const [defect, setDefect] = useState<DefectKind | "">(lastRec?.defect || "")
  const [cause, setCause] = useState(lastRec?.cause || step?.departmentId || CAUSE_UNKNOWN)
  const [toIndex, setToIndex] = useState(String(index))
  const [consent, setConsent] = useState("")
  const [area, setArea] = useState("")
  const [reason, setReason] = useState("")

  const q = num(qty)
  const credit = kind === "remnant" && main ? Math.round(num(area) * (main.unitCost || 0) * (data.settings.remnantValuePercent / 100)) : 0
  const value = Math.max(0, Math.round(unitSunkCost(view.product, data.departments, data.settings, index) * q - credit))
  const above = value > data.settings.scrapApprovalLimit
  const valued = kind === "scrap" || kind === "remnant"
  const reworkOptions = c.route
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => i <= index && !c.gates[i])
    .map(({ i }) => ({ value: String(i), label: departmentNameOf(data.departments, view, i) }))

  const invalid =
    !(q > 0)
      ? t("mfg4_err_quantity_required")
      : q > held + 1e-9
        ? t("mfg4_err_more_than_rejected")
        : !defect
          ? t("mfg4_err_defect_required")
          : kind === "concession" && !consent.trim()
            ? t("mfg4_err_consent_required")
            : kind === "remnant" && !(num(area) > 0)
              ? t("mfg4_err_remnant_area_required")
              : valued && !reason.trim()
                ? t("mfg4_err_reason_required")
                : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid || !defect) return
    void run(
      () =>
        qcDecide(firestore, {
          orderId: view.id,
          product: view.product,
          departments: data.departments,
          settings: data.settings,
          index,
          kind,
          quantity: q,
          defect,
          cause,
          toIndex: kind === "rework" ? Number(toIndex) : null,
          consent: kind === "concession" ? consent.trim() : null,
          remnantArea: kind === "remnant" ? num(area) : null,
          reason: reason.trim(),
          actor: data.actor,
        }),
      (res) => {
        const st = stationOf(ui, step?.departmentId)
        // The discovering lead hears QC's decision on the rejects they recorded.
        const discoverer = [...c.slice.rejects].reverse().find((x) => x.index === index)?.byId
        if (st && !isQcStation(st)) notify.emit("qc_decision", [discoverer ? notify.users(discoverer) : notify.station(step?.departmentId)], { ref: view.ref, qty: fmtQty(q), unit: view.unit, decision: `@mfo_qc_kind_${kind}` }, view.id)
        if (valued) {
          // The approver (manager up to the limit, cost controller above) and the
          // manager, who decides the re-make without waiting (FL-12).
          const approvers = res.scrapValue > data.settings.scrapApprovalLimit ? notify.cost : notify.managers
          notify.emit("scrap_raised", [approvers, notify.managers], { ref: view.ref, qty: fmtQty(q), unit: view.unit, value: fmtMoney(res.scrapValue), defect: `@mfg4_defect_${defect}` }, view.id)
        }
        if (kind === "remnant" && main && num(area) > 0) {
          notify.emit("remnants_returned", [{ permission: "warehouses.manage" }], { ref: view.ref, qty: fmtQty(num(area)), unit: main.unit, item: main.itemName, lot: c.slice.slabApproval?.lot ? ` — ${c.slice.slabApproval.lot}` : "" }, view.id, mfgLinks.inventoryDesk())
        }
        if (kind === "rework") return t("mfo_qc_toast_rework", { qty: fmtQty(q), unit: view.unit, dept: departmentNameOf(data.departments, view, Number(toIndex)) })
        if (kind === "concession") return t("mfo_qc_toast_concession", { qty: fmtQty(q), unit: view.unit })
        return t("mfo_qc_toast_scrap", { qty: fmtQty(q), unit: view.unit })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={AlertTriangle} title={t("mfo_qc_title")} subtitle={t("mfo_qc_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_confirm")} size="lg">
      <OrderSummary view={view} />
      <MfgReview
        rows={[
          [t("mfo_qc_rejected"), <span key="r"><Num>{fmtQty(held)}</Num> {view.unit} — {dept}</span>],
          ...records.map(
            (x) =>
              [
                `${x.by} · ${d.relative(x.at)}`,
                [
                  `${fmtQty(x.quantity)} — ${t(`mfg4_defect_${x.defect}`)}`,
                  t("mfo_from_cause", { cause: causeLabel(x.cause, ui, t) }),
                  x.note,
                  x.photoAttached ? t("mfo_with_photo") : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              ] as [string, string]
          ),
          freeInBlock != null && main && [t("mfo_free_in_approved_block"), <span key="f">{lot} — <Num>{fmtQty(freeInBlock)}</Num> {main.unit}</span>],
        ]}
      />
      <MfgChoiceCards
        value={kind}
        onChange={setKind}
        options={[
          { id: "rework", icon: Undo2, title: t("mfo_qc_kind_rework"), description: t("mfo_qc_kind_rework_d") },
          { id: "concession", icon: CheckCircle2, title: t("mfo_qc_kind_concession"), description: t("mfo_qc_kind_concession_d") },
          ...(main ? [{ id: "remnant" as const, icon: Warehouse, title: t("mfo_qc_kind_remnant"), description: t("mfo_qc_kind_remnant_d") }] : []),
          { id: "scrap", icon: Trash2, title: t("mfo_qc_kind_scrap"), description: t("mfo_qc_kind_scrap_d") },
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NumField id="qc-qty" label={t("mfo_qty")} value={qty} onChange={setQty} unit={view.unit} hint={t("mfo_qc_qty_hint")} invalid={q > held + 1e-9} required />
        <SelectField id="qc-defect" label={t("mfo_defect")} value={defect} onChange={(v) => setDefect(v as DefectKind)} options={defectOptions(t)} placeholder={t("mfo_choose")} required />
        <SelectField id="qc-cause" label={t("mfo_cause")} value={cause} onChange={setCause} options={causeOptions(view, index, ui, t, false)} required />
      </div>
      {kind === "rework" && <SelectField id="qc-to" label={t("mfo_qc_back_to")} value={toIndex} onChange={setToIndex} options={reworkOptions} hint={t("mfo_qc_back_to_hint")} />}
      {kind === "concession" && (
        <TextField
          id="qc-consent"
          label={t("mfo_qc_consent")}
          value={consent}
          onChange={setConsent}
          hint={view.source === "client" ? t("mfo_qc_consent_client") : view.source === "project" ? t("mfo_qc_consent_project") : t("mfo_qc_consent_stock")}
          required
          multiline
        />
      )}
      {kind === "remnant" && main && <NumField id="qc-area" label={t("mfo_qc_remnant_area", { unit: main.unit })} value={area} onChange={setArea} unit={main.unit} required />}
      {valued && (
        <>
          {ui.seesMoney && (
            <MfgReview
              rows={[
                [
                  t("mfo_qc_scrap_value"),
                  <span key="v">
                    <Num>{fmtMoney(value)}</Num> {t("mfg4_sar")}
                    {credit > 0 && <span className="text-muted-foreground"> {t("mfo_qc_after_remnant", { value: fmtMoney(credit) })}</span>}
                  </span>,
                ],
              ]}
            />
          )}
          <MfgNote tone={above ? "bad" : "warn"}>{above ? t("mfo_qc_above_limit") : t("mfo_qc_within_limit")}</MfgNote>
        </>
      )}
      <TextField id="qc-reason" label={valued ? t("mfo_reason") : t("mfo_note_optional")} value={reason} onChange={setReason} hint={t("mfo_qc_reason_hint")} required={valued} />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}
