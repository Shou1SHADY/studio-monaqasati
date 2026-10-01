"use client"

// Execution › Delivery units (the prototype's execZones / zSetup / openZone).
// Before the units exist: the one-time setup (count and label, an equal split —
// an assumption, stated; not before the BOQ has quantities). After: three
// figures (the project average and the spread it hides, units ready to hand
// over, units whose date is unrealistic),
// a card per unit (value, progress, what is left, planned day, the retention its
// handover releases, what blocks it, its pace against its date), what belongs
// to no unit, and a drawer with the unit's money, conditions and items. While
// nothing was measured on a unit and none is handed over, a split older than
// the BOQ can be made again. The retention shown is what the handover would
// free under the contract's release term, from what is held today.
// Money is shown only to those who see money.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc } from "firebase/firestore"
import { Box, Check, Clock, Eye, Hand, List, Loader2, Lock, RefreshCw, TrendingUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmUnits } from "@/hooks/usePmUnits"
import { defectsEnd, progressOf } from "@/lib/pm/acceptance"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import { isOpenOrFailed, PM_INSPECTIONS, type PmInspection } from "@/lib/pm/inspection"
import { isOpenPunch, PM_PUNCH, type PunchItem } from "@/lib/pm/punch"
import type { ContractTerms } from "@/lib/pm/terms"
import { handOverUnit, PmUnitError, resplitUnits, setUnitPlan, setUpUnits, type UnitActor } from "@/lib/pm/unit-writes"
import {
  boqValue,
  commonItems,
  resplitBlocks,
  splitGaps,
  unattributed,
  UNIT_DONE_AT,
  unitBlocks,
  unitClaimable,
  unitFigures,
  unitNeed,
  unitRate,
  unitRetention,
  unitState,
  unitTight,
  UNITS_MAX,
  UNITS_MIN,
  type PmUnit,
  type UnitBlock,
  type UnitState,
} from "@/lib/pm/units"
import { cn } from "@/lib/utils"

export interface UnitsItem {
  id: string
  code: string
  description: string
  unit?: string
  quantity: number
  rate: number
  executed: number
}

const STATE_TONE: Record<UnitState, PillTone> = { done: "ok", ready: "info", risk: "warn", work: "mute" }
const STATE_ICON = { done: Check, ready: Hand, risk: Clock, work: Box } as const

