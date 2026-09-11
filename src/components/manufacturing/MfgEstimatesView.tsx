"use client"

// Cost estimates — the workshop issues COST and LEAD TIME; sales set the
// price (with Finance's floor under it), and the award comes back here to
// become work orders with one click.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Calculator, Loader2, Plus, Send, FileText, Trophy, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { MfgData } from "@/hooks/useMfgData"
import {
  estimateCost,
  marginPercent,
  minPriceFor,
  possibleForDays,
  type MfgCostEstimate,
} from "@/lib/manufacturing-engine"
import {
  createCostEstimate,
  logEstimateQuote,
  markEstimateLost,
  markEstimateWon,
  sendCostEstimate,
} from "@/lib/manufacturing-writes"

const fmtMoney = (n: number) => Number(Math.round(n) || 0).toLocaleString("en-US")
const fmtQty = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })

const STATE_BADGES: Record<MfgCostEstimate["state"], string> = {
  draft: "bg-amber-100 text-amber-700",
  sent: "bg-cta/10 text-cta",
  quoted: "bg-violet-100 text-violet-700",
  won: "bg-success/10 text-success",
  lost: "bg-muted text-muted-foreground",
}

export function MfgEstimatesView({ data }: { data: MfgData }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const [showCreate, setShowCreate] = useState(false)
  const [action, setAction] = useState<{ kind: "send" | "quote" | "won"; estimate: MfgCostEstimate } | null>(null)
  const canAct = data.canManage || data.canCost

  if (!data.settings.features.estimates) {
    return <p className="text-sm text-muted-foreground border border-dashed rounded-xl p-8 text-center">{t("mfg2_estimates_off")}</p>
  }

  return (
    <div className="space-y-4" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">{t("mfg2_estimates_hint")}</p>
        {canAct && (
          <Button size="sm" className="ms-auto gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> {t("mfg2_new_estimate")}
          </Button>
        )}
      </div>

      {data.estimates.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed rounded-xl p-8 text-center">{t("mfg2_estimates_empty")}</p>
      ) : (
        data.estimates.map((e) => {
          const cost = estimateCost(e)
          const floor = minPriceFor(cost, data.settings)
          const margin = e.quotedPrice ? marginPercent(e.quotedPrice, cost) : null
          return (
            <section key={e.id} className="rounded-xl border bg-white overflow-hidden">
              <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b bg-muted/20">
                <Calculator size={15} className="text-cta shrink-0" />
                <b className="text-sm">{e.estimateNumber}</b>
                <span className="text-xs text-muted-foreground truncate">
                  {e.contactName || e.requestedBy || ""}
                  {e.neededBy && <> · {t("mfg2_needed_by")}: {e.neededBy}</>}
                  {e.quoteNumber && <> · {e.quoteNumber}</>}
                </span>
                <span className="ms-auto flex items-center gap-2">
                  <Badge className={cn("border-none", STATE_BADGES[e.state])}>{t(`mfg2_est_state_${e.state}`)}</Badge>
                  {canAct && e.state === "draft" && (
                    <Button size="sm" className="h-7 text-[11px] gap-1" onClick={() => setAction({ kind: "send", estimate: e })}>
                      <Send size={11} /> {t("mfg2_est_send")}
                    </Button>
                  )}
                  {canAct && e.state === "sent" && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => setAction({ kind: "quote", estimate: e })}>
                      <FileText size={11} /> {t("mfg2_est_log_quote")}
                    </Button>
                  )}
                  {canAct && e.state === "quoted" && (
                    <>
                      <Button size="sm" className="h-7 text-[11px] gap-1" onClick={() => setAction({ kind: "won", estimate: e })}>
                        <Trophy size={11} /> {t("mfg2_est_won")}
                      </Button>
                      <LostButton estimate={e} />
                    </>
                  )}
                </span>
              </header>
              <div className="divide-y">
                {e.lines.map((l, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                    <span className="font-semibold">{l.productName}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtQty(l.quantity)} {l.unit}</span>
                    {data.seesMoney && (
                      <span className="ms-auto tabular-nums text-muted-foreground">
                        {t("mfg2_cost_materials")} {fmtMoney(l.materialCost)} · {t("mfg2_cost_labour_oh")} {fmtMoney(l.labourCost + l.overheadCost)} ·{" "}
                        <b className="text-foreground">{fmtMoney(l.totalCost)} ﷼</b>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {data.seesMoney && (
                <footer className="px-4 py-2.5 border-t bg-muted/10 flex flex-wrap items-center gap-4 text-xs">
                  <span>
                    {t("mfg2_est_make_cost")}: <b className="tabular-nums">{fmtMoney(cost)} ﷼</b>
                  </span>
                  <span>
                    {t("mfg2_est_floor", { percent: data.settings.minMarginPercent })}: <b className="tabular-nums">{fmtMoney(floor)} ﷼</b>
                  </span>
                  {e.quotedPrice != null && (
                    <span>
                      {t("mfg2_est_quoted_price")}: <b className={cn("tabular-nums", e.quotedPrice < floor ? "text-destructive" : "text-success")}>{fmtMoney(e.quotedPrice)} ﷼</b>
                      {margin != null && <> ({t("mfg2_margin")} {margin}%)</>}
                      {e.financeApprovalBy && <span className="text-amber-600"> · {t("mfg2_est_finance_approved", { name: e.financeApprovalBy })}</span>}
                    </span>
                  )}
                  <span className="ms-auto text-muted-foreground">
                    {t("mfg2_est_validity", { days: e.validityDays })} · {t("mfg2_est_price_note")}
                  </span>
                </footer>
              )}
            </section>
          )
        })
      )}

      {showCreate && <NewEstimateDialog data={data} onClose={() => setShowCreate(false)} />}
      {action && <EstimateActionDialog data={data} action={action} onClose={() => setAction(null)} />}
    </div>
  )
}

function LostButton({ estimate }: { estimate: MfgCostEstimate }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-[11px] gap-1 text-muted-foreground"
      onClick={async () => {
        if (!firestore) return
        await markEstimateLost(firestore, estimate.id)
        toast({ title: t("mfg2_est_lost_toast") })
      }}
    >
      <XCircle size={11} /> {t("mfg2_est_lost")}
    </Button>
  )
}

