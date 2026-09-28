"use client"

// A PM 1.0 project's head (the prototype's project view): the crumb, the name
// with its state — and «تحصيل متأخر» when a certified amount is past due —
// one line of facts ending in the day count (or the planned start), the two
// actions a project manager takes most, and three numbers that change with who
// is looking: the site sees progress, obstacles and shortages; money without
// the client side sees progress, what is committed and shortages; the client
// side sees progress, unbilled work and the cash position. Each money tile
// opens the list behind it.

import type { ReactNode } from "react"
import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, Banknote, Check, ChevronRight, Clock, FolderKanban, Hand, Lock, Package, Pause, Play, Receipt, Ruler, TrendingUp, Wallet, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useProjectFigures } from "@/hooks/useProjectFigures"
import { usePulseCost } from "@/hooks/usePulseCost"
import { useSupplyWorld } from "@/hooks/useSupplyWorld"
import { Link } from "@/i18n/routing"
import { grantedDays, PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { lifecycleOf, type PmLifecycle } from "@/lib/pm/lifecycle"
import { PREPARE_OFFER_AT, progressNote, progressTone, projectDays, UNBILLED_ALARM } from "@/lib/pm/pulse"
import { isOpenObstacle, PM_OBSTACLES, type PmObstacle } from "@/lib/pm/site"
import { needsWithin, reqState } from "@/lib/pm/supply"
import { displayDocNumber } from "@/lib/procurement/format"
import { cn } from "@/lib/utils"

export interface PmHeadProject {
  name?: string
  clientName?: string
  location?: string
  region?: string
  budget?: number
  status?: string | null
  warehouseId?: string | null
  organizationId?: string
  projectManagerId?: string | null
  pm?: { no?: string; lifecycle?: string; startOn?: string | null; startedAt?: string | null; durationDays?: number } | null
}

const STATE: Record<PmLifecycle, { tone: PillTone; icon: LucideIcon }> = {
  plan: { tone: "mute", icon: Clock },
  live: { tone: "info", icon: Play },
  hold: { tone: "warn", icon: Pause },
  done: { tone: "module", icon: Check },
  closed: { tone: "mute", icon: Lock },
}

type Tone = "bad" | "warn" | "good" | "neutral"
const TONE: Record<Tone, string> = { bad: "bg-destructive/10 text-destructive", warn: "bg-warning/10 text-warning", good: "bg-success/10 text-success", neutral: "bg-muted text-muted-foreground" }

interface Tile {
  id: string
  icon: LucideIcon
  label: string
  value: string
  note: string
  tone: Tone
  tab?: string
}

export function ProjectHead({
  projectId,
  project,
  access,
  ipcOn,
  onOpen,
  actions,
}: {
  projectId: string
  project: PmHeadProject
  access: PmAccess
  /** The project bills its client (the ipc section is on). */
  ipcOn: boolean
  onOpen: (tab: string) => void
  /** The page's own buttons (sections, edit, delete) after the PM actions. */
  actions?: ReactNode
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const money = access.has("money")
  const client = access.has("client")
  const fig = useProjectFigures(projectId, project, access)
  const pm = project.pm ?? {}
  const lifecycle = lifecycleOf(project)
  const today = todayDay()

  const claimQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_CLAIMS) : null), [firestore, projectId])
  const { data: claimData } = useCollection(claimQ)
  const obsQ = useMemoFirebase(() => (firestore && !money ? collection(firestore, "projects", projectId, PM_OBSTACLES) : null), [firestore, projectId, money])
  const { data: obsData } = useCollection(obsQ)
  const supply = useSupplyWorld(projectId, project.organizationId)
  const cost = usePulseCost(projectId, project.organizationId, project.warehouseId, project.budget ?? 0, money && !client)
  const itemQ = useMemoFirebase(() => (firestore && !(money && client) ? collection(firestore, "projects", projectId, "boqItems") : null), [firestore, projectId, money, client])
  const { data: itemData } = useCollection(itemQ)

  const days = projectDays(pm.startedAt ?? null, (pm.durationDays ?? 0) + grantedDays((claimData ?? []) as unknown as PmClaim[]), today)
  const openObstacles = ((obsData ?? []) as unknown as PmObstacle[]).filter(isOpenObstacle).length
  const shortages = useMemo(() => {
    if (money && client) return 0
    const items = ((itemData ?? []) as Array<Record<string, unknown> & { id: string }>).map((d) => ({
      id: d.id,
      code: String(d.itemNo ?? ""),
      description: "",
      unit: String(d.unit ?? ""),
      quantity: Number(d.quantity) || 0,
      executed: Number(d.executedQuantity) || 0,
    }))
    return needsWithin({ stores: supply.stores, items, requests: supply.requests, activities: supply.activities, startOn: pm.startedAt ?? null, today }).gaps.length
  }, [money, client, itemData, supply.stores, supply.requests, supply.activities, pm.startedAt, today])
  const pendingRequests = supply.requests.filter((r) => reqState(r) === "wait").length

  const note = progressNote({ itemCount: fig.itemCount, unpricedCount: fig.unpricedCount, planned: fig.planned, progress: fig.progress })
  const progressValue = `${Math.round(fig.progress ?? 0)}%`
  const planText = t("head.kpi_plan", { planned: Math.round(fig.planned ?? 0) })
  const tiles: Tile[] = []
  if (!money) {
    tiles.push(
      { id: "progress", icon: TrendingUp, label: t("pulse.kpi_progress"), value: progressValue, note: planText, tone: (fig.progress ?? 0) < (fig.planned ?? 0) - 4 ? "bad" : "good" },
      { id: "obstacles", icon: AlertTriangle, label: t("head.kpi_obstacles"), value: String(openObstacles), note: t("head.kpi_obstacles_note"), tone: openObstacles ? "warn" : "good" },
      { id: "short", icon: Package, label: t("head.kpi_short"), value: String(shortages), note: t("head.kpi_short_note"), tone: "neutral" }
    )
  } else if (!client) {
    const budget = cost?.estimated ? cost.total.budget : null
    tiles.push(
      { id: "progress", icon: TrendingUp, label: t("pulse.kpi_progress"), value: progressValue, note: planText, tone: "neutral" },
      {
        id: "committed",
        icon: Hand,
        label: t("head.kpi_committed"),
        value: pmMoney(cost?.total.committed ?? 0),
        note: budget !== null ? t("head.kpi_committed_of", { budget: pmMoney(budget) }) : t("head.kpi_committed_note"),
        tone: "neutral",
      },
      { id: "short", icon: Package, label: t("head.kpi_short"), value: String(shortages), note: t("head.kpi_short_pending", { count: pendingRequests }), tone: "neutral" }
    )
  } else {
    tiles.push(
      {
        id: "progress",
        icon: TrendingUp,
        label: t("pulse.kpi_progress"),
        value: progressValue,
        note:
          note.kind === "plan"
            ? t(note.dv < 0 ? "head.kpi_plan_behind" : "head.kpi_plan_ahead", { planned: Math.round(note.planned), count: Math.abs(note.dv) })
            : t(`head.kpi_progress_${note.kind}`),
        tone: progressTone(note),
        tab: "pmToday",
      },
      { id: "unbilled", icon: Banknote, label: t("pulse.kpi_unbilled"), value: pmMoney(fig.unbilled), note: t("pulse.kpi_unbilled_note"), tone: fig.unbilled > UNBILLED_ALARM ? "bad" : "good", tab: "ipc" },
      { id: "cash", icon: Wallet, label: t("pulse.kpi_cash"), value: pmMoney(fig.cash), note: t("head.kpi_cash_note", { in: pmMoney(fig.cashIn), out: pmMoney(fig.cashOut) }), tone: fig.cash < 0 ? "bad" : "good", tab: "ipc" }
    )
  }

  const no = pm.no ? displayDocNumber(String(pm.no), locale) : null
  const facts = [no, project.clientName, project.region || project.location].filter(Boolean).join(" · ")
  const when =
    lifecycle === "plan"
      ? pm.startOn
        ? t("head.starts", { date: pmDate(pm.startOn, locale) })
        : null
      : days
        ? t("head.day_of", { el: days.el, tot: days.tot })
        : null
  const State = STATE[lifecycle]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label={t("head.crumbs")} className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link href="/contractor/projects" className="rounded font-semibold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("head.crumb_projects")}
            </Link>
            <ChevronRight size={12} className="rtl-flip" aria-hidden="true" />
            <span dir="ltr">{no ?? project.name}</span>
          </nav>
          <h1 className="flex flex-wrap items-center gap-2 font-headline text-2xl font-black leading-snug text-foreground">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-module/10 text-module" aria-hidden="true">
              <FolderKanban size={18} />
            </span>
            <span className="min-w-0 truncate" dir="auto">
              {project.name}
            </span>
            <StatusPill tone={State.tone}>
              <State.icon size={12} aria-hidden="true" />
              {t(`lifecycle.${lifecycle}`)}
            </StatusPill>
            {money && fig.overdue > 0 && (
              <StatusPill tone="bad">
                <Wallet size={12} aria-hidden="true" />
                {t("head.overdue")}
              </StatusPill>
            )}
          </h1>
          {(facts || when) && (
            <p className="mt-1 text-sm text-muted-foreground" dir="auto">
              {facts}
              {facts && when ? " — " : ""}
              {when}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {access.allowed("measurement.write") && (
            <Button variant="outline" size="sm" onClick={() => onOpen("pmMeasure")} className="gap-1.5 rounded-xl border border-border bg-card text-foreground shadow-none hover:border-module/40 hover:bg-card">
              <Ruler size={14} aria-hidden="true" />
              {t("pulse.act_measure")}
            </Button>
          )}
          {ipcOn && access.allowed("certificate.prepare") && fig.unbilled > PREPARE_OFFER_AT && (
            <Button size="sm" onClick={() => onOpen("ipc")} className="gap-1.5 rounded-xl bg-module text-module-foreground hover:bg-module/90">
              <Receipt size={14} aria-hidden="true" />
              {t("head.prepare_ipc")}
            </Button>
          )}
          {actions}
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3" aria-label={t("pulse.kpis")}>
        {tiles.map((k) => {
          const body = (
            <>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <k.icon size={14} className="text-module" aria-hidden="true" />
                {k.label}
              </span>
              <span className="mt-2 block truncate text-2xl font-black tabular-nums text-foreground" dir="ltr">
                {k.value}
              </span>
              <span className={cn("mt-2 inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[k.tone])}>{k.note}</span>
            </>
          )
          return (
            <li key={k.id}>
              {k.tab ? (
                <button
                  type="button"
                  onClick={() => onOpen(k.tab as string)}
                  className="block w-full rounded-2xl border bg-card p-4 text-start shadow-sm transition-colors hover:border-module/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-5"
                >
                  {body}
                </button>
              ) : (
                <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
