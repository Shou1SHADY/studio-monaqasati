"use client"

// Contract › Bill of quantities on a PM 1.0 project (the prototype's scopeBOQ).
// Read-only: after start a line's quantity and rate change only by variation;
// the one write here is pricing an unpriced line by its agreed rate («سعّره»),
// and importing a BOQ into a project that has none. Money columns are for
// holders of money — the site engineer sees quantities and progress, and •••
// where a riyal would be; the view chips (bleeding, unbilled) and the «ينزف»
// pill carry no amount, so he sees them too (prototype scopeBOQ). A bleeding line (actual unit cost > estimate + 2%)
// needs a booked cost: the lead passes it as `actualCost` when the cost
// section reports it; without it the margin is taken on the budget.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { AlertTriangle, ChevronDown, CircleDollarSign, Flame, ListTree, Loader2, Pencil, Plus, Search, TableProperties } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BoqItemDialog } from "./BoqItemDialog"
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
import { Chip } from "@/components/module-ui/Chip"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
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
import { pmDate, pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import { itemCommitments, type CommitPo } from "@/lib/pm/item-commitments"
import { isOpenObstacle, obstacleDays, obstacleSeq, PM_OBSTACLES, type PmObstacle } from "@/lib/pm/site"
import { PM_SUBCONTRACTS, subcontractNo, type PmSubcontract } from "@/lib/pm/subcontract"
import { PURCHASE_REQUESTS, requestOf } from "@/lib/pm/supply"
import { PURCHASE_ORDERS } from "@/lib/procurement/types"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { PM_VARIATIONS, voNo, type PmVariation } from "@/lib/pm/variation"
import { cn } from "@/lib/utils"
import { CheckLine, FormHint } from "./ContractBits"

const TABLE_LABELS = { sortBy: (c: string) => c, showMore: (n: number) => `+${n}` }
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
  planning = false,
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
  /** The project has not started: lines may still be added and corrected one by one. */
  planning?: boolean
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [pricing, setPricing] = useState<PmBoqLine | null>(null)
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState<PmBoqLine | "new" | null>(null)

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
  // CON-03 / WF-29 (FX-64): «سعّره» is whoever holds the pricing duty (prep or
  // approve) AND sees amounts — the QS office or the PM — exactly as the write.
  const canPrice = money && !access.ctx.archived && access.allowed("item.price")
  const canImport = !access.ctx.archived && access.allowed("boq.import")
  const canEditLines = canImport && planning
  const open = lines.find((b) => b.id === openId) ?? null
  const filtering = search.trim() !== "" || view !== "all"
  const divisionKeys = groups.flatMap((g) => (g.division === null ? [] : [g.division]))
  const allCollapsed = divisionKeys.length > 0 && divisionKeys.every((d) => collapsed.has(d))
  const columns = boqColumns({ t, money, canPrice, canEdit: canEditLines, totals: money && shown.length > 0 ? totals : null, onOpen: setOpenId, onPrice: setPricing, onEdit: setEditing })
  const toggleDivision = (d: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })

  if (!isLoading && lines.length === 0) {
    return (
      <section className="rounded-xl border bg-card">
        <EmptyState
          icon={TableProperties}
          title={t("boq.empty")}
          description={t("boq.empty_desc")}
          bare
          className="py-10"
          action={
            // CON-03: no import after the start — work outside the BOQ enters by a variation.
            canImport && planning ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setImporting(true)}>
                  <Plus size={15} className="me-1.5" aria-hidden="true" />
                  {t("boq.add")}
                </Button>
                {planning && (
                  <Button variant="outline" onClick={() => setEditing("new")}>
                    <Plus size={15} className="me-1.5" aria-hidden="true" />
                    {t("boq.item_add")}
                  </Button>
                )}
              </div>
            ) : canImport ? (
              <p className="text-xs text-muted-foreground">{t("boq.import_err.started")}</p>
            ) : undefined
          }
        />
        {canImport && planning && <ImportDialog open={importing} onOpenChange={setImporting} projectId={projectId} access={access} contractValue={contractValue} money={money} />}
        {editing && <BoqItemDialog projectId={projectId} access={access} money={money} line={null} existingCodes={[]} onClose={() => setEditing(null)} />}
      </section>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label={t("boq.views")} className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", counts.all, null],
              ["leak", counts.leak, "bad"],
              ["ub", counts.ub, "warn"],
              ["ns", counts.ns, null],
              ["done", counts.done, null],
            ] as const
          ).map(([id, n, tone]) => (
            <Chip key={id} selected={view === id} onClick={() => setView(id)}>
              {t(`boq.view.${id}`)}
              {n > 0 && (
              <span
                dir="ltr"
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums leading-5",
                  view === id ? "bg-white/20" : n > 0 && tone === "bad" ? "bg-destructive/10 text-destructive" : n > 0 && tone === "warn" ? "bg-warning/10 text-warning" : "bg-muted",
                )}
              >
                {n}
              </span>
              )}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto">
            <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("boq.search_ph")} aria-label={t("boq.search_ph")} className="h-9 w-full ps-8 sm:w-56" dir="auto" />
          </div>
          <Chip selected={bySection} icon={ListTree} onClick={() => setBySection((v) => !v)}>
            {t("boq.group")}
          </Chip>
          {canEditLines && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus size={14} className="me-1.5" aria-hidden="true" />
              {t("boq.item_add")}
            </Button>
          )}
          {bySection && divisionKeys.length > 1 && !filtering && (
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(divisionKeys))}>
              {t(allCollapsed ? "boq.expand_all" : "boq.collapse_all")}
            </Button>
          )}
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

      <DataTable<PmBoqLine>
        caption={t("boq.views")}
        columns={columns}
        rows={shown}
        rowKey={(b) => b.id}
        labels={TABLE_LABELS}
        empty={<EmptyState bare icon={Search} title={t("boq.none_match")} className="rounded-xl border bg-card" />}
        rowGroup={bySection ? (b) => ({ key: b.division, label: <GroupLabel group={groups.find((g) => g.division === b.division)} money={money} folded={!filtering && collapsed.has(b.division)} onToggle={toggleDivision} /> }) : undefined}
        foldedGroups={filtering ? undefined : collapsed}
        onRowClick={(b) => setOpenId(b.id)}
        maxHeight="70vh"
        dense
      />
      {money && totals.estimated && <FormHint>{t("boq.cost_estimated")}</FormHint>}

      <ItemDrawer projectId={projectId} orgId={orgId ?? null} line={open} lines={lines} money={money} onClose={() => setOpenId(null)} />
      {editing && (
        <BoqItemDialog
          key={editing === "new" ? "new" : editing.id}
          projectId={projectId}
          access={access}
          money={money}
          line={editing === "new" ? null : editing}
          existingCodes={lines.filter((l) => editing === "new" || l.id !== editing.id).map((l) => l.code)}
          onClose={() => setEditing(null)}
        />
      )}
      {pricing && <PriceDialog projectId={projectId} line={pricing} access={access} actor={actor} onClose={() => setPricing(null)} />}
    </div>
  )
}

