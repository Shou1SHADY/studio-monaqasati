"use client"

// Money › Reconciliation on a PM 1.0 project (CVR-01, CST-03, WF-22): one
// question — are we still profitable? Earned value against actual cost, then
// the variance projected onto what remains, so the margin at completion is
// known before handover, not after. The project manager approves the estimate
// monthly and Finance recognises revenue on it (prj:BUD).

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Check, ClipboardList, Flame, List, Loader2, Ruler, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useProjectCost } from "@/hooks/useProjectCost"
import { PmAccessError } from "@/lib/pm/access"
import { progressOf } from "@/lib/pm/acceptance"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import { delayAndDamages, grantedDays, PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { EAC_STALE_DAYS, estimateAge, estimateBlocks, itemCosts, projectCost, sectionRows, type ApprovedEstimate, type CostItem } from "@/lib/pm/cost"
import { approveReconciliation, PmCvrError } from "@/lib/pm/cvr-writes"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import type { ContractTerms } from "@/lib/pm/terms"
import { cn } from "@/lib/utils"
import { Tile, type CostPanelItem } from "./CostPanel"
import { usePmIndirect } from "@/hooks/usePmIndirect"

const pct = (n: number) => `${Math.round(n * 10) / 10}%`

export function CvrPanel({
  projectId,
  orgId,
  items,
  projectWarehouseId,
  baseValue,
  original,
  lifecycle,
  startOn,
  durationDays,
  eac,
  access,
  actor,
}: {
  projectId: string
  orgId: string | null
  items: CostPanelItem[]
  projectWarehouseId: string | null
  baseValue: number
  original: ContractTerms
  lifecycle: string
  startOn: string | null
  durationDays: number
  eac: ApprovedEstimate | null
  access: PmAccess
  actor: { uid: string; name: string | null }
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const money = access.has("money")
  const world = useProjectCost(projectId, orgId, money)
  const indirect = usePmIndirect(projectId, orgId, money)
  const [busy, setBusy] = useState(false)
  const today = todayDay()

  const claimQ = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PM_CLAIMS) : null), [firestore, projectId, money])
  const addQ = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PM_ADDENDA) : null), [firestore, projectId, money])
  const { data: claims } = useCollection(claimQ)
  const { data: addenda } = useCollection(addQ)

  const costItems = useMemo<CostItem[]>(() => items.map((i) => ({ ...i, estCost: i.estCost ?? 0 })), [items])
  const cost = useMemo(() => {
    const { items: costs, unassigned } = itemCosts({ items: costItems, pos: world.pos, issues: world.issues, projectWarehouseId, subcontracts: world.subcontracts, direct: world.direct })
    const terms = inForce(original, (addenda ?? []) as unknown as PmAddendum[])
    const voValue = world.variations.filter((v) => v.status === "appr").reduce((a, v) => a + v.value, 0)
    const delay = delayAndDamages({
      lifecycle,
      startOn,
      effectiveDays: durationDays + grantedDays((claims ?? []) as unknown as PmClaim[]),
      progress: progressOf(costItems),
      contractValue: baseValue + voValue,
      damages: terms.damages,
      today,
    })
    const total = projectCost({ items: costItems, costs, unassigned, variations: world.variations, baseValue, penalty: delay?.damages ?? 0, indirect: { budget: indirect.budget, actual: indirect.actual } })
    const rows = sectionRows(costItems, costs)
    return { total, rows }
  }, [costItems, world, projectWarehouseId, original, addenda, claims, lifecycle, startOn, durationDays, baseValue, today, indirect.budget, indirect.actual])

  if (!money) return <Callout tone="info">{t("money.money_only")}</Callout>

  const { total: c, rows } = cost
  const age = estimateAge(eac, today)
  const stale = age !== null && age > EAC_STALE_DAYS
  const change = eac ? c.forecastCost - eac.v : 0
  const canApprove = !access.ctx.archived && access.allowed("reconciliation.manage")
  const blocks = estimateBlocks({ archived: access.ctx.archived, lifecycle, estimate: c.forecastCost, estimatedLines: c.estimatedLines })
  const noBudget = c.estimatedLines === 0
  const fmTone = c.forecastMargin <= 0 || c.forecastMargin < c.plannedMargin * 0.75 ? "bad" : "good"

  const approve = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      await approveReconciliation(firestore, access.ctx, projectId, actor, c)
      toast({ title: t("money.cvr.approved") })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmCvrError && err.blocks[0] ? `money.cvr.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Panel title={t("money.cvr.approve_title")} icon={ShieldCheck} actions={<span className="text-xs text-muted-foreground">{eac ? t("money.cvr.last_approved", { date: pmDate(eac.on, locale), who: eac.byName || "—" }) : t("money.cvr.never")}</span>}>
        <KeyValueRow label={t("money.cvr.eac_today")} value={noBudget ? "—" : pmMoney(c.forecastCost)} ltr strong />
        {eac && (
          <>
            <KeyValueRow label={t("money.cvr.eac_finance")} value={pmMoney(eac.v)} ltr />
            <KeyValueRow
              label={t("money.cvr.change")}
              value={<span className={cn(Math.abs(change) > 1000 && "text-destructive")}>{`${change >= 0 ? "+" : "−"}${pmMoney(Math.abs(change))}`}</span>}
              ltr
            />
          </>
        )}
        <Callout tone={stale ? "warn" : "info"} className="mt-3">
          {t("money.cvr.why")}
          {stale && <b className="ms-1">{t("money.cvr.age", { days: age ?? 0 })}</b>}
        </Callout>
        {canApprove && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => void approve()} disabled={busy || blocks.length > 0}>
              {busy ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Check size={14} className="me-1.5" aria-hidden="true" />}
              {t("money.cvr.approve")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("money.cvr.event_note")}</span>
          </div>
        )}
        {canApprove && <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`money.cvr.block.${b}`))} />}
      </Panel>

      <Callout tone="info">{t("money.cvr.intro")}</Callout>
      {noBudget && <Callout tone="block" title={t("money.cvr.no_budget_title")}>{t("money.cvr.no_budget")}</Callout>}
      {!noBudget && c.unestimated > 0 && <Callout tone="warn">{t("money.cost.some_unestimated", { count: c.unestimated })}</Callout>}

      {!noBudget && (
      <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile icon={ClipboardList} label={t("money.cvr.planned")} value={pmMoney(c.plannedMargin)} note={t("money.cvr.of_contract", { pct: c.contract ? pct((c.plannedMargin / c.contract) * 100) : "—" })} />
        <Tile
          icon={Ruler}
          label={t("money.cvr.to_date")}
          value={pmMoney(c.marginToDate)}
          note={t("money.cvr.of_executed", { pct: c.earned ? pct((c.marginToDate / c.earned) * 100) : "—" })}
          tone={c.marginToDate > 0 ? "good" : "bad"}
        />
        <Tile
          icon={Flame}
          label={t("money.cvr.forecast")}
          value={pmMoney(c.forecastMargin)}
          note={`${c.contract ? pct((c.forecastMargin / c.contract) * 100) : "—"}${c.penalty > 0 ? ` ${t("money.cvr.after_penalty")}` : ""}`}
          tone={fmTone}
        />
      </div>

      {c.forecastMargin < c.plannedMargin && (
        <Callout tone={c.forecastMargin < c.plannedMargin * 0.6 ? "block" : "warn"} title={t("money.cvr.below_plan", { amount: pmMoney(c.plannedMargin - c.forecastMargin) })}>
          {t("money.cvr.below_why", { cpi: pct(c.cpi * 100), per: c.cpi > 0 ? (Math.round((1 / c.cpi) * 100) / 100).toLocaleString("en-US") : "—" })}
          {c.penalty > 0 && ` ${t("money.cvr.below_penalty", { amount: pmMoney(c.penalty) })}`} {t("money.cvr.below_end")}
        </Callout>
      )}

      <Panel title={t("money.cvr.by_section")} icon={List} actions={<span className="text-xs text-muted-foreground">{t("money.cvr.as_at", { date: pmDate(today, locale) })}</span>} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="sticky start-0 bg-card px-4 py-2 text-start font-semibold">{t("money.cost.col.section")}</th>
                <th className="px-3 py-2 text-end font-semibold">{t("money.cvr.col.contract")}</th>
                <th className="px-3 py-2 text-end font-semibold">{t("money.cvr.col.earned")}</th>
                <th className="px-3 py-2 text-end font-semibold">{t("money.cost.col.budget_executed")}</th>
                <th className="px-3 py-2 text-end font-semibold">{t("money.cvr.col.actual")}</th>
                <th className="px-3 py-2 text-end font-semibold">{t("money.cvr.col.margin")}</th>
                <th className="px-3 py-2 text-end font-semibold">{t("money.cvr.col.fcost")}</th>
                <th className="px-4 py-2 text-end font-semibold">{t("money.cvr.col.fmargin")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const mg = x.earned - x.actual
                const fmg = x.contract - x.forecast
                return (
                  <tr key={x.section} className="border-b">
                    <td className="sticky start-0 bg-card px-4 py-2.5">
                      <p className="font-bold" dir="auto">
                        {x.section}
                      </p>
                      <p className="text-xs text-muted-foreground">{t("money.cvr.section_sub", { count: x.n, pct: pct(x.progress * 100) })}</p>
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{pmMoney(x.contract)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{pmMoney(x.earned)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{pmMoney(x.budgetExecuted)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{pmMoney(x.actual)}</td>
                    <td className={cn("px-3 py-2.5 text-end font-bold tabular-nums", mg > 0 ? "text-success" : "text-destructive")} dir="ltr">
                      {pmMoney(mg)}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{pmMoney(x.forecast)}</td>
                    <td className="px-4 py-2.5 text-end" dir="ltr">
                      <b className={cn("tabular-nums", fmg > x.contract * 0.08 ? "text-success" : fmg > 0 ? "text-warning" : "text-destructive")}>{pmMoney(fmg)}</b>
                      <p className="text-xs text-muted-foreground">{x.contract ? pct((fmg / x.contract) * 100) : "—"}</p>
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-muted/40 font-bold">
                <td className="sticky start-0 bg-muted px-4 py-2.5">{t("money.total")}</td>
                <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{pmMoney(c.contract)}</td>
                <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{pmMoney(c.earned)}</td>
                <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{pmMoney(c.budgetExecuted)}</td>
                <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{pmMoney(c.actual)}</td>
                <td className={cn("px-3 py-2.5 text-end tabular-nums", c.marginToDate > 0 ? "text-success" : "text-destructive")} dir="ltr">
                  {pmMoney(c.marginToDate)}
                </td>
                <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">{pmMoney(c.forecastCost)}</td>
                <td className={cn("px-4 py-2.5 text-end tabular-nums", c.forecastMargin > 0 ? "text-success" : "text-destructive")} dir="ltr">
                  {pmMoney(c.forecastMargin)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{t("money.cvr.footer")}</p>
      </Panel>
      </>
      )}
    </div>
  )
}
