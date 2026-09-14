"use client"

// Materials the way the boundary runs (MAT-01..07): a station requests its
// slab by block, Inventory issues it (there), the station confirms receipt
// (here, and the cost lands), what the store cannot cover becomes a purchase
// request, and output beyond the received material needs a logged override.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Boxes, PackageCheck, ShoppingCart } from "lucide-react"
import { useFirestore } from "@/firebase"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  addDaysISO,
  canDo,
  itemKey,
  materialNeed,
  materialOpen,
  materialReceived,
  needRemain,
  r1,
  requestedItems,
  type Allocation,
} from "@/lib/manufacturing-engine"
import { confirmMaterialReceipt, overrideMaterials, requestPurchase, requestStationMaterials } from "@/lib/manufacturing-writes"
import type { OrderView } from "@/lib/manufacturing-view"
import { useMfgUi } from "./MfgUiContext"
import { MfgModuleChip, MfgRecordedAs, departmentNameOf } from "./MfgOrderBits"
import { MfgEffects, MfgField, MfgFormModal, MfgNote, MfgReview, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"
import { DateField, Num, NumField, OrderSummary, TextField, num, todayIso, useNotify, useSubmit } from "./MfgFormKit"
import { mfgLinks } from "@/lib/mfg-events"

type Props = { view: OrderView; onClose: () => void }

/** Free stock plus what is already reserved for this order. */
export function availableTo(alloc: Allocation | null, orderId: string, itemName: string): number {
  if (!alloc) return 0
  const k = itemKey(itemName)
  return r1(Math.max(0, alloc.free.get(k) || 0) + (alloc.reserved.get(orderId)?.get(k) || 0))
}

/** Need-by for a purchase: a few days before the order is due, never in the past. */
export function purchaseNeedBy(view: OrderView): string {
  if (!view.neededBy) return ""
  const d = addDaysISO(view.neededBy, -4)
  const today = todayIso()
  return d < today ? today : d
}

// ---------------------------------------------------------------------------
// Request the station's materials (T10)
// ---------------------------------------------------------------------------

interface ReqLine {
  itemName: string
  unit: string
  lotted: boolean
  qty: string
  lot: string
}

export function RequestMaterialsForm({ view, departmentId, onClose }: Props & { departmentId: string }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const ui = useMfgUi()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const notify = useNotify()
  const c = view.calc
  const index = c.route.findIndex((r) => r.departmentId === departmentId)
  const dept = index >= 0 ? departmentNameOf(data.departments, view, index) : ""
  const need = useMemo(() => (index >= 0 ? materialNeed(c, index) : []), [c, index])
  const approved = c.slice.slabApproval?.lot || null
  const alt = c.slice.slabApproval?.alternativeLot?.lot || null
  const stock = data.stock
  const alloc = ui.world.alloc
  const lotsOf = (item: string) => (stock ? stock.lots.filter((l) => itemKey(l.itemName) === itemKey(item)) : [])

  const [lines, setLines] = useState<ReqLine[]>(() =>
    need.map((n) => ({
      itemName: n.itemName,
      unit: n.unit,
      lotted: n.lotted,
      qty: String(Math.max(0, r1(n.qty - materialReceived(c.slice, departmentId, n.itemName) - materialOpen(c.slice, departmentId, n.itemName)))),
      lot: n.lotted ? approved || "" : "",
    }))
  )
  const [consent, setConsent] = useState("")

  // Blocks arrive with the stock read: default an unset block to the first one.
  useEffect(() => {
    if (!stock) return
    setLines((ls) => ls.map((l) => (l.lotted && !l.lot ? { ...l, lot: stock.lots.find((x) => itemKey(x.itemName) === itemKey(l.itemName))?.lot || "" } : l)))
  }, [stock])

  const setLine = (i: number, patch: Partial<ReqLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const rows = lines.map((l) => ({ ...l, q: num(l.qty), av: availableTo(alloc, view.id, l.itemName) }))
  const mixed = rows.some((l) => l.q > 0 && l.lot && approved && l.lot !== approved && l.lot !== alt)
  const beyond = !!alloc && rows.some((l) => l.q > l.av + 0.05)
  const requestable = rows.some((l) => (alloc ? Math.min(l.q, l.av) : l.q) > 0.05)
  const invalid = !rows.some((l) => l.q > 0)
    ? t("mfg4_err_quantity_required")
    : !requestable
      ? t("mfo_matreq_none_available")
      : mixed && !consent.trim()
        ? t("mfg4_err_consent_required")
        : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    // Only what the store can cover is requested. The shortfall is the
    // workshop manager's purchase request (MAT-05) — it shows on their Today.
    const req = rows.map((l) => ({ itemName: l.itemName, unit: l.unit, quantity: alloc ? r1(Math.min(l.q, l.av)) : l.q, lot: l.lot || null })).filter((l) => l.quantity > 0)
    void run(
      () => requestStationMaterials(firestore, { orderId: view.id, organizationId: data.orgId, departmentId, lines: req, consentNote: mixed ? consent.trim() : null, actor: data.actor }),
      (number) => {
        // mfg.withdrawal.requested → the storekeepers (T10).
        notify.emit(
          "withdrawal_requested",
          [{ permission: "warehouses.manage" }],
          { number, ref: view.ref, dept, lines: req.map((l) => `${l.itemName} ${fmtQty(l.quantity)} ${l.unit}${l.lot ? ` (${l.lot})` : ""}`).join(locale === "ar" ? "، " : ", ") },
          view.id,
          mfgLinks.inventoryDesk()
        )
        return beyond ? t("mfo_matreq_toast_short", { ref: number }) : t("mfo_matreq_toast", { ref: number })
      }
    )
  }

  const lotLabel = (lot: { lot: string; quantity: number; remnant?: boolean }, unit: string) => {
    const tags = [
      approved && lot.lot === approved ? t("mfo_lot_approved") : null,
      alt && lot.lot === alt ? t("mfo_lot_alternative") : null,
      lot.remnant ? t("mfo_lot_remnant") : null,
      approved && lot.lot !== approved && lot.lot !== alt ? t("mfo_lot_needs_consent") : null,
      data.notices.some((n) => !n.closedAt && n.lot === lot.lot) ? t("mfo_lot_notice") : null,
    ].filter(Boolean)
    return `${lot.lot} — ${fmtQty(lot.quantity)} ${unit}${tags.length ? ` · ${tags.join(" · ")}` : ""}`
  }

  return (
    <MfgFormModal open onClose={onClose} icon={Boxes} title={t("mfo_matreq_title")} subtitle={t("mfo_matreq_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_matreq_confirm")}>
      <OrderSummary view={view} />
      {!need.length ? (
        <MfgNote tone="info">{t("mfo_matreq_nothing")}</MfgNote>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-[11px] font-bold text-muted-foreground">
            <span className="flex-1">{t("mfo_matreq_item", { dept })}</span>
            <span className="w-24 sm:w-28">{t("mfo_qty")}</span>
            <span className="hidden w-24 sm:block">{t("mfo_available_to_you")}</span>
          </div>
          {rows.map((l, i) => {
            const lots = l.lotted ? lotsOf(l.itemName) : []
            const bad = !!alloc && l.q > l.av + 0.05
            return (
              <div key={l.itemName} className="border-b border-border/60 px-3 py-2.5 last:border-b-0">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <b className="block text-xs">{l.itemName}</b>
                    <span className="block text-[10px] text-muted-foreground">
                      {l.unit}
                      {(alloc?.reserved.get(view.id)?.get(itemKey(l.itemName)) || 0) > 0 && ` · ${t("mfo_reserved_for_you", { qty: fmtQty(alloc?.reserved.get(view.id)?.get(itemKey(l.itemName))) })}`}
                    </span>
                  </div>
                  <div className="w-24 sm:w-28">
                    <Input
                      aria-label={t("mfo_qty_of", { item: l.itemName })}
                      inputMode="decimal"
                      dir="ltr"
                      value={l.qty}
                      onChange={(e) => setLine(i, { qty: sanitizeDecimalInput(e.target.value) })}
                      className={cn("h-11 tabular-nums sm:h-9", bad && "border-destructive ring-1 ring-destructive")}
                    />
                  </div>
                  <div className="hidden w-24 pt-2 text-xs sm:block">
                    {alloc ? bad ? <span className="font-bold text-destructive">{t("mfo_only", { qty: fmtQty(l.av) })}</span> : <b className="tabular-nums">{fmtQty(l.av)}</b> : "—"}
                  </div>
                </div>
                <p className="mt-1 text-[10px] sm:hidden">
                  {t("mfo_available_to_you")}: {alloc ? <b className={cn("tabular-nums", bad && "text-destructive")}>{fmtQty(l.av)}</b> : "—"}
                </p>
                {lots.length > 0 && (
                  <div className="mt-1.5">
                    <Select value={l.lot} onValueChange={(v) => setLine(i, { lot: v })} dir={locale === "ar" ? "rtl" : "ltr"}>
                      <SelectTrigger aria-label={t("mfo_block")} className="h-10 text-xs sm:h-9">
                        <SelectValue placeholder={t("mfo_block")} />
                      </SelectTrigger>
                      <SelectContent>
                        {lots.map((x) => (
                          <SelectItem key={x.lot} value={x.lot}>
                            {lotLabel(x, l.unit)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {mixed && (
        <>
          <MfgNote tone="bad" title={t("mfo_matreq_other_block", { lot: approved || "" })}>
            {t("mfo_matreq_other_block_fix")}
          </MfgNote>
          <TextField id="mr-consent" label={t("mfo_consent_note")} value={consent} onChange={setConsent} hint={t("mfo_consent_note_hint")} required multiline />
        </>
      )}
      {beyond && (
        <MfgNote tone="warn" icon={ShoppingCart}>
          {t("mfo_matreq_beyond")}
        </MfgNote>
      )}
      {!alloc && <MfgNote tone="info">{t("mfo_stock_loading")}</MfgNote>}
      <MfgEffects
        items={[
          { text: t("mfo_matreq_eff_store") },
          { text: t("mfo_matreq_eff_cost") },
          { text: t("mfo_matreq_eff_not_issue"), applies: false },
        ]}
      />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Confirm material receipt (T12) — cost lands here
// ---------------------------------------------------------------------------

export function ConfirmReceiptForm({ view, departmentId, requestNumber, onClose }: Props & { departmentId: string; requestNumber: string }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const d = useMfgDate()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const [note, setNote] = useState("")
  const c = view.calc
  const index = c.route.findIndex((r) => r.departmentId === departmentId)
  const dept = index >= 0 ? departmentNameOf(data.departments, view, index) : ""
  const rows = c.slice.materials.filter((m) => m.requestNumber === requestNumber && m.state === "released")
  const invalid = !rows.length ? t("mfo_recv_nothing") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    void run(
      () => confirmMaterialReceipt(firestore, { orderId: view.id, requestNumber, note: note.trim() || null, actor: data.actor, organizationId: data.orgId }),
      () => t("mfo_recv_toast", { dept, ref: view.ref })
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={PackageCheck} title={t("mfo_recv_title")} subtitle={t("mfo_recv_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_recv_confirm")}>
      <OrderSummary view={view} />
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-[11px] font-bold text-muted-foreground">
          <span className="flex-1">
            {t("mfo_recv_issued", { dept })} · <Num>{requestNumber}</Num>
          </span>
          <MfgModuleChip module="inventory" prefix="from" />
        </div>
        {rows.length ? (
          rows.map((m) => (
            <div key={m.id} className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 text-xs last:border-b-0">
              <div className="min-w-0 flex-1">
                <b className="block">{m.itemName}</b>
                <span className="block text-[10px] text-muted-foreground">
                  {[m.lot ? t("mfo_lot_is", { lot: m.lot }) : null, m.releasedByName ? t("mfo_issued_by", { name: m.releasedByName }) : null, m.releasedAt ? d.short(m.releasedAt) : null].filter(Boolean).join(" · ")}
                </span>
              </div>
              <span className="font-bold">
                <Num>{fmtQty(m.quantity)}</Num> {m.unit}
              </span>
              {ui.seesMoney && (
                <span className="w-24 text-end text-[11px] text-muted-foreground">
                  {m.unitCost != null ? (
                    <>
                      <Num>{fmtMoney(m.quantity * m.unitCost)}</Num> {t("mfg4_sar")}
                    </>
                  ) : (
                    t("mfo_unpriced")
                  )}
                </span>
              )}
            </div>
          ))
        ) : (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t("mfo_recv_nothing")}</p>
        )}
      </div>
      <TextField id="recv-note" label={t("mfo_note_optional")} value={note} onChange={setNote} placeholder={t("mfo_recv_note_ph")} />
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Purchase request for the shortfall (T22, MAT-05)
// ---------------------------------------------------------------------------

export function PurchaseForm({ view, itemName, onClose }: Props & { itemName: string }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const notify = useNotify()
  const c = view.calc
  const alloc = ui.world.alloc
  const k = itemKey(itemName)
  const item = requestedItems(view.product).find((x) => itemKey(x.itemName) === k)
  const shortLine = view.shortages.find((x) => itemKey(x.itemName) === k)
  const unit = item?.unit || shortLine?.unit || ""
  const need = needRemain(c, itemName)
  const reserved = alloc?.reserved.get(view.id)?.get(k) || 0
  const available = Math.max(0, alloc?.free.get(k) || 0)
  const [qty, setQty] = useState(() => String(shortLine?.short ?? Math.max(0, r1(need - reserved - available))))
  const [needBy, setNeedBy] = useState(purchaseNeedBy(view))
  const [note, setNote] = useState("")
  const q = num(qty)
  const invalid = !(q > 0) ? t("mfg4_err_quantity_required") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid) return
    void run(
      () => requestPurchase(firestore, { orderId: view.id, itemName, unit, quantity: q, needBy: needBy || null, note: note.trim() || null, actor: data.actor }),
      () => {
        // mfg.purchase.requested → Procurement (MAT-05).
        notify.emit("purchase_requested", [{ permission: "rfq.manage" }], { ref: view.ref, qty: fmtQty(q), unit, item: itemName, needBy: needBy || "—" }, view.id, mfgLinks.procurement())
        return t("mfo_prq_toast", { qty: fmtQty(q), unit, item: itemName })
      }
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={ShoppingCart} title={t("mfo_prq_title")} subtitle={t("mfo_prq_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_prq_confirm")}>
      <OrderSummary view={view} />
      <MfgReview
        rows={[
          [
            itemName,
            <span key="i" className="flex flex-wrap items-center gap-1.5">
              <span>{t("mfo_prq_facts", { need: fmtQty(need), reserved: fmtQty(reserved), available: fmtQty(available), unit })}</span>
              <MfgModuleChip module="inventory" prefix="from" />
            </span>,
          ],
          shortLine?.requested && [t("mfo_prq_already"), t("mfo_prq_already_value", { qty: fmtQty(shortLine.requested.quantity), unit })],
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumField id="prq-qty" label={t("mfo_prq_qty")} value={qty} onChange={setQty} unit={unit} required />
        <DateField id="prq-need" label={t("mfo_prq_need_by")} value={needBy} onChange={setNeedBy} hint={t("mfo_prq_need_by_hint")} />
      </div>
      {item?.lotted && <MfgNote tone="warn">{t("mfo_prq_same_block")}</MfgNote>}
      <TextField id="prq-note" label={t("mfo_prq_note")} value={note} onChange={setNote} />
      <MfgNote tone="info">{t("mfo_prq_honest_date")}</MfgNote>
      <MfgRecordedAs />
    </MfgFormModal>
  )
}

// ---------------------------------------------------------------------------
// Materials override (MAT-03) — a logged exception
// ---------------------------------------------------------------------------

export function OverrideForm({ view, index, onClose }: Props & { index: number }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const ui = useMfgUi()
  const { data } = ui
  const { busy, tried, setTried, run } = useSubmit(onClose)
  const [reason, setReason] = useState("")
  const c = view.calc
  const step = c.route[index]
  const dept = departmentNameOf(data.departments, view, index)
  const inHand = c.pend[index] || 0
  const cov = canDo(c, index)
  const invalid = !step ? t("mfg4_err_generic") : !reason.trim() ? t("mfg4_err_reason_required") : null

  const submit = () => {
    setTried(true)
    if (!firestore || invalid || !step) return
    void run(
      () => overrideMaterials(firestore, { orderId: view.id, departmentId: step.departmentId, reason: reason.trim(), actor: data.actor }),
      () => t("mfo_ovr_toast", { dept })
    )
  }

  return (
    <MfgFormModal open onClose={onClose} icon={AlertTriangle} title={t("mfo_ovr_title")} subtitle={t("mfo_ovr_sub")} busy={busy} error={tried ? invalid : null} onConfirm={submit} confirmLabel={t("mfo_ovr_confirm")} confirmTone="destructive">
      <OrderSummary view={view} />
      <MfgNote tone="warn">{t("mfo_ovr_covers", { dept, qty: fmtQty(Math.min(cov === Infinity ? inHand : cov, inHand)), inHand: fmtQty(inHand), unit: view.unit })}</MfgNote>
      <MfgField label={t("mfo_reason")} required htmlFor="ovr-reason">
        <Input id="ovr-reason" dir="auto" value={reason} placeholder={t("mfo_ovr_reason_ph")} onChange={(e) => setReason(e.target.value)} className="h-11 sm:h-10" />
      </MfgField>
      <MfgRecordedAs />
    </MfgFormModal>
  )
}
