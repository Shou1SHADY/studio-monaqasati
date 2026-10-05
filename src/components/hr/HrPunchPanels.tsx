"use client"

// The Attendance tab with punches (optional: punch; the prototype's VIEWS.att):
// «استثناءات البصمة» — the system proposes, a person decides, nothing deducted
// or marked absent automatically — with the employees' correction requests
// first, then no punch · late · missing out · overtime · outside the fence ·
// another workplace, four a group; and «مصدر الحضور لكل مكان عمل» — each
// workplace's source, schedule or shifts, radius or last device file, with
// import / shifts / change, and the days now ready to record from punches.

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AlarmClock, Fingerprint, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/module-ui/Panel"
import { ShowMoreRow } from "@/components/module-ui/ShowMoreRow"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useOrgPay } from "@/hooks/useHrPeople"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { Link } from "@/i18n/routing"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import { displayName, type HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { overtimeRate } from "@/lib/hr/pay"
import {
  importLateDays,
  lastImport,
  lateCode,
  PUNCH_EX_KINDS,
  punchExceptions,
  readyDays,
  riyadhMinutes,
  siteDay,
  siteSchedule,
  sourceOf,
  type PunchEx,
  type PunchExKind,
  type PunchSite,
  type PunchWm,
  type PunchWorld,
} from "@/lib/hr/punches"
import { decidePunch, recordPunchDay, type PunchDecisionInput } from "@/lib/hr/punch-writes"
import { decideRequest } from "@/lib/hr/request-writes"
import { requestActions, type HrRequest } from "@/lib/hr/requests"
import { mh, siteShifts, type EmployeeShift } from "@/lib/hr/shifts"
import { siteLabel, UNASSIGNED_SITE, type HrSite } from "@/lib/hr/sites"
import { daysBetween } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { DeclineDialog, DeviceImportDialog, NotOvertimeDialog, ShiftsDialog, SourceDialog } from "./HrPunchDialogs"
import type { HrPortal } from "./HrShell"

export type PunchEmp = HrEmployee & { shift?: EmployeeShift | null }

/** The punch world the Attendance tab and its KPIs read — this and last month's workplace months. */
export function usePunchWorld(access: HrAccess, input: { employees: HrEmployee[]; sites: HrSite[]; months: WorkplaceMonth[]; requests: HrRequest[] }): PunchWorld {
  const today = todayDay()
  const scope = access.ctx.owner || (["manager", "gov", "payroll", "management"] as const).some((r) => access.ctx.roles.has(r)) ? null : access.ctx.sites
  const on = access.settings.features.includes("punch")
  return useMemo(
    () => ({ today, nowMin: riyadhMinutes(), punch: on, employees: input.employees as PunchEmp[], sites: input.sites as PunchSite[], months: input.months as PunchWm[], requests: input.requests, scope }),
    [today, on, input.employees, input.sites, input.months, input.requests, scope]
  )
}

const KIND_ICON: Record<PunchExKind, typeof AlarmClock> = { nop: Fingerprint, late: AlarmClock, noout: AlarmClock, ot: AlarmClock, fence: MapPin, xsite: MapPin }

export function HrPunchAttendance({ access, actor, portal, world }: { access: HrAccess; actor: HrActor; portal: HrPortal; world: PunchWorld }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const money = access.allowed("pay.view")
  const pays = useOrgPay(access.orgId, money)
  const [more, setMore] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [otno, setOtno] = useState<PunchEx | null>(null)
  const [declining, setDeclining] = useState<HrRequest | null>(null)
  const [dialog, setDialog] = useState<{ kind: "am" | "dev" | "shifts"; site: PunchSite } | null>(null)
  const employees = world.employees as PunchEmp[]
  // Today's "device file not read" row opens the import for its workplace (`?import=<site>`).
  const params = useSearchParams()
  const importFor = params?.get("import") ?? null
  const importSite = importFor ? (world.sites.find((x) => x.id === importFor) ?? null) : null
  useEffect(() => {
    if (importSite && access.allowed("attendance.record", { site: importSite.id })) setDialog({ kind: "dev", site: importSite })
    // Opened once per link — a later change of the access object must not reopen it after it is closed.
  }, [importSite?.id])
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const siteOf = (id: string | null | undefined) => world.sites.find((s) => s.id === id) ?? null
  const siteName = (id: string | null | undefined) => {
    const s = siteOf(id)
    return s ? siteLabel({ name: s.name ?? "", nameEn: s.nameEn }, locale) : t("sites.unassigned")
  }
  const name = (id: string) => {
    const e = byId.get(id)
    return e ? displayName(e, locale) : id
  }
  const ex = useMemo(() => punchExceptions(world), [world])
  // Correction requests this viewer decides (the supervisor who keeps the sheet, or the HR manager).
  const fixes = useMemo(
    () => (world.requests as HrRequest[]).filter((r) => r.kind === "attfix" && (r.state === "pending" || r.state === "endorsed") && requestActions(access.ctx, r, { today: world.today, financeAllowed: false }).includes("approve")),
    [world.requests, world.today, access.ctx]
  )

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (!firestore || !access.orgId) return
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
    } catch (err) {
      console.error(err)
      const key = err instanceof HrWriteError ? (err.blocks[0] ? `punch.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"
      toast({ title: t.has(key) ? t(key) : t("err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  const decide = (x: PunchEx, input: PunchDecisionInput) => {
    const site = siteOf(x.siteId)
    if (!site) return
    void run(() => decidePunch(firestore!, access.ctx, access.orgId!, site, actor, { day: x.day, employeeId: x.employeeId, ...input }), "punch.decided")
  }

  const dayTag = (day: string) => (day === world.today ? t("punch.today") : hrDate(day, locale))
  const line = (x: PunchEx): string => {
    const p = { in: x.in ?? "—", out: x.out ?? "—", sin: x.sched.in, sout: x.sched.out, day: dayTag(x.day) }
    switch (x.kind) {
      case "late":
        return t("punch.ex.late_line", { ...p, min: x.min ?? 0, code: t(`violation.${lateCode(x.min ?? 0)}`) })
      case "nop":
        return x.day === world.today ? t("punch.ex.nop_line", { now: mh(world.nowMin) }) : t("punch.ex.nop_past", { day: p.day })
      case "noout":
        return t("punch.ex.noout_line", p)
      case "ot": {
        const pay = pays.get(x.employeeId)
        const amount = money && pay ? ` ≈ ${hrMoney(Math.round(overtimeRate(pay) * (x.h ?? 0)))}` : ""
        return `${t("punch.ex.ot_line", { ...p, h: x.h ?? 0 })}${amount}`
      }
      case "fence":
        return t("punch.ex.fence_line", p)
      case "xsite":
        return t("punch.ex.xsite_line", { assigned: siteName(x.assigned), here: siteName(x.siteId), day: p.day })
    }
  }
  const actions = (x: PunchEx) => {
    if (x.kind === "xsite")
      return access.allowed("employee.assign") ? (
        <Button asChild size="sm" variant="outline">
          <Link href={`/${portal}/hr/people/${x.employeeId}`}>{t("punch.ex.fix_assign")}</Link>
        </Button>
      ) : null
    if (!access.allowed("attendance.record", { site: x.siteId })) return null
    const b = (label: string, input: PunchDecisionInput, primary = false) => (
      <Button size="sm" variant={primary ? "default" : "outline"} disabled={busy} onClick={() => decide(x, input)}>
        {label}
      </Button>
    )
    switch (x.kind) {
      case "late":
        return (
          <>
            {b(t("punch.ex.excused"), { kind: "late", v: "excused", min: x.min ?? 0 })}
            {access.allowed("violation.record", { site: x.siteId }) && b(t("punch.ex.violation"), { kind: "late", v: "violation", min: x.min ?? 0 })}
          </>
        )
      case "nop":
        return (
          <>
            {b(t("punch.ex.excused"), { kind: "nop", v: "permission" })}
            {b(t("punch.ex.absent"), { kind: "nop", v: "absent" })}
          </>
        )
      case "noout":
        return b(t("punch.ex.set_out", { out: x.sched.out }), { kind: "out" })
      case "ot":
        return (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setOtno(x)}>
              {t("punch.ex.not_ot")}
            </Button>
            {b(t("punch.ex.approve"), { kind: "ot", v: "ok", h: x.h ?? 0 }, true)}
          </>
        )
      case "fence":
        return (
          <>
            {b(t("punch.ex.fence_absent"), { kind: "fence", v: "absent" })}
            {b(t("punch.ex.fence_ok"), { kind: "fence", v: "ok" }, true)}
          </>
        )
    }
  }

  const row = (x: PunchEx) => {
    const e = byId.get(x.employeeId)
    const Icon = KIND_ICON[x.kind]
    return (
      <li key={`${x.kind}:${x.employeeId}:${x.day}`} className="flex flex-wrap items-center gap-2 py-2.5">
        <Icon size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 basis-56">
          <span className="block text-sm font-bold">
            <Link href={`/${portal}/hr/people/${x.employeeId}`} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
              {name(x.employeeId)}
            </Link>{" "}
            <span className="text-xs font-normal text-muted-foreground">
              · {e ? t(`trade.${e.trade}` as "trade.mason") : ""} · {siteName(x.siteId)}
            </span>
          </span>
          <span className="block text-xs text-muted-foreground">{line(x)}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">{actions(x)}</span>
      </li>
    )
  }

  const fixLine = (r: HrRequest) => `${t(`req.attfix_type.${r.attfix?.type ?? "abs"}`)} · ${hrDate(r.attfix?.day ?? null, locale)}`
  const groups = PUNCH_EX_KINDS.map((k) => [k, ex.filter((x) => x.kind === k)] as const).filter(([, l]) => l.length)

  // ---- the sources --------------------------------------------------------
  const sources = world.sites.filter((s) => s.active !== false && s.id !== UNASSIGNED_SITE && (!world.scope || world.scope.includes(s.id)))
  const months = world.months
  const recordReady = async (site: PunchSite) => {
    const days = readyDays(world, site)
    for (const d of days) await recordPunchDay(firestore!, access.ctx, access.orgId!, siteDay(world, site, d.day), actor)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title={t("punch.ex.title")} icon={Fingerprint} count={ex.length + fixes.length} countTone={ex.length + fixes.length ? "bad" : "ok"}>
        <p className="mb-2 text-xs text-muted-foreground">{t("punch.ex.note")}</p>
        {fixes.length > 0 && (
          <section className="mb-2">
            <h3 className="flex items-center gap-2 border-b py-1.5 text-xs font-bold text-muted-foreground">
              {t("punch.fix.title")} <StatusPill tone="warn">{fixes.length}</StatusPill>
            </h3>
            <ul className="divide-y">
              {fixes.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1 basis-56">
                    <span className="block text-sm font-bold" dir="auto">
                      {r.employeeName} — {fixLine(r)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {r.attfix?.reason} · {t("me.ago", { n: Math.max(0, daysBetween((r.createdAt || world.today).slice(0, 10), world.today)) })}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeclining(r)}>
                      {t("punch.fix.decline")}
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void run(() => decideRequest(firestore!, access.ctx, r.id, actor, "approve", "", { policies: access.settings.policies }), "punch.fix.accepted")}>
                      {t("punch.fix.accept")}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {groups.map(([k, list]) => {
          const shown = more[k] ? list : list.slice(0, 4)
          return (
            <section key={k} className="mb-2">
              <h3 className="flex items-center gap-2 border-b py-1.5 text-xs font-bold text-muted-foreground">
                {t(`punch.exk.${k}`)} <StatusPill tone={k === "nop" || k === "fence" ? "bad" : "warn"}>{list.length}</StatusPill>
              </h3>
              <ul className="divide-y">{shown.map(row)}</ul>
              {list.length > 4 && <ShowMoreRow onClick={() => setMore((m) => ({ ...m, [k]: !m[k] }))}>{more[k] ? t("today.show_less") : t("today.show_more", { n: list.length - 4 })}</ShowMoreRow>}
            </section>
          )
        })}
        {!groups.length && !fixes.length && <p className="py-6 text-center text-sm font-bold text-muted-foreground">{t("punch.ex.none")}</p>}
      </Panel>

      <Panel title={t("punch.src.title")} icon={MapPin} count={sources.length || undefined}>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("punch.src.none")}</p>
        ) : (
          <ul className="divide-y">
            {sources.map((s) => {
              const source = sourceOf(s, true)
              const sched = siteSchedule(s)
              const shifts = siteShifts(s)
              const n = employees.filter((e) => e.siteId === s.id && e.status === "active").length
              const last = lastImport(months.filter((m) => m.siteId === s.id))
              const late = importLateDays(last, world.today)
              const ready = readyDays(world, s)
              const parts = [t(`punch.src.${source}`), shifts ? shifts.map((x) => t(`punch.shift.${x.id}`)).join("/") : `${sched.in}–${sched.out}`]
              if (source === "app") parts.push(s.att?.geo?.lat != null ? t("punch.src.radius", { r: s.att.geo.r }) : t("punch.src.no_centre"))
              if (source === "device") parts.push(last ? t("punch.src.last_import", { date: hrDate(last.at.slice(0, 10), locale) }) : t("punch.src.no_import"))
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1 basis-56">
                    <span className="block text-sm font-bold" dir="auto">
                      {siteLabel({ name: s.name ?? "", nameEn: s.nameEn }, locale)} <span className="text-xs font-normal tabular-nums text-muted-foreground">{n}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {parts.join(" · ")}
                      {late != null && (
                        <>
                          {" · "}
                          <span className="font-bold text-destructive">{t("punch.src.silent", { n: late })}</span>
                        </>
                      )}
                      {(last?.unknown?.length ?? 0) > 0 && ` · ${t("punch.src.unknown", { n: last!.unknown.length })}`}
                    </span>
                    {ready.length > 0 && <span className="block text-xs font-semibold text-module">{t("punch.src.ready", { n: ready.length })}</span>}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {ready.length > 0 && access.allowed("attendance.record", { site: s.id }) && (
                      <Button size="sm" disabled={busy} onClick={() => void run(() => recordReady(s), "punch.src.recorded")}>
                        {t("punch.src.record")}
                      </Button>
                    )}
                    {source === "device" && access.allowed("attendance.record", { site: s.id }) && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: "dev", site: s })}>
                        {t("punch.src.import")}
                      </Button>
                    )}
                    {access.allowed("settings.manage") && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: "shifts", site: s })}>
                          {t("punch.src.shifts")}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: "am", site: s })}>
                          {t("punch.src.change")}
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {otno && (
        <NotOvertimeDialog
          name={name(otno.employeeId)}
          h={otno.h ?? 0}
          day={otno.day}
          onClose={() => setOtno(null)}
          onSave={(why) => decidePunch(firestore!, access.ctx, access.orgId!, siteOf(otno.siteId)!, actor, { day: otno.day, employeeId: otno.employeeId, kind: "ot", v: why, h: otno.h ?? 0 })}
        />
      )}
      {declining && (
        <DeclineDialog title={t("punch.fix.decline_title", { name: declining.employeeName })} onClose={() => setDeclining(null)} onSave={(note) => decideRequest(firestore!, access.ctx, declining.id, actor, "decline", note, { policies: access.settings.policies }).then(() => undefined)} />
      )}
      {dialog?.kind === "am" && <SourceDialog access={access} actor={actor} site={dialog.site} onClose={() => setDialog(null)} />}
      {dialog?.kind === "shifts" && <ShiftsDialog access={access} actor={actor} site={dialog.site} people={employees.filter((e) => e.siteId === dialog.site.id)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "dev" && <DeviceImportDialog access={access} actor={actor} site={dialog.site} employees={employees} requests={world.requests as HrRequest[]} onClose={() => setDialog(null)} />}
    </div>
  )
}

/** The prototype's KPI «حاضرون اليوم» note by source, and «استثناءات تنتظر قراراً» with its split. */
export function punchKpiParts(world: PunchWorld, sheetPresent: number) {
  const ex = punchExceptions(world)
  const fixes = (world.requests as HrRequest[]).filter((r) => r.kind === "attfix" && (r.state === "pending" || r.state === "endorsed")).length
  const c = (k: PunchExKind) => ex.filter((x) => x.kind === k).length
  return { exceptions: ex.length + fixes, late: c("late"), nop: c("nop"), ot: c("ot"), fixes, sheetPresent }
}
