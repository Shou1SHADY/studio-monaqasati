"use client"

// Record the consultant's certification (form 46, IPC-03): the value exactly as
// the consultant's certificate reads — typed, never prefilled — and never above
// what was submitted; a deduction states one of four reasons, which decides the
// follow-up. Everything recomputes on the certified value, the deduction returns
// to unbilled, and Finance is told the certified amount once (prj:IPC).

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { Link2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { certificateAmounts, certificateNo, certifyBlocks, CUT_REASONS, type CutReason } from "@/lib/pm/certificate"
import { certifyCertificate, PmCertificateError, type CertificateActor, type PmCertificate } from "@/lib/pm/certificate-writes"
import { pmMoney } from "@/lib/pm/format"
import { onPmCertificateCertified } from "@/lib/accounting/pm-hooks"
import { ChoiceChips, FormHint } from "./ContractBits"

export function CertifyDialog({
  open,
  onOpenChange,
  projectId,
  access,
  actor,
  cert,
  held,
  recovered,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  access: PmAccess
  actor: CertificateActor
  cert: PmCertificate
  /** The project's running totals, this certificate included. */
  held: number
  recovered: number
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [value, setValue] = useState("")
  const [reason, setReason] = useState<CutReason | null>(null)
  const [ref, setRef] = useState("")
  const [busy, setBusy] = useState(false)
  const projectRef = useMemoFirebase(() => (firestore ? doc(firestore, "projects", projectId) : null), [firestore, projectId])
  const { data: projectDoc } = useDoc<{ name?: string; pm?: { no?: string } }>(projectRef)
  const projectNo = projectDoc?.pm?.no ?? null

  useEffect(() => {
    if (open) {
      setValue("")
      setReason(null)
      setRef("")
    }
  }, [open])

  const certified = value.trim() === "" ? NaN : Number(value)
  const blocks = certifyBlocks({ status: cert.status, gross: cert.gross, certified, reason })
  const valid = Number.isFinite(certified) && certified > 0 && certified <= cert.gross + 0.005
  const amounts = valid ? certificateAmounts({ gross: certified, terms: cert.terms, contractValue: cert.contractValue, held: held - cert.retention, recovered: recovered - cert.recovery }) : null
  const cut = valid ? Math.max(0, cert.gross - certified) : 0
  const key = `prj:IPC:${projectNo || projectId}:${certificateNo(cert.seq)}`

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      const res = await certifyCertificate(firestore, access.ctx, projectId, actor, cert.seq, { certified, reason: cut > 0.005 ? reason : null, consultantRef: ref })
      if (res.event) onPmCertificateCertified(firestore, { organizationId: res.event.organizationId, userId: actor.uid, userName: actor.name || "" }, res.event)
      toast({ title: t("ipc.certified_done", { no: certificateNo(cert.seq) }), description: cut > 0 ? t("ipc.cut_back", { amount: pmMoney(cut) }) : undefined })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmCertificateError && err.blocks[0] ? `ipc.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  // Only a typed value is judged — an empty box is not yet an error.
  const shownBlocks = value.trim() === "" ? blocks.filter((b) => b !== "bad_amount") : blocks

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("ipc.certify_title_consultant")}</DialogTitle>
          <DialogDescription dir="auto">{[t("ipc.no", { no: certificateNo(cert.seq) }), projectDoc?.name].filter(Boolean).join(" — ")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ipc-sub">{t("ipc.submitted_value")}</Label>
              <div id="ipc-sub" className="flex h-10 items-center rounded-md border bg-muted/50 px-3 text-sm font-bold tabular-nums" dir="ltr">
                {pmMoney(cert.gross)}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ipc-v">{t("ipc.certified_by_consultant")}</Label>
              <Input id="ipc-v" type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
              <FormHint>{t("ipc.as_written")}</FormHint>
            </div>
          </div>
          {cut > 0.005 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                {t("ipc.cut_reason")} <span className="text-destructive">*</span>
              </p>
              <ChoiceChips label={t("ipc.cut_reason")} options={CUT_REASONS.map((r) => ({ id: r, label: t(`ipc.cut_reasons.${r}`) }))} value={reason} onChange={setReason} disabled={busy} />
              <FormHint>{t("ipc.cut_hint")}</FormHint>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ipc-ref">{t("ipc.consultant_ref")}</Label>
            <Input id="ipc-ref" value={ref} onChange={(e) => setRef(e.target.value)} disabled={busy} dir="auto" />
          </div>
          {amounts && (
            <div className="rounded-xl border p-3">
              <KeyValueRow label={t("ipc.certified_gross")} value={pmMoney(amounts.gross)} ltr />
              <KeyValueRow label={t("ipc.recovery_short")} value={`− ${pmMoney(amounts.recovery)}`} ltr />
              <KeyValueRow label={t("ipc.retention_short")} value={`− ${pmMoney(amounts.retention)}`} ltr />
              <KeyValueRow label={t("ipc.vat_on_certified")} value={`+ ${pmMoney(amounts.vat)}`} ltr />
              <KeyValueRow label={t("ipc.net_finance")} value={pmMoney(amounts.net)} ltr strong />
              {cut > 0.005 && <KeyValueRow label={<span className="text-destructive">{t("ipc.back_to_unbilled")}</span>} value={<span className="text-destructive">{pmMoney(cut)}</span>} ltr />}
            </div>
          )}
          <Callout tone="info">
            <span className="flex items-start gap-1.5">
              <Link2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t("ipc.finance_event")}{" "}
                <b dir="ltr" className="font-mono text-xs [unicode-bidi:isolate]">
                  {key}
                </b>{" "}
                — {t("ipc.finance_event_once")}
              </span>
            </span>
          </Callout>
          <BlockingReasons title={t("cannot_save")} reasons={shownBlocks.map((b) => t(`ipc.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("ipc.certify_send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
