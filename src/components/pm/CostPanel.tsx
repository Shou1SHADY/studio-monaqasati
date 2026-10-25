"use client"

// Money › Cost on a PM 1.0 project (CST-01…03): the contract budget against
// what is committed and spent, by section and by BOQ line, and the lines
// bleeding margin (over their budget by more than 2%). Every figure is read
// from its owner — orders, receipts, issues, subcontracts — never typed here.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, Flame, Hand, List, Pencil, Receipt, TrendingUp, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useTableLabels } from "@/hooks/useTableLabels"
import { usePmIndirect } from "@/hooks/usePmIndirect"
import { useProjectCost } from "@/hooks/useProjectCost"
import { IndirectBudgetDialog } from "./IndirectBudgetDialog"
import { bleeding, itemCosts, projectCost, sectionOf, sectionRows, type CostItem, type SectionRow } from "@/lib/pm/cost"
import { pmMoney } from "@/lib/pm/format"
import { cn } from "@/lib/utils"

export interface CostPanelItem {
  id: string
  code: string
  description: string
  division: string
  quantity: number
  rate: number
  executed: number
  estCost?: number
}

const pct = (n: number) => `${Math.round(n * 10) / 10}%`
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${pmMoney(Math.abs(n))}`

export function Tile({ icon: Icon, label, value, note, tone }: { icon: typeof List; label: string; value: string; note: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon size={12} aria-hidden="true" />
        {label}
      </p>
      <p className={cn("mt-1 text-lg font-bold tabular-nums", tone === "bad" && "text-destructive", tone === "good" && "text-success")} dir="ltr">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

export function CostPanel({
  projectId,
  orgId,
  items,
  projectWarehouseId,
  baseValue,
  access,
  onOpenItem,
}: {
  projectId: string
  orgId: string | null
  items: CostPanelItem[]
  projectWarehouseId: string | null
  baseValue: number
  access: PmAccess
  /** Open a BOQ item's drawer (the prototype's openItem). */
  onOpenItem?: (itemId: string) => void
}) {
  const t = useTranslations("Portal.PM")
  const money = access.has("money")
  const labels = useTableLabels()
  const world = useProjectCost(projectId, orgId, money)
  const indirect = usePmIndirect(projectId, orgId, money)
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const canBudget = money && !access.ctx.archived && access.allowed("reconciliation.manage")

  const costItems = useMemo<CostItem[]>(() => items.map((i) => ({ ...i, estCost: i.estCost ?? 0 })), [items])
  const { costs, unassigned } = useMemo(() => {
    const r = itemCosts({ items: costItems, pos: world.pos, issues: world.issues, projectWarehouseId, subcontracts: world.subcontracts, direct: world.direct })
    return { costs: r.items, unassigned: r.unassigned }
  }, [costItems, world.pos, world.issues, world.subcontracts, world.direct, projectWarehouseId])
  const rows = useMemo(() => sectionRows(costItems, costs), [costItems, costs])
  const total = useMemo(
    () => projectCost({ items: costItems, costs, unassigned, variations: world.variations, baseValue, penalty: 0, indirect: { budget: indirect.budget, actual: indirect.actual } }),
    [costItems, costs, unassigned, world.variations, baseValue, indirect.budget, indirect.actual]
  )
  const leaks = useMemo(() => bleeding(costItems, costs), [costItems, costs])

  if (!money) return <Callout tone="info">{t("money.money_only")}</Callout>

  const estimated = total.unestimated < costItems.length
  const plannedPct = total.contract > 0 ? (total.plannedMargin / total.contract) * 100 : 0

  type CostRow = { key: string; kind: "section" | "unassigned" | "indirect"; s?: SectionRow }
  const tableRows: CostRow[] = [
    ...rows.map((r) => ({ key: `s:${r.section}`, kind: "section" as const, s: r })),
    ...(unassigned.actual > 0 || unassigned.committed > 0 ? [{ key: "unassigned", kind: "unassigned" as const }] : []),
    ...(indirect.rows.length > 0 ? [{ key: "indirect", kind: "indirect" as const }] : []),
  ]
  const openRow = open ? rows.find((r) => r.section === open) ?? null : null
  const openLines = openRow ? costItems.filter((i) => sectionOf(i) === openRow.section) : []
  const sectionColumns: DataColumn<CostRow>[] = [
    {
      key: "section",
      header: t("money.cost.col.section"),
      cell: (r) => {
        if (r.kind === "unassigned")
          return (
            <>
              <p className="font-bold">{t("money.cost.unassigned")}</p>
              <p className="text-xs text-muted-foreground">{t("money.cost.unassigned_sub", { committed: pmMoney(unassigned.committed) })}</p>
            </>
          )
        if (r.kind === "indirect")
          return (
            <>
              <p className="font-bold">{t("money.cost.indirect")}</p>
              <p className="text-xs text-muted-foreground">{t("money.cost.indirect_sub")}</p>
            </>
          )
        const sr = r.s!
        const expanded = open === sr.section
        return (
          <button
            type="button"
            onClick={() => setOpen(expanded ? null : sr.section)}
            aria-expanded={expanded}
            className="flex items-start gap-1.5 rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown size={14} className={cn("mt-0.5 shrink-0 transition-transform", !expanded && "-rotate-90 rtl:rotate-90")} aria-hidden="true" />
            <span>
              <span className="block font-bold" dir="auto">
                {sr.section}
              </span>
              <span className="block text-xs text-muted-foreground">{t("money.cost.section_sub", { count: sr.n, committed: pmMoney(sr.committed) })}</span>
            </span>
          </button>
        )
      },
      footer: rows.length > 0 ? t("money.total") : undefined,
    },
    {
      key: "budget_executed",
      header: t("money.cost.col.budget_executed"),
      numeric: true,
      cell: (r) => (r.kind === "indirect" ? pmMoney(indirect.budget) : r.kind === "unassigned" || r.s!.unestimated === r.s!.n ? "—" : pmMoney(r.s!.budgetExecuted)),
      footer: rows.length > 0 ? (estimated ? pmMoney(total.budgetExecuted) : "—") : undefined,
    },
    {
      key: "actual",
      header: t("money.cost.col.actual"),
      numeric: true,
      cell: (r) => pmMoney(r.kind === "indirect" ? indirect.actual : r.kind === "unassigned" ? unassigned.actual : r.s!.actual),
      footer: rows.length > 0 ? pmMoney(total.actual) : undefined,
    },
    {
      key: "variance",
      header: t("money.cost.col.variance"),
      numeric: true,
      cell: (r) => {
        if (r.kind === "unassigned") return "—"
        if (r.kind === "indirect")
          return <span className={cn(indirect.actual > indirect.budget && "font-bold text-destructive")}>{t("money.cost.indirect_left", { amount: pmMoney(indirect.budget - indirect.actual) })}</span>
        const sr = r.s!
        const dv = sr.actual - sr.budgetExecuted
        return <span className={cn("font-bold", dv > 1000 ? "text-destructive" : dv < -1000 ? "text-success" : "text-muted-foreground")}>{sr.unestimated === sr.n ? "—" : signed(dv)}</span>
      },
      footer: rows.length > 0 ? (estimated ? signed(total.variance) : "—") : undefined,
    },
  ]
  const lineColumns: DataColumn<CostItem>[] = [
    {
      key: "item",
      header: t("money.cost.col.item"),
      cell: (i) => (
        <>
          <span className="me-1.5 text-muted-foreground" dir="ltr">
            {i.code}
          </span>
          <span dir="auto">{i.description.slice(0, 40)}</span>
          {costs.get(i.id)?.leak && <StatusPill tone="bad" className="ms-1.5">{t("money.cost.bleeds")}</StatusPill>}
        </>
      ),
    },
    { key: "budget", header: t("money.cost.col.budget"), numeric: true, cell: (i) => { const c = costs.get(i.id); return c?.budget == null ? "—" : pmMoney(c.budget) } },
    { key: "committed", header: t("money.cost.col.committed"), numeric: true, cell: (i) => pmMoney(costs.get(i.id)?.committed ?? 0) },
    { key: "actual", header: t("money.cost.col.actual"), numeric: true, cell: (i) => pmMoney(costs.get(i.id)?.actual ?? 0) },
    { key: "paid", header: t("money.cost.col.paid"), numeric: true, hideBelow: "md", cell: (i) => pmMoney(costs.get(i.id)?.paid ?? 0) },
  ]

  return (
    <div className="space-y-4">
      {costItems.length > 0 && !estimated && <Callout tone="warn" title={t("money.cost.no_estimate_title")}>{t("money.cost.no_estimate")}</Callout>}
      {estimated && total.unestimated > 0 && <Callout tone="info">{t("money.cost.some_unestimated", { count: total.unestimated })}</Callout>}

      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
        <Tile icon={Receipt} label={t("money.cost.budget")} value={estimated ? pmMoney(total.budget) : "—"} note={t("money.cost.planned_margin", { pct: estimated ? pct(plannedPct) : "—" })} />
        <Tile icon={Hand} label={t("money.cost.committed")} value={pmMoney(total.committed)} note={t("money.cost.of_budget", { pct: total.budget > 0 ? pct((total.committed / total.budget) * 100) : "—" })} />
        <Tile
          icon={TrendingUp}
          label={t("money.cost.variance")}
          value={estimated ? signed(total.variance) : "—"}
          note={t("money.cost.variance_note")}
          tone={!estimated ? undefined : total.variance > 0 ? "bad" : "good"}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title={t("money.cost.by_section")} icon={List} bodyClassName="p-0" className="min-w-0">
          <DataTable
            columns={sectionColumns}
            rows={tableRows}
            rowKey={(r) => r.key}
            caption={t("money.cost.by_section")}
            labels={labels}
            bordered={false}
            dense
            rowTone={(r) => (r.kind === "unassigned" ? "mute" : undefined)}
            empty={<EmptyState bare icon={List} title={t("money.cost.no_items")} />}
          />
          {openRow && openLines.length > 0 && (
            // A section's lines, opened from its row (the old inline sub-table) — the same five figures per BOQ line.
            <div className="border-t bg-muted/20" data-cost-lines="">
              <p className="px-4 pb-1 pt-2.5 text-xs font-bold text-muted-foreground" dir="auto">
                {openRow.section}
              </p>
              <DataTable
                columns={lineColumns}
                rows={openLines}
                rowKey={(i) => i.id}
                caption={openRow.section}
                labels={labels}
                bordered={false}
                dense
                empty={null}
              />
            </div>
          )}
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{t("money.cost.sources")}</p>
        </Panel>

        <Panel title={t("money.cost.bleeding")} icon={Flame} description={t("money.cost.bleeding_sub")} bodyClassName="p-0" className="min-w-0">
          {leaks.length === 0 ? (
            <EmptyState bare icon={Flame} title={t("money.cost.no_bleeding")} />
          ) : (
            <ul className="divide-y">
              {leaks.map(({ item, cost }) => {
                const over = item.estCost > 0 && cost.unitActual != null ? Math.round((cost.unitActual / item.estCost - 1) * 100) : 0
                return (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold" dir="auto">
                        {item.description.slice(0, 44)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("money.cost.unit_line", { code: item.code, actual: (cost.unitActual ?? 0).toLocaleString("en-US"), est: item.estCost.toLocaleString("en-US"), pct: over })}
                      </p>
                    </div>
                    <span className="shrink-0 font-bold tabular-nums text-destructive" dir="ltr">
                      +{pmMoney(cost.deviation ?? 0)}
                    </span>
                    <Button size="sm" variant="ghost" className="max-sm:min-h-11" onClick={() => (onOpenItem ? onOpenItem(item.id) : setOpen(sectionOf(item)))}>
                      {t("money.open")}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title={t("money.cost.indirect_title")}
        icon={Users}
        description={t("money.cost.indirect_panel_sub")}
        actions={
          canBudget ? (
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEditing(true)}>
              <Pencil size={13} aria-hidden="true" />
              {t("money.cost.indirect_edit")}
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        {indirect.rows.length === 0 ? (
          <EmptyState bare icon={Users} title={t("money.cost.indirect_empty")} />
        ) : (
          <ul className="divide-y">
            {indirect.rows.map((r) => {
              const share = r.budget > 0 ? r.actual / r.budget : r.actual > 0 ? 1 : 0
              return (
                <li key={r.kind} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{t(`money.cost.indirect_kind.${r.kind}`)}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.budget > 0 ? t("money.cost.indirect_budget", { amount: pmMoney(r.budget) }) : t("money.cost.indirect_no_budget")}
                      {` · ${t("money.cost.indirect_paid", { amount: pmMoney(indirect.paid[r.kind] ?? 0) })}`}
                      {r.kind === "eq" && indirect.plantLogged > 0 && <b> · {t("money.cost.indirect_plant", { amount: pmMoney(indirect.plantLogged) })}</b>}
                    </p>
                  </div>
                  <div className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-muted" role="presentation">
                    <span className={cn("block h-full rounded-full", share > 1 ? "bg-destructive" : "bg-module")} style={{ width: `${Math.min(100, share * 100)}%` }} />
                  </div>
                  <span className="shrink-0 text-end text-sm font-bold tabular-nums sm:min-w-24" dir="ltr">
                    {pmMoney(r.actual)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{t("money.cost.indirect_sources")}</p>
      </Panel>
      {canBudget && <IndirectBudgetDialog open={editing} onOpenChange={setEditing} projectId={projectId} access={access} budgets={indirect.budgets} />}
      <p className="text-xs text-muted-foreground">{t("money.cost.paid_note")}</p>
    </div>
  )
}
