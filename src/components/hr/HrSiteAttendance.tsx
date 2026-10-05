"use client"

// A workplace's attendance (PRD AT-01…04, WF-04, WF-05): the day sheet —
// everyone present, then the exceptions (absent · sick · permission ·
// overtime · violation · "a worker here but not listed") — and the month:
// unrecorded days, the named declaration that fills them, each person's
// month, and the closing that never reopens. An office assumes presence.
// The sheet is today's and is saved once: a recorded day is locked, and a
// past day with no sheet is filled only by the declaration (WF-04).

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { CalendarCheck2, Loader2, Lock, Plus, Trash2, UserPlus } from "lucide-react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useHrPeople } from "@/hooks/useHrPeople"
import { useHrRequests } from "@/hooks/useHrRequests"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useTableLabels } from "@/hooks/useTableLabels"
import {
  assumesPresence,
  attendanceId,
  closeBlocks,
  DAY_EXCEPTIONS,
  employeeMonth,
  firstOnSite,
  missingDays,
  monthOf,
  onLeaveOn,
  onSheet,
  sheetBlocks,
  type AttendanceException,
  type DayException,
  type WorkplaceMonth,
} from "@/lib/hr/attendance"
import { closeMonth, recordDay } from "@/lib/hr/attendance-writes"
import { legalOnSite } from "@/lib/hr/documents"
import { HR_ATTENDANCE } from "@/lib/hr/collections"
import { holidayOn, isRamadan } from "@/lib/hr/holidays"
import { displayName } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { empNo, hrDate, todayDay } from "@/lib/hr/format"
import { overtimeOverCap } from "@/lib/hr/pay"
import { VIOLATIONS, type ViolationCode } from "@/lib/hr/penalties"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
import { leaveReturn, notBackOn } from "@/lib/hr/requests"
import { addDays, monthRange } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import { HrAssignFixPanel } from "./HrAssignFixPanel"
import { HrDeclareMissingDialog } from "./HrDeclareMissingDialog"
import { ReturnFromLeave } from "./HrRequestList"

type Seg = "sheet" | "month"
const NO_VIOLATION = "__none__"

