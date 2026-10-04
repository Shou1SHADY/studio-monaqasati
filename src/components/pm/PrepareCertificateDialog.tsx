"use client"

// A new certificate (form 45, WF-05): nobody types an amount — the items with
// approved work not yet billed (each billed whole), the approved variations for
// their executed share not yet billed, and the consultant's earlier
// deductions. Work on variations nobody approved is shown as excluded risk.
// The §8.6 breakdown is computed live, as the write computes it. The checklist
// is ticked by a person, so it never blocks.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, ChevronDown, ClipboardList, Loader2, Ruler } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import {
  CERTIFICATE_CHECKS,
  certificateAmounts,
  certificateLines,
  certificateNo,
  certificateVoLines,
  prepareBlocks,
  voClaimable,
  voRisk,
  type BillableItem,
  type CertificateCheck,
  type ClaimableVariation,
} from "@/lib/pm/certificate"
import { PmCertificateError, prepareCertificate, type CertificateActor } from "@/lib/pm/certificate-writes"
import { pmDate, pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import type { ContractTerms } from "@/lib/pm/terms"
import { cn } from "@/lib/utils"

export interface CertItem extends BillableItem {
  /** The contract quantity — with the rate, the item's share of the contract value (INV-01). */
  quantity?: number
  code: string
  description: string
  unit: string
}

const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })
const toggle = (set: Set<string>, id: string, on: boolean) => {
  const n = new Set(set)
  if (on) n.add(id)
  else n.delete(id)
  return n
}

