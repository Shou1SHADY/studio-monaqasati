"use client"

// The punch feature's forms (optional: punch), on the prototype's X5F: the
// attendance source of a workplace (`am`, PRD form 21), the device file import
// with its review (`impdev`, form 22), "not overtime" with its reason (`otno`,
// form 20), the workplace's shifts (`shifts`, form 23) and a worker's shift
// from a date (`shiftset`, form 23). Each shows what blocks it before saving.

import { useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { FileUp, Loader2, LocateFixed } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import type { HrEmployee } from "@/lib/hr/employee"
import { displayName } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, todayDay } from "@/lib/hr/format"
import { parseCsv } from "@/lib/hr/import"
import {
  ATT_SOURCES,
  DEFAULT_GRACE_MIN,
  DEFAULT_RADIUS_M,
  deviceRows,
  GEO_MARGIN_M,
  MIN_RADIUS_M,
  OT_REFUSALS,
  reviewDeviceFile,
  siteSchedule,
  sourceBlocks,
  sourceOf,
  type AttSource,
  type DeviceReview,
  type OtRefusal,
  type PunchSite,
  type SiteAttendance,
} from "@/lib/hr/punches"
import { importDeviceFile, saveAttendanceSource, saveSiteShifts, setEmployeeShift } from "@/lib/hr/punch-writes"
import type { HrRequest } from "@/lib/hr/requests"
import {
  isNight,
  normalizeShifts,
  OT_MONTH_CAP,
  SHIFT_DEFAULTS,
  SHIFT_IDS,
  shiftIdOn,
  shiftOf,
  shiftsBlocks,
  shiftSetBlocks,
  siteShifts,
  type EmployeeShift,
  type ShiftDef,
  type ShiftId,
} from "@/lib/hr/shifts"
import { siteLabel } from "@/lib/hr/sites"
import { addDays } from "@/lib/hr/statutory"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"

type T = ReturnType<typeof useTranslations>

/** One choice as a card (the prototype's optBtn): a radio with its title and line. */
function Choice({ name, value, checked, onChange, title, line, disabled }: { name: string; value: string; checked: boolean; onChange: () => void; title: ReactNode; line?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring", checked && "border-module bg-module/5")}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} className="mt-1 accent-current" />
      <span className="min-w-0">
        <span className="block font-bold">{title}</span>
        {line && <span className="block text-xs text-muted-foreground">{line}</span>}
      </span>
    </label>
  )
}

