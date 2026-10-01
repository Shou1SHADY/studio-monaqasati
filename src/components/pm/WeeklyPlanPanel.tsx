"use client"

// Execution › Site & the week (WF-21, WWP-01…05), as the prototype's laPanel
// and wwpPanel side by side: the three-week readiness — every activity that
// starts or runs soon with its computed constraints (nothing is committed
// before its constraints are cleared) — and the weekly plan: what we commit to
// this week, closed at its end with done or a reason for each task, PPC over
// the weeks and the most frequent reasons. A plan left open past its week
// stays in hand — the oldest first — until it is closed: it is closed exactly
// as the current one, and only then is a new week planned.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, CalendarRange, Check, ListChecks, Loader2, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmLookahead, type LookaheadSections } from "@/hooks/usePmLookahead"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, todayDay } from "@/lib/pm/format"
import { OBSTACLE_PARTIES } from "@/lib/pm/site"
import { closeWeekBlocks, commitBlocks, lookahead, MISS_REASONS, missReasonsTop, PM_WEEKS, ppc, ppcAverage, ppcTone, weekInHand, weekStart, type Constraint, type LookItem, type LookRow, type MissReason, type PmWeek } from "@/lib/pm/weekly-plan"
import { closeWeek, commitWeek, PmWeekError } from "@/lib/pm/weekly-plan-writes"
import { cn } from "@/lib/utils"

const SHOWN = 8

