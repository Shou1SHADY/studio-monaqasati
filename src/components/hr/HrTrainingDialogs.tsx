"use client"

// Training's two forms (PRD form 28, WF-20; the prototype's X5F.sess / X5F.sessdone). Schedule: a day (not past;
// a public holiday is flagged), seats (15 for a certificate course, 8 otherwise), for a certificate course the
// workplace it draws from; the participants are the gaps for that certificate not already booked — worst first —
// or the people reviews named, the first `seats` taken, any one unticked; an external course shows its estimated
// cost (money roles) and that Finance is asked after it runs. Result: everyone attended and passed — untick who
// did not; the certificate's validity, and the actual cost with the workplaces it is charged to.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { displayName, type HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, hrMoney, todayDay } from "@/lib/hr/format"
import { holidayOn } from "@/lib/hr/holidays"
import { siteLabel, type HrSite } from "@/lib/hr/sites"
import { addDays } from "@/lib/hr/statutory"
import { attendees, CERT_SITE_TYPES, CERTS, certExpiry, certState, courseOf, resultBlocks, scheduleBlocks, sessionPool, trainingCost, type CertGap, type Course, type TrainingSession } from "@/lib/hr/training"
import { recordSessionResult, scheduleSession } from "@/lib/hr/training-writes"
import { HrWriteError } from "@/lib/hr/write-guard"
import { CertChip } from "./HrCertChip"

const scheduleSchema = z.object({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seats: z.coerce.number().int().min(1),
  siteId: z.string(),
})
type ScheduleForm = z.infer<typeof scheduleSchema>

