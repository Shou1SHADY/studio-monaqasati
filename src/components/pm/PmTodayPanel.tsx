"use client"

// Today on a PM 1.0 project (PRD §12, DEC-01): every decision its data raises,
// reddest first, each with the tab where it is solved.

import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  Flag,
  Gavel,
  Hammer,
  SearchX,
  TestTube,
  UserX,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmDecisions, type PmDecisionProject } from "@/hooks/usePmDecisions"
import type { DecisionKind, DecisionTab, PmDecision } from "@/lib/pm/decisions"
import { pmMoney } from "@/lib/pm/format"

export const DECISION_ICON: Record<DecisionKind, LucideIcon> = {
  no_pm: UserX,
  plan_overdue: CalendarClock,
  sheets_waiting: ClipboardCheck,
  unpriced_executed: Banknote,
  wir_failed: SearchX,
  sample_missing: TestTube,
  vo_work: Hammer,
  vo_waiting: Hammer,
  claim_notice_late: Gavel,
  claim_waiting: Gavel,
  addendum_unsigned: FileSignature,
  cert_internal: ClipboardCheck,
  cert_consultant: ClipboardCheck,
  collection_overdue: Banknote,
  damages: AlertTriangle,
  provisional_ready: Flag,
  final_ready: Flag,
}

export function DecisionList({ decisions, money, onOpen }: { decisions: PmDecision[]; money: boolean; onOpen: (tab: DecisionTab) => void }) {
  const t = useTranslations("Portal.PM")
  return (
    <ul className="divide-y">
      {decisions.map((d) => (
        <DecisionRow
          key={d.kind}
          severity={d.severity}
          icon={DECISION_ICON[d.kind]}
          title={t(`dec.${d.kind}.title`, { count: d.count ?? 0 })}
          detail={t(`dec.${d.kind}.detail`, { count: d.count ?? 0 })}
          age={d.age ? t("days", { count: d.age }) : undefined}
          amount={d.amount && money ? pmMoney(d.amount) : undefined}
          action={
            <Button size="sm" variant="outline" onClick={() => onOpen(d.tab)}>
              {t("dec.open")}
            </Button>
          }
        />
      ))}
    </ul>
  )
}

export function PmTodayPanel({ projectId, project, access, onOpen }: { projectId: string; project: PmDecisionProject; access: PmAccess; onOpen: (tab: DecisionTab) => void }) {
  const t = useTranslations("Portal.PM")
  const { decisions } = usePmDecisions(projectId, project, access)
  return (
    <Panel title={t("dec.title")} icon={AlertTriangle} count={decisions.length || undefined} bodyClassName="p-0">
      {decisions.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={CheckCircle2} title={t("dec.none")} description={t("dec.none_desc")} />
        </div>
      ) : (
        <DecisionList decisions={decisions} money={access.has("money")} onOpen={onOpen} />
      )}
    </Panel>
  )
}
