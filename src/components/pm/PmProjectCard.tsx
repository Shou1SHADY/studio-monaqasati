"use client"

// One project in the portfolio (the PM 1.0 prototype's pcard): name, number,
// client and region, its state; a postponed project says since when and why; a
// project with no BOQ says it can be neither measured nor billed; otherwise
// progress against the plan. For holders of money: contract value (unpriced /
// estimated), unbilled and the cash position. Pills: urgent decisions, open
// obstacles, overdue collection, and — once technically complete — whether it
// is ready to archive. A project made before PM 1.0 shows what it has.

import { useEffect } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Building2, Lock, Pause, Zap } from "lucide-react"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import type { PortfolioFeed, PortfolioProject } from "@/hooks/usePortfolioFeed"
import { usePortfolioFeed } from "@/hooks/usePortfolioFeed"
import { Link } from "@/i18n/routing"
import { pmMoney, todayDay } from "@/lib/pm/format"
import { lifecycleOf, type PmLifecycle } from "@/lib/pm/lifecycle"
import { displayDocNumber } from "@/lib/sales-numbering"
import { cn } from "@/lib/utils"

export const LIFECYCLE_TONE: Record<PmLifecycle, PillTone> = { plan: "mute", live: "info", hold: "warn", done: "module", closed: "mute" }

const dayNum = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86_400_000

export function projectHref(p: { id: string; pm?: unknown }) {
  return `/contractor/projects/${p.id}${p.pm ? "?tab=pmToday" : ""}`
}

export function ProgressLine({ feed }: { feed: PortfolioFeed }) {
  const t = useTranslations("Portal.PM")
  const pr = feed.progress ?? 0
  const late = feed.planned !== null && feed.behind > 4
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", late ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, Math.max(0, pr))}%` }} />
        </div>
        <span className="text-sm font-black tabular-nums" dir="ltr">
          {feed.progress === null ? "—" : `${Math.round(pr)}%`}
        </span>
      </div>
      {feed.planned !== null && feed.planned > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("list.plan_line", { planned: Math.round(feed.planned), state: feed.behind > 0 ? "behind" : "ahead", count: Math.abs(Math.round(feed.behind)) })}
        </p>
      )}
    </div>
  )
}

export function PmProjectCard({ project, onFeed }: { project: PortfolioProject; onFeed?: (id: string, feed: PortfolioFeed) => void }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const feed = usePortfolioFeed(project)
  const lifecycle = lifecycleOf(project as { pm?: { lifecycle?: string }; status?: string })
  const noBoq = feed.itemCount === 0
  const holdDays = lifecycle === "hold" && project.pm?.holdSince ? Math.max(0, Math.round(dayNum(todayDay()) - dayNum(project.pm.holdSince))) : null
  const value = project.budget ?? 0

  useEffect(() => {
    if (onFeed) onFeed(project.id, feed)
  }, [onFeed, project.id, feed])

  return (
    <Link
      href={projectHref(project)}
      className="flex h-full flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
          <Building2 size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-black leading-snug text-foreground" dir="auto">
            {project.name || "—"}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
            {[project.pm?.no ? displayDocNumber(project.pm.no, locale) : null, project.clientName, project.region || project.location].filter(Boolean).join(" · ")}
          </p>
        </div>
        <StatusPill tone={LIFECYCLE_TONE[lifecycle]}>{t(`lifecycle.${lifecycle}`)}</StatusPill>
      </div>

      {lifecycle === "hold" && (holdDays !== null || project.pm?.holdWhy) && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs">
          <Pause size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <span>
            {holdDays !== null && <b>{t("list.hold_since", { count: holdDays })}</b>}
            {project.pm?.holdWhy && <span dir="auto"> — {project.pm.holdWhy}</span>}
          </span>
        </p>
      )}

      {noBoq ? (
        <p className="flex items-start gap-2 rounded-lg border border-cta/20 bg-cta/5 px-3 py-2 text-xs">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-cta" aria-hidden="true" />
          {t("list.no_boq")}
        </p>
      ) : (
        <ProgressLine feed={feed} />
      )}

      {feed.money && (
        <dl className="grid grid-cols-3 gap-2 border-t pt-3 text-xs">
          <div>
            <dt className="text-muted-foreground">{t("list.contract_value")}</dt>
            <dd className="font-black tabular-nums text-foreground" dir="ltr">
              {value > 0 ? pmMoney(value) : t("list.unpriced")}
            </dd>
            {value > 0 && noBoq && <dd className="text-[10px] text-muted-foreground">{t("list.estimated")}</dd>}
          </div>
          <div>
            <dt className="text-muted-foreground">{t("list.unbilled")}</dt>
            <dd className={cn("font-black tabular-nums", feed.unbilled > 50_000 ? "text-destructive" : "text-foreground")} dir="ltr">
              {noBoq ? "—" : pmMoney(feed.unbilled)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("list.cash")}</dt>
            <dd className={cn("font-black tabular-nums", noBoq ? "text-foreground" : feed.cash < 0 ? "text-destructive" : "text-success")} dir="ltr">
              {noBoq ? "—" : pmMoney(feed.cash)}
            </dd>
          </div>
        </dl>
      )}

      {(feed.red > 0 || feed.obstacles > 0 || (feed.overdue > 0 && feed.money) || feed.archivable !== null) && (
        <p className="mt-auto flex flex-wrap gap-1.5">
          {feed.red > 0 && (
            <StatusPill tone="bad">
              <Zap size={11} aria-hidden="true" />
              {t("list.urgent", { count: feed.red })}
            </StatusPill>
          )}
          {feed.obstacles > 0 && <StatusPill tone="warn">{t("list.obstacles", { count: feed.obstacles })}</StatusPill>}
          {feed.overdue > 0 && feed.money && (
            <StatusPill tone="bad">
              {t("list.overdue")} <span dir="ltr">{pmMoney(feed.overdue)}</span>
            </StatusPill>
          )}
          {feed.archivable === true && <StatusPill tone="ok">{t("list.ready_archive")}</StatusPill>}
          {feed.archivable === false && (
            <StatusPill tone="warn">
              <Lock size={11} aria-hidden="true" />
              {t("list.not_archivable")}
            </StatusPill>
          )}
        </p>
      )}
    </Link>
  )
}
