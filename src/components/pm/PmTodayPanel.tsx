"use client"

// Today on a PM 1.0 project (PRD §12, DEC-01): every decision its data raises,
// reddest first, each with the tab where it is solved — and, where the
// prototype opens the work itself (prepare the IPC), the page is told the kind.

import { ShowMoreRow } from "@/components/module-ui/ShowMoreRow"
import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  Box,
  PackageCheck,
  PackageX,
  ShoppingCart,
  Truck,
  Wrench,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  FileStack,
  Flag,
  Gavel,
  Hammer,
  Clock,
  HardHat,
  Mail,
  PauseCircle,
  Ruler,
  Scale,
  SearchX,
  ShieldAlert,
  TestTube,
  UserX,
  Users,
  Wallet,
  type LucideIcon,
  Boxes,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmDecisions, type PmDecisionProject } from "@/hooks/usePmDecisions"
import type { DecisionKind, DecisionTab, PmDecision } from "@/lib/pm/decisions"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { cn } from "@/lib/utils"

export const DECISION_ICON: Record<DecisionKind, LucideIcon> = {
  no_pm: UserX,
  plan_overdue: CalendarClock,
  sheets_waiting: Ruler,
  unpriced_executed: Banknote,
  wir_failed: SearchX,
  sample_rejected: TestTube,
  sample_late: TestTube,
  vo_work: AlertTriangle,
  vo_waiting: Hammer,
  claim_notice_late: Gavel,
  claim_notice_due: Gavel,
  claim_waiting: Gavel,
  addendum_unsigned: FileSignature,
  ipc_ready: Banknote,
  cert_internal: ClipboardCheck,
  cert_mine: ClipboardCheck,
  cert_consultant: ClipboardCheck,
  collection_overdue: Wallet,
  damages: Clock,
  slip: Clock,
  hold: PauseCircle,
  provisional_ready: Flag,
  final_ready: Flag,
  final_overdue: ShieldAlert,
  sub_cert_waiting: Users,
  doc_stale: FileStack,
  letters_late: Mail,
  obstacle_blocking: HardHat,
  obstacle_unprotected: Gavel,
  cvr_stale: Activity,
  req_waiting: ShoppingCart,
  req_stop: PackageX,
  req_incoming: Truck,
  store_move: AlertTriangle,
  store_incoming: ArrowLeftRight,
  store_close: Box,
  store_negative: AlertTriangle,
  change_held: ArrowLeftRight,
  change_rejected: AlertTriangle,
  need_short: PackageCheck,
  eqp_waiting: Truck,
  eqp_receive: Truck,
  eqp_idle: Clock,
  eqp_overdue: AlertTriangle,
  eqp_offhire: Wrench,
  eqp_licence: Ban,
  rerate: Ruler,
  eqp_hire: Truck,
  po_budget: Scale,
  zone: Boxes,
  ztight: Clock,
}

/** One decision row: the kind's own action, filled when it is red (the prototype's rule). */
export function DecisionItem({ d, money, onOpen, project }: { d: PmDecision; money: boolean; onOpen: () => void; project?: string }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const v = d.vars ?? {}
  const values = {
    count: d.count ?? 0,
    no: v.no ?? "—",
    n: v.n ?? 0,
    pct: v.pct ?? 0,
    note: v.note ?? "—",
    days: v.days ?? 0,
    name: v.name ?? "—",
    cause: v.cause ?? "—",
    date: v.date ? pmDate(v.date, locale) : "—",
    payer: v.payer ?? "—",
    why: v.why ?? "—",
    points: v.points ?? 0,
    rate: v.rate ?? 0,
    cap: v.cap ?? 0,
  }
  const detail = t(`dec.${d.kind}.${d.detail ?? "detail"}`, values)
  return (
    <DecisionRow
      severity={d.severity}
      icon={DECISION_ICON[d.kind]}
      title={t(`dec.${d.kind}.${d.title ?? "title"}`, values)}
      detail={project ? `${project} · ${detail}` : detail}
      age={d.age ? t("days", { count: d.age }) : undefined}
      ageDays={d.age}
      amount={d.amount && money ? pmMoney(d.amount) : undefined}
      action={
        <Button size="sm" variant={d.severity === "red" ? "default" : "outline"} className={cn(d.severity === "red" ? "bg-module text-module-foreground hover:bg-module/90" : "border border-border bg-card text-foreground shadow-none hover:bg-muted")} onClick={onOpen}>
          {t(`dec.${d.kind}.${d.act ?? "act"}`)}
        </Button>
      }
    />
  )
}

export function DecisionList({ decisions, money, onOpen, limit }: { decisions: PmDecision[]; money: boolean; onOpen: (tab: DecisionTab, kind: DecisionKind) => void; limit?: number }) {
  const t = useTranslations("Portal.PM")
  const [all, setAll] = useState(false)
  const shown = limit && !all ? decisions.slice(0, limit) : decisions
  return (
    <>
      <ul className="divide-y">
        {shown.map((d) => (
          <DecisionItem key={d.kind} d={d} money={money} onOpen={() => onOpen(d.tab, d.kind)} />
        ))}
      </ul>
      {limit && decisions.length > limit && (
        <ShowMoreRow onClick={() => setAll((v) => !v)}>
          {all ? t("dec.show_less") : t("dec.show_more", { count: decisions.length - limit })}
        </ShowMoreRow>
      )}
    </>
  )
}

/** «N عاجل · أقدمها منذ N يوماً» — the line under the panel title. */
export function DecisionSubline({ decisions }: { decisions: PmDecision[] }) {
  const t = useTranslations("Portal.PM")
  if (!decisions.length) return null
  const urgent = decisions.filter((d) => d.severity === "red").length
  const oldest = decisions.reduce((m, d) => Math.max(m, d.age ?? 0), 0)
  const parts = [urgent ? t("dec.sub_urgent", { count: urgent }) : null, oldest ? t("dec.sub_oldest", { count: oldest }) : null].filter(Boolean)
  if (!parts.length) return null
  return <p className="border-b px-4 py-2 text-xs text-muted-foreground">{parts.join(" · ")}</p>
}

export function PmTodayPanel({ projectId, project, access, onOpen }: { projectId: string; project: PmDecisionProject; access: PmAccess; onOpen: (tab: DecisionTab, kind: DecisionKind) => void }) {
  const t = useTranslations("Portal.PM")
  const { decisions } = usePmDecisions(projectId, project, access)
  const red = decisions.some((d) => d.severity === "red")
  return (
    <Panel title={t("dec.panel_title")} icon={AlertTriangle} count={decisions.length || undefined} countTone={red ? "bad" : "mute"} bodyClassName="p-0">
      <DecisionSubline decisions={decisions} />
      {decisions.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={CheckCircle2} title={t("dec.none_today")} description={t("dec.none_desc")} />
        </div>
      ) : (
        <DecisionList decisions={decisions} money={access.has("money")} onOpen={onOpen} limit={5} />
      )}
    </Panel>
  )
}
