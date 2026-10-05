"use client"

// Sites (PRD §5 Sites, AS-01, AS-02, AS-04, WF-01 step 3; the prototype's
// `VIEWS.sites`): one card per workplace — present today of those assigned, or
// "no record today", the end of a project site, expired iqamas there — then
// the unassigned with what they cost a month (to the roles that see pay), each
// card opening the place. Below: the manpower requests from Projects, the
// transfers scheduled by an answered plan, the places ending soon and the
// corrections waiting across places; then the list of places (type, which
// decides the labour cost that follows the people there; project; supervisor)
// that the HR manager keeps, and the fleet. A supervisor sees his own places.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { AlertTriangle, ArrowRightLeft, CalendarCheck2, CalendarClock, Loader2, MapPin, Pencil, Plus, Power, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { FleetRegistry } from "@/components/hr/FleetRegistry"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useHrPeople, useOrgPay } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useWorkplaceMonths } from "@/hooks/useWorkplaceMonths"
import { Link } from "@/i18n/routing"
import { assumesPresence, isRestDay } from "@/lib/hr/attendance"
import { legalOnSite } from "@/lib/hr/documents"
import { displayName, type HrEmployee } from "@/lib/hr/employee"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { applyPlannedMove, cancelPlannedMove, MANPOWER_REQUESTS, manpowerNo, plannedBlocks, type ManpowerRequest } from "@/lib/hr/manpower"
import { wageOf } from "@/lib/hr/pay"
import { costKindOf, HR_ASSIGN_FIXES, SITE_TYPES, siteBlocks, siteEndOf, siteLabel, siteWordOf, UNASSIGNED_SITE, type AssignFix, type HrSite, type SiteType } from "@/lib/hr/sites"
import { saveSite, setSiteActive } from "@/lib/hr/site-writes"
import { daysBetween } from "@/lib/hr/statutory"
import { dutyToday } from "@/lib/hr/today"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import type { HrPortal } from "./HrShell"
import { HrManpowerPanel } from "./HrManpowerPanel"

type Draft = { id?: string; name: string; nameEn: string; type: SiteType; projectId: string; endDate: string; supervisorUserId: string }
const EMPTY: Draft = { name: "", nameEn: "", type: "project", projectId: "", endDate: "", supervisorUserId: "" }
const ENDING_DAYS = 45

type Project = { id: string; name?: string; projectManagerName?: string | null; pm?: { no?: string | null; durationDays?: number; startOn?: string } | null; endDate?: string | null }

