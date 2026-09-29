"use client"

// Contract › Bill of quantities on a PM 1.0 project (the prototype's scopeBOQ).
// Read-only: after start a line's quantity and rate change only by variation;
// the one write here is pricing an unpriced line by its agreed rate («سعّره»),
// and importing a BOQ into a project that has none. Money columns are for
// holders of money — the site engineer sees quantities and progress, and •••
// where a riyal would be. A bleeding line (actual unit cost > estimate + 2%)
// needs a booked cost: the lead passes it as `actualCost` when the cost
// section reports it; without it the margin is taken on the budget.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, CircleDollarSign, Flame, ListTree, Loader2, Plus, Search, TableProperties } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BoqItemSupply } from "./BoqItemSupply"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import {
  actualUnitCost,
  boqLineOf,
  boqTotals,
  crmMismatch,
  filterLines,
  groupLines,
  lineBilled,
  lineBleeding,
  lineBudgetEx,
  lineContract,
  lineEarned,
  lineMargin,
  lineMarginPct,
  lineOverBudget,
  linePriced,
  lineProgress,
  lineUnbilled,
  MAX_IMPORT_ROWS,
  parseBoqPaste,
  priceBlocks,
  unpricedNote,
  UNBILLED_FLOOR,
  viewCounts,
  type BoqView,
  type PmBoqLine,
} from "@/lib/pm/boq"
import { importBoq, PmBoqError, priceItem, type BoqActor } from "@/lib/pm/boq-writes"
import { pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import { isOpenObstacle, obstacleDays, obstacleSeq, PM_OBSTACLES, type PmObstacle } from "@/lib/pm/site"
import { PM_SUBCONTRACTS, type PmSubcontract } from "@/lib/pm/subcontract"
import { PM_VARIATIONS, voNo, type PmVariation } from "@/lib/pm/variation"
import { cn } from "@/lib/utils"
import { CheckLine, FormHint } from "./ContractBits"

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US")
const pct = (n: number) => `${Math.round(n)}%`

export function PmBoqPanel({
  projectId,
  contractValue,
  access,
  actor,
  actualCost,
  orgId,
  openItemId,
}: {
  projectId: string
  /** The org — the item drawer reads the store ledger and the org's price history. */
  orgId?: string | null
  /** The contract value the handover carried from CRM (the project's budget). */
  contractValue: number
  access: PmAccess
  actor: BoqActor
  /** Actual cost booked per BOQ line, SAR — from the cost section when it reports it. */
  actualCost?: ReadonlyMap<string, number>
  /** Open this item's drawer on arrival (Cost's «افتح» on a bleeding item). */
  openItemId?: string | null
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const money = access.has("money")
  const [view, setView] = useState<BoqView>("all")
  const [search, setSearch] = useState("")
  const [bySection, setBySection] = useState(false)
  const [openId, setOpenId] = useState<string | null>(openItemId ?? null)
  useEffect(() => {
    if (openItemId) setOpenId(openItemId)
  }, [openItemId])
  const [pricing, setPricing] = useState<PmBoqLine | null>(null)
  const [importing, setImporting] = useState(false)

  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, "boqItems") : null), [firestore, projectId])
  const { data, isLoading } = useCollection(q)
  const lines = useMemo(
    () =>
      ((data ?? []) as Array<Record<string, unknown> & { id: string }>)
        .map((d) => boqLineOf(d.id, d, locale, actualCost?.get(d.id) ?? null))
        .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })),
    [data, locale, actualCost],
  )
  const counts = useMemo(() => viewCounts(lines), [lines])
  const shown = useMemo(() => filterLines(lines, view, search), [lines, view, search])
  const groups = useMemo(() => groupLines(shown, bySection), [shown, bySection])
  const totals = boqTotals(shown)
  const up = unpricedNote(lines)
  // The row's «سعّره» is the approver's (prototype: money && approve); the write
  // itself still accepts prep, as the prototype's handler does.
  const canPrice = money && !access.ctx.archived && access.allowed("item.price") && access.has("approve")
  const canImport = !access.ctx.archived && access.allowed("boq.import")
  const open = lines.find((b) => b.id === openId) ?? null
  const cols = money ? 6 : 3

  if (!isLoading && lines.length === 0) {
    return (
      <section className="rounded-xl border bg-card">
        <EmptyState
          icon={TableProperties}
          title={t("boq.empty")}
          description={t("boq.empty_desc")}
          className="p-8"
          action={
            canImport ? (
              <Button onClick={() => setImporting(true)}>
                <Plus size={15} className="me-1.5" aria-hidden="true" />
                {t("boq.add")}
              </Button>
            ) : undefined
          }
        />
        {canImport && <ImportDialog open={importing} onOpenChange={setImporting} projectId={projectId} access={access} contractValue={contractValue} money={money} />}
      </section>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedNav
          ariaLabel={t("boq.views")}
          active={view}
          onSelect={(id) => setView(id as BoqView)}
          segments={[
            {
              id: "all",
              label: t("boq.view.all"),
              count: counts.all,
              tone: "mute",
            },
            ...(money
              ? [
                  {
                    id: "leak",
                    label: t("boq.view.leak"),
                    count: counts.leak,
                    tone: counts.leak ? ("bad" as const) : ("mute" as const),
                  },
                ]
              : []),
            ...(money
              ? [
                  {
                    id: "ub",
                    label: t("boq.view.ub"),
                    count: counts.ub,
                    tone: counts.ub ? ("warn" as const) : ("mute" as const),
                  },
                ]
              : []),
            {
              id: "ns",
              label: t("boq.view.ns"),
              count: counts.ns,
              tone: "mute",
            },
            {
              id: "done",
              label: t("boq.view.done"),
              count: counts.done,
              tone: "ok",
            },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("boq.search_ph")} aria-label={t("boq.search_ph")} className="h-9 w-56 ps-8" dir="auto" />
          </div>
          <Button size="sm" variant={bySection ? "default" : "outline"} aria-pressed={bySection} onClick={() => setBySection((v) => !v)}>
            <ListTree size={14} className="me-1.5" aria-hidden="true" />
            {t("boq.group")}
          </Button>
        </div>
      </div>

      {up.count > 0 && (
        <Callout tone="warn" title={t("boq.unpriced_title", { count: up.count })}>
          {t("boq.unpriced_body")}
          {up.executed > 0 && <b className="mt-1 block text-destructive">{t("boq.unpriced_executed", { count: up.executed })}</b>}
          {up.unweighted > 0 && <span className="mt-1 block">{t("boq.unpriced_weight", { pct: pmPct(up.unweighted / 100) })}</span>}
        </Callout>
      )}
      {view === "leak" && counts.leak > 0 && <Callout tone="warn">{t("boq.leak_note")}</Callout>}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-start font-semibold">{t("boq.col.item")}</th>
              <th className="px-3 py-2 text-end font-semibold">{t("boq.col.contracted")}</th>
              <th className="px-3 py-2 text-start font-semibold">{t("boq.col.executed")}</th>
              {money && <th className="px-3 py-2 text-end font-semibold">{t("boq.col.unbilled")}</th>}
              {money && <th className="px-3 py-2 text-end font-semibold">{t("boq.col.cost")}</th>}
              {money && <th className="px-4 py-2 text-end font-semibold">{t("boq.col.margin")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.length === 0 && (
              <tr>
                <td colSpan={cols} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("boq.none_match")}
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <BoqGroupRows key={g.division ?? "_all"} group={g} cols={cols} money={money} canPrice={canPrice} onOpen={setOpenId} onPrice={setPricing} />
            ))}
            {money && shown.length > 0 && (
              <tr className="bg-muted/40 font-bold">
                <td className="px-4 py-2">{t("boq.total")}</td>
                <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                  {fmt(totals.contract)}
                </td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">
                  {pct(totals.progress)}
                </td>
                <td className="px-3 py-2 text-end tabular-nums text-destructive" dir="ltr">
                  {fmt(totals.unbilled)}
                </td>
                <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                  {totals.costed ? fmt(totals.cost) : "—"}
                </td>
                <td className={cn("px-4 py-2 text-end tabular-nums", !totals.costed ? "text-muted-foreground" : totals.margin > 0 ? "text-success" : "text-destructive")} dir="ltr">
                  {totals.costed ? fmt(totals.margin) : "—"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {money && totals.estimated && <FormHint>{t("boq.cost_estimated")}</FormHint>}

      <ItemDrawer projectId={projectId} orgId={orgId ?? null} line={open} lines={lines} money={money} onClose={() => setOpenId(null)} />
      {pricing && <PriceDialog projectId={projectId} line={pricing} access={access} actor={actor} onClose={() => setPricing(null)} />}
    </div>
  )
}

function BoqGroupRows({
  group,
  cols,
  money,
  canPrice,
  onOpen,
  onPrice,
}: {
  group: ReturnType<typeof groupLines>[number]
  cols: number
  money: boolean
  canPrice: boolean
  onOpen: (id: string) => void
  onPrice: (b: PmBoqLine) => void
}) {
  const t = useTranslations("Portal.PM")
  return (
    <>
      {group.division !== null && (
        <tr className="bg-muted/25">
          <td colSpan={cols} className="px-4 py-1.5 text-xs">
            <b dir="auto">{group.division || "—"}</b>
            <span className="ms-2 rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{group.lines.length}</span>
            {money && (
              <span className="ms-3 tabular-nums text-muted-foreground" dir="auto">
                {group.contract > 0
                  ? t("boq.group_line", {
                      value: pmMoney(group.contract),
                      pct: pct((group.earned / group.contract) * 100),
                    })
                  : t("boq.no_rate")}
              </span>
            )}
          </td>
        </tr>
      )}
      {group.lines.map((b) => {
        const pr = lineProgress(b)
        const mg = lineMarginPct(b)
        const ub = lineUnbilled(b)
        return (
          <tr key={b.id} className="cursor-pointer hover:bg-muted/30" onClick={() => onOpen(b.id)}>
            <td className="px-4 py-2">
              <button type="button" className="block text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(b.id)}>
                <b className="block" dir="auto">
                  {b.description || "—"}
                </b>
              </button>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono underline" dir="ltr">
                  {b.code}
                </span>
                <span dir="ltr">
                  · {fmt(b.quantity)} {b.unit}
                  {money && linePriced(b) ? ` × ${fmt(b.rate)}` : ""}
                </span>
                {!linePriced(b) && (
                  <StatusPill tone="warn" className="px-1.5 py-0 text-[10px]">
                    {t("boq.no_rate")}
                  </StatusPill>
                )}
                {!linePriced(b) && canPrice && (
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={(e) => {
                      e.stopPropagation()
                      onPrice(b)
                    }}
                  >
                    {t("boq.price_it")}
                  </Button>
                )}
                {money && lineBleeding(b) && (
                  <StatusPill tone="bad" className="px-1.5 py-0 text-[10px]">
                    <Flame size={10} aria-hidden="true" />
                    {t("boq.bleeding")}
                  </StatusPill>
                )}
              </span>
            </td>
            <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
              {!money ? "•••" : linePriced(b) ? fmt(lineContract(b)) : "—"}
            </td>
            <td className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums" dir="ltr">
                <span>
                  {fmt(b.executed)} <small className="text-muted-foreground">{t("boq.of", { qty: fmt(b.quantity) })}</small>
                </span>
                <small>{pct(pr)}</small>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" dir="ltr">
                <div className={cn("h-full rounded-full", pr >= 99.5 ? "bg-success" : "bg-module")} style={{ width: `${Math.min(100, pr)}%` }} />
              </div>
            </td>
            {money && (
              <td className={cn("px-3 py-2 text-end tabular-nums", ub > UNBILLED_FLOOR ? "text-destructive" : "text-muted-foreground")} dir="ltr">
                {ub > 1 ? fmt(ub) : "—"}
              </td>
            )}
            {money &&
              (linePriced(b) ? (
                <>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                    <span className="block text-xs">{b.actual !== null ? fmt(b.actual) : "—"}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {t("boq.budget")} {fmt(lineBudgetEx(b))}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums">
                    {b.estCost > 0 ? (
                      <>
                        <span
                          className={cn("rounded px-1.5 text-xs font-bold", mg > 12 ? "bg-success/10 text-success" : mg > 5 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive")}
                          dir="ltr"
                        >
                          {Math.round(mg)}%
                        </span>
                        <span className="block text-[11px] text-muted-foreground" dir="ltr">
                          {fmt(lineMargin(b))}
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{t("boq.no_budget_cost")}</span>
                    )}
                  </td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2 text-end text-xs text-muted-foreground">—</td>
                  <td className="px-4 py-2 text-end text-xs text-muted-foreground">—</td>
                </>
              ))}
          </tr>
        )
      })}
    </>
  )
}

function ItemDrawer({ projectId, orgId, line, lines, money, onClose }: { projectId: string; orgId: string | null; line: PmBoqLine | null; lines: PmBoqLine[]; money: boolean; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const on = Boolean(line)
  const voQ = useMemoFirebase(() => (firestore && on ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [firestore, projectId, on])
  const { data: voData } = useCollection(voQ)
  const obsQ = useMemoFirebase(() => (firestore && on ? collection(firestore, "projects", projectId, PM_OBSTACLES) : null), [firestore, projectId, on])
  const { data: obsData } = useCollection(obsQ)
  const scQ = useMemoFirebase(() => (firestore && on ? collection(firestore, "projects", projectId, PM_SUBCONTRACTS) : null), [firestore, projectId, on])
  const { data: scData } = useCollection(scQ)
  if (!line) return <Sheet open={false} onOpenChange={() => onClose()} />
  const vos = ((voData ?? []) as unknown as PmVariation[]).filter((v) => (v.itemIds ?? []).includes(line.id))
  const obs = ((obsData ?? []) as unknown as PmObstacle[]).filter((o) => isOpenObstacle(o) && o.itemIds.includes(line.id))
  const subs = ((scData ?? []) as unknown as PmSubcontract[]).flatMap((c) => c.lines.filter((l) => l.itemId === line.id).map((l) => ({ c, l })))
  const committed = subs.reduce((a, s) => a + s.l.qty, 0)
  const unit = actualUnitCost(line)
  const over = lineOverBudget(line)
  const remaining = Math.max(0, line.quantity - line.executed)
  const mg = lineMarginPct(line)
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-lg" dir={locale === "ar" ? "rtl" : "ltr"}>
        <SheetHeader className="text-start">
          <SheetTitle dir="auto">{line.description || line.code}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <StatusPill tone="module">
              <span dir="ltr">{line.code}</span>
            </StatusPill>
            {line.division && <span dir="auto">{line.division}</span>}
            {money && lineBleeding(line) && (
              <StatusPill tone="bad">
                <Flame size={11} aria-hidden="true" />
                {t("boq.bleeding")}
              </StatusPill>
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              {
                l: t("boq.d.contracted_qty"),
                v: fmt(line.quantity),
                s: line.unit,
              },
              {
                l: t("boq.col.executed"),
                v: fmt(line.executed),
                s: pct(lineProgress(line)),
              },
              { l: t("boq.d.remaining"), v: fmt(remaining), s: line.unit },
            ].map((x) => (
              <div key={x.l} className="rounded-xl border p-3">
                <p className="text-[11px] text-muted-foreground">{x.l}</p>
                <p className="text-lg font-black tabular-nums" dir="ltr">
                  {x.v}
                </p>
                <p className="text-[11px] text-muted-foreground" dir="auto">
                  {x.s}
                </p>
              </div>
            ))}
          </div>
          {money && (
            <DrawerSection title={t("boq.d.revenue")}>
              <KeyValueRow label={t("boq.d.rate")} value={linePriced(line) ? pmMoney(line.rate) : t("boq.no_rate")} ltr />
              <KeyValueRow label={t("boq.d.contract_value")} value={fmt(lineContract(line))} ltr />
              <KeyValueRow label={t("boq.d.executed_value")} value={fmt(lineEarned(line))} ltr />
              <KeyValueRow label={t("boq.d.billed")} value={fmt(lineBilled(line))} ltr />
              {lineUnbilled(line) > 1 && (
                <KeyValueRow label={<span className="font-bold text-destructive">{t("boq.d.unbilled")}</span>} value={<span className="text-destructive">{fmt(lineUnbilled(line))}</span>} ltr strong />
              )}
            </DrawerSection>
          )}
          {money && (
            <DrawerSection title={t("boq.d.cost_margin")}>
              <KeyValueRow label={t("boq.d.budget_unit")} value={line.estCost > 0 ? fmt(line.estCost) : "—"} ltr />
              <KeyValueRow
                label={t("boq.d.actual_unit")}
                value={
                  unit === null ? (
                    "—"
                  ) : (
                    <span
                      className={cn(line.estCost > 0 && unit > line.estCost * 1.02 ? "text-destructive" : undefined)}
                    >{`${fmt(unit)}${line.estCost > 0 ? ` (${unit >= line.estCost ? "+" : ""}${Math.round((unit / line.estCost - 1) * 100)}%)` : ""}`}</span>
                  )
                }
                ltr
              />
              <KeyValueRow label={t("boq.d.budget_ex")} value={fmt(lineBudgetEx(line))} ltr />
              <KeyValueRow label={t("boq.d.actual")} value={line.actual === null ? "—" : fmt(line.actual)} ltr />
              <KeyValueRow
                label={t("boq.d.margin")}
                value={<span className={mg > 12 ? "text-success" : mg > 5 ? "text-warning" : "text-destructive"}>{`${fmt(lineMargin(line))} · ${Math.round(mg)}%`}</span>}
                ltr
                strong
              />
            </DrawerSection>
          )}
          {money && over > 1000 && unit !== null && (
            <Callout tone="block">
              {t("boq.d.over_budget", {
                amount: pmMoney(over),
                actual: fmt(unit),
                budget: fmt(line.estCost),
              })}
            </Callout>
          )}
          <DrawerSection title={t("boq.d.commitments")} count={subs.length}>
            {subs.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">{t("boq.d.no_commitments")}</p>
            ) : (
              subs.map(({ c, l }) => (
                <div key={`${c.id}-${l.itemId}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <b className="block truncate" dir="auto">
                      {c.party.name}
                    </b>
                    <span className="text-xs text-muted-foreground">{t("boq.d.subcontract", { qty: fmt(l.qty) })}</span>
                  </span>
                  {money && (
                    <b className="tabular-nums" dir="ltr">
                      {fmt(l.value)}
                    </b>
                  )}
                </div>
              ))
            )}
          </DrawerSection>
          <BoqItemSupply
            projectId={projectId}
            orgId={orgId}
            item={{ id: line.id, code: line.code, description: line.description, unit: line.unit, quantity: line.quantity, executed: line.executed }}
            items={lines.map((x) => ({ id: x.id, code: x.code, description: x.description, unit: x.unit, quantity: x.quantity, executed: x.executed }))}
          />
          {vos.length > 0 && (
            <DrawerSection title={t("boq.d.variations")} count={vos.length}>
              {vos.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate" dir="auto">
                    {t("vo.no", { no: voNo(v.seq) })} — {v.title}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StatusPill tone={v.status === "appr" ? "ok" : v.status === "rej" ? "bad" : v.status === "wait" ? "warn" : "mute"}>{t(`vo.status.${v.status}`)}</StatusPill>
                    {money && v.value > 0 && (
                      <b className="tabular-nums" dir="ltr">
                        {fmt(v.value)}
                      </b>
                    )}
                  </span>
                </div>
              ))}
            </DrawerSection>
          )}
          {obs.length > 0 && (
            <Callout tone="warn">
              {obs.map((o) => (
                <span key={o.id} className="block" dir="auto">
                  <b>{t(`site.obs.no.${o.type}`, { no: obstacleSeq(o.seq) })}</b> {o.title} — {t("site.obs.open_for", { count: obstacleDays(o, today) })}
                </span>
              ))}
            </Callout>
          )}
          <DrawerSection title={t("boq.d.before_measuring")}>
            <CheckLine
              ok={remaining > 0}
              title={t("boq.d.qty_remains")}
              note={
                remaining > 0
                  ? t("boq.d.qty_left", {
                      qty: fmt(remaining),
                      unit: line.unit,
                    })
                  : t("boq.d.item_complete")
              }
            />
            <CheckLine ok={obs.length === 0} title={t("boq.d.no_obstacle")} note={obs.length ? t("boq.d.blocking", { count: obs.length }) : t("boq.d.clear")} />
            <CheckLine
              ok={committed > 0 || line.executed === 0}
              title={t("boq.d.committed")}
              note={
                committed > 0
                  ? t("boq.d.committed_pct", {
                      pct: pct((committed / Math.max(line.quantity, 1e-9)) * 100),
                    })
                  : t("boq.d.no_commitment")
              }
            />
          </DrawerSection>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function PriceDialog({ projectId, line, access, actor, onClose }: { projectId: string; line: PmBoqLine; access: PmAccess; actor: BoqActor; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [rate, setRate] = useState("")
  const [cost, setCost] = useState("")
  const [busy, setBusy] = useState(false)
  const r = rate.trim() === "" ? NaN : Number(rate)
  const c = cost.trim() === "" ? 0 : Number(cost)
  const blocks = priceBlocks({
    archived: access.ctx.archived,
    currentRate: line.rate,
    rate: r,
    cost: c,
  })

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      await priceItem(firestore, access.ctx, projectId, actor, line.id, {
        rate: r,
        cost: c,
      })
      toast({ title: t("boq.priced", { code: line.code }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({
        title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmBoqError && err.blocks[0] ? `boq.block.${err.blocks[0]}` : "error.save"),
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("boq.price_title")}</DialogTitle>
          <DialogDescription dir="auto">
            <span dir="ltr">{line.code}</span> — {line.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="info">{t("boq.price_note")}</Callout>
          <div className="rounded-xl border px-3">
            <KeyValueRow label={t("boq.d.contracted_qty")} value={`${fmt(line.quantity)} ${line.unit}`} />
            {line.executed > 0 && <KeyValueRow label={t("boq.executed_so_far")} value={`${fmt(line.executed)} ${line.unit}`} />}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bp-rate">
                {t("boq.agreed_rate")} <span className="text-warning">*</span>
              </Label>
              <Input id="bp-rate" dir="ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" disabled={busy} />
              <FormHint>{t("boq.agreed_rate_hint")}</FormHint>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-cost">{t("boq.unit_cost")}</Label>
              <Input id="bp-cost" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" disabled={busy} />
              <FormHint>{t("boq.unit_cost_hint")}</FormHint>
            </div>
          </div>
          {r > 0 && (
            <div className="rounded-xl border px-3">
              <KeyValueRow label={t("boq.adds_to_contract")} value={pmMoney(r * line.quantity)} ltr />
              {line.executed > 0 && <KeyValueRow label={t("boq.claimable_now")} value={pmMoney(r * line.executed)} ltr strong />}
              {c > 0 && <KeyValueRow label={t("boq.expected_margin")} value={<span className={r <= c ? "text-destructive" : undefined}>{pmPct((r - c) / r)}</span>} ltr />}
            </div>
          )}
          <BlockingReasons title={t("cannot_save")} reasons={rate.trim() === "" ? [] : blocks.map((b) => t(`boq.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <CircleDollarSign size={16} className="me-1.5" aria-hidden="true" />}
            {t("boq.price_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportDialog({
  open,
  onOpenChange,
  projectId,
  access,
  contractValue,
  money,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  projectId: string
  access: PmAccess
  contractValue: number
  money: boolean
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [raw, setRaw] = useState("")
  const [busy, setBusy] = useState(false)
  const r = useMemo(() => parseBoqPaste(raw), [raw])
  const rows = [...r.ok, ...r.bad].sort((a, b) => a.line - b.line)
  const mismatch = crmMismatch(r.ok, contractValue)
  const unpriced = r.ok.filter((o) => !o.rate).length
  const noCost = r.ok.filter((o) => !o.cost).length
  const tooMany = r.ok.length > MAX_IMPORT_ROWS
  const ready = r.ok.length > 0 && r.bad.length === 0 && !tooMany

  const save = async () => {
    if (!firestore || !ready) return
    setBusy(true)
    try {
      const n = await importBoq(firestore, access.ctx, projectId, r.ok)
      toast({ title: t("boq.imported", { count: n }) })
      setRaw("")
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({
        title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmBoqError ? `boq.import_err.${err.code}` : "error.save"),
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("boq.import_title")}</DialogTitle>
          <DialogDescription>{t("boq.import_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="boq-raw">{t("boq.paste_here")}</Label>
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setRaw(t("boq.sample"))} disabled={busy}>
                {t("boq.fill_sample")}
              </Button>
            </div>
            <Textarea id="boq-raw" value={raw} onChange={(e) => setRaw(e.target.value)} className="h-40 font-mono text-xs" placeholder="02-01-01	…	m3	18400	24	18.5" disabled={busy} dir="auto" />
          </div>
          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-start">#</th>
                    <th className="px-2 py-1.5 text-start">{t("boq.col.item")}</th>
                    <th className="px-2 py-1.5 text-end">{t("boq.qty")}</th>
                    <th className="px-2 py-1.5 text-end">{t("boq.rate")}</th>
                    <th className="px-2 py-1.5 text-end">{t("boq.cost")}</th>
                    <th className="px-2 py-1.5 text-start">{t("boq.verdict")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((o) => (
                    <tr key={o.line}>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{o.line}</td>
                      <td className="px-2 py-1.5">
                        <b className="block" dir="auto">
                          {o.description || "—"}
                        </b>
                        <span className="font-mono text-muted-foreground" dir="ltr">
                          {o.code} · {o.unit}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                        {Number.isNaN(o.quantity) ? "—" : fmt(o.quantity)}
                      </td>
                      <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                        {o.rate ? fmt(o.rate) : <span className="text-muted-foreground">{t("boq.no_rate")}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                        {o.cost ? fmt(o.cost) : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {o.problems.length ? <StatusPill tone="bad">{t(`boq.problem.${o.problems[0]}`)}</StatusPill> : <StatusPill tone="ok">{t("boq.valid")}</StatusPill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {mismatch && money && (
            <Callout tone={mismatch.under ? "warn" : "block"}>
              {t("boq.crm_mismatch", {
                total: pmMoney(mismatch.total),
                value: pmMoney(mismatch.value),
                diff: pmMoney(mismatch.diff),
              })}
            </Callout>
          )}
          {r.ok.length > 0 && (unpriced > 0 || noCost > 0) && (
            <Callout tone="warn">
              {unpriced > 0 && <span className="block">{t("boq.import_unpriced", { count: unpriced })}</span>}
              {noCost > 0 && <span className="block">{t("boq.import_no_cost", { count: noCost })}</span>}
            </Callout>
          )}
          {r.bad.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs font-bold text-destructive">
              <AlertTriangle size={13} aria-hidden="true" />
              {t("boq.import_bad", { count: r.bad.length })}
            </p>
          )}
          {tooMany && <p className="text-xs font-bold text-destructive">{t("boq.import_too_many", { max: MAX_IMPORT_ROWS })}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !ready}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("boq.import_n", { count: r.ok.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
