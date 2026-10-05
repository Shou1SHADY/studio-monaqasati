"use client"

// The Attendance tab (PRD §5 Attendance, AT-03, AT-04; the prototype's
// `VIEWS.att` and `attClosePanel`), core — no punch needed: who is present
// today across the workplaces, the days nobody recorded (they block closing —
// an unrecorded day used to be paid as if worked), last month's closing place
// by place (recorded through which day, the missing days filled by a named
// declaration, closed), each place's month at a glance, and the workers a
// sheet reported as working there but not listed. The daily sheet itself is
// on each place's page. Punch sources and exceptions join here with `punch`.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarCheck2, Lock, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import type { ModuleKpi } from "@/components/module-ui/ModuleHeader"
import { useFirestore } from "@/firebase"
import { useHrPeople } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useWorkplaceMonths } from "@/hooks/useWorkplaceMonths"
import { Link } from "@/i18n/routing"
import { assumesPresence, closeBlocks, dueDays, firstOnSite, missingDays, monthOf, monthOver, monthStatus, type WorkplaceMonth } from "@/lib/hr/attendance"
import { closeMonth } from "@/lib/hr/attendance-writes"
import type { HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, todayDay } from "@/lib/hr/format"
import type { HrSite } from "@/lib/hr/sites"
import { addDays } from "@/lib/hr/statutory"
import { dutyToday } from "@/lib/hr/today"
import { punchedToday, sourceOf, type PunchSite } from "@/lib/hr/punches"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import { HrDeclareMissingDialog } from "./HrDeclareMissingDialog"
import type { HrPortal } from "./HrShell"
import { useMonthStatusText } from "./HrSitePanel"
import { HrPunchAttendance, punchKpiParts, usePunchWorld } from "./HrPunchPanels"

const prevMonthOf = (month: string) => monthOf(addDays(`${month}-01`, -1))

interface PlaceMonth {
  site: HrSite
  people: HrEmployee[]
  wm: WorkplaceMonth | null
  missing: string[]
  due: number
}

/** Each workplace the viewer may see, with its month — offices and the unassigned assume presence and are not
 * closed by a person's sheet; a supervisor sees his own places. */
function placeMonths(sites: HrSite[], employees: HrEmployee[], months: WorkplaceMonth[], month: string, today: string, scope: readonly string[] | null): PlaceMonth[] {
  return sites
    .filter((s) => (s.active !== false || months.some((w) => w.siteId === s.id)) && !assumesPresence(s.id, s.type) && (!scope || scope.includes(s.id)))
    .map((site) => {
      const people = employees.filter((e) => e.siteId === site.id && e.status !== "expected")
      const wm = months.find((w) => w.siteId === site.id) ?? null
      const from = firstOnSite(people, wm, month)
      const missing = missingDays(wm, month, today, { assumed: false, from })
      const due = from === null ? 0 : dueDays(month, today).filter((d) => d >= from).length
      return { site, people, wm, missing, due }
    })
    .filter((p) => p.people.length > 0 || p.wm)
    .sort((a, b) => a.site.name.localeCompare(b.site.name))
}

function useAttendanceWorld(access: HrAccess, month: string) {
  const today = todayDay()
  const { employees, sites, isLoading } = useHrPeople(access)
  const { requests } = useHrRequests(access)
  const current = today.slice(0, 7)
  const prev = prevMonthOf(current)
  const { months: cur } = useWorkplaceMonths(access, current)
  const { months: last } = useWorkplaceMonths(access, prev)
  const { months: chosen } = useWorkplaceMonths(access, month)
  const scope = access.ctx.owner || (["manager", "gov", "payroll", "management"] as const).some((r) => access.ctx.roles.has(r)) ? null : access.ctx.sites
  return useMemo(() => {
    const duty = dutyToday({ today, employees, sites, thisMonth: cur, requests }).filter((d) => d.siteId !== "__bench__" && (!scope || scope.includes(d.siteId)))
    return {
      today,
      current,
      prev,
      employees,
      sites,
      isLoading,
      duty,
      curPlaces: placeMonths(sites, employees, cur, current, today, scope),
      prevPlaces: placeMonths(sites, employees, last, prev, today, scope),
      chosenPlaces: placeMonths(sites, employees, chosen, month, today, scope),
      // The punch feature reads this and last month whole (its evidence and decisions ride them).
      months: [...cur, ...last],
      requests,
    }
  }, [today, employees, sites, isLoading, requests, cur, last, chosen, current, prev, month, scope])
}

