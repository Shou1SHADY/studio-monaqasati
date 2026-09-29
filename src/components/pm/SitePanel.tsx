"use client"

// Execution › Site on a PM 1.0 project (WF-19, WF-20; the prototype's
// «الموقع والمعوّقات» / «الموقع والسلامة»). The daily report, the obstacles and
// RFIs with the time their answer is taking, and safety. With both the daily
// report and obstacles on, obstacles sit beside the report as a side list of
// what is open; with obstacles alone they read as two boards, open and closed.
// Nothing here carries a price — the site engineer sees all of it.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { AlertTriangle, Camera, Check, Clock, Gavel, Link2, Loader2, Paperclip, Plus, ShieldCheck, Truck, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { claimNo, PM_CLAIMS } from "@/lib/pm/claim"
import { pmDate, todayDay } from "@/lib/pm/format"
import {
  averageLabour,
  claimable,
  claimSeed,
  daysBetween,
  daysSinceLti,
  expiredPermits,
  INCIDENT_TYPES,
  isOpenObstacle,
  livePermits,
  lostDays,
  obstacleDays,
  obstacleSeq,
  obstacleTone,
  permitState,
  PM_DAILY,
  PM_INCIDENTS,
  PM_OBSTACLES,
  PM_PERMITS,
  sortDaily,
  sortIncidents,
  sortObstacles,
  sortPermits,
  type ClaimSeed,
  type IncidentType,
  type PmDaily,
  type PmIncident,
  type PmObstacle,
  type PmPermit,
  type SiteFile,
} from "@/lib/pm/site"
import { chaseObstacle, closeObstacle, fileDailyReport, issuePermit, logIncident, openObstacle, PmSiteError, type SiteActor } from "@/lib/pm/site-writes"
import { cn } from "@/lib/utils"
import { CloseObstacleDialog, DailyReportDialog, IncidentDialog, ObstacleDialog, PermitDialog, type SiteItem } from "./SiteDialogs"

const INC_TONE: Record<IncidentType, PillTone> = { near: "mute", fa: "info", lti: "bad", prop: "warn" }
const DAILY_SHOWN = 10

type Run = (key: string, fn: () => Promise<unknown>, ok: string) => Promise<boolean>

function Files({ files, none }: { files?: SiteFile[]; none?: string }) {
  if (!files?.length) return none ? <span className="text-xs text-muted-foreground">{none}</span> : null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {files.map((f, i) => (
        <a
          key={`${f.url}-${i}`}
          href={f.url}
          target="_blank"
          rel="noreferrer"
          title={f.name}
          className="inline-flex max-w-40 items-center gap-1 rounded-full bg-cta/10 px-2 py-0.5 text-xs font-semibold text-cta hover:bg-cta/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Paperclip size={11} className="shrink-0" aria-hidden="true" />
          <span className="truncate" dir="auto">
            {f.name}
          </span>
        </a>
      ))}
    </span>
  )
}

