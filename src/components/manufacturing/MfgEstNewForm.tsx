"use client"

// A cost estimate raised directly — a client wants a price and no request
// came first. The workshop costs the lines and the lead time; sales will set
// the price once it is sent.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Calculator, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { addDaysISO, minPriceFor, possibleForDays, round2, standardCost, type MfgProduct } from "@/lib/manufacturing-engine"
import { createCostEstimate } from "@/lib/manufacturing-writes"
import { parseQty } from "@/lib/manufacturing-requests"
import { useMfgUi } from "./MfgUiContext"
import { MfgEffects, MfgField, MfgFormModal, MfgNote, fmtMoney, useMfgDate } from "./ui/MfgUi"

export function MfgEstNewForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { data, perms, today } = useMfgUi()
  const firestore = useFirestore()
  const { toast } = useToast()
  const date = useMfgDate()
  const [contactName, setContactName] = useState("")
  const [requestedBy, setRequestedBy] = useState("")
  const [neededBy, setNeededBy] = useState("")
  const [note, setNote] = useState("")
  const [rows, setRows] = useState<Array<{ productId: string; quantity: string }>>([{ productId: "", quantity: "" }])
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timeOn = data.settings.features.time

  const rowState = rows.map((r) => {
    const product = data.productById.get(r.productId) || null
    const q = parseQty(r.quantity)
    const touched = !!r.productId || !!r.quantity.trim()
    return { product, quantity: q > 0 ? q : 0, productError: touched && !product, quantityError: touched && !(q > 0) }
  })
  const lines = rowState.filter((r): r is typeof r & { product: MfgProduct } => !!r.product && r.quantity > 0)
  const rowErrors = rowState.some((r) => r.productError || r.quantityError)

  const totals = useMemo(() => {
    const cost = round2(lines.reduce((a, l) => a + standardCost(l.product, data.departments, data.settings, l.quantity).total, 0))
    const days = timeOn && lines.length ? Math.max(...lines.map((l) => possibleForDays(l.product, l.quantity, data.scheduleInputs, data.departments))) : null
    return { cost, days }
  }, [lines, data.departments, data.settings, data.scheduleInputs, timeOn])

  const setRow = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const submit = async () => {
    if (!firestore || busy) return
    setAttempted(true)
    if (rowErrors || !lines.length) {
      setError(t("mfg3_req_err_no_lines"))
      return
    }
    setError(null)
    setBusy(true)
    try {
      await createCostEstimate(firestore, {
        organizationId: data.orgId,
        contactName: contactName.trim() || null,
        requestedBy: requestedBy.trim() || null,
        neededBy: neededBy || null,
        lines: lines.map((l) => ({ product: l.product, quantity: l.quantity })),
        note: note.trim() || null,
        departments: data.departments,
        settings: data.settings,
        actor: data.actor,
      })
      toast({ title: t("mfg2_est_created_toast") })
      onClose()
    } catch (err) {
      console.error(err)
      setError(t("mfg_save_error"))
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Calculator}
      title={t("mfg2_new_estimate")}
      subtitle={t("mfg3_est_new_sub")}
      error={error}
      busy={busy}
      onConfirm={submit}
      confirmLabel={t("mfg2_create_estimate_btn")}
      size="lg"
    >
      {!data.products.length && <MfgNote tone="warn">{t("mfg3_req_new_no_products")}</MfgNote>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MfgField label={t("mfg2_field_client")} htmlFor="mfg-est-client">
          <Input id="mfg-est-client" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </MfgField>
        <MfgField label={t("mfg2_field_requested_by")} htmlFor="mfg-est-by">
          <Input id="mfg-est-by" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
        </MfgField>
        <MfgField label={t("mfg2_field_needed_by")} htmlFor="mfg-est-needed">
          <Input id="mfg-est-needed" type="date" min={today} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </MfgField>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold text-slate-700">
          {t("mfg3_req_new_lines")}
          <span className="ms-0.5 text-warning">*</span>
        </p>
        {rows.map((row, i) => {
          const st = rowState[i]
          const show = attempted
          const std = st.product && st.quantity > 0 ? standardCost(st.product, data.departments, data.settings, st.quantity) : null
          const days = timeOn && st.product && st.quantity > 0 ? possibleForDays(st.product, st.quantity, data.scheduleInputs, data.departments) : null
          return (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border bg-white p-2.5 sm:grid-cols-[1fr_9rem_auto]">
              <div className="col-span-2 sm:col-span-1">
                <Select value={row.productId} onValueChange={(v) => setRow(i, { productId: v })}>
                  <SelectTrigger aria-label={t("mfg2_field_product")} aria-invalid={show && st.productError} className={cn(show && st.productError && "border-destructive")}>
                    <SelectValue placeholder={t("mfg2_field_product")} />
                  </SelectTrigger>
                  <SelectContent>
                    {data.products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {show && st.productError && <p className="mt-1 text-[11px] font-semibold text-destructive">{t("mfg3_req_err_product")}</p>}
                {(std || days != null) && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {std && perms.seesMoney && <>{t("mfg3_est_row_cost", { cost: fmtMoney(std.total) })}</>}
                    {std && perms.seesMoney && days != null && " · "}
                    {days != null && t("mfg3_est_row_earliest", { date: date.short(addDaysISO(today, days)) })}
                  </p>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    aria-label={t("mfg2_field_quantity")}
                    placeholder={t("mfg2_field_quantity")}
                    aria-invalid={show && st.quantityError}
                    className={cn("tabular-nums", show && st.quantityError && "border-destructive")}
                    value={row.quantity}
                    onChange={(e) => setRow(i, { quantity: e.target.value })}
                  />
                  {st.product && <span className="shrink-0 text-[11px] text-muted-foreground">{st.product.unit}</span>}
                </div>
                {show && st.quantityError && <p className="mt-1 text-[11px] font-semibold text-destructive">{t("mfg2_err_quantity_required")}</p>}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 text-muted-foreground hover:text-destructive"
                aria-label={t("mfg3_req_remove_line")}
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash2 size={15} aria-hidden="true" />
              </Button>
            </div>
          )
        })}
        {attempted && !lines.length && !rowErrors && <p className="text-[11px] font-semibold text-destructive">{t("mfg3_req_err_no_lines")}</p>}
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setRows((rs) => [...rs, { productId: "", quantity: "" }])}>
          <Plus size={13} aria-hidden="true" /> {t("mfg2_add_line")}
        </Button>
      </div>

      <MfgField label={t("mfg2_field_note_optional")} htmlFor="mfg-est-new-note">
        <Input id="mfg-est-new-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("mfg3_est_note_ph")} />
      </MfgField>

      {lines.length > 0 && perms.seesMoney && (
        <MfgNote tone="info">
          {t("mfg3_req_est_money", {
            cost: fmtMoney(totals.cost),
            floor: fmtMoney(minPriceFor(totals.cost, data.settings)),
            percent: data.settings.minMarginPercent,
          })}
        </MfgNote>
      )}
      <MfgEffects
        items={[
          { text: t("mfg3_est_new_eff_draft") },
          { text: t("mfg3_req_eff_nothing_reserved"), applies: false },
        ]}
      />
    </MfgFormModal>
  )
}