export function UnitsPanel({
  projectId,
  items,
  startedOn,
  terms,
  access,
  actor,
  actualCost,
}: {
  projectId: string
  items: UnitsItem[]
  startedOn: string | null
  terms: Pick<ContractTerms, "retention" | "retentionCap" | "retentionRelease" | "defectsDays"> | null
  access: PmAccess
  actor: UnitActor
  /** Actual cost of each item's executed work so far — the cost section's. */
  actualCost?: ReadonlyMap<string, number>
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const money = access.has("money")
  const canManage = !access.ctx.archived && access.allowed("deliveryUnit.manage")
  const { units, isLoading } = usePmUnits(projectId, true)
  const punchQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PUNCH) : null), [firestore, projectId])
  const wirQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_INSPECTIONS) : null), [firestore, projectId])
  const { data: punchData } = useCollection(punchQ)
  const { data: wirData } = useCollection(wirQ)
  // What is held and what the handovers already freed — the handover write reads the same two figures.
  const projectRef = useMemoFirebase(() => (firestore && money ? doc(firestore, "projects", projectId) : null), [firestore, projectId, money])
  const { data: projectDoc } = useDoc<{ pm?: { retentionHeld?: number; retentionFreed?: number } }>(projectRef)
  const held = Number(projectDoc?.pm?.retentionHeld) || 0
  const freed = Number(projectDoc?.pm?.retentionFreed) || 0
  const open = useMemo(
    () => ({
      punch: ((punchData ?? []) as unknown as PunchItem[]).filter(isOpenPunch),
      inspections: ((wirData ?? []) as unknown as PmInspection[]).filter(isOpenOrFailed),
    }),
    [punchData, wirData]
  )
  const [count, setCount] = useState("5")
  const [label, setLabel] = useState(t("units.label_default"))
  const [busy, setBusy] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const of = boqValue(items)
    return units.map((u) => {
      const f = unitFigures(u, items)
      const blocks = unitBlocks(u, items, open)
      const tight = unitTight(u, f, startedOn, today)
      // A unit still to hand over: what its handover would send now. One handed over: its half of what is held against it.
      const ret = !terms ? 0 : u.ho ? unitRetention(f.contract, terms, { held, of }) : unitClaimable(f.contract, terms, { held, of, freed })
      return { u, f, blocks, tight, state: unitState(u, blocks, tight), ret }
    })
  }, [units, items, open, startedOn, today, terms, held, freed])

  const fail = (err: unknown) => {
    console.error(err)
    toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmUnitError ? `units.err.${err.code}` : "error.save"), variant: "destructive" })
  }

  const blockText = (b: UnitBlock) =>
    b.key === "no_alloc" ? t("units.block.no_alloc") : b.key === "progress" ? t("units.block.progress", { pct: pmPct((b.pct ?? 0) / 100) }) : t(`units.block.${b.key}`, { count: b.n ?? 0 })

  const setup = async () => {
    const n = parseInt(count, 10)
    if (!firestore || !(n >= UNITS_MIN && n <= UNITS_MAX) || !label.trim()) return
    setBusy("setup")
    try {
      const made = await setUpUnits(firestore, access.ctx, projectId, actor, { count: n, label })
      toast({ title: t("units.created", { count: made }) })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const handOver = async (u: PmUnit) => {
    if (!firestore) return
    setBusy(u.id)
    try {
      const r = await handOverUnit(firestore, access.ctx, projectId, actor, u.id)
      toast({ title: t("units.handed", { name: u.name, amount: pmMoney(r.claimable) }) })
      setOpenId(null)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const resplit = async () => {
    if (!firestore) return
    setBusy("resplit")
    try {
      const n = await resplitUnits(firestore, access.ctx, projectId)
      toast({ title: t("units.resplit_done", { count: n }) })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const plan = async (u: PmUnit, day: string) => {
    if (!firestore) return
    try {
      await setUnitPlan(firestore, access.ctx, projectId, u.id, day || null)
    } catch (err) {
      fail(err)
    }
  }

  const intro = (
    <Callout tone="info">
      <span className="inline-flex items-start gap-2">
        <Box size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        {t("units.intro")}
      </span>
    </Callout>
  )

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="animate-spin text-muted-foreground" size={24} aria-hidden="true" />
      </div>
    )
  }

  if (!units.length) {
    const n = parseInt(count, 10)
    // Units share out the BOQ's quantities: with none, the write refuses — say so before the click.
    const noBoq = !items.some((i) => i.quantity > 0)
    return (
      <div className="flex flex-col gap-4">
        {intro}
        <Panel title={t("units.setup_title")} icon={Box} actions={<span className="text-xs text-muted-foreground">{t("units.setup_sub")}</span>}>
          <div className="flex flex-col gap-4">
            {noBoq ? <Callout tone="block">{t("units.err.no_boq")}</Callout> : <Callout tone="warn">{t("units.setup_note")}</Callout>}
            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="units-count">{t("units.count")}</Label>
                <Input id="units-count" type="number" min={UNITS_MIN} max={UNITS_MAX} dir="ltr" value={count} onChange={(e) => setCount(e.target.value)} disabled={!canManage} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="units-label">{t("units.label")}</Label>
                <Input id="units-label" dir="auto" value={label} placeholder={t("units.label_ph")} onChange={(e) => setLabel(e.target.value)} disabled={!canManage} />
              </div>
            </div>
            {canManage ? (
              <div>
                <Button onClick={setup} disabled={busy !== null || noBoq || !(n >= UNITS_MIN && n <= UNITS_MAX) || !label.trim()} className="gap-1.5">
                  {busy === "setup" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                  {t("units.create")}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("units.setup_who")}</p>
            )}
          </div>
        </Panel>
      </div>
    )
  }

  const prg = rows.map((r) => r.f.progress)
  const spread = Math.max(...prg) - Math.min(...prg)
  const ready = rows.filter((r) => r.state === "ready").length
  const done = rows.filter((r) => r.state === "done").length
  const tight = rows.filter((r) => r.tight)
  const common = commonItems(units, items)
  const commonValue = common.reduce((a, i) => a + i.quantity * Math.max(0, i.rate), 0)
  const commonDone = common.reduce((a, i) => a + i.executed * Math.max(0, i.rate), 0)
  const loose = unattributed(units, items)
  const avg = progressOf(items)
  const opened = rows.find((r) => r.u.id === openId) ?? null
  // BOQ lines the units do not share out as they stand — and whether the split may still be made again
  // (the write re-reads both, and the sheets, inside its transaction).
  const gaps = splitGaps(units, items)
  const canResplit = canManage && gaps > 0 && resplitBlocks(units, []).length === 0

  return (
    <div className="flex flex-col gap-4">
      {intro}
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure icon={TrendingUp} label={t("units.avg")} value={pmPct((avg ?? 0) / 100)} sub={spread >= 1 ? t("units.avg_spread", { n: Math.round(spread) }) : loose > 1 ? t("units.avg_loose") : t("units.avg_level")} />
        <Figure icon={Hand} label={t("units.ready")} value={t("units.of", { n: ready, total: units.length })} sub={done ? t("units.done_n", { count: done }) : t("units.done_none")} tone={ready ? "pos" : undefined} />
        <Figure icon={Clock} label={t("units.tight")} value={String(tight.length)} sub={t("units.tight_sub")} tone={tight.length ? "neg" : undefined} />
      </div>

      {canResplit && (
        <Callout tone="warn">
          <span className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 basis-64">{t("units.resplit_note", { count: gaps })}</span>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={resplit}>
              {busy === "resplit" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
              {t("units.resplit")}
            </Button>
          </span>
        </Callout>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ u, f, blocks, tight: tt, state, ret }) => {
          const Icon = STATE_ICON[state]
          const need = unitNeed(f.progress, u.plan, today)
          return (
            <article key={u.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <header className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-module/10 text-module">
                  <Box size={17} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-sm" dir="auto">
                    {u.name}
                  </b>
                  <small className="text-xs text-muted-foreground">{f.contract > 0 ? (money ? t("units.value", { amount: pmMoney(f.contract) }) : t("units.lines", { count: f.lines })) : t("units.block.no_alloc")}</small>
                </div>
                <StatusPill tone={STATE_TONE[state]}>
                  <Icon size={12} aria-hidden="true" />
                  {t(`units.state.${state}`)}
                </StatusPill>
              </header>
              <div className="flex items-center gap-2">
                <Bar pct={f.progress} tone={f.progress >= UNIT_DONE_AT ? "ok" : tt ? "warn" : "module"} />
                <b className="min-w-12 text-end text-xs tabular-nums" dir="ltr">
                  {pmPct(f.progress / 100)}
                </b>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">{t("units.left")}</dt>
                  <dd className="font-bold tabular-nums" dir="ltr">
                    {money ? pmMoney(Math.max(0, f.contract - f.earned)) : pmPct(Math.max(0, 100 - f.progress) / 100)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("units.date")}</dt>
                  <dd className="font-bold">{u.ho ? pmDate(u.ho.on, locale) : u.plan ? pmDate(u.plan, locale) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("units.ret")}</dt>
                  <dd className="font-bold tabular-nums" dir="ltr">
                    {money ? pmMoney(ret) : "—"}
                  </dd>
                </div>
              </dl>
              {u.ho ? (
                <Callout tone="info">{t("units.handed_note", { on: pmDate(u.ho.on, locale), end: pmDate(defectsEnd(u.ho.on, terms?.defectsDays ?? 365), locale) })}</Callout>
              ) : blocks.length ? (
                <Callout tone="block">
                  <span className="inline-flex items-start gap-1.5">
                    <Lock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      <b>{t("units.not_until")}</b> {blocks.map(blockText).join(" · ")}
                    </span>
                  </span>
                </Callout>
              ) : (
                <Callout tone="info">{t("units.all_met")}</Callout>
              )}
              {!u.ho && tt && need !== null && (
                <Callout tone="warn">{t("units.pace", { need: pmPct(need / 100), rate: pmPct(unitRate(f.progress, startedOn, today) / 100) })}</Callout>
              )}
              {!u.ho && tt && need === null && <Callout tone="warn">{t("units.pace_passed", { date: pmDate(u.plan, locale) })}</Callout>}
              <footer className="mt-auto flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpenId(u.id)}>
                  <Eye size={14} aria-hidden="true" />
                  {t("units.items")}
                </Button>
                {!u.ho && canManage && (
                  <>
                    <Button size="sm" variant={blocks.length ? "outline" : "default"} className="gap-1.5" disabled={blocks.length > 0 || busy !== null} onClick={() => handOver(u)}>
                      {busy === u.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Hand size={14} aria-hidden="true" />}
                      {t("units.hand_over")}
                    </Button>
                    <Input
                      type="date"
                      dir="ltr"
                      aria-label={t("units.plan_aria", { name: u.name })}
                      title={t("units.plan_aria", { name: u.name })}
                      className="h-9 min-w-32 flex-1 text-xs"
                      defaultValue={u.plan ?? ""}
                      onChange={(e) => plan(u, e.target.value)}
                    />
                  </>
                )}
              </footer>
            </article>
          )
        })}
      </div>

      {(loose > 1 || common.length > 0) && (
        <Panel title={t("units.loose_title")} icon={List} actions={<span className="text-xs text-muted-foreground">{t("units.loose_sub")}</span>} bodyClassName="p-0">
          <ul className="divide-y">
            {common.length > 0 && (
              <li className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <b className="text-sm">{t("units.common")}</b>
                  <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                    {common.map((i) => i.description || i.code).join(" · ")}
                  </p>
                </div>
                {money && (
                  <span className="text-end text-sm font-bold tabular-nums" dir="ltr">
                    {pmMoney(commonValue)}
                    <span className="block text-[11px] font-semibold text-muted-foreground">{t("units.executed_amt", { amount: pmMoney(commonDone) })}</span>
                  </span>
                )}
              </li>
            )}
            {loose > 1 && (
              <li className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <b className="text-sm text-warning">{t("units.loose")}</b>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("units.loose_note")}</p>
                </div>
                {money && (
                  <span className="text-sm font-bold tabular-nums text-warning" dir="ltr">
                    {pmMoney(loose)}
                  </span>
                )}
              </li>
            )}
          </ul>
        </Panel>
      )}

      <Sheet open={opened !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-lg">
          {opened && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2" dir="auto">
                  <Box size={17} className="text-module" aria-hidden="true" />
                  {opened.u.name}
                </SheetTitle>
                <SheetDescription>{t("units.drawer_sub", { count: opened.f.lines })}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label={t("units.d_value")} value={money ? pmMoney(opened.f.contract) : "—"} />
                  <Stat label={t("units.d_executed")} value={money ? pmMoney(opened.f.earned) : pmPct(opened.f.progress / 100)} sub={pmPct(opened.f.progress / 100)} />
                  <Stat
                    label={t("units.date")}
                    value={opened.u.ho ? pmDate(opened.u.ho.on, locale) : opened.u.plan ? pmDate(opened.u.plan, locale) : "—"}
                    sub={opened.u.ho ? t("units.state.done") : opened.u.plan ? undefined : t("units.not_set")}
                  />
                </div>
                {money && <UnitMoney figures={opened.f} unit={opened.u} items={items} actualCost={actualCost} ret={opened.ret} />}
                <DrawerSection title={t("units.conditions")}>
                  {opened.blocks.length ? (
                    <ul className="flex flex-col gap-1.5 py-1">
                      {opened.blocks.map((b) => (
                        <li key={b.key} className="flex items-center gap-1.5 text-sm text-destructive">
                          <X size={13} aria-hidden="true" />
                          {blockText(b)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="flex items-center gap-1.5 py-1 text-sm text-success">
                      <Check size={13} aria-hidden="true" />
                      {t("units.conditions_met")}
                    </p>
                  )}
                </DrawerSection>
                <DrawerSection title={t("units.items")} count={opened.f.lines}>
                  <ul className="divide-y">
                    {items
                      .filter((i) => (opened.u.lines[i.id]?.q ?? 0) > 0)
                      .map((i) => {
                        const l = opened.u.lines[i.id]
                        const pr = l.q > 0 ? (l.ex / l.q) * 100 : 0
                        return (
                          <li key={i.id} className="flex items-center gap-3 py-2">
                            <div className="min-w-0 flex-1">
                              <b className="block truncate text-xs" dir="auto">
                                {i.description || i.code}
                              </b>
                              <span className="text-[11px] text-muted-foreground" dir="auto">
                                {i.code} · {t("units.q_of", { ex: l.ex.toLocaleString("en-US"), q: l.q.toLocaleString("en-US"), unit: i.unit ?? "" })}
                              </span>
                            </div>
                            <div className="w-20">
                              <Bar pct={pr} tone={pr >= UNIT_DONE_AT ? "ok" : "module"} />
                            </div>
                            <span className="min-w-11 text-end text-xs tabular-nums" dir="ltr">
                              {pmPct(pr / 100)}
                            </span>
                          </li>
                        )
                      })}
                  </ul>
                </DrawerSection>
                {!opened.u.ho && canManage && (
                  <Button className="gap-1.5" disabled={opened.blocks.length > 0 || busy !== null} onClick={() => handOver(opened.u)}>
                    <Hand size={15} aria-hidden="true" />
                    {t("units.hand_over")}
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function UnitMoney({ figures, unit, items, actualCost, ret }: { figures: { contract: number; earned: number }; unit: PmUnit; items: UnitsItem[]; actualCost?: ReadonlyMap<string, number>; ret: number }) {
  const t = useTranslations("Portal.PM")
  const cost = actualCost
    ? items.reduce((a, i) => {
        const l = unit.lines[i.id]
        const c = actualCost.get(i.id)
        return l && c && i.executed > 0 ? a + (c * l.ex) / i.executed : a
      }, 0)
    : null
  const margin = cost === null ? null : figures.earned - cost
  return (
    <DrawerSection title={t("units.money")}>
      <KeyValueRow label={t("units.m_share")} value={pmMoney(figures.contract)} ltr />
      <KeyValueRow label={t("units.m_executed")} value={pmMoney(figures.earned)} ltr />
      <KeyValueRow label={t("units.m_cost")} value={cost === null ? "—" : pmMoney(cost)} ltr />
      <KeyValueRow
        label={t("units.m_margin")}
        value={<span className={cn(margin !== null && (margin > 0 ? "text-success" : "text-destructive"))}>{margin === null ? "—" : pmMoney(margin)}</span>}
        ltr
        strong
      />
      <KeyValueRow label={t("units.m_ret")} value={pmMoney(ret)} ltr />
    </DrawerSection>
  )
}

function Figure({ icon: Icon, label, value, sub, tone }: { icon: typeof Box; label: string; value: string; sub: string; tone?: "pos" | "neg" }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon size={12} aria-hidden="true" />
        {label}
      </span>
      <span className={cn("text-xl font-bold tabular-nums", tone === "pos" && "text-success", tone === "neg" && "text-destructive")} dir="auto">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2.5">
      <span className="block text-[11px] text-muted-foreground">{label}</span>
      <span className="block text-sm font-bold tabular-nums" dir="auto">
        {value}
      </span>
      {sub && <span className="block text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

function Bar({ pct, tone }: { pct: number; tone: "ok" | "warn" | "module" }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
      <span className={cn("block h-full rounded-full", tone === "ok" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-module")} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}
