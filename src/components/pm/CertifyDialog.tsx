"use client"

// Record the consultant's certification (form 46, IPC-03): the certified value,
// never above what was submitted; a deduction states its reason. Everything
// recomputes on the certified value, the deduction returns to unbilled, and
// Finance is told the certified amount once.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { certificateAmounts, certificateNo, certifyBlocks } from "@/lib/pm/certificate"
import { certifyCertificate, PmCertificateError, type CertificateActor, type PmCertificate } from "@/lib/pm/certificate-writes"
import { pmMoney } from "@/lib/pm/format"

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
  const [reason, setReason] = useState("")
  const [ref, setRef] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setValue(String(cert.gross))
      setReason("")
      setRef("")
    }
  }, [open, cert.gross])

  const certified = value.trim() === "" ? NaN : Number(value)
  const blocks = certifyBlocks({ status: cert.status, gross: cert.gross, certified, reason })
  const amounts = Number.isFinite(certified) && certified > 0 ? certificateAmounts({ gross: certified, terms: cert.terms, contractValue: cert.contractValue, held: held - cert.retention, recovered: recovered - cert.recovery }) : null
  const cut = Number.isFinite(certified) ? Math.max(0, cert.gross - certified) : 0

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      await certifyCertificate(firestore, access.ctx, projectId, actor, cert.seq, { certified, reason, consultantRef: ref })
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("ipc.certify_title", { no: certificateNo(cert.seq) })}</DialogTitle>
          <DialogDescription>{t("ipc.certify_desc", { gross: pmMoney(cert.gross) })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ipc-v">{t("ipc.certified_value")}</Label>
            <Input id="ipc-v" type="number" min="0" step="any" inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
          </div>
          {cut > 0.005 && (
            <>
              <Callout tone="warn">{t("ipc.cut_note", { amount: pmMoney(cut) })}</Callout>
              <div className="space-y-1.5">
                <Label htmlFor="ipc-why">{t("ipc.cut_reason")}</Label>
                <Input id="ipc-why" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ipc-ref">{t("ipc.consultant_ref")}</Label>
            <Input id="ipc-ref" value={ref} onChange={(e) => setRef(e.target.value)} disabled={busy} />
          </div>
          {amounts && (
            <div className="rounded-xl border p-3">
              <KeyValueRow label={t("ipc.gross")} value={pmMoney(amounts.gross)} ltr />
              <KeyValueRow label={t("ipc.recovery_short")} value={`− ${pmMoney(amounts.recovery)}`} ltr />
              <KeyValueRow label={t("ipc.retention_short")} value={`− ${pmMoney(amounts.retention)}`} ltr />
              <KeyValueRow label={t("ipc.vat")} value={`+ ${pmMoney(amounts.vat)}`} ltr />
              <KeyValueRow label={t("ipc.net")} value={pmMoney(amounts.net)} ltr strong />
            </div>
          )}
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`ipc.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("ipc.certify")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
