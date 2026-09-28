"use client"

// Today across projects (PRD §12, DEC-01, laid out as the PM 1.0 prototype's
// Today): one decision list over every open PM project the viewer sees — on its
// team, or holding `all` — reddest first, filtered by group; beside it the
// viewer's projects with their progress, and what waits on other modules.
// Each project's facts are read by its own feed (the hooks are per project);
// the feeds report up and this page merges.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, CalendarCheck2, Coins, FolderKanban, Zap } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { ModuleHeader } from "@/components/module-ui/ModuleHeader"
import { Panel } from "@/components/module-ui/Panel"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { DECISION_ICON } from "@/components/pm/PmTodayPanel"
import { WaitingOnOthers } from "@/components/pm/WaitingOnOthers"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { usePmAccess } from "@/hooks/usePmAccess"
import { usePmDecisions, type PmDecisionProject } from "@/hooks/usePmDecisions"
import { usePmRail } from "@/hooks/usePmRail"
import { Link, useRouter } from "@/i18n/routing"
import { pmSeesProject } from "@/lib/pm/access"
import type { DecisionKind, PmDecision } from "@/lib/pm/decisions"
import { pmMoney } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { cn } from "@/lib/utils"

type Row = PmDecisionProject & { id: string; name?: string; pm?: (PmDecisionProject["pm"] & { no?: string }) | null }
type Feed = { visible: boolean; money: boolean; decisions: PmDecision[]; progress: number | null }

type Group = "team" | "exec" | "contract" | "money" | "close"
const GROUPS: Group[] = ["team", "exec", "contract", "money", "close"]
const GROUP_OF: Record<DecisionKind, Group> = {
  no_pm: "team",
  plan_overdue: "exec",
  sheets_waiting: "exec",
  unpriced_executed: "exec",
  wir_failed: "exec",
  sample_missing: "exec",
  vo_work: "contract",
  vo_waiting: "contract",
  claim_notice_late: "contract",
  claim_waiting: "contract",
  addendum_unsigned: "contract",
  damages: "contract",
  cert_internal: "money",
  cert_consultant: "money",
  collection_overdue: "money",
  provisional_ready: "close",
  final_ready: "close",
}
const SEVERITY_RANK = { red: 0, amber: 1, blue: 2 } as const
const CLIP = 7

const signature = (f: Feed) => `${f.visible}|${f.money}|${f.progress}|${f.decisions.map((d) => `${d.kind}:${d.count ?? ""}:${d.amount ?? ""}:${d.age ?? ""}`).join(",")}`

/** Reads one project's facts and reports them up; renders nothing. */
function ProjectFeed({ project, onFeed }: { project: Row; onFeed: (id: string, f: Feed) => void }) {
  const access = usePmAccess(project.id, project as { pm?: { lifecycle?: string } | null; status?: string; projectManagerId?: string | null })
  const visible = !access.isLoading && pmSeesProject(access.ctx)
  const { decisions, progress } = usePmDecisions(project.id, visible ? project : null, access)
  const money = access.has("money")
  useEffect(() => {
    if (!access.isLoading) onFeed(project.id, { visible, money, decisions, progress })
  }, [access.isLoading, visible, money, decisions, progress, project.id, onFeed])
  return null
}

