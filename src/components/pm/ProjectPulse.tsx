"use client"

// A PM 1.0 project's Pulse (the prototype's first tab): what needs a decision,
// the money path — what the contract is worth, what was executed, billed and
// collected against what was committed, invoiced and paid — and what we are
// waiting on from other modules, with no button, because the act is theirs.

import { useTranslations } from "next-intl"
import { Wallet } from "lucide-react"
import { Panel } from "@/components/module-ui/Panel"
import { PmTodayPanel } from "@/components/pm/PmTodayPanel"
import { WaitingOnOthers } from "@/components/pm/WaitingOnOthers"
import type { PmAccess } from "@/hooks/usePmAccess"
import type { PmDecisionProject } from "@/hooks/usePmDecisions"
import { useProjectMoneyFlow } from "@/hooks/useProjectMoneyFlow"
import type { DecisionTab } from "@/lib/pm/decisions"
import { pmMoney } from "@/lib/pm/format"

const r2 = (n: number) => Math.round(n * 100) / 100

export function ProjectPulse({
  projectId,
  organizationId,
  project,
  items,
  access,
  onOpen,
}: {
  projectId: string
  organizationId: string
  project: PmDecisionProject
  items: Array<{ rate: number; executed: number }>
  access: PmAccess
  onOpen: (tab: DecisionTab) => void
}) {
  const t = useTranslations("Portal.PM")
  const money = access.has("money")
  const flow = useProjectMoneyFlow(money ? projectId : null)
  const executed = r2(items.reduce((a, i) => a + (i.rate > 0 ? i.executed * i.rate : 0), 0))

  const path = [
    [
      { label: t("pulse.path_contract"), value: flow.budget ?? 0 },
      { label: t("pulse.path_executed"), value: executed },
      { label: t("pulse.path_billed"), value: flow.claimed || 0 },
      { label: t("pulse.path_collected"), value: flow.collected || 0 },
    ],
    [
      { label: t("pulse.path_committed"), value: flow.committed || 0 },
      { label: t("pulse.path_invoiced"), value: flow.invoiced || 0 },
      { label: t("pulse.path_paid"), value: flow.paid || 0 },
    ],
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <div className="space-y-4">
        <PmTodayPanel projectId={projectId} project={project} access={access} onOpen={onOpen} />
        {money && (
          <Panel title={t("pulse.path_title")} icon={Wallet}>
            <p className="-mt-1 mb-3 text-xs text-muted-foreground">{t("pulse.path_desc")}</p>
            <div className="space-y-3">
              {path.map((row, i) => (
                <ol key={i} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-4">
                  {row.map((cell) => (
                    <li key={cell.label} className="min-w-0">
                      <p className="text-[11px] font-semibold text-muted-foreground">{cell.label}</p>
                      <p className="truncate text-sm font-black tabular-nums text-foreground" dir="ltr">
                        {pmMoney(cell.value)}
                      </p>
                    </li>
                  ))}
                </ol>
              ))}
            </div>
          </Panel>
        )}
      </div>

      <WaitingOnOthers organizationId={organizationId} projects={[{ id: projectId }]} />
    </div>
  )
}
