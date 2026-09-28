"use client"

// A workplace's attendance (PRD AT-01…04, WF-04, WF-05): the day sheet —
// everyone present, then the exceptions (absent · sick · permission ·
// overtime · violation · "a worker here but not listed") — and the month:
// unrecorded days, the named declaration that fills them, each person's
// month, and the closing that never reopens. An office assumes presence.

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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useHrPeople } from "@/hooks/useHrPeople"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import {
  assumesPresence,
  attendanceId,
  closeBlocks,
  DAY_EXCEPTIONS,
  declareBlocks,
  employeeMonth,
  missingDays,
  monthOf,
  sheetBlocks,
  type AttendanceException,
  type DayException,
  type WorkplaceMonth,
} from "@/lib/hr/attendance"
import { closeMonth, declareMissing, recordDay } from "@/lib/hr/attendance-writes"
import { HR_ATTENDANCE } from "@/lib/hr/collections"
import { displayName, type HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { empNo, hrDate, todayDay } from "@/lib/hr/format"
import { overtimeOverCap } from "@/lib/hr/pay"
import { VIOLATIONS, type ViolationCode } from "@/lib/hr/penalties"
import { UNASSIGNED_SITE } from "@/lib/hr/sites"
import { addDays, monthRange } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"

type Seg = "sheet" | "month"
const NO_VIOLATION = "__none__"

/** Who is on a workplace's sheet on a day: active there, or joined by then. */
function onSheet(e: HrEmployee, siteId: string, day: string) {
  const here = siteId === UNASSIGNED_SITE ? !e.siteId : e.siteId === siteId
  if (!here) return false
  if (e.status === "active") return true
  return e.status === "expected" && Boolean(e.join) && e.join <= day
}

export function HrSiteAttendance({ access, siteId, actor }: { access: HrAccess; siteId: string; actor: HrActor }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const { employees, sites, isLoading } = useHrPeople(access.orgId)
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
  useEffect(() => {
    setEx(saved?.ex ?? {})
    setUnlisted((saved?.unlisted ?? []).map((u) => ({ name: u.name, note: u.note ?? "" })))
  }, [saved, day])
  const mayViolation = access.allowed("violation.record", { site: siteId })
  const mayRecord = access.allowed("attendance.record", { site: siteId })
  const sheetClosed = Boolean(sheetWm?.closed)
  const sBlocks = sheetBlocks({ day, today, closed: sheetClosed, listed: roster, ex, mayRecordViolation: mayViolation })
  const setRow = (id: string, patch: Partial<AttendanceException>) => setEx((m) => ({ ...m, [id]: { ...m[id], ...patch } }))

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (!firestore || !access.orgId || !site) return
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `att.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save", { n: missing.length }), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  const siteRef = { id: siteId, type: site?.type ?? null }
  const saveSheet = () => run(() => recordDay(firestore!, access.ctx, access.orgId!, siteRef, day, actor, { listed: roster, ex, unlisted }), "att.saved")

  // ---- the month ------------------------------------------------------------
  const missing = useMemo(() => missingDays(wm, month, today, { assumed }), [wm, month, today, assumed])
  const [pick, setPick] = useState<string[]>([])
  const [note, setNote] = useState("")
  useEffect(() => setPick(missing), [missing])
  const dBlocks = declareBlocks({ days: pick, note, missing, closed: Boolean(wm?.closed) })
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
  const rosterNow = employees.filter((e) => onSheet(e, siteId, monthRange(month).end)).map((e) => e.id)
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
            {sheetClosed && <Callout tone="block">{t("att.month_closed")}</Callout>}
            {saved && <p className="text-xs text-muted-foreground">{t("att.recorded_by", { name: saved.byName || "—", at: hrDate(saved.at, locale) })}</p>}
            {roster.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{t("att.nobody")}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {roster.map((id) => {
                  const e = ex[id] ?? {}
                  const status: DayException | "present" = e.status ?? "present"
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
                      <div className="flex flex-wrap gap-1" role="group" aria-label={t("att.status_of", { name: name(id) })}>
                        {(["present", ...DAY_EXCEPTIONS] as const).map((s) => (
                          <Button
                            key={s}
                            type="button"
                            size="sm"
                            variant={status === s ? (s === "present" ? "default" : "destructive") : "outline"}
                            aria-pressed={status === s}
                            disabled={!mayRecord || sheetClosed || busy}
                            onClick={() => setRow(id, { status: s === "present" ? null : s })}
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
                        disabled={!mayRecord || sheetClosed || busy || status === "absent" || status === "sick"}
                        className="h-8 w-20"
                      />
                      {mayViolation && (
                        <Select value={e.violation ?? NO_VIOLATION} onValueChange={(v) => setRow(id, { violation: v === NO_VIOLATION ? null : (v as ViolationCode) })} disabled={sheetClosed || busy}>
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

            <div className="space-y-2 rounded-xl border border-dashed p-3">
              <p className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                <UserPlus size={14} aria-hidden="true" />
                {t("att.unlisted")}
              </p>
              {unlisted.map((u, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <Input aria-label={t("att.unlisted_name")} placeholder={t("att.unlisted_name")} value={u.name} onChange={(e) => setUnlisted((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-8 flex-1 basis-40" disabled={sheetClosed || busy} />
                  <Input aria-label={t("att.unlisted_note")} placeholder={t("att.unlisted_note")} value={u.note} onChange={(e) => setUnlisted((l) => l.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} className="h-8 flex-1 basis-40" disabled={sheetClosed || busy} />
                  <Button type="button" size="sm" variant="ghost" aria-label={t("att.remove")} onClick={() => setUnlisted((l) => l.filter((_, j) => j !== i))} disabled={sheetClosed || busy}>
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {mayRecord && !sheetClosed && (
                <Button type="button" size="sm" variant="outline" onClick={() => setUnlisted((l) => [...l, { name: "", note: "" }])} disabled={busy}>
                  <Plus size={14} className="me-1.5" aria-hidden="true" />
                  {t("att.unlisted_add")}
                </Button>
              )}
            </div>

            <BlockingReasons title={t("cannot_save")} reasons={sBlocks.map((b) => t(`att.block.${b}`))} />
            {mayRecord && (
              <div className="flex justify-end">
                <Button onClick={() => void saveSheet()} disabled={busy || sBlocks.length > 0}>
                  {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                  {t(saved ? "att.save_again" : "att.save")}
                </Button>
              </div>
            )}
          </div>
        </Panel>
      )}

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
                      <label key={d} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", pick.includes(d) && "border-warning bg-warning/10")}>
                        <Checkbox
                          checked={pick.includes(d)}
                          onCheckedChange={(c) => setPick((p) => (c ? [...p, d] : p.filter((x) => x !== d)))}
                          disabled={!access.allowed("attendance.declare", { site: siteId }) || busy}
                          aria-label={hrDate(d, locale)}
                        />
                        {hrDate(d, locale)}
                      </label>
                    ))}
                  </div>
                  {access.allowed("attendance.declare", { site: siteId }) ? (
                    <div className="space-y-2">
                      <Label htmlFor="att-note">{t("att.declare_note")}</Label>
                      <Textarea id="att-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
                      <Callout tone="warn">{t("att.declare_warn", { n: pick.length, people: rosterNow.length })}</Callout>
                      <BlockingReasons title={t("cannot_save")} reasons={dBlocks.map((b) => t(`att.block.${b}`))} />
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          disabled={busy || dBlocks.length > 0}
                          onClick={() =>
                            void run(() => declareMissing(firestore!, access.ctx, access.orgId!, siteRef, month, actor, { days: pick, note, employees: rosterNow }), "att.declared").then(() => setNote(""))
                          }
                        >
                          {t("att.declare", { n: pick.length })}
                        </Button>
                      </div>
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
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {d.note}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={t("att.people_title")} count={people.length} bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-bold">{t("people.col.name")}</th>
                    {(["present", "absent", "sick", "permission", "declared", "ot"] as const).map((k) => (
                      <th key={k} scope="col" className="px-3 py-2 text-end font-bold">
                        {t(`att.col.${k}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {people.map(({ id, m }) => (
                    <tr key={id} className="border-t">
                      <td className="px-3 py-2 font-semibold" dir="auto">
                        {name(id)}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{m.present}</td>
                      <td className={cn("px-3 py-2 text-end tabular-nums", m.absent > 0 && "font-bold text-destructive")}>{m.absent}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{m.sick}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{m.permission}</td>
                      <td className={cn("px-3 py-2 text-end tabular-nums", m.declared > 0 && "text-warning")}>{m.declared}</td>
                      <td className={cn("px-3 py-2 text-end tabular-nums", overtimeOverCap(m.overtimeHours) && "font-bold text-warning")}>{m.overtimeHours}</td>
                    </tr>
                  ))}
                  {people.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {t("att.nobody")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
