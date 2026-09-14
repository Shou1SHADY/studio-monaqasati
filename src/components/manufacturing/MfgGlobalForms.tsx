"use client"

// Workshop-wide decisions, not tied to one order: the one order the workshop
// creates itself (a stock work order, WS-05), a stop or absence that moves
// every possible date through a station (FL-14), and a quality notice on a
// block that follows it into every order using it (FL-11). Requests, cost
// statements and product cards open their own forms from here.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Factory, Gem, PauseCircle, Plug, UserX, Wrench, Zap } from "lucide-react"
import { useFirestore } from "@/firebase"
import { cn } from "@/lib/utils"
import {
  DEFECT_KINDS,
  addDaysISO,
  deptCapacity,
  effectiveRoute,
  itemKey,
  possibleForDays,
  remAt,
  roundNeed,
  scheduleOrders,
  standardCost,
  stationGate,
  wasteFactor,
  type DefectKind,
  type MfgProduct,
} from "@/lib/manufacturing-engine"
import { STOP_KINDS, createStockWorkOrder, raiseBlockNotice, recordStop, type StopKind } from "@/lib/manufacturing-writes"
import { myStations } from "@/lib/manufacturing-view"
import { useMfgUi, type GlobalAction } from "./MfgUiContext"
import { MfgRecordedAs, deptName } from "./MfgOrderBits"
import { MfgChoiceCards, MfgEffects, MfgFormModal, MfgNote, MfgReview, MfgSearchField, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"
import { CheckRow, DateField, Num, NumField, SelectField, TextField, num, todayIso, useNotify, useSubmit, type Station } from "./MfgFormKit"
import { mfgLinks } from "@/lib/mfg-events"
import { AnswerRequestForm, RecalcEstimateForm, SendEstimateForm } from "./MfgRequestForms"
import { MfgProductForm } from "./MfgPrdForm"

export function MfgGlobalForms({ action, onClose, onOpenOrder }: { action: GlobalAction; onClose: () => void; onOpenOrder: (id: string) => void }) {
  switch (action.kind) {
    case "stockOrder":
      return <StockOrderForm onClose={onClose} onOpenOrder={onOpenOrder} />
    case "stop":
      return <StopForm departmentId={action.departmentId} onClose={onClose} />
    case "blockNotice":
      return <BlockNoticeForm lot={action.lot} onClose={onClose} />
    case "answerRequest":
      return <AnswerRequestForm requestId={action.requestId} onClose={onClose} />
    case "sendEstimate":
      return <SendEstimateForm estimateId={action.estimateId} onClose={onClose} />
    case "recalcEstimate":
      return <RecalcEstimateForm estimateId={action.estimateId} onClose={onClose} />
    case "product":
      return <MfgProductForm productId={action.productId} onClose={onClose} />
  }
}

// ---------------------------------------------------------------------------
// Stock work order (WS-05, ORD-02) — pick a product card, then preview
// ---------------------------------------------------------------------------

function StockOrderForm({ onClose, onOpenOrder }: { onClose: () => void; onOpenOrder: (id: string) => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const [step, setStep] = useState(0)
  const [productId, setProductId] = useState("")
  const [search, setSearch] = useState("")
  const [qty, setQty] = useState("")
  const [due, setDue] = useState(addDaysISO(todayIso(), 14))
  const products = useMemo(() => data.products.filter((p) => !p.archived && effectiveRoute(p).length > 0), [data.products])
  const shown = products.filter((p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()))
  const product = products.find((p) => p.id === productId)
  const q = num(qty)
  const time = data.settings.features.time
  const arrow = locale === "ar" ? " ← " : " → "

  const preview = useMemo(() => {
    if (!product || !(q > 0)) return null
    const days = time ? possibleForDays(product, q, ui.world.calcs, data.departments, ui.world.lost) : null
    const possible = days != null ? addDaysISO(todayIso(), days) : null
    const std = standardCost(product, data.departments, data.settings, q)
    const needs = new Map<string, { itemName: string; unit: string; need: number }>()
    for (const b of product.bom || []) {
      if (b.custody) continue
      const k = itemKey(b.itemName)
      const cur = needs.get(k) || { itemName: b.itemName, unit: b.unit, need: 0 }
      cur.need += b.qtyPerUnit * q * (b.withWaste ? wasteFactor(product) : 1)
      needs.set(k, cur)
    }
    const alloc = ui.world.alloc
    const shorts = alloc
      ? Array.from(needs.entries())
          .map(([k, x]) => ({ ...x, need: roundNeed(x.unit, x.need), av: Math.max(0, alloc.free.get(k) || 0) }))
          .filter((x) => x.need > x.av + 0.05)
      : []
    return { possible, std, shorts }
  }, [product, q, time, ui.world.calcs, ui.world.lost, ui.world.alloc, data.departments, data.settings])

  const invalid = step === 0 ? (!product ? t("mfo_so_err_product") : null) : !(q > 0) ? t("mfg4_err_quantity_required") : null

  const next = () => {
    setTried(true)
    if (invalid) return
    setTried(false)
    setStep(1)
  }

  const submit = () => {
    setTried(true)
    if (!firestore || invalid || !product) return
    void run(
      () => createStockWorkOrder(firestore, { organizationId: data.orgId, product, quantity: q, neededBy: due || null, actor: data.actor }),
      (r) => {
        onOpenOrder(r.id)
        return t("mfo_so_toast", { ref: r.docNumber })
      },
      true
    )
  }

  const routeText = (p: MfgProduct) => effectiveRoute(p).map((r) => deptName(data.departments, r.departmentId, r.departmentName)).join(arrow)

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Factory}
      title={t("mfo_so_title")}
      subtitle={t("mfo_so_sub")}
      steps={[t("mfo_so_step_product"), t("mfo_so_step_qty")]}
      step={step}
      busy={busy}
      error={tried ? invalid : null}
      onBack={() => setStep(0)}
      onNext={next}
      onConfirm={submit}
      confirmLabel={t("mfo_so_confirm")}
      size="lg"
    >
      {step === 0 ? (
        <>
          {products.length > 8 && <MfgSearchField value={search} onChange={setSearch} placeholder={t("mfo_so_search")} />}
          {products.length ? (
            <MfgChoiceCards
              value={productId}
              onChange={setProductId}
              options={shown.map((p) => ({ id: p.id, icon: Gem, title: p.name, description: t("mfo_so_product_d", { count: effectiveRoute(p).length, unit: p.unit }) }))}
            />
          ) : (
            <MfgNote tone="warn">{t("mfo_so_no_products")}</MfgNote>
          )}
          <MfgNote tone="info">{t("mfo_so_define_first")}</MfgNote>
        </>
      ) : product ? (
        <>
          <MfgReview rows={[[t("mfo_so_product"), product.name]]} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumField id="so-qty" label={t("mfo_qty")} value={qty} onChange={setQty} unit={product.unit} required />
            <DateField id="so-due" label={t("mfg4_date_required")} value={due} onChange={setDue} />
          </div>
          <MfgReview
            rows={[
              [t("mfo_so_route"), routeText(product)],
              time && preview?.possible && [
                t("mfo_so_possible"),
                <span key="p" className={cn(due && preview.possible > due ? "text-destructive" : "text-success")}>
                  {d.short(preview.possible)}
                </span>,
              ],
              ui.seesMoney && preview && [t("mfo_standard_cost"), <span key="s"><Num>{fmtMoney(preview.std.total)}</Num> {t("mfg4_sar")}</span>],
            ]}
          />
          {product.requiresMeasurement && <MfgNote tone="warn">{t("mfo_so_made_to_measure")}</MfgNote>}
          {preview && preview.shorts.length > 0 && (
            <MfgNote tone="warn" title={t("mfo_so_short_title")}>
              <ul className="space-y-0.5">
                {preview.shorts.map((x) => (
                  <li key={x.itemName}>{t("mfo_needs_available", { item: x.itemName, need: fmtQty(x.need), available: fmtQty(x.av), unit: x.unit })}</li>
                ))}
              </ul>
            </MfgNote>
          )}
          <MfgNote tone="info">{t("mfo_so_to_warehouse")}</MfgNote>
          <MfgRecordedAs />
        </>
      ) : null}
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Stop or absence (FL-14, T24)
// ---------------------------------------------------------------------------

const STOP_ICON: Record<StopKind, typeof Wrench> = { machine: Wrench, power: Plug, absence: UserX, maintenance: PauseCircle }

function StopForm({ departmentId, onClose }: { departmentId?: string; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const units = (data.departments as Station[]).filter((s) => !stationGate(s))
  const allowed = data.canManage
    ? units
    : units.filter((s) => myStations(data.engineActor, data.departments, "lead").includes(s.id) || (data.canQc && myStations(data.engineActor, data.departments, "qc").includes(s.id)))
  const [stationId, setStationId] = useState(() => (departmentId && allowed.some((s) => s.id === departmentId) ? departmentId : allowed[0]?.id || ""))
  const [hours, setHours] = useState("")
  const [kind, setKind] = useState<StopKind>("machine")
  const [note, setNote] = useState("")
  const station = allowed.find((s) => s.id === stationId)
  const cap = station ? deptCapacity(station) : 0
  const lost = station ? ui.world.lost.get(station.id) || 0 : 0
  const h = num(hours)
  const todayStops = station ? data.stops.filter((s) => s.departmentId === station.id && s.date === ui.today) : []
  const affected = station ? ui.views.filter((v) => v.live && v.released && v.calc.route.some((r, i) => r.departmentId === station.id && remAt(v.calc, i) > 0)).length : 0

  const lateNow = ui.views.filter((v) => v.late).length
  const lateAfter = useMemo(() => {
    if (!station || !(h > 0) || !data.settings.features.time) return lateNow
    const lostPlus = new Map(ui.world.lost)
    lostPlus.set(station.id, (lostPlus.get(station.id) || 0) + h)
    const sched = scheduleOrders(ui.world.calcs, data.departments, lostPlus, ui.world.alloc)
    return ui.views.filter((v) => {
      if (!v.live || !v.neededBy) return false
      if (v.overdue) return true
      const s = sched.get(v.id)
      return !!s && s.finishDays != null && addDaysISO(ui.today, s.finishDays) > v.neededBy
    }).length
  }, [station, h, data.settings.features.time, lateNow, ui.world.lost, ui.world.calcs, ui.world.alloc, data.departments, ui.views, ui.today])
  const slips = Math.max(0, lateAfter - lateNow)

  const invalid = !station ? t("mfo_stop_err_station") : !(h > 0) || h + lost > cap + 1e-9 ? t("mfo_stop_err_hours", { hours: fmtQty(Math.max(0, cap - lost)) }) : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid || !station) return
    void run(
      () => recordStop(firestore, { organizationId: data.orgId, department: station, hours: h, alreadyLost: lost, kind, note: note.trim() || null, actor: data.actor }),
      () => {
        if (slips > 0) notify.emit("stop_delays", [notify.managers], { kind: `@mfo_stop_${kind}`, dept: station.name, hours: fmtQty(h), count: lateAfter }, null)
        return slips > 0 ? t("mfo_stop_toast_slips", { dept: station.name, hours: fmtQty(h), count: slips }) : t("mfo_stop_toast", { dept: station.name, hours: fmtQty(h) })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={AlertTriangle} title={t("mfo_stop_title")} subtitle={t("mfo_stop_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_stop_confirm")}>
      {!allowed.length ? (
        <MfgNote tone="bad">{t("mfo_stop_no_station")}</MfgNote>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField id="stop-station" label={t("mfo_station")} value={stationId} onChange={setStationId} options={allowed.map((s) => ({ value: s.id, label: s.name }))} required />
            <NumField
              id="stop-hours"
              label={t("mfo_stop_hours")}
              value={hours}
              onChange={setHours}
              unit={t("mfo_h")}
              hint={t("mfo_stop_hours_hint", { cap: fmtQty(cap), lost: fmtQty(lost) })}
              invalid={h > 0 && h + lost > cap + 1e-9}
              required
            />
          </div>
          {todayStops.length > 0 && (
            <MfgReview
              rows={todayStops.map((s) => [t(`mfo_stop_${s.kind}`), `${fmtQty(s.hours)} ${t("mfo_h")} · ${s.by}${s.note ? ` · ${s.note}` : ""}`] as [string, string])}
            />
          )}
          <MfgChoiceCards
            value={kind}
            onChange={setKind}
            options={STOP_KINDS.map((k) => ({ id: k, icon: STOP_ICON[k], title: t(`mfo_stop_${k}`) }))}
          />
          <TextField id="stop-note" label={t("mfo_note_optional")} value={note} onChange={setNote} placeholder={t("mfo_stop_note_ph")} />
          <MfgNote tone="warn" icon={Zap}>
            {t("mfo_stop_moves", { count: affected })}
            {slips > 0 && ` ${t("mfo_stop_slips", { count: slips })}`}
          </MfgNote>
        </>
      )}
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Block quality notice (FL-11, T25)
// ---------------------------------------------------------------------------

function BlockNoticeForm({ lot: initialLot, onClose }: { lot?: string; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const lottedNames = useMemo(() => new Set(data.products.flatMap((p) => (p.bom || []).filter((b) => !b.custody && (b.lotted || b.withWaste)).map((b) => itemKey(b.itemName)))), [data.products])
  const lots = useMemo(() => (data.stock ? data.stock.lots.filter((l) => !l.remnant && (!lottedNames.size || lottedNames.has(itemKey(l.itemName)))) : []), [data.stock, lottedNames])
  const [selected, setSelected] = useState(() => (initialLot && lots.some((l) => l.lot === initialLot) ? initialLot : ""))
  const [typed, setTyped] = useState(() => (initialLot && !lots.some((l) => l.lot === initialLot) ? initialLot : ""))
  const [defect, setDefect] = useState<DefectKind>("crack")
  const [note, setNote] = useState("")
  const [photos, setPhotos] = useState(false)
  const lot = typed.trim() || selected
  const itemName = lots.find((l) => l.lot === lot)?.itemName || null
  const onBlock = lot
    ? ui.views.filter(
        (v) =>
          v.live &&
          (v.calc.slice.slabApproval?.lot === lot || v.calc.slice.slabApproval?.alternativeLot?.lot === lot || v.calc.slice.materials.some((m) => m.lot === lot && m.state !== "received"))
      )
    : []
  const invalid = !lot ? t("mfg4_err_lot_required") : !note.trim() ? t("mfo_qn_err_note") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    void run(
      () => raiseBlockNotice(firestore, { organizationId: data.orgId, lot, itemName, defect, note: note.trim(), photosAttached: photos, orderIds: onBlock.map((v) => v.id), actor: data.actor }),
      () => {
        // Warning everywhere the block is used; Inventory quarantines, Procurement claims (T25).
        notify.emit(
          "block_notice",
          [notify.managers, { permission: "warehouses.manage" }, { permission: "rfq.manage" }],
          { lot, defect: `@mfg4_defect_${defect}`, note: note.trim(), orders: onBlock.map((v) => v.ref).join(", ") || "—" },
          null,
          mfgLinks.inventoryDesk()
        )
        return t("mfo_qn_toast", { lot })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={AlertTriangle} title={t("mfo_qn_title")} subtitle={t("mfo_qn_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_qn_confirm")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {lots.length > 0 && (
          <SelectField
            id="qn-lot"
            label={t("mfo_block")}
            value={selected}
            onChange={(v) => {
              setSelected(v)
              setTyped("")
            }}
            placeholder={t("mfo_choose")}
            options={lots.map((l) => ({ value: l.lot, label: `${l.lot} — ${l.itemName}` }))}
          />
        )}
        <TextField id="qn-typed" label={lots.length ? t("mfo_qn_or_type") : t("mfo_block")} value={typed} onChange={setTyped} required={!lots.length} />
      </div>
      <SelectField id="qn-defect" label={t("mfo_defect")} value={defect} onChange={(v) => setDefect(v as DefectKind)} options={DEFECT_KINDS.map((k) => ({ value: k, label: t(`mfg4_defect_${k}`) }))} required />
      <TextField id="qn-note" label={t("mfo_qn_found")} value={note} onChange={setNote} placeholder={t("mfo_qn_found_ph")} required multiline />
      <CheckRow checked={photos} onChange={setPhotos} title={t("mfo_qn_photos")} />
      {lot && (
        <MfgNote tone={onBlock.length ? "bad" : "info"}>
          {onBlock.length ? t("mfo_qn_on_block", { refs: onBlock.map((v) => v.ref).join(t("mfo_list_sep")) }) : t("mfo_qn_none_on_block")}
        </MfgNote>
      )}
      <MfgEffects
        items={[
          { text: t("mfo_qn_eff_warning") },
          { text: t("mfo_qn_eff_quarantine") },
          { text: t("mfo_qn_eff_claim") },
        ]}
      />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}
