"use client"

// The decisions before and at the saw: the site survey (a document, not a
// date), release (reserve, not issue), rush (names its price), the shop
// drawing we submit and others approve, the client's slab sign-off on a named
// block, and an order-level step closed once.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { CheckCircle2, Eye, PencilRuler, Play, Plus, Ruler, Trash2, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFirestore } from "@/firebase"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import {
  itemKey,
  lotFree,
  mainMaterial,
  needRemain,
  r1,
  requestedItems,
  standardCost,
  type ApproverOrg,
  type CutPiece,
} from "@/lib/manufacturing-engine"
import { completeOrderStep, recordSurvey, releaseOrder, rushOrder, signOffSlab, submitDrawing } from "@/lib/manufacturing-writes"
import { mfgLinks } from "@/lib/mfg-events"
import { salesOrderOfWorkOrder, type OrderView } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgRecordedAs, blockTexts, departmentNameOf } from "./MfgOrderBits"
import { MfgFileField, type UploadedFile } from "./MfgFileField"
import { MfgEffects, MfgField, MfgFormModal, MfgNote, MfgReview, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"
import {
  CheckRow,
  DateField,
  Num,
  NumField,
  OrderSummary,
  SelectField,
  StationChecklist,
  TextField,
  num,
  optNum,
  todayIso,
  ownerRecipients,
  salesLinkOf,
  useNotify,
  useSubmit,
} from "./MfgFormKit"

type Props = { view: OrderView; onClose: () => void }

const ownerModuleKey = (v: OrderView) => (v.source === "client" ? "mfg4_module_sales" : "mfg4_module_procurement")

// ---------------------------------------------------------------------------
// Record site survey (ORD-10)
// ---------------------------------------------------------------------------

export function SurveyForm({ view, onClose }: Props) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const notify = useNotify()
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const [date, setDate] = useState(todayIso())
  const [measured, setMeasured] = useState("")
  const [note, setNote] = useState("")
  const [sketch, setSketch] = useState<UploadedFile | null>(null)

  const m = num(measured)
  const q = view.quantity
  const mismatch = m > 0 && q > 0 && Math.abs(m - q) / q > 0.02
  const invalid = !sketch ? t("mfg4_err_sketch_required") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    void run(
      () => recordSurvey(firestore, { orderId: view.id, date, measuredQuantity: m > 0 ? m : null, note: note.trim() || null, sketch, actor: ui.data.actor }),
      (r) => {
        if (r.mismatch && view.source !== "stock" && view.order.requestedByUserId) {
          notify.emit("survey_mismatch", ownerRecipients(view), { ref: view.ref, measured: fmtQty(m), qty: fmtQty(q), unit: view.unit }, view.id)
        }
        return r.mismatch ? t("mfo_survey_toast_mismatch", { ref: view.ref }) : t("mfo_survey_toast", { ref: view.ref })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={Ruler} title={t("mfo_survey_title")} subtitle={t("mfo_survey_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_confirm")}>
      <OrderSummary view={view} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DateField id="sv-date" label={t("mfo_survey_date")} value={date} onChange={setDate} required />
        <NumField id="sv-qty" label={t("mfo_survey_measured")} value={measured} onChange={setMeasured} unit={view.unit} hint={t("mfo_optional")} />
      </div>
      <TextField id="sv-note" label={t("mfo_note_optional")} value={note} onChange={setNote} placeholder={t("mfo_survey_note_ph")} />
      <MfgFileField
        orgId={ui.data.orgId}
        folder={`workOrders/${view.id}/survey`}
        value={sketch}
        onChange={setSketch}
        label={t("mfo_survey_sketch")}
        hint={t("mfo_survey_sketch_hint")}
        required
      />
      {mismatch && (
        <MfgNote tone="warn" title={t("mfo_survey_mismatch", { measured: fmtQty(m), qty: fmtQty(q), unit: view.unit })}>
          {view.source === "stock" ? t("mfo_survey_mismatch_stock") : t("mfo_survey_mismatch_owner", { module: t(ownerModuleKey(view)) })}
        </MfgNote>
      )}
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Release (T6) — reserve, not issue
// ---------------------------------------------------------------------------

export function ReleaseForm({ view, onClose }: Props) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const notify = useNotify()
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const { data } = ui
  const c = view.calc
  const blocks = view.releaseBlocks
  const time = data.settings.features.time
  const possible = view.possibleDate
  const late = !!possible && !!view.neededBy && possible > view.neededBy
  const std = standardCost(view.product, data.departments, data.settings, view.quantity)
  const alloc = ui.world.alloc
  const shorts = useMemo(
    () =>
      alloc
        ? requestedItems(view.product)
            .map((it) => ({ it, need: needRemain(c, it.itemName), av: Math.max(0, alloc.free.get(itemKey(it.itemName)) || 0) }))
            .filter((x) => x.need > x.av + 0.05)
        : [],
    [alloc, view.product, c]
  )
  const firstName = departmentNameOf(data.departments, view, 0)
  const invalid = blocks.length ? t("mfg4_err_blocked") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    void run(
      () => releaseOrder(firestore, { orderId: view.id, product: view.product, departments: data.departments, salesOrderId: salesOrderOfWorkOrder(view.order, data.salesOrders.values())?.id ?? null, actor: data.actor }),
      () => {
        const first = c.route[0]?.departmentId
        const unit = c.route[c.firstQ]?.departmentId
        notify.emit("order_released", [notify.station(first), notify.station(unit)], { ref: view.ref, product: view.product.name, qty: fmtQty(view.quantity), unit: view.unit }, view.id)
        return t("mfo_release_toast", { ref: view.ref, dept: firstName })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={Play} title={t("mfo_release_title")} subtitle={t("mfo_release_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_release_confirm")}>
      <OrderSummary view={view} />
      {(time || ui.seesMoney) && (
        <MfgReview
          rows={[
            time && [
              t("mfo_release_possible"),
              possible ? (
                <span key="p" className={late ? "text-destructive" : "text-success"}>
                  {d.short(possible)}
                  {late && view.neededBy ? ` — ${t("mfo_days_after_required", { days: d.dayDiff(possible) - d.dayDiff(view.neededBy) })}` : ""}
                </span>
              ) : (
                "—"
              ),
            ],
            ui.seesMoney && [t("mfo_standard_cost"), <span key="s"><Num>{fmtMoney(std.total)}</Num> {t("mfg4_sar")}</span>],
          ]}
        />
      )}
      {blocks.map((b) => {
        const x = blockTexts(b, view, c.firstQ, data.departments, t)
        return (
          <MfgNote key={b.key} tone="bad" title={x.title}>
            {x.fix}
          </MfgNote>
        )
      })}
      {shorts.length > 0 && (
        <MfgNote tone="warn" title={t("mfo_release_short_title")}>
          <ul className="space-y-0.5">
            {shorts.map((x) => (
              <li key={x.it.itemName}>
                {t("mfo_needs_available", { item: x.it.itemName, need: fmtQty(x.need), available: fmtQty(x.av), unit: x.it.unit })}
              </li>
            ))}
          </ul>
        </MfgNote>
      )}
      {!alloc && <MfgNote tone="info">{t("mfo_stock_loading")}</MfgNote>}
      <MfgEffects
        items={[
          { text: t("mfo_release_eff_reserve") },
          { text: t("mfo_release_eff_queue", { dept: firstName }) },
          { text: t("mfo_release_eff_not_issue"), applies: false },
        ]}
      />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Rush (T21, ORD-09) — shows who it delays before confirming
// ---------------------------------------------------------------------------

export function RushForm({ view, onClose }: Props) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const [reason, setReason] = useState("")
  const mine = new Set(view.calc.route.map((r) => r.departmentId))
  const due = view.neededBy || "9999-12-31"
  const delayed = ui.views.filter(
    (x) => x.live && x.id !== view.id && x.released && !x.rush && x.calc.route.some((r) => mine.has(r.departmentId)) && (x.neededBy || "9999-12-31") >= due
  )
  const invalid = !reason.trim() ? t("mfg4_err_reason_required") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    void run(
      () => rushOrder(firestore, { orderId: view.id, reason: reason.trim(), delays: delayed.map((x) => x.number), actor: ui.data.actor }),
      () => t("mfo_rush_toast", { ref: view.ref })
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={Zap} title={t("mfo_rush_title")} subtitle={t("mfo_rush_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_rush_confirm")}>
      <OrderSummary view={view} />
      <TextField id="rush-reason" label={t("mfo_rush_reason")} value={reason} onChange={setReason} hint={t("mfo_rush_reason_hint")} required />
      <MfgNote tone="warn" title={t("mfo_rush_delays")}>
        {delayed.length ? (
          <ul className="space-y-0.5">
            {delayed.slice(0, 8).map((x) => (
              <li key={x.id}>
                <Num>{x.ref}</Num> — {x.product.name}
              </li>
            ))}
            {delayed.length > 8 && <li>{t("mfo_and_more", { count: delayed.length - 8 })}</li>}
          </ul>
        ) : (
          t("mfo_rush_none")
        )}
      </MfgNote>
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Submit the shop drawing (T7) — we produce, others approve (D11)
// ---------------------------------------------------------------------------

interface CutRow {
  no: string
  length: string
  width: string
  thickness: string
  edge: string
  cutouts: string
}

const toRow = (p: CutPiece): CutRow => ({
  no: p.no,
  length: p.length ? String(p.length) : "",
  width: p.width ? String(p.width) : "",
  thickness: p.thickness != null ? String(p.thickness) : "",
  edge: p.edge || "",
  cutouts: p.cutouts || "",
})

const rowUsed = (r: CutRow) => !!(r.length || r.width || r.thickness || r.edge.trim() || r.cutouts.trim())

export function SubmitDrawingForm({ view, onClose }: Props) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const notify = useNotify()
  const c = view.calc
  const prev = c.slice.drawing
  const gi = c.gates.findIndex((g) => g === "drawing")
  const di = gi >= 0 ? gi : c.firstQ
  const client = view.source === "client"
  const internal = view.source === "stock"
  const gateIndex = view.calc.gates.findIndex((g) => g === "drawing")
  const [org, setOrg] = useState<ApproverOrg>(prev?.approverOrg && prev.approverOrg !== "client" ? prev.approverOrg : "technical_office")
  const [hours, setHours] = useState("")
  const [note, setNote] = useState("")
  const [file, setFile] = useState<UploadedFile | null>(null)
  const [rows, setRows] = useState<CutRow[]>(() => (prev?.cutList || []).map(toRow))

  const setCell = (i: number, key: keyof CutRow, value: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)))
  const addRow = () => setRows((rs) => [...rs, { no: String(rs.length + 1).padStart(2, "0"), length: "", width: "", thickness: "", edge: "", cutouts: "" }])
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i))

  const used = rows.filter(rowUsed)
  const badRow = used.some((r) => !(num(r.length) > 0 && num(r.width) > 0))
  const invalid = badRow ? t("mfo_cut_err_size") : null
  const approver = client ? t("mfg4_approver_client") : internal ? t("mfg4_approver_workshop") : t(`mfg4_approver_${org}`)

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    const cutList: CutPiece[] = used.map((r, i) => ({
      no: r.no.trim() || String(i + 1).padStart(2, "0"),
      length: num(r.length),
      width: num(r.width),
      thickness: optNum(r.thickness),
      edge: r.edge.trim() || null,
      cutouts: r.cutouts.trim() || null,
    }))
    void run(
      () =>
        submitDrawing(firestore, {
          orderId: view.id,
          product: view.product,
          departments: data.departments,
          approverOrg: client ? "client" : org,
          note: note.trim() || null,
          hours: data.settings.features.time && gateIndex >= 0 ? optNum(hours) : null,
          file,
          cutList,
          actor: data.actor,
        }),
      () => {
        if (!internal) {
          const to = client ? ownerRecipients(view) : view.order.projectId ? [{ projectPermission: "projects.edit" as const, projectId: view.order.projectId }] : ownerRecipients(view)
          const link = client ? salesLinkOf(view, data.salesOrders) : view.order.projectId ? mfgLinks.project(view.order.projectId) : null
          notify.emit("drawing_submitted", to, { ref: view.ref, revision: (prev?.revision || 0) + 1, approver: client ? "@mfg4_approver_client" : `@mfg4_approver_${org}` }, view.id, link)
        }
        return t("mfo_drawing_toast", { ref: view.ref, approver })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={PencilRuler} title={t("mfo_drawing_title")} subtitle={t("mfo_drawing_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_drawing_confirm")} size="lg">
      <OrderSummary view={view} />
      {prev?.previousC && (
        <MfgNote tone="warn" title={t("mfo_drawing_returned_c")}>
          {prev.previousC}
        </MfgNote>
      )}
      {internal && <MfgNote tone="info">{t("mfo_drawing_stock_note")}</MfgNote>}
      {client || internal ? (
        <MfgNote tone="info">{t("mfo_drawing_client")}</MfgNote>
      ) : (
        <SelectField
          id="dr-org"
          label={t("mfo_drawing_approver")}
          value={org}
          onChange={(v) => setOrg(v as ApproverOrg)}
          hint={t("mfo_drawing_approver_hint")}
          options={[
            { value: "technical_office", label: t("mfo_org_technical_office") },
            { value: "consultant", label: t("mfo_org_consultant") },
          ]}
        />
      )}
      <div className={cn("grid grid-cols-1 gap-3", data.settings.features.time && "sm:grid-cols-2")}>
        {data.settings.features.time && gateIndex >= 0 && <NumField id="dr-hours" label={t("mfo_drawing_hours")} value={hours} onChange={setHours} unit={t("mfo_h")} hint={t("mfo_hours_hint")} />}
        <TextField id="dr-note" label={t("mfo_drawing_note")} value={note} onChange={setNote} />
      </div>
      <MfgFileField
        orgId={data.orgId}
        folder={`workOrders/${view.id}/drawing`}
        value={file}
        onChange={setFile}
        label={t("mfo_drawing_file")}
        hint={prev?.fileUrl ? t("mfo_drawing_file_keep", { name: prev.fileName || "" }) : t("mfo_drawing_file_hint")}
      />
      <MfgField label={t("mfo_cut_title")} hint={t("mfo_cut_hint")}>
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="bg-muted/40 text-[10px] font-bold text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-start">{t("mfo_cut_no")}</th>
                <th className="px-2 py-1.5 text-start">{t("mfo_cut_length")}</th>
                <th className="px-2 py-1.5 text-start">{t("mfo_cut_width")}</th>
                <th className="px-2 py-1.5 text-start">{t("mfo_cut_thickness")}</th>
                <th className="px-2 py-1.5 text-start">{t("mfo_cut_edge")}</th>
                <th className="px-2 py-1.5 text-start">{t("mfo_cut_cutouts")}</th>
                <th className="w-9 px-1 py-1.5" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const bad = tried && rowUsed(r) && !(num(r.length) > 0 && num(r.width) > 0)
                return (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-1.5 py-1">
                      <Input aria-label={t("mfo_cut_no")} dir="ltr" value={r.no} onChange={(e) => setCell(i, "no", e.target.value)} className="h-9 w-14 text-xs" />
                    </td>
                    <td className="px-1.5 py-1">
                      <Input aria-label={t("mfo_cut_length")} inputMode="decimal" dir="ltr" value={r.length} onChange={(e) => setCell(i, "length", sanitizeDecimalInput(e.target.value))} className={cn("h-9 w-20 text-xs", bad && !num(r.length) && "border-destructive")} />
                    </td>
                    <td className="px-1.5 py-1">
                      <Input aria-label={t("mfo_cut_width")} inputMode="decimal" dir="ltr" value={r.width} onChange={(e) => setCell(i, "width", sanitizeDecimalInput(e.target.value))} className={cn("h-9 w-20 text-xs", bad && !num(r.width) && "border-destructive")} />
                    </td>
                    <td className="px-1.5 py-1">
                      <Input aria-label={t("mfo_cut_thickness")} inputMode="decimal" dir="ltr" value={r.thickness} onChange={(e) => setCell(i, "thickness", sanitizeDecimalInput(e.target.value))} className="h-9 w-16 text-xs" />
                    </td>
                    <td className="px-1.5 py-1">
                      <Input aria-label={t("mfo_cut_edge")} dir="auto" value={r.edge} onChange={(e) => setCell(i, "edge", e.target.value)} className="h-9 min-w-[110px] text-xs" />
                    </td>
                    <td className="px-1.5 py-1">
                      <Input aria-label={t("mfo_cut_cutouts")} dir="auto" value={r.cutouts} onChange={(e) => setCell(i, "cutouts", e.target.value)} className="h-9 min-w-[100px] text-xs" />
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        aria-label={t("mfo_cut_remove")}
                        className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-border/60 px-2 py-1.5">
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={addRow}>
              <Plus size={13} aria-hidden="true" /> {t("mfo_cut_add")}
            </Button>
          </div>
        </div>
      </MfgField>
      <StationChecklist view={view} index={di} />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Client slab sign-off (T9, PR-01) — a sufficient block and a signed form
// ---------------------------------------------------------------------------

export function SlabForm({ view, onClose }: Props) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const c = view.calc
  const main = mainMaterial(view.product)
  const stock = data.stock
  const alloc = ui.world.alloc
  const key = main ? itemKey(main.itemName) : ""
  const need = main ? needRemain(c, main.itemName) : 0
  const lots = useMemo(() => (stock && main ? stock.lots.filter((l) => itemKey(l.itemName) === key && !l.remnant) : []), [stock, main, key])
  const freeOf = (lot: string) => (stock && main ? lotFree(stock, main.itemName, lot, ui.world.calcs, view.id) : 0)
  const [lot, setLot] = useState<string>(() => {
    const best = lots.find((l) => freeOf(l.lot) >= need - 0.05) || lots[0]
    return best?.lot || ""
  })
  useEffect(() => {
    if (lot || !lots.length) return
    const best = lots.find((l) => freeOf(l.lot) >= need - 0.05) || lots[0]
    setLot(best.lot)
  }, [lots])
  const [typedLot, setTypedLot] = useState("")
  const [date, setDate] = useState(todayIso())
  const [numbers, setNumbers] = useState("")
  const [note, setNote] = useState("")
  const [photos, setPhotos] = useState(false)
  const [form, setForm] = useState<UploadedFile | null>(null)

  const registered = lots.length > 0
  const chosen = registered ? lot : typedLot.trim()
  const availableToOrder = alloc && main ? Math.max(0, alloc.free.get(key) || 0) + (alloc.reserved.get(view.id)?.get(key) || 0) : 0
  const free = registered ? freeOf(chosen) : availableToOrder
  const gotOnLot = main
    ? r1(c.slice.materials.filter((m) => itemKey(m.itemName) === key && m.lot === chosen && m.state === "received").reduce((a, m) => a + m.quantity, 0))
    : 0
  const short = Math.max(0, r1(need - free))
  const notices = chosen ? data.notices.filter((n) => !n.closedAt && n.lot === chosen) : []
  const invalid = !main
    ? t("mfo_slab_no_main")
    : !chosen
      ? t("mfg4_err_lot_required")
      : short > 0.05
        ? t("mfg4_err_block_short")
        : !form
          ? t("mfg4_err_form_required")
          : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid || !main) return
    void run(
      () =>
        signOffSlab(firestore, {
          orderId: view.id,
          product: view.product,
          lot: chosen,
          quantity: r1(need + gotOnLot),
          blockFree: r1(free + gotOnLot),
          slabNumbers: numbers.trim() || null,
          photosAttached: photos,
          form,
          note: note.trim() || null,
          date: date || null,
          actor: data.actor,
        }),
      () => {
        notify.emit("slab_signed", [notify.station(c.route[c.firstQ]?.departmentId)], { ref: view.ref, lot: chosen }, view.id)
        return t("mfo_slab_toast", { lot: chosen, ref: view.ref })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={Eye} title={t("mfo_slab_title")} subtitle={t("mfo_slab_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_confirm")}>
      <OrderSummary view={view} />
      {!main ? (
        <MfgNote tone="bad">{t("mfo_slab_no_main")}</MfgNote>
      ) : (
        <>
          <MfgReview
            rows={[[t("mfo_slab_needed"), <span key="n"><Num>{fmtQty(need)}</Num> {main.unit} — {t("mfo_incl_waste", { pct: view.product.wastePercent })} · {main.itemName}</span>]]}
          />
          {registered ? (
            <SelectField
              id="slab-lot"
              label={t("mfo_block")}
              value={lot}
              onChange={setLot}
              hint={t("mfo_slab_block_hint")}
              required
              options={lots.map((l) => ({
                value: l.lot,
                label: `${l.lot} — ${t("mfo_free_qty", { qty: fmtQty(freeOf(l.lot)), unit: main.unit })}${data.notices.some((n) => !n.closedAt && n.lot === l.lot) ? ` — ${t("mfo_has_notice")}` : ""}`,
              }))}
            />
          ) : (
            <TextField id="slab-lot-typed" label={t("mfo_block")} value={typedLot} onChange={setTypedLot} hint={t("mfo_slab_no_lots", { qty: fmtQty(availableToOrder), unit: main.unit })} required />
          )}
          {notices.map((n) => (
            <MfgNote key={n.id} tone="bad" title={t("mfo_notice_on_this_block", { defect: t(`mfg4_defect_${n.defect}`) })}>
              {n.note} — {n.by} · {d.relative(n.at)}
            </MfgNote>
          ))}
          {chosen &&
            (short > 0.05 ? (
              <MfgNote tone="bad" title={t("mfo_slab_short", { qty: fmtQty(short), unit: main.unit })}>
                {t("mfo_slab_short_fix")}
              </MfgNote>
            ) : (
              <MfgNote tone="ok">{t("mfo_slab_covers", { qty: fmtQty(r1(free - need)), unit: main.unit })}</MfgNote>
            ))}
        </>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DateField id="slab-date" label={t("mfo_slab_date")} value={date} onChange={setDate} />
        <TextField id="slab-nos" label={t("mfo_slab_numbers")} value={numbers} onChange={setNumbers} hint={t("mfo_slab_numbers_hint")} />
      </div>
      <TextField id="slab-note" label={t("mfo_note_optional")} value={note} onChange={setNote} placeholder={t("mfo_slab_note_ph")} />
      <CheckRow checked={photos} onChange={setPhotos} title={t("mfo_slab_photos")} hint={t("mfo_slab_photos_hint")} />
      <MfgFileField orgId={data.orgId} folder={`workOrders/${view.id}/slab`} value={form} onChange={setForm} label={t("mfo_slab_form")} hint={t("mfo_slab_form_hint")} required />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// An order-level step closed once (PC-07)
// ---------------------------------------------------------------------------

export function GateForm({ view, index, onClose }: Props & { index: number }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const [hours, setHours] = useState("")
  const c = view.calc
  const q = c.pend[index] || 0
  const dept = departmentNameOf(data.departments, view, index)
  const next = index < c.lastI ? departmentNameOf(data.departments, view, index + 1) : t("mfo_awaiting_close")
  const invalid = q <= 0 ? t("mfo_nothing_in_hand") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    void run(
      () => completeOrderStep(firestore, { orderId: view.id, product: view.product, departments: data.departments, index, hours: data.settings.features.time ? optNum(hours) : null, actor: data.actor }),
      () => {
        if (index < c.lastI) notify.emit("handover", [notify.station(c.route[index + 1]?.departmentId)], { ref: view.ref, qty: fmtQty(q), unit: view.unit, from: dept }, view.id)
        return t("mfo_gate_toast", { dept, qty: fmtQty(q), unit: view.unit })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={CheckCircle2} title={t("mfo_gate_title")} subtitle={t("mfo_gate_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_confirm")}>
      <OrderSummary view={view} />
      <MfgReview
        rows={[
          [t("mfo_step"), dept],
          [t("mfo_hands_over_to"), <span key="h">{next} — <Num>{fmtQty(q)}</Num> {view.unit}</span>],
        ]}
      />
      {data.settings.features.time && <NumField id="gate-hours" label={t("mfo_hours_optional")} value={hours} onChange={setHours} unit={t("mfo_h")} hint={t("mfo_hours_hint")} />}
      <StationChecklist view={view} index={index} />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}
