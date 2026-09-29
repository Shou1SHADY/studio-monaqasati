"use client"

// A PM 1.0 project's Pulse (the prototype's first tab): a note when there is
// no BOQ or no item has a rate, what needs a decision (five, then "show more"),
// the money trail; and beside them the delivery units, the divisions furthest from their plan, what
// we are waiting on from other modules (no button — the act is theirs) and the
// project log.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Callout } from "@/components/module-ui/Callout"
import { PmTodayPanel } from "@/components/pm/PmTodayPanel"
import { PulseMoneyTrail, type TrailProject } from "@/components/pm/PulseMoneyTrail"
import { WaitingOnOthers } from "@/components/pm/WaitingOnOthers"
import { ProjectLogPanel, SectionsBehindPanel } from "@/components/pm/PulseExtras"
import { UnitsPulsePanel } from "@/components/pm/UnitsPulsePanel"
import type { PmAccess } from "@/hooks/usePmAccess"
import type { PmDecisionProject } from "@/hooks/usePmDecisions"
import type { DecisionKind, DecisionTab } from "@/lib/pm/decisions"
import { boqNote } from "@/lib/pm/pulse"

export type PulseProject = PmDecisionProject & TrailProject & { name?: string; location?: string; warehouseId?: string | null; pm?: (PmDecisionProject["pm"] & { retentionReleased?: boolean; cutPool?: number }) | null }

export function ProjectPulse({
  projectId,
  organizationId,
  project,
  items,
  access,
  onOpen,
  sections,
  programmeOn,
}: {
  projectId: string
  organizationId: string
  project: PulseProject
  items: Array<{ id?: string; division?: string; quantity: number; rate: number; executed: number }>
  access: PmAccess
  onOpen: (tab: DecisionTab, kind?: DecisionKind) => void
  /** The project's switched-on sections; the trail needs billing or cost. */
  sections?: readonly string[]
  /** The Programme tab is in the rail (its section is on and the terms exist): the button opens it. */
  programmeOn?: boolean
}) {
  const t = useTranslations("Portal.PM")
  const money = access.has("money")
  const note = boqNote(items.length, items.filter((i) => !(i.rate > 0)).length)
  const has = (s: string) => !sections || sections.includes(s)
  const trailProject = useMemo(() => ({ ...project, organizationId }), [project, organizationId])
  const open = (tab: string) => onOpen(tab as DecisionTab)

  return (
    <div className="space-y-4">
      {note === "all_unpriced" && (
        <Callout tone="warn" title={t("pulse.note_unpriced_title", { count: items.length })}>
          {t("pulse.note_unpriced_body")}
        </Callout>
      )}
      {note === "no_boq" && (
        <Callout tone="warn" title={t("pulse.note_no_boq_title")}>
          {t("pulse.note_no_boq_body")}
        </Callout>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <PmTodayPanel projectId={projectId} project={project} access={access} onOpen={onOpen} />
          <PulseMoneyTrail projectId={projectId} project={trailProject} access={access} ipcOn={has("ipc")} costOn={has("cost")} />
        </div>
        <div className="space-y-4">
          {has("zone") && sections && <UnitsPulsePanel projectId={projectId} items={items} startedOn={project.pm?.startedAt ?? null} onDetails={() => open("pmUnits")} />}
          <SectionsBehindPanel projectId={projectId} project={project} items={items} onProgramme={programmeOn ? () => open("pmProgramme") : undefined} />
          <WaitingOnOthers
            organizationId={organizationId}
            projects={[{ id: projectId, name: project.name, retentionReleased: project.pm?.retentionReleased }]}
            finance={access.has("client")}
            money={money}
            onOpenTab={open}
          />
          <ProjectLogPanel projectId={projectId} project={trailProject} money={money} seesTerms={money || access.has("approve")} />
        </div>
      </div>
    </div>
  )
}
