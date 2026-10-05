"use client"

// «المنصات» (GV-01…04, optional: gov — the prototype's VIEWS.pf): what must be done on Qiwa, GOSI, Muqeem,
// health insurance, Traffic, HRDF and Mudad, computed from the record and grouped by platform, each with its
// first action — done THERE, recorded HERE (no connection to any platform); the platforms with what we output
// to each and import from it, its last reconciliation, and the switch to stop following it (the HR manager);
// who differed at the last reconciliations; and the establishment's Nitaqat with a what-if for a hire or an
// exit. Government relations' tab — the HR manager's when nobody holds that role; never management's.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { ArrowLeftRight, Calculator, CheckCircle2, ClipboardList, FileUp, Landmark, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, Figure, type DataColumn } from "@/components/module-ui/DataTable"
import type { ModuleKpi } from "@/components/module-ui/ModuleHeader"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrGovDocs } from "@/hooks/useHrGovDocs"
import { useHrToday } from "@/hooks/useHrToday"
import { usePermissions } from "@/hooks/usePermissions"
import { useTableLabels } from "@/hooks/useTableLabels"
import { Link } from "@/i18n/routing"
import type { HrEmployee } from "@/lib/hr/employee"
import { setExitTask } from "@/lib/hr/exit-writes"
import { empNo, hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { recordPlatformDone, saveReconciliation, setPlatformSwitch } from "@/lib/hr/platform-writes"
import {
  IMPORTS,
  nitaqatAfter,
  parseReconCsv,
  platformOn,
  platformTasks,
  PLATFORMS,
  RECON_PLATFORMS,
  reconcile,
  reconValue,
  taskSummary,
  WAGE_RECON,
  type DiffKind,
  type GovDoc,
  type PlatformTask,
  type ReconDiff,
  type ReconPlatform,
} from "@/lib/hr/platforms"
import { nitaqatOf } from "@/lib/hr/settings"
import { recordExitVisa } from "@/lib/hr/today-writes"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import { NitaqatPanel } from "./HrSettingsView"
import type { HrPortal } from "./HrShell"

/** Rows per platform before «عرض N أخرى» (the prototype's `clipped(…, 4)`). */
const CLIP = 4
const DIFF_TONE: Record<DiffKind, PillTone> = { diff: "warn", miss: "bad", gone: "bad", unk: "bad" }

/** The world the tab reads — the same reads Today does — and the tasks it computes. */
function usePlatformWorld(access: HrAccess) {
  const today = todayDay()
  const world = useHrToday(access, today)
  const docs = useHrGovDocs(access, access.settings.features.includes("gov"))
  const tasks = useMemo(
    () =>
      platformTasks({
        today,
        employees: world.employees,
        requests: world.requests,
        exits: world.exits,
        injuries: world.injuries,
        payrolls: world.payrolls,
        docs,
        switches: access.settings.platforms,
        renewWindowDays: access.settings.policies.renewWindowDays,
        selfId: access.ctx.employeeId,
      }),
    [today, world, docs, access.settings, access.ctx.employeeId]
  )
  return { today, world, docs, tasks }
}

const recons = (docs: GovDoc[], access: HrAccess) => docs.filter((d) => d.kind === "recon" && platformOn(access.settings.platforms, d.pf))

/** The header's three numbers (the prototype's K): open tasks, differences at the last reconciliations, the oldest. */
export function usePlatformsKpis(access: HrAccess): ModuleKpi[] | undefined {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const { tasks, docs } = usePlatformWorld(access)
  return useMemo(() => {
    const s = taskSummary(tasks)
    const last = recons(docs, access)
    const diffs = last.reduce((a, d) => a + (d.diff ?? 0), 0)
    const followed = RECON_PLATFORMS.filter((pf) => platformOn(access.settings.platforms, pf))
    const ats = followed.map((pf) => last.find((d) => d.pf === pf)?.at ?? null)
    const oldest = ats.some((x) => x == null) ? null : ats.sort()[0]
    return [
      { id: "open", label: t("pf.kpi.open"), value: String(s.total), note: s.late ? t("pf.kpi.open_late", { n: s.late }) : t("pf.kpi.open_none"), tone: s.late ? "bad" : s.total ? "warn" : "good", icon: ClipboardList },
      { id: "diffs", label: t("pf.kpi.diffs"), value: String(diffs), note: t("pf.kpi.diffs_note"), tone: diffs ? "warn" : "good", icon: ArrowLeftRight },
      { id: "oldest", label: t("pf.kpi.oldest"), value: oldest ? hrDate(oldest, locale) : t("pf.kpi.never"), note: t("pf.kpi.oldest_note"), tone: "neutral", icon: Landmark },
    ]
  }, [tasks, docs, access, t, locale])
}

function useActor() {
  const { user } = useUser()
  const { profile } = usePermissions()
  return { uid: user?.uid ?? "", name: (profile?.name as string) || user?.displayName || null }
}

export function HrPlatformsView({ access, portal }: { access: HrAccess; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const actor = useActor()
  const labels = useTableLabels()
  const { today, world, docs, tasks } = usePlatformWorld(access)
  const [more, setMore] = useState<Record<string, boolean>>({})
  const [gt, setGt] = useState<PlatformTask | null>(null)
  const [recon, setRecon] = useState<ReconPlatform | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const can = access.allowed("platform.tasks")
  const manages = access.allowed("settings.manage")
  const sw = access.settings.platforms
  const byId = useMemo(() => new Map(world.employees.map((e) => [e.id, e])), [world.employees])
  const siteName = (id: string | null | undefined) => (!id || id === UNASSIGNED_SITE ? t("sites.unassigned") : (world.sites.find((s) => s.id === id)?.name ?? "—"))
  const last = recons(docs, access)

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (!firestore || !access.orgId) return
    setBusy(key)
    try {
      await fn()
      toast({ title: ok })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const taskText = (x: PlatformTask) => t(`pf.task.${x.code}`, { ...x.params, on: x.params.on ? hrDate(String(x.params.on), locale) : "", from: x.params.from ? hrDate(String(x.params.from), locale) : "", month: String(x.params.month ?? "") })

  /** The task's first action: recorded here, or opened where its record lives. */
  const action = (x: PlatformTask) => {
    if (!can) return null
    const a = x.action
    const person = x.employeeId ? `/${portal}/hr/people/${x.employeeId}` : null
    if (a.kind === "done")
      return (
        <Button size="sm" variant="outline" onClick={() => setGt(x)}>
          {t("pf.btn.done")}
        </Button>
      )
    if (a.kind === "exit")
      return (
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run(x.key, () => setExitTask(firestore!, access.ctx, actor, a.exitId, a.task, true), t("pf.saved"))}>
          {busy === x.key && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
          {t("pf.btn.done")}
        </Button>
      )
    if (a.kind === "exit_visa")
      return (
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run(x.key, () => recordExitVisa(firestore!, access.ctx, actor, a.requestId), t("today.exit_visa_done"))}>
          {busy === x.key && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
          {t("pf.btn.recorded")}
        </Button>
      )
    if (a.kind === "mudad")
      return access.allowed("pay.view") ? (
        <Button asChild size="sm" variant="outline">
          <Link href={`/${portal}/hr/payroll`}>{t("pf.btn.status")}</Link>
        </Button>
      ) : null
    if (!person) return null
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={person}>{t(a.kind === "injury" ? "pf.btn.report" : x.code === "iq" ? "pf.btn.issue" : "pf.btn.record")}</Link>
      </Button>
    )
  }

  const byPf = PLATFORMS.map((pf) => ({ pf, list: tasks.filter((x) => x.pf === pf) })).filter((g) => g.list.length)

  const diffRows = last.flatMap((d) => (d.rows ?? []).map((r, i) => ({ ...r, pf: d.pf, id: `${d.pf}-${i}` })))
  const diffColumns: DataColumn<(typeof diffRows)[number]>[] = [
    { key: "pf", header: t("pf.col.platform"), cell: (r) => t(`pf.short_name.${r.pf}`), sortValue: (r) => r.pf },
    {
      key: "who",
      header: t("pf.col.who"),
      cell: (r) => {
        const e = r.employeeId ? byId.get(r.employeeId) : undefined
        return e ? (
          <Link href={`/${portal}/hr/people/${e.id}`} className="rounded font-semibold hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
            {e.names.ar}
          </Link>
        ) : (
          <span className="text-muted-foreground">{t("pf.unknown_no", { no: r.no })}</span>
        )
      },
      sortValue: (r) => (r.employeeId ? (byId.get(r.employeeId)?.names.ar ?? "") : r.no),
    },
    { key: "what", header: t("pf.col.what"), cell: (r) => <StatusPill tone={DIFF_TONE[r.k]}>{t(`pf.k.${r.k}`)}</StatusPill>, sortValue: (r) => r.k },
  ]

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Panel title={t("pf.todo")} icon={ClipboardList} count={tasks.length || undefined} countTone={tasks.some((x) => x.late) ? "bad" : "mute"} bodyClassName="p-0">
            <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("pf.todo_sub")}</p>
            {byPf.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm font-semibold text-muted-foreground">{t("pf.none")}</p>
            ) : (
              byPf.map(({ pf, list }) => {
                const shown = more[pf] ? list : list.slice(0, CLIP)
                return (
                  <section key={pf} aria-label={t(`pf.name.${pf}`)} className="border-b last:border-b-0">
                    <h3 className="flex items-center justify-between gap-2 bg-muted/40 px-4 py-1.5 text-xs font-bold text-muted-foreground">
                      <span>{t(`pf.name.${pf}`)}</span>
                      <span className="tabular-nums">{list.length}</span>
                    </h3>
                    <ul className="divide-y">
                      {shown.map((x) => {
                        const e = x.employeeId ? byId.get(x.employeeId) : undefined
                        return (
                          <li key={x.key} className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2.5", x.late && "border-s-4 border-s-destructive")}>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-bold" dir="auto">
                                {x.name ? (
                                  e ? (
                                    <Link href={`/${portal}/hr/people/${e.id}`} className="rounded hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                      {x.name}
                                    </Link>
                                  ) : (
                                    x.name
                                  )
                                ) : null}
                                {x.name ? " — " : ""}
                                {taskText(x)}
                              </span>
                              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                                {x.late ? <StatusPill tone="bad">{t("pf.overdue", { date: hrDate(x.due, locale) })}</StatusPill> : <span>{t("pf.by", { date: hrDate(x.due, locale) })}</span>}
                                {e && <span>· {t(`trade.${e.trade}` as "trade.mason")}</span>}
                                {e && <span dir="auto">· {siteName(e.siteId)}</span>}
                              </span>
                            </span>
                            {action(x)}
                          </li>
                        )
                      })}
                    </ul>
                    {list.length > CLIP && (
                      <Button variant="ghost" size="sm" className="w-full" aria-expanded={Boolean(more[pf])} onClick={() => setMore((m) => ({ ...m, [pf]: !m[pf] }))}>
                        {more[pf] ? t("today.show_less") : t("today.show_more", { n: list.length - CLIP })}
                      </Button>
                    )}
                  </section>
                )
              })
            )}
          </Panel>

          <Panel title={t("pf.diffs_title")} icon={ArrowLeftRight} count={diffRows.length || undefined} bodyClassName="p-0">
            <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("pf.diffs_sub")}</p>
            <DataTable
              caption={t("pf.diffs_title")}
              labels={labels}
              dense
              bordered={false}
              columns={diffColumns}
              rows={diffRows}
              rowKey={(r) => r.id}
              rowTone={(r) => (r.k === "diff" ? "warn" : "bad")}
              pageSize={10}
              empty={<p className="px-4 py-4 text-sm text-muted-foreground">{t("pf.diffs_none")}</p>}
            />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title={t("pf.authorities")} icon={Landmark} bodyClassName="p-0">
            <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("pf.authorities_sub")}</p>
            <ul className="divide-y">
              {PLATFORMS.map((pf) => {
                const on = platformOn(sw, pf)
                const l = last.find((d) => d.pf === pf)
                const reconcilable = (RECON_PLATFORMS as readonly string[]).includes(pf)
                return (
                  <li key={pf} className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 py-2.5", !on && "opacity-60")}>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="flex flex-wrap items-center gap-2 font-bold">
                        {t(`pf.name.${pf}`)}
                        {!on && <StatusPill tone="mute">{t("pf.off_pill")}</StatusPill>}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t("pf.out_label")}: {t(`pf.out.${pf}`)}
                      </span>
                      {IMPORTS.has(pf) && (
                        <span className="block text-xs text-muted-foreground">
                          {t("pf.in_label")}: {t(`pf.in.${pf}` as "pf.in.qiwa")}
                          {reconcilable && ` · ${l ? t("pf.last", { date: hrDate(l.at, locale), n: l.diff ?? 0 }) : t("pf.never")}`}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {reconcilable && on && can && (
                        <Button size="sm" variant="outline" onClick={() => setRecon(pf as ReconPlatform)}>
                          <FileUp size={14} className="me-1.5" aria-hidden="true" />
                          {t("pf.reconcile")}
                        </Button>
                      )}
                      {manages && (
                        <Button size="sm" variant="outline" disabled={busy !== null} aria-pressed={on} onClick={() => void run(`sw:${pf}`, () => setPlatformSwitch(firestore!, access.ctx, access.orgId!, access.settings, pf, !on, actor), t(on ? "pf.switched_off" : "pf.switched_on"))}>
                          {t(on ? "pf.off" : "pf.on")}
                        </Button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Panel>

          <NitaqatPanel access={access} employees={world.employees} compact />
          <WhatIfPanel access={access} employees={world.employees} />
        </div>
      </div>

      <GtDialog access={access} task={gt} live={gt ? tasks.some((x) => x.key === gt.key) : false} employee={gt?.employeeId ? byId.get(gt.employeeId) : undefined} text={gt ? taskText(gt) : ""} onClose={() => setGt(null)} />
      {recon && <ReconDialog access={access} pf={recon} employees={world.employees} pays={world.pays} docs={docs} today={today} portal={portal} onClose={() => setRecon(null)} />}
    </div>
  )
}

/** ST-04 — what a hire or an exit does to the Saudi ratio and the safety margin. */
function WhatIfPanel({ access, employees }: { access: HrAccess; employees: HrEmployee[] }) {
  const t = useTranslations("Portal.HR")
  const [sa, setSa] = useState(0)
  const [non, setNon] = useState(0)
  const base = nitaqatOf(employees, access.settings.establishment)
  const after = nitaqatAfter(base, base.min, { saudis: sa, others: non })
  const num = (v: string) => (v === "" || v === "-" ? 0 : Math.max(-999, Math.min(999, Math.trunc(Number(v)) || 0)))
  return (
    <Panel title={t("pf.whatif")} icon={Calculator}>
      <p className="mb-3 text-xs text-muted-foreground">{t("pf.whatif_sub")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pf-wi-sa">{t("pf.whatif_sa")}</Label>
          <Input id="pf-wi-sa" type="number" step="1" dir="ltr" value={String(sa)} onChange={(e) => setSa(num(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-wi-non">{t("pf.whatif_non")}</Label>
          <Input id="pf-wi-non" type="number" step="1" dir="ltr" value={String(non)} onChange={(e) => setNon(num(e.target.value))} />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">{t("pf.whatif_hint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-3 text-sm" aria-live="polite">
        <span>{t("pf.whatif_ratio", { pct: after.pct, sa: after.saudis, total: after.total, before: base.pct })}</span>
        {after.short == null ? (
          <StatusPill tone="mute">{t("settings.margin_unknown")}</StatusPill>
        ) : after.short > 0 ? (
          <StatusPill tone="bad">{t("settings.margin_short", { n: after.short })}</StatusPill>
        ) : (
          <StatusPill tone="ok">{t("settings.margin_spare", { n: after.spare ?? 0 })}</StatusPill>
        )}
      </div>
    </Panel>
  )
}

/** «سجّل أنه تمّ» — the act is done on the platform itself; here it is recorded, with its reference. */
function GtDialog({ access, task, live, employee, text, onClose }: { access: HrAccess; task: PlatformTask | null; live: boolean; employee?: HrEmployee; text: string; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const actor = useActor()
  const schema = z.object({ ref: z.string().trim().max(60, t("pf.ref_long")) })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { ref: "" } })
  useEffect(() => {
    if (task) form.reset({ ref: "" })
  }, [task?.key])
  const submit = form.handleSubmit(async (v) => {
    if (!firestore || !access.orgId || !task) return
    try {
      await recordPlatformDone(firestore, access.ctx, access.orgId, actor, task, { ref: v.ref || null })
      toast({ title: t("pf.saved") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    }
  })
  return (
    <Dialog open={task !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? `${t(`pf.name.${task.pf}`)} — ${text}` : ""}</DialogTitle>
          {employee && (
            <DialogDescription dir="auto">
              {employee.names.ar} · {t(`trade.${employee.trade}` as "trade.mason")}
            </DialogDescription>
          )}
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-3">
            <Callout tone="info">{t("pf.gt_info")}</Callout>
            {!live && <Callout tone="warn">{t("pf.gt_gone")}</Callout>}
            <FormField
              control={form.control}
              name="ref"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("pf.gt_ref")}</FormLabel>
                  <FormControl>
                    <Input dir="ltr" {...field} />
                  </FormControl>
                  <p className="text-[11px] text-muted-foreground">{t("pf.optional")}</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={!live || form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} className="me-1.5" aria-hidden="true" />}
                {t("pf.gt_submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

type ReconResult = { diffs: ReconDiff[]; n: number; matched: number; bad: number }

/** «مطابقة — <جهة>»: their exported report (a file, or typed / pasted), compared with the record — differences
 * only; a wage is compared for a pay role alone (RL-03). */
function ReconDialog({
  access,
  pf,
  employees,
  pays,
  docs,
  today,
  portal,
  onClose,
}: {
  access: HrAccess
  pf: ReconPlatform
  employees: HrEmployee[]
  pays: ReturnType<typeof useHrToday>["pays"]
  docs: GovDoc[]
  today: string
  portal: HrPortal
  onClose: () => void
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const actor = useActor()
  const labels = useTableLabels()
  const [text, setText] = useState("")
  const [result, setResult] = useState<ReconResult | null>(null)
  const [take, setTake] = useState(false)
  const [saving, setSaving] = useState(false)
  const wage = WAGE_RECON.has(pf)
  const seesValue = !wage || access.allowed("pay.view")
  const mayTake = pf === "qiwa" ? access.allowed("pay.change") : pf === "gosi" ? seesValue : true
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  const readFile = (f: File | undefined) => {
    if (!f) return
    const r = new FileReader()
    r.onload = () => setText(String(r.result ?? ""))
    r.readAsText(f)
  }
  const compare = () => {
    const parsed = parseReconCsv(text, pf)
    const valueOf = seesValue ? (e: HrEmployee) => reconValue(pf, e, pays.get(e.id), docs, today) : null
    setResult({ ...reconcile(pf, parsed.rows, employees, valueOf, today), bad: parsed.bad })
  }
  const save = async () => {
    if (!firestore || !access.orgId || !result) return
    setSaving(true)
    try {
      const out = await saveReconciliation(firestore, access.ctx, access.orgId, actor, { pf, diffs: result.diffs, n: result.n, matched: result.matched, take: take && mayTake }, { employees, docs, today })
      toast({ title: t("pf.recon_saved", { n: result.diffs.length, tasks: out.tasks }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const fmt = (v: string | number | null | undefined) => (v == null ? "—" : pf === "muqeem" ? hrDate(String(v), locale) : hrMoney(Number(v)))
  const columns: DataColumn<ReconDiff>[] = [
    {
      key: "who",
      header: t("pf.col.who"),
      cell: (d) => {
        const e = d.employeeId ? byId.get(d.employeeId) : undefined
        return e ? (
          <Link href={`/${portal}/hr/people/${e.id}`} className="rounded font-semibold hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
            {e.names.ar} <span className="text-xs font-normal text-muted-foreground">#{empNo(e.no)}</span>
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
      sortValue: (d) => (d.employeeId ? (byId.get(d.employeeId)?.names.ar ?? "") : d.no),
    },
    {
      key: "what",
      header: t("pf.col.what"),
      cell: (d) =>
        d.k === "diff" ? (
          <span className="text-xs">
            {t("pf.ours")} <Figure>{fmt(d.ours)}</Figure> · {t("pf.theirs")} <Figure className="font-bold">{fmt(d.theirs)}</Figure>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t(`pf.k_text.${d.k}`, { no: d.no })}</span>
        ),
    },
    { key: "k", header: t("pf.col.kind"), cell: (d) => <StatusPill tone={DIFF_TONE[d.k]}>{t(`pf.k.${d.k}`)}</StatusPill>, sortValue: (d) => d.k },
  ]

  const name = t(`pf.name.${pf}`)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {!result ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("pf.recon_title", { pf: name })}</DialogTitle>
              <DialogDescription>{t("pf.recon_sub", { col: t(`pf.col_value.${pf}`) })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Callout tone="info">{t("pf.recon_info")}</Callout>
              {!seesValue && <Callout tone="warn">{t("pf.recon_no_wage")}</Callout>}
              <div className="space-y-1.5">
                <Label htmlFor="pf-recon-file">{t("pf.recon_file")}</Label>
                <Input id="pf-recon-file" type="file" accept=".csv,.txt" onChange={(e) => readFile(e.target.files?.[0])} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-recon-text">{t("pf.recon_paste")}</Label>
                <Textarea id="pf-recon-text" rows={6} dir="ltr" value={text} onChange={(e) => setText(e.target.value)} placeholder={pf === "muqeem" ? "2101234567,2027-03-31" : "2101234567,4500"} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button type="button" onClick={compare} disabled={!text.trim()}>
                {t("pf.recon_compare")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("pf.review_title", { pf: name })}</DialogTitle>
              <DialogDescription>{t("pf.review_sub", { n: result.n, matched: result.matched, k: result.diffs.length })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {result.bad > 0 && <Callout tone="warn">{t("pf.recon_bad", { n: result.bad })}</Callout>}
              <DataTable
                caption={t("pf.review_title", { pf: name })}
                labels={labels}
                dense
                columns={columns}
                rows={result.diffs}
                rowKey={(d) => `${d.k}-${d.employeeId ?? d.no}`}
                rowTone={(d) => (d.k === "diff" ? "warn" : "bad")}
                maxHeight="40vh"
                empty={<p className="py-4 text-center text-sm font-semibold text-success">{t("pf.matched_all")}</p>}
              />
              {result.diffs.some((d) => d.k === "diff") && (
                <div className="flex items-start gap-2 rounded-xl border p-3">
                  <Checkbox id="pf-take" checked={take} onCheckedChange={(v) => setTake(v === true)} disabled={!mayTake} className="mt-0.5" />
                  <div className="min-w-0">
                    <Label htmlFor="pf-take" className="text-sm font-bold">
                      {t(`pf.take.${pf}`)}
                    </Label>
                    <p className="text-[11px] text-muted-foreground">{t(mayTake ? "pf.take_note" : "pf.take_manager")}</p>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t("pf.recon_tasks_note")}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResult(null)}>
                {t("back")}
              </Button>
              <Button type="button" onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" />}
                {t("pf.recon_save")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