/** The tab's three numbers (TD-04): present today · unrecorded days · places left to close. */
export function useAttendanceKpis(access: HrAccess): ModuleKpi[] | undefined {
  const t = useTranslations("Portal.HR")
  const w = useAttendanceWorld(access, todayDay().slice(0, 7))
  const present = w.duty.reduce((s, d) => s + d.present, 0)
  const assigned = w.duty.reduce((s, d) => s + d.assigned, 0)
  const missing = [...w.curPlaces, ...w.prevPlaces].reduce((s, p) => s + p.missing.length, 0)
  const open = monthOver(w.prev, w.today) ? w.prevPlaces.filter((p) => !p.wm?.closed).length : 0
  const pw = usePunchWorld(access, { employees: w.employees, sites: w.sites, months: w.months, requests: w.requests })
  if (pw.punch) {
    // The prototype's VIEWS.att: present by source · exceptions awaiting a decision · unrecorded days.
    const bySource = (id: string) => sourceOf(w.sites.find((s) => s.id === id) as PunchSite | undefined, true)
    const sheet = w.duty.filter((d) => bySource(d.siteId) === "sheet").reduce((s, d) => s + d.present, 0)
    const punched = punchedToday(pw)
    const k = punchKpiParts(pw, sheet)
    return [
      { id: "present", label: t("atv.k_present"), value: `${sheet + punched.ids.size}/${assigned}`, note: t("punch.k_present_note", { sheet, device: punched.device, app: punched.app }), tone: "neutral" },
      { id: "exceptions", label: t("punch.k_ex"), value: String(k.exceptions), note: t("punch.k_ex_note", { late: k.late, nop: k.nop, ot: k.ot, fixes: k.fixes }), tone: k.exceptions ? "warn" : "good" },
      { id: "missing", label: t("atv.k_missing"), value: String(missing), note: t("atv.k_missing_note"), tone: missing ? "bad" : "good" },
    ]
  }
  return [
    { id: "present", label: t("atv.k_present"), value: `${present}/${assigned}`, note: t("atv.k_present_note"), tone: "neutral" },
    { id: "missing", label: t("atv.k_missing"), value: String(missing), note: t("atv.k_missing_note"), tone: missing ? "bad" : "good" },
    { id: "close", label: t("atv.k_close", { month: w.prev }), value: String(open), note: t("atv.k_close_note"), tone: open ? "warn" : "good" },
  ]
}