export function PrepareCertificateDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  access,
  actor,
  items,
  variations,
  terms,
  payer,
  lifecycle,
  contractValue,
  held,
  recovered,
  cutPool,
  cutFrom,
  periodFrom,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName?: string
  access: PmAccess
  actor: CertificateActor
  items: CertItem[]
  variations: ClaimableVariation[]
  terms: ContractTerms
  /** Who the certificate is addressed to (terms.ts `certificatePayer`); the payer in force when not given. */
  payer?: string
  lifecycle: string
  contractValue: number
  held: number
  recovered: number
  cutPool: number
  /** The certificates the consultant cut, and why — what the re-claim is made of. */
  cutFrom: Array<{ no: string; reason: string }>
  periodFrom: string | null
  onSaved?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const billable = useMemo(() => certificateLines(items, new Set(items.map((i) => i.id))), [items])
  const claimable = useMemo(() => voClaimable(variations), [variations])
  const risk = useMemo(() => voRisk(variations), [variations])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [vos, setVos] = useState<Set<string>>(new Set())
  const [cuts, setCuts] = useState(true)
  const [checks, setChecks] = useState<Set<CertificateCheck>>(new Set())
  const [showChecks, setShowChecks] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setChosen(new Set(billable.map((l) => l.itemId)))
      setVos(new Set(claimable.map((v) => v.id)))
      setCuts(true)
      setChecks(new Set())
    }
  }, [open, billable, claimable])

  const lines = billable.filter((l) => chosen.has(l.itemId))
  const voLines = certificateVoLines(variations, vos)
  const gross = lines.reduce((a, l) => a + l.amount, 0) + voLines.reduce((a, l) => a + l.amount, 0) + (cuts ? cutPool : 0)
  const amounts = certificateAmounts({ gross, terms, contractValue, held, recovered })
  const blocks = prepareBlocks({ archived: access.ctx.archived, lifecycle, payer: payer ?? terms.payer, gross })
  const capped = gross * terms.retention - amounts.retention > 0.005
  const byId = new Map(items.map((i) => [i.id, i]))
  const nothing = billable.length === 0 && claimable.length === 0 && cutPool <= 0

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      const r = await prepareCertificate(firestore, access.ctx, projectId, actor, { itemIds: [...chosen], voIds: [...vos], includeCuts: cuts, checks: [...checks] })
      toast({ title: t("ipc.prepared_net", { no: certificateNo(r.seq), net: pmMoney(r.amounts.net) }) })
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmCertificateError && err.blocks[0] ? `ipc.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const rowCls = "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("money.form.title")}</DialogTitle>
          <DialogDescription>{t("money.form.period", { project: projectName || "—", from: pmDate(periodFrom, locale), to: pmDate(todayDay(), locale) })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="info">
            <span className="flex items-start gap-1.5">
              <Ruler size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t("money.form.no_amount")}
            </span>
          </Callout>

          {nothing ? (
            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{t("money.form.nothing")}</p>
          ) : (
            <>
              <div className="rounded-xl border p-3">
                <p className="mb-1 text-sm font-bold">{t("money.form.calc")}</p>
                <KeyValueRow label={t("money.dr.work")} value={pmMoney(amounts.gross)} ltr />
                <KeyValueRow label={t("money.dr.recovery", { rate: pmPct(terms.advance) })} value={`− ${pmMoney(amounts.recovery)}`} ltr />
                <KeyValueRow
                  label={
                    <span>
                      {t("money.dr.retention", { rate: pmPct(terms.retention) })}
                      {capped && <span className="ms-1.5 rounded bg-warning/15 px-1 text-[10px] font-bold text-warning">{t("ipc.at_cap")}</span>}
                    </span>
                  }
                  value={`− ${pmMoney(amounts.retention)}`}
                  ltr
                />
                <KeyValueRow label={t("money.dr.vat")} value={`+ ${pmMoney(amounts.vat)}`} ltr />
                <KeyValueRow label={<Label className="font-bold">{t("money.dr.net")}</Label>} value={pmMoney(amounts.net)} ltr strong />
              </div>

              {billable.length > 0 && (
                <section aria-label={t("money.form.items")}>
                  <p className="mb-1.5 flex items-center justify-between text-sm font-bold">
                    {t("money.form.items")}
                    <span className="text-xs font-normal text-muted-foreground" dir="ltr">
                      {lines.length}/{billable.length}
                    </span>
                  </p>
                  <ul className="max-h-[36vh] divide-y overflow-y-auto rounded-xl border">
                    {billable.map((l) => {
                      const i = byId.get(l.itemId)
                      return (
                        <li key={l.itemId}>
                          <label className={rowCls}>
                            <Checkbox checked={chosen.has(l.itemId)} onCheckedChange={(on) => setChosen((cur) => toggle(cur, l.itemId, on === true))} disabled={busy} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium" dir="auto">
                                {i?.description}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                <span dir="ltr">{i?.code}</span> · {t("money.form.measured_billed", { ex: qty(i?.executed ?? 0), bl: qty(i?.billed ?? 0) })}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">
                              <b>{qty(l.qty)}</b> {i?.unit}
                            </span>
                            <span className="w-28 shrink-0 text-end font-semibold tabular-nums" dir="ltr">
                              {pmMoney(l.amount)}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {claimable.length > 0 && (
                <section aria-label={t("money.form.vos")}>
                  <p className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm font-bold">
                    {t("money.form.vos")}
                    <span className="text-xs font-normal text-muted-foreground">{t("money.form.vos_sub")}</span>
                  </p>
                  <ul className="divide-y rounded-xl border">
                    {claimable.map((v) => (
                      <li key={v.id}>
                        <label className={rowCls}>
                          <Checkbox checked={vos.has(v.id)} onCheckedChange={(on) => setVos((cur) => toggle(cur, v.id, on === true))} disabled={busy} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium" dir="auto">
                              {v.title}
                            </span>
                            <span className="block text-xs text-muted-foreground">{t("money.form.vo_line", { no: String(v.seq).padStart(2, "0"), ex: pmPct(v.executedPct), bl: pmPct(v.billedPct ?? 0) })}</span>
                          </span>
                          <span className="w-28 shrink-0 text-end font-semibold tabular-nums" dir="ltr">
                            {pmMoney(v.value * (v.executedPct - (v.billedPct ?? 0)))}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {cutPool > 0 && (
                <div className="rounded-xl border">
                  <label className={rowCls}>
                    <Checkbox checked={cuts} onCheckedChange={(on) => setCuts(on === true)} disabled={busy} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t("money.form.cuts")}</span>
                      {cutFrom.length > 0 && <span className="block text-xs text-muted-foreground">{cutFrom.map((c) => `${t("ipc.no", { no: c.no })} — ${c.reason || "—"}`).join(" · ")}</span>}
                    </span>
                    <span className="w-28 shrink-0 text-end font-semibold tabular-nums" dir="ltr">
                      {pmMoney(cutPool)}
                    </span>
                  </label>
                </div>
              )}

              {risk > 0 && <Callout tone="warn">{t("money.form.risk", { amount: pmMoney(risk) })}</Callout>}

              <div className="rounded-xl border">
                <button
                  type="button"
                  onClick={() => setShowChecks((s) => !s)}
                  aria-expanded={showChecks}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-start text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ClipboardList size={15} aria-hidden="true" />
                  <span className="flex-1">{t("money.form.checklist")}</span>
                  <span className="text-xs font-normal text-muted-foreground">{t("money.form.non_blocking")}</span>
                  <ChevronDown size={15} className={cn("transition-transform", showChecks && "rotate-180")} aria-hidden="true" />
                </button>
                {showChecks && (
                  <div className="space-y-2 border-t px-3 py-3">
                    {CERTIFICATE_CHECKS.map((k) => (
                      <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                        <Checkbox checked={checks.has(k)} onCheckedChange={(on) => setChecks((cur) => toggle(cur as Set<string>, k, on === true) as Set<CertificateCheck>)} disabled={busy} />
                        <span className="font-medium">{t(`money.check.${k}`)}</span>
                      </label>
                    ))}
                    <p className="text-xs text-muted-foreground">{t("money.form.checklist_note")}</p>
                  </div>
                )}
              </div>
            </>
          )}
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(b === "zero" ? "money.form.nothing" : `ipc.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <Check size={16} className="me-2" aria-hidden="true" />}
            {t("money.form.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