/** The section row of the BOQ by division: fold toggle · name · count · contract value and earned share for money. */
function GroupLabel({ group, money, folded, onToggle }: { group: ReturnType<typeof groupLines>[number] | undefined; money: boolean; folded: boolean; onToggle: (division: string) => void }) {
  const t = useTranslations("Portal.PM")
  if (!group) return null
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-normal">
      <button
        type="button"
        aria-expanded={!folded}
        aria-label={t(folded ? "boq.expand_section" : "boq.collapse_section", { name: group.division || "—" })}
        onClick={() => onToggle(group.division ?? "")}
        className="inline-flex min-h-8 items-center gap-1.5 rounded text-start text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown size={14} className={cn("transition-transform", folded && "-rotate-90 rtl:rotate-90")} aria-hidden="true" />
        <b dir="auto">{group.division || "—"}</b>
        <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{group.lines.length}</span>
      </button>
      {money && (
        <span className="tabular-nums" dir="auto">
          {group.contract > 0
            ? t("boq.group_line", {
                value: pmMoney(group.contract),
                pct: pct((group.earned / group.contract) * 100),
              })
            : t("boq.no_rate")}
        </span>
      )}
    </span>
  )
}

/** The BOQ's columns: the item (opens the drawer), contracted, executed — and for money holders unbilled, cost, margin. */
function boqColumns({
  t,
  money,
  canPrice,
  canEdit,
  totals,
  onOpen,
  onPrice,
  onEdit,
}: {
  t: ReturnType<typeof useTranslations>
  money: boolean
  canPrice: boolean
  canEdit: boolean
  totals: ReturnType<typeof boqTotals> | null
  onOpen: (id: string) => void
  onPrice: (b: PmBoqLine) => void
  onEdit: (b: PmBoqLine) => void
}): DataColumn<PmBoqLine>[] {
  const cols: DataColumn<PmBoqLine>[] = [
    {
      key: "item",
      header: t("boq.col.item"),
      className: "min-w-0",
      footer: totals ? t("boq.total") : undefined,
      cell: (b) => (
        <div className="min-w-0">
          <button type="button" className="block rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(b.id)}>
            <b className="block" dir="auto">
              {b.description || "—"}
            </b>
          </button>
          <span className="flex flex-wrap items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <span className="font-mono" dir="ltr">
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
            {lineBleeding(b) && (
              <StatusPill tone="bad" className="px-1.5 py-0 text-[10px]">
                <Flame size={10} aria-hidden="true" />
                {t("boq.bleeding")}
              </StatusPill>
            )}
            {!linePriced(b) && canPrice && (
              <Button size="sm" className="h-7 px-2 text-[11px] max-md:h-11" onClick={() => onPrice(b)}>
                {t("boq.price_it")}
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] max-md:h-11" aria-label={t("boq.item_edit", { code: b.code })} onClick={() => onEdit(b)}>
                <Pencil size={11} className="me-1" aria-hidden="true" />
                {t("boq.edit")}
              </Button>
            )}
          </span>
        </div>
      ),
    },
    {
      key: "contracted",
      header: t("boq.col.contracted"),
      numeric: true,
      cell: (b) => (!money ? "•••" : linePriced(b) ? fmt(lineContract(b)) : "—"),
      footer: totals ? fmt(totals.contract) : undefined,
    },
    {
      key: "executed",
      header: t("boq.col.executed"),
      className: "min-w-36",
      footer: totals ? <bdi dir="ltr" className="tabular-nums">{pct(totals.progress)}</bdi> : undefined,
      cell: (b) => {
        const pr = lineProgress(b)
        return (
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums" dir="ltr">
              <span>
                {fmt(b.executed)} <small className="text-muted-foreground">{t("boq.of", { qty: fmt(b.quantity) })}</small>
              </span>
              <small>{pct(pr)}</small>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" dir="ltr" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, pr))} aria-label={t("boq.col.executed")}>
              <div className={cn("h-full rounded-full", pr >= 99.5 ? "bg-success" : "bg-module")} style={{ width: `${Math.min(100, pr)}%` }} />
            </div>
          </div>
        )
      },
    },
  ]
  if (!money) return cols
  cols.push(
    {
      key: "unbilled",
      header: t("boq.col.unbilled"),
      numeric: true,
      cell: (b) => {
        const ub = lineUnbilled(b)
        return <span className={ub > UNBILLED_FLOOR ? "text-destructive" : "text-muted-foreground"}>{ub > 1 ? fmt(ub) : "—"}</span>
      },
      footer: totals ? <span className="text-destructive">{fmt(totals.unbilled)}</span> : undefined,
    },
    {
      key: "cost",
      header: t("boq.col.cost"),
      className: "text-end",
      hideBelow: "lg",
      cell: (b) =>
        linePriced(b) ? (
          <span className="block tabular-nums">
            <bdi dir="ltr" className="block text-xs">
              {b.actual !== null ? fmt(b.actual) : "—"}
            </bdi>
            <span className="block text-[11px] text-muted-foreground">
              {t("boq.budget")} <bdi dir="ltr">{fmt(lineBudgetEx(b))}</bdi>
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      footer: totals ? <bdi dir="ltr" className="tabular-nums">{totals.costed ? fmt(totals.cost) : "—"}</bdi> : undefined,
    },
    {
      key: "margin",
      header: t("boq.col.margin"),
      className: "text-end",
      cell: (b) => {
        if (!linePriced(b)) return <span className="text-xs text-muted-foreground">—</span>
        if (b.estCost <= 0) return <span className="text-[11px] text-muted-foreground">{t("boq.no_budget_cost")}</span>
        const mg = lineMarginPct(b)
        return (
          <span className="block tabular-nums">
            <bdi dir="ltr" className={cn("rounded px-1.5 text-xs font-bold", mg > 12 ? "bg-success/10 text-success" : mg > 5 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive")}>
              {Math.round(mg)}%
            </bdi>
            <bdi dir="ltr" className="block text-[11px] text-muted-foreground">
              {fmt(lineMargin(b))}
            </bdi>
          </span>
        )
      },
      footer: totals ? (
        <bdi dir="ltr" className={cn("tabular-nums", !totals.costed ? "text-muted-foreground" : totals.margin > 0 ? "text-success" : "text-destructive")}>
          {totals.costed ? fmt(totals.margin) : "—"}
        </bdi>
      ) : undefined,
    },
  )
  return cols
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
  const poQ = useMemoFirebase(
    () => (firestore && on && orgId ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", orgId), where("projectId", "==", projectId)) : null),
    [firestore, on, orgId, projectId]
  )
  const { data: poData } = useCollection(poQ)
  const reqQ = useMemoFirebase(() => (firestore && on ? collection(firestore, "projects", projectId, PURCHASE_REQUESTS) : null), [firestore, projectId, on])
  const { data: reqData } = useCollection(reqQ)
  if (!line) return <Sheet open={false} onOpenChange={() => onClose()} />
  const vos = ((voData ?? []) as unknown as PmVariation[]).filter((v) => (v.itemIds ?? []).includes(line.id))
  const obs = ((obsData ?? []) as unknown as PmObstacle[]).filter((o) => isOpenObstacle(o) && o.itemIds.includes(line.id))
  const commit = itemCommitments({
    itemId: line.id,
    budget: line.quantity * line.estCost,
    quantity: line.quantity,
    subs: (scData ?? []) as unknown as PmSubcontract[],
    pos: (poData ?? []) as unknown as CommitPo[],
    requestLines: ((reqData ?? []) as Array<Record<string, unknown> & { id: string }>).map(requestOf).flatMap((r) => r.lines.filter((l) => l.itemId === line.id).map((l) => ({ poId: r.poId, name: l.name, unit: l.unit }))),
  })
  const unit = actualUnitCost(line)
  const over = lineOverBudget(line)
  const remaining = Math.max(0, line.quantity - line.executed)
  const mg = lineMarginPct(line)
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-2xl" dir={locale === "ar" ? "rtl" : "ltr"}>
        <SheetHeader className="pe-12 text-start">
          <SheetTitle dir="auto">{line.description || line.code}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <StatusPill tone="module">
              <span dir="ltr">{line.code}</span>
            </StatusPill>
            {line.division && <span dir="auto">{line.division}</span>}
            {lineBleeding(line) && (
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
                label={t("boq.d.committed_value")}
                value={commit.share === null ? fmt(commit.value) : t("boq.d.committed_value_of", { value: fmt(commit.value), pct: pct(commit.share * 100) })}
                ltr
              />
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
          <DrawerSection title={t("boq.d.commitments")} count={commit.rows.length}>
            {commit.rows.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">{t("boq.d.no_commitments")}</p>
            ) : (
              commit.rows.map((c) => (
                <div key={`${c.kind}-${c.id}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <b className="block truncate" dir="auto">
                      {c.party}
                    </b>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <span dir={c.kind === "po" ? "ltr" : "auto"}>{c.kind === "po" ? c.no : t("subs.contract_no", { no: subcontractNo(Number(c.no)) })}</span>
                      <span aria-hidden="true">·</span>
                      <SourceBadge module={c.kind === "po" ? "procurement" : "project-management"} label={t(c.kind === "po" ? "boq.d.commit_po" : "boq.d.commit_sub")} />
                      <span aria-hidden="true">·</span>
                      <span>{pmDate(c.day, locale)}</span>
                    </span>
                  </span>
                  {money && (
                    <span className="shrink-0 text-end">
                      <b className="block tabular-nums" dir="ltr">
                        {fmt(c.value)}
                      </b>
                      <span className="text-[11px] text-muted-foreground">{t("boq.d.commit_recv", { pct: pct(c.recv * 100) })}</span>
                    </span>
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
              ok={commit.rows.length > 0 || line.executed === 0}
              title={t("boq.d.committed")}
              note={
                commit.rows.length === 0
                  ? t("boq.d.no_commitment")
                  : commit.share === null
                    ? t("boq.d.committed_count", { count: commit.rows.length })
                    : t("boq.d.committed_pct", { pct: pct(commit.share * 100) })
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
      <DialogContent className="max-w-lg">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <DataTable<(typeof rows)[number]>
              caption={t("boq.import_title")}
              rows={rows}
              rowKey={(o) => String(o.line)}
              labels={TABLE_LABELS}
              empty={null}
              dense
              maxHeight="40vh"
              cardTitleKey="item"
              columns={[
                { key: "line", header: "#", numeric: true, cardHidden: true, className: "w-10 text-muted-foreground", cell: (o) => o.line },
                {
                  key: "item",
                  header: t("boq.col.item"),
                  cell: (o) => (
                    <>
                      <b className="block" dir="auto">
                        {o.description || "—"}
                      </b>
                      <span className="font-mono text-xs font-normal text-muted-foreground" dir="ltr">
                        {o.code} · {o.unit}
                      </span>
                    </>
                  ),
                },
                { key: "qty", header: t("boq.qty"), numeric: true, cell: (o) => (Number.isNaN(o.quantity) ? "—" : fmt(o.quantity)) },
                { key: "rate", header: t("boq.rate"), numeric: true, cell: (o) => (o.rate ? fmt(o.rate) : <span className="text-muted-foreground">{t("boq.no_rate")}</span>) },
                { key: "cost", header: t("boq.cost"), numeric: true, cell: (o) => (o.cost ? fmt(o.cost) : "—") },
                {
                  key: "verdict",
                  header: t("boq.verdict"),
                  cell: (o) =>
                    o.problems.length ? (
                      <span className="flex flex-wrap gap-1">
                        {o.problems.map((p) => (
                          <StatusPill key={p} tone="bad">
                            {t(`boq.problem.${p}`)}
                          </StatusPill>
                        ))}
                      </span>
                    ) : (
                      <StatusPill tone="ok">{t("boq.valid")}</StatusPill>
                    ),
                },
              ]}
            />
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