export function ScheduleSessionDialog({
  access,
  actor,
  course,
  siteId,
  employees,
  sites,
  gaps,
  sessions,
  needs,
  onClose,
}: {
  access: HrAccess
  actor: HrActor
  course: Course
  siteId: string | null
  employees: HrEmployee[]
  sites: HrSite[]
  gaps: CertGap[]
  sessions: TrainingSession[]
  needs: Array<{ employeeId: string; need?: string | null }>
  onClose: () => void
}) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const money = access.allowed("pay.view")
  const form = useForm<ScheduleForm>({ resolver: zodResolver(scheduleSchema), defaultValues: { at: addDays(today, 7), seats: course.cert ? 15 : 8, siteId: siteId ?? "" } })
  const [at, seatsRaw, site] = useWatch({ control: form.control, name: ["at", "seats", "siteId"] })
  const seats = Number(seatsRaw) || 0
  const [excluded, setExcluded] = useState<string[]>([])
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const pool = useMemo(() => sessionPool(course, { gaps, sessions, needs, byId: (id) => byId.get(id), today, siteId: site || null }), [course, gaps, sessions, needs, byId, today, site])
  const picked = pool.filter((id) => !excluded.includes(id)).slice(0, seats)
  const blocks = scheduleBlocks({ course: course.id, at, seats, ppl: picked }, today)
  const holiday = at ? holidayOn(at) : null
  const certSites = sites.filter((s) => s.active !== false && CERT_SITE_TYPES.includes(s.type))

  const submit = form.handleSubmit(async (v) => {
    if (!firestore || !access.orgId || blocks.length) return
    try {
      const people = picked.map((id) => ({ id, name: byId.get(id) ? displayName(byId.get(id) as HrEmployee, "ar") : id, siteId: byId.get(id)?.siteId ?? null }))
      await scheduleSession(firestore, access.ctx, access.orgId, actor, { course: course.id, at: v.at, seats: v.seats, siteId: v.siteId || null, people }, { sites, today })
      toast({ title: t("train.scheduled", { n: people.length }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `train.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    }
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("train.sess_title", { course: t(`train.course.${course.id}` as "train.course.ind") })}</DialogTitle>
          <DialogDescription>
            {t(`train.provider.${course.id}` as "train.provider.ind")} · {t("train.hours", { n: course.hours })}
            {course.cert ? ` · ${t("train.cert_valid", { n: CERTS[course.cert].months })}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sess-at">{t("train.f.at")}</Label>
              <Input id="sess-at" type="date" dir="ltr" min={today} {...form.register("at")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sess-seats">{t("train.f.seats")}</Label>
              <Input id="sess-seats" type="number" min={1} step={1} dir="ltr" {...form.register("seats")} />
            </div>
          </div>
          {course.cert && (
            <div className="space-y-1.5">
              <Label htmlFor="sess-site">{t("train.f.site")}</Label>
              <NativeSelect id="sess-site" className="w-full" {...form.register("siteId")}>
                <option value="">{t("train.f.all_sites")}</option>
                {certSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {siteLabel(s, locale)}
                  </option>
                ))}
              </NativeSelect>
              {course.kind === "internal" && <p className="text-[11px] text-muted-foreground">{t("train.f.site_internal")}</p>}
            </div>
          )}
          {course.kind === "external" && money && (
            <div className="rounded-xl border px-3">
              <KeyValueRow label={t("train.f.estimate")} value={`${hrMoney(picked.length * course.cost)} (${picked.length} × ${hrMoney(course.cost)})`} ltr strong />
              <KeyValueRow label={t("train.f.payment")} value={t("train.f.payment_after")} />
            </div>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between text-sm font-bold">
              <span>{t("train.f.participants")}</span>
              <span className="tabular-nums text-muted-foreground" dir="ltr">
                {picked.length}/{pool.length}
              </span>
            </div>
            <ul className="max-h-56 divide-y overflow-y-auto rounded-xl border" aria-label={t("train.f.participants")}>
              {pool.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">{t("train.f.nobody")}</li>}
              {pool.slice(0, 40).map((id) => {
                const e = byId.get(id)
                const on = !excluded.includes(id)
                const within = picked.includes(id)
                return (
                  <li key={id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2">
                      <Checkbox checked={on} disabled={on && !within} onCheckedChange={(c) => setExcluded((x) => (c ? x.filter((y) => y !== id) : [...x, id]))} aria-label={e ? displayName(e, locale) : id} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{e ? displayName(e, locale) : id}</span>
                        <span className="block text-xs text-muted-foreground">{e ? t(`trade.${e.trade}` as "trade.mason") : ""}</span>
                      </span>
                      {course.cert && e && <CertChip k={course.cert} state={certState(e.certs, course.cert, today)} expiry={e.certs?.[course.cert]} />}
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("train.f.worst_first")}</p>
          </div>
          {holiday && <Callout tone="warn">{t("train.f.holiday")}</Callout>}
          <p className="text-xs text-muted-foreground">{t("train.f.by", { name: actor.name || "—" })}</p>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`train.block.${b}`))} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting || blocks.length > 0}>
              {form.formState.isSubmitting && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("train.f.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const resultSchema = z.object({ absent: z.array(z.string()) })
type ResultForm = z.infer<typeof resultSchema>

export function SessionResultDialog({ access, actor, session, employees, sites, onClose }: { access: HrAccess; actor: HrActor; session: TrainingSession; employees: HrEmployee[]; sites: HrSite[]; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const money = access.allowed("pay.view")
  const form = useForm<ResultForm>({ resolver: zodResolver(resultSchema), defaultValues: { absent: [] } })
  const absent = useWatch({ control: form.control, name: "absent" })
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const passed = attendees({ ppl: session.ppl, abs: absent })
  const blocks = resultBlocks(session, absent, today)
  const courseDef = courseOf(session.course)
  const cost = courseDef ? trainingCost(courseDef, passed.map((id) => byId.get(id)?.siteId ?? null), sites) : { amount: 0, lines: [] }
  const name = (id: string) => (byId.get(id) ? displayName(byId.get(id) as HrEmployee, locale) : (session.names?.[id] ?? id))

  const submit = form.handleSubmit(async (v) => {
    if (!firestore || blocks.length) return
    try {
      const r = await recordSessionResult(firestore, access.ctx, actor, session.id, { absent: v.absent }, { sites, employeeSites: new Map(employees.map((e) => [e.id, e.siteId ?? null])), today })
      toast({ title: r.cost ? t("train.recorded_cost", { n: r.passed }) : t("train.recorded", { n: r.passed }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `train.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    }
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("train.res_title", { course: t(`train.course.${session.course}` as "train.course.ind") })}</DialogTitle>
          <DialogDescription>
            {hrDate(session.at, locale)} · {session.siteId ? (sites.find((s) => s.id === session.siteId) ? siteLabel(sites.find((s) => s.id === session.siteId) as HrSite, locale) : "—") : t(`train.provider.${session.course}` as "train.provider.ind")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Callout tone="info">
            {t("train.res_note")}
            {courseDef?.cert ? ` ${t("train.res_valid", { date: hrDate(certExpiry(session.at, courseDef.cert), locale) })}` : ""}
          </Callout>
          <ul className="max-h-60 divide-y overflow-y-auto rounded-xl border" aria-label={t("train.f.participants")}>
            {session.ppl.map((id) => (
              <li key={id}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2">
                  <Checkbox
                    checked={!absent.includes(id)}
                    onCheckedChange={(on) => form.setValue("absent", on ? absent.filter((x) => x !== id) : [...absent, id], { shouldDirty: true })}
                    aria-label={name(id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{name(id)}</span>
                    <span className="block text-xs text-muted-foreground">{byId.get(id) ? t(`trade.${byId.get(id)!.trade}` as "trade.mason") : ""}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {courseDef?.kind === "external" && money && (
            <div className="rounded-xl border px-3">
              <KeyValueRow label={t("train.res_cost")} value={hrMoney(cost.amount)} ltr strong />
              <KeyValueRow label={t("train.res_charged")} value={[...new Set(cost.lines.map((l) => t(`cost_kind.${l.costKind}` as "cost_kind.direct")))].join(" · ") || "—"} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("train.f.by", { name: actor.name || "—" })}</p>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`train.block.${b}`))} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting || blocks.length > 0}>
              {form.formState.isSubmitting && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("train.res_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
