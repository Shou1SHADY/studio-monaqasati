"use client"

// Money › Certificates on a PM 1.0 project (WF-05). Unbilled approved work
// above the threshold is a red "certificate ready" decision; each certificate
// moves prepared → approved internally (by someone else) → with the consultant
// → certified (Finance told the certified amount). Holders of money only; a
// project nobody pays has no certificates.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { BadgeCheck, FileCheck2, Loader2, Receipt, Send, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { mayApproveCertificate, PmAccessError, pmCan } from "@/lib/pm/access"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import { CERTIFICATE_READY_AT, certificateNo, CERTIFICATE_STATUSES, PM_CERTIFICATES, unbilledValue, type CertificateStatus } from "@/lib/pm/certificate"
import { approveCertificate, PmCertificateError, withdrawCertificate, type CertificateActor, type PmCertificate } from "@/lib/pm/certificate-writes"
import { pmDate, pmMoney } from "@/lib/pm/format"
import type { ContractTerms } from "@/lib/pm/terms"
import { CertifyDialog } from "./CertifyDialog"
import { PrepareCertificateDialog, type CertItem } from "./PrepareCertificateDialog"

const TONE: Record<CertificateStatus, PillTone> = { int: "warn", sub: "info", appr: "ok", part: "module", paid: "ok", void: "mute" }

