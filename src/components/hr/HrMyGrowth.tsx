"use client"

// My file's growth cards (the prototype's VIEWS.me / x5Me, ES-06, PF-07): «تقييمي» on Home — once approved, his
// band, who reviewed him, his record's score, an approved raise on his basic and the note, then «اطّلعت»; before,
// "not reviewed yet — the cycle closes …" and, for staff while it is open, his self-assessment. «شهاداتي
// وتدريبي» in Documents — a red line when a required certificate is missing or expired (tell his manager; the
// session he is booked on, or none yet), each certificate's expiry and state, his sessions (a paid work day).

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { GraduationCap, Loader2, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useHrGrowth } from "@/hooks/useHrGrowth"
import { useTableLabels } from "@/hooks/useTableLabels"
import { hrDate, hrMoney } from "@/lib/hr/format"
import { approvedRaise, cycleOpen, recordScore, reviewEligible, scoreOf } from "@/lib/hr/performance"
import { acknowledgeReview } from "@/lib/hr/performance-writes"
import { certState, inSession, reqCerts, type CertKey } from "@/lib/hr/training"
import { HrWriteError } from "@/lib/hr/write-guard"
import { CertChip } from "./HrCertChip"
import { SessionLog } from "./HrFileGrowth"
import type { MyFileCtx } from "./HrMyFile"
import { SelfReviewDialog } from "./HrPerfDialogs"
import { BandPill } from "./HrPerformanceView"

export function HrMyGrowth({ ctx, part }: { ctx: MyFileCtx; part: "review" | "certs" }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const labels = useTableLabels()
  const firestore = useFirestore()
  const { toast } = useToast()
  const growth = useHrGrowth(ctx.access)
  const [selfOpen, setSelfOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { emp, today } = ctx
  const manager = ctx.lineManager?.name ?? null

  if (part === "certs") {
    if (!growth.train) return null
    const req = reqCerts(emp, ctx.site?.type ?? null)
    const mine = growth.sessions.filter((s) => s.ppl.includes(emp.id))
    if (!req.length && !mine.length) return null
    const bad = req.filter((k) => ["missing", "expired"].includes(certState(emp.certs, k, today)))
    const booked = bad.map((k) => inSession(growth.sessions, emp.id, k)).find(Boolean) ?? null
    const cols: DataColumn<CertKey>[] = [
      { key: "cert", header: t("train.col.cert"), cell: (k) => <span className="font-semibold">{t(`train.cert.${k}`)}</span> },
      { key: "exp", header: t("train.col.expires"), cell: (k) => hrDate(emp.certs?.[k] ?? null, locale) },
      { key: "state", header: t("train.col.state"), cell: (k) => <CertChip k={k} state={certState(emp.certs, k, today, ctx.access.settings.policies.renewWindowDays)} expiry={emp.certs?.[k]} /> },
    ]
    const place = (s: (typeof mine)[number]) => (s.siteId ? (ctx.siteName(s.siteId) ?? "—") : t(`train.provider.${s.course}` as "train.provider.ind"))
    return (
      <Panel title={t("train.my_title")} icon={GraduationCap}>
        {bad.length > 0 && (
          <Callout tone="block" title={t("train.my_bad")} className="mb-3">
            {t("train.my_tell", { name: manager ?? t("train.my_supervisor") })} {booked ? t("train.my_booked", { date: hrDate(booked.at, locale) }) : t("train.my_not_booked")}
          </Callout>
        )}
        {req.length > 0 && <DataTable columns={cols} rows={req} rowKey={(k) => k} caption={t("train.my_title")} labels={labels} empty={null} bordered={false} dense />}
        {mine.length > 0 && <SessionLog sessions={mine} employeeId={emp.id} place={place} />}
      </Panel>
    )
  }

  const cycle = growth.cycle
  if (!growth.perf || !cycle || !reviewEligible(emp, cycle.open)) return null
  const r = growth.mine
  const weight = ctx.access.settings.policies.recordWeight
  const s = r ? scoreOf(r, weight) : null
  const raise = cycle.raise?.state === "ok" ? approvedRaise(ctx.pay, cycle.raise.eff) : null
  const mayself = emp.category === "staff" && cycleOpen(cycle, today) && !r && !growth.myself

  const ack = async () => {
    if (!firestore || !r) return
    setBusy(true)
    try {
      await acknowledgeReview(firestore, ctx.access.ctx, r)
      toast({ title: t("perf.acked") })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t("perf.my_title")} icon={Star}>
      <p className="mb-2 text-xs text-muted-foreground">{t("perf.cycle_name", { year: cycle.year })}</p>
      {r && s ? (
        <>
          <KeyValueRow label={t("perf.result")} value={<BandPill band={s.band} score={s.score} />} />
          <KeyValueRow label={t("perf.reviewed_by")} value={r.raterName ?? r.rated?.byName ?? t("perf.management")} />
          {r.rec && <KeyValueRow label={t("perf.my_record")} value={<span>{`${recordScore(r.rec)}/5`} <span className="text-xs text-muted-foreground">{t("perf.rec_short", { abs: r.rec.abs, pen: r.rec.pen })}</span></span>} />}
          {raise && raise.from != null && <KeyValueRow label={t("perf.raise_on_file")} value={t("perf.my_raise", { amount: hrMoney(raise.to - raise.from), date: hrDate(raise.on, locale) })} />}
          {r.note && (
            <Callout tone="info" className="mt-2">
              {r.note}
            </Callout>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {r.st === "ok" ? (
              <Button size="sm" onClick={() => void ack()} disabled={busy}>
                {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
                {t("perf.ack")}
              </Button>
            ) : (
              <StatusPill tone="ok">{t("perf.acked_on", { date: hrDate(r.ackAt?.slice(0, 10) ?? null, locale) })}</StatusPill>
            )}
            <span className="text-xs text-muted-foreground">{t("perf.discuss")}</span>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">{manager ? t("perf.my_not_yet", { name: manager, date: hrDate(cycle.close, locale) }) : t("perf.my_not_yet_anon", { date: hrDate(cycle.close, locale) })}</p>
          {mayself && (
            <Button size="sm" onClick={() => setSelfOpen(true)}>
              {t("perf.self_send")}
            </Button>
          )}
          {growth.myself && <StatusPill tone="info">{t("perf.self_done")}</StatusPill>}
        </div>
      )}
      {selfOpen && <SelfReviewDialog access={ctx.access} actor={ctx.actor} emp={emp} cycle={cycle} onClose={() => setSelfOpen(false)} />}
    </Panel>
  )
}