export function WeeklyPlanPanel({
  projectId,
  items,
  sections,
  access,
  actor,
}: {
  projectId: string
  items: Array<LookItem & { description?: string }>
  sections: LookaheadSections
  access: PmAccess
  actor: { uid: string; name: string | null }
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const { rows, facts } = usePmLookahead(projectId, items, sections, today)
  const weeksQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_WEEKS) : null), [firestore, projectId])
  const { data } = useCollection(weeksQ)
  const weeks = useMemo(() => ((data ?? []) as unknown as PmWeek[]).slice().sort((a, b) => b.week.localeCompare(a.week)), [data])
  const cur = weekInHand(weeks, today)
  const late = cur !== null && cur.status === "open" && cur.week < weekStart(today)
  const hist = weeks.filter((w) => w.status === "done")
  const avg = ppcAverage(weeks)
  const top = missReasonsTop(weeks)
  const blocked = rows.filter((r) => r.block.length > 0)
  const thisWeek = weeks.some((w) => w.week === weekStart(today))
  const can = !access.ctx.archived && access.allowed("weeklyPlan.manage")
  const [committing, setCommitting] = useState(false)
  const [closing, setClosing] = useState(false)
  const [sel, setSel] = useState<Record<string, string>>({})
  const [res, setRes] = useState<Array<{ done: boolean; why: MissReason | null; whyText: string }>>([])
  const [busy, setBusy] = useState(false)

  const unitOf = (r: LookRow) => items.find((i) => r.a.itemIds.includes(i.id))?.unit ?? ""
  const cText = (c: Constraint) => {
    const d = c.detail
    if (!d) return t(`wwp.c.${c.k}`)
    switch (d.kind) {
      case "stale":
        return t("wwp.cx.stale")
      case "sample":
        return t(`wwp.cx.sample_${d.state}`, { code: d.code })
      case "pred":
        return t("wwp.cx.pred", { name: d.name, pc: Math.round(d.pc) })
      case "failed":
        return t("wwp.cx.failed", { code: d.code })
      case "obstacle": {
        // The name typed for the party, else its code in the reader's language; addressed to nobody, the title stands alone.
        const party = d.partyName || (d.party !== "none" && (OBSTACLE_PARTIES as readonly string[]).includes(d.party) ? t(`site.obs.party.${d.party}`) : "")
        return party ? t("wwp.cx.obstacle", { title: d.title, party }) : d.title
      }
      case "no_permit":
        return t("wwp.cx.no_permit")
      case "materials":
        return d.count > 2 ? t("wwp.cx.materials_more", { names: d.names.join(" · "), count: d.count - 2 }) : t("wwp.cx.materials", { names: d.names.join(" · ") })
      case "plant":
        return t("wwp.cx.plant", { what: d.what })
    }
  }
  const when = (r: LookRow) => (r.startsIn > 0 ? t("wwp.starts_in", { count: r.startsIn }) : t("wwp.running", { count: -r.startsIn }))
  const codes = (r: LookRow) => items.filter((i) => r.a.itemIds.includes(i.id)).map((i) => i.code).join(" · ")

  const window2 = useMemo(() => lookahead(facts, today, 2), [facts, today])
  const chosen = Object.keys(sel)
  const risky = chosen.map((id) => window2.find((r) => r.a.id === id)).filter((r): r is LookRow => Boolean(r && r.block.length))
  const cBlocks = commitBlocks({ archived: access.ctx.archived, tasks: chosen.map((id) => ({ qty: Number(sel[id] || 0) })), exists: thisWeek })
  const xBlocks = cur ? closeWeekBlocks({ archived: access.ctx.archived, status: cur.status, results: res }) : []
  const livePc = res.length ? Math.round((res.filter((r) => r.done).length / res.length) * 100) : 0
  const noWhy = res.filter((r) => !r.done && (!r.why || (r.why === "other" && !r.whyText.trim()))).length

  const fail = (err: unknown) => {
    console.error(err)
    toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmWeekError && err.blocks[0] ? `wwp.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
  }

  const commit = async () => {
    if (!firestore || cBlocks.length) return
    setBusy(true)
    try {
      const tasks = chosen.map((id) => {
        const r = window2.find((x) => x.a.id === id)
        return { activityId: id, name: r?.a.name ?? "", qty: Number(sel[id] || 0), unit: r ? unitOf(r) : null, ready: r ? r.block.length === 0 : false, open: r?.block.map((c) => c.k) ?? [] }
      })
      await commitWeek(firestore, access.ctx, projectId, actor, tasks)
      const n = tasks.filter((x) => !x.ready).length
      toast({ title: t("wwp.committed", { count: tasks.length }), description: n ? t("wwp.committed_risky", { count: n }) : undefined })
      setCommitting(false)
      setSel({})
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const close = async () => {
    if (!firestore || !cur || xBlocks.length) return
    setBusy(true)
    try {
      const pc = await closeWeek(firestore, access.ctx, projectId, actor, cur.week, res)
      toast({ title: t("wwp.closed", { pc }) })
      setClosing(false)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title={t("wwp.la_title")}
        icon={CalendarRange}
        bodyClassName="p-0"
        actions={<StatusPill tone={blocked.length ? "bad" : "ok"}>{blocked.length ? t("wwp.n_blocked", { count: blocked.length }) : t("wwp.all_clear")}</StatusPill>}
      >
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("wwp.la_sub")}</p>
        {rows.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-muted-foreground">{t("wwp.la_empty")}</p>
        ) : (
          <ul className="divide-y">
            {rows.slice(0, SHOWN).map((r) => {
              const ok = r.block.length === 0
              return (
                <li key={r.a.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                    {ok ? <Check size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-sm font-bold" dir="auto">
                      {r.a.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {when(r)} · <span dir="ltr">{codes(r)}</span> · <span dir="ltr">{Math.round(r.pc)}%</span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.cs.map((c) => (
                        <StatusPill key={c.k} tone={c.ok === false ? "bad" : c.ok === null ? "mute" : "ok"} className="px-2 py-0 text-[11px]">
                          {c.ok === false ? <X size={10} aria-hidden="true" /> : c.ok ? <Check size={10} aria-hidden="true" /> : null}
                          {t(`wwp.c.${c.k}`)}
                        </StatusPill>
                      ))}
                    </div>
                    {r.block.length > 0 && (
                      <p className="mt-1 text-xs font-bold text-destructive" dir="auto">
                        {r.block.map(cText).join(" · ")}
                      </p>
                    )}
                  </div>
                  <StatusPill tone={ok ? "ok" : "bad"}>{ok ? t("wwp.ready") : t("wwp.n_constraints", { count: r.block.length })}</StatusPill>
                </li>
              )
            })}
          </ul>
        )}
        {rows.length > SHOWN && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t("wwp.more", { count: rows.length - SHOWN })}</p>}
      </Panel>

      <Panel
        title={t("wwp.title")}
        icon={ListChecks}
        bodyClassName="p-0"
        actions={
          <>
            {avg !== null && <StatusPill tone={ppcTone(avg)}>{t("wwp.ppc_pill", { pc: avg })}</StatusPill>}
            {can &&
              (cur && cur.status === "open" ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setRes(cur.tasks.map(() => ({ done: false, why: null, whyText: "" })))
                    setClosing(true)
                  }}
                >
                  <Check size={15} className="me-1.5" aria-hidden="true" />
                  {t("wwp.close")}
                </Button>
              ) : (
                <Button size="sm" onClick={() => setCommitting(true)} disabled={thisWeek}>
                  <Plus size={15} className="me-1.5" aria-hidden="true" />
                  {t("wwp.plan")}
                </Button>
              ))}
          </>
        }
      >
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("wwp.sub")}</p>
        {cur && cur.status === "open" ? (
          <>
            {late ? (
              <p className="px-4 pt-3 text-xs font-semibold text-warning">{t("wwp.late_week", { date: pmDate(cur.week, locale) })}</p>
            ) : (
              <p className="px-4 pt-3 text-xs text-muted-foreground">
                {t("wwp.committed_n", { count: cur.tasks.length })}
                {cur.tasks.some((x) => !x.ready) ? ` — ${t("wwp.with_open", { count: cur.tasks.filter((x) => !x.ready).length })}` : ""}
              </p>
            )}
            <ul className="divide-y">
              {cur.tasks.map((x, i) => (
                <li key={`${x.activityId}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" dir="auto">
                      {x.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {x.qty ? (
                        <>
                          <span dir="ltr">{x.qty}</span> {x.unit} ·{" "}
                        </>
                      ) : null}
                      {x.ready ? t("wwp.was_ready") : <span className="text-warning">{t("wwp.was_not_ready")}</span>}
                    </p>
                  </div>
                  <StatusPill tone="mute">{t("wwp.in_progress")}</StatusPill>
                </li>
              ))}
            </ul>
          </>
        ) : cur ? (
          <>
            <p className="px-4 pt-3 text-xs text-muted-foreground">{t("wwp.closed_line", { date: pmDate(cur.week, locale), pc: ppc(cur) })}</p>
            <ul className="divide-y">
              {cur.tasks.map((x, i) => (
                <li key={`${x.activityId}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" dir="auto">
                      {x.name}
                    </p>
                    {!x.done && x.why && (
                      <p className="text-xs text-destructive" dir="auto">
                        {t("wwp.missed")}: {x.why === "other" && x.whyText ? `${t("wwp.why.other")}: ${x.whyText}` : t(`wwp.why.${x.why}`)}
                      </p>
                    )}
                  </div>
                  <StatusPill tone={x.done ? "ok" : "bad"}>{x.done ? t("wwp.done") : t("wwp.missed")}</StatusPill>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="px-4 py-5 text-center text-sm text-muted-foreground">{t("wwp.empty")}</p>
        )}
        {hist.length > 0 && (
          <div className="space-y-2 border-t bg-muted/30 px-4 py-3 text-xs">
            <p className="flex flex-wrap items-center gap-1">
              <b>{t("wwp.ppc_weeks")}:</b>
              {hist.slice(0, 8).map((w) => (
                <StatusPill key={w.week} tone={ppcTone(ppc(w))} className="px-2 py-0">
                  <span dir="ltr">{ppc(w)}%</span>
                </StatusPill>
              ))}
            </p>
            {top.length > 0 && (
              <p>
                <b>{t("wwp.top")}:</b> {top.slice(0, 3).map((x) => `${t(`wwp.why.${x.k}`)} (${x.n})`).join(" · ")} — {t("wwp.top_note")}
              </p>
            )}
          </div>
        )}
      </Panel>

      <Dialog open={committing} onOpenChange={setCommitting}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("wwp.plan_title")}</DialogTitle>
            <DialogDescription>{t("wwp.plan_note")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {window2.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("wwp.plan_empty")}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {window2.map((r) => {
                  const on = r.a.id in sel
                  const ok = r.block.length === 0
                  return (
                    <li key={r.a.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setSel((s) => {
                            const n = { ...s }
                            if (on) delete n[r.a.id]
                            else n[r.a.id] = ""
                            return n
                          })
                        }
                        className="min-h-11 min-w-0 flex-1 basis-48 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <p className="text-sm font-bold" dir="auto">
                          {on ? "✓ " : ""}
                          {r.a.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span dir="ltr">{codes(r)}</span> · <span dir="ltr">{Math.round(r.pc)}%</span>
                        </p>
                        <p className={cn("text-xs font-bold", ok ? "text-success" : "text-destructive")} dir="auto">
                          {ok ? t("wwp.ready_none") : r.block.map(cText).join(" · ")}
                        </p>
                      </button>
                      {on && (
                        <div className="flex items-center gap-2">
                          <Input aria-label={t("wwp.qty_for", { name: r.a.name })} type="number" min="0" step="0.01" dir="ltr" placeholder={t("wwp.qty")} value={sel[r.a.id]} onChange={(e) => setSel((s) => ({ ...s, [r.a.id]: e.target.value }))} className="h-11 w-24" />
                          <span className="text-xs text-muted-foreground">{unitOf(r)}</span>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {risky.length > 0 && <Callout tone="block">{t("wwp.risky", { count: risky.length, list: risky.slice(0, 2).map((r) => cText(r.block[0])).join(" · ") })}</Callout>}
            <BlockingReasons title={t("cannot_save")} reasons={cBlocks.map((b) => t(`wwp.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommitting(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void commit()} disabled={busy || cBlocks.length > 0}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("wwp.commit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("wwp.close_title")}</DialogTitle>
            <DialogDescription>{t("wwp.close_note")}</DialogDescription>
          </DialogHeader>
          {cur && (
            <div className="space-y-3">
              <ul className="divide-y rounded-xl border">
                {cur.tasks.map((x, i) => {
                  const r = res[i] ?? { done: false, why: null, whyText: "" }
                  const set = (patch: Partial<typeof r>) => setRes((all) => all.map((y, j) => (j === i ? { ...y, ...patch } : y)))
                  return (
                    <li key={`${x.activityId}-${i}`} className="space-y-2 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold" dir="auto">
                            {x.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {x.qty ? `${x.qty} ${x.unit ?? ""}` : ""}
                            {x.ready ? "" : ` · ${t("wwp.was_not_ready")}`}
                          </p>
                        </div>
                        <Button size="sm" variant={r.done ? "default" : "outline"} aria-pressed={r.done} onClick={() => set({ done: !r.done })} className="min-w-28">
                          {r.done ? <Check size={14} className="me-1.5" aria-hidden="true" /> : null}
                          {r.done ? t("wwp.done") : t("wwp.not_done")}
                        </Button>
                      </div>
                      {!r.done && (
                        <>
                          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("wwp.why_label")}>
                            {MISS_REASONS.map((k) => (
                              <button
                                key={k}
                                type="button"
                                role="radio"
                                aria-checked={r.why === k}
                                onClick={() => set({ why: k })}
                                className={cn(
                                  "min-h-9 rounded-full border px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  r.why === k ? "border-module bg-module text-module-foreground" : "hover:border-module/40"
                                )}
                              >
                                {t(`wwp.why.${k}`)}
                              </button>
                            ))}
                          </div>
                          {r.why === "other" && (
                            <div className="space-y-1">
                              <Label htmlFor={`wwp-oth-${i}`} className="sr-only">
                                {t("wwp.why_other")}
                              </Label>
                              <Input id={`wwp-oth-${i}`} value={r.whyText} placeholder={t("wwp.why_other")} onChange={(e) => set({ whyText: e.target.value })} dir="auto" />
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
              <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3 text-sm">
                <span className="font-semibold">{t("wwp.ppc_full")}</span>
                <b className={cn("tabular-nums", ppcTone(livePc) === "ok" ? "text-success" : ppcTone(livePc) === "warn" ? "text-warning" : "text-destructive")} dir="ltr">
                  {livePc}%
                </b>
              </div>
              {noWhy > 0 && <Callout tone="warn">{t("wwp.no_why", { count: noWhy })}</Callout>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void close()} disabled={busy || xBlocks.length > 0}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("wwp.close_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
