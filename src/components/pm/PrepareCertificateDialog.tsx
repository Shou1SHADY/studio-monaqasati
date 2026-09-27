"use client"

// Prepare a certificate (form 45, WF-05): the priced items with approved work
// not yet billed, each billed whole; the consultant's earlier deductions
// re-claimed unless unticked. The §8.6 breakdown is computed live, the same
// way the write computes it — the cap on retention applied.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { certificateAmounts, certificateLines, certificateNo, prepareBlocks, type BillableItem } from "@/lib/pm/certificate"
import { PmCertificateError, prepareCertificate, type CertificateActor } from "@/lib/pm/certificate-writes"
import { pmMoney, pmPct } from "@/lib/pm/format"
import type { ContractTerms } from "@/lib/pm/terms"

export interface CertItem extends BillableItem {
  code: string
  description: string
  unit: string
}

export function PrepareCertificateDialog({
  open,
  onOpenChange,
  projectId,
  access,
  actor,
  items,
  terms,
  lifecycle,
  contractValue,
  held,
  recovered,
  cutPool,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  access: PmAccess
  actor: CertificateActor
  items: CertItem[]
  terms: ContractTerms
  lifecycle: string
  contractValue: number
  held: number
  recovered: number
  cutPool: number
  onSaved?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const billable = useMemo(() => certificateLines(items, new Set(items.map((i) => i.id))), [items])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [cuts, setCuts] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setChosen(new Set(billable.map((l) => l.itemId)))
      setCuts(true)
    }
  }, [open, billable])

  const lines = billable.filter((l) => chosen.has(l.itemId))
  const gross = lines.reduce((a, l) => a + l.amount, 0) + (cuts ? cutPool : 0)
  const amounts = certificateAmounts({ gross, terms, contractValue, held, recovered })
  const blocks = prepareBlocks({ archived: access.ctx.archived, lifecycle, payer: terms.payer, gross })
  const capped = gross * terms.retention - amounts.retention > 0.005
  const byId = new Map(items.map((i) => [i.id, i]))

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      const r = await prepareCertificate(firestore, access.ctx, projectId, actor, { itemIds: [...chosen], includeCuts: cuts })
      toast({ title: t("ipc.prepared", { no: certificateNo(r.seq) }) })
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("ipc.prepare_title")}</DialogTitle>
          <DialogDescription>{t("ipc.prepare_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {billable.length === 0 && cutPool <= 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{t("ipc.nothing_unbilled")}</p>
          ) : (
            <ul className="max-h-[40vh] divide-y overflow-y-auto rounded-xl border">
              {billable.map((l) => {
                const i = byId.get(l.itemId)
                return (
                  <li key={l.itemId}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <Checkbox
                        checked={chosen.has(l.itemId)}
                        onCheckedChange={(on) =>
                          setChosen((cur) => {
                            const n = new Set(cur)
                            if (on === true) n.add(l.itemId)
                            else n.delete(l.itemId)
                            return n
                          })
                        }
                        disabled={busy}
                      />
                      <span className="min-w-0 flex-1 truncate" dir="auto">
                        <span className="me-1.5 text-xs text-muted-foreground" dir="ltr">
                          {i?.code}
                        </span>
                        {i?.description}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">
                        {l.qty.toLocaleString("en-US")} {i?.unit}
                      </span>
                      <span className="w-28 shrink-0 text-end font-semibold tabular-nums" dir="ltr">
                        {pmMoney(l.amount)}
                      </span>
                    </label>
                  </li>
                )
              })}
              {cutPool > 0 && (
                <li>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <Checkbox checked={cuts} onCheckedChange={(on) => setCuts(on === true)} disabled={busy} />
                    <span className="flex-1">{t("ipc.reclaim_cuts")}</span>
                    <span className="w-28 shrink-0 text-end font-semibold tabular-nums" dir="ltr">
                      {pmMoney(cutPool)}
                    </span>
                  </label>
                </li>
              )}
            </ul>
          )}
          <div className="rounded-xl border p-3">
            <KeyValueRow label={t("ipc.gross")} value={pmMoney(amounts.gross)} ltr />
            <KeyValueRow label={t("ipc.recovery", { rate: pmPct(terms.advance) })} value={`− ${pmMoney(amounts.recovery)}`} ltr />
            <KeyValueRow
              label={
                <span>
                  {t("ipc.retention", { rate: pmPct(terms.retention), cap: pmPct(terms.retentionCap) })}
                  {capped && <span className="ms-1.5 rounded bg-warning/15 px-1 text-[10px] font-bold text-warning">{t("ipc.at_cap")}</span>}
                </span>
              }
              value={`− ${pmMoney(amounts.retention)}`}
              ltr
            />
            <KeyValueRow label={t("ipc.vat")} value={`+ ${pmMoney(amounts.vat)}`} ltr />
            <KeyValueRow label={<Label className="font-bold">{t("ipc.net")}</Label>} value={pmMoney(amounts.net)} ltr strong />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`ipc.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("ipc.prepare")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
