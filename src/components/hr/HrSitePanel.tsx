"use client"

// A workplace's own page head (PRD §5 Sites, AS-01, AS-04, the prototype's
// `sitePanel` / `benchOrTrades`): who is assigned there, who is present today,
// where its month stands, the people with today's state and their documents
// (an expired iqama flagged), the move action, labour by trade — and for a
// project site its number, manager and end date read from Projects. The
// unassigned have their own page: who, since when, their documents, Assign —
// paid with no output, the first source of coverage. Pay is never shown here
// but the unassigned cost, to the roles that see pay (RL-03). Whoever runs the
// place records a work injury or a violation on another day from the people
// table (DC-07, PN-01) — a supervisor has no People tab.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { Ambulance, ArrowRightLeft, BarChart3, Flag, Loader2, MapPin, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import { useModules } from "@/hooks/useCompanyModules"
import { useTableLabels } from "@/hooks/useTableLabels"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { Link } from "@/i18n/routing"
import { assumesPresence, attendanceId, dayState, firstOnSite, missingDays, monthStatus, onLeaveOn, type DayState, type MonthStatus, type WorkplaceMonth } from "@/lib/hr/attendance"
import { HR_ATTENDANCE } from "@/lib/hr/collections"
import { legalOnSite, type DocState } from "@/lib/hr/documents"
import { displayName, type HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { empNo, hrDate, hrMoney, nearestDocument, todayDay } from "@/lib/hr/format"
import { recordInjury } from "@/lib/hr/injuries"
import { wageOf } from "@/lib/hr/pay"
import { benchSince, siteEndOf, siteLabel, tradeRows, UNASSIGNED_SITE } from "@/lib/hr/sites"
import { daysBetween } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import { EmployeeActionDialog } from "./EmployeeActionDialogs"
import type { HrPortal } from "./HrShell"
import { HrManpowerPanel } from "./HrManpowerPanel"
import { RecordViolationDialog } from "./HrViolationList"

const DAY_TONE: Record<DayState, PillTone> = { present: "ok", absent: "bad", sick: "warn", permission: "info", leave: "info", unrecorded: "mute", rest: "mute" }
const DOC_TONE: Record<DocState, PillTone> = { missing: "mute", valid: "ok", d60: "info", d30: "warn", expired: "bad" }
const DOC_RANK: Record<DocState, number> = { missing: 0, valid: 0, d60: 1, d30: 2, expired: 3 }
const ENDING_DAYS = 45
const CLIP = 25

/** Three figures in a row — the prototype's `.m3`. */
export function KpiRow({ items }: { items: Array<{ label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "bad" | "ok" | "warn" }> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {items.map((k) => (
        <div key={k.label} className="rounded-xl border bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{k.label}</dt>
          <dd className={cn("mt-1 text-lg font-black tabular-nums", k.tone === "bad" && "text-destructive", k.tone === "ok" && "text-success", k.tone === "warn" && "text-warning")}>
            {k.value}
            {k.note ? <span className="ms-1.5 text-xs font-semibold text-muted-foreground">{k.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** "Closed" · "up to date" · "stopped since …" — one month's state in words. */
export function useMonthStatusText() {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  return (s: MonthStatus) =>
    s.state === "closed"
      ? t("site.month_closed")
      : s.state === "current"
        ? s.through
          ? t("site.month_through", { date: hrDate(s.through, locale) })
          : t("site.month_current")
        : t("site.month_behind", { date: hrDate(s.since, locale), n: s.missing })
}

/** The trade bars: present ÷ assigned, expired iqamas flagged. */
export function TradeBars({ rows }: { rows: Array<{ trade: string; n: number; p: number; x: number }> }) {
  const t = useTranslations("Portal.HR")
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t("siteppl.none")}</p>
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.trade} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold">{t(`trade.${r.trade}` as "trade.mason")}</span>
            {r.x > 0 && <StatusPill tone="bad">{t("site.expired_n", { n: r.x })}</StatusPill>}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span className="block h-full rounded-full bg-success" style={{ width: `${r.n ? Math.round((r.p / r.n) * 100) : 0}%` }} />
          </span>
          <span className="tabular-nums text-muted-foreground">
            {r.p}/{r.n}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function HrSitePanel({ access, siteId, actor, portal }: { access: HrAccess; siteId: string; actor: HrActor; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const month = today.slice(0, 7)
  const { employees, sites } = useHrPeople(access)
  const { requests } = useHrRequests(access)
  const bench = siteId === UNASSIGNED_SITE
  const site = bench ? null : (sites.find((s) => s.id === siteId) ?? null)
  const assumed = assumesPresence(siteId, site?.type ?? null)
  const mayMove = access.allowed("employee.assign")
  // A supervisor opens his own workers' files from his site (RL-01) — he has no People tab.
  const opensFiles = access.tabs.includes("people") || access.ctx.roles.has("supervisor")
  const money = access.allowed("pay.view")
  const pays = useOrgPay(access.orgId, money && bench)
  const window = access.settings.policies.renewWindowDays
  const { toast } = useToast()
  const tableLabels = useTableLabels()
  const { on: moduleOn } = useModules()
  const pmOn = moduleOn("project-management")
  const [moving, setMoving] = useState<HrEmployee | null>(null)
  const mayInjury = !bench && access.allowed("injury.record", { site: siteId })
  const mayViolation = !bench && access.allowed("violation.record", { site: siteId })
  const [injuring, setInjuring] = useState<HrEmployee | null>(null)
  const [violating, setViolating] = useState<HrEmployee | null>(null)
  const [on, setOn] = useState(today)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const saveInjury = async () => {
    if (!firestore || !access.orgId || !injuring) return
    setBusy(true)
    try {
      await recordInjury(firestore, access.ctx, access.orgId, actor, { employeeId: injuring.id, on, description: text })
      toast({ title: t("inj.recorded_ok") })
      setInjuring(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `inj.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  const acts = mayMove || mayInjury || mayViolation

  const wmRef = useMemoFirebase(() => (firestore && access.orgId ? doc(firestore, HR_ATTENDANCE, attendanceId(access.orgId, siteId, month)) : null), [firestore, access.orgId, siteId, month])
  const { data: wmData } = useDoc(wmRef)
  const wm = (wmData as unknown as WorkplaceMonth | null) ?? null
  const projRef = useMemoFirebase(() => (firestore && pmOn && site?.projectId ? doc(firestore, "projects", site.projectId) : null), [firestore, pmOn, site?.projectId])
  const { data: projData } = useDoc(projRef)
  const project = projData as { name?: string; projectManagerName?: string | null; pm?: { no?: string | null; startOn?: string | null; durationDays?: number | null } | null; endDate?: string | null } | null

  // On the books here: not left, not yet started.
  const here = useMemo(() => employees.filter((e) => (bench ? !e.siteId : e.siteId === siteId) && e.status !== "left" && e.status !== "expected"), [employees, bench, siteId])
  const onLeave = useMemo(() => onLeaveOn(requests, today), [requests, today])
  const sheet = wm?.days?.[today] ?? null
  const stateOf = (e: HrEmployee): DayState => (e.status === "leave" ? "leave" : dayState(e.id, sheet, { onLeave, assumed, day: today }))
  const working = here.filter((e) => e.status === "active" || e.status === "leaving")
  const away = here.length - working.filter((e) => stateOf(e) !== "leave").length
  const present = working.filter((e) => stateOf(e) === "present")
  const absent = working.filter((e) => stateOf(e) === "absent").length
  const missing = missingDays(wm, month, today, { assumed, from: assumed ? undefined : firstOnSite(here, wm, month) })
  const status = monthStatus(wm, missing)
  const statusText = useMonthStatusText()
  const expired = (e: HrEmployee) => !legalOnSite({ ...e, docs: e.docs ?? {} }, today)
  const trades = tradeRows(working, new Set(present.map((e) => e.id)), expired)
  const end = site ? siteEndOf(site, project) : null
  const endsIn = end ? daysBetween(today, end) : null
  const benchCost = bench && money ? here.reduce((s, e) => s + (pays.get(e.id) ? wageOf(pays.get(e.id)!) : 0), 0) : 0

  const docOf = (e: HrEmployee) => nearestDocument(e.nationality === "sa" ? { ...e.docs, iqama: null } : e.docs, today, window)
  const rows = here.slice().sort((a, b) => DOC_RANK[docOf(b)?.state ?? "missing"] - DOC_RANK[docOf(a)?.state ?? "missing"] || (a.no ?? 0) - (b.no ?? 0))
  const name = (e: HrEmployee) => (e.names ? displayName(e, locale) : "—")
  const columns: DataColumn<HrEmployee>[] = [
    {
      key: "name",
      header: t("people.col.name"),
      sortValue: name,
      cell: (e) => (
        <>
          {opensFiles ? (
            <Link href={`/${portal}/hr/people/${e.id}`} className="font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
              {name(e)}
            </Link>
          ) : (
            <span className="font-semibold" dir="auto">
              {name(e)}
            </span>
          )}
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <bdi dir="ltr">{empNo(e.no)}</bdi> · {t(`trade.${e.trade}` as "trade.mason")}
            {expired(e) && <StatusPill tone="bad">{t("att.iqama_expired")}</StatusPill>}
          </span>
        </>
      ),
    },
    bench
      ? { key: "since", header: t("site.col.since"), sortValue: (e) => benchSince(e) ?? null, cell: (e) => <span className="text-xs">{hrDate(benchSince(e), locale)}</span> }
      : {
          key: "today",
          header: t("site.col.today"),
          sortValue: (e) => (e.status === "leaving" ? t("status.leaving") : t(`site.day.${stateOf(e)}`)),
          cell: (e) => (e.status === "leaving" ? <StatusPill tone="warn">{t("status.leaving")}</StatusPill> : <StatusPill tone={DAY_TONE[stateOf(e)]}>{t(`site.day.${stateOf(e)}`)}</StatusPill>),
        },
    {
      key: "docs",
      header: t("site.col.docs"),
      sortValue: (e) => DOC_RANK[docOf(e)?.state ?? "missing"],
      cell: (e) => {
        const d = docOf(e)
        return d ? (
          <StatusPill tone={DOC_TONE[d.state]}>
            {t(`doc.${d.type}`)} · {t(`doc_state.${d.state}`)}
          </StatusPill>
        ) : (
          <span className="text-xs text-muted-foreground">{t("doc_state.missing")}</span>
        )
      },
    },
    ...(acts
      ? [
          {
            key: "action",
            header: <span className="sr-only">{t("site.col.action")}</span>,
            label: t("site.col.action"),
            cell: (e: HrEmployee) => (
              <div className="flex flex-wrap justify-end gap-1.5">
                {mayMove && (e.status === "active" || e.status === "leave") && (
                  <Button size="sm" variant="outline" onClick={() => setMoving(e)}>
                    <ArrowRightLeft size={14} className="me-1.5" aria-hidden="true" />
                    {t(bench ? "site.assign" : "site.move")}
                  </Button>
                )}
                {mayInjury && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOn(today)
                      setText("")
                      setInjuring(e)
                    }}
                  >
                    <Ambulance size={14} className="me-1.5" aria-hidden="true" />
                    {t("siteppl.injury")}
                  </Button>
                )}
                {mayViolation && (
                  <Button size="sm" variant="outline" onClick={() => setViolating(e)}>
                    <Flag size={14} className="me-1.5" aria-hidden="true" />
                    {t("siteppl.violation")}
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ]

  if (!bench && !site) return null

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
          <MapPin size={18} className="text-module" aria-hidden="true" />
          <span dir="auto">{bench ? t("sites.unassigned") : siteLabel(site!, locale)}</span>
          {site && <StatusPill tone="module">{t(`site_type.${site.type}`)}</StatusPill>}
        </h2>
        {site?.type === "project" && (pmOn || end) && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {project?.pm?.no && <span dir="ltr">{project.pm.no}</span>}
            {project?.projectManagerName && <span>{t("site.pm", { name: project.projectManagerName })}</span>}
            {end && <span>{t("sites.ends", { date: hrDate(end, locale) })}</span>}
            {pmOn && <SourceBadge module="project-management" label={project?.name || t("site.from_projects")} />}
          </p>
        )}
        {bench && <p className="text-xs text-muted-foreground">{t("site.bench_note")}</p>}
      </div>

      <KpiRow
        items={
          bench
            ? [
                { label: t("site.k_bench"), value: here.length },
                ...(money ? [{ label: t("site.k_bench_cost"), value: <span dir="ltr">{hrMoney(Math.round(benchCost))}</span>, note: t("site.per_month"), tone: benchCost ? ("warn" as const) : undefined }] : []),
                { label: t("site.k_expired"), value: here.filter(expired).length, tone: here.some(expired) ? ("bad" as const) : undefined },
              ]
            : [
                { label: t("site.k_assigned"), value: here.length, note: away > 0 ? t("site.k_away", { n: away }) : undefined },
                { label: t("site.k_present"), value: present.length, note: t("site.k_of", { n: working.length - working.filter((e) => stateOf(e) === "leave").length }), tone: absent ? "bad" : "ok" },
                { label: t("site.k_month", { month }), value: <span className="text-base">{assumed ? t("site.month_assumed") : statusText(status)}</span>, tone: status.state === "behind" && !assumed ? "bad" : undefined },
              ]
        }
      />

      {endsIn != null && endsIn >= 0 && endsIn <= ENDING_DAYS && (
        <Callout tone="warn" title={t("site.ending_title", { n: endsIn })}>
          {t("site.ending", { n: working.length })}
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title={bench ? t("site.bench_people") : t("siteppl.title")} icon={UsersRound} count={here.length} bodyClassName="p-0">
          {(mayInjury || mayViolation) && <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("siteppl.note")}</p>}
          <DataTable
            caption={bench ? t("site.bench_people") : t("siteppl.title")}
            labels={tableLabels}
            dense
            bordered={false}
            columns={columns}
            rows={rows}
            rowKey={(e) => e.id}
            pageSize={CLIP}
            maxHeight="70vh"
            empty={<p className="px-4 py-4 text-sm text-muted-foreground">{t("siteppl.none")}</p>}
          />
        </Panel>

        <div className="space-y-4">
          <Panel title={bench ? t("site.bench_trades") : t("site.trades")} icon={BarChart3}>
            <p className="mb-3 text-xs text-muted-foreground">{bench ? t("site.bench_trades_note") : t("site.trades_note")}</p>
            <TradeBars rows={trades} />
          </Panel>
          {!bench && pmOn && <HrManpowerPanel access={access} siteId={siteId} />}
        </div>
      </div>

      {moving && <EmployeeActionDialog action="move" onClose={() => setMoving(null)} access={access} actor={actor} emp={moving} pay={null} sites={sites} />}
      {violating && <RecordViolationDialog access={access} actor={actor} employeeId={violating.id} onClose={() => setViolating(null)} />}
      <Dialog open={injuring !== null} onOpenChange={(o) => !o && setInjuring(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inj.record")}</DialogTitle>
            <DialogDescription dir="auto">
              {injuring ? name(injuring) : ""} — {t("inj.record_desc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sw-inj-on">{t("inj.on")}</Label>
              <Input id="sw-inj-on" type="date" dir="ltr" max={today} value={on} onChange={(e) => setOn(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-inj-text">{t("inj.description")}</Label>
              <Textarea id="sw-inj-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInjuring(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button disabled={busy || !text.trim() || !on || !firestore} onClick={() => void saveInjury()}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
