"use client"

// Today across projects (PRD §12, DEC-01): each open PM project the viewer sees
// — on its team, or holding `all` — with its computed decisions, reddest first,
// and a door to the tab that solves each one.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, CalendarCheck2, CheckCircle2, FolderOpen } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { ModuleHeader } from "@/components/module-ui/ModuleHeader"
import { Panel } from "@/components/module-ui/Panel"
import { DecisionList } from "@/components/pm/PmTodayPanel"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { usePmAccess } from "@/hooks/usePmAccess"
import { usePmDecisions, type PmDecisionProject } from "@/hooks/usePmDecisions"
import { Link, useRouter } from "@/i18n/routing"
import { pmSeesProject } from "@/lib/pm/access"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { displayDocNumber } from "@/lib/sales-numbering"

type Counts = { red: number; amber: number; visible: boolean }
type Row = PmDecisionProject & { id: string; name?: string; pm?: (PmDecisionProject["pm"] & { no?: string }) | null }

function ProjectDecisions({ project, onCounts }: { project: Row; onCounts: (id: string, c: Counts) => void }) {
  const t = useTranslations("Portal.PM")
  const router = useRouter()
  const access = usePmAccess(project.id, project as { pm?: { lifecycle?: string } | null; status?: string; projectManagerId?: string | null })
  const visible = !access.isLoading && pmSeesProject(access.ctx)
  const { decisions } = usePmDecisions(project.id, visible ? project : null, access)
  const red = decisions.filter((d) => d.severity === "red").length
  const amber = decisions.filter((d) => d.severity === "amber").length
  useEffect(() => {
    if (!access.isLoading) onCounts(project.id, { red, amber, visible })
  }, [access.isLoading, red, amber, visible, project.id, onCounts])
  if (!visible) return null

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          {project.pm?.no && (
            <span dir="ltr" className="text-module">
              {displayDocNumber(project.pm.no, "ar")}
            </span>
          )}
          <span dir="auto">{project.name}</span>
        </span>
      }
      icon={FolderOpen}
      count={decisions.length || undefined}
      actions={
        <Button asChild size="sm" variant="outline">
          <Link href={`/contractor/projects/${project.id}?tab=pmToday`}>{t("dec.open_project")}</Link>
        </Button>
      }
      bodyClassName="p-0"
    >
      {decisions.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <CheckCircle2 size={15} className="text-success" aria-hidden="true" />
          {t("dec.none")}
        </p>
      ) : (
        <DecisionList decisions={decisions} money={access.has("money")} onOpen={(tab) => router.push(`/contractor/projects/${project.id}?tab=${tab}`)} />
      )}
    </Panel>
  )
}

export function PmPortfolioToday() {
  const t = useTranslations("Portal.PM")
  const tShared = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile } = usePermissions()
  const orgId = (profile?.organizationId as string | undefined) || user?.uid
  const [counts, setCounts] = useState<Record<string, Counts>>({})
  const onCounts = useCallback(
    (id: string, c: Counts) => setCounts((prev) => (prev[id]?.red === c.red && prev[id]?.amber === c.amber && prev[id]?.visible === c.visible ? prev : { ...prev, [id]: c })),
    []
  )

  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data, isLoading } = useCollection(q)
  const projects = useMemo(
    () =>
      ((data ?? []) as unknown as Row[])
        .filter((p) => p.pm && lifecycleOf(p as { pm?: { lifecycle?: string }; status?: string }) !== "closed")
        .sort((a, b) => String(a.pm?.no ?? "").localeCompare(String(b.pm?.no ?? ""))),
    [data]
  )
  const shown = Object.values(counts).filter((c) => c.visible)
  const red = shown.reduce((a, c) => a + c.red, 0)
  const amber = shown.reduce((a, c) => a + c.amber, 0)

  return (
    <div className="space-y-4">
      <ModuleHeader
        icon={CalendarCheck2}
        title={t("dec.portfolio_title")}
        description={t("dec.portfolio_desc")}
        crumbs={[{ label: tShared("pm_crumb_projects"), href: "/contractor/projects" }, { label: t("dec.portfolio_title") }]}
        kpisLabel={t("dec.portfolio_title")}
        kpis={[
          { id: "projects", label: t("dec.kpi_projects"), value: String(shown.length), icon: FolderOpen },
          { id: "red", label: t("dec.kpi_red"), value: String(red), tone: red ? "bad" : "neutral", icon: AlertTriangle },
          { id: "amber", label: t("dec.kpi_amber"), value: String(amber), tone: amber ? "warn" : "neutral", icon: AlertTriangle },
        ]}
      />
      {!isLoading && projects.length === 0 ? (
        <EmptyState icon={CalendarCheck2} title={t("dec.no_projects")} description={t("dec.no_projects_desc")} />
      ) : (
        projects.map((p) => <ProjectDecisions key={p.id} project={p} onCounts={onCounts} />)
      )}
    </div>
  )
}