function EstimateActionDialog({
  data,
  action,
  onClose,
}: {
  data: MfgData
  action: { kind: "send" | "quote" | "won"; estimate: MfgCostEstimate }
  onClose: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const e = action.estimate
  const cost = estimateCost(e)
  const floor = minPriceFor(cost, data.settings)
  const [validity, setValidity] = useState(String(e.validityDays || 15))
  const [note, setNote] = useState(e.note || "")
  const [quoteNumber, setQuoteNumber] = useState("")
  const [price, setPrice] = useState("")
  const [quotedBy, setQuotedBy] = useState("")
  const [financeBy, setFinanceBy] = useState("")
  const [confirmedBy, setConfirmedBy] = useState("")
  const below = Number(price) > 0 && Number(price) < floor

  const submit = async () => {
    if (!firestore || busy) return
    setBusy(true)
    try {
      if (action.kind === "send") {
        await sendCostEstimate(firestore, { estimateId: e.id, validityDays: Number(validity) || 15, note: note || null, actor: data.actor })
        toast({ title: t("mfg2_est_sent_toast") })
      } else if (action.kind === "quote") {
        await logEstimateQuote(firestore, {
          estimate: e,
          quoteNumber,
          quotedPrice: Number(price) || 0,
          quotedByName: quotedBy || data.actor.name,
          financeApprovalBy: financeBy || null,
          settings: data.settings,
        })
        toast({ title: t("mfg2_est_quote_logged_toast") })
      } else {
        await markEstimateWon(firestore, { estimate: e, confirmedBy, products: data.products, actor: data.actor })
        toast({ title: t("mfg2_est_won_toast") })
      }
      onClose()
    } catch (err) {
      console.error(err)
      const key =
        (err as Error).message === "below_floor"
          ? "mfg2_err_below_floor"
          : (err as Error).message === "by_required"
            ? "mfg2_err_name_required"
            : "mfg_save_error"
      toast({ title: t(key), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="text-base">
            {action.kind === "send" ? t("mfg2_est_send") : action.kind === "quote" ? t("mfg2_est_log_quote") : t("mfg2_est_won_title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {data.seesMoney && (
            <p className="text-xs text-muted-foreground">
              {t("mfg2_est_make_cost")}: <b className="tabular-nums">{fmtMoney(cost)} ﷼</b> · {t("mfg2_est_floor", { percent: data.settings.minMarginPercent })}:{" "}
              <b className="tabular-nums">{fmtMoney(floor)} ﷼</b>
            </p>
          )}
          {action.kind === "send" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs font-bold">{t("mfg2_est_validity_field")}</Label>
                <Input type="number" min="1" value={validity} onChange={(ev) => setValidity(ev.target.value)} />
                <p className="text-[11px] text-muted-foreground">{t("mfg2_est_validity_hint")}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">{t("mfg2_est_note_to_sales")}</Label>
                <Input value={note} onChange={(ev) => setNote(ev.target.value)} />
              </div>
              <p className="text-[11px] text-muted-foreground">{t("mfg2_est_no_price_note")}</p>
            </>
          )}
          {action.kind === "quote" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs font-bold">{t("mfg2_est_quote_number")}</Label>
                  <Input value={quoteNumber} onChange={(ev) => setQuoteNumber(ev.target.value)} placeholder="Q-XXXXXX" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold">{t("mfg2_est_quoted_price")}</Label>
                  <Input type="number" min="0" value={price} onChange={(ev) => setPrice(ev.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">{t("mfg2_est_quoted_by")}</Label>
                <Input value={quotedBy} onChange={(ev) => setQuotedBy(ev.target.value)} />
              </div>
              {below && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-destructive">{t("mfg2_est_below_floor_warn", { floor: fmtMoney(floor) })}</p>
                  <Label className="text-xs font-bold">{t("mfg2_est_finance_approval")}</Label>
                  <Input value={financeBy} onChange={(ev) => setFinanceBy(ev.target.value)} />
                </div>
              )}
            </>
          )}
          {action.kind === "won" && (
            <>
              <p className="text-xs text-muted-foreground">{t("mfg2_est_won_hint", { count: e.lines.length })}</p>
              <div className="space-y-1">
                <Label className="text-xs font-bold">{t("mfg2_est_confirmed_by")}</Label>
                <Input value={confirmedBy} onChange={(ev) => setConfirmedBy(ev.target.value)} />
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{t("crm_cancel")}</Button>
            <Button size="sm" disabled={busy} onClick={submit} className="gap-1.5">
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t("mfg2_confirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NewEstimateDialog({ data, onClose }: { data: MfgData; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [contactName, setContactName] = useState("")
  const [requestedBy, setRequestedBy] = useState("")
  const [neededBy, setNeededBy] = useState("")
  const [note, setNote] = useState("")
  const [rows, setRows] = useState<Array<{ productId: string; quantity: string }>>([{ productId: "", quantity: "" }])

  const submit = async () => {
    if (!firestore || busy) return
    const lines = rows
      .map((r) => ({ product: data.productById.get(r.productId), quantity: Number(r.quantity) || 0 }))
      .filter((l): l is { product: NonNullable<typeof l.product>; quantity: number } => !!l.product && l.quantity > 0)
    if (!lines.length) {
      toast({ title: t("mfg2_err_quantity_required"), variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      await createCostEstimate(firestore, {
        organizationId: data.orgId,
        contactName: contactName || null,
        requestedBy: requestedBy || null,
        neededBy: neededBy || null,
        lines,
        note: note || null,
        departments: data.departments,
        settings: data.settings,
        actor: data.actor,
      })
      toast({ title: t("mfg2_est_created_toast") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="text-base">{t("mfg2_new_estimate")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold">{t("mfg2_field_client")}</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold">{t("mfg2_field_requested_by")}</Label>
              <Input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-bold">{t("mfg2_field_needed_by")}</Label>
            <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </div>
          {rows.map((row, i) => {
            const product = data.productById.get(row.productId)
            const qty = Number(row.quantity) || 0
            return (
              <div key={i} className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Select value={row.productId} onValueChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, productId: v } : x)))}>
                    <SelectTrigger><SelectValue placeholder={t("mfg2_field_product")} /></SelectTrigger>
                    <SelectContent>
                      {data.products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {product && qty > 0 && data.settings.features.time && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {t("mfg2_est_earliest", { days: possibleForDays(product, qty, data.scheduleInputs, data.departments) })}
                    </p>
                  )}
                </div>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder={t("mfg2_field_quantity")}
                  value={row.quantity}
                  onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                />
              </div>
            )
          })}
          <Button size="sm" variant="outline" className="gap-1 h-7 text-[11px]" onClick={() => setRows((rs) => [...rs, { productId: "", quantity: "" }])}>
            <Plus size={11} /> {t("mfg2_add_line")}
          </Button>
          <div className="space-y-1">
            <Label className="text-xs font-bold">{t("mfg2_field_note_optional")}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{t("crm_cancel")}</Button>
            <Button size="sm" disabled={busy} onClick={submit} className="gap-1.5">
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t("mfg2_create_estimate_btn")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
