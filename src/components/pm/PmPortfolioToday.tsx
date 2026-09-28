"use client"

// Today across projects (PRD §12, DEC-01, laid out as the PM 1.0 prototype's
// Today): one list of what needs the viewer's decision over every project they
// see — handover files first-class among them — reddest and oldest first,
// filtered by the prototype's four groups in the order the viewer's seat reads
// them; the figures that seat opens with; their projects with progress; and
// what waits on other modules. Each project's facts are read by its own feed
// (the hooks are per project); the feeds report up and this page merges.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Banknote, CalendarCheck2, ClipboardList, Coins, FolderKanban, Hand, TrendingUp, Wallet, Zap } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { ModuleHeader, type ModuleKpi } from "@/components/module-ui/ModuleHeader"
import { Panel } from "@/components/module-ui/Panel"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { DecisionItem } from "@/components/pm/PmTodayPanel"
import { PmSeatChip } from "@/components/pm/PmSeatChip"
import { WaitingOnOthers } from "@/components/pm/WaitingOnOthers"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { usePmAccess } from "@/hooks/usePmAccess"
import { usePmDecisions, type PmDecisionProject } from "@/hooks/usePmDecisions"
import { usePmRail } from "@/hooks/usePmRail"
import { usePmSeat } from "@/hooks/usePmSeat"
import { useProjectFigures } from "@/hooks/useProjectFigures"
import { useProjectPurchaseRequests } from "@/hooks/useProjectPurchaseRequests"
import { Link, useRouter } from "@/i18n/routing"
import { pmSeesProject } from "@/lib/pm/access"
import { DECISION_GROUP, GROUP_ORDER, type DecisionGroup, type PmDecision } from "@/lib/pm/decisions"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { handoverAge, handoverFlags, PM_HANDOVERS, type PmHandover } from "@/lib/pm/handover"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { cn } from "@/lib/utils"

type Row = PmDecisionProject & { id: string; name?: string; pm?: (PmDecisionProject["pm"] & { no?: string }) | null }
type Feed = { visible: boolean; money: boolean; client: boolean; decisions: PmDecision[]; progress: number | null; behind: number; unbilled: number; cash: number; overdue: number }
type Item = { key: string; severity: PmDecision["severity"]; age: number; amount: number; group: DecisionGroup; node: React.ReactNode }

const SEVERITY_RANK = { red: 0, amber: 1, blue: 2 } as const
const CLIP = 7

const signature = (f: Feed) =>
  `${f.visible}|${f.money}|${f.client}|${f.progress}|${f.behind}|${f.unbilled}|${f.cash}|${f.overdue}|${f.decisions.map((d) => `${d.kind}:${d.count ?? ""}:${d.amount ?? ""}:${d.age ?? ""}:${d.severity}`).join(",")}`

/** Reads one project's facts and reports them up; renders nothing. */
function ProjectFeed({ project, onFeed }: { project: Row; onFeed: (id: string, f: Feed) => void }) {
  const access = usePmAccess(project.id, project as { pm?: { lifecycle?: string } | null; status?: string; projectManagerId?: string | null })
  const visible = !access.isLoading && pmSeesProject(access.ctx)
  const { decisions } = usePmDecisions(project.id, visible ? project : null, access)
  const fig = useProjectFigures(project.id, visible ? project : null, access)
  const money = access.has("money")
  const client = access.has("client")
  const overdue = decisions.find((d) => d.kind === "collection_overdue")?.amount ?? 0
  useEffect(() => {
    if (!access.isLoading) onFeed(project.id, { visible, money, client, decisions, progress: fig.progress, behind: fig.behind, unbilled: fig.unbilled, cash: fig.cash, overdue })
  }, [access.isLoading, visible, money, client, decisions, fig.progress, fig.behind, fig.unbilled, fig.cash, overdue, project.id, onFeed])
  return null
}

