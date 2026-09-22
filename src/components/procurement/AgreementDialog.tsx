"use client"

// Signing a price agreement, and renewing one (PRD 3.0 §4 `AGR`, §7.4).
//
// One dialog, two jobs, because they ask almost the same questions. Signing asks
// which supplier, for how long, and the price of each material. Renewing asks
// only for the new end date and the re-negotiated prices: the supplier and the
// materials are what the orders already placed on it point at, so they are shown
// and not editable.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore, useUser } from "@/firebase"
import { createPriceAgreement, renewPriceAgreement } from "@/lib/procurement/agreement-writes"
import { materialKey, renewalUntil, type PriceAgreement } from "@/lib/procurement/prices"
import { displayAgreementNumber } from "@/lib/procurement/format"
import { ProcWriteError } from "@/lib/procurement/writes"
import type { ProcActor } from "@/lib/procurement/types"

interface Row {
  name: string
  unit: string
  price: string
}

const emptyRow = (): Row => ({ name: "", unit: "", price: "" })
const today = () => new Date().toISOString().slice(0, 10)

export function AgreementDialog({
  open,
  onOpenChange,
  actor,
  orgId,
  locale,
  /** Signing when absent; renewing the one given. */
  agreement,
  suppliers,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  actor: ProcActor
  orgId: string
  locale: string
  agreement?: PriceAgreement | null
  suppliers: Array<{ id: string; name: string }>
  onDone?: () => void
}) {
  const t = useTranslations("Portal.ProcPrices")
  const firestore = useFirestore()
  const { user } = useUser()
  const renewing = Boolean(agreement)

  const [supplierOrgId, setSupplierOrgId] = useState("")
  const [from, setFrom] = useState(today())
  const [until, setUntil] = useState("")
  const [rows, setRows] = useState<Row[]>([emptyRow()])
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reopening must not show the previous agreement's numbers.
  useEffect(() => {
    if (!open) return
    setError(null)
    if (agreement) {
      setSupplierOrgId(agreement.supplierOrgId)
      setFrom(agreement.from)
      setUntil(renewalUntil(agreement, today()))
      setRows((agreement.lines || []).map((l) => ({ name: l.name, unit: l.unit, price: String(l.price) })))
      setNote(agreement.note || "")
    } else {
      setSupplierOrgId("")
      setFrom(today())
      setUntil("")
      setRows([emptyRow()])
      setNote("")
    }
  }, [open, agreement])

  const priced = rows.filter((r) => r.name.trim() && r.unit.trim() && Number(r.price) > 0)
  const ready = renewing ? until > today() : Boolean(supplierOrgId) && Boolean(from) && until >= from && until >= today() && priced.length > 0

  const submit = async () => {
    if (!firestore || !user || !ready) return
    setBusy(true)
    setError(null)
    try {
      if (agreement) {
        const prices: Record<string, string> = {}
        for (const r of rows) prices[materialKey(r.name, r.unit)] = r.price
        await renewPriceAgreement(firestore, actor, agreement.id, { until, prices, note })
      } else {
        await createPriceAgreement(firestore, actor, {
          organizationId: orgId,
          supplierOrgId,
          supplierName: suppliers.find((s) => s.id === supplierOrgId)?.name || "",
          from,
          until,
          lines: rows,
          note,
        })
      }
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      setError(err instanceof ProcWriteError ? t(`err.${err.code}`) : t("err.generic"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{renewing ? t("dialog.renewTitle", { number: displayAgreementNumber(agreement?.docNumber, locale) }) : t("dialog.newTitle")}</DialogTitle>
          <DialogDescription>{renewing ? t("dialog.renewDesc") : t("dialog.newDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {renewing ? (
            <p className="text-sm font-bold text-foreground">{agreement?.supplierName}</p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="agr-supplier">{t("dialog.supplier")}</Label>
              <select
                id="agr-supplier"
                value={supplierOrgId}
                onChange={(e) => setSupplierOrgId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t("dialog.pickSupplier")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agr-from">{t("dialog.from")}</Label>
              <Input id="agr-from" type="date" value={from} disabled={renewing} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agr-until">{t("dialog.until")}</Label>
              <Input id="agr-until" type="date" value={until} min={renewing ? today() : from} onChange={(e) => setUntil(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("dialog.lines")}</Label>
            {rows.map((r, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Input
                    aria-label={t("dialog.material")}
                    placeholder={t("dialog.material")}
                    value={r.name}
                    disabled={renewing}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Input
                    aria-label={t("dialog.unit")}
                    placeholder={t("dialog.unit")}
                    value={r.unit}
                    disabled={renewing}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                  />
                </div>
                <div className="w-28 space-y-1">
                  <Input
                    aria-label={t("dialog.price")}
                    placeholder={t("dialog.price")}
                    inputMode="decimal"
                    dir="ltr"
                    value={r.price}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                  />
                </div>
                {!renewing && rows.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" aria-label={t("dialog.removeLine")} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    <X size={16} />
                  </Button>
                )}
              </div>
            ))}
            {!renewing && (
              <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, emptyRow()])}>
                <Plus size={14} className="me-1.5" />
                {t("dialog.addLine")}
              </Button>
            )}
            {renewing && <p className="text-[11px] text-muted-foreground">{t("dialog.renewPricesHint")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agr-note">{t("dialog.note")}</Label>
            <Textarea id="agr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("dialog.notePlaceholder")} />
          </div>

          {error && <p className="text-sm font-bold text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("dialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={!ready || busy}>
            {busy && <Loader2 className="me-1.5 animate-spin" size={14} />}
            {renewing ? t("dialog.renew") : t("dialog.sign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
