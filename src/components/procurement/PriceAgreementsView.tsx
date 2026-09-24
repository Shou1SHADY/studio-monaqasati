"use client"

// The Suppliers tab's agreements segment (PRD 3.0 §7.2).
//
// An agreement is a price we already negotiated, so the only question the list
// has to answer at a glance is "which of these is about to stop being true".
// Expiring ones sort first and carry the amber; an expired one stays visible,
// because the orders placed on it still name it.
//
// Each row shows what every material costs against what we last paid ELSEWHERE —
// the agreement is only worth renewing while it still beats the market, and that
// is a comparison the reader makes themselves. No verdict, two numbers.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Handshake, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useFirestore } from "@/firebase"
import { displayAgreementNumber } from "@/lib/procurement/format"
import { agreementRows, lastPaid, type AgreementState, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { endPriceAgreement } from "@/lib/procurement/agreement-writes"
import { ProcWriteError } from "@/lib/procurement/writes"
import { AgreementDialog } from "./AgreementDialog"
import type { ProcActor } from "@/lib/procurement/types"

const TONE: Record<AgreementState, string> = {
  expiring: "bg-amber-100 text-amber-800 border-amber-200",
  live: "bg-success/10 text-success border-success/20",
  upcoming: "bg-muted text-muted-foreground border-border",
  expired: "bg-destructive/10 text-destructive border-destructive/20",
}

export function PriceAgreementsView({
  agreements,
  history,
  actor,
  orgId,
  locale,
  suppliers,
  mayEdit,
  fmtDate,
}: {
  agreements: PriceAgreement[]
  history: PriceHistoryEntry[]
  actor: ProcActor
  orgId: string
  locale: string
  suppliers: Array<{ id: string; name: string }>
  mayEdit: boolean
  fmtDate: (value: unknown, locale: string) => string
}) {
  const t = useTranslations("Portal.ProcPrices")
  const firestore = useFirestore()
  const [dialogFor, setDialogFor] = useState<PriceAgreement | null | undefined>(undefined)
  const [endTarget, setEndTarget] = useState<PriceAgreement | null>(null)
  const [endReason, setEndReason] = useState("")
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const rows = useMemo(() => agreementRows(agreements, today), [agreements, today])
  // One entry per material history knows, in the words its orders used.
  const knownMaterials = useMemo(() => {
    const seen = new Map<string, { name: string; unit: string }>()
    for (const h of history) if (!seen.has(h.materialKey)) seen.set(h.materialKey, { name: h.name, unit: h.unit })
    return Array.from(seen.values())
  }, [history])

  const endIt = async () => {
    if (!firestore || !endTarget || !endReason.trim()) return
    setEnding(true)
    setEndError(null)
    try {
      await endPriceAgreement(firestore, actor, endTarget.id, endReason)
      setEndTarget(null)
      setEndReason("")
    } catch (err) {
      // The real reason, not "try again": a retry never fixes a refusal.
      setEndError(err instanceof ProcWriteError && t.has(`err.${err.code}`) ? t(`err.${err.code}`) : t("err.generic"))
    } finally {
      setEnding(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("agreements.intro")}</p>
        {mayEdit && (
          <Button size="sm" onClick={() => setDialogFor(null)}>
            <Plus size={14} className="me-1.5" />
            {t("agreements.new")}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-16 text-center text-muted-foreground">
          <Handshake size={44} className="mx-auto mb-4 opacity-20" />
          <p className="text-lg font-bold">{t("agreements.emptyTitle")}</p>
          <p className="mt-1 text-sm">{t("agreements.emptyDesc")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-3 text-start font-bold">{t("agreements.colNumber")}</th>
                <th className="p-3 text-start font-bold">{t("agreements.colSupplier")}</th>
                <th className="p-3 text-start font-bold">{t("agreements.colItems")}</th>
                <th className="p-3 text-start font-bold">{t("agreements.colUntil")}</th>
                {mayEdit && <th className="p-3 text-end font-bold">{t("agreements.colActions")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t align-top">
                  <td className="p-3 font-bold tabular-nums" dir="ltr">
                    {displayAgreementNumber(a.docNumber, locale)}
                  </td>
                  <td className="p-3">{a.supplierName || "—"}</td>
                  <td className="p-3">
                    <ul className="space-y-1.5">
                      {(a.lines || []).map((l, i) => {
                        const elsewhere = history.filter((h) => h.supplierOrgId !== a.supplierOrgId)
                        const last = lastPaid(elsewhere, l.name, l.unit)
                        return (
                          <li key={i}>
                            <span className="font-medium">{l.name}</span>
                            <span className="text-muted-foreground">
                              {" — "}
                              <b className="tabular-nums" dir="ltr">
                                {l.price}
                              </b>
                              {` / ${l.unit}`}
                            </span>
                            {last && (
                              <span className="block text-[11px] text-muted-foreground">
                                {t("agreements.lastElsewhere", { price: last.price, supplier: last.supplierName || "—" })}
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                    {a.note && <p className="mt-1.5 text-[11px] text-muted-foreground">{a.note}</p>}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className={cn("border font-bold", TONE[a.state])}>
                      {t(`state.${a.state}`)}
                    </Badge>
                    <span className="mt-1 block text-[11px] text-muted-foreground">{fmtDate(a.until, locale)}</span>
                  </td>
                  {mayEdit && (
                    <td className="p-3 text-end">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setDialogFor(a)}>
                          {t("agreements.renew")}
                        </Button>
                        {a.state !== "expired" && (
                          <Button size="sm" variant="ghost" onClick={() => { setEndTarget(a); setEndReason(""); setEndError(null) }}>
                            {t("agreements.end")}
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(endTarget)} onOpenChange={(o) => !o && setEndTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("end.title", { number: displayAgreementNumber(endTarget?.docNumber, locale) })}</DialogTitle>
            <DialogDescription>{t("end.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="agr-end-reason" className="text-sm font-medium">
              {t("endReason")}
            </label>
            <Textarea id="agr-end-reason" rows={2} value={endReason} onChange={(e) => setEndReason(e.target.value)} />
            {endError && <p className="text-sm font-bold text-destructive">{endError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEndTarget(null)} disabled={ending}>
              {t("dialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={endIt} disabled={!endReason.trim() || ending}>
              {ending && <Loader2 className="me-1.5 animate-spin" size={14} />}
              {t("agreements.end")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AgreementDialog
        open={dialogFor !== undefined}
        onOpenChange={(o) => !o && setDialogFor(undefined)}
        actor={actor}
        orgId={orgId}
        locale={locale}
        agreement={dialogFor}
        suppliers={suppliers}
        knownMaterials={knownMaterials}
      />
    </div>
  )
}