export function CertificatesPanel({
  projectId,
  original,
  lifecycle,
  contractValue,
  totals,
  items,
  access,
  actor,
  onItemsChanged,
}: {
  projectId: string
  original: ContractTerms
  lifecycle: string
  contractValue: number
  totals: { retentionHeld?: number; advanceRecovered?: number; cutPool?: number }
  items: CertItem[]
  access: PmAccess
  actor: CertificateActor
  onItemsChanged?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [preparing, setPreparing] = useState(false)
  const [certifying, setCertifying] = useState<PmCertificate | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const certQuery = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_CERTIFICATES) : null), [firestore, projectId])
  const { data } = useCollection(certQuery)
  const certs = useMemo(() => ((data ?? []) as unknown as PmCertificate[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const addQuery = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_ADDENDA) : null), [firestore, projectId])
  const { data: addData } = useCollection(addQuery)
  const terms = useMemo(() => inForce(original, (addData ?? []) as unknown as PmAddendum[]), [original, addData])

  const held = totals.retentionHeld ?? 0
  const recovered = totals.advanceRecovered ?? 0
  const cutPool = totals.cutPool ?? 0
  const unbilled = items.reduce((a, i) => a + unbilledValue(i), 0) + cutPool
  const open = !access.ctx.archived
  const canPrepare = open && access.allowed("certificate.prepare")
  const canCertify = open && access.allowed("certificate.certify")

  const act = async (c: PmCertificate, how: "approve" | "withdraw") => {
    if (!firestore) return
    setBusy(`${c.seq}:${how}`)
    try {
      if (how === "approve") {
        await approveCertificate(firestore, access.ctx, projectId, actor, c.seq)
        toast({ title: t("ipc.approved", { no: certificateNo(c.seq) }) })
      } else {
        await withdrawCertificate(firestore, access.ctx, projectId, actor, c.seq)
        toast({ title: t("ipc.withdrawn", { no: certificateNo(c.seq) }) })
        onItemsChanged?.()
      }
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmCertificateError && err.code === "wrong_state" ? "ipc.wrong_state" : "error.save"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  if (!access.has("money")) return <Callout tone="info">{t("ipc.money_only")}</Callout>

  return (
    <Panel
      title={t("ipc.title")}
      icon={Receipt}
      count={certs.filter((c) => c.status === "int" || c.status === "sub").length || undefined}
      actions={
        canPrepare && terms.payer !== "none" ? (
          <Button size="sm" onClick={() => setPreparing(true)}>
            <FileCheck2 size={15} className="me-1.5" aria-hidden="true" />
            {t("ipc.prepare")}
          </Button>
        ) : null
      }
    >
      {terms.payer === "none" && <Callout tone="info" className="mb-4">{t("ipc.no_client")}</Callout>}

      <div className="mb-4 grid gap-x-6 sm:grid-cols-2">
        <KeyValueRow label={t("ipc.unbilled")} value={pmMoney(unbilled)} ltr strong />
        <KeyValueRow label={t("ipc.cut_pool")} value={pmMoney(cutPool)} ltr />
        <KeyValueRow label={t("ipc.held", { cap: pmMoney(terms.retentionCap * contractValue) })} value={pmMoney(held)} ltr />
        <KeyValueRow label={t("ipc.recovered", { total: pmMoney(terms.advance * contractValue) })} value={pmMoney(recovered)} ltr />
      </div>

      {canPrepare && terms.payer !== "none" && unbilled >= CERTIFICATE_READY_AT && (
        <ul className="mb-4 overflow-hidden rounded-xl border">
          <DecisionRow
            severity="red"
            icon={Receipt}
            title={t("ipc.ready_title")}
            detail={t("ipc.ready_detail")}
            amount={<span dir="ltr">{pmMoney(unbilled)}</span>}
            action={
              <Button size="sm" onClick={() => setPreparing(true)}>
                {t("ipc.prepare")}
              </Button>
            }
          />
        </ul>
      )}

      {certs.length === 0 ? (
        <EmptyState icon={Receipt} title={t("ipc.empty")} description={t("ipc.empty_desc")} />
      ) : (
        <ul className="space-y-3">
          {certs.map((c) => {
            const known = (CERTIFICATE_STATUSES as readonly string[]).includes(c.status)
            const mayApprove = open && c.status === "int" && mayApproveCertificate(access.ctx, access.uid ?? "", c.prep)
            const isPreparer = c.prep === access.uid
            const mayWithdraw = open && c.status === "int" && (isPreparer ? pmCan(access.ctx, "prep") || pmCan(access.ctx, "approve") : pmCan(access.ctx, "approve"))
            return (
              <li key={c.seq} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      {t("ipc.no", { no: certificateNo(c.seq) })}
                      <StatusPill tone={known ? TONE[c.status] : "bad"}>{known ? t(`ipc.status.${c.status}`) : t("unknown_state")}</StatusPill>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("ipc.prepared_line", { who: c.prepName || "—", date: pmDate(c.prepOn, locale) })}
                      {c.apprName ? ` · ${t("ipc.approved_line", { who: c.apprName, date: pmDate(c.apprOn, locale) })}` : ""}
                      {c.certOn ? ` · ${t("ipc.certified_line", { date: pmDate(c.certOn, locale), due: pmDate(c.dueOn, locale) })}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.status === "int" && isPreparer && !mayApprove && <span className="self-center text-xs text-muted-foreground">{t("ipc.needs_second")}</span>}
                    {mayApprove && (
                      <Button size="sm" onClick={() => void act(c, "approve")} disabled={busy !== null}>
                        {busy === `${c.seq}:approve` ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Send size={14} className="me-1.5" aria-hidden="true" />}
                        {t("ipc.approve")}
                      </Button>
                    )}
                    {mayWithdraw && (
                      <Button size="sm" variant="outline" onClick={() => void act(c, "withdraw")} disabled={busy !== null}>
                        <Undo2 size={14} className="me-1.5" aria-hidden="true" />
                        {t("ipc.withdraw")}
                      </Button>
                    )}
                    {c.status === "sub" && canCertify && (
                      <Button size="sm" onClick={() => setCertifying(c)} disabled={busy !== null}>
                        <BadgeCheck size={14} className="me-1.5" aria-hidden="true" />
                        {t("ipc.certify")}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
                  <KeyValueRow label={t(c.status === "appr" ? "ipc.certified_gross" : "ipc.gross")} value={pmMoney(c.gross)} ltr />
                  <KeyValueRow label={t("ipc.recovery_short")} value={pmMoney(c.recovery)} ltr />
                  <KeyValueRow label={t("ipc.retention_short")} value={pmMoney(c.retention)} ltr />
                  <KeyValueRow label={t("ipc.vat")} value={pmMoney(c.vat)} ltr />
                  <KeyValueRow label={t("ipc.net")} value={pmMoney(c.net)} ltr strong />
                  {c.submitted && (c.cut ?? 0) > 0 && <KeyValueRow label={t("ipc.cut", { reason: c.cutReason || "—" })} value={pmMoney(c.cut ?? 0)} ltr />}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canPrepare && (
        <PrepareCertificateDialog
          open={preparing}
          onOpenChange={setPreparing}
          projectId={projectId}
          access={access}
          actor={actor}
          items={items}
          terms={terms}
          lifecycle={lifecycle}
          contractValue={contractValue}
          held={held}
          recovered={recovered}
          cutPool={cutPool}
          onSaved={onItemsChanged}
        />
      )}
      {certifying && <CertifyDialog open onOpenChange={(o) => !o && setCertifying(null)} projectId={projectId} access={access} actor={actor} cert={certifying} held={held} recovered={recovered} />}
    </Panel>
  )
}