function useRun(onDone: () => void) {
  const t = useTranslations("Portal.HR")
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
      onDone()
    } catch (err) {
      console.error(err)
      const key = err instanceof HrWriteError ? (err.blocks[0] ? `punch.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"
      toast({ title: t.has(key) ? t(key) : t("err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function Footer({ t, busy, onClose, onSave, disabled, label }: { t: T; busy: boolean; onClose: () => void; onSave: () => void; disabled: boolean; label: string }) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onClose} disabled={busy}>
        {t("cancel")}
      </Button>
      <Button onClick={onSave} disabled={busy || disabled}>
        {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
        {label}
      </Button>
    </DialogFooter>
  )
}

// ---------------------------------------------------------------------------
// Form `am` — the attendance source
// ---------------------------------------------------------------------------

export function SourceDialog({ access, actor, site, onClose }: { access: HrAccess; actor: HrActor; site: PunchSite; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { busy, run } = useRun(onClose)
  const sched = siteSchedule(site)
  const [source, setSource] = useState<AttSource>(sourceOf(site, true))
  const [tin, setTin] = useState(sched.in)
  const [tout, setTout] = useState(sched.out)
  const [grace, setGrace] = useState(String(site.att?.grace ?? DEFAULT_GRACE_MIN))
  const [r, setR] = useState(String(site.att?.geo?.r ?? DEFAULT_RADIUS_M))
  const [lat, setLat] = useState(site.att?.geo?.lat != null ? String(site.att.geo.lat) : "")
  const [lng, setLng] = useState(site.att?.geo?.lng != null ? String(site.att.geo.lng) : "")
  const [locating, setLocating] = useState(false)
  const shifts = siteShifts(site)
  const num = (s: string) => (s.trim() === "" ? null : Number(s))
  const input: SiteAttendance = {
    source,
    schedule: shifts ? (site.att?.schedule ?? null) : { in: tin, out: tout },
    grace: num(grace),
    geo: source === "app" ? { lat: num(lat), lng: num(lng), r: Number(r) } : null,
  }
  const blocks = sourceBlocks(input)
  const here = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6))
        setLng(p.coords.longitude.toFixed(6))
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("punch.am.title", { site: siteLabel({ name: site.name ?? "", nameEn: site.nameEn }, locale) })}</DialogTitle>
          <DialogDescription>{t("punch.am.sub")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2" role="radiogroup" aria-label={t("punch.am.source")}>
            {ATT_SOURCES.map((s) => (
              <Choice key={s} name="am" value={s} checked={source === s} onChange={() => setSource(s)} title={t(`punch.src.${s}`)} line={t(`punch.am.line_${s}`)} disabled={busy} />
            ))}
          </div>
          {source === "device" && <Callout tone="info">{t("punch.am.device_file")}</Callout>}
          {shifts ? (
            <p className="text-xs text-muted-foreground">{t("punch.am.has_shifts", { shifts: shifts.map((s) => t(`punch.shift.${s.id}`)).join(" / ") })}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="am-in">{t("punch.am.tin")}</Label>
                <Input id="am-in" type="time" dir="ltr" value={tin} onChange={(e) => setTin(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="am-out">{t("punch.am.tout")}</Label>
                <Input id="am-out" type="time" dir="ltr" value={tout} onChange={(e) => setTout(e.target.value)} disabled={busy} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="am-grace">{t("punch.am.grace")}</Label>
              <Input id="am-grace" type="number" min={0} max={60} dir="ltr" value={grace} onChange={(e) => setGrace(e.target.value)} disabled={busy} />
            </div>
            {source === "app" && (
              <div className="space-y-1.5">
                <Label htmlFor="am-r">{t("punch.am.radius")}</Label>
                <Input id="am-r" type="number" min={MIN_RADIUS_M} step={10} dir="ltr" value={r} onChange={(e) => setR(e.target.value)} disabled={busy} />
                <p className="text-[11px] text-muted-foreground">{t("punch.am.radius_hint", { m: GEO_MARGIN_M })}</p>
              </div>
            )}
          </div>
          {source === "app" && (
            <div className="space-y-2 rounded-xl border p-3">
              <p className="text-sm font-bold">{t("punch.am.centre")}</p>
              <p className="text-xs text-muted-foreground">{t("punch.am.centre_note")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="am-lat">{t("punch.am.lat")}</Label>
                  <Input id="am-lat" inputMode="decimal" dir="ltr" value={lat} onChange={(e) => setLat(e.target.value)} disabled={busy} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="am-lng">{t("punch.am.lng")}</Label>
                  <Input id="am-lng" inputMode="decimal" dir="ltr" value={lng} onChange={(e) => setLng(e.target.value)} disabled={busy} />
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={here} disabled={busy || locating}>
                {locating ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <LocateFixed size={14} className="me-1.5" aria-hidden="true" />}
                {t("punch.am.here")}
              </Button>
            </div>
          )}
          <Callout tone="info">{t("punch.am.info", { grace: DEFAULT_GRACE_MIN })}</Callout>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`punch.block.${b}`))} />
        </div>
        <Footer t={t} busy={busy} onClose={onClose} disabled={blocks.length > 0} label={t("save")} onSave={() => firestore && void run(() => saveAttendanceSource(firestore, access.ctx, site.id, actor, input), "punch.am.saved")} />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Form `impdev` — the device file
// ---------------------------------------------------------------------------

export function DeviceImportDialog({
  access,
  actor,
  site,
  employees,
  requests,
  onClose,
}: {
  access: HrAccess
  actor: HrActor
  site: PunchSite
  employees: HrEmployee[]
  requests: HrRequest[]
  onClose: () => void
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { busy, run } = useRun(onClose)
  const [review, setReview] = useState<DeviceReview | null>(null)
  const [fileName, setFileName] = useState("")
  const name = (id: string) => {
    const e = employees.find((x) => x.id === id)
    return e ? displayName(e, locale) : id
  }
  const read = (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    const fr = new FileReader()
    fr.onload = () => {
      const rows = deviceRows(parseCsv(String(fr.result ?? "")))
      setReview(reviewDeviceFile(rows, { site, employees: employees as Array<HrEmployee & { shift?: EmployeeShift | null }>, requests, today: todayDay() }))
    }
    fr.readAsText(file)
  }
  const siteName = siteLabel({ name: site.name ?? "", nameEn: site.nameEn }, locale)
  const n = review ? review.saved.length : 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(review ? "punch.dev.review_title" : "punch.dev.title", { site: siteName })}</DialogTitle>
          <DialogDescription>{review ? t("punch.dev.rows", { n: review.rows, file: fileName }) : t("punch.dev.columns")}</DialogDescription>
        </DialogHeader>
        {!review ? (
          <div className="space-y-4">
            <Callout tone="info">{t("punch.dev.info")}</Callout>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-sm font-bold hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring">
              <FileUp size={18} aria-hidden="true" />
              {t("punch.dev.choose")}
              <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => read(e.target.files?.[0])} aria-label={t("punch.dev.choose")} />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border px-3">
              <KeyValueRow label={t("punch.dev.k_saved")} value={n} strong />
              <KeyValueRow label={t("punch.dev.k_dup")} value={review.dup} />
              {review.dawn > 0 && <KeyValueRow label={t("punch.dev.k_dawn")} value={review.dawn} />}
              <KeyValueRow label={t("punch.dev.k_unknown")} value={<span className={cn(review.unknown.length > 0 && "text-destructive")}>{review.unknown.length}</span>} />
              <KeyValueRow label={t("punch.dev.k_late")} value={review.late} />
              {review.bad + review.future > 0 && <KeyValueRow label={t("punch.dev.k_bad")} value={review.bad + review.future} />}
            </div>
            {review.unknown.length > 0 && (
              <p className="text-xs text-muted-foreground" dir="ltr">
                {review.unknown.join(" · ")}
              </p>
            )}
            {review.leave.length > 0 && (
              <Callout tone="warn" title={t("punch.dev.leave_title")}>
                {review.leave.map((l) => `${name(l.employeeId)} (${hrDate(l.day, locale)})`).join(locale === "ar" ? "، " : ", ")} — {t("punch.dev.leave_note")}
              </Callout>
            )}
            {review.other.length > 0 && (
              <Callout tone="warn" title={t("punch.dev.other_title")}>
                {review.other.map((o) => name(o.employeeId)).join(locale === "ar" ? "، " : ", ")} — {t("punch.dev.other_note")}
              </Callout>
            )}
            {review.unknown.length > 0 && <Callout tone="info">{t("punch.dev.unknown_note")}</Callout>}
            <p className="text-xs text-muted-foreground">{t("punch.by", { name: actor.name || "—" })}</p>
          </div>
        )}
        {review && (
          <Footer
            t={t}
            busy={busy}
            onClose={onClose}
            disabled={n === 0 && review.other.length === 0}
            label={t("punch.dev.save", { n })}
            onSave={() => firestore && access.orgId && void run(() => importDeviceFile(firestore, access.ctx, access.orgId!, site, actor, review, employees as Array<HrEmployee & { shift?: EmployeeShift | null }>), "punch.dev.saved")}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Form `otno` — not overtime
// ---------------------------------------------------------------------------

export function NotOvertimeDialog({ name, h, day, onClose, onSave }: { name: string; h: number; day: string; onClose: () => void; onSave: (why: OtRefusal) => Promise<void> }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const { busy, run } = useRun(onClose)
  const [why, setWhy] = useState<OtRefusal | null>(null)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("punch.otno.title", { name })}</DialogTitle>
          <DialogDescription>{t("punch.otno.sub", { h, date: hrDate(day, locale) })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Callout tone="info">{t("punch.otno.info")}</Callout>
          <div className="grid gap-2" role="radiogroup" aria-label={t("punch.otno.why")}>
            {OT_REFUSALS.map((w) => (
              <Choice key={w} name="otno" value={w} checked={why === w} onChange={() => setWhy(w)} title={t(`punch.otno.${w}`)} disabled={busy} />
            ))}
          </div>
        </div>
        <Footer t={t} busy={busy} onClose={onClose} disabled={!why} label={t("punch.otno.save")} onSave={() => why && void run(() => onSave(why), "punch.otno.saved")} />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Form `shifts` — the workplace's shifts
// ---------------------------------------------------------------------------

export function ShiftsDialog({ access, actor, site, people, onClose }: { access: HrAccess; actor: HrActor; site: PunchSite; people: Array<{ id: string; shift?: EmployeeShift | null }>; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { busy, run } = useRun(onClose)
  const current = siteShifts(site)
  const [on, setOn] = useState(Boolean(current))
  const [rows, setRows] = useState<Record<ShiftId, { use: boolean; in: string; out: string }>>(() =>
    Object.fromEntries(
      SHIFT_IDS.map((id) => {
        const x = current?.find((s) => s.id === id)
        return [id, { use: current ? Boolean(x) : id !== "n" || site.type === "workshop", in: x?.in ?? SHIFT_DEFAULTS[id].in, out: x?.out ?? SHIFT_DEFAULTS[id].out }]
      })
    ) as Record<ShiftId, { use: boolean; in: string; out: string }>
  )
  const input = normalizeShifts({ on, list: SHIFT_IDS.filter((id) => rows[id].use).map((id): ShiftDef => ({ id, in: rows[id].in, out: rows[id].out })) })
  const blocks = shiftsBlocks(input)
  const set = (id: ShiftId, patch: Partial<{ use: boolean; in: string; out: string }>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("punch.shifts.title", { site: siteLabel({ name: site.name ?? "", nameEn: site.nameEn }, locale) })}</DialogTitle>
          <DialogDescription>{t("punch.shifts.sub")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm">
            <Checkbox checked={on} onCheckedChange={(c) => setOn(c === true)} disabled={busy} className="mt-0.5" aria-label={t("punch.shifts.on")} />
            <span>
              <span className="block font-bold">{t("punch.shifts.on")}</span>
              <span className="block text-xs text-muted-foreground">{t("punch.shifts.off_note")}</span>
            </span>
          </label>
          {on &&
            SHIFT_IDS.map((id) => (
              <div key={id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
                <Checkbox checked={rows[id].use} onCheckedChange={(c) => set(id, { use: c === true })} disabled={busy} aria-label={t(`punch.shift.${id}`)} />
                <span className="min-w-0 flex-1 basis-32">
                  <span className="block text-sm font-bold">{t(`punch.shift.${id}`)}</span>
                  {isNight(rows[id]) && <span className="block text-[11px] text-muted-foreground">{t("punch.shifts.night_note")}</span>}
                </span>
                <Input type="time" dir="ltr" aria-label={t("punch.shifts.in_of", { shift: t(`punch.shift.${id}`) })} value={rows[id].in} onChange={(e) => set(id, { in: e.target.value })} disabled={busy || !rows[id].use} className="h-8 w-28" />
                <span aria-hidden="true">–</span>
                <Input type="time" dir="ltr" aria-label={t("punch.shifts.out_of", { shift: t(`punch.shift.${id}`) })} value={rows[id].out} onChange={(e) => set(id, { out: e.target.value })} disabled={busy || !rows[id].use} className="h-8 w-28" />
              </div>
            ))}
          <Callout tone="info">{t("punch.shifts.law", { cap: OT_MONTH_CAP })}</Callout>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`punch.block.${b}`))} />
        </div>
        <Footer
          t={t}
          busy={busy}
          onClose={onClose}
          disabled={blocks.length > 0}
          label={t("save")}
          onSave={() => firestore && access.orgId && void run(() => saveSiteShifts(firestore, access.ctx, access.orgId!, site.id, actor, input, people), "punch.shifts.saved")}
        />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Form `shiftset` — a worker's shift from a date
// ---------------------------------------------------------------------------

export function ShiftSetDialog({ access, actor, emp, site, people, onClose }: { access: HrAccess; actor: HrActor; emp: HrEmployee & { shift?: EmployeeShift | null }; site: PunchSite; people: Array<HrEmployee & { shift?: EmployeeShift | null }>; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { busy, run } = useRun(onClose)
  const today = todayDay()
  const list = siteShifts(site)
  const now = shiftOf(emp, site, today)
  const [shiftId, setShiftId] = useState<ShiftId | null>(now?.id ?? null)
  const [from, setFrom] = useState(addDays(today, 1))
  const blocks = shiftSetBlocks({ list, shiftId, from: from || null, today, current: from ? shiftIdOn(emp, from) : null })
  const counts = useMemo(() => Object.fromEntries((list ?? []).map((s) => [s.id, people.filter((p) => p.siteId === site.id && p.status === "active" && shiftOf(p, site, today)?.id === s.id).length])), [list, people, site, today])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("punch.shiftset.title", { name: displayName(emp, locale) })}</DialogTitle>
          <DialogDescription>{t("punch.shiftset.sub", { trade: t(`trade.${emp.trade}` as "trade.mason"), site: siteLabel({ name: site.name ?? "", nameEn: site.nameEn }, locale), now: now ? t(`punch.shift.${now.id}`) : "—" })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2" role="radiogroup" aria-label={t("punch.shiftset.shift")}>
            {(list ?? []).map((s) => (
              <Choice
                key={s.id}
                name="shiftset"
                value={s.id}
                checked={shiftId === s.id}
                onChange={() => setShiftId(s.id)}
                title={
                  <>
                    {t(`punch.shift.${s.id}`)}{" "}
                    <bdi dir="ltr" className="tabular-nums">
                      {s.in}–{s.out}
                    </bdi>
                  </>
                }
                line={`${t("punch.shiftset.on_it", { n: counts[s.id] ?? 0 })}${isNight(s) ? ` · ${t("punch.shifts.ends_next")}` : ""}`}
                disabled={busy}
              />
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shiftset-from">{t("punch.shiftset.from")}</Label>
            <Input id="shiftset-from" type="date" dir="ltr" min={today} value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
            <p className="text-[11px] text-muted-foreground">{t("punch.shiftset.from_note")}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t("punch.by", { name: actor.name || "—" })}</p>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`punch.block.${b}`))} />
        </div>
        <Footer t={t} busy={busy} onClose={onClose} disabled={blocks.length > 0} label={t("punch.shiftset.save")} onSave={() => firestore && void run(() => setEmployeeShift(firestore, access.ctx, emp.id, actor, { shiftId, from }), "punch.shiftset.saved")} />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Declining a correction — the reason goes back to the employee
// ---------------------------------------------------------------------------

export function DeclineDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useTranslations("Portal.HR")
  const { busy, run } = useRun(onClose)
  const [note, setNote] = useState("")
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("punch.fix.decline_sub")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="fix-why">{t("punch.fix.why")}</Label>
          <Textarea id="fix-why" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </div>
        <Footer t={t} busy={busy} onClose={onClose} disabled={!note.trim()} label={t("punch.fix.decline")} onSave={() => void run(() => onSave(note), "punch.fix.declined")} />
      </DialogContent>
    </Dialog>
  )
}

