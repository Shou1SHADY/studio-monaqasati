"use client"

// A PM 1.0 project's Pulse (the prototype's first tab): what needs a decision,
// the money path — what the contract is worth, what was executed, billed and
// collected against what was committed, invoiced and paid — and what we are
// waiting on from other modules, with no button, because the act is theirs.

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { ArrowLeftRight, Wallet } from "lucide-react"
import { Panel } from "@/components/module-ui/Panel"
import { PmTodayPanel } from "@/components/pm/PmTodayPanel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import type { PmDecisionProject } from "@/hooks/usePmDecisions"
import { useProjectMoneyFlow } from "@/hooks/useProjectMoneyFlow"
import type { DecisionTab } from "@/lib/pm/decisions"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { displayPoNumber } from "@/lib/procurement/format"
import { poStatus } from "@/lib/procurement/po"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"

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
  const locale = useLocale()
  const firestore = useFirestore()
  const money = access.has("money")
  const flow = useProjectMoneyFlow(money ? projectId : null)
  const poQ = useMemoFirebase(
    () => (firestore && organizationId ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", organizationId), where("projectId", "==", projectId)) : null),
    [firestore, organizationId, projectId]
  )
  const { data: poData } = useCollection(poQ)
  const waiting = useMemo(
    () =>
      ((poData ?? []) as unknown as PurchaseOrder[])
        .map((po) => ({ ...po, lines: po.lines || [], log: po.log || [] }))
        .filter((po) => !["received", "closed", "cancelled"].includes(poStatus(po)))
        .sort((a, b) => String(a.promisedDate ?? "9999").localeCompare(String(b.promisedDate ?? "9999"))),
    [poData]
  )
  const executed = r2(items.reduce((a, i) => a + (i.rate > 0 ? i.executed * i.rate : 0), 0))
  const today = todayDay()

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

      <Panel title={t("pulse.waiting_title")} icon={ArrowLeftRight} count={waiting.length || undefined} bodyClassName="p-0">
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("pulse.waiting_desc")}</p>
        {waiting.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("pulse.waiting_none")}</p>
        ) : (
          <ul className="divide-y">
            {waiting.slice(0, 8).map((po) => {
              const late = po.promisedDate && po.promisedDate.slice(0, 10) < today
              return (
                <li key={po.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      <span className="me-2 rounded bg-teal/10 px-1.5 py-0.5 text-[11px] font-semibold text-teal">{t("pulse.from_procurement")}</span>
                      <span dir="ltr">{displayPoNumber(po.docNumber, locale)}</span> — <span dir="auto">{po.supplierName}</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
                      {po.lines
                        .slice(0, 2)
                        .map((l) => `${l.name} ${l.quantity} ${l.unit}`)
                        .join(" · ")}
                    </p>
                  </div>
                  {po.promisedDate && (
                    <span className={late ? "rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive" : "rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"}>
                      {pmDate(po.promisedDate, locale)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
