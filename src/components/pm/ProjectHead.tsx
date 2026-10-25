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
import { AlertTriangle, Banknote, Check, Clock, FolderKanban, Hand, Lock, Package, Pause, Play, Receipt, Ruler, TrendingUp, Wallet, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModuleHeader, type ModuleKpi } from "@/components/module-ui/ModuleHeader"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useProjectFigures } from "@/hooks/useProjectFigures"
import { usePulseCost } from "@/hooks/usePulseCost"
import { useSupplyWorld } from "@/hooks/useSupplyWorld"
import { grantedDays, PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { lifecycleOf, type PmLifecycle } from "@/lib/pm/lifecycle"
import { PREPARE_OFFER_AT, progressNote, progressTone, projectDays, UNBILLED_ALARM } from "@/lib/pm/pulse"
import { isOpenObstacle, PM_OBSTACLES, type PmObstacle } from "@/lib/pm/site"
import { needsWithin, reqState } from "@/lib/pm/supply"
import { displayDocNumber } from "@/lib/procurement/format"
import { SAR_SIGN } from "@/lib/riyal"

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

/** A tile's amount: the figure, and the riyal sign as its unit (ModuleKpi draws it left of the figure, above it on a phone). */
export const moneyTile = (n: number): { value: string; unit: string } => ({ value: Math.round(n).toLocaleString("en-US"), unit: SAR_SIGN })

interface Tile {
  id: string
  icon: LucideIcon
  label: string
  value: string
  /** An amount's sign, set apart so a phone puts it above the figure and never cuts the figure. */
  unit?: string
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
  onWork,
  actions,
}: {
  projectId: string
  project: PmHeadProject
  access: PmAccess
  /** The project bills its client (the ipc section is on). */
  ipcOn: boolean
  onOpen: (tab: string) => void
  /** The head's two acts open the work itself — the measurement writer, the IPC form — not just their tab. */
  onWork?: (what: "measure" | "prepare") => void
  /** After the two acts: the secondary ones, behind a «…» menu (Postpone — `PmHoldControl trigger="menu"`), or Resume. */
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
        ...moneyTile(cost?.total.committed ?? 0),
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
      { id: "unbilled", icon: Banknote, label: t("pulse.kpi_unbilled"), ...moneyTile(fig.unbilled), note: t("pulse.kpi_unbilled_note"), tone: fig.unbilled > UNBILLED_ALARM ? "bad" : "good", tab: "ipc" },
      { id: "cash", icon: Wallet, label: t("pulse.kpi_cash"), ...moneyTile(fig.cash), note: t("head.kpi_cash_note", { in: pmMoney(fig.cashIn), out: pmMoney(fig.cashOut) }), tone: fig.cash < 0 ? "bad" : "good", tab: "ipc" }
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
  const measureAct = access.allowed("measurement.write")
  const prepareAct = ipcOn && access.allowed("certificate.prepare") && fig.unbilled > PREPARE_OFFER_AT

  const kpis: ModuleKpi[] = tiles.map((k) => ({
    id: k.id,
    label: k.label,
    value: k.value,
    unit: k.unit,
    note: k.note,
    tone: k.tone,
    icon: k.icon,
    onClick: k.tab ? () => onOpen(k.tab as string) : undefined,
  }))

  // The prototype's project head, in the module head every Mdmak module shows (PM 1.1 UX-02…05): ONE crumb row (the
  // portal's bar steps aside on this page), the icon beside — not inside — the name, which wraps instead of being cut,
  // the two acts that wrap under the title on a phone, the secondary ones behind «…» (`actions`), and the three numbers
  // three across, compact, on a phone too.
  return (
    <ModuleHeader
      icon={FolderKanban}
      crumbs={[{ label: t("head.crumb_projects"), href: "/contractor/projects" }, { label: no ?? project.name ?? "" }]}
      crumbsLabel={t("head.crumbs")}
      title={
        <span className="break-words" dir="auto">
          {project.name}
        </span>
      }
      status={
        <>
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
        </>
      }
      description={
        facts || when ? (
          <span dir="auto">
            {facts}
            {facts && when ? " — " : ""}
            {when}
          </span>
        ) : undefined
      }
      actions={
        measureAct || prepareAct || actions ? (
          <>
            {measureAct && (
              <Button variant="outline" size="sm" onClick={() => (onWork ? onWork("measure") : onOpen("pmMeasure"))} className="gap-1.5 rounded-xl border border-border bg-card text-foreground shadow-none hover:border-module/40 hover:bg-card">
                <Ruler size={14} aria-hidden="true" />
                {t("pulse.act_measure")}
              </Button>
            )}
            {prepareAct && (
              <Button size="sm" onClick={() => (onWork ? onWork("prepare") : onOpen("ipc"))} className="gap-1.5 rounded-xl bg-module text-module-foreground hover:bg-module/90">
                <Receipt size={14} aria-hidden="true" />
                {t("head.prepare_ipc")}
              </Button>
            )}
            {actions}
          </>
        ) : undefined
      }
      kpis={kpis}
      kpisLabel={t("pulse.kpis")}
    />
  )
}
