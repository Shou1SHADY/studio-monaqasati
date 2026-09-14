"use client"

// The end of the line: production close (a decision, batch allowed, the final
// one freezes actual cost), the delivery note to project custody or the
// warehouse with a fleet driver (no entry before receipt), an incoming change
// applied — or our own call on a stock order — and the variance review.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowRightLeft, CheckCircle2, Clock, Printer, Truck, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFirestore } from "@/firebase"
import { mainMaterial, minQuantity, round2, type VarianceCause } from "@/lib/manufacturing-engine"
import { applyOrderChange, closeProduction, issueDeliveryNote, reviewVariance } from "@/lib/manufacturing-writes"
import type { OrderView } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgModuleChip, MfgRecordedAs, departmentNameOf } from "./MfgOrderBits"
import { MfgChip, MfgChoiceCards, MfgEffects, MfgFormModal, MfgNote, MfgReview, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"
import { Num, NumField, OrderSummary, SelectField, TextField, num, optNum, ownerRecipients, stationOf, useNotify, useSubmit } from "./MfgFormKit"
import { mfgLinks, type RecipientSpec } from "@/lib/mfg-events"
import { useDeliveryNotePrint, type PrintableNote } from "./MfgDeliveryNotePrint"

type Props = { view: OrderView; onClose: () => void }

// ---------------------------------------------------------------------------
// Close production (T17, ORD-13)
// ---------------------------------------------------------------------------

export function CloseForm({ view, onClose }: Props) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const c = view.calc
  const [qty, setQty] = useState(String(c.toClose))
  const q = num(qty)
  const final = q >= c.toClose - 1e-9 && c.wip === 0 && c.rejected === 0 && c.scrapPending === 0 && c.scrapReturned === 0 && c.scrapUndecided === 0
  const lastRelease = c.slice.qcReleases[c.slice.qcReleases.length - 1]
  const perUnit = view.cost.total / Math.max(1, c.finished)
  const invalid = !(q > 0) ? t("mfg4_err_quantity_required") : q > c.toClose + 1e-9 ? t("mfo_close_err_over", { qty: fmtQty(c.toClose) }) : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    void run(
      () => closeProduction(firestore, { orderId: view.id, product: view.product, departments: data.departments, settings: data.settings, notes: view.noteSlices, quantity: q, actor: data.actor }),
      (r) => [t("mfo_close_toast", { qty: fmtQty(q), unit: view.unit, ref: view.ref }), r.final ? t("mfo_close_toast_frozen") : null].filter(Boolean).join(" · ")
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={CheckCircle2} title={t("mfo_close_title")} subtitle={t("mfo_close_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_close_confirm")}>
      <OrderSummary view={view} />
      <MfgReview
        rows={[
          [t("mfo_close_out_of_qc"), <span key="o"><Num>{fmtQty(c.toClose)}</Num> {view.unit} {t("mfo_close_awaiting")}</span>],
          [t("mfo_close_before"), <span key="b"><Num>{fmtQty(c.closed)}</Num> {view.unit}</span>],
          ui.seesMoney && [
            t("mfo_cost_so_far"),
            <span key="c">
              <Num>{fmtMoney(view.cost.total)}</Num> {t("mfg4_sar")} · {t("mfo_per_unit")} <Num>{fmtMoney(perUnit)}</Num>
            </span>,
          ],
        ]}
      />
      <NumField id="cl-qty" label={t("mfo_close_qty")} value={qty} onChange={setQty} unit={view.unit} hint={t("mfo_close_qty_hint")} invalid={q > c.toClose + 1e-9} required />
      {lastRelease && (
        <MfgNote tone="ok" title={t("mfo_close_released_by_qc")}>
          {`${lastRelease.by} · ${d.short(lastRelease.at)} — `}
          {t("mfo_close_only_qc")}
        </MfgNote>
      )}
      {final ? <MfgNote tone="ok" title={t("mfo_close_final")}>{t("mfo_close_final_d")}</MfgNote> : <MfgNote tone="info" title={t("mfo_close_partial")}>{t("mfo_close_partial_d")}</MfgNote>}
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Delivery note (T18, DN-01, DN-04) — no entry before receipt
// ---------------------------------------------------------------------------

export function DeliverForm({ view, onClose }: Props) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const print = useDeliveryNotePrint()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const c = view.calc
  const toProject = view.source === "project"
  const destinations = toProject
    ? data.warehouses.filter((w) => !!w.projectId && w.projectId === view.order.projectId)
    : data.warehouses.filter((w) => !w.projectId && !w.virtual && !w.isOutbound)
  const [warehouseId, setWarehouseId] = useState(() => (destinations.find((w) => w.isCentral) || destinations[0])?.id || "")
  // Warehouses may arrive after the form opens.
  const firstDestination = (destinations.find((w) => w.isCentral) || destinations[0])?.id || ""
  useEffect(() => {
    if (!warehouseId && firstDestination) setWarehouseId(firstDestination)
  }, [warehouseId, firstDestination])
  const [qty, setQty] = useState(String(c.ready))
  const [pieces, setPieces] = useState(() => {
    const n = c.slice.drawing?.cutList?.length || 0
    return n && c.ready >= c.target - 1e-9 ? String(n) : ""
  })
  const [crates, setCrates] = useState("")
  const [vehicleId, setVehicleId] = useState(() => data.fleet[0]?.id || "")
  const [note, setNote] = useState("")
  const [issued, setIssued] = useState<PrintableNote | null>(null)

  const q = num(qty)
  const wh = destinations.find((w) => w.id === warehouseId)
  const vehicle = data.fleet.find((v) => v.id === vehicleId)
  const vehicleText = (v: (typeof data.fleet)[number]) => [t(`mfo_vehicle_${v.kind}`), v.plate].filter(Boolean).join(" ")

  const invalid = !(q > 0)
    ? t("mfg4_err_quantity_required")
    : q > c.ready + 1e-9
      ? t("mfo_dn_err_over", { qty: fmtQty(c.ready) })
      : !wh
        ? toProject
          ? t("mfo_dn_no_project_store")
          : t("mfo_dn_no_store")
        : !data.fleet.length
          ? t("mfo_dn_no_fleet")
          : !vehicle
            ? t("mfg4_err_vehicle_required")
            : null

  if (issued) {
    return (
      <MfgFormModal open onClose={onClose} icon={Truck} title={t("mfo_dn_title")} subtitle={t("mfo_dn_sub")} onConfirm={onClose} confirmLabel={t("mfo_done")}>
        <MfgNote tone="ok" title={t("mfo_dn_issued", { no: issued.noteNumber })}>
          {t("mfo_dn_issued_d", { dest: issued.destination })}
        </MfgNote>
        <Button type="button" variant="outline" className="h-11 w-full gap-2" onClick={() => print(issued)}>
          <Printer size={15} aria-hidden="true" /> {t("mfo_dn_print")}
        </Button>
      </MfgFormModal>
    )
  }

  const submit = () => {
    setTried(true)
    if (!firestore || invalid || !wh || !vehicle) return
    const label = vehicleText(vehicle)
    void run(
      () =>
        issueDeliveryNote(firestore, {
          orderId: view.id,
          organizationId: data.orgId,
          product: view.product,
          departments: data.departments,
          settings: data.settings,
          notes: view.noteSlices,
          quantity: q,
          destination: { warehouseId: wh.id, warehouseName: wh.name, kind: toProject ? "project" : "central", projectId: toProject ? view.order.projectId ?? null : null },
          pieces: optNum(pieces),
          crates: optNum(crates),
          vehicle: { id: vehicle.id, label, driverName: vehicle.driverName, plate: vehicle.plate },
          note: note.trim() || null,
          actor: data.actor,
        }),
      (r) => {
        setIssued({
          noteNumber: r.noteNumber,
          date: new Date().toISOString(),
          workOrderRef: view.ref,
          productName: view.product.name,
          quantity: q,
          unit: view.unit,
          pieces: optNum(pieces),
          crates: optNum(crates),
          destination: wh.name,
          vehicle: label,
          driver: vehicle.driverName,
          sender: data.actor.name,
          note: note.trim() || null,
          cutList: c.slice.drawing?.cutList || [],
        })
        // The destination receives it (DN-01/DN-02): the project's people for
        // custody, the storekeepers for the warehouse.
        const to: RecipientSpec[] = toProject && view.order.projectId
          ? [{ projectPermission: "projects.edit", projectId: view.order.projectId }, { permission: "warehouses.manage" }]
          : [{ permission: "warehouses.receive" }, { permission: "warehouses.manage" }]
        notify.emit(
          "note_issued",
          to,
          { number: r.noteNumber, ref: view.ref, qty: fmtQty(q), unit: view.unit, product: view.product.name, destination: wh.name, pieces: optNum(pieces) ?? "—", vehicle: label },
          view.id,
          toProject && view.order.projectId ? mfgLinks.project(view.order.projectId) : mfgLinks.deliveryNotes()
        )
        return t("mfo_dn_toast", { no: r.noteNumber })
      },
      true
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={Truck} title={t("mfo_dn_title")} subtitle={t("mfo_dn_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_dn_confirm")}>
      <OrderSummary view={view} />
      <MfgNote tone="info" title={toProject ? t("mfo_dn_to_project") : t("mfo_dn_to_warehouse")}>
        {toProject ? t("mfo_dn_to_project_d", { project: view.order.projectName || "" }) : t("mfo_dn_to_warehouse_d")}
      </MfgNote>
      {destinations.length > 1 || !toProject ? (
        <SelectField
          id="dn-wh"
          label={t("mfo_dn_destination")}
          value={warehouseId}
          onChange={setWarehouseId}
          options={destinations.map((w) => ({ value: w.id, label: w.name }))}
          placeholder={t("mfo_choose")}
          required
        />
      ) : wh ? (
        <MfgReview rows={[[t("mfo_dn_destination"), <span key="w" className="flex flex-wrap items-center gap-1.5">{wh.name} <MfgModuleChip module="projects" /></span>]]} />
      ) : null}
      {!destinations.length && <MfgNote tone="bad">{toProject ? t("mfo_dn_no_project_store") : t("mfo_dn_no_store")}</MfgNote>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NumField id="dn-qty" label={t("mfo_qty")} value={qty} onChange={setQty} unit={view.unit} hint={t("mfo_dn_ready", { qty: fmtQty(c.ready) })} invalid={q > c.ready + 1e-9} required />
        <NumField id="dn-pieces" label={t("mfo_dn_pieces")} value={pieces} onChange={setPieces} hint={t("mfo_dn_pieces_hint")} />
        <NumField id="dn-crates" label={t("mfo_dn_crates")} value={crates} onChange={setCrates} />
      </div>
      {data.fleet.length ? (
        <SelectField
          id="dn-vehicle"
          label={t("mfo_dn_vehicle")}
          value={vehicleId}
          onChange={setVehicleId}
          hint={t("mfo_dn_vehicle_hint")}
          required
          options={data.fleet.map((v) => ({ value: v.id, label: `${v.driverName} — ${vehicleText(v)}` }))}
        />
      ) : (
        <MfgNote tone="bad" title={t("mfo_dn_no_fleet")}>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {t("mfo_dn_no_fleet_d")} <MfgChip tone="muted">{t("mfg4_module_hr")}</MfgChip>
          </span>
        </MfgNote>
      )}
      <TextField id="dn-note" label={t("mfo_note_optional")} value={note} onChange={setNote} />
      <MfgEffects
        items={[
          { text: t("mfo_dn_eff_note") },
          { text: t("mfo_dn_eff_no_entry"), applies: false },
        ]}
      />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Apply an incoming change — or change / cancel a stock order (T20, ORD-11)
// ---------------------------------------------------------------------------

export function ChangeForm({ view, onClose }: Props) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const notify = useNotify()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const c = view.calc
  const incoming = c.slice.changeRequest
  const min = minQuantity(c)
  const stock = view.source === "stock"
  const [kind, setKind] = useState<"quantity" | "cancel">(incoming?.kind || "quantity")
  const [qty, setQty] = useState(String(incoming?.newQuantity ?? view.quantity))
  const [reason, setReason] = useState("")
  const [wip, setWip] = useState<"scrap" | "remnant">("scrap")
  const [remArea, setRemArea] = useState("")
  const mainItem = mainMaterial(view.product)
  const wanted = incoming ? incoming.newQuantity ?? 0 : num(qty)
  const clamp = !!incoming && incoming.kind === "quantity" && wanted < min
  const applied = incoming && incoming.kind === "quantity" ? Math.max(wanted, min) : num(qty)
  const moduleName = incoming ? t(`mfg4_module_${incoming.module}`) : ""
  const effKind = incoming ? incoming.kind : kind

  const invalid =
    !incoming && !stock
      ? t("mfg4_err_owner_changes_only")
      : !incoming && !reason.trim()
        ? t("mfg4_err_reason_required")
        : effKind === "quantity" && !(applied > 0)
          ? t("mfg4_err_quantity_required")
          : effKind === "quantity" && !incoming && applied < min
            ? t("mfo_change_err_min", { qty: fmtQty(min) })
            : effKind === "cancel" && c.delivered >= c.target
              ? t("mfg4_err_fully_delivered")
              : effKind === "cancel" && c.released && c.wip > 0 && wip === "remnant" && !(num(remArea) > 0)
                ? t("mfg4_err_remnant_area_required")
                : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    void run(
      () => applyOrderChange(firestore, { orderId: view.id, product: view.product, departments: data.departments, notes: view.noteSlices, kind: effKind, quantity: effKind === "quantity" ? applied : null, reason: reason.trim(), wip, remnantArea: wip === "remnant" ? num(remArea) : null, settings: data.settings, actor: data.actor }),
      (r) => {
        // The order's owner hears what was applied — and the sunk minimum when clamped (ORD-11).
        if (effKind === "cancel") {
          notify.emit("order_cancelled", ownerRecipients(view), { ref: view.ref, wip: c.wip > 0 ? `@mfo_change_wip_${wip}` : "—" }, view.id)
        } else if (incoming || clamp) {
          notify.emit("change_applied", ownerRecipients(view), { ref: view.ref, qty: fmtQty(r.applied ?? applied), unit: view.unit, minimum: clamp ? ` (min ${fmtQty(min)})` : "" }, view.id)
        }
        return effKind === "cancel" ? t("mfo_change_toast_cancel", { ref: view.ref }) : t("mfo_change_toast_qty", { ref: view.ref, qty: fmtQty(r.applied ?? applied), unit: view.unit })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={ArrowRightLeft} title={t("mfo_change_title")} subtitle={t("mfo_change_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_confirm")} confirmTone={effKind === "cancel" ? "destructive" : "default"}>
      <OrderSummary view={view} />
      {incoming ? (
        <MfgNote tone="info" title={incoming.kind === "cancel" ? t("mfo_change_in_cancel", { module: moduleName }) : t("mfo_change_in_qty", { module: moduleName, qty: fmtQty(incoming.newQuantity ?? 0) })}>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {incoming.reason} · {incoming.by} · {d.short(incoming.at)} <MfgModuleChip module={incoming.module} />
          </span>
        </MfgNote>
      ) : stock ? (
        <MfgChoiceCards
          value={kind}
          onChange={setKind}
          options={[
            { id: "quantity", icon: ArrowRightLeft, title: t("mfo_change_qty"), description: t("mfo_change_qty_d", { qty: fmtQty(min) }) },
            { id: "cancel", icon: X, title: t("mfo_change_cancel"), description: t("mfo_change_cancel_d") },
          ]}
        />
      ) : (
        <MfgNote tone="bad">{t("mfo_more_locked", { module: t(view.source === "client" ? "mfg4_module_sales" : "mfg4_module_procurement") })}</MfgNote>
      )}
      {effKind === "quantity" &&
        (incoming ? (
          <MfgReview
            rows={[
              [
                t("mfo_change_applied"),
                <span key="a">
                  <Num>{fmtQty(applied)}</Num> {view.unit}
                  {clamp && <span className="text-destructive"> — {t("mfo_change_clamped", { min: fmtQty(min), module: moduleName })}</span>}
                </span>,
              ],
            ]}
          />
        ) : (
          stock && <NumField id="ch-qty" label={t("mfo_change_new_qty")} value={qty} onChange={setQty} unit={view.unit} hint={t("mfo_change_new_qty_hint")} invalid={num(qty) > 0 && num(qty) < min} required />
        ))}
      {effKind === "cancel" && c.released && c.wip > 0 && (
        <SelectField
          id="ch-wip"
          label={t("mfo_change_wip", { qty: fmtQty(c.wip), unit: view.unit })}
          value={wip}
          onChange={(v) => setWip(v as "scrap" | "remnant")}
          options={[
            { value: "scrap", label: t("mfo_change_wip_scrap") },
            ...(mainItem ? [{ value: "remnant", label: t("mfo_change_wip_remnant") }] : []),
          ]}
        />
      )}
      {effKind === "cancel" && c.released && c.wip > 0 && wip === "remnant" && mainItem && (
        <NumField id="ch-rem" label={t("mfo_change_remnant_area", { unit: mainItem.unit })} value={remArea} onChange={setRemArea} unit={mainItem.unit} required />
      )}
      {!incoming && stock && <TextField id="ch-reason" label={t("mfo_reason")} value={reason} onChange={setReason} required />}
      {effKind === "cancel" && <MfgEffects items={[{ text: t("mfo_change_eff_reservations") }, { text: t("mfo_change_eff_requests") }]} />}
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Variance review (FL-05)
// ---------------------------------------------------------------------------

export function VarianceForm({ view, departmentId, onClose }: Props & { departmentId: string }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const notify = useNotify()
  const { data } = ui
  const { busy, run } = useSubmit(onClose)
  const c = view.calc
  const i = c.route.findIndex((r) => r.departmentId === departmentId)
  const step = c.route[i]
  const dept = i >= 0 ? departmentNameOf(data.departments, view, i) : ""
  const actual = c.slice.progress[i]?.hours || 0
  const std = round2((c.done[i] || 0) * (step?.hoursPerUnit || 0))
  const rate = Number(stationOf(ui, departmentId)?.hourlyRate) || 0
  const value = Math.round((actual - std) * (rate + data.settings.overheadRatePerHour))
  const [cause, setCause] = useState<VarianceCause>("genuine")
  const [note, setNote] = useState("")

  const submit = () => {
    if (!firestore || i < 0) return
    void run(
      () => reviewVariance(firestore, { orderId: view.id, departmentId, cause, note: note.trim() || null, actor: data.actor }),
      () => {
        if (cause !== "genuine") notify.emit("variance_reviewed", [notify.managers], { ref: view.ref, dept, cause: `@mfo_var_${cause}` }, view.id)
        return t("mfo_var_toast")
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={Clock} title={t("mfo_var_title")} subtitle={t("mfo_var_sub")} busy={busy} onConfirm={submit} confirmLabel={t("mfo_confirm")}>
      <OrderSummary view={view} />
      <MfgReview
        rows={[
          [
            dept,
            <span key="v">
              {t("mfo_var_facts", { actual: fmtQty(actual), std: fmtQty(std) })}
              {ui.seesMoney && (
                <>
                  {" — "}
                  <Num>{fmtMoney(value)}</Num> {t("mfg4_sar")}
                </>
              )}
            </span>,
          ],
        ]}
      />
      <MfgChoiceCards
        value={cause}
        onChange={setCause}
        options={[
          { id: "genuine", icon: Clock, title: t("mfo_var_genuine"), description: t("mfo_var_genuine_d") },
          { id: "unrecorded_rework", icon: Undo2, title: t("mfo_var_unrecorded_rework"), description: t("mfo_var_unrecorded_rework_d") },
          { id: "standard_wrong", icon: ArrowRightLeft, title: t("mfo_var_standard_wrong"), description: t("mfo_var_standard_wrong_d") },
          { id: "entry_error", icon: X, title: t("mfo_var_entry_error"), description: t("mfo_var_entry_error_d") },
        ]}
      />
      <TextField id="var-note" label={t("mfo_note_optional")} value={note} onChange={setNote} />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}
