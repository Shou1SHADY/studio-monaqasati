"use client"

// «سجّل عرضاً وصل خارج المنصة» (R-09): an offer that came by e-mail or
// WhatsApp, keyed in by the buyer so it enters the comparison — in his name,
// flagged «أدخله …» on its column, «بلا مرفق» when no proof was attached. A
// line the supplier did not price stays empty; nothing is invented.

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc, getDoc } from "firebase/firestore"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { useFirestore, useStorage } from "@/firebase"
import { pricedProducts, toAmount } from "@/lib/procurement/offer-pricing"
import { manualOfferRefusal, type ManualOfferInput } from "@/lib/procurement/rfq-detail"
import { awardMode } from "@/lib/procurement/rfq-award"
import { recordManualOffer } from "@/lib/procurement/rfq-writes"
import type { RfqWriteActor } from "@/lib/procurement/rfq-access"
import { ProcWriteError } from "@/lib/procurement/writes"
import { cn } from "@/lib/utils"
import type { RfqView } from "./rfqOfferView"

const OTHER = "__other__"

export function RfqManualOfferDialog({
  open,
  onOpenChange,
  rfq,
  pendingInvitees,
  sealed,
  actor,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  rfq: RfqView
  /** Invited companies that have not offered yet (org ids). */
  pendingInvitees: string[]
  sealed: boolean
  actor: RfqWriteActor
  onDone: () => void
}) {
  const t = useTranslations("Portal.Procurement.rfqd")
  const tc = useTranslations("Portal.Contractor")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const firestore = useFirestore()
  const storage = useStorage()
  const products = pricedProducts(rfq)
  const whole = awardMode(rfq) === "whole"

  const [names, setNames] = useState<Record<string, string>>({})
  const [pick, setPick] = useState<string>("")
  const [otherName, setOtherName] = useState("")
  const [rates, setRates] = useState<Record<number, string>>({})
  const [total, setTotal] = useState("")
  const [lead, setLead] = useState("")
  const [valid, setValid] = useState("")
  const [credit, setCredit] = useState("")
  const [advance, setAdvance] = useState("")
  const [basis, setBasis] = useState<"" | "site" | "exw">("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inviteeKey = pendingInvitees.join(",")
  useEffect(() => {
    if (!open || !firestore || !inviteeKey) return
    let cancelled = false
    ;(async () => {
      const found: Record<string, string> = {}
      for (const id of inviteeKey.split(",")) {
        try {
          const snap = await getDoc(doc(firestore, "users", id))
          const d = (snap.exists() ? snap.data() : {}) as { companyName?: string; name?: string }
          found[id] = (d.companyName || d.name || "").trim()
        } catch {
          found[id] = ""
        }
      }
      if (!cancelled) setNames(found)
    })()
    return () => {
      cancelled = true
    }
  }, [open, firestore, inviteeKey])

  const supplier: ManualOfferInput["supplier"] = pick && pick !== OTHER ? { orgId: pick, name: names[pick] || t("invited.unknown") } : { orgId: null, name: otherName }
  const input: ManualOfferInput = {
    rfq,
    supplier,
    rates: whole ? null : products.map((p) => ({ rfqProductIndex: p.rfqProductIndex, unitPrice: Math.round(toAmount(rates[p.rfqProductIndex]) * 100) / 100 })),
    total: whole ? toAmount(total) : null,
    leadDays: toAmount(lead) > 0 ? Math.round(toAmount(lead)) : null,
    validUntil: valid || null,
    priceBasis: (basis || "site") as "site" | "exw",
    creditDays: credit.trim() ? Math.max(0, Math.round(toAmount(credit))) : null,
    advancePercent: advance.trim() ? Math.min(100, Math.max(0, toAmount(advance))) : null,
    proofUrl: null,
    early: sealed,
  }
  const refusal = !pick ? "supplier_missing" : !basis ? "basis_missing" : manualOfferRefusal(input)

  const submit = async () => {
    if (!firestore || refusal) return
    setBusy(true)
    setError(null)
    try {
      let proofUrl: string | null = null
      if (file && storage) {
        const fileRef = ref(storage, `offers/manual/${rfq.id}/${Date.now()}-${file.name}`)
        await uploadBytes(fileRef, file)
        proofUrl = await getDownloadURL(fileRef)
      }
      await recordManualOffer(firestore, actor, { ...input, proofUrl }, products)
      onDone()
    } catch (err) {
      const code = err instanceof ProcWriteError ? err.code : null
      setError(code && tProc.has(`err_${code}`) ? tProc(`err_${code}`) : tc("offers_toast_error"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>{t("manual.title")}</DialogTitle>
          <DialogDescription>{t("manual.sub")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="manual-supplier" className="text-xs font-bold">
              {t("manual.supplier")} <span className="text-destructive">*</span>
            </Label>
            <select
              id="manual-supplier"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{t("manual.choose")}</option>
              {pendingInvitees.map((id) => (
                <option key={id} value={id}>
                  {names[id] || t("invited.unknown")}
                </option>
              ))}
              <option value={OTHER}>{t("manual.other_supplier")}</option>
            </select>
            {pick === OTHER && <Input aria-label={t("manual.company_name")} placeholder={t("manual.company_name")} value={otherName} onChange={(e) => setOtherName(e.target.value)} dir="auto" />}
            {pick === OTHER && <p className="text-[11px] text-muted-foreground">{t("manual.other_hint")}</p>}
          </div>

          {whole ? (
            <div className="space-y-1.5">
              <Label htmlFor="manual-total" className="text-xs font-bold">
                {t("manual.total")}
              </Label>
              <Input id="manual-total" type="number" min="0" step="any" inputMode="decimal" dir="ltr" value={total} onChange={(e) => setTotal(e.target.value)} className="h-9 w-48" />
            </div>
          ) : (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-bold">{t("manual.rates")}</legend>
              <div className="divide-y rounded-xl border">
                {products.map((p) => (
                  <div key={p.rfqProductIndex} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <b className="block truncate font-semibold" dir="auto">
                        {p.name}
                      </b>
                      <span className="text-[11px] text-muted-foreground">
                        <bdi dir="ltr">{p.quantity.toLocaleString("en-US")}</bdi> {p.unit}
                      </span>
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      dir="ltr"
                      className="h-9 w-28"
                      aria-label={t("award.unit_price_for", { line: p.name })}
                      placeholder={t("award.unit_price")}
                      value={rates[p.rfqProductIndex] ?? ""}
                      onChange={(e) => setRates((r) => ({ ...r, [p.rfqProductIndex]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{t("manual.blank_hint")}</p>
            </fieldset>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="manual-lead" className="text-xs font-bold">
                {t("manual.lead")}
              </Label>
              <Input id="manual-lead" type="number" min="0" inputMode="numeric" dir="ltr" value={lead} onChange={(e) => setLead(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-valid" className="text-xs font-bold">
                {t("manual.valid")}
              </Label>
              <Input id="manual-valid" type="date" dir="ltr" value={valid} onChange={(e) => setValid(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-credit" className="text-xs font-bold">
                {t("manual.credit")}
              </Label>
              <Input id="manual-credit" type="number" min="0" inputMode="numeric" dir="ltr" value={credit} onChange={(e) => setCredit(e.target.value)} className="h-9" placeholder="30" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs font-bold">
                {t("manual.basis")} <span className="text-destructive">*</span>
              </p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("manual.basis")}>
                {(["site", "exw"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="radio"
                    aria-checked={basis === b}
                    onClick={() => setBasis(b)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      basis === b ? "border-module bg-module/10 text-module" : "hover:bg-muted"
                    )}
                  >
                    {b === "site" ? t("cmp.basis_site") : t("cmp.basis_exw")}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-advance" className="text-xs font-bold">
                {t("manual.advance")}
              </Label>
              <Input id="manual-advance" type="number" min="0" max="100" inputMode="decimal" dir="ltr" value={advance} onChange={(e) => setAdvance(e.target.value)} className="h-9" placeholder="30" />
              <p className="text-[11px] text-muted-foreground">{t("manual.advance_hint")}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-proof" className="text-xs font-bold">
              {t("manual.proof")}
            </Label>
            <Input id="manual-proof" type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="h-9" />
            {!file && <p className="text-[11px] text-muted-foreground">{t("manual.no_proof_hint")}</p>}
          </div>

          {sealed && <Callout tone="warn">{t("manual.sealed_warn")}</Callout>}
          {error && <Callout tone="block">{error}</Callout>}
          {refusal && !error && <p className="text-[11px] text-destructive">{t(`manual.err_${refusal}`)}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {tc("cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || Boolean(refusal)} className="gap-2">
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            {t("manual.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