export function SitePanel({
  projectId,
  orgId,
  items,
  startOn,
  sections,
  access,
  actor,
  onLogClaim,
}: {
  projectId: string
  orgId: string
  items: SiteItem[]
  /** The day work started — the safety counter runs from it until the first lost-time injury. */
  startOn: string | null
  /** Which of the project's sections are on: daily report, obstacles & RFI, safety, claims. */
  sections: { daily: boolean; rfi: boolean; hse: boolean; claim: boolean }
  access: PmAccess
  actor: SiteActor
  /** Opens the claim composer on Contract › Claims, seeded from the obstacle. */
  onLogClaim?: (seed: ClaimSeed) => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const archived = access.ctx.archived
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<"daily" | "obstacle" | "incident" | "permit" | null>(null)
  const [closing, setClosing] = useState<PmObstacle | null>(null)
  const [allDaily, setAllDaily] = useState(false)
  const [showClosed, setShowClosed] = useState(false)

  const col = (name: string, on: boolean) => (firestore && on ? collection(firestore, "projects", projectId, name) : null)
  const dailyQ = useMemoFirebase(() => col(PM_DAILY, sections.daily), [firestore, projectId, sections.daily])
  const obsQ = useMemoFirebase(() => col(PM_OBSTACLES, sections.rfi), [firestore, projectId, sections.rfi])
  const incQ = useMemoFirebase(() => col(PM_INCIDENTS, sections.hse), [firestore, projectId, sections.hse])
  const pmtQ = useMemoFirebase(() => col(PM_PERMITS, sections.hse), [firestore, projectId, sections.hse])
  const clmQ = useMemoFirebase(() => col(PM_CLAIMS, sections.rfi && sections.claim), [firestore, projectId, sections.rfi, sections.claim])
  const { data: dailyData } = useCollection(dailyQ)
  const { data: obsData } = useCollection(obsQ)
  const { data: incData } = useCollection(incQ)
  const { data: pmtData } = useCollection(pmtQ)
  const { data: clmData } = useCollection(clmQ)

  const reports = useMemo(() => sortDaily((dailyData ?? []) as unknown as PmDaily[]), [dailyData])
  const obstacles = useMemo(() => sortObstacles((obsData ?? []) as unknown as PmObstacle[]), [obsData])
  const incidents = useMemo(() => sortIncidents((incData ?? []) as unknown as PmIncident[]), [incData])
  const permits = useMemo(() => sortPermits((pmtData ?? []) as unknown as PmPermit[], today), [pmtData, today])
  const claims = useMemo(() => (clmData ?? []) as unknown as Array<{ seq: number; obstacleId?: string | null }>, [clmData])

  const canDaily = !archived && access.allowed("daily.write")
  const canHse = !archived && access.allowed("hse.record")
  const canObs = !archived && access.allowed("obstacle.record")
  const canChase = !archived && access.allowed("obstacle.chase")
  const canClaim = !archived && sections.claim && access.allowed("request.decide") && Boolean(onLogClaim)
  const filedToday = reports.some((r) => r.day === today)

  const obsNo = (o: Pick<PmObstacle, "type" | "seq">) => t(`site.obs.no.${o.type}`, { no: obstacleSeq(o.seq) })
  const partyOf = (o: PmObstacle) => (o.party === "none" ? "—" : o.partyName || t(`site.obs.party.${o.party}`))
  const coverOf = (o: PmObstacle) => claims.find((c) => c.obstacleId === o.id)
  const rel = (day: string) => {
    const n = daysBetween(day, today)
    return n === 0 ? t("site.rel_today") : n === 1 ? t("site.rel_yesterday") : t("site.ago", { count: n })
  }

  const run: Run = async (key, fn, ok) => {
    if (!firestore) return false
    setBusy(key)
    try {
      await fn()
      toast({ title: ok })
      return true
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmSiteError && err.blocks[0] ? `site.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
      return false
    } finally {
      setBusy(null)
    }
  }

  const chase = (o: PmObstacle) =>
    firestore &&
    void run(`c${o.id}`, () => chaseObstacle(firestore, access.ctx, projectId, actor, o.id), t("site.obs.chase_done", { n: (o.chases?.length ?? 0) + 1, no: obsNo(o) }))

  const obstacleActions = (o: PmObstacle, stacked: boolean) => {
    if (!isOpenObstacle(o)) return null
    const cover = coverOf(o)
    return (
      <div className={cn("flex shrink-0 flex-wrap gap-1.5", stacked && "flex-col items-end")}>
        {canChase && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => chase(o)}>
            {busy === `c${o.id}` && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("site.obs.chase")}
          </Button>
        )}
        {canClaim && claimable(o) && !cover && (
          <Button size="sm" variant="outline" onClick={() => onLogClaim?.(claimSeed(o))}>
            <Gavel size={14} className="me-1.5" aria-hidden="true" />
            {t("site.obs.log_claim")}
          </Button>
        )}
        {canObs && (
          <Button size="sm" variant="ghost" onClick={() => setClosing(o)}>
            {t("site.obs.close")}
          </Button>
        )}
      </div>
    )
  }

  const chaseLine = (o: PmObstacle) => {
    const n = o.chases?.length ?? 0
    return n ? t("site.obs.chased", { count: n, last: rel(o.chases?.[n - 1]?.on ?? today) }) : null
  }

  const coverLine = (o: PmObstacle) => {
    const cover = coverOf(o)
    return cover ? (
      <p className="flex items-center gap-1 text-xs font-bold text-module">
        <Link2 size={12} aria-hidden="true" />
        {t("site.obs.covered", { no: t("claim.no", { no: claimNo(cover.seq) }) })}
      </p>
    ) : null
  }

  const blocksText = (o: PmObstacle) => {
    const codes = (o.codes ?? []).filter(Boolean)
    return codes.length ? t("site.obs.blocks", { items: codes.join("، ") }) : o.itemIds.length ? t("site.obs.blocks_n", { count: o.itemIds.length }) : null
  }

  // ---- The daily report -----------------------------------------------------
  const avg = averageLabour(reports.slice(0, allDaily ? reports.length : DAILY_SHOWN))
  const shown = allDaily ? reports : reports.slice(0, DAILY_SHOWN)
  const dailyPanel = (
    <Panel
      title={
        <>
          {t("site.daily.title")}
          <span className="ms-2 text-xs font-normal text-muted-foreground">{t("site.daily.sub")}</span>
        </>
      }
      icon={Camera}
      actions={
        canDaily ? (
          filedToday ? (
            <StatusPill tone="ok">
              <Check size={12} aria-hidden="true" />
              {t("site.daily.filed_today")}
            </StatusPill>
          ) : (
            <Button size="sm" onClick={() => setDialog("daily")}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("site.daily.new")}
            </Button>
          )
        ) : null
      }
      bodyClassName="p-0"
    >
      {reports.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={Camera} title={t("site.daily.empty")} description={t("site.daily.empty_desc")} />
        </div>
      ) : (
        <>
          <ul className="divide-y">
            {shown.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">
                    {pmDate(d.day, locale)} <span className="text-xs font-normal text-muted-foreground">· {rel(d.day)}</span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground" dir="auto">
                    {d.done}
                  </p>
                  {d.obstacle && (
                    <p className="mt-1 flex items-start gap-1 text-xs font-semibold text-warning" dir="auto">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                      {d.obstacle}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusPill tone="mute">
                    <Users size={11} aria-hidden="true" />
                    <span dir="ltr">{d.labour}</span>
                    <span className="sr-only">{t("site.daily.labour")}</span>
                  </StatusPill>
                  <StatusPill tone="mute">
                    <Truck size={11} aria-hidden="true" />
                    <span dir="ltr">{d.plant}</span>
                    <span className="sr-only">{t("site.daily.plant")}</span>
                  </StatusPill>
                  <Files files={d.files} none={t("site.daily.no_files")} />
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5">
            <span className="text-xs text-muted-foreground">{avg !== null ? t("site.daily.avg", { avg, count: shown.length }) : null}</span>
            {reports.length > DAILY_SHOWN && (
              <Button size="sm" variant="ghost" onClick={() => setAllDaily(!allDaily)}>
                {allDaily ? t("site.show_less") : t("site.show_all", { count: reports.length })}
              </Button>
            )}
          </div>
        </>
      )}
    </Panel>
  )

  // ---- Obstacles & RFI ------------------------------------------------------
  const open = obstacles.filter(isOpenObstacle)
  const closed = obstacles.filter((o) => !isOpenObstacle(o))
  const newObstacle = canObs ? (
    <Button size="sm" variant="outline" onClick={() => setDialog("obstacle")}>
      <Plus size={15} className="me-1.5" aria-hidden="true" />
      {t("site.obs.new")}
    </Button>
  ) : null

  const closedRow = (o: PmObstacle) => (
    <li key={o.id} className="flex items-start gap-2.5 px-4 py-3">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success/10 text-success">
        <Check size={13} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-bold" dir="auto">
          {obsNo(o)}: {o.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("site.obs.closed_after", { count: obstacleDays(o, today) })}
          {o.party !== "none" ? ` · ${t("site.obs.with", { party: partyOf(o) })}` : ""}
          {blocksText(o) ? ` · ${blocksText(o)}` : ""}
        </p>
        {o.answer && (
          <p className="text-xs" dir="auto">
            {t("site.obs.answer_line", { text: o.answer })}
          </p>
        )}
        {chaseLine(o) && <p className="text-xs text-muted-foreground">{chaseLine(o)}</p>}
        {coverLine(o)}
      </div>
    </li>
  )

  const openRow = (o: PmObstacle, compact: boolean) => {
    const tone = obstacleTone(o, today)
    const days = obstacleDays(o, today)
    return (
      <li key={o.id} className="flex flex-wrap items-start gap-2.5 px-4 py-3">
        {!compact && (
          <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full", tone === "late" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
            <Clock size={13} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-bold" dir="auto">
            {obsNo(o)}: {o.title}
          </p>
          <p className={cn("text-xs", tone === "late" ? "font-semibold text-destructive" : "text-muted-foreground")}>
            {t("site.obs.open_for", { count: days })}
            {o.party !== "none" ? ` · ${t("site.obs.with", { party: partyOf(o) })}` : ""}
            {!compact && blocksText(o) ? ` · ${blocksText(o)}` : ""}
            {compact && chaseLine(o) ? ` · ${t("site.obs.chased_short", { count: o.chases?.length ?? 0 })}` : ""}
          </p>
          <p className="text-xs font-semibold text-warning" dir="auto">
            {o.impact}
          </p>
          {!compact && chaseLine(o) && <p className="text-xs text-muted-foreground">{chaseLine(o)}</p>}
          {coverLine(o)}
        </div>
        {obstacleActions(o, compact)}
      </li>
    )
  }

  const sidePanel = (
    <Panel
      title={
        <>
          {t("site.obs.title")}
          {closed.length > 0 && <span className="ms-2 text-xs font-normal text-muted-foreground">{t("site.obs.and_closed", { count: closed.length })}</span>}
        </>
      }
      icon={AlertTriangle}
      count={open.length}
      actions={newObstacle}
      bodyClassName="p-0"
    >
      {open.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("site.obs.nothing_blocking")}</p>
      ) : (
        <ul className="divide-y">{open.map((o) => openRow(o, true))}</ul>
      )}
      {closed.length > 0 && (
        <div className="border-t">
          <Button variant="ghost" size="sm" className="m-2" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? t("site.obs.hide_closed") : t("site.obs.show_closed", { count: closed.length })}
          </Button>
          {showClosed && <ul className="divide-y border-t">{closed.map(closedRow)}</ul>}
        </div>
      )}
    </Panel>
  )

  const boards = (
    <Panel title={t("site.obs.title")} icon={AlertTriangle} count={open.length} actions={newObstacle} bodyClassName="p-0">
      {obstacles.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={AlertTriangle} title={t("site.obs.empty")} description={t("site.obs.empty_desc")} />
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 lg:divide-x lg:rtl:divide-x-reverse">
          <section aria-label={t("site.obs.open")}>
            <h4 className="flex items-center gap-2 border-b px-4 py-2.5 text-xs font-bold">
              <AlertTriangle size={14} className="text-warning" aria-hidden="true" />
              {t("site.obs.open")}
              <StatusPill tone="warn" className="ms-auto">
                {open.length}
              </StatusPill>
            </h4>
            {open.length ? <ul className="divide-y">{open.map((o) => openRow(o, false))}</ul> : <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("site.obs.nothing_open")}</p>}
          </section>
          <section aria-label={t("site.obs.closed")} className="border-t lg:border-t-0">
            <h4 className="flex items-center gap-2 border-b px-4 py-2.5 text-xs font-bold">
              <Check size={14} className="text-success" aria-hidden="true" />
              {t("site.obs.closed")}
            </h4>
            {closed.length ? <ul className="divide-y">{closed.map(closedRow)}</ul> : <p className="px-4 py-6 text-center text-sm text-muted-foreground">—</p>}
          </section>
        </div>
      )}
    </Panel>
  )

  // ---- Safety -----------------------------------------------------------------
  const since = daysSinceLti(incidents, startOn, today)
  const lost = lostDays(incidents)
  const live = livePermits(permits, today)
  const dead = expiredPermits(permits, today)
  const pmtTone: Record<ReturnType<typeof permitState>, PillTone> = { expired: "bad", today: "warn", soon: "warn", valid: "ok" }
  const pmtText = (p: PmPermit) => {
    const s = permitState(p, today)
    return s === "expired" ? t("site.hse.pmt_expired", { date: pmDate(p.to, locale) }) : s === "today" ? t("site.hse.pmt_today") : t("site.hse.pmt_until", { date: pmDate(p.to, locale) })
  }
  const tile = (label: string, value: string, sub: string, bad = false) => (
    <div className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", bad && "text-destructive")} dir="auto">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  )
  const safetyPanel = (
    <Panel
      title={
        <>
          {t("site.hse.title")}
          <span className="ms-2 text-xs font-normal text-muted-foreground">{t("site.hse.sub")}</span>
        </>
      }
      icon={ShieldCheck}
      actions={
        canHse ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setDialog("permit")}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("site.hse.pmt_new")}
            </Button>
            <Button size="sm" onClick={() => setDialog("incident")}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("site.hse.inc_new")}
            </Button>
          </>
        ) : null
      }
      bodyClassName="p-0"
    >
      <div className="m-4 grid overflow-hidden rounded-xl border sm:grid-cols-3 sm:divide-x sm:rtl:divide-x-reverse max-sm:divide-y">
        {tile(t("site.hse.since_lti"), since ? t("days", { count: since.days }) : "—", since ? (since.fromLti ? t("site.hse.since_lti_last") : t("site.hse.since_lti_none")) : t("site.hse.since_lti_unstarted"))}
        {tile(t("site.hse.lost"), String(lost), t("site.hse.lost_sub"), lost > 0)}
        {tile(t("site.hse.live_permits"), String(live.length), dead.length ? t("site.hse.expired_n", { count: dead.length }) : t("site.hse.none_expired"))}
      </div>
      {permits.length > 0 && (
        <ul className="mx-4 mb-3 space-y-1.5">
          {permits.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <b className="min-w-0 flex-1" dir="auto">
                {p.title}
              </b>
              <span className="text-xs text-muted-foreground" dir="auto">
                {p.who}
              </span>
              <StatusPill tone={pmtTone[permitState(p, today)]}>{pmtText(p)}</StatusPill>
            </li>
          ))}
        </ul>
      )}
      {incidents.length === 0 ? (
        <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">{t("site.hse.empty")}</p>
      ) : (
        <ul className="divide-y border-t">
          {incidents.map((x) => {
            const known = (INCIDENT_TYPES as readonly string[]).includes(x.type)
            return (
              <li key={x.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-bold" dir="auto">
                    {x.what}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pmDate(x.day, locale)} · <span dir="auto">{x.byName || "—"}</span>
                    {x.lostDays > 0 ? ` · ${t("site.hse.lost_line", { count: x.lostDays })}` : ""}
                  </p>
                  <p className="text-xs font-semibold text-success" dir="auto">
                    {t("site.hse.action_line", { text: x.action })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Files files={x.files} />
                  <StatusPill tone={known ? INC_TONE[x.type] : "bad"}>{known ? t(`site.hse.type.${x.type}`) : t("unknown_state")}</StatusPill>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )

  const both = sections.daily && sections.rfi
  return (
    <div className="space-y-4">
      {both ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-4">
            {dailyPanel}
            {sections.hse && safetyPanel}
          </div>
          {sidePanel}
        </div>
      ) : (
        <>
          {sections.daily ? dailyPanel : sections.rfi ? boards : null}
          {sections.hse && safetyPanel}
        </>
      )}

      <DailyReportDialog
        open={dialog === "daily"}
        onOpenChange={(o) => setDialog(o ? "daily" : null)}
        orgId={orgId}
        projectId={projectId}
        filedToday={filedToday}
        archived={archived}
        onSubmit={(v) =>
          firestore
            ? run("daily", () => fileDailyReport(firestore, access.ctx, projectId, actor, v), v.files.length ? t("site.daily.saved_files", { count: v.files.length }) : t("site.daily.saved"))
            : Promise.resolve(false)
        }
      />
      <ObstacleDialog
        open={dialog === "obstacle"}
        onOpenChange={(o) => setDialog(o ? "obstacle" : null)}
        items={items}
        archived={archived}
        onSubmit={(v) => (firestore ? run("obs", () => openObstacle(firestore, access.ctx, projectId, actor, v), t("site.obs.opened")) : Promise.resolve(false))}
      />
      <CloseObstacleDialog
        target={closing ? { no: obsNo(closing), title: closing.title, openOn: closing.openOn } : null}
        onClose={() => setClosing(null)}
        archived={archived}
        onSubmit={(v) =>
          firestore && closing
            ? run("close", () => closeObstacle(firestore, access.ctx, projectId, actor, closing.id, v), t("site.obs.closed_done", { no: obsNo(closing), count: daysBetween(closing.openOn, v.on) }))
            : Promise.resolve(false)
        }
      />
      <IncidentDialog
        open={dialog === "incident"}
        onOpenChange={(o) => setDialog(o ? "incident" : null)}
        orgId={orgId}
        projectId={projectId}
        archived={archived}
        onSubmit={(v) =>
          firestore
            ? run("inc", () => logIncident(firestore, access.ctx, projectId, actor, v), v.lostDays > 0 ? t("site.hse.inc_saved_lost", { type: t(`site.hse.type.${v.type}`), count: v.lostDays }) : t("site.hse.inc_saved", { type: t(`site.hse.type.${v.type}`) }))
            : Promise.resolve(false)
        }
      />
      <PermitDialog
        open={dialog === "permit"}
        onOpenChange={(o) => setDialog(o ? "permit" : null)}
        archived={archived}
        onSubmit={(v) => (firestore ? run("pmt", () => issuePermit(firestore, access.ctx, projectId, actor, v), t("site.hse.pmt_saved")) : Promise.resolve(false))}
      />
    </div>
  )
}