export function HrSiteAttendance({ access, siteId, actor }: { access: HrAccess; siteId: string; actor: HrActor }) {
  const t = useTranslations("Portal.HR")
  const tableLabels = useTableLabels()
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const { employees, sites, isLoading } = useHrPeople(access)
  const { requests } = useHrRequests(access)
  const site = siteId === UNASSIGNED_SITE ? { id: UNASSIGNED_SITE, name: t("sites.unassigned"), type: null } : (sites.find((s) => s.id === siteId) ?? null)
  const assumed = assumesPresence(siteId, site?.type ?? null)
  const [seg, setSeg] = useState<Seg>("sheet")
  const [day, setDay] = useState(today)
  const [month, setMonth] = useState(monthOf(addDays(`${today.slice(0, 7)}-01`, -1)))
  const [busy, setBusy] = useState(false)

  const sheetMonth = monthOf(day)
  const sheetRef = useMemoFirebase(() => (firestore && access.orgId ? doc(firestore, HR_ATTENDANCE, attendanceId(access.orgId, siteId, sheetMonth)) : null), [firestore, access.orgId, siteId, sheetMonth])
  const { data: sheetData } = useDoc(sheetRef)
  const sheetWm = (sheetData as unknown as WorkplaceMonth | null) ?? null
  const monthRef = useMemoFirebase(() => (firestore && access.orgId ? doc(firestore, HR_ATTENDANCE, attendanceId(access.orgId, siteId, month)) : null), [firestore, access.orgId, siteId, month])
  const { data: monthData } = useDoc(monthRef)
  const wm = (monthData as unknown as WorkplaceMonth | null) ?? null

  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const name = (id: string) => {
    const e = byId.get(id)
    return e?.names ? displayName(e, locale) : id
  }

  // ---- the day sheet --------------------------------------------------------
  const saved = sheetWm?.days?.[day] ?? null
  const roster = useMemo(() => (saved ? saved.listed : employees.filter((e) => onSheet(e, siteId, day)).map((e) => e.id)), [saved, employees, siteId, day])
  const [ex, setEx] = useState<Record<string, AttendanceException>>({})
  const [unlisted, setUnlisted] = useState<Array<{ name: string; note: string }>>([])
  // Reload the rows only when THIS day's record changes: the month's document
  // gets a new identity whenever anyone saves any other day, and that must not
  // wipe what is being typed here.
  const savedAt = saved?.at ?? ""
  useEffect(() => {
    setEx(saved?.ex ?? {})
    setUnlisted((saved?.unlisted ?? []).map((u) => ({ name: u.name, note: u.note ?? "" })))
    // `saved` is read at the moment its stamp changes — it is deliberately not a dependency.
  }, [savedAt, day])
  // On approved leave that day (paid or not): shown, never recorded absent.
  const onLeave = useMemo(() => onLeaveOn(requests, day), [requests, day])
  // AT-05 — after a leave's end and before his return is recorded, he is absent without leave:
  // the row starts as absent (the supervisor may still correct it) and offers "started today".
  const notBack = useMemo(() => notBackOn(requests, day), [requests, day])
  const lateLeave = (id: string) => requests.find((r) => r.employeeId === id && r.kind === "leave" && r.state === "approved" && r.leave && day > r.leave.to && (!r.returned || day < r.returned.on)) ?? null
  const exOf = (id: string): AttendanceException => ex[id] ?? (!saved && notBack.has(id) ? { status: "absent" } : {})
  const mayViolation = access.allowed("violation.record", { site: siteId })
  const mayRecord = access.allowed("attendance.record", { site: siteId })
  const sheetClosed = Boolean(sheetWm?.closed)
  // AT-06 — a public holiday is paid and needs no sheet; hours worked on it are overtime.
  const holiday = holidayOn(day)
  const sBlocks = sheetBlocks({ day, today, closed: sheetClosed, recorded: Boolean(saved), listed: roster, ex, mayRecordViolation: mayViolation })
  // WF-04 — only today's sheet, and only until it is saved.
  const editable = mayRecord && !sheetClosed && !saved && day === today
  const setRow = (id: string, patch: Partial<AttendanceException>) => setEx((m) => ({ ...m, [id]: { ...m[id], ...patch } }))

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    if (!firestore || !access.orgId || !site) return false
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
      return true
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `att.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save", { n: missing.length }), variant: "destructive" })
      return false
    } finally {
      setBusy(false)
    }
  }
  const siteRef = { id: siteId, type: site?.type ?? null }
  const saveSheet = () => {
    // Nothing is recorded against someone on approved leave that day; someone not back from one is absent unless corrected.
    const rows = Object.fromEntries(roster.map((id) => [id, exOf(id)]))
    const kept = Object.fromEntries(Object.entries({ ...rows, ...ex }).filter(([id]) => !onLeave.has(id)))
    return run(() => recordDay(firestore!, access.ctx, access.orgId!, siteRef, day, actor, { listed: roster, ex: kept, unlisted }), "att.saved")
  }

  // ---- the month ------------------------------------------------------------
  // The people the record places here — the month counts from the first day one of them was here (AT-04).
  const placed = useMemo(() => employees.filter((e) => (siteId === UNASSIGNED_SITE ? !e.siteId : e.siteId === siteId)), [employees, siteId])
  const missing = useMemo(() => missingDays(wm, month, today, { assumed, from: assumed ? undefined : firstOnSite(placed, wm, month) }), [wm, month, today, assumed, placed])
  const [declaring, setDeclaring] = useState(false)
  const policy = access.settings.policies.closeMissing
  const close = closeBlocks({ month, today, closed: Boolean(wm?.closed), missing, policy })
  const [confirming, setConfirming] = useState(false)
  const people = useMemo(() => {
    const ids = new Set<string>()
    for (const s of Object.values(wm?.days ?? {})) s.listed.forEach((id) => ids.add(id))
    for (const d of wm?.declarations ?? []) d.employees.forEach((id) => ids.add(id))
    if (!wm?.closed) employees.filter((e) => onSheet(e, siteId, monthRange(month).end)).forEach((e) => ids.add(e.id))
    return [...ids].map((id) => ({ id, m: employeeMonth(wm, id), no: byId.get(id)?.no ?? 0 })).sort((a, b) => a.no - b.no)
  }, [wm, employees, siteId, month, byId])
  type Person = (typeof people)[number]
  const total = (f: (p: Person) => number) => people.reduce((a, p) => a + f(p), 0)
  const summaryColumns: DataColumn<Person>[] = [
    { key: "name", header: t("people.col.name"), cell: (p) => <span className="font-semibold" dir="auto">{name(p.id)}</span>, sortValue: (p) => name(p.id), footer: t("att.total") },
    { key: "present", header: t("att.col.present"), numeric: true, cell: (p) => p.m.present, sortValue: (p) => p.m.present, footer: total((p) => p.m.present) },
    { key: "absent", header: t("att.col.absent"), numeric: true, cell: (p) => <span className={cn(p.m.absent > 0 && "font-bold text-destructive")}>{p.m.absent}</span>, sortValue: (p) => p.m.absent, footer: total((p) => p.m.absent) },
    { key: "sick", header: t("att.col.sick"), numeric: true, cell: (p) => p.m.sick, sortValue: (p) => p.m.sick, footer: total((p) => p.m.sick) },
    { key: "permission", header: t("att.col.permission"), numeric: true, cell: (p) => p.m.permission, sortValue: (p) => p.m.permission, footer: total((p) => p.m.permission) },
    { key: "declared", header: t("att.col.declared"), numeric: true, cell: (p) => <span className={cn(p.m.declared > 0 && "text-warning")}>{p.m.declared}</span>, sortValue: (p) => p.m.declared, footer: total((p) => p.m.declared) },
    { key: "ot", header: t("att.col.ot"), numeric: true, cell: (p) => <span className={cn(overtimeOverCap(p.m.overtimeHours) && "font-bold text-warning")}>{p.m.overtimeHours}</span>, sortValue: (p) => p.m.overtimeHours, footer: total((p) => p.m.overtimeHours) },
  ]
  const months = [monthOf(addDays(`${today.slice(0, 7)}-01`, -1)), today.slice(0, 7)]

  if (isLoading) {
    return (
      <div className="flex justify-center p-16">
        <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
      </div>
    )
  }
  if (!site) return <EmptyState icon={CalendarCheck2} title={t("att.no_site")} description={t("att.no_site_desc")} />

  return (
    <div className="space-y-5">
      <SegmentedNav
        segments={[
          { id: "sheet", label: t("att.seg.sheet") },
          { id: "month", label: t("att.seg.month"), count: missing.length || undefined, tone: missing.length ? "warn" : undefined },
        ]}
        active={seg}
        onSelect={(s) => setSeg(s as Seg)}
        ariaLabel={t("att.segments")}
      />

      {seg === "sheet" && (
        <Panel
          title={t("att.sheet_title", { day: hrDate(day, locale) })}
          icon={CalendarCheck2}
          count={roster.length}
          actions={<Input type="date" dir="ltr" aria-label={t("att.day")} value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-9 w-40" />}
        >
          <div className="space-y-3">
            {assumed && <Callout tone="info">{t("att.assumed")}</Callout>}
            {holiday && <Callout tone="info">{t("att.holiday", { name: t(`holiday.${holiday.key}`) })}</Callout>}
            {!holiday && isRamadan(day) && <Callout tone="info">{t("att.ramadan")}</Callout>}
            {sheetClosed && <Callout tone="block">{t("att.month_closed")}</Callout>}
            {saved && <p className="text-xs text-muted-foreground">{t("att.recorded_by", { name: saved.byName || "—", at: hrDate(saved.at, locale) })}</p>}
            {saved && !sheetClosed && <Callout tone="info">{t("att.day_locked")}</Callout>}
            {!saved && !sheetClosed && day < today && !assumed && <Callout tone="warn">{t("att.day_past")}</Callout>}
            {roster.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{t("att.nobody")}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {roster.map((id) => {
                  const e = exOf(id)
                  const status: DayException | "present" = e.status ?? "present"
                  const late = notBack.has(id) ? lateLeave(id) : null
                  const stage = late ? leaveReturn({ ...late, returned: null }, day) : null
                  if (onLeave.has(id)) {
                    return (
                      <li key={id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                        <div className="min-w-0 flex-1 basis-40">
                          <p className="truncate text-sm font-bold" dir="auto">
                            {name(id)}
                          </p>
                          <p className="text-[11px] text-muted-foreground" dir="ltr">
                            {empNo(byId.get(id)?.no)}
                          </p>
                        </div>
                        <StatusPill tone="info">{t("att.on_leave")}</StatusPill>
                        <p className="basis-full text-xs text-muted-foreground">{t("att.on_leave_note")}</p>
                      </li>
                    )
                  }
                  return (
                    <li key={id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="truncate text-sm font-bold" dir="auto">
                          {name(id)}
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span dir="ltr">{empNo(byId.get(id)?.no)}</span>
                          {byId.get(id) && !legalOnSite({ ...byId.get(id)!, docs: byId.get(id)!.docs ?? {} }, day) && <StatusPill tone="bad">{t("att.iqama_expired")}</StatusPill>}
                        </p>
                      </div>
                      {late && stage && (
                        <div className="flex basis-full flex-wrap items-center gap-2">
                          <StatusPill tone={stage.stage === "due" ? "warn" : "bad"}>{t("ret.not_back", { n: stage.daysLate })}</StatusPill>
                          <span className="text-xs text-muted-foreground">{t(`ret.stage.${stage.stage}`)}</span>
                          {!late.returned && <ReturnFromLeave access={access} r={late} actor={actor} on={day} />}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1" role="group" aria-label={t("att.status_of", { name: name(id) })}>
                        {(["present", ...DAY_EXCEPTIONS] as const).map((s) => (
                          <Button
                            key={s}
                            type="button"
                            size="sm"
                            variant={status === s ? (s === "present" ? "default" : "destructive") : "outline"}
                            aria-pressed={status === s}
                            disabled={!editable || busy}
                            onClick={() => setRow(id, s === "absent" || s === "sick" ? { status: s, ot: null } : { status: s === "present" ? null : s })}
                            className="h-8 rounded-full px-3 text-xs"
                          >
                            {t(`att.status.${s}`)}
                          </Button>
                        ))}
                      </div>
                      <Input
                        type="number"
                        min="0"
                        max="12"
                        step="0.5"
                        dir="ltr"
                        aria-label={t("att.ot_of", { name: name(id) })}
                        placeholder={t("att.ot")}
                        value={e.ot ?? ""}
                        onChange={(ev) => setRow(id, { ot: ev.target.value === "" ? null : Number(ev.target.value) })}
                        disabled={!editable || busy || status === "absent" || status === "sick"}
                        className="h-8 w-20"
                      />
                      {mayViolation && (
                        <Select value={e.violation ?? NO_VIOLATION} onValueChange={(v) => setRow(id, { violation: v === NO_VIOLATION ? null : (v as ViolationCode) })} disabled={!editable || busy}>
                          <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("att.violation_of", { name: name(id) })}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_VIOLATION}>{t("att.no_violation")}</SelectItem>
                            {(Object.keys(VIOLATIONS) as ViolationCode[]).map((v) => (
                              <SelectItem key={v} value={v}>
                                {t(`violation.${v}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {saved && (saved.unlisted ?? []).length > 0 && (
              <div className="space-y-1 rounded-xl border border-dashed p-3">
                <p className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                  <UserPlus size={14} aria-hidden="true" />
                  {t("att.unlisted_saved")}
                </p>
                <ul className="space-y-0.5 text-sm">
                  {(saved.unlisted ?? []).map((u, i) => (
                    <li key={i} dir="auto">
                      <span className="font-semibold">{u.name}</span>
                      {u.note ? <span className="text-muted-foreground"> — {u.note}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground">{t("att.unlisted_hint")}</p>
              </div>
            )}
            {editable && (
            <div className="space-y-2 rounded-xl border border-dashed p-3">
              <p className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                <UserPlus size={14} aria-hidden="true" />
                {t("att.unlisted")}
              </p>
              {unlisted.map((u, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <Input aria-label={t("att.unlisted_name")} placeholder={t("att.unlisted_name")} value={u.name} onChange={(e) => setUnlisted((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-8 flex-1 basis-40" disabled={busy} />
                  <Input aria-label={t("att.unlisted_note")} placeholder={t("att.unlisted_note")} value={u.note} onChange={(e) => setUnlisted((l) => l.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} className="h-8 flex-1 basis-40" disabled={busy} />
                  <Button type="button" size="sm" variant="ghost" aria-label={t("att.remove")} onClick={() => setUnlisted((l) => l.filter((_, j) => j !== i))} disabled={busy}>
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={() => setUnlisted((l) => [...l, { name: "", note: "" }])} disabled={busy}>
                <Plus size={14} className="me-1.5" aria-hidden="true" />
                {t("att.unlisted_add")}
              </Button>
            </div>
            )}

            {editable && <BlockingReasons title={t("cannot_save")} reasons={sBlocks.map((b) => t(`att.block.${b}`))} />}
            {editable && <p className="text-xs text-muted-foreground">{t("att.save_locks")}</p>}
            {editable && (
              <div className="flex justify-end">
                <Button onClick={() => void saveSheet()} disabled={busy || sBlocks.length > 0}>
                  {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                  {t("att.save")}
                </Button>
              </div>
            )}
          </div>
        </Panel>
      )}

      {seg === "sheet" && siteId !== UNASSIGNED_SITE && <HrAssignFixPanel access={access} actor={actor} siteId={siteId} employees={employees} sites={sites} />}

      {seg === "month" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {months.map((m) => (
              <Button key={m} size="sm" variant={month === m ? "default" : "outline"} aria-pressed={month === m} onClick={() => setMonth(m)} className="rounded-full">
                {m}
              </Button>
            ))}
            <Input type="month" dir="ltr" aria-label={t("att.month")} value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 w-40" />
            {wm?.closed ? <StatusPill tone="mute">{t("att.closed_pill")}</StatusPill> : <StatusPill tone="info">{t("att.open_pill")}</StatusPill>}
          </div>

          {wm?.closed && (
            <Callout tone="info" title={t("att.closed_title")}>
              {t("att.closed_line", { name: wm.closed.byName || "—", at: hrDate(wm.closed.at, locale) })}
              {wm.closed.asIs && ` ${t("att.closed_as_is", { n: wm.closed.missing.length })}`}
            </Callout>
          )}

          {!wm?.closed && !assumed && (
            <Panel title={t("att.missing_title")} count={missing.length}>
              {missing.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t("att.missing_none")}</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">{t("att.missing_desc")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {missing.map((d) => (
                      <span key={d} className="rounded-full border border-warning bg-warning/10 px-2.5 py-1 text-xs">
                        {hrDate(d, locale)}
                      </span>
                    ))}
                  </div>
                  {access.allowed("attendance.declare", { site: siteId }) ? (
                    <div className="flex justify-end">
                      <Button variant="outline" onClick={() => setDeclaring(true)} disabled={busy}>
                        {t("att.fill_open")}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("att.declare_who")}</p>
                  )}
                </div>
              )}
            </Panel>
          )}

          {(wm?.declarations ?? []).length > 0 && (
            <Panel title={t("att.declarations")} count={wm!.declarations.length}>
              <ul className="divide-y">
                {wm!.declarations.map((d, i) => (
                  <li key={i} className="py-2 text-sm">
                    <p className="font-semibold">{t("att.declaration_line", { n: d.days.length, name: d.byName || "—", at: hrDate(d.at, locale) })}</p>
                    <p className="text-xs text-muted-foreground">{t("att.declaration_people", { n: d.employees.length })}</p>
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {d.note}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={t("att.people_title")} count={people.length} bodyClassName="p-0">
            <DataTable
              bordered={false}
              dense
              caption={t("att.people_title")}
              labels={tableLabels}
              columns={summaryColumns}
              rows={people}
              rowKey={(p) => p.id}
              rowTone={(p) => (p.m.absent > 0 ? "warn" : undefined)}
              empty={<p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("att.nobody")}</p>}
            />
          </Panel>

          {!wm?.closed && access.allowed("attendance.close", { site: siteId }) && (
            <div className="space-y-2">
              <BlockingReasons title={t("att.cannot_close")} reasons={close.blocks.map((b) => t(`att.block.${b}`, { n: missing.length }))} />
              {close.warnings.length > 0 && <Callout tone="warn">{t("att.close_warn", { n: missing.length })}</Callout>}
              <div className="flex justify-end">
                <Button onClick={() => setConfirming(true)} disabled={busy || close.blocks.length > 0}>
                  <Lock size={15} className="me-1.5" aria-hidden="true" />
                  {t(close.warnings.length ? "att.close_as_is" : "att.close")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {declaring && (
        <HrDeclareMissingDialog
          access={access}
          actor={actor}
          site={siteRef}
          siteName={site.name}
          month={month}
          wm={wm}
          missing={missing}
          people={placed}
          onClose={() => setDeclaring(false)}
        />
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("att.confirm_title", { month, site: site.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("att.confirm_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run(() => closeMonth(firestore!, access.ctx, access.orgId!, siteRef, month, actor, policy), "att.closed")}>{t("att.close")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