export function PmPortfolioToday() {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const router = useRouter()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile, isOrgOwner } = usePermissions()
  const seat = usePmSeat()
  const orgId = (profile?.organizationId as string | undefined) || user?.uid || ""
  const today = todayDay()
  const [feeds, setFeeds] = useState<Record<string, Feed>>({})
  const onFeed = useCallback((id: string, f: Feed) => setFeeds((prev) => (prev[id] && signature(prev[id]) === signature(f) ? prev : { ...prev, [id]: f })), [])
  const [group, setGroup] = useState<DecisionGroup | "all">("all")
  const [all, setAll] = useState(false)

  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data, isLoading } = useCollection(q)
  const projects = useMemo(
    () =>
      ((data ?? []) as unknown as Row[])
        .filter((p) => p.pm && lifecycleOf(p as { pm?: { lifecycle?: string }; status?: string }) !== "closed")
        .sort((a, b) => String(a.pm?.no ?? "").localeCompare(String(b.pm?.no ?? ""))),
    [data]
  )
  const mine = useMemo(() => projects.filter((p) => feeds[p.id]?.visible), [projects, feeds])

  // Handover files addressed to the viewer (the owner sees every one): HO-05.
  const hoQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PM_HANDOVERS), where("organizationId", "==", orgId), where("status", "==", "wait")) : null), [firestore, orgId])
  const { data: hoData } = useCollection(hoQ)
  const handovers = useMemo(() => ((hoData ?? []) as PmHandover[]).filter((h) => isOrgOwner || h.to === user?.uid), [hoData, isOrgOwner, user?.uid])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = handovers.map((h) => {
      const f = handoverFlags(h, today)
      const age = handoverAge(h, today)
      return {
        key: `ho:${h.id}`,
        severity: f.severity,
        age,
        amount: h.value,
        group: "appr" as const,
        node: (
          <DecisionRow
            key={`ho:${h.id}`}
            severity={f.severity}
            icon={Hand}
            title={t("dec.ho.title", { name: h.title, days: age })}
            detail={t("dec.ho.detail", { client: h.clientName || "—", value: h.value ? pmMoney(h.value) : t("dec.ho.no_value"), start: h.startOn ? pmDate(h.startOn, locale) : "—" })}
            age={age ? t("days", { count: age }) : undefined}
            ageDays={age}
            action={
              <Button size="sm" className={cn(f.severity === "red" ? "bg-module text-module-foreground hover:bg-module/90" : "border border-border bg-card text-foreground shadow-none hover:bg-muted")} variant={f.severity === "red" ? "default" : "outline"} onClick={() => router.push("/contractor/projects/inbox")}>
                {t("dec.ho.act")}
              </Button>
            }
          />
        ),
      }
    })
    for (const p of mine) {
      for (const d of feeds[p.id].decisions) {
        out.push({
          key: `${p.id}:${d.kind}`,
          severity: d.severity,
          age: d.age ?? 0,
          amount: d.amount ?? 0,
          group: DECISION_GROUP[d.kind],
          node: <DecisionItem key={`${p.id}:${d.kind}`} d={d} money={feeds[p.id].money} project={p.name || "—"} onOpen={() => router.push(`/contractor/projects/${p.id}?tab=${d.tab}`)} />,
        })
      }
    }
    return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.age - a.age || b.amount - a.amount)
  }, [handovers, mine, feeds, today, t, locale, router])

  const red = items.filter((r) => r.severity === "red").length
  const oldest = items.reduce((a, r) => Math.max(a, r.age), 0)
  const rail = usePmRail(red)
  const inGroup = group === "all" ? items : items.filter((r) => r.group === group)
  const shown = all ? inGroup : inGroup.slice(0, CLIP)

  const money = mine.some((p) => feeds[p.id].money)
  const client = mine.some((p) => feeds[p.id].client)
  const live = mine.filter((p) => lifecycleOf(p as { pm?: { lifecycle?: string }; status?: string }) === "live")
  const withProgress = mine.filter((p) => feeds[p.id].progress !== null)
  const avgProgress = withProgress.length ? Math.round(withProgress.reduce((a, p) => a + (feeds[p.id].progress ?? 0), 0) / withProgress.length) : null
  const liveValue = live.reduce((a, p) => a + (p.budget ?? 0), 0)
  const unbilled = mine.reduce((a, p) => a + feeds[p.id].unbilled, 0)
  const cash = mine.reduce((a, p) => a + feeds[p.id].cash, 0)
  const overdue = mine.reduce((a, p) => a + feeds[p.id].overdue, 0)
  const requests = useProjectPurchaseRequests(orgId || null)
  const pendingRequests = requests.rows.filter((r) => feeds[r.project.id]?.visible).reduce((a, r) => a + r.requests.filter((x) => x.status === "pending").length, 0)

  const kpis: ModuleKpi[] =
    money && client
      ? [
          { id: "value", label: t("dec.kpi_value"), value: pmMoney(liveValue), note: t("dec.kpi_value_note", { count: live.length }), tone: "neutral", icon: Coins },
          { id: "unbilled", label: t("pulse.kpi_unbilled"), value: pmMoney(unbilled), note: t("dec.kpi_unbilled_note"), tone: unbilled > 0 ? "bad" : "good", icon: Banknote },
          { id: "cash", label: t("pulse.kpi_cash"), value: pmMoney(cash), note: cash < 0 ? t("dec.kpi_cash_negative", { overdue: pmMoney(overdue) }) : t("dec.kpi_cash_covered"), tone: cash < 0 ? "bad" : "good", icon: Wallet },
        ]
      : [
          { id: "progress", label: t("dec.kpi_progress"), value: avgProgress === null ? "—" : `${avgProgress}%`, note: t("dec.kpi_progress_note", { count: live.length }), tone: "neutral", icon: TrendingUp },
          { id: "urgent", label: t("dec.kpi_red"), value: String(red), note: oldest ? t("dec.kpi_oldest", { count: oldest }) : t("dec.kpi_none"), tone: red ? "bad" : "good", icon: AlertTriangle },
          { id: "requests", label: t("dec.kpi_requests"), value: String(pendingRequests), note: t("dec.kpi_requests_note"), tone: pendingRequests ? "warn" : "good", icon: ClipboardList },
        ]

  const groupChips = GROUP_ORDER[seat]
    .map((g) => ({ id: g, label: t(`dec.grp.${g}`), count: items.filter((r) => r.group === g).length }))
    .filter((g) => g.count > 0)

  return (
    <div className="space-y-4">
      <ModuleHeader
        icon={CalendarCheck2}
        title={t("dec.portfolio_title")}
        description={t("dec.portfolio_desc", { date: pmDate(today, locale) })}
        status={<PmSeatChip />}
        kpisLabel={t("dec.portfolio_title")}
        kpis={kpis}
        tabs={rail.tabs}
        activeTab="today"
        tabsLabel={t("dec.portfolio_title")}
      />
      {projects.map((p) => (
        <ProjectFeed key={p.id} project={p} onFeed={onFeed} />
      ))}
      {!isLoading && projects.length === 0 && handovers.length === 0 ? (
        <EmptyState icon={CalendarCheck2} title={t("dec.no_projects")} description={t("dec.no_projects_desc")} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Panel title={t("dec.panel_title")} icon={Zap} count={items.length || undefined} bodyClassName="p-0">
            {items.length > 0 && <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("dec.subline", { urgent: red, oldest })}</p>}
            {items.length > 0 && groupChips.length > 1 && (
              <div className="border-b px-4 py-3">
                <ProcChipGroup
                  items={[{ id: "all" as const, label: t("dec.grp.all"), count: items.length }, ...groupChips]}
                  active={group}
                  onPick={(g) => {
                    setGroup(g)
                    setAll(false)
                  }}
                  label={t("dec.panel_title")}
                />
              </div>
            )}
            {items.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={CalendarCheck2} title={t("dec.none_today")} description={t("dec.none_desc")} />
              </div>
            ) : (
              <ul className="divide-y">{shown.map((r) => r.node)}</ul>
            )}
            {inGroup.length > CLIP && (
              <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t py-3 text-sm font-bold text-cta hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                {all ? t("dec.show_less") : t("dec.show_more", { count: inGroup.length - CLIP })}
              </button>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel
              title={t("dec.my_projects")}
              icon={FolderKanban}
              actions={
                <Link href="/contractor/projects" className="rounded text-xs font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t("list.chip_all")}
                </Link>
              }
              bodyClassName="p-0"
            >
              {mine.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("dec.my_projects_empty")}</p>
              ) : (
                <ul className="divide-y">
                  {mine.map((p) => {
                    const f = feeds[p.id]
                    const reds = f.decisions.filter((d) => d.severity === "red").length
                    const life = lifecycleOf(p as { pm?: { lifecycle?: string }; status?: string })
                    return (
                      <li key={p.id}>
                        <Link href={`/contractor/projects/${p.id}?tab=pmToday`} className="block px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-bold text-foreground" dir="auto">{p.name || "—"}</span>
                            {reds > 0 ? (
                              <span className="rounded-full bg-destructive/10 px-2 text-[11px] font-bold tabular-nums text-destructive">{reds}</span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">{t(`lifecycle.${life}`)}</span>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="w-10 text-xs font-bold tabular-nums" dir="ltr">
                              {f.progress === null ? "—" : `${Math.round(f.progress)}%`}
                            </span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className={cn("h-full rounded-full", f.behind > 0 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, Math.max(0, f.progress ?? 0))}%` }} />
                            </div>
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Panel>
            {orgId && <WaitingOnOthers organizationId={orgId} projects={mine.map((p) => ({ id: p.id, name: p.name }))} />}
          </div>
        </div>
      )}
    </div>
  )
}
