"use client"

// A certificate's drawer (form 45 → 46): how its number was computed, when it
// is due and what Finance collected, who prepared and who approved it (the
// preparer never approves — a recorded self-approval is flagged), the
// consultant's certification with any deduction, and what Finance did with it.
// Internal approval, withdrawal and recording the certification start here.
// The preparer approves his own only when the owner has allowed self-approval
// (pmSettings.selfApproval) — then it is recorded as an exception.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { BadgeCheck, Calculator, Check, ClipboardCheck, Info, Link2, Loader2, Lock, Receipt, ShieldCheck, Undo2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { mayApproveCertificate, PmAccessError, pmCan } from "@/lib/pm/access"
import { CERTIFICATE_CHECKS, CERTIFICATE_STATUSES, certificateNo, type CertificateStatus, collectedAmount, collectedShare, daysBetween, isCutReason, lateDays } from "@/lib/pm/certificate"
import { approveCertificate, PmCertificateError, withdrawCertificate, type CertificateActor, type PmCertificate } from "@/lib/pm/certificate-writes"
import { pmDate, pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import { PM_SETTINGS, type PmOrgSettings } from "@/lib/pm/info-writes"
import { cn } from "@/lib/utils"

export const CERT_TONE: Record<CertificateStatus, PillTone> = { int: "warn", sub: "info", appr: "module", part: "warn", paid: "ok", void: "mute" }

export function CertificateDrawer({
  cert,
  certs,
  period,
  projectName,
  projectId,
  access,
  actor,
  onClose,
  onCertify,
  onChanged,
}: {
  cert: PmCertificate | null
  certs: PmCertificate[]
  period: { from: string | null; to: string } | null
  projectName?: string
  projectId: string
  access: PmAccess
  actor: CertificateActor
  onClose: () => void
  onCertify: (c: PmCertificate) => void
  onChanged?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState<"approve" | "withdraw" | null>(null)
  const today = todayDay()
  const projectRef = useMemoFirebase(() => (firestore ? doc(firestore, "projects", projectId) : null), [firestore, projectId])
  const { data: projectDoc } = useDoc<{ organizationId?: string }>(projectRef)
  const orgId = projectDoc?.organizationId ?? null
  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PM_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settings } = useDoc<PmOrgSettings>(settingsRef)
  const selfApproval = settings?.selfApproval === true

  const act = async (c: PmCertificate, how: "approve" | "withdraw") => {
    if (!firestore) return
    setBusy(how)
    try {
      if (how === "approve") {
        await approveCertificate(firestore, access.ctx, projectId, actor, c.seq)
        toast({
          title:
            c.prep === actor.uid
              ? t("ipc.approved_self", { no: certificateNo(c.seq), who: actor.name || "—", date: pmDate(today, locale) })
              : t("ipc.approved_net", { no: certificateNo(c.seq), net: pmMoney(c.net) }),
        })
      } else {
        await withdrawCertificate(firestore, access.ctx, projectId, actor, c.seq)
        toast({ title: t("ipc.withdrawn", { no: certificateNo(c.seq) }) })
        onChanged?.()
      }
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmCertificateError && err.code === "wrong_state" ? "ipc.wrong_state" : "error.save"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const c = cert
  const open = !access.ctx.archived
  const known = c ? (CERTIFICATE_STATUSES as readonly string[]).includes(c.status) : false
  const late = c ? lateDays(c, today) : 0
  const share = c ? collectedShare(c) : 0
  const isPreparer = c?.prep === access.uid
  const mayApprove = Boolean(c) && open && c!.status === "int" && mayApproveCertificate(access.ctx, access.uid ?? "", c!.prep, selfApproval)
  const mayWithdraw = Boolean(c) && open && c!.status === "int" && (isPreparer ? pmCan(access.ctx, "prep") || pmCan(access.ctx, "approve") : pmCan(access.ctx, "approve"))
  const canCertify = open && access.allowed("certificate.certify")
  const reclaimed = c ? certs.some((x) => x.seq > c.seq && x.status !== "void" && (x.cutsIncluded ?? 0) > 0) : false
  const certified = c ? c.status === "appr" || c.status === "part" || c.status === "paid" : false

  return (
    <Sheet open={Boolean(c)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isRtl ? "left" : "right"} dir={isRtl ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {c && (
          <>
            <SheetHeader className="space-y-2 border-b px-4 py-4 text-start sm:px-6">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
                  <Receipt size={20} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-lg font-black leading-relaxed text-primary">
                    {t("ipc.no", { no: certificateNo(c.seq) })}
                    {projectName ? <span dir="auto">{` — ${projectName}`}</span> : null}
                  </SheetTitle>
                  <SheetDescription className="flex flex-wrap items-center gap-2 text-xs">
                    <StatusPill tone={known ? CERT_TONE[c.status] : "bad"}>{known ? t(`ipc.status.${c.status}`) : t("unknown_state")}</StatusPill>
                    {period && <span>{t("money.period", { from: pmDate(period.from, locale), to: pmDate(period.to, locale) })}</span>}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-4 px-4 py-4 sm:px-6">
              <DrawerSection title={<span className="flex items-center gap-1.5"><Calculator size={14} aria-hidden="true" />{t("money.dr.how")}</span>}>
                <div className="rounded-xl border px-3 py-1">
                  <KeyValueRow label={t("money.dr.work")} value={pmMoney(c.gross)} ltr />
                  <KeyValueRow label={t("money.dr.recovery", { rate: pmPct(c.terms?.advance) })} value={`− ${pmMoney(c.recovery)}`} ltr />
                  <KeyValueRow label={t("money.dr.retention", { rate: pmPct(c.terms?.retention) })} value={`− ${pmMoney(c.retention)}`} ltr />
                  <KeyValueRow label={t("money.dr.vat")} value={`+ ${pmMoney(c.vat)}`} ltr />
                  <KeyValueRow label={t("money.dr.net")} value={pmMoney(c.net)} ltr strong />
                </div>
                {(c.voLines?.length ?? 0) > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {c.voLines!.map((v) => (
                      <li key={v.voId} className="flex justify-between gap-2">
                        <span dir="auto">{t("money.dr.vo_line", { no: String(v.seq).padStart(2, "0"), title: v.title })}</span>
                        <span dir="ltr">{pmMoney(v.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </DrawerSection>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">{t("money.dr.due")}</p>
                  <p className="mt-1 font-bold">{pmDate(c.dueOn, locale)}</p>
                  <p className="text-xs">
                    {late > 0 ? (
                      <span className="font-bold text-destructive">{t("money.late", { days: late })}</span>
                    ) : c.dueOn ? (
                      <span className="text-muted-foreground">{t("money.dr.in_days", { days: Math.max(0, daysBetween(today, c.dueOn)) })}</span>
                    ) : (
                      <span className="text-muted-foreground">{t("money.dr.due_after_cert")}</span>
                    )}
                  </p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">{t("money.col.collected")}</p>
                  <p className="mt-1 font-bold tabular-nums" dir="ltr">
                    {pmMoney(collectedAmount(c))}
                  </p>
                  <p className="text-xs text-muted-foreground">{share < 1 ? t("money.dr.outstanding", { amount: pmMoney(c.net * (1 - share)) }) : t("money.dr.in_full")}</p>
                </div>
              </div>

              <DrawerSection title={<span className="flex items-center gap-1.5"><Users size={14} aria-hidden="true" />{t("money.dr.who")}</span>}>
                <KeyValueRow label={t("money.dr.prepared_by")} value={`${c.prepName || "—"} · ${pmDate(c.prepOn, locale)}`} />
                <KeyValueRow
                  label={t("money.dr.approved_by")}
                  value={
                    c.apprName ? (
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        {`${c.apprName} · ${pmDate(c.apprOn, locale)}`}
                        {c.selfApp && <StatusPill tone="warn">{t("money.dr.self_app")}</StatusPill>}
                      </span>
                    ) : (
                      <span className="font-bold text-warning">{t("money.dr.not_yet")}</span>
                    )
                  }
                />
                {(c.checks?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {CERTIFICATE_CHECKS.filter((k) => c.checks?.includes(k)).map((k) => (
                      <span key={k} className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                        <ClipboardCheck size={12} aria-hidden="true" />
                        {t(`money.check.${k}`)}
                      </span>
                    ))}
                  </div>
                )}
                {c.status === "int" && (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {mayApprove ? (
                        <Button size="sm" onClick={() => void act(c, "approve")} disabled={busy !== null}>
                          {busy === "approve" ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Check size={14} className="me-1.5" aria-hidden="true" />}
                          {t("money.dr.approve")}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled>
                          <Lock size={14} className="me-1.5" aria-hidden="true" />
                          {isPreparer ? t("money.dr.you_prepared") : t("money.dr.not_yours")}
                        </Button>
                      )}
                      {mayWithdraw && (
                        <Button size="sm" variant="outline" onClick={() => void act(c, "withdraw")} disabled={busy !== null}>
                          {busy === "withdraw" ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Undo2 size={14} className="me-1.5" aria-hidden="true" />}
                          {t("ipc.withdraw")}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{t("money.dr.two_hands")}</p>
                  </div>
                )}
              </DrawerSection>

              {c.status === "sub" && (
                <DrawerSection title={<span className="flex items-center gap-1.5"><ShieldCheck size={14} aria-hidden="true" />{t("money.dr.consultant")}</span>}>
                  <p className="text-sm">{t("money.dr.submitted_since", { date: pmDate(c.apprOn, locale), days: c.apprOn ? Math.max(0, daysBetween(c.apprOn, today)) : 0 })}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {canCertify ? (
                      <Button size="sm" onClick={() => onCertify(c)}>
                        <BadgeCheck size={14} className="me-1.5" aria-hidden="true" />
                        {t("ipc.certify")}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled>
                        <Lock size={14} className="me-1.5" aria-hidden="true" />
                        {t("money.dr.pm_records")}
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t("money.dr.finance_invoices_certified")}</p>
                </DrawerSection>
              )}

              {certified && (
                <DrawerSection title={<span className="flex items-center gap-1.5"><ShieldCheck size={14} aria-hidden="true" />{t("money.dr.consultant")}</span>}>
                  <KeyValueRow label={t("money.dr.submitted")} value={pmMoney(c.submitted?.gross ?? c.gross)} ltr />
                  <KeyValueRow label={`${t("money.dr.certified")}${c.consultantRef ? ` · ${c.consultantRef}` : ""}`} value={pmMoney(c.certified ?? c.gross)} ltr strong />
                  {(c.cut ?? 0) > 0 && (
                    <>
                      <KeyValueRow
                        label={<span className="font-bold text-destructive">{t("money.dr.cut", { reason: isCutReason(c.cutReason) ? t(`ipc.cut_reasons.${c.cutReason}`) : c.cutReason || "—" })}</span>}
                        value={<span className="font-bold text-destructive">{`− ${pmMoney(c.cut ?? 0)}`}</span>}
                        ltr
                      />
                      <p className="text-xs text-muted-foreground">{reclaimed ? t("money.dr.reclaimed") : t("money.dr.back_to_unbilled")}</p>
                    </>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                    <span>{t("money.dr.finance")}</span>
                    <SourceBadge module="payments" label={c.status === "appr" && !(c.collected ?? 0) ? t("money.dr.fin_pending") : t("money.dr.fin_invoiced")} />
                  </div>
                </DrawerSection>
              )}

              <Callout tone="info">
                <span className="flex items-start gap-1.5">
                  <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {t("money.dr.no_hand_amount")}
                </span>
              </Callout>
              <div className={cn("flex items-start gap-1.5 rounded-xl border border-success/25 bg-success/5 p-3 text-sm")}>
                <Link2 size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                <span>{t("money.dr.finance_owns")}</span>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
