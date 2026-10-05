"use client"

// The employee file's growth cards (the prototype's openEmp cards, ES-06): «الشهادات والتدريب» in Documents —
// each required certificate, why it is required (anyone on a site, a trade on a project, the trade itself), its
// expiry and state, and his sessions (passed · absent · scheduled); «الأداء» in the overview — the cycle's state
// (the band to the office and his rater), the record's score, an approved raise (money roles) and an improvement
// plan. Each card only with its feature on (or a review on record).

import { useLocale, useTranslations } from "next-intl"
import { GraduationCap, Star } from "lucide-react"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useHrGrowth } from "@/hooks/useHrGrowth"
import { useTableLabels } from "@/hooks/useTableLabels"
import { hrDate, hrMoney } from "@/lib/hr/format"
import { approvedRaise, recordFacts, recordScore, reviewEligible, scoreOf } from "@/lib/hr/performance"
import { certState, certWhy, reqCerts, type CertKey, type TrainingSession } from "@/lib/hr/training"
import { CertChip } from "./HrCertChip"
import { BandPill } from "./HrPerformanceView"
import type { FileView } from "./hr-file-view"

export function HrFileGrowth({ v, part }: { v: FileView; part: "perf" | "certs" }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const labels = useTableLabels()
  const growth = useHrGrowth(v.access)
  const { emp, today } = v

  if (part === "certs") {
    if (!growth.train) return null
    const req = reqCerts(emp, v.site?.type ?? null)
    if (!req.length && !Object.keys(emp.certs ?? {}).length) return null
    const sessions = growth.sessions.filter((s) => s.ppl.includes(emp.id))
    const cols: DataColumn<CertKey>[] = [
      { key: "cert", header: t("train.col.cert"), cell: (k) => <span className="font-semibold">{t(`train.cert.${k}`)}</span> },
      { key: "why", header: t("train.col.why"), cell: (k) => t(`train.why.${certWhy(k)}`, { trade: t(`trade.${emp.trade}` as "trade.mason") }), hideBelow: "lg" },
      { key: "exp", header: t("train.col.expires"), cell: (k) => hrDate(emp.certs?.[k] ?? null, locale) },
      { key: "state", header: t("train.col.state"), cell: (k) => <CertChip k={k} state={certState(emp.certs, k, today, v.access.settings.policies.renewWindowDays)} expiry={emp.certs?.[k]} /> },
    ]
    return (
      <Panel title={t("train.file_title")} icon={GraduationCap} count={req.filter((k) => ["missing", "expired"].includes(certState(emp.certs, k, today))).length || undefined} countTone="bad">
        <DataTable columns={cols} rows={req} rowKey={(k) => k} caption={t("train.file_title")} labels={labels} empty={<p className="py-3 text-sm text-muted-foreground">{t("train.none_required")}</p>} bordered={false} dense />
        {sessions.length > 0 && <SessionLog sessions={sessions} employeeId={emp.id} />}
      </Panel>
    )
  }

  if (!growth.perf || !growth.cycle) return null
  const cycle = growth.cycle
  const review = growth.reviews.find((r) => r.employeeId === emp.id) ?? null
  const weight = v.access.settings.policies.recordWeight
  const office = v.access.ctx.owner || v.access.ctx.roles.has("manager") || v.access.ctx.roles.has("management")
  const sees = Boolean(review && (office || review.raterUserId === v.access.ctx.uid))
  const score = review && sees && review.st !== "draft" ? scoreOf(review, weight) : null
  const rec = review?.rec ?? recordFacts(emp as Parameters<typeof recordFacts>[0], { violations: v.violations, injuries: [], today })
  const raise = v.money && cycle.raise?.state === "ok" ? approvedRaise(v.pay, cycle.raise.eff) : null
  return (
    <Panel title={t("perf.file_title")} icon={Star}>
      <KeyValueRow
        label={t("perf.cycle_name", { year: cycle.year })}
        value={
          !reviewEligible(emp, today) && !review ? (
            t("perf.under_six")
          ) : review ? (
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              {score && <BandPill band={score.band} score={score.score} />}
              <span className="text-xs text-muted-foreground">{t(`perf.st.${review.st}`)}</span>
            </span>
          ) : (
            t("perf.not_reviewed")
          )
        }
      />
      <KeyValueRow label={t("perf.from_record")} value={<span>{`${recordScore(rec)}/5`} <span className="text-xs text-muted-foreground">{t("perf.rec_short", { abs: rec.abs, pen: rec.pen })}</span></span>} />
      {raise && <KeyValueRow label={t("perf.raise_on_file")} value={`${t("perf.raise_change", { from: raise.from != null ? hrMoney(raise.from) : "—", to: hrMoney(raise.to) })} · ${t("perf.raise_from", { date: hrDate(raise.on, locale) })}`} />}
      {emp.pip && emp.pip.until >= today && <KeyValueRow label={t("perf.pip")} value={<StatusPill tone="warn">{t("perf.pip_until", { date: hrDate(emp.pip.until, locale) })}</StatusPill>} />}
      {review?.note && sees && <p className="mt-2 text-xs text-muted-foreground">{review.note}</p>}
    </Panel>
  )
}

/** His sessions: date · course · passed / absent / scheduled. */
export function SessionLog({ sessions, employeeId, place }: { sessions: TrainingSession[]; employeeId: string; place?: (s: TrainingSession) => string }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  return (
    <ul className="mt-3 divide-y border-t text-sm">
      {sessions.map((s) => {
        const st = s.state === "done" ? ((s.abs ?? []).includes(employeeId) ? "absent" : "passed") : "scheduled"
        return (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block font-semibold">{t(`train.course.${s.course}` as "train.course.ind")}</span>
              <span className="block text-xs text-muted-foreground">
                {hrDate(s.at, locale)}
                {place ? ` · ${place(s)}` : ""}
                {st === "scheduled" ? ` · ${t("train.paid_day")}` : ""}
              </span>
            </span>
            <StatusPill tone={st === "passed" ? "ok" : st === "absent" ? "bad" : "info"}>{t(`train.log.${st}`)}</StatusPill>
          </li>
        )
      })}
    </ul>
  )
}