export function PmPortfolioToday() {
  const t = useTranslations("Portal.PM")
  const router = useRouter()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile, can } = usePermissions()
  const orgId = (profile?.organizationId as string | undefined) || user?.uid || ""
  const [feeds, setFeeds] = useState<Record<string, Feed>>({})
  const onFeed = useCallback((id: string, f: Feed) => setFeeds((prev) => (prev[id] && signature(prev[id]) === signature(f) ? prev : { ...prev, [id]: f })), [])
  const [group, setGroup] = useState<Group | "all">("all")
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
  const rows = useMemo(
    () =>
      mine
        .flatMap((p) => feeds[p.id].decisions.map((d) => ({ project: p, money: feeds[p.id].money, d })))
        .sort((a, b) => SEVERITY_RANK[a.d.severity] - SEVERITY_RANK[b.d.severity] || (b.d.age ?? 0) - (a.d.age ?? 0)),
    [mine, feeds]
  )
  const red = rows.filter((r) => r.d.severity === "red").length
  const oldest = rows.reduce((a, r) => Math.max(a, r.d.age ?? 0), 0)
  const rail = usePmRail(rows.length)
  const inGroup = group === "all" ? rows : rows.filter((r) => GROUP_OF[r.d.kind] === group)
  const shown = all ? inGroup : inGroup.slice(0, CLIP)
  const seesValue = can("projects.edit") || can("invoices.manage")
  const liveValue = mine.reduce((a, p) => a + (p.budget ?? 0), 0)

  return (
    <div className="space-y-4">
      <ModuleHeader
        icon={CalendarCheck2}
        title={t("dec.portfolio_title")}
        description={t("dec.portfolio_desc")}
        kpisLabel={t("dec.portfolio_title")}
        kpis={[
          ...(seesValue ? [{ id: "value", label: t("dec.kpi_value"), value: pmMoney(liveValue), note: t("dec.kpi_value_note", { count: mine.length }), tone: "neutral" as const, icon: Coins }] : [{ id: "projects", label: t("dec.kpi_projects"), value: String(mine.length), icon: FolderKanban }]),
          { id: "red", label: t("dec.kpi_red"), value: String(red), tone: red ? ("bad" as const) : ("neutral" as const), icon: AlertTriangle },
          { id: "all", label: t("dec.kpi_all"), value: String(rows.length), note: oldest ? t("dec.kpi_oldest", { count: oldest }) : undefined, tone: rows.length ? ("warn" as const) : ("good" as const), icon: Zap },
        ]}
        tabs={rail.tabs}
        activeTab="today"
        tabsLabel={t("dec.portfolio_title")}
      />
      {projects.map((p) => (
        <ProjectFeed key={p.id} project={p} onFeed={onFeed} />
      ))}
      {!isLoading && projects.length === 0 ? (
        <EmptyState icon={CalendarCheck2} title={t("dec.no_projects")} description={t("dec.no_projects_desc")} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Panel title={t("dec.title")} icon={Zap} count={rows.length || undefined} bodyClassName="p-0">
            {rows.length > 0 && (
              <div className="border-b px-4 py-3">
                <ProcChipGroup
                  items={[
                    { id: "all" as const, label: t("dec.grp.all"), count: rows.length },
                    ...GROUPS.map((g) => ({ id: g, label: t(`dec.grp.${g}`), count: rows.filter((r) => GROUP_OF[r.d.kind] === g).length })).filter((g) => g.count > 0),
                  ]}
                  active={group}
                  onPick={(g) => {
                    setGroup(g)
                    setAll(false)
                  }}
                  label={t("dec.title")}
                />
              </div>
            )}
            {rows.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={CalendarCheck2} title={t("dec.none")} description={t("dec.none_desc")} />
              </div>
            ) : (
              <ul className="divide-y">
                {shown.map(({ project: p, money, d }) => (
                  <DecisionRow
                    key={`${p.id}-${d.kind}`}
                    severity={d.severity}
                    icon={DECISION_ICON[d.kind]}
                    title={t(`dec.${d.kind}.title`, { count: d.count ?? 0 })}
                    detail={`${p.name || "—"} · ${t(`dec.${d.kind}.detail`, { count: d.count ?? 0 })}`}
                    age={d.age ? t("days", { count: d.age }) : undefined}
                    amount={d.amount && money ? pmMoney(d.amount) : undefined}
                    action={
                      <Button size="sm" className="bg-module text-module-foreground hover:bg-module/90" onClick={() => router.push(`/contractor/projects/${p.id}?tab=${d.tab}`)}>
                        {t("dec.open")}
                      </Button>
                    }
                  />
                ))}
              </ul>
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
              <ul className="divide-y">
                {mine.map((p) => {
                  const f = feeds[p.id]
                  const reds = f.decisions.filter((d) => d.severity === "red").length
                  return (
                    <li key={p.id}>
                      <Link href={`/contractor/projects/${p.id}?tab=pmToday`} className="block px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-bold text-foreground" dir="auto">{p.name || "—"}</span>
                          {f.decisions.length > 0 && (
                            <span className={cn("rounded-full px-2 text-[11px] font-bold tabular-nums", reds ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{f.decisions.length}</span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="w-10 text-xs font-bold tabular-nums" dir="ltr">
                            {f.progress === null ? "—" : `${Math.round(f.progress)}%`}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full", (f.progress ?? 0) >= 100 ? "bg-success" : "bg-warning")} style={{ width: `${Math.min(100, Math.max(0, f.progress ?? 0))}%` }} />
                          </div>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </Panel>
            {orgId && <WaitingOnOthers organizationId={orgId} projects={mine.map((p) => ({ id: p.id, name: p.name }))} />}
          </div>
        </div>
      )}
    </div>
  )
}