export function HrSitesView({ access, portal, actorName }: { access: HrAccess; portal: HrPortal; actorName: string }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const orgId = access.orgId
  const today = todayDay()
  const canEdit = access.allowed("settings.manage")
  const mayAssign = access.allowed("employee.assign")
  const money = access.allowed("pay.view")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const { employees, sites: allSites, isLoading } = useHrPeople(access)
  const { requests } = useHrRequests(access)
  const { months: thisMonth } = useWorkplaceMonths(access, today.slice(0, 7))
  const pays = useOrgPay(orgId, money)
  const projQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: projData } = useCollection(projQ)
  const projects = useMemo(() => (projData ?? []) as Project[], [projData])
  const projectOf = (id?: string | null) => (id ? (projects.find((p) => p.id === id) ?? null) : null)
  const mrQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, MANPOWER_REQUESTS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: mrData } = useCollection(mrQ)
  const newRequests = ((mrData ?? []) as unknown as ManpowerRequest[]).filter((r) => r.state === "open").length
  // Corrections waiting across places — the office reads them all; a supervisor sees his own on each place.
  const office = access.ctx.owner || (["manager", "gov", "payroll", "management"] as const).some((r) => access.ctx.roles.has(r))
  const fixQ = useMemoFirebase(() => (firestore && orgId && office ? query(collection(firestore, HR_ASSIGN_FIXES), where("organizationId", "==", orgId), where("state", "==", "pending")) : null), [firestore, orgId, office])
  const { data: fixData } = useCollection(fixQ)
  const fixes = (fixData ?? []) as unknown as AssignFix[]
  const { orgMembers } = useOrgMembers(orgId)

  // A supervisor and nothing else sees his own workplaces only.
  const onlySupervisor = access.ctx.roles.size === 1 && access.ctx.roles.has("supervisor") && !access.ctx.owner
  const sites = useMemo(
    () =>
      allSites
        .filter((s) => !onlySupervisor || access.ctx.sites.includes(s.id))
        .slice()
        .sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name)),
    [allSites, onlySupervisor, access.ctx.sites]
  )
  const live = sites.filter((s) => s.active !== false)
  const duty = useMemo(() => dutyToday({ today, employees, sites: allSites, thisMonth, requests }), [today, employees, allSites, thisMonth, requests])
  const onBooks = (e: HrEmployee) => e.status !== "left" && e.status !== "expected"
  const peopleAt = (siteId: string) => employees.filter((e) => onBooks(e) && (siteId === UNASSIGNED_SITE ? !e.siteId : e.siteId === siteId))
  const bench = peopleAt(UNASSIGNED_SITE)
  const benchCost = money ? bench.reduce((s, e) => s + (pays.get(e.id) ? wageOf(pays.get(e.id)!) : 0), 0) : 0
  const endOf = (s: HrSite) => siteEndOf(s, projectOf(s.projectId))
  const ending = live
    .map((s) => ({ s, end: endOf(s) }))
    .filter((x) => x.end && daysBetween(today, x.end) >= 0 && daysBetween(today, x.end) <= ENDING_DAYS)
    .sort((a, b) => (a.end as string).localeCompare(b.end as string))
  const planned = employees.filter((e) => e.planned && onBooks(e)).sort((a, b) => (a.planned!.on ?? "").localeCompare(b.planned!.on ?? ""))
  const siteName = (id: string | null | undefined) => (!id || id === UNASSIGNED_SITE ? t("sites.unassigned") : (allSites.find((s) => s.id === id)?.name ?? "—"))
  const seesAttendance = (siteId: string) => access.allowed("attendance.record", { site: siteId }) || access.ctx.roles.has("management")
  const memberName = (uid?: string | null) => {
    const m = orgMembers.find((x) => x.id === uid)
    return (m?.name as string) || (m?.email as string) || "—"
  }
  const actor = { uid: user?.uid ?? access.ctx.uid, name: actorName || null }

  const blocks = draft ? siteBlocks({ name: draft.name, type: draft.type, projectId: draft.projectId || null, endDate: draft.endDate || null }) : []

  const run = async (fn: () => Promise<unknown>, ok: string, prefix = "err") => {
    if (!firestore || !orgId) return false
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
      return true
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `${prefix}.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!draft || blocks.length) return
    const ok = await run(() => saveSite(firestore!, access.ctx, orgId!, { name: draft.name, nameEn: draft.nameEn || null, type: draft.type, projectId: draft.projectId || null, endDate: draft.endDate || null, supervisorUserId: draft.supervisorUserId || null }, draft.id), "sites.saved")
    if (ok) setDraft(null)
  }

  const card = (href: string, title: React.ReactNode, line: React.ReactNode, warn = false) => (
    <Link
      href={href}
      className={cn(
        "flex min-w-[11rem] flex-1 basis-44 flex-col gap-1 rounded-xl border bg-card px-3 py-2.5 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        warn && "border-warning/60"
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-bold">{title}</span>
      <span className="text-xs text-muted-foreground">{line}</span>
    </Link>
  )

  return (
    <div className="space-y-6">
      {!onlySupervisor && (
        <nav aria-label={t("site.strip")} className="flex flex-wrap gap-2">
          <div className="flex min-w-[11rem] flex-1 basis-44 flex-col gap-1 rounded-xl border border-module bg-module/10 px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <Users size={14} aria-hidden="true" />
              {t("site.all", { word: t(`site_word.${siteWordOf(access.settings.businessType)}`) })}
            </span>
            <span className="text-xs text-muted-foreground">{t("site.all_line", { n: employees.filter((e) => e.status === "active" || e.status === "leave" || e.status === "leaving").length, r: newRequests })}</span>
          </div>
          {live.map((s) => {
            const d = duty.find((x) => x.siteId === s.id)
            const assigned = d?.assigned ?? 0
            const assumed = assumesPresence(s.id, s.type)
            const none = assigned > 0 && !assumed && !isRestDay(today) && (d?.unrecorded ?? 0) === assigned
            const expired = peopleAt(s.id).filter((e) => !legalOnSite({ ...e, docs: e.docs ?? {} }, today)).length
            const end = endOf(s)
            return (
              <span key={s.id} className="contents">
                {card(
                  `/${portal}/hr/sites/${s.id}`,
                  <>
                    <MapPin size={14} className="text-module" aria-hidden="true" />
                    <span dir="auto" className="truncate">
                      {siteLabel(s, locale)}
                    </span>
                  </>,
                  <>
                    {none ? <span className="font-bold text-warning">{t("site.unrecorded_today")}</span> : t("site.present_of", { p: d?.present ?? 0, n: assigned })}
                    {end ? ` · ${t("sites.ends", { date: hrDate(end, locale) })}` : ""}
                    {expired ? (
                      <>
                        {" · "}
                        <span className="font-bold text-destructive">{t("site.expired_n", { n: expired })}</span>
                      </>
                    ) : null}
                  </>,
                  none || expired > 0
                )}
              </span>
            )
          })}
          {card(
            `/${portal}/hr/sites/${UNASSIGNED_SITE}`,
            <>
              <AlertTriangle size={14} className="text-warning" aria-hidden="true" />
              {t("sites.unassigned")}
            </>,
            <>
              {t("site.bench_n", { n: bench.length })}
              {money && bench.length ? (
                <>
                  {" · "}
                  <span dir="ltr">{hrMoney(Math.round(benchCost))}</span> {t("site.per_month")}
                </>
              ) : null}
            </>,
            bench.length > 0
          )}
        </nav>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <HrManpowerPanel access={access} />
          <Panel
            title={t("sites.title")}
            icon={MapPin}
            count={live.length || undefined}
            actions={
              canEdit ? (
                <Button size="sm" onClick={() => setDraft({ ...EMPTY })}>
                  <Plus size={15} className="me-1.5" aria-hidden="true" />
                  {t("sites.add")}
                </Button>
              ) : null
            }
            bodyClassName="p-0"
          >
            {isLoading ? (
              <div className="flex justify-center p-10">
                <Loader2 className="animate-spin text-muted-foreground" size={24} aria-hidden="true" />
              </div>
            ) : (
              <ul className="divide-y">
                {sites.length === 0 && (
                  <li className="p-4">
                    <EmptyState icon={MapPin} title={t("sites.empty")} description={t("sites.empty_desc")} />
                  </li>
                )}
                {sites.map((s) => {
                  const end = endOf(s)
                  return (
                    <li key={s.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", s.active === false && "opacity-60")}>
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                          <span dir="auto">{siteLabel(s, locale)}</span>
                          <StatusPill tone="module">{t(`site_type.${s.type}`)}</StatusPill>
                          {s.active === false && <StatusPill tone="mute">{t("sites.inactive")}</StatusPill>}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("sites.line", {
                            cost: t(`cost_kind.${costKindOf(s.type)}`),
                            supervisor: s.supervisorUserId ? memberName(s.supervisorUserId) : t("sites.no_supervisor"),
                            count: peopleAt(s.id).length,
                          })}
                          {s.type === "project" && s.projectId ? ` · ${projectOf(s.projectId)?.name ?? "—"}` : ""}
                          {end ? ` · ${t("sites.ends", { date: hrDate(end, locale) })}` : ""}
                        </p>
                      </div>
                      {s.active !== false && seesAttendance(s.id) && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/${portal}/hr/sites/${s.id}`}>
                            <CalendarCheck2 size={14} className="me-1.5" aria-hidden="true" />
                            {t("att.open")}
                          </Link>
                        </Button>
                      )}
                      {canEdit && (
                        <div className="flex shrink-0 gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={t("sites.edit")}
                            onClick={() => setDraft({ id: s.id, name: s.name, nameEn: s.nameEn ?? "", type: s.type, projectId: s.projectId ?? "", endDate: s.endDate ?? "", supervisorUserId: s.supervisorUserId ?? "" })}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </Button>
                          <Button size="sm" variant="outline" aria-label={t(s.active === false ? "sites.activate" : "sites.deactivate")} onClick={() => void run(() => setSiteActive(firestore!, access.ctx, s.id, s.active === false), "sites.saved")}>
                            <Power size={14} aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                })}
                {!onlySupervisor && (
                  <li className="flex flex-wrap items-center gap-3 bg-muted/30 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{t("sites.unassigned")}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("sites.unassigned_line", { count: bench.length })}</p>
                    </div>
                  </li>
                )}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          {planned.length > 0 && (
            <Panel title={t("site.planned_title")} icon={ArrowRightLeft} count={planned.length}>
              <ul className="divide-y">
                {planned.map((e) => {
                  const due = plannedBlocks(e, today).length === 0
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 basis-40">
                        <span className="block font-semibold" dir="auto">
                          {displayName(e, locale)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t("site.planned_line", { from: siteName(e.siteId), to: siteName(e.planned!.siteId), date: hrDate(e.planned!.on, locale) })}
                          {e.planned!.no ? ` · ${manpowerNo(e.planned!.no, locale)}` : ""}
                        </span>
                      </span>
                      {due ? <StatusPill tone="warn">{t("site.planned_due")}</StatusPill> : <StatusPill tone="mute">{t("site.planned_wait")}</StatusPill>}
                      {mayAssign && due && (
                        <Button size="sm" onClick={() => void run(() => applyPlannedMove(firestore!, access.ctx, e.id, actor), "site.planned_applied", "move.block")} disabled={busy}>
                          {t("site.planned_apply")}
                        </Button>
                      )}
                      {mayAssign && (
                        <Button size="sm" variant="outline" onClick={() => void run(() => cancelPlannedMove(firestore!, access.ctx, e.id, actor), "site.planned_cancelled")} disabled={busy}>
                          {t("site.planned_cancel")}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Panel>
          )}

          {!onlySupervisor && (
            <Panel title={t("today.ending")} icon={CalendarClock} count={ending.length || undefined}>
              {ending.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("today.ending_none", { n: ENDING_DAYS })}</p>
              ) : (
                <ul className="divide-y">
                  {ending.map(({ s, end }) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 basis-40">
                        <span className="block font-semibold" dir="auto">
                          {s.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t("site.ending_row", { date: hrDate(end, locale), n: peopleAt(s.id).length })}
                          {projectOf(s.projectId)?.projectManagerName ? ` · ${t("site.pm", { name: projectOf(s.projectId)!.projectManagerName! })}` : ""}
                        </span>
                      </span>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/${portal}/hr/sites/${s.id}`}>{t("site.plan")}</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {office && fixes.length > 0 && (
            <Panel title={t("site.fixes_title")} icon={ArrowRightLeft} count={fixes.length}>
              <p className="mb-2 text-xs text-muted-foreground">{t("site.fixes_note")}</p>
              <ul className="divide-y">
                {fixes.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 basis-40">
                      <span className="block font-semibold" dir="auto">
                        {f.employeeName}
                      </span>
                      <span className="block text-xs text-muted-foreground">{t("site.fix_line", { site: siteName(f.siteId), date: hrDate(f.since, locale), by: f.byName || "—" })}</span>
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/${portal}/hr/sites/${f.siteId}`}>{t("site.open")}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      {orgId && <FleetRegistry orgId={orgId} actor={{ id: access.ctx.uid, name: actorName }} />}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t(draft?.id ? "sites.edit" : "sites.add")}</DialogTitle>
            <DialogDescription>{t("sites.dialog_desc")}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="site-name">{t("sites.name")}</Label>
                  <Input id="site-name" dir="auto" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={busy} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="site-name-en">{t("sites.name_en")}</Label>
                  <Input id="site-name-en" dir="ltr" value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} disabled={busy} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="site-type">{t("sites.type")}</Label>
                  <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v as SiteType })} disabled={busy}>
                    <SelectTrigger id="site-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SITE_TYPES.map((x) => (
                        <SelectItem key={x} value={x}>
                          {t(`site_type.${x}`)} — <span className="text-muted-foreground">{t(`cost_kind.${costKindOf(x)}`)}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">{t("sites.cost_note", { cost: t(`cost_kind.${costKindOf(draft.type)}`) })}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="site-end">{t("sites.end")}</Label>
                  <Input id="site-end" type="date" dir="ltr" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} disabled={busy} />
                  {draft.type === "project" && draft.projectId && projectOf(draft.projectId)?.pm?.startOn ? (
                    <p className="text-[11px] text-muted-foreground">{t("site.end_from_project", { date: hrDate(siteEndOf({ endDate: null }, projectOf(draft.projectId)), locale) })}</p>
                  ) : null}
                </div>
              </div>
              {draft.type === "project" && (
                <div className="space-y-1.5">
                  <Label htmlFor="site-project">{t("sites.project")}</Label>
                  <SearchableSelect
                    id="site-project"
                    value={draft.projectId}
                    onChange={(v) => setDraft({ ...draft, projectId: v })}
                    options={projects.map((p) => ({ value: p.id, label: p.name || p.id }))}
                    placeholder={t("sites.pick_project")}
                    searchPlaceholder={t("search")}
                    noResultsText={t("no_results")}
                    disabled={busy}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="site-sup">{t("sites.supervisor")}</Label>
                <SearchableSelect
                  id="site-sup"
                  value={draft.supervisorUserId}
                  onChange={(v) => setDraft({ ...draft, supervisorUserId: v })}
                  options={orgMembers.map((m) => ({ value: m.id, label: (m.name as string) || (m.email as string) || m.id }))}
                  placeholder={t("sites.pick_supervisor")}
                  searchPlaceholder={t("search")}
                  noResultsText={t("no_results")}
                  disabled={busy}
                />
                <p className="text-[11px] text-muted-foreground">{t("sites.supervisor_note")}</p>
              </div>
              <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`sites.block.${b}`))} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