export function HrAttendanceView({ access, actor, portal }: { access: HrAccess; actor: HrActor; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [month, setMonth] = useState(todayDay().slice(0, 7))
  const w = useAttendanceWorld(access, month)
  const pw = usePunchWorld(access, { employees: w.employees, sites: w.sites, months: w.months, requests: w.requests })
  const statusText = useMonthStatusText()
  const policy = access.settings.policies.closeMissing
  const [declaring, setDeclaring] = useState<{ p: PlaceMonth; month: string } | null>(null)
  const [closing, setClosing] = useState<{ p: PlaceMonth; month: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const prevOver = monthOver(w.prev, w.today)
  const toClose = prevOver ? w.prevPlaces.filter((p) => !p.wm?.closed) : []
  const unlisted = w.chosenPlaces.flatMap((p) =>
    Object.entries(p.wm?.days ?? {}).flatMap(([day, s]) => (s.unlisted ?? []).map((u) => ({ ...u, day, by: s.byName, site: p.site })))
  )

  const close = async () => {
    if (!firestore || !access.orgId || !closing) return
    setBusy(true)
    try {
      await closeMonth(firestore, access.ctx, access.orgId, { id: closing.p.site.id, type: closing.p.site.type }, closing.month, actor, policy)
      toast({ title: t("att.closed") })
      setClosing(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `att.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save", { n: closing.p.missing.length }), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const closeButtons = (p: PlaceMonth, m: string) => {
    const c = closeBlocks({ month: m, today: w.today, closed: Boolean(p.wm?.closed), missing: p.missing, policy })
    const mayDeclare = access.allowed("attendance.declare", { site: p.site.id })
    const mayClose = access.allowed("attendance.close", { site: p.site.id })
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {p.missing.length > 0 && <StatusPill tone="bad">{t("atv.missing_n", { n: p.missing.length })}</StatusPill>}
        {p.missing.length > 0 && mayDeclare && (
          <Button size="sm" variant="outline" onClick={() => setDeclaring({ p, month: m })} disabled={busy}>
            {t("att.fill_open")}
          </Button>
        )}
        {mayClose && c.blocks.length === 0 && (
          <Button size="sm" variant={c.warnings.length ? "outline" : "default"} onClick={() => setClosing({ p, month: m })} disabled={busy}>
            <Lock size={14} className="me-1.5" aria-hidden="true" />
            {t(c.warnings.length ? "att.close_as_is" : "atv.close")}
          </Button>
        )}
        <Button asChild size="sm" variant="ghost">
          <Link href={`/${portal}/hr/sites/${p.site.id}`}>{t("atv.sheet")}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {[w.prev, w.current].map((m) => (
          <Button key={m} size="sm" variant={month === m ? "default" : "outline"} aria-pressed={month === m} onClick={() => setMonth(m)} className="rounded-full">
            {m}
          </Button>
        ))}
        <Input type="month" dir="ltr" aria-label={t("att.month")} value={month} max={w.current} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 w-40" />
      </div>

      {pw.punch && <HrPunchAttendance access={access} actor={actor} portal={portal} world={pw} />}

      {toClose.length > 0 && (
        <Panel title={t("atv.close_title", { month: w.prev })} icon={Lock} count={toClose.length} countTone="bad">
          <p className="mb-3 text-xs text-muted-foreground">{t("atv.close_note")}</p>
          <ul className="divide-y">
            {toClose.map((p) => {
              const s = monthStatus(p.wm, p.missing)
              return (
                <li key={p.site.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="block text-sm font-bold" dir="auto">
                      {p.site.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">{s.state !== "closed" && s.through ? t("atv.through", { date: hrDate(s.through, locale) }) : t("atv.nothing")}</span>
                  </span>
                  {closeButtons(p, w.prev)}
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      <Panel title={t("atv.month_title", { month })} icon={CalendarCheck2} count={w.chosenPlaces.length || undefined}>
        <p className="mb-3 text-xs text-muted-foreground">{t("atv.month_note")}</p>
        {w.chosenPlaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("atv.none")}</p>
        ) : (
          <ul className="space-y-3">
            {w.chosenPlaces.map((p) => {
              const s = monthStatus(p.wm, p.missing)
              const share = s.state === "closed" ? 100 : p.due ? Math.round(((p.due - p.missing.length) / p.due) * 100) : 100
              return (
                <li key={p.site.id} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 basis-40 font-semibold" dir="auto">
                      {p.site.name} <span className="text-xs font-normal text-muted-foreground">{t("atv.people_n", { n: p.people.length })}</span>
                    </span>
                    <span className={cn("text-xs font-bold", s.state === "behind" ? "text-destructive" : s.state === "closed" ? "text-success" : "text-muted-foreground")}>{statusText(s)}</span>
                  </div>
                  <span className="block h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span className={cn("block h-full rounded-full", s.state === "closed" ? "bg-success" : s.state === "behind" ? "bg-destructive" : "bg-cta")} style={{ width: `${share}%` }} />
                  </span>
                  {!p.wm?.closed && (month !== w.current || p.missing.length > 0) && closeButtons(p, month)}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {unlisted.length > 0 && (
        <Panel title={t("atv.unlisted_title")} icon={UserPlus} count={unlisted.length}>
          <p className="mb-3 text-xs text-muted-foreground">{t("atv.unlisted_note")}</p>
          <ul className="divide-y">
            {unlisted.map((u, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block font-semibold" dir="auto">
                    {u.name}
                    {u.note ? <span className="font-normal text-muted-foreground"> — {u.note}</span> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{t("atv.unlisted_line", { site: u.site.name, date: hrDate(u.day, locale), by: u.by || "—" })}</span>
                </span>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/${portal}/hr/sites/${u.site.id}`}>{t("site.open")}</Link>
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!access.settings.features.includes("punch") && <Callout tone="info">{t("atv.punch_later")}</Callout>}

      {declaring && (
        <HrDeclareMissingDialog
          access={access}
          actor={actor}
          site={{ id: declaring.p.site.id, type: declaring.p.site.type }}
          siteName={declaring.p.site.name}
          month={declaring.month}
          wm={declaring.p.wm}
          missing={declaring.p.missing}
          people={declaring.p.people}
          onClose={() => setDeclaring(null)}
        />
      )}

      <AlertDialog open={closing !== null} onOpenChange={(o) => !o && setClosing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("att.confirm_title", { month: closing?.month ?? "", site: closing?.p.site.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("att.confirm_desc")}
              {closing && closing.p.missing.length > 0 ? ` ${t("att.close_warn", { n: closing.p.missing.length })}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void close()}>{t("att.close")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
